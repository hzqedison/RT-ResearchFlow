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
}
export interface MacThsRequest {
  action: MacThsAction
  mode?: MacThsMode
  order?: MacThsOrder
  requestId?: string
  contractNo?: string
  confirmationToken?: string
  liveRiskAcknowledged?: boolean
}
export interface MacThsResult {
  schemaVersion: 1
  component: 'mac-ths-ui-experiment'
  adapterVersion: '2'
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
export function safeMacThsDiagnostic(value: MacThsResult | null) {
  if (!value) return { schemaVersion: 1, component: 'mac-ths-ui-experiment', tested: false }
  return {
    schemaVersion: 1, component: 'mac-ths-ui-experiment', adapterVersion: '2', tested: true,
    runtime: value.runtime === 'macos' ? 'macos' : 'other',
    architecture: value.architecture === 'arm64' || value.architecture === 'x64' ? value.architecture : 'other',
    action: MAC_THS_ACTIONS.includes(value.action) ? value.action : 'probe',
    mode: value.mode === 'simulation' ? 'simulation' : value.mode === 'livePreview' ? 'livePreview' : 'live',
    outcome: value.outcome === 'passed' || value.outcome === 'unknown' ? value.outcome : 'blocked',
    code: MAC_THS_CODES.includes(value.code) ? value.code : 'SCRIPT_ERROR',
    unknownPending: value.unknownPending === true,
    canSubmitLiveOrders: value.canSubmitLiveOrders === true, canRunUnattended: false,
  }
}
