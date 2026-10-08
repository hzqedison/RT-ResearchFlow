import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn, ChildProcess } from 'node:child_process'

export const toolsRoot = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(toolsRoot, '../..')
export const manifestPath = path.join(repoRoot, 'tests/fixtures/releases/native-upgrade-1.0-1.1.json')
export const contract = JSON.parse(fs.readFileSync(path.join(toolsRoot, 'fixtures/version-contract.json'), 'utf8'))
export const FILES = ['input-manifest.json', 'acceptance-result.json', 'network-isolation.json', 'installer-events.json']
export const KINDS = ['BLOCKED_INPUT', 'BLOCKED_ENVIRONMENT', 'FAIL_INSTALL', 'FAIL_DATA', 'FAIL_CREDENTIAL', 'FAIL_LIFECYCLE', 'PASS']
const shaPattern = /^[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{40}$/
export const FROZEN_PATHS = [
  '.github/workflows/mac-launcher-diagnostic.yml',
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
  'network-probe', 'fixture-seed', 'state-read', 'normal-exit', 'cleanup', 'archive', 'publish', 'runner-end', 'unknown', 'tool-preflight', 'tool-diagnostic'])
const ERROR_CLASSES = new Set(['Error', 'TypeError', 'SyntaxError', 'ReferenceError', 'RangeError', 'TimeoutError', 'AssertionError', 'AggregateError'])
const ERRNOS = new Set(['EACCES', 'EPERM', 'ENOENT', 'EEXIST', 'EISDIR', 'ENOTDIR', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET',
  'ENOSPC', 'EADDRINUSE', 'EINVAL', 'EIO', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_REQUIRE_ESM',
  'ERR_INVALID_ARG_TYPE', 'ERR_UNKNOWN_FILE_EXTENSION', 'ERR_DLOPEN_FAILED'])
const SIGNALS = new Set(['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT', 'SIGBUS'])
const SYSCALLS = new Set(['spawn', 'execve', 'posix_spawn', 'connect', 'open', 'access', 'stat', 'lstat', 'read', 'write', 'kill'])
const PROCESS_ROLES = new Set(['test-runner', 'launcher-process', 'wrapper', 'shell', 'sandbox-exec', 'original-executable', 'codesign', 'platform-helper'])
const safeKeys = new Set(('schemaVersion kind harnessSha contractSha256 manifestSha256 caseId runId runAttempt platform arch status reasonCode startedAt endedAt phases assertions cleanup complete sanitization scope products version tag sourceSha basename sha256 size path installers phase launchId pid uidHash exitCode exited launchTime exitTime packaged runtimeName packageName appId appUserModelId exeRelative exePathHash appRelative appPathHash userDataRelative userDataPathHash sessionDataRelative sessionDataPathHash markerMatches sqliteReadonly sqliteModuleInsidePackage settingsSha256 aiSha256 providerSha256 sourceSha256 sourceId migrations cipherSha256 cipherBytes encryptionAvailable decryptMatches rejectsPrevious otherKeysEmpty apiNoPlaintext dbFiles fileClass absent plaintextAbsent name passed installed registrationSha256 installRelative policy policySha256 enabledAt disabledAt controls transport loopback externalDenied denialCode denialEvidence inherited descendantsCovered blockedAttempts credentialRequestObserved requestCount observationCount verification cleanupSucceeded finalized beforeSha256 afterSha256 durationMs events moduleName moduleVersion exceptionCode faultOffset sanitizedInMemory fixtureScan passwordScan forbiddenFieldsScan records').split(' '))

export class AcceptanceError extends Error {
  constructor(kind, code) { super(code); this.kind = kind; this.code = code }
}
export function requireCondition(value, kind, code) { if (!value) throw new AcceptanceError(kind, code) }
export function hash(value) { return createHash('sha256').update(value).digest('hex') }
for (const key of ['stage', 'checkpoints', 'diagnostics', 'errorClass', 'errno', 'signal', 'description', 'role', 'line', 'column',
  'cleanupEvidence', 'attempts', 'time', 'frozenSource', 'freezeSha256', 'combinedSha256', 'fileCount', 'files',
  'syscall', 'errnoNumber', 'processRole', 'targetRole', 'launchDiagnostics', 'processEvents', 'exists', 'executable',
  'mode', 'regularFile', 'codesign', 'debugConnection', 'identityVerified', 'observation', 'probeComplete',
  'attemptId', 'callerRole', 'callerPid', 'writerRole', 'sequence', 'operation', 'processIdentity', 'closeObserved',
  'helperReceipt', 'callerReceipt', 'observedAt', 'cleanupProjection', 'cleanupHistory', 'producerRole', 'observedRole',
  'classification', 'token', 'bufferTruncated', 'timeout', 'stdoutBytes', 'stderrBytes', 'profileSha256', 'wrapperSha256',
  'templateSha256', 'templateMatches', 'tools', 'preconditions', 'environmentPolicy', 'environmentSafe', 'cwdPolicy',
  'diagnosticStatus', 'toolDiagnostic', 'outputComplete', 'requestedSignal']) safeKeys.add(key)

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
  // A spawn syscall often includes an absolute path. Keep only its known verb.
  const syscall = typeof error?.syscall === 'string' ? error.syscall.split(/\s/, 1)[0]
    : raw.match(/\b(spawn|execve|posix_spawn|connect|open|access|stat|lstat|read|write|kill)\b(?=[^\n]{0,512}\b(?:EPERM|EACCES|ENOENT|EINVAL)\b)/)?.[1]
  if (SYSCALLS.has(syscall)) diagnostic.syscall = syscall
  if (Number.isInteger(error?.errno) && error.errno < 0 && error.errno >= -65535) diagnostic.errnoNumber = error.errno
  if (PROCESS_ROLES.has(error?.processRole)) diagnostic.processRole = error.processRole
  if (PROCESS_ROLES.has(error?.targetRole)) diagnostic.targetRole = error.targetRole
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
  for (const secondary of error?.secondaryDiagnostics || []) {
    if (result.diagnostics.length >= 20) break
    result.diagnostics.push({ ...safeDiagnostic({ name: secondary.errorClass, code: secondary.errno,
      errno: secondary.errnoNumber, syscall: secondary.syscall, signal: secondary.signal,
      processRole: secondary.processRole }, stage, 'OWNED_PROCESS_TERMINATION_FAILED'), role: 'secondary' })
  }
  result.complete = false
  return result
}
function caseState() {
  const { root, owner } = controlledRoot()
  const file = path.join(root, 'run-state.json')
  const value = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : minimalResult(owner, 'BLOCKED_ENVIRONMENT', 'RUN_IN_PROGRESS')
  const folded = foldCleanupEvents(readCleanupEvents(root, owner))
  if (folded.attempts.length) { value.cleanupEvidence = folded; value.cleanup = folded.attempts.at(-1).cleanupSucceeded === true }
  return { root, owner, file, value }
}
function saveState(state) {
  scanEvidence(state.value)
  atomicJson(state.file, state.value)
  return state.value
}
export function checkpoint(stage, phase) {
  requireCondition(STAGES.has(stage), 'BLOCKED_INPUT', 'UNKNOWN_CHECKPOINT_STAGE')
  const state = caseState()
  state.value.stage = stage
  state.value.checkpoints = [...(state.value.checkpoints || []), { stage, time: new Date().toISOString(),
    ...(['A', 'B', 'C', 'D'].includes(phase) ? { phase } : {}) }].slice(-128)
  const value = saveState(state)
  if (fs.existsSync(path.join(state.root, 'evidence/acceptance-result.json'))) writeEvidence('acceptance-result.json', value)
  return value
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
    && receipt.combinedSha256 === freeze.combinedSha256 && receipt.fileCount === FROZEN_PATHS.length,
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
  return boundedCommand(executable, args, options)
}
// Both native commands and T1 terminate through this promise, including a
// synchronous kill failure. The extra grace is bounded; no numeric-PID kill.
export async function boundedCommand(executable, args, options = {}, io = { spawn, setTimeout, clearTimeout }) {
  return new Promise((resolve, reject) => {
    let child, primary, timer, grace, done = false, observerBroken = false, stopping = false
    let stdout = '', stderr = '', stdoutBytes = 0, stderrBytes = 0, malformed = false, truncated = false
    let exitCode = null, signal = null, closeObserved = false
    const secondaryDiagnostics = [], decoder = new TextDecoder('utf-8', { fatal: true })
    const t1 = options.capture === 't1', limit = t1 ? 8192 : 512 * 1024
    const role = options.processRole || 'platform-helper'
    const fail = (code, error) => {
      if (!primary) {
        primary = new AcceptanceError(options.kind || 'BLOCKED_ENVIRONMENT', code)
        if (error) primary.nativeError = { name: error.name, code: error.code, errno: error.errno, syscall: error.syscall, processRole: role }
      }
    }
    const event = (observation, fields = {}) => {
      if (observerBroken || !options.onEvent) return
      try { options.onEvent({ observation, processRole: role, time: new Date().toISOString(),
        ...(Number.isInteger(child?.pid) && child.pid > 0 ? { pid: child.pid } : {}), ...fields }) }
      catch (error) { observerBroken = true; fail('PROCESS_EVIDENCE_WRITE_FAILED', error) }
    }
    const finish = () => {
      if (done) return
      done = true; io.clearTimeout(timer); io.clearTimeout(grace)
      try { stderr += decoder.decode() } catch { malformed = true }
      const result = { code: exitCode, signal, pid: child?.pid || null, closeObserved,
        stdout: t1 ? '' : stdout, stdoutBytes, stderrBytes, bufferTruncated: truncated,
        timeout: primary?.code === 'NATIVE_COMMAND_TIMEOUT',
        diagnostic: safeDiagnostic({ message: t1 ? '' : stderr, exitCode, signal, processRole: role }, 'unknown', 'NATIVE_PROCESS_RESULT') }
      if (t1) {
        result.toolOutput = classifyToolStderr(stderr, options.profilePath, options.wrapperPath,
          { malformed, truncated, stdoutBytes, stderrBytes })
        if (primary?.code === 'NATIVE_COMMAND_TIMEOUT' || primary?.code === 'NATIVE_COMMAND_UNAVAILABLE') {
          // An incomplete observation does not invalidate already classified facts.
          // Keep all four facts when full; primary and timeout still describe control failure.
          result.toolOutput.outputComplete = false
          if (result.toolOutput.records.length < 4) result.toolOutput.records.push({
            classification: primary.code === 'NATIVE_COMMAND_TIMEOUT' ? 'TOOL_TIMEOUT' : 'TOOL_SPAWN_ERROR',
            producerRole: 'unknown', observedRole: 'launcher-process' })
        } else if ((exitCode !== 0 || signal) && !result.toolOutput.records.length) {
          result.toolOutput.records = [{ classification: 'UNCLASSIFIED_TOOL_EXIT', producerRole: 'unknown', observedRole: 'launcher-process' }]
          result.toolOutput.outputComplete = false
        }
      }
      // This is a safe projection, not the child object, output, argv or env.
      if (primary) {
        primary.processOutcome = result; primary.secondaryDiagnostics = secondaryDiagnostics
        reject(primary)
      } else resolve(result)
      if (!closeObserved) {
        child?.stdout?.destroy(); child?.stderr?.destroy(); child?.stdin?.destroy(); child?.unref?.()
      }
    }
    const stop = code => {
      fail(code)
      if (stopping || done) return
      stopping = true; io.clearTimeout(timer)
      if (child && child.exitCode == null && child.signalCode == null) {
        event('kill-requested', { requestedSignal: 'SIGKILL' })
        try { child.kill('SIGKILL') }
        catch (error) {
          const diagnostic = safeDiagnostic({ name: error.name, code: error.code, errno: error.errno,
            syscall: error.syscall || 'kill', processRole: role }, 'unknown', 'OWNED_PROCESS_TERMINATION_FAILED')
          secondaryDiagnostics.push(diagnostic); event('kill-error', { diagnostics: [diagnostic] })
        }
      }
      grace = io.setTimeout(finish, options.graceMs ?? 2000)
    }
    event('spawn-requested')
    if (primary) { finish(); return }
    timer = io.setTimeout(() => stop('NATIVE_COMMAND_TIMEOUT'), options.timeout || 30000)
    try {
      child = io.spawn(executable, args, { cwd: options.cwd || toolsRoot, env: options.environment || safeEnvironment(options.env),
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      fail('NATIVE_COMMAND_UNAVAILABLE', error)
      event('spawn-error', { diagnostics: [safeDiagnostic(error, 'unknown', 'TOOL_SPAWN_ERROR')] }); finish(); return
    }
    child.once('spawn', () => { event('spawn-observed'); if (primary) stop(primary.code) })
    child.once('error', error => {
      fail('NATIVE_COMMAND_UNAVAILABLE', error)
      event('spawn-error', { diagnostics: [safeDiagnostic(error, 'unknown', 'TOOL_SPAWN_ERROR')] })
      if (!stopping) { stopping = true; io.clearTimeout(timer); grace = io.setTimeout(finish, options.graceMs ?? 2000) }
    })
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length
      if (stdoutBytes > limit) { truncated = true; stop('NATIVE_OUTPUT_LIMIT'); return }
      if (!t1) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length
      if (stderrBytes > (t1 ? 8192 : 32768)) { truncated = true; stop('NATIVE_OUTPUT_LIMIT'); return }
      if (!malformed) try { stderr += decoder.decode(chunk, { stream: true }) } catch { malformed = true }
    })
    child.once('exit', (code, endedSignal) => {
      exitCode = Number.isInteger(code) ? code : null; signal = SIGNALS.has(endedSignal) ? endedSignal : null
      event('exit-observed', { exitCode, signal }); if (primary && !stopping) stop(primary.code)
    })
    child.once('close', (code, endedSignal) => {
      closeObserved = true; exitCode = Number.isInteger(code) ? code : null; signal = SIGNALS.has(endedSignal) ? endedSignal : null
      event('close-observed', { exitCode, signal }); finish()
    })
    child.stdin.on('error', () => {})
    child.stdin.end(options.input || '')
  })
}

const PROFILE_LINES = ['(version 1)', '(allow default)', '(deny network-outbound)',
  '(allow network-outbound (remote ip "127.0.0.1:*"))', '(allow network-outbound (remote ip "[::1]:*"))',
  '(allow network-outbound (remote unix-socket))']
const PROFILE_TOKENS = new Set(['version', 'allow', 'deny', 'default', 'network-outbound', 'remote', 'ip', 'unix-socket', '127.0.0.1:*', '[::1]:*'])
export function classifyToolStderr(stderr, profilePath, wrapperPath, bounds = {}) {
  const unknown = () => ({ outputComplete: false, records: [{ classification: 'UNCLASSIFIED_TOOL_EXIT', producerRole: 'unknown', observedRole: 'launcher-process' }] })
  if (bounds.malformed || bounds.truncated || Buffer.byteLength(stderr) > 8192 || /[^\x09\x0a\x20-\x7e]/.test(stderr)) return unknown()
  if (!stderr) return { outputComplete: true, records: [] }
  const lines = stderr.endsWith('\n') ? stderr.slice(0, -1).split('\n') : stderr.split('\n')
  if (lines.length > 4 || lines.some(line => !line || Buffer.byteLength(line) > 1024)) return unknown()
  const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const records = []
  for (const line of lines) {
    let record
    const compiler = line.match(new RegExp('^sandbox-exec: ' + escape(profilePath) + ':(\\d+):(\\d+): (syntax error|unbound variable|invalid IP address)(?: \'([^\']+)\')?$'))
    if (compiler) {
      const row = Number(compiler[1]), column = Number(compiler[2]), token = compiler[4]
      if (row < 1 || row > 6 || column < 1 || column > PROFILE_LINES[row - 1].length) return unknown()
      record = { classification: { 'syntax error': 'SBPL_PARSE_ERROR', 'unbound variable': 'SBPL_SYMBOL_ERROR', 'invalid IP address': 'SBPL_ADDRESS_ERROR' }[compiler[3]],
        producerRole: 'sandbox-exec', observedRole: 'launcher-process', targetRole: 'sandbox-profile', line: row, column }
      if (token) record.token = PROFILE_TOKENS.has(token) && PROFILE_LINES[row - 1].includes(token) ? token : 'unknown'
    } else if (line === 'sandbox-exec: sandbox_apply: Operation not permitted' || line === 'sandbox-exec: sandbox_apply: Permission denied') {
      record = { classification: 'SANDBOX_APPLY_ERROR', producerRole: 'sandbox-exec', observedRole: 'launcher-process', errno: line.endsWith('Operation not permitted') ? 'EPERM' : 'EACCES' }
    } else if (/^sandbox-exec: execvp\(\): (No such file or directory|Permission denied|Operation not permitted)$/.test(line)) {
      record = { classification: 'TARGET_EXEC_ERROR', producerRole: 'sandbox-exec', observedRole: 'launcher-process',
        errno: line.endsWith('No such file or directory') ? 'ENOENT' : line.endsWith('Permission denied') ? 'EACCES' : 'EPERM' }
    } else if (line === 'sandbox-exec: ' + profilePath + ': No such file or directory') {
      record = { classification: 'PROFILE_READ_ERROR', producerRole: 'sandbox-exec', observedRole: 'launcher-process', targetRole: 'sandbox-profile', errno: 'ENOENT' }
    } else if (line === wrapperPath + ': line 2: syntax error near unexpected token `exec\'') {
      record = { classification: 'SHELL_SYNTAX_ERROR', producerRole: 'shell', observedRole: 'launcher-process' }
    } else if (line === 'usage: sandbox-exec [options] command [arguments ...]') {
      record = { classification: 'TOOL_USAGE_ERROR', producerRole: 'sandbox-exec', observedRole: 'launcher-process' }
    } else return unknown()
    records.push(record)
  }
  if (new Set(records.map(item => item.classification)).size > 1) return unknown()
  return { outputComplete: true, records }
}

export function validateToolEnvironment(environment) {
  const forbidden = /^(?:BASH_ENV|ENV|SHELLOPTS|BASHOPTS|CDPATH|GLOBIGNORE|PROMPT_COMMAND|NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|LD_.*|DYLD_.*|BASH_FUNC_.*)$/
  requireCondition(!Object.entries(environment).some(([name, value]) => forbidden.test(name) && value), 'BLOCKED_ENVIRONMENT', 'TOOL_ENVIRONMENT_INJECTION')
  return { environmentPolicy: 'safeEnvironment-v1-no-shell-or-loader-injection', environmentSafe: true, cwdPolicy: 'frozen-harness-tools-root' }
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
    const diagnostic = value.diagnostic ? safeDiagnostic({ name: value.diagnostic.errorClass, code: value.diagnostic.errno,
      errno: value.diagnostic.errnoNumber, syscall: value.diagnostic.syscall, targetRole: value.diagnostic.targetRole }, 'unknown', 'NATIVE_PLATFORM_FAILED') : result.diagnostic
    failure.nativeError = { name: diagnostic.errorClass, code: diagnostic.errno, errno: diagnostic.errnoNumber,
      syscall: diagnostic.syscall, targetRole: diagnostic.targetRole, processRole: 'platform-helper', exitCode: result.code, signal: result.signal,
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
  const folded = foldOwnedCleanup()
  if (folded.attempts.length) {
    if (file === 'acceptance-result.json') value = { ...value, cleanupEvidence: folded, cleanup: folded.attempts.at(-1).cleanupSucceeded === true }
    if (file === 'network-isolation.json') value = networkCleanupProjection(value, folded)
  }
  scanEvidence(value, secrets)
  atomicJson(path.join(root, 'evidence', file), value, secrets)
  if (file === 'acceptance-result.json') atomicJson(stateFile, value, secrets)
}
// Scan before touching disk. Readers see the old complete JSON or the new one,
// never a truncated document. Only this call's exclusive temporary file is removed.
export function atomicJson(file, value, secrets = [], io = fs) {
  scanEvidence(value, secrets)
  const bytes = JSON.stringify(value, null, 2) + '\n'
  const temporary = file + '.' + randomUUID() + '.partial'
  let descriptor, owned = false
  try {
    descriptor = io.openSync(temporary, 'wx', 0o600); owned = true
    io.writeFileSync(descriptor, bytes); io.fsyncSync(descriptor)
    io.closeSync(descriptor); descriptor = undefined
    io.renameSync(temporary, file); owned = false
  } finally {
    if (descriptor !== undefined) io.closeSync(descriptor)
    if (owned) io.unlinkSync(temporary)
  }
}

// Read-only checks, never a product probe. Tests inject all OS operations.
export async function inspectMacLaunch(root, emit, io = {
  stat: file => fs.statSync(file), access: file => fs.accessSync(file, fs.constants.X_OK), hashFile, command,
}) {
  const records = []
  for (const [targetRole, file] of [
    ['wrapper', path.join(root, 'launch-app.sh')], ['shell', '/bin/bash'], ['sandbox-exec', '/usr/bin/sandbox-exec'],
    ['original-executable', path.join(root, 'install/RT-ResearchFlow.app/Contents/MacOS/RT-ResearchFlow')],
  ]) {
    const record = { targetRole, exists: null, regularFile: null, executable: null, mode: null, sha256: null,
      time: new Date().toISOString(), diagnostics: [] }
    try {
      const stat = io.stat(file)
      record.exists = true; record.regularFile = stat.isFile(); record.mode = stat.mode & 0o777
      try { io.access(file); record.executable = true } catch (error) {
        record.executable = false; record.diagnostics.push(safeDiagnostic({ ...error, name: error.name, targetRole }, 'app-launch', 'LAUNCH_EXEC_ACCESS_FAILED'))
      }
      if (record.regularFile) record.sha256 = await io.hashFile(file)
    } catch (error) {
      if (error.code === 'ENOENT') record.exists = false
      record.diagnostics.push(safeDiagnostic({ name: error.name, code: error.code, errno: error.errno, syscall: error.syscall, targetRole }, 'app-launch', 'LAUNCH_FILE_INSPECTION_UNAVAILABLE'))
    }
    records.push(record); emit({ records: structuredClone(records), codesign: null })
  }
  let codesign
  try {
    const result = await io.command('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(root, 'install/RT-ResearchFlow.app')], { timeout: 30000 })
    codesign = { exitCode: result.code, signal: result.signal || null, processRole: 'codesign',
      diagnostics: result.code === 0 ? [] : [safeDiagnostic({ ...result.diagnostic, name: result.diagnostic?.errorClass,
        code: result.diagnostic?.errno, exitCode: result.code, signal: result.signal, processRole: 'codesign' }, 'app-launch', 'CODESIGN_INSPECTION_NONZERO')] }
  } catch (error) {
    codesign = { exitCode: null, signal: null, processRole: 'codesign', diagnostics: [safeDiagnostic(error, 'app-launch', 'CODESIGN_INSPECTION_UNAVAILABLE')] }
  }
  emit({ records, codesign })
}

// Observe the ONE existing Playwright launch, including failure before it returns
// an ElectronApplication. No argv/env/stderr is retained. Matching uses the exact
// owned wrapper path; the original spawn receiver/options/result are untouched.
export async function observeMacLaunch(launcher, emit, operation, prototype = ChildProcess.prototype) {
  const original = prototype.spawn
  let observationFailure
  const publish = value => { try { emit(value) } catch (error) { observationFailure ||= error } }
  function observed(options) {
    if (options.file !== launcher) return Reflect.apply(original, this, arguments)
    const child = this
    const event = (observation, extra = {}) => publish({ observation, processRole: 'launcher-process',
      time: new Date().toISOString(), ...(Number.isInteger(child.pid) && child.pid > 0 ? { pid: child.pid } : {}), ...extra })
    event('spawn-requested')
    child.once('spawn', () => event('spawn-observed'))
    child.once('error', error => event('spawn-error', { diagnostics: [safeDiagnostic({ name: error.name, code: error.code,
      errno: error.errno, syscall: error.syscall, targetRole: 'wrapper', processRole: 'launcher-process' }, 'app-launch', 'LAUNCH_PROCESS_ERROR')] }))
    child.once('exit', (exitCode, signal) => event('exit-observed', {
      ...(Number.isInteger(exitCode) ? { exitCode } : {}), ...(SIGNALS.has(signal) ? { signal } : {}),
    }))
    try { return Reflect.apply(original, child, arguments) }
    catch (error) {
      event('spawn-threw', { diagnostics: [safeDiagnostic({ name: error.name, code: error.code, errno: error.errno,
        syscall: error.syscall, targetRole: 'wrapper', processRole: 'launcher-process' }, 'app-launch', 'LAUNCH_PROCESS_ERROR')] })
      throw error
    }
  }
  prototype.spawn = observed
  try {
    const result = await operation()
    if (observationFailure) throw observationFailure
    return result
  } finally { if (prototype.spawn === observed) prototype.spawn = original }
}
export function minimalResult(owner, kind, code) {
  return { schemaVersion: 1, kind: 'acceptance-result', harnessSha: owner.harnessSha,
    caseId: owner.caseId, runId: owner.runId, runAttempt: Number(owner.runAttempt), platform: owner.platform, arch: owner.arch,
    status: kind, reasonCode: code, phases: [], assertions: [], cleanup: false, complete: false,
    scope: 'machine-evidence-only; Astra signoff required', sanitizedInMemory: true }
}
const CLEANUP_ROLES = new Set(['test-finally', 'workflow-cleanup'])
const CLEANUP_OPERATIONS = ['owned-process-cleanup', 'mount-detach', 'keychain-default-restore', 'keychain-search-restore', 'keychain-delete']
const CLEANUP_EVENTS = new Set(['caller-entered', 'caller-identity', 'helper-spawn-requested', 'helper-spawned', 'spawn-error',
  'helper-entered', 'helper-identity', 'operation-started', 'operation-ended', 'helper-finished', 'helper-exit-observed',
  'helper-close-observed', 'caller-observed-result', 'caller-returned-incomplete', 'termination-error'])
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
function journalDirectory(root) {
  const directory = path.join(root, 'cleanup-journal')
  try { fs.mkdirSync(directory, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  requireCondition(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'BLOCKED_ENVIRONMENT', 'CLEANUP_JOURNAL_NOT_OWNED')
  return directory
}
export function exclusiveJson(file, value) {
  scanEvidence(value)
  const temporary = file + '.' + randomUUID() + '.partial'
  let fd, owned = false
  try {
    fd = fs.openSync(temporary, 'wx', 0o600); owned = true
    fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined
    // link is an atomic, no-replace publication of the complete event.
    fs.linkSync(temporary, file)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    if (owned) fs.unlinkSync(temporary)
  }
}
export function appendCleanupEvent(context, observation, fields = {}) {
  requireCondition(CLEANUP_EVENTS.has(observation) && uuidPattern.test(context.attemptId)
    && CLEANUP_ROLES.has(context.callerRole) && ['caller', 'helper'].includes(context.writerRole), 'BLOCKED_INPUT', 'CLEANUP_EVENT_INVALID')
  if (fields.operation) requireCondition(CLEANUP_OPERATIONS.includes(fields.operation), 'BLOCKED_INPUT', 'CLEANUP_OPERATION_INVALID')
  const event = { schemaVersion: 1, kind: 'cleanup-event', attemptId: context.attemptId, callerRole: context.callerRole,
    writerRole: context.writerRole, sequence: context.sequence++, observation, time: new Date().toISOString(),
    caseId: context.owner.caseId, harnessSha: context.owner.harnessSha, runId: context.owner.runId,
    runAttempt: Number(context.owner.runAttempt), ...fields }
  exclusiveJson(path.join(journalDirectory(context.root), context.attemptId + '.' + context.writerRole + '.' + event.sequence + '.json'), event)
  return event
}
export function beginCleanup(callerRole, owned = controlledRoot()) {
  requireCondition(CLEANUP_ROLES.has(callerRole), 'BLOCKED_INPUT', 'CLEANUP_CALLER_ROLE_REQUIRED')
  const context = { ...owned, callerRole, attemptId: randomUUID(), writerRole: 'caller', sequence: 0 }
  // No await or platform operation precedes this durable intent.
  appendCleanupEvent(context, 'caller-entered', { callerPid: process.pid, status: 'started', cleanupSucceeded: null })
  return context
}
export function readCleanupEvents(root, owner) {
  const directory = path.join(root, 'cleanup-journal')
  if (!fs.existsSync(directory)) return []
  requireCondition(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'BLOCKED_ENVIRONMENT', 'CLEANUP_JOURNAL_NOT_OWNED')
  const events = []
  for (const name of fs.readdirSync(directory)) {
    if (!/^[a-f0-9-]{36}\.(?:caller|helper)\.\d+\.json$/.test(name)) continue
    const file = path.join(directory, name)
    requireCondition(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).size <= 8192, 'BLOCKED_INPUT', 'CLEANUP_EVENT_BYTES_INVALID')
    const event = JSON.parse(fs.readFileSync(file, 'utf8')); scanEvidence(event)
    requireCondition(event.caseId === owner.caseId && event.harnessSha === owner.harnessSha && event.runId === owner.runId
      && event.runAttempt === Number(owner.runAttempt) && CLEANUP_EVENTS.has(event.observation)
      && name === event.attemptId + '.' + event.writerRole + '.' + event.sequence + '.json', 'BLOCKED_INPUT', 'CLEANUP_EVENT_IDENTITY_INVALID')
    events.push(event)
  }
  return events.sort((a, b) => a.time.localeCompare(b.time) || a.writerRole.localeCompare(b.writerRole) || a.sequence - b.sequence)
}
export function foldCleanupEvents(events) {
  const attempts = []
  for (const entry of events.filter(event => event.observation === 'caller-entered')) {
    const records = events.filter(event => event.attemptId === entry.attemptId)
    const helper = records.find(event => event.observation === 'helper-finished')
    const caller = records.find(event => event.observation === 'caller-observed-result')
    const failure = records.find(event => event.observation === 'caller-returned-incomplete')
    attempts.push({ attemptId: entry.attemptId, callerRole: entry.callerRole, callerPid: entry.callerPid, startedAt: entry.time,
      status: caller ? (caller.cleanupSucceeded ? 'succeeded' : 'failed') : 'incomplete',
      cleanupSucceeded: caller ? caller.cleanupSucceeded : null, complete: !!caller,
      helperReceipt: helper ? { cleanupSucceeded: helper.cleanupSucceeded, observedAt: helper.time } : null,
      callerReceipt: caller ? { cleanupSucceeded: caller.cleanupSucceeded, observedAt: caller.time } : null,
      ...(caller || failure ? { endedAt: (caller || failure).time } : {}), events: records })
  }
  return { attempts }
}
export async function macProcessIdentity(pid, invoke = command) {
  requireCondition(Number.isInteger(pid) && pid > 0, 'BLOCKED_ENVIRONMENT', 'CLEANUP_PID_INVALID')
  const result = await invoke('/bin/ps', ['-p', String(pid), '-o', 'pid=,uid=,lstart=,comm='], { timeout: 2000, env: { LC_ALL: 'C' } })
  if (result.code === 1 && result.stdout.trim() === '' && result.stderrBytes === 0 && result.closeObserved === true) return { pid, status: 'absent' }
  const match = result.stdout.trim().match(/^(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+([^\r\n]+)$/)
  requireCondition(result.code === 0 && result.stderrBytes === 0 && result.closeObserved === true && match && Number(match[1]) === pid, 'BLOCKED_ENVIRONMENT', 'CLEANUP_PROCESS_IDENTITY_UNAVAILABLE')
  return { pid, processIdentity: hash(JSON.stringify([pid, match[2], match[3], match[4]])), status: 'present' }
}
export async function acquireCleanupLease(context, identity = macProcessIdentity) {
  const directory = journalDirectory(context.root), lock = path.join(directory, 'active.json'), recovery = path.join(directory, 'recovery.json')
  const caller = await identity(process.pid)
  requireCondition(caller.status === 'present' && shaPattern.test(caller.processIdentity), 'BLOCKED_ENVIRONMENT', 'CLEANUP_CALLER_IDENTITY_UNAVAILABLE')
  appendCleanupEvent(context, 'caller-identity', { pid: caller.pid, processIdentity: caller.processIdentity })
  const claim = () => exclusiveJson(lock, { attemptId: context.attemptId })
  requireCondition(!fs.existsSync(recovery), 'BLOCKED_ENVIRONMENT', 'CLEANUP_LEASE_RECOVERY_INCOMPLETE')
  try { claim(); return } catch (error) { if (error.code !== 'EEXIST') throw error }
  // A separate exclusive recovery gate prevents two new callers from removing
  // each other's lock. An interrupted recovery is blocked, never stolen by age.
  exclusiveJson(recovery, { attemptId: context.attemptId })
  try {
    requireCondition(fs.lstatSync(lock).isFile() && !fs.lstatSync(lock).isSymbolicLink(), 'BLOCKED_ENVIRONMENT', 'CLEANUP_LOCK_INVALID')
    const previous = JSON.parse(fs.readFileSync(lock, 'utf8'))
    const events = readCleanupEvents(context.root, context.owner).filter(item => item.attemptId === previous.attemptId)
    requireCondition(!cleanupResourcesUncertain(events), 'BLOCKED_ENVIRONMENT', 'CLEANUP_RESOURCE_IDENTITY_UNKNOWN')
    const callerIdentity = events.find(item => item.observation === 'caller-identity')
    const helperRequested = events.some(item => item.observation === 'helper-spawn-requested')
    const helperIdentity = events.find(item => item.observation === 'helper-identity')
    requireCondition(callerIdentity && (!helperRequested || helperIdentity), 'BLOCKED_ENVIRONMENT', 'CLEANUP_PREVIOUS_IDENTITY_UNKNOWN')
    for (const known of [callerIdentity, helperIdentity].filter(Boolean)) {
      const current = await identity(known.pid)
      // A reused PID or changed identity is uncertainty, not proof of old exit.
      requireCondition(current.status === 'absent', 'BLOCKED_ENVIRONMENT', current.processIdentity === known.processIdentity ? 'CLEANUP_PREVIOUS_PROCESS_ALIVE' : 'CLEANUP_PREVIOUS_IDENTITY_UNKNOWN')
    }
    requireCondition(JSON.parse(fs.readFileSync(lock, 'utf8')).attemptId === previous.attemptId, 'BLOCKED_ENVIRONMENT', 'CLEANUP_LOCK_CHANGED')
    fs.unlinkSync(lock); claim()
  } finally { fs.unlinkSync(recovery) }
}
function releaseCleanupLease(context) {
  const lock = path.join(context.root, 'cleanup-journal/active.json')
  requireCondition(JSON.parse(fs.readFileSync(lock, 'utf8')).attemptId === context.attemptId, 'BLOCKED_ENVIRONMENT', 'CLEANUP_LOCK_CHANGED')
  fs.unlinkSync(lock)
}
export async function enterCleanupHelper(attemptId, callerRole, owned = controlledRoot(), identity = macProcessIdentity) {
  const entries = readCleanupEvents(owned.root, owned.owner)
  requireCondition(uuidPattern.test(attemptId) && CLEANUP_ROLES.has(callerRole)
    && entries.some(item => item.attemptId === attemptId && item.observation === 'caller-entered' && item.callerRole === callerRole)
    && JSON.parse(fs.readFileSync(path.join(owned.root, 'cleanup-journal/active.json'), 'utf8')).attemptId === attemptId,
  'BLOCKED_ENVIRONMENT', 'CLEANUP_HELPER_NOT_AUTHORIZED')
  const context = { ...owned, attemptId, callerRole, writerRole: 'helper', sequence: 0 }
  appendCleanupEvent(context, 'helper-entered', { pid: process.pid, status: 'started' })
  const current = await identity(process.pid)
  requireCondition(current.status === 'present' && shaPattern.test(current.processIdentity), 'BLOCKED_ENVIRONMENT', 'CLEANUP_HELPER_IDENTITY_UNAVAILABLE')
  appendCleanupEvent(context, 'helper-identity', { pid: current.pid, processIdentity: current.processIdentity })
  return context
}
export async function cleanupOperations(context, operations) {
  requireCondition(operations.length === CLEANUP_OPERATIONS.length && operations.every((item, index) => item.operation === CLEANUP_OPERATIONS[index]), 'BLOCKED_INPUT', 'CLEANUP_OPERATION_SET_INVALID')
  let primary
  for (const operation of operations) {
    if (!operation.needed) {
      appendCleanupEvent(context, 'operation-ended', { operation: operation.operation, status: 'not-needed' }); continue
    }
    appendCleanupEvent(context, 'operation-started', { operation: operation.operation, status: 'started' })
    try {
      await operation.run()
      appendCleanupEvent(context, 'operation-ended', { operation: operation.operation, status: 'succeeded' })
    } catch (error) {
      primary ||= error
      const uncertain = error.processOutcome?.closeObserved === false
      appendCleanupEvent(context, 'operation-ended', { operation: operation.operation, status: uncertain ? 'incomplete' : 'failed',
        diagnostics: [safeDiagnostic(error, 'cleanup', 'CLEANUP_RESOURCE_FAILED'), ...(error.secondaryDiagnostics || []).map(item =>
          safeDiagnostic({ name: item.errorClass, code: item.errno, errno: item.errnoNumber, syscall: item.syscall }, 'cleanup', 'OWNED_PROCESS_TERMINATION_FAILED'))] })
      if (uncertain) {
        appendCleanupEvent(context, 'helper-finished', { status: 'incomplete', cleanupSucceeded: null })
        throw primary
      }
    }
  }
  appendCleanupEvent(context, 'helper-finished', { status: primary ? 'failed' : 'succeeded', cleanupSucceeded: !primary })
  if (primary) throw primary
  return { ok: true, attemptId: context.attemptId, cleanupSucceeded: true }
}
function cleanupResourcesUncertain(events) {
  return events.some(item => item.observation === 'operation-ended' && item.status === 'incomplete')
    || events.some(item => item.observation === 'operation-started'
      && !events.some(end => end.observation === 'operation-ended' && end.operation === item.operation))
}
function foldOwnedCleanup() {
  const { root, owner } = controlledRoot()
  return foldCleanupEvents(readCleanupEvents(root, owner))
}
function projectCleanup(root, owner) {
  const folded = foldCleanupEvents(readCleanupEvents(root, owner)), latest = folded.attempts.at(-1)
  if (!latest) return folded
  const file = path.join(root, 'evidence/network-isolation.json')
  if (fs.existsSync(file)) {
    atomicJson(file, networkCleanupProjection(JSON.parse(fs.readFileSync(file, 'utf8')), folded))
  }
  return folded
}
export function networkCleanupProjection(network, folded) {
  const observedAt = new Date().toISOString()
  const history = folded.attempts.map(attempt => ({ attemptId: attempt.attemptId, callerRole: attempt.callerRole,
    observedAt, complete: attempt.complete, cleanupSucceeded: attempt.cleanupSucceeded }))
  if (!history.length) return network
  const latest = folded.attempts.at(-1)
  return { ...network, cleanupHistory: history, cleanupProjection: history.at(-1), cleanupSucceeded: latest.cleanupSucceeded,
    ...(latest.cleanupSucceeded === true ? { disabledAt: latest.callerReceipt.observedAt } : {}) }
}
export async function cleanup(callerRole) {
  const owned = controlledRoot(), { root, owner } = owned
  const context = beginCleanup(callerRole, owned)
  checkpoint('cleanup')
  let primary, lease = false, closed = false
  try {
    if (owner.platform === 'macOS') { await acquireCleanupLease(context); lease = true }
    const onEvent = event => {
      const names = { 'spawn-requested': 'helper-spawn-requested', 'spawn-observed': 'helper-spawned', 'spawn-error': 'spawn-error',
        'exit-observed': 'helper-exit-observed', 'close-observed': 'helper-close-observed', 'kill-error': 'termination-error' }
      if (names[event.observation]) {
        const { observation, ...fields } = event
        appendCleanupEvent(context, names[observation], fields)
        if (observation === 'close-observed') closed = true
      }
    }
    const args = owner.platform === 'macOS' ? [context.attemptId, callerRole] : []
    const result = await platformCommand('cleanup', args, { timeout: 60000, onEvent })
    if (owner.platform === 'macOS') requireCondition(result.attemptId === context.attemptId, 'BLOCKED_ENVIRONMENT', 'CLEANUP_RECEIPT_MISMATCH')
    appendCleanupEvent(context, 'caller-observed-result', { status: 'succeeded', cleanupSucceeded: true })
  } catch (error) {
    primary = error
    const helper = readCleanupEvents(root, owner).find(item => item.attemptId === context.attemptId && item.observation === 'helper-finished')
    const confirmed = closed && helper && typeof helper.cleanupSucceeded === 'boolean'
    appendCleanupEvent(context, confirmed ? 'caller-observed-result' : 'caller-returned-incomplete', {
      status: confirmed ? 'failed' : 'incomplete', cleanupSucceeded: confirmed ? false : null,
      diagnostics: [safeDiagnostic(error, 'cleanup', 'OWNED_CLEANUP_FAILED')] })
  } finally {
    if (lease && closed && !cleanupResourcesUncertain(readCleanupEvents(root, owner).filter(item => item.attemptId === context.attemptId))) releaseCleanupLease(context)
    const folded = projectCleanup(root, owner), state = caseState()
    state.value.cleanupEvidence = folded; state.value.cleanup = folded.attempts.at(-1)?.cleanupSucceeded === true
    saveState(state)
    if (primary) recordFailure(primary, 'cleanup', 'OWNED_CLEANUP_FAILED')
    else writeEvidence('acceptance-result.json', state.value)
  }
  if (primary) throw primary
}
export function publishEvidence() {
  const { root, owner } = controlledRoot()
  projectCleanup(root, owner)
  writeEvidence('acceptance-result.json', ensureTerminalOutcome('publish'))
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
  if (state.mode === 'mac-launcher-T1' && ['TOOL_CHAIN_PASS', 'BLOCKED', 'FAILED'].includes(state.toolDiagnostic?.diagnosticStatus)) return state
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
      error.nativeError = { name: result.diagnostic.errorClass, code: result.diagnostic.errno, exitCode: result.code, signal: result.signal, processRole: 'test-runner',
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

export const T1_BRANCH = 'refs/heads/codex/diagnose-mac-launcher-1.0'
export function assertT1Trigger(environment = process.env) {
  requireCondition(environment.CI === 'true' && environment.GITHUB_ACTIONS === 'true'
    && environment.RUNNER_ENVIRONMENT === 'github-hosted' && environment.GITHUB_REPOSITORY === 'hzqedison/RT-ResearchFlow'
    && environment.GITHUB_REF === T1_BRANCH && environment.GITHUB_EVENT_NAME === 'push' && environment.NA_T1_DELETED === 'false'
    && environment.GITHUB_RUN_ATTEMPT === '1' && commitPattern.test(environment.GITHUB_SHA || '')
    && /^\d+$/.test(environment.GITHUB_RUN_ID || ''), 'BLOCKED_ENVIRONMENT', 'T1_TRIGGER_NOT_AUTHORIZED')
}
function t1Root() {
  assertT1Trigger()
  const owned = controlledRoot()
  requireCondition(owned.owner.platform === 'macOS' && owned.owner.mode === 'mac-launcher-T1'
    && process.versions.node.startsWith('20.'), 'BLOCKED_ENVIRONMENT', 'T1_NATIVE_NODE20_CASE_REQUIRED')
  return owned
}
export function toolChainOutcome(result, error) {
  if (error || result?.timeout || result?.bufferTruncated || !result?.closeObserved) return 'BLOCKED'
  if (result.code === 0 && result.signal === null && result.stdoutBytes === 0 && result.stderrBytes === 0
    && result.toolOutput?.outputComplete) return 'TOOL_CHAIN_PASS'
  return result.toolOutput?.outputComplete && result.toolOutput.records.length ? 'FAILED' : 'BLOCKED'
}
export async function runT1() {
  const { root, owner } = t1Root()
  const frozenSource = requireFrozenExecution()
  exclusiveJson(path.join(fs.realpathSync(process.env.RUNNER_TEMP), 'rt-mac-launcher-T1-' + owner.runId + '-' + owner.harnessSha + '-' + owner.arch + '.json'),
    { caseId: owner.caseId, runId: owner.runId, runAttempt: 1, harnessSha: owner.harnessSha, arch: owner.arch })
  exclusiveJson(path.join(root, 't1-once.json'), { caseId: owner.caseId, runId: owner.runId, runAttempt: 1, harnessSha: owner.harnessSha })
  const envelope = (kind, fields) => ({ schemaVersion: 1, kind, harnessSha: owner.harnessSha, caseId: owner.caseId,
    runId: owner.runId, runAttempt: 1, platform: owner.platform, arch: owner.arch, mode: 'mac-launcher-T1', ...fields, sanitizedInMemory: true })
  const diagnostic = { diagnosticStatus: 'BLOCKED', events: [], tools: [], preconditions: {}, records: [],
    bufferTruncated: false, timeout: false, closeObserved: false,
    scope: 'T1-tool-only; product NOT_EXECUTED; Windows NOT_EXECUTED; system-true; empty arguments; no inspector, network proof or Keychain' }
  const result = { ...minimalResult(owner, 'BLOCKED_ENVIRONMENT', 'T1_IN_PROGRESS'), mode: 'mac-launcher-T1', toolDiagnostic: diagnostic }
  const persist = () => writeEvidence('acceptance-result.json', result)
  checkpoint('tool-preflight'); persist()
  let failure
  try {
    diagnostic.preconditions = validateToolEnvironment(process.env); persist()
    const { renderMacMaterials, validateMacMaterials } = await import('./platform/macos.mjs')
    const materials = renderMacMaterials(root, 'system-true')
    validateMacMaterials(root, 'system-true', materials.profile, materials.wrapper)
    const profilePath = path.join(root, 'network.sb'), wrapperPath = path.join(root, 'launch-true.sh')
    fs.writeFileSync(profilePath, materials.profile, { flag: 'wx', mode: 0o600 })
    fs.writeFileSync(wrapperPath, materials.wrapper, { flag: 'wx', mode: 0o700 })
    for (const [file, mode] of [[profilePath, 0o600], [wrapperPath, 0o700]]) {
      const stat = fs.lstatSync(file)
      requireCondition(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === mode, 'BLOCKED_INPUT', 'T1_MATERIAL_FILE_INVALID')
    }
    const materialReceipt = validateMacMaterials(root, 'system-true', fs.readFileSync(profilePath), fs.readFileSync(wrapperPath))
    Object.assign(diagnostic, materialReceipt); persist()
    writeEvidence('input-manifest.json', envelope('input-manifest', { frozenSource, ...materialReceipt, installers: [] }))
    writeEvidence('installer-events.json', envelope('installer-events', { events: [], scope: 'T1-does-not-download-or-install' }))
    writeEvidence('network-isolation.json', envelope('network-isolation', { controls: [], records: [], inherited: false,
      descendantsCovered: false, probeComplete: false, cleanupSucceeded: null, scope: 'T1-does-not-probe-network; true-is-not-network-proof' }))
    for (const [targetRole, file] of [['shell', '/bin/bash'], ['sandbox-exec', '/usr/bin/sandbox-exec'], ['system-true', '/usr/bin/true']]) {
      const record = { targetRole, exists: null, regularFile: null, executable: null, mode: null, sha256: null, diagnostics: [] }
      diagnostic.tools.push(record)
      try {
        const stat = fs.lstatSync(file); record.exists = true; record.regularFile = stat.isFile() && !stat.isSymbolicLink(); record.mode = stat.mode & 0o777
        requireCondition(record.regularFile, 'BLOCKED_ENVIRONMENT', 'T1_SYSTEM_TOOL_NOT_REGULAR')
        fs.accessSync(file, fs.constants.X_OK); record.executable = true; record.sha256 = await hashFile(file)
      } catch (error) {
        if (error.code === 'ENOENT') record.exists = false
        record.diagnostics.push(safeDiagnostic(error, 'tool-preflight', 'T1_SYSTEM_TOOL_UNAVAILABLE')); persist(); throw error
      }
      persist()
    }
    checkpoint('tool-diagnostic'); persist()
    let observed, commandFailure
    try {
      observed = await boundedCommand(wrapperPath, [], { capture: 't1', profilePath, wrapperPath, timeout: 5000, graceMs: 2000,
        processRole: 'launcher-process', cwd: toolsRoot, environment: safeEnvironment(),
        onEvent: event => { diagnostic.events.push(event); persist() } })
    } catch (error) { commandFailure = error; observed = error.processOutcome; failure = error }
    if (observed) Object.assign(diagnostic, { exitCode: observed.code, signal: observed.signal, closeObserved: observed.closeObserved,
      stdoutBytes: observed.stdoutBytes, stderrBytes: observed.stderrBytes, timeout: observed.timeout, bufferTruncated: observed.bufferTruncated,
      outputComplete: observed.toolOutput.outputComplete, records: observed.toolOutput.records })
    diagnostic.diagnosticStatus = toolChainOutcome(observed, commandFailure)
    if (commandFailure) recordFailure(commandFailure, 'tool-diagnostic', 'T1_COMMAND_FAILED')
    result.reasonCode = diagnostic.diagnosticStatus === 'TOOL_CHAIN_PASS' ? 'DIAGNOSTIC_ONLY_NO_PRODUCT_ACCEPTANCE' : 'T1_DIAGNOSTIC_BLOCKED'
    persist()
  } catch (error) {
    failure = error; diagnostic.diagnosticStatus = 'BLOCKED'
    recordFailure(error, currentStage(), 'T1_PREFLIGHT_FAILED'); persist()
  }
  // No continuation into install/setup/Playwright exists, including the success path.
  process.stdout.write(JSON.stringify({ mode: 'mac-launcher-T1', diagnosticStatus: diagnostic.diagnosticStatus, complete: false }) + '\n')
  if (failure || diagnostic.diagnosticStatus !== 'TOOL_CHAIN_PASS') process.exitCode = 1
}
export function cleanupT1() {
  const { root, owner } = t1Root(), context = beginCleanup('workflow-cleanup', { root, owner })
  const file = path.join(root, 'evidence/acceptance-result.json')
  const result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : minimalResult(owner, 'BLOCKED_ENVIRONMENT', 'T1_NO_EXECUTION_RECEIPT')
  const events = result.toolDiagnostic?.events || []
  const requested = events.some(event => event.observation === 'spawn-requested')
  const closed = events.some(event => event.observation === 'close-observed')
  for (const operation of CLEANUP_OPERATIONS) appendCleanupEvent(context, 'operation-ended', { operation,
    status: operation === 'owned-process-cleanup' && requested ? (closed ? 'succeeded' : 'incomplete') : 'not-needed' })
  appendCleanupEvent(context, requested && !closed ? 'caller-returned-incomplete' : 'caller-observed-result', {
    status: requested && !closed ? 'incomplete' : 'succeeded', cleanupSucceeded: requested && !closed ? null : true })
  projectCleanup(root, owner); writeEvidence('acceptance-result.json', result)
  if (requested && !closed) {
    recordFailure(new AcceptanceError('BLOCKED_ENVIRONMENT', 'T1_OWNED_PROCESS_EXIT_UNCONFIRMED'), 'cleanup', 'T1_OWNED_PROCESS_EXIT_UNCONFIRMED')
    process.exitCode = 1
  }
}

async function cli() {
  const [operation, first, second] = process.argv.slice(2)
  if (operation === 't1-guard') { assertT1Trigger(); return }
  if (operation === 't1-run') return runT1()
  if (operation === 't1-cleanup') return cleanupT1()
  if (operation === 'freeze') {
    const freeze = createFreeze(localFrozenBytes)
    fs.writeFileSync(path.join(repoRoot, FREEZE_RELATIVE), JSON.stringify(freeze, null, 2) + '\n', { flag: 'wx' })
    process.stdout.write('Frozen ' + FROZEN_PATHS.length + '-file combination: ' + freeze.combinedSha256 + '\n')
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
  if (operation === 'init' || operation === 'init-t1') {
    if (operation === 'init-t1') { assertT1Trigger(); requireCondition(first === 'macOS', 'BLOCKED_INPUT', 'T1_MAC_REQUIRED') }
    assertHosted(first, second)
    requireCondition(path.isAbsolute(process.env.RUNNER_TEMP || '') && commitPattern.test(process.env.GITHUB_SHA || ''),
      'BLOCKED_ENVIRONMENT', 'RUNNER_IDENTITY_MISSING')
    requireCondition(path.parse(fs.realpathSync(process.env.RUNNER_TEMP)).root !== fs.realpathSync(process.env.RUNNER_TEMP)
      && /^\d+$/.test(process.env.GITHUB_RUN_ID || '') && /^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || ''),
    'BLOCKED_ENVIRONMENT', 'RUNNER_IDENTITY_INVALID')
    const root = fs.mkdtempSync(path.join(fs.realpathSync(process.env.RUNNER_TEMP), 'rt-native-acceptance-'))
    const owner = { root, caseId: randomUUID(), platform: first, arch: second, runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT, harnessSha: process.env.GITHUB_SHA,
      ...(operation === 'init-t1' ? { mode: 'mac-launcher-T1' } : {}) }
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
  if (operation === 'cleanup') return cleanup('workflow-cleanup')
  if (operation === 'publish') return publishEvidence()
  if (operation === 'collect' || operation === 'collect-mac') {
    const macOnly = operation === 'collect-mac'
    const expected = new Set(macOnly ? ['macOS-arm64', 'macOS-x64'] : ['windows-x64', 'macOS-arm64', 'macOS-x64']), selected = new Map()
    for (const directory of fs.readdirSync(first)) {
      const file = path.join(first, directory, 'acceptance-result.json')
      if (!fs.existsSync(file)) continue
      const result = JSON.parse(fs.readFileSync(file, 'utf8')); scanEvidence(result)
      requireCondition(!result.mode, 'BLOCKED_INPUT', 'DIAGNOSTIC_ARTIFACT_NOT_ACCEPTANCE')
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
            requireCondition(value.frozenSource?.harnessSha === result.harnessSha && value.frozenSource?.fileCount === FROZEN_PATHS.length
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
