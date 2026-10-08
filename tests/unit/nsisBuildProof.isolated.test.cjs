'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createCompileRecorder, orderedEntries, parseArguments, sha256, main } =
  require('../../scripts/collect-nsis-build-proof.cjs')

test('null BUILD_UNINSTALLER selects the actual uninstaller phase and preserves this', async () => {
  const files = new Map()
  const records = []
  const context = { sentinel: 42 }
  const wrapped = createCompileRecorder(async function (defines, commands, script) {
    assert.equal(this, context)
    assert.equal(defines.BUILD_UNINSTALLER, null)
    assert.equal(commands.OutFile, '"candidate.exe"')
    assert.equal(script, 'Unicode \u4e2d\u6587\r\n')
    return 42
  }, (name, bytes) => files.set(name, bytes), records)
  assert.equal(await wrapped.call(context, { BUILD_UNINSTALLER: null }, { OutFile: '"candidate.exe"' },
    'Unicode \u4e2d\u6587\r\n'), 42)
  assert.equal(records[0].phase, 'uninstaller')
  assert.equal(records[0].result, 'resolved')
  assert.equal(records[0].scriptSha256, sha256(files.get(records[0].scriptPath)))
  assert.equal(records[0].rawProcessArgumentsObserved, false)
})

test('installer phase, order, arrays and input bytes are preserved', async () => {
  const records = []
  const wrapped = createCompileRecorder(async () => undefined, () => {}, records)
  await wrapped({ BUILD_UNINSTALLER: null, VERSION: '1.7.0' }, { SetCompressor: ['a', 'b'] }, 'first')
  await wrapped({ VERSION: '1.7.0', APP_ID: 'com.tradewatcher.app' }, {}, 'second')
  assert.deepEqual(records.map(({ sequence, phase }) => [sequence, phase]), [[1, 'uninstaller'], [2, 'installer']])
  assert.deepEqual(records[0].commandsEntries, [['SetCompressor', ['a', 'b']]])
  assert.deepEqual(records[1].definesEntries.map(([key]) => key), ['VERSION', 'APP_ID'])
})

test('compiler rejection is recorded and propagated unchanged', async () => {
  const failure = new Error('synthetic compiler failure')
  const records = []
  const files = new Map()
  const wrapped = createCompileRecorder(async () => { throw failure },
    (name, bytes) => files.set(name, bytes), records)
  await assert.rejects(wrapped({}, {}, 'input'), (error) => error === failure)
  assert.equal(records[0].result, 'rejected')
  assert.equal(JSON.parse(files.get('proof/compiler/01-installer.invocation.json')).result, 'rejected')
})

test('unsupported compiler values cannot silently disappear in JSON', () => {
  assert.throws(() => orderedEntries({ arbitrary: undefined }), /Unsupported/)
  assert.throws(() => orderedEntries({ arbitrary: {} }), /Unsupported/)
  assert.throws(() => orderedEntries({ arbitrary: [() => 1] }), /Unsupported/)
})

test('successful compiler result is not changed when final evidence write fails', async () => {
  const records = []
  const diskFailure = new Error('final evidence write failed')
  let writes = 0
  const wrapped = createCompileRecorder(async () => 42, () => {
    if (++writes === 3) throw diskFailure
  }, records)
  await assert.rejects(wrapped({}, {}, 'input'), (error) => error === diskFailure)
  assert.equal(records[0].result, 'resolved')
})

test('failed compiler exception survives a second evidence write failure', async () => {
  const records = []
  const compilerFailure = new Error('compiler failed')
  let writes = 0
  const wrapped = createCompileRecorder(async () => { throw compilerFailure }, () => {
    if (++writes === 3) throw new Error('disk failed too')
  }, records)
  await assert.rejects(wrapped({}, {}, 'input'), (error) => error === compilerFailure)
  assert.equal(records[0].result, 'rejected')
  assert.equal(records[0].recordingFailed, true)
})

test('source snapshot is verified at each compiler boundary', async () => {
  const records = []
  let verifications = 0
  const wrapped = createCompileRecorder(async () => undefined, () => {}, records, () => {
    verifications++
    return true
  })
  await wrapped({ BUILD_UNINSTALLER: null }, {}, 'first')
  await wrapped({}, {}, 'second')
  assert.equal(verifications, 2)
  assert.ok(records.every((record) => record.sourceSnapshotRechecked === true))
})

test('changed input snapshot blocks the compiler without claiming success', async () => {
  let invoked = false
  const records = []
  const wrapped = createCompileRecorder(async () => { invoked = true }, () => {}, records,
    () => { throw new Error('changed template') })
  await assert.rejects(wrapped({}, {}, 'input'), /changed template/)
  assert.equal(invoked, false)
  assert.equal(records[0].result, 'started')
  assert.equal(records[0].sourceSnapshotRechecked, false)
})

test('non-text input cannot reach the compiler', async () => {
  let invoked = false
  const wrapped = createCompileRecorder(async () => { invoked = true }, () => {})
  await assert.rejects(wrapped({}, {}, Buffer.from('input')), /must be text/)
  assert.equal(invoked, false)
})

test('proof output errors fail before executing the compiler', async () => {
  let invoked = false
  const wrapped = createCompileRecorder(async () => { invoked = true }, () => { throw new Error('disk failed') })
  await assert.rejects(wrapped({}, {}, 'input'), /disk failed/)
  assert.equal(invoked, false)
})

test('argument parser rejects duplicates, unknown and incomplete options', () => {
  assert.throws(() => parseArguments(['--output', 'proof']), /Both/)
  assert.throws(() => parseArguments(['--config', 'one', '--config', 'two']), /Usage/)
  assert.throws(() => parseArguments(['--unknown', 'x']), /Usage/)
  assert.throws(() => parseArguments(['--config']), /Usage/)
  assert.equal(Object.keys(parseArguments(['--config', 'builder.yml', '--output', 'proof'])).length, 2)
})

test('CLI collection is blocked outside disposable hosted Windows CI', () => {
  const result = spawnSync(process.execPath,
    [path.resolve(__dirname, '../../scripts/collect-nsis-build-proof.cjs')], {
      env: { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'isolated-test' },
      encoding: 'utf8', timeout: 10000, windowsHide: true
    })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /restricted/)
  assert.equal(result.stdout, '')
})
