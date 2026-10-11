import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { authorizeWindowsRepairNativeConsumer, requireWindowsRepairNativeGrant, verifyWindowsRepairDetachedArtifacts, requireVerifiedRepairArtifacts, bindWindowsRepairRuntimeSession, requireWindowsRepairRuntimeSession, resolveWindowsRepairConsumerRoots } from '../../electron/main/services/windowsInstallRepairConsumer'
import type { CompiledRepairTrust, ObservedRepairArtifacts, WindowsRepairConsumerRoots, WindowsRepairNativeLaunchFacts } from '../../electron/main/services/windowsInstallRepairConsumer'
import { windowsRepairNativeRegistryInvocation, invokeWindowsRepairNativeRegistry } from '../../electron/main/services/windowsInstallRepairNativeBackend'
import { createWindowsInstallRepairPreflight } from '../../electron/main/services/windowsInstallRepairPreflight'
import type { WindowsInstallRepairPlan } from '../../electron/main/services/windowsInstallRepairPreflight'
import { verifyWindowsRepairPlanCapability } from '../../electron/main/services/windowsInstallRepairPlanCapability'
import { windowsRepairEvidenceFixture } from './fixtures/windowsInstallRepairEvidence'
const H = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex')
const hostPath = resolve(__dirname, '../../resources/windows-install-repair-native-host.ps1')
function fixture() {
  const key = generateKeyPairSync('ed25519'), nonce = Buffer.alloc(32, 7), target = 'D:\\Program Files\\RT-ResearchFlow'
  // Synthetic native launch observations, never real installer authorization.
  const evidence = windowsRepairEvidenceFixture()
  const producer = { schemaVersion: 1, kind: 'rt-windows-repair-producer-v1', artifactSha256: H('installer'),
    policy: evidence.policy, registration: evidence.registration, programMembers: ['RT-ResearchFlow.exe'] }
  const bytes = Buffer.from(JSON.stringify(producer)), signature = sign(null, bytes, key.privateKey)
  const roots: WindowsRepairConsumerRoots = { producerKey: key.publicKey, consumerSha256: H('consumer'), nativeHostSha256: H(readFileSync(hostPath)), producerSha256: H(bytes),
    installerSha256: H('installer'), planSha256: evidence.plan.planSha256, appId: 'fixture.app', target, scope: 'all-users', view: '64',
    initiatingUserSid: 'S-1-5-21-fixture', intentNonceSha256: H(nonce), payloadRoot: 'D:\\FixturePayload', journalRoot: 'D:\\FixtureJournal',
    programFiles: [{ path: 'RT-ResearchFlow.exe', size: 11, sha256: H('fixture-exe') }] }
  const plan: WindowsInstallRepairPlan = evidence.plan
  const facts: WindowsRepairNativeLaunchFacts = { consumerSha256: roots.consumerSha256, directParentImageSha256: roots.installerSha256,
    directParentRunning: true, directParentRepairIntent: true, explicitConsentObserved: true, selectedScope: 'all-users', selectedTarget: target,
    currentUserSid: roots.initiatingUserSid, elevated: true, nonce }
  return { roots, bytes, signature, plan, facts, evidence,
    grant: () => authorizeWindowsRepairNativeConsumer(roots, bytes, signature, verifyWindowsRepairPlanCapability(evidence.policy, plan, evidence.current), facts) }
}
describe('reviewed native consumer boundary, synthetic facts only; no OS writes', () => {
  it('creates a frozen in-process grant only after all independent bindings match', () => {
    const f = fixture(), grant = f.grant(); expect(requireWindowsRepairNativeGrant(grant)).toBe(grant)
    expect(Object.isFrozen(grant)).toBe(true); expect(Object.isFrozen(grant.roots.programFiles)).toBe(true)
    expect(() => requireWindowsRepairNativeGrant(structuredClone({ ...grant, roots: { ...grant.roots, producerKey: undefined } }) as any)).toThrow()
  })
  it.each(['parent', 'dead-parent', 'intent', 'consent', 'scope', 'target', 'sid', 'elevation', 'nonce', 'consumer', 'plan', 'producer', 'signature', 'payload', 'host'])('refuses %s before a native child can start', kind => {
    const f = fixture()
    if (kind === 'parent') f.facts.directParentImageSha256 = H('foreign')
    if (kind === 'dead-parent') f.facts.directParentRunning = false
    if (kind === 'intent') f.facts.directParentRepairIntent = false
    if (kind === 'consent') f.facts.explicitConsentObserved = false
    if (kind === 'scope') f.facts.selectedScope = 'per-user'
    if (kind === 'target') f.facts.selectedTarget = 'D:\\Program'
    if (kind === 'sid') f.facts.currentUserSid = 'foreign'
    if (kind === 'elevation') f.facts.elevated = false
    if (kind === 'nonce') f.facts.nonce = Buffer.alloc(32)
    if (kind === 'consumer') f.facts.consumerSha256 = H('foreign')
    if (kind === 'plan') f.plan.planSha256 = H('foreign')
    if (kind === 'producer') f.bytes[0] ^= 1
    if (kind === 'signature') f.signature[0] ^= 1
    if (kind === 'payload') f.roots.programFiles = [{ path: 'data/trade.db', size: 1, sha256: H('foreign') }]
    if (kind === 'host') f.roots.nativeHostSha256 = ''
    expect(() => f.grant()).toThrow()
  })
  it('constructs only the signed scope/view/exact app keys and verified host source', () => {
    const f = fixture(), spec = windowsRepairNativeRegistryInvocation(f.grant(), hostPath, f.roots.nativeHostSha256, 'C:\\Windows', 'install')
    expect(spec.shell).toBe(false); expect(spec.env).toEqual({ SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows' })
    expect(JSON.parse(JSON.parse(Buffer.from(spec.input).toString('utf8')).payload)).toMatchObject({ scope: 'all-users', view: '64', installKey: 'Software\\fixture-app', selectedKey: 'install', operation: 'read-registry' })
    expect(() => windowsRepairNativeRegistryInvocation(f.grant(), hostPath, H('wrong'), 'C:\\Windows', 'install')).toThrow()
  })
  it('refuses foreign subkeys or malformed typed registry values before sending', () => {
    const f = fixture(), grant = f.grant()
    for (const next of [{ state: 'present', values: [], children: ['foreign'] }, { state: 'present', values: [{ name: 'NoModify', type: 'REG_DWORD', data: true }], children: [] }]) {
      expect(() => windowsRepairNativeRegistryInvocation(grant, hostPath, f.roots.nativeHostSha256, 'C:\\Windows', 'uninstall',
        { expected: { state: 'absent', values: null, children: [] }, next: next as any })).toThrow()
    }
  })
  it('uses bounded real subprocess contract but exercises a synthetic return only', async () => {
    const f = fixture(), spec = windowsRepairNativeRegistryInvocation(f.grant(), hostPath, f.roots.nativeHostSha256, 'C:\\Windows', 'install')
    expect(await invokeWindowsRepairNativeRegistry(spec, async () => Buffer.from(JSON.stringify({ state: 'absent', values: null, children: [] })))).toEqual({ state: 'absent', values: null, children: [] })
    await expect(invokeWindowsRepairNativeRegistry(spec, async () => Buffer.from([0xff]))).rejects.toThrow()
    await expect(invokeWindowsRepairNativeRegistry(spec)).rejects.toThrow('NATIVE_BACKEND_FAILED')
  })
  it.each(['dataRoots', 'protectedPaths', 'steps', 'snapshotSha256', 'expiry', 'missing'])('rejects altered %s with unchanged claimed plan digest', key => {
    const f = fixture()
    if (key === 'dataRoots') f.plan.dataRoots = []
    if (key === 'protectedPaths') f.plan.protectedPaths = []
    if (key === 'steps') (f.plan as any).steps = []
    if (key === 'snapshotSha256') f.plan.snapshotSha256 = H('other-snapshot')
    if (key === 'expiry') f.plan.expiresAtMs = Date.now() - 1
    if (key === 'missing') delete (f.plan as any).protocol
    expect(() => f.grant()).toThrow()
  })
  it('rejects a deserialized plan token and the former five-field stub', () => {
    const f = fixture(), token = verifyWindowsRepairPlanCapability(f.evidence.policy, f.plan, f.evidence.current)
    for (const fake of [structuredClone(token), { plan: { planSha256: f.roots.planSha256, appId: f.roots.appId, target: f.roots.target, scope: 'all-users', view: '64' } }]) {
      expect(() => authorizeWindowsRepairNativeConsumer(f.roots, f.bytes, f.signature, fake as any, f.facts)).toThrow('CONSUMER_REJECTED')
    }
  })
  it('does not accept typed before values that merely carry a stale claimed digest', () => {
    const f = fixture()
    f.evidence.current.registry.find(row => row.state === 'present')!.installValues![0].data = 'D:\\Foreign'
    expect(() => f.grant()).toThrow()
  })
  it('constructs a forward write only from the approved complete typed image', () => {
    const f = fixture(), grant = f.grant(), before = f.evidence.current.registry.find(row => row.state === 'present')!
    const spec = windowsRepairNativeRegistryInvocation(grant, hostPath, f.roots.nativeHostSha256, 'C:\\Windows', 'install', {
      expected: { state: 'present', values: before.installValues!, children: [] },
      next: { state: 'present', values: f.evidence.registration.installValues, children: [] },
    })
    expect(JSON.parse(JSON.parse(Buffer.from(spec.input).toString('utf8')).payload).next.values).toEqual(f.evidence.registration.installValues)
  })
  it.each(['arbitrary-value', 'delete-key', 'wrong-before', 'reverse-replay'])('rejects %s with a valid grant before any native spawn', kind => {
    const f = fixture(), grant = f.grant(), before = f.evidence.current.registry.find(row => row.state === 'present')!
    const old = { state: 'present' as const, values: before.uninstallValues!, children: [] }
    const next = { state: 'present' as const, values: f.evidence.registration.uninstallValues, children: [] }
    const change: any = { expected: structuredClone(old), next: structuredClone(next) }
    if (kind === 'arbitrary-value') change.next.values[0].data = 'C:\\foreign.exe'
    if (kind === 'delete-key') change.next = { state: 'absent', values: null, children: [] }
    if (kind === 'wrong-before') change.expected.values[0].data = 'foreign-old-value'
    if (kind === 'reverse-replay') { change.expected = next; change.next = old }
    expect(() => windowsRepairNativeRegistryInvocation(grant, hostPath, f.roots.nativeHostSha256, 'C:\\Windows', 'uninstall', change)).toThrow('NATIVE_BACKEND_FAILED')
  })
})

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
      nativeHost: Buffer.from('native host'), jobHost: Buffer.from('job host') },
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

describe('detached artifact gate, in-memory synthetic bytes only', () => {
  it('mints only a frozen WeakSet capability after signed final bytes and uninstaller match', () => {
    const f = detachedFixture(), cap = f.verifyReceipt()
    expect(requireVerifiedRepairArtifacts(cap)).toBe(cap)
    expect(Object.isFrozen(cap.receipt.programInventory)).toBe(true)
    expect(() => requireVerifiedRepairArtifacts(structuredClone(cap))).toThrow('CONSUMER_REJECTED')
    for (const dynamic of ['consumerSha256', 'nativeHostSha256', 'producerSha256', 'installerSha256',
      'planSha256', 'initiatingUserSid', 'intentNonceSha256', 'payloadRoot', 'journalRoot', 'programFiles']) {
      expect(Object.keys(f.trust)).not.toContain(dynamic)
      expect(() => f.verifyReceipt(f.receipt, undefined, f.observed, { ...f.trust, [dynamic]: 'foreign' } as any))
        .toThrow('CONSUMER_REJECTED')
    }
  })
  it.each(['installer', 'consumer', 'privateNode', 'nativeHost', 'jobHost', 'program', 'uninstaller', 'seal'])
  ('rejects changed observed %s bytes despite a valid receipt signature', kind => {
    const f = detachedFixture(), observed = structuredClone(f.observed)
    if (kind === 'installer') observed.installer = Buffer.from('tampered')
    if (kind === 'seal') observed.runtimeSeal = Buffer.from('tampered')
    if (['consumer', 'privateNode', 'nativeHost', 'jobHost'].includes(kind)) (observed.components as any)[kind] = Buffer.from('tampered')
    if (kind === 'program') observed.programFiles[0].bytes = Buffer.from('tampered')
    if (kind === 'uninstaller') observed.programFiles[1].bytes = Buffer.from('tampered')
    expect(() => f.verifyReceipt(f.receipt, undefined, observed)).toThrow('CONSUMER_REJECTED')
  })
  it.each(['policy', 'installKey', 'dataRoots', 'command', 'sid', 'nonce', 'plan', 'receiptSha256'])
  ('rejects signed receipt attempting to import %s authority', field => {
    const f = detachedFixture()
    expect(() => f.verifyReceipt({ ...f.receipt, [field]: 'attacker-value' })).toThrow('CONSUMER_REJECTED')
  })
  it('rejects duplicate JSON keys, including escaped aliases, even under a valid test signature', () => {
    const f = detachedFixture(), raw = JSON.stringify(f.receipt)
    for (const inserted of ['"appId":"foreign",', '"app\\u0049d":"foreign",']) {
      const duplicate = Buffer.from(raw.replace('"appId":"fixture.app",', inserted + '"appId":"fixture.app",'))
      expect(() => f.verifyReceipt(f.receipt, duplicate)).toThrow('CONSUMER_REJECTED')
    }
  })
  it('rejects forged static roots, missing uninstaller and forbidden program data paths', () => {
    const f = detachedFixture()
    expect(() => f.verifyReceipt(f.receipt, undefined, f.observed, { ...f.trust, installerSha256: H('future') } as any)).toThrow()
    expect(() => f.verifyReceipt({ ...f.receipt, registeredUninstallerRelativePath: 'other.exe' })).toThrow()
    expect(() => f.verifyReceipt({ ...f.receipt, programInventory: [{ relativePath: 'data/trade.db', size: 1, sha256: H('x') }] })).toThrow()
  })
  it('rejects an unsigned mutation of the detached raw bytes', () => {
    const f = detachedFixture(), bytes = Buffer.from(JSON.stringify(f.receipt))
    const signed = sign(null, bytes, generateKeyPairSync('ed25519').privateKey)
    expect(() => verifyWindowsRepairDetachedArtifacts(f.trust, bytes, signed, f.observed)).toThrow('CONSUMER_REJECTED')
  })
})

function runtimeSessionFixture() {
  const f = detachedFixture(), artifacts = f.verifyReceipt()
  const evidence = windowsRepairEvidenceFixture()
  const policy = structuredClone(evidence.policy)
  policy.installer.releaseReceiptSha256 = artifacts.receiptSha256
  const initial = structuredClone(evidence.current)
  initial.collectionId = 'session-initial'
  initial.observedAtMs = Date.now() - 20
  initial.installer.releaseReceiptSha256 = artifacts.receiptSha256
  const preflight = createWindowsInstallRepairPreflight(policy, initial, { scope: 'all-users', view: '64' }, initial.observedAtMs)
  if (preflight.kind !== 'preflight-candidate') throw new Error('SYNTHETIC_SESSION_PREFLIGHT')
  const current = structuredClone(initial)
  current.collectionId = 'session-fresh'
  current.observedAtMs = Date.now()
  const verifiedPlan = verifyWindowsRepairPlanCapability(policy, preflight.plan, current)
  const observed = {
    launch: { consumerSha256: artifacts.receipt.components.consumer.sha256,
      directParentImageSha256: artifacts.receipt.installer.sha256, directParentRunning: true,
      directParentRepairIntent: true, selectedScope: 'all-users' as const,
      selectedTarget: f.trust.target, currentUserSid: 'S-1-5-21-100-200-300-1001',
      elevated: true, explicitConsentObserved: true, nonce: Buffer.alloc(32, 7) },
    payloadRoot: 'D:\\FixturePayload', journalRoot: 'D:\\FixtureJournal',
  }
  return { ...f, artifacts, verifiedPlan, observed }
}

describe('internal runtime session and fresh plan binding, synthetic observations only', () => {
  it('assembles backend-compatible resolved roots from three capabilities, not compiled future hashes', () => {
    const f = runtimeSessionFixture()
    const session = bindWindowsRepairRuntimeSession(f.artifacts, f.verifiedPlan, f.observed)
    const roots = resolveWindowsRepairConsumerRoots(f.artifacts, session, f.verifiedPlan)
    expect(requireWindowsRepairRuntimeSession(session)).toBe(session)
    expect(roots.producerSha256).toBe(f.artifacts.receiptSha256)
    expect(roots.installerSha256).toBe(f.artifacts.receipt.installer.sha256)
    expect(roots.planSha256).toBe(f.verifiedPlan.plan.planSha256)
    expect(roots.initiatingUserSid).toBe(f.observed.launch.currentUserSid)
    expect(roots.programFiles.map(item => item.path)).toContain('Uninstall RT-ResearchFlow.exe')
    expect(Object.isFrozen(roots.programFiles)).toBe(true)
    expect(() => requireWindowsRepairRuntimeSession(structuredClone(session))).toThrow('CONSUMER_REJECTED')
    expect(() => resolveWindowsRepairConsumerRoots(f.verifyReceipt(), session, f.verifiedPlan)).toThrow('CONSUMER_REJECTED')
  })
  it.each(['parent', 'consent', 'nonce', 'scope', 'sid', 'payload', 'external-policy'])
  ('rejects synthetic runtime %s forgery before resolved roots exist', kind => {
    const f = runtimeSessionFixture(), observed: any = structuredClone(f.observed)
    if (kind === 'parent') observed.launch.directParentImageSha256 = H('foreign')
    if (kind === 'consent') observed.launch.explicitConsentObserved = false
    if (kind === 'nonce') observed.launch.nonce = Buffer.alloc(1)
    if (kind === 'scope') observed.launch.selectedScope = 'per-user'
    if (kind === 'sid') observed.launch.currentUserSid = 'attacker'
    if (kind === 'payload') observed.payloadRoot = f.trust.target
    if (kind === 'external-policy') observed.policy = { installKey: 'Software\\foreign' }
    expect(() => bindWindowsRepairRuntimeSession(f.artifacts, f.verifiedPlan, observed)).toThrow('CONSUMER_REJECTED')
  })
  it('rejects a plan token for another receipt and a deserialized plan token', () => {
    const f = runtimeSessionFixture(), unrelated = windowsRepairEvidenceFixture()
    const other = verifyWindowsRepairPlanCapability(unrelated.policy, unrelated.plan, unrelated.current)
    expect(() => bindWindowsRepairRuntimeSession(f.artifacts, other, f.observed)).toThrow('CONSUMER_REJECTED')
    expect(() => bindWindowsRepairRuntimeSession(f.artifacts, structuredClone(f.verifiedPlan) as any, f.observed)).toThrow('CONSUMER_REJECTED')
  })
})
