'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { createDistributionEvidenceReader, HOOK, BUILDER, SOURCE, MANIFEST, hash } = require('../../scripts/private-runtime-recipient-materials.cjs')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-recipient-evidence-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const members = new Map(), trust = {}, manifest = { files: [] }
  const write = (name, content) => {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true })
    const raw = Buffer.from(content); fs.writeFileSync(file, raw)
    const pin = hash(raw); members.set(name, pin); return pin
  }
  const read = () => createDistributionEvidenceReader({ repositoryRoot: root, sourceMembers: members, trustedContext: trust })
  const sourcePin = write('reviews/scope.json', '{"fixture":true}')
  const runtimePin = write('darwin-arm64/notices/LICENSE.txt', 'original fixture notice')
  manifest.files.push({ path: 'notices/LICENSE.txt', kind: 'file', sha256: runtimePin })
  return { root, members, trust, manifest, write, read, sourcePin, runtimePin,
    args: { target: 'darwin-arm64', manifest, preparedRoot: root, role: 'evidence' } }
}
test('existing runtime payload still needs actual inventory and bytes', t => {
  const f = fixture(t), read = f.read()
  assert.equal(read({ ...f.args, role: 'payload', file: { path: 'notices/LICENSE.txt', sha256: f.runtimePin } }).toString(), 'original fixture notice')
  assert.throws(() => read({ ...f.args, role: 'payload', manifest: { files: [] }, file: { path: 'notices/LICENSE.txt', sha256: f.runtimePin } }), /OBLIGATION_PAYLOAD_BYTES/)
})
test('source review evidence is exact protected bytes, not recipient delivery', t => {
  const f = fixture(t), read = f.read(), file = { path: 'reviews/scope.json', sha256: f.sourcePin, location: 'source-review' }
  assert.equal(read({ ...f.args, file }).toString(), '{"fixture":true}')
  assert.throws(() => read({ ...f.args, file, role: 'payload' }), /SOURCE_REVIEW_IS_NOT_RECIPIENT_PAYLOAD/)
})
test('source change and unpinned source cannot be accepted', t => {
  const f = fixture(t), read = f.read(), file = { path: 'reviews/scope.json', sha256: f.sourcePin, location: 'source-review' }
  fs.writeFileSync(path.join(f.root, file.path), 'changed')
  assert.throws(() => read({ ...f.args, file }), /DISTRIBUTION_EVIDENCE_SOURCE_CHANGED/)
  assert.throws(() => read({ ...f.args, file: { ...file, sha256: '0'.repeat(64) } }), /SOURCE_NOT_VERIFIED/)
})
test('source membership cannot be mutated after reader construction', t => {
  const f = fixture(t), read = f.read()
  f.members.set('reviews/unapproved.json', f.write('reviews/unapproved.json', 'new'))
  assert.throws(() => read({ ...f.args, file: { path: 'reviews/unapproved.json', sha256: f.members.get('reviews/unapproved.json'), location: 'source-review' } }), /SOURCE_NOT_VERIFIED/)
})
test('unknown namespaces and traversal cannot change evidence roots', t => {
  const f = fixture(t), read = f.read()
  for (const file of [
    { path: 'reviews/scope.json', sha256: f.sourcePin, location: 'local-approved' },
    { path: '../reviews/scope.json', sha256: f.sourcePin, location: 'source-review' }
  ]) assert.throws(() => read({ ...f.args, file }))
})
test('recipient material needs protected hook/manifest/builder authorization', t => {
  const f = fixture(t), read = f.read()
  assert.throws(() => read({ ...f.args, file: { path: 'notices/LICENSE.txt', sha256: f.runtimePin, location: 'mac-recipient-material' } }), /PROTECTED_PLAN_REQUIRED/)
  assert.throws(() => read({ ...f.args, target: 'win32-x64', file: { path: 'notices/LICENSE.txt', sha256: f.runtimePin, location: 'mac-recipient-material' } }), /TARGET_INVALID/)
})
test('review evidence links are rejected', t => {
  const f = fixture(t)
  const link = path.join(f.root, 'reviews/link.json')
  try { fs.symlinkSync(path.join(f.root, 'reviews/scope.json'), link) } catch { t.skip('Host does not allow creating a symlink fixture'); return }
  f.members.set('reviews/link.json', f.sourcePin)
  assert.throws(() => f.read()({ ...f.args, file: { path: 'reviews/link.json', sha256: f.sourcePin, location: 'source-review' } }), /EVIDENCE_LINK/)
})
test('real Mac plan gives 21 source-bound files and an exact generated recipient index', () => {
  const root = path.resolve(__dirname, '../..')
  const hook = require('../../scripts/mac-distribution-materials.cjs')
  const { files } = hook.loadPlan()
  const members = new Map()
  for (const row of files) members.set(SOURCE + '/' + row.path, row.sha256)
  for (const name of [HOOK, BUILDER, MANIFEST]) members.set(name, hash(fs.readFileSync(path.join(root, name))))
  const trust = { recipientMaterials: { kind: 'mac-third-party-source-plan-v1', targets: ['darwin-arm64', 'darwin-x64'],
    hookPath: HOOK, hookSha256: members.get(HOOK), builderPath: BUILDER, builderSha256: members.get(BUILDER),
    manifestPath: MANIFEST, manifestSha256: members.get(MANIFEST) } }
  const read = createDistributionEvidenceReader({ repositoryRoot: root, sourceMembers: members, trustedContext: trust })
  const sample = files.find(row => row.path === 'source/pip-vendored-certifi-2026.6.17/pip/_vendor/certifi/core.py')
  assert.ok(read({ target: 'darwin-arm64', manifest: { files: [] }, file: { ...sample, location: 'mac-recipient-material' }, role: 'payload' }).length > 0)
  const index = Buffer.from(hook.recipientIndex(files))
  assert.deepEqual(read({ target: 'darwin-x64', manifest: { files: [] }, file: { path: 'START-HERE.txt', sha256: hash(index), location: 'mac-recipient-material' }, role: 'evidence' }), index)
  assert.throws(() => read({ target: 'darwin-arm64', manifest: { files: [] }, file: { path: 'unlisted.txt', sha256: '0'.repeat(64), location: 'mac-recipient-material' }, role: 'payload' }), /NOT_IN_PROTECTED_PLAN/)
})
