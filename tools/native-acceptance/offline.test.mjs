import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
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
  registration = { key: 'HKEY_CURRENT_USER\\offline-uninstall-key', location: 'C:\\offline-case\\install' } } = {}) {
  const root = path.join(path.parse(process.cwd()).root, 'native-offline-never-created')
  const owner = { root, caseId: 'offline-case', harnessSha: 'a'.repeat(40), runId: '1', runAttempt: '1', platform: 'windows', arch: 'x64' }
  const assets = contract.versions.map(version => ({ version, absolute: path.join(root, 'synthetic-' + version + '.exe'), sha256: 'b'.repeat(64) }))
  const writes = [], platformCalls = [], documents = new Map()
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
      controlledRoot: () => ({ root, owner }),
      validatedInputs: async () => ({ root, owner, assets }),
      hashFile: async () => 'b'.repeat(64),
      platformCommand: async (action, args) => {
        platformCalls.push({ action, args })
        if (action === 'setup') return { uid: 'offline-user', programs, policy: 'offline-app-policy' }
        if (action === 'install') return { uid: 'offline-user', exitCode: 0, durationMs: 1, events: [], registration }
        if (action === 'processes') return { processes: [] }
        throw new Error('OFFLINE_FORBIDDEN_PLATFORM_ACTION:' + action)
      },
      command: forbidden('command'), cleanup: async () => {},
      writeEvidence: (name, value, secrets) => { scanEvidence(value, secrets); documents.set(name, structuredClone(value)) },
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
