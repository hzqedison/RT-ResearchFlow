'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { verifyPackagedAcceptance, STARTUP_SPEC } = require('../../scripts/mac-packaged-acceptance.cjs')
const executable = path.resolve('/tmp/rt-dmg-installed/RT-ResearchFlow.app/Contents/MacOS/RT-ResearchFlow')
const testRoot = path.resolve('/tmp/rt-mac-gui-contract')
const runtimeProof = () => ({ kind: 'packaged-runtime-verified', version: '1.9.0', arch: 'arm64',
  electron: '41.1.0', pdf: true, canvas: true, sqlite: true })
const cleanReport = () => ({ errors: [], stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 } })
function harness({ runtime = { status: 0, stdout: JSON.stringify(runtimeProof()) + '\n' }, gui,
  report = cleanReport(), hasFile = () => true } = {}) {
  const calls = []
  const options = {
    platform: 'darwin', hasFile, version: '1.9.0', arch: 'arm64', testRoot,
    environment: { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require source-host.cjs',
      NODE_PATH: '/source/node_modules', PLAYWRIGHT_JSON_OUTPUT_FILE: '/tmp/stale-report.json' },
    spawn(command, args, settings) {
      calls.push({ command, args, settings })
      return calls.length === 1 ? runtime : gui || { status: 0, stdout: JSON.stringify(report), stderr: '' }
    },
  }
  return { calls, run: () => verifyPackagedAcceptance(executable, options) }
}
test('passes the actual installed executable to PDF verification and GUI startup, not a source host', () => {
  const h = harness(), proof = h.run()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[0].args[1], executable)
  assert.equal(path.basename(h.calls[0].args[0]), 'verify-packaged-runtime.cjs')
  assert.equal(h.calls[1].command, 'pnpm')
  assert.deepEqual(h.calls[1].args, ['exec', 'playwright', 'test', STARTUP_SPEC,
    '--workers=1', '--retries=0', '--reporter=json'])
  for (const call of h.calls) {
    assert.equal(call.settings.env.RT_PACKAGED_EXE, executable)
    assert.equal(call.settings.env.RT_PACKAGED_VERSION, '1.9.0')
    assert.equal(call.settings.env.RT_PACKAGED_TEST_ROOT, testRoot)
    for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'PLAYWRIGHT_JSON_OUTPUT_FILE']) {
      assert.equal(Object.hasOwn(call.settings.env, key), false)
    }
  }
  assert.equal(proof.runtimeVerifierPassed, true)
  assert.equal(proof.guiStartupPassed, true)
  assert.equal(proof.executablePath, executable)
  assert.deepEqual(proof.runtimeProof, runtimeProof())
})
test('missing main-agent verifier files fail before executing anything', () => {
  const h = harness({ hasFile: filename => filename === executable })
  assert.throws(h.run, /MAC_PACKAGED_ACCEPTANCE_INPUT_MISSING/)
  assert.equal(h.calls.length, 0)
})
test('a PDF/dependency verifier failure cannot produce an acceptance proof', () => {
  const h = harness({ runtime: { status: 1 } })
  assert.throws(h.run, /MAC_PACKAGED_RUNTIME_PDF_FAILED/)
  assert.equal(h.calls.length, 1)
})
test('an empty success or mismatched packaged PDF/canvas/version/architecture proof fails before GUI startup', () => {
  const empty = harness({ runtime: { status: 0, stdout: '' } })
  assert.throws(empty.run, /MAC_PACKAGED_RUNTIME_PROOF_INVALID/)
  assert.equal(empty.calls.length, 1)
  for (const patch of [{ pdf: false }, { canvas: false }, { sqlite: false },
    { version: '1.8.0' }, { arch: 'x64' }, { electron: '' }]) {
    const h = harness({ runtime: { status: 0, stdout: JSON.stringify({ ...runtimeProof(), ...patch }) } })
    assert.throws(h.run, /MAC_PACKAGED_RUNTIME_PROOF_MISMATCH/)
    assert.equal(h.calls.length, 1)
  }
})
test('GUI launch failure cannot be hidden by passing SQLite or PDF checks', () => {
  assert.throws(harness({ gui: { status: 1, stdout: '', stderr: '' } }).run, /MAC_PACKAGED_GUI_STARTUP_FAILED/)
})
test('zero, skipped, flaky or failed GUI tests cannot masquerade as a passing startup', () => {
  for (const stats of [
    { expected: 0, unexpected: 0, skipped: 0, flaky: 0 },
    { expected: 1, unexpected: 0, skipped: 1, flaky: 0 },
    { expected: 1, unexpected: 0, skipped: 0, flaky: 1 },
    { expected: 1, unexpected: 1, skipped: 0, flaky: 0 },
  ]) assert.throws(harness({ report: { errors: [], stats } }).run, /MAC_PACKAGED_GUI_TESTS_NOT_ACCEPTED/)
})
test('missing/malformed reports and runner errors fail closed', () => {
  assert.throws(harness({ gui: { status: 0, stdout: 'not JSON' } }).run, /MAC_PACKAGED_GUI_REPORT_INVALID/)
  assert.throws(harness({ report: { stats: cleanReport().stats } }).run, /MAC_PACKAGED_GUI_TESTS_NOT_ACCEPTED/)
  assert.throws(harness({ report: { errors: [{ message: 'worker failed' }], stats: cleanReport().stats } }).run,
    /MAC_PACKAGED_GUI_TESTS_NOT_ACCEPTED/)
})
