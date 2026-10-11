'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const producer = require('../../scripts/seal-private-python-runtime-producer.cjs')
const stage = require('../../scripts/run-private-runtime-stage-ci.cjs')
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rt-producer-lock-cap-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, filename: path.join(root, 'formal-lock.json') }
}
test('inner producer and outer stage use the same bounded formal-lock budget', t => {
  const f = fixture(t), bytes = Buffer.alloc(9 * 1024 * 1024, 0x20)
  fs.writeFileSync(f.filename, bytes)
  assert.equal(producer.FORMAL_LOCK_BYTE_CAP, stage.FORMAL_LOCK_BYTE_CAP)
  assert.equal(producer.FORMAL_LOCK_BYTE_CAP, 32 * 1024 * 1024)
  assert.deepEqual(producer.readFormalLock(f.root, f.filename), bytes)
})
test('producer rejects an oversized formal lock before reading', t => {
  const f = fixture(t)
  fs.closeSync(fs.openSync(f.filename, 'w'))
  fs.truncateSync(f.filename, producer.FORMAL_LOCK_BYTE_CAP + 1)
  assert.throws(() => producer.readFormalLock(f.root, f.filename), { code: 'INPUT_FILE_INVALID' })
})
test('producer formal lock retains the single-link restriction', t => {
  const f = fixture(t)
  fs.writeFileSync(f.filename, '{}')
  fs.linkSync(f.filename, f.filename + '.hardlink')
  assert.throws(() => producer.readFormalLock(f.root, f.filename), { code: 'INPUT_FILE_INVALID' })
})
test('producer formal lock retains the owned-root path restriction', t => {
  const f = fixture(t)
  assert.throws(() => producer.readFormalLock(f.root, path.join(f.root, '..', 'unowned.json')))
})
test('actual current 15 MB structural lock is readable without changing its approved input hash', {
  skip: !process.env.RT_CURRENT_FORMAL_INPUTS_ROOT,
}, () => {
  const root = fs.realpathSync(process.env.RT_CURRENT_FORMAL_INPUTS_ROOT)
  const bytes = producer.readFormalLock(root, path.join(root, 'formal-lock.json'))
  assert.ok(bytes.length > 8 * 1024 * 1024)
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),
    'c20a1a327b91d4022746d2fc18b4a8045c31767134b14fdfae866ba2f06cd6ea')
  assert.equal(JSON.parse(bytes).structuralOnly, true)
  assert.equal(JSON.parse(bytes).releaseEligible, false)
})
