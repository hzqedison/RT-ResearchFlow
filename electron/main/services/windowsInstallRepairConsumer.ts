import { createHash, randomUUID, verify, type KeyObject } from 'node:crypto'
import { win32 } from 'node:path'
import type { WindowsRepairProducerReceipt } from './windowsInstallRepairExecutor'
import type { WindowsInstallRepairPlan } from './windowsInstallRepairPreflight'
import { windowsInstallRepairTypedValuesDigest } from './windowsInstallRepairPreflight'
import type { WindowsInstallRepairSnapshot } from './windowsInstallRepairPreflight'
import { requireWindowsRepairVerifiedPlan } from './windowsInstallRepairPlanCapability'
import type { WindowsRepairVerifiedPlan } from './windowsInstallRepairPlanCapability'

// Only immutable build rules belong here. Final hashes, plans, users and nonces
// are deliberately absent, so a detached receipt cannot create a hash cycle.
export interface CompiledRepairTrust {
  readonly issuerKeys: Readonly<Record<string, KeyObject>>
  readonly signingPurpose: 'rt-windows-repair-final-artifacts-v1'
  readonly appId: string
  readonly appGuid: string
  readonly version: string
  readonly channel: string
  readonly platform: 'win32'
  readonly arch: 'x64'
  readonly target: 'D:\\Program Files\\RT-ResearchFlow'
  readonly registryInstallKey: string
  readonly registryUninstallKey: string
  readonly allowedScopeViews: ReadonlyArray<'per-user:32' | 'per-user:64' | 'all-users:32' | 'all-users:64'>
}
export interface RepairArtifactDigest { readonly sha256: string; readonly size: number }
export interface DetachedRepairArtifactReceipt {
  readonly schemaVersion: 1
  readonly kind: 'rt-windows-repair-artifacts-v1'
  readonly signingPurpose: 'rt-windows-repair-final-artifacts-v1'
  readonly issuerKeyId: string
  readonly appId: string
  readonly version: string
  readonly channel: string
  readonly platform: 'win32'
  readonly arch: 'x64'
  readonly sourceCommit: string
  readonly sourceTree: string
  readonly producerWorkflow: string
  readonly producerRunId: string
  readonly producerRunAttempt: number
  readonly installer: RepairArtifactDigest
  readonly components: Readonly<Record<'consumer' | 'privateNode' | 'nativeHost' | 'jobHost', RepairArtifactDigest>>
  readonly programInventory: ReadonlyArray<RepairArtifactDigest & { readonly relativePath: string }>
  readonly registeredUninstallerRelativePath: string
  readonly runtimeSeal: RepairArtifactDigest
}
export interface ObservedRepairArtifacts {
  readonly installer: Uint8Array
  readonly components: Readonly<Record<'consumer' | 'privateNode' | 'nativeHost' | 'jobHost', Uint8Array>>
  readonly programFiles: ReadonlyArray<{ readonly relativePath: string; readonly bytes: Uint8Array }>
  readonly runtimeSeal: Uint8Array
}
export interface VerifiedRepairArtifacts {
  readonly kind: 'rt-windows-verified-repair-artifacts-v1'
  readonly receiptSha256: string
  readonly receipt: DetachedRepairArtifactReceipt
}
const verifiedArtifacts = new WeakSet<object>()
const artifactTrust = new WeakMap<object, CompiledRepairTrust>()
export interface WindowsRepairRuntimeSessionObservation {
  readonly launch: WindowsRepairNativeLaunchFacts
  readonly payloadRoot: string
  readonly journalRoot: string
}
export interface WindowsRepairRuntimeSession {
  readonly kind: 'rt-windows-repair-runtime-session-v1'
  readonly sessionId: string
  readonly receiptSha256: string
  readonly planSha256: string
  readonly scope: 'per-user' | 'all-users'
  readonly view: '32' | '64'
  readonly initiatingUserSid: string
  readonly intentNonceSha256: string
  readonly payloadRoot: string
  readonly journalRoot: string
}
const verifiedSessions = new WeakSet<object>()
const sessionBindings = new WeakMap<object, { artifacts: VerifiedRepairArtifacts; plan: WindowsRepairVerifiedPlan }>()
const componentNames = ['consumer', 'privateNode', 'nativeHost', 'jobHost'] as const
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
function exact(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) fail()
}
function artifactDigest(value: unknown, bytes: unknown) {
  exact(value, ['sha256', 'size'])
  if (!sha256(value.sha256) || !Number.isSafeInteger(value.size) || (value.size as number) < 0 ||
      !(bytes instanceof Uint8Array) || bytes.byteLength !== value.size || hash(bytes) !== value.sha256) fail()
}
function inventoryName(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 240 &&
    path.split('/').every(part => part && part !== '.' && part !== '..' &&
      !/[<>:"\\|?*\x00-\x1f]/.test(part) && !/[ .]$/.test(part) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) &&
    !/^(data|userdata|backups)(\/|$)/i.test(path)
}
// JSON.parse accepts duplicate keys. Walk only the bounded signed JSON first,
// decoding key strings so escaped aliases are rejected as the same property.
function uniqueJson(raw: string): unknown {
  let at = 0
  const space = () => { while (/\s/.test(raw[at] ?? '')) at++ }
  const quoted = (): string => {
    if (raw[at] !== '"') fail()
    const start = at++
    while (at < raw.length) {
      if (raw[at] === '\\') { at += 2; continue }
      if (raw[at++] === '"') return JSON.parse(raw.slice(start, at))
    }
    fail()
  }
  const value = (): void => {
    space()
    if (raw[at] === '{') {
      at++; space(); const keys = new Set<string>()
      if (raw[at] === '}') { at++; return }
      for (;;) {
        space(); const key = quoted(); if (keys.has(key)) fail(); keys.add(key)
        space(); if (raw[at++] !== ':') fail(); value(); space()
        const end = raw[at++]; if (end === '}') return; if (end !== ',') fail()
      }
    }
    if (raw[at] === '[') {
      at++; space(); if (raw[at] === ']') { at++; return }
      for (;;) { value(); space(); const end = raw[at++]; if (end === ']') return; if (end !== ',') fail() }
    }
    if (raw[at] === '"') { quoted(); return }
    const start = at
    while (at < raw.length && !/[\s,}\]]/.test(raw[at])) at++
    if (at === start) fail()
    JSON.parse(raw.slice(start, at))
  }
  value(); space(); if (at !== raw.length) fail()
  return JSON.parse(raw)
}

// Pure byte verification only. The caller must later bind a native session and
// fresh plan; this capability alone conveys no registry or file-write authority.
export function verifyWindowsRepairDetachedArtifacts(
  trust: CompiledRepairTrust, receiptBytes: Uint8Array, signature: Uint8Array,
  observed: ObservedRepairArtifacts,
): VerifiedRepairArtifacts {
  exact(trust, ['issuerKeys', 'signingPurpose', 'appId', 'appGuid', 'version', 'channel', 'platform', 'arch',
    'target', 'registryInstallKey', 'registryUninstallKey', 'allowedScopeViews'])
  if (trust.signingPurpose !== 'rt-windows-repair-final-artifacts-v1' || trust.platform !== 'win32' ||
      trust.arch !== 'x64' || trust.target !== 'D:\\Program Files\\RT-ResearchFlow' ||
      !/^\{?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\}?$/i.test(trust.appGuid) ||
      !trust.appId || !trust.version || !trust.channel ||
      !trust.registryInstallKey.startsWith('Software\\') || !trust.registryUninstallKey.startsWith('Software\\') ||
      !Array.isArray(trust.allowedScopeViews) || !trust.allowedScopeViews.length ||
      new Set(trust.allowedScopeViews).size !== trust.allowedScopeViews.length ||
      trust.allowedScopeViews.some(item => !['per-user:32', 'per-user:64', 'all-users:32', 'all-users:64'].includes(item)) ||
      !trust.issuerKeys || typeof trust.issuerKeys !== 'object' || !Object.keys(trust.issuerKeys).length ||
      !(receiptBytes instanceof Uint8Array) || receiptBytes.byteLength === 0 || receiptBytes.byteLength > 2 * 1024 * 1024 ||
      !(signature instanceof Uint8Array) || signature.byteLength !== 64 || !observed) fail()
  let receipt: Record<string, unknown>
  try {
    if (receiptBytes[0] === 0xef && receiptBytes[1] === 0xbb && receiptBytes[2] === 0xbf) fail()
    receipt = uniqueJson(new TextDecoder('utf-8', { fatal: true }).decode(receiptBytes)) as Record<string, unknown>
  } catch { fail() }
  exact(receipt, ['schemaVersion', 'kind', 'signingPurpose', 'issuerKeyId', 'appId', 'version', 'channel',
    'platform', 'arch', 'sourceCommit', 'sourceTree', 'producerWorkflow', 'producerRunId', 'producerRunAttempt',
    'installer', 'components', 'programInventory', 'registeredUninstallerRelativePath', 'runtimeSeal'])
  if (receipt.schemaVersion !== 1 || receipt.kind !== 'rt-windows-repair-artifacts-v1' ||
      receipt.signingPurpose !== trust.signingPurpose || receipt.appId !== trust.appId ||
      receipt.version !== trust.version || receipt.channel !== trust.channel ||
      receipt.platform !== trust.platform || receipt.arch !== trust.arch ||
      !/^[a-f0-9]{40}$/.test(String(receipt.sourceCommit)) || !/^[a-f0-9]{40}$/.test(String(receipt.sourceTree)) ||
      typeof receipt.producerWorkflow !== 'string' || !receipt.producerWorkflow ||
      !/^\d+$/.test(String(receipt.producerRunId)) || !Number.isSafeInteger(receipt.producerRunAttempt) ||
      (receipt.producerRunAttempt as number) < 1 || typeof receipt.issuerKeyId !== 'string' ||
      !Object.hasOwn(trust.issuerKeys, receipt.issuerKeyId)) fail()
  try {
    const key = trust.issuerKeys[receipt.issuerKeyId]
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519' || !verify(null, receiptBytes, key, signature)) fail()
  } catch { fail() }
  exact(observed, ['installer', 'components', 'programFiles', 'runtimeSeal'])
  exact(receipt.components, componentNames)
  exact(observed.components, componentNames)
  artifactDigest(receipt.installer, observed.installer)
  artifactDigest(receipt.runtimeSeal, observed.runtimeSeal)
  for (const name of componentNames) artifactDigest(receipt.components[name], observed.components[name])
  if (!Array.isArray(receipt.programInventory) || !Array.isArray(observed.programFiles) ||
      receipt.programInventory.length === 0 || receipt.programInventory.length > 20000 ||
      receipt.programInventory.length !== observed.programFiles.length ||
      !inventoryName(receipt.registeredUninstallerRelativePath) ||
      !/\.exe$/i.test(receipt.registeredUninstallerRelativePath)) fail()
  const actual = new Map<string, Uint8Array>()
  for (const item of observed.programFiles) {
    if (!item || !inventoryName(item.relativePath) || !(item.bytes instanceof Uint8Array) ||
        actual.has(item.relativePath.toLowerCase())) fail()
    actual.set(item.relativePath.toLowerCase(), item.bytes)
  }
  const signed = new Set<string>()
  for (const item of receipt.programInventory) {
    exact(item, ['relativePath', 'size', 'sha256'])
    if (!inventoryName(item.relativePath) || signed.has(item.relativePath.toLowerCase())) fail()
    signed.add(item.relativePath.toLowerCase())
    artifactDigest({ size: item.size, sha256: item.sha256 }, actual.get(item.relativePath.toLowerCase()))
  }
  if (!signed.has(receipt.registeredUninstallerRelativePath.toLowerCase())) fail()
  const capability = frozen({ kind: 'rt-windows-verified-repair-artifacts-v1' as const,
    receiptSha256: hash(receiptBytes), receipt: structuredClone(receipt) as unknown as DetachedRepairArtifactReceipt })
  verifiedArtifacts.add(capability)
  artifactTrust.set(capability, Object.freeze({ ...trust, issuerKeys: Object.freeze({ ...trust.issuerKeys }),
    allowedScopeViews: Object.freeze([...trust.allowedScopeViews]) }))
  return capability
}
export function requireVerifiedRepairArtifacts(value: VerifiedRepairArtifacts): VerifiedRepairArtifacts {
  if (!value || !verifiedArtifacts.has(value)) fail()
  return value
}

// Observations must be supplied by the trusted native collector, not IPC or a
// receipt. This pure boundary does not itself attest the collector or authorize
// any write; production wiring must bind actual handles/consent before calling.
export function bindWindowsRepairRuntimeSession(
  artifacts: VerifiedRepairArtifacts, verifiedPlan: WindowsRepairVerifiedPlan,
  observed: WindowsRepairRuntimeSessionObservation,
): WindowsRepairRuntimeSession {
  requireVerifiedRepairArtifacts(artifacts)
  let validated: WindowsRepairVerifiedPlan
  try { validated = requireWindowsRepairVerifiedPlan(verifiedPlan) } catch { fail() }
  const trust = artifactTrust.get(artifacts)
  if (!trust) fail()
  const receipt = artifacts.receipt, plan = validated.plan, policy = validated.policy
  exact(observed, ['launch', 'payloadRoot', 'journalRoot'])
  exact(observed.launch, ['consumerSha256', 'directParentImageSha256', 'directParentRunning',
    'directParentRepairIntent', 'selectedScope', 'selectedTarget', 'currentUserSid',
    'elevated', 'explicitConsentObserved', 'nonce'])
  const facts = observed.launch
  const main = receipt.programInventory.find(item => item.relativePath === policy.executableName)
  const overlap = (left: string, right: string) => {
    const a = left.toLowerCase(), b = right.toLowerCase()
    return a === b || a.startsWith(b + '\\') || b.startsWith(a + '\\')
  }
  if (!main || Date.now() > plan.expiresAtMs || plan.appId !== trust.appId || plan.target !== trust.target ||
      policy.appId !== trust.appId || policy.installKey !== trust.registryInstallKey ||
      policy.uninstallKey !== trust.registryUninstallKey ||
      policy.installer.sha256 !== receipt.installer.sha256 ||
      policy.installer.releaseReceiptSha256 !== artifacts.receiptSha256 ||
      policy.installer.mainExecutableSha256 !== main.sha256 ||
      policy.installer.runtimeSealSha256 !== receipt.runtimeSeal.sha256 ||
      validated.current.installer.sha256 !== receipt.installer.sha256 ||
      validated.current.installer.releaseReceiptSha256 !== artifacts.receiptSha256 ||
      validated.current.installer.runtimeSealSha256 !== receipt.runtimeSeal.sha256 ||
      policy.expectedRegistration.scope !== plan.scope || policy.expectedRegistration.view !== plan.view ||
      !trust.allowedScopeViews.includes(`${plan.scope}:${plan.view}` as typeof trust.allowedScopeViews[number]) ||
      facts.consumerSha256 !== receipt.components.consumer.sha256 ||
      facts.directParentImageSha256 !== receipt.installer.sha256 ||
      facts.directParentRunning !== true || facts.directParentRepairIntent !== true ||
      facts.explicitConsentObserved !== true || facts.selectedScope !== plan.scope ||
      facts.selectedTarget !== trust.target || !/^S-1-5-(?:[0-9]+-)+[0-9]+$/.test(facts.currentUserSid) ||
      (plan.scope === 'all-users' && facts.elevated !== true) ||
      !(facts.nonce instanceof Uint8Array) || facts.nonce.byteLength !== 32 ||
      !privateRoot(observed.payloadRoot) || !privateRoot(observed.journalRoot) ||
      overlap(observed.payloadRoot, trust.target) || overlap(observed.journalRoot, trust.target) ||
      overlap(observed.payloadRoot, observed.journalRoot) ||
      !Array.isArray(policy.dataRoots) || policy.dataRoots.some(root =>
        typeof root !== 'string' || overlap(root, observed.payloadRoot) || overlap(root, observed.journalRoot))) fail()
  const session = frozen({ kind: 'rt-windows-repair-runtime-session-v1' as const,
    sessionId: randomUUID(), receiptSha256: artifacts.receiptSha256, planSha256: plan.planSha256,
    scope: plan.scope, view: plan.view, initiatingUserSid: facts.currentUserSid,
    intentNonceSha256: hash(facts.nonce), payloadRoot: observed.payloadRoot, journalRoot: observed.journalRoot })
  verifiedSessions.add(session)
  sessionBindings.set(session, { artifacts, plan: verifiedPlan })
  return session
}
export function requireWindowsRepairRuntimeSession(value: WindowsRepairRuntimeSession): WindowsRepairRuntimeSession {
  if (!value || !verifiedSessions.has(value)) fail()
  return value
}
export function resolveWindowsRepairConsumerRoots(
  artifacts: VerifiedRepairArtifacts, session: WindowsRepairRuntimeSession,
  verifiedPlan: WindowsRepairVerifiedPlan,
): WindowsRepairResolvedRoots {
  requireVerifiedRepairArtifacts(artifacts)
  requireWindowsRepairRuntimeSession(session)
  let validated: WindowsRepairVerifiedPlan
  try { validated = requireWindowsRepairVerifiedPlan(verifiedPlan) } catch { fail() }
  const binding = sessionBindings.get(session), trust = artifactTrust.get(artifacts)
  if (!binding || binding.artifacts !== artifacts || binding.plan !== verifiedPlan || !trust ||
      session.receiptSha256 !== artifacts.receiptSha256 || session.planSha256 !== validated.plan.planSha256) fail()
  const receipt = artifacts.receipt
  return frozen({ producerKey: trust.issuerKeys[receipt.issuerKeyId],
    consumerSha256: receipt.components.consumer.sha256,
    nativeHostSha256: receipt.components.nativeHost.sha256,
    producerSha256: artifacts.receiptSha256, installerSha256: receipt.installer.sha256,
    planSha256: validated.plan.planSha256, appId: trust.appId, target: trust.target,
    scope: session.scope, view: session.view, initiatingUserSid: session.initiatingUserSid,
    intentNonceSha256: session.intentNonceSha256, payloadRoot: session.payloadRoot,
    journalRoot: session.journalRoot,
    programFiles: receipt.programInventory.map(item =>
      ({ path: item.relativePath, size: item.size, sha256: item.sha256 })) })
}

// Backend-compatible resolved execution context. Its dynamic fields must come
// from verified artifacts and an internal session/plan, never CompiledRepairTrust,
// IPC, receipt policy, or installed registry data.
export interface WindowsRepairResolvedRoots {
  producerKey: KeyObject
  consumerSha256: string
  nativeHostSha256: string
  producerSha256: string
  installerSha256: string
  planSha256: string
  appId: string
  target: string
  scope: 'per-user' | 'all-users'
  view: '32' | '64'
  initiatingUserSid: string
  intentNonceSha256: string
  payloadRoot: string
  journalRoot: string
  programFiles: ReadonlyArray<{ path: string; size: number; sha256: string }>
}
/** Migration alias for the existing backend and native-launch interfaces. */
export type WindowsRepairConsumerRoots = WindowsRepairResolvedRoots
export interface WindowsRepairNativeLaunchFacts {
  // Collected from native process handles by the consumer itself, never stdin.
  consumerSha256: string
  directParentImageSha256: string
  directParentRunning: boolean
  directParentRepairIntent: boolean
  selectedScope: 'per-user' | 'all-users'
  selectedTarget: string
  currentUserSid: string
  elevated: boolean
  explicitConsentObserved: boolean
  nonce: Uint8Array
}
export interface WindowsRepairNativeGrant {
  readonly kind: 'rt-windows-native-repair-grant-v1'
  readonly roots: WindowsRepairConsumerRoots
  readonly receipt: WindowsRepairProducerReceipt
  readonly plan: WindowsInstallRepairPlan
  readonly beforeRegistry: WindowsInstallRepairSnapshot['registry']
}
const grants = new WeakSet<object>()
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
function fail(): never { throw new Error('WINDOWS_REPAIR_CONSUMER_REJECTED') }
function canonicalTarget(target: string) {
  return /^[DK]:\\Program Files\\RT-ResearchFlow$/i.test(target) && win32.normalize(target) === target
}
function privateRoot(path: string) {
  return /^[DK]:\\[^<>:"/|?*\x00-\x1f]+$/.test(path) && win32.normalize(path) === path &&
    path.split('\\').slice(1).every(part => part && !/[ .]$/.test(part))
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value) }
  return value
}

/** Legacy adapter only; not the production detached-receipt authorization entry. */
export function authorizeWindowsRepairNativeConsumer(
  roots: WindowsRepairConsumerRoots, producerBytes: Uint8Array, signature: Uint8Array,
  verifiedPlan: WindowsRepairVerifiedPlan, facts: WindowsRepairNativeLaunchFacts,
): WindowsRepairNativeGrant {
  let validated: WindowsRepairVerifiedPlan
  try { validated = requireWindowsRepairVerifiedPlan(verifiedPlan) } catch { fail() }
  const plan = validated.plan
  if (!roots || !facts || !plan || !canonicalTarget(roots.target) ||
      !privateRoot(roots.payloadRoot) || !privateRoot(roots.journalRoot) ||
      [roots.payloadRoot, roots.journalRoot].some(root => {
        const a = root.toLowerCase(), b = roots.target.toLowerCase()
        return a === b || a.startsWith(b + '\\') || b.startsWith(a + '\\')
      }) ||
      roots.payloadRoot.toLowerCase() === roots.journalRoot.toLowerCase() ||
      roots.payloadRoot.toLowerCase().startsWith(roots.journalRoot.toLowerCase() + '\\') ||
      roots.journalRoot.toLowerCase().startsWith(roots.payloadRoot.toLowerCase() + '\\') ||
      ![roots.consumerSha256, roots.nativeHostSha256, roots.producerSha256, roots.installerSha256, roots.planSha256, roots.intentNonceSha256].every(x => /^[a-f0-9]{64}$/.test(x)) ||
      roots.producerKey.asymmetricKeyType !== 'ed25519' || producerBytes.byteLength > 2 * 1024 * 1024 ||
      hash(producerBytes) !== roots.producerSha256 || !verify(null, producerBytes, roots.producerKey, signature) ||
      facts.consumerSha256 !== roots.consumerSha256 || facts.directParentImageSha256 !== roots.installerSha256 ||
      facts.directParentRunning !== true || facts.directParentRepairIntent !== true || facts.explicitConsentObserved !== true ||
      facts.selectedScope !== roots.scope || facts.selectedTarget !== roots.target || facts.currentUserSid !== roots.initiatingUserSid ||
      (roots.scope === 'all-users' && facts.elevated !== true) ||
      !(facts.nonce instanceof Uint8Array) || facts.nonce.byteLength !== 32 || hash(facts.nonce) !== roots.intentNonceSha256 ||
      plan.planSha256 !== roots.planSha256 || plan.appId !== roots.appId || plan.target !== roots.target ||
      plan.scope !== roots.scope || plan.view !== roots.view) fail()
  let receipt: WindowsRepairProducerReceipt
  try { receipt = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(producerBytes)) } catch { fail() }
  if (receipt.kind !== 'rt-windows-repair-producer-v1' || receipt.schemaVersion !== 1 || receipt.policy?.appId !== roots.appId ||
      receipt.artifactSha256 !== roots.installerSha256 || receipt.policy.installer.sha256 !== roots.installerSha256 ||
      receipt.registration?.scope !== roots.scope || receipt.registration.view !== roots.view ||
      stable(receipt.policy) !== stable(validated.policy) ||
      !Array.isArray(receipt.registration.installValues) || !Array.isArray(receipt.registration.uninstallValues) ||
      !Array.isArray(roots.programFiles) || roots.programFiles.length !== receipt.programMembers?.length) fail()
  const expectedRegistration = receipt.policy.expectedRegistration
  if (!expectedRegistration || expectedRegistration.scope !== roots.scope || expectedRegistration.view !== roots.view ||
      expectedRegistration.installValuesSha256 !== windowsInstallRepairTypedValuesDigest(receipt.registration.installValues) ||
      expectedRegistration.uninstallValuesSha256 !== windowsInstallRepairTypedValuesDigest(receipt.registration.uninstallValues)) fail()
  const location = receipt.registration.installValues.find(value => value.name.toLowerCase() === 'installlocation')
  if (!location || location.type !== 'REG_SZ' || location.data !== roots.target) fail()
  for (const data of receipt.policy.dataRoots ?? []) {
    for (const root of [roots.payloadRoot, roots.journalRoot]) {
      const a = root.toLowerCase(), b = data.toLowerCase()
      if (a === b || a.startsWith(b + '\\') || b.startsWith(a + '\\')) fail()
    }
  }
  const names = new Set<string>()
  for (const member of roots.programFiles) {
    if (!member || typeof member.path !== 'string' || !member.path.split('/').every(part => part && part !== '.' && part !== '..' &&
        !/[<>:"\\|?*\x00-\x1f]/.test(part) && !/[ .]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) ||
        /^(data|userdata|backups)(\/|$)/i.test(member.path) || !/^[a-f0-9]{64}$/.test(member.sha256) ||
        !Number.isSafeInteger(member.size) || member.size < 0 || names.has(member.path.toLowerCase()) ||
        !receipt.programMembers.includes(member.path)) fail()
    names.add(member.path.toLowerCase())
  }
  // Copy all mutable arrays/objects. KeyObject is an immutable native verifier,
  // not part of the write authority given to the backend.
  const safeRoots = { ...roots, programFiles: structuredClone(roots.programFiles) }
  const grant = frozen({ kind: 'rt-windows-native-repair-grant-v1' as const,
    roots: safeRoots, receipt: structuredClone(receipt), plan: structuredClone(plan), beforeRegistry: structuredClone(validated.current.registry) })
  grants.add(grant)
  return grant
}

export function requireWindowsRepairNativeGrant(grant: WindowsRepairNativeGrant) {
  if (!grant || !grants.has(grant)) fail()
  return grant
}
