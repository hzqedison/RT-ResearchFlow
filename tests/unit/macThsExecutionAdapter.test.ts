import { afterEach, describe, expect, it, vi } from 'vitest'
import childProcess from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { createMacThsExecutionAdapter, type MacThsExecutionAdapter } from '../../electron/main/services/macThsExecutionAdapter'
import { MacThsIntentStore, type IntentSnapshot } from '../../electron/main/services/macThsIntentStore'
import { verifyExecutorExit } from '../../electron/main/services/macThsRecoveryCoordinator'
import { macThsNativeScript, macThsScript } from '../../electron/main/services/macThsScripts'
import {
  createNativeObservationFixture, decodeNativeObservation, nativeCompatibility,
  type NativeScriptRequest, type NativeObservationV1, type NativeTarget, type NativeAccountWitness,
} from '../../electron/shared/macThsNativeProtocol'

const ACCOUNT: NativeAccountWitness = { kind: 'fund_account', value: 'FIXTURE00001234', broker: 'citics', selected: true }
const DATE = '2026-10-08'
const ORDER = { symbol: '600000', market: 'SH' as const, side: 'buy' as const, priceCents: 1000, quantity: 100 }
const TARGET: NativeTarget = { ...ORDER, contractNo: 'TEST-NEW', tradingDate: DATE, observation: 'accepted',
  filledQuantity: null, cancelledQuantity: null }
const facts = { account: ACCOUNT, clientVersion: '9.0.0', tradingDate: DATE }
const directories: string[] = []
const adapters: MacThsExecutionAdapter[] = []
const stores: { store: MacThsIntentStore; adapter: MacThsExecutionAdapter }[] = []
const nativeTempRoot = realpathSync.native(tmpdir())
function directory(): string {
  const path = mkdtempSync(join(nativeTempRoot, 'rt-native-adapter-'))
  directories.push(path)
  return path
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const adapter of adapters.splice(0)) await adapter.stopOwned()
  for (const { store, adapter } of stores.splice(0)) await store.shutdown(adapter.coordinator)
  for (const path of directories.splice(0)) {
    if (dirname(resolve(path)) !== nativeTempRoot || !path.includes('rt-native-adapter-')) throw new Error('UNOWNED_TEST_DIRECTORY')
    rmSync(path, { recursive: true, force: true })
  }
})
function request(action: NativeScriptRequest['action'] = 'observe_context'): NativeScriptRequest {
  return { nonce: randomUUID(), action, mode: 'live', expectedAccount: action === 'execute' || action === 'observe_receipt' ? ACCOUNT : null,
    expectedClientVersion: action === 'execute' || action === 'observe_receipt' ? facts.clientVersion : null,
    expectedDate: action === 'execute' || action === 'observe_receipt' ? DATE : null,
    order: action === 'execute' || action === 'observe_receipt' ? ORDER : null,
    contractNo: action === 'observe_cancel_target' ? 'TEST-NEW' : null, beforeContracts: null }
}
function packet(q: NativeScriptRequest): NativeObservationV1 {
  return createNativeObservationFixture(q, { ...facts, ...(q.action === 'observe_context' ? {} : { target: TARGET }) })
}
function harmless(code: string) { return { executable: process.execPath, args: ['-e', code] } }
function output(value: unknown) { return harmless('process.stdout.write(' + JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value)) + ')') }
function spyOnActualSpawn() {
  // Node's exported spawn may already be bound by ESM consumers. Observe the
  // actual ChildProcess startup method, leaving its real implementation intact.
  return vi.spyOn(childProcess.ChildProcess.prototype as unknown as { spawn(options: unknown): unknown }, 'spawn')
}
function adapter(command: (q: NativeScriptRequest, script: string, auxiliary?: string) => ReturnType<typeof harmless> = q => output(packet(q)),
  path = directory()): MacThsExecutionAdapter {
  const result = createMacThsExecutionAdapter({ directory: path, testHooks: { platform: 'darwin', command } })
  adapters.push(result)
  return result
}
async function snapshot(a: MacThsExecutionAdapter): Promise<IntentSnapshot> {
  const observed = await a.observeContext('live')
  if (!observed.ok) throw new Error(observed.code)
  const now = Date.now()
  return { schemaVersion: 1, executor: 'mac-local-ths', mode: 'live', action: 'submit', ...ORDER,
    maxNotionalCents: 100_000, cancelTarget: null, accountContext: observed.value.accountContext,
    input: { source: 'manual', capturedAt: now }, createdAt: now, expiresAt: now + 120_000 }
}
function limits(milliseconds = 20_000) { return { expiresAt: Date.now() + milliseconds, deadlineMonotonic: performance.now() + milliseconds } }
function launch(a: MacThsExecutionAdapter, s: IntentSnapshot, milliseconds = 20_000) {
  const prepared = a.prepareExecution(s, limits(milliseconds))
  // Test-only stand-in for an already checked F3 sentinel; real store launch is covered separately below.
  const instance = a.coordinator.launchExecutor(prepared.executable, prepared.args, {}, () => {})
  return { prepared, ...instance }
}

/** Synthetic AX surface. This runs the production JXA source, not a second implementation of its rules. */
function ax(options: { masked?: boolean; ambiguous?: boolean; noDate?: boolean; sheetAfterSubmit?: boolean;
  wrongReadback?: boolean; duplicateNew?: boolean; receiptOnly?: boolean; disabled?: boolean;
  cancel?: boolean; retainedSelection?: boolean; unknownSelection?: boolean; conflictingSelection?: boolean } = {}) {
  const clicks: string[] = []
  let submitted = false
  const selectedRows = new Set<string>(options.retainedSelection ? ['TEST-OLD'] : [])
  function node(attributes: Record<string, unknown> = {}, initial = '') {
    let current = initial
    const result: any = { attributes: { byName: (name: string) => ({ value: () => attributes[name] ?? null }) }, exists: () => true }
    Object.defineProperty(result, 'value', { get: () => () => current,
      set: (v: string) => { current = options.wrongReadback && v === ORDER.symbol ? '600001' : v } })
    return result
  }
  const account = () => node({ AXDescription: '资金账号', AXValue: options.masked ? '****1234' : ACCOUNT.value, AXSelected: true })
  const texts = [node({}, '中信证券合成测试'), node({ AXDescription: '证券市场', AXRole: 'AXStaticText', AXValue: '上海' })]
  if (!options.noDate) texts.push(node({ AXDescription: '交易日期', AXRole: 'AXStaticText', AXValue: DATE }))
  const headings = ['合同编号', '证券代码', '委托价格', '委托数量', '买卖标志',
    options.noDate ? '未知日期' : '交易日期', '证券市场', '委托状态']
  const row = (id: string) => ({
    attributes: { byName: (name: string) => ({ value: () => name === 'AXSelected'
      ? options.unknownSelection && id === 'TEST-OLD' ? null : selectedRows.has(id)
      : name === 'AXValue' && options.conflictingSelection && id === 'TEST-TARGET' ? 0 : null }) },
    select: () => { if (!options.retainedSelection) selectedRows.clear(); selectedRows.add(id) },
    staticTexts: () => [id, ORDER.symbol, '10.00', '100', '买入', DATE, '上海',
      options.cancel && submitted && id === 'TEST-TARGET' ? '已撤' : '已报'].map(v => node({}, v)),
  })
  const table = {
    groups: () => [{ buttons: () => headings.map(title => node({ AXTitle: title })) }],
    rows: () => [row('TEST-OLD'), ...(options.cancel ? [row('TEST-TARGET')] : []),
      ...(!options.cancel && ((submitted && !options.sheetAfterSubmit) || options.receiptOnly) ? [row('TEST-NEW')] : []),
      ...(submitted && options.duplicateNew ? [row('TEST-OTHER')] : [])],
  }
  const buttons: any = { byName: (name: string) => {
    const exists = ['A股', '模拟', '买入', '卖出', '确定买入', '撤单'].includes(name)
    return { ...node({ AXSelected: name === 'A股', AXEnabled: !options.disabled }), exists: () => exists,
      click: () => { clicks.push(name); if (name === '确定买入' || name === '撤单') submitted = true } }
  } }
  const w = { buttons, staticTexts: () => texts, popUpButtons: () => options.ambiguous ? [account(), account()] : [account()],
    comboBoxes: () => [], textFields: () => fields, sheets: () => submitted && options.sheetAfterSubmit ? [{}] : [],
    scrollAreas: () => [{}, {}, {}, { tables: () => [table] }] }
  const fields = [node({}, '10.00'), node({}, ORDER.symbol), node({}, '100')]
  const app = { version: () => facts.clientVersion }
  const system = { processes: { byName: () => ({ exists: () => true, windows: () => [w] }) } }
  return { clicks, run(q: NativeScriptRequest, script = macThsNativeScript(q)) {
    const raw = runInNewContext(script, { Application: (name: string) => name === 'System Events' ? system : app, delay: () => {} },
      { timeout: 1000 })
    return decodeNativeObservation(raw, q)
  } }
}

describe('native protocol boundaries', () => {
  it('constructs one strictly decoded fixture and preserves unobserved quantities as null', () => {
    const q = request('execute'), p = packet(q)
    expect(decodeNativeObservation(JSON.stringify(p), q).target).toEqual(TARGET)
    expect(p.target?.filledQuantity).toBeNull()
    expect(p.target?.cancelledQuantity).toBeNull()
  })
  it.each(['LIVE_ACCEPTED|123', 'READY', '{}', '[1]', 'null'])('rejects nonprotocol %s', raw => {
    expect(() => decodeNativeObservation(raw, request())).toThrow('NATIVE_PROTOCOL_INVALID')
  })
  it('rejects excess bytes and malformed UTF-8', () => {
    expect(() => decodeNativeObservation(' '.repeat(4097), request())).toThrow()
    expect(() => decodeNativeObservation(Uint8Array.from([0xc3, 0x28]), request())).toThrow()
  })
  it.each(['nonce', 'action', 'extra', 'date', 'quantities', 'baseline', 'phase', 'account'])('rejects inconsistent %s', field => {
    const q = request('execute'), p: any = packet(q)
    if (field === 'nonce') p.nonce = randomUUID()
    if (field === 'action') p.action = 'observe_receipt'
    if (field === 'extra') p.stderr = 'SENSITIVE_RAW'
    if (field === 'date') p.target.tradingDate = '2026-02-30'
    if (field === 'quantities') { p.target.filledQuantity = 100; p.target.cancelledQuantity = 1 }
    if (field === 'baseline') p.beforeContracts = ['DUP', 'DUP']
    if (field === 'phase') p.phase = 'before_submit'
    if (field === 'account') p.account.value = '****1234'
    expect(() => decodeNativeObservation(JSON.stringify(p), q)).toThrow('NATIVE_PROTOCOL_INVALID')
  })
  it.each(['top', 'escaped-top', 'nested', 'escaped-nested'])('rejects duplicate decoded JSON members: %s', kind => {
    const q = request('execute'), raw = JSON.stringify(packet(q))
    const duplicate = kind === 'top' ? raw.replace('"submitTouched":true', '"submitTouched":false,"submitTouched":true')
      : kind === 'escaped-top' ? raw.replace('"submitTouched":true', '"submitTouched":false,"submit\\u0054ouched":true')
        : kind === 'nested' ? raw.replace('"selected":true', '"selected":false,"selected":true')
          : raw.replace('"selected":true', '"selected":false,"selec\\u0074ed":true')
    expect(duplicate).not.toBe(raw)
    expect(() => decodeNativeObservation(duplicate, q)).toThrow('NATIVE_PROTOCOL_INVALID')
  })
  it('keeps valid escaped keys and values without duplicate members', () => {
    const q = request('execute'), raw = JSON.stringify(packet(q)).replace('"nonce":', '"no\\u006ece":').replace('9.0.0', '9\\u002e0.0')
    expect(decodeNativeObservation(raw, q)).toEqual(packet(q))
  })
  it.each(['symbol', 'market', 'side', 'priceCents', 'quantity', 'missing', 'headers', 'date', 'mode'])('rejects incoherent accepted observation: %s', kind => {
    const q = request('execute'), p = packet(q)
    if (kind === 'missing') { p.readback = null; p.fields.readback = 'missing' }
    else if (kind === 'headers') p.fields.headers = 'missing'
    else if (kind === 'date') p.tradingDate = '2026-10-09'
    else if (kind === 'mode') p.mode = 'simulation'
    else Object.assign(p.readback!, { [kind]: { symbol: '600001', market: 'SZ', side: 'sell', priceCents: 999, quantity: 200 }[kind] })
    expect(() => decodeNativeObservation(JSON.stringify(p), q)).toThrow('NATIVE_PROTOCOL_INVALID')
  })
})

describe('legacy AppleScript cancel template guards (structural, not native execution)', () => {
  it.each([['cancelLive', 'live'], ['cancelSimulation', 'simulation']] as const)('%s checks exclusive matching selection immediately before cancel', (action, mode) => {
    const script = macThsScript(action, mode, undefined, 'LEGACY-TARGET')
    const start = script.indexOf('on exclusiveCancelTarget(')
    const end = script.indexOf('end exclusiveCancelTarget', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const helper = script.slice(start, end)
    expect(helper).toContain('repeat with areaNumber in {4, 5}')
    expect(helper).toContain('if idColumns > 1 then return false')
    expect(helper).toContain('if recognizedTables > 1 then return false')
    expect(helper).toContain('repeat with candidateRow in rows of theTable')
    expect(helper).toContain('if (count of cellValues) < idColumn then return false')
    expect(helper).toContain('if identifier is targetContract then set matchingTargets to matchingTargets + 1')
    expect(helper).toContain('set rowIsSelected to value of attribute "AXSelected" of candidateRow')
    expect(helper).toContain('if (class of rowIsSelected) is not boolean then return false')
    expect(helper).toContain('if identifier is not targetContract then return false')
    expect(helper).toContain('return recognizedTables is 1 and matchingTargets is 1 and selectedCount is 1 and selectedTarget')
    expect(helper).toMatch(/on error\s+return false/)
    expect(helper).not.toMatch(/\bselect\b|\bclick\b/)
    const selection = script.indexOf('select item 1 of matchedRows')
    const check = 'if not my exclusiveCancelTarget(theWindow, "LEGACY-TARGET") then return "TABLE_UNSUPPORTED"'
    const guard = script.indexOf(check, selection)
    const click = script.indexOf('click button "撤单" of theWindow', guard)
    expect(selection).toBeGreaterThan(end)
    expect(guard).toBeGreaterThan(selection)
    expect(click).toBeGreaterThan(guard)
    expect(script.slice(guard + check.length, click).trim()).toBe('set submitTouched to true')
    expect(script.slice(selection, guard)).toContain('if exists sheet 1 of theWindow then return "NATIVE_CONFIRMATION_REQUIRED"')
    expect(script.match(/click button "撤单" of theWindow/g)).toHaveLength(1)
    expect(script).not.toContain('click button "确认" of sheet 1')
  })
})

describe('production AX template via synthetic accessible surface', () => {
  it('reads explicit selected full account, mode, version and date without clicking', () => {
    const surface = ax(), p = surface.run(request())
    expect(p.code).toBe('READY')
    expect(p.account).toEqual(ACCOUNT)
    expect(p.clientVersion).toBe(facts.clientVersion)
    expect(p.tradingDate).toBe(DATE)
    expect(surface.clicks).toEqual([])
  })
  it.each([{ masked: true }, { ambiguous: true }])('does not promote masked/ambiguous account %j', options => {
    const p = ax(options).run(request())
    expect(p.code).toBe('ACCOUNT_IDENTITY_UNAVAILABLE')
    expect(p.account).toBeNull()
    expect(p.fields.account).toBe(options.masked ? 'masked_only' : 'ambiguous')
  })
  it('never substitutes wall-clock date when an explicit observed date is missing', () => {
    const p = ax({ noDate: true }).run(request())
    expect(p.code).toBe('TRADING_DATE_UNAVAILABLE')
    expect(p.tradingDate).toBeNull()
  })
  it('reads a complete cancel target without selection/submission', () => {
    const q = request('observe_cancel_target'); q.contractNo = 'TEST-OLD'
    const surface = ax(), p = surface.run(q)
    expect(p.code).toBe('TARGET_OBSERVED')
    expect(p.target).toEqual({ ...TARGET, contractNo: 'TEST-OLD' })
    expect(surface.clicks).toEqual([])
  })
  it('fills and reads actual fields, submits once, and identifies one new complete receipt', () => {
    const surface = ax(), p = surface.run(request('execute'))
    expect(p.code).toBe('LIVE_ACCEPTED')
    expect(p.readback).toEqual(ORDER)
    expect(p.target).toEqual(TARGET)
    expect(p.beforeContracts).toEqual(['TEST-OLD'])
    expect(p.contractMatch).toBe('unique_new')
    expect(surface.clicks).toEqual(['买入', '确定买入'])
  })
  it('never handles a broker confirmation sheet', () => {
    const surface = ax({ sheetAfterSubmit: true }), p = surface.run(request('execute'))
    expect(p.code).toBe('NATIVE_CONFIRMATION_REQUIRED')
    expect(p.submitTouched).toBe(true)
    expect(p.target).toBeNull()
    expect(surface.clicks).toEqual(['买入', '确定买入'])
    expect(nativeCompatibility(p).nextAction).toBe('review_native_dialog')
  })
  it('refuses readback mismatch before submission', () => {
    const surface = ax({ wrongReadback: true }), p = surface.run(request('execute'))
    expect(p.code).toBe('READBACK_MISMATCH')
    expect(p.submitTouched).toBe(false)
    expect(surface.clicks).toEqual(['买入'])
  })
  it('refuses disabled submit control', () => {
    const surface = ax({ disabled: true }), p = surface.run(request('execute'))
    expect(p.code).toBe('ORDER_CONTROL_DISABLED')
    expect(p.submitTouched).toBe(false)
    expect(surface.clicks).toEqual(['买入'])
  })
  it('does not pick the first of two new matching contracts', () => {
    const p = ax({ duplicateNew: true }).run(request('execute'))
    expect(p.code).toBe('RECEIPT_UNKNOWN')
    expect(p.fields.receipt).toBe('ambiguous')
  })
  it('receipt-only observation has no click and uses the earlier baseline', () => {
    const q = request('observe_receipt'); q.beforeContracts = ['TEST-OLD']
    const surface = ax({ receiptOnly: true }), p = surface.run(q)
    expect(p.target?.contractNo).toBe('TEST-NEW')
    expect(p.contractMatch).toBe('unique_new')
    expect(surface.clicks).toEqual([])
  })
  it('cancels exactly one fully matched, exclusively selected target', () => {
    const q = request('execute'); q.contractNo = 'TEST-TARGET'
    const surface = ax({ cancel: true }), p = surface.run(q)
    expect(surface.clicks).toEqual(['撤单'])
    expect(p.code).toBe('LIVE_CANCELLED')
    expect(p.contractMatch).toBe('unique_target')
    expect(p.target).toEqual({ ...TARGET, contractNo: 'TEST-TARGET', observation: 'cancelled' })
  })
  it.each([{ retainedSelection: true }, { unknownSelection: true }, { conflictingSelection: true }])('does not cancel with ambiguous row selection %j', option => {
    const q = request('execute'); q.contractNo = 'TEST-TARGET'
    const surface = ax({ cancel: true, ...option }), p = surface.run(q)
    expect(p.code).toBe('TARGET_UNVERIFIED')
    expect(p.submitTouched).toBe(false)
    expect(surface.clicks).toEqual([])
  })
})

describe('owned harmless children, production decoder and store launch', () => {
  it('returns only a hashed/masked account context with actual close proof retained internally', async () => {
    const a = adapter(), result = await a.observeContext('live')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.accountContext.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(result.value.accountContext.label).toBe('**1234')
    expect(JSON.stringify(result)).not.toContain(ACCOUNT.value)
    expect(a.hasUnprovenOwned()).toBe(false)
  })
  it('passes the real store claim/launch/outcome/exit lifecycle with one harmless execution', async () => {
    const path = directory(), store = MacThsIntentStore.open({ directory: path, initialize: true })
    let executed = 0
    const a = adapter((q, script) => { if (q.action === 'execute') executed++; return output(ax().run(q, script)) }, path)
    stores.push({ store, adapter: a })
    const s = await snapshot(a)
    store.enableLiveSession({ accountDigest: s.accountContext.digest, observedAt: s.accountContext.capturedAt })
    const intent = store.createIntent(randomUUID(), s)
    const confirmed = store.confirmIntent(intent.intentId, intent.snapshotHash!, intent.revision, {
      method: 'native_dialog', sessionId: store.sessionId, confirmedAt: Date.now(), expiresAt: s.expiresAt,
      additionalOrderAcknowledged: false,
    })
    const observation = await a.observeContext()
    if (!observation.ok) throw new Error(observation.code)
    const prepared = a.prepareExecution(s, limits())
    const claim = store.claimExecution(confirmed.intentId, confirmed.snapshotHash!, confirmed.revision, randomUUID(),
      { accountDigest: observation.value.accountContext.digest, observedAt: observation.value.observedAt })
    expect(claim.claimed).toBe(true)
    const spawned = spyOnActualSpawn()
    const owned = store.launchExecutor(claim.attemptId!, a.coordinator, prepared.executable, prepared.args)
    const result = await a.awaitExecution(owned.instanceId, prepared)
    expect(result.code).toBe('LIVE_ACCEPTED')
    expect(result.evidence?.source).toBe('ths_ui')
    expect(result.exitProof).not.toBeNull()
    verifyExecutorExit(result.exitProof!, owned.instanceId)
    store.recordExecutorExit(claim.attemptId!, result.exitProof!)
    const recorded = store.recordOutcome(claim.intent.intentId, claim.intent.snapshotHash!, claim.intent.revision, claim.attemptId!, result.evidence!)
    expect(spawned).toHaveBeenCalledTimes(1)
    expect(recorded.state).toBe('ACCEPTED_OBSERVED')
    expect(executed).toBe(1)
    expect(a.hasUnprovenOwned()).toBe(false)
    expect(JSON.stringify(store.inspect())).not.toContain(ACCOUNT.value)
  })
  it('requires store guard, exact prepared arguments and original deadline at launch', async () => {
    const a = adapter(), s = await snapshot(a), p = a.prepareExecution(s, limits())
    expect(() => a.coordinator.launchExecutor(p.executable, p.args)).toThrow('STORE_LAUNCH_REQUIRED')
    expect(() => a.coordinator.launchExecutor(p.executable, [...p.args], {}, () => {})).toThrow('UNOWNED_EXECUTOR')
    const sentinel = new Error('EXACT_F3_SENTINEL')
    expect(() => a.coordinator.launchExecutor(p.executable, p.args, {}, () => { throw sentinel })).toThrow(sentinel)
    expect(a.hasUnprovenOwned()).toBe(false)
    expect(() => a.prepareExecution(s, { expiresAt: Date.now() - 1, deadlineMonotonic: performance.now() + 1000 })).toThrow('EXECUTION_PERMISSION_EXPIRED')
    expect(() => a.prepareExecution(s, { expiresAt: Date.now() + 1000, deadlineMonotonic: performance.now() - 1 })).toThrow('EXECUTION_PERMISSION_EXPIRED')
  })
  it('preserves the exact final F3 sentinel even when the adapter deadline also expired', async () => {
    const a = adapter(), s = await snapshot(a), prepared = a.prepareExecution(s, limits(30))
    await new Promise(resolve => setTimeout(resolve, 60))
    const sentinel = Object.assign(new Error('EXECUTION_PERMISSION_EXPIRED'), { code: 'EXECUTION_PERMISSION_EXPIRED' })
    const guard = vi.fn(() => { throw sentinel })
    const spawned = spyOnActualSpawn()
    let thrown: unknown
    try { a.coordinator.launchExecutor(prepared.executable, prepared.args, {}, guard) } catch (error) { thrown = error }
    expect(thrown).toBe(sentinel)
    expect(guard).toHaveBeenCalledTimes(1)
    expect(spawned).not.toHaveBeenCalled()
    expect(a.hasUnprovenOwned()).toBe(false)
  })
  it('lets F3 record not_started and shut down when real SQLite launch-pending work burns the original ticket', async () => {
    const path = directory()
    let expiresAt = 0, burned = 0
    let readAttempt = (_id: string): { executor_state: string; executor_instance: string | null } => { throw new Error('DB_NOT_OPEN') }
    let isOpen = () => false
    const store = MacThsIntentStore.open({ directory: path, initialize: true, testHooks: { onDatabaseOpen(db) {
      isOpen = () => db.open
      readAttempt = id => db.prepare('SELECT executor_state,executor_instance FROM attempts WHERE attempt_id=?').get(id) as ReturnType<typeof readAttempt>
      db.function('burn_native_ticket', () => {
        burned++
        const remaining = expiresAt - Date.now() + 30
        if (remaining < 1 || remaining > 3000) throw new Error('INVALID_BURN_WINDOW')
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, remaining)
        return 0
      })
      db.exec("CREATE TEMP TRIGGER native_burn_ticket BEFORE UPDATE OF executor_state ON attempts WHEN NEW.executor_state='launch_pending' BEGIN SELECT burn_native_ticket(); END")
    } } })
    const a = adapter(q => output(packet(q)), path), fixture = { store, adapter: a }
    stores.push(fixture)
    const s = await snapshot(a)
    store.enableLiveSession({ accountDigest: s.accountContext.digest, observedAt: s.accountContext.capturedAt })
    const intent = store.createIntent(randomUUID(), s)
    expiresAt = Date.now() + 2000
    const confirmed = store.confirmIntent(intent.intentId, intent.snapshotHash!, intent.revision, {
      method: 'native_dialog', sessionId: store.sessionId, confirmedAt: Date.now(), expiresAt,
      additionalOrderAcknowledged: false,
    })
    const observation = await a.observeContext()
    if (!observation.ok) throw new Error(observation.code)
    const prepared = a.prepareExecution(s, { expiresAt, deadlineMonotonic: performance.now() + expiresAt - Date.now() })
    const claim = store.claimExecution(confirmed.intentId, confirmed.snapshotHash!, confirmed.revision, randomUUID(),
      { accountDigest: observation.value.accountContext.digest, observedAt: observation.value.observedAt })
    expect(claim.claimed).toBe(true)
    const spawned = spyOnActualSpawn()
    expect(() => store.launchExecutor(claim.attemptId!, a.coordinator, prepared.executable, prepared.args)).toThrow('EXECUTION_PERMISSION_EXPIRED')
    expect(burned).toBe(1)
    expect(spawned).not.toHaveBeenCalled()
    expect(readAttempt(claim.attemptId!)).toEqual({ executor_state: 'not_started', executor_instance: null })
    expect(store.inspect().intents.find(row => row.intentId === intent.intentId)?.state).toBe('UNKNOWN')
    expect(a.hasUnprovenOwned()).toBe(false)
    await store.shutdown(a.coordinator)
    expect(isOpen()).toBe(false)
    stores.splice(stores.indexOf(fixture), 1)
  })
  it('keeps native confirmation UNKNOWN, then permits strictly read-only receipt observation', async () => {
    const seen: string[] = []
    const a = adapter(q => {
      seen.push(q.action)
      return output(q.action === 'execute' ? createNativeObservationFixture(q, facts,
        { code: 'NATIVE_CONFIRMATION_REQUIRED', beforeContracts: ['TEST-OLD'] }) : packet(q))
    })
    const s = await snapshot(a), owned = launch(a, s), result = await a.awaitExecution(owned.instanceId, owned.prepared)
    expect(result.evidence).toBeNull()
    expect(result.code).toBe('NATIVE_CONFIRMATION_REQUIRED')
    const observed = await a.observeReceipt(s)
    expect(observed.evidence?.source).toBe('ths_ui')
    expect(seen).toEqual(['observe_context', 'execute', 'observe_receipt'])
  })
  it('never renews an absolute deadline between preparation and actual launch', async () => {
    const a = adapter(), s = await snapshot(a), prepared = a.prepareExecution(s, limits(30))
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(() => a.coordinator.launchExecutor(prepared.executable, prepared.args, {}, () => {})).toThrow('EXECUTION_PERMISSION_EXPIRED')
    expect(a.hasUnprovenOwned()).toBe(false)
  })
  it.each(['legacy', 'stderr', 'overflow', 'exit', 'account'])('never promotes %s to order evidence', async variant => {
    const a = adapter(q => {
      if (q.action !== 'execute') return output(packet(q))
      if (variant === 'legacy') return output('LIVE_ACCEPTED|TEST-NEW')
      if (variant === 'stderr') return harmless('process.stderr.write("SENSITIVE_ACCOUNT_TOKEN");process.stdout.write(' + JSON.stringify(JSON.stringify(packet(q))) + ')')
      if (variant === 'overflow') return harmless('process.stdout.write("x".repeat(4097));setInterval(()=>{},1000)')
      if (variant === 'exit') return harmless('process.stdout.write(' + JSON.stringify(JSON.stringify(packet(q))) + ');process.exitCode=65')
      return output(createNativeObservationFixture(q, { ...facts, account: { ...ACCOUNT, value: 'OTHER00001234' }, target: TARGET }))
    })
    const s = await snapshot(a), owned = launch(a, s), result = await a.awaitExecution(owned.instanceId, owned.prepared)
    expect(result.evidence).toBeNull()
    expect(JSON.stringify(result)).not.toContain('SENSITIVE_ACCOUNT_TOKEN')
    expect(a.hasUnprovenOwned()).toBe(false)
  })
  it('deadline stops only the owned child and never maps timeout to NOT_SUBMITTED', async () => {
    const a = adapter(q => q.action === 'execute' ? harmless('setInterval(()=>{},1000)') : output(packet(q)))
    const s = await snapshot(a), owned = launch(a, s, 250)
    expect(a.hasUnprovenOwned()).toBe(true)
    const result = await a.awaitExecution(owned.instanceId, owned.prepared)
    expect(result.code).toBe('NATIVE_TIMEOUT')
    expect(result.evidence).toBeNull()
    expect(result.exitProof).not.toBeNull()
    verifyExecutorExit(result.exitProof!, owned.instanceId)
    expect(a.hasUnprovenOwned()).toBe(false)
  })
  it.each(['symbol', 'missing', 'headers', 'duplicate'])('rejects owned child evidence with %s conflict and still proves actual exit', async kind => {
    const a = adapter(q => {
      const p = packet(q)
      if (q.action !== 'execute') return output(p)
      if (kind === 'symbol') p.readback = { ...ORDER, symbol: '600001' }
      if (kind === 'missing') { p.readback = null; p.fields.readback = 'missing' }
      if (kind === 'headers') p.fields.headers = 'ambiguous'
      if (kind === 'duplicate') return output(JSON.stringify(p).replace('"submitTouched":true', '"submitTouched":false,"submitTouched":true'))
      return output(p)
    })
    const s = await snapshot(a), owned = launch(a, s), result = await a.awaitExecution(owned.instanceId, owned.prepared)
    expect(result.evidence).toBeNull()
    expect(result.code).toBe('NATIVE_PROTOCOL_INVALID')
    expect(result.exitProof).not.toBeNull()
    verifyExecutorExit(result.exitProof!, owned.instanceId)
    expect(a.hasUnprovenOwned()).toBe(false)
  })
  it('auxiliary view output is bounded and cannot become order evidence', async () => {
    const a = adapter((_q, _script, action) => output(action === 'queryOrders' ? 'VIEW_OPENED' : 'LIVE_ACCEPTED|TEST-NEW'))
    expect((await a.performAuxiliary('queryOrders', 'live')).code).toBe('VIEW_OPENED')
    expect((await a.performAuxiliary('queryDeals', 'live')).code).toBe('RECEIPT_UNKNOWN')
  })
})
