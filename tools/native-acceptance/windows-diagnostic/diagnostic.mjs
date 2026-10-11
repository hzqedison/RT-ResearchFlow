import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(ROOT, '../../..')
export const PARENT_COMBINATION = '8fef94360d98b7be394def53a2f455794a8ac12707136a42971c7dbff67a6795'
export const PARENT_FREEZE = 'tools/native-acceptance/fixtures/harness-freeze.json'
export const OWN_FREEZE = 'tools/native-acceptance/windows-diagnostic/freeze.json'
export const OWN_FILES = ['.github/workflows/windows-installer-diagnostic.yml',
  'tools/native-acceptance/windows-diagnostic/README.md', 'tools/native-acceptance/windows-diagnostic/diagnostic.mjs',
  'tools/native-acceptance/windows-diagnostic/deadline.test.mjs',
  'tools/native-acceptance/windows-diagnostic/observe.ps1', 'tools/native-acceptance/windows-diagnostic/offline.test.mjs'].sort()
export const PIN = Object.freeze({ version: '1.0.0', tag: 'v1.0.0', sourceSha: '41f8429149f646c7dec7f1610082702e7d9cce48',
  basename: 'RT-ResearchFlow-Setup-1.0.0-x64.exe', size: 166547210,
  sha256: 'f5ea701458902dbcdeea08b3aabbcfca23b2c2c6a16ed8b88de1b31811033a4b' })
const HISTORICAL = { runId: '37726873605', attempt: 1, osBuild: '26100', image: 'windows-2025-vs2026', imageVersion: '20260925.250.1',
  exitCode: -1073741819, moduleName: 'System.dll', exceptionCode: 'c0000005', faultOffset: '00001581' }
const hex = /^[a-f0-9]{64}$/
export const hash = value => createHash('sha256').update(value).digest('hex')
export class D0Error extends Error {
  constructor(kind, code) { super(code); this.kind = kind; this.code = code }
}
export function need(condition, code, kind = 'BLOCKED_INPUT') { if (!condition) throw new D0Error(kind, code) }
export function assertContext(env = process.env, platform = process.platform, arch = process.arch) {
  need(env.CI === 'true' && env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted'
    && platform === 'win32' && arch === 'x64', 'HOSTED_WINDOWS_X64_REQUIRED', 'BLOCKED_ENVIRONMENT')
  need(env.GITHUB_RUN_ATTEMPT === '1', 'D0_RERUN_FORBIDDEN')
  need(env.GITHUB_REF === 'refs/heads/codex/diagnose-windows-installer-1.0', 'D0_BRANCH_REQUIRED')
  need(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') && /^\d+$/.test(env.GITHUB_RUN_ID || ''), 'D0_RUN_IDENTITY_INVALID')
}
const fields = new Set(('schemaVersion diagnosticOnly upgradeAccepted experiment historical harnessSha runId attempt job caseId stage time stages '
  + 'status primary secondary kind code errorClass errno exitCode nativeErrorCode description cleanup complete sourceSha version tag basename size sha256 '
  + 'input before after unchanged freeze combinedSha256 parentCombinedSha256 parentFreezeSha256 freezeSha256 files path image imageVersion osBuild osEdition '
  + 'runner nodeVersion powershellVersion cpuArchitecture processArchitecture comparison process pid parentPid createdUtc exitedUtc observedUtc alive '
  + 'imageName imageNameSha256 category imagePathSha256 identity integrity elevated administrator sidSha256 mitigations name availability flags '
  + 'paths label length spaces nonAscii localVolume reparseAncestor exists writable parameterShape installerCwd '
  + 'preflight emptyTarget registrationsBefore productProcessesBefore protectionUnchanged probeReachable installation attempted invocationCount timedOut '
  + 'autoStartedProduct registeredVersion locationMatches registrationSha256 registrationsAfter identityConfirmed processes coverage events eventId provider '
  + 'recordId eventUtc faultPid attribution creationTimeMatches exceptionCode faultOffset moduleName moduleVersion module categorySha256 '
  + 'modulePathSha256 signature signedHashStable available unavailableReason eventObservation matchedCount unattributedCount waitMs bounded '
  + 'observer cleanupOwned cleanupProtection succeeded remainingOwned unknownDescendant interrupted finalStage elapsedMs scope result records processCount '
  + 'moduleCandidates stageObserved fieldsUnavailable freezeFileSha256 sourceCommit filesVerified protectionSetupCalled attempts protectionState restorationAttempted preserveIsolation signal '
  + 'queryStatus queryTimeout queryUnavailable queryCompletionReceived collectionComplete helperOwnership helperExited cancellationRequested '
  + 'receiptComplete deadlineMs terminationReserveMs schedulingToleranceMs deadlineExceeded queryWindowMs resultDrainReserveMs '
  + 'ownershipRegistry ownedCheckedCount queryCleanup terminationStatus').split(/\s+/))
export function sanitizeEvidence(value) {
  const visit = item => {
    if (typeof item === 'string') {
      need(item.length <= 600 && !/[\r\n\0]/.test(item) && !/NOT-A-REAL-CREDENTIAL:|NA_KEYCHAIN_PASSWORD:|Bearer\s|https?:\/\//i.test(item), 'UNSAFE_DIAGNOSTIC_STRING')
      need(item === '/S /D=<CASE>/install' || (!path.posix.isAbsolute(item) && !path.win32.isAbsolute(item) && !item.includes('..\\') && !item.includes('../')), 'RAW_PATH_FORBIDDEN')
    } else if (Array.isArray(item)) { need(item.length <= 512, 'DIAGNOSTIC_ARRAY_TOO_LARGE'); item.forEach(visit) }
    else if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) { need(fields.has(key), 'DIAGNOSTIC_FIELD_FORBIDDEN'); visit(child) }
    else need(item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item), 'DIAGNOSTIC_VALUE_INVALID')
  }
  visit(value)
  return value
}
// Explicit fixed contracts; never copy arbitrary error properties or parse messages.
const parentErrors = {
  BLOCKED_INPUT: new Set(('PATH_OUTSIDE_CASE CASE_ROOT_REQUIRED CASE_OWNERSHIP_INVALID FROZEN_EXECUTION_RECEIPT_MISSING '
    + 'FROZEN_EXECUTION_RECEIPT_MISMATCH FROZEN_EXECUTION_BYTES_CHANGED').split(' ')),
  BLOCKED_ENVIRONMENT: new Set(('HOSTED_NATIVE_CI_REQUIRED NATIVE_PLATFORM_REQUIRED NATIVE_ARCH_REQUIRED CASE_ROOT_REQUIRED CASE_OWNERSHIP_INVALID '
    + 'PATH_OUTSIDE_CASE NATIVE_COMMAND_UNAVAILABLE NATIVE_COMMAND_TIMEOUT NATIVE_PLATFORM_FAILED WINDOWS_CONTROL_FAILED PATH_NOT_OWNED '
    + 'UNKNOWN_PRODUCT_PROCESS HOSTED_WINDOWS_REQUIRED ABSOLUTE_ROOT_REQUIRED CASE_ROOT_INVALID CASE_OWNER_INVALID INSTALL_DIRECTORY_EXISTS '
    + 'PREEXISTING_PRODUCT_REGISTRATION PREEXISTING_PRODUCT_PROCESS FIREWALL_DISABLED AUDIT_BACKUP_FAILED WFP_AUDIT_UNAVAILABLE '
    + 'AUDIT_RESTORE_FAILED OWNED_PROCESSES_REMAIN').split(' ')),
  FAIL_INSTALL: new Set(('INSTALL_VERSION_INVALID INSTALL_RECEIPT_INVALID INSTALLER_PATH_INVALID INSTALLER_BYTES_CHANGED PRODUCT_NOT_EXITED '
    + 'OLD_INSTALL_NOT_CLEAN UPGRADE_REGISTRATION_MISSING NSIS_TIMEOUT NSIS_NONZERO_EXIT INSTALLER_AUTO_STARTED_PRODUCT '
    + 'INSTALLED_EXE_MISSING INSTALLED_REGISTRATION_INVALID UPGRADE_REGISTRATION_CHANGED NATIVE_COMMAND_TIMEOUT NATIVE_PLATFORM_FAILED').split(' ')),
}
const downloadInputCodes = new Set(('INVALID_ARGUMENTS UNSUPPORTED_PLATFORM_ARCH INVALID_MANIFEST UNSAFE_OUTPUT_DIRECTORY OUTPUT_DIRECTORY_CHANGED '
  + 'UNTRUSTED_DOWNLOAD_URL INVALID_REDIRECT PARTIAL_FILE_CHANGED DOWNLOAD_SIZE_MISMATCH DOWNLOAD_HASH_MISMATCH DESTINATION_EXISTS FINAL_FILE_CHANGED').split(' '))
const downloadEnvironmentCodes = new Set(('HOSTED_CI_REQUIRED INVALID_RUNNER_TEMP DOWNLOAD_HTTP_ERROR TOO_MANY_REDIRECTS DOWNLOAD_WRITE_FAILED '
  + 'ATOMIC_FINALIZE_FAILED DOWNLOAD_TIMEOUT DOWNLOAD_FAILED').split(' '))
const errnoCodes = new Set(('ENOENT EACCES EPERM EIO ENOSPC ETIMEDOUT EEXIST EISDIR ENOTDIR ECONNREFUSED ECONNRESET EADDRINUSE EINVAL '
  + 'ERR_MODULE_NOT_FOUND MODULE_NOT_FOUND ERR_REQUIRE_ESM ERR_INVALID_ARG_TYPE ERR_UNKNOWN_FILE_EXTENSION ERR_DLOPEN_FAILED').split(' '))
const signals = new Set(['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT', 'SIGBUS'])
export function safeError(error, stage, fallback = 'D0_TOOL_ERROR') {
  const fixedFallback = /^[A-Z0-9_]{1,80}$/.test(fallback) ? fallback : 'D0_TOOL_ERROR'
  let kind = 'DIAGNOSTIC_ERROR', code = fixedFallback
  if (error instanceof D0Error && /^[A-Z0-9_]{1,80}$/.test(error.code)
    && ['BLOCKED_INPUT', 'BLOCKED_ENVIRONMENT', 'FAIL_INSTALL', 'DIAGNOSTIC_ERROR'].includes(error.kind)) {
    kind = error.kind; code = error.code
  } else if (error instanceof Error && Object.hasOwn(parentErrors, error.kind) && parentErrors[error.kind].has(error.code)) {
    kind = error.kind; code = error.code
  } else if (error instanceof Error && downloadInputCodes.has(error.upgradeCode)) {
    kind = 'BLOCKED_INPUT'; code = error.upgradeCode
  } else if (error instanceof Error && downloadEnvironmentCodes.has(error.upgradeCode)) {
    kind = 'BLOCKED_ENVIRONMENT'; code = error.upgradeCode
  }
  const native = error?.nativeError
  return { kind, code, stage,
    errorClass: ['Error', 'TypeError', 'SyntaxError', 'RangeError', 'TimeoutError'].includes(native?.name || error?.name) ? native?.name || error.name : 'Error',
    errno: errnoCodes.has(native?.code) ? native.code : errnoCodes.has(error?.code) ? error.code : 'unavailable',
    exitCode: Number.isInteger(native?.exitCode) && native.exitCode >= -2147483648 && native.exitCode <= 4294967295 ? native.exitCode : 'unavailable',
    signal: signals.has(native?.signal) ? native.signal : 'unavailable',
    description: 'Raw exception text, parameters and paths suppressed.' }
}
export function failure(result, error, stage, fallback) {
  const detail = safeError(error, stage, fallback)
  if (!result.primary) result.primary = detail
  else result.secondary.push(detail)
  result.status = result.primary.kind
  return result
}
function relativeRead(file) {
  need(file === PARENT_FREEZE || file === OWN_FREEZE || OWN_FILES.includes(file)
    || file.startsWith('tools/native-acceptance/') || file === '.github/scripts/fetch-upgrade-installers.cjs'
    || file === '.github/workflows/native-upgrade-acceptance.yml' || file === 'tests/fixtures/releases/native-upgrade-1.0-1.1.json', 'UNKNOWN_FROZEN_PATH')
  need(!file.includes('..') && !path.isAbsolute(file), 'FROZEN_PATH_ESCAPE')
  const absolute = path.join(REPO, file)
  need(fs.realpathSync(absolute) === absolute && fs.lstatSync(absolute).isFile(), 'FROZEN_FILE_NOT_REGULAR')
  return fs.readFileSync(absolute)
}
function parentPins(bytes) {
  const value = JSON.parse(bytes.toString('utf8'))
  need(value.files?.length === 16 && value.combinedSha256 === PARENT_COMBINATION, 'REUSED_FREEZE_CHANGED')
  const files = value.files.map(item => {
    need(typeof item.path === 'string' && !item.path.includes('..') && !path.win32.isAbsolute(item.path)
      && Number.isSafeInteger(item.size) && item.size > 0 && hex.test(item.sha256), 'REUSED_FREEZE_INVALID')
    return { path: item.path, size: item.size, sha256: item.sha256 }
  })
  need(hash(JSON.stringify(files)) === PARENT_COMBINATION, 'REUSED_COMBINATION_MISMATCH')
  return files
}
export function makeFreeze(read = relativeRead) {
  const bytes = read(PARENT_FREEZE); parentPins(bytes)
  const parent = { path: PARENT_FREEZE, size: bytes.length, sha256: hash(bytes), combinedSha256: PARENT_COMBINATION }
  const files = OWN_FILES.map(file => { const bytes = read(file); return { path: file, size: bytes.length, sha256: hash(bytes) } })
  return { schemaVersion: 1, commitBinding: 'workflow-checkout-commit', parent, files, combinedSha256: hash(JSON.stringify({ parent, files })) }
}
export async function verifyFreeze(ownBytes, parentBytes, sourceSha, readLocal, readCommit) {
  need(/^[a-f0-9]{40}$/.test(sourceSha), 'FIXED_COMMIT_REQUIRED')
  const freeze = JSON.parse(ownBytes.toString('utf8')), reused = parentPins(parentBytes)
  need(freeze.schemaVersion === 1 && freeze.commitBinding === 'workflow-checkout-commit'
    && freeze.parent?.path === PARENT_FREEZE && freeze.parent.sha256 === hash(parentBytes)
    && freeze.parent.size === parentBytes.length && freeze.parent.combinedSha256 === PARENT_COMBINATION, 'D0_PARENT_BINDING_MISMATCH')
  need(freeze.files?.length === OWN_FILES.length && freeze.files.every((item, i) => item.path === OWN_FILES[i]
    && Number.isSafeInteger(item.size) && item.size > 0 && hex.test(item.sha256)), 'D0_FILE_SET_INVALID')
  need(hash(JSON.stringify({ parent: freeze.parent, files: freeze.files })) === freeze.combinedSha256, 'D0_COMBINATION_MISMATCH')
  const files = [...reused, ...freeze.files]
  for (const item of files) {
    let bytes
    try { bytes = await readLocal(item.path) } catch { throw new D0Error('BLOCKED_INPUT', 'FROZEN_FILE_MISSING') }
    need(Buffer.isBuffer(bytes) && bytes.length === item.size && hash(bytes) === item.sha256, 'WORKTREE_BYTES_CHANGED')
  }
  for (const [file, expected] of [[OWN_FREEZE, ownBytes], [PARENT_FREEZE, parentBytes]]) need(hash(await readCommit(file, sourceSha)) === hash(expected), 'FREEZE_COMMIT_CHANGED')
  for (const item of files) {
    const bytes = await readCommit(item.path, sourceSha)
    need(Buffer.isBuffer(bytes) && bytes.length === item.size && hash(bytes) === item.sha256, 'COMMIT_BYTES_CHANGED')
  }
  return { sourceCommit: sourceSha, combinedSha256: freeze.combinedSha256, parentCombinedSha256: PARENT_COMBINATION,
    parentFreezeSha256: hash(parentBytes), freezeSha256: hash(ownBytes), filesVerified: files.length,
    scope: 'raw-checkout-and-same-commit-blobs; both-freezes-exclude-themselves' }
}
function commitReader() {
  const deadline = Date.now() + 180000
  return async (file, sha) => {
    need(Date.now() < deadline, 'COMMIT_READ_TIMEOUT')
    const response = await fetch('https://api.github.com/repos/hzqedison/RT-ResearchFlow/contents/' + file + '?ref=' + sha, {
      headers: { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(Math.min(10000, deadline - Date.now())),
    })
    need(response.ok, 'COMMIT_READ_FAILED')
    let size = 0; const chunks = []
    for await (const part of response.body) { size += part.length; need(size <= 2 * 1024 * 1024, 'COMMIT_RESPONSE_LIMIT'); chunks.push(part) }
    const item = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    need(item.type === 'file' && item.path === file && item.encoding === 'base64', 'COMMIT_RESPONSE_INVALID')
    const bytes = Buffer.from(item.content, 'base64')
    need(item.size === bytes.length && item.sha === createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'), 'GIT_BLOB_IDENTITY_MISMATCH')
    return bytes
  }
}
function ownedCase() {
  assertContext()
  const root = process.env.NA_CASE_ROOT, temporary = fs.realpathSync(process.env.RUNNER_TEMP)
  need(root && path.isAbsolute(root) && fs.realpathSync(root) === root && path.dirname(root) === temporary
    && path.basename(root).startsWith('rt-native-acceptance-') && !fs.lstatSync(root).isSymbolicLink(), 'D0_CASE_INVALID')
  const owner = JSON.parse(fs.readFileSync(path.join(root, 'owner.json'), 'utf8'))
  need(owner.diagnostic === 'D0' && owner.root === root && owner.harnessSha === process.env.GITHUB_SHA
    && owner.runId === process.env.GITHUB_RUN_ID && owner.runAttempt === '1', 'D0_OWNER_INVALID')
  return { root, owner }
}
const outputName = 'windows-installer-d0.json'
function save(result) {
  sanitizeEvidence(result)
  const { root } = ownedCase()
  fs.writeFileSync(path.join(root, 'd0-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
}
function loadResult() { return JSON.parse(fs.readFileSync(path.join(ownedCase().root, 'd0-result.json'), 'utf8')) }
function phase(result, stage) { result.stage = stage; result.stages.push({ stage, time: new Date().toISOString() }); save(result) }
export async function hashInstaller(file) {
  const digest = createHash('sha256'); let size = 0
  for await (const part of fs.createReadStream(file)) { size += part.length; digest.update(part) }
  return { size, sha256: digest.digest('hex') }
}
export function selectOld(receipt, temporary) {
  need(receipt.installers?.length === 2, 'DOWNLOAD_RECEIPT_INVALID')
  const item = receipt.installers[0]
  need(item.version === PIN.version && item.basename === PIN.basename && item.size === PIN.size && item.sha256 === PIN.sha256
    && typeof item.path === 'string' && /^rt-native-upgrade-[A-Za-z0-9_-]+\//.test(item.path)
    && item.path.split('/').length === 2 && path.posix.basename(item.path) === PIN.basename && !item.path.includes('\\'), 'OLD_INSTALLER_PIN_MISMATCH')
  return path.resolve(temporary, item.path)
}
function imageValue(value) { return typeof value === 'string' && /^[A-Za-z0-9_. -]{1,96}$/.test(value) ? value : 'unavailable' }
export function compareImage(runner) {
  return runner.image === HISTORICAL.image && runner.imageVersion === HISTORICAL.imageVersion && runner.osBuild === HISTORICAL.osBuild
    ? 'reported-image-fields-match-R0; other-unobserved-factors-not-proven-equal' : 'new-environment-diagnostic-observation; not-strict-R0-reproduction'
}
async function reachable() {
  return new Promise(resolve => {
    const request = https.get('https://1.1.1.1/cdn-cgi/trace', { timeout: 6000 }, response => { response.resume(); resolve(response.statusCode >= 200 && response.statusCode < 400) })
    request.on('error', () => resolve(false)); request.on('timeout', () => { request.destroy(); resolve(false) })
  })
}
function verifyReceiptLocally() {
  const { root, owner } = ownedCase(), receipt = JSON.parse(fs.readFileSync(path.join(root, 'd0-verified.json'), 'utf8'))
  const ownBytes = relativeRead(OWN_FREEZE), parentBytes = relativeRead(PARENT_FREEZE), freeze = JSON.parse(ownBytes)
  need(receipt.sourceCommit === owner.harnessSha && receipt.freezeSha256 === hash(ownBytes)
    && receipt.parentFreezeSha256 === hash(parentBytes) && receipt.parentCombinedSha256 === PARENT_COMBINATION, 'D0_VERIFICATION_RECEIPT_CHANGED')
  for (const item of [...parentPins(parentBytes), ...freeze.files]) { const bytes = relativeRead(item.path); need(bytes.length === item.size && hash(bytes) === item.sha256, 'D0_PRECALL_BYTES_CHANGED') }
  return receipt
}
async function sharedTools() { return import(pathToFileURL(path.join(REPO, 'tools/native-acceptance/evidence.mjs')).href) }
async function observer(action, shared) {
  const { root } = ownedCase()
  const response = await shared.command('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(ROOT, 'observe.ps1'), '-Action', action, '-Root', root], {
    cwd: path.join(REPO, 'tools/native-acceptance'), timeout: action === 'run' ? 250000 : 45000,
  })
  let value
  try { value = JSON.parse(response.stdout) } catch { throw new D0Error('DIAGNOSTIC_ERROR', 'OBSERVER_OUTPUT_UNAVAILABLE') }
  sanitizeEvidence(value)
  return value
}
// Pure orchestration seam: offline tests supply all effects and prove exactly one invocation.
export async function runOnce(result, effects) {
  let invocationIssued = false
  try {
    await effects.verify()
    await effects.claim() // Exclusive marker is consumed even if launching later fails.
    result.before = await effects.hash()
    need(result.before.size === PIN.size && result.before.sha256 === PIN.sha256, 'PREINSTALL_BYTES_CHANGED')
    await effects.setup()
    invocationIssued = true
    result.installation = await effects.install()
    if (result.installation.primary) {
      result.primary = result.installation.primary
      result.status = result.primary.kind
    } else result.status = 'DIAGNOSTIC_OBSERVED'
  } catch (error) {
    if (!result.installation) result.installation = { attempted: invocationIssued ? 'unavailable' : false,
      invocationCount: invocationIssued ? 'unavailable' : 0, exitCode: 'unavailable', scope: 'no-observer-result; no-second-invocation' }
    failure(result, error, result.stage, 'D0_TOOL_ERROR')
  }
  finally {
    try { result.after = await effects.hash(); result.unchanged = result.after.size === PIN.size && result.after.sha256 === PIN.sha256
      if (!result.unchanged) failure(result, new D0Error('BLOCKED_INPUT', 'POSTINSTALL_BYTES_CHANGED'), 'post-install-hash')
    } catch (error) { failure(result, error, 'post-install-hash', 'POSTINSTALL_HASH_UNAVAILABLE') }
    await finishCleanup(result, effects.cleanup)
  }
  result.diagnosticOnly = true; result.upgradeAccepted = false; result.complete = true
  return result
}
export function consumeBudget(writeExclusive) {
  try { writeExclusive() } catch (error) {
    if (error.code === 'EEXIST') throw new D0Error('BLOCKED_INPUT', 'D0_BUDGET_EXHAUSTED')
    throw error
  }
}
export async function cleanupWithEffects(result, effects) {
  if (!result.protectionSetupCalled) return { succeeded: true, protectionState: 'not-started', restorationAttempted: false,
    preserveIsolation: false, records: [{ scope: 'no-native-protection-or-install-started' }] }
  const records = []; let owned
  try { owned = await effects.observe(); sanitizeEvidence(owned); records.push(owned) }
  catch (error) { owned = undefined; records.push({ succeeded: false, ...safeError(error, 'cleanup', 'OWNED_PROCESS_CLEANUP_FAILED') }) }
  const ownedExited = owned?.succeeded === true && owned.remainingOwned === 0 && owned.unknownDescendant === false
    && owned.preserveIsolation !== true && owned.helperExited !== false
  if (!ownedExited) {
    records.push({ cleanupProtection: false, scope: 'protection-retained-until-owned-process-exit-established' })
    return { succeeded: false, protectionState: 'retained', restorationAttempted: false, preserveIsolation: true, records }
  }
  let restored = false
  try { const value = await effects.restore(); restored = value?.cleanupSucceeded === true; records.push({ cleanupProtection: restored }) }
  catch (error) { records.push({ cleanupProtection: false, ...safeError(error, 'cleanup', 'PROTECTION_CLEANUP_FAILED') }) }
  // Restoration may fail after partial effects. Protection is then unknown.
  return { succeeded: restored, protectionState: restored ? 'restored' : 'unknown', restorationAttempted: true,
    preserveIsolation: !restored, records }
}
export async function finishCleanup(result, effect) {
  let attempt
  try { attempt = await effect(); need(typeof attempt?.succeeded === 'boolean', 'D0_CLEANUP_RECEIPT_INVALID', 'DIAGNOSTIC_ERROR'); sanitizeEvidence(attempt) }
  catch (error) { attempt = { succeeded: false, protectionState: 'unknown', preserveIsolation: true,
    records: [{ ...safeError(error, 'cleanup', 'D0_CLEANUP_FAILED') }] } }
  const previous = Array.isArray(result.cleanup?.attempts) ? result.cleanup.attempts : []
  result.cleanup = { succeeded: attempt.succeeded, protectionState: attempt.protectionState || 'unknown',
    preserveIsolation: attempt.preserveIsolation !== false, attempts: [...previous, { time: new Date().toISOString(), ...attempt }] }
  if (!attempt.succeeded) failure(result, new D0Error('DIAGNOSTIC_ERROR', 'D0_CLEANUP_FAILED'), 'cleanup')
  return result.cleanup
}
async function cleanup(result) {
  if (!result.protectionSetupCalled) return cleanupWithEffects(result, {})
  const shared = await sharedTools()
  return cleanupWithEffects(result, { observe: () => observer('cleanup', shared),
    restore: () => shared.platformCommand('cleanup', [], { timeout: 60000 }) })
}
async function main() {
  const action = process.argv[2]
  if (action === 'freeze') {
    const freeze = makeFreeze()
    fs.writeFileSync(path.join(REPO, OWN_FREEZE), JSON.stringify(freeze, null, 2) + '\n', { flag: 'wx' })
    process.stdout.write(JSON.stringify({ experiment: 'D0', combinedSha256: freeze.combinedSha256, parentCombinedSha256: PARENT_COMBINATION }) + '\n')
    return
  }
  assertContext()
  if (action === 'init') {
    need(path.isAbsolute(process.env.RUNNER_TEMP || '') && !fs.lstatSync(process.env.RUNNER_TEMP).isSymbolicLink(), 'RUNNER_TEMP_INVALID')
    const temporary = fs.realpathSync(process.env.RUNNER_TEMP)
    need(path.parse(temporary).root !== temporary, 'RUNNER_TEMP_IS_ROOT')
    const root = fs.mkdtempSync(path.join(temporary, 'rt-native-acceptance-'))
    const owner = { root, diagnostic: 'D0', caseId: randomUUID(), platform: 'windows', arch: 'x64', harnessSha: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID, runAttempt: '1' }
    fs.writeFileSync(path.join(root, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 })
    process.env.NA_CASE_ROOT = root
    save({ schemaVersion: 1, experiment: 'D0', diagnosticOnly: true, upgradeAccepted: false, historical: HISTORICAL,
      harnessSha: owner.harnessSha, runId: owner.runId, attempt: 1, job: imageValue(process.env.GITHUB_JOB), caseId: owner.caseId,
      stage: 'initialized', stages: [], status: 'NOT_RUN', primary: null, secondary: [], input: PIN, complete: false,
      protectionSetupCalled: false, runner: { image: imageValue(process.env.ImageOS), imageVersion: imageValue(process.env.ImageVersion), nodeVersion: process.version }, cleanup: { succeeded: false, protectionState: 'not-started', attempts: [] } })
    fs.appendFileSync(process.env.GITHUB_ENV, 'NA_CASE_ROOT=' + root + '\nD0_PUBLIC_EVIDENCE=' + path.join(root, 'd0-public', outputName) + '\n')
    return
  }
  const { root } = ownedCase(), result = loadResult()
  if (action === 'verify') {
    phase(result, 'freeze-verification')
    result.freeze = await verifyFreeze(relativeRead(OWN_FREEZE), relativeRead(PARENT_FREEZE), process.env.GITHUB_SHA, relativeRead, commitReader())
    fs.writeFileSync(path.join(root, 'd0-verified.json'), JSON.stringify(result.freeze), { flag: 'wx', mode: 0o600 }); save(result); return
  }
  if (action === 'download') {
    verifyReceiptLocally(); phase(result, 'download')
    const receipt = await createRequire(import.meta.url)(path.join(REPO, '.github/scripts/fetch-upgrade-installers.cjs')).main(['--platform', 'windows', '--arch', 'x64'])
    selectOld(receipt, fs.realpathSync(process.env.RUNNER_TEMP))
    fs.writeFileSync(path.join(root, 'download-receipt.json'), JSON.stringify(receipt), { flag: 'wx', mode: 0o600 }); return
  }
  if (action === 'run') {
    verifyReceiptLocally()
    const shared = await sharedTools()
    const receipt = JSON.parse(fs.readFileSync(path.join(root, 'download-receipt.json'), 'utf8'))
    const installer = selectOld(receipt, fs.realpathSync(process.env.RUNNER_TEMP))
    need(fs.realpathSync(installer) === installer && fs.lstatSync(installer).isFile(), 'INSTALLER_PATH_CHANGED')
    await runOnce(result, {
      verify: async () => { verifyReceiptLocally(); phase(result, 'preflight') },
      claim: async () => consumeBudget(() => fs.writeFileSync(path.join(root, 'd0-budget-consumed.json'), JSON.stringify({ experiment: 'D0', invocationCount: 1 }), { flag: 'wx', mode: 0o600 })),
      hash: () => hashInstaller(installer),
      setup: async () => {
        result.probeReachable = await reachable(); need(result.probeReachable, 'PUBLIC_PROBE_UNAVAILABLE', 'BLOCKED_ENVIRONMENT')
        phase(result, 'protection-setup'); result.protectionSetupCalled = true; save(result)
        await shared.platformCommand('setup', [], { timeout: 60000 })
      },
      install: async () => { phase(result, 'single-native-invocation'); return observer('run', shared) },
      cleanup: async () => cleanup(result),
    })
    if (result.installation?.runner) Object.assign(result.runner, result.installation.runner)
    result.runner.comparison = compareImage(result.runner)
    phase(result, 'diagnostic-ended'); save(result)
    if (result.primary || !result.cleanup.succeeded || result.installation?.exitCode !== 0) process.exitCode = 1
    return
  }
  if (action === 'cleanup') { await finishCleanup(result, () => cleanup(result)); save(result); if (!result.cleanup.succeeded) process.exitCode = 1; return }
  if (action === 'publish') {
    if (!result.complete && !result.primary) failure(result, new D0Error('DIAGNOSTIC_ERROR', 'D0_NO_TERMINAL_OBSERVATION'), result.stage)
    sanitizeEvidence(result)
    const destination = path.join(root, 'd0-public'); fs.mkdirSync(destination, { mode: 0o700 })
    fs.writeFileSync(path.join(destination, outputName), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    process.stdout.write(JSON.stringify({ experiment: 'D0', diagnosticOnly: true, upgradeAccepted: false, status: result.status,
      primary: result.primary, cleanup: { succeeded: result.cleanup.succeeded } }) + '\n')
    return
  }
  throw new D0Error('BLOCKED_INPUT', 'UNKNOWN_D0_OPERATION')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  const detail = safeError(error, 'driver')
  try { const result = loadResult(); failure(result, error, result.stage); save(result) } catch { /* No unsafe fallback output. */ }
  process.stdout.write(JSON.stringify({ diagnosticOnly: true, upgradeAccepted: false, primary: detail }) + '\n'); process.exitCode = 1
})
