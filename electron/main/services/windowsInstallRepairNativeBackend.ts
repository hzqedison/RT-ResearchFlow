import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { win32 } from 'node:path'
import { requireWindowsRepairNativeGrant, resolveWindowsRepairConsumerRoots, requireVerifiedRepairArtifacts } from './windowsInstallRepairConsumer'
import type { WindowsRepairNativeGrant, WindowsRepairResolvedRoots, VerifiedRepairArtifacts, WindowsRepairRuntimeSession, CompiledRepairTrust, WindowsRepairNativeLaunchFacts } from './windowsInstallRepairConsumer'
import { windowsRepairCollectorInvocation } from './windowsInstallRepairCollector'
import type { WindowsRepairCollectorInvocation } from './windowsInstallRepairCollector'
import { windowsInstallRepairTypedValuesDigest, revalidateWindowsInstallRepairPlan } from './windowsInstallRepairPreflight'
import type { WindowsRepairTypedRegistryValue, WindowsInstallRepairPolicy, WindowsInstallRepairPlan, WindowsInstallRepairSnapshot } from './windowsInstallRepairPreflight'
import { requireWindowsRepairVerifiedPlan } from './windowsInstallRepairPlanCapability'
import type { WindowsRepairVerifiedPlan } from './windowsInstallRepairPlanCapability'
import { WindowsRepairDurableJournal } from './windowsInstallRepairRecovery'
import type { WindowsRepairImage, WindowsRepairMutation, WindowsRepairRecoveryHost, WindowsRepairRecoveryBinding } from './windowsInstallRepairRecovery'

// Detached artifacts + native session + fresh internally derived plan. This is
// a backend-local capability, never a fabricated Consumer NativeGrant.
export interface WindowsRepairNativeContext {
  readonly kind: 'rt-windows-repair-native-context-v1'
  readonly roots: Omit<WindowsRepairResolvedRoots, 'producerKey'>
  readonly plan: WindowsInstallRepairPlan
  readonly receipt: { readonly policy: WindowsInstallRepairPolicy; readonly registration: {
    readonly installValues: WindowsRepairTypedRegistryValue[]; readonly uninstallValues: WindowsRepairTypedRegistryValue[]
  } }
  readonly beforeRegistry: WindowsRepairNativeGrant['beforeRegistry']
  readonly beforeSnapshot: WindowsInstallRepairSnapshot
}
export type WindowsRepairNativeJournalAuthorization = Omit<WindowsRepairNativeContext, 'kind'>
export type WindowsRepairNativeAuthority = WindowsRepairNativeGrant | WindowsRepairNativeContext
const nativeContexts = new WeakSet<object>()
const recoveryOnlyAuthorities = new WeakSet<object>()
function freezeNative<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeNative(child); Object.freeze(value) }
  return value
}
export function requireWindowsRepairNativeAuthority(value: WindowsRepairNativeAuthority) {
  if (value && nativeContexts.has(value)) return value as WindowsRepairNativeContext
  return requireWindowsRepairNativeGrant(value as WindowsRepairNativeGrant)
}
function requireForwardAuthority(value: WindowsRepairNativeAuthority) {
  if (recoveryOnlyAuthorities.has(value)) fail()
  return requireWindowsRepairNativeAuthority(value)
}
export function bindWindowsRepairNativeBackend(
  artifacts: VerifiedRepairArtifacts, session: WindowsRepairRuntimeSession, verifiedPlan: WindowsRepairVerifiedPlan,
  registration: { installValues: WindowsRepairTypedRegistryValue[]; uninstallValues: WindowsRepairTypedRegistryValue[] },
): WindowsRepairNativeContext {
  const { producerKey: _producerKey, ...roots } = resolveWindowsRepairConsumerRoots(artifacts, session, verifiedPlan)
  const validated = requireWindowsRepairVerifiedPlan(verifiedPlan), expected = validated.policy.expectedRegistration
  if (!registration || !expected || expected.scope !== roots.scope || expected.view !== roots.view ||
      windowsInstallRepairTypedValuesDigest(registration.installValues) !== expected.installValuesSha256 ||
      windowsInstallRepairTypedValuesDigest(registration.uninstallValues) !== expected.uninstallValuesSha256 ||
      !registration.installValues.some(value => value.name.toLowerCase() === 'installlocation' && value.type === 'REG_SZ' && value.data === roots.target)) fail()
  const context = freezeNative({ kind: 'rt-windows-repair-native-context-v1' as const, roots,
    plan: structuredClone(validated.plan), receipt: { policy: structuredClone(validated.policy), registration: structuredClone(registration) },
    beforeRegistry: structuredClone(validated.current.registry), beforeSnapshot: structuredClone(validated.current) })
  nativeContexts.add(context)
  return context
}

export interface WindowsRepairNativeRegistryImage {
  state: 'absent' | 'present'
  values: WindowsRepairTypedRegistryValue[] | null
  children: string[]
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function fail(): never { throw new Error('WINDOWS_REPAIR_NATIVE_BACKEND_FAILED') }
export function windowsRepairNativeHostEnvelope(spec: WindowsRepairCollectorInvocation, host: Uint8Array, approvedSha256: string, body: object) {
  if (!/^[a-f0-9]{64}$/.test(approvedSha256) || hash(host) !== approvedSha256) fail()
  // Keep CreateProcess below its 32K command line limit. Source travels over the
  // owned pipe and is checked against the compiled pin before script creation.
  const loader = String.raw`$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);try{$e=[Console]::In.ReadToEnd()|ConvertFrom-Json;$b=[Convert]::FromBase64String($e.source);$h=[Security.Cryptography.SHA256]::Create();try{$actual=[BitConverter]::ToString($h.ComputeHash($b)).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()};if($actual -cne '${approvedSha256}'){throw 'host-source'};[Console]::SetIn([IO.StringReader]::new([string]$e.payload));&([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b)))}catch{[Console]::Error.Write('WINDOWS_REPAIR_NATIVE_HOST_FAILED');exit 1}`
  return { ...spec, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(loader, 'utf16le').toString('base64')],
    input: Buffer.from(JSON.stringify({ source: Buffer.from(host).toString('base64'), payload: JSON.stringify(body) }), 'utf8') }
}
function image(value: WindowsRepairNativeRegistryImage) {
  if (!value || !['absent', 'present'].includes(value.state) || !Array.isArray(value.children) || value.children.length ||
      (value.state === 'absent' ? value.values !== null : !Array.isArray(value.values))) fail()
  windowsInstallRepairTypedValuesDigest(value.values)
  return { state: value.state, values: value.values, children: [] }
}

// The script SHA is an independently compiled consumer pin. It cannot be taken
// from the host file itself, request, producer receipt or runtime registry.
export function windowsRepairNativeRegistryInvocation(
  grant: WindowsRepairNativeAuthority, hostPath: string, approvedHostSha256: string,
  systemRoot: string, selectedKey: 'install' | 'uninstall',
  change?: { expected: WindowsRepairNativeRegistryImage; next: WindowsRepairNativeRegistryImage },
): WindowsRepairCollectorInvocation {
  const verified = requireForwardAuthority(grant)
  if (!/^[a-f0-9]{64}$/.test(approvedHostSha256) || approvedHostSha256 !== verified.roots.nativeHostSha256 ||
      !['install', 'uninstall'].includes(selectedKey)) fail()
  if (Date.now() > verified.plan.expiresAtMs) fail()
  if (change) {
    const before = verified.beforeRegistry.find(row => row.scope === verified.roots.scope && row.view === verified.roots.view)
    if (!before) fail()
    const expected = image(change.expected), next = image(change.next)
    const oldState = selectedKey === 'install' ? before.installKeyState : before.uninstallKeyState
    const oldValues = selectedKey === 'install' ? before.installValues : before.uninstallValues
    const approved = selectedKey === 'install' ? verified.receipt.registration.installValues : verified.receipt.registration.uninstallValues
    // Forward-only. Compensation must receive separate journal-owned recovery
    // authority; an arbitrary caller image cannot become a privileged rollback.
    if (expected.state !== oldState || windowsInstallRepairTypedValuesDigest(expected.values) !== windowsInstallRepairTypedValuesDigest(oldValues) ||
        next.state !== 'present' || windowsInstallRepairTypedValuesDigest(next.values) !== windowsInstallRepairTypedValuesDigest(approved)) fail()
  }
  const bytes = readFileSync(hostPath)
  if (bytes.length > 1024 * 1024 || hash(bytes) !== approvedHostSha256) fail()
  const keys = { installKey: verified.receipt.policy.installKey, uninstallKey: verified.receipt.policy.uninstallKey }
  const spec = windowsRepairCollectorInvocation(keys, systemRoot)
  const body = { schemaVersion: 1, operation: change ? 'write-registry' : 'read-registry', ...keys,
    scope: verified.roots.scope, view: verified.roots.view, selectedKey,
    ...(change ? { expected: image(change.expected), next: image(change.next) } : {}) }
  return windowsRepairNativeHostEnvelope(spec, bytes, approvedHostSha256, body)
}

export async function invokeWindowsRepairNativeRegistry(
  spec: WindowsRepairCollectorInvocation,
  run?: (spec: WindowsRepairCollectorInvocation) => Promise<Uint8Array>,
): Promise<WindowsRepairNativeRegistryImage> {
  // Add-Type may create descendants. No root-only collector fallback is safe.
  // A reviewed caller must supply the producer-pinned owned Job runner.
  if (!run) fail()
  const bytes = await run(spec)
  if (!(bytes instanceof Uint8Array) || bytes.length > spec.stdoutCap) fail()
  let value: WindowsRepairNativeRegistryImage
  try { value = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)) } catch { fail() }
  return image(value)
}

export interface WindowsRepairNativeFileImage { identity: string; size: string; sha256: string }
export function windowsRepairNativeFileInvocation(
  grant: WindowsRepairNativeAuthority, hostPath: string, systemRoot: string, member: string,
  change?: { before: WindowsRepairNativeFileImage; backupName: string },
): WindowsRepairCollectorInvocation {
  const verified = requireForwardAuthority(grant), approved = verified.roots.programFiles.find(x => x.path === member)
  if (!approved || (change && (!/^[a-f0-9]{32}\.old$/.test(change.backupName) ||
      !(change.before.identity === 'absent' || /^win32:[a-f0-9]{8}:[a-f0-9]{8}:[a-f0-9]{8}$/.test(change.before.identity)) ||
      (change.before.identity !== 'absent' && !/^[a-f0-9]{64}$/.test(change.before.sha256))))) fail()
  // Reuse the verified native source/executable boundary; no arbitrary script,
  // PowerShell statement, target root or user-supplied registry key is accepted.
  const spec = windowsRepairNativeRegistryInvocation(grant, hostPath, verified.roots.nativeHostSha256, systemRoot, 'install')
  const target = win32.join(verified.roots.target, ...member.split('/'))
  for (const protectedRoot of verified.receipt.policy.dataRoots ?? []) {
    const a = target.toLowerCase(), b = protectedRoot.toLowerCase()
    if (a === b || a.startsWith(b + '\\') || b.startsWith(a + '\\')) fail()
  }
  const body = { schemaVersion: 1, operation: change ? 'write-file' : 'inspect-file', target,
    ...(change ? { source: win32.join(verified.roots.payloadRoot, ...member.split('/')),
      backup: win32.join(verified.roots.journalRoot, change.backupName), beforeId: change.before.identity,
      beforeSha256: change.before.sha256, nextSha256: approved.sha256, nextSize: approved.size,
      userSid: verified.roots.initiatingUserSid } : {}) }
  return windowsRepairNativeHostEnvelope(spec, readFileSync(hostPath), verified.roots.nativeHostSha256, body)
}
export async function invokeWindowsRepairNativeFile(
  spec: WindowsRepairCollectorInvocation,
  run?: (spec: WindowsRepairCollectorInvocation) => Promise<Uint8Array>,
): Promise<WindowsRepairNativeFileImage> {
  if (!run) fail()
  const bytes = await run(spec)
  if (!(bytes instanceof Uint8Array) || bytes.length > spec.stdoutCap) fail()
  let result: WindowsRepairNativeFileImage
  try { result = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)) } catch { fail() }
  if (!result || typeof result.size !== 'string' || !/^\d+$/.test(result.size) ||
      !(result.identity === 'absent' || /^win32:[a-f0-9]{8}:[a-f0-9]{8}:[a-f0-9]{8}$/.test(result.identity)) ||
      (result.identity === 'absent' ? result.sha256 !== '' || result.size !== '0' : !/^[a-f0-9]{64}$/.test(result.sha256))) fail()
  return result
}


export interface WindowsRepairNativeJournalPorts {
  // Mandatory reviewed owned-Job invocation, never a root-only process runner.
  run(spec: WindowsRepairCollectorInvocation): Promise<Uint8Array>
  // Trusted collector callbacks must check protected root handles/ACLs, all
  // untouched registry slots, data/backup facts and foreign DProgram. During
  // compensation they use the journal projection, not a new fresh preflight.
  assertJournalProtected(path: string): Promise<void>
  assertProtectedFactsUnchanged(operations: readonly WindowsRepairMutation[], progress: ReturnType<WindowsRepairDurableJournal['progress']>): Promise<void>
  verifyProgramStage(): Promise<void>
  verifyComplete(): Promise<void>
}
export interface WindowsRepairNativeJournalOptions { hostPath: string; systemRoot: string }
export interface WindowsRepairNativeRecoveryCapability { readonly kind: 'rt-windows-repair-recovery-capability-v1' }
const recoveryCapabilities = new WeakSet<object>()
const recoveryBindings = new WeakMap<object, {
  authority: WindowsRepairNativeAuthority; journal: WindowsRepairDurableJournal; options: WindowsRepairNativeJournalOptions; indexes: Map<string, number>
}>()
const imageEqual = (a: WindowsRepairImage, b: WindowsRepairImage) => a.identity === b.identity && a.bytes === b.bytes
const fileImage = (value: WindowsRepairNativeFileImage): WindowsRepairImage => ({
  identity: value.identity, bytes: value.identity === 'absent' ? null : JSON.stringify({ size: value.size, sha256: value.sha256 }),
})
function decodeFile(value: WindowsRepairImage): WindowsRepairNativeFileImage {
  if (value.identity === 'absent') { if (value.bytes !== null) fail(); return { identity: 'absent', size: '0', sha256: '' } }
  if (!/^win32:[a-f0-9]{8}:[a-f0-9]{8}:[a-f0-9]{8}$/.test(value.identity) && value.identity !== 'pending-owned-create') fail()
  let contents: { size: string; sha256: string }
  try { contents = JSON.parse(value.bytes!) } catch { fail() }
  if (Object.keys(contents).sort().join(',') !== 'sha256,size' || !/^\d+$/.test(contents.size) ||
      !/^[a-f0-9]{64}$/.test(contents.sha256)) fail()
  return { identity: value.identity, ...contents }
}
function registryImage(value: WindowsRepairNativeRegistryImage, identity: string): WindowsRepairImage {
  const normalized = image(value)
  const values = normalized.values?.map(item => structuredClone(item)).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ?? null
  return { identity, bytes: JSON.stringify({ ...normalized, values }) }
}
function decodeRegistry(value: WindowsRepairImage): WindowsRepairNativeRegistryImage {
  try { return image(JSON.parse(value.bytes!)) } catch { fail() }
}
export function windowsRepairNativeJournalBinding(authority: WindowsRepairNativeAuthority): WindowsRepairRecoveryBinding {
  const verified = requireWindowsRepairNativeAuthority(authority), { roots } = verified
  return { consumerSha256: roots.consumerSha256, producerSha256: roots.producerSha256, planSha256: roots.planSha256,
    target: roots.target, appId: roots.appId, scope: roots.scope, view: roots.view,
    ...(verified.kind === 'rt-windows-repair-native-context-v1' ? { nativeAuthorization: structuredClone({
      roots: verified.roots, plan: verified.plan, receipt: verified.receipt,
      beforeRegistry: verified.beforeRegistry, beforeSnapshot: verified.beforeSnapshot,
    }) } : {}) }
}
function nativeEnvelope(authority: WindowsRepairNativeAuthority, options: WindowsRepairNativeJournalOptions, body: object) {
  const verified = requireWindowsRepairNativeAuthority(authority), source = readFileSync(options.hostPath)
  if (source.length > 1024 * 1024 || hash(source) !== verified.roots.nativeHostSha256) fail()
  return windowsRepairNativeHostEnvelope(windowsRepairCollectorInvocation({
    installKey: verified.receipt.policy.installKey, uninstallKey: verified.receipt.policy.uninstallKey,
  }, options.systemRoot), source, verified.roots.nativeHostSha256, { schemaVersion: 1, ...body })
}
function keyId(authority: WindowsRepairNativeAuthority, key: 'install' | 'uninstall') {
  const verified = requireWindowsRepairNativeAuthority(authority)
  return verified.roots.scope + ':' + verified.roots.view + ':' +
    (key === 'install' ? verified.receipt.policy.installKey : verified.receipt.policy.uninstallKey)
}
function keyImages(authority: WindowsRepairNativeAuthority, key: 'install' | 'uninstall') {
  const verified = requireWindowsRepairNativeAuthority(authority), row = verified.beforeRegistry.find(item =>
    item.scope === verified.roots.scope && item.view === verified.roots.view)
  if (!row) fail()
  const oldState = key === 'install' ? row.installKeyState : row.uninstallKeyState
  if (oldState !== 'present' && oldState !== 'absent') fail()
  return {
    before: registryImage({ state: oldState,
      values: key === 'install' ? row.installValues : row.uninstallValues, children: [] }, keyId(authority, key)),
    after: registryImage({ state: 'present', values: key === 'install' ? verified.receipt.registration.installValues :
      verified.receipt.registration.uninstallValues, children: [] }, keyId(authority, key)),
  }
}
const backupName = () => randomBytes(16).toString('hex') + '.old'
function memberTarget(authority: WindowsRepairNativeAuthority, member: string) {
  const verified = requireWindowsRepairNativeAuthority(authority), target = win32.join(verified.roots.target, ...member.split('/'))
  if (!verified.roots.programFiles.some(item => item.path === member)) fail()
  for (const root of verified.receipt.policy.dataRoots ?? []) {
    const a = target.toLowerCase(), b = root.toLowerCase()
    // Ancestor directory identities are protected, not a blanket veto on every
    // approved child. Files may never equal or descend into a protected subtree.
    if (a === b || a.startsWith(b + '\\')) fail()
  }
  for (const item of verified.plan.protectedPaths) {
    const a = target.toLowerCase(), p = win32.resolve(item.path).toLowerCase()
    if (p !== verified.roots.target.toLowerCase() &&
        (item.kind === 'directory' ? a === p || p.startsWith(a + '\\\\') :
          a === p || a.startsWith(p + '\\\\') || p.startsWith(a + '\\\\'))) fail()
  }
  return target
}

// All program before-images are copied/read back in the private journal cache
// before any program mutation. The native primitive flushes each backup first.
export async function prepareWindowsRepairNativeMutations(
  authority: WindowsRepairNativeAuthority, options: WindowsRepairNativeJournalOptions, ports: WindowsRepairNativeJournalPorts,
): Promise<WindowsRepairMutation[]> {
  const verified = requireForwardAuthority(authority)
  if (Date.now() > verified.plan.expiresAtMs) fail()
  await ports.assertJournalProtected(verified.roots.journalRoot)
  await ports.assertProtectedFactsUnchanged([], { next: 0, pending: null, compensating: false, terminal: false, restoreCursor: -1, transitionChecks: 0 })
  const operations: WindowsRepairMutation[] = []
  for (const member of verified.roots.programFiles) {
    const target = memberTarget(authority, member.path)
    const before = await invokeWindowsRepairNativeFile(nativeEnvelope(authority, options, { operation: 'inspect-file', target }), ports.run)
    const operation: WindowsRepairMutation = { id: 'file:' + member.path, before: fileImage(before),
      after: { identity: before.identity === 'absent' ? 'pending-owned-create' : before.identity,
        bytes: JSON.stringify({ size: String(member.size), sha256: member.sha256 }) },
      forwardBackupName: backupName(), restoreBackupName: backupName() }
    if (before.identity !== 'absent') {
      const name = backupName(), backup = win32.join(verified.roots.journalRoot, name)
      const actual = await invokeWindowsRepairNativeFile(nativeEnvelope(authority, options, {
        operation: 'write-file', target: backup, source: target, backup: win32.join(verified.roots.journalRoot, backupName()),
        beforeId: 'absent', beforeSha256: '', nextSha256: before.sha256, nextSize: before.size, userSid: verified.roots.initiatingUserSid,
      }), ports.run)
      if (actual.sha256 !== before.sha256 || actual.size !== before.size || actual.identity === 'absent') fail()
      operation.backup = { name, image: fileImage(actual) }
    }
    operations.push(operation)
  }
  for (const key of ['install', 'uninstall'] as const) operations.push({ id: 'registry-' + key + ':' + keyId(authority, key), ...keyImages(authority, key) })
  return freezeNative(operations)
}
function validateNativeOperations(authority: WindowsRepairNativeAuthority, operations: WindowsRepairMutation[]) {
  const verified = requireWindowsRepairNativeAuthority(authority), names = new Set<string>()
  if (operations.length !== verified.roots.programFiles.length + 2) fail()
  for (let index = 0; index < verified.roots.programFiles.length; index++) {
    const member = verified.roots.programFiles[index], operation = operations[index]
    memberTarget(authority, member.path)
    if (operation.id !== 'file:' + member.path) fail()
    const before = decodeFile(operation.before), after = decodeFile(operation.after)
    if (after.size !== String(member.size) || after.sha256 !== member.sha256 ||
        after.identity !== (before.identity === 'absent' ? 'pending-owned-create' : before.identity)) fail()
    for (const name of [operation.forwardBackupName, operation.restoreBackupName, operation.backup?.name].filter(x => x !== undefined)) {
      if (!/^[a-f0-9]{32}\.old$/.test(name!) || names.has(name!)) fail()
      names.add(name!)
    }
    if (!operation.forwardBackupName || !operation.restoreBackupName) fail()
    if (before.identity !== 'absent') {
      if (!operation.backup) fail()
      const backup = decodeFile(operation.backup.image)
      if (backup.identity === 'absent' || backup.identity === 'pending-owned-create' || backup.sha256 !== before.sha256 || backup.size !== before.size) fail()
    } else if (operation.backup) fail()
  }
  for (const [offset, key] of (['install', 'uninstall'] as const).entries()) {
    const operation = operations[operations.length - 2 + offset], expected = keyImages(authority, key)
    if (operation.id !== 'registry-' + key + ':' + keyId(authority, key) ||
        !imageEqual(operation.before, expected.before) || !imageEqual(operation.after, expected.after)) fail()
  }
}
function requireRecovery(capability: WindowsRepairNativeRecoveryCapability, operation: WindowsRepairMutation, restoring: boolean) {
  if (!capability || !recoveryCapabilities.has(capability)) fail()
  const bound = recoveryBindings.get(capability)!
  const index = bound.indexes.get(operation.id) ?? -1
  if (index < 0 || (restoring && index !== bound.journal.recoveryCursor()) ||
      JSON.stringify(bound.journal.resolvedOperation(index)) !== JSON.stringify(operation)) fail()
  return bound
}
export function windowsRepairNativeRecoveryInvocation(
  capability: WindowsRepairNativeRecoveryCapability, operation: WindowsRepairMutation,
): WindowsRepairCollectorInvocation {
  const { authority, journal, options } = requireRecovery(capability, operation, true)
  const verified = requireWindowsRepairNativeAuthority(authority)
  // This separate capability deliberately has no new preflight/expiry check.
  // It can only restore the current durable reverse cursor to its original image.
  if (journal.lastEventKind() === 'committed' || journal.lastEventKind() === 'rolled-back') fail()
  if (operation.id.startsWith('file:')) {
    const target = memberTarget(authority, operation.id.slice(5)), after = decodeFile(operation.after), before = decodeFile(operation.before)
    if (after.identity === 'pending-owned-create' || after.identity === 'absent') fail()
    if (before.identity === 'absent') return nativeEnvelope(authority, options, {
      operation: 'delete-owned-file', target, beforeId: after.identity, beforeSha256: after.sha256,
    })
    if (!operation.backup || !operation.restoreBackupName) fail()
    return nativeEnvelope(authority, options, { operation: 'write-file', target,
      source: win32.join(verified.roots.journalRoot, operation.backup.name),
      backup: win32.join(verified.roots.journalRoot, operation.restoreBackupName),
      beforeId: after.identity, beforeSha256: after.sha256, nextSha256: before.sha256, nextSize: before.size,
      userSid: verified.roots.initiatingUserSid })
  }
  const key = operation.id.startsWith('registry-install:') ? 'install' : 'uninstall'
  return nativeEnvelope(authority, options, { operation: 'write-registry', installKey: verified.receipt.policy.installKey,
    uninstallKey: verified.receipt.policy.uninstallKey, scope: verified.roots.scope, view: verified.roots.view,
    selectedKey: key, expected: decodeRegistry(operation.after), next: decodeRegistry(operation.before) })
}

export async function createWindowsRepairNativeJournalHost(
  authority: WindowsRepairNativeAuthority, journal: WindowsRepairDurableJournal, options: WindowsRepairNativeJournalOptions,
  inputPorts: WindowsRepairNativeJournalPorts,
): Promise<WindowsRepairRecoveryHost & { readonly recoveryCapability: WindowsRepairNativeRecoveryCapability }> {
  const verified = requireWindowsRepairNativeAuthority(authority), ports = Object.freeze({ ...inputPorts })
  options = Object.freeze({ ...options })
  if (['run', 'assertJournalProtected', 'assertProtectedFactsUnchanged', 'verifyProgramStage', 'verifyComplete']
      .some(name => typeof ports[name as keyof WindowsRepairNativeJournalPorts] !== 'function') ||
      win32.dirname(journal.path).toLowerCase() !== verified.roots.journalRoot.toLowerCase() ||
      JSON.stringify(journal.binding()) !== JSON.stringify(windowsRepairNativeJournalBinding(authority))) fail()
  const begin = journal.events()[0]
  if (begin.kind !== 'begin') fail()
  const operations = journal.boundOperations(begin.operations)
  validateNativeOperations(authority, operations)
  await ports.assertJournalProtected(journal.path)
  await ports.assertProtectedFactsUnchanged(operations, journal.progress())
  const capability = Object.freeze({ kind: 'rt-windows-repair-recovery-capability-v1' as const })
  recoveryCapabilities.add(capability)
  recoveryBindings.set(capability, { authority, journal, options, indexes: new Map(operations.map((operation, index) => [operation.id, index])) })
  const read = async (operation: WindowsRepairMutation): Promise<WindowsRepairImage> => {
    requireRecovery(capability, operation, false)
    await ports.assertJournalProtected(journal.path)
    if (operation.id.startsWith('file:')) return fileImage(await invokeWindowsRepairNativeFile(nativeEnvelope(authority, options,
      { operation: 'inspect-file', target: memberTarget(authority, operation.id.slice(5)) }), ports.run))
    const key = operation.id.startsWith('registry-install:') ? 'install' : 'uninstall'
    return registryImage(await invokeWindowsRepairNativeRegistry(nativeEnvelope(authority, options, {
      operation: 'read-registry', installKey: verified.receipt.policy.installKey, uninstallKey: verified.receipt.policy.uninstallKey,
      scope: verified.roots.scope, view: verified.roots.view, selectedKey: key,
    }), ports.run), operation.before.identity)
  }
  return Object.freeze({
    recoveryCapability: capability,
    assertProtectedFactsUnchanged: async () => {
      await ports.assertJournalProtected(journal.path)
      await ports.assertProtectedFactsUnchanged(operations.map((_operation, index) => journal.resolvedOperation(index)), journal.progress())
    },
    read,
    async writeChecked(operation: WindowsRepairMutation, expected: WindowsRepairImage, next: WindowsRepairImage) {
      if (!imageEqual(await read(operation), expected)) fail()
      const forward = imageEqual(expected, operation.before) && imageEqual(next, operation.after)
      if (!forward && !(imageEqual(expected, operation.after) && imageEqual(next, operation.before))) fail()
      if (forward && (recoveryOnlyAuthorities.has(authority) || Date.now() > verified.plan.expiresAtMs || journal.lastEventKind() !== 'intent' ||
          journal.resolvedOperation(journal.recoveryCursor()).id !== operation.id)) fail()
      if (!forward && operation.backup) {
        const actual = fileImage(await invokeWindowsRepairNativeFile(nativeEnvelope(authority, options, {
          operation: 'inspect-file', target: win32.join(verified.roots.journalRoot, operation.backup.name),
        }), ports.run))
        if (!imageEqual(actual, operation.backup.image)) fail()
      }
      if (operation.id.startsWith('file:')) {
        const spec = forward ? windowsRepairNativeFileInvocation(authority, options.hostPath, options.systemRoot, operation.id.slice(5),
          { before: decodeFile(operation.before), backupName: operation.forwardBackupName! }) :
          windowsRepairNativeRecoveryInvocation(capability, operation)
        return fileImage(await invokeWindowsRepairNativeFile(spec, ports.run))
      }
      const key = operation.id.startsWith('registry-install:') ? 'install' : 'uninstall'
      const spec = forward ? windowsRepairNativeRegistryInvocation(authority, options.hostPath, verified.roots.nativeHostSha256,
        options.systemRoot, key, { expected: decodeRegistry(expected), next: decodeRegistry(next) }) :
        windowsRepairNativeRecoveryInvocation(capability, operation)
      return registryImage(await invokeWindowsRepairNativeRegistry(spec, ports.run), operation.before.identity)
    },
    verifyProgramStage: ports.verifyProgramStage,
    verifyComplete: ports.verifyComplete,
  })
}


// Cold-start recovery re-verifies the original signed final artifacts, checks
// current native launch/consent facts and resumes only the protected old log.
// It neither reissues a forward plan nor treats serialized roots as a grant.
export async function bindWindowsRepairNativeRecoveryBackend(
  trust: CompiledRepairTrust, artifacts: VerifiedRepairArtifacts, journal: WindowsRepairDurableJournal,
  facts: WindowsRepairNativeLaunchFacts, ports: WindowsRepairNativeJournalPorts,
): Promise<WindowsRepairNativeContext> {
  requireVerifiedRepairArtifacts(artifacts)
  await ports.assertJournalProtected(journal.path)
  const binding = journal.binding(), original = binding.nativeAuthorization, signed = artifacts.receipt
  if (!original || !facts || !trust || trust.signingPurpose !== signed.signingPurpose ||
      trust.appId !== signed.appId || trust.version !== signed.version || trust.channel !== signed.channel ||
      trust.platform !== signed.platform || trust.arch !== signed.arch ||
      !Object.hasOwn(trust.issuerKeys, signed.issuerKeyId) ||
      binding.producerSha256 !== artifacts.receiptSha256 || binding.appId !== trust.appId || binding.target !== trust.target ||
      binding.consumerSha256 !== signed.components.consumer.sha256 ||
      !trust.allowedScopeViews.includes(`${binding.scope}:${binding.view}` as typeof trust.allowedScopeViews[number])) fail()
  const { roots, plan, receipt, beforeRegistry, beforeSnapshot } = original
  if (!roots || !plan || !receipt || !beforeSnapshot ||
      roots.consumerSha256 !== binding.consumerSha256 || roots.producerSha256 !== binding.producerSha256 ||
      roots.planSha256 !== binding.planSha256 || roots.appId !== binding.appId || roots.target !== binding.target ||
      roots.scope !== binding.scope || roots.view !== binding.view ||
      roots.nativeHostSha256 !== signed.components.nativeHost.sha256 || roots.installerSha256 !== signed.installer.sha256 ||
      win32.dirname(journal.path).toLowerCase() !== roots.journalRoot.toLowerCase() ||
      receipt.policy.installKey !== trust.registryInstallKey || receipt.policy.uninstallKey !== trust.registryUninstallKey ||
      receipt.policy.appId !== trust.appId || plan.appId !== trust.appId || plan.target !== trust.target ||
      plan.planSha256 !== binding.planSha256 || plan.scope !== binding.scope || plan.view !== binding.view ||
      receipt.policy.installer.sha256 !== signed.installer.sha256 ||
      receipt.policy.installer.releaseReceiptSha256 !== artifacts.receiptSha256 ||
      receipt.policy.installer.runtimeSealSha256 !== signed.runtimeSeal.sha256 ||
      JSON.stringify(beforeRegistry) !== JSON.stringify(beforeSnapshot.registry) ||
      JSON.stringify(roots.programFiles) !== JSON.stringify(signed.programInventory.map(item =>
        ({ path: item.relativePath, size: item.size, sha256: item.sha256 }))) ||
      facts.consumerSha256 !== signed.components.consumer.sha256 ||
      facts.directParentImageSha256 !== signed.installer.sha256 || facts.directParentRunning !== true ||
      facts.directParentRepairIntent !== true || facts.explicitConsentObserved !== true ||
      facts.selectedScope !== binding.scope || facts.selectedTarget !== binding.target ||
      !/^S-1-5-(?:[0-9]+-)+[0-9]+$/.test(facts.currentUserSid) || facts.currentUserSid !== roots.initiatingUserSid ||
      (binding.scope === 'all-users' && facts.elevated !== true) ||
      !(facts.nonce instanceof Uint8Array) || facts.nonce.byteLength !== 32) fail()
  // Validate the original authorizing facts at their original time, NOT today's
  // partially repaired registry. This historical check creates no fresh token.
  revalidateWindowsInstallRepairPlan(receipt.policy, plan, beforeSnapshot, beforeSnapshot.observedAtMs)
  const expected = receipt.policy.expectedRegistration
  if (!expected || expected.scope !== binding.scope || expected.view !== binding.view ||
      windowsInstallRepairTypedValuesDigest(receipt.registration.installValues) !== expected.installValuesSha256 ||
      windowsInstallRepairTypedValuesDigest(receipt.registration.uninstallValues) !== expected.uninstallValuesSha256) fail()
  const main = signed.programInventory.find(item => item.relativePath === receipt.policy.executableName)
  if (!main || main.sha256 !== receipt.policy.installer.mainExecutableSha256) fail()
  const context = freezeNative({ kind: 'rt-windows-repair-native-context-v1' as const, ...structuredClone(original) })
  nativeContexts.add(context)
  recoveryOnlyAuthorities.add(context)
  try {
    const begin = journal.events()[0]
    if (begin.kind !== 'begin') fail()
    const operations = journal.boundOperations(begin.operations)
    validateNativeOperations(context, operations)
    await ports.assertProtectedFactsUnchanged(operations.map((_operation, index) => journal.resolvedOperation(index)), journal.progress())
    return context
  } catch (error) {
    nativeContexts.delete(context); recoveryOnlyAuthorities.delete(context)
    throw error
  }
}
