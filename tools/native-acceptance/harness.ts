import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { AcceptanceError, requireCondition as need, controlledRoot, validatedInputs, contract, toolsRoot,
  manifestPath, hash, hashFile, relative, safeEnvironment, command, platformCommand, writeEvidence, minimalResult, cleanup,
  checkpoint, recordFailure, requireFrozenExecution, inspectMacLaunch, observeMacLaunch } from './evidence.mjs'

type Phase = 'A' | 'B' | 'C' | 'D'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function deadline<T>(promise: Promise<T>, ms: number, kind: string, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new AcceptanceError(kind, code)), ms) })])
    .finally(() => clearTimeout(timer))
}
function publicReachable(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const request = https.get(url, { timeout: 6000 }, response => { response.resume(); resolve((response.statusCode || 0) >= 200 && (response.statusCode || 0) < 400) })
    request.on('error', () => resolve(false)); request.on('timeout', () => request.destroy())
  })
}

export class NativeUpgrade {
  root: string; owner: any; assets: any[] = []; app?: ElectronApplication; page?: Page
  executable: string; launcher: string; userData: string; sessionData: string; appPath = ''; runtimeName = ''
  phase: Phase = 'A'; uid = ''; sourceId = 0; baseline: any; current: any; installEvents: any[] = []
  stage = 'constructor'
  result: any; network: any; input: any; ownedPids = new Set<number>(); launchedPids = new Set<number>()
  server?: http.Server; origin = ''; requestCount = 0; credentialRequest = false; oversizedRequest = false
  k0 = ''; k1 = ''; password = ''; secretValues: string[] = []; expected: any; marker: string; sentinel: string
  constructor() {
    const { root, owner } = controlledRoot(); this.root = root; this.owner = owner
    this.executable = path.join(root, 'install', owner.platform === 'windows' ? 'RT-ResearchFlow.exe' : 'RT-ResearchFlow.app/Contents/MacOS/RT-ResearchFlow')
    this.launcher = owner.platform === 'windows' ? this.executable : path.join(root, 'launch-app.sh')
    this.userData = path.join(root, owner.platform === 'windows' ? 'install/data' : 'profile')
    this.sessionData = owner.platform === 'windows' ? path.join(this.userData, 'session') : this.userData
    this.marker = JSON.stringify({ caseId: owner.caseId, harnessSha: owner.harnessSha })
    this.sentinel = 'native-upgrade-synthetic:' + owner.caseId
    this.result = minimalResult(owner, 'BLOCKED_ENVIRONMENT', 'RUN_IN_PROGRESS')
    this.network = this.envelope('network-isolation', { enabledAt: '', disabledAt: '', policy: '', controls: [], records: [],
      scope: 'startup-transport-self-checks-and-cumulative-loopback-only',
      verification: 'controls-are-self-checks; complete-background-OS-denial-counts-not-collected',
      inherited: false, descendantsCovered: false, credentialRequestObserved: false, requestCount: 0, cleanupSucceeded: false })
  }
  get mac() { return this.owner.platform === 'macOS' }
  mark(stage: string) { this.stage = stage; checkpoint(stage, this.phase); this.persistResult() }
  persistResult() { writeEvidence('acceptance-result.json', this.result, this.secretValues) }
  persistNetwork() {
    this.network.credentialRequestObserved = this.credentialRequest; this.network.requestCount = this.requestCount
    this.network.records = [{ phase: this.phase, requestCount: this.requestCount, credentialRequestObserved: this.credentialRequest,
      scope: 'cumulative-loopback-since-observer-start', verification: 'phase-is-collection-end-not-request-stage' }]
    writeEvidence('network-isolation.json', this.network, this.secretValues)
  }
  persistInstallers() { writeEvidence('installer-events.json', this.envelope('installer-events', { events: this.installEvents }), this.secretValues) }
  envelope(kind: string, fields: any) {
    return { schemaVersion: 1, kind, harnessSha: this.owner.harnessSha, caseId: this.owner.caseId,
      runId: this.owner.runId, runAttempt: Number(this.owner.runAttempt), platform: this.owner.platform, arch: this.owner.arch,
      ...fields, sanitizedInMemory: true }
  }
  check(name: string, value: any, kind = 'FAIL_DATA', code = name) {
    this.result.assertions.push({ name: this.phase + ':' + name, passed: !!value })
    this.persistResult()
    need(value, kind, code)
  }
  async timed<T>(promise: Promise<T>, code = 'IPC_TIMEOUT'): Promise<T> {
    return deadline(promise, contract.timeoutsMs.ipc, this.mac ? 'BLOCKED_ENVIRONMENT' : 'FAIL_DATA', this.mac ? 'KEYCHAIN_INTERACTION_REQUIRED_' + code : code)
  }
  async loopback() {
    this.server = http.createServer((request, response) => {
      this.requestCount++
      // Keep at most a short rolling suffix, never log authorization or request bodies.
      const needles = ['NOT-A-REAL-CREDENTIAL:', ...this.secretValues]
      if (Object.values(request.headers).some(value => typeof value === 'string' && needles.some(needle => value.includes(needle)))) this.credentialRequest = true
      let suffix = '', bytes = 0
      request.on('data', chunk => {
        bytes += chunk.length
        const next = suffix + chunk.toString('utf8')
        if (needles.some(needle => next.includes(needle))) this.credentialRequest = true
        suffix = next.slice(-512)
        if (bytes > 65536) { this.oversizedRequest = true; request.destroy() }
      })
      request.on('end', () => { response.writeHead(request.url === '/health' ? 200 : 503, { 'Content-Type': 'text/plain' }); response.end(request.url === '/health' ? 'healthy' : 'acceptance endpoint: no provider response') })
      request.on('error', () => {}); request.setTimeout(5000, () => request.destroy())
    })
    this.server.requestTimeout = 6000; this.server.headersTimeout = 5000
    await deadline(new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve) }), 5000, 'BLOCKED_ENVIRONMENT', 'LOOPBACK_UNAVAILABLE')
    const address = this.server.address()
    need(address && typeof address !== 'string', 'BLOCKED_ENVIRONMENT', 'LOOPBACK_ADDRESS_INVALID')
    this.origin = 'http://127.0.0.1:' + (address as any).port
    this.expected = { origin: this.origin, baseUrl: this.origin + '/v1', maxTokens: contract.provider.maxTokens,
      presetPrompt: 'acceptance-synthetic-' + this.owner.caseId, sourceName: 'acceptance-source-' + this.owner.caseId }
  }
  async install(index: number) {
    this.mark('platform-install')
    const asset = this.assets[index]
    const args = this.mac ? [asset.absolute, asset.version] : ['-Installer', asset.absolute, '-Version', asset.version]
    const event = await platformCommand('install', args, { timeout: 180000, kind: 'FAIL_INSTALL' })
    this.installEvents.push({ version: asset.version, exitCode: event.exitCode, durationMs: event.durationMs, events: event.events,
      installRelative: 'install', ...(event.registration ? { registrationSha256: hash(JSON.stringify({ key: event.registration.key, location: event.registration.location })) } : { appId: event.appId }) })
    this.persistInstallers()
    this.check('INSTALLER_EXIT_' + index, event.exitCode === 0, 'FAIL_INSTALL')
    this.check('INSTALLER_BYTES_' + index, await hashFile(asset.absolute) === asset.sha256, 'BLOCKED_INPUT')
    this.check('SYSTEM_USER_' + index, event.uid === this.uid, 'BLOCKED_ENVIRONMENT')
    this.check('NO_INSTALLER_AUTOSTART_' + index, (await platformCommand('processes')).processes.length === 0, 'FAIL_INSTALL')
  }
  async descendants(expectEmpty = false) {
    const inventory = (await platformCommand('processes')).processes
    const programs = !this.mac && fs.existsSync(path.join(this.root, 'firewall-programs.json'))
      ? JSON.parse(fs.readFileSync(path.join(this.root, 'firewall-programs.json'), 'utf8')) : []
    for (const item of inventory) {
      const inside = item.exe && path.isAbsolute(item.exe) && !path.relative(this.root, item.exe).startsWith('..')
      need(inside, 'BLOCKED_ENVIRONMENT', 'UNOWNED_APPLICATION_DESCENDANT')
      if (!this.mac) need(programs.some((program: string) => program.toLowerCase() === item.exe.toLowerCase()), 'BLOCKED_ENVIRONMENT', 'UNCOVERED_APPLICATION_DESCENDANT')
      this.ownedPids.add(item.pid)
    }
    if (expectEmpty) need(inventory.length === 0, 'FAIL_LIFECYCLE', 'APPLICATION_DESCENDANTS_REMAIN')
    this.network.descendantsCovered = true
    return inventory
  }
  async launch(phase: Phase, version: string) {
    this.phase = phase
    const partial: any = { phase, version, launchId: this.owner.caseId + '-' + phase, startedAt: new Date().toISOString(),
      exited: false, debugConnection: 'not-observed', identityVerified: false, processEvents: [] }
    this.result.phases.push(partial)
    this.mark('app-launch')
    await this.descendants(true)
    const trap = path.join(this.root, 'legacy-trap')
    if (!fs.existsSync(trap)) fs.mkdirSync(trap)
    this.check('LEGACY_TRAP_EMPTY_BEFORE', fs.readdirSync(trap).length === 0, 'BLOCKED_ENVIRONMENT')
    if (phase === 'A') {
      this.check('PROFILE_NOT_PREPOPULATED', !fs.existsSync(this.userData)
        || (fs.lstatSync(this.userData).isDirectory() && !fs.lstatSync(this.userData).isSymbolicLink() && fs.readdirSync(this.userData).length === 0), 'BLOCKED_ENVIRONMENT')
    } else this.check('PRELAUNCH_MARKER', fs.readFileSync(path.join(this.userData, contract.markerBasename), 'utf8') === this.marker)
    const args = ['--user-data-dir=' + (this.mac ? this.userData : trap)]
    if (this.mac) await inspectMacLaunch(this.root, (facts: any) => { partial.launchDiagnostics = facts; this.persistResult() })
    const launchOnce = () => deadline(_electron.launch({ executablePath: this.launcher, args, timeout: contract.timeoutsMs.launch,
      env: safeEnvironment({ DEBUG: '', PWDEBUG: '' }) }), contract.timeoutsMs.launch + 5000, 'BLOCKED_ENVIRONMENT', 'PACKAGED_LAUNCH_FAILED')
    this.app = this.mac ? await observeMacLaunch(this.launcher, (event: any) => {
      partial.processEvents.push(event); this.persistResult()
    }, launchOnce) : await launchOnce()
    partial.debugConnection = 'connected'; this.persistResult()
    const child = this.app.process()
    this.check('INDEPENDENT_MAIN_PROCESS', !!child.pid && !this.launchedPids.has(child.pid), 'FAIL_LIFECYCLE')
    this.launchedPids.add(child.pid!); this.ownedPids.add(child.pid!)
    const identity: any = await this.timed(this.app.evaluate(({ app }, input) => {
      const fs = require('node:fs'), path = require('node:path')
      const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'))
      return { packaged: app.isPackaged, version: app.getVersion(), runtimeName: app.getName(), packageName: pkg.name,
        expectedName: pkg.productName || pkg.name, exe: app.getPath('exe'), appPath: app.getAppPath(),
        userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), pid: process.pid, arch: process.arch,
        uid: process.platform === 'darwin' ? String(process.getuid!()) : null,
        profileExists: fs.existsSync(input.profile) }
    }, { profile: this.userData }))
    this.check('PACKAGED_VERSION_ARCH', identity.packaged && identity.version === version && identity.arch === this.owner.arch, 'FAIL_INSTALL')
    this.check('PACKAGE_RUNTIME_NAME', identity.packageName === contract.packageName && identity.runtimeName === identity.expectedName
      && (!this.runtimeName || this.runtimeName === identity.runtimeName), 'FAIL_INSTALL')
    this.runtimeName = identity.runtimeName
    this.check('EFFECTIVE_USER_DATA', path.resolve(identity.userData) === this.userData, 'BLOCKED_ENVIRONMENT')
    this.check('EFFECTIVE_SESSION_DATA', path.resolve(identity.sessionData) === this.sessionData, 'BLOCKED_ENVIRONMENT', 'SESSION_DATA_CONTRACT_NOT_FROZEN')
    this.check('EFFECTIVE_EXECUTABLE', path.resolve(identity.exe) === this.executable && identity.pid === child.pid, 'BLOCKED_ENVIRONMENT')
    const expectedAppPath = this.mac ? path.join(this.root, 'install/RT-ResearchFlow.app/Contents/Resources/app.asar') : path.join(this.root, 'install/resources/app.asar')
    this.check('INSTALLED_APP_PATH', identity.appPath === expectedAppPath, 'FAIL_INSTALL'); this.appPath = identity.appPath
    if (this.mac) this.check('NATIVE_USER_ID', identity.uid === this.uid, 'BLOCKED_ENVIRONMENT')
    if (phase === 'A') fs.writeFileSync(path.join(this.userData, contract.markerBasename), this.marker, { flag: 'wx', mode: 0o600 })
    this.check('CASE_MARKER', fs.readFileSync(path.join(this.userData, contract.markerBasename), 'utf8') === this.marker)
    Object.assign(partial, { phase, launchId: this.owner.caseId + '-' + phase, pid: identity.pid, version, identityVerified: true,
      launchTime: new Date().toISOString(), packaged: true, runtimeName: identity.runtimeName, packageName: identity.packageName,
      uidHash: hash(this.uid), arch: identity.arch, appId: contract.builderAppId,
      // Electron has no public AppUserModelID getter. Record the frozen source fact,
      // separately from observed NSIS identity; do not invent a runtime observation.
      ...(this.mac ? {} : { appUserModelId: contract.windowsAppUserModelId,
        verification: 'AppUserModelID-source-contract; NSIS-registration-observed-separately' }),
      exeRelative: relative(this.root, identity.exe), exePathHash: hash(identity.exe),
      appRelative: relative(this.root, identity.appPath), appPathHash: hash(identity.appPath),
      userDataRelative: relative(this.root, identity.userData), userDataPathHash: hash(identity.userData),
      sessionDataRelative: relative(this.root, identity.sessionData), sessionDataPathHash: hash(identity.sessionData), markerMatches: true, exited: false })
    this.persistResult()
    this.page = await deadline(this.app.firstWindow(), 30000, 'BLOCKED_ENVIRONMENT', 'APP_WINDOW_UNAVAILABLE')
    await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 })
    await this.descendants()
    await this.networkProbe()
  }
  async networkProbe() {
    this.mark('network-probe')
    // Each transport has its own timestamp/PID, so an unrelated timeout cannot satisfy a deny assertion.
    for (const transport of ['node', 'electron', 'child']) {
      const since = new Date().toISOString()
      const probe: any = await deadline(this.app!.evaluate(async ({ net }, input) => {
        const nodeProbe = (url: string) => new Promise<any>(resolve => {
          const request = require(url.startsWith('https:') ? 'node:https' : 'node:http').get(url, { timeout: 5000 }, (response: any) => { response.resume(); resolve({ success: true, code: 'HTTP_RESPONSE', pid: process.pid }) })
          request.on('error', (error: any) => resolve({ success: false, code: error.code || 'UNKNOWN', pid: process.pid }))
          request.on('timeout', () => { request.destroy(); resolve({ success: false, code: 'TIMEOUT', pid: process.pid }) })
        })
        const electronProbe = async (url: string) => {
          const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000)
          try { const response = await net.fetch(url, { signal: controller.signal }); await response.arrayBuffer(); return { success: true, code: 'HTTP_RESPONSE', pid: process.pid } }
          catch (error: any) { const match = String(error.message).match(/ERR_[A-Z_]+/); return { success: false, code: match ? match[0] : 'UNKNOWN', pid: process.pid } }
          finally { clearTimeout(timer) }
        }
        const childProbe = (url: string) => new Promise<any>(resolve => {
          const script = `const u=process.argv[1];const r=require(u.startsWith('https:')?'https':'http').get(u,{timeout:5000},s=>{s.resume();process.stdout.write(JSON.stringify({success:true,code:'HTTP_RESPONSE',pid:process.pid}));});r.on('error',e=>process.stdout.write(JSON.stringify({success:false,code:e.code||'UNKNOWN',pid:process.pid})));r.on('timeout',()=>{process.stdout.write(JSON.stringify({success:false,code:'TIMEOUT',pid:process.pid}));process.exit(0)});`
          const child = require('node:child_process').spawn(process.execPath, ['-e', script, url], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
          let output = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 6500)
          child.stdout.on('data', (chunk: any) => { if (output.length < 4096) output += chunk.toString() })
          child.on('error', () => { clearTimeout(timer); resolve({ success: false, code: 'CHILD_UNAVAILABLE', pid: child.pid || 0 }) })
          child.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(output)) } catch { resolve({ success: false, code: 'CHILD_NO_RESULT', pid: child.pid || 0 }) } })
        })
        const probe = input.transport === 'node' ? nodeProbe : input.transport === 'electron' ? electronProbe : childProbe
        return { loopback: await probe(input.origin + '/health'), external: await probe(input.url) }
      }, { transport, origin: this.origin, url: contract.probeUrl }), 18000, 'BLOCKED_ENVIRONMENT', 'NETWORK_PROBE_TIMEOUT')
      const explicit = ['EPERM', 'EACCES', 'ERR_NETWORK_ACCESS_DENIED'].includes(probe.external.code)
      let observedDeny = explicit, denialEvidence = explicit ? 'os-permission-denied' : 'none'
      if (!this.mac) {
        const audit = await platformCommand('denials', ['-Since', since])
        const actual = audit.events.filter((event: any) => event.destination === '1.1.1.1' && event.port === '443')
        // Chromium uses its own network service PID; its path must remain in the ruled application tree.
        const descendants = await this.descendants()
        const allowed = new Set([probe.external.pid, ...descendants.map((item: any) => item.pid)])
        const hits = actual.filter((event: any) => allowed.has(Number(event.pid)))
        observedDeny = hits.length > 0; denialEvidence = observedDeny ? 'WFP-5157-owned-pid-and-target' : 'none'
      }
      this.network.controls.push({ phase: this.phase, transport, loopback: probe.loopback.success === true,
        externalDenied: probe.external.success === false && observedDeny, denialCode: /^[A-Z0-9_]+$/.test(probe.external.code) ? probe.external.code : 'UNKNOWN', denialEvidence })
      this.persistNetwork()
      this.check('NETWORK_' + transport, probe.loopback.success === true && probe.external.success === false && observedDeny,
        'BLOCKED_ENVIRONMENT', 'OS_NETWORK_DENIAL_NOT_PROVEN')
    }
    this.network.inherited = true
    this.network.probeComplete = this.network.controls.length === 12 && this.network.controls.every((item: any) => item.loopback && item.externalDenied)
    this.persistNetwork()
  }
  async apiCheck() {
    const result: any = await this.timed(this.page!.evaluate(async ({ settings, keys, provider, expected }) => {
      const api = (window as any).api
      const actual = await api.settings.get(), config = await api.ai.getConfig()
      const serialized = JSON.stringify(config)
      const visit = (item: any): boolean => {
        if (!item || typeof item !== 'object') return true
        if (typeof item.apiKey === 'string' && item.apiKey.trim()) return false
        return Object.values(item).every(value => typeof value !== 'object' || visit(value))
      }
      return { settings: Object.entries(settings).every(([name, value]) => actual[name] === value),
        apiNoPlaintext: keys.every((key: string) => !serialized.includes(key)) && visit(config),
        providerMetadata: serialized.includes(provider.model) && serialized.includes(expected.presetPrompt) }
    }, { settings: contract.settings, keys: this.secretValues.filter(key => key.startsWith('NOT-A-REAL-CREDENTIAL:')), provider: contract.provider, expected: this.expected }))
    this.check('SETTINGS_API', result.settings)
    this.check('CONFIG_API_REDACTED', result.apiNoPlaintext, 'FAIL_CREDENTIAL')
    this.check('CONFIG_API_METADATA', result.providerMetadata)
  }
  async saveProvider(key?: string, metadataOnly = false) {
    const providerConfig: any = { ...contract.provider, baseUrl: this.expected.baseUrl, maxTokens: this.expected.maxTokens, presetPrompt: this.expected.presetPrompt }
    if (!metadataOnly && key) providerConfig.apiKey = key
    await this.timed(this.page!.evaluate(async input => { await (window as any).api.ai.saveConfig({ providerConfig: input }) }, providerConfig), 'SAVE_CONFIG_TIMEOUT')
  }
  async seed() {
    this.mark('fixture-seed')
    this.check('NETWORK_GATE_BEFORE_FIXTURES', this.network.inherited && this.network.controls.length === 3
      && this.network.controls.every((item: any) => item.loopback && item.externalDenied), 'BLOCKED_ENVIRONMENT')
    if (this.mac) {
      this.check('SYSTEM_ENCRYPTION_PRECONDITION', await this.timed(this.app!.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable())), 'BLOCKED_ENVIRONMENT')
      this.k0 = 'NOT-A-REAL-CREDENTIAL:' + this.owner.caseId + ':K0:' + randomBytes(32).toString('hex')
      this.k1 = 'NOT-A-REAL-CREDENTIAL:' + this.owner.caseId + ':K1:' + randomBytes(32).toString('hex')
      this.secretValues.push(this.k0, this.k1)
    }
    await this.timed(this.page!.evaluate(async settings => { await (window as any).api.settings.update(settings) }, contract.settings))
    await this.saveProvider(this.k0)
    this.sourceId = await this.timed(this.page!.evaluate(async expected => {
      const api = (window as any).api
      await api.sources.add({ nameCN: expected.sourceName, nameEN: expected.sourceName, url: expected.origin,
        feedUrl: expected.origin + '/rss', parseStrategy: 'RSS', authorityWeight: 3 })
      const sources = await api.sources.list()
      const rows = sources.filter((item: any) => item.nameCN === expected.sourceName && item.nameEN === expected.sourceName && item.url === expected.origin)
      if (rows.length !== 1 || !Number.isSafeInteger(rows[0].id)) throw new Error('SOURCE_CREATION_CONTRACT')
      await api.sources.toggle(rows[0].id, false)
      return rows[0].id
    }, this.expected))
    this.check('BUSINESS_FIXTURE_CREATED_VIA_API', Number.isSafeInteger(this.sourceId) && this.sourceId > 0)
    await this.page!.getByTestId('nav-tab-feed').click()
    await this.page!.getByTestId('quant-onboarding-open').click()
    await this.page!.getByTestId('quant-onboarding-step-1').click()
    await this.page!.getByTestId('quant-application-reported').click()
    await this.page!.getByTestId('quant-official-reply-reported').click()
    await this.page!.getByTestId('quant-onboarding-step-2').click()
    await this.page!.getByTestId('quant-data-permission-acknowledged').check()
    await this.page!.getByRole('button', { name: '\u5173\u95ed\u91cf\u5316\u5f00\u901a\u5f15\u5bfc' }).click()
    await this.page!.evaluate(({ name, marker }) => localStorage.setItem(name, marker), { name: contract.caseStorageKey, marker: this.marker })
    fs.writeFileSync(path.join(this.userData, contract.sentinelBasename), this.sentinel, { flag: 'wx', mode: 0o600 })
  }
  snapshotInput(activeKey: string, previousKey = '') {
    return { appPath: this.appPath, userData: this.userData, contract, expected: this.expected, sourceId: this.sourceId,
      keys: [this.k0, this.k1].filter(Boolean), activeKey, previousKey }
  }
  async snapshot(activeKey: string, previousKey = '') {
    const value: any = await this.timed(this.app!.evaluate(({ safeStorage }, input) => {
      try { return { ok: true, snapshot: require(input.helper).snapshot(input.data, safeStorage) } }
      catch (error: any) { return { ok: false, code: error.acceptanceCode || 'INSTALLED_SQLITE_READ_FAILED' } }
    }, { helper: path.join(toolsRoot, 'snapshot.cjs'), data: this.snapshotInput(activeKey, previousKey) }), 'SYSTEM_DECRYPT_TIMEOUT')
    need(value.ok, value.code?.includes('CRYPT') || value.code?.includes('CREDENTIAL') ? 'FAIL_CREDENTIAL' : 'FAIL_DATA', value.code || 'SNAPSHOT_FAILED')
    this.check('READONLY_INSTALLED_SQLITE', value.snapshot.sqliteReadonly && value.snapshot.sqliteModuleInsidePackage)
    this.check('DISK_NO_PLAINTEXT_RUNNING', value.snapshot.dbFiles.every((item: any) => item.plaintextAbsent), 'FAIL_CREDENTIAL')
    if (this.mac) this.check('REAL_SYSTEM_DECRYPT', value.snapshot.encryptionAvailable && value.snapshot.decryptMatches && value.snapshot.rejectsPrevious, 'FAIL_CREDENTIAL')
    else this.check('WINDOWS_NO_NONEMPTY_KEY', value.snapshot.cipherBytes === 0, 'FAIL_CREDENTIAL')
    this.result.phases.at(-1).records = [...(this.result.phases.at(-1).records || []), value.snapshot]
    return value.snapshot
  }
  async readState(activeKey: string, previousKey = '') {
    this.mark('state-read')
    await this.apiCheck()
    const storage: any = await this.page!.evaluate(({ progressKey, caseKey, marker }) => {
      const raw = localStorage.getItem(progressKey)
      const progress = raw ? JSON.parse(raw) : {}
      return { progress: progress.applicationRequested === true && progress.officialReplyReceived === true && progress.dataPermissionAcknowledged === true,
        marker: localStorage.getItem(caseKey) === marker }
    }, { progressKey: contract.onboardingStorageKey, caseKey: contract.caseStorageKey, marker: this.marker })
    this.check('ONBOARDING_PROGRESS', storage.progress)
    this.check('ORIGIN_LOCAL_STORAGE', storage.marker)
    this.check('SENTINEL', hash(fs.readFileSync(path.join(this.userData, contract.sentinelBasename))) === hash(this.sentinel))
    this.check('NO_CREDENTIAL_REQUEST', !this.credentialRequest && !this.oversizedRequest, 'FAIL_CREDENTIAL')
    return this.snapshot(activeKey, previousKey)
  }
  compare(actual: any, expected: any) {
    for (const key of ['settingsSha256', 'aiSha256', 'providerSha256', 'sourceSha256', 'sourceId', 'cipherSha256']) this.check('PERSIST_' + key, actual[key] === expected[key], key === 'cipherSha256' ? 'FAIL_CREDENTIAL' : 'FAIL_DATA')
    this.check('MIGRATION_SET_FROZEN', JSON.stringify(actual.migrations) === JSON.stringify(expected.migrations), 'BLOCKED_INPUT', 'MIGRATION_PLAN_NOT_FROZEN')
  }
  async quit(activeKey: string) {
    this.mark('normal-exit')
    await this.descendants()
    const app = this.app!, child = app.process() // Cache before Playwright closes its handle.
    const exit = new Promise<{ code: number | null; signal: string | null }>(resolve => {
      if (child.exitCode !== null) resolve({ code: child.exitCode, signal: child.signalCode })
      else child.once('exit', (code, signal) => resolve({ code, signal }))
    })
    // Normal application quit, never a force kill to obtain a successful lifecycle result.
    await deadline(app.close(), contract.timeoutsMs.exit, 'FAIL_LIFECYCLE', 'NORMAL_QUIT_TIMEOUT')
    const ended = await deadline(exit, 3000, 'FAIL_LIFECYCLE', 'EXIT_NOT_OBSERVED')
    this.app = undefined; this.page = undefined
    this.check('NORMAL_EXIT_ZERO', ended.code === 0 && ended.signal === null, 'FAIL_LIFECYCLE')
    const until = Date.now() + 5000
    while ((await this.descendants()).length && Date.now() < until) await sleep(200)
    await this.descendants(true)
    this.check('DESCENDANTS_EXITED', true, 'FAIL_LIFECYCLE')
    this.check('LEGACY_TRAP_UNUSED', fs.readdirSync(path.join(this.root, 'legacy-trap')).length === 0, 'BLOCKED_ENVIRONMENT')
    const probe = await command(this.launcher, [path.join(toolsRoot, 'snapshot.cjs')], {
      timeout: 15000, env: { ELECTRON_RUN_AS_NODE: '1' }, input: JSON.stringify(this.snapshotInput(activeKey)), kind: 'FAIL_LIFECYCLE' })
    let read: any
    try { read = JSON.parse(probe.stdout) } catch { throw new AcceptanceError('BLOCKED_ENVIRONMENT', 'PACKAGED_READONLY_HELPER_UNAVAILABLE') }
    this.check('POST_EXIT_DATABASE_READABLE', probe.code === 0 && read.ok && read.snapshot.sqliteReadonly, 'FAIL_DATA', read.code || 'POST_EXIT_DATABASE_FAILED')
    this.check('DISK_NO_PLAINTEXT_EXITED', read.snapshot.dbFiles.every((item: any) => item.plaintextAbsent), 'FAIL_CREDENTIAL')
    this.result.phases.at(-1).records.push(read.snapshot)
    Object.assign(this.result.phases.at(-1), { exited: true, exitCode: ended.code, exitTime: new Date().toISOString() })
    this.persistResult()
    await this.descendants(true)
  }
  async execute() {
    try {
      this.mark('execute')
      const frozenSource = requireFrozenExecution()
      const inputs = await validatedInputs(); this.assets = inputs.assets
      this.input = this.envelope('input-manifest', { frozenSource, manifestSha256: await hashFile(manifestPath),
        contractSha256: await hashFile(path.join(toolsRoot, 'fixtures/version-contract.json')),
        installers: this.assets.map(({ absolute, ...item }) => item) })
      writeEvidence('input-manifest.json', this.input, this.secretValues)
      this.check('PUBLIC_PROBE_REACHABLE_BEFORE_ISOLATION', await publicReachable(contract.probeUrl), 'BLOCKED_ENVIRONMENT')
      await this.loopback()
      this.password = this.mac ? 'NA_KEYCHAIN_PASSWORD:' + randomBytes(32).toString('hex') : ''
      if (this.password) this.secretValues.push(this.password)
      this.mark('platform-setup')
      const setup = await platformCommand('setup', [], { timeout: 60000, input: this.password })
      this.uid = setup.uid; this.network.enabledAt = new Date().toISOString(); this.network.policy = setup.policy
      this.network.probeComplete = false
      this.persistNetwork()
      this.network.policySha256 = this.mac ? await hashFile(path.join(this.root, 'network.sb')) : hash(JSON.stringify(setup.programs))
      this.persistNetwork()
      await this.install(0)
      await this.launch('A', '1.0.0'); await this.seed(); this.baseline = await this.readState(this.k0); await this.quit(this.k0)
      await this.launch('B', '1.0.0'); this.compare(await this.readState(this.k0), this.baseline); await this.quit(this.k0)
      const before = await hashFile(path.join(this.userData, contract.databaseBasename))
      await this.install(1)
      this.check('PRE_NEW_LAUNCH_DATABASE_UNCHANGED', before === await hashFile(path.join(this.userData, contract.databaseBasename)))
      this.check('PRE_NEW_LAUNCH_SENTINEL', hash(fs.readFileSync(path.join(this.userData, contract.sentinelBasename))) === hash(this.sentinel))
      await this.launch('C', '1.1.0'); this.compare(await this.readState(this.k0), this.baseline)
      if (this.mac) {
        await this.saveProvider(this.k1)
        const changed = await this.snapshot(this.k1, this.k0)
        this.check('K1_REPLACED_K0', changed.cipherSha256 !== this.baseline.cipherSha256, 'FAIL_CREDENTIAL')
        this.expected.maxTokens = 3072; this.expected.presetPrompt += '-metadata-only'
        await this.saveProvider(undefined, true)
        this.current = await this.readState(this.k1, this.k0)
        this.check('METADATA_ONLY_PRESERVES_CIPHER', this.current.cipherSha256 === changed.cipherSha256, 'FAIL_CREDENTIAL')
      } else this.current = this.baseline
      await this.quit(this.mac ? this.k1 : '')
      await this.launch('D', '1.1.0'); this.compare(await this.readState(this.mac ? this.k1 : '', this.k0), this.current); await this.quit(this.mac ? this.k1 : '')
      this.check('FINAL_NO_CREDENTIAL_REQUEST', !this.credentialRequest && !this.oversizedRequest, 'FAIL_CREDENTIAL')
      this.result.status = 'PASS'; this.result.reasonCode = 'MACHINE_ASSERTIONS_COMPLETE_ASTRA_REVIEW_REQUIRED'; this.result.complete = true
      this.result.scope = 'published-package-upgrade-data-preservation; equal-migration-sets; isolated-keychain-only; Astra signoff required'
    } catch (error: any) {
      const failure = recordFailure(error, this.stage, 'NATIVE_EXECUTION_FAILED')
      this.result.status = failure.status
      this.result.reasonCode = failure.reasonCode
      this.result.complete = false
    } finally {
      // Preserve completed facts BEFORE the first cleanup await. Cleanup/worker
      // termination must not be the only path to the evidence directory.
      try {
        this.persistResult()
        if (this.network.enabledAt) this.persistNetwork()
        if (this.installEvents.length) this.persistInstallers()
      } catch (error) {
        const failure = recordFailure(error, this.stage, 'EVIDENCE_CHECKPOINT_FAILED')
        this.result.status = failure.status; this.result.reasonCode = failure.reasonCode; this.result.complete = false
      }
      try { await cleanup('test-finally'); this.result.cleanup = true; this.network.cleanupSucceeded = true; this.network.disabledAt = new Date().toISOString() }
      catch (error) {
        const failure = recordFailure(error, 'cleanup', 'OWNED_CLEANUP_FAILED')
        this.result.cleanup = false; this.result.complete = false; this.result.status = failure.status; this.result.reasonCode = failure.reasonCode
      }
      if (this.server) { this.server.closeAllConnections(); await deadline(new Promise<void>(resolve => this.server!.close(() => resolve())), 3000, 'BLOCKED_ENVIRONMENT', 'LOOPBACK_CLEANUP_TIMEOUT').catch(() => {}) }
      this.result.endedAt = new Date().toISOString()
      // Installer errors may have been recorded before the platform command returned nonzero.
      if (!this.mac) for (const version of contract.versions) {
        const file = path.join(this.root, 'installer-event-' + version + '.json')
        if (fs.existsSync(file) && !this.installEvents.some(item => item.version === version)) {
          const event = JSON.parse(fs.readFileSync(file, 'utf8'))
          this.installEvents.push({ version, exitCode: event.exitCode, durationMs: event.durationMs, events: event.events })
        }
      }
      try {
        this.mark('archive')
        if (this.input) writeEvidence('input-manifest.json', this.input, this.secretValues)
        this.persistNetwork()
        this.persistInstallers()
        writeEvidence('acceptance-result.json', this.result, this.secretValues)
      } catch (error) {
        const failure = recordFailure(error, 'archive', 'EVIDENCE_ARCHIVE_FAILED')
        this.result.status = failure.status; this.result.reasonCode = failure.reasonCode; this.result.complete = false
      }
    }
    if (this.result.status !== 'PASS') throw new AcceptanceError(this.result.status, this.result.reasonCode)
  }
}
