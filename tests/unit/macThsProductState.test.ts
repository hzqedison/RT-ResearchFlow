import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
// Minimal deterministic hook host: executes this component's handlers/effects,
// not a DOM renderer, native bridge, or substitute for device acceptance.
const hooks = vi.hoisted(() => ({ current: null as null | {
  state(initial: unknown): unknown; ref(initial: unknown): unknown
  effect(fn: () => unknown, deps?: unknown[]): void; callback(fn: unknown, deps?: unknown[]): unknown
} }))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual,
    useState: (initial: unknown) => hooks.current ? hooks.current.state(initial) : actual.useState(initial),
    useRef: (initial: unknown) => hooks.current ? hooks.current.ref(initial) : actual.useRef(initial),
    useEffect: (fn: () => void, deps?: unknown[]) => hooks.current ? hooks.current.effect(fn, deps) : actual.useEffect(fn, deps),
    useCallback: (fn: (...args: unknown[]) => unknown, deps: unknown[]) => hooks.current ? hooks.current.callback(fn, deps) : actual.useCallback(fn, deps),
  }
})
import { MAC_THS_SERVICE_STATES, type MacThsConfirmation, type MacThsProductState,
  type MacThsRequest } from '../../electron/shared/macThsTypes'
import MacTradingPanel from '../../src/components/MacTradingPanel'
import { acceptMacThsStateRead, beginMacThsStateRead, bindMacThsRequestId, buildMacThsProductView,
  createMacThsStateCursor, currentMacThsActionResponse, isMacThsProductState, isMacThsTradeRequest,
  macThsCapabilityHints, macThsCodeMessage, macThsConfirmationMatches, macThsIntentLabel,
  needsMacThsIntentReview, safeMacThsProductStateDiagnostic } from '../../src/components/macThsProductState'

const UUID = '12345678-1234-4234-8234-123456789012'
const HASH = 'a'.repeat(64)
function intent(overrides: Partial<MacThsProductState['intents'][number]> = {}): MacThsProductState['intents'][number] {
  return { intentId: UUID, requestId: UUID, snapshotHash: HASH, revision: 1, state: 'PREPARED',
    gateReleased: false, executionForbidden: false, recoveryQuarantine: false, recoveryId: null,
    mode: 'live', action: 'submit', symbol: '600000', market: 'SH', side: 'buy', price: '10.00',
    quantity: 100, maxNotional: '1000.00', accountLabel: '本机账户 A', contractNo: null,
    tradingDate: '2026-10-08', ...overrides }
}
function state(overrides: Partial<MacThsProductState> = {}): MacThsProductState {
  return { schemaVersion: 1, adapterVersion: '3', sessionId: 'session-a', stateSequence: 10,
    serviceState: 'READY_DISABLED', code: 'READY', recoveryReason: null, liveEnabled: false,
    executorState: 'idle', unknownPending: false, canPrepare: true, canConfirm: false,
    canRecover: false, canReview: false, canInitialize: false, canProvisionLegacy: false, coverage: null, intents: [],
    recovery: null, capabilities: null, ...overrides }
}
function view(s: MacThsProductState | null, overrides = {}) {
  return buildMacThsProductView(s, { isMac: true, synchronized: true, ...overrides })
}
function ticket(overrides: Partial<MacThsConfirmation> = {}): MacThsConfirmation {
  return { token: UUID, title: '本人确认', message: '核对原意图', confirmLabel: '继续',
    sessionId: 'session-a', expiresAt: 2000,
    intentBinding: { intentId: UUID, snapshotHash: HASH, expectedRevision: 1 }, ...overrides }
}
function confirmationState(overrides: Partial<MacThsProductState> = {}) {
  return state({ serviceState: 'AWAITING_CONFIRMATION', canConfirm: true, intents: [intent()], ...overrides })
}
function confirmationRequest(action: MacThsRequest['action'] = 'submitLive'): MacThsRequest {
  return { action, mode: action.includes('Simulation') ? 'simulation' : 'live', requestId: UUID }
}
afterEach(() => { hooks.current = null; vi.unstubAllGlobals() })

describe('authoritative product gates, not last execute success', () => {
  it.each(MAC_THS_SERVICE_STATES)('renders explicit %s without claiming completion', serviceState => {
    const v = view(state({ serviceState }))
    expect(v.phase).toBe(serviceState)
    expect(v.title).not.toBe('原因未知')
    expect(v.description.length).toBeGreaterThan(8)
    if (!['READY_DISABLED', 'READY_ENABLED'].includes(serviceState)) expect(v.canSubmit).toBe(false)
  })
  it('allows disabled-session form preparation, never live submission or simulation', () => {
    const v = view(state())
    expect(v.canPreview).toBe(true)
    expect(v.canEnable).toBe(true)
    expect(v.canSubmit).toBe(false)
    expect(v.title).toContain('真实会话关闭')
    expect(v.title + v.description).not.toContain('模拟')
  })
  it('requires both enabled authority and preparation permission', () => {
    expect(view(state({ serviceState: 'READY_ENABLED', liveEnabled: true })).canSubmit).toBe(true)
    expect(view(state({ serviceState: 'READY_ENABLED', liveEnabled: true, canPrepare: false })).canSubmit).toBe(false)
    expect(view(state({ serviceState: 'READY_ENABLED', liveEnabled: false })).canSubmit).toBe(false)
    expect(view(state({ liveEnabled: true })).canSubmit).toBe(false)
  })
  it.each(['running', 'unproven', 'stopping'] as const)('overrides a stale ready label with %s', executorState => {
    const v = view(state({ serviceState: 'READY_ENABLED', liveEnabled: true, executorState }))
    expect(v.phase).toBe({ running: 'EXECUTING', unproven: 'EXECUTOR_UNPROVEN', stopping: 'STOPPING' }[executorState])
    expect(v.canSubmit || v.canPreview || v.canInspect || v.canConfirm || v.canReview).toBe(false)
  })
  it('keeps storage and recovery higher than intent review', () => {
    const intents = [intent({ state: 'UNKNOWN' })]
    expect(view(state({ serviceState: 'BLOCKED_STORAGE', executorState: 'running', intents })).phase).toBe('BLOCKED_STORAGE')
    expect(view(state({ serviceState: 'RECOVERY_REQUIRED', intents })).phase).toBe('RECOVERY_REQUIRED')
    expect(view(state({ unknownPending: true })).phase).toBe('REVIEW_REQUIRED')
    expect(view(state({ intents })).phase).toBe('REVIEW_REQUIRED')
  })
  it('permits explicit native review pages but never a new trade while a local reply is unknown', () => {
    const v = view(state({ serviceState: 'REVIEW_REQUIRED', canReview: true,
      intents: [intent({ state: 'UNKNOWN' })] }), { uncertainOperation: true })
    expect(v.canInspect).toBe(true)
    expect(v.canReview).toBe(true)
    expect(v.canSubmit || v.canPreview || v.canEnable).toBe(false)
  })
  it.each([null, state({ adapterVersion: '2' as '3' }), state({ stateSequence: NaN }),
    state({ stateSequence: -1 }), state({ canPrepare: 'true' as unknown as boolean }),
    state({ serviceState: 'future' as MacThsProductState['serviceState'] })])('fails closed for absent or malformed authority', s => {
    expect(isMacThsProductState(s)).toBe(false)
    const v = view(s)
    expect(v.phase).toBe('UNAVAILABLE')
    expect(v.canSubmit || v.canPreview || v.canEnable || v.canRecover || v.canReview || v.canConfirm).toBe(false)
  })
  it('does not trust stale state after a read failure or on another platform', () => {
    const s = state({ serviceState: 'READY_ENABLED', liveEnabled: true })
    expect(view(s, { synchronized: false }).phase).toBe('UNAVAILABLE')
    expect(view(s, { synchronized: false }).canSubmit).toBe(false)
    expect(view(s, { isMac: false }).phase).toBe('UNSUPPORTED_PLATFORM')
    expect(view(s, { isMac: false }).canSubmit).toBe(false)
  })
})

describe('trusted legacy provision viewmodel', () => {
  const legacy = () => state({ serviceState: 'RECOVERY_REQUIRED', canProvisionLegacy: true, recoveryReason: 'IMPORT_REQUIRED' })
  it('allows only explicit authoritative permission, without enabling fresh/apply/live', () => {
    const v = view(legacy())
    expect(v.canProvisionLegacy).toBe(true)
    expect(v.canInitialize || v.canRecover || v.canSubmit || v.canEnable).toBe(false)
  })
  it.each([false, undefined, 'true', 1])('refuses absent, false, or malformed permission %s', permission => {
    expect(view({ ...legacy(), canProvisionLegacy: permission as boolean }).canProvisionLegacy).toBe(false)
  })
  it.each(['running', 'unproven', 'stopping'] as const)('does not provision with executor %s', executorState => {
    expect(view({ ...legacy(), executorState }).canProvisionLegacy).toBe(false)
  })
  it.each(['STARTING', 'SYNCING', 'STOPPING', 'BLOCKED_STORAGE', 'UNSUPPORTED_PLATFORM', 'READY_DISABLED'] as const)('does not bypass %s even with a stale true flag', serviceState => {
    expect(view({ ...legacy(), serviceState }).canProvisionLegacy).toBe(false)
  })
  it('retains protection after transport uncertainty, stale authority or on non-Mac', () => {
    expect(view(legacy(), { uncertainOperation: true }).canProvisionLegacy).toBe(false)
    expect(view(legacy(), { synchronized: false }).canProvisionLegacy).toBe(false)
    expect(view(legacy(), { isMac: false }).canProvisionLegacy).toBe(false)
  })
})

describe('bound recovery and individual review', () => {
  it.each(['UNKNOWN', 'LEGACY_UNKNOWN'] as const)('reviews only unreleased %s or quarantine', status => {
    expect(needsMacThsIntentReview(intent({ state: status }))).toBe(true)
    expect(needsMacThsIntentReview(intent({ state: status, gateReleased: true, executionForbidden: true }))).toBe(false)
    expect(needsMacThsIntentReview(intent({ state: status, gateReleased: true, recoveryQuarantine: true }))).toBe(true)
  })
  it('does not make every permanently forbidden historic intent a new review', () => {
    const i = intent({ state: 'ACCEPTED_OBSERVED', executionForbidden: true, gateReleased: true })
    expect(needsMacThsIntentReview(i)).toBe(false)
    expect(view(state({ intents: [i] })).canPreview).toBe(true)
    expect(macThsIntentLabel(i.state)).toContain('不等于成交')
  })
  it('requires a usable plan triple and explicit backend permission', () => {
    const s = state({ serviceState: 'RECOVERY_REQUIRED', canRecover: true,
      recovery: { recoveryId: HASH, manifestHash: HASH, revision: 1, reason: 'IMPORT_REQUIRED',
        evidence: 'verified', canApply: true, intentCount: 2, reviewCount: 2 } })
    expect(view(s).canRecover).toBe(true)
    for (const p of [{ recoveryId: null }, { manifestHash: null }, { revision: NaN }, { canApply: false }]) {
      expect(view({ ...s, recovery: { ...s.recovery!, ...p } }).canRecover).toBe(false)
    }
    expect(view({ ...s, canRecover: false }).canRecover).toBe(false)
    expect(view({ ...s, executorState: 'unproven' }).canRecover).toBe(false)
  })
  it('keeps unfenced legacy recovery blocked, without calling it migrated', () => {
    const v = view(state({ serviceState: 'RECOVERY_REQUIRED', code: 'LEGACY_WRITER_UNFENCED', canRecover: false }))
    expect(v.canRecover || v.canInitialize || v.canSubmit).toBe(false)
    expect(macThsCodeMessage('LEGACY_WRITER_UNFENCED')).toContain('迁移尚未可用')
  })
  it('initializes only a backend-approved new domain, never unknown or ready history', () => {
    expect(view(state({ serviceState: 'NOT_INITIALIZED', canInitialize: true })).canInitialize).toBe(true)
    expect(view(state({ serviceState: 'NOT_INITIALIZED', canInitialize: true, unknownPending: true })).canInitialize).toBe(false)
    expect(view(state({ canInitialize: true })).canInitialize).toBe(false)
  })
})

describe('session, read epoch and sequence ordering', () => {
  function loaded(s = state()) {
    const c = beginMacThsStateRead(createMacThsStateCursor())!
    return acceptMacThsStateRead(c, c.epoch, s)!
  }
  it('never lets an older read overwrite a newer UNKNOWN projection', async () => {
    let c = beginMacThsStateRead(loaded())!
    const oldEpoch = c.epoch
    let resolveOld!: (s: MacThsProductState) => void
    const oldRead = new Promise<MacThsProductState>(resolve => { resolveOld = resolve })
    c = beginMacThsStateRead(c, { sessionId: 'session-a', stateSequence: 12 })!
    c = acceptMacThsStateRead(c, c.epoch, state({ stateSequence: 12, unknownPending: true }))!
    resolveOld(state({ stateSequence: 11 }))
    expect(acceptMacThsStateRead(c, oldEpoch, await oldRead)).toBeNull()
    expect(c.state!.unknownPending).toBe(true)
  })
  it('rejects lower same-session sequence, including below an event hint', () => {
    let c = loaded()
    expect(beginMacThsStateRead(c, { sessionId: 'session-a', stateSequence: 9 })).toBeNull()
    c = beginMacThsStateRead(c, { sessionId: 'session-a', stateSequence: 15 })!
    expect(acceptMacThsStateRead(c, c.epoch, state({ stateSequence: 14 }))).toBeNull()
    expect(currentMacThsActionResponse(c, state({ stateSequence: 14 }), 'session-a')).toBe(false)
    expect(acceptMacThsStateRead(c, c.epoch, state({ stateSequence: 15 }))).not.toBeNull()
  })
  it('allows a fresh session with a lower independent sequence, retires the old session', () => {
    let c = beginMacThsStateRead(loaded(state({ stateSequence: 100 })), { sessionId: 'session-b', stateSequence: 1 })!
    expect(acceptMacThsStateRead(c, c.epoch, state({ stateSequence: 101 }))).toBeNull()
    c = acceptMacThsStateRead(c, c.epoch, state({ sessionId: 'session-b', stateSequence: 1 }))!
    expect(c.state!.sessionId).toBe('session-b')
    expect(beginMacThsStateRead(c, { sessionId: 'session-a', stateSequence: 200 })).toBeNull()
    expect(currentMacThsActionResponse(c, state({ stateSequence: 200 }), 'session-a')).toBe(false)
  })
  it('accepts a session change from an explicit current read, not an old execute response', () => {
    const c = loaded()
    const next = state({ sessionId: 'session-b', stateSequence: 0 })
    expect(currentMacThsActionResponse(c, next, 'session-a')).toBe(false)
    const reading = beginMacThsStateRead(c)!
    expect(acceptMacThsStateRead(reading, reading.epoch, next)!.state!.sessionId).toBe('session-b')
    expect(currentMacThsActionResponse(c, state(), 'session-a')).toBe(true)
  })
  it('copies accepted facts instead of sharing mutable transport objects', () => {
    const source = state({ intents: [intent({ state: 'UNKNOWN' })] })
    const c = loaded(source)
    source.intents[0].gateReleased = true
    source.unknownPending = true
    expect(c.state!.intents[0].gateReleased).toBe(false)
    expect(c.state!.unknownPending).toBe(false)
  })
  it('rejects malformed notices without generating IDs or performing native work', () => {
    const uuid = vi.fn()
    vi.stubGlobal('crypto', { randomUUID: uuid })
    const c = loaded()
    expect(beginMacThsStateRead(c, { sessionId: '', stateSequence: 1 })).toBeNull()
    expect(beginMacThsStateRead(c, { sessionId: 'a', stateSequence: Infinity })).toBeNull()
    expect(uuid).not.toHaveBeenCalled()
  })
})

describe('stable operation and original confirmation binding', () => {
  it('uses one immutable top/order ID and preserves it for second-stage confirmation', () => {
    const original: MacThsRequest = { action: 'submitLive', mode: 'live',
      order: { requestId: 'old', mode: 'live', symbol: '600000', side: 'buy', price: '10.00', quantity: 100, maxNotional: '1000.00' } }
    const first = bindMacThsRequestId(original, UUID)
    const confirmed = { ...first, confirmationToken: UUID, intentBinding: ticket().intentBinding! }
    expect(first.requestId).toBe(first.order!.requestId)
    expect(confirmed.requestId).toBe(first.requestId)
    expect(confirmed.order).toEqual(first.order)
    expect(original.order!.requestId).toBe('old')
    expect(isMacThsTradeRequest(confirmed)).toBe(true)
  })
  it('does not invent a cancel order or treat historical simulation as live', () => {
    const cancel = bindMacThsRequestId({ action: 'cancelLive', mode: 'live', contractNo: 'local' }, UUID)
    expect(cancel.order).toBeUndefined()
    expect(isMacThsTradeRequest(cancel)).toBe(true)
    expect(isMacThsTradeRequest({ action: 'submitSimulation' })).toBe(false)
    expect(isMacThsTradeRequest({ action: 'probe' })).toBe(false)
  })
  it('allows the exact original valid ticket and the session authorization ticket', () => {
    expect(macThsConfirmationMatches(confirmationState(), ticket(), 1000, confirmationRequest())).toBe(true)
    expect(macThsConfirmationMatches(confirmationState({ intents: [] }), ticket({ intentBinding: null }), 1000, confirmationRequest('authorizeLive'))).toBe(true)
  })
  it.each([{ sessionId: 'old-session' }, { expiresAt: 1000 }, { expiresAt: NaN },
    { intentBinding: { intentId: 'other', snapshotHash: HASH, expectedRevision: 1 } },
    { intentBinding: { intentId: UUID, snapshotHash: 'different', expectedRevision: 1 } },
    { intentBinding: { intentId: UUID, snapshotHash: HASH, expectedRevision: 2 } }])('refuses a stale or mismatched ticket %j', overrides => {
    expect(macThsConfirmationMatches(confirmationState(), ticket(overrides), 1000, confirmationRequest())).toBe(false)
  })
  it.each([{ canConfirm: false }, { unknownPending: true }, { executorState: 'unproven' as const },
    { intents: [intent({ gateReleased: true })] }, { serviceState: 'BLOCKED_STORAGE' as const }])('cannot confirm across a higher persistent gate %j', overrides => {
    expect(macThsConfirmationMatches(confirmationState(overrides), ticket(), 1000, confirmationRequest())).toBe(false)
  })
  it.each(['submitLive', 'cancelLive', 'submitSimulation', 'cancelSimulation'] as const)('binding-required confirmation rejects null for %s but accepts a matching persisted binding', action => {
    const request = confirmationRequest(action)
    const current = confirmationState({ intents: [intent({ action: action.startsWith('cancel') ? 'cancel' : 'submit', mode: request.mode! })] })
    expect(macThsConfirmationMatches(current, ticket({ intentBinding: null }), 1000, request)).toBe(false)
    expect(macThsConfirmationMatches(current, ticket(), 1000, request)).toBe(true)
  })
  it.each([
    { intentId: '', snapshotHash: HASH, expectedRevision: 1 },
    { intentId: UUID, snapshotHash: 'not-a-hash', expectedRevision: 1 },
    { intentId: UUID, snapshotHash: HASH, expectedRevision: 0 },
    { intentId: UUID, snapshotHash: HASH, expectedRevision: 1.5 },
    { intentId: UUID, snapshotHash: HASH, expectedRevision: NaN },
  ])('binding-required confirmation rejects malformed bindings even if transport facts match %j', binding => {
    const current = confirmationState({ intents: [intent({ intentId: binding.intentId, snapshotHash: binding.snapshotHash,
      revision: Number.isSafeInteger(binding.expectedRevision) ? binding.expectedRevision : 1 })] })
    expect(macThsConfirmationMatches(current, ticket({ intentBinding: binding }), 1000, confirmationRequest())).toBe(false)
  })
  it('binding-required confirmation cannot borrow another request intent or mismatched order ID', () => {
    expect(macThsConfirmationMatches(confirmationState({ intents: [intent({ requestId: null })] }), ticket(), 1000, confirmationRequest())).toBe(false)
    expect(macThsConfirmationMatches(confirmationState(), ticket(), 1000, { ...confirmationRequest(), requestId: '87654321-1234-4234-8234-123456789012' })).toBe(false)
    expect(macThsConfirmationMatches(confirmationState(), ticket(), 1000, { ...confirmationRequest(), order: {
      requestId: '87654321-1234-4234-8234-123456789012', mode: 'live', symbol: '600000', side: 'buy', price: '10.00', quantity: 100, maxNotional: '1000.00' } })).toBe(false)
  })
})

describe('category-only guidance and whitelist exports', () => {
  const secret = 'TOKEN_ACCOUNT_PATH_SECRET'
  function sensitiveState() {
    return state({ sessionId: secret, code: secret as MacThsProductState['code'], intents: [intent({
      intentId: secret, requestId: secret, snapshotHash: secret, accountLabel: secret, contractNo: secret,
      price: secret, symbol: secret, state: 'UNKNOWN', executionForbidden: true, recoveryQuarantine: true })],
      capabilities: { clientVersion: secret, layoutProfile: secret, account: 'missing', mode: 'ambiguous',
        tradingDate: 'invalid', headers: 'recognized', readback: 'missing', receipt: 'missing', nextAction: 'select_account' } })
  }
  it('uses real field categories and actionable fixed guidance, not native values', () => {
    const hints = macThsCapabilityHints(sensitiveState()).join(' ')
    expect(hints).toContain('账户区分：缺失')
    expect(hints).toContain('真实 A 股模式：有歧义')
    expect(hints).toContain('原生回报：缺失')
    expect(hints).toContain('选择可区分的正确账户')
    expect(hints).not.toContain(secret)
    expect(macThsCapabilityHints(null).join('')).toContain('尚未观察')
  })
  it('never reflects an unknown reason or path', () => {
    expect(macThsCodeMessage(secret)).not.toContain(secret)
    expect(macThsCodeMessage(secret)).toContain('不要重试')
    expect(macThsCodeMessage('__proto__')).toContain('原因未识别')
  })
  it('exports counts, not account/order/request/session/confirmation values', () => {
    const s = sensitiveState()
    const exported = safeMacThsProductStateDiagnostic(s)
    expect(exported).toMatchObject({ loaded: true, intentCount: 1, pendingReviewCount: 1,
      quarantineCount: 1, executionForbiddenCount: 1, code: 'UNRECOGNIZED_STATE', earlierIds: 'unavailable' })
    expect(JSON.stringify(exported)).not.toContain(secret)
    for (const field of ['sessionId', 'requestId', 'snapshotHash', 'intents', 'accountLabel', 'contractNo', 'price', 'symbol']) {
      expect(exported).not.toHaveProperty(field)
    }
    expect(safeMacThsProductStateDiagnostic(null)).toEqual({ loaded: false })
  })
})

describe('actual initial panel markup (SSR only, not mounted effects or Mac native rendering)', () => {
  it.each(['MacIntel', 'Win32'])('keeps first-load trade controls disabled on %s and performs no native call', platform => {
    const execute = vi.fn(), getState = vi.fn(), randomUUID = vi.fn()
    vi.stubGlobal('navigator', { platform })
    vi.stubGlobal('window', { api: { macThs: { execute, getState } } })
    vi.stubGlobal('crypto', { randomUUID })
    // The existing unit config uses classic JSX; production uses its React plugin.
    vi.stubGlobal('React', React)
    const html = renderToStaticMarkup(createElement(MacTradingPanel))
    for (const id of ['mac-ths-submit-live', 'mac-ths-cancel-live', 'mac-ths-enable-live']) {
      expect(html).toMatch(new RegExp('<button[^>]*data-testid="' + id + '"[^>]*disabled=""'))
    }
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('尚未读取持久记录，不能推断没有未决委托')
    expect(html).toContain('旧 1.2 无可信封存来源迁移仍未完成')
    expect(html).not.toContain('解除未知状态')
    expect(html).not.toContain('提交模拟')
    expect(execute).not.toHaveBeenCalled()
    expect(getState).not.toHaveBeenCalled()
    expect(randomUUID).not.toHaveBeenCalled()
  })
})

describe('isolated real component effect/handler wiring (no DOM or native)', () => {
  function harness(initial: MacThsProductState) {
    let authority = initial
    let slot = 0
    const slots: Array<{ value?: any; deps?: unknown[]; cleanup?: () => void }> = []
    let effects: Array<() => void> = []
    let tree: any
    let listener: ((n: { sessionId: string; stateSequence: number }) => void) | undefined
    const focus = new Map<string, () => void>()
    const equal = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
    const runtime = {
      state(initialValue: any) {
        const index = slot++
        if (!slots[index]) slots[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue }
        return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next }]
      },
      ref(value: unknown) { const index = slot++; return (slots[index] ??= { value: { current: value } }).value },
      effect(fn: () => unknown, deps?: unknown[]) {
        const index = slot++
        const old = slots[index]
        if (!old || !equal(old.deps, deps)) {
          slots[index] = { deps }
          effects.push(() => { old?.cleanup?.(); const cleanup = fn(); if (typeof cleanup === 'function') slots[index].cleanup = cleanup as () => void })
        }
      },
      callback(fn: unknown, deps?: unknown[]) {
        const index = slot++
        if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { deps, value: fn }
        return slots[index].value
      },
    }
    const execute = vi.fn(async (_request: MacThsRequest) => { throw new Error('unscripted test action') })
    const getState = vi.fn(async () => authority)
    const recover = vi.fn(async (_command: unknown) => authority)
    const reviewIntent = vi.fn(async (_command: unknown) => authority)
    const unsubscribe = vi.fn()
    const randomUUID = vi.fn(() => UUID)
    vi.stubGlobal('React', React)
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    vi.stubGlobal('crypto', { randomUUID })
    vi.stubGlobal('window', { api: { macThs: { execute, getState, recover, reviewIntent,
      onStateChanged: (fn: typeof listener) => { listener = fn; return unsubscribe } } },
      addEventListener: (name: string, fn: () => void) => focus.set(name, fn),
      removeEventListener: (name: string) => focus.delete(name) })
    function render() {
      slot = 0; hooks.current = runtime
      try { tree = MacTradingPanel({}) } finally { hooks.current = null }
      const pendingEffects = effects; effects = []
      pendingEffects.forEach(fn => fn())
    }
    async function settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); render() } }
    function find(predicate: (e: any) => boolean, value = tree): any {
      if (!value || typeof value !== 'object') return null
      if (Array.isArray(value)) return value.map(v => find(predicate, v ?? null)).find(Boolean)
      if (predicate(value)) return value
      return find(predicate, value.props?.children ?? null)
    }
    function node(id: string) { return find(e => e.props?.['data-testid'] === id || e.props?.testId === id) }
    async function click(id: string) {
      const button = node(id)
      expect(button).toBeTruthy(); expect(button.props.disabled).not.toBe(true)
      button.props.onClick(); await settle()
    }
    async function fill() {
      for (const [placeholder, value] of [['由本人选择，不提供推荐', '600000'], ['本人填写，不标为实时行情', '10.00'],
        ['本人填写数量', '100'], ['由你明确设置', '1000.00']]) {
        find(e => e.props?.placeholder === placeholder).props.onChange({ target: { value } }); render()
      }
      node('mac-ths-live-risk-ack').props.onChange({ target: { checked: true } }); await settle()
    }
    return { execute, getState, recover, reviewIntent, randomUUID, unsubscribe, node, find, click, fill, settle,
      mount: async () => { render(); await settle() }, setState: (s: MacThsProductState) => { authority = s },
      event: (n: { sessionId: string; stateSequence: number }) => listener?.(n),
      focus: () => focus.get('focus')?.(),
      dispose: () => { slots.forEach(s => s.cleanup?.()); hooks.current = null } }
  }
  function result(s: MacThsProductState, request: MacThsRequest, confirmation?: MacThsConfirmation) {
    return { schemaVersion: 1 as const, component: 'mac-ths-ui-experiment' as const, adapterVersion: '3' as const,
      state: s, runtime: 'macos' as const, architecture: 'arm64' as const, action: request.action, mode: 'live' as const,
      outcome: 'blocked' as const, code: confirmation ? 'CONFIRMATION_REQUIRED' as const : 'VIEW_OPENED' as const,
      unknownPending: s.unknownPending, canSubmitLiveOrders: false, canRunUnattended: false as const, confirmation }
  }
  it('mount, focus, and notification read authority only; stale events do not execute or create IDs', async () => {
    const h = harness(state())
    await h.mount()
    expect(h.getState).toHaveBeenCalledTimes(1)
    h.focus(); await h.settle()
    expect(h.getState).toHaveBeenCalledTimes(2)
    h.setState(state({ stateSequence: 11, unknownPending: true, canReview: true }))
    h.event({ sessionId: 'session-a', stateSequence: 11 }); await h.settle()
    expect(h.getState).toHaveBeenCalledTimes(3)
    expect(h.node('mac-ths-submit-live').props.disabled).toBe(true)
    expect(h.node('mac-ths-probe').props.disabled).toBe(false)
    const diagnostic = JSON.parse(h.node('mac-ths-diagnostic').props.children)
    expect(diagnostic.unknownPending).toBe(true)
    expect(diagnostic.canSubmitLiveOrders).toBe(false)
    h.event({ sessionId: 'session-a', stateSequence: 9 }); await h.settle()
    expect(h.getState).toHaveBeenCalledTimes(3)
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.recover).not.toHaveBeenCalled()
    expect(h.reviewIntent).not.toHaveBeenCalled()
    expect(h.randomUUID).not.toHaveBeenCalled()
    h.dispose(); expect(h.unsubscribe).toHaveBeenCalledTimes(1)
  })
  it('a rejected focus read never falls back to executing probe or stale ready state', async () => {
    const h = harness(state({ serviceState: 'READY_ENABLED', liveEnabled: true }))
    await h.mount()
    h.getState.mockRejectedValueOnce(new Error('SECRET_PATH_TOKEN'))
    h.focus(); await h.settle()
    expect(h.node('mac-ths-submit-live').props.disabled).toBe(true)
    expect(h.node('mac-ths-probe').props.disabled).toBe(true)
    expect(h.execute).not.toHaveBeenCalled()
    expect(JSON.stringify(h.node('mac-ths-status').props.children)).not.toContain('SECRET_PATH_TOKEN')
    h.dispose()
  })
  it('unknown submit retains its ID, reads state, allows explicit viewing but never resend', async () => {
    const h = harness(state({ serviceState: 'READY_ENABLED', liveEnabled: true }))
    await h.mount(); await h.fill()
    h.execute.mockImplementationOnce(async request => {
      h.setState(state({ stateSequence: 11, serviceState: 'REVIEW_REQUIRED', unknownPending: true, canReview: true,
        intents: [intent({ state: 'UNKNOWN', executionForbidden: true, requestId: request.requestId! })] }))
      throw new Error('SECRET_PATH_TOKEN')
    })
    await h.click('mac-ths-submit-live')
    expect(h.execute).toHaveBeenCalledTimes(1)
    const request = h.execute.mock.calls[0][0]
    expect(request.requestId).toBe(request.order!.requestId)
    expect(h.node('mac-ths-submit-live').props.disabled).toBe(true)
    expect(h.node('mac-ths-operation-pending')).toBeTruthy()
    expect(h.node('mac-ths-probe').props.disabled).toBe(false)
    const orders = h.find(e => e.type === 'button' && e.props.children === '在同花顺查看委托')
    expect(orders.props.disabled).toBe(false)
    h.execute.mockImplementationOnce(async r => result(state({ stateSequence: 11, serviceState: 'REVIEW_REQUIRED',
      canReview: true, unknownPending: true, intents: [intent({ state: 'UNKNOWN', executionForbidden: true })] }), r) as never)
    orders.props.onClick(); await h.settle()
    expect(h.execute.mock.calls[1][0].action).toBe('queryOrders')
    expect(h.node('mac-ths-operation-pending')).toBeTruthy()
    expect(h.getState.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(h.execute.mock.calls.filter(([r]) => r.action === 'submitLive')).toHaveLength(1)
    h.dispose()
  })
  it('application confirmation submits the exact original operation and binding, never auto-confirms', async () => {
    const h = harness(state({ serviceState: 'READY_ENABLED', liveEnabled: true }))
    await h.mount(); await h.fill()
    const confirmed = confirmationState({ stateSequence: 11, liveEnabled: true })
    const validTicket = ticket({ expiresAt: Date.now() + 60000 })
    h.execute.mockImplementationOnce(async r => { h.setState(confirmed); return result(confirmed, r, validTicket) as never })
    await h.click('mac-ths-submit-live')
    expect(h.execute).toHaveBeenCalledTimes(1)
    const original = h.execute.mock.calls[0][0]
    expect(h.node('mac-ths-confirmation').props.open).toBe(true)
    h.execute.mockImplementationOnce(async r => {
      const done = state({ stateSequence: 12, serviceState: 'READY_ENABLED', liveEnabled: true,
        intents: [intent({ gateReleased: true, executionForbidden: true, state: 'ACCEPTED_OBSERVED' })] })
      h.setState(done); return result(done, r) as never
    })
    h.node('mac-ths-confirmation').props.onConfirm(); await h.settle()
    expect(h.execute).toHaveBeenCalledTimes(2)
    expect(h.execute.mock.calls[1][0]).toEqual({ ...original, confirmationToken: validTicket.token, intentBinding: validTicket.intentBinding })
    expect(h.randomUUID).toHaveBeenCalledTimes(1)
    expect(h.node('mac-ths-confirmation').props.open).toBe(false)
    h.dispose()
  })
  it.each(['submitLive', 'cancelLive'] as const)('UI refuses trading confirmation with null binding for %s without a second execute', async action => {
    const h = harness(state({ serviceState: 'READY_ENABLED', liveEnabled: true }))
    await h.mount(); await h.fill()
    if (action === 'cancelLive') {
      h.find(e => e.props?.placeholder === '本人指定，仅本机使用，不导出').props.onChange({ target: { value: 'local-contract' } })
      await h.settle()
    }
    const current = confirmationState({ stateSequence: 11, liveEnabled: true,
      intents: [intent({ action: action === 'cancelLive' ? 'cancel' : 'submit' })] })
    h.execute.mockImplementationOnce(async r => { h.setState(current); return result(current, r, ticket({ intentBinding: null, expiresAt: Date.now() + 60000 })) as never })
    await h.click(action === 'submitLive' ? 'mac-ths-submit-live' : 'mac-ths-cancel-live')
    expect(h.execute).toHaveBeenCalledTimes(1)
    expect(h.node('mac-ths-confirmation').props.open).toBe(false)
    // Calling the actual component confirm handler is inert without a valid flow.
    h.node('mac-ths-confirmation').props.onConfirm(); await h.settle()
    expect(h.execute).toHaveBeenCalledTimes(1)
    expect(h.node('mac-ths-submit-live').props.disabled).toBe(true)
    h.dispose()
  })
  it('UI allows null-bound authorizeLive confirmation and reuses the original request', async () => {
    const h = harness(state())
    await h.mount()
    h.node('mac-ths-live-risk-ack').props.onChange({ target: { checked: true } }); await h.settle()
    const current = confirmationState({ stateSequence: 11, intents: [] })
    const approval = ticket({ intentBinding: null, expiresAt: Date.now() + 60000 })
    h.execute.mockImplementationOnce(async r => { h.setState(current); return result(current, r, approval) as never })
    await h.click('mac-ths-enable-live')
    expect(h.execute).toHaveBeenCalledTimes(1)
    expect(h.node('mac-ths-confirmation').props.open).toBe(true)
    const original = h.execute.mock.calls[0][0]
    h.execute.mockImplementationOnce(async r => {
      const enabled = state({ stateSequence: 12, serviceState: 'READY_ENABLED', liveEnabled: true })
      h.setState(enabled); return result(enabled, r) as never
    })
    h.node('mac-ths-confirmation').props.onConfirm(); await h.settle()
    expect(h.execute).toHaveBeenCalledTimes(2)
    expect(h.execute.mock.calls[1][0]).toEqual({ ...original, confirmationToken: approval.token })
    expect(h.execute.mock.calls[1][0]).not.toHaveProperty('intentBinding')
    h.dispose()
  })
  it('revokes an open confirmation after a session notification instead of rebinding it', async () => {
    const h = harness(state({ serviceState: 'READY_ENABLED', liveEnabled: true }))
    await h.mount(); await h.fill()
    const current = confirmationState({ stateSequence: 11 })
    h.execute.mockImplementationOnce(async r => { h.setState(current); return result(current, r, ticket({ expiresAt: Date.now() + 60000 })) as never })
    await h.click('mac-ths-submit-live')
    const previousConfirm = h.node('mac-ths-confirmation').props.onConfirm
    h.setState(state({ sessionId: 'session-b', stateSequence: 1 }))
    h.event({ sessionId: 'session-b', stateSequence: 1 }); await h.settle()
    expect(h.node('mac-ths-confirmation').props.open).toBe(false)
    previousConfirm(); await h.settle()
    expect(h.execute).toHaveBeenCalledTimes(1)
    expect(h.node('mac-ths-submit-live').props.disabled).toBe(true)
    h.dispose()
  })
  it('does not repeat a recovery command whose result is unknown, or call execute', async () => {
    const h = harness(state({ serviceState: 'RECOVERY_REQUIRED', canRecover: true,
      recovery: { recoveryId: HASH, manifestHash: HASH, revision: 7, reason: 'IMPORT_REQUIRED',
        evidence: 'verified', canApply: true, intentCount: 1, reviewCount: 1 } }))
    h.recover.mockRejectedValueOnce(new Error('PRIVATE_PATH'))
    await h.mount(); await h.click('mac-ths-recover')
    expect(h.recover).not.toHaveBeenCalled()
    h.node('mac-ths-confirmation').props.onConfirm(); await h.settle()
    expect(h.recover).toHaveBeenCalledTimes(1)
    expect(h.recover).toHaveBeenCalledWith({ kind: 'apply', recoveryId: HASH, manifestHash: HASH, expectedRevision: 7 })
    expect(h.node('mac-ths-recover').props.disabled).toBe(true)
    expect(h.execute).not.toHaveBeenCalled()
    h.dispose()
  })
  it('requires an observed scope and preserves still-uncertain protection after human review failure', async () => {
    const h = harness(state({ serviceState: 'REVIEW_REQUIRED', canReview: true, unknownPending: true,
      intents: [intent({ state: 'UNKNOWN', executionForbidden: true })] }))
    await h.mount()
    const reviewButton = () => h.find(e => e.type === 'button' && e.props.children === '逐条核对并提交人审（仍须原生确认）')
    expect(reviewButton().props.disabled).toBe(true)
    const ordersLabel = h.find(e => e.type === 'label' && Array.isArray(e.props.children) && e.props.children.includes('已查看委托'))
    ordersLabel.props.children[0].props.onChange({ target: { checked: true } }); await h.settle()
    expect(reviewButton().props.disabled).not.toBe(true)
    reviewButton().props.onClick(); await h.settle()
    expect(h.reviewIntent).not.toHaveBeenCalled()
    h.reviewIntent.mockRejectedValueOnce(new Error('PRIVATE_PATH'))
    h.node('mac-ths-confirmation').props.onConfirm(); await h.settle()
    expect(h.reviewIntent).toHaveBeenCalledTimes(1)
    expect(h.reviewIntent).toHaveBeenCalledWith({ intentId: UUID, snapshotHash: HASH,
      expectedRevision: 1, reviewRequestId: UUID, observation: { statement: 'still_uncertain', scope: ['orders'], releaseGate: false } })
    expect(reviewButton().props.disabled).toBe(true)
    expect(h.node('mac-ths-submit-live').props.disabled).toBe(true)
    expect(h.execute).not.toHaveBeenCalled()
    h.dispose()
  })
  it('trusted legacy provision UI requires manual confirmation then a separate explicit apply', async () => {
    const original = state({ serviceState: 'RECOVERY_REQUIRED', canProvisionLegacy: true })
    const h = harness(original)
    await h.mount()
    expect(h.node('mac-ths-provision-legacy')).toBeTruthy()
    await h.click('mac-ths-provision-legacy')
    const dialog = h.node('mac-ths-confirmation')
    expect(dialog.props.open).toBe(true)
    const message = dialog.props.message.props.children
    expect(message).toContain('本人单独确认 apply')
    expect(message).toContain('旧 1.2 未受监督 journal')
    expect(message).toContain('不作为新 fresh 初始化')
    expect(h.recover).not.toHaveBeenCalled()
    h.recover.mockImplementationOnce(async command => {
      expect(command).toEqual({ kind: 'provisionLegacy' })
      const prepared = state({ stateSequence: 11, serviceState: 'RECOVERY_REQUIRED', canRecover: true,
        recovery: { recoveryId: HASH, manifestHash: HASH, revision: 1, reason: 'IMPORT_REQUIRED',
          evidence: 'verified', canApply: true, intentCount: 1, reviewCount: 1 } })
      h.setState(prepared); return prepared
    })
    dialog.props.onConfirm(); await h.settle()
    expect(h.recover).toHaveBeenCalledTimes(1)
    expect(h.node('mac-ths-provision-legacy')).toBeFalsy()
    expect(h.node('mac-ths-recover').props.disabled).toBe(false)
    expect(h.node('mac-ths-enable-live').props.disabled).toBe(true)
    expect(h.execute).not.toHaveBeenCalled()
    await h.click('mac-ths-recover')
    expect(h.recover).toHaveBeenCalledTimes(1)
    h.node('mac-ths-confirmation').props.onConfirm(); await h.settle()
    expect(h.recover.mock.calls[1][0]).toEqual({ kind: 'apply', recoveryId: HASH, manifestHash: HASH, expectedRevision: 1 })
    expect(h.execute).not.toHaveBeenCalled()
    h.dispose()
  })
  it('trusted legacy provision UI is absent for unsealed legacy or no permission', async () => {
    const h = harness(state({ serviceState: 'RECOVERY_REQUIRED', code: 'LEGACY_WRITER_UNFENCED' }))
    await h.mount()
    expect(h.node('mac-ths-provision-legacy')).toBeFalsy()
    expect(h.recover).not.toHaveBeenCalled()
    h.dispose()
  })
  it.each(['running', 'unproven', 'stopping'] as const)('trusted legacy provision UI cannot be clicked with executor %s', async executorState => {
    const h = harness(state({ serviceState: 'RECOVERY_REQUIRED', canProvisionLegacy: true, executorState }))
    await h.mount()
    expect(h.node('mac-ths-provision-legacy').props.disabled).toBe(true)
    h.node('mac-ths-provision-legacy').props.onClick(); await h.settle()
    expect(h.node('mac-ths-confirmation').props.open).toBe(false)
    expect(h.recover).not.toHaveBeenCalled()
    h.dispose()
  })
  it('trusted legacy provision UI blocks an unknown result without retrying or applying', async () => {
    const h = harness(state({ serviceState: 'RECOVERY_REQUIRED', canProvisionLegacy: true }))
    await h.mount(); await h.click('mac-ths-provision-legacy')
    h.recover.mockRejectedValueOnce(new Error('PRIVATE_CAPABILITY_TOKEN'))
    h.node('mac-ths-confirmation').props.onConfirm(); await h.settle()
    expect(h.recover).toHaveBeenCalledTimes(1)
    expect(h.recover).toHaveBeenCalledWith({ kind: 'provisionLegacy' })
    expect(h.node('mac-ths-provision-legacy').props.disabled).toBe(true)
    expect(h.node('mac-ths-recover').props.disabled).toBe(true)
    h.node('mac-ths-provision-legacy').props.onClick(); await h.settle()
    expect(h.recover).toHaveBeenCalledTimes(1)
    expect(h.execute).not.toHaveBeenCalled()
    expect(JSON.stringify(h.node('mac-ths-status').props.children)).not.toContain('PRIVATE_CAPABILITY_TOKEN')
    h.dispose()
  })
  it('trusted legacy provision UI revokes permission changes and failed authority reads before confirm', async () => {
    const original = state({ serviceState: 'RECOVERY_REQUIRED', canProvisionLegacy: true })
    const h = harness(original)
    await h.mount(); await h.click('mac-ths-provision-legacy')
    const staleConfirm = h.node('mac-ths-confirmation').props.onConfirm
    h.setState({ ...original, stateSequence: 11, canProvisionLegacy: false })
    h.event({ sessionId: 'session-a', stateSequence: 11 }); await h.settle()
    staleConfirm(); await h.settle()
    expect(h.recover).not.toHaveBeenCalled()
    expect(h.node('mac-ths-provision-legacy')).toBeFalsy()
    h.setState({ ...original, stateSequence: 12 })
    h.focus(); await h.settle()
    await h.click('mac-ths-provision-legacy')
    h.getState.mockRejectedValueOnce(new Error('PRIVATE_PATH'))
    h.focus(); await h.settle()
    expect(h.node('mac-ths-provision-legacy').props.disabled).toBe(true)
    h.node('mac-ths-confirmation').props.onConfirm(); await h.settle()
    expect(h.recover).not.toHaveBeenCalled()
    h.dispose()
  })
})
