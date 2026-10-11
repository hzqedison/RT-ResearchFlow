'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { readFormalLock, FORMAL_LOCK_BYTE_CAP } = require('../../scripts/run-private-runtime-stage-ci.cjs')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-formal-lock-cap-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return path.join(root, 'formal-lock.json')
}
test('formal lock over the generic 8 MiB cap can be read within its explicit 32 MiB budget', t => {
  const name = fixture(t), bytes = Buffer.alloc(9 * 1024 * 1024, 0x20)
  bytes[0] = 0x7b; bytes[bytes.length - 1] = 0x7d
  fs.writeFileSync(name, bytes)
  assert.equal(FORMAL_LOCK_BYTE_CAP, 32 * 1024 * 1024)
  assert.deepEqual(readFormalLock(name), bytes)
})
test('formal lock larger than 32 MiB remains rejected before reading', t => {
  const name = fixture(t)
  fs.closeSync(fs.openSync(name, 'w')); fs.truncateSync(name, FORMAL_LOCK_BYTE_CAP + 1)
  assert.throws(() => readFormalLock(name), { code: 'STAGE_FILE_INVALID' })
})
test('formal lock with multiple hardlinks remains rejected', t => {
  const name = fixture(t)
  fs.writeFileSync(name, '{}')
  fs.linkSync(name, name + '.hardlink')
  assert.throws(() => readFormalLock(name), { code: 'STAGE_FILE_INVALID' })
})
test('formal lock directory remains rejected', t => {
  const name = fixture(t)
  fs.mkdirSync(name)
  assert.throws(() => readFormalLock(name), { code: 'STAGE_FILE_INVALID' })
})
