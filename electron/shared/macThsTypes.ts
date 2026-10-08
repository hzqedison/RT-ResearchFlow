export type MacThsMode = 'simulation' | 'livePreview' | 'live'
export const MAC_THS_ACTIONS = ['probe', 'preview', 'submitSimulation', 'queryOrders', 'queryDeals',
  'cancelSimulation', 'authorize', 'resolveUnknown', 'authorizeLive', 'disableLive', 'submitLive',
  'cancelLive', 'dismissConfirmation'] as const
export type MacThsAction = typeof MAC_THS_ACTIONS[number]
export type MacThsOutcome = 'passed' | 'blocked' | 'unknown'
export const MAC_THS_CODES = [
  'READY', 'MAC_REQUIRED', 'CLIENT_NOT_RUNNING', 'ACCESSIBILITY_REQUIRED', 'AUTOMATION_DENIED',
  'TRADE_VIEW_REQUIRED', 'MODE_UNVERIFIED', 'LAYOUT_UNSUPPORTED', 'BROKER_UNVERIFIED', 'INVALID_ORDER',
  'BUSY', 'JOURNAL_UNAVAILABLE', 'UNKNOWN_PENDING', 'DUPLICATE_REQUEST', 'USER_CANCELLED',
  'READBACK_MISMATCH', 'SIMULATION_ACCEPTED', 'SIMULATION_CANCELLED', 'FORM_READY', 'VIEW_OPENED',
  'TABLE_UNSUPPORTED', 'RECEIPT_UNKNOWN', 'CANCEL_CONTROL_UNSUPPORTED', 'CONFIRMATION_UNRECOGNIZED',
  'SCRIPT_ERROR', 'PERMISSION_PROMPTED', 'STATE_RESOLVED', 'CONFIRMATION_REQUIRED', 'CONFIRMATION_EXPIRED',
  'LIVE_ENABLED', 'LIVE_DISABLED', 'LIVE_NOT_ENABLED', 'LIVE_ACCEPTED', 'LIVE_CANCELLED',
  'NATIVE_CONFIRMATION_REQUIRED', 'ORDER_CONTROL_DISABLED',
  'NOT_INITIALIZED', 'INITIALIZED', 'STORAGE_UNAVAILABLE', 'RECOVERY_REQUIRED', 'REVIEW_REQUIRED',
  'LEGACY_WRITER_UNFENCED', 'EXECUTOR_EXIT_UNPROVEN', 'SESSION_STOPPING', 'INVALID_CALLER', 'INVALID_REQUEST',
  'REQUEST_CONFLICT', 'INTENT_CONFLICT', 'DUPLICATE_ISOLATED', 'ACCOUNT_IDENTITY_UNAVAILABLE',
  'ACCOUNT_CONTEXT_CONFLICT', 'TRADING_DATE_UNAVAILABLE', 'TARGET_UNVERIFIED', 'CAPABILITY_UNAVAILABLE',
  'NOT_SUBMITTED', 'ACCEPTED_OBSERVED', 'CANCEL_OBSERVED', 'STORAGE_RECOVERED_REVIEW_REQUIRED',
  'HUMAN_REVIEW_RECORDED', 'EXECUTION_PERMISSION_EXPIRED', 'CAS_CONFLICT', 'SNAPSHOT_CONFLICT',
  'EXECUTION_FORBIDDEN', 'QUOTE_SESSION_REQUIRED', 'LIVE_SESSION_REQUIRED', 'INCOMPLETE_REVIEW',
  'RECOVERY_PLAN_CHANGED', 'RECOVERY_CONFLICT', 'INTENT_NOT_FOUND', 'SNAPSHOT_EXPIRED',
  'INVALID_ADDITIONAL_ORDER', 'ADDITIONAL_ORDER_LINK_REQUIRED', 'INVALID_DATA', 'EVIDENCE_CONFLICT', 'UNSUPPORTED_PLATFORM',
] as const
export type MacThsCode = typeof MAC_THS_CODES[number]
export interface MacThsOrder {
  requestId: string
  mode: MacThsMode
  side: 'buy' | 'sell'
  symbol: string
  price: string
  quantity: number
  maxNotional: string
}
export interface MacThsConfirmation {
  token: string
  title: string
  message: string
  confirmLabel: string
  sessionId: string
  expiresAt: number
  intentBinding: MacThsIntentBinding | null
}
export interface MacThsRequest {
  action: MacThsAction
  mode?: MacThsMode
  order?: MacThsOrder
  requestId?: string
  contractNo?: string
  confirmationToken?: string
  liveRiskAcknowledged?: boolean
  intentBinding?: MacThsIntentBinding
  additionalOrder?: { previousIntentId: string; additionalOrderAcknowledged: true }
}
export interface MacThsResult {
  schemaVersion: 1
  component: 'mac-ths-ui-experiment'
  adapterVersion: '3'
  state: MacThsProductState
  runtime: 'macos' | 'other'
  architecture: 'arm64' | 'x64' | 'other'
  action: MacThsAction
  mode: MacThsMode
  outcome: MacThsOutcome
  code: MacThsCode
  unknownPending: boolean
  canSubmitLiveOrders: boolean
  canRunUnattended: false
  contractNo?: string
  confirmation?: MacThsConfirmation
}
export function validateMacThsOrder(value: unknown): MacThsOrder | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(v.requestId)) return null
  if (v.mode !== 'simulation' && v.mode !== 'livePreview' && v.mode !== 'live') return null
  if (v.side !== 'buy' && v.side !== 'sell') return null
  if (typeof v.symbol !== 'string' || !/^(600|601|603|605|000|001|002|003)\d{3}$/.test(v.symbol)) return null
  if (typeof v.price !== 'string' || !/^\d{1,5}(\.\d{1,2})?$/.test(v.price) || Number(v.price) <= 0) return null
  if (typeof v.quantity !== 'number' || !Number.isSafeInteger(v.quantity) || v.quantity < 1 || v.quantity > 1000000) return null
  if (v.side === 'buy' && v.quantity % 100 !== 0) return null
  if (typeof v.maxNotional !== 'string' || !/^\d{1,9}(\.\d{1,2})?$/.test(v.maxNotional) || Number(v.maxNotional) <= 0) return null
  const cents = Math.round(Number(v.price) * 100)
  const limit = Math.round(Number(v.maxNotional) * 100)
  if (cents * v.quantity > limit) return null
  return { requestId: v.requestId, mode: v.mode, side: v.side, symbol: v.symbol,
    price: Number(v.price).toFixed(2), quantity: v.quantity, maxNotional: Number(v.maxNotional).toFixed(2) }
}

export const MAC_THS_SERVICE_STATES = [
  'STARTING', 'SYNCING', 'NOT_INITIALIZED', 'READY_DISABLED', 'READY_ENABLED', 'AWAITING_CONFIRMATION',
  'EXECUTING', 'REVIEW_REQUIRED', 'RECOVERY_REQUIRED', 'BLOCKED_STORAGE', 'EXECUTOR_UNPROVEN',
  'STOPPING', 'UNSUPPORTED_PLATFORM',
] as const
export type MacThsServiceState = typeof MAC_THS_SERVICE_STATES[number]
export const MAC_THS_RECOVERY_REASONS = ['ACTIVE_OWNER', 'LEGACY_WRITER_UNFENCED', 'IMPORT_REQUIRED',
  'INTERRUPTED_SESSION', 'EVIDENCE_CONFLICT', 'STORAGE_IO', 'CORRUPT_STORE', 'ABI_UNAVAILABLE'] as const
export type MacThsRecoveryReason = typeof MAC_THS_RECOVERY_REASONS[number]
export interface MacThsIntentBinding { intentId: string; snapshotHash: string; expectedRevision: number }
export interface MacThsIntentSummary {
  intentId: string; requestId: string | null; snapshotHash: string | null; revision: number
  state: 'PREPARED' | 'CONFIRMED' | 'UNKNOWN' | 'ABANDONED' | 'NOT_SUBMITTED' |
    'ACCEPTED_OBSERVED' | 'CANCEL_OBSERVED' | 'LEGACY_UNKNOWN'
  gateReleased: boolean; executionForbidden: boolean; recoveryQuarantine: boolean; recoveryId: string | null
  mode: MacThsMode | null; action: 'submit' | 'cancel' | null; symbol: string | null
  market: 'SH' | 'SZ' | 'BJ' | null; side: 'buy' | 'sell' | null; price: string | null
  quantity: number | null; maxNotional: string | null; accountLabel: string | null
  contractNo: string | null; tradingDate: string | null
}
export interface MacThsRecoveryPlan {
  recoveryId: string | null; manifestHash: string | null; revision: number
  reason: MacThsRecoveryReason | null; evidence: 'unavailable' | 'verified' | 'partial' | 'conflicting'
  canApply: boolean; intentCount: number; reviewCount: number
}
export interface MacThsCapabilities {
  clientVersion: string | null; layoutProfile: string | null
  account: 'recognized' | 'missing' | 'ambiguous' | 'invalid'
  mode: 'recognized' | 'missing' | 'ambiguous' | 'invalid'
  tradingDate: 'recognized' | 'missing' | 'ambiguous' | 'invalid'
  headers: 'recognized' | 'missing' | 'ambiguous' | 'invalid'
  readback: 'recognized' | 'missing' | 'ambiguous' | 'invalid'
  receipt: 'recognized' | 'missing' | 'ambiguous' | 'invalid'
  nextAction: 'open_trade_view' | 'select_account' | 'show_dated_orders' | 'review_native_dialog' | 'check_again'
}
export interface MacThsProductState {
  schemaVersion: 1; adapterVersion: '3'; sessionId: string; stateSequence: number
  serviceState: MacThsServiceState; code: MacThsCode; recoveryReason: MacThsRecoveryReason | null
  liveEnabled: boolean; executorState: 'idle' | 'running' | 'unproven' | 'stopping'
  unknownPending: boolean; canPrepare: boolean; canConfirm: boolean; canRecover: boolean
  canReview: boolean; canInitialize: boolean; canProvisionLegacy: boolean
  coverage: { kind: 'fresh' | 'legacy'; since: number; legacyIds: number; earlierIds: 'unavailable' } | null
  intents: MacThsIntentSummary[]; recovery: MacThsRecoveryPlan | null; capabilities: MacThsCapabilities | null
}
export type RecoveryCommand = { kind: 'initialize' } | { kind: 'provisionLegacy' } |
  { kind: 'apply'; recoveryId: string; manifestHash: string; expectedRevision: number }
export interface ReviewCommand {
  intentId: string; snapshotHash: string | null; expectedRevision: number
  recoveryId?: string; reviewRequestId: string
  observation: {
    statement: 'still_uncertain' | 'order_seen' | 'cancel_seen' | 'no_order_seen'
    scope: Array<'orders' | 'deals' | 'confirmation'>; releaseGate: boolean
  }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const HASH = /^[a-f0-9]{64}$/
function plain(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'string') return value.length <= 4096
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value) ? value.length > 32 : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(value).length > 40) return false
  return Reflect.ownKeys(descriptors).every(key => typeof key === 'string' &&
    Object.hasOwn(descriptors[key], 'value') && plain(descriptors[key].value, depth + 1))
}
function fields(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return required.every(key => Object.hasOwn(v, key)) && Object.keys(v).every(key => required.includes(key) || optional.includes(key))
}
const id = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
const hash = (v: unknown): v is string => typeof v === 'string' && HASH.test(v)
const revision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
function binding(v: unknown): boolean {
  return fields(v, ['intentId', 'snapshotHash', 'expectedRevision']) && id(v.intentId) && hash(v.snapshotHash) && revision(v.expectedRevision)
}
/** IPC uses strict decoders, not the legacy order normalizer that deliberately strips fields. */
export function decodeMacThsRequest(value: unknown): MacThsRequest | null {
  try {
    if (!plain(value) || !fields(value, ['action'], ['mode', 'order', 'requestId', 'contractNo',
      'confirmationToken', 'liveRiskAcknowledged', 'intentBinding', 'additionalOrder'])) return null
    if (!MAC_THS_ACTIONS.includes(value.action as MacThsAction)) return null
    if (value.mode !== undefined && !['simulation', 'livePreview', 'live'].includes(String(value.mode))) return null
    for (const key of ['requestId', 'confirmationToken']) if (value[key] !== undefined && !id(value[key])) return null
    if (value.contractNo !== undefined && (typeof value.contractNo !== 'string' || !/^[a-zA-Z0-9-]{1,32}$/.test(value.contractNo))) return null
    if (value.liveRiskAcknowledged !== undefined && typeof value.liveRiskAcknowledged !== 'boolean') return null
    if (value.intentBinding !== undefined && !binding(value.intentBinding)) return null
    if (value.additionalOrder !== undefined && (!fields(value.additionalOrder, ['previousIntentId', 'additionalOrderAcknowledged']) ||
      !id(value.additionalOrder.previousIntentId) || value.additionalOrder.additionalOrderAcknowledged !== true)) return null
    const action = value.action as MacThsAction
    const submit = action === 'submitLive' || action === 'submitSimulation'
    const cancel = action === 'cancelLive' || action === 'cancelSimulation'
    let order: MacThsOrder | null = null
    if (value.order !== undefined) {
      if (!fields(value.order, ['requestId', 'mode', 'side', 'symbol', 'price', 'quantity', 'maxNotional']) ||
        !id(value.order.requestId)) return null
      order = validateMacThsOrder(value.order)
      if (!order || order.mode !== value.mode) return null
    }
    if (submit || action === 'preview') {
      if (!order || (submit && (value.requestId !== order.requestId || !id(value.requestId)))) return null
    } else if (order && action !== 'dismissConfirmation') return null
    if (cancel && (!id(value.requestId) || value.contractNo === undefined)) return null
    if ((action === 'submitLive' || action === 'cancelLive' || action === 'authorizeLive') && value.mode !== 'live') return null
    if ((action === 'submitSimulation' || action === 'cancelSimulation') && value.mode !== 'simulation') return null
    if (action === 'authorizeLive' && value.liveRiskAcknowledged !== true) return null
    if (value.contractNo !== undefined && !cancel && action !== 'dismissConfirmation') return null
    if (value.additionalOrder !== undefined && !submit && !cancel && action !== 'dismissConfirmation') return null
    if (value.intentBinding !== undefined && !submit && !cancel && action !== 'dismissConfirmation') return null
    const copied = JSON.parse(JSON.stringify(value)) as MacThsRequest
    if (order) copied.order = order
    return copied
  } catch { return null }
}
export function decodeMacThsRecovery(value: unknown): RecoveryCommand | null {
  try {
    if (!plain(value)) return null
    if (fields(value, ['kind']) && (value.kind === 'initialize' || value.kind === 'provisionLegacy')) return { kind: value.kind }
    if (fields(value, ['kind', 'recoveryId', 'manifestHash', 'expectedRevision']) && value.kind === 'apply' &&
      hash(value.recoveryId) && hash(value.manifestHash) && revision(value.expectedRevision))
      return { kind: 'apply', recoveryId: value.recoveryId, manifestHash: value.manifestHash, expectedRevision: value.expectedRevision }
    return null
  } catch { return null }
}
export function decodeMacThsReview(value: unknown): ReviewCommand | null {
  try {
    if (!plain(value) || !fields(value, ['intentId', 'snapshotHash', 'expectedRevision', 'reviewRequestId', 'observation'], ['recoveryId']) ||
      !id(value.intentId) || !(value.snapshotHash === null || hash(value.snapshotHash)) || !revision(value.expectedRevision) ||
      !id(value.reviewRequestId) || (value.recoveryId !== undefined && !hash(value.recoveryId))) return null
    const o = value.observation
    if (!fields(o, ['statement', 'scope', 'releaseGate']) || !['still_uncertain', 'order_seen', 'cancel_seen', 'no_order_seen'].includes(String(o.statement)) ||
      !Array.isArray(o.scope) || !o.scope.length || o.scope.length > 3 || new Set(o.scope).size !== o.scope.length ||
      !o.scope.every(v => ['orders', 'deals', 'confirmation'].includes(v)) || typeof o.releaseGate !== 'boolean' ||
      (o.releaseGate && (o.statement === 'still_uncertain' || o.scope.length !== 3))) return null
    return JSON.parse(JSON.stringify(value)) as ReviewCommand
  } catch { return null }
}
export function safeMacThsDiagnostic(value: MacThsResult | null, authoritativeState?: MacThsProductState | null) {
  const state = authoritativeState ?? value?.state
  const status = (v: unknown) => typeof v === 'string' && ['recognized', 'missing', 'ambiguous', 'invalid'].includes(v) ? v : 'invalid'
  const nextActions = ['open_trade_view', 'select_account', 'show_dated_orders', 'review_native_dialog', 'check_again']
  return {
    schemaVersion: 1, component: 'mac-ths-ui-experiment', adapterVersion: '3', tested: !!value,
    ...(value ? {
      runtime: value.runtime === 'macos' ? 'macos' : 'other',
      architecture: value.architecture === 'arm64' || value.architecture === 'x64' ? value.architecture : 'other',
      action: MAC_THS_ACTIONS.includes(value.action) ? value.action : 'probe',
      mode: value.mode === 'simulation' ? 'simulation' : value.mode === 'livePreview' ? 'livePreview' : 'live',
      outcome: value.outcome === 'passed' || value.outcome === 'unknown' ? value.outcome : 'blocked',
      code: MAC_THS_CODES.includes(value.code) ? value.code : 'SCRIPT_ERROR',
    } : {}),
    unknownPending: (state?.unknownPending ?? value?.unknownPending) === true,
    canSubmitLiveOrders: state ? state.canPrepare === true && state.liveEnabled === true : value?.canSubmitLiveOrders === true,
    canRunUnattended: false,
    ...(state ? {
      serviceState: MAC_THS_SERVICE_STATES.includes(state.serviceState) ? state.serviceState : 'BLOCKED_STORAGE',
      recoveryReason: state.recoveryReason && MAC_THS_RECOVERY_REASONS.includes(state.recoveryReason) ? state.recoveryReason : null,
      intentCount: Array.isArray(state.intents) ? state.intents.length : 0,
      reviewCount: Array.isArray(state.intents) ? state.intents.filter(i => i.recoveryQuarantine ||
        (['UNKNOWN', 'LEGACY_UNKNOWN'].includes(i.state) && !i.gateReleased)).length : 0,
      capabilities: state.capabilities ? {
        account: status(state.capabilities.account), mode: status(state.capabilities.mode),
        tradingDate: status(state.capabilities.tradingDate), headers: status(state.capabilities.headers),
        readback: status(state.capabilities.readback), receipt: status(state.capabilities.receipt),
        nextAction: nextActions.includes(state.capabilities.nextAction) ? state.capabilities.nextAction : 'check_again',
      } : null,
    } : {}),
  }
}
