import { createHash, verify, type KeyObject } from 'node:crypto'
import { win32 } from 'node:path'
import { WindowsRepairDurableJournal, applyRecoverableWindowsRepair, recoverWindowsRepairJournal } from './windowsInstallRepairRecovery'
import type { WindowsRepairMutation } from './windowsInstallRepairRecovery'
import { createWindowsRepairNativeJournalHost, prepareWindowsRepairNativeMutations,
  requireWindowsRepairNativeAuthority, windowsRepairNativeJournalBinding, bindWindowsRepairNativeRecoveryBackend } from './windowsInstallRepairNativeBackend'
import type { CompiledRepairTrust, VerifiedRepairArtifacts, WindowsRepairNativeLaunchFacts } from './windowsInstallRepairConsumer'
import type { WindowsRepairNativeAuthority, WindowsRepairNativeJournalOptions, WindowsRepairNativeJournalPorts } from './windowsInstallRepairNativeBackend'
import {
  createWindowsInstallRepairPreflight, revalidateWindowsInstallRepairPlan, verifyWindowsInstallRepairReceipt,
  windowsInstallRepairTypedValuesDigest, windowsInstallRepairInventoryDigest,
} from './windowsInstallRepairPreflight'
import type {
  WindowsInstallRepairPolicy, WindowsInstallRepairPlan, WindowsInstallRepairSnapshot,
  WindowsInstallRepairReceipt, WindowsRepairTypedRegistryValue, WindowsInstallRepairSelection,
} from './windowsInstallRepairPreflight'

export interface WindowsRepairProducerReceipt {
  schemaVersion: 1
  kind: 'rt-windows-repair-producer-v1'
  repository: string
  sourceCommit: string
  sourceTree: string
  workflow: string
  runId: string
  artifactSha256: string
  policy: WindowsInstallRepairPolicy
  registration: WindowsInstallRepairSelection & {
    installValues: WindowsRepairTypedRegistryValue[]
    uninstallValues: WindowsRepairTypedRegistryValue[]
  }
  programMembers: string[]
}
export interface WindowsRepairExecutorTrust {
  // Embedded by the reviewed consumer/build, NEVER populated from request JSON.
  publicKey: KeyObject
  producerReceiptSha256: string
  repository: string
  sourceCommit: string
  sourceTree: string
  workflow: string
  runId: string
  appId: string
  installerSha256: string
  capabilityReviewSha256: string
}
export interface WindowsRepairTransactionPorts {
  // These ports must be implemented by the reviewed privileged Windows host.
  // They are not request-supplied functions or a substitute for native evidence.
  validateNewPayload(receipt: WindowsRepairProducerReceipt): Promise<void>
  collect(policy: WindowsInstallRepairPolicy): Promise<WindowsInstallRepairSnapshot>
  authorizeExplicitRepair(plan: WindowsInstallRepairPlan): Promise<boolean>
  applyVerifiedProgramPayload(receipt: WindowsRepairProducerReceipt, plan: WindowsInstallRepairPlan): Promise<{ writtenMembers: string[]; evidence: Uint8Array }>
  // Legacy host seam; this is NOT an atomic BOTH-key commit with expected old typed values, matching scope/view;
  // no delete-key/rewrite-before-verification/old-uninstaller port is exposed.
  commitRegistration(receipt: WindowsRepairProducerReceipt, before: WindowsInstallRepairSnapshot): Promise<Uint8Array>
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function fail(reason: string): never { throw new Error('WINDOWS_INSTALL_REPAIR_EXECUTOR_FAILED:' + reason) }
function stable(value: unknown): string {
  return JSON.stringify(value, (_name, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
}
function producer(bytes: Uint8Array, signature: Uint8Array, trust: WindowsRepairExecutorTrust): WindowsRepairProducerReceipt {
  if (bytes.byteLength > 2 * 1024 * 1024 || hash(bytes) !== trust.producerReceiptSha256 ||
      trust.publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, bytes, trust.publicKey, signature)) fail('untrusted-producer')
  let value: WindowsRepairProducerReceipt
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { fail('invalid-producer') }
  if (value.schemaVersion !== 1 || value.kind !== 'rt-windows-repair-producer-v1' ||
      !/^[a-f0-9]{40}$/.test(value.sourceCommit) || !/^[a-f0-9]{40}$/.test(value.sourceTree) || !/^\d+$/.test(value.runId) ||
      ['repository', 'sourceCommit', 'sourceTree', 'workflow', 'runId'].some(key => (value as any)[key] !== (trust as any)[key]) ||
      value.policy?.appId !== trust.appId || value.artifactSha256 !== trust.installerSha256 ||
      value.policy.installer.sha256 !== trust.installerSha256 || value.policy.capabilityReviewSha256 !== trust.capabilityReviewSha256) fail('producer-identity')
  const registration = value.registration
  if (!registration || !Array.isArray(registration.installValues) || !Array.isArray(registration.uninstallValues)) fail('registration-contract')
  const expected = { scope: registration.scope, view: registration.view,
    installValuesSha256: windowsInstallRepairTypedValuesDigest(registration.installValues),
    uninstallValuesSha256: windowsInstallRepairTypedValuesDigest(registration.uninstallValues) }
  if (stable(expected) !== stable(value.policy.expectedRegistration)) fail('registration-contract')
  const locations = registration.installValues.filter(item => item.name.toLowerCase() === 'installlocation')
  if (locations.length !== 1 || locations[0].type !== 'REG_SZ' ||
      locations[0].data !== 'D:\\Program Files\\RT-ResearchFlow') fail('registration-target')
  if (!Array.isArray(value.programMembers) || !value.programMembers.length || value.programMembers.length > 100000) fail('program-members')
  for (const name of value.programMembers) {
    if (typeof name !== 'string' || !name.split('/').every(part => part && part !== '.' && part !== '..' &&
        !/[<>:"\\|?*\x00-\x1f]/.test(part) && !/[ .]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('program-members')
  }
  if (new Set(value.programMembers.map(name => name.toLowerCase())).size !== value.programMembers.length) fail('program-members')
  return value
}
function writableMembers(receipt: WindowsRepairProducerReceipt, plan: WindowsInstallRepairPlan) {
  const key = (name: string) => win32.resolve(name).toLowerCase()
  const overlaps = (a: string, b: string) => a === b || a.startsWith(b + '\\') || b.startsWith(a + '\\')
  const protectedRoots = receipt.policy.dataRoots.map(key)
  for (const name of receipt.programMembers) {
    const destination = key(win32.join(plan.target, ...name.split('/')))
    if (name.split('/').some(part => /^(data|userdata|user-data|backups?)$/i.test(part)) ||
        protectedRoots.some(root => overlaps(destination, root)) ||
        plan.protectedPaths.some(item => item.path.toLowerCase() !== plan.target.toLowerCase() &&
          (item.kind === 'directory' ? destination === key(item.path) || key(item.path).startsWith(destination + '\\')
            : overlaps(destination, key(item.path))))) fail('protected-program-member')
  }
}
function preservation(before: WindowsInstallRepairSnapshot, after: WindowsInstallRepairSnapshot, plan: WindowsInstallRepairPlan, now: number) {
  if (after.collectionId === before.collectionId || after.observedAtMs > now || now - after.observedAtMs > 300000 ||
      after.activeWorkers !== 0 || after.sqliteState !== 'closed-consistent' || stable(before.registry) !== stable(after.registry) ||
      stable(before.installer) !== stable(after.installer) || stable(before.data) !== stable(after.data)) fail('preservation-before-commit')
  for (const data of after.data) {
    if (!data.complete || data.entries.some(entry => /-(wal|shm)$/i.test(entry.path)) ||
        windowsInstallRepairInventoryDigest(data.entries) !== data.backup.inventorySha256) fail('preservation-before-commit')
  }
  for (const expected of plan.protectedPaths) {
    const actual = after.paths.find(item => item.path.toLowerCase() === expected.path.toLowerCase())
    if (stable(actual) !== stable(expected)) fail('protected-path-changed')
  }
}

// Non-pure transaction orchestration. No production consumer/privileged host is
// registered yet: this API alone does not make /RTRepair usable or authorize IO.
export async function executeWindowsInstallRepairTransaction(
  trust: WindowsRepairExecutorTrust, producerBytes: Uint8Array, signature: Uint8Array,
  ports: WindowsRepairTransactionPorts, clock = Date.now,
) {
  const receipt = producer(producerBytes, signature, trust)
  await ports.validateNewPayload(receipt)
  const initial = await ports.collect(receipt.policy)
  const result = createWindowsInstallRepairPreflight(receipt.policy, initial, receipt.registration, clock())
  if (result.kind !== 'preflight-candidate') fail('preflight-not-repairable')
  const plan = result.plan
  writableMembers(receipt, plan)
  if (!await ports.authorizeExplicitRepair(plan)) fail('explicit-consent-required')
  const before = await ports.collect(receipt.policy)
  revalidateWindowsInstallRepairPlan(receipt.policy, plan, before, clock())
  // Re-check the payload after consent and fresh recollection, before any write.
  await ports.validateNewPayload(receipt)
  const applied = await ports.applyVerifiedProgramPayload(receipt, plan)
  if (!(applied.evidence instanceof Uint8Array) || !applied.evidence.byteLength || applied.evidence.byteLength > 2 * 1024 * 1024 ||
      stable([...applied.writtenMembers].sort()) !== stable([...receipt.programMembers].sort())) fail('owned-write-observation')
  const staged = await ports.collect(receipt.policy)
  preservation(before, staged, plan, clock())
  if (staged.product?.kind !== 'owned-payload' || staged.product.root !== plan.target || staged.product.appId !== receipt.policy.appId ||
      staged.product.identityVerified !== true || staged.product.productProofSha256 !== receipt.policy.installer.releaseReceiptSha256 ||
      staged.product.mainExecutableSha256 !== receipt.policy.installer.mainExecutableSha256 ||
      staged.paths.find(item => item.path === win32.join(plan.target, receipt.policy.executableName))?.sha256 !== receipt.policy.installer.mainExecutableSha256) fail('new-payload-before-commit')
  const committed = await ports.commitRegistration(receipt, staged)
  if (!(committed instanceof Uint8Array) || !committed.byteLength || committed.byteLength > 2 * 1024 * 1024) fail('registration-observation')
  const completedAtMs = clock()
  const after = await ports.collect(receipt.policy)
  const row = after.registry.find(item => item.scope === plan.scope && item.view === plan.view)
  if (!row?.installValuesSha256 || !row.uninstallValuesSha256 || !row.rawValuesSha256) fail('registration-observation')
  const observed: WindowsInstallRepairReceipt = {
    protocol: plan.protocol, planSha256: plan.planSha256, appId: plan.appId, target: plan.target, scope: plan.scope, view: plan.view,
    steps: [...plan.steps], collectorEvidenceSha256: hash(Buffer.concat([Buffer.from(applied.evidence), Buffer.from(committed)])),
    oldUninstallerExecutions: 0, foreignPathMutations: 0, registrationMutatedBeforeVerification: false,
    committedInstallValuesSha256: row.installValuesSha256, committedUninstallValuesSha256: row.uninstallValuesSha256,
    committedRegistrySha256: row.rawValuesSha256, completedAtMs,
  }
  const checked = verifyWindowsInstallRepairReceipt(receipt.policy, plan, before, after, observed, clock())
  return { kind: 'repair-transaction-observed' as const, receipt: observed, checked, nativeEffectsIndependentlyAccepted: false as const }
}


export interface WindowsRepairNativeExecutionOptions extends WindowsRepairNativeJournalOptions {
  journalName: string
  ports: WindowsRepairNativeJournalPorts
}

// Production wiring consumes detached artifacts/native session via
// bindWindowsRepairNativeBackend. Never use the legacy receipt-port transaction
// as proof of privileged native effects or fabricate a NativeGrant from JSON.
export async function executeWindowsRepairNativeJournal(
  authority: WindowsRepairNativeAuthority, options: WindowsRepairNativeExecutionOptions,
) {
  const verified = requireWindowsRepairNativeAuthority(authority)
  if (Date.now() > verified.plan.expiresAtMs || !/^[a-f0-9]{32}\.journal$/.test(options.journalName)) fail('native-plan')
  const ports = Object.freeze({ ...options.ports }), hostOptions = Object.freeze({ hostPath: options.hostPath, systemRoot: options.systemRoot })
  const operations = await prepareWindowsRepairNativeMutations(authority, hostOptions, ports)
  const journal = WindowsRepairDurableJournal.open(verified.roots.journalRoot, options.journalName, windowsRepairNativeJournalBinding(authority), operations)
  try {
    const host = await createWindowsRepairNativeJournalHost(authority, journal, hostOptions, ports)
    const result = await applyRecoverableWindowsRepair(journal, operations, host)
    return { ...result, journalPath: journal.path, nativeEffectsIndependentlyAccepted: false as const }
  } finally { journal.close() }
}

// Reopen the original protected journal, never mint a new fresh plan to erase
// evidence of partial registration. Unknown native outcomes keep all evidence.
export async function recoverWindowsRepairNativeTransaction(
  authority: WindowsRepairNativeAuthority, options: WindowsRepairNativeExecutionOptions,
  originalOperations: WindowsRepairMutation[],
) {
  const verified = requireWindowsRepairNativeAuthority(authority)
  const journalPath = win32.join(verified.roots.journalRoot, options.journalName)
  await options.ports.assertJournalProtected(journalPath)
  const journal = WindowsRepairDurableJournal.open(verified.roots.journalRoot, options.journalName, windowsRepairNativeJournalBinding(authority), originalOperations, undefined, true)
  try {
    const host = await createWindowsRepairNativeJournalHost(authority, journal, options, options.ports)
    return { kind: await recoverWindowsRepairJournal(journal, originalOperations, host),
      journalPath: journal.path, nativeEffectsIndependentlyAccepted: false as const }
  } finally { journal.close() }
}


// CLI cold-start entry. Compiled trust is source-owned, artifacts are freshly
// byte/signature-verified, and facts come from the existing native launch port.
// None may be populated from untrusted command JSON or an environment true flag.
export async function recoverWindowsRepairNativeJournal(
  trust: CompiledRepairTrust, artifacts: VerifiedRepairArtifacts, facts: WindowsRepairNativeLaunchFacts,
  options: WindowsRepairNativeExecutionOptions & { journalRoot: string },
) {
  if (!['D:' + win32.sep, 'K:' + win32.sep].includes(win32.parse(options.journalRoot).root.toUpperCase()) || win32.normalize(options.journalRoot) !== options.journalRoot ||
      !/^[a-f0-9]{32}\.journal$/.test(options.journalName)) fail('native-journal')
  const ports = Object.freeze({ ...options.ports })
  await ports.assertJournalProtected(win32.join(options.journalRoot, options.journalName))
  const journal = WindowsRepairDurableJournal.reopen(options.journalRoot, options.journalName)
  try {
    const authority = await bindWindowsRepairNativeRecoveryBackend(trust, artifacts, journal, facts, ports)
    const host = await createWindowsRepairNativeJournalHost(authority, journal, options, ports)
    const begin = journal.events()[0]
    if (begin.kind !== 'begin') fail('native-journal')
    return { kind: await recoverWindowsRepairJournal(journal, begin.operations, host),
      journalPath: journal.path, nativeEffectsIndependentlyAccepted: false as const }
  } finally { journal.close() }
}
