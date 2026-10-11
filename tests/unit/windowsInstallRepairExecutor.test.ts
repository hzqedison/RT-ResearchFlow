import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { executeWindowsInstallRepairTransaction, executeWindowsRepairNativeJournal, recoverWindowsRepairNativeTransaction } from '../../electron/main/services/windowsInstallRepairExecutor'
import type { WindowsRepairProducerReceipt, WindowsRepairTransactionPorts } from '../../electron/main/services/windowsInstallRepairExecutor'
import {
  DEFAULT_WINDOWS_INSTALL_REPAIR_TARGET as TARGET, WINDOWS_INSTALL_REPAIR_CAPABILITY as CAPABILITY,
  windowsInstallRepairInventoryDigest, windowsInstallRepairTypedValuesDigest as typed, windowsInstallRepairRegistryDigest as pair,
} from '../../electron/main/services/windowsInstallRepairPreflight'
import type { WindowsInstallRepairPolicy, WindowsInstallRepairSnapshot, WindowsRepairTypedRegistryValue } from '../../electron/main/services/windowsInstallRepairPreflight'

const NOW = 1800000000000, EXE = 'RT-ResearchFlow.exe', OLD = 'D:\\Program', DATA = 'D:\\FixtureData'
const H = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex')
function fixture() {
  const keys = generateKeyPairSync('ed25519'), events: string[] = []
  const registration = { scope: 'all-users' as const, view: '64' as const,
    installValues: [{ name: 'InstallLocation', type: 'REG_SZ' as const, data: TARGET }],
    uninstallValues: [{ name: 'UninstallString', type: 'REG_SZ' as const, data: '"' + TARGET + '\\Uninstall RT-ResearchFlow.exe" /allusers' }] }
  const policy: WindowsInstallRepairPolicy = {
    appId: 'org.example.repair-fixture', executableName: EXE, installKey: 'Software\\fixture-guid',
    uninstallKey: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\fixture-key',
    existingProductProofSha256: H('old-product'), dataRoots: [DATA],
    expectedRegistration: { scope: registration.scope, view: registration.view,
      installValuesSha256: typed(registration.installValues), uninstallValuesSha256: typed(registration.uninstallValues) },
    installer: { path: 'D:\\FixtureDownloads\\setup.exe', sha256: H('installer'), releaseReceiptSha256: H('receipt'),
      mainExecutableSha256: H('new-exe'), runtimeSealSha256: H('runtime') },
    capability: { protocol: CAPABILITY, appId: 'org.example.repair-fixture', installerSha256: H('installer'), reviewSha256: H('review') },
    capabilityReviewSha256: H('review'),
  }
  const dir = (path: string) => ({ path, kind: 'directory' as const, fileId: 'fixture:' + path })
  const file = (path: string, sha256: string, size = 100) => ({ path, kind: 'file' as const, fileId: 'fixture:' + path, sha256, size })
  const entries = [{ path: 'trade.db', kind: 'file' as const, sha256: H('untouched-data'), size: 100 }]
  const state: WindowsInstallRepairSnapshot = {
    collectionId: 'initial', observedAtMs: NOW,
    registry: (['per-user', 'all-users'] as const).flatMap(scope => (['32', '64'] as const).map(view => {
      const present = scope === 'all-users' && view === '64'
      const installValues: WindowsRepairTypedRegistryValue[] | null = present ? [{ name: 'InstallLocation', type: 'REG_SZ', data: OLD }] : null
      const uninstallValues: WindowsRepairTypedRegistryValue[] | null = present ? [{ name: 'UninstallString', type: 'REG_SZ', data: 'bad-old-command-never-executed' }] : null
      return { scope, view, installKey: policy.installKey, uninstallKey: policy.uninstallKey,
        state: present ? 'present' as const : 'absent' as const, installKeyState: present ? 'present' as const : 'absent' as const,
        uninstallKeyState: present ? 'present' as const : 'absent' as const, ...(present ? { installLocation: OLD } : {}),
        installValues, uninstallValues, installValuesSha256: typed(installValues), uninstallValuesSha256: typed(uninstallValues),
        rawValuesSha256: pair(typed(installValues), typed(uninstallValues)) }
    })),
    paths: [dir('D:\\'), dir('D:\\Program Files'), dir(TARGET), file(OLD, H('foreign-file'), 1099),
      file(TARGET + '\\' + EXE, H('old-exe')), dir(DATA), dir('D:\\FixtureBackups'), file('D:\\FixtureBackups\\backup.bin', H('backup')),
      dir('D:\\FixtureDownloads'), file(policy.installer.path, policy.installer.sha256)],
    product: { kind: 'owned-payload', root: TARGET, appId: policy.appId, identityVerified: true,
      productProofSha256: policy.existingProductProofSha256, mainExecutableSha256: H('old-exe') },
    installer: { appId: policy.appId, sha256: policy.installer.sha256, releaseReceiptSha256: policy.installer.releaseReceiptSha256,
      runtimeSealSha256: policy.installer.runtimeSealSha256, identityVerified: true, runtimeGateVerified: true },
    data: [{ root: DATA, complete: true, entries, backup: { path: 'D:\\FixtureBackups\\backup.bin', sha256: H('backup'), inventorySha256: windowsInstallRepairInventoryDigest(entries) } }],
    activeWorkers: 0, sqliteState: 'closed-consistent',
  }
  const receipt: WindowsRepairProducerReceipt = { schemaVersion: 1, kind: 'rt-windows-repair-producer-v1',
    repository: 'fixture/repository', sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), workflow: 'fixture/workflow', runId: '123',
    artifactSha256: policy.installer.sha256, policy, registration, programMembers: [EXE, 'resources/private-python-runtime/manifest.json'] }
  const bytes = Buffer.from(JSON.stringify(receipt)), signature = sign(null, bytes, keys.privateKey)
  const trust = { publicKey: keys.publicKey, producerReceiptSha256: H(bytes), repository: receipt.repository, sourceCommit: receipt.sourceCommit,
    sourceTree: receipt.sourceTree, workflow: receipt.workflow, runId: receipt.runId, appId: policy.appId,
    installerSha256: policy.installer.sha256, capabilityReviewSha256: policy.capabilityReviewSha256! }
  let counter = 0
  // Trusted-host operations below are SYNTHETIC observations, not registry or
  // installer effects. This demonstrates real orchestration/ordering, not a
  // completed privileged Windows implementation or approved producer identity.
  const ports: WindowsRepairTransactionPorts = {
    async validateNewPayload() { events.push('validate') },
    async collect() { events.push('collect'); return { ...structuredClone(state), collectionId: 'fresh-' + ++counter } },
    async authorizeExplicitRepair() { events.push('consent'); return true },
    async applyVerifiedProgramPayload(value) {
      events.push('apply')
      state.paths.find(row => row.path === TARGET + '\\' + EXE)!.sha256 = policy.installer.mainExecutableSha256
      state.product = { kind: 'owned-payload', root: TARGET, appId: policy.appId, identityVerified: true,
        productProofSha256: policy.installer.releaseReceiptSha256, mainExecutableSha256: policy.installer.mainExecutableSha256 }
      return { writtenMembers: value.programMembers, evidence: Buffer.from('synthetic-owned-stage') }
    },
    async commitRegistration(value) {
      events.push('commit')
      const row = state.registry[3]
      row.installLocation = TARGET; row.installValues = value.registration.installValues; row.uninstallValues = value.registration.uninstallValues
      row.installValuesSha256 = typed(row.installValues); row.uninstallValuesSha256 = typed(row.uninstallValues)
      row.rawValuesSha256 = pair(row.installValuesSha256, row.uninstallValuesSha256)
      return Buffer.from('synthetic-atomic-commit')
    },
  }
  const run = () => executeWindowsInstallRepairTransaction(trust, bytes, signature, ports, () => NOW)
  return { keys, receipt, bytes, signature, trust, ports, state, events, run }
}
describe('signed producer repair transaction orchestration, never a production grant', () => {
  it('executes verification, fresh recollection, owned payload then registration in order', async () => {
    const f = fixture(), before = structuredClone(f.state.data), foreign = structuredClone(f.state.paths.find(row => row.path === OLD))
    const result = await f.run()
    expect(f.events).toEqual(['validate', 'collect', 'consent', 'collect', 'validate', 'apply', 'collect', 'commit', 'collect'])
    expect(f.state.data).toEqual(before); expect(f.state.paths.find(row => row.path === OLD)).toEqual(foreign)
    expect(result.checked.executionAuthorized).toBe(false); expect(result.nativeEffectsIndependentlyAccepted).toBe(false)
  })
  it.each(['bytes', 'signature', 'source', 'tree', 'run', 'installer', 'review'])('rejects untrusted %s before host effects', async kind => {
    const f = fixture()
    if (kind === 'bytes') f.bytes[0] ^= 1
    if (kind === 'signature') f.signature[0] ^= 1
    if (kind === 'source') f.trust.sourceCommit = 'c'.repeat(40)
    if (kind === 'tree') f.trust.sourceTree = 'c'.repeat(40)
    if (kind === 'run') f.trust.runId = '999'
    if (kind === 'installer') f.trust.installerSha256 = H('wrong')
    if (kind === 'review') f.trust.capabilityReviewSha256 = H('wrong')
    await expect(f.run()).rejects.toThrow(); expect(f.events).toEqual([])
  })
  it('requires explicit consent and does not write on refusal', async () => {
    const f = fixture(); f.ports.authorizeExplicitRepair = async () => false
    await expect(f.run()).rejects.toThrow('explicit-consent'); expect(f.events).not.toContain('apply')
  })
  it.each(['non-string', 'data', 'backup', 'wrong-target'])('rejects signed %s before payload write', async kind => {
    const f = fixture()
    if (kind === 'non-string') (f.receipt.programMembers as unknown[])[0] = 7
    if (kind === 'data') f.receipt.programMembers.push('data/trade.db')
    if (kind === 'backup') f.receipt.programMembers.push('resources/backups/backup.bin')
    if (kind === 'wrong-target') {
      f.receipt.registration.installValues[0].data = 'D:\\Program'
      f.receipt.policy.expectedRegistration!.installValuesSha256 = typed(f.receipt.registration.installValues)
    }
    const bytes = Buffer.from(JSON.stringify(f.receipt)), signature = sign(null, bytes, f.keys.privateKey)
    f.trust.producerReceiptSha256 = H(bytes)
    await expect(executeWindowsInstallRepairTransaction(f.trust, bytes, signature, f.ports, () => NOW)).rejects.toThrow()
    expect(f.events).not.toContain('apply'); expect(f.events).not.toContain('commit')
  })
  it('protects data subtrees without treating data2 as data or the installation parent as forbidden', async () => {
    const f = fixture(); f.receipt.programMembers.push('resources/data2/value.bin')
    const bytes = Buffer.from(JSON.stringify(f.receipt)), signature = sign(null, bytes, f.keys.privateKey)
    f.trust.producerReceiptSha256 = H(bytes)
    await expect(executeWindowsInstallRepairTransaction(f.trust, bytes, signature, f.ports, () => NOW)).resolves.toMatchObject({ kind: 'repair-transaction-observed' })
  })
  it.each(['foreign', 'data', 'registry', 'sqlite', 'missing-payload', 'unexpected-write'])('does not commit on %s change', async kind => {
    const f = fixture(), apply = f.ports.applyVerifiedProgramPayload
    f.ports.applyVerifiedProgramPayload = async (...args) => {
      const result = await apply(...args)
      if (kind === 'foreign') f.state.paths.find(row => row.path === OLD)!.sha256 = H('changed')
      if (kind === 'data') f.state.data[0].entries[0].sha256 = H('changed')
      if (kind === 'registry') f.state.registry[3].installValuesSha256 = H('early-commit')
      if (kind === 'sqlite') f.state.sqliteState = 'open-or-wal-active'
      if (kind === 'missing-payload') f.state.product!.mainExecutableSha256 = H('wrong')
      if (kind === 'unexpected-write') result.writtenMembers = ['../foreign']
      return result
    }
    await expect(f.run()).rejects.toThrow(); expect(f.events).not.toContain('commit')
  })
  it('recollects changed facts after consent before any payload write', async () => {
    const f = fixture(); f.ports.authorizeExplicitRepair = async () => { f.state.paths.find(row => row.path === OLD)!.fileId = 'replacement'; return true }
    await expect(f.run()).rejects.toThrow(); expect(f.events).not.toContain('apply')
  })
  it('fails closed if commit disagrees with the independently signed typed registration', async () => {
    const f = fixture(), commit = f.ports.commitRegistration
    f.ports.commitRegistration = async (...args) => { const result = await commit(...args); f.state.registry[3].uninstallValuesSha256 = H('wrong'); return result }
    await expect(f.run()).rejects.toThrow()
    expect(Object.keys(f.ports)).not.toContain('runOldUninstaller')
  })
})

describe('native executor requires a branded consumer capability before any port effects', () => {
  it.each(['execute', 'recover'])('rejects JSON authority on %s with zero native invocation', async kind => {
    let calls = 0
    const ports = { run: async () => { calls++; return Buffer.alloc(0) },
      assertJournalProtected: async () => { calls++ }, assertProtectedFactsUnchanged: async () => { calls++ },
      verifyProgramStage: async () => { calls++ }, verifyComplete: async () => { calls++ } }
    const options = { hostPath: 'D:\\fixture-host.ps1', systemRoot: 'C:\\Windows', journalName: '0'.repeat(32) + '.journal', ports }
    if (kind === 'execute') await expect(executeWindowsRepairNativeJournal({ kind: 'rt-windows-repair-native-context-v1' } as any, options)).rejects.toThrow()
    else await expect(recoverWindowsRepairNativeTransaction({ kind: 'rt-windows-repair-native-context-v1' } as any, options, [])).rejects.toThrow()
    expect(calls).toBe(0)
  })
})
