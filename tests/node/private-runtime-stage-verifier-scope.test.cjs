'use strict'

// Offline constructor/rejection tests only, not native success or release approval.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { createNativeBootstrapVerifier, createReleaseVerifiers } =
  require('../../scripts/private-runtime-release-verifiers.cjs')
const targets = ['win32-x64', 'darwin-arm64', 'darwin-x64']
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-stage-verifier-scope-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const bytes = Buffer.from('# offline reporter source fixture\n')
  fs.writeFileSync(path.join(root, 'reporter.py'), bytes)
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const sourceMembers = new Map([['reporter.py', sha256]])
  const trustedContext = { approvedPolicySha256: 'a'.repeat(64), producers: [] }
  const verifierPolicy = { kind: 'rt-private-runtime-release-verifier-policy-v1',
    schemaVersion: 1, preparationPolicySha256: trustedContext.approvedPolicySha256,
    nativeReporters: Object.fromEntries(targets.map(target => [target, { path: 'reporter.py', sha256 }])) }
  return { repositoryRoot: root, sourceMembers, trustedContext, verifierPolicy }
}
test('non-release native verifier does not require final distribution policy or review records', t => {
  const f = fixture(t)
  const callbacks = createNativeBootstrapVerifier(f)
  assert.equal(typeof callbacks.verifyNativeBootstrap, 'function')
  assert.equal(callbacks.evidenceVerifiers, undefined)
})
test('final verifier still requires the full distribution verifier policy', t => {
  assert.throws(() => createReleaseVerifiers(fixture(t)), { code: 'VERIFIER_POLICY_BINDING' })
})
test('final verifier still rejects missing authorized obligation source', t => {
  const f = fixture(t)
  f.trustedContext.obligationPolicySha256 = 'b'.repeat(64)
  f.verifierPolicy.obligationPolicySha256 = 'b'.repeat(64)
  f.verifierPolicy.reviewRecords = []
  assert.throws(() => createReleaseVerifiers(f), { code: 'OBLIGATION_POLICY_SOURCE_CHANGED' })
})
test('native verifier requires actual source-pinned reporter bytes for every target', t => {
  const f = fixture(t)
  f.verifierPolicy.nativeReporters['darwin-x64'].sha256 = 'c'.repeat(64)
  assert.throws(() => createNativeBootstrapVerifier(f), { code: 'NATIVE_REPORTER_SOURCE_NOT_VERIFIED' })
})
test('native verifier does not infer approval from synthetic success fields', async t => {
  const f = fixture(t)
  const callbacks = createNativeBootstrapVerifier(f)
  await assert.rejects(callbacks.verifyNativeBootstrap({
    target: 'win32-x64', reportBytes: Buffer.from('{"validatorPassed":true,"status":"accepted"}'),
    expectedBinding: {}, producer: {},
  }), { code: 'NATIVE_PRODUCER_NOT_AUTHORIZED' })
})
test('native verifier retains the preparation policy source binding', t => {
  const f = fixture(t)
  f.verifierPolicy.preparationPolicySha256 = 'd'.repeat(64)
  assert.throws(() => createNativeBootstrapVerifier(f), { code: 'VERIFIER_POLICY_BINDING' })
})
