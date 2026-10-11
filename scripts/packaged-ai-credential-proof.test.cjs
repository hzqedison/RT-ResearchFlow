'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { SPEC, requireCredentialReport, requireCredentialProof } = require('./packaged-ai-credential-proof.cjs')
const { asarPath } = require('./verify-packaged-ai-credentials.cjs')
function report() { return { stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 }, errors: [], suites: [{ specs: [{
  file: SPEC, title: 'packaged AI partial saves retain drafts and OS-encrypted keys survive restart', ok: true,
  tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, errors: [] }] }]
}] }] } }
test('accepts exactly the successful non-retried credential scenario', () => assert.equal(requireCredentialReport(report()).expected, 1))
for (const [name, mutate] of [
  ['empty run', r => { r.stats.expected = 0 }], ['skipped', r => { r.stats.skipped = 1 }],
  ['flaky', r => { r.stats.flaky = 1 }], ['failed', r => { r.stats.unexpected = 1 }],
  ['other suite', r => { r.suites[0].specs[0].file = 'other.ts' }],
  ['other scenario', r => { r.suites[0].specs[0].title = 'startup only' }],
  ['unexpected status', r => { r.suites[0].specs[0].tests[0].status = 'unexpected' }],
  ['retry', r => { r.suites[0].specs[0].tests[0].results[0].retry = 1 }],
  ['missing result', r => { r.suites[0].specs[0].tests[0].results = [] }],
  ['multiple results', r => { r.suites[0].specs[0].tests[0].results.push({ status: 'passed', retry: 0 }) }],
  ['runner error', r => { r.errors.push({ message: 'fixture' }) }]
]) test('rejects ' + name, () => { const r = report(); mutate(r); assert.throws(() => requireCredentialReport(r)) })
const identity = { version: '1.13.0', sourceCommit: 'a'.repeat(40), runId: '123', platform: 'darwin', arch: 'arm64', executableSha256: 'b'.repeat(64), appAsarSha256: 'c'.repeat(64) }
function proof() { return { ...identity, kind: 'rt-packaged-ai-credentials-v1', localCredentialPersistenceVerified: true, fixture: 'synthetic-loopback', brokerOrdersSubmitted: false, stats: report().stats } }
test('binds proof to the exact installed application and CI identity', () => assert.equal(requireCredentialProof(proof(), identity), true))
for (const key of Object.keys(identity)) test('rejects mismatched ' + key, () => assert.throws(() => requireCredentialProof({ ...proof(), [key]: 'different' }, identity)))
test('rejects a missing proof', () => assert.throws(() => requireCredentialProof(null, identity)))
test('rejects an unverified persistence flag', () => assert.throws(() => requireCredentialProof({ ...proof(), localCredentialPersistenceVerified: false }, identity)))
test('finds the Mac installed asar beside MacOS', () => assert.equal(asarPath('/fixture/Product.app/Contents/MacOS/Product', 'darwin').replaceAll('\\', '/'), '/fixture/Product.app/Contents/Resources/app.asar'))
