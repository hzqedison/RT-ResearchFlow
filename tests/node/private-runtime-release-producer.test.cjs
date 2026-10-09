'use strict'

// Synthetic authorization and process records only: no release approval, real
// GitHub traffic, production registry, account or provider request is exercised.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const entry = require('../../scripts/seal-private-python-runtime-producer.cjs')
const { createReleaseVerifiers, buildPreSealBootstrapContract } = require('../../scripts/private-runtime-release-verifiers.cjs')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const oid = bytes => crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(40)
const targets = ['win32-x64', 'darwin-arm64', 'darwin-x64']
const owned = []
function temporary() {
  const base = path.resolve(process.env.RT_RUNTIME_TEST_TEMP_ROOT || process.env.RUNNER_TEMP || os.tmpdir())
  const root = fs.mkdtempSync(path.join(base, 'release-producer-test-')); owned.push(root); return root
}
test.after(() => { for (const root of owned) fs.rmSync(root, { recursive: true, force: true }) })
function authorizationFixture(change) {
  const record = { kind: 'rt-private-runtime-release-authorization-v1', schemaVersion: 1, decision: 'approved',
    trustedContext: { repositoryId: 7, repositoryFullName: 'test/runtime' }, assemblyTargets: targets }
  const bytes = Buffer.from(JSON.stringify(record)), blob = oid(bytes), tree = '1'.repeat(40)
  const pins = { repository: 'test/runtime', repositoryId: 7, commit: C, path: 'authorization.json', sha256: sha(bytes) }
  const replies = {
    '/repos/test/runtime': { id: 7, full_name: 'test/runtime' },
    ['/repos/test/runtime/git/commits/' + C]: { sha: C, tree: { sha: tree } },
    ['/repos/test/runtime/git/trees/' + tree]: { sha: tree, tree: [{ path: pins.path, type: 'blob', mode: '100644', sha: blob }] },
    ['/repos/test/runtime/git/blobs/' + blob]: { sha: blob, encoding: 'base64', content: bytes.toString('base64'), size: bytes.length },
  }
  if (change) change({ record, pins, replies, blob, tree, bytes })
  const calls = []
  return { pins, record, calls, authority: { async readJson(name) { calls.push(name); assert.ok(Object.hasOwn(replies, name)); return replies[name] } } }
}
test('authorization consumes official commit/tree/blob raw bytes, not a local approval boolean', async () => {
  const fixture = authorizationFixture()
  assert.deepEqual(await entry.readAuthorization(fixture.pins, fixture.authority), fixture.record)
  assert.equal(fixture.calls.length, 4)
})
for (const [name, mutate] of [
  ['wrong repository', f => { f.replies['/repos/test/runtime'].id = 8 }],
  ['wrong commit', f => { f.replies['/repos/test/runtime/git/commits/' + C].sha = 'd'.repeat(40) }],
  ['truncated tree', f => { f.replies['/repos/test/runtime/git/trees/' + f.tree].truncated = true }],
  ['symlink member', f => { f.replies['/repos/test/runtime/git/trees/' + f.tree].tree[0].mode = '120000' }],
  ['duplicate member', f => { f.replies['/repos/test/runtime/git/trees/' + f.tree].tree.push(f.replies['/repos/test/runtime/git/trees/' + f.tree].tree[0]) }],
  ['changed SHA256', f => { f.pins.sha256 = B }],
  ['changed actual bytes', f => { f.replies['/repos/test/runtime/git/blobs/' + f.blob].content = Buffer.from('{}').toString('base64') }],
]) test('authorization rejects ' + name, async () => {
  const fixture = authorizationFixture(mutate)
  await assert.rejects(entry.readAuthorization(fixture.pins, fixture.authority))
})
test('CLI without protected roots is executable and rejects before filesystem/network access', () => {
  const child = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/seal-private-python-runtime-producer.cjs'), '--input', 'not-present.json'],
    { env: { ...process.env, GITHUB_ACTIONS: 'false', RT_RUNTIME_RELEASE_SOURCE_VERIFIED: 'true' }, encoding: 'utf8', timeout: 10000 })
  assert.equal(child.status, 2)
  assert.deepEqual(JSON.parse(child.stdout), { status: 'pending', releaseEligible: false, reasons: [{ code: 'PROTECTED_CONTEXT_REQUIRED' }] })
  assert.equal(child.stderr, '')
})
test('protected roots require commit/path/hash pins; true grants no authorization', () => {
  assert.throws(() => entry.protectedPins({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_TEMP: temporary(), sourceVerified: 'true' }), /AUTHORIZATION_PINS_REQUIRED/)
})
test('CLI accepts only the exact input switch', () => {
  assert.equal(entry.options(['--input', 'file.json']), 'file.json')
  for (const args of [[], ['--sourceVerified', 'true'], ['--input', 'a', '--context', 'b']]) assert.throws(() => entry.options(args))
})
test('module loader refuses an unverified dependency without executing its sentinel', () => {
  const root = temporary(), main = Buffer.from("module.exports = require('./sentinel.cjs')"), marker = path.join(root, 'executed')
  fs.writeFileSync(path.join(root, 'main.cjs'), main)
  fs.writeFileSync(path.join(root, 'sentinel.cjs'), "require('node:fs').writeFileSync(" + JSON.stringify(marker) + ", 'bad')")
  assert.throws(() => entry.verifiedLoader(root, new Map([['main.cjs', sha(main)]]))('main.cjs'), /EXECUTED_MODULE_NOT_VERIFIED/)
  assert.equal(fs.existsSync(marker), false)
})
test('module loader compiles verified raw bytes and rejects bytes changed after pinning', () => {
  const root = temporary(), bytes = Buffer.from('module.exports = { value: 42 }')
  fs.writeFileSync(path.join(root, 'good.cjs'), bytes)
  assert.equal(entry.verifiedLoader(root, new Map([['good.cjs', sha(bytes)]]))('good.cjs').value, 42)
  fs.appendFileSync(path.join(root, 'good.cjs'), '\n')
  assert.throws(() => entry.verifiedLoader(root, new Map([['good.cjs', sha(bytes)]]))('good.cjs'), /EXECUTED_MODULE_CHANGED/)
})
test('artifact reader consumes actual bytes and refuses SHA echo, changed bytes and unknown artifact', async () => {
  const root = temporary(), filename = path.join(root, 'proof.zip'), bytes = Buffer.from('raw ZIP fixture bytes')
  fs.writeFileSync(filename, bytes)
  const read = entry.archiveReader({ artifactArchives: { 12: filename } }, { producers: [{ fragmentArtifactId: 12, artifactArchiveSha256: sha(bytes) }] }, root)
  assert.deepEqual(await read({ artifactId: 12 }), bytes)
  await assert.rejects(read({ artifactId: 13 }), /UNAUTHORIZED_ARTIFACT/)
  fs.writeFileSync(filename, 'changed')
  await assert.rejects(read({ artifactId: 12 }), /ARTIFACT_ARCHIVE_BYTES_MISMATCH/)
})
function verifierFixture() {
  const root = temporary(), reporter = Buffer.from('# fixture reporter, never a release producer\n'), reporterPin = { path: 'reporter.py', sha256: sha(reporter) }
  fs.writeFileSync(path.join(root, reporterPin.path), reporter)
  const obligationPolicyPath = 'resources/python-runtime/distribution-obligations.policy.json'
  const obligationPolicyBytes = Buffer.from(JSON.stringify({ schemaVersion: 1,
    kind: 'rt-runtime-distribution-obligation-policy-v1', preparationPolicySha256: A, assets: [] }))
  fs.mkdirSync(path.dirname(path.join(root, obligationPolicyPath)), { recursive: true })
  fs.writeFileSync(path.join(root, obligationPolicyPath), obligationPolicyBytes)
  const context = { approvedSourceCommit: C, approvedPolicySha256: A, obligationPolicySha256: sha(obligationPolicyBytes),
    producers: targets.map((target, index) => ({ target, runId: 100 + index, attempt: 1, jobId: 200 + index })) }
  const policy = { schemaVersion: 1, kind: 'rt-private-runtime-release-verifier-policy-v1', preparationPolicySha256: A,
    obligationPolicySha256: context.obligationPolicySha256, nativeReporters: Object.fromEntries(targets.map(target => [target, reporterPin])), reviewRecords: [] }
  const sourceMembers = new Map([[reporterPin.path, reporterPin.sha256], [obligationPolicyPath, context.obligationPolicySha256]])
  return { root, context, policy, sourceMembers, reporterPin, obligationPolicyPath,
    callbacks() { return createReleaseVerifiers({ repositoryRoot: root, sourceMembers, trustedContext: context, verifierPolicy: policy }) } }
}
function nativeFixture(fixture, target = targets[0]) {
  const producer = fixture.context.producers.find(row => row.target === target)
  const [nativePlatform, nativeArch] = target.split('-')
  const binding = { target, providers: { akshare: {}, mootdx: {}, pywencai: {} } }
  const report = { kind: 'rt-private-python-native-bootstrap-evidence-v1', binding, nativePlatform, nativeArch,
    producer: { runId: producer.runId, attempt: producer.attempt, jobId: producer.jobId, sourceCommit: C },
    reporter: fixture.reporterPin, validatorPassed: true, executableModeChecked: true,
    invocationFlags: ['-X', 'utf8', '-I', '-S', '-B'], observationMethod: 'owned-process-exit-v1',
    results: ['akshare', 'mootdx', 'pywencai'].map((provider, index) => ({ provider, workerPid: index + 10,
      workerExitObserved: true, workerExitCode: 0, privateNodeExited: true, ownedDescendantsExited: true,
      ...(provider === 'pywencai' ? { privateNodeCheck: { kind: 'pywencai-token-computation-v1', pid: 99, exitCode: 0, status: 'passed' } } : {}),
      ownedProcesses: [{ pid: index + 10, role: 'worker', startedAt: '2026-10-09T00:00:00Z', exitedAt: '2026-10-09T00:00:01Z', exitObserved: true, exitCode: 0 },
        ...(provider === 'pywencai' ? [{ pid: 99, role: 'private-node', startedAt: '2026-10-09T00:00:00Z', exitedAt: '2026-10-09T00:00:01Z', exitObserved: true, exitCode: 0 }] : [])] })) }
  return { target, producer, binding, report, args() { return { target, producer, expectedBinding: binding, reportBytes: Buffer.from(JSON.stringify(report)) } } }
}
for (const target of targets) test('native verifier accepts bound synthetic observations for ' + target + ', not a native execution claim', async () => {
  const fixture = verifierFixture(), native = nativeFixture(fixture, target), args = native.args()
  const result = await fixture.callbacks().verifyNativeBootstrap(args)
  assert.equal(result.status, 'accepted'); assert.equal(result.reportSha256, sha(args.reportBytes))
})
for (const [name, mutate] of [
  ['wrong job', n => { n.report.producer.jobId++ }],
  ['wrong source', n => { n.report.producer.sourceCommit = 'd'.repeat(40) }],
  ['reporter SHA mismatch', n => { n.report.reporter = { ...n.report.reporter, sha256: B } }],
  ['missing UTF8 flag', n => { n.report.invocationFlags = ['-I', '-S', '-B'] }],
  ['worker failure', n => { n.report.results[0].workerExitCode = 70 }],
  ['worker not observed', n => { n.report.results[0].workerExitObserved = false }],
  ['unobserved descendant', n => { n.report.results[0].ownedProcesses[0].exitObserved = false }],
  ['missing Node observation', n => { n.report.results[2].ownedProcesses.pop() }],
  ['private Node exit 1', n => { n.report.results[2].ownedProcesses[1].exitCode = 1 }],
  ['private Node exit 137', n => { n.report.results[2].ownedProcesses[1].exitCode = 137 }],
  ['missing actual Node computation result', n => { delete n.report.results[2].privateNodeCheck }],
  ['Node computation bound to a different PID', n => { n.report.results[2].privateNodeCheck.pid = 100 }],
  ['failed actual Node computation result', n => { n.report.results[2].privateNodeCheck.status = 'failed' }],
  ['duplicate provider', n => { n.report.results[1].provider = 'akshare' }],
]) test('native verifier rejects ' + name, async () => {
  const fixture = verifierFixture(), native = nativeFixture(fixture); mutate(native)
  await assert.rejects(fixture.callbacks().verifyNativeBootstrap(native.args()))
})
test('approved reporter actual source bytes must remain pinned', () => {
  const fixture = verifierFixture()
  fs.appendFileSync(path.join(fixture.root, fixture.reporterPin.path), 'changed')
  assert.throws(() => fixture.callbacks(), /NATIVE_REPORTER_SOURCE_NOT_VERIFIED/)
})
function obligationFixture() {
  const fixture = verifierFixture(), target = targets[0], evidence = { format: 'rights-scope-review', path: 'evidence.json', sha256: sha(Buffer.from('{"payload":"reviewed fixture"}')) }
  fs.mkdirSync(path.join(fixture.root, target))
  fs.writeFileSync(path.join(fixture.root, target, evidence.path), '{"payload":"reviewed fixture"}')
  const asset = { component: 'fixture-only', version: '1', artifactSha256: A }
  const obligation = { id: 'fixture-rights', scope: { licenseSha256: B }, requiredEvidence: [evidence.format], payloadFiles: [] }
  const binding = { target, id: obligation.id, ...asset, licenseSha256: B, decision: 'satisfied', format: evidence.format,
    evidencePath: evidence.path, evidenceSha256: evidence.sha256, payloadFiles: [] }
  const record = { schemaVersion: 1, kind: 'rt-runtime-obligation-review-record-v1', preparationPolicySha256: A,
    evidenceAcceptances: [{ decision: 'approved', basis: 'independent-review', binding }] }
  const bytes = Buffer.from(JSON.stringify(record)), pin = { path: 'review.json', sha256: sha(bytes) }
  fs.writeFileSync(path.join(fixture.root, pin.path), bytes)
  fixture.policy.reviewRecords.push(pin); fixture.sourceMembers.set(pin.path, pin.sha256)
  const obligationPolicy = { schemaVersion: 1, kind: 'rt-runtime-distribution-obligation-policy-v1', preparationPolicySha256: A,
    assets: [{ target, ...asset, classification: 'additional-obligations', reviewRecord: pin, obligations: [obligation] }] }
  const policyBytes = Buffer.from(JSON.stringify(obligationPolicy))
  fs.writeFileSync(path.join(fixture.root, fixture.obligationPolicyPath), policyBytes)
  fixture.context.obligationPolicySha256 = sha(policyBytes)
  fixture.policy.obligationPolicySha256 = sha(policyBytes)
  fixture.sourceMembers.set(fixture.obligationPolicyPath, sha(policyBytes))
  const reviewRecord = { authorizationCommit: C, ...pin }
  const args = { target, manifest: { platform: 'win32', arch: 'x64' }, asset, rule: { reviewRecord: pin }, obligation,
    review: { reviewRecord, decision: 'satisfied' }, evidence, preparedRoot: fixture.root }
  return { fixture, args, record, pin, policyBytes }
}
test('review bytes then policy bytes then outer authorization construct an acyclic actual hash chain', async () => {
  const { fixture, args, record, pin, policyBytes } = obligationFixture()
  assert.equal(Object.hasOwn(record, 'obligationPolicySha256'), false)
  assert.equal(sha(fs.readFileSync(path.join(fixture.root, pin.path))), pin.sha256)
  assert.equal(JSON.parse(policyBytes).assets[0].reviewRecord.sha256, pin.sha256)
  assert.equal(sha(policyBytes), fixture.context.obligationPolicySha256)
  assert.equal(fixture.policy.obligationPolicySha256, sha(policyBytes))
  assert.equal((await fixture.callbacks().evidenceVerifiers[args.evidence.format](args)).status, 'accepted')
})
test('actual reviewed record changed after policy pinning is rejected', () => {
  const { fixture, pin } = obligationFixture()
  fs.appendFileSync(path.join(fixture.root, pin.path), '\n')
  assert.throws(() => fixture.callbacks(), /REVIEW_RECORD_SOURCE_CHANGED/)
})
test('actual obligation policy changed after outer authorization is rejected', () => {
  const { fixture } = obligationFixture()
  fs.appendFileSync(path.join(fixture.root, fixture.obligationPolicyPath), '\n')
  assert.throws(() => fixture.callbacks(), /OBLIGATION_POLICY_SOURCE_CHANGED/)
})
test('outer verifier policy cannot substitute another obligation policy hash', () => {
  const { fixture } = obligationFixture()
  fixture.policy.obligationPolicySha256 = B
  assert.throws(() => fixture.callbacks(), /VERIFIER_POLICY_BINDING/)
})
test('license verifier accepts only source-authorized review of exact evidence bytes (synthetic, not license approval)', async () => {
  const { fixture, args } = obligationFixture()
  assert.deepEqual(await fixture.callbacks().evidenceVerifiers[args.evidence.format](args), { status: 'accepted', evidenceSha256: args.evidence.sha256 })
})
test('payload accepted=true without a separately approved record remains pending', async () => {
  const { fixture, args } = obligationFixture(); fixture.policy.reviewRecords = []
  fs.writeFileSync(path.join(fixture.root, args.target, args.evidence.path), '{"accepted":true}')
  assert.equal((await fixture.callbacks().evidenceVerifiers[args.evidence.format](args)).status, 'pending')
})
test('changed reviewed evidence is rejected, never silently rehashed', async () => {
  const { fixture, args } = obligationFixture()
  fs.writeFileSync(path.join(fixture.root, args.target, args.evidence.path), 'changed')
  await assert.rejects(fixture.callbacks().evidenceVerifiers[args.evidence.format](args), /OBLIGATION_REVIEWED_BYTES_CHANGED/)
})
test('different artifact, version, target or decision has no approved evidence match', async () => {
  for (const mutate of [a => { a.asset.artifactSha256 = B }, a => { a.asset.version = '2' },
    a => { a.target = targets[1]; a.manifest = { platform: 'darwin', arch: 'arm64' } }, a => { a.review.decision = 'not-applicable' }]) {
    const { fixture, args } = obligationFixture(); mutate(args)
    assert.equal((await fixture.callbacks().evidenceVerifiers[args.evidence.format](args)).status, 'pending')
  }
})
test('mutated or unverified review source cannot grant approval', () => {
  const { fixture, pin } = obligationFixture()
  fixture.sourceMembers.delete(pin.path)
  assert.throws(() => fixture.callbacks(), /REVIEW_RECORD_SOURCE_NOT_VERIFIED/)
})
function stageFixture() {
  const repositoryRoot = temporary(), stagingRoot = temporary(), target = process.platform + '-' + process.arch
  const runtimeRoot = path.join(stagingRoot, target); fs.mkdirSync(runtimeRoot)
  const contents = { 'python/python': 'not a real Python binary', 'node/node': 'not a real Node binary', 'bootstrap.py': '# fixture only',
    'miniracer_unicode_adapter.py': '# fixture mini adapter', 'providers/pywencai/pywencai_adapter.py': '# fixture pyw adapter',
    'private_runtime_manifest.cjs': '// fixture validator' }
  const files = []
  for (const [name, text] of Object.entries(contents)) {
    const bytes = Buffer.from(text), filename = path.join(runtimeRoot, name)
    fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes)
    files.push({ path: name, kind: 'file', size: bytes.length, sha256: sha(bytes) })
  }
  const sourceMembers = new Map(), bootstrapSmokes = {}
  for (const provider of ['akshare', 'mootdx', 'pywencai']) {
    const name = provider + '.py', bytes = Buffer.from('# synthetic invocation contract only\n')
    fs.writeFileSync(path.join(repositoryRoot, name), bytes)
    sourceMembers.set(name, sha(bytes)); bootstrapSmokes[provider] = { path: name, sha256: sha(bytes) }
  }
  sourceMembers.set('reporter.py', A)
  sourceMembers.set('resources/python-runtime/bootstrap.py', files.find(row => row.path === 'bootstrap.py').sha256)
  sourceMembers.set('resources/python-runtime/miniracer_unicode_adapter.py', files.find(row => row.path === 'miniracer_unicode_adapter.py').sha256)
  sourceMembers.set('resources/python-runtime/pywencai_adapter.py', files.find(row => row.path === 'providers/pywencai/pywencai_adapter.py').sha256)
  sourceMembers.set('electron/shared/privatePythonRuntimeManifest.cjs', files.find(row => row.path === 'private_runtime_manifest.cjs').sha256)
  const [platform, arch] = target.split('-')
  const manifest = { kind: 'rt-private-python-runtime', complete: true, platform, arch, bootstrap: 'bootstrap.py', files,
    sourceLockSha256: A, python: { executable: 'python/python', asset: { sha256: A } }, node: { executable: 'node/node', asset: { sha256: B } },
    dependencyAuditValidator: { sha256: A }, providers: Object.fromEntries(['akshare', 'mootdx', 'pywencai'].map(provider =>
      [provider, { version: 'fixture', wheels: [], dependencyAudit: { sha256: A } }])) }
  const args = { repositoryRoot, stagingRoot, runtimeRoot, manifest, manifestSha256: B,
    fragment: { sourceSha256: A, preparationPolicySha256: B, inventorySha256: A }, fragmentSha256: B, candidateLockSha256: A,
    trustedContext: { assemblyTarget: target, sourceSnapshotSha256: A, approvedPolicySha256: B, approvedSourceCommit: C,
      producers: [{ target, runId: 7, attempt: 1, jobId: 8 }] }, sourceMembers,
    verifierPolicy: { nativeReporters: { [target]: { path: 'reporter.py', sha256: A } }, bootstrapSmokes: { [target]: bootstrapSmokes } },
    environment: { RUNNER_TEMP: path.dirname(stagingRoot), GITHUB_TOKEN: 'must-not-inherit', PYTHONPATH: 'must-not-inherit' } }
  return { args, target, bootstrapSmokes }
}
test('pre-seal contract uses real formal argv, three isolated providers, and no approval or release flag', () => {
  const { args } = stageFixture(), contract = buildPreSealBootstrapContract(args)
  assert.equal(contract.releaseEligible, false)
  assert.equal(contract.expectedBinding.candidateLockSha256, args.candidateLockSha256)
  assert.equal(contract.invocations.length, 3)
  for (const invocation of contract.invocations) {
    assert.deepEqual(invocation.args.slice(0, 5), ['-X', 'utf8', '-I', '-S', '-B'])
    assert.equal(invocation.args.some(value => value.includes('--fixture')), false)
    assert.equal(invocation.executable, contract.pythonExecutable)
    assert.equal(invocation.env.GITHUB_TOKEN, undefined)
    assert.equal(invocation.env.PYTHONPATH, '')
    assert.equal(JSON.parse(invocation.input).request.operation, 'status')
    assert.equal(invocation.cwd.startsWith(contract.runtimeRoot + path.sep), false)
  }
  assert.notEqual(contract.invocations[0].cwd, contract.invocations[1].cwd)
  assert.equal(contract.invocations[1].env.RT_MOOTDX_CACHE_ROOT, contract.invocations[1].cwd)
  assert.equal(contract.producer.jobId, 8)
})
test('pre-seal contract does not convert incomplete manifest into complete', () => {
  const { args } = stageFixture(); args.manifest.complete = false
  assert.throws(() => buildPreSealBootstrapContract(args), /STAGING_MANIFEST_INVALID/)
  assert.equal(args.manifest.complete, false)
})
test('pre-seal contract refuses unverified smoke, changed binary and wrong target', () => {
  let f = stageFixture(); f.args.sourceMembers.delete(f.bootstrapSmokes.akshare.path)
  assert.throws(() => buildPreSealBootstrapContract(f.args), /STAGING_SMOKE_SOURCE_NOT_VERIFIED/)
  f = stageFixture(); fs.appendFileSync(path.join(f.args.runtimeRoot, f.args.manifest.python.executable), 'changed')
  assert.throws(() => buildPreSealBootstrapContract(f.args), /STAGING_EXECUTABLE_BYTES/)
  f = stageFixture(); f.args.trustedContext.assemblyTarget = 'not-current-native'
  assert.throws(() => buildPreSealBootstrapContract(f.args), /STAGING_MANIFEST_INVALID/)
})
test('stage CLI without separate protected authorization never falls back to fixture or final assembly', () => {
  const child = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/seal-private-python-runtime-producer.cjs'), '--stage', '--input', 'not-present.json'],
    { env: { ...process.env, GITHUB_ACTIONS: 'false' }, encoding: 'utf8', timeout: 10000 })
  assert.equal(child.status, 2)
  assert.equal(JSON.parse(child.stdout).reasons[0].code, 'PROTECTED_CONTEXT_REQUIRED')
})
test('staging input pins bind actual independent authorization to all four raw materials', () => {
  const names = ['formalLockSha256', 'candidateLockSha256', 'fragmentSha256', 'handoffSha256']
  const bytes = Object.fromEntries(names.map(name => [name, Buffer.from('raw ' + name)]))
  const pins = Object.fromEntries(names.map(name => [name, sha(bytes[name])]))
  assert.doesNotThrow(() => entry.verifyStagingInputPins(bytes, pins))
  for (const name of names) {
    const changed = { ...bytes, [name]: Buffer.from('changed') }
    assert.throws(() => entry.verifyStagingInputPins(changed, pins), /STAGING_APPROVED_INPUT_BYTES_MISMATCH/)
  }
  assert.throws(() => entry.verifyStagingInputPins(bytes, { approved: true }), /STAGING_INPUT_AUTHORIZATION_REQUIRED/)
})
test('staging refuses self-consistent application bytes not matching approved source members', () => {
  const sourceNames = ['resources/python-runtime/bootstrap.py', 'resources/python-runtime/miniracer_unicode_adapter.py',
    'resources/python-runtime/pywencai_adapter.py', 'electron/shared/privatePythonRuntimeManifest.cjs']
  for (const sourceName of sourceNames) {
    const { args } = stageFixture()
    args.sourceMembers.set(sourceName, B)
    assert.throws(() => buildPreSealBootstrapContract(args), /STAGING_APPLICATION_SOURCE_BYTES/)
  }
})
function currentStageJobFixture(mutate) {
  const target = process.platform + '-' + process.arch
  const policy = { target, workflowPath: '.github/workflows/native-prepare.yml', jobName: 'Native prepare (' + target + ')',
    allowedEvents: ['workflow_dispatch'] }
  const context = { repositoryId: 7, repositoryFullName: 'test/runtime', approvedSourceCommit: C,
    producers: [{ target, runId: 1, attempt: 1, jobId: 2, fragmentArtifactId: 3, artifactArchiveSha256: A }] }
  const run = { id: 100, run_attempt: 2, repository: { id: 7 }, head_repository: { id: 7 }, head_sha: C,
    path: policy.workflowPath, event: 'workflow_dispatch', status: 'in_progress', conclusion: null }
  const job = { id: 200, run_id: 100, run_attempt: 2, head_sha: C, name: policy.jobName, status: 'in_progress', conclusion: null }
  const response = { total_count: 2, jobs: [job, { ...job, id: 201, name: 'Other exact job' }] }
  const fixture = { target, policy, context, run, job, response, calls: [] }
  if (mutate) mutate(fixture)
  fixture.resolve = () => entry.resolveStageProducer({ target, policy, trustedContext: context, run, runId: 100, attempt: 2,
    authority: { async readJson(apiPath) {
      fixture.calls.push(apiPath)
      assert.equal(apiPath, '/repos/test/runtime/actions/runs/100/attempts/2/jobs?per_page=100')
      return response
    } } })
  return fixture
}
test('stage derives unique current producer from official attempt jobs without any preauthorized job ID', async () => {
  const f = currentStageJobFixture(), saved = structuredClone(f.context.producers)
  assert.deepEqual(await f.resolve(), { target: f.target, runId: 100, attempt: 2, workflowPath: f.policy.workflowPath,
    jobId: 200, jobName: f.policy.jobName })
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.context.producers, saved, 'final completed producer roots are not mutated by resolution')
})
for (const [name, mutate] of [
  ['impostor job name', f => { f.job.name += ' spoof' }],
  ['duplicate exact job', f => { f.response.jobs.push({ ...f.job, id: 202 }); f.response.total_count++ }],
  ['old completed run', f => { f.run.status = 'completed'; f.run.conclusion = 'success' }],
  ['wrong run ID', f => { f.run.id = 99 }],
  ['old run job', f => { f.job.run_id = 99 }],
  ['old attempt', f => { f.job.run_attempt = 1 }],
  ['wrong repository', f => { f.run.repository.id = 8 }],
  ['fork head repository', f => { f.run.head_repository.id = 8 }],
  ['different source commit', f => { f.job.head_sha = 'd'.repeat(40) }],
  ['different official workflow', f => { f.run.path = '.github/workflows/impostor.yml' }],
  ['different event', f => { f.run.event = 'push' }],
  ['completed job', f => { f.job.status = 'completed'; f.job.conclusion = 'success' }],
  ['queued job', f => { f.job.status = 'queued' }],
  ['incomplete job list', f => { f.response.total_count++ }],
  ['request-like job ID in policy', f => { f.policy.jobId = 200 }],
  ['wrong native target', f => { f.policy.target = 'not-this-native-target' }],
]) test('current stage producer rejects ' + name, async () => {
  const fixture = currentStageJobFixture(mutate)
  await assert.rejects(fixture.resolve())
})
function nativeHostPinFixture() {
  const root = temporary(), name = 'resources/private-runtime-owned-job-host.cs'
  const filename = path.join(root, name), bytes = Buffer.from('// Synthetic host pin fixture, never compiled.\n')
  fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes)
  const pin = { path: name, sha256: sha(bytes) }, members = new Map([[name, pin.sha256]])
  return { root, filename, pin, members }
}
test('native host spec carries canonical actual source path and independently verified raw SHA', () => {
  const f = nativeHostPinFixture()
  assert.deepEqual(entry.verifiedNativeHostSource(f.pin, f.members, f.root),
    { path: path.join(fs.realpathSync(f.root), f.pin.path), sha256: f.pin.sha256 })
})
test('native host source requires a separate authorization pin', () => {
  const f = nativeHostPinFixture()
  assert.throws(() => entry.verifiedNativeHostSource(undefined, f.members, f.root), /STAGING_NATIVE_HOST_PIN_REQUIRED/)
})
test('native host rejects fake authorization SHA before compiling anything', () => {
  const f = nativeHostPinFixture()
  assert.throws(() => entry.verifiedNativeHostSource({ ...f.pin, sha256: B }, f.members, f.root), /STAGING_NATIVE_HOST_SOURCE_NOT_VERIFIED/)
})
test('native host rejects self-consistent fake pin not matching actual source bytes', () => {
  const f = nativeHostPinFixture(); f.pin.sha256 = B; f.members.set(f.pin.path, B)
  assert.throws(() => entry.verifiedNativeHostSource(f.pin, f.members, f.root), /STAGING_NATIVE_HOST_SOURCE_CHANGED/)
})
test('native host refuses missing official source membership', () => {
  const f = nativeHostPinFixture(); f.members.delete(f.pin.path)
  assert.throws(() => entry.verifiedNativeHostSource(f.pin, f.members, f.root), /STAGING_NATIVE_HOST_SOURCE_NOT_VERIFIED/)
})
test('native host rejects source byte changes after the independent pin', () => {
  const f = nativeHostPinFixture(); fs.appendFileSync(f.filename, '// changed\n')
  assert.throws(() => entry.verifiedNativeHostSource(f.pin, f.members, f.root), /STAGING_NATIVE_HOST_SOURCE_CHANGED/)
})
test('native host refuses alternate paths and approved=true in place of source authority', () => {
  const f = nativeHostPinFixture()
  assert.throws(() => entry.verifiedNativeHostSource({ ...f.pin, path: '../private-runtime-owned-job-host.cs' }, f.members, f.root), /STAGING_NATIVE_HOST_SOURCE_NOT_VERIFIED/)
  assert.throws(() => entry.verifiedNativeHostSource({ approved: true }, f.members, f.root), /STAGING_NATIVE_HOST_SOURCE_NOT_VERIFIED/)
})
// Execute the actual production call site and its exit guard, not a separately
// reconstructed argv. The supervisor is synthetic: this is not native evidence.
function stageExecutionFixture(platform, arch = 'x64', change) {
  const source = entry.runProducer.toString()
  const begin = source.indexOf('const execution = await supervisor.runOwnedPrivatePython(')
  const end = source.indexOf('const nativeReportBytes = execution.stdout', begin)
  assert.ok(begin >= 0 && end > begin)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const invoke = new AsyncFunction('supervisor', 'contract', 'ROOT', 'reporter', 'contractPath',
    'path', 'Buffer', 'process', 'ownershipMode', 'nativeHostSource', 'fail',
    source.slice(begin, end) + '\nreturn execution')
  const root = path.resolve(__dirname, '../..'), contractPath = path.join(root, 'synthetic-stage-contract.json')
  const reporter = { path: 'scripts/report-private-runtime-native-bootstrap.py' }
  const contract = { pythonExecutable: path.join(root, 'synthetic-private-python'),
    reporterCwd: root, reporterEnvironment: { PATH: 'synthetic-private-node-only' } }
  const ownershipMode = platform === 'win32' ? 'windows-job' : 'posix-owned-session'
  const nativeHostSource = platform === 'win32' ? { path: 'synthetic-verified-host.cs', sha256: A } : undefined
  const execution = { pid: 42, exitCode: 0, signal: null, exitObserved: true, ownedTreeEmpty: true,
    ownershipMode, stdout: Buffer.from('{"synthetic":true}'), stderr: Buffer.alloc(0) }
  if (change) change(execution)
  const calls = []
  return { root, contractPath, reporter, contract, nativeHostSource, calls,
    run: () => invoke({ async runOwnedPrivatePython(spec) { calls.push(spec); return execution } },
      contract, root, reporter, contractPath, path, Buffer, { platform, arch }, ownershipMode, nativeHostSource,
      code => { throw new Error(code) }) }
}
for (const target of targets) test('actual stage call keeps exact eight argv and native ownership mode for ' + target, async () => {
  const [platform, arch] = target.split('-'), f = stageExecutionFixture(platform, arch)
  await f.run()
  assert.equal(f.calls.length, 1)
  const spec = f.calls[0]
  assert.deepEqual(spec.args, ['-X', 'utf8', '-I', '-S', '-B', path.join(f.root, f.reporter.path),
    '--pre-seal-bootstrap-contract', f.contractPath])
  assert.equal(spec.executable, f.contract.pythonExecutable)
  assert.equal(spec.env, f.contract.reporterEnvironment)
  assert.equal(spec.cwd, f.contract.reporterCwd)
  assert.equal(spec.shell, false)
  assert.equal(spec.deadlineMs, 300000)
  assert.equal(spec.stdoutByteCap, 1024 * 1024)
  assert.equal(spec.stderrByteCap, 8192)
  assert.equal(spec.input.length, 0)
  assert.equal(spec.ownershipMode, platform === 'win32' ? 'windows-job' : 'posix-owned-session')
  assert.equal(Object.hasOwn(spec, 'preSealPosixInherited'), platform === 'darwin')
  if (platform === 'darwin') assert.equal(spec.preSealPosixInherited, true)
  assert.equal(Object.hasOwn(spec, 'nativeHostSource'), platform === 'win32')
  if (platform === 'win32') assert.deepEqual(spec.nativeHostSource, f.nativeHostSource)
})
for (const [name, change] of [
  ['nonzero exit', e => { e.exitCode = 7 }],
  ['unobserved exit', e => { e.exitObserved = false }],
  ['nonempty owned tree', e => { e.ownedTreeEmpty = false }],
  ['wrong ownership mode', e => { e.ownershipMode = 'not-owned' }],
  ['signal', e => { e.signal = 'SIGTERM' }],
  ['execution error', e => { e.error = true }],
  ['invalid PID', e => { e.pid = 0 }],
  ['stderr', e => { e.stderr = Buffer.from('synthetic failure') }],
  ['empty stdout', e => { e.stdout = Buffer.alloc(0) }],
  ['oversize stdout', e => { e.stdout = Buffer.alloc(1024 * 1024 + 1) }],
]) test('actual stage exit guard rejects ' + name + ' with POSIX inheritance enabled', async () => {
  const f = stageExecutionFixture('darwin', 'arm64', change)
  await assert.rejects(f.run(), /STAGING_NATIVE_REPORTER_FAILED/)
  assert.equal(f.calls.length, 1)
})
test('stage still requires protected authorization before input access on the native host', async () => {
  await assert.rejects(entry.runProducer('not-present.json', {}, true), error =>
    error.code === 'PROTECTED_CONTEXT_REQUIRED' && error.sealStatus === 'pending')
})
