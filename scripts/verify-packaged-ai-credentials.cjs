'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { SPEC, requireCredentialReport } = require('./packaged-ai-credential-proof.cjs')
const ROOT = path.resolve(__dirname, '..')
async function digest(filename) {
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('PACKAGED_CREDENTIAL_TARGET_INVALID')
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}
function asarPath(executable, platform = process.platform) {
  return platform === 'darwin' ? path.join(path.dirname(path.dirname(executable)), 'Resources', 'app.asar')
    : path.join(path.dirname(executable), 'resources', 'app.asar')
}
async function main() {
  const executable = process.argv[2]
  if (process.argv.length !== 3 || !path.isAbsolute(executable || '') || !['win32', 'darwin'].includes(process.platform)) throw Error('PACKAGED_CREDENTIAL_TARGET_INVALID')
  const version = require('../package.json').version
  if (process.env.RT_PACKAGED_VERSION !== version) throw Error('PACKAGED_CREDENTIAL_VERSION_INVALID')
  const root = path.join(process.env.RT_PACKAGED_TEST_ROOT || os.tmpdir(), 'credentials-' + crypto.randomUUID())
  fs.mkdirSync(root, { recursive: true })
  const before = { executableSha256: await digest(executable), appAsarSha256: await digest(asarPath(executable)) }
  const env = { ...process.env, RT_PACKAGED_EXE: executable, RT_AI_CREDENTIAL_FIXTURE_ALLOWED: '1', RT_PACKAGED_TEST_ROOT: root }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_PATH', 'NODE_OPTIONS', 'PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_DIR']) delete env[key]
  const result = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/@playwright/test/cli.js'), 'test', SPEC,
    '--workers=1', '--retries=0', '--reporter=json'], { cwd: ROOT, env, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024 })
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error || result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout)
    throw Error('PACKAGED_CREDENTIAL_TEST_FAILED')
  }
  const stats = requireCredentialReport(JSON.parse(result.stdout))
  if (await digest(executable) !== before.executableSha256 || await digest(asarPath(executable)) !== before.appAsarSha256) throw Error('PACKAGED_CREDENTIAL_TARGET_CHANGED')
  const proof = { kind: 'rt-packaged-ai-credentials-v1', version, sourceCommit: process.env.GITHUB_SHA || null,
    runId: process.env.GITHUB_RUN_ID || null, platform: process.platform, arch: process.arch,
    ...before, stats, localCredentialPersistenceVerified: true, fixture: 'synthetic-loopback', brokerOrdersSubmitted: false }
  // Playwright clears test-results at the next installed-app check. Keep the
  // verified receipt outside that disposable directory until publication.
  fs.mkdirSync(path.join(ROOT, 'release'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, `release/packaged-ai-credentials-proof-${process.platform}-${process.arch}.json`), JSON.stringify(proof, null, 2) + '\n')
  console.log(JSON.stringify(proof))
}
if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
module.exports = { digest, asarPath }
