'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const harness = require('../native/private-runtime-posix-owned-chain.cjs')
const { posixLaunchArgs } = require('../../scripts/private-runtime-owned-supervisor.cjs')

test('test successor reuses actual exported gate bytes and exact flags from legal fixed eight argv', () => {
  const fixedPath = path.resolve(__dirname, '../../scripts/report-private-runtime-native-bootstrap.py')
  const flags = ['-X', 'utf8', '-I', '-S', '-B']
  const spec = { executable: path.resolve('private-python'), cwd: path.resolve('owned-cache'),
    args: [...flags, fixedPath, '--pre-seal-bootstrap-contract', path.resolve('fixture.json')],
    ownershipMode: 'posix-owned-session', preSealPosixInherited: true, shell: false,
    input: Buffer.alloc(0), deadlineMs: 3000, stdoutByteCap: 65536, stderrByteCap: 8192,
    env: harness.environment(path.resolve('owned-cache'), process.execPath) }
  const actual = posixLaunchArgs(spec)
  const successor = path.resolve('owned-cache', 'owned-chain-probe.py')
  const derived = harness.deriveTestLaunchArgs(spec, successor)
  assert.equal(derived.observation.gateSourceBase64, Buffer.from(actual[6], 'utf8').toString('base64'))
  assert.equal(derived.observation.gateSourceSha256, crypto.createHash('sha256').update(actual[6], 'utf8').digest('hex'))
  assert.deepEqual(derived.observation.exactGatePrefix, actual.slice(0, 6))
  assert.deepEqual(actual.slice(7), spec.args)
  assert.equal(derived.args[12], successor)
  for (let index = 0; index < actual.length; index++) {
    if (index !== 12) assert.equal(derived.args[index], actual[index])
  }
  assert.equal(derived.observation.productionReporterAuthorityUsed, false)
  for (const extra of [['--pre-seal-owned-posix-root', '123'], ['--pre-seal-owned-posix-root=123']]) {
    assert.throws(() => harness.deriveTestLaunchArgs({ ...spec, args: [...spec.args, ...extra] }, successor))
  }
  assert.throws(() => harness.deriveTestLaunchArgs({ ...spec, args: [...flags, successor, ...spec.args.slice(6)] }, successor))
})

test('probe requires explicit absolute paths, with no environment root authorization', () => {
  const python = path.resolve('python'), root = path.resolve('cache')
  assert.deepEqual(harness.parseArguments(['--python', python, '--cache-root', root]), { python, cacheRoot: root, output: undefined })
  for (const argv of [[], ['--python', 'relative', '--cache-root', root], ['--python', python],
    ['--python', python, '--cache-root', root, '--root-pid', '123'], ['--python', python, '--python', python, '--cache-root', root]]) {
    assert.throws(() => harness.parseArguments(argv))
  }
})

test('fixture scope is never product approval and watcher uses kernel observations', () => {
  for (const value of Object.values(harness.SCOPE)) assert.equal(value, false)
  assert.match(harness.WORKER_PROBE, /bootstrap\['check_dependency_audits'\]/)
  assert.match(harness.WORKER_PROBE, /adapter\['run_token'\]/)
  assert.match(harness.WORKER_PROBE, /pre_seal_owned_posix_root=root/)
  assert.match(harness.WORKER_PROBE, /super\(\)\.__init__\(\*arguments,\*\*keywords\)/)
  assert.match(harness.WATCHER_PROBE, /select\.kqueue\(\)/)
  assert.match(harness.WATCHER_PROBE, /select\.KQ_NOTE_EXIT/)
  assert.match(harness.WATCHER_PROBE, /select\.KQ_EV_ONESHOT/)
  assert.match(harness.WATCHER_PROBE, /watcher-python-failure\.json/)
  assert.match(harness.WATCHER_PROBE, /traceback\.format_exc\(\)/)
  assert.match(harness.WATCHER_PROBE, /timeout-live\.json/)
  assert.match(harness.WATCHER_PROBE, /os\.kill\(pid,0\)/)
  assert.match(harness.WATCHER_PROBE, /os\.killpg\(root,0\)/)
})

test('harness environment forwards no credentials, proxy or host PATH', () => {
  const root = path.resolve('owned-cache'), node = path.resolve('private-node')
  const env = harness.environment(root, node)
  assert.equal(env.PATH, path.dirname(node))
  assert.equal(env.NODE_OPTIONS, ''); assert.equal(env.NODE_PATH, ''); assert.equal(env.PYTHONPATH, '')
  assert.ok(!('GITHUB_TOKEN' in env)); assert.ok(!('HTTP_PROXY' in env)); assert.ok(!('RT_PRE_SEAL_OWNED_POSIX_ROOT' in env))
})

test('non-Mac host cannot claim native chain evidence', { skip: process.platform === 'darwin' }, async () => {
  await assert.rejects(harness.runNative({ python: process.execPath, cacheRoot: os.tmpdir() }), /NATIVE_DARWIN_REQUIRED/)
})

const python = process.env.RT_POSIX_CHAIN_PYTHON || (process.platform === 'win32'
  ? 'D:/RT-ResearchFlow-BuildCache/private-runtime-1.7/PBS 运行 windows-x64/python/python.exe' : '')
test('actual isolated PBS compiles all three test-only Python probes', { skip: !python || !fs.existsSync(python) }, () => {
  const directory = fs.mkdtempSync(path.join(path.resolve(__dirname, '../../.cache'), 'posix-chain-syntax-'))
  try {
    const sources = path.join(directory, 'sources.json')
    fs.writeFileSync(sources, JSON.stringify([harness.ROOT_PROBE, harness.WORKER_PROBE, harness.WATCHER_PROBE]), { flag: 'wx' })
    const code = "import json,sys; sources=json.load(open(sys.argv[1],encoding='utf-8')); [compile(source,'<test-only-probe>','exec') for source in sources]"
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
    const result = spawnSync(python, ['-X', 'utf8', '-I', '-S', '-B', '-c', code, sources], { env, shell: false, timeout: 5000, maxBuffer: 8192 })
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr.toString('utf8'))
  } finally {
    // Only the two files in this freshly created owned syntax-test directory.
    fs.unlinkSync(path.join(directory, 'sources.json')); fs.rmdirSync(directory)
  }
})

test('native Mac separately tests fixed reporter rejection and real API chains without widening its gate', {
  skip: process.platform !== 'darwin' || !process.env.RT_POSIX_CHAIN_PYTHON || !process.env.RT_POSIX_CHAIN_CACHE,
  timeout: 200000,
}, async () => {
  const report = await harness.runNative({ python: process.env.RT_POSIX_CHAIN_PYTHON, cacheRoot: process.env.RT_POSIX_CHAIN_CACHE })
  assert.equal(report.releaseEligible, false); assert.equal(report.productApproval, false)
  assert.equal(report.cases.length, 8)
  assert.equal(report.cases.find(row => row.scenario === 'actual-reporter-gate').preSealPosixInherited, true)
  for (const row of report.cases.filter(row => row.api)) {
    assert.equal(row.productionReporterGateCoversThisApiCase, false)
    assert.equal(row.gateDerivation.productionReporterAuthorityUsed, false)
    assert.equal(row.gateDerivation.authorizedFixedArgv.length, 8)
    const node = row.processes.find(process => process.role === 'node')
    const root = row.processes.find(process => process.role === 'root')
    assert.equal(root.pid, root.pgid); assert.equal(root.pid, root.sid)
    assert.deepEqual(root.argv.slice(-2), ['--pre-seal-owned-posix-root', String(root.pid)])
    assert.equal(node.rootPid, root.pid)
    if (row.scenario === 'outer-timeout') {
      assert.equal(row.outerDeadlineMs, 12000)
      assert.equal(row.timeoutLiveObservation.nodePid, node.pid)
      assert.equal(row.timeoutLiveObservation.workerPid, row.processes.find(process => process.role === 'worker').pid)
      assert.ok(Date.parse(row.timeoutLiveObservation.aliveObservedAt) <= Date.parse(row.outerStartedAt) + row.outerDeadlineMs)
      for (const event of row.kernelEvidence.processes) {
        assert.ok(Date.parse(event.exitObservedAt) >= Date.parse(row.outerStartedAt) + row.outerDeadlineMs - 50)
      }
    }
  }
  for (const api of ['bootstrap.check_dependency_audits', 'adapter.run_token']) {
    assert.deepEqual(report.cases.filter(row => row.api === api).map(row => row.scenario), ['positive', 'outer-timeout', 'root-first'])
  }
})
