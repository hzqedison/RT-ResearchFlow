'use strict'

// Records actual compiler calls without editing dependencies or bypassing hooks.
// These observations are not release acceptance or installed-application proof.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')

const PATCH_SHA256 = 'f68e2bd73a81618599904c64c70dee8ac3e1225d0e6a37730cb0b46857df6895'
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

function orderedEntries(object) {
  return Object.keys(object).map((key) => {
    const value = object[key]
    const scalar = (item) => item === null || ['string', 'number', 'boolean'].includes(typeof item)
    if (!scalar(value) && !(Array.isArray(value) && value.every(scalar))) {
      throw new Error(`Unsupported compiler value: ${key}`)
    }
    return [key, Array.isArray(value) ? [...value] : value]
  })
}

function createCompileRecorder(original, write, records = [], verifyInputs = null) {
  return async function recordCompile(defines, commands, script) {
    if (typeof script !== 'string') throw new Error('Compiler input must be text')
    const sequence = records.length + 1
    const phase = Object.hasOwn(defines, 'BUILD_UNINSTALLER') ? 'uninstaller' : 'installer'
    const stem = `${String(sequence).padStart(2, '0')}-${phase}`
    const bytes = Buffer.from(script, 'utf8')
    const record = {
      schemaVersion: 1,
      sequence,
      phase,
      definesEntries: orderedEntries(defines),
      commandsEntries: orderedEntries(commands),
      scriptPath: `proof/compiler/${stem}.input.nsi`,
      scriptBytes: bytes.length,
      scriptSha256: sha256(bytes),
      observationBoundary: 'NsisTarget.executeMakensis arguments and promise result',
      rawProcessArgumentsObserved: false,
      sourceSnapshotRechecked: false,
      result: 'started'
    }
    records.push(record)
    write(record.scriptPath, bytes)
    const recordPath = `proof/compiler/${stem}.invocation.json`
    if (verifyInputs !== null) {
      if (verifyInputs() !== true) throw new Error('Compiler input snapshot verification failed')
      record.sourceSnapshotRechecked = true
    }
    write(recordPath, Buffer.from(JSON.stringify(record, null, 2) + '\n'))
    let result
    try {
      result = await original.call(this, defines, commands, script)
    } catch (compilerError) {
      record.result = 'rejected'
      try {
        write(recordPath, Buffer.from(JSON.stringify(record, null, 2) + '\n'))
      } catch {
        // Failure to persist evidence must not replace the compiler exception.
        record.recordingFailed = true
      }
      throw compilerError
    }
    record.result = 'resolved'
    // A recording failure rejects the collector, not the observed compiler call.
    write(recordPath, Buffer.from(JSON.stringify(record, null, 2) + '\n'))
    return result
  }
}

function checkedFile(filename) {
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular file: ${filename}`)
  const bytes = fs.readFileSync(filename)
  return { bytes, sha256: sha256(bytes), size: bytes.length }
}

function parseArguments(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    if (!['--config', '--output'].includes(name) || !argv[index + 1] || result[name]) {
      throw new Error('Usage: --config <builder-config> --output <new-proof-directory>')
    }
    result[name] = path.resolve(argv[index + 1])
  }
  if (!result['--config'] || !result['--output']) throw new Error('Both config and output are required')
  return result
}

async function main(argv = process.argv.slice(2)) {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('Build proof collection is restricted to a disposable GitHub-hosted Windows runner')
  }
  const args = parseArguments(argv)
  const root = path.resolve(__dirname, '..')
  const output = args['--output']
  if (fs.existsSync(output)) throw new Error('Proof directory must not already exist')
  // Reject reparse points in existing output ancestors before creating anything.
  let ancestor = path.dirname(output)
  for (;;) {
    if (fs.existsSync(ancestor)) {
      const stat = fs.lstatSync(ancestor)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe proof ancestor')
    }
    const parent = path.dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  const inputFiles = {
    'proof/patches/app-builder-lib@24.13.3.patch': path.join(root, 'patches/app-builder-lib@24.13.3.patch'),
    'proof/resources/installer.nsh': path.join(root, 'resources/installer.nsh'),
    'proof/source/package.json': path.join(root, 'package.json'),
    'proof/source/pnpm-lock.yaml': path.join(root, 'pnpm-lock.yaml'),
    'proof/source/builder-config': args['--config']
  }
  const patch = checkedFile(inputFiles['proof/patches/app-builder-lib@24.13.3.patch'])
  if (patch.sha256 !== PATCH_SHA256) throw new Error('Audited installer patch hash mismatch')
  const metadata = JSON.parse(checkedFile(inputFiles['proof/source/package.json']).bytes)
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error('Expected three-part application version')
  const projectRequire = createRequire(path.join(root, 'package.json'))
  const builderPackage = projectRequire.resolve('electron-builder/package.json')
  const builderRequire = createRequire(builderPackage)
  const appBuilderPackage = builderRequire.resolve('app-builder-lib/package.json')
  const appBuilderRoot = path.dirname(appBuilderPackage)
  const appBuilderMetadata = JSON.parse(checkedFile(appBuilderPackage).bytes)
  if (appBuilderMetadata.version !== '24.13.3') throw new Error('Unreviewed app-builder-lib version')
  const builderMetadata = JSON.parse(checkedFile(builderPackage).bytes)
  for (const relative of ['multiUser.nsh', 'include/installUtil.nsh', 'installSection.nsh']) {
    inputFiles[`proof/templates/${relative}`] = path.join(appBuilderRoot, 'templates/nsis', relative)
  }
  const sources = Object.entries(inputFiles).map(([relative, filename]) => [relative, checkedFile(filename)])
  fs.mkdirSync(output, { recursive: true })
  const proofFiles = new Map()
  function write(relative, bytes) {
    if (!/^[a-zA-Z0-9@._/-]+$/.test(relative) || relative.split('/').includes('..')) {
      throw new Error('Unsafe proof filename')
    }
    const destination = path.join(output, ...relative.split('/'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, bytes)
    proofFiles.set(relative, { path: relative, bytes: bytes.length, sha256: sha256(bytes) })
  }
  for (const [relative, file] of sources) write(relative, file.bytes)
  const { NsisTarget } = builderRequire(path.join(appBuilderRoot, 'out/targets/nsis/NsisTarget.js'))
  const original = NsisTarget.prototype.executeMakensis
  if (typeof original !== 'function') throw new Error('Compiler observation boundary unavailable')
  const records = []
  const verifyInputs = () => {
    for (const [relative, filename] of Object.entries(inputFiles)) {
      const expected = proofFiles.get(relative)
      const actual = checkedFile(filename)
      if (!expected || actual.sha256 !== expected.sha256 || actual.size !== expected.bytes) {
        throw new Error(`Build input changed before compilation: ${relative}`)
      }
    }
    return true
  }
  const wrapped = createCompileRecorder(original, write, records, verifyInputs)
  NsisTarget.prototype.executeMakensis = wrapped
  let artifacts
  try {
    artifacts = await projectRequire('electron-builder').build({
      projectDir: root, config: args['--config'], win: ['nsis'], x64: true, publish: 'never'
    })
  } finally {
    if (NsisTarget.prototype.executeMakensis === wrapped) NsisTarget.prototype.executeMakensis = original
  }
  if (records.length !== 2 || records[0].phase !== 'uninstaller' ||
      records[1].phase !== 'installer' || records.some((record) => record.result !== 'resolved')) {
    throw new Error('Expected exactly two successful compiler observations')
  }
  const filename = `RT-ResearchFlow-Setup-${metadata.version}-x64.exe`
  const matches = artifacts.filter((item) => path.basename(item) === filename)
  if (matches.length !== 1) throw new Error('Expected exactly one final installer')
  const installer = checkedFile(matches[0])
  write(filename, installer.bytes)
  const observation = {
    schemaVersion: 1,
    kind: 'rt-nsis-build-observations',
    releaseAccepted: false,
    declaredProducer: {
      repository: process.env.GITHUB_REPOSITORY || null,
      runId: process.env.GITHUB_RUN_ID || null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
      sourceSha: process.env.GITHUB_SHA || null,
      independentlyVerified: false
    },
    candidate: { filename, bytes: installer.size, sha256: installer.sha256, sourceVersion: metadata.version },
    build: { nodeVersion: process.version, electronBuilderVersion: builderMetadata.version,
      appBuilderLibVersion: appBuilderMetadata.version, publish: 'never', promiseResolved: true },
    compiler: { calls: records.length, rawProcessArgumentsObserved: false },
    proofFiles: [...proofFiles.values()],
    pendingAcceptance: ['producer identity and source tree', 'runtime manifest and license approval',
      'compiler identity and applied patch semantics', 'installed application and upgrade scenarios',
      'artifact upload digest and immutable receipt']
  }
  write('nsis-build-observations.json', Buffer.from(JSON.stringify(observation, null, 2) + '\n'))
  return observation
}

module.exports = { createCompileRecorder, orderedEntries, parseArguments, sha256, main }
if (require.main === module) main().then(() => process.stdout.write('Build observations collected; release acceptance remains pending.\n'))
  .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
