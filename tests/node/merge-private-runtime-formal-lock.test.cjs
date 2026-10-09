'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const merge = require('../../scripts/merge-private-runtime-formal-lock.cjs')
const foundation = require('../../electron/shared/privatePythonRuntimeManifest.cjs')
const { preparationBytes, crc32 } = require('../../scripts/seal-private-python-runtime.cjs')
const { makeFixture } = require('../unit/fixtures/privateRuntimeSealFixture.cjs')
const ROOT = path.resolve(__dirname, '../..')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(process.env.RT_MERGE_TEST_TEMP || ROOT, 'structural-merge-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const f = makeFixture(ROOT, root)
  const policyBytes = fs.readFileSync(path.join(f.input.repositoryRoot, 'resources/python-runtime/preparation.policy.json'))
  const policy = JSON.parse(policyBytes), policySha256 = hash(policyBytes), sourceCommit = f.input.trustedContext.approvedSourceCommit
  const input = { target: 'win32-x64', policySha256, sourceCommit, policy, treeRoot: path.join(f.input.preparedRoot, 'win32-x64') }
  const candidate = structuredClone(f.candidateData[input.target]), fragment = structuredClone(f.fragmentData[input.target])
  // The shared fixture has manifest runtimes; native prepare locks carry policy runtimes only.
  candidate.python = structuredClone(policy.targets[input.target].python)
  candidate.node = structuredClone(policy.targets[input.target].node)
  candidate.sourceCommit = sourceCommit; fragment.sourceCommit = sourceCommit
  fragment.licenseRequirements = []
  const manifest = f.manifests[input.target]
  for (const [component, value] of [['python-build-standalone', manifest.python], ['node', manifest.node],
    ...Object.values(manifest.providers).flatMap(provider => provider.wheels.map(w => [w.distribution, w]))]) {
    for (const license of value.licenses) {
      const approval = policy.licenseApprovals.find(row => row.id === license.approvalId)
      fragment.licenseRequirements.push({ component, version: value.version, artifactSha256: approval.artifactSha256,
        licenseSha256: license.sha256, path: license.path, spdx: license.spdx, approvalId: approval.id, review: license.review })
    }
  }
  fragment.pending = ['No actual bootstrap or publication approval in fixture']
  const candidateBytes = preparationBytes(candidate)
  fragment.inputLockSha256 = hash(candidateBytes)
  const fragmentBytes = preparationBytes(fragment)
  const handoffBytes = preparationBytes({ kind: 'rt-private-python-preparation-handoff', status: 'candidate',
    resolutionComplete: true, treeComplete: true, preparationPolicySha256: policySha256, sourceCommit,
    sourceSha256: candidate.sourceSha256, lock: { sha256: hash(candidateBytes) }, fragment: { sha256: hash(fragmentBytes) } })
  return { ...input, candidate, fragment, candidateBytes, fragmentBytes, handoffBytes, f, root }
}
test('real audit projection preserves constraints and existing approvals without native claims', t => {
  const input = fixture(t), before = preparationBytes(input.fragment)
  const verified = merge.verifyPreparation(input)
  merge.verifyTree(input.treeRoot, input.fragment.inventory)
  const manifest = merge.projectPlatform({ ...input, ...verified })
  foundation.validateManifestShape({ ...manifest, sourceLockSha256: '1'.repeat(64) }, input.target)
  assert.deepEqual(manifest.providers.akshare.wheels[0].requiresDist, ['mini-racer==0.12.4'])
  assert.deepEqual(manifest.providers.akshare.wheels[0].dependencies, ['mini-racer'])
  assert.equal(manifest.releaseEligible, false)
  assert.deepEqual(preparationBytes(input.fragment), before)
  assert.equal(Object.hasOwn(manifest, 'nativeReport'), false)
})
test('tampered candidate binding fails before projection', t => {
  const input = fixture(t); input.candidateBytes = Buffer.from('{}')
  assert.throws(() => merge.verifyPreparation(input), /MERGE_CANDIDATE_INVALID/)
})
test('handoff wrong fragment SHA is rejected', t => {
  const input = fixture(t), h = JSON.parse(input.handoffBytes)
  h.fragment.sha256 = '0'.repeat(64); input.handoffBytes = preparationBytes(h)
  assert.throws(() => merge.verifyPreparation(input), /MERGE_HANDOFF_BINDING/)
})
test('wrong source or policy never grants structural acceptance', t => {
  const input = fixture(t)
  assert.throws(() => merge.verifyPreparation({ ...input, sourceCommit: 'b'.repeat(40) }), /MERGE_POLICY_SOURCE_BINDING/)
  assert.throws(() => merge.verifyPreparation({ ...input, policySha256: 'b'.repeat(64) }), /MERGE_POLICY_SOURCE_BINDING/)
})
test('approval tampering is rejected; pending records are not upgraded', t => {
  const input = fixture(t)
  input.policy.licenseApprovals.find(row => row.id === input.fragment.licenseRequirements[0].approvalId).decision = 'pending'
  assert.throws(() => merge.projectPlatform(input), /MERGE_LICENSE_APPROVAL_BINDING/)
})
test('inventory notices and unexpected files are checked against real tree', t => {
  const input = fixture(t)
  fs.writeFileSync(path.join(input.treeRoot, 'licenses/FIXTURE.txt'), 'tampered')
  assert.throws(() => merge.verifyTree(input.treeRoot, input.fragment.inventory), /MERGE_TREE_FILE_BYTES/)
})
test('audit mutation fails closed', t => {
  const input = fixture(t)
  const file = path.join(input.treeRoot, input.fragment.providers.akshare.dependencyAudit.path)
  fs.writeFileSync(file, '{}')
  assert.throws(() => merge.projectPlatform(input), /MERGE_AUDIT_HASH/)
})
test('CLI rejects missing/duplicate arguments and existing output', t => {
  const input = fixture(t)
  assert.throws(() => merge.options(['--index', '/x']), /MERGE_USAGE/)
  assert.throws(() => merge.options(['--index', '/x', '--index', '/y']), /MERGE_USAGE/)
  assert.throws(() => merge.run({ outputRoot: input.root }), /MERGE_FRESH_OUTPUT_REQUIRED/)
})
test('missing real license evidence keeps projection pending and production validateLock rejects it', t => {
  const input = fixture(t), platforms = structuredClone(input.f.manifests)
  const before = preparationBytes(platforms)
  assert.equal(merge.finalizeStructuralLock(platforms, input.policySha256).structuralValidationPassed, true)
  platforms['win32-x64'].providers.akshare.wheels[0].licenses = []
  const result = merge.finalizeStructuralLock(platforms, input.policySha256)
  assert.equal(result.structuralValidationPassed, false)
  assert.equal(result.lock.status, 'pending')
  assert.equal(result.code, 'LICENSE_EVIDENCE_MISSING')
  assert.equal(result.lock.releaseEligible, false)
  assert.throws(() => foundation.validateLock(result.lock), /PRIVATE_RUNTIME_PENDING/)
  assert.equal(platforms['win32-x64'].providers.akshare.wheels[0].licenses.length, 0)
  assert.notDeepEqual(preparationBytes(platforms), before)
})
function zip(name, data) {
  const n = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22)
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc32(data), 14)
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26)
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6)
  central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(local.length + n.length + data.length, 16)
  return Buffer.concat([local, n, data, central, n, end])
}
test('bounded ZIP reader checks CRC and rejects traversal without extracting files', t => {
  const root = fs.mkdtempSync(path.join(process.env.RT_MERGE_TEST_TEMP || ROOT, 'merge-zip-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const filename = path.join(root, 'fixture.zip'), data = Buffer.from('{"synthetic":true}')
  fs.writeFileSync(filename, zip('handoff.json', data))
  assert.deepEqual(merge.readZipMember(filename, 'handoff.json'), data)
  const corrupt = zip('handoff.json', data); corrupt[30 + 'handoff.json'.length] ^= 1
  fs.writeFileSync(filename, corrupt)
  assert.throws(() => merge.readZipMember(filename, 'handoff.json'), /MERGE_ZIP_MEMBER_BYTES/)
  fs.writeFileSync(filename, zip('../escape.json', data))
  assert.throws(() => merge.readZipMember(filename, 'handoff.json'))
})
