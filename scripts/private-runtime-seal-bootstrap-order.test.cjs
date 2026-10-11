'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const producer = require('./seal-private-python-runtime-producer.cjs')
const root = path.resolve(__dirname, '..')
const sealPath = 'scripts/seal-private-python-runtime.cjs'
const sha = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')
function bootstrap() { return producer.verifiedLoader(root, new Map([[sealPath, sha(sealPath)]]))(sealPath) }
test('seal-only protected bootstrap does not execute recipient reader before source verification', () => {
  const seal = bootstrap()
  assert.equal(typeof seal.verifySourceAuthority, 'function')
  assert.equal(typeof seal.verifyObligationCoverage, 'function')
})
test('recipient evidence still rejects an unverified reader after bootstrap', async () => {
  const seal = bootstrap()
  await assert.rejects(seal.verifyObligationCoverage({trust: {}, repositoryRoot: root, sourceMembers: new Map()}), /EXECUTED_MODULE_NOT_VERIFIED/)
})
test('recipient evidence still rejects a changed reader digest', async () => {
  const seal = bootstrap()
  await assert.rejects(seal.verifyObligationCoverage({trust: {}, repositoryRoot: root, sourceMembers: new Map([['scripts/private-runtime-recipient-materials.cjs', '0'.repeat(64)]])}), /EXECUTED_MODULE_CHANGED/)
})
