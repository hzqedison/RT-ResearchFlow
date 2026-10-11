'use strict'

// Offline transport fixtures only. None is an approved release or CI result.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { readObligationsProof } = require('../../scripts/run-private-runtime-final-seal-ci.cjs')
const producer = require('../../scripts/seal-private-python-runtime-producer.cjs')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function fixture(t) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rt-proof-transport-')))
  const inputs = path.join(temporary, 'inputs'); fs.mkdirSync(inputs)
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  // Deliberately incomplete proof: only the real seal can judge eligibility.
  const proof = { kind: 'runtime-distribution-obligations-v1', targets: [] }
  const bytes = Buffer.from(JSON.stringify(proof) + '\n')
  const blobOid = crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')
  const commit = '1'.repeat(40), rootTree = '2'.repeat(40), childTree = '3'.repeat(40)
  const pins = { repository: 'fixture/transport' }, prefix = '/repos/' + pins.repository
  const authorization = { obligationsProof: { commit, path: 'review/obligations-proof.json', sha256: hash(bytes) } }
  const responses = new Map([
    [prefix + '/git/commits/' + commit, { sha: commit, tree: { sha: rootTree } }],
    [prefix + '/git/trees/' + rootTree, { sha: rootTree, tree: [{ path: 'review', type: 'tree', mode: '040000', sha: childTree }] }],
    [prefix + '/git/trees/' + childTree, { sha: childTree, tree: [{ path: 'obligations-proof.json', type: 'blob', mode: '100644', sha: blobOid }] }],
    [prefix + '/git/blobs/' + blobOid, { sha: blobOid, encoding: 'base64', content: bytes.toString('base64'), size: bytes.length }],
  ])
  const requests = []
  const authority = { async readJson(endpoint) {
    requests.push(endpoint)
    assert.ok(responses.has(endpoint), 'only exact pinned Git endpoints are requested')
    return responses.get(endpoint)
  } }
  return { temporary, inputs, authorization, pins, authority, proof, bytes, requests, responses,
    root: responses.get(prefix + '/git/trees/' + rootTree),
    child: responses.get(prefix + '/git/trees/' + childTree),
    blob: responses.get(prefix + '/git/blobs/' + blobOid),
    read() { return readObligationsProof(inputs, temporary, authorization, pins, authority) } }
}

test('missing structural-artifact proof uses only explicitly authorized Git bytes', async t => {
  const f = fixture(t)
  assert.deepEqual(await f.read(), f.proof)
  assert.equal(f.requests.length, 4)
})

test('existing downloaded proof remains supported without new authorization fields', async t => {
  const f = fixture(t); delete f.authorization.obligationsProof
  fs.writeFileSync(path.join(f.inputs, 'obligations-proof.json'), f.bytes)
  assert.deepEqual(await f.read(), f.proof)
  assert.equal(f.requests.length, 0)
})

test('missing proof without an explicit pin stops before any authority request', async t => {
  const f = fixture(t); delete f.authorization.obligationsProof
  await assert.rejects(f.read(), { code: 'FINAL_OBLIGATIONS_PROOF_MISSING' })
  assert.equal(f.requests.length, 0)
})

test('a malformed pin cannot fall back to an existing downloaded proof', async t => {
  const f = fixture(t); f.authorization.obligationsProof.path = '../obligations-proof.json'
  fs.writeFileSync(path.join(f.inputs, 'obligations-proof.json'), f.bytes)
  await assert.rejects(f.read(), { code: 'FINAL_OBLIGATIONS_PROOF_PIN' })
  assert.equal(f.requests.length, 0)
})

test('official commit identity mismatch is rejected', async t => {
  const f = fixture(t)
  f.responses.get(f.requests[0] || '/repos/fixture/transport/git/commits/' + '1'.repeat(40)).sha = '4'.repeat(40)
  await assert.rejects(f.read(), { code: 'FINAL_OBLIGATIONS_PROOF_COMMIT' })
})

test('truncated Git membership cannot transport proof', async t => {
  const f = fixture(t); f.root.truncated = true
  await assert.rejects(f.read(), { code: 'FINAL_OBLIGATIONS_PROOF_TREE' })
})

test('ambiguous and symlink members are rejected', async t => {
  const f = fixture(t); f.child.tree.push({ ...f.child.tree[0] })
  await assert.rejects(f.read(), { code: 'FINAL_OBLIGATIONS_PROOF_MEMBER' })
  f.child.tree.pop(); f.child.tree[0].mode = '120000'
  await assert.rejects(f.read(), { code: 'FINAL_OBLIGATIONS_PROOF_MEMBER' })
})

test('Git blob identity, declared size and authorization digest all bind the bytes', async t => {
  const f = fixture(t); f.blob.sha = '4'.repeat(40)
  await assert.rejects(f.read(), { code: 'FINAL_OBLIGATIONS_PROOF_BLOB' })
  f.blob.sha = f.child.tree[0].sha; f.blob.size++
  await assert.rejects(f.read(), { code: 'FINAL_OBLIGATIONS_PROOF_BYTES' })
  f.blob.size--; f.authorization.obligationsProof.sha256 = '5'.repeat(64)
  await assert.rejects(f.read(), { code: 'FINAL_OBLIGATIONS_PROOF_BYTES' })
})

test('corrupt bytes cannot pass even with an updated transport SHA256', async t => {
  const f = fixture(t), changed = Buffer.from('{"kind":"not-release-proof"}')
  f.blob.content = changed.toString('base64'); f.blob.size = changed.length
  f.authorization.obligationsProof.sha256 = hash(changed)
  await assert.rejects(f.read(), { code: 'FINAL_OBLIGATIONS_PROOF_BYTES' })
})

test('matching downloaded bytes are accepted; conflicting copies stop instead of falling back', async t => {
  const f = fixture(t), filename = path.join(f.inputs, 'obligations-proof.json')
  fs.writeFileSync(filename, f.bytes)
  assert.deepEqual(await f.read(), f.proof)
  fs.writeFileSync(filename, '{}')
  await assert.rejects(f.read(), { code: 'FINAL_OBLIGATIONS_PROOF_CONFLICT' })
})

function syntheticAuthorization(f) {
  // Synthetic, in-memory protocol fixture only. This approved discriminator
  // exercises readAuthorization's contract; it is NOT a real approval, file,
  // protected repository variable, hosted runner or release-eligible record.
  const record = { kind: 'rt-private-runtime-release-authorization-v1', schemaVersion: 1,
    decision: 'approved', assemblyTargets: ['win32-x64'],
    trustedContext: { repositoryId: 7, repositoryFullName: f.pins.repository },
    obligationsProof: { ...f.authorization.obligationsProof } }
  const prefix = '/repos/' + f.pins.repository, commit = 'a'.repeat(40), treeOid = 'b'.repeat(40)
  const tree = { sha: treeOid, tree: [{ path: 'synthetic-authorization.json', type: 'blob', mode: '100644', sha: '' }] }
  f.responses.set(prefix, { id: 7, full_name: f.pins.repository })
  f.responses.set(prefix + '/git/commits/' + commit, { sha: commit, tree: { sha: treeOid } })
  f.responses.set(prefix + '/git/trees/' + treeOid, tree)
  function replaceBlob(value) {
    const bytes = Buffer.from(JSON.stringify(value) + '\n')
    const oid = crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')
    tree.tree[0].sha = oid
    f.responses.set(prefix + '/git/blobs/' + oid, { sha: oid, encoding: 'base64',
      content: bytes.toString('base64'), size: bytes.length })
    return bytes
  }
  const bytes = replaceBlob(record)
  const pins = { repository: f.pins.repository, repositoryId: 7, commit,
    path: 'synthetic-authorization.json', sha256: hash(bytes) }
  async function readChain() {
    const authorization = await producer.readAuthorization(pins, f.authority)
    const proof = await readObligationsProof(f.inputs, f.temporary, authorization, pins, f.authority)
    return { authorization, proof }
  }
  return { record, pins, replaceBlob, readChain }
}

test('synthetic protected blob preserves obligationsProof through the real authorization-to-proof chain', async t => {
  const f = fixture(t), a = syntheticAuthorization(f)
  const result = await a.readChain()
  assert.deepEqual(result.authorization, a.record)
  assert.deepEqual(result.authorization.obligationsProof, f.authorization.obligationsProof)
  assert.deepEqual(result.proof, f.proof)
  assert.equal(f.requests.length, 8)
})

test('synthetic authorization blob tampering is rejected by the unchanged protected SHA256 before proof transport', async t => {
  const f = fixture(t), a = syntheticAuthorization(f), protectedSha256 = a.pins.sha256
  // Keep the mock Git tree/blob OID, size and encoding internally consistent:
  // rejection must come from the stale protected digest, not corrupt Git data.
  const changed = { ...a.record, obligationsProof: { ...a.record.obligationsProof, sha256: '6'.repeat(64) } }
  const changedBytes = a.replaceBlob(changed)
  assert.notEqual(hash(changedBytes), protectedSha256)
  await assert.rejects(a.readChain(), { code: 'AUTHORIZATION_BYTES_MISMATCH' })
  assert.equal(a.pins.sha256, protectedSha256)
  assert.equal(f.requests.length, 4)
})
