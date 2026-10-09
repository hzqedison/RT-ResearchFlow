'use strict'

// Hosted native regression fixture, not a product installer acceptance test.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { signAppPreservingRuntime } = require('../../macos/sign-app.cjs')

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const root = path.resolve(__dirname, '../..')
let stage = 'host-context'
let ownedLab = ''

function plist(name, executable, id) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0"><dict><key>CFBundleName</key><string>' + name + '</string>' +
    '<key>CFBundleIdentifier</key><string>' + id + '</string>' +
    '<key>CFBundleExecutable</key><string>' + executable + '</string>' +
    '<key>CFBundlePackageType</key><string>APPL</string>' +
    '<key>CFBundleVersion</key><string>1</string></dict></plist>\n'
}

function makeApp(app, name, id) {
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true })
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), plist(name, name, id))
  const executable = path.join(app, 'Contents', 'MacOS', name)
  fs.copyFileSync(process.execPath, executable, fs.constants.COPYFILE_EXCL)
  fs.chmodSync(executable, 0o755)
  return executable
}

function inventory(directory) {
  const entries = []
  function walk(base) {
    for (const name of fs.readdirSync(base).sort()) {
      const file = path.join(base, name)
      const stat = fs.lstatSync(file)
      assert.equal(stat.isSymbolicLink(), false)
      if (stat.isDirectory()) walk(file)
      else {
        assert.equal(stat.isFile(), true)
        entries.push({ path: path.relative(directory, file).split(path.sep).join('/'),
          mode: stat.mode & 0o777, size: stat.size, sha256: hash(fs.readFileSync(file)) })
      }
    }
  }
  walk(directory)
  return entries
}

async function main() {
  assert.equal(process.platform, 'darwin')
  assert.ok(['arm64', 'x64'].includes(process.arch))
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
  assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/)
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''))
  const temporary = fs.realpathSync(process.env.RUNNER_TEMP)
  const lab = fs.mkdtempSync(path.join(temporary, 'RT signing \u4e2d\u6587 '))
  ownedLab = lab
  stage = 'construct-owned-fixture'
  const app = path.join(lab, 'RT-Signing-Fixture.app')
  const executable = makeApp(app, 'RT-Signing-Fixture', 'com.tradewatcher.signing-fixture')
  const helper = path.join(app, 'Contents', 'Frameworks', 'RT-Helper.app')
  makeApp(helper, 'RT-Helper', 'com.tradewatcher.signing-fixture.helper')
  const runtime = path.join(app, 'Contents', 'Resources', 'private-python-runtime')
  fs.mkdirSync(path.join(runtime, 'node', 'bin'), { recursive: true })
  const privateNode = path.join(runtime, 'node', 'bin', 'node')
  fs.copyFileSync(process.execPath, privateNode, fs.constants.COPYFILE_EXCL)
  fs.chmodSync(privateNode, 0o755)
  fs.writeFileSync(path.join(runtime, 'locked-fixture.txt'), 'Isolated signing fixture, not a formal runtime.\n')
  fs.writeFileSync(path.join(runtime, '\u4e2d\u6587 fixture.txt'), 'Unicode file must remain unchanged.\n')
  const before = inventory(runtime)
  stage = 'sign-owned-app'
  await signAppPreservingRuntime(app)
  stage = 'compare-locked-runtime'
  assert.deepEqual(inventory(runtime), before)
  stage = 'verify-app-signature'
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 60000 })
  stage = 'verify-helper-signature'
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', helper], { timeout: 60000 })
  const env = { HOME: lab, TMPDIR: lab, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
  const invoke = file => execFileSync(file, ['--version'], { env, timeout: 30000, encoding: 'utf8' }).trim()
  stage = 'invoke-owned-main'
  assert.equal(invoke(executable), process.version)
  stage = 'invoke-owned-private-node'
  assert.equal(invoke(privateNode), process.version)
  const sources = ['macos/sign-app.cjs', 'macos/electron-builder.cjs',
    'tests/node/mac-sign-app.test.cjs', 'tests/native/mac-signing-runtime.cjs',
    '.github/workflows/mac-runtime-signing-native.yml']
  const report = {
    kind: 'rt-native-mac-signing-regression-v1', sourceCommit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    target: 'darwin-' + process.arch, nativeNode: process.version,
    signature: 'ad-hoc', strictAppVerified: true, nestedHelperVerified: true,
    lockedRuntimeBytesPreserved: true, ownedNativeExecutablesRan: true,
    fixtureInventory: before,
    sourceHashes: Object.fromEntries(sources.map(file => [file, hash(fs.readFileSync(path.join(root, file)))])),
    productRuntimeTested: false, productInstallerTested: false, minimumMacOSLiveVerified: false,
  }
  const proof = path.join(temporary, 'mac-signing-proof')
  stage = 'export-proof'
  fs.mkdirSync(proof)
  const raw = Buffer.from(JSON.stringify(report, null, 2) + '\n')
  fs.writeFileSync(path.join(proof, 'result.json'), raw, { flag: 'wx' })
  fs.writeFileSync(path.join(proof, 'SHA256SUMS.txt'), hash(raw) + '  result.json\n', { flag: 'wx' })
  console.log(JSON.stringify({ target: report.target, strictAppVerified: true,
    lockedRuntimeBytesPreserved: true, productInstallerTested: false }))
}

main().catch(error => {
  // All fixture inputs are generated here on a disposable hosted runner. The
  // bounded diagnostic never includes environment variables or application data.
  let message = String(error.message || 'Native regression rejected')
  for (const [source, label] of [[ownedLab, 'OWNED_FIXTURE'], [root, 'SOURCE_CHECKOUT']]) {
    if (source) message = message.split(source).join(label)
  }
  console.error(JSON.stringify({ kind: 'rt-native-mac-signing-failure-v1', stage,
    errorType: /^[A-Za-z]{1,40}$/.test(error.name || '') ? error.name : 'Error',
    message: message.slice(0, 1024), productInstallerTested: false }))
  process.exitCode = 1
})

