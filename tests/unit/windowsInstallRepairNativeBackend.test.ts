import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, win32 } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { verifyWindowsRepairDetachedArtifacts, bindWindowsRepairRuntimeSession } from '../../electron/main/services/windowsInstallRepairConsumer'
import type { CompiledRepairTrust, ObservedRepairArtifacts } from '../../electron/main/services/windowsInstallRepairConsumer'
import { verifyWindowsRepairPlanCapability } from '../../electron/main/services/windowsInstallRepairPlanCapability'
import { createWindowsInstallRepairPreflight, windowsInstallRepairTypedValuesDigest as typed, windowsInstallRepairRegistryDigest as pair } from '../../electron/main/services/windowsInstallRepairPreflight'
import { windowsRepairEvidenceFixture } from './fixtures/windowsInstallRepairEvidence'
import { bindWindowsRepairNativeBackend, requireWindowsRepairNativeAuthority, prepareWindowsRepairNativeMutations,
  createWindowsRepairNativeJournalHost, windowsRepairNativeJournalBinding, windowsRepairNativeRecoveryInvocation } from '../../electron/main/services/windowsInstallRepairNativeBackend'
import type { WindowsRepairNativeFileImage, WindowsRepairNativeJournalPorts } from '../../electron/main/services/windowsInstallRepairNativeBackend'
import { executeWindowsRepairNativeJournal, recoverWindowsRepairNativeTransaction, recoverWindowsRepairNativeJournal } from '../../electron/main/services/windowsInstallRepairExecutor'
import { WindowsRepairDurableJournal, recoverWindowsRepairJournal } from '../../electron/main/services/windowsInstallRepairRecovery'

const H = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex')
const hostPath = resolve(__dirname, '../../resources/windows-install-repair-native-host.ps1')
function detachedFixture() {
  const keys = generateKeyPairSync('ed25519')
  const trust: CompiledRepairTrust = {
    issuerKeys: { 'fixture-issuer': keys.publicKey }, signingPurpose: 'rt-windows-repair-final-artifacts-v1',
    appId: 'fixture.app', appGuid: '11111111-2222-3333-4444-555555555555', version: '1.7.0', channel: 'stable',
    platform: 'win32', arch: 'x64', target: 'D:\\Program Files\\RT-ResearchFlow',
    registryInstallKey: 'Software\\fixture-app', registryUninstallKey: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\fixture-app',
    allowedScopeViews: ['per-user:64', 'all-users:64'],
  }
  const observed: ObservedRepairArtifacts = {
    installer: Buffer.from('installer'),
    components: { consumer: Buffer.from('consumer'), privateNode: Buffer.from('private node'),
      nativeHost: readFileSync(hostPath), jobHost: Buffer.from('job host') },
    programFiles: [{ relativePath: 'RT-ResearchFlow.exe', bytes: Buffer.from('fixture-exe') },
      { relativePath: 'Uninstall RT-ResearchFlow.exe', bytes: Buffer.from('new uninstaller') }],
    runtimeSeal: Buffer.from('runtime-seal'),
  }
  const fact = (bytes: Uint8Array) => ({ sha256: H(bytes), size: bytes.byteLength })
  const receipt = {
    schemaVersion: 1, kind: 'rt-windows-repair-artifacts-v1', signingPurpose: trust.signingPurpose,
    issuerKeyId: 'fixture-issuer', appId: trust.appId, version: trust.version, channel: trust.channel,
    platform: trust.platform, arch: trust.arch, sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40),
    producerWorkflow: 'fixture-release', producerRunId: '123', producerRunAttempt: 1,
    installer: fact(observed.installer),
    components: Object.fromEntries(Object.entries(observed.components).map(([name, bytes]) => [name, fact(bytes)])),
    programInventory: observed.programFiles.map(item => ({ relativePath: item.relativePath, ...fact(item.bytes) })),
    registeredUninstallerRelativePath: 'Uninstall RT-ResearchFlow.exe', runtimeSeal: fact(observed.runtimeSeal),
  }
  const verifyReceipt = (value: unknown = receipt, raw?: Uint8Array, observedBytes = observed, compiledTrust = trust) => {
    const bytes = raw ?? Buffer.from(JSON.stringify(value))
    return verifyWindowsRepairDetachedArtifacts(compiledTrust, bytes, sign(null, bytes, keys.privateKey), observedBytes)
  }
  return { trust, observed, receipt, verifyReceipt }
}


function runtimeSessionFixture(scope: 'per-user' | 'all-users' = 'all-users') {
  const f = detachedFixture(), artifacts = f.verifyReceipt()
  const evidence = windowsRepairEvidenceFixture()
  const policy = structuredClone(evidence.policy)
  policy.expectedRegistration!.scope = scope
  policy.installer.releaseReceiptSha256 = artifacts.receiptSha256
  const initial = structuredClone(evidence.current)
  if (scope === 'per-user') {
    const old = structuredClone(initial.registry.find(row => row.state === 'present')!)
    initial.registry = initial.registry.map(row => row.scope === 'per-user' && row.view === '64' ?
      { ...old, scope: row.scope, view: row.view } : row.scope === 'all-users' && row.view === '64' ?
      { ...row, state: 'absent', installKeyState: 'absent', uninstallKeyState: 'absent', installLocation: undefined,
        installValues: null, uninstallValues: null, installValuesSha256: typed(null), uninstallValuesSha256: typed(null),
        rawValuesSha256: pair(typed(null), typed(null)) } : row)
  }
  initial.collectionId = 'session-initial'
  initial.observedAtMs = Date.now() - 20
  initial.installer.releaseReceiptSha256 = artifacts.receiptSha256
  const preflight = createWindowsInstallRepairPreflight(policy, initial, { scope, view: '64' }, initial.observedAtMs)
  if (preflight.kind !== 'preflight-candidate') throw new Error('SYNTHETIC_SESSION_PREFLIGHT')
  const current = structuredClone(initial)
  current.collectionId = 'session-fresh'
  current.observedAtMs = Date.now()
  const verifiedPlan = verifyWindowsRepairPlanCapability(policy, preflight.plan, current)
  const observed = {
    launch: { consumerSha256: artifacts.receipt.components.consumer.sha256,
      directParentImageSha256: artifacts.receipt.installer.sha256, directParentRunning: true,
      directParentRepairIntent: true, selectedScope: scope,
      selectedTarget: f.trust.target, currentUserSid: 'S-1-5-21-100-200-300-1001',
      elevated: true, explicitConsentObserved: true, nonce: Buffer.alloc(32, 7) },
    payloadRoot: 'D:\\FixturePayload', journalRoot: 'D:\\FixtureJournal',
  }
  return { ...f, artifacts, verifiedPlan, observed }
}



// Real temporary durable journal; OS keys, launch facts and collector callbacks
// below are synthetic ports. No installer, real registry, DB or DProgram access.
function fixture(scope: 'per-user' | 'all-users' = 'all-users') {
  const f = runtimeSessionFixture(scope), root = mkdtempSync(join(tmpdir(), 'rt-native-journal-'))
  f.observed.journalRoot = root
  const session = bindWindowsRepairRuntimeSession(f.artifacts, f.verifiedPlan, f.observed)
  const registration = windowsRepairEvidenceFixture().registration
  const authority = bindWindowsRepairNativeBackend(f.artifacts, session, f.verifiedPlan, registration)
  const files = new Map<string, WindowsRepairNativeFileImage>(), events: string[] = []
  let identity = 1, fault: string | null = null, unknown = false, completeFailure = false, stageFailure = false
  const makeId = () => 'win32:00000001:00000000:' + (++identity).toString(16).padStart(8, '0')
  for (const member of authority.roots.programFiles) {
    files.set(win32.join(authority.roots.target, member.path), { identity: makeId(), size: '9', sha256: H('old:' + member.path) })
    files.set(win32.join(authority.roots.payloadRoot, member.path), { identity: makeId(), size: String(member.size), sha256: member.sha256 })
  }
  const old = authority.beforeRegistry.find(row => row.scope === scope && row.view === '64')!
  const keys = new Map<string, any>([['install', { state: old.installKeyState, values: structuredClone(old.installValues), children: [] }],
    ['uninstall', { state: old.uninstallKeyState, values: structuredClone(old.uninstallValues), children: [] }]])
  const originalKeys = structuredClone(keys), originalFiles = structuredClone(files)
  const absent = () => ({ identity: 'absent', size: '0', sha256: '' })
  const ports: WindowsRepairNativeJournalPorts = {
    async assertJournalProtected(path) { expect(path === root || win32.dirname(path) === root).toBe(true) },
    async assertProtectedFactsUnchanged() { /* Synthetic unchanged ACL/data/foreign facts, not native attestation. */ },
    async verifyProgramStage() {
      events.push('stage')
      expect(keys).toEqual(originalKeys)
      if (stageFailure) throw new Error('stage-failed')
      for (const member of authority.roots.programFiles) expect(files.get(win32.join(authority.roots.target, member.path))!.sha256).toBe(member.sha256)
    },
    async verifyComplete() {
      events.push('complete')
      if (completeFailure) throw new Error('complete-failed')
      expect(keys.get('install').values).toEqual(registration.installValues)
      expect(keys.get('uninstall').values).toEqual(registration.uninstallValues)
    },
    async run(spec) {
      const body = JSON.parse(JSON.parse(Buffer.from(spec.input).toString('utf8')).payload)
      expect(spec.shell).toBe(false)
      let result: unknown
      if (body.operation === 'inspect-file') result = files.get(body.target) ?? absent()
      else if (body.operation === 'write-file') {
        const before = files.get(body.target) ?? absent(), source = files.get(body.source)!
        expect(before.identity).toBe(body.beforeId)
        if (before.identity !== 'absent') expect(before.sha256).toBe(body.beforeSha256)
        expect(source.sha256).toBe(body.nextSha256); expect(source.size).toBe(String(body.nextSize)); expect(files.has(body.backup)).toBe(false)
        files.set(body.backup, { ...before, identity: makeId() })
        const after = { identity: before.identity === 'absent' ? makeId() : before.identity, size: source.size, sha256: source.sha256 }
        files.set(body.target, after); events.push('write:' + body.target)
        if (fault === body.target) { if (unknown) files.set(body.target, { ...after, sha256: H('unknown-partial') }); throw new Error('after-write-child-failed') }
        result = after
      } else if (body.operation === 'delete-owned-file') {
        const before = files.get(body.target)!
        expect(before.identity).toBe(body.beforeId); expect(before.sha256).toBe(body.beforeSha256)
        files.delete(body.target); events.push('delete:' + body.target); result = absent()
      } else if (body.operation === 'read-registry') result = keys.get(body.selectedKey)
      else if (body.operation === 'write-registry') {
        expect(body.scope).toBe(scope); expect(body.view).toBe('64')
        expect(keys.get(body.selectedKey)).toEqual(body.expected)
        keys.set(body.selectedKey, structuredClone(body.next)); events.push('key:' + body.selectedKey)
        if (fault === body.selectedKey) { fault = null; throw new Error('after-write-key-failed') }
        result = body.next
      } else throw new Error('unsupported-native-operation')
      return Buffer.from(JSON.stringify(result))
    },
  }
  const options = { hostPath, systemRoot: 'C:\\Windows', journalName: randomBytes(16).toString('hex') + '.journal', ports }
  return { authority, f, session, registration, root, options, ports, files, keys, events, originalKeys, originalFiles,
    failKey() { fault = 'uninstall' }, failFile(partial: boolean) { fault = win32.join(authority.roots.target, authority.roots.programFiles[0].path); unknown = partial },
    failComplete() { completeFailure = true }, failStage() { stageFailure = true },
    close() { const allowed = resolve(tmpdir()) + win32.sep
      if (!resolve(root).toLowerCase().startsWith(allowed.toLowerCase()) || !root.includes('rt-native-journal-')) throw new Error('UNSAFE_FIXTURE_CLEANUP')
      rmSync(root, { recursive: true, force: true }) },
  }
}

describe.runIf(process.platform === 'win32')('detached-authorized native port journal integration, synthetic OS seams only', () => {
  it('refuses missing original journal instead of fabricating a rollback', async () => {
    const f = fixture()
    try {
      const operations = await prepareWindowsRepairNativeMutations(f.authority, f.options, f.ports)
      await expect(recoverWindowsRepairNativeTransaction(f.authority, f.options, operations)).rejects.toThrow('journal-missing')
      expect(f.events.some(event => event.startsWith('key:'))).toBe(false)
      for (const member of f.authority.roots.programFiles) {
        const path = win32.join(f.authority.roots.target, member.path)
        expect(f.files.get(path)).toEqual(f.originalFiles.get(path))
      }
    } finally { f.close() }
  })
  it.each(['per-user', 'all-users'] as const)('commits the ordered program and two %s keys with an honest non-acceptance result', async scope => {
    const f = fixture(scope)
    try {
      const result = await executeWindowsRepairNativeJournal(f.authority, f.options)
      expect(result.kind).toBe('journal-committed'); expect(result.nativeEffectsIndependentlyAccepted).toBe(false)
      expect(f.events.filter(event => event.startsWith('key:'))).toEqual(['key:install', 'key:uninstall'])
      expect(f.events.indexOf('stage')).toBeLessThan(f.events.indexOf('key:install'))
      expect(readFileSync(result.journalPath, 'utf8')).toContain('committed')
    } finally { f.close() }
  })
  it.each(['second-key', 'complete', 'stage'])('compensates %s failure with the original journal', async failure => {
    const f = fixture()
    try {
      if (failure === 'second-key') f.failKey()
      if (failure === 'complete') f.failComplete()
      if (failure === 'stage') f.failStage()
      await expect(executeWindowsRepairNativeJournal(f.authority, f.options)).rejects.toThrow('rolled-back')
      expect(f.keys).toEqual(f.originalKeys)
      for (const member of f.authority.roots.programFiles) {
        const path = win32.join(f.authority.roots.target, member.path)
        expect(f.files.get(path)).toEqual(f.originalFiles.get(path))
      }
      if (failure === 'stage') expect(f.events.some(event => event.startsWith('key:'))).toBe(false)
      expect(readFileSync(join(f.root, f.options.journalName), 'utf8')).toContain('rolled-back')
    } finally { f.close() }
  })
  it('retains unknown partial file bytes and never overwrites them', async () => {
    const f = fixture()
    try {
      f.failFile(true)
      await expect(executeWindowsRepairNativeJournal(f.authority, f.options)).rejects.toThrow('recovery-required')
      const path = win32.join(f.authority.roots.target, f.authority.roots.programFiles[0].path)
      expect(f.files.get(path)!.sha256).toBe(H('unknown-partial'))
      expect(f.events.filter(event => event === 'write:' + path)).toHaveLength(1)
      expect(f.events.some(event => event.startsWith('key:'))).toBe(false)
      expect(readFileSync(join(f.root, f.options.journalName), 'utf8')).toContain('recovery-required')
    } finally { f.close() }
  })
  it('fails closed on cloned context or registration not bound to the internally verified plan', () => {
    const f = fixture()
    try {
      expect(() => requireWindowsRepairNativeAuthority({ ...f.authority })).toThrow()
      expect(() => bindWindowsRepairNativeBackend(f.f.artifacts, f.session, f.f.verifiedPlan,
        { ...f.registration, installValues: [] })).toThrow()
    } finally { f.close() }
  })
  it('restores expired forward authority only via the separate journal capability and rejects its clones', async () => {
    const f = fixture(); let journal: WindowsRepairDurableJournal | undefined
    try {
      const operations = await prepareWindowsRepairNativeMutations(f.authority, f.options, f.ports)
      journal = WindowsRepairDurableJournal.open(f.root, f.options.journalName, windowsRepairNativeJournalBinding(f.authority), operations)
      const host = await createWindowsRepairNativeJournalHost(f.authority, journal, f.options, f.ports)
      await expect(host.writeChecked(operations[0], operations[0].before, operations[0].after)).rejects.toThrow()
      journal.append({ kind: 'intent', index: 0 })
      await host.writeChecked(operations[0], operations[0].before, operations[0].after)
      expect(() => windowsRepairNativeRecoveryInvocation({ ...host.recoveryCapability }, operations[0])).toThrow()
      expect(() => windowsRepairNativeRecoveryInvocation(host.recoveryCapability, operations[1])).toThrow()
      vi.spyOn(Date, 'now').mockReturnValue(f.authority.plan.expiresAtMs + 1)
      expect(await recoverWindowsRepairJournal(journal, operations, host)).toBe('rolled-back')
      expect(() => windowsRepairNativeRecoveryInvocation(host.recoveryCapability, operations[0])).toThrow()
    } finally { vi.restoreAllMocks(); journal?.close(); f.close() }
  })
  it('rejects a changed backup identity even when bytes match', async () => {
    const f = fixture(); let journal: WindowsRepairDurableJournal | undefined
    try {
      const operations = await prepareWindowsRepairNativeMutations(f.authority, f.options, f.ports)
      journal = WindowsRepairDurableJournal.open(f.root, f.options.journalName, windowsRepairNativeJournalBinding(f.authority), operations)
      const host = await createWindowsRepairNativeJournalHost(f.authority, journal, f.options, f.ports)
      journal.append({ kind: 'intent', index: 0 })
      await host.writeChecked(operations[0], operations[0].before, operations[0].after)
      const path = win32.join(f.root, operations[0].backup!.name)
      f.files.set(path, { ...f.files.get(path)!, identity: 'win32:ffffffff:00000000:00000001' })
      await expect(recoverWindowsRepairJournal(journal, operations, host)).rejects.toThrow('recovery-required')
      expect(f.files.get(win32.join(f.authority.roots.target, f.authority.roots.programFiles[0].path))!.sha256)
        .toBe(f.authority.roots.programFiles[0].sha256)
    } finally { journal?.close(); f.close() }
  })
  it('does not mint recovery authority for changed program operations', async () => {
    const f = fixture(); let journal: WindowsRepairDurableJournal | undefined
    try {
      const operations = structuredClone(await prepareWindowsRepairNativeMutations(f.authority, f.options, f.ports))
      operations[0].after.bytes = JSON.stringify({ size: '1', sha256: H('foreign') })
      journal = WindowsRepairDurableJournal.open(f.root, f.options.journalName, windowsRepairNativeJournalBinding(f.authority), operations)
      await expect(createWindowsRepairNativeJournalHost(f.authority, journal, f.options, f.ports)).rejects.toThrow()
      expect(f.events.some(event => event.startsWith('key:'))).toBe(false)
    } finally { journal?.close(); f.close() }
  })
})


describe.runIf(process.platform === 'win32')('cold-start protected journal recovery without the original context or fresh plan', () => {
  async function interrupted(f: ReturnType<typeof fixture>) {
    const operations = await prepareWindowsRepairNativeMutations(f.authority, f.options, f.ports)
    const journal = WindowsRepairDurableJournal.open(f.root, f.options.journalName, windowsRepairNativeJournalBinding(f.authority), operations)
    try {
      const host = await createWindowsRepairNativeJournalHost(f.authority, journal, f.options, f.ports)
      for (let index = 0; index < operations.length; index++) {
        const operation = operations[index]
        if (operation.id.startsWith('registry-install:')) await host.verifyProgramStage!()
        journal.append({ kind: 'intent', index })
        const actual = await host.writeChecked(operation, operation.before, operation.after)
        if (operation.after.identity === 'pending-owned-create') {
          if (!actual) throw new Error('fixture-owned-result-missing')
          journal.append({ kind: 'owned-after', index, image: actual })
        }
        // Simulate termination after the second key's write but before reply.
        if (index !== operations.length - 1) journal.append({ kind: 'applied', index })
      }
    } finally { journal.close() }
  }
  it.each(['per-user', 'all-users'] as const)('reopens %s log and restores both keys and files after plan expiry', async scope => {
    const f = fixture(scope)
    try {
      const created = win32.join(f.authority.roots.target, f.authority.roots.programFiles[1].path)
      f.files.delete(created); f.originalFiles.delete(created)
      await interrupted(f)
      vi.spyOn(Date, 'now').mockReturnValue(f.authority.plan.expiresAtMs + 60000)
      const freshArtifacts = f.f.verifyReceipt()
      const result = await recoverWindowsRepairNativeJournal(f.f.trust, freshArtifacts, f.f.observed.launch,
        { ...f.options, journalRoot: f.root })
      expect(result.kind).toBe('rolled-back'); expect(result.nativeEffectsIndependentlyAccepted).toBe(false)
      expect(f.keys).toEqual(f.originalKeys)
      for (const member of f.authority.roots.programFiles) {
        const path = win32.join(f.authority.roots.target, member.path)
        expect(f.files.get(path)).toEqual(f.originalFiles.get(path))
      }
      expect(f.events).toContain('delete:' + created)
      expect(readFileSync(join(f.root, f.options.journalName), 'utf8')).toContain('rolled-back')
    } finally { vi.restoreAllMocks(); f.close() }
  })
  it.each(['consumer', 'parent', 'consent', 'sid', 'elevation', 'compiled-key'])('rejects %s mismatch before compensation writes', async mismatch => {
    const f = fixture()
    try {
      await interrupted(f)
      const facts = { ...f.f.observed.launch }, trust = { ...f.f.trust }, count = f.events.length
      if (mismatch === 'consumer') facts.consumerSha256 = H('foreign')
      if (mismatch === 'parent') facts.directParentImageSha256 = H('foreign')
      if (mismatch === 'consent') facts.explicitConsentObserved = false
      if (mismatch === 'sid') facts.currentUserSid = 'S-1-5-21-1-2-3-4'
      if (mismatch === 'elevation') facts.elevated = false
      if (mismatch === 'compiled-key') trust.registryInstallKey = 'Software\\foreign'
      await expect(recoverWindowsRepairNativeJournal(trust, f.f.verifyReceipt(), facts,
        { ...f.options, journalRoot: f.root })).rejects.toThrow()
      expect(f.events).toHaveLength(count)
      expect(readFileSync(join(f.root, f.options.journalName), 'utf8')).not.toContain('rolled-back')
    } finally { f.close() }
  })
  it('preserves an unknown third file image on cold recovery', async () => {
    const f = fixture()
    try {
      await interrupted(f)
      const path = win32.join(f.authority.roots.target, f.authority.roots.programFiles[0].path)
      f.files.set(path, { ...f.files.get(path)!, sha256: H('third-state') })
      await expect(recoverWindowsRepairNativeJournal(f.f.trust, f.f.verifyReceipt(), f.f.observed.launch,
        { ...f.options, journalRoot: f.root })).rejects.toThrow('recovery-required')
      expect(f.files.get(path)!.sha256).toBe(H('third-state'))
      expect(readFileSync(join(f.root, f.options.journalName), 'utf8')).toContain('recovery-required')
    } finally { f.close() }
  })
  it('does not turn a recovery-only capability back into forward execution', async () => {
    const f = fixture(); let journal: WindowsRepairDurableJournal | undefined
    try {
      await interrupted(f)
      journal = WindowsRepairDurableJournal.reopen(f.root, f.options.journalName)
      const { bindWindowsRepairNativeRecoveryBackend } = await import('../../electron/main/services/windowsInstallRepairNativeBackend')
      const recovery = await bindWindowsRepairNativeRecoveryBackend(f.f.trust, f.f.verifyReceipt(), journal, f.f.observed.launch, f.ports)
      await expect(prepareWindowsRepairNativeMutations(recovery, f.options, f.ports)).rejects.toThrow()
      const host = await createWindowsRepairNativeJournalHost(recovery, journal, f.options, f.ports)
      expect(await recoverWindowsRepairJournal(journal, (journal.events()[0] as any).operations, host)).toBe('rolled-back')
    } finally { journal?.close(); f.close() }
  })
})
