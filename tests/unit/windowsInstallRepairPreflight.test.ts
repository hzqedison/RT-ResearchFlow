import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  DEFAULT_WINDOWS_INSTALL_REPAIR_TARGET as TARGET, WINDOWS_INSTALL_REPAIR_CAPABILITY as CAPABILITY,
  createWindowsInstallRepairPreflight, revalidateWindowsInstallRepairPlan, verifyWindowsInstallRepairReceipt,
  windowsInstallRepairInventoryDigest, windowsInstallRepairRegistryDigest, windowsInstallRepairTypedValuesDigest,
} from '../../electron/main/services/windowsInstallRepairPreflight'
import type {
  WindowsInstallRepairPolicy, WindowsInstallRepairSnapshot, WindowsInstallRepairSelection,
  WindowsInstallRepairPlan, WindowsInstallRepairReceipt, WindowsRepairPathEvidence, WindowsRepairTypedRegistryValue,
  WindowsRepairRegistrySlot,
} from '../../electron/main/services/windowsInstallRepairPreflight'

// All keys, IDs, files, data and release approvals below are synthetic in-memory
// fixtures. These tests never collect a real registry, start an installer or grant
// production licensing/repair capability.
const NOW = 1_800_000_000_000
const OLD = 'D:\\Program'
const DATA = 'D:\\FixtureUserData'
const BACKUP = 'D:\\FixtureBackups\\backup.bin'
const INSTALLER = 'D:\\FixtureDownloads\\setup.exe'
const EXE = 'RT-ResearchFlow.exe'
const H = (text: string) => createHash('sha256').update(text).digest('hex')
function registrationValues(path: string, selected: WindowsInstallRepairSelection) {
  const scope = selected.scope === 'all-users' ? '/allusers' : '/currentuser'
  const uninstall = '"' + path + '\\Uninstall RT-ResearchFlow.exe" ' + scope
  const install: WindowsRepairTypedRegistryValue[] = [
    { name: 'InstallLocation', type: 'REG_SZ', data: path },
    { name: 'KeepShortcuts', type: 'REG_SZ', data: 'true' },
    { name: 'ShortcutName', type: 'REG_SZ', data: 'RT-ResearchFlow' },
  ]
  const uninstallation: WindowsRepairTypedRegistryValue[] = [
    { name: 'DisplayName', type: 'REG_SZ', data: 'RT-ResearchFlow 1.7.0' },
    { name: 'DisplayVersion', type: 'REG_SZ', data: '1.7.0' },
    { name: 'Publisher', type: 'REG_SZ', data: 'Fixture Publisher' },
    { name: 'UninstallString', type: 'REG_SZ', data: uninstall },
    { name: 'QuietUninstallString', type: 'REG_SZ', data: uninstall + ' /S' },
    { name: 'DisplayIcon', type: 'REG_SZ', data: path + '\\' + EXE + ',0' },
    { name: 'NoModify', type: 'REG_DWORD', data: 1 },
    { name: 'NoRepair', type: 'REG_DWORD', data: 1 },
  ]
  return { install, uninstallation }
}
function bindValues(row: WindowsRepairRegistrySlot) {
  row.installValuesSha256 = windowsInstallRepairTypedValuesDigest(row.installValues)
  row.uninstallValuesSha256 = windowsInstallRepairTypedValuesDigest(row.uninstallValues)
  row.rawValuesSha256 = windowsInstallRepairRegistryDigest(row.installValuesSha256, row.uninstallValuesSha256)
}
function fixture(selected: WindowsInstallRepairSelection = { scope: 'all-users', view: '64' }) {
  const expected = registrationValues(TARGET, selected)
  const old = registrationValues(OLD, selected)
  const policy: WindowsInstallRepairPolicy = {
    appId: 'org.example.fixture.rt-researchflow', executableName: EXE,
    installKey: 'Software\\fixture-only-compiled-guid',
    uninstallKey: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\fixture-only-key',
    existingProductProofSha256: H('trusted-old-product-proof'), dataRoots: [DATA],
    installer: { path: INSTALLER, sha256: H('new-installer'), releaseReceiptSha256: H('release-receipt'),
      mainExecutableSha256: H('new-owned-executable'), runtimeSealSha256: H('runtime-seal') },
    expectedRegistration: { ...selected, installValuesSha256: windowsInstallRepairTypedValuesDigest(expected.install),
      uninstallValuesSha256: windowsInstallRepairTypedValuesDigest(expected.uninstallation) },
    capability: { protocol: CAPABILITY, appId: 'org.example.fixture.rt-researchflow',
      installerSha256: H('new-installer'), reviewSha256: H('independent-capability-review') },
    capabilityReviewSha256: H('independent-capability-review'),
  }
  const directory = (path: string): WindowsRepairPathEvidence => ({ path, kind: 'directory', fileId: 'fixture-dir:' + path })
  const file = (path: string, sha256: string, size = 100): WindowsRepairPathEvidence =>
    ({ path, kind: 'file', fileId: 'fixture-file:' + path, sha256, size })
  const entries = [{ path: 'trade.db', kind: 'file' as const, sha256: H('unchanged-user-db'), size: 100 },
    { path: 'empty-directory', kind: 'directory' as const }]
  const snapshot: WindowsInstallRepairSnapshot = {
    collectionId: 'fixture-collection-1', observedAtMs: NOW,
    registry: (['per-user', 'all-users'] as const).flatMap(scope => (['32', '64'] as const).map(view => ({
      scope, view, installKey: policy.installKey, uninstallKey: policy.uninstallKey,
      state: scope === selected.scope && view === selected.view ? 'present' as const : 'absent' as const,
      installKeyState: scope === selected.scope && view === selected.view ? 'present' as const : 'absent' as const,
      uninstallKeyState: scope === selected.scope && view === selected.view ? 'present' as const : 'absent' as const,
      installValues: scope === selected.scope && view === selected.view ? structuredClone(old.install) : null,
      uninstallValues: scope === selected.scope && view === selected.view ? structuredClone(old.uninstallation) : null,
      ...(scope === selected.scope && view === selected.view ? { installLocation: OLD,
        installValuesSha256: windowsInstallRepairTypedValuesDigest(old.install), uninstallValuesSha256: windowsInstallRepairTypedValuesDigest(old.uninstallation),
        rawValuesSha256: windowsInstallRepairRegistryDigest(windowsInstallRepairTypedValuesDigest(old.install), windowsInstallRepairTypedValuesDigest(old.uninstallation)) }
        : { installValuesSha256: windowsInstallRepairTypedValuesDigest(null), uninstallValuesSha256: windowsInstallRepairTypedValuesDigest(null),
          rawValuesSha256: windowsInstallRepairRegistryDigest(windowsInstallRepairTypedValuesDigest(null), windowsInstallRepairTypedValuesDigest(null)) }),
    }))),
    paths: [directory('D:\\'), directory('D:\\Program Files'), directory(TARGET),
      file(OLD, H('foreign-1099-bytes'), 1099), file(TARGET + '\\' + EXE, H('old-owned-executable')),
      directory(DATA), directory('D:\\FixtureBackups'), file(BACKUP, H('consistent-backup')),
      directory('D:\\FixtureDownloads'), file(INSTALLER, policy.installer.sha256)],
    product: { kind: 'owned-payload', root: TARGET, appId: policy.appId, productProofSha256: policy.existingProductProofSha256,
      identityVerified: true, mainExecutableSha256: H('old-owned-executable') },
    installer: { appId: policy.appId, sha256: policy.installer.sha256, releaseReceiptSha256: policy.installer.releaseReceiptSha256,
      runtimeSealSha256: policy.installer.runtimeSealSha256, identityVerified: true, runtimeGateVerified: true },
    data: [{ root: DATA, complete: true, entries, backup: { path: BACKUP, sha256: H('consistent-backup'),
      inventorySha256: windowsInstallRepairInventoryDigest(entries) } }],
    activeWorkers: 0, sqliteState: 'closed-consistent',
  }
  return { policy, snapshot, selected }
}
function ready() {
  const input = fixture()
  const result = createWindowsInstallRepairPreflight(input.policy, input.snapshot, input.selected, NOW)
  expect(result.kind).toBe('preflight-candidate')
  if (result.kind !== 'preflight-candidate') throw Error('fixture preflight failed')
  return { ...input, plan: result.plan }
}
function receiptFixture() {
  const input = ready()
  const before = structuredClone(input.snapshot)
  before.collectionId = 'fixture-collection-2'; before.observedAtMs = NOW + 1
  const after = structuredClone(before)
  after.collectionId = 'fixture-collection-3'; after.observedAtMs = NOW + 3
  const row = after.registry.find(row => row.scope === input.selected.scope && row.view === input.selected.view)!
  row.installLocation = TARGET
  const expected = registrationValues(TARGET, input.selected)
  row.installValues = expected.install; row.uninstallValues = expected.uninstallation
  bindValues(row)
  after.paths.find(path => path.path === TARGET + '\\' + EXE)!.sha256 = input.policy.installer.mainExecutableSha256
  after.product = { kind: 'owned-payload', root: TARGET, appId: input.policy.appId, identityVerified: true,
    productProofSha256: input.policy.installer.releaseReceiptSha256, mainExecutableSha256: input.policy.installer.mainExecutableSha256 }
  const receipt: WindowsInstallRepairReceipt = { protocol: CAPABILITY, planSha256: input.plan.planSha256,
    appId: input.policy.appId, target: TARGET, ...input.selected, steps: [...input.plan.steps],
    collectorEvidenceSha256: H('synthetic-executor-observation-not-VM-proof'),
    oldUninstallerExecutions: 0, foreignPathMutations: 0, registrationMutatedBeforeVerification: false,
    committedInstallValuesSha256: row.installValuesSha256!, committedUninstallValuesSha256: row.uninstallValuesSha256!,
    committedRegistrySha256: row.rawValuesSha256!, completedAtMs: NOW + 3 }
  return { ...input, before, after, receipt }
}
function blocked(mutate: (input: ReturnType<typeof fixture>) => void, reason?: string) {
  const input = fixture(); mutate(input)
  const result = createWindowsInstallRepairPreflight(input.policy, input.snapshot, input.selected, NOW)
  expect(result.kind).toBe('blocked')
  expect(result.executionAuthorized).toBe(false)
  if (reason && result.kind === 'blocked') expect(result.reason).toBe(reason)
}
function rejectReceipt(mutate: (input: ReturnType<typeof receiptFixture>) => void) {
  const input = receiptFixture(); mutate(input)
  expect(() => verifyWindowsInstallRepairReceipt(input.policy, input.plan, input.before, input.after, input.receipt, NOW + 4)).toThrow('WINDOWS_INSTALL_REPAIR_INVALID')
}
describe('explicit Windows repair pure preflight', () => {
  it.each(['per-user', 'all-users'] as const)('keeps %s and each exact registry view without execution grant', scope => {
    for (const view of ['32', '64'] as const) {
      const input = fixture({ scope, view })
      const original = structuredClone(input)
      const result = createWindowsInstallRepairPreflight(input.policy, input.snapshot, input.selected, NOW)
      expect(result.kind).toBe('preflight-candidate')
      if (result.kind !== 'preflight-candidate') throw Error('not a candidate')
      expect(result.plan.target).toBe('D:\\Program Files\\RT-ResearchFlow')
      expect([result.plan.scope, result.plan.view]).toEqual([scope, view])
      expect(result.plan.protectedPaths.find(path => path.path === OLD)).toEqual(input.snapshot.paths.find(path => path.path === OLD))
      expect(result.executionAuthorized).toBe(false)
      expect(result.plan.executionAuthorized).toBe(false)
      expect(input).toEqual(original)
      expect(result.plan).not.toHaveProperty('uninstallString')
      expect(result.plan).not.toHaveProperty('command')
    }
  })
  it('blocks current missing installer capability even with all other evidence', () => {
    blocked(input => { input.policy.capability = null }, 'installer-repair-capability-missing')
  })
  it.each(['raw-string', 'wrong-version', 'wrong-app', 'wrong-installer', 'wrong-review'])('does not grant capability from %s', value => {
    blocked(input => {
      if (value === 'raw-string') (input.policy as any).capability = CAPABILITY
      if (value === 'wrong-version') (input.policy.capability as any).protocol = 'rt-windows-install-explicit-repair-v2'
      if (value === 'wrong-app') input.policy.capability!.appId = 'foreign'
      if (value === 'wrong-installer') input.policy.capability!.installerSha256 = H('foreign')
      if (value === 'wrong-review') input.policy.capability!.reviewSha256 = H('foreign')
    })
  })
  it.each(['D:Program', 'D:\\Program\\..\\Program', 'D:\\Program ', '\\\\server\\share\\Program', '\\\\?\\D:\\Program',
    'D:\\Program:stream', 'D:\\NUL', 'D:\\Program.'])('blocks unsafe old path %s', path => {
    blocked(input => { input.snapshot.registry.find(row => row.state === 'present')!.installLocation = path })
  })
  it.each(['missing', 'file', 'reparse', 'unreadable'] as const)('does not invent target ownership for %s target', kind => {
    blocked(input => { input.snapshot.paths.find(path => path.path === TARGET)!.kind = kind })
  })
  it('requires independent same-product evidence, not the corrupted key alone', () => {
    blocked(input => { input.snapshot.product = null }, 'independent-product-evidence-missing')
  })
  it('rejects a foreign product at the canonical target', () => {
    blocked(input => { input.snapshot.product!.appId = 'foreign' })
  })
  it('accepts only a trusted recovery proof for an existing canonical directory', () => {
    const input = fixture()
    input.snapshot.product = { kind: 'verified-recovery-manifest', root: TARGET, appId: input.policy.appId,
      productProofSha256: input.policy.existingProductProofSha256, identityVerified: true }
    expect(createWindowsInstallRepairPreflight(input.policy, input.snapshot, input.selected, NOW).kind).toBe('preflight-candidate')
    input.snapshot.product.productProofSha256 = H('untrusted-backup')
    expect(createWindowsInstallRepairPreflight(input.policy, input.snapshot, input.selected, NOW).kind).toBe('blocked')
  })
  it.each(['other-scope', 'other-view'])('blocks duplicate product records in %s', choice => {
    blocked(input => {
      const row = input.snapshot.registry.find(row => choice === 'other-scope' ? row.scope === 'per-user' && row.view === '64' : row.scope === 'all-users' && row.view === '32')!
      row.state = 'present'; row.installLocation = OLD
      row.installKeyState = 'present'; row.uninstallKeyState = 'present'
      const values = registrationValues(OLD, row)
      row.installValues = values.install
      row.uninstallValues = values.uninstallation
      bindValues(row)
    }, 'ambiguous-installation-records')
  })
  it.each(['missing-slot', 'unreadable-slot', 'wrong-key', 'wrong-install-key', 'missing-install-digest', 'changed-uninstall-digest',
    'install-only', 'uninstall-only', 'hidden-present-install', 'hidden-present-uninstall', 'unknown-install-key',
    'scope-switch', 'view-switch'])('blocks incomplete or changed registry selection %s', value => {
    blocked(input => {
      if (value === 'missing-slot') input.snapshot.registry.pop()
      if (value === 'unreadable-slot') input.snapshot.registry[0].state = 'unreadable'
      if (value === 'wrong-key') input.snapshot.registry[0].uninstallKey += '-foreign'
      if (value === 'wrong-install-key') input.snapshot.registry[0].installKey += '-foreign'
      if (value === 'missing-install-digest') delete input.snapshot.registry.find(row => row.state === 'present')!.installValuesSha256
      if (value === 'changed-uninstall-digest') input.snapshot.registry.find(row => row.state === 'present')!.uninstallValuesSha256 = H('changed-uninstall')
      if (value === 'install-only') input.snapshot.registry.find(row => row.state === 'present')!.uninstallKeyState = 'absent'
      if (value === 'uninstall-only') input.snapshot.registry.find(row => row.state === 'present')!.installKeyState = 'absent'
      if (value === 'hidden-present-install') input.snapshot.registry.find(row => row.state === 'absent')!.installKeyState = 'present'
      if (value === 'hidden-present-uninstall') input.snapshot.registry.find(row => row.state === 'absent')!.uninstallKeyState = 'present'
      if (value === 'unknown-install-key') input.snapshot.registry.find(row => row.state === 'present')!.installKeyState = 'unreadable'
      if (value === 'scope-switch') input.selected.scope = 'per-user'
      if (value === 'view-switch') input.selected.view = '32'
    })
  })
  it.each(['D:\\', 'D:\\Program Files'])('rejects an unsafe ancestor %s', path => {
    blocked(input => { input.snapshot.paths.find(item => item.path === path)!.kind = 'reparse' })
  })
  it.each(['workers', 'sqlite', 'wal', 'partial', 'backup', 'root'])('blocks unproved data consistency %s', value => {
    blocked(input => {
      if (value === 'workers') input.snapshot.activeWorkers = 1
      if (value === 'sqlite') input.snapshot.sqliteState = 'open-or-wal-active'
      if (value === 'wal') input.snapshot.data[0].entries.push({ path: 'trade.db-wal', kind: 'file', size: 1, sha256: H('wal') })
      if (value === 'partial') (input.snapshot.data[0] as any).complete = false
      if (value === 'backup') input.snapshot.data[0].backup.inventorySha256 = H('not-the-inventory')
      if (value === 'root') input.policy.dataRoots.push('D:\\UncoveredOtherUser')
    })
  })
  it.each(['identity', 'hash', 'runtime'])('does not bypass new payload verification %s', value => {
    blocked(input => {
      if (value === 'identity') input.snapshot.installer.appId = 'foreign'
      if (value === 'hash') input.snapshot.installer.sha256 = H('tampered-installer')
      if (value === 'runtime') (input.snapshot.installer as any).runtimeGateVerified = false
    })
  })
  it.each(['D', 'C'])('delegates a healthy %s install unchanged to normal all-scopes guards', drive => {
    const input = fixture()
    const path = drive + ':\\Program Files\\RT-ResearchFlow'
    input.snapshot.registry.find(row => row.state === 'present')!.installLocation = path
    const row = input.snapshot.registry.find(row => row.state === 'present')!
    const values = registrationValues(path, input.selected)
    row.installValues = values.install; row.uninstallValues = values.uninstallation; bindValues(row)
    if (drive === 'C') {
      input.snapshot.paths.push({ path: 'C:\\', kind: 'directory', fileId: 'C-root' },
        { path: 'C:\\Program Files', kind: 'directory', fileId: 'C-program-files' },
        { path, kind: 'directory', fileId: 'C-app' },
        { path: path + '\\' + EXE, kind: 'file', fileId: 'C-exe', size: 100, sha256: H('old-owned-executable') })
      input.snapshot.product!.root = path
    }
    const result = createWindowsInstallRepairPreflight(input.policy, input.snapshot, input.selected, NOW)
    expect(result).toEqual({ kind: 'delegate-normal-upgrade', target: path, ...input.selected,
      useExistingAllScopesGuards: true, executionAuthorized: false })
  })
})
describe('repair plans and receipts are bindings, never execution tokens', () => {
  it('requires a fresh recollection of unchanged facts before consuming a plan', () => {
    const { policy, snapshot, plan } = ready()
    expect(() => revalidateWindowsInstallRepairPlan(policy, plan, snapshot, NOW + 1)).toThrow('fresh-recollection-required')
    const fresh = structuredClone(snapshot); fresh.collectionId = 'recollected'; fresh.observedAtMs = NOW + 1
    expect(() => revalidateWindowsInstallRepairPlan(policy, plan, fresh, NOW + 2)).not.toThrow()
    fresh.paths.find(path => path.path === OLD)!.sha256 = H('foreign-file-changed')
    expect(() => revalidateWindowsInstallRepairPlan(policy, plan, fresh, NOW + 2)).toThrow('revalidation-failed')
  })
  it('rejects expiration, altered plan and changed policy', () => {
    const { policy, snapshot, plan } = ready()
    const fresh = structuredClone(snapshot); fresh.collectionId = 'recollected'; fresh.observedAtMs = NOW + 1
    expect(() => revalidateWindowsInstallRepairPlan(policy, plan, fresh, NOW + 300001)).toThrow()
    expect(() => revalidateWindowsInstallRepairPlan(policy, { ...plan, target: 'C:\\Other' } as any, fresh, NOW + 2)).toThrow()
    policy.installer.sha256 = H('new-policy')
    expect(() => revalidateWindowsInstallRepairPlan(policy, plan, fresh, NOW + 2)).toThrow()
  })
  it('checks a synthetic receipt without claiming real execution or all users coverage', () => {
    const input = receiptFixture()
    const result = verifyWindowsInstallRepairReceipt(input.policy, input.plan, input.before, input.after, input.receipt, NOW + 4)
    expect(result).toEqual({ kind: 'structurally-verified-repair-receipt', executionAuthorized: false,
      processEffectsIndependentlyProved: false, dataRootsVerified: [DATA] })
  })
  it('rejects unchanged old two-key values even when receipt repeats the old digests', () => {
    rejectReceipt(input => {
      const before = input.before.registry.find(row => row.state === 'present')!
      const after = input.after.registry.find(row => row.state === 'present')!
      after.installValues = structuredClone(before.installValues)
      after.uninstallValues = structuredClone(before.uninstallValues)
      bindValues(after)
      input.receipt.committedInstallValuesSha256 = after.installValuesSha256!
      input.receipt.committedUninstallValuesSha256 = after.uninstallValuesSha256!
      input.receipt.committedRegistrySha256 = after.rawValuesSha256!
    })
  })
  it.each(['UninstallString', 'QuietUninstallString', 'DisplayIcon', 'DisplayVersion'])('rejects correct InstallLocation but bad %s even with recomputed key/receipt digests', name => {
    rejectReceipt(input => {
      const before = input.before.registry.find(row => row.state === 'present')!
      const after = input.after.registry.find(row => row.state === 'present')!
      after.uninstallValues!.find(value => value.name === name)!.data = name === 'DisplayVersion'
        ? '1.6.0' : before.uninstallValues!.find(value => value.name === name)!.data
      bindValues(after)
      input.receipt.committedInstallValuesSha256 = after.installValuesSha256!
      input.receipt.committedUninstallValuesSha256 = after.uninstallValuesSha256!
      input.receipt.committedRegistrySha256 = after.rawValuesSha256!
    })
  })
  it('rejects detached InstallLocation even when a typed-values digest is genuine', () => {
    blocked(input => { input.snapshot.registry.find(row => row.state === 'present')!.installLocation = TARGET }, 'detached-install-location')
  })
  it.each(['REG_DWORD', 'REG_BINARY', 'REG_QWORD', 'REG_MULTI_SZ'])('rejects invalid typed registry data for %s', type => {
    expect(() => windowsInstallRepairTypedValuesDigest([{ name: 'fixture', type, data: true } as any])).toThrow('invalid-typed-registry-values')
  })
  it('rejects case-colliding registry names instead of selecting one detached value', () => {
    expect(() => windowsInstallRepairTypedValuesDigest([
      { name: 'InstallLocation', type: 'REG_SZ', data: TARGET },
      { name: 'installlocation', type: 'REG_SZ', data: OLD },
    ])).toThrow('duplicate-registry-value')
  })
  it.each(['old-exec', 'foreign-write', 'early-registry', 'order', 'wrong-app', 'wrong-scope', 'wrong-view', 'wrong-target',
    'missing-observation', 'other-key', 'install-key-values', 'uninstall-key-values', 'data', 'backup', 'foreign-file',
    'foreign-file-id', 'payload', 'runtime', 'stale-post'])('rejects receipt inconsistency %s', value => {
    rejectReceipt(input => {
      if (value === 'old-exec') input.receipt.oldUninstallerExecutions = 1
      if (value === 'foreign-write') input.receipt.foreignPathMutations = 1
      if (value === 'early-registry') input.receipt.registrationMutatedBeforeVerification = true
      if (value === 'order') input.receipt.steps.reverse()
      if (value === 'wrong-app') input.receipt.appId = 'foreign'
      if (value === 'wrong-scope') input.receipt.scope = 'per-user'
      if (value === 'wrong-view') input.receipt.view = '32'
      if (value === 'wrong-target') input.receipt.target = 'C:\\Other'
      if (value === 'missing-observation') input.receipt.collectorEvidenceSha256 = ''
      if (value === 'install-key-values') input.receipt.committedInstallValuesSha256 = H('different-install-values')
      if (value === 'uninstall-key-values') input.receipt.committedUninstallValuesSha256 = H('different-uninstall-values')
      if (value === 'other-key') {
        input.after.registry[0].state = 'present'; input.after.registry[0].installLocation = TARGET; input.after.registry[0].rawValuesSha256 = H('duplicate')
        input.after.registry[0].installKeyState = 'present'; input.after.registry[0].uninstallKeyState = 'present'
      }
      if (value === 'data') input.after.data[0].entries[0].sha256 = H('changed-user-db')
      if (value === 'backup') input.after.paths.find(path => path.path === BACKUP)!.sha256 = H('changed-backup')
      if (value === 'foreign-file') input.after.paths.find(path => path.path === OLD)!.sha256 = H('changed-foreign-file')
      if (value === 'foreign-file-id') input.after.paths.find(path => path.path === OLD)!.fileId = 'replacement-file'
      if (value === 'payload') input.after.product!.mainExecutableSha256 = H('wrong-new-executable')
      if (value === 'runtime') input.after.installer.runtimeSealSha256 = H('wrong-runtime-seal')
      if (value === 'stale-post') input.after.observedAtMs = NOW - 1
    })
  })
  it.each(['../trade.db', 'Trade.DB', 'sub\\file', 'NUL', 'file:stream'])('rejects unsafe or colliding inventory entry %s', path => {
    const input = fixture()
    input.snapshot.data[0].entries.push({ path, kind: 'file', size: 1, sha256: H('extra') })
    expect(() => windowsInstallRepairInventoryDigest(input.snapshot.data[0].entries)).toThrow('invalid-data-inventory')
  })
})
