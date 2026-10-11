export interface LedgerFees { commission: string; stampDuty: string; transferFee: string; other: string }
export interface LedgerOpeningPosition { symbol: string; quantity: number; costBasis: string | null }
export interface CreateLedgerAccount {
  accountId: string; label: string; openingCash: string; openingAt: number
  openingPositions: LedgerOpeningPosition[]; openingPositionsComplete: boolean; cashConfirmed: true
}
export interface LedgerAccount extends Omit<CreateLedgerAccount, 'accountId' | 'cashConfirmed'> {
  id: string; currency: 'CNY'; source: 'manual-confirmed'; revision: number; createdAt: number
}
interface LedgerReferencedEvent {
  reference: string; occurredAt: number; correctionOf: string | null; confirmed: true
}
export type LedgerEvent =
  | (LedgerReferencedEvent & { kind: 'fill'; symbol: string; side: 'buy' | 'sell'; quantity: number; price: string; fees: LedgerFees | null })
  | (LedgerReferencedEvent & { kind: 'cash'; direction: 'in' | 'out'; amount: string })
  | { kind: 'reversal'; targetEventId: string; reason: string; confirmed: true }
export interface AppendLedgerEvent { accountId: string; eventId: string; expectedRevision: number; event: LedgerEvent }
export interface LedgerRecord { id: string; revision: number; recordedAt: number; event: LedgerEvent }
export type LedgerIssue = 'FEES_UNKNOWN' | 'OPENING_POSITIONS_INCOMPLETE' | 'NEGATIVE_BOOK_CASH' | 'POSITION_RECONCILIATION_REQUIRED' | 'COST_BASIS_UNKNOWN'
export interface LedgerSnapshot {
  account: LedgerAccount; cashBalance: string | null; availableCash: null; feesTotal: string | null
  realizedPnl: string | null; brokerVerified: false; basisPolicy: 'weighted-average-book'
  positions: Array<{ symbol: string; quantity: number | null; quantityDelta: number; costBasis: string | null; availableQuantity: null }>
  issues: LedgerIssue[]; records: LedgerRecord[]; totalRecords: number; reversedIds: string[]
}
export type LedgerCode = 'INVALID_INPUT' | 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_CONFLICT' | 'ALIAS_EXISTS' | 'REVISION_CONFLICT' | 'EVENT_CONFLICT' | 'REFERENCE_EXISTS' | 'INVALID_CORRECTION' | 'INVALID_REVERSAL' | 'LIMIT_REACHED' | 'UNAUTHORIZED' | 'STORAGE_UNAVAILABLE'
export type LedgerResult<T> = { ok: true; data: T } | { ok: false; code: LedgerCode; message: string }
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export const isLedgerId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
export function ledgerMoney(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  return `${whole}.${fraction.padEnd(2, '0')}`
}
export const ledgerCents = (value: string): bigint => BigInt(value.replace('.', ''))
export function ledgerAmount(cents: bigint): string {
  const negative = cents < BigInt(0); const value = negative ? -cents : cents
  return `${negative ? '-' : ''}${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, '0')}`
}
function object(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value'))
}
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 946684800000
const quantity = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 1000000000
const symbol = (value: unknown): value is string => typeof value === 'string' && /^\d{6}\.(SH|SZ|BJ)$/.test(value)
export function decodeLedgerAccount(value: unknown): CreateLedgerAccount | null {
  try {
    if (!object(value, ['accountId', 'label', 'openingCash', 'openingAt', 'openingPositions', 'openingPositionsComplete', 'cashConfirmed'])
      || !isLedgerId(value.accountId) || !text(value.label, 40) || !timestamp(value.openingAt)
      || value.cashConfirmed !== true || typeof value.openingPositionsComplete !== 'boolean'
      || !Array.isArray(value.openingPositions) || value.openingPositions.length > 200) return null
    const openingCash = ledgerMoney(value.openingCash); if (openingCash === null) return null
    const positions: LedgerOpeningPosition[] = []
    for (const p of value.openingPositions) {
      if (!object(p, ['symbol', 'quantity', 'costBasis']) || !symbol(p.symbol) || !quantity(p.quantity)) return null
      const costBasis = p.costBasis === null ? null : ledgerMoney(p.costBasis)
      if (p.costBasis !== null && costBasis === null || positions.some(old => old.symbol === p.symbol)) return null
      positions.push({ symbol: p.symbol, quantity: p.quantity, costBasis })
    }
    return { accountId: value.accountId, label: value.label.trim(), openingCash, openingAt: value.openingAt,
      openingPositions: positions.sort((a, b) => a.symbol.localeCompare(b.symbol)), openingPositionsComplete: value.openingPositionsComplete, cashConfirmed: true }
  } catch { return null }
}
export function decodeLedgerAppend(value: unknown): AppendLedgerEvent | null {
  try {
    if (!object(value, ['accountId', 'eventId', 'expectedRevision', 'event']) || !isLedgerId(value.accountId) || !isLedgerId(value.eventId)
      || typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) return null
    const e = value.event as Record<string, unknown>
    let event: LedgerEvent
    if (e?.kind === 'reversal') {
      if (!object(e, ['kind', 'targetEventId', 'reason', 'confirmed']) || !isLedgerId(e.targetEventId) || !text(e.reason, 120) || e.confirmed !== true) return null
      event = { kind: 'reversal', targetEventId: e.targetEventId, reason: e.reason.trim(), confirmed: true }
    } else {
      const base = ['kind', 'reference', 'occurredAt', 'correctionOf', 'confirmed']
      if (!object(e, e?.kind === 'fill' ? [...base, 'symbol', 'side', 'quantity', 'price', 'fees'] : [...base, 'direction', 'amount'])
        || !text(e.reference, 80) || !timestamp(e.occurredAt) || e.confirmed !== true
        || e.correctionOf !== null && !isLedgerId(e.correctionOf)) return null
      const common = { reference: e.reference.trim(), occurredAt: e.occurredAt, correctionOf: e.correctionOf as string | null, confirmed: true as const }
      if (e.kind === 'fill') {
        const price = ledgerMoney(e.price)
        if (!symbol(e.symbol) || !quantity(e.quantity) || !['buy', 'sell'].includes(String(e.side)) || price === null || ledgerCents(price) <= BigInt(0)) return null
        let fees: LedgerFees | null = null
        if (e.fees !== null) {
          if (!object(e.fees, ['commission', 'stampDuty', 'transferFee', 'other'])) return null
          const normalized = Object.fromEntries(['commission', 'stampDuty', 'transferFee', 'other'].map(key => [key, ledgerMoney(e.fees![key])]))
          if (Object.values(normalized).some(amount => amount === null)) return null
          fees = normalized as unknown as LedgerFees
        }
        event = { ...common, kind: 'fill', symbol: e.symbol, side: e.side as 'buy' | 'sell', quantity: e.quantity, price, fees }
      } else {
        const amount = ledgerMoney(e.amount)
        if (e.kind !== 'cash' || !['in', 'out'].includes(String(e.direction)) || amount === null || ledgerCents(amount) <= BigInt(0)) return null
        event = { ...common, kind: 'cash', direction: e.direction as 'in' | 'out', amount }
      }
    }
    return { accountId: value.accountId, eventId: value.eventId, expectedRevision: value.expectedRevision, event }
  } catch { return null }
}
