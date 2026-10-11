'use strict'

// Test the installed DMG executable, never the source dev host. These checks
// grant no distribution, broker, account or order authority.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ROOT = path.resolve(__dirname, '..')
const RUNTIME_VERIFIER = 'scripts/verify-packaged-runtime.cjs'
const STARTUP_SPEC = 'tests/e2e/packaged-startup.spec.ts'

function fail(code) { throw new Error(code) }
function regularFile(filename) {
  try {
    const stat = fs.lstatSync(filename)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch { return false }
}
function verifyPackagedAcceptance(executablePath, {
  spawn = spawnSync, hasFile = regularFile, platform = process.platform, environment = process.env,
  version = environment.RT_PACKAGED_VERSION || require('../package.json').version,
  arch = process.arch,
  testRoot = environment.RT_PACKAGED_TEST_ROOT || path.join(os.tmpdir(), 'rt-mac-packaged-startup-' + randomUUID()),
} = {}) {
  if (platform !== 'darwin' || typeof executablePath !== 'string' || !path.isAbsolute(executablePath) ||
      path.basename(path.dirname(executablePath)) !== 'MacOS' ||
      path.basename(path.dirname(path.dirname(executablePath))) !== 'Contents') fail('MAC_PACKAGED_EXECUTABLE_INVALID')
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || !['arm64', 'x64'].includes(arch) ||
      typeof testRoot !== 'string' || !path.isAbsolute(testRoot)) fail('MAC_PACKAGED_ACCEPTANCE_CONTEXT_INVALID')
  for (const filename of [executablePath, path.join(ROOT, RUNTIME_VERIFIER), path.join(ROOT, STARTUP_SPEC)]) {
    if (!hasFile(filename)) fail('MAC_PACKAGED_ACCEPTANCE_INPUT_MISSING:' + filename)
  }
  const env = { ...environment, RT_PACKAGED_EXE: executablePath,
    RT_PACKAGED_VERSION: version, RT_PACKAGED_TEST_ROOT: testRoot }
  // The GUI must not inherit the SQLite smoke's Electron-as-Node mode. Keep
  // JSON on stdout so skipped/empty tests cannot silently pass this gate.
  for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH',
    'PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_DIR']) delete env[name]
  const runtime = spawn(process.execPath, [path.join(ROOT, RUNTIME_VERIFIER), executablePath], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
  })
  if (runtime.stdout) process.stdout.write(runtime.stdout)
  if (runtime.stderr) process.stderr.write(runtime.stderr)
  if (runtime.error || runtime.status !== 0) fail('MAC_PACKAGED_RUNTIME_PDF_FAILED')
  const runtimeProofs = []
  for (const line of (runtime.stdout || '').trim().split(/\r?\n/)) {
    try {
      const value = JSON.parse(line)
      if (value?.kind === 'packaged-runtime-verified') runtimeProofs.push(value)
    } catch { /* Non-proof diagnostic output is not an acceptance result. */ }
  }
  if (runtimeProofs.length !== 1) fail('MAC_PACKAGED_RUNTIME_PROOF_INVALID')
  const runtimeProof = runtimeProofs[0]
  if (runtimeProof.version !== version || runtimeProof.arch !== arch || !runtimeProof.electron ||
      runtimeProof.pdf !== true || runtimeProof.canvas !== true || runtimeProof.sqlite !== true) fail('MAC_PACKAGED_RUNTIME_PROOF_MISMATCH')
  const gui = spawn('pnpm', ['exec', 'playwright', 'test', STARTUP_SPEC,
    '--workers=1', '--retries=0', '--reporter=json'], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024,
  })
  if (gui.stderr) process.stderr.write(gui.stderr)
  if (gui.error || gui.status !== 0) {
    if (gui.stdout) process.stderr.write(gui.stdout)
    fail('MAC_PACKAGED_GUI_STARTUP_FAILED')
  }
  let report
  try { report = JSON.parse(gui.stdout) } catch { fail('MAC_PACKAGED_GUI_REPORT_INVALID') }
  const stats = report.stats
  if (!stats || !Number.isSafeInteger(stats.expected) || stats.expected < 1 ||
      stats.unexpected !== 0 || stats.skipped !== 0 || stats.flaky !== 0 ||
      !Array.isArray(report.errors) || report.errors.length !== 0) fail('MAC_PACKAGED_GUI_TESTS_NOT_ACCEPTED')
  return {
    kind: 'rt-mac-installed-packaged-acceptance-v1', executablePath, version, arch, testRoot,
    runtimeVerifier: RUNTIME_VERIFIER, runtimeVerifierPassed: true,
    runtimeProof,
    startupSpec: STARTUP_SPEC, guiStartupPassed: true,
    guiStats: { expected: stats.expected, unexpected: stats.unexpected, skipped: stats.skipped, flaky: stats.flaky },
  }
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) fail('Usage: node scripts/mac-packaged-acceptance.cjs /absolute/App.app/Contents/MacOS/App')
    console.log(JSON.stringify(verifyPackagedAcceptance(process.argv[2])))
  } catch (error) { console.error(error.stack || error.message); process.exitCode = 1 }
}
module.exports = { verifyPackagedAcceptance, RUNTIME_VERIFIER, STARTUP_SPEC }
