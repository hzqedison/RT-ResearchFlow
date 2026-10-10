'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { hash } = require('../../electron/shared/privatePythonRuntimeManifest.cjs')
const { assemble, assemblyPolicy, nativeTestContext, options } = require('../../scripts/bundle-private-python-runtime.cjs')
const actualTarget = process.platform + '-' + process.arch
const policyBytes = fs.readFileSync(path.resolve(__dirname, '../../resources/python-runtime/preparation.policy.json'))
const policy = JSON.parse(policyBytes)
const policySha = hash(policyBytes)

test('isolated policy binding leaves original pending approvals untouched', () => {
 const before = JSON.stringify(policy)
 const lock = { platforms: { [actualTarget]: { preparationPolicySha256: policySha } } }
 assemblyPolicy(lock, policy, policySha, { expectedPolicySha256: policySha })
 assert.equal(JSON.stringify(policy), before)
 assert.ok(policy.licenseApprovals.some(row => row.decision === 'pending'))
})
test('native-test rejects changed policy binding', () => {
 assert.throws(() => assemblyPolicy({ platforms: {} }, policy, policySha, { expectedPolicySha256: '0'.repeat(64) }), /NATIVE_TEST_POLICY_BINDING_INVALID/)
})
test('native-test rejects unbound manifest policy', () => {
 assert.throws(() => assemblyPolicy({ platforms: { x: { preparationPolicySha256: '0'.repeat(64) } } }, policy, policySha, { expectedPolicySha256: policySha }), /NATIVE_TEST_POLICY_BINDING_INVALID/)
})
test('native assembly context is confined to empty owned temporary staging root', () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-native-assembly-test-'))
 const output = fs.mkdtempSync(path.join(root, 'rt-preseal-'))
 const context = { temporaryRoot: root, expectedFormalLockSha256: '1'.repeat(64), expectedPolicySha256: policySha }
 try {
  assert.equal(nativeTestContext({ target: actualTarget, outputRoot: output }, context), context)
  assert.throws(() => nativeTestContext({ target: 'foreign-x64', outputRoot: output }, context), /NATIVE_TEST_CONTEXT_INVALID/)
  assert.throws(() => nativeTestContext({ target: actualTarget, outputRoot: root }, context), /NATIVE_TEST_CONTEXT_INVALID/)
  fs.writeFileSync(path.join(output, 'occupied'), 'existing data')
  assert.throws(() => nativeTestContext({ target: actualTarget, outputRoot: output }, context), /NATIVE_TEST_CONTEXT_INVALID/)
 } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
test('ordinary assembler CLI cannot select native-test purpose', () => {
 assert.throws(() => options(['--purpose', 'native-test']), /invalid assembler arguments/)
})
test('actual formal input remains denied by the ordinary release assembler', () => {
 const formal = process.env.RT_CURRENT_FORMAL_INPUTS_ROOT
 assert.ok(formal, 'explicit actual formal input is required')
 const output = path.join(os.tmpdir(), 'rt-release-rejection-' + process.pid)
 assert.throws(() => assemble({ lockPath: path.join(formal, 'formal-lock.json'),
  preparedRoot: path.join(os.tmpdir(), 'not-a-prepared-runtime'), assetsRoot: path.join(os.tmpdir(), 'not-an-asset-cache'),
  outputRoot: output, target: 'darwin-arm64' }), /PRIVATE_RUNTIME_PENDING: license evidence incomplete/)
 assert.equal(fs.existsSync(output), false)
})
