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
export const FROZEN_PATHS = [
  '.github/scripts/fetch-upgrade-installers.cjs', '.github/workflows/native-upgrade-acceptance.yml',
  'tests/fixtures/releases/native-upgrade-1.0-1.1.json', 'tools/native-acceptance/README.md',
  'tools/native-acceptance/evidence.mjs', 'tools/native-acceptance/fixtures/version-contract.json',
  'tools/native-acceptance/harness.ts', 'tools/native-acceptance/native-upgrade.spec.ts',
  'tools/native-acceptance/offline.test.mjs', 'tools/native-acceptance/package.json',
  'tools/native-acceptance/platform/macos.mjs', 'tools/native-acceptance/platform/macos.sh',
  'tools/native-acceptance/platform/windows.ps1', 'tools/native-acceptance/playwright.config.ts',
  'tools/native-acceptance/pnpm-lock.yaml', 'tools/native-acceptance/snapshot.cjs',
].sort()
export const FREEZE_RELATIVE = 'tools/native-acceptance/fixtures/harness-freeze.json'
const STAGES = new Set(['case-init', 'freeze-verification', 'download', 'runner-start', 'discovery-or-worker-start',
  'test-start', 'module-load', 'constructor', 'execute', 'platform-setup', 'platform-install', 'app-launch',
  'network-probe', 'fixture-seed', 'state-read', 'normal-exit', 'cleanup', 'archive', 'publish', 'runner-end', 'unknown'])
const ERROR_CLASSES = new Set(['Error', 'TypeError', 'SyntaxError', 'ReferenceError', 'RangeError', 'TimeoutError', 'AssertionError', 'AggregateError'])
const ERRNOS = new Set(['EACCES', 'EPERM', 'ENOENT', 'EEXIST', 'EISDIR', 'ENOTDIR', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET',
  'ENOSPC', 'EADDRINUSE', 'EINVAL', 'EIO', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_REQUIRE_ESM',
  'ERR_INVALID_ARG_TYPE', 'ERR_UNKNOWN_FILE_EXTENSION', 'ERR_DLOPEN_FAILED'])
const SIGNALS = new Set(['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT', 'SIGBUS'])
const safeKeys = new Set(('schemaVersion kind harnessSha contractSha256 manifestSha256 caseId runId runAttempt platform arch status reasonCode startedAt endedAt phases assertions cleanup complete sanitization scope products version tag sourceSha basename sha256 size path installers phase launchId pid uidHash exitCode exited launchTime exitTime packaged runtimeName packageName appId appUserModelId exeRelative exePathHash appRelative appPathHash userDataRelative userDataPathHash sessionDataRelative sessionDataPathHash markerMatches sqliteReadonly sqliteModuleInsidePackage settingsSha256 aiSha256 providerSha256 sourceSha256 sourceId migrations cipherSha256 cipherBytes encryptionAvailable decryptMatches rejectsPrevious otherKeysEmpty apiNoPlaintext dbFiles fileClass absent plaintextAbsent name passed installed registrationSha256 installRelative policy policySha256 enabledAt disabledAt controls transport loopback externalDenied denialCode denialEvidence inherited descendantsCovered blockedAttempts credentialRequestObserved requestCount observationCount verification cleanupSucceeded finalized beforeSha256 afterSha256 durationMs events moduleName moduleVersion exceptionCode faultOffset sanitizedInMemory fixtureScan passwordScan forbiddenFieldsScan records').split(' '))

export class AcceptanceError extends Error {
  constructor(kind, code) { super(code); this.kind = kind; this.code = code }
}
export function requireCondition(value, kind, code) { if (!value) throw new AcceptanceError(kind, code) }
export function hash(value) { return createHash('sha256').update(value).digest('hex') }
for (const key of ['stage', 'checkpoints', 'diagnostics', 'errorClass', 'errno', 'signal', 'description', 'role', 'line', 'column',
  'cleanupEvidence', 'attempts', 'time', 'frozenSource', 'freezeSha256', 'combinedSha256', 'fileCount', 'files']) safeKeys.add(key)

// Never return the message, stack, arguments, arbitrary error properties, or an
// arbitrary error name. Even Playwright errors can contain complete IPC inputs.
export function safeDiagnostic(error, stage, code) {
  error = error?.nativeError || error
  const raw = typeof error?.message === 'string' ? error.message.slice(0, 16384) : ''
  const stack = typeof error?.stack === 'string' ? error.stack.slice(0, 32768) : ''
  const errorClass = ERROR_CLASSES.has(error?.name) ? error.name
    : [...ERROR_CLASSES].find(name => raw.startsWith(name + ':')) || 'Error'
  const errno = ERRNOS.has(error?.code) ? error.code
    : [...ERRNOS].find(value => new RegExp('\\b' + value + '\\b').test(raw)) || null
  const diagnostic = { stage: STAGES.has(stage) ? stage : 'unknown', reasonCode: /^[A-Z0-9_]{1,96}$/.test(code) ? code : 'UNCLASSIFIED_FAILURE',
    errorClass, errno, description: errno ? 'Operation failed with a recognized system or module error.'
      : errorClass === 'SyntaxError' ? 'Module parsing failed; raw source and parameters are suppressed.'
        : errorClass === 'TimeoutError' ? 'A bounded operation timed out; raw call arguments are suppressed.'
          : 'An exception was observed; raw message, stack and arguments are suppressed.' }
  if (Number.isInteger(error?.exitCode) && error.exitCode >= -2147483648 && error.exitCode <= 2147483647) diagnostic.exitCode = error.exitCode
  if (SIGNALS.has(error?.signal)) diagnostic.signal = error.signal
  const location = error?.location
  const candidates = [typeof location?.file === 'string' ? location.file.replaceAll('\\', '/') : '', stack.replaceAll('\\', '/'), raw.replaceAll('\\', '/')]
  for (const file of FROZEN_PATHS) {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = candidates.slice(1).map(value => value.match(new RegExp(escaped + ':(\\d{1,6})(?::(\\d{1,6}))?'))).find(Boolean)
    if (match || candidates[0] === file || candidates[0].endsWith('/' + file)) {
      diagnostic.path = file
      const line = match ? Number(match[1]) : location?.line
      const column = match ? Number(match[2] || 1) : location?.column
      if (Number.isInteger(line) && line > 0 && line <= 999999) diagnostic.line = line
      if (Number.isInteger(column) && column > 0 && column <= 999999) diagnostic.column = column
      break
    }
  }
  return diagnostic
}
export function applyFailure(result, error, stage, fixedCode) {
  const code = error instanceof AcceptanceError && /^[A-Z0-9_]{1,96}$/.test(error.code) ? error.code : fixedCode
  const diagnostic = safeDiagnostic(error, stage, code)
  const previous = result.diagnostics || []
  diagnostic.role = previous.length ? 'secondary' : 'primary'
  if (!previous.length) {
    result.status = error instanceof AcceptanceError && KINDS.includes(error.kind) && error.kind !== 'PASS' ? error.kind
      : stage === 'freeze-verification' || stage === 'download' ? 'BLOCKED_INPUT' : 'BLOCKED_ENVIRONMENT'
    result.reasonCode = diagnostic.reasonCode
  }
  result.diagnostics = [...previous, diagnostic].slice(0, 20)
  result.complete = false
  return result
}
function caseState() {
  const { root, owner } = controlledRoot()
  const file = path.join(root, 'run-state.json')
  const value = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : minimalResult(owner, 'BLOCKED_ENVIRONMENT', 'RUN_IN_PROGRESS')
  return { root, owner, file, value }
}
function saveState(state) {
  scanEvidence(state.value)
  fs.writeFileSync(state.file, JSON.stringify(state.value), { mode: 0o600 })
  return state.value
}
export function checkpoint(stage, phase) {
  requireCondition(STAGES.has(stage), 'BLOCKED_INPUT', 'UNKNOWN_CHECKPOINT_STAGE')
  const state = caseState()
  state.value.stage = stage
  state.value.checkpoints = [...(state.value.checkpoints || []), { stage, time: new Date().toISOString(),
    ...(['A', 'B', 'C', 'D'].includes(phase) ? { phase } : {}) }].slice(-128)
  return saveState(state)
}
export function currentStage() { return caseState().value.stage || 'unknown' }
export function recordFailure(error, stage, code) {
  const state = caseState()
  applyFailure(state.value, error, stage, code)
  saveState(state)
  writeEvidence('acceptance-result.json', state.value)
  return state.value
}
export function mergeRunState(value, state) {
  const merged = { ...value, stage: state.stage || value.stage || 'unknown', checkpoints: state.checkpoints || [],
    diagnostics: state.diagnostics || [], cleanupEvidence: state.cleanupEvidence || { attempts: [] } }
  if (state.diagnostics?.length) Object.assign(merged, { status: state.status, reasonCode: state.reasonCode, complete: false })
  if (state.cleanupEvidence?.attempts?.length) merged.cleanup = state.cleanup === true
  return merged
}
export function createFreeze(readBytes) {
  const files = FROZEN_PATHS.map(file => { const bytes = readBytes(file); return { path: file, size: bytes.length, sha256: hash(bytes) } })
  return { schemaVersion: 1, commitBinding: 'workflow-checkout-commit', files, combinedSha256: hash(JSON.stringify(files)) }
}
export function validateFreeze(freeze) {
  requireCondition(freeze?.schemaVersion === 1 && freeze.commitBinding === 'workflow-checkout-commit'
    && freeze.files?.length === FROZEN_PATHS.length, 'BLOCKED_INPUT', 'FREEZE_FORMAT_INVALID')
  const files = freeze.files.map((item, index) => {
    requireCondition(item.path === FROZEN_PATHS[index] && shaPattern.test(item.sha256) && Number.isSafeInteger(item.size) && item.size > 0,
      'BLOCKED_INPUT', 'FREEZE_FILE_SET_INVALID')
    return { path: item.path, size: item.size, sha256: item.sha256 }
  })
  requireCondition(hash(JSON.stringify(files)) === freeze.combinedSha256, 'BLOCKED_INPUT', 'FREEZE_COMBINED_MISMATCH')
  return files
}
export async function verifyFrozenBytes(freezeBytes, sourceSha, readLocal, readCommit) {
  requireCondition(commitPattern.test(sourceSha), 'BLOCKED_INPUT', 'FROZEN_COMMIT_INVALID')
  let freeze
  try { freeze = JSON.parse(freezeBytes.toString('utf8')) } catch { throw new AcceptanceError('BLOCKED_INPUT', 'FREEZE_JSON_INVALID') }
  const files = validateFreeze(freeze)
  // Verify local bytes first. Missing/changed files cannot reach network, install, or app launch.
  for (const item of files) {
    let bytes
    try { bytes = await readLocal(item.path) } catch { throw new AcceptanceError('BLOCKED_INPUT', 'FROZEN_FILE_MISSING') }
    requireCondition(Buffer.isBuffer(bytes) && bytes.length === item.size && hash(bytes) === item.sha256,
      'BLOCKED_INPUT', 'FROZEN_WORKTREE_BYTES_MISMATCH')
  }
  // The freeze is excluded from its own file list. Its independent runtime digest
  // is bound to the same checkout commit, without embedding that commit in itself.
  requireCondition(hash(await readCommit(FREEZE_RELATIVE, sourceSha)) === hash(freezeBytes), 'BLOCKED_INPUT', 'FREEZE_COMMIT_BYTES_MISMATCH')
  for (const item of files) {
    const bytes = await readCommit(item.path, sourceSha)
    requireCondition(Buffer.isBuffer(bytes) && bytes.length === item.size && hash(bytes) === item.sha256,
      'BLOCKED_INPUT', 'FROZEN_COMMIT_BYTES_MISMATCH')
  }
  return { harnessSha: sourceSha, freezeSha256: hash(freezeBytes), combinedSha256: freeze.combinedSha256,
    fileCount: files.length, files, verification: 'raw-worktree-and-fixed-commit-blobs-match; freeze-excludes-itself' }
}
function localFrozenBytes(file) {
  const absolute = path.join(repoRoot, file)
  requireCondition(fs.realpathSync(absolute) === absolute && fs.lstatSync(absolute).isFile(), 'BLOCKED_INPUT', 'FROZEN_FILE_NOT_REGULAR')
  return fs.readFileSync(absolute)
}
async function verifyCheckout() {
  const deadline = Date.now() + 120000
  const readCommit = async (file, sha) => {
    requireCondition(Date.now() < deadline, 'BLOCKED_INPUT', 'COMMIT_READ_TIMEOUT')
    const response = await fetch('https://api.github.com/repos/hzqedison/RT-ResearchFlow/contents/' + file + '?ref=' + sha, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        ...(process.env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(Math.min(10000, deadline - Date.now())),
    })
    requireCondition(response.ok, 'BLOCKED_INPUT', 'COMMIT_BLOB_READ_FAILED')
    let length = 0; const chunks = []
    for await (const chunk of response.body) { length += chunk.length; requireCondition(length <= 2 * 1024 * 1024, 'BLOCKED_INPUT', 'COMMIT_RESPONSE_TOO_LARGE'); chunks.push(chunk) }
    const item = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requireCondition(item.type === 'file' && item.path === file && item.encoding === 'base64' && typeof item.content === 'string',
      'BLOCKED_INPUT', 'COMMIT_BLOB_FORMAT_INVALID')
    const bytes = Buffer.from(item.content, 'base64')
    requireCondition(bytes.length === item.size && createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex') === item.sha,
      'BLOCKED_INPUT', 'COMMIT_GIT_BLOB_MISMATCH')
    return bytes
  }
  return verifyFrozenBytes(localFrozenBytes(FREEZE_RELATIVE), process.env.GITHUB_SHA || '', localFrozenBytes, readCommit)
}
export function requireFrozenExecution() {
  const { root, owner } = controlledRoot()
  let receipt
  try { receipt = JSON.parse(fs.readFileSync(path.join(root, 'freeze-receipt.json'), 'utf8')) }
  catch { throw new AcceptanceError('BLOCKED_INPUT', 'FROZEN_EXECUTION_RECEIPT_MISSING') }
  const bytes = localFrozenBytes(FREEZE_RELATIVE), freeze = JSON.parse(bytes.toString('utf8')), files = validateFreeze(freeze)
  requireCondition(receipt.harnessSha === owner.harnessSha && receipt.caseId === owner.caseId && receipt.runId === owner.runId
    && receipt.runAttempt === Number(owner.runAttempt) && receipt.freezeSha256 === hash(bytes)
    && receipt.combinedSha256 === freeze.combinedSha256 && receipt.fileCount === 16,
  'BLOCKED_INPUT', 'FROZEN_EXECUTION_RECEIPT_MISMATCH')
  for (const item of files) {
    const local = localFrozenBytes(item.path)
    requireCondition(local.length === item.size && hash(local) === item.sha256, 'BLOCKED_INPUT', 'FROZEN_EXECUTION_BYTES_CHANGED')
  }
  return receipt
}
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
    let stdout = '', stderr = '', stderrBytes = 0, timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeout)
    child.stdout.on('data', chunk => {
      if (stdout.length + chunk.length > 512 * 1024) { timedOut = true; child.kill('SIGKILL') }
      else stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderr.length < 32768) stderr += chunk.toString('utf8').slice(0, 32768 - stderr.length) })
    child.on('error', error => {
      clearTimeout(timer)
      const failure = new AcceptanceError('BLOCKED_ENVIRONMENT', 'NATIVE_COMMAND_UNAVAILABLE')
      failure.nativeError = { name: error.name, code: error.code }
      reject(failure)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const diagnostic = safeDiagnostic({ message: stderr, exitCode: code, signal }, 'unknown', 'NATIVE_PROCESS_RESULT')
      if (timedOut) {
        const failure = new AcceptanceError(options.kind || 'BLOCKED_ENVIRONMENT', 'NATIVE_COMMAND_TIMEOUT')
        failure.nativeError = { name: 'TimeoutError', code: diagnostic.errno, exitCode: code, signal }
        reject(failure)
      } else resolve({ code, stdout, stderrBytes, pid: child.pid, signal, diagnostic })
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
    const failure = new AcceptanceError(value.kind || options.kind || 'BLOCKED_ENVIRONMENT',
      /^[A-Z0-9_]+$/.test(value.code || '') ? value.code : 'NATIVE_PLATFORM_FAILED')
    failure.nativeError = { name: result.diagnostic.errorClass, code: result.diagnostic.errno, exitCode: result.code, signal: result.signal,
      location: { file: result.diagnostic.path, line: result.diagnostic.line, column: result.diagnostic.column } }
    throw failure
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
  const stateFile = path.join(root, 'run-state.json')
  if (file === 'acceptance-result.json' && fs.existsSync(stateFile)) value = mergeRunState(value, JSON.parse(fs.readFileSync(stateFile, 'utf8')))
  scanEvidence(value, secrets)
  fs.writeFileSync(path.join(root, 'evidence', file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  if (file === 'acceptance-result.json') fs.writeFileSync(stateFile, JSON.stringify(value), { mode: 0o600 })
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
  checkpoint('cleanup')
  const start = new Date().toISOString()
  let error
  try { await platformCommand('cleanup', [], { timeout: 60000 }) } catch (failure) { error = failure }
  const state = caseState()
  state.value.cleanup = !error
  state.value.cleanupEvidence = { attempts: [...(state.value.cleanupEvidence?.attempts || []), {
    stage: 'cleanup', startedAt: start, endedAt: new Date().toISOString(), cleanupSucceeded: !error,
  }] }
  saveState(state)
  if (error) { recordFailure(error, 'cleanup', 'OWNED_CLEANUP_FAILED'); throw error }
  const file = path.join(root, 'evidence/acceptance-result.json')
  if (fs.existsSync(file)) {
    const result = JSON.parse(fs.readFileSync(file, 'utf8'))
    result.cleanup = true
    writeEvidence('acceptance-result.json', result)
  }
}
export function publishEvidence() {
  const { root, owner } = controlledRoot()
  ensureTerminalOutcome('publish')
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
  } catch (error) {
    // No partial success bundle is uploaded if scanning fails.
    for (const name of copied) {
      const file = path.join(destination, name)
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
    const prior = caseState().value
    const summary = mergeRunState(minimalResult(owner, 'FAIL_CREDENTIAL', 'EVIDENCE_SCAN_FAILED'), prior)
    applyFailure(summary, new AcceptanceError('FAIL_CREDENTIAL', 'EVIDENCE_SCAN_FAILED'), 'publish', 'EVIDENCE_SCAN_FAILED')
    scanEvidence(summary)
    fs.writeFileSync(path.join(destination, 'acceptance-result.json'), JSON.stringify(summary), { flag: 'wx', mode: 0o600 })
    throw new AcceptanceError('FAIL_CREDENTIAL', 'EVIDENCE_SCAN_FAILED')
  }
}
export function ensureTerminalOutcome(stage) {
  const state = caseState().value
  if (!state.diagnostics?.length && !(state.status === 'PASS' && state.complete === true)) {
    return recordFailure(new Error('No terminal evidence'), stage, 'RUNNER_NO_TERMINAL_EVIDENCE')
  }
  return state
}
export default class PrivateReporter {
  // The second argument is an in-memory test seam; Playwright supplies only options.
  constructor(_options = {}, io = { checkpoint, stage: currentStage, fail: recordFailure,
    state: () => caseState().value, output: line => process.stdout.write(line) }) { this.io = io }
  onBegin() { this.io.checkpoint('discovery-or-worker-start') }
  onTestBegin() { this.io.checkpoint('test-start') }
  onError(error) { this.io.fail(error, this.io.stage(), 'RUNNER_ERROR') }
  onTestEnd(_test, result) {
    if (result.status !== 'passed') {
      for (const error of result.errors?.length ? result.errors.slice(0, 3) : [new Error('Test did not pass')]) {
        this.io.fail(error, this.io.stage(), result.status === 'timedOut' ? 'TEST_TIMED_OUT' : 'TEST_FAILED')
      }
    }
  }
  onEnd(result) {
    let state = this.io.state()
    if (!state.diagnostics?.length && (result.status !== 'passed' || state.status !== 'PASS' || !state.complete)) {
      this.io.fail(new Error('Runner did not produce complete passing evidence'), this.io.stage(), 'RUNNER_NO_TERMINAL_EVIDENCE')
      state = this.io.state()
    }
    // Projection only; never log TestResult, attachments, stdout, errors or parameters.
    this.io.output(JSON.stringify({ status: state.status, reasonCode: state.reasonCode,
      stage: state.stage || 'unknown', diagnostics: state.diagnostics || [] }) + '\n')
  }
}
async function runRunner() {
  requireFrozenExecution()
  checkpoint('runner-start')
  try {
    const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
    const result = await command(process.execPath, [cli, 'test'], { timeout: 680000, env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', DEBUG: '', PWDEBUG: '' } })
    if (result.code !== 0) {
      const error = new AcceptanceError('BLOCKED_ENVIRONMENT', 'RUNNER_EXIT_NONZERO')
      error.nativeError = { name: result.diagnostic.errorClass, code: result.diagnostic.errno, exitCode: result.code, signal: result.signal,
        location: { file: result.diagnostic.path, line: result.diagnostic.line, column: result.diagnostic.column } }
      recordFailure(error, currentStage(), 'RUNNER_EXIT_NONZERO')
    }
    const state = ensureTerminalOutcome('runner-end')
    process.stdout.write(JSON.stringify({ status: state.status, reasonCode: state.reasonCode, stage: state.stage,
      diagnostics: state.diagnostics || [] }) + '\n')
    if (result.code !== 0 || state.status !== 'PASS' || !state.complete) process.exitCode = 1
  } catch (error) {
    recordFailure(error, currentStage(), 'RUNNER_START_FAILED')
    throw new AcceptanceError('BLOCKED_ENVIRONMENT', 'RUNNER_START_FAILED')
  }
}

async function cli() {
  const [operation, first, second] = process.argv.slice(2)
  if (operation === 'freeze') {
    const freeze = createFreeze(localFrozenBytes)
    fs.writeFileSync(path.join(repoRoot, FREEZE_RELATIVE), JSON.stringify(freeze, null, 2) + '\n', { flag: 'wx' })
    process.stdout.write('Frozen 16-file combination: ' + freeze.combinedSha256 + '\n')
    return
  }
  if (operation === 'prepare') {
    const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
    requireCondition(commitPattern.test(process.env.GITHUB_SHA || ''), 'BLOCKED_INPUT', 'HARNESS_SHA_MISSING')
    const frozen = await verifyCheckout()
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'manifest_sha256=' + hash(fs.readFileSync(manifestPath)) + '\n')
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'combined_sha256=' + frozen.combinedSha256 + '\n')
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
    // Private progress is not a terminal acceptance artifact.
    checkpoint('case-init')
    fs.appendFileSync(process.env.GITHUB_ENV, 'NA_CASE_ROOT=' + root + '\nNA_PUBLIC_EVIDENCE=' + path.join(root, 'public-evidence') + '\n')
    return
  }
  if (operation === 'verify') {
    checkpoint('freeze-verification')
    try {
      const { root, owner } = controlledRoot()
      const receipt = await verifyCheckout()
      requireCondition(receipt.combinedSha256 === process.env.NA_EXPECTED_COMBINED_SHA256, 'BLOCKED_INPUT', 'PREPARE_FREEZE_MISMATCH')
      fs.writeFileSync(path.join(root, 'freeze-receipt.json'), JSON.stringify({ ...receipt, caseId: owner.caseId,
        runId: owner.runId, runAttempt: Number(owner.runAttempt) }), { flag: 'wx', mode: 0o600 })
    } catch (error) { recordFailure(error, 'freeze-verification', 'FROZEN_CHECKOUT_FAILED'); throw error }
    return
  }
  if (operation === 'fetch') {
    const { root, owner } = controlledRoot()
    try {
      requireFrozenExecution()
      checkpoint('download')
      const require = createRequire(import.meta.url)
      const { main } = require(path.join(repoRoot, '.github/scripts/fetch-upgrade-installers.cjs'))
      const receipt = await main(['--platform', owner.platform, '--arch', owner.arch])
      fs.writeFileSync(path.join(root, 'download-receipt.json'), JSON.stringify(receipt), { flag: 'wx', mode: 0o600 })
      await validatedInputs()
    } catch (error) {
      const code = error.upgradeCode || error.code || 'DOWNLOAD_INPUT_FAILED'
      recordFailure(new AcceptanceError('BLOCKED_INPUT', /^[A-Z0-9_]+$/.test(code) ? code : 'DOWNLOAD_INPUT_FAILED'), 'download', 'DOWNLOAD_INPUT_FAILED')
      throw new AcceptanceError('BLOCKED_INPUT', code)
    }
    return
  }
  if (operation === 'run') return runRunner()
  if (operation === 'cleanup') return cleanup()
  if (operation === 'publish') return publishEvidence()
  if (operation === 'collect' || operation === 'collect-mac') {
    const macOnly = operation === 'collect-mac'
    const expected = new Set(macOnly ? ['macOS-arm64', 'macOS-x64'] : ['windows-x64', 'macOS-arm64', 'macOS-x64']), selected = new Map()
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
    let allPassed = selected.size === expected.size && process.env.NA_NATIVE_RESULT === 'success'
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
          if (name === 'input-manifest.json') {
            requireCondition(value.manifestSha256 === hash(fs.readFileSync(manifestPath)), 'BLOCKED_INPUT', 'COLLECT_ASSET_MANIFEST_MISMATCH')
            const freezeBytes = localFrozenBytes(FREEZE_RELATIVE), freeze = JSON.parse(freezeBytes.toString('utf8'))
            validateFreeze(freeze)
            requireCondition(value.frozenSource?.harnessSha === result.harnessSha && value.frozenSource?.fileCount === 16
              && value.frozenSource?.freezeSha256 === hash(freezeBytes) && value.frozenSource?.combinedSha256 === freeze.combinedSha256,
            'BLOCKED_INPUT', 'COLLECT_FROZEN_SOURCE_MISMATCH')
          }
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
    const message = (macOnly ? 'Mac-only machine evidence ' : 'All-platform machine evidence ')
      + (allPassed ? 'complete' : 'incomplete or failing') + '. Astra review/signoff required.\n'
      + (macOnly ? 'Windows NOT EXECUTED (BLOCKED_F2); all-platform acceptance is NOT complete.\n' : '')
    process.stdout.write(message)
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, message)
    if (!allPassed) process.exitCode = 1
    return
  }
  throw new AcceptanceError('BLOCKED_INPUT', 'UNKNOWN_OPERATION')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => {
    const diagnostic = safeDiagnostic(error, 'unknown', error instanceof AcceptanceError ? error.code : 'HARNESS_COMMAND_FAILED')
    try { if (process.env.NA_CASE_ROOT) recordFailure(error, currentStage(), 'HARNESS_COMMAND_FAILED') } catch { /* Only safe projection below, even if the evidence filesystem is unavailable. */ }
    process.stderr.write(JSON.stringify(diagnostic) + '\n'); process.exitCode = 1
  })
}
