import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { ROOT, REPO, PIN, OWN_FILES, OWN_FREEZE, PARENT_FREEZE, PARENT_COMBINATION, D0Error,
  assertContext, hash, makeFreeze, verifyFreeze, selectOld, sanitizeEvidence, safeError, runOnce, consumeBudget, compareImage,
  cleanupWithEffects, finishCleanup } from './diagnostic.mjs'
import { AcceptanceError } from '../evidence.mjs'

const env = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_RUN_ATTEMPT: '1',
  GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '12345', GITHUB_REF: 'refs/heads/codex/diagnose-windows-installer-1.0' }
test('D0 admits only explicit first-attempt hosted native Windows context', () => {
  assert.doesNotThrow(() => assertContext(env, 'win32', 'x64'))
  for (const change of [{ CI: 'false' }, { GITHUB_ACTIONS: 'false' }, { RUNNER_ENVIRONMENT: 'self-hosted' },
    { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_RUN_ATTEMPT: '01' }, { GITHUB_REF: 'refs/heads/main' }]) {
    assert.throws(() => assertContext({ ...env, ...change }, 'win32', 'x64'), D0Error)
  }
  assert.throws(() => assertContext(env, 'darwin', 'arm64'), /HOSTED_WINDOWS_X64_REQUIRED/)
})

function record() { return { diagnosticOnly: true, upgradeAccepted: false, status: 'NOT_RUN', stage: 'single-native-invocation', primary: null, secondary: [], complete: false } }
function effects(installation = { attempted: true, invocationCount: 1, exitCode: 0, primary: null }) {
  const calls = [], api = {}
  for (const name of ['verify', 'claim', 'setup', 'cleanup', 'hash', 'install']) api[name] = async () => {
    calls.push(name)
    if (name === 'hash') return { size: PIN.size, sha256: PIN.sha256 }
    if (name === 'install') return installation
    if (name === 'cleanup') return { succeeded: true, records: [] }
  }
  return { calls, api }
}
for (const outcome of ['exit-zero', 'access-violation', 'timeout', 'observer-error']) {
  test('D0 ends after one invocation for ' + outcome + ', with no upgrade acceptance', async () => {
    const installation = { attempted: true, invocationCount: 1, exitCode: outcome === 'exit-zero' ? 0 : outcome === 'timeout' ? 'unavailable' : -1073741819,
      timedOut: outcome === 'timeout', primary: outcome === 'exit-zero' ? null : { kind: outcome === 'observer-error' ? 'DIAGNOSTIC_ERROR' : 'FAIL_INSTALL',
        code: outcome === 'timeout' ? 'NSIS_TIMEOUT' : outcome === 'observer-error' ? 'D0_OBSERVER_FAILED' : 'NSIS_NONZERO_EXIT', stage: 'single-install' } }
    const { calls, api } = effects(installation), result = await runOnce(record(), api)
    assert.equal(calls.filter(name => name === 'install').length, 1)
    assert.deepEqual(calls, ['verify', 'claim', 'hash', 'setup', 'install', 'hash', 'cleanup'])
    assert.equal(result.diagnosticOnly, true); assert.equal(result.upgradeAccepted, false)
    assert.equal(result.installation.exitCode, installation.exitCode)
    assert.equal(result.status, outcome === 'exit-zero' ? 'DIAGNOSTIC_OBSERVED' : installation.primary.kind)
    assert.doesNotThrow(() => sanitizeEvidence(result))
  })
}
test('exclusive same-case budget rejects a second call before native setup or invocation', async () => {
  let claimed = false
  const claim = () => consumeBudget(() => { if (claimed) throw Object.assign(new Error('already exists'), { code: 'EEXIST' }); claimed = true })
  claim()
  const { calls, api } = effects(); api.claim = async () => { calls.push('claim'); claim() }
  const result = await runOnce(record(), api)
  assert.equal(result.primary.code, 'D0_BUDGET_EXHAUSTED')
  assert.equal(calls.includes('install'), false); assert.equal(calls.includes('setup'), false)
})
test('observer crash after dispatch leaves native outcome unavailable and never invokes again', async () => {
  const { calls, api } = effects()
  api.install = async () => { calls.push('install'); throw new Error('private native output unavailable') }
  const result = await runOnce(record(), api)
  assert.equal(calls.filter(name => name === 'install').length, 1)
  assert.equal(result.installation.exitCode, 'unavailable')
  assert.equal(result.installation.attempted, 'unavailable')
  assert.equal(result.primary.kind, 'DIAGNOSTIC_ERROR')
  assert.equal(result.cleanup.succeeded, true)
})
test('byte or protection failure prevents installation rather than retrying', async () => {
  for (const stop of ['verify', 'hash', 'setup']) {
    const { calls, api } = effects()
    api[stop] = async () => { calls.push(stop); throw new D0Error('BLOCKED_INPUT', 'OFFLINE_GATE_FAILED') }
    const result = await runOnce(record(), api)
    assert.equal(calls.includes('install'), false); assert.equal(result.primary.code, 'OFFLINE_GATE_FAILED')
  }
})
test('post-byte and cleanup failure cannot replace the original installer crash', async () => {
  const { api } = effects({ exitCode: -1073741819, primary: { kind: 'FAIL_INSTALL', code: 'NSIS_NONZERO_EXIT', stage: 'single-install' } })
  let hashes = 0
  api.hash = async () => ({ size: PIN.size, sha256: ++hashes === 1 ? PIN.sha256 : '0'.repeat(64) })
  api.cleanup = async () => { throw Object.assign(new Error('private cleanup details'), { code: 'EACCES' }) }
  const result = await runOnce(record(), api)
  assert.equal(result.primary.code, 'NSIS_NONZERO_EXIT'); assert.equal(result.installation.exitCode, -1073741819)
  assert.deepEqual(result.secondary.map(item => item.code), ['POSTINSTALL_BYTES_CHANGED', 'D0_CLEANUP_FAILED'])
  assert.equal(result.upgradeAccepted, false)
})
test('receipt selects only the original fixed 1.0 installer and rejects substitution/traversal', () => {
  const old = { ...PIN, path: 'rt-native-upgrade-offline/' + PIN.basename }
  const receipt = { installers: [old, { version: '1.1.0' }] }
  assert.equal(path.basename(selectOld(receipt, 'K:/offline-owned')), PIN.basename)
  for (const changed of [{ version: '1.1.0' }, { sha256: '0'.repeat(64) }, { size: 1 }, { path: '../' + PIN.basename },
    { path: 'rt-native-upgrade-offline/../' + PIN.basename }]) {
    assert.throws(() => selectOld({ installers: [{ ...old, ...changed }, receipt.installers[1]] }, 'K:/offline-owned'), /OLD_INSTALLER_PIN_MISMATCH/)
  }
})
test('whitelist accepts fixed argument shape but rejects paths, secrets and raw events', () => {
  assert.doesNotThrow(() => sanitizeEvidence({ parameterShape: '/S /D=<CASE>/install', processArchitecture: 'unavailable', signature: 'unavailable' }))
  for (const unsafe of [{ category: 'C:\\Users\\private' }, { category: '/private/profile' }, { description: 'Bearer token' },
    { description: 'NOT-A-REAL-CREDENTIAL:fake' }, { description: 'NA_KEYCHAIN_PASSWORD:fake' }, { rawEvent: '<xml/>' }, { commandLine: 'installer /S' }]) {
    assert.throws(() => sanitizeEvidence(unsafe))
  }
  const detail = safeError(Object.assign(new Error('private password and paths'), { code: 'EACCES', parameters: { token: 'private' } }), 'observer')
  assert.equal(detail.errno, 'EACCES'); assert.equal(JSON.stringify(detail).includes('private'), false)
})
test('image drift or unknown image metadata never claims strict R0 reproduction', () => {
  assert.match(compareImage({ image: 'unavailable', imageVersion: 'unavailable', osBuild: '26100' }), /^new-environment/)
  assert.match(compareImage({ image: 'windows-2025-vs2026', imageVersion: 'different', osBuild: '26100' }), /^new-environment/)
  assert.match(compareImage({ image: 'windows-2025-vs2026', imageVersion: '20260925.250.1', osBuild: '26100' }), /other-unobserved-factors-not-proven-equal/)
})

function frozenInputs() {
  const parentBytes = fs.readFileSync(path.join(REPO, PARENT_FREEZE)), parent = JSON.parse(parentBytes)
  assert.equal(parent.combinedSha256, PARENT_COMBINATION)
  const bytes = new Map([...parent.files.map(item => item.path), ...OWN_FILES, PARENT_FREEZE].map(file => [file, fs.readFileSync(path.join(REPO, file))]))
  const freeze = makeFreeze(file => bytes.get(file)), ownBytes = Buffer.from(JSON.stringify(freeze) + '\n')
  const committed = new Map([...bytes, [OWN_FREEZE, ownBytes]])
  const requests = []
  return { bytes, parentBytes, freeze, ownBytes, committed, requests,
    readLocal: file => { if (!bytes.has(file)) throw new Error('missing'); return bytes.get(file) },
    readCommit: async (file, sha) => { assert.equal(sha, env.GITHUB_SHA); requests.push(file); return committed.get(file) } }
}
test('independent freeze binds 6 new files and the unchanged 16-file parent plus both freeze bytes', async () => {
  const f = frozenInputs(), receipt = await verifyFreeze(f.ownBytes, f.parentBytes, env.GITHUB_SHA, f.readLocal, f.readCommit)
  assert.equal(receipt.filesVerified, 22); assert.equal(f.requests.length, 24)
  assert.equal(receipt.parentCombinedSha256, PARENT_COMBINATION)
  assert.equal(receipt.parentFreezeSha256, hash(f.parentBytes))
  assert.equal(f.freeze.files.some(item => item.path === OWN_FREEZE), false)
  assert.equal(f.ownBytes.toString().includes(env.GITHUB_SHA), false)
})
for (const variant of ['missing-own', 'changed-parent', 'eol-conversion']) {
  test('freeze rejects ' + variant + ' locally before any commit read or native action', async () => {
    const f = frozenInputs()
    if (variant === 'missing-own') f.bytes.delete(OWN_FILES[0])
    else {
      const file = variant === 'changed-parent' ? JSON.parse(f.parentBytes).files[0].path : OWN_FILES[0]
      const value = Buffer.from(f.bytes.get(file))
      if (variant === 'changed-parent') { value[0] ^= 1; f.bytes.set(file, value) }
      else f.bytes.set(file, Buffer.from(value.toString().replace(/\r?\n/g, '\r\r\n')))
    }
    await assert.rejects(verifyFreeze(f.ownBytes, f.parentBytes, env.GITHUB_SHA, f.readLocal, f.readCommit), error => error.kind === 'BLOCKED_INPUT')
    assert.equal(f.requests.length, 0)
  })
}
test('freeze rejects changed same-commit payload and parent-freeze bytes', async () => {
  const f = frozenInputs(); f.committed.set(OWN_FILES[0], Buffer.from('changed'))
  await assert.rejects(verifyFreeze(f.ownBytes, f.parentBytes, env.GITHUB_SHA, f.readLocal, f.readCommit), /COMMIT_BYTES_CHANGED/)
  const g = frozenInputs(); g.committed.set(PARENT_FREEZE, Buffer.from('{}'))
  await assert.rejects(verifyFreeze(g.ownBytes, g.parentBytes, env.GITHUB_SHA, g.readLocal, g.readCommit), /FREEZE_COMMIT_CHANGED/)
})
test('freeze cannot include itself, change the parent combination, omit payloads or bind a branch name', async () => {
  const f = frozenInputs()
  for (const mutate of [value => { value.files[0].path = OWN_FREEZE }, value => { value.files.pop() },
    value => { value.parent.combinedSha256 = '0'.repeat(64) }]) {
    const changed = structuredClone(f.freeze); mutate(changed)
    await assert.rejects(verifyFreeze(Buffer.from(JSON.stringify(changed)), f.parentBytes, env.GITHUB_SHA, f.readLocal, f.readCommit), D0Error)
  }
  await assert.rejects(verifyFreeze(f.ownBytes, f.parentBytes, 'main', f.readLocal, f.readCommit), /FIXED_COMMIT_REQUIRED/)
})
test('workflow is single-run D0, read-only, same runner and exclusively uploads sanitized JSON', () => {
  const yaml = createRequire(import.meta.url)('js-yaml')
  const workflow = yaml.load(fs.readFileSync(path.join(REPO, OWN_FILES[0]), 'utf8'))
  assert.deepEqual(workflow.on.push.branches, ['codex/diagnose-windows-installer-1.0'])
  assert.equal(workflow.permissions.contents, 'read')
  assert.deepEqual(Object.keys(workflow.jobs), ['diagnostic'])
  assert.equal(workflow.jobs.diagnostic['runs-on'], 'windows-latest')
  const steps = workflow.jobs.diagnostic.steps
  assert.equal(steps.filter(step => step.run?.endsWith('diagnostic.mjs run')).length, 1)
  assert.equal(steps.find(step => step.uses?.startsWith('actions/upload-artifact')).with.path, '${{ env.D0_PUBLIC_EVIDENCE }}')
})
test('PowerShell syntax and real pure event correlation reject name-only, wrong PID/path/time and partial identities', () => {
  const psPath = path.join(ROOT, 'observe.ps1').replaceAll("'", "''")
  const script = `
$ErrorActionPreference='Stop'
$errors=$null; $tokens=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${psPath}',[ref]$tokens,[ref]$errors)
if($errors.Count) { throw 'POWERSHELL_SYNTAX_FAILED' }
foreach($name in @('Number-Id','Match-Event')) {
  $node=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if($node.Count -ne 1) { throw 'PURE_FUNCTION_NOT_UNIQUE' }
  . ([ScriptBlock]::Create($node[0].Extent.Text))
}
$start=[DateTime]::Parse('2026-10-08T00:00:00Z').ToUniversalTime()
$known=@{'42'=@{rawPath='D:\\owned\\setup.exe';createdUtc=$start.ToString('o')}}
$fields=@{ProcessId='0x2a';AppPath='D:\\owned\\setup.exe';ProcessCreationTime=('0x'+$start.ToFileTimeUtc().ToString('x'))}
$match=Match-Event $fields $start.AddSeconds(2) $known $start $start.AddSeconds(60)
if($match.attribution -ne 'pid-image-creation-time-window') { throw 'MATCH_FAILED' }
$fields.ProcessId='43'
if((Match-Event $fields $start.AddSeconds(2) $known $start $start.AddSeconds(60)).attribution -ne 'missing-or-unowned-fault-pid') { throw 'PID_GUARD_FAILED' }
$fields.ProcessId='42'; $fields.AppPath='D:\\elsewhere\\setup.exe'
if((Match-Event $fields $start.AddSeconds(2) $known $start $start.AddSeconds(60)).attribution -ne 'image-identity-unavailable') { throw 'PATH_GUARD_FAILED' }
$fields.AppPath='D:\\owned\\setup.exe'
if((Match-Event $fields $start.AddSeconds(61) $known $start $start.AddSeconds(60)).attribution -ne 'outside-window') { throw 'TIME_GUARD_FAILED' }
$fields.ProcessCreationTime='0x1'
if((Match-Event $fields $start.AddSeconds(2) $known $start $start.AddSeconds(60)).attribution -ne 'creation-time-mismatch') { throw 'CREATION_GUARD_FAILED' }
$fields.Remove('ProcessCreationTime')
if((Match-Event $fields $start.AddSeconds(2) $known $start $start.AddSeconds(60)).attribution -ne 'pid-image-window; creation-time-unavailable') { throw 'PARTIAL_GUARD_FAILED' }
$fields.Remove('ProcessId')
if((Match-Event $fields $start.AddSeconds(2) $known $start $start.AddSeconds(60)).attribution -ne 'missing-or-unowned-fault-pid') { throw 'WER_NO_PID_GUARD_FAILED' }
Write-Output 'D0_PURE_CORRELATION_OK'
`
  const outcome = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', timeout: 10000, windowsHide: true, cwd: REPO })
  assert.equal(outcome.status, 0, 'PowerShell parser/pure functions failed: ' + (outcome.stderr || outcome.error?.code || 'unknown'))
  assert.match(outcome.stdout, /D0_PURE_CORRELATION_OK/)
})

const exitedReceipt = { succeeded: true, remainingOwned: 0, unknownDescendant: false }
for (const [name, receipt] of [
  ['remaining child', { succeeded: false, remainingOwned: 1, unknownDescendant: false }],
  ['missing count', { succeeded: true, unknownDescendant: false }],
  ['missing success', { remainingOwned: 0, unknownDescendant: false }],
  ['missing ownership verdict', { succeeded: true, remainingOwned: 0 }],
  ['unknown descendant', { ...exitedReceipt, unknownDescendant: true }],
  ['worker alive', { ...exitedReceipt, helperExited: false }],
  ['isolation guard', { ...exitedReceipt, preserveIsolation: true }],
  ['unsafe receipt', { ...exitedReceipt, rawEvent: 'private' }],
]) test('cleanup retains protection: ' + name, async () => {
  let restores = 0
  const result = await cleanupWithEffects({ protectionSetupCalled: true }, {
    observe: async () => receipt, restore: async () => { restores++; return { cleanupSucceeded: true } },
  })
  assert.equal(restores, 0); assert.equal(result.succeeded, false)
  assert.equal(result.restorationAttempted, false); assert.equal(result.protectionState, 'retained')
  assert.doesNotThrow(() => sanitizeEvidence(result))
})
test('observer exception retains protection and sanitized errno', async () => {
  let restores = 0
  const result = await cleanupWithEffects({ protectionSetupCalled: true }, {
    observe: async () => { throw Object.assign(new Error('private path'), { code: 'EACCES' }) },
    restore: async () => { restores++ },
  })
  assert.equal(restores, 0); assert.equal(result.protectionState, 'retained')
  assert.equal(result.records[0].errno, 'EACCES')
})
test('positive owned-exit receipt gates protection restoration in order', async () => {
  const calls = []
  const result = await cleanupWithEffects({ protectionSetupCalled: true }, {
    observe: async () => { calls.push('observe'); return exitedReceipt },
    restore: async () => { calls.push('restore'); return { cleanupSucceeded: true } },
  })
  assert.deepEqual(calls, ['observe', 'restore'])
  assert.equal(result.succeeded, true); assert.equal(result.protectionState, 'restored')
})
test('failed restoration reports unknown protection state, never presumed retained', async () => {
  const result = await cleanupWithEffects({ protectionSetupCalled: true }, {
    observe: async () => exitedReceipt,
    restore: async () => { throw new AcceptanceError('BLOCKED_ENVIRONMENT', 'AUDIT_RESTORE_FAILED') },
  })
  assert.equal(result.succeeded, false); assert.equal(result.protectionState, 'unknown')
  assert.equal(result.records[1].code, 'AUDIT_RESTORE_FAILED')
})
test('no setup means no native cleanup effects', async () => {
  let calls = 0
  const result = await cleanupWithEffects({ protectionSetupCalled: false }, {
    observe: async () => { calls++ }, restore: async () => { calls++ },
  })
  assert.equal(calls, 0); assert.equal(result.protectionState, 'not-started')
})
test('later cleanup success preserves all attempts and original installer crash', async () => {
  const result = { ...record(), protectionSetupCalled: true,
    primary: { kind: 'FAIL_INSTALL', code: 'NSIS_NONZERO_EXIT', stage: 'single-install' } }
  await finishCleanup(result, () => cleanupWithEffects(result, {
    observe: async () => ({ succeeded: false, remainingOwned: 1, unknownDescendant: false }),
    restore: async () => assert.fail('must not restore'),
  }))
  await finishCleanup(result, () => cleanupWithEffects(result, {
    observe: async () => exitedReceipt, restore: async () => ({ cleanupSucceeded: true }),
  }))
  assert.equal(result.cleanup.attempts.length, 2)
  assert.equal(result.cleanup.attempts[0].records[0].remainingOwned, 1)
  assert.equal(result.cleanup.attempts[0].protectionState, 'retained')
  assert.equal(result.cleanup.attempts[1].protectionState, 'restored')
  assert.equal(result.cleanup.succeeded, true)
  assert.equal(result.primary.code, 'NSIS_NONZERO_EXIT')
  assert.equal(result.secondary[0].code, 'D0_CLEANUP_FAILED')
  assert.doesNotThrow(() => sanitizeEvidence(result))
})
test('throwing and malformed cleanup results survive in attempt history', async () => {
  const result = record()
  await finishCleanup(result, async () => { throw Object.assign(new Error('private'), { code: 'EPERM' }) })
  await finishCleanup(result, async () => ({}))
  assert.equal(result.cleanup.attempts.length, 2)
  assert.equal(result.cleanup.attempts[0].records[0].errno, 'EPERM')
  assert.equal(result.cleanup.attempts[1].records[0].code, 'D0_CLEANUP_RECEIPT_INVALID')
})
test('actual parent AcceptanceError preserves fixed classification and native facts', async () => {
  const error = new AcceptanceError('BLOCKED_ENVIRONMENT', 'WFP_AUDIT_UNAVAILABLE')
  error.nativeError = { name: 'Error', code: 'EPERM', exitCode: -1073741819, signal: 'SIGKILL', message: 'private', location: { file: 'C:/private' } }
  const detail = safeError(error, 'protection-setup')
  assert.equal(detail.kind, 'BLOCKED_ENVIRONMENT'); assert.equal(detail.code, 'WFP_AUDIT_UNAVAILABLE')
  assert.equal(detail.errno, 'EPERM'); assert.equal(detail.exitCode, -1073741819); assert.equal(detail.signal, 'SIGKILL')
  assert.equal(JSON.stringify(detail).includes('private'), false)
  const { api, calls } = effects(); api.setup = async () => { throw error }
  const result = await runOnce(record(), api)
  assert.equal(result.primary.code, 'WFP_AUDIT_UNAVAILABLE'); assert.equal(calls.includes('install'), false)
})
test('fixed downloader codes survive but arbitrary error codes and properties do not', () => {
  for (const [code, kind] of [['DOWNLOAD_TIMEOUT', 'BLOCKED_ENVIRONMENT'], ['DOWNLOAD_HASH_MISMATCH', 'BLOCKED_INPUT']]) {
    const detail = safeError(Object.assign(new Error('private'), { upgradeCode: code }), 'download')
    assert.equal(detail.code, code); assert.equal(detail.kind, kind)
  }
  for (const error of [
    new AcceptanceError('BLOCKED_ENVIRONMENT', 'PRIVATE_ACCOUNT_1234'),
    new AcceptanceError('PASS', 'WFP_AUDIT_UNAVAILABLE'),
    Object.assign(new Error('private'), { kind: 'toString', code: 'PRIVATE_ACCOUNT_1234', upgradeCode: 'SECRET_1234',
      nativeError: { name: 'PrivateName', code: 'SECRET_1234', exitCode: Infinity, signal: 'PRIVATE' } }),
  ]) {
    const detail = safeError(error, 'observer')
    assert.equal(detail.kind, 'DIAGNOSTIC_ERROR'); assert.equal(detail.code, 'D0_TOOL_ERROR')
    assert.equal(detail.exitCode, 'unavailable'); assert.equal(detail.signal, 'unavailable')
    assert.doesNotThrow(() => sanitizeEvidence(detail))
    assert.doesNotMatch(JSON.stringify(detail), /1234|PrivateName|private/)
  }
})
