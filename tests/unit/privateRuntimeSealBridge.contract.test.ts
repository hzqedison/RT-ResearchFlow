import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { verifySourceAuthority, verifyProducers, verifyObligationCoverage, sealPrivateRuntime,
  githubAuthority, executionAssets, digest, REQUIRED_SOURCE, PREPARATION_SOURCE, TARGETS, executionOrigin, crc32, unresolvedPending,
  preparationBytes, verifyPreparationBinding } = require('../../scripts/seal-private-python-runtime.cjs')
const H = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const O = (value: Buffer) => createHash('sha1').update(Buffer.from('blob ' + value.length + '\0')).update(value).digest('hex')
const roots: string[] = []
const { makeFixture } = require('./fixtures/privateRuntimeSealFixture.cjs')
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('rt-seal-contract-')) throw new Error('unsafe fixture cleanup')
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// All authority responses here are explicitly synthetic. These tests demonstrate
// gate behavior, not GitHub authorization, native relinking or a release approval.
function sourceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-seal-contract-')); roots.push(root)
  const names = [...REQUIRED_SOURCE, 'resources/python-runtime/distribution-obligations.policy.json',
    'resources/python-runtime/license-review.md', '.github/workflows/test-producer.yml']
  const responses = new Map<string, any>(), files: any[] = [], trees = new Map<string, any[]>()
  const repo = 'fixture/private-runtime', prefix = '/repos/' + repo, commit = 'a'.repeat(40), tree = 'b'.repeat(40)
  trees.set('', [])
  for (const name of names) {
    const bytes = Buffer.from('synthetic-source:' + name), blob = O(bytes)
    const filename = path.join(root, name); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes)
    files.push({ path: name, mode: '100644', blobOid: blob, size: bytes.length, sha256: H(bytes) })
    responses.set(prefix + '/git/blobs/' + blob, { sha: blob, encoding: 'base64', size: bytes.length, content: bytes.toString('base64') })
    const parts = name.split('/'); let parent = ''
    for (const part of parts.slice(0, -1)) {
      const current = parent ? parent + '/' + part : part
      if (!trees.has(current)) {
        trees.set(current, [])
        trees.get(parent)!.push({ path: part, mode: '040000', type: 'tree', sha: H(current).slice(0, 40) })
      }
      parent = current
    }
    trees.get(parent)!.push({ path: parts.at(-1), mode: '100644', type: 'blob', sha: blob })
  }
  for (const [name, entries] of trees) responses.set(prefix + '/git/trees/' + (name ? H(name).slice(0, 40) : tree), { sha: name ? H(name).slice(0, 40) : tree, truncated: false, tree: entries })
  responses.set(prefix, { id: 42, full_name: repo })
  responses.set(prefix + '/git/commits/' + commit, { sha: commit, tree: { sha: tree } })
  const pin = (name: string) => files.find(file => file.path === name)!.sha256
  const trust: any = { repositoryId: 42, repositoryFullName: repo, approvedSourceCommit: commit,
    approvedPolicySha256: pin('resources/python-runtime/preparation.policy.json'), approvedSealImplementationSha256: pin('scripts/seal-private-python-runtime.cjs'),
    sourceSnapshotSha256: H('snapshot'), requiredSourceFiles: names, obligationPolicySha256: pin('resources/python-runtime/distribution-obligations.policy.json') }
  const proof: any = { kind: 'github-tree-membership-v1', repositoryId: 42, sourceCommit: commit, rootTreeOid: tree,
    policySha256: trust.approvedPolicySha256, sourceSnapshotSha256: trust.sourceSnapshotSha256, files }
  const authority: any = { async readJson(endpoint: string) {
    if (!responses.has(endpoint)) throw new Error('unexpected synthetic authority endpoint')
    return structuredClone(responses.get(endpoint))
  } }
  return { root, prefix, trust, proof, files, responses, pin, authority }
}


describe('exact ten-member preparation snapshot', () => {
  it('requires the actual ten consumed sources in source authority and preparation', () => {
    expect(PREPARATION_SOURCE).toEqual([
      'electron/shared/privatePythonRuntimeManifest.cjs',
      'resources/python-runtime/bootstrap.py',
      'resources/python-runtime/miniracer_unicode_adapter.py',
      'resources/python-runtime/pywencai_adapter.py',
      'scripts/build-mootdx-compat-wheel.py',
      'scripts/build-provider-source-wheels.py',
      'scripts/prepare-private-python-runtime.py',
      'scripts/rebuild-lxml-native.py',
      'scripts/build-lxml-redistribution-wheel.py',
      'scripts/build-lxml-matched-public-source.py',
    ].sort())
    expect(PREPARATION_SOURCE.every((name: string) => REQUIRED_SOURCE.includes(name))).toBe(true)
  })
  it.each(['old-seven', 'missing', 'extra', 'duplicate', 'replacement', 'order',
    'member-sha', 'snapshot-digest', 'candidate-snapshot'])('rejects %s even with rebound candidate/fragment byte hashes', kind => {
    const policySha = H('synthetic-policy'), sourceMembers = new Map<string, string>(
      PREPARATION_SOURCE.map((name: string) => [name, H('synthetic-bytes:' + name)]))
    let names = [...PREPARATION_SOURCE]
    if (kind === 'old-seven') names = names.filter((name: string) => ![
      'scripts/rebuild-lxml-native.py', 'scripts/build-lxml-redistribution-wheel.py',
      'scripts/build-lxml-matched-public-source.py'].includes(name))
    if (kind === 'missing') names.pop()
    if (kind === 'extra') names.push('scripts/unconsumed.py')
    if (kind === 'duplicate') names[names.length - 1] = names[0]
    if (kind === 'replacement') {
      names[names.indexOf('scripts/build-lxml-matched-public-source.py')] = 'scripts/unconsumed.py'
      sourceMembers.set('scripts/unconsumed.py', H('unconsumed-but-source-verified'))
    }
    names.sort()
    if (kind === 'order') names.reverse()
    const snapshot = { policySha256: policySha, files: names.map((name: string) =>
      ({ path: name, sha256: sourceMembers.get(name) ?? H(name) })) }
    if (kind === 'member-sha') snapshot.files[0].sha256 = H('wrong-member-bytes')
    const snapshotSha = kind === 'snapshot-digest' ? H('wrong-summary') : H(preparationBytes(snapshot))
    const candidate: any = { kind: 'rt-private-python-candidate-lock', schemaVersion: 1,
      status: 'candidate', target: TARGETS[0], resolutionComplete: true,
      sourceSha256: snapshotSha, preparationPolicySha256: policySha, sourceSnapshot: structuredClone(snapshot) }
    if (kind === 'candidate-snapshot') candidate.sourceSnapshot.files[0].sha256 = H('candidate-divergence')
    const candidateBytes = preparationBytes(candidate)
    const fragment = { kind: 'rt-private-python-candidate-fragment', schemaVersion: 1,
      status: 'candidate', target: TARGETS[0], treeComplete: true, inputLockSha256: H(candidateBytes),
      sourceSha256: snapshotSha, preparationPolicySha256: policySha, sourceSnapshot: snapshot }
    const fragmentBytes = preparationBytes(fragment)
    const handoff = { kind: 'rt-private-python-preparation-handoff', status: 'candidate',
      resolutionComplete: true, treeComplete: true,
      lock: { sha256: H(candidateBytes) }, fragment: { sha256: H(fragmentBytes) } }
    expect(() => verifyPreparationBinding({ target: TARGETS[0], manifest: {}, candidateLockBytes: candidateBytes,
      fragmentBytes, handoffBytes: preparationBytes(handoff), sourceMembers,
      trust: { approvedPolicySha256: policySha, sourceSnapshotSha256: snapshotSha } }))
      .toThrow('PREPARATION_SOURCE_SNAPSHOT')
  })
})

describe('private runtime seal authority contract', () => {
  it('checks authority blobs and current bytes, not a sourceVerified Boolean', async () => {
    const f = sourceFixture(); f.proof.sourceVerified = true
    const result = await verifySourceAuthority(f.trust, f.proof, f.root, f.authority)
    expect(result.verified.size).toBe(f.files.length)
  })
  it.each(['repository', 'commit', 'policy', 'implementation', 'snapshot', 'tree', 'coverage', 'blob', 'local-bytes', 'mode', 'truncated', 'lfs'])('rejects or defers %s evidence', async kind => {
    const f = sourceFixture(), file = f.files[0]
    if (kind === 'repository') f.responses.get(f.prefix).id = 43
    if (kind === 'commit') f.proof.sourceCommit = 'c'.repeat(40)
    if (kind === 'policy') f.proof.policySha256 = H('other-policy')
    if (kind === 'implementation') f.trust.approvedSealImplementationSha256 = H('other-implementation')
    if (kind === 'snapshot') f.proof.sourceSnapshotSha256 = H('other-snapshot')
    if (kind === 'tree') f.proof.rootTreeOid = 'c'.repeat(40)
    if (kind === 'coverage') f.proof.files.pop()
    if (kind === 'blob') f.responses.get(f.prefix + '/git/blobs/' + file.blobOid).content = Buffer.from('changed').toString('base64')
    if (kind === 'local-bytes') fs.appendFileSync(path.join(f.root, file.path), '\r\n')
    if (kind === 'mode') file.mode = '120000'
    if (kind === 'truncated') f.responses.get(f.prefix + '/git/trees/' + f.proof.rootTreeOid).truncated = true
    if (kind === 'lfs') {
      const bytes = Buffer.from('version https://git-lfs.github.com/spec/v1\n'), old = file.blobOid
      file.blobOid = O(bytes); file.size = bytes.length; file.sha256 = H(bytes)
      f.responses.set(f.prefix + '/git/blobs/' + file.blobOid, { sha: file.blobOid, encoding: 'base64', size: bytes.length, content: bytes.toString('base64') })
      for (const response of f.responses.values()) if (Array.isArray(response.tree)) for (const item of response.tree) if (item.sha === old) item.sha = file.blobOid
      fs.writeFileSync(path.join(f.root, file.path), bytes)
    }
    await expect(verifySourceAuthority(f.trust, f.proof, f.root, f.authority)).rejects.toThrow()
  })
  it('rejects caller endpoints without creating a network request', () => {
    const authority = githubAuthority()
    for (const endpoint of ['https://evil.example/', '//evil.example/', '/repos/o/r/../secret\n', '/user']) expect(() => authority.readJson(endpoint)).toThrow('INVALID_GITHUB_ENDPOINT')
  })
  it('ordinary invocation has no protected context and no assembly', async () => {
    const result = await sealPrivateRuntime({})
    expect(result).toMatchObject({ status: 'pending', releaseEligible: false, reasons: [{ code: 'PROTECTED_CONTEXT_REQUIRED' }] })
  })
  it('rejects a different verified checkout as the actual executing module origin', async () => {
    const f = sourceFixture()
    await verifySourceAuthority(f.trust, f.proof, f.root, f.authority)
    expect(() => executionOrigin(f.root)).toThrow('EXECUTION_SOURCE_ROOT_MISMATCH')
  })
  it('cannot discharge unknown or native pending using caller strings', () => {
    expect(() => unresolvedPending({ 'win32-x64': { pending: ['production-native-bootstrap'] } }, new Set(['source']))).toThrow('PREPARATION_PENDING_REMAINS')
    expect(() => unresolvedPending({ 'win32-x64': { pending: ['unknown'] } }, new Set(['source', 'native', 'assembly']))).toThrow('PREPARATION_PENDING_REMAINS')
    expect(() => unresolvedPending({ 'win32-x64': { pending: [true] } }, new Set(['source', 'native', 'assembly']))).toThrow('PREPARATION_PENDING_TYPE')
  })
})

function zipFixture(members: Record<string, Buffer>) {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0
  for (const [name, bytes] of Object.entries(members)) {
    const encoded = Buffer.from(name), header = Buffer.alloc(30), entry = Buffer.alloc(46), crc = crc32(bytes)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(encoded.length, 26)
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(encoded.length, 28); entry.writeUInt32LE(offset, 42)
    locals.push(header, encoded, bytes); central.push(entry, encoded); offset += header.length + encoded.length + bytes.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22), count = Object.keys(members).length
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

function producerFixture() {
  const f = sourceFixture(), bindings: any = { sourceMembers: new Map(f.files.map(file => [file.path, file.sha256])) }
  f.trust.producers = []; f.proof.producers = []; const archives = new Map()
  for (const [index, target] of TARGETS.entries()) {
    const row = { target, runId: '123', attempt: 2, workflowPath: '.github/workflows/test-producer.yml',
      workflowBlobOid: f.files.at(-1)!.blobOid, workflowSha256: f.pin('.github/workflows/test-producer.yml'),
      jobId: index + 1, jobName: target, fragmentArtifactId: 10 + index, artifactName: 'fixture-' + target,
      artifactArchiveSha256: H('archive-' + target), fragmentMember: target + '/candidate-fragment.json', allowedEvents: ['workflow_dispatch'] }
    const members = Object.fromEntries(['fragment', 'candidateLock', 'handoff', 'nativeReport'].map(name => [name, target + '/' + name + '.json']))
    const content = Object.fromEntries(Object.keys(members).map(name => [name, Buffer.from(name + '-' + target)]))
    const archive = zipFixture(Object.fromEntries(Object.entries(members).map(([name, member]) => [member, content[name]])))
    Object.assign(row, { members, artifactArchiveSha256: H(archive) }); archives.set(row.fragmentArtifactId, archive)
    bindings[target] = { fragmentSha256: H(content.fragment), ...Object.fromEntries(Object.entries(content).map(([name, bytes]) => [name + 'Bytes', bytes])) }
    f.trust.producers.push(row); f.proof.producers.push({ ...row, fragmentSha256: bindings[target].fragmentSha256 })
    f.responses.set(f.prefix + '/actions/runs/123/attempts/2', { repository: { id: 42 }, head_repository: { id: 42 },
      head_sha: f.trust.approvedSourceCommit, path: row.workflowPath, run_attempt: 2, event: 'workflow_dispatch', status: 'in_progress' })
    f.responses.set(f.prefix + '/actions/jobs/' + row.jobId, { id: row.jobId, run_id: 123, run_attempt: 2, head_sha: f.trust.approvedSourceCommit,
      name: target, status: 'completed', conclusion: 'success' })
    f.responses.set(f.prefix + '/actions/artifacts/' + row.fragmentArtifactId, { id: row.fragmentArtifactId, expired: false,
      workflow_run: { id: 123, head_sha: f.trust.approvedSourceCommit }, name: row.artifactName, digest: 'sha256:' + row.artifactArchiveSha256 })
  }
  f.authority.readArtifactArchive = async ({ artifactId }: any) => archives.get(artifactId)
  return { ...f, bindings }
}
describe('per-target upstream producer gates', () => {
  it('does not deadlock on a still-running workflow with all three upstream jobs successful', async () => {
    const f = producerFixture(); await expect(verifyProducers(f.trust, f.proof, f.authority, f.bindings)).resolves.toBeUndefined()
  })
  it.each(['mac-failure', 'fork', 'head', 'attempt', 'archive', 'extracted-member', 'missing-verifier', 'workflow'])('refuses %s rather than borrowing Windows success', async kind => {
    const f = producerFixture(), run = f.responses.get(f.prefix + '/actions/runs/123/attempts/2')
    if (kind === 'mac-failure') f.responses.get(f.prefix + '/actions/jobs/2').conclusion = 'failure'
    if (kind === 'fork') run.head_repository.id = 999
    if (kind === 'head') run.head_sha = 'c'.repeat(40)
    if (kind === 'attempt') run.run_attempt = 1
    if (kind === 'archive') f.responses.get(f.prefix + '/actions/artifacts/10').digest = 'sha256:' + H('other')
    if (kind === 'extracted-member') f.bindings[TARGETS[0]].fragmentBytes = Buffer.from('changed')
    if (kind === 'missing-verifier') delete f.authority.readArtifactArchive
    if (kind === 'workflow') f.bindings.sourceMembers.clear()
    await expect(verifyProducers(f.trust, f.proof, f.authority, f.bindings)).rejects.toThrow()
  })
})

function obligationFixture() {
  const f = sourceFixture(), manifests: any = {}, rules: any = { schemaVersion: 1, kind: 'rt-runtime-distribution-obligation-policy-v1',
    preparationPolicySha256: f.trust.approvedPolicySha256, assets: [] }, proof: any = { kind: 'runtime-distribution-obligations-v1',
    policySha256: f.trust.approvedPolicySha256, sourceSnapshotSha256: f.trust.sourceSnapshotSha256, targets: [] }
  for (const target of TARGETS) {
    const notice = Buffer.from('fixture original notice'), index = Buffer.from('licenses/NOTICE.txt\n')
    for (const [name, bytes] of [['licenses/NOTICE.txt', notice], ['licenses/index.txt', index]] as const) {
      const filename = path.join(f.root, target, name); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes)
    }
    const manifest = { python: { version: '3.13.16', asset: { sha256: H('python') } }, node: { version: '22.23.3', asset: { sha256: H('node') } },
      providers: { fixture: { wheels: [{ distribution: 'fixture', version: '1', asset: { sha256: H('wheel') } }], dependencyAudit: { path: 'fixture-audit', sha256: H('audit') } } },
      files: [{ kind: 'file', path: 'licenses/NOTICE.txt', sha256: H(notice) }, { kind: 'file', path: 'licenses/index.txt', sha256: H(index) }] }
    manifests[target] = manifest
    for (const asset of executionAssets(manifest)) rules.assets.push({ target, ...asset, classification: 'notice-only', obligations: [],
      reviewRecord: { path: 'resources/python-runtime/license-review.md', sha256: f.pin('resources/python-runtime/license-review.md') } })
    proof.targets.push({ target, artifactSetSha256: digest(executionAssets(manifest)), inventorySha256: digest(manifest.files),
      dependencyAuditSha256: digest([{ name: 'fixture', ...manifest.providers.fixture.dependencyAudit }]), reviews: [] })
  }
  const args: any = { trust: f.trust, proof, rules, manifests, preparedRoot: f.root,
    sourceMembers: new Map(f.files.map(file => [file.path, file.sha256])), authority: f.authority }
  function noticeRule(format = 'original-notice-bytes') {
    const rule = rules.assets[0]
    rule.classification = 'additional-obligations'
    const obligation = { id: 'fixture-notice', kind: 'notice-payload', scope: { component: 'fixture', version: '1', licenseSha256: H('fixture original notice') },
      requiredEvidence: [format], payloadFiles: [{ path: 'licenses/NOTICE.txt', sha256: H('fixture original notice') }] }
    rule.obligations.push(obligation)
    proof.targets[0].reviews.push({ id: obligation.id, component: rule.component, version: rule.version, artifactSha256: rule.artifactSha256,
      licenseSha256: obligation.scope.licenseSha256, obligation: obligation.kind, decision: 'satisfied',
      reviewRecord: { ...rule.reviewRecord, authorizationCommit: f.trust.approvedSourceCommit }, payloadFiles: obligation.payloadFiles,
      evidence: [{ id: 'fixture-evidence', path: 'licenses/NOTICE.txt', sha256: H('fixture original notice'), format }] })
    return { rule, obligation, review: proof.targets[0].reviews[0] }
  }
  return { ...f, args, noticeRule }
}
describe('precise obligations coverage, no automated license approval', () => {
  it('mechanically matches all previously reviewed notice-only execution assets', async () => {
    const f = obligationFixture(); await expect(verifyObligationCoverage(f.args)).resolves.toBeUndefined()
  })
  it('checks actual original notice bytes', async () => {
    const f = obligationFixture(); f.noticeRule(); await expect(verifyObligationCoverage(f.args)).resolves.toBeUndefined()
  })
  it.each(['missing-rules', 'empty-rules', 'duplicate-asset', 'replaced-asset', 'bad-review-source', 'wrong-inventory', 'missing-review',
    'altered-notice', 'unknown-format', 'missing-native-verifier', 'fake-absence', 'extra-review'])('fails closed for %s', async kind => {
    const f = obligationFixture()
    if (kind === 'missing-rules') f.args.rules = undefined
    if (kind === 'empty-rules') f.args.rules.assets = []
    if (kind === 'duplicate-asset') f.args.rules.assets.push(structuredClone(f.args.rules.assets[0]))
    if (kind === 'replaced-asset') f.args.rules.assets[0].artifactSha256 = H('other-executable')
    if (kind === 'bad-review-source') f.args.sourceMembers.clear()
    if (kind === 'wrong-inventory') f.args.proof.targets[0].inventorySha256 = H('other')
    if (kind === 'missing-review') { f.noticeRule(); f.args.proof.targets[0].reviews = [] }
    if (kind === 'altered-notice') { f.noticeRule(); fs.appendFileSync(path.join(f.root, TARGETS[0], 'licenses/NOTICE.txt'), 'changed') }
    if (kind === 'unknown-format') f.noticeRule('made-up-pass')
    if (kind === 'missing-native-verifier') f.noticeRule('native-relink-result')
    if (kind === 'fake-absence') f.noticeRule().review.decision = 'not-applicable'
    if (kind === 'extra-review') f.args.proof.targets[0].reviews.push({ id: 'not-approved' })
    await expect(verifyObligationCoverage(f.args)).rejects.toThrow()
  })
})

describe('faithful candidate schema through actual assembler and validator', () => {
  function completeFixture(options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-seal-contract-')); roots.push(root)
    return makeFixture(path.resolve(__dirname, '../..'), root, options)
  }
  it('checks three synthetic producers and actually assembles the native target without adding resolutionComplete to fragment', async () => {
    const f = completeFixture(), result = await f.seal(f.input, f.authority)
    expect(f.fragmentData[TARGETS[0]].resolutionComplete).toBeUndefined()
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'accepted', stage: 'pre-sign-native-assembly', releaseEligible: false })
    expect(result.verifiedProducerTargets).toEqual(TARGETS)
    expect(result.outputs.map((row: any) => row.target)).toEqual([process.platform + '-' + process.arch])
    expect(fs.existsSync(path.join(f.input.outputRoot, process.platform + '-' + process.arch, 'manifest.json'))).toBe(true)
  })
  it.each(['lock-bytes', 'inventory', 'audit', 'native-report', 'handoff', 'source-snapshot', 'native-verifier', 'native-pending'])('refuses altered or missing %s evidence', async kind => {
    const f = completeFixture(kind === 'native-pending' ? { pending: ['Full manifest production bootstrap/Unicode adapter acceptance remains a separate gate'] } : {}), preparation = f.input.preparations[TARGETS[0]]
    if (kind === 'lock-bytes') fs.appendFileSync(preparation.candidateLockPath, ' ')
    if (kind === 'inventory') fs.appendFileSync(path.join(f.input.preparedRoot, TARGETS[0], 'licenses/FIXTURE.txt'), 'changed')
    if (kind === 'audit') fs.appendFileSync(path.join(f.input.preparedRoot, TARGETS[0], 'providers/akshare/dependency-audit.json'), ' ')
    if (kind === 'native-report') fs.writeFileSync(preparation.nativeReportPath, JSON.stringify({ kind: 'imports-only', ok: true }))
    if (kind === 'handoff') fs.writeFileSync(preparation.handoffPath, JSON.stringify({ resolutionComplete: true, treeComplete: true }))
    if (kind === 'source-snapshot') {
      const value = JSON.parse(fs.readFileSync(preparation.fragmentPath, 'utf8')); value.sourceSnapshot.files[0].sha256 = H('other'); fs.writeFileSync(preparation.fragmentPath, JSON.stringify(value))
    }
    if (kind === 'native-verifier') delete f.authority.verifyNativeBootstrap
    if (kind === 'native-pending') {
      f.input.trustedContext.dischargedIntegrationCodes = ['Full manifest production bootstrap/Unicode adapter acceptance remains a separate gate']
      f.authority.verifyNativeBootstrap = async () => ({ status: 'pending' })
    }
    const result = await f.seal(f.input, f.authority)
    expect(result.status).not.toBe('accepted'); expect(result.releaseEligible).toBe(false)
    expect(fs.existsSync(f.input.outputRoot)).toBe(false)
    if (kind === 'native-verifier') expect(result.reasons[0].code).toBe('NATIVE_BOOTSTRAP_VERIFIER_MISSING')
    if (kind === 'native-pending') expect(result.reasons[0].code).toBe('NATIVE_BOOTSTRAP_VERIFICATION_PENDING')
  })
  it('retains unknown pending after every implemented checker succeeds', async () => {
    const f = completeFixture({ pending: ['unimplemented-new-security-gate'] })
    f.input.trustedContext.dischargedIntegrationCodes = ['unimplemented-new-security-gate']
    const result = await f.seal(f.input, f.authority)
    expect(result).toMatchObject({ status: 'pending', reasons: [{ code: 'PREPARATION_PENDING_REMAINS' }] })
    expect(fs.existsSync(f.input.outputRoot)).toBe(false)
  })
})
