'use strict'

// Original immutable test inputs, not dependency approval or product payload.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const PINS = Object.freeze([
  {
    "filename": "mootdx-0.11.7-py3-none-any.whl",
    "size": 108803,
    "sha256": "eab475f1d08b1c71ea51212c8b1b1038c4739798f7d95ad1a6fb7bb26e348ef2"
  },
  {
    "filename": "mootdx-0.11.7+rt.1-py3-none-any.whl",
    "size": 413852,
    "sha256": "35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77"
  }
].map(Object.freeze))
function pinFor(name) {
  const pin = PINS.find(item => item.filename === name)
  if (!pin) throw new Error('UNKNOWN_PINNED_WHEEL_FIXTURE')
  return pin
}
function decodePinnedWheel(name, source) {
  const pin = pinFor(name)
  if (typeof source !== 'string' || source.length > Math.ceil(pin.size / 3) * 4 + 2) {
    throw new Error('INVALID_PINNED_WHEEL_FIXTURE')
  }
  const encoded = source.replace(/\r?\n$/, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('INVALID_PINNED_WHEEL_FIXTURE')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length !== pin.size || bytes.toString('base64') !== encoded ||
      crypto.createHash('sha256').update(bytes).digest('hex') !== pin.sha256) {
    throw new Error('PINNED_WHEEL_FIXTURE_BYTES_MISMATCH')
  }
  return bytes
}
function readPinnedWheel(name) {
  const pin = pinFor(name)
  const file = path.join(__dirname, 'runtime-wheel-assets', pin.filename + '.b64')
  const state = fs.lstatSync(file)
  if (!state.isFile() || state.isSymbolicLink() || state.size > Math.ceil(pin.size / 3) * 4 + 2) {
    throw new Error('INVALID_PINNED_WHEEL_FIXTURE')
  }
  return decodePinnedWheel(name, fs.readFileSync(file, 'ascii'))
}
module.exports = { PINS, decodePinnedWheel, readPinnedWheel }
