'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { stageFailure } = require('../../scripts/run-private-runtime-stage-ci.cjs')

test('retains static runtime reason and phase without release approval', () => {
  const error = new Error('PRIVATE_RUNTIME_INVALID: runtime file mismatch')
  error.stagePhase = 'native-producer'
  assert.deepEqual(stageFailure(error), { status: 'invalid', releaseEligible: false,
    code: 'STAGE_RUNTIME_INVALID', phase: 'native-producer', reason: 'runtime file mismatch' })
})
test('preserves license pending instead of granting approval', () => {
  assert.deepEqual(stageFailure(new Error('PRIVATE_RUNTIME_PENDING: license approval unavailable')),
    { status: 'pending', releaseEligible: false, code: 'STAGE_RUNTIME_PENDING', reason: 'license approval unavailable' })
})
test('retains known seal code from its existing message contract', () => {
  const error = new Error('NATIVE_BOOTSTRAP_REPORT_MISSING')
  error.sealStatus = 'pending'
  assert.deepEqual(stageFailure(error), { status: 'pending', releaseEligible: false, code: 'NATIVE_BOOTSTRAP_REPORT_MISSING' })
})
test('retains existing coded transport failure', () => {
  const error = new Error('request failed: sensitive URL')
  error.code = 'AUTHORITY_UNAVAILABLE'
  assert.deepEqual(stageFailure(error), { status: 'pending', releaseEligible: false, code: 'AUTHORITY_UNAVAILABLE' })
})
for (const message of ['PRIVATE_RUNTIME_INVALID: C:/Users/private/key/sk-secret',
  'PRIVATE_RUNTIME_PENDING: private broker account', 'TypeError: token=secret']) {
  test('suppresses non-allowlisted diagnostic text: ' + message.split(':')[0], () => {
    const error = new Error(message)
    error.stagePhase = 'private-path-or-token'
    const value = stageFailure(error)
    assert.equal(value.releaseEligible, false)
    assert.equal(Object.hasOwn(value, 'reason'), false)
    assert.equal(Object.hasOwn(value, 'phase'), false)
    assert.doesNotMatch(JSON.stringify(value), /private|secret|broker|Users/)
  })
}
