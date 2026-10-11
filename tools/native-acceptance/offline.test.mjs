import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { renderMacMaterials, validateMacMaterials, ORIGINAL_PROFILE_SHA256 } from './platform/macos.mjs'
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
  freezeFailure, installFailure, cleanupFailure, archiveFailure, mac = false, electronLaunch, beforeCleanup } = {}) {
  const root = path.join(path.parse(process.cwd()).root, 'native-offline-never-created')
  const owner = { root, caseId: 'offline-case', harnessSha: 'a'.repeat(40), runId: '1', runAttempt: '1', platform: mac ? 'macOS' : 'windows', arch: 'x64' }
  const assets = contract.versions.map(version => ({ version, absolute: path.join(root, 'synthetic-' + version + '.exe'), sha256: 'b'.repeat(64) }))
  const writes = [], platformCalls = [], documents = new Map()
  const journal = { ...minimalResult(owner, 'BLOCKED_ENVIRONMENT', 'RUN_IN_PROGRESS'), diagnostics: [], checkpoints: [] }
  const forbidden = name => () => { throw new Error('OFFLINE_FORBIDDEN_OPERATION:' + name) }
  const dependencies = {
    'node:fs': {
      existsSync: () => false,
      mkdirSync: () => {}, readdirSync: () => [],
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
    '@playwright/test': { _electron: { launch: electronLaunch || forbidden('electron.launch') } },
    './evidence.mjs': {
      ...evidence,
      checkpoint: (stage, phase) => { journal.stage = stage; journal.checkpoints.push({ stage, phase: phase || 'A' }); return journal },
      requireFrozenExecution: () => {
        if (freezeFailure) throw freezeFailure
        return { harnessSha: owner.harnessSha, freezeSha256: 'd'.repeat(64), combinedSha256: 'c'.repeat(64), fileCount: evidence.FROZEN_PATHS.length }
      },
      recordFailure: (error, stage, code) => {
        evidence.applyFailure(journal, error, stage, code)
        documents.set('acceptance-result.json', structuredClone(journal))
        return journal
      },
      controlledRoot: () => ({ root, owner }),
      validatedInputs: async () => ({ root, owner, assets }),
      hashFile: async () => 'b'.repeat(64),
      inspectMacLaunch: async (_root, emit) => emit({ records: [{ targetRole: 'wrapper', exists: true, executable: true,
        mode: 448, sha256: 'c'.repeat(64), diagnostics: [] }], codesign: { exitCode: 0 } }),
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
      command: forbidden('command'), cleanup: async () => {
        if (beforeCleanup) beforeCleanup(documents)
        if (cleanupFailure) throw cleanupFailure
      },
      writeEvidence: (name, value, secrets) => {
        if (archiveFailure && journal.stage === 'archive' && name === 'network-isolation.json') throw archiveFailure
        if (name === 'acceptance-result.json') value = evidence.mergeRunState(value, journal)
        scanEvidence(value, secrets); documents.set(name, structuredClone(value))
        if (name === 'acceptance-result.json') Object.assign(journal, structuredClone(value))
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
  return { harness, root, writes, platformCalls, documents, journal }
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

test('freeze verifies exactly 17 raw files and same-commit freeze bytes without self-referential hashing', async () => {
  const fixture = frozenFixture()
  const receipt = await evidence.verifyFrozenBytes(fixture.freezeBytes, fixture.sourceSha, fixture.readLocal, fixture.readCommit)
  assert.equal(receipt.fileCount, 17); assert.equal(receipt.harnessSha, fixture.sourceSha)
  assert.equal(receipt.combinedSha256, fixture.freeze.combinedSha256)
  assert.equal(receipt.freezeSha256, hash(fixture.freezeBytes))
  assert.equal(fixture.freeze.files.some(item => item.path === evidence.FREEZE_RELATIVE), false)
  assert.equal(fixture.freezeBytes.toString().includes(fixture.sourceSha), false)
  assert.equal(fixture.requests.length, 18)
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
        frozenSource: { harnessSha: sha, fileCount: evidence.FROZEN_PATHS.length, freezeSha256: hash(freezeBytes), combinedSha256: freeze.combinedSha256 } }
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

test('atomic scanned JSON preserves the previous complete document on rename failure and rejects secrets before writing', () => {
  const base = fs.realpathSync(process.cwd())
  const root = fs.mkdtempSync(path.join(base, '.offline-atomic-'))
  const file = path.join(root, 'acceptance-result.json'), operations = []
  try {
    evidence.atomicJson(file, { stage: 'platform-install', assertions: [{ name: 'actual', passed: true }] })
    const before = fs.readFileSync(file, 'utf8')
    const io = { ...fs,
      fsyncSync: fd => { operations.push('fsync'); return fs.fsyncSync(fd) },
      renameSync: () => {
        operations.push('rename'); assert.equal(fs.readFileSync(file, 'utf8'), before)
        throw Object.assign(new Error('synthetic rename failure'), { code: 'EIO' })
      },
    }
    assert.throws(() => evidence.atomicJson(file, { stage: 'app-launch' }, [], io), error => error.code === 'EIO')
    assert.deepEqual(operations, ['fsync', 'rename'])
    assert.equal(fs.readFileSync(file, 'utf8'), before)
    assert.deepEqual(fs.readdirSync(root), ['acceptance-result.json'])
    assert.throws(() => evidence.atomicJson(file, { description: 'NA_KEYCHAIN_PASSWORD:must-not-write' }), /SENSITIVE_EVIDENCE/)
    assert.equal(fs.readFileSync(file, 'utf8'), before)
    evidence.atomicJson(file, { stage: 'app-launch' })
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).stage, 'app-launch')
  } finally {
    assert.equal(path.dirname(fs.realpathSync(root)), base)
    assert.ok(path.basename(root).startsWith('.offline-atomic-'))
    fs.rmSync(root, { recursive: true })
  }
})

test('real Mac harness persists input, setup, install, phase and assertions before cleanup; cleanup failure preserves EPERM', async () => {
  let launches = 0, cleanups = 0
  const launchError = Object.assign(new Error('spawn /private/NA_KEYCHAIN_PASSWORD:secret EPERM'), {
    code: 'EPERM', errno: -1, syscall: 'spawn /private/owned/launch-app.sh',
  })
  const context = offlineHarness({ mac: true,
    electronLaunch: async () => { launches++; throw launchError },
    cleanupFailure: Object.assign(new Error('secret cleanup'), { code: 'EACCES' }),
    beforeCleanup(documents) {
      cleanups++
      for (const name of evidence.FILES) assert.ok(documents.has(name), 'Missing actual pre-cleanup fact: ' + name)
      const result = documents.get('acceptance-result.json'), network = documents.get('network-isolation.json')
      assert.equal(result.phases.length, 1); assert.equal(result.phases[0].phase, 'A')
      assert.equal(result.phases[0].debugConnection, 'not-observed')
      assert.equal(result.phases[0].identityVerified, false)
      assert.equal(result.phases[0].exited, false); assert.equal(Object.hasOwn(result.phases[0], 'exitCode'), false)
      assert.ok(result.assertions.some(item => item.name === 'A:INSTALLER_BYTES_0' && item.passed))
      assert.equal(result.diagnostics[0].errno, 'EPERM'); assert.equal(result.diagnostics[0].syscall, 'spawn')
      assert.equal(result.diagnostics[0].errnoNumber, -1)
      assert.equal(documents.get('installer-events.json').events[0].version, '1.0.0')
      assert.ok(network.enabledAt); assert.equal(network.controls.length, 0)
      assert.equal(network.inherited, false); assert.equal(network.probeComplete, false)
      assert.equal(network.cleanupSucceeded, false)
      for (const value of documents.values()) scanEvidence(value)
    },
  })
  context.harness.loopback = async () => {}
  await assert.rejects(context.harness.execute(), error => error.code === 'NATIVE_EXECUTION_FAILED')
  assert.equal(launches, 1); assert.equal(cleanups, 1)
  const result = context.documents.get('acceptance-result.json')
  assert.equal(result.diagnostics[0].errno, 'EPERM')
  assert.equal(result.diagnostics[1].stage, 'cleanup')
  assert.equal(result.complete, false)
  assert.equal(result.assertions.some(item => item.name.includes('NETWORK_')), false)
})

test('worker/runner exit after launch failure keeps durable phase facts without inventing an app exit or requiring finally', async () => {
  const context = offlineHarness({ mac: true, electronLaunch: async () => {
    throw Object.assign(new Error('EPERM'), { code: 'EPERM', syscall: 'spawn /private/wrapper' })
  } })
  await context.harness.install(0)
  await assert.rejects(context.harness.launch('A', '1.0.0'), error => error.code === 'EPERM')
  // Model reporter/outer runner operating on the already persisted worker state;
  // neither NativeUpgrade.execute() nor its finally block is invoked here.
  const durable = structuredClone(context.documents.get('acceptance-result.json'))
  evidence.applyFailure(durable, Object.assign(new Error('EPERM'), { code: 'EPERM', syscall: 'spawn' }), 'app-launch', 'TEST_FAILED')
  evidence.applyFailure(durable, Object.assign(new Error('runner stopped'), {
    exitCode: 1, signal: 'SIGTERM', processRole: 'test-runner',
  }), 'app-launch', 'RUNNER_EXIT_NONZERO')
  assert.ok(durable.assertions.some(item => item.name === 'A:INSTALLER_EXIT_0' && item.passed))
  assert.equal(durable.phases.length, 1); assert.equal(durable.phases[0].exited, false)
  assert.equal(Object.hasOwn(durable.phases[0], 'exitCode'), false)
  assert.equal(durable.diagnostics[0].errno, 'EPERM')
  assert.equal(durable.diagnostics[1].processRole, 'test-runner')
  assert.equal(durable.diagnostics[1].exitCode, 1)
  scanEvidence(durable)
})

test('single-launch observer delegates unchanged options, persists actual PID/exit, and restores its hook on failure', async () => {
  const launcher = '/owned/launch-app.sh', records = [], options = { file: launcher, args: ['NA_KEYCHAIN_PASSWORD:secret'], envPairs: ['TOKEN=private'] }
  let calls = 0
  class FakeChild extends EventEmitter {
    spawn(input) { calls++; assert.equal(input, options); this.pid = 4321; this.emit('spawn'); return 17 }
  }
  const original = FakeChild.prototype.spawn
  const error = Object.assign(new Error('NOT-A-REAL-CREDENTIAL:hidden'), { code: 'EPERM', syscall: 'spawn ' + launcher, errno: -1 })
  await assert.rejects(evidence.observeMacLaunch(launcher, value => records.push(value), async () => {
    const child = new FakeChild()
    assert.equal(child.spawn(options), 17)
    child.emit('error', error); child.emit('exit', null, 'SIGKILL')
    throw error
  }, FakeChild.prototype), value => value === error)
  assert.equal(calls, 1); assert.equal(FakeChild.prototype.spawn, original)
  assert.deepEqual(records.map(item => item.observation), ['spawn-requested', 'spawn-observed', 'spawn-error', 'exit-observed'])
  assert.equal(Object.hasOwn(records[0], 'pid'), false)
  assert.equal(records[1].pid, 4321)
  assert.equal(records[2].diagnostics[0].errno, 'EPERM'); assert.equal(records[2].diagnostics[0].syscall, 'spawn')
  assert.equal(records[3].signal, 'SIGKILL'); assert.equal(Object.hasOwn(records[3], 'exitCode'), false)
  assert.equal(records.every(item => item.processRole === 'launcher-process'), true)
  scanEvidence(records, ['TOKEN=private', launcher])
  assert.equal(JSON.stringify(records).includes('envPairs'), false)
})

test('read-only Mac launch inspection emits incremental roles, missing/access facts and codesign result without native calls', async () => {
  const snapshots = [], calls = []
  await evidence.inspectMacLaunch('/owned', value => snapshots.push(structuredClone(value)), {
    stat(file) {
      calls.push(['stat', file])
      if (file === '/bin/bash') throw Object.assign(new Error('private'), { code: 'ENOENT', syscall: 'stat' })
      return { mode: 0o100700, isFile: () => true }
    },
    access(file) { if (file.endsWith('launch-app.sh')) throw Object.assign(new Error('private'), { code: 'EPERM', errno: -1, syscall: 'access' }) },
    hashFile: async () => 'd'.repeat(64),
    command: async (file, args, options) => {
      assert.equal(file, '/usr/bin/codesign'); assert.equal(args[0], '--verify'); assert.equal(options.timeout, 30000)
      calls.push(['codesign'])
      return { code: 1, signal: null, diagnostic: { errorClass: 'Error', errno: null }, stdout: 'secret', stderr: '/private/raw' }
    },
  })
  assert.deepEqual(snapshots.map(item => item.records.length), [1, 2, 3, 4, 4])
  const final = snapshots.at(-1)
  assert.equal(final.records[0].exists, true); assert.equal(final.records[0].executable, false)
  assert.equal(final.records[0].diagnostics[0].syscall, 'access')
  assert.equal(final.records[1].exists, false); assert.equal(final.records[1].sha256, null)
  assert.equal(final.codesign.exitCode, 1)
  assert.equal(calls.filter(item => item[0] === 'codesign').length, 1)
  scanEvidence(final, ['secret', '/private/raw', '/owned'])
})

test('safe diagnostics retain known syscall and numeric errno, rejecting arbitrary target roles and leaked arguments', () => {
  const projected = evidence.safeDiagnostic({ name: 'Error', code: 'EPERM', errno: -1,
    syscall: 'spawn /private/NOT-A-REAL-CREDENTIAL:hidden', targetRole: 'wrapper', processRole: 'launcher-process',
    message: 'Bearer hidden-token', parameters: ['NA_KEYCHAIN_PASSWORD:hidden'] }, 'app-launch', 'LAUNCH_PROCESS_ERROR')
  assert.equal(projected.errno, 'EPERM'); assert.equal(projected.errnoNumber, -1); assert.equal(projected.syscall, 'spawn')
  assert.equal(projected.targetRole, 'wrapper')
  scanEvidence(projected, ['hidden-token'])
  const unknown = evidence.safeDiagnostic({ syscall: 'secret-call', errno: 'secret', targetRole: 'secret' }, 'app-launch', 'TEST_FAILED')
  for (const field of ['syscall', 'errnoNumber', 'targetRole']) assert.equal(Object.hasOwn(unknown, field), false)
  assert.throws(() => scanEvidence({ ...projected, description: 'Bearer hidden-token' }))
})

const diagnosticRoot = path.resolve(process.cwd(), '.synthetic-owned-case')
test('shared material renderer preserves original profile bytes and exact wrapper except the enum target', () => {
  const original = renderMacMaterials(diagnosticRoot, 'original-product'), probe = renderMacMaterials(diagnosticRoot, 'system-true')
  assert.equal(hash(probe.profile), 'f7dfa3333acc36436a1dcb4ad350a8823f403439c7c49622ede267dd49f89e0a')
  assert.equal(ORIGINAL_PROFILE_SHA256, hash(original.profile))
  assert.equal(original.template, probe.template)
  assert.equal(probe.template, '#!/bin/bash\nexec /usr/bin/sandbox-exec -f \'<PROFILE>\' -- \'<TARGET>\' "$@"\n')
  assert.equal(probe.wrapper.includes(" -- '/usr/bin/true' \"$@\"\n"), true)
  assert.equal(validateMacMaterials(diagnosticRoot, 'system-true', probe.profile, probe.wrapper).templateMatches, true)
  for (const profile of [probe.profile.slice(0, -1), probe.profile.replace('127.0.0.1', '127.0.0.2'), probe.profile.replaceAll('\n', '\r\n')]) {
    assert.throws(() => validateMacMaterials(diagnosticRoot, 'system-true', profile, probe.wrapper), /MAC_MATERIAL_BYTES_CHANGED/)
  }
  for (const wrapper of [original.wrapper, probe.wrapper.replace(' -- ', ' '), probe.wrapper.replace('"$@"', '$@'), probe.wrapper.replace(' -f ', ' --file ')]) {
    assert.throws(() => validateMacMaterials(diagnosticRoot, 'system-true', probe.profile, wrapper), /MAC_MATERIAL_BYTES_CHANGED/)
  }
  assert.throws(() => renderMacMaterials(diagnosticRoot, '/bin/sh'), /MAC_MATERIAL_TARGET_INVALID/)
  const quoted = renderMacMaterials(path.join(diagnosticRoot, "a'b"), 'system-true')
  assert.ok(quoted.wrapper.includes("a'\\''b"))
})

test('T1 trigger and environment guards reject alternate entry, repeat attempts, deletion and loader injection', () => {
  const environment = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_REPOSITORY: 'hzqedison/RT-ResearchFlow', GITHUB_REF: evidence.T1_BRANCH, GITHUB_EVENT_NAME: 'push',
    GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '1', NA_T1_DELETED: 'false' }
  evidence.assertT1Trigger(environment)
  for (const mutation of [{ GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_REF: 'refs/heads/main' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { RUNNER_ENVIRONMENT: 'self-hosted' }, { GITHUB_REPOSITORY: 'other/repository' }, { NA_T1_DELETED: 'true' }]) {
    assert.throws(() => evidence.assertT1Trigger({ ...environment, ...mutation }), /T1_TRIGGER_NOT_AUTHORIZED/)
  }
  for (const name of ['BASH_ENV', 'ENV', 'SHELLOPTS', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', 'NODE_OPTIONS', 'BASH_FUNC_hidden%%']) {
    assert.throws(() => evidence.validateToolEnvironment({ [name]: 'private-input' }), /TOOL_ENVIRONMENT_INJECTION/)
  }
  assert.equal(evidence.validateToolEnvironment({ PATH: 'synthetic', HOME: 'synthetic' }).environmentSafe, true)
  // Real Node entry dispatch must stop on Windows before case creation or any Mac helper.
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./evidence.mjs', import.meta.url)), 'init-t1', 'macOS', 'x64'], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, ...environment },
  })
  assert.equal(child.status, 1); assert.match(child.stdout + child.stderr, /NATIVE_PLATFORM_REQUIRED/)
})

function syntheticProcess(behavior, { killThrows = false } = {}) {
  const events = [], child = new EventEmitter(), calls = []
  child.pid = 8123; child.exitCode = null; child.signalCode = null
  for (const name of ['stdout', 'stderr', 'stdin']) child[name] = Object.assign(new EventEmitter(), { destroy() {} })
  child.stdin.end = input => { calls.push(['stdin', input]) }
  child.unref = () => calls.push(['unref'])
  child.kill = signal => {
    calls.push(['kill', signal])
    if (killThrows) throw Object.assign(new Error('NA_KEYCHAIN_PASSWORD:never expose'), { code: 'EPERM', errno: -1, syscall: 'kill' })
    child.signalCode = signal; child.emit('exit', null, signal); child.emit('close', null, signal); return true
  }
  const io = { setTimeout, clearTimeout, spawn(executable, args, options) {
    calls.push(['spawn', executable, args, options])
    queueMicrotask(() => { child.emit('spawn'); behavior(child) })
    return child
  } }
  return { io, calls, child, events }
}
const t1Options = onEvent => ({ capture: 't1', timeout: 5000, graceMs: 2000, processRole: 'launcher-process',
  profilePath: path.join(diagnosticRoot, 'network.sb'), wrapperPath: path.join(diagnosticRoot, 'launch-true.sh'), onEvent })
test('T1 actual bounded spawn wiring uses no shell/arguments, closes stdin and observes only its one child', async () => {
  const fake = syntheticProcess(child => { child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null) })
  const options = t1Options(event => fake.events.push(event))
  const result = await evidence.boundedCommand(options.wrapperPath, [], options, fake.io)
  assert.equal(fake.calls.filter(call => call[0] === 'spawn').length, 1)
  const spawnCall = fake.calls.find(call => call[0] === 'spawn')
  assert.equal(spawnCall[1], options.wrapperPath); assert.deepEqual(spawnCall[2], [])
  assert.equal(spawnCall[3].shell, false); assert.deepEqual(spawnCall[3].stdio, ['pipe', 'pipe', 'pipe'])
  assert.deepEqual(fake.calls.find(call => call[0] === 'stdin'), ['stdin', ''])
  assert.deepEqual(fake.events.map(event => event.observation), ['spawn-requested', 'spawn-observed', 'exit-observed', 'close-observed'])
  assert.equal(evidence.toolChainOutcome(result), 'TOOL_CHAIN_PASS')
  assert.equal(result.stdout, ''); assert.equal(result.closeObserved, true)
})

test('T1 split stderr classification maps only an exact profile location and fixed token; exit65 alone remains unknown', async () => {
  const options = t1Options(() => {})
  const message = 'sandbox-exec: ' + options.profilePath + ":4:3: invalid IP address '127.0.0.1:*'\n"
  const fake = syntheticProcess(child => {
    const bytes = Buffer.from(message)
    for (let i = 0; i < bytes.length; i += 3) child.stderr.emit('data', bytes.subarray(i, i + 3))
    child.emit('exit', 65, null); child.emit('close', 65, null)
  })
  const result = await evidence.boundedCommand(options.wrapperPath, [], options, fake.io)
  assert.equal(result.toolOutput.records[0].classification, 'SBPL_ADDRESS_ERROR')
  assert.equal(result.toolOutput.records[0].targetRole, 'sandbox-profile')
  assert.equal(result.toolOutput.records[0].line, 4); assert.equal(result.toolOutput.records[0].column, 3)
  assert.equal(result.toolOutput.records[0].token, '127.0.0.1:*')
  scanEvidence(result.toolOutput)
  const empty = syntheticProcess(child => { child.emit('exit', 65, null); child.emit('close', 65, null) })
  const unknown = await evidence.boundedCommand(options.wrapperPath, [], options, empty.io)
  assert.equal(unknown.toolOutput.records[0].classification, 'UNCLASSIFIED_TOOL_EXIT')
  assert.equal(evidence.toolChainOutcome(unknown), 'BLOCKED')
})

for (const terminal of [{ name: 'exit65', code: 65, signal: null }, { name: 'signal', code: null, signal: 'SIGTERM' }]) {
  test('T1 classified stderr and observed ' + terminal.name + ' survive timeout without close', async () => {
    const options = { ...t1Options(() => {}), timeout: 5, graceMs: 5 }
    const fake = syntheticProcess(child => {
      child.stderr.emit('data', Buffer.from('sandbox-exec: ' + options.profilePath + ":4:3: invalid IP address '127.0.0.1:*'\n"))
      child.exitCode = terminal.code; child.signalCode = terminal.signal
      child.emit('exit', terminal.code, terminal.signal)
    })
    await assert.rejects(evidence.boundedCommand(options.wrapperPath, [], options, fake.io), error => {
      assert.equal(error.code, 'NATIVE_COMMAND_TIMEOUT'); assert.equal(error.kind, 'BLOCKED_ENVIRONMENT')
      const result = error.processOutcome
      assert.equal(result.code, terminal.code); assert.equal(result.signal, terminal.signal)
      assert.equal(result.timeout, true); assert.equal(result.closeObserved, false)
      assert.equal(result.toolOutput.outputComplete, false)
      assert.deepEqual(result.toolOutput.records, [
        { classification: 'SBPL_ADDRESS_ERROR', producerRole: 'sandbox-exec', observedRole: 'launcher-process',
          targetRole: 'sandbox-profile', line: 4, column: 3, token: '127.0.0.1:*' },
        { classification: 'TOOL_TIMEOUT', producerRole: 'unknown', observedRole: 'launcher-process' },
      ])
      assert.equal(evidence.toolChainOutcome(result, error), 'BLOCKED')
      assert.equal(fake.calls.some(call => call[0] === 'kill'), false)
      const state = minimalResult({ platform: 'macOS' }, 'BLOCKED_ENVIRONMENT', 'RUN_IN_PROGRESS')
      evidence.applyFailure(state, error, 'tool-diagnostic', 'T1_COMMAND_FAILED')
      assert.equal(state.reasonCode, 'NATIVE_COMMAND_TIMEOUT'); assert.equal(state.status, 'BLOCKED_ENVIRONMENT')
      scanEvidence({ records: result.toolOutput.records, diagnostics: state.diagnostics }, [options.profilePath, options.wrapperPath])
      return true
    })
  })
}

for (const failure of ['timeout', 'spawn-error']) {
  test('T1 saturated four-fact evidence is never displaced by ' + failure, async () => {
    const options = { ...t1Options(() => {}), timeout: 5, graceMs: 5 }
    const expected = [1, 2, 3, 4].map(column => ({ classification: 'SBPL_ADDRESS_ERROR', producerRole: 'sandbox-exec',
      observedRole: 'launcher-process', targetRole: 'sandbox-profile', line: 4, column, token: '127.0.0.1:*' }))
    const fake = syntheticProcess(child => {
      child.stderr.emit('data', Buffer.from(expected.map(record => 'sandbox-exec: ' + options.profilePath
        + ':4:' + record.column + ": invalid IP address '127.0.0.1:*'\n").join('')))
      child.exitCode = 65; child.emit('exit', 65, null)
      if (failure === 'spawn-error') child.emit('error', Object.assign(new Error('NOT-A-REAL-CREDENTIAL:hidden'), {
        code: 'EPERM', syscall: 'spawn ' + options.wrapperPath,
      }))
    })
    await assert.rejects(evidence.boundedCommand(options.wrapperPath, [], options, fake.io), error => {
      const code = failure === 'timeout' ? 'NATIVE_COMMAND_TIMEOUT' : 'NATIVE_COMMAND_UNAVAILABLE'
      assert.equal(error.code, code)
      const result = error.processOutcome
      assert.equal(result.code, 65); assert.equal(result.signal, null); assert.equal(result.closeObserved, false)
      assert.equal(result.timeout, failure === 'timeout'); assert.equal(result.toolOutput.outputComplete, false)
      assert.deepEqual(result.toolOutput.records, expected)
      assert.equal(result.toolOutput.records.length, 4); assert.equal(result.toolOutput.records[3].column, 4)
      assert.equal(evidence.toolChainOutcome(result, error), 'BLOCKED')
      const primary = evidence.safeDiagnostic(error, 'tool-diagnostic', error.code)
      assert.equal(primary.reasonCode, code)
      scanEvidence({ records: result.toolOutput.records, diagnostics: [primary] }, [options.profilePath, options.wrapperPath, 'hidden'])
      return true
    })
  })
}

test('T1 no-stderr timeout remains incomplete even when termination subsequently closes the child', async () => {
  const fake = syntheticProcess(() => {})
  await assert.rejects(evidence.boundedCommand('synthetic-wrapper', [], {
    ...t1Options(() => {}), timeout: 5, graceMs: 5,
  }, fake.io), error => {
    assert.equal(error.code, 'NATIVE_COMMAND_TIMEOUT')
    const result = error.processOutcome
    assert.equal(result.stderrBytes, 0); assert.equal(result.timeout, true)
    assert.equal(result.closeObserved, true); assert.equal(result.code, null); assert.equal(result.signal, 'SIGKILL')
    assert.equal(result.toolOutput.outputComplete, false)
    assert.deepEqual(result.toolOutput.records, [{ classification: 'TOOL_TIMEOUT', producerRole: 'unknown', observedRole: 'launcher-process' }])
    assert.equal(evidence.toolChainOutcome(result, error), 'BLOCKED')
    scanEvidence(result.toolOutput)
    return true
  })
})

for (const mode of ['synchronous', 'after-stderr']) {
  test('T1 ' + mode + ' spawn error retains only safe facts and never implies complete observation', async () => {
    const options = { ...t1Options(() => {}), timeout: 5, graceMs: 5 }
    const nativeError = Object.assign(new Error('NOT-A-REAL-CREDENTIAL:hidden ' + options.wrapperPath), {
      code: 'ENOENT', syscall: 'spawn ' + options.wrapperPath,
    })
    const fake = syntheticProcess(child => {
      child.stderr.emit('data', Buffer.from('sandbox-exec: ' + options.profilePath + ":4:3: invalid IP address '127.0.0.1:*'\n"))
      child.emit('error', nativeError)
    })
    let spawns = 0
    const io = mode === 'synchronous' ? { ...fake.io, spawn() { spawns++; throw nativeError } } : fake.io
    await assert.rejects(evidence.boundedCommand(options.wrapperPath, [], options, io), error => {
      assert.equal(error.code, 'NATIVE_COMMAND_UNAVAILABLE'); assert.equal(error.kind, 'BLOCKED_ENVIRONMENT')
      const result = error.processOutcome
      assert.equal(result.code, null); assert.equal(result.signal, null)
      assert.equal(result.timeout, false); assert.equal(result.closeObserved, false)
      assert.equal(result.toolOutput.outputComplete, false)
      assert.deepEqual(result.toolOutput.records.map(record => record.classification), mode === 'synchronous'
        ? ['TOOL_SPAWN_ERROR'] : ['SBPL_ADDRESS_ERROR', 'TOOL_SPAWN_ERROR'])
      assert.equal(evidence.toolChainOutcome(result, error), 'BLOCKED')
      const primary = evidence.safeDiagnostic(error, 'tool-diagnostic', error.code)
      assert.equal(primary.errno, 'ENOENT'); assert.equal(primary.syscall, 'spawn')
      scanEvidence({ records: result.toolOutput.records, diagnostics: [primary] }, [options.profilePath, options.wrapperPath, 'hidden'])
      return true
    })
    assert.equal(mode === 'synchronous' ? spawns : fake.calls.filter(call => call[0] === 'spawn').length, 1)
  })
}

test('T1 stderr counterexamples never leak text or infer compilation from errno/token/exit phrases', () => {
  const profile = path.join(diagnosticRoot, 'network.sb'), wrapper = path.join(diagnosticRoot, 'launch-true.sh')
  const valid = 'sandbox-exec: ' + profile + ':4:3: syntax error'
  for (const raw of ['EPERM 65 remote ip', 'fake ' + valid, valid + ' /private/extra', valid + ' NOT-A-REAL-CREDENTIAL:secret',
    '\x1b[31m' + valid, valid.replace(':4:3:', ':4:'), valid.replace(':4:3:', ':7:3:'), valid.replace(':4:3:', ':4:999:'),
    valid.replace(profile, profile + '-other'), 'x'.repeat(1025), '\u79d8\u5bc6',
    valid + '\nsandbox-exec: sandbox_apply: Operation not permitted']) {
    const projection = evidence.classifyToolStderr(raw, profile, wrapper)
    assert.equal(projection.outputComplete, false)
    assert.equal(projection.records[0].classification, 'UNCLASSIFIED_TOOL_EXIT')
    scanEvidence(projection, ['secret', '/private/extra'])
  }
})

test('T1 malformed UTF8 and bounded output overflow block; raw bytes are never returned', async () => {
  for (const variant of ['malformed', 'overflow', 'stdout']) {
    const fake = syntheticProcess(child => {
      if (variant === 'malformed') {
        child.stderr.emit('data', Buffer.from([0xc3])); child.stderr.emit('data', Buffer.from([0x28]))
      } else if (variant === 'overflow') child.stderr.emit('data', Buffer.alloc(8193, 65))
      else child.stdout.emit('data', Buffer.from('NOT-A-REAL-CREDENTIAL:private'))
      child.emit('exit', 0, null); child.emit('close', 0, null)
    })
    let result, error
    try { result = await evidence.boundedCommand('synthetic-wrapper', [], t1Options(() => {}), fake.io) }
    catch (failure) { error = failure; result = failure.processOutcome }
    assert.equal(evidence.toolChainOutcome(result, error), 'BLOCKED')
    assert.equal(result.stdout, '')
    assert.equal(JSON.stringify(result).includes('NOT-A-REAL-CREDENTIAL:'), false)
    if (variant === 'overflow') assert.equal(error.code, 'NATIVE_OUTPUT_LIMIT')
  }
})

test('timeout kill throwing EPERM returns bounded incomplete evidence and retains timeout as primary', async () => {
  const fake = syntheticProcess(() => {}, { killThrows: true })
  const started = Date.now()
  let error
  try { await evidence.boundedCommand('synthetic-wrapper', [], { ...t1Options(event => fake.events.push(event)), timeout: 5, graceMs: 5 }, fake.io) }
  catch (failure) { error = failure }
  assert.ok(Date.now() - started < 1000)
  assert.equal(error.code, 'NATIVE_COMMAND_TIMEOUT')
  assert.equal(error.processOutcome.closeObserved, false)
  assert.equal(error.secondaryDiagnostics[0].errno, 'EPERM'); assert.equal(error.secondaryDiagnostics[0].syscall, 'kill')
  assert.equal(fake.calls.filter(call => call[0] === 'kill').length, 1)
  const state = minimalResult({ platform: 'macOS' }, 'BLOCKED_ENVIRONMENT', 'RUN_IN_PROGRESS')
  evidence.applyFailure(state, error, 'tool-diagnostic', 'T1_COMMAND_FAILED')
  assert.equal(state.reasonCode, 'NATIVE_COMMAND_TIMEOUT')
  assert.equal(state.diagnostics[1].role, 'secondary'); assert.equal(state.diagnostics[1].errno, 'EPERM')
  scanEvidence(state.diagnostics)
})

function journalFixture() {
  const base = fs.realpathSync(process.cwd()), root = fs.mkdtempSync(path.join(base, '.offline-journal-'))
  const owner = { root, caseId: 'journal-offline', harnessSha: 'a'.repeat(40), runId: '1', runAttempt: '1', platform: 'macOS', arch: 'x64' }
  return { root, owner, close() {
    assert.equal(path.dirname(fs.realpathSync(root)), base); assert.ok(path.basename(root).startsWith('.offline-journal-'))
    fs.rmSync(root, { recursive: true })
  } }
}
const presentIdentity = async pid => ({ pid, status: 'present', processIdentity: 'b'.repeat(64) })
const resourceNames = ['owned-process-cleanup', 'mount-detach', 'keychain-default-restore', 'keychain-search-restore', 'keychain-delete']

test('journal publishes exclusive events; caller entry precedes identity await and incomplete attempts cannot overwrite each other', async () => {
  const fixture = journalFixture()
  try {
    const first = evidence.beginCleanup('test-finally', fixture)
    let events = evidence.readCleanupEvents(fixture.root, fixture.owner)
    assert.equal(events.length, 1); assert.equal(events[0].observation, 'caller-entered')
    await assert.rejects(evidence.acquireCleanupLease(first, async () => { throw new Error('offline interruption') }))
    const second = evidence.beginCleanup('workflow-cleanup', fixture)
    events = evidence.readCleanupEvents(fixture.root, fixture.owner)
    assert.equal(evidence.foldCleanupEvents(events).attempts.length, 2)
    assert.equal(evidence.foldCleanupEvents(events).attempts.every(item => item.cleanupSucceeded === null), true)
    assert.throws(() => evidence.appendCleanupEvent({ ...first, sequence: 0 }, 'caller-entered'), error => error.code === 'EEXIST')
    assert.notEqual(first.attemptId, second.attemptId)
  } finally { fixture.close() }
})

test('helper-entry, in-operation and helper-finished-without-caller boundaries remain separately observable', async () => {
  const fixture = journalFixture()
  try {
    const caller = evidence.beginCleanup('test-finally', fixture)
    await evidence.acquireCleanupLease(caller, presentIdentity)
    await assert.rejects(evidence.enterCleanupHelper(caller.attemptId, caller.callerRole, fixture, async () => { throw new Error('interrupted after helper entry') }))
    let folded = evidence.foldCleanupEvents(evidence.readCleanupEvents(fixture.root, fixture.owner))
    assert.equal(folded.attempts[0].events.some(item => item.observation === 'helper-entered'), true)
    assert.equal(folded.attempts[0].helperReceipt, null); assert.equal(folded.attempts[0].cleanupSucceeded, null)
    // Continue the same synthetic helper writer after its first immutable event.
    const helper = { ...caller, writerRole: 'helper', sequence: 1 }
    let unblock
    const operation = evidence.cleanupOperations(helper, resourceNames.map((name, index) => ({ operation: name, needed: index === 0,
      run: () => new Promise(resolve => { unblock = resolve }) })))
    folded = evidence.foldCleanupEvents(evidence.readCleanupEvents(fixture.root, fixture.owner))
    assert.equal(folded.attempts[0].events.at(-1).observation, 'operation-started')
    assert.equal(folded.attempts[0].complete, false)
    unblock(); await operation
    folded = evidence.foldCleanupEvents(evidence.readCleanupEvents(fixture.root, fixture.owner))
    assert.equal(folded.attempts[0].helperReceipt.cleanupSucceeded, true)
    assert.equal(folded.attempts[0].callerReceipt, null); assert.equal(folded.attempts[0].cleanupSucceeded, null)
  } finally { fixture.close() }
})

test('live or identity-unknown previous cleanup blocks another Keychain helper; confirmed absence permits a new lease', async () => {
  const fixture = journalFixture()
  try {
    const first = evidence.beginCleanup('test-finally', fixture)
    await evidence.acquireCleanupLease(first, presentIdentity)
    evidence.appendCleanupEvent(first, 'helper-spawn-requested')
    const next = evidence.beginCleanup('workflow-cleanup', fixture)
    await assert.rejects(evidence.acquireCleanupLease(next, presentIdentity), /CLEANUP_PREVIOUS_IDENTITY_UNKNOWN/)
    const helper = await evidence.enterCleanupHelper(first.attemptId, first.callerRole, fixture, presentIdentity)
    const third = evidence.beginCleanup('workflow-cleanup', fixture)
    await assert.rejects(evidence.acquireCleanupLease(third, presentIdentity), /CLEANUP_PREVIOUS_PROCESS_ALIVE/)
    const fourth = evidence.beginCleanup('workflow-cleanup', fixture)
    let queries = 0
    await evidence.acquireCleanupLease(fourth, async pid => ++queries === 1 ? presentIdentity(pid) : { pid, status: 'absent' })
    assert.equal(queries, 3)
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.root, 'cleanup-journal/active.json'), 'utf8')).attemptId, fourth.attemptId)
    assert.ok(helper.attemptId === first.attemptId)
    assert.equal(evidence.foldCleanupEvents(evidence.readCleanupEvents(fixture.root, fixture.owner)).attempts.length, 4)
  } finally { fixture.close() }
})

test('later cleanup success projects its source without rewriting previous unknown, primary error or network controls', () => {
  const fixture = journalFixture()
  try {
    const first = evidence.beginCleanup('test-finally', fixture), next = evidence.beginCleanup('workflow-cleanup', fixture)
    evidence.appendCleanupEvent(next, 'caller-observed-result', { cleanupSucceeded: true, status: 'succeeded' })
    const folded = evidence.foldCleanupEvents(evidence.readCleanupEvents(fixture.root, fixture.owner))
    assert.equal(folded.attempts.find(item => item.attemptId === first.attemptId).cleanupSucceeded, null)
    const network = { controls: [{ transport: 'node', loopback: false, externalDenied: false }], inherited: false, probeComplete: false }
    const projected = evidence.networkCleanupProjection(network, folded)
    assert.deepEqual(projected.controls, network.controls); assert.equal(projected.inherited, false); assert.equal(projected.probeComplete, false)
    assert.equal(projected.cleanupHistory.length, 2)
    assert.equal(projected.cleanupProjection.attemptId, next.attemptId)
    assert.equal(projected.cleanupProjection.callerRole, 'workflow-cleanup')
    assert.equal(projected.cleanupProjection.complete, true); assert.ok(projected.cleanupProjection.observedAt)
    const state = minimalResult({ platform: 'macOS' }, 'BLOCKED_ENVIRONMENT', 'RUN_IN_PROGRESS')
    evidence.applyFailure(state, Object.assign(new Error('EPERM'), { code: 'EPERM', syscall: 'kill' }), 'app-launch', 'ORIGINAL_FAILURE')
    const result = evidence.mergeRunState({ status: 'PASS', complete: true }, { ...state, cleanup: true, cleanupEvidence: folded })
    assert.equal(result.reasonCode, 'ORIGINAL_FAILURE'); assert.equal(result.complete, false)
    scanEvidence(projected)
  } finally { fixture.close() }
})

test('diagnostic-only evidence cannot satisfy either product collector even if its result is mislabeled PASS', () => {
  for (const operation of ['collect', 'collect-mac']) {
    const platforms = operation === 'collect' ? [['windows', 'x64'], ['macOS', 'arm64'], ['macOS', 'x64']] : [['macOS', 'arm64'], ['macOS', 'x64']]
    const result = runCollection(operation, platforms, value => { value.mode = 'mac-launcher-T1' })
    assert.equal(result.status, 1); assert.match(result.output, /DIAGNOSTIC_ARTIFACT_NOT_ACCEPTANCE/)
  }
})

test('actual Mac helper cleanup argument wiring records operations without executing shell, Keychain or native APIs', async () => {
  const fixture = journalFixture(), calls = [], writes = []
  try {
    const caller = evidence.beginCleanup('test-finally', fixture)
    await evidence.acquireCleanupLease(caller, presentIdentity)
    const sourceUrl = new URL('./platform/macos.mjs', import.meta.url)
    const compiled = ts.transpileModule(fs.readFileSync(sourceUrl, 'utf8').replaceAll('import.meta.url', JSON.stringify(sourceUrl.href)), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, allowJs: true },
      fileName: 'macos-offline.ts',
    }).outputText
    const module = { exports: {} }
    const state = { default: '/synthetic/original.keychain-db', search: ['/synthetic/original.keychain-db'], uid: 1000, keychainCreated: true, mountPending: true }
    vm.runInNewContext(compiled, {
      module, exports: module.exports, Buffer,
      process: { argv: [], env: {}, getuid: () => 1000, kill: () => assert.fail('No real process may be signalled') },
      require(name) {
        if (name === 'node:path') return path
        if (name === 'node:url') return require(name)
        if (name === 'node:fs') return {
          existsSync: file => [path.join(fixture.root, 'mac-state.json'), path.join(fixture.root, 'acceptance.keychain-db')].includes(file),
          readFileSync: file => { assert.equal(file, path.join(fixture.root, 'mac-state.json')); return JSON.stringify(state) },
          writeFileSync: (file, value) => { assert.equal(file, path.join(fixture.root, 'mac-state.json')); writes.push(JSON.parse(value)) },
        }
        if (name === '../evidence.mjs') return { ...evidence, controlledRoot: () => fixture,
          enterCleanupHelper: (id, role, owned) => evidence.enterCleanupHelper(id, role, owned, presentIdentity),
          command: async (file, args) => {
            calls.push([file, structuredClone(args)])
            assert.ok(['/bin/ps', '/usr/bin/hdiutil', '/usr/bin/security'].includes(file))
            return { code: 0, stdout: '', diagnostic: {}, signal: null }
          },
        }
        throw new Error('OFFLINE_UNEXPECTED_MAC_IMPORT')
      },
    }, { timeout: 2000 })
    const receipt = await module.exports.macMain(['cleanup', fixture.root, caller.attemptId, caller.callerRole])
    assert.equal(receipt.attemptId, caller.attemptId); assert.equal(receipt.cleanupSucceeded, true)
    assert.deepEqual(calls.filter(call => call[0] === '/usr/bin/security').map(call => call[1][0]), ['default-keychain', 'list-keychains', 'delete-keychain'])
    const folded = evidence.foldCleanupEvents(evidence.readCleanupEvents(fixture.root, fixture.owner))
    assert.deepEqual(folded.attempts[0].events.filter(event => event.observation === 'operation-ended').map(event => event.operation), resourceNames)
    assert.equal(folded.attempts[0].helperReceipt.cleanupSucceeded, true)
    assert.equal(folded.attempts[0].callerReceipt, null)
    assert.equal(writes.at(-1).keychainCreated, false)
    fixture.owner.mode = 'mac-launcher-T1'
    await assert.rejects(module.exports.macMain(['setup', fixture.root]), /MAC_OWNER_INVALID/)
  } finally { fixture.close() }
})

test('process absence requires a clean, closed ps receipt, not PID-only or stderr-bearing exit1', async () => {
  const absent = await evidence.macProcessIdentity(1234, async () => ({ code: 1, stdout: '', stderrBytes: 0, closeObserved: true }))
  assert.equal(absent.status, 'absent')
  await assert.rejects(evidence.macProcessIdentity(1234, async () => ({ code: 1, stdout: '', stderrBytes: 17, closeObserved: true })), /CLEANUP_PROCESS_IDENTITY_UNAVAILABLE/)
  await assert.rejects(evidence.macProcessIdentity(1234, async () => ({ code: 1, stdout: '', stderrBytes: 0, closeObserved: false })), /CLEANUP_PROCESS_IDENTITY_UNAVAILABLE/)
  const present = await evidence.macProcessIdentity(1234, async () => ({ code: 0, stdout: '1234 501 Thu Oct  8 12:00:00 2026 /synthetic/node\n', stderrBytes: 0, closeObserved: true }))
  assert.equal(present.status, 'present'); assert.match(present.processIdentity, /^[a-f0-9]{64}$/)
  scanEvidence(present)
})

test('unconfirmed resource-command exit stops further resource changes and blocks lease recovery even if caller/helper are absent', async () => {
  const fixture = journalFixture()
  try {
    const caller = evidence.beginCleanup('test-finally', fixture)
    await evidence.acquireCleanupLease(caller, presentIdentity)
    evidence.appendCleanupEvent(caller, 'helper-spawn-requested')
    const helper = await evidence.enterCleanupHelper(caller.attemptId, caller.callerRole, fixture, presentIdentity)
    const error = new evidence.AcceptanceError('BLOCKED_ENVIRONMENT', 'NATIVE_COMMAND_TIMEOUT')
    error.processOutcome = { closeObserved: false }
    let laterOperations = 0
    await assert.rejects(evidence.cleanupOperations(helper, resourceNames.map((operation, index) => ({ operation, needed: true,
      run: async () => { if (index === 0) throw error; laterOperations++ },
    }))), value => value === error)
    assert.equal(laterOperations, 0)
    const folded = evidence.foldCleanupEvents(evidence.readCleanupEvents(fixture.root, fixture.owner))
    assert.equal(folded.attempts[0].helperReceipt.cleanupSucceeded, null)
    const next = evidence.beginCleanup('workflow-cleanup', fixture)
    let queries = 0
    await assert.rejects(evidence.acquireCleanupLease(next, async pid => ++queries === 1 ? presentIdentity(pid) : { pid, status: 'absent' }), /CLEANUP_RESOURCE_IDENTITY_UNKNOWN/)
  } finally { fixture.close() }
})

test('actual publish folds a caller-only interrupted journal into the existing result before copying its four-file allowlist', () => {
  const base = fs.realpathSync(process.cwd()), root = fs.mkdtempSync(path.join(base, 'rt-native-acceptance-offline-'))
  try {
    const owner = { root, caseId: 'publish-offline', harnessSha: 'a'.repeat(40), runId: '1', runAttempt: '1', platform: 'macOS', arch: 'x64' }
    fs.writeFileSync(path.join(root, 'owner.json'), JSON.stringify(owner)); fs.mkdirSync(path.join(root, 'evidence'))
    const sourceUrl = new URL('./evidence.mjs', import.meta.url)
    const compiled = ts.transpileModule(fs.readFileSync(sourceUrl, 'utf8').replaceAll('import.meta.url', JSON.stringify(sourceUrl.href)), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: 'evidence-offline.ts',
    }).outputText
    const module = { exports: {} }
    vm.runInNewContext(compiled, { module, exports: module.exports, Buffer, URL, TextDecoder, structuredClone, setTimeout, clearTimeout,
      process: { argv: [], pid: process.pid, platform: 'darwin', arch: 'x64',
        env: { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', NA_CASE_ROOT: root,
          RUNNER_TEMP: base, GITHUB_SHA: owner.harnessSha, GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1' } },
      require(name) {
        if (name === 'node:child_process') return { spawn: () => assert.fail('No native process in publication test'), ChildProcess: class {} }
        assert.ok(name.startsWith('node:')); return require(name)
      },
    }, { timeout: 3000 })
    const loaded = module.exports
    loaded.recordFailure(Object.assign(new Error('EPERM'), { code: 'EPERM', syscall: 'kill' }), 'app-launch', 'ORIGINAL_LAUNCH_FAILURE')
    const attempt = loaded.beginCleanup('workflow-cleanup') // deliberately no helper or finally
    loaded.publishEvidence()
    const published = JSON.parse(fs.readFileSync(path.join(root, 'public-evidence/acceptance-result.json'), 'utf8'))
    assert.equal(published.reasonCode, 'ORIGINAL_LAUNCH_FAILURE')
    assert.equal(published.cleanupEvidence.attempts.length, 1)
    assert.equal(published.cleanupEvidence.attempts[0].attemptId, attempt.attemptId)
    assert.equal(published.cleanupEvidence.attempts[0].cleanupSucceeded, null)
    assert.deepEqual(fs.readdirSync(path.join(root, 'public-evidence')), ['acceptance-result.json'])
  } finally {
    assert.equal(path.dirname(fs.realpathSync(root)), base); assert.ok(path.basename(root).startsWith('rt-native-acceptance-offline-'))
    fs.rmSync(root, { recursive: true })
  }
})

for (const outcome of ['zero', 'unknown-exit65', 'timeout-kill-error', 'classified-exit65-no-close']) {
  test('actual T1 entry/renderer/spawn/cleanup/publish wiring: ' + outcome + ', with no product or native system calls', async () => {
    const parent = fs.realpathSync(process.cwd()), base = fs.mkdtempSync(path.join(parent, '.offline-t1-'))
    const root = fs.mkdtempSync(path.join(base, 'rt-native-acceptance-')), output = [], timers = []
    const owner = { root, caseId: 't1-offline', harnessSha: 'a'.repeat(40), runId: '1', runAttempt: '1', platform: 'macOS', arch: 'x64', mode: 'mac-launcher-T1' }
    try {
      fs.mkdirSync(path.join(root, 'evidence')); fs.writeFileSync(path.join(root, 'owner.json'), JSON.stringify(owner))
      const freezeBytes = fs.readFileSync(new URL('./fixtures/harness-freeze.json', import.meta.url)), freeze = JSON.parse(freezeBytes)
      fs.writeFileSync(path.join(root, 'freeze-receipt.json'), JSON.stringify({ harnessSha: owner.harnessSha, caseId: owner.caseId,
        runId: owner.runId, runAttempt: 1, freezeSha256: hash(freezeBytes), combinedSha256: freeze.combinedSha256, fileCount: evidence.FROZEN_PATHS.length }))
      const fake = syntheticProcess(child => {
        if (outcome === 'timeout-kill-error') return
        if (outcome === 'classified-exit65-no-close') {
          child.stderr.emit('data', Buffer.from('sandbox-exec: ' + path.join(root, 'network.sb') + ":4:3: invalid IP address '127.0.0.1:*'\n"))
          child.exitCode = 65; child.emit('exit', 65, null); return
        }
        if (outcome === 'unknown-exit65') child.stderr.emit('data', Buffer.from('EPERM 65 NOT-A-REAL-CREDENTIAL:hidden'))
        const code = outcome === 'zero' ? 0 : 65
        child.exitCode = code; child.emit('exit', code, null); child.emit('close', code, null)
      }, { killThrows: outcome === 'timeout-kill-error' })
      const systemFiles = new Set(['/bin/bash', '/usr/bin/sandbox-exec', '/usr/bin/true']), createdModes = new Map()
      const sourceUrl = new URL('./evidence.mjs', import.meta.url)
      const compiled = ts.transpileModule(fs.readFileSync(sourceUrl, 'utf8').replaceAll('import.meta.url', JSON.stringify(sourceUrl.href)), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: 't1-entry-offline.ts',
      }).outputText
      const module = { exports: {} }
      const runtime = { argv: [], pid: process.pid, platform: 'darwin', arch: 'x64', versions: { node: '20.20.2' },
        stdout: { write: text => output.push(text) },
        env: { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', NA_CASE_ROOT: root, RUNNER_TEMP: base,
          GITHUB_SHA: owner.harnessSha, GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1', GITHUB_REF: evidence.T1_BRANCH,
          GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'hzqedison/RT-ResearchFlow', NA_T1_DELETED: 'false' } }
      vm.runInNewContext(compiled, { module, exports: module.exports, Buffer, URL, TextDecoder, structuredClone, process: runtime,
        setTimeout: (fn, ms) => { timers.push(ms); return setTimeout(fn, Math.min(ms, 5)) }, clearTimeout,
        require(name) {
          if (name === './platform/macos.mjs') return { renderMacMaterials, validateMacMaterials }
          if (name === 'node:child_process') return { spawn: (file, args, options) => {
            assert.equal(file, path.join(root, 'launch-true.sh')); assert.deepEqual(structuredClone(args), [])
            return fake.io.spawn(file, args, options)
          }, ChildProcess: class {} }
          if (name === 'node:fs') return { ...fs,
            lstatSync: file => {
              if (systemFiles.has(file)) return { isFile: () => true, isSymbolicLink: () => false, mode: 0o100755 }
              const stat = fs.lstatSync(file)
              // Windows does not expose POSIX execute bits. Model only the mode
              // actually requested by the renderer writer; do not relax its gate.
              if (createdModes.has(file)) stat.mode = (stat.mode & ~0o777) | createdModes.get(file)
              return stat
            },
            writeFileSync: (file, value, options) => {
              if ([path.join(root, 'network.sb'), path.join(root, 'launch-true.sh')].includes(file)) createdModes.set(file, options.mode)
              return fs.writeFileSync(file, value, options)
            },
            accessSync: (file, mode) => { assert.ok(systemFiles.has(file)); assert.equal(mode, fs.constants.X_OK) },
            createReadStream: file => { assert.ok(systemFiles.has(file)); return Readable.from([Buffer.from('offline-system-tool-fixture')]) },
          }
          assert.ok(name.startsWith('node:')); return require(name)
        },
      }, { timeout: 3000 })
      const loaded = module.exports
      await loaded.runT1(); loaded.cleanupT1(); loaded.publishEvidence()
      const result = JSON.parse(fs.readFileSync(path.join(root, 'public-evidence/acceptance-result.json'), 'utf8'))
      assert.equal(fake.calls.filter(call => call[0] === 'spawn').length, 1, JSON.stringify(result.diagnostics))
      assert.equal(result.toolDiagnostic.diagnosticStatus, outcome === 'zero' ? 'TOOL_CHAIN_PASS' : 'BLOCKED')
      assert.equal(result.complete, false); assert.notEqual(result.status, 'PASS')
      assert.match(result.toolDiagnostic.scope, /product NOT_EXECUTED; Windows NOT_EXECUTED/)
      assert.equal(result.toolDiagnostic.profileSha256, ORIGINAL_PROFILE_SHA256)
      assert.equal(result.toolDiagnostic.tools.length, 3)
      assert.equal(result.cleanupEvidence.attempts[0].events.some(event => event.observation === 'helper-spawn-requested'), false)
      assert.equal(result.cleanupEvidence.attempts[0].events.filter(event => event.operation?.startsWith('keychain')).every(event => event.status === 'not-needed'), true)
      const incomplete = ['timeout-kill-error', 'classified-exit65-no-close'].includes(outcome)
      assert.equal(result.cleanupEvidence.attempts[0].cleanupSucceeded, incomplete ? null : true)
      assert.deepEqual(fs.readdirSync(path.join(root, 'public-evidence')).sort(), [...evidence.FILES].sort())
      assert.equal(output.join('').includes('NOT-A-REAL-CREDENTIAL:'), false)
      assert.equal(timers[0], 5000)
      if (incomplete) assert.ok(timers.includes(2000))
      if (outcome === 'classified-exit65-no-close') {
        assert.equal(result.reasonCode, 'NATIVE_COMMAND_TIMEOUT')
        assert.equal(result.toolDiagnostic.exitCode, 65); assert.equal(result.toolDiagnostic.signal, null)
        assert.equal(result.toolDiagnostic.timeout, true); assert.equal(result.toolDiagnostic.closeObserved, false)
        assert.equal(result.toolDiagnostic.outputComplete, false)
        assert.deepEqual(result.toolDiagnostic.records.map(record => record.classification), ['SBPL_ADDRESS_ERROR', 'TOOL_TIMEOUT'])
        scanEvidence(result, [root, path.join(root, 'network.sb')])
      }
      await assert.rejects(loaded.runT1(), error => error.code === 'EEXIST')
      assert.equal(fake.calls.filter(call => call[0] === 'spawn').length, 1)
    } finally {
      assert.equal(path.dirname(fs.realpathSync(base)), parent); assert.ok(path.basename(base).startsWith('.offline-t1-'))
      fs.rmSync(base, { recursive: true })
    }
  })
}
