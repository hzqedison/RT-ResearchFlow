import type { MacThsMode } from './macThsTypes'

export const NATIVE_LAYOUT_PROFILE = 'citics-explicit-ax-v1' as const
export const NATIVE_OUTPUT_LIMIT = 4096
export const NATIVE_MAX_ROWS = 64
export const NATIVE_ACTIONS = ['observe_context', 'observe_cancel_target', 'execute', 'observe_receipt'] as const
export type NativeAction = typeof NATIVE_ACTIONS[number]
export type NativeFieldState = 'recognized' | 'missing' | 'ambiguous' | 'invalid' | 'masked_only'
export interface NativeCompatibility {
  adapterVersion: '3'
  clientVersion: string | null
  layoutProfile: string | null
  account: NativeFieldState
  mode: NativeFieldState
  tradingDate: NativeFieldState
  headers: NativeFieldState
  readback: NativeFieldState
  receipt: NativeFieldState
  nextAction: 'open_trade_view' | 'select_account' | 'show_dated_orders' | 'review_native_dialog' | 'check_again'
}
export interface NativeAccountWitness {
  kind: 'fund_account' | 'shareholder_account'
  value: string
  broker: 'citics'
  selected: true
}
export interface NativeOrderFields {
  symbol: string
  market: 'SH' | 'SZ' | 'BJ'
  side: 'buy' | 'sell'
  priceCents: number
  quantity: number
}
export interface NativeTarget extends NativeOrderFields {
  contractNo: string
  tradingDate: string
  observation: 'accepted' | 'cancelled' | 'partially_cancelled' | null
  filledQuantity: number | null
  cancelledQuantity: number | null
}
export interface NativeScriptRequest {
  nonce: string
  action: NativeAction
  mode: MacThsMode
  expectedAccount: NativeAccountWitness | null
  expectedClientVersion: string | null
  expectedDate: string | null
  order: NativeOrderFields | null
  contractNo: string | null
  beforeContracts: readonly string[] | null
}
export const NATIVE_CODES = [
  'READY', 'TARGET_OBSERVED', 'CLIENT_NOT_RUNNING', 'TRADE_VIEW_REQUIRED', 'MODE_UNVERIFIED',
  'LAYOUT_UNSUPPORTED', 'ACCOUNT_IDENTITY_UNAVAILABLE', 'TRADING_DATE_UNAVAILABLE',
  'TABLE_UNSUPPORTED', 'TARGET_UNVERIFIED', 'READBACK_MISMATCH', 'ORDER_CONTROL_DISABLED',
  'NATIVE_CONFIRMATION_REQUIRED', 'RECEIPT_UNKNOWN', 'LIVE_ACCEPTED', 'SIMULATION_ACCEPTED',
  'LIVE_CANCELLED', 'SIMULATION_CANCELLED', 'AUTOMATION_DENIED', 'SCRIPT_ERROR',
] as const
export type NativeCode = typeof NATIVE_CODES[number]
/** Private process protocol. Never put the witness or this envelope into IPC/audit/export. */
export interface NativeObservationV1 {
  version: 1
  nonce: string
  action: NativeAction
  phase: 'observed' | 'before_submit' | 'after_submit'
  clientVersion: string | null
  layoutProfile: typeof NATIVE_LAYOUT_PROFILE | null
  fields: Pick<NativeCompatibility, 'account' | 'mode' | 'tradingDate' | 'headers' | 'readback' | 'receipt'>
  account: NativeAccountWitness | null
  mode: 'live' | 'simulation' | null
  tradingDate: string | null
  readback: NativeOrderFields | null
  target: NativeTarget | null
  beforeContracts: string[] | null
  contractMatch: 'unique_new' | 'unique_target' | null
  submitTouched: boolean
  code: NativeCode
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const contract = /^[a-zA-Z0-9-]{1,32}$/
const version = /^[0-9][a-zA-Z0-9._-]{0,39}$/
export function nativeProtocolError(): never { throw Object.assign(new Error('NATIVE_PROTOCOL_INVALID'), { code: 'NATIVE_PROTOCOL_INVALID' }) }
function must(value: unknown): asserts value { if (!value) nativeProtocolError() }
function record(value: unknown, names: string[]): asserts value is Record<string, unknown> {
  must(value !== null && typeof value === 'object' && !Array.isArray(value))
  const descriptors = Object.getOwnPropertyDescriptors(value)
  must(Reflect.ownKeys(descriptors).length === names.length)
  for (const name of names) must(descriptors[name] && 'value' in descriptors[name] && descriptors[name].enumerable)
}
function integer(value: unknown, minimum: number, maximum: number): asserts value is number {
  must(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum)
}
export function validNativeDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}
function account(value: unknown): asserts value is NativeAccountWitness {
  record(value, ['kind', 'value', 'broker', 'selected'])
  must(['fund_account', 'shareholder_account'].includes(String(value.kind)))
  must(typeof value.value === 'string' && /^[A-Z0-9]{6,32}$/.test(value.value))
  must(value.broker === 'citics' && value.selected === true)
}
function order(value: unknown, target = false): void {
  const fields = ['symbol', 'market', 'side', 'priceCents', 'quantity']
  record(value, target ? [...fields, 'contractNo', 'tradingDate', 'observation', 'filledQuantity', 'cancelledQuantity'] : fields)
  must(typeof value.symbol === 'string' && /^\d{6}$/.test(value.symbol))
  must(['SH', 'SZ', 'BJ'].includes(String(value.market)) && ['buy', 'sell'].includes(String(value.side)))
  integer(value.priceCents, 1, 9_999_999)
  integer(value.quantity, 1, 1_000_000)
  if (target) {
    must(typeof value.contractNo === 'string' && contract.test(value.contractNo) && validNativeDate(value.tradingDate))
    must(value.observation === null || ['accepted', 'cancelled', 'partially_cancelled'].includes(String(value.observation)))
    for (const name of ['filledQuantity', 'cancelledQuantity']) if (value[name] !== null) integer(value[name], 0, value.quantity)
    if (value.filledQuantity !== null && value.cancelledQuantity !== null) {
      must((value.filledQuantity as number) + (value.cancelledQuantity as number) <= value.quantity)
    }
    if (value.observation === 'accepted') must(value.cancelledQuantity === null || value.cancelledQuantity === 0)
    if (value.observation === 'cancelled' || value.observation === 'partially_cancelled') {
      must(value.cancelledQuantity === null || (value.cancelledQuantity as number) > 0)
      must(value.filledQuantity === null || (value.filledQuantity as number) < value.quantity)
      if (value.observation === 'partially_cancelled') must(value.cancelledQuantity === null || (value.cancelledQuantity as number) < value.quantity)
      if (value.observation === 'cancelled' && value.filledQuantity !== null && value.cancelledQuantity !== null)
        must((value.filledQuantity as number) + (value.cancelledQuantity as number) === value.quantity)
    }
  }
}
function contracts(value: unknown): void {
  must(Array.isArray(value) && value.length <= NATIVE_MAX_ROWS)
  must(value.every(item => typeof item === 'string' && contract.test(item)) && new Set(value).size === value.length)
}
export function validateNativeScriptRequest(value: unknown): asserts value is NativeScriptRequest {
  record(value, ['nonce', 'action', 'mode', 'expectedAccount', 'expectedClientVersion', 'expectedDate', 'order', 'contractNo', 'beforeContracts'])
  must(typeof value.nonce === 'string' && uuid.test(value.nonce))
  must(NATIVE_ACTIONS.includes(value.action as NativeAction) && ['simulation', 'livePreview', 'live'].includes(String(value.mode)))
  if (value.expectedAccount !== null) account(value.expectedAccount)
  must(value.expectedClientVersion === null || (typeof value.expectedClientVersion === 'string' && version.test(value.expectedClientVersion)))
  must(value.expectedDate === null || validNativeDate(value.expectedDate))
  if (value.order !== null) order(value.order)
  must(value.contractNo === null || (typeof value.contractNo === 'string' && contract.test(value.contractNo)))
  if (value.beforeContracts !== null) contracts(value.beforeContracts)
  if (value.action === 'execute') {
    must(value.mode !== 'livePreview' && value.expectedAccount !== null && value.expectedClientVersion !== null
      && value.expectedDate !== null && value.order !== null)
  }
  if (value.action === 'observe_cancel_target') must(value.contractNo !== null)
}
/** JSON.parse validates the grammar, but loses duplicate members. Walk the same
 * bounded source before using its result, comparing decoded keys at every depth. */
function parseUniqueJson(source: string): unknown {
  const parsed: unknown = JSON.parse(source)
  let offset = 0
  const whitespace = () => { while (offset < source.length && /[ \t\r\n]/.test(source[offset])) offset++ }
  const string = (): string => {
    const start = offset
    must(source[offset++] === '"')
    while (offset < source.length) {
      const character = source[offset++]
      if (character === '\\') offset++
      else if (character === '"') return JSON.parse(source.slice(start, offset)) as string
    }
    return nativeProtocolError()
  }
  const value = (depth: number): void => {
    must(depth <= 16)
    whitespace()
    const opening = source[offset]
    if (opening === '{') {
      offset++; whitespace()
      const seen = new Set<string>()
      if (source[offset] === '}') { offset++; return }
      for (;;) {
        whitespace()
        const key = string()
        must(!seen.has(key)); seen.add(key)
        whitespace(); must(source[offset++] === ':')
        value(depth + 1); whitespace()
        const separator = source[offset++]
        if (separator === '}') return
        must(separator === ',')
      }
    }
    if (opening === '[') {
      offset++; whitespace()
      if (source[offset] === ']') { offset++; return }
      for (;;) {
        value(depth + 1); whitespace()
        const separator = source[offset++]
        if (separator === ']') return
        must(separator === ',')
      }
    }
    if (opening === '"') { string(); return }
    const start = offset
    while (offset < source.length && !/[,\]} \t\r\n]/.test(source[offset])) offset++
    must(offset > start)
  }
  value(0); whitespace(); must(offset === source.length)
  return parsed
}
function matchingOrder(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return ['symbol', 'market', 'side', 'priceCents', 'quantity'].every(key => left[key] === right[key])
}
/** Parses one bounded UTF-8 JSON object; legacy success strings are not evidence. */
export function decodeNativeObservation(output: Uint8Array | string, expected: Pick<NativeScriptRequest, 'nonce' | 'action'>
  & Partial<Pick<NativeScriptRequest, 'mode' | 'expectedDate' | 'order' | 'contractNo'>>): NativeObservationV1 {
  const bytes = typeof output === 'string' ? Buffer.from(output, 'utf8') : Buffer.from(output)
  must(bytes.length > 0 && bytes.length <= NATIVE_OUTPUT_LIMIT)
  let value: unknown
  try { value = parseUniqueJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { nativeProtocolError() }
  record(value, ['version', 'nonce', 'action', 'phase', 'clientVersion', 'layoutProfile', 'fields', 'account',
    'mode', 'tradingDate', 'readback', 'target', 'beforeContracts', 'contractMatch', 'submitTouched', 'code'])
  must(value.version === 1 && typeof value.nonce === 'string' && uuid.test(value.nonce) && value.nonce === expected.nonce)
  must(value.action === expected.action && NATIVE_ACTIONS.includes(value.action as NativeAction))
  must(['observed', 'before_submit', 'after_submit'].includes(String(value.phase)))
  must(value.clientVersion === null || (typeof value.clientVersion === 'string' && version.test(value.clientVersion)))
  must(value.layoutProfile === null || value.layoutProfile === NATIVE_LAYOUT_PROFILE)
  record(value.fields, ['account', 'mode', 'tradingDate', 'headers', 'readback', 'receipt'])
  for (const field of Object.values(value.fields)) must(['recognized', 'missing', 'ambiguous', 'invalid', 'masked_only'].includes(String(field)))
  if (value.account !== null) { account(value.account); must(value.fields.account === 'recognized') }
  else must(value.fields.account !== 'recognized')
  must(value.mode === null || value.mode === 'live' || value.mode === 'simulation')
  must((value.mode !== null) === (value.fields.mode === 'recognized'))
  must(value.tradingDate === null || validNativeDate(value.tradingDate))
  must((value.tradingDate !== null) === (value.fields.tradingDate === 'recognized'))
  if (value.readback !== null) { order(value.readback); must(value.fields.readback === 'recognized') }
  else must(value.fields.readback !== 'recognized')
  if (value.target !== null) order(value.target, true)
  if (value.beforeContracts !== null) contracts(value.beforeContracts)
  must(value.contractMatch === null || ['unique_new', 'unique_target'].includes(String(value.contractMatch)))
  must(typeof value.submitTouched === 'boolean' && NATIVE_CODES.includes(value.code as NativeCode))
  if (value.action === 'execute') must(value.phase === (value.submitTouched ? 'after_submit' : 'before_submit'))
  else must(!value.submitTouched && value.phase === 'observed')
  if (value.contractMatch !== null) must(value.target !== null && value.fields.receipt === 'recognized')
  const accepted = value.code === 'LIVE_ACCEPTED' || value.code === 'SIMULATION_ACCEPTED'
  const cancelled = value.code === 'LIVE_CANCELLED' || value.code === 'SIMULATION_CANCELLED'
  if (accepted || cancelled) {
    must(value.action === 'execute' || value.action === 'observe_receipt')
    must(value.layoutProfile === NATIVE_LAYOUT_PROFILE && value.clientVersion !== null)
    for (const name of ['account', 'mode', 'tradingDate', 'headers', 'receipt']) must(value.fields[name] === 'recognized')
    must(value.target !== null && typeof value.target === 'object')
    const target = value.target as Record<string, unknown>
    must(target.tradingDate === value.tradingDate)
    must(value.mode === (String(value.code).startsWith('SIMULATION_') ? 'simulation' : 'live'))
    if (expected.mode !== undefined) must(value.mode === (expected.mode === 'simulation' ? 'simulation' : 'live'))
    if (expected.expectedDate !== undefined && expected.expectedDate !== null) must(value.tradingDate === expected.expectedDate)
    if (expected.order) must(matchingOrder(target, expected.order as unknown as Record<string, unknown>))
    if (accepted) {
      must(value.contractMatch === 'unique_new' && target.observation === 'accepted' && value.beforeContracts !== null)
      must(!(value.beforeContracts as string[]).includes(target.contractNo as string))
      if (value.action === 'execute') {
        must(value.fields.readback === 'recognized' && value.readback !== null)
        must(matchingOrder(value.readback as Record<string, unknown>, target))
      }
      if (expected.contractNo !== undefined) must(expected.contractNo === null)
    } else {
      must(value.contractMatch === 'unique_target' && ['cancelled', 'partially_cancelled'].includes(String(target.observation)))
      if (expected.contractNo !== undefined) must(expected.contractNo !== null && target.contractNo === expected.contractNo)
    }
  }
  return value as unknown as NativeObservationV1
}
export function unavailableNativeCompatibility(): NativeCompatibility {
  return { adapterVersion: '3', clientVersion: null, layoutProfile: null, account: 'missing', mode: 'missing',
    tradingDate: 'missing', headers: 'missing', readback: 'missing', receipt: 'missing', nextAction: 'open_trade_view' }
}
export function nativeCompatibility(packet: NativeObservationV1): NativeCompatibility {
  return { adapterVersion: '3', clientVersion: packet.clientVersion, layoutProfile: packet.layoutProfile, ...packet.fields,
    nextAction: packet.code === 'NATIVE_CONFIRMATION_REQUIRED' ? 'review_native_dialog'
      : packet.fields.account !== 'recognized' ? 'select_account' : packet.fields.tradingDate !== 'recognized'
        ? 'show_dated_orders' : packet.layoutProfile === null ? 'open_trade_view' : 'check_again' }
}

/** Explicit synthetic protocol fixture only. Production adapter never calls this constructor. */
export function createNativeObservationFixture(request: NativeScriptRequest,
  facts: { account: NativeAccountWitness; clientVersion: string; tradingDate: string; target?: NativeTarget },
  overrides: Partial<NativeObservationV1> = {}): NativeObservationV1 {
  validateNativeScriptRequest(request)
  const executing = request.action === 'execute'
  const target = facts.target ?? null
  const match = target && (executing || request.action === 'observe_receipt')
    ? request.contractNo ? 'unique_target' : 'unique_new' : null
  const packet: NativeObservationV1 = {
    version: 1, nonce: request.nonce, action: request.action, phase: executing ? 'after_submit' : 'observed',
    clientVersion: facts.clientVersion, layoutProfile: NATIVE_LAYOUT_PROFILE,
    fields: { account: 'recognized', mode: 'recognized', tradingDate: 'recognized', headers: 'recognized',
      readback: executing && request.order ? 'recognized' : 'missing', receipt: target ? 'recognized' : 'missing' },
    account: { ...facts.account }, mode: request.mode === 'simulation' ? 'simulation' : 'live', tradingDate: facts.tradingDate,
    readback: executing ? request.order : null, target, beforeContracts: executing ? [] : request.beforeContracts ? [...request.beforeContracts] : null,
    contractMatch: match, submitTouched: executing,
    code: target ? request.action === 'observe_cancel_target' ? 'TARGET_OBSERVED' : request.contractNo
      ? request.mode === 'simulation' ? 'SIMULATION_CANCELLED' : 'LIVE_CANCELLED'
      : request.mode === 'simulation' ? 'SIMULATION_ACCEPTED' : 'LIVE_ACCEPTED'
      : request.action === 'observe_context' ? 'READY' : 'RECEIPT_UNKNOWN',
    ...overrides,
  }
  return decodeNativeObservation(JSON.stringify(packet), request)
}
