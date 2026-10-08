import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

export const toolsRoot = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(toolsRoot, '../..')
export const manifestPath = path.join(repoRoot, 'tests/fixtures/releases/native-upgrade-1.0-1.1.json')
export const contract = JSON.parse(fs.readFileSync(path.join(toolsRoot, 'fixtures/version-contract.json'), 'utf8'))
export const FILES = ['input-manifest.json', 'acceptance-result.json', 'network-isolation.json', 'installer-events.json']
export const KINDS = ['BLOCKED_INPUT', 'BLOCKED_ENVIRONMENT', 'FAIL_INSTALL', 'FAIL_DATA', 'FAIL_CREDENTIAL', 'FAIL_LIFECYCLE', 'PASS']
const shaPattern = /^[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{40}$/
const safeKeys = new Set(('schemaVersion kind harnessSha contractSha256 manifestSha256 caseId runId runAttempt platform arch status reasonCode startedAt endedAt phases assertions cleanup complete sanitization scope products version tag sourceSha basename sha256 size path installers phase launchId pid uidHash exitCode exited launchTime exitTime packaged runtimeName packageName appId appUserModelId exeRelative exePathHash appRelative appPathHash userDataRelative userDataPathHash sessionDataRelative sessionDataPathHash markerMatches sqliteReadonly sqliteModuleInsidePackage settingsSha256 aiSha256 providerSha256 sourceSha256 sourceId migrations cipherSha256 cipherBytes encryptionAvailable decryptMatches rejectsPrevious otherKeysEmpty apiNoPlaintext dbFiles fileClass absent plaintextAbsent name passed installed registrationSha256 installRelative policy policySha256 enabledAt disabledAt controls transport loopback externalDenied denialCode denialEvidence inherited descendantsCovered blockedAttempts credentialRequestObserved requestCount observationCount verification cleanupSucceeded finalized beforeSha256 afterSha256 durationMs events moduleName moduleVersion exceptionCode faultOffset sanitizedInMemory fixtureScan passwordScan forbiddenFieldsScan records').split(' '))

export class AcceptanceError extends Error {
  constructor(kind, code) { super(code); this.kind = kind; this.code = code }
}
export function requireCondition(value, kind, code) { if (!value) throw new AcceptanceError(kind, code) }
export function hash(value) { return createHash('sha256').update(value).digest('hex') }
export function relative(root, value) {
  const result = path.relative(root, value)
  requireCondition(result && !result.startsWith('..') && !path.isAbsolute(result), 'BLOCKED_ENVIRONMENT', 'PATH_OUTSIDE_CASE')
  return result.split(path.sep).join('/')
}
export function assertHosted(platform, arch) {
  requireCondition(process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true'
    && process.env.RUNNER_ENVIRONMENT === 'github-hosted', 'BLOCKED_ENVIRONMENT', 'HOSTED_NATIVE_CI_REQUIRED')
  requireCondition((platform === 'windows' && arch === 'x64' && process.platform === 'win32')
    || (platform === 'macOS' && ['arm64', 'x64'].includes(arch) && process.platform === 'darwin'),
  'BLOCKED_ENVIRONMENT', 'NATIVE_PLATFORM_REQUIRED')
  requireCondition(process.arch === arch, 'BLOCKED_ENVIRONMENT', 'NATIVE_ARCH_REQUIRED')
}
export function controlledRoot() {
  const root = process.env.NA_CASE_ROOT
  requireCondition(root && path.isAbsolute(root) && process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP),
    'BLOCKED_ENVIRONMENT', 'CASE_ROOT_REQUIRED')
  const temporary = fs.realpathSync(process.env.RUNNER_TEMP)
  requireCondition(fs.realpathSync(root) === root && path.dirname(root) === temporary
    && path.basename(root).startsWith('rt-native-acceptance-') && !fs.lstatSync(root).isSymbolicLink(),
  'BLOCKED_ENVIRONMENT', 'CASE_OWNERSHIP_INVALID')
  const owner = JSON.parse(fs.readFileSync(path.join(root, 'owner.json'), 'utf8'))
  requireCondition(owner.root === root && owner.runId === process.env.GITHUB_RUN_ID
    && owner.runAttempt === process.env.GITHUB_RUN_ATTEMPT && owner.harnessSha === process.env.GITHUB_SHA,
  'BLOCKED_ENVIRONMENT', 'CASE_OWNERSHIP_INVALID')
  assertHosted(owner.platform, owner.arch)
  return { root, owner }
}
export function safeEnvironment(extra = {}) {
  const names = /^(PATH|Path|SystemRoot|WINDIR|windir|COMSPEC|ComSpec|PATHEXT|TEMP|TMP|TMPDIR|HOME|USER|LOGNAME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|LANG|LC_.*|DISPLAY|XAUTHORITY|SHELL|CI|GITHUB_ACTIONS|RUNNER_ENVIRONMENT|RUNNER_TEMP)$/
  const controlNames = new Set(['GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'NA_CASE_ROOT'])
  return Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => names.test(key) || controlNames.has(key))), ...extra })
    .filter(([, value]) => typeof value === 'string'))
}
export async function command(executable, args, options = {}) {
  const timeout = options.timeout || 30000
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd || toolsRoot, env: safeEnvironment(options.env),
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderrBytes = 0, timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeout)
    child.stdout.on('data', chunk => {
      if (stdout.length + chunk.length > 512 * 1024) { timedOut = true; child.kill('SIGKILL') }
      else stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', chunk => { stderrBytes += chunk.length })
    child.on('error', () => { clearTimeout(timer); reject(new AcceptanceError('BLOCKED_ENVIRONMENT', 'NATIVE_COMMAND_UNAVAILABLE')) })
    child.on('close', code => {
      clearTimeout(timer)
      if (timedOut) reject(new AcceptanceError(options.kind || 'BLOCKED_ENVIRONMENT', 'NATIVE_COMMAND_TIMEOUT'))
      else resolve({ code, stdout, stderrBytes, pid: child.pid })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(options.input || '')
  })
}
export async function platformCommand(action, args = [], options = {}) {
  const { root, owner } = controlledRoot()
  const result = owner.platform === 'windows'
    ? await command('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(toolsRoot, 'platform/windows.ps1'),
      '-Action', action, '-Root', root, ...args], options)
    : await command('/bin/bash', [path.join(toolsRoot, 'platform/macos.sh'), action, root, ...args], options)
  let value
  try { value = JSON.parse(result.stdout.trim() || '{}') } catch { value = {} }
  if (result.code !== 0 || value.ok !== true) {
    throw new AcceptanceError(value.kind || options.kind || 'BLOCKED_ENVIRONMENT',
      /^[A-Z0-9_]+$/.test(value.code || '') ? value.code : 'NATIVE_PLATFORM_FAILED')
  }
  return value
}
export async function hashFile(file) {
  const digest = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}
export function validateManifest(manifest) {
  requireCondition(manifest.repository === contract.repository && manifest.releases?.length === 2,
    'BLOCKED_INPUT', 'RELEASE_MANIFEST_INVALID')
  const sources = ['41f8429149f646c7dec7f1610082702e7d9cce48', 'ec1fe73e5f3c80edb1f3e7b0a989a03cf66b18ad']
  manifest.releases.forEach((release, index) => {
    requireCondition(release.version === contract.versions[index] && release.tag === 'v' + release.version
      && release.sourceSha === sources[index], 'BLOCKED_INPUT', 'RELEASE_IDENTITY_MISMATCH')
    for (const [platform, arch] of [['windows', 'x64'], ['macOS', 'arm64'], ['macOS', 'x64']]) {
      const asset = release.assets?.[platform]?.[arch]
      requireCondition(asset && shaPattern.test(asset.sha256) && Number.isSafeInteger(asset.size) && asset.size > 0,
        'BLOCKED_INPUT', 'ASSET_PIN_MISSING')
    }
  })
  return manifest
}
export async function validatedInputs() {
  const { root, owner } = controlledRoot()
  const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'download-receipt.json'), 'utf8'))
  requireCondition(receipt.installers?.length === 2, 'BLOCKED_INPUT', 'DOWNLOAD_RECEIPT_INCOMPLETE')
  const temporary = fs.realpathSync(process.env.RUNNER_TEMP)
  const assets = []
  for (let index = 0; index < 2; index++) {
    const item = receipt.installers[index], release = manifest.releases[index]
    const pin = release.assets[owner.platform][owner.arch]
    requireCondition(item.version === release.version && item.basename === pin.basename && item.sha256 === pin.sha256
      && item.size === pin.size && typeof item.path === 'string' && !path.isAbsolute(item.path)
      && !item.path.includes('\\') && !item.path.split('/').includes('..') && item.path.split('/').length === 2
      && item.path.startsWith('rt-native-upgrade-') && path.posix.basename(item.path) === pin.basename,
    'BLOCKED_INPUT', 'DOWNLOAD_RECEIPT_MISMATCH')
    const absolute = path.resolve(temporary, item.path)
    requireCondition(fs.realpathSync(absolute) === absolute && fs.lstatSync(absolute).isFile()
      && fs.statSync(absolute).size === pin.size && await hashFile(absolute) === pin.sha256,
    'BLOCKED_INPUT', 'INSTALLER_BYTES_MISMATCH')
    assets.push({ ...item, absolute, tag: release.tag, sourceSha: release.sourceSha })
  }
  requireCondition(path.dirname(assets[0].absolute) === path.dirname(assets[1].absolute), 'BLOCKED_INPUT', 'DOWNLOAD_PAIR_DIRECTORY_MISMATCH')
  return { root, owner, assets }
}
export function scanEvidence(value, secrets = []) {
  const visit = item => {
    if (typeof item === 'string') {
      if (/NOT-A-REAL-CREDENTIAL:|NA_KEYCHAIN_PASSWORD:|Bearer\s/i.test(item)
          || secrets.some(secret => secret && item.includes(secret))) throw new Error('SENSITIVE_EVIDENCE')
      if (path.isAbsolute(item) || /^[A-Za-z]:[\\/]/.test(item)) throw new Error('ABSOLUTE_EVIDENCE_PATH')
    } else if (Array.isArray(item)) item.forEach(visit)
    else if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (!safeKeys.has(key)) throw new Error('UNKNOWN_EVIDENCE_FIELD')
      visit(child)
    } else if (item !== null && !['boolean', 'number'].includes(typeof item)) throw new Error('INVALID_EVIDENCE_VALUE')
  }
  visit(value)
}
export function writeEvidence(file, value, secrets = []) {
  requireCondition(FILES.includes(file), 'BLOCKED_INPUT', 'UNKNOWN_EVIDENCE_FILE')
  const { root } = controlledRoot()
  scanEvidence(value, secrets)
  fs.writeFileSync(path.join(root, 'evidence', file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
}
export function minimalResult(owner, kind, code) {
  return { schemaVersion: 1, kind: 'acceptance-result', harnessSha: owner.harnessSha,
    caseId: owner.caseId, runId: owner.runId, runAttempt: Number(owner.runAttempt), platform: owner.platform, arch: owner.arch,
    status: kind, reasonCode: code, phases: [], assertions: [], cleanup: false, complete: false,
    scope: 'machine-evidence-only; Astra signoff required', sanitizedInMemory: true }
}
export async function cleanup() {
  const { root } = controlledRoot()
  // Platform cleanup only targets case-owned paths/processes/rules; it never uninstalls a product.
  await platformCommand('cleanup', [], { timeout: 60000 })
  const file = path.join(root, 'evidence/acceptance-result.json')
  if (fs.existsSync(file)) {
    const result = JSON.parse(fs.readFileSync(file, 'utf8'))
    result.cleanup = true
    writeEvidence('acceptance-result.json', result)
  }
}
export function publishEvidence() {
  const { root, owner } = controlledRoot()
  const destination = path.join(root, 'public-evidence')
  // Publication owns a fresh directory; never clean up someone else's previous output.
  fs.mkdirSync(destination, { mode: 0o700 })
  const copied = []
  try {
    const result = JSON.parse(fs.readFileSync(path.join(root, 'evidence/acceptance-result.json'), 'utf8'))
    const files = FILES.filter(name => fs.existsSync(path.join(root, 'evidence', name)))
    requireCondition(!result.complete || files.length === FILES.length, 'BLOCKED_INPUT', 'COMPLETE_EVIDENCE_MISSING')
    for (const name of files) {
      const file = path.join(root, 'evidence', name)
      requireCondition(fs.lstatSync(file).isFile() && fs.statSync(file).size <= 256 * 1024,
        'FAIL_CREDENTIAL', 'EVIDENCE_SIZE_INVALID')
      const value = JSON.parse(fs.readFileSync(file, 'utf8'))
      scanEvidence(value)
      requireCondition(value.sanitizedInMemory === true, 'FAIL_CREDENTIAL', 'EVIDENCE_NOT_SCANNED_IN_MEMORY')
    }
    for (const name of files) {
      fs.copyFileSync(path.join(root, 'evidence', name), path.join(destination, name), fs.constants.COPYFILE_EXCL)
      copied.push(name)
    }
  } catch {
    // No partial success bundle is uploaded if scanning fails.
    for (const name of copied) {
      const file = path.join(destination, name)
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
    fs.writeFileSync(path.join(destination, 'acceptance-result.json'), JSON.stringify(minimalResult(owner, 'FAIL_CREDENTIAL', 'EVIDENCE_SCAN_FAILED')), { flag: 'wx', mode: 0o600 })
    throw new AcceptanceError('FAIL_CREDENTIAL', 'EVIDENCE_SCAN_FAILED')
  }
}
export default class PrivateReporter {
  onEnd(result) { process.stdout.write('Native acceptance runner: ' + result.status + '; review sanitized evidence.\n') }
}

async function cli() {
  const [operation, first, second] = process.argv.slice(2)
  if (operation === 'prepare') {
    const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
    requireCondition(commitPattern.test(process.env.GITHUB_SHA || ''), 'BLOCKED_INPUT', 'HARNESS_SHA_MISSING')
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'manifest_sha256=' + hash(fs.readFileSync(manifestPath)) + '\n')
    process.stdout.write('Frozen input contract: ' + manifest.releases.map(item => item.version).join(' -> ') + '\n')
    return
  }
  if (operation === 'init') {
    assertHosted(first, second)
    requireCondition(path.isAbsolute(process.env.RUNNER_TEMP || '') && commitPattern.test(process.env.GITHUB_SHA || ''),
      'BLOCKED_ENVIRONMENT', 'RUNNER_IDENTITY_MISSING')
    requireCondition(path.parse(fs.realpathSync(process.env.RUNNER_TEMP)).root !== fs.realpathSync(process.env.RUNNER_TEMP)
      && /^\d+$/.test(process.env.GITHUB_RUN_ID || '') && /^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || ''),
    'BLOCKED_ENVIRONMENT', 'RUNNER_IDENTITY_INVALID')
    const root = fs.mkdtempSync(path.join(fs.realpathSync(process.env.RUNNER_TEMP), 'rt-native-acceptance-'))
    const owner = { root, caseId: randomUUID(), platform: first, arch: second, runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT, harnessSha: process.env.GITHUB_SHA }
    fs.writeFileSync(path.join(root, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 })
    fs.mkdirSync(path.join(root, 'evidence'), { mode: 0o700 })
    process.env.NA_CASE_ROOT = root
    writeEvidence('acceptance-result.json', minimalResult(owner, 'BLOCKED_INPUT', 'NOT_EXECUTED'))
    fs.appendFileSync(process.env.GITHUB_ENV, 'NA_CASE_ROOT=' + root + '\nNA_PUBLIC_EVIDENCE=' + path.join(root, 'public-evidence') + '\n')
    return
  }
  if (operation === 'fetch') {
    const { root, owner } = controlledRoot()
    try {
      const require = createRequire(import.meta.url)
      const { main } = require(path.join(repoRoot, '.github/scripts/fetch-upgrade-installers.cjs'))
      const receipt = await main(['--platform', owner.platform, '--arch', owner.arch])
      fs.writeFileSync(path.join(root, 'download-receipt.json'), JSON.stringify(receipt), { flag: 'wx', mode: 0o600 })
      await validatedInputs()
    } catch (error) {
      const code = error.upgradeCode || error.code || 'DOWNLOAD_INPUT_FAILED'
      writeEvidence('acceptance-result.json', minimalResult(owner, 'BLOCKED_INPUT', /^[A-Z0-9_]+$/.test(code) ? code : 'DOWNLOAD_INPUT_FAILED'))
      throw new AcceptanceError('BLOCKED_INPUT', code)
    }
    return
  }
  if (operation === 'cleanup') return cleanup()
  if (operation === 'publish') return publishEvidence()
  if (operation === 'collect') {
    const expected = new Set(['windows-x64', 'macOS-arm64', 'macOS-x64']), selected = new Map()
    for (const directory of fs.readdirSync(first)) {
      const file = path.join(first, directory, 'acceptance-result.json')
      if (!fs.existsSync(file)) continue
      const result = JSON.parse(fs.readFileSync(file, 'utf8')); scanEvidence(result)
      requireCondition(result.harnessSha === process.env.GITHUB_SHA && result.runId === process.env.GITHUB_RUN_ID
        && Number.isInteger(result.runAttempt) && result.runAttempt <= Number(process.env.GITHUB_RUN_ATTEMPT),
      'BLOCKED_INPUT', 'COLLECT_IDENTITY_MISMATCH')
      const key = result.platform + '-' + result.arch
      requireCondition(expected.has(key), 'BLOCKED_INPUT', 'COLLECT_PLATFORM_UNKNOWN')
      if (!selected.has(key) || selected.get(key).result.runAttempt < result.runAttempt) selected.set(key, { result, directory })
    }
    let allPassed = selected.size === 3 && process.env.NA_NATIVE_RESULT === 'success'
    for (const [key, { result, directory }] of selected) {
      const required = ['PACKAGED_VERSION_ARCH', 'PACKAGE_RUNTIME_NAME', 'EFFECTIVE_USER_DATA', 'EFFECTIVE_SESSION_DATA',
        'INSTALLED_APP_PATH', 'CASE_MARKER', 'NETWORK_node', 'NETWORK_electron', 'NETWORK_child', 'SETTINGS_API',
        'CONFIG_API_REDACTED', 'ONBOARDING_PROGRESS', 'ORIGIN_LOCAL_STORAGE', 'SENTINEL', 'READONLY_INSTALLED_SQLITE',
        'NORMAL_EXIT_ZERO', 'DESCENDANTS_EXITED', 'POST_EXIT_DATABASE_READABLE', 'DISK_NO_PLAINTEXT_RUNNING', 'DISK_NO_PLAINTEXT_EXITED']
      const assertionNames = new Set((result.assertions || []).filter(item => item.passed === true).map(item => item.name))
      const passed = result.status === 'PASS' && result.complete === true && result.cleanup === true
        && result.phases?.length === 4 && result.phases.every((phase, index) => phase.phase === 'ABCD'[index] && phase.exited === true && phase.exitCode === 0)
        && result.assertions?.length >= 20 && result.assertions.every(item => item.passed === true)
        && [...'ABCD'].every(phase => required.every(name => assertionNames.has(phase + ':' + name)))
        && (result.platform !== 'macOS' || ([...'ABCD'].every(phase => assertionNames.has(phase + ':REAL_SYSTEM_DECRYPT'))
          && assertionNames.has('C:K1_REPLACED_K0') && assertionNames.has('C:METADATA_ONLY_PRESERVES_CIPHER')))
      if (passed) {
        for (const name of FILES) {
          const value = JSON.parse(fs.readFileSync(path.join(first, directory, name), 'utf8')); scanEvidence(value)
          requireCondition(value.sanitizedInMemory === true, 'FAIL_CREDENTIAL', 'COLLECT_UNSCANNED_EVIDENCE')
          requireCondition(value.caseId === result.caseId && value.harnessSha === result.harnessSha
            && value.runId === result.runId && value.runAttempt === result.runAttempt
            && value.platform === result.platform && value.arch === result.arch, 'BLOCKED_INPUT', 'COLLECT_FILE_IDENTITY_MISMATCH')
          if (name === 'input-manifest.json') requireCondition(value.manifestSha256 === hash(fs.readFileSync(manifestPath)), 'BLOCKED_INPUT', 'COLLECT_ASSET_MANIFEST_MISMATCH')
          if (name === 'network-isolation.json') requireCondition(value.inherited === true && value.descendantsCovered === true
            && value.cleanupSucceeded === true && value.credentialRequestObserved === false && value.controls?.length === 12
            && value.controls.every(item => item.loopback === true && item.externalDenied === true), 'BLOCKED_ENVIRONMENT', 'COLLECT_NETWORK_GATE_MISSING')
          if (name === 'installer-events.json') requireCondition(value.events?.length === 2
            && value.events.every((item, index) => item.version === contract.versions[index] && item.exitCode === 0), 'FAIL_INSTALL', 'COLLECT_INSTALL_EVENT_MISSING')
        }
      }
      allPassed &&= passed
      process.stdout.write(key + ': ' + result.status + ' / ' + result.reasonCode + '\n')
    }
    const message = 'Machine evidence ' + (allPassed ? 'complete' : 'incomplete or failing') + '. Astra review/signoff required.\n'
    process.stdout.write(message)
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, message)
    if (!allPassed) process.exitCode = 1
    return
  }
  throw new AcceptanceError('BLOCKED_INPUT', 'UNKNOWN_OPERATION')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { process.stderr.write((error.kind || 'BLOCKED_ENVIRONMENT') + ' / ' + (error.code || 'HARNESS_COMMAND_FAILED') + '\n'); process.exitCode = 1 })
}
