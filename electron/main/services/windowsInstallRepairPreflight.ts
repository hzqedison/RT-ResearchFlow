import { createHash } from 'node:crypto'
import { win32 } from 'node:path'

// Pure evidence contract. No registry, filesystem, process or installer operations.
// Inputs assume a trusted collector and build policy. Digests are bindings, NOT
// authorization tokens or proof that declared installer effects actually happened.
export const DEFAULT_WINDOWS_INSTALL_REPAIR_TARGET = 'D:\\Program Files\\RT-ResearchFlow'
export const WINDOWS_INSTALL_REPAIR_CAPABILITY = 'rt-windows-install-explicit-repair-v1'
const MAX_AGE_MS = 5 * 60 * 1000
export type WindowsInstallScope = 'per-user' | 'all-users'
export type WindowsRegistryView = '32' | '64'
export interface WindowsInstallRepairSelection { scope: WindowsInstallScope; view: WindowsRegistryView }
export interface WindowsRepairTypedRegistryValue {
  name: string
  type: 'REG_SZ' | 'REG_EXPAND_SZ' | 'REG_DWORD' | 'REG_QWORD' | 'REG_BINARY' | 'REG_MULTI_SZ'
  data: string | number | string[]
}
export interface WindowsRepairPathEvidence {
  path: string
  kind: 'directory' | 'file' | 'missing' | 'reparse' | 'unreadable'
  fileId?: string
  sha256?: string
  size?: number
}
export interface WindowsRepairRegistrySlot extends WindowsInstallRepairSelection {
  installKey: string
  uninstallKey: string
  state: 'absent' | 'present' | 'unreadable'
  installKeyState: 'absent' | 'present' | 'unreadable'
  uninstallKeyState: 'absent' | 'present' | 'unreadable'
  installValues: WindowsRepairTypedRegistryValue[] | null
  uninstallValues: WindowsRepairTypedRegistryValue[] | null
  installLocation?: string
  installValuesSha256?: string
  uninstallValuesSha256?: string
  rawValuesSha256?: string
}
export interface WindowsRepairInventoryEntry {
  path: string
  kind: 'file' | 'directory'
  sha256?: string
  size?: number
}
export interface WindowsRepairDataEvidence {
  root: string
  complete: true
  entries: WindowsRepairInventoryEntry[]
  backup: { path: string; sha256: string; inventorySha256: string }
}
export interface WindowsRepairProductEvidence {
  kind: 'owned-payload' | 'verified-recovery-manifest'
  root: string
  appId: string
  productProofSha256: string
  identityVerified: true
  mainExecutableSha256?: string
}
export interface WindowsInstallRepairPolicy {
  appId: string
  executableName: string
  installKey: string
  uninstallKey: string
  existingProductProofSha256: string
  dataRoots: string[]
  installer: {
    path: string
    sha256: string
    releaseReceiptSha256: string
    mainExecutableSha256: string
    runtimeSealSha256: string
  }
  // Independently produced from the verified new payload's registration contract,
  // not copied from a receipt or the old registry. Include exact selected scope.
  expectedRegistration: WindowsInstallRepairSelection & {
    installValuesSha256: string
    uninstallValuesSha256: string
  }
  capability: null | {
    protocol: typeof WINDOWS_INSTALL_REPAIR_CAPABILITY
    appId: string
    installerSha256: string
    reviewSha256: string
  }
  capabilityReviewSha256?: string
}
export interface WindowsInstallRepairSnapshot {
  collectionId: string
  observedAtMs: number
  registry: WindowsRepairRegistrySlot[]
  paths: WindowsRepairPathEvidence[]
  product: WindowsRepairProductEvidence | null
  installer: {
    appId: string
    sha256: string
    releaseReceiptSha256: string
    runtimeSealSha256: string
    identityVerified: true
    runtimeGateVerified: true
  }
  data: WindowsRepairDataEvidence[]
  activeWorkers: number
  sqliteState: 'closed-consistent' | 'open-or-wal-active' | 'unknown'
}
const STEPS = [
  'validate-new-payload', 'verify-data-and-foreign-before',
  'install-only-without-old-uninstaller', 'verify-new-payload-and-preservation',
  'commit-selected-registration',
] as const
export interface WindowsInstallRepairPlan extends WindowsInstallRepairSelection {
  protocol: typeof WINDOWS_INSTALL_REPAIR_CAPABILITY
  appId: string
  target: typeof DEFAULT_WINDOWS_INSTALL_REPAIR_TARGET
  policySha256: string
  snapshotSha256: string
  planSha256: string
  collectionId: string
  createdAtMs: number
  expiresAtMs: number
  dataRoots: string[]
  protectedPaths: WindowsRepairPathEvidence[]
  steps: readonly string[]
  executionAuthorized: false
}
export type WindowsInstallRepairPreflight =
  | { kind: 'blocked'; reason: string; executionAuthorized: false; plan?: WindowsInstallRepairPlan }
  | { kind: 'delegate-normal-upgrade'; target: string; scope: WindowsInstallScope; view: WindowsRegistryView;
      useExistingAllScopesGuards: true; executionAuthorized: false }
  | { kind: 'preflight-candidate'; plan: WindowsInstallRepairPlan; executionAuthorized: false }

function invalid(reason: string): never { throw new Error('WINDOWS_INSTALL_REPAIR_INVALID:' + reason) }
function digest(value: unknown): string {
  function stable(item: any): any {
    if (Array.isArray(item)) return item.map(stable)
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, stable(item[key])]))
    }
    return item
  }
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}
function sha(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid('invalid-digest')
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\x00-\x1f]/.test(value)) invalid('invalid-identity')
}
function parts(value: string): string[] {
  return value === value.slice(0, 3) ? [] : value.slice(3).split('\\')
}
function validPart(value: string): boolean {
  return !!value && value !== '.' && value !== '..' && !/[ .]$/.test(value)
    && !/[<>:"/\\|?*\x00-\x1f]/.test(value)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
}
function canonical(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32760 || !/^[a-z]:\\/i.test(value)
      || value.trim() !== value || !parts(value).every(validPart)) invalid('noncanonical-path')
  return value[0].toUpperCase() + value.slice(1)
}
function same(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase() }
function below(root: string, path: string): boolean { return same(root, path) || path.toLowerCase().startsWith(root.toLowerCase() + '\\') }
function chain(path: string): string[] {
  const names = [path.slice(0, 3)]
  let current = names[0]
  for (const part of parts(path)) { current = win32.join(current, part); names.push(current) }
  return names
}
function selection(value: WindowsInstallRepairSelection): void {
  if (!value || !['per-user', 'all-users'].includes(value.scope) || !['32', '64'].includes(value.view)) invalid('invalid-scope-view')
}
function validatePolicy(policy: WindowsInstallRepairPolicy): void {
  identifier(policy.appId)
  if (!validPart(policy.executableName) || !policy.executableName.toLowerCase().endsWith('.exe')) invalid('invalid-executable')
  if (!/^Software\\[^\\\x00-\x1f]+$/i.test(policy.installKey)) invalid('invalid-install-registry-key')
  if (!/^Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^\\\x00-\x1f]+$/i.test(policy.uninstallKey)) invalid('invalid-registry-key')
  sha(policy.existingProductProofSha256)
  if (!Array.isArray(policy.dataRoots) || !policy.dataRoots.length || policy.dataRoots.length > 32) invalid('data-coverage-missing')
  const roots = policy.dataRoots.map(canonical)
  if (new Set(roots.map(root => root.toLowerCase())).size !== roots.length) invalid('duplicate-data-root')
  for (const root of roots) for (const other of roots) if (root !== other && below(root, other)) invalid('overlapping-data-roots')
  canonical(policy.installer.path)
  if (below(DEFAULT_WINDOWS_INSTALL_REPAIR_TARGET, policy.installer.path)) invalid('installer-inside-target')
  for (const value of [policy.installer.sha256, policy.installer.releaseReceiptSha256,
    policy.installer.mainExecutableSha256, policy.installer.runtimeSealSha256]) sha(value)
  selection(policy.expectedRegistration)
  sha(policy.expectedRegistration.installValuesSha256)
  sha(policy.expectedRegistration.uninstallValuesSha256)
}
function pathIndex(snapshot: WindowsInstallRepairSnapshot): Map<string, WindowsRepairPathEvidence> {
  if (!Array.isArray(snapshot.paths) || snapshot.paths.length > 512) invalid('path-coverage-missing')
  const result = new Map<string, WindowsRepairPathEvidence>()
  for (const item of snapshot.paths) {
    const path = canonical(item.path)
    if (result.has(path.toLowerCase()) || !['directory', 'file', 'missing', 'reparse', 'unreadable'].includes(item.kind)) invalid('ambiguous-path-evidence')
    if (item.kind === 'file' || item.kind === 'directory') identifier(item.fileId)
    if (item.kind === 'file') { sha(item.sha256); if (!Number.isSafeInteger(item.size) || item.size! < 0) invalid('invalid-file-size') }
    result.set(path.toLowerCase(), { ...item, path })
  }
  return result
}
function requirePath(index: Map<string, WindowsRepairPathEvidence>, path: string, leaf?: string): WindowsRepairPathEvidence {
  const names = chain(canonical(path))
  for (let i = 0; i < names.length; i++) {
    const item = index.get(names[i].toLowerCase())
    if (!item) invalid('path-coverage-missing')
    if (i < names.length - 1 && item.kind !== 'directory') invalid('unsafe-path-ancestor')
    if (i === names.length - 1) {
      if (item.kind === 'reparse' || item.kind === 'unreadable' || (leaf && item.kind !== leaf)) invalid('unsafe-path-leaf')
      return item
    }
  }
  return invalid('path-coverage-missing')
}
function registry(policy: WindowsInstallRepairPolicy, snapshot: WindowsInstallRepairSnapshot): WindowsRepairRegistrySlot[] {
  if (!Array.isArray(snapshot.registry) || snapshot.registry.length !== 4) invalid('registry-coverage-missing')
  const seen = new Set<string>()
  const rows = snapshot.registry.map(slot => {
    selection(slot)
    const id = slot.scope + '/' + slot.view
    if (seen.has(id) || !same(slot.installKey, policy.installKey) || !same(slot.uninstallKey, policy.uninstallKey)) invalid('ambiguous-registry')
    seen.add(id)
    if (slot.state === 'unreadable' || !['present', 'absent'].includes(slot.state)) invalid('unreadable-registry')
    if (![slot.installKeyState, slot.uninstallKeyState].every(value => value === 'present' || value === 'absent')) invalid('unreadable-registry')
    const bothAbsent = slot.installKeyState === 'absent' && slot.uninstallKeyState === 'absent'
    if ((slot.state === 'absent') !== bothAbsent) invalid('registry-presence-mismatch')
    if (slot.installKeyState !== slot.uninstallKeyState) invalid('partial-registration-requires-manual-recovery')
    for (const [state, values, claimed] of [
      [slot.installKeyState, slot.installValues, slot.installValuesSha256],
      [slot.uninstallKeyState, slot.uninstallValues, slot.uninstallValuesSha256],
    ] as const) {
      if ((state === 'absent') !== (values === null)) invalid('registry-value-presence-mismatch')
      if (windowsInstallRepairTypedValuesDigest(values) !== claimed) invalid('registry-typed-digest-mismatch')
    }
    if (slot.rawValuesSha256 !== windowsInstallRepairRegistryDigest(slot.installValuesSha256!, slot.uninstallValuesSha256!)) invalid('registry-digest-mismatch')
    if (slot.state === 'present') {
      canonical(slot.installLocation); sha(slot.rawValuesSha256)
      const location = slot.installValues!.find(value => value.name.toLowerCase() === 'installlocation')
      if (!location || !['REG_SZ', 'REG_EXPAND_SZ'].includes(location.type)
          || location.data !== slot.installLocation) invalid('detached-install-location')
    }
    return { ...slot }
  }).sort((a, b) => (a.scope + a.view).localeCompare(b.scope + b.view))
  return rows
}
// The collector hashes the exact typed values of BOTH keys. Neither an uninstall
// string nor DisplayName is interpreted as an instruction/product identity here.
export function windowsInstallRepairRegistryDigest(installValuesSha256: string, uninstallValuesSha256: string): string {
  sha(installValuesSha256); sha(uninstallValuesSha256)
  return digest({ installValuesSha256, uninstallValuesSha256 })
}
export function windowsInstallRepairTypedValuesDigest(values: WindowsRepairTypedRegistryValue[] | null): string {
  if (values === null) return digest({ state: 'absent' })
  if (!Array.isArray(values) || values.length > 4096) invalid('invalid-typed-registry-values')
  const seen = new Set<string>()
  const normalized = values.map(value => {
    if (!value || typeof value.name !== 'string' || value.name.length > 16383 || /[\x00-\x1f]/.test(value.name)) invalid('invalid-typed-registry-values')
    const name = value.name.toLowerCase()
    if (seen.has(name)) invalid('duplicate-registry-value')
    seen.add(name)
    let data = value.data
    switch (value.type) {
      case 'REG_SZ': case 'REG_EXPAND_SZ':
        if (typeof data !== 'string' || data.length > 1024 * 1024 || data.includes('\0')) invalid('invalid-typed-registry-values')
        break
      case 'REG_DWORD':
        if (typeof data !== 'number' || !Number.isInteger(data) || data < 0 || data > 0xffffffff) invalid('invalid-typed-registry-values')
        break
      case 'REG_QWORD':
        if (typeof data !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(data) || BigInt(data) > 18446744073709551615n) invalid('invalid-typed-registry-values')
        break
      case 'REG_BINARY':
        if (typeof data !== 'string' || data.length > 2 * 1024 * 1024 || !/^(?:[a-f0-9]{2})*$/i.test(data)) invalid('invalid-typed-registry-values')
        data = data.toLowerCase()
        break
      case 'REG_MULTI_SZ':
        if (!Array.isArray(data) || data.length > 4096 || !data.every(item => typeof item === 'string' && !item.includes('\0') && item.length <= 16383)) invalid('invalid-typed-registry-values')
        data = [...data]
        break
      default: invalid('invalid-typed-registry-values')
    }
    return { name, type: value.type, data }
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  return digest({ state: 'present', values: normalized })
}
export function windowsInstallRepairInventoryDigest(entries: WindowsRepairInventoryEntry[]): string {
  if (!Array.isArray(entries) || entries.length > 100000) invalid('invalid-data-inventory')
  const seen = new Set<string>()
  const values = entries.map(entry => {
    if (typeof entry.path !== 'string' || !entry.path.split('/').every(validPart) || seen.has(entry.path.toLowerCase())) invalid('invalid-data-inventory')
    seen.add(entry.path.toLowerCase())
    if (!['file', 'directory'].includes(entry.kind)) invalid('invalid-data-inventory')
    if (entry.kind === 'file') { sha(entry.sha256); if (!Number.isSafeInteger(entry.size) || entry.size! < 0) invalid('invalid-data-size') }
    return { ...entry }
  }).sort((a, b) => a.path.localeCompare(b.path))
  return digest(values)
}
function dataEvidence(policy: WindowsInstallRepairPolicy, snapshot: WindowsInstallRepairSnapshot, index: Map<string, WindowsRepairPathEvidence>): unknown[] {
  if (snapshot.activeWorkers !== 0 || snapshot.sqliteState !== 'closed-consistent') invalid('active-or-unproved-data')
  if (!Array.isArray(snapshot.data) || snapshot.data.length !== policy.dataRoots.length) invalid('data-coverage-missing')
  const roots = new Set(policy.dataRoots.map(root => canonical(root).toLowerCase()))
  return snapshot.data.map(data => {
    const root = canonical(data.root)
    if (!roots.delete(root.toLowerCase()) || data.complete !== true) invalid('data-coverage-missing')
    requirePath(index, root, 'directory')
    const inventorySha256 = windowsInstallRepairInventoryDigest(data.entries)
    if (data.entries.some(entry => /-(wal|shm)$/i.test(entry.path))) invalid('active-or-unproved-data')
    sha(data.backup.sha256)
    if (data.backup.inventorySha256 !== inventorySha256) invalid('inconsistent-backup')
    const backupPath = canonical(data.backup.path)
    if (below(DEFAULT_WINDOWS_INSTALL_REPAIR_TARGET, backupPath) || policy.dataRoots.some(value => below(canonical(value), backupPath))) invalid('unsafe-backup-location')
    const backup = requirePath(index, backupPath, 'file')
    if (backup.sha256 !== data.backup.sha256) invalid('backup-identity-mismatch')
    return { root, inventorySha256, backup: { ...data.backup, path: backupPath, fileId: backup.fileId } }
  }).sort((a, b) => a.root.localeCompare(b.root))
}
function fresh(snapshot: WindowsInstallRepairSnapshot, now: number): void {
  identifier(snapshot.collectionId)
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(snapshot.observedAtMs)
      || snapshot.observedAtMs > now || now - snapshot.observedAtMs > MAX_AGE_MS) invalid('stale-snapshot')
}
function product(policy: WindowsInstallRepairPolicy, snapshot: WindowsInstallRepairSnapshot, root: string,
  index: Map<string, WindowsRepairPathEvidence>, after = false): void {
  const value = snapshot.product
  if (!value || !['owned-payload', 'verified-recovery-manifest'].includes(value.kind) || value.appId !== policy.appId
      || value.identityVerified !== true || !same(canonical(value.root), root)
      || value.productProofSha256 !== (after ? policy.installer.releaseReceiptSha256 : policy.existingProductProofSha256)) invalid('independent-product-evidence-missing')
  if (after && value.kind !== 'owned-payload') invalid('new-payload-missing')
  if (value.kind === 'owned-payload') {
    sha(value.mainExecutableSha256)
    const executable = requirePath(index, win32.join(root, policy.executableName), 'file')
    if (executable.sha256 !== value.mainExecutableSha256
        || (after && executable.sha256 !== policy.installer.mainExecutableSha256)) invalid('product-payload-mismatch')
  }
}
function installer(policy: WindowsInstallRepairPolicy, snapshot: WindowsInstallRepairSnapshot, index: Map<string, WindowsRepairPathEvidence>): void {
  const evidence = snapshot.installer
  if (!evidence || evidence.appId !== policy.appId || evidence.identityVerified !== true || evidence.runtimeGateVerified !== true
      || evidence.sha256 !== policy.installer.sha256 || evidence.releaseReceiptSha256 !== policy.installer.releaseReceiptSha256
      || evidence.runtimeSealSha256 !== policy.installer.runtimeSealSha256
      || requirePath(index, policy.installer.path, 'file').sha256 !== policy.installer.sha256) invalid('new-installer-untrusted')
}
function capability(policy: WindowsInstallRepairPolicy): void {
  const value = policy.capability
  if (!value) invalid('installer-repair-capability-missing')
  sha(policy.capabilityReviewSha256)
  if (typeof value !== 'object' || value.protocol !== WINDOWS_INSTALL_REPAIR_CAPABILITY || value.appId !== policy.appId
      || value.installerSha256 !== policy.installer.sha256 || value.reviewSha256 !== policy.capabilityReviewSha256) invalid('installer-repair-capability-invalid')
}
function facts(snapshot: WindowsInstallRepairSnapshot): unknown {
  return { registry: [...snapshot.registry].sort((a, b) => (a.scope + a.view).localeCompare(b.scope + b.view)),
    paths: [...snapshot.paths].sort((a, b) => a.path.localeCompare(b.path)), product: snapshot.product,
    installer: snapshot.installer, data: [...snapshot.data].sort((a, b) => a.root.localeCompare(b.root)),
    activeWorkers: snapshot.activeWorkers, sqliteState: snapshot.sqliteState }
}
function preflight(policy: WindowsInstallRepairPolicy, snapshot: WindowsInstallRepairSnapshot,
  selected: WindowsInstallRepairSelection, now: number): WindowsInstallRepairPreflight {
  validatePolicy(policy); selection(selected); fresh(snapshot, now)
  const rows = registry(policy, snapshot)
  const present = rows.filter(row => row.state === 'present')
  if (present.length !== 1) invalid(present.length ? 'ambiguous-installation-records' : 'no-existing-installation-record')
  const row = present[0]
  if (row.scope !== selected.scope || row.view !== selected.view) invalid('scope-or-view-migration-forbidden')
  if (policy.expectedRegistration.scope !== selected.scope || policy.expectedRegistration.view !== selected.view) invalid('new-registration-scope-mismatch')
  const index = pathIndex(snapshot)
  const oldRoot = canonical(row.installLocation)
  const old = requirePath(index, oldRoot)
  if (old.kind === 'directory') {
    product(policy, snapshot, oldRoot, index)
    if (snapshot.product!.kind !== 'owned-payload') invalid('manual-recovery-required')
    return { kind: 'delegate-normal-upgrade', target: oldRoot, ...selected, useExistingAllScopesGuards: true, executionAuthorized: false }
  }
  if (old.kind !== 'file' && old.kind !== 'missing') invalid('unsafe-old-location')
  const target = requirePath(index, DEFAULT_WINDOWS_INSTALL_REPAIR_TARGET)
  if (target.kind === 'missing') invalid('manual-recovery-required')
  if (target.kind !== 'directory') invalid('unsafe-target')
  product(policy, snapshot, DEFAULT_WINDOWS_INSTALL_REPAIR_TARGET, index)
  installer(policy, snapshot, index)
  dataEvidence(policy, snapshot, index)
  // Preserve the foreign path and all outer ancestors/data/backup/installer evidence.
  // Only owned payload children may change; this never specifies deletion operations.
  const protectedPaths = [...index.values()].filter(item => same(item.path, DEFAULT_WINDOWS_INSTALL_REPAIR_TARGET)
    || !below(DEFAULT_WINDOWS_INSTALL_REPAIR_TARGET, item.path)).sort((a, b) => a.path.localeCompare(b.path))
  const fields: Omit<WindowsInstallRepairPlan, 'planSha256'> = {
    protocol: WINDOWS_INSTALL_REPAIR_CAPABILITY, appId: policy.appId, target: DEFAULT_WINDOWS_INSTALL_REPAIR_TARGET,
    ...selected, policySha256: digest(policy), snapshotSha256: digest(facts(snapshot)),
    collectionId: snapshot.collectionId, createdAtMs: now, expiresAtMs: now + MAX_AGE_MS,
    dataRoots: policy.dataRoots.map(canonical), protectedPaths, steps: [...STEPS], executionAuthorized: false as const,
  }
  const plan: WindowsInstallRepairPlan = { ...fields, planSha256: digest(fields) }
  try { capability(policy) } catch (error) {
    return { kind: 'blocked', reason: reason(error), executionAuthorized: false, plan }
  }
  return { kind: 'preflight-candidate', plan, executionAuthorized: false }
}
function reason(error: unknown): string {
  return error instanceof Error && error.message.startsWith('WINDOWS_INSTALL_REPAIR_INVALID:')
    ? error.message.slice('WINDOWS_INSTALL_REPAIR_INVALID:'.length) : 'invalid-evidence'
}
export function createWindowsInstallRepairPreflight(policy: WindowsInstallRepairPolicy, snapshot: WindowsInstallRepairSnapshot,
  selected: WindowsInstallRepairSelection, now = Date.now()): WindowsInstallRepairPreflight {
  try { return preflight(policy, snapshot, selected, now) }
  catch (error) { return { kind: 'blocked', reason: reason(error), executionAuthorized: false } }
}
export function revalidateWindowsInstallRepairPlan(policy: WindowsInstallRepairPolicy, plan: WindowsInstallRepairPlan,
  current: WindowsInstallRepairSnapshot, now = Date.now()): void {
  const { planSha256, ...fields } = plan
  if (digest(fields) !== planSha256 || plan.executionAuthorized !== false || plan.target !== DEFAULT_WINDOWS_INSTALL_REPAIR_TARGET
      || plan.policySha256 !== digest(policy) || now < plan.createdAtMs || now > plan.expiresAtMs) invalid('stale-or-altered-plan')
  if (current.collectionId === plan.collectionId || current.observedAtMs < plan.createdAtMs) invalid('fresh-recollection-required')
  const result = createWindowsInstallRepairPreflight(policy, current, plan, now)
  if (result.kind !== 'preflight-candidate' || result.plan.snapshotSha256 !== plan.snapshotSha256) invalid('revalidation-failed')
}
export interface WindowsInstallRepairReceipt extends WindowsInstallRepairSelection {
  protocol: typeof WINDOWS_INSTALL_REPAIR_CAPABILITY
  planSha256: string
  appId: string
  target: string
  steps: string[]
  collectorEvidenceSha256: string
  oldUninstallerExecutions: number
  foreignPathMutations: number
  registrationMutatedBeforeVerification: boolean
  committedInstallValuesSha256: string
  committedUninstallValuesSha256: string
  committedRegistrySha256: string
  completedAtMs: number
}
export function verifyWindowsInstallRepairReceipt(policy: WindowsInstallRepairPolicy, plan: WindowsInstallRepairPlan,
  before: WindowsInstallRepairSnapshot, after: WindowsInstallRepairSnapshot, receipt: WindowsInstallRepairReceipt, now = Date.now()) {
  // Caller must independently collect/observe effects. A JSON receipt cannot grant
  // registry privileges, prove no process ran, or replace a VM/installer audit.
  revalidateWindowsInstallRepairPlan(policy, plan, before, now)
  fresh(after, now)
  if (after.collectionId === before.collectionId || !Number.isSafeInteger(receipt.completedAtMs)
      || receipt.completedAtMs < before.observedAtMs || receipt.completedAtMs > after.observedAtMs
      || receipt.protocol !== WINDOWS_INSTALL_REPAIR_CAPABILITY || receipt.planSha256 !== plan.planSha256
      || receipt.appId !== policy.appId || !same(canonical(receipt.target), plan.target)
      || receipt.scope !== plan.scope || receipt.view !== plan.view || digest(receipt.steps) !== digest(STEPS)
      || receipt.oldUninstallerExecutions !== 0 || receipt.foreignPathMutations !== 0
      || receipt.registrationMutatedBeforeVerification !== false) invalid('invalid-repair-receipt')
  sha(receipt.collectorEvidenceSha256); sha(receipt.committedRegistrySha256)
  if (receipt.committedRegistrySha256 !== windowsInstallRepairRegistryDigest(receipt.committedInstallValuesSha256,
    receipt.committedUninstallValuesSha256)) invalid('registration-commit-mismatch')
  const previous = registry(policy, before)
  const current = registry(policy, after)
  for (let i = 0; i < previous.length; i++) {
    const row = current[i]
    if (row.scope === plan.scope && row.view === plan.view) {
      if (row.state !== 'present' || !same(canonical(row.installLocation), plan.target)
          || row.installValuesSha256 !== receipt.committedInstallValuesSha256
          || row.uninstallValuesSha256 !== receipt.committedUninstallValuesSha256
          || row.installValuesSha256 !== policy.expectedRegistration.installValuesSha256
          || row.uninstallValuesSha256 !== policy.expectedRegistration.uninstallValuesSha256
          || row.rawValuesSha256 !== receipt.committedRegistrySha256) invalid('registration-commit-mismatch')
    } else if (digest(row) !== digest(previous[i])) invalid('other-scope-or-view-mutated')
  }
  const oldIndex = pathIndex(before), newIndex = pathIndex(after)
  for (const item of plan.protectedPaths) {
    if (digest(newIndex.get(item.path.toLowerCase())) !== digest(item)) invalid('protected-path-mutated')
  }
  product(policy, after, plan.target, newIndex, true)
  installer(policy, after, newIndex)
  if (digest(dataEvidence(policy, before, oldIndex)) !== digest(dataEvidence(policy, after, newIndex))) invalid('userdata-or-backup-mutated')
  return { kind: 'structurally-verified-repair-receipt' as const, executionAuthorized: false as const,
    processEffectsIndependentlyProved: false as const, dataRootsVerified: [...plan.dataRoots] }
}
