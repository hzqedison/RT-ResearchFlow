'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { validateSpec, quoteWindowsArgument, parseWindowsProof, posixLaunchArgs, WINDOWS_LOADER } = require('../../scripts/private-runtime-owned-supervisor.cjs')
function spec() {
  return { executable: path.resolve('private-python'), args: ['-X', 'utf8', '-I', '-S', '-B', path.resolve('reporter.py')],
    cwd: path.resolve('owned-cache'), input: Buffer.alloc(0), shell: false, deadlineMs: 1000,
    stdoutByteCap: 1024, stderrByteCap: 0, ownershipMode: 'windows-job',
    env: { PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', NODE_OPTIONS: '', NODE_PATH: '', PYTHONPATH: '' } }
}
test('strict isolated spec permits no extra environment or shell', () => {
  assert.equal(validateSpec(spec(), 'win32').ownershipMode, 'windows-job')
  for (const replacement of [{ shell: true }, { deadlineMs: 300001 }, { input: 'text' }, { stdoutByteCap: 0 }]) {
    assert.throws(() => validateSpec({ ...spec(), ...replacement }, 'win32'))
  }
})
test('reject credentials and executable environment injection', () => {
  for (const extra of [{ GITHUB_TOKEN: 'secret' }, { NODE_OPTIONS: '--require evil' }, { PYTHONPATH: 'foreign' }, { HOME: 'bad\npath' }]) {
    assert.throws(() => validateSpec({ ...spec(), env: { ...spec().env, ...extra } }, 'win32'))
  }
})
test('requires interpreter isolation flags and actual platform ownership', () => {
  assert.throws(() => validateSpec({ ...spec(), args: ['-c', 'print(1)'] }, 'win32'))
  assert.throws(() => validateSpec(spec(), 'darwin'))
  assert.doesNotThrow(() => validateSpec({ ...spec(), ownershipMode: 'posix-owned-session' }, 'darwin'))
})
test('quote spaces, literal quotes and trailing slashes without shell interpolation', () => {
  assert.equal(quoteWindowsArgument('space value'), '"space value"')
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"')
  assert.equal(quoteWindowsArgument('D:\\cache\\'), '"D:\\cache\\\\"')
  assert.throws(() => quoteWindowsArgument('line\nbreak'))
})
test('native empty-Job proof binds nonce and real positive process identity', () => {
  const nonce = 'a'.repeat(64)
  assert.deepEqual(parseWindowsProof(Buffer.from('RT_PRIVATE_JOB_EMPTY:' + nonce + ':23:0'), nonce), { nativeRootPid: 23, activeProcesses: 0 })
  for (const bytes of ['RT_PRIVATE_JOB_EMPTY:' + 'b'.repeat(64) + ':23:0',
    'RT_PRIVATE_JOB_EMPTY:' + nonce + ':0:0', 'RT_PRIVATE_JOB_EMPTY:' + nonce + ':23:1', 'prefixRT_PRIVATE_JOB_EMPTY:' + nonce + ':23:0']) {
    assert.throws(() => parseWindowsProof(Buffer.from(bytes), nonce))
  }
})
test('fixed native loader waits stdin before launching Python and clears inherited environment', () => {
  assert.ok(WINDOWS_LOADER.indexOf('ReadToEnd()') < WINDOWS_LOADER.indexOf('$proc.Start()'))
  assert.ok(WINDOWS_LOADER.includes('EnvironmentVariables.Clear()'))
  assert.ok(WINDOWS_LOADER.includes("$ProgressPreference='SilentlyContinue'"))
  assert.ok(!WINDOWS_LOADER.includes('Invoke-Expression'))
})
test('POSIX explicit preseal gate derives actual OS leader and preserves final argv', () => {
  const input = { ...spec(), ownershipMode: 'posix-owned-session', preSealPosixInherited: true,
    args: ['-X', 'utf8', '-I', '-S', '-B', path.resolve('report-private-runtime-native-bootstrap.py'), '--pre-seal-bootstrap-contract', path.resolve('contract.json')] }
  assert.doesNotThrow(() => validateSpec(input, 'darwin'))
  const args = posixLaunchArgs(input)
  assert.deepEqual(args.slice(0, 6), ['-X', 'utf8', '-I', '-S', '-B', '-c'])
  assert.ok(args[6].includes('os.getpgrp()==p and os.getsid(0)==p'))
  assert.ok(args[6].includes('os.execv(sys.executable'))
  assert.deepEqual(args.slice(7), input.args)
  assert.throws(() => posixLaunchArgs({ ...input, args: [...input.args, '--pre-seal-owned-posix-root', '42'] }))
  assert.throws(() => posixLaunchArgs({ ...input, args: spec().args }))
})
test('ordinary non-preseal POSIX path never enables the inherited mode', () => {
  assert.deepEqual(posixLaunchArgs(spec()), spec().args)
  assert.throws(() => validateSpec({ ...spec(), preSealPosixInherited: true }, 'win32'))
})
