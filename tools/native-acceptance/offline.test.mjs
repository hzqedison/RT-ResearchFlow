import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import * as evidence from './evidence.mjs'
import { scanEvidence, hash, relative, safeEnvironment, assertHosted, validateManifest, minimalResult, contract } from './evidence.mjs'
const require = createRequire(import.meta.url)
const manifest = require('../../tests/fixtures/releases/native-upgrade-1.0-1.1.json')

test('frozen official input identities and all three asset pairs', () => {
  assert.equal(validateManifest(manifest), manifest)
  for (const release of manifest.releases) {
    assert.equal(release.tag, 'v' + release.version)
    for (const [platform, arch] of [['windows', 'x64'], ['macOS', 'arm64'], ['macOS', 'x64']]) {
      assert.match(release.assets[platform][arch].sha256, /^[a-f0-9]{64}$/)
    }
  }
})
test('unknown version, source, missing pins fail closed', () => {
  for (const mutate of [value => { value.releases[0].version = '1.0.1' }, value => { value.releases[1].sourceSha = 'a'.repeat(40) },
    value => { delete value.releases[0].assets.macOS.x64 }]) {
    const value = structuredClone(manifest); mutate(value)
    assert.throws(() => validateManifest(value), error => error.kind === 'BLOCKED_INPUT')
  }
})
test('evidence rejects secrets, absolute paths and arbitrary fields', () => {
  for (const value of [{ path: '/Users/private/profile' }, { path: 'C:\\Users\\private' }, { rawDatabase: 'anything' },
    { reasonCode: 'NOT-A-REAL-CREDENTIAL:synthetic' }, { reasonCode: 'NA_KEYCHAIN_PASSWORD:synthetic' }, { reasonCode: 'Bearer token' }]) {
    assert.throws(() => scanEvidence(value))
  }
  assert.throws(() => scanEvidence({ reasonCode: 'arbitrary-runtime-secret' }, ['arbitrary-runtime-secret']))
})
test('evidence permits only a synthetic sanitized outcome', () => {
  const result = minimalResult({ harnessSha: 'a'.repeat(40), caseId: 'offline', runId: '1', runAttempt: '1', platform: 'windows', arch: 'x64' }, 'BLOCKED_ENVIRONMENT', 'OFFLINE_ONLY')
  assert.doesNotThrow(() => scanEvidence(result))
  assert.equal(result.complete, false)
})
test('relative paths cannot escape or identify the whole root', () => {
  const root = process.platform === 'win32' ? 'C:\\owned' : '/owned'
  assert.equal(relative(root, root + '/child/file'), 'child/file')
  assert.throws(() => relative(root, root))
  assert.throws(() => relative(root, root + '/../elsewhere'))
})
test('application environment never inherits credential/debug variables', () => {
  const saved = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, NODE_OPTIONS: process.env.NODE_OPTIONS, DEBUG: process.env.DEBUG }
  try {
    process.env.GITHUB_TOKEN = 'offline-token'; process.env.NODE_OPTIONS = '--inspect'; process.env.DEBUG = '*'
    const environment = safeEnvironment()
    assert.equal(environment.GITHUB_TOKEN, undefined); assert.equal(environment.NODE_OPTIONS, undefined); assert.equal(environment.DEBUG, undefined)
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
})
test('workstation cannot invoke native operations', () => {
  const previous = process.env.CI
  try { process.env.CI = 'false'; assert.throws(() => assertHosted('windows', 'x64'), /HOSTED_NATIVE_CI_REQUIRED/) }
  finally { if (previous === undefined) delete process.env.CI; else process.env.CI = previous }
})
test('identity fields are deliberately not equated', () => {
  assert.equal(contract.packageName, 'rt-research-flow')
  assert.notEqual(contract.packageName, contract.productName)
  assert.notEqual(contract.builderAppId, contract.windowsAppUserModelId)
  assert.deepEqual(contract.migrationPolicy.allowedAddedVersions, [])
})
test('hash is deterministic and no plaintext is returned', () => {
  assert.match(hash('offline synthetic'), /^[a-f0-9]{64}$/)
  assert.equal(hash('offline synthetic'), hash('offline synthetic'))
})

// Development-only compiler already present in the repository. No app, browser,
// filesystem mutation, registry, firewall, download or Keychain operation is run.
const ts = require('typescript')
const compiledHarness = ts.transpileModule(fs.readFileSync(new URL('./harness.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText
const expectedJsonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function offlineHarness({ programs = ['C:\\offline-case\\install\\RT-ResearchFlow.exe'],
  registration = { key: 'HKEY_CURRENT_USER\\offline-uninstall-key', location: 'C:\\offline-case\\install' },
  freezeFailure, installFailure, cleanupFailure, archiveFailure } = {}) {
  const root = path.join(path.parse(process.cwd()).root, 'native-offline-never-created')
  const owner = { root, caseId: 'offline-case', harnessSha: 'a'.repeat(40), runId: '1', runAttempt: '1', platform: 'windows', arch: 'x64' }
  const assets = contract.versions.map(version => ({ version, absolute: path.join(root, 'synthetic-' + version + '.exe'), sha256: 'b'.repeat(64) }))
  const writes = [], platformCalls = [], documents = new Map()
  const journal = { ...minimalResult(owner, 'BLOCKED_ENVIRONMENT', 'RUN_IN_PROGRESS'), diagnostics: [], checkpoints: [] }
  const forbidden = name => () => { throw new Error('OFFLINE_FORBIDDEN_OPERATION:' + name) }
  const dependencies = {
    'node:fs': {
      existsSync: () => false,
      writeFileSync: (file, value) => { assert.ok(file.startsWith(root + path.sep)); writes.push({ file, value }) },
      readFileSync: forbidden('readFileSync'),
    },
    'node:path': path,
    'node:https': {
      get: (_url, _options, onResponse) => {
        queueMicrotask(() => onResponse({ statusCode: 200, resume() {} }))
        return { on() { return this }, destroy: forbidden('unexpected-probe-timeout') }
      },
    },
    'node:http': { createServer: forbidden('listen') },
    'node:crypto': { randomBytes },
    '@playwright/test': { _electron: { launch: forbidden('electron.launch') } },
    './evidence.mjs': {
      ...evidence,
      checkpoint: (stage, phase) => { journal.stage = stage; journal.checkpoints.push({ stage, phase: phase || 'A' }); return journal },
      requireFrozenExecution: () => {
        if (freezeFailure) throw freezeFailure
        return { harnessSha: owner.harnessSha, freezeSha256: 'd'.repeat(64), combinedSha256: 'c'.repeat(64), fileCount: 16 }
      },
      recordFailure: (error, stage, code) => {
        evidence.applyFailure(journal, error, stage, code)
        documents.set('acceptance-result.json', structuredClone(journal))
        return journal
      },
      controlledRoot: () => ({ root, owner }),
      validatedInputs: async () => ({ root, owner, assets }),
      hashFile: async () => 'b'.repeat(64),
      platformCommand: async (action, args) => {
        platformCalls.push({ action, args })
        if (action === 'setup') return { uid: 'offline-user', programs, policy: 'offline-app-policy' }
        if (action === 'install') {
          if (installFailure) throw installFailure
          return { uid: 'offline-user', exitCode: 0, durationMs: 1, events: [], registration }
        }
        if (action === 'processes') return { processes: [] }
        throw new Error('OFFLINE_FORBIDDEN_PLATFORM_ACTION:' + action)
      },
      command: forbidden('command'), cleanup: async () => { if (cleanupFailure) throw cleanupFailure },
      writeEvidence: (name, value, secrets) => {
        if (archiveFailure && name === 'network-isolation.json') throw archiveFailure
        if (name === 'acceptance-result.json') value = evidence.mergeRunState(value, journal)
        scanEvidence(value, secrets); documents.set(name, structuredClone(value))
      },
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(compiledHarness, {
    module, exports: module.exports, setTimeout, clearTimeout,
    require: name => {
      assert.ok(Object.hasOwn(dependencies, name), 'Unexpected harness import: ' + name)
      return dependencies[name]
    },
  }, { filename: 'offline-compiled-harness.cjs', timeout: 2000 })
  const harness = new module.exports.NativeUpgrade()
  harness.assets = assets; harness.uid = 'offline-user'
  return { harness, root, writes, platformCalls, documents }
}

async function runThroughWindowsSetup(programs, requestCount = 0) {
  const context = offlineHarness({ programs })
  context.harness.loopback = async () => { context.harness.requestCount = requestCount }
  let reachedInstall = false
  context.harness.install = async index => {
    assert.equal(index, 0); reachedInstall = true
    throw new evidence.AcceptanceError('BLOCKED_INPUT', 'OFFLINE_STOP_BEFORE_INSTALL')
  }
  await assert.rejects(context.harness.execute(), error => error.kind === 'BLOCKED_INPUT' && error.code === 'OFFLINE_STOP_BEFORE_INSTALL')
  assert.equal(reachedInstall, true, 'Real Windows setup path must pass hashing before the deliberately stopped install')
  assert.deepEqual(context.platformCalls.map(item => item.action), ['setup'])
  return context
}

test('real Windows setup hashes the programs array: stable inputs and changed content', async () => {
  const programs = ['C:\\offline-case\\install\\RT-ResearchFlow.exe', 'C:\\offline-case\\install\\helper.exe']
  const first = await runThroughWindowsSetup(programs)
  const same = await runThroughWindowsSetup([...programs])
  const changed = await runThroughWindowsSetup([programs[0], 'C:\\offline-case\\install\\different.exe'])
  assert.equal(first.harness.network.policySha256, expectedJsonHash(programs))
  assert.equal(first.harness.network.policySha256, same.harness.network.policySha256)
  assert.notEqual(first.harness.network.policySha256, changed.harness.network.policySha256)
})

test('real Windows install hashes the registration identity: both fields affect its digest', async () => {
  const registration = { key: 'HKEY_CURRENT_USER\\offline-key', location: 'C:\\offline-case\\install' }
  async function digest(value) {
    const context = offlineHarness({ registration: value })
    await context.harness.install(0)
    assert.deepEqual(context.platformCalls.map(item => item.action), ['install', 'processes'])
    assert.equal(context.harness.installEvents.length, 1)
    return context.harness.installEvents[0].registrationSha256
  }
  const first = await digest(registration)
  assert.equal(first, expectedJsonHash(registration))
  assert.equal(first, await digest({ location: registration.location, key: registration.key }))
  assert.notEqual(first, await digest({ ...registration, key: registration.key + '-changed' }))
  assert.notEqual(first, await digest({ ...registration, location: registration.location + '-changed' }))
})

test('byte hashing preserves string, Buffer and typed-array semantics; structured values are not coerced', () => {
  const bytes = Buffer.from([0, 1, 127, 128, 255])
  assert.equal(hash(bytes), createHash('sha256').update(bytes).digest('hex'))
  assert.equal(hash(new Uint8Array(bytes)), hash(bytes))
  assert.equal(hash(Buffer.from('offline text')), hash('offline text'))
  for (const structured of [['synthetic.exe'], { key: 'synthetic', location: 'synthetic' }]) {
    assert.throws(() => hash(structured), error => error.code === 'ERR_INVALID_ARG_TYPE')
  }
})

function onboardingPage(expected) {
  const calls = [], storage = new Map(), sources = []
  const state = { feed: false, opened: false, step: 0, applicationRequested: false, officialReplyReceived: false, dataPermissionAcknowledged: false }
  const persistProgress = () => storage.set(contract.onboardingStorageKey, JSON.stringify({
    applicationRequested: state.applicationRequested, officialReplyReceived: state.officialReplyReceived,
    dataPermissionAcknowledged: state.dataPermissionAcknowledged,
  }))
  const types = new Map([
    ['nav-tab-feed', 'button'], ['quant-onboarding-open', 'button'], ['quant-onboarding-step-1', 'button'],
    ['quant-application-reported', 'button'], ['quant-official-reply-reported', 'button'],
    ['quant-onboarding-step-2', 'button'], ['quant-data-permission-acknowledged', 'checkbox'],
  ])
  async function act(id, operation) {
    assert.ok(types.has(id), 'Unknown UI control')
    assert.equal(operation, types.get(id) === 'checkbox' ? 'check' : 'click', 'Wrong operation for ' + types.get(id) + ': ' + id)
    // An asynchronous transition also checks that the harness awaits registration
    // before clicking the initially-disabled official-reply button.
    await Promise.resolve()
    if (id === 'nav-tab-feed') state.feed = true
    else if (id === 'quant-onboarding-open') { assert.equal(state.feed, true); state.opened = true }
    else {
      assert.equal(state.opened, true)
      if (id === 'quant-onboarding-step-1') state.step = 1
      if (id === 'quant-application-reported') { assert.equal(state.step, 1); state.applicationRequested = true; persistProgress() }
      if (id === 'quant-official-reply-reported') { assert.equal(state.step, 1); assert.equal(state.applicationRequested, true, 'Official reply is disabled before application registration'); state.officialReplyReceived = true; persistProgress() }
      if (id === 'quant-onboarding-step-2') { assert.equal(state.officialReplyReceived, true); state.step = 2 }
      if (id === 'quant-data-permission-acknowledged') { assert.equal(state.step, 2); state.dataPermissionAcknowledged = true; persistProgress() }
    }
    calls.push([id, operation])
  }
  const page = {
    getByTestId: id => ({ click: () => act(id, 'click'), check: () => act(id, 'check') }),
    getByRole: (role, options) => ({ click: async () => {
      assert.equal(role, 'button'); assert.equal(options.name, '\u5173\u95ed\u91cf\u5316\u5f00\u901a\u5f15\u5bfc')
      assert.equal(state.dataPermissionAcknowledged, true); state.opened = false; calls.push(['close', 'click'])
    } }),
    evaluate: async (callback, input) => vm.runInNewContext('(' + callback.toString() + ')(input)', {
      input,
      window: { api: {
        settings: { update: async value => assert.deepEqual(structuredClone(value), contract.settings) },
        ai: { saveConfig: async value => { assert.equal(value.providerConfig.baseUrl, expected.baseUrl); assert.equal(value.providerConfig.apiKey, undefined) } },
        sources: {
          add: async value => { sources.push({ ...value, id: 7, isEnabled: true }) },
          list: async () => sources,
          toggle: async (id, enabled) => { assert.equal(id, 7); assert.equal(enabled, false); sources[0].isEnabled = enabled },
        },
      } },
      localStorage: { setItem: (key, value) => {
        assert.equal(key, contract.caseStorageKey, 'Harness may not forge onboarding progress through localStorage')
        storage.set(key, value)
      } },
    }, { timeout: 1000 }),
  }
  return { page, calls, storage, state, sources }
}

test('real seed clicks ordered registration buttons and checks only the permission checkbox', async () => {
  const { harness, writes } = offlineHarness()
  harness.expected = { origin: 'http://127.0.0.1:12345', baseUrl: 'http://127.0.0.1:12345/v1', maxTokens: 2048,
    presetPrompt: 'offline-prompt', sourceName: 'offline-source' }
  harness.network.inherited = true
  harness.network.controls = ['node', 'electron', 'child'].map(transport => ({ transport, loopback: true, externalDenied: true }))
  const ui = onboardingPage(harness.expected)
  // Negative controls demonstrate that the double rejects the two original bugs.
  await assert.rejects(ui.page.getByTestId('quant-application-reported').check(), /Wrong operation for button/)
  await assert.rejects(ui.page.getByTestId('quant-official-reply-reported').check(), /Wrong operation for button/)
  await assert.rejects(ui.page.getByTestId('quant-data-permission-acknowledged').click(), /Wrong operation for checkbox/)
  harness.page = ui.page
  await harness.seed()
  assert.deepEqual(ui.calls, [
    ['nav-tab-feed', 'click'], ['quant-onboarding-open', 'click'], ['quant-onboarding-step-1', 'click'],
    ['quant-application-reported', 'click'], ['quant-official-reply-reported', 'click'], ['quant-onboarding-step-2', 'click'],
    ['quant-data-permission-acknowledged', 'check'], ['close', 'click'],
  ])
  assert.deepEqual(JSON.parse(ui.storage.get(contract.onboardingStorageKey)), {
    applicationRequested: true, officialReplyReceived: true, dataPermissionAcknowledged: true,
  })
  assert.equal(ui.storage.get(contract.caseStorageKey), harness.marker)
  assert.equal(harness.sourceId, 7); assert.equal(ui.sources[0].isEnabled, false)
  assert.equal(writes.length, 1); assert.equal(path.basename(writes[0].file), contract.sentinelBasename)
})

test('network evidence explicitly scopes cumulative loopback and never invents background OS counts', async () => {
  const { documents } = await runThroughWindowsSetup(['C:\\offline-case\\install\\RT-ResearchFlow.exe'], 7)
  const network = documents.get('network-isolation.json')
  assert.equal(network.scope, 'startup-transport-self-checks-and-cumulative-loopback-only')
  assert.equal(network.verification, 'controls-are-self-checks; complete-background-OS-denial-counts-not-collected')
  assert.equal(network.requestCount, 7)
  assert.equal(network.records.length, 1)
  assert.equal(network.records[0].requestCount, 7)
  assert.equal(network.records[0].scope, 'cumulative-loopback-since-observer-start')
  assert.equal(network.records[0].verification, 'phase-is-collection-end-not-request-stage')
  assert.equal(Object.hasOwn(network, 'blockedAttempts'), false)
  assert.equal(Object.hasOwn(network.records[0], 'blockedAttempts'), false)
  assert.doesNotThrow(() => scanEvidence(network))
})

function memoryReporter() {
  const owner = { harnessSha: 'a'.repeat(40), caseId: 'offline', runId: '1', runAttempt: '1', platform: 'macOS', arch: 'arm64' }
  const state = minimalResult(owner, 'BLOCKED_ENVIRONMENT', 'RUN_IN_PROGRESS')
  state.stage = 'discovery-or-worker-start'; state.checkpoints = []; state.diagnostics = []
  const output = []
  const io = {
    checkpoint(stage) { state.stage = stage; state.checkpoints.push({ stage }) },
    stage: () => state.stage,
    fail: (error, stage, code) => evidence.applyFailure(state, error, stage, code),
    state: () => state,
    output: line => output.push(line),
  }
  return { state, output, io, reporter: new evidence.default({}, io) }
}

test('reporter captures module/worker failure before a test body, without placeholder evidence', () => {
  const { reporter, state, output } = memoryReporter()
  const error = new SyntaxError('NOT-A-REAL-CREDENTIAL:private input must not escape')
  error.stack = 'SyntaxError: private\n at K:/workspace/tools/native-acceptance/harness.ts:18:4'
  reporter.onError(error) // No onBegin, onTestBegin, constructor or application ever ran.
  reporter.onEnd({ status: 'failed' })
  assert.equal(state.status, 'BLOCKED_ENVIRONMENT')
  assert.equal(state.reasonCode, 'RUNNER_ERROR')
  assert.equal(state.complete, false)
  assert.equal(state.diagnostics[0].errorClass, 'SyntaxError')
  assert.equal(state.diagnostics[0].stage, 'discovery-or-worker-start')
  assert.equal(state.diagnostics[0].path, 'tools/native-acceptance/harness.ts')
  assert.equal(state.diagnostics[0].line, 18)
  assert.equal(state.cleanup, false)
  assert.equal(output.join('').includes('NOT-A-REAL-CREDENTIAL:'), false)
  assert.equal(output.join('').includes('K:/workspace'), false)
  assert.doesNotThrow(() => scanEvidence(JSON.parse(output[0])))
})

test('reporter test errors preserve safe errno/exit details and discard secret messages and parameters', () => {
  const { reporter, state, output } = memoryReporter()
  reporter.onBegin(); reporter.onTestBegin()
  const secret = 'NA_KEYCHAIN_PASSWORD:' + 'a'.repeat(64)
  const error = Object.assign(new TypeError('EACCES with ' + secret + ' and Bearer secret-token'), {
    code: 'EACCES', exitCode: -1073741819, signal: 'SIGSEGV', parameters: { apiKey: secret },
    location: { file: '/private/runner/tools/native-acceptance/harness.ts', line: 42, column: 2 },
  })
  reporter.onTestEnd({}, { status: 'failed', errors: [error], stdout: [secret], attachments: [{ body: secret }] })
  reporter.onEnd({ status: 'failed', errors: [error] })
  const diagnostic = state.diagnostics[0]
  assert.equal(diagnostic.errorClass, 'TypeError'); assert.equal(diagnostic.errno, 'EACCES')
  assert.equal(diagnostic.exitCode, -1073741819); assert.equal(diagnostic.signal, 'SIGSEGV')
  assert.equal(diagnostic.path, 'tools/native-acceptance/harness.ts')
  for (const value of [secret, 'secret-token', '/private/runner', 'parameters', 'attachments']) assert.equal(output.join('').includes(value), false)
  assert.doesNotThrow(() => scanEvidence(state, [secret]))
})

test('failed runner without an error callback records observed missing terminal evidence, not an installer inference', () => {
  const { reporter, state, output } = memoryReporter()
  reporter.onEnd({ status: 'failed' })
  assert.equal(state.reasonCode, 'RUNNER_NO_TERMINAL_EVIDENCE')
  assert.equal(state.diagnostics.length, 1)
  assert.equal(state.diagnostics[0].role, 'primary')
  assert.equal(state.complete, false)
  assert.equal(output.join('').includes('NOT_EXECUTED'), false)
})

const compiledEntry = ts.transpileModule(fs.readFileSync(new URL('./native-upgrade.spec.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText
for (const failureStage of ['module-load', 'constructor', 'execute']) {
  test('real guarded test entry records ' + failureStage + ' failure before exposing only a safe error', async () => {
    const { state, io } = memoryReporter()
    const error = Object.assign(new TypeError('NOT-A-REAL-CREDENTIAL:never expose test input'), { code: 'ERR_INVALID_ARG_TYPE' })
    let body
    const module = { exports: {} }
    vm.runInNewContext(compiledEntry, {
      module, exports: module.exports,
      require(name) {
        if (name === '@playwright/test') return { test: (_title, callback) => { body = callback } }
        if (name === './evidence.mjs') return { AcceptanceError: evidence.AcceptanceError,
          checkpoint: io.checkpoint, currentStage: io.stage, recordFailure: io.fail }
        if (name === './harness') {
          if (failureStage === 'module-load') throw error
          return { NativeUpgrade: class {
            constructor() { if (failureStage === 'constructor') throw error }
            async execute() { throw error }
          } }
        }
        throw new Error('Unexpected guarded-entry dependency')
      },
    }, { timeout: 1000 })
    await assert.rejects(body(), failure => failure.code === 'NATIVE_TEST_FAILED' && !failure.message.includes('CREDENTIAL'))
    assert.equal(state.diagnostics[0].stage, failureStage)
    assert.equal(state.diagnostics[0].errno, 'ERR_INVALID_ARG_TYPE')
    assert.equal(state.reasonCode, 'TEST_BODY_FAILED')
    assert.doesNotThrow(() => scanEvidence(state))
  })
}

test('real harness preserves original NSIS failure when cleanup and archival also fail', async () => {
  const context = offlineHarness({
    installFailure: new evidence.AcceptanceError('FAIL_INSTALL', 'NSIS_NONZERO_EXIT'),
    cleanupFailure: Object.assign(new Error('NA_KEYCHAIN_PASSWORD:private cleanup'), { code: 'EACCES' }),
    archiveFailure: Object.assign(new Error('NOT-A-REAL-CREDENTIAL:private archive'), { code: 'ENOSPC' }),
  })
  context.harness.loopback = async () => {}
  await assert.rejects(context.harness.execute(), error => error.kind === 'FAIL_INSTALL' && error.code === 'NSIS_NONZERO_EXIT')
  const result = context.documents.get('acceptance-result.json')
  assert.equal(result.status, 'FAIL_INSTALL'); assert.equal(result.reasonCode, 'NSIS_NONZERO_EXIT')
  assert.equal(result.diagnostics[0].stage, 'platform-install')
  assert.deepEqual(result.diagnostics.map(item => item.role), ['primary', 'secondary', 'secondary'])
  assert.deepEqual(result.diagnostics.slice(1).map(item => item.stage), ['cleanup', 'archive'])
  assert.deepEqual(result.diagnostics.slice(1).map(item => item.errno), ['EACCES', 'ENOSPC'])
  assert.equal(result.complete, false)
  assert.doesNotThrow(() => scanEvidence(result))
})

test('successful cleanup evidence cannot convert an original failure into PASS', () => {
  const { state } = memoryReporter()
  evidence.applyFailure(state, new TypeError('unsafe details'), 'constructor', 'TEST_BODY_FAILED')
  state.cleanup = true
  state.cleanupEvidence = { attempts: [{ stage: 'cleanup', cleanupSucceeded: true }] }
  const merged = evidence.mergeRunState({ status: 'PASS', complete: true, reasonCode: 'MACHINE_COMPLETE' }, state)
  assert.equal(merged.status, 'BLOCKED_ENVIRONMENT'); assert.equal(merged.complete, false)
  assert.equal(merged.reasonCode, 'TEST_BODY_FAILED'); assert.equal(merged.cleanup, true)
  assert.equal(merged.cleanupEvidence.attempts[0].cleanupSucceeded, true)
})

test('diagnostic projection rejects arbitrary names/codes/fields and never leaks secret-bearing parameters', () => {
  const secret = 'NOT-A-REAL-CREDENTIAL:synthetic-sensitive'
  const projected = evidence.safeDiagnostic({ name: secret, code: secret, message: secret, stack: secret,
    exitCode: secret, signal: secret, location: { file: '/private/' + secret, line: secret }, apiKey: secret }, secret, secret)
  assert.equal(projected.stage, 'unknown'); assert.equal(projected.errorClass, 'Error')
  assert.equal(projected.reasonCode, 'UNCLASSIFIED_FAILURE'); assert.equal(projected.errno, null)
  assert.equal(Object.hasOwn(projected, 'exitCode'), false)
  assert.equal(Object.hasOwn(projected, 'path'), false)
  assert.doesNotThrow(() => scanEvidence(projected, [secret]))
  assert.throws(() => scanEvidence({ ...projected, message: secret }))
})

function frozenFixture() {
  const sourceSha = '1'.repeat(40)
  const local = new Map(evidence.FROZEN_PATHS.map(file => [file, Buffer.from('synthetic raw bytes for ' + file + '\n')]))
  const freeze = evidence.createFreeze(file => local.get(file))
  const freezeBytes = Buffer.from(JSON.stringify(freeze, null, 2) + '\n')
  const committed = new Map([...local, [evidence.FREEZE_RELATIVE, freezeBytes]])
  const requests = []
  const readLocal = file => { if (!local.has(file)) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return local.get(file) }
  const readCommit = async (file, sha) => { assert.equal(sha, sourceSha); requests.push(file); return committed.get(file) }
  return { sourceSha, local, freeze, freezeBytes, committed, requests, readLocal, readCommit }
}

test('freeze verifies exactly 16 raw files and same-commit freeze bytes without self-referential hashing', async () => {
  const fixture = frozenFixture()
  const receipt = await evidence.verifyFrozenBytes(fixture.freezeBytes, fixture.sourceSha, fixture.readLocal, fixture.readCommit)
  assert.equal(receipt.fileCount, 16); assert.equal(receipt.harnessSha, fixture.sourceSha)
  assert.equal(receipt.combinedSha256, fixture.freeze.combinedSha256)
  assert.equal(receipt.freezeSha256, hash(fixture.freezeBytes))
  assert.equal(fixture.freeze.files.some(item => item.path === evidence.FREEZE_RELATIVE), false)
  assert.equal(fixture.freezeBytes.toString().includes(fixture.sourceSha), false)
  assert.equal(fixture.requests.length, 17)
  assert.doesNotThrow(() => scanEvidence(receipt))
})

for (const variant of ['missing', 'same-size-corruption', 'LF-to-CRLF']) {
  test('freeze rejects ' + variant + ' before commit requests or native execution', async () => {
    const fixture = frozenFixture(), file = evidence.FROZEN_PATHS[0]
    if (variant === 'missing') fixture.local.delete(file)
    else if (variant === 'same-size-corruption') {
      const changed = Buffer.from(fixture.local.get(file)); changed[0] ^= 1; fixture.local.set(file, changed)
    } else fixture.local.set(file, Buffer.from(fixture.local.get(file).toString().replaceAll('\n', '\r\n')))
    let failure
    try { await evidence.verifyFrozenBytes(fixture.freezeBytes, fixture.sourceSha, fixture.readLocal, fixture.readCommit) }
    catch (error) { failure = error }
    assert.ok(failure instanceof evidence.AcceptanceError)
    assert.equal(failure.kind, 'BLOCKED_INPUT')
    assert.equal(failure.code, variant === 'missing' ? 'FROZEN_FILE_MISSING' : 'FROZEN_WORKTREE_BYTES_MISMATCH')
    assert.equal(fixture.requests.length, 0)
    const context = offlineHarness({ freezeFailure: failure })
    await assert.rejects(context.harness.execute(), error => error.code === failure.code)
    assert.equal(context.platformCalls.length, 0)
    assert.equal(context.documents.get('acceptance-result.json').status, 'BLOCKED_INPUT')
    assert.equal(context.documents.get('acceptance-result.json').complete, false)
  })
}

test('freeze rejects wrong fixed-commit bytes and separately rejects a changed freeze blob', async () => {
  const fixture = frozenFixture()
  fixture.committed.set(evidence.FROZEN_PATHS[2], Buffer.from('different committed content'))
  await assert.rejects(evidence.verifyFrozenBytes(fixture.freezeBytes, fixture.sourceSha, fixture.readLocal, fixture.readCommit),
    error => error.code === 'FROZEN_COMMIT_BYTES_MISMATCH')
  const other = frozenFixture(); other.committed.set(evidence.FREEZE_RELATIVE, Buffer.from('{}'))
  await assert.rejects(evidence.verifyFrozenBytes(other.freezeBytes, other.sourceSha, other.readLocal, other.readCommit),
    error => error.code === 'FREEZE_COMMIT_BYTES_MISMATCH')
})

test('freeze refuses omitted files, self inclusion, unknown paths, bad digest and unfixed source identities', async () => {
  const fixture = frozenFixture()
  for (const mutate of [value => value.files.pop(), value => { value.files[0].path = evidence.FREEZE_RELATIVE },
    value => { value.files[0].path = '../outside' }, value => { value.combinedSha256 = '0'.repeat(64) }]) {
    const changed = structuredClone(fixture.freeze); mutate(changed)
    await assert.rejects(evidence.verifyFrozenBytes(Buffer.from(JSON.stringify(changed)), fixture.sourceSha, fixture.readLocal, fixture.readCommit),
      error => error.kind === 'BLOCKED_INPUT')
  }
  await assert.rejects(evidence.verifyFrozenBytes(fixture.freezeBytes, 'main', fixture.readLocal, fixture.readCommit),
    error => error.code === 'FROZEN_COMMIT_INVALID')
})

// These are synthetic collector inputs, not native installation evidence.
function runCollection(operation, platforms, mutate = () => {}) {
  const base = fs.realpathSync(process.cwd())
  const root = fs.mkdtempSync(path.join(base, '.offline-collection-'))
  const sha = 'd'.repeat(40), runId = '9000001', runAttempt = 1
  const freezeBytes = fs.readFileSync(new URL('./fixtures/harness-freeze.json', import.meta.url))
  const freeze = JSON.parse(freezeBytes.toString('utf8'))
  const required = ['PACKAGED_VERSION_ARCH', 'PACKAGE_RUNTIME_NAME', 'EFFECTIVE_USER_DATA', 'EFFECTIVE_SESSION_DATA',
    'INSTALLED_APP_PATH', 'CASE_MARKER', 'NETWORK_node', 'NETWORK_electron', 'NETWORK_child', 'SETTINGS_API',
    'CONFIG_API_REDACTED', 'ONBOARDING_PROGRESS', 'ORIGIN_LOCAL_STORAGE', 'SENTINEL', 'READONLY_INSTALLED_SQLITE',
    'NORMAL_EXIT_ZERO', 'DESCENDANTS_EXITED', 'POST_EXIT_DATABASE_READABLE', 'DISK_NO_PLAINTEXT_RUNNING', 'DISK_NO_PLAINTEXT_EXITED']
  try {
    for (const [platform, arch] of platforms) {
      const directory = path.join(root, platform + '-' + arch)
      fs.mkdirSync(directory)
      const identity = { harnessSha: sha, runId, runAttempt, platform, arch,
        caseId: 'synthetic-collector-' + platform + '-' + arch, sanitizedInMemory: true }
      const names = [...'ABCD'].flatMap(phase => required.map(name => phase + ':' + name))
      if (platform === 'macOS') names.push(...[...'ABCD'].map(phase => phase + ':REAL_SYSTEM_DECRYPT'),
        'C:K1_REPLACED_K0', 'C:METADATA_ONLY_PRESERVES_CIPHER')
      const result = { ...minimalResult(identity, 'PASS', 'SYNTHETIC_COLLECTOR_FIXTURE'), cleanup: true, complete: true,
        phases: [...'ABCD'].map(phase => ({ phase, exited: true, exitCode: 0 })),
        assertions: names.map(name => ({ name, passed: true })) }
      mutate(result)
      const inputs = { ...identity, manifestSha256: hash(fs.readFileSync(new URL('../../tests/fixtures/releases/native-upgrade-1.0-1.1.json', import.meta.url))),
        frozenSource: { harnessSha: sha, fileCount: 16, freezeSha256: hash(freezeBytes), combinedSha256: freeze.combinedSha256 } }
      const network = { ...identity, inherited: true, descendantsCovered: true, cleanupSucceeded: true,
        credentialRequestObserved: false, controls: Array.from({ length: 12 }, () => ({ loopback: true, externalDenied: true })) }
      const installers = { ...identity, events: ['1.0.0', '1.1.0'].map(version => ({ version, exitCode: 0 })) }
      for (const [name, value] of Object.entries({ 'acceptance-result.json': result, 'input-manifest.json': inputs,
        'network-isolation.json': network, 'installer-events.json': installers })) {
        fs.writeFileSync(path.join(directory, name), JSON.stringify(value))
      }
    }
    const child = spawnSync(process.execPath, [new URL('./evidence.mjs', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:'), operation, root], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, GITHUB_SHA: sha, GITHUB_RUN_ID: runId,
        GITHUB_RUN_ATTEMPT: String(runAttempt), NA_NATIVE_RESULT: 'success', GITHUB_STEP_SUMMARY: '' },
    })
    if (child.error) throw child.error
    return { status: child.status, output: child.stdout + child.stderr }
  } finally {
    assert.equal(path.dirname(fs.realpathSync(root)), base)
    assert.ok(path.basename(root).startsWith('.offline-collection-'))
    fs.rmSync(root, { recursive: true, force: false })
  }
}

test('Mac-only collector requires both architectures and explicitly excludes all-platform acceptance', () => {
  const result = runCollection('collect-mac', [['macOS', 'arm64'], ['macOS', 'x64']])
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /Mac-only machine evidence complete/)
  assert.match(result.output, /Windows NOT EXECUTED \(BLOCKED_F2\); all-platform acceptance is NOT complete/)
})

test('Mac-only collector rejects missing architecture and failing native assertions', () => {
  assert.equal(runCollection('collect-mac', [['macOS', 'arm64']]).status, 1)
  assert.equal(runCollection('collect-mac', []).status, 1)
  const failed = runCollection('collect-mac', [['macOS', 'arm64'], ['macOS', 'x64']], result => {
    if (result.arch === 'x64') result.assertions[0].passed = false
  })
  assert.equal(failed.status, 1)
  assert.match(failed.output, /Mac-only machine evidence incomplete or failing/)
})

test('Mac-only collector refuses a Windows result rather than silently discarding it', () => {
  const result = runCollection('collect-mac', [['macOS', 'arm64'], ['macOS', 'x64'], ['windows', 'x64']])
  assert.equal(result.status, 1)
  assert.match(result.output, /COLLECT_PLATFORM_UNKNOWN/)
})

test('original all-platform collector still requires and validates Windows alongside both Macs', () => {
  const missing = runCollection('collect', [['macOS', 'arm64'], ['macOS', 'x64']])
  assert.equal(missing.status, 1)
  assert.match(missing.output, /All-platform machine evidence incomplete or failing/)
  const complete = runCollection('collect', [['macOS', 'arm64'], ['macOS', 'x64'], ['windows', 'x64']])
  assert.equal(complete.status, 0, complete.output)
  assert.match(complete.output, /All-platform machine evidence complete/)
})
