'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { PINS, decodePinnedWheel, readPinnedWheel } = require('../fixtures/runtime-wheel-assets.cjs')
for (const pin of PINS) {
  const bytes = readPinnedWheel(pin.filename)
  const encoded = bytes.toString('base64')
  test(pin.filename + ': actual pinned ZIP bytes without host cache', () => {
    assert.equal(bytes.length, pin.size)
    assert.equal(bytes.subarray(0, 2).toString(), 'PK')
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), pin.sha256)
  })
  test(pin.filename + ': reject changed bytes with unchanged size', () => {
    const mutated = Buffer.from(bytes); mutated[mutated.length - 1] ^= 1
    assert.throws(() => decodePinnedWheel(pin.filename, mutated.toString('base64')), /MISMATCH/)
  })
  test(pin.filename + ': reject whitespace and oversized input', () => {
    for (const value of [encoded + ' ', encoded + '\n\n', ' '.repeat(encoded.length + 10)]) {
      assert.throws(() => decodePinnedWheel(pin.filename, value))
    }
  })
  test(pin.filename + ': reject truncated input and non-text', () => {
    assert.throws(() => decodePinnedWheel(pin.filename, encoded.slice(0, -4)))
    assert.throws(() => decodePinnedWheel(pin.filename, null))
  })
  test(pin.filename + ': LF and CRLF checkout endings keep identical bytes', () => {
    assert.deepEqual(decodePinnedWheel(pin.filename, encoded + '\n'), bytes)
    assert.deepEqual(decodePinnedWheel(pin.filename, encoded + '\r\n'), bytes)
  })
}
test('unknown names cannot redirect a fixture read', () => {
  for (const name of ['../asset.whl', 'D:/old-host-cache/asset.whl', 'unknown.whl']) {
    assert.throws(() => readPinnedWheel(name), /UNKNOWN/)
  }
})
