import { createHash } from 'node:crypto'
import type { LimitListDailyRow, StkAuctionRow } from '../database/types'
import { validTradeDate, type KnownCalendar } from './dataReadinessService'
import { getBeijingEpochForYmd, getBeijingYmd, offsetYmd } from './marketSettlementPolicy'

export const AUCTION_REQUEST_MS = 30_000
export const AUCTION_RETRY_COOLDOWN_MS = 60_000
export const MAX_ENTRY_DATES = 2
// Request admission is independent of the two-date snapshot cache.
export const MAX_AUCTION_COOLDOWNS = 32

export interface EntryDateContext {
  tradeDate: string
  today: string
  status: 'open' | 'closed' | 'unknown' | 'future'
  reasonCode: string
  previousTradeDate: string | null
  calendarFacts: Array<{ date: string; isOpen: number | null; conflict: boolean }>
}
export interface EntryAttempt {
  targetTradeDate: string
  startedAt: number
  endedAt: number
  source: 'tushare'
  outcome: 'success' | 'partial' | 'empty' | 'failed' | 'blocked'
  reasonCode: string
}
export interface EntryReadiness {
  targetTradeDate: string
  previousTradeDate: string | null
  calendar: EntryDateContext['status']
  reasonCode: string
  phase: 'blocked' | 'waiting' | 'preview' | 'observed_provisional' | 'due_unconfirmed' | 'observed_after_cutoff' | 'historical'
  source: string
  fingerprint: string
  retryable: boolean
  auction: {
    state: 'missing_or_empty' | 'invalid' | 'partial' | 'present'
    validRows: number
    invalidRows: number
    allMarketInputRows: number
    observedAt: number | null
    observationSource: 'stk_auction_cache' | null
    eligibleRows: number
    afterCutoffRows: number
    completeCoverage: false
  }
  previousLimit: { state: 'unknown' | 'missing_or_empty' | 'partial' | 'present'; rows: number; validRows: number }
  pools: Record<string, { state: 'blocked' | 'partial' | 'ready' | 'no_match'; reasonCode: string; candidates: number }>
  lastAttempt: EntryAttempt | null
}

// Explicit business target, NOT the diagnostic 09:30 default.
// The first unknown day stops the predecessor search.
export function resolveEntryDate(calendar: KnownCalendar, tradeDate: string, now: number): EntryDateContext {
  const result: EntryDateContext = { tradeDate, today: getBeijingYmd(now), status: 'unknown',
    reasonCode: 'CALENDAR_UNAVAILABLE', previousTradeDate: null, calendarFacts: [] }
  if (!validTradeDate(tradeDate)) return result
  if (tradeDate > result.today) return { ...result, status: 'future', reasonCode: 'FUTURE_TRADE_DATE' }
  const known = (date: string): number | null => {
    const fact = calendar(date)
    result.calendarFacts.push({ date, isOpen: fact?.isOpen ?? null, conflict: fact?.conflict === true })
    return fact && !fact.conflict && [0, 1].includes(fact.isOpen) ? fact.isOpen : null
  }
  const target = known(tradeDate)
  if (target === null) return result
  result.status = target === 1 ? 'open' : 'closed'
  result.reasonCode = target === 1 ? 'KNOWN_TRADE_DATE' : 'NON_TRADING_DAY'
  let date = offsetYmd(tradeDate, -1)
  for (let i = 0; i < 3660; i++, date = offsetYmd(date, -1)) {
    const open = known(date)
    if (open === null) break
    if (open === 1) { result.previousTradeDate = date; break }
  }
  return result
}

const numericFields = ['vol', 'price', 'amount', 'preClose', 'turnoverRate', 'volumeRatio', 'floatShare'] as const
const codePattern = /^\d{6}\.(SH|SZ|BJ)$/
export function validAuctionFact(row: StkAuctionRow, date: string): boolean {
  return row.tradeDate === date && codePattern.test(row.tsCode)
    && numericFields.every(key => row[key] == null || (Number.isFinite(row[key]) && row[key]! >= 0))
    && row.price != null && row.price > 0 && row.preClose != null && row.preClose > 0
    && row.amount != null && Number.isFinite(row.amount) && row.amount >= 0
    && row.turnoverRate != null && Number.isFinite(row.turnoverRate) && row.turnoverRate >= 0
}
export function validPreviousLimit(row: LimitListDailyRow, date: string | null): boolean {
  return row.tradeDate === date && codePattern.test(row.tsCode) && ['U', 'D', 'Z'].includes(row.limit ?? '')
    && row.limitTimes != null && Number.isFinite(row.limitTimes) && row.limitTimes >= (row.limit === 'U' ? 1 : 0)
    && row.openTimes != null && Number.isFinite(row.openTimes) && row.openTimes >= 0
}
export function observationTime(row: StkAuctionRow, date: string, now: number): number | null {
  return validAuctionFact(row, date) && Number.isFinite(row.fetchedAt) && row.fetchedAt > 0
    && row.fetchedAt <= now && row.fetchedAt >= getBeijingEpochForYmd(date, 0, 0) ? row.fetchedAt : null
}
export function cutoffObservation(row: StkAuctionRow, date: string, now: number): number | null {
  const observed = observationTime(row, date, now)
  return observed !== null && observed >= getBeijingEpochForYmd(date, 9, 30) ? observed : null
}
export function signalObservation(row: StkAuctionRow, date: string, now: number): number | null {
  const observed = observationTime(row, date, now)
  return date === getBeijingYmd(now) && observed !== null && observed >= getBeijingEpochForYmd(date, 9, 28)
    && row.floatShare != null && row.floatShare > 0 ? observed : null
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}
export function entryFingerprint(context: EntryDateContext, source: string, auction: StkAuctionRow[], limits: LimitListDailyRow[]): string {
  const sorted = (rows: unknown[]) => rows.map(row => JSON.stringify(canonical(row))).sort()
  return createHash('sha256').update(JSON.stringify([canonical(context), source, sorted(auction), sorted(limits)])).digest('hex')
}

// Preserve old non-null fields AND their observation time. A newer local writer wins.
export function mergeAuctionFacts(local: StkAuctionRow[], remote: StkAuctionRow[], date: string, observedAt: number): {
  rows: StkAuctionRow[]; partial: boolean
} {
  const existing = new Map(local.map(row => [row.tsCode, row]))
  const seen = new Set<string>()
  let partial = false
  const rows = remote.map(row => {
    if (row.tradeDate !== date || !codePattern.test(row.tsCode) || seen.has(row.tsCode)
      || numericFields.some(key => row[key] != null && (!Number.isFinite(row[key]) || row[key]! < 0))
      || row.price === 0 || row.preClose === 0) throw new Error('FACT_INVALID')
    seen.add(row.tsCode)
    const old = existing.get(row.tsCode)
    if (old && old.fetchedAt > observedAt) { partial = true; return { ...old } }
    const merged = { ...row, fetchedAt: observedAt }
    for (const key of numericFields) {
      if (row[key] == null && old?.[key] != null) {
        merged[key] = old[key]
        merged.fetchedAt = old.fetchedAt
        partial = true
      }
    }
    if (!validAuctionFact(merged, date)) throw new Error('FACT_INVALID')
    if (merged.floatShare == null) partial = true
    return merged
  })
  return { rows, partial }
}

export function describeEntry(context: EntryDateContext, source: string, fingerprint: string,
  auction: StkAuctionRow[], limits: LimitListDailyRow[], now: number, lastAttempt: EntryAttempt | null): EntryReadiness {
  const valid = auction.filter(row => validAuctionFact(row, context.tradeDate))
  const observations = valid.map(row => observationTime(row, context.tradeDate, now)).filter((time): time is number => time !== null)
  const eligibleRows = valid.filter(row => signalObservation(row, context.tradeDate, now) !== null).length
  const afterCutoffRows = valid.filter(row => cutoffObservation(row, context.tradeDate, now) !== null).length
  let phase: EntryReadiness['phase']
  if (context.status !== 'open') phase = 'blocked'
  else if (context.tradeDate < context.today) phase = 'historical'
  else if (now < getBeijingEpochForYmd(context.tradeDate, 9, 28)) phase = valid.length ? 'preview' : 'waiting'
  else if (now < getBeijingEpochForYmd(context.tradeDate, 9, 30)) phase = eligibleRows ? 'observed_provisional' : 'waiting'
  // This aggregate never promotes mixed observations. Individual pools check their own inputs.
  else phase = afterCutoffRows > 0 && afterCutoffRows === auction.length ? 'observed_after_cutoff' : 'due_unconfirmed'
  const validLimits = limits.filter(row => validPreviousLimit(row, context.previousTradeDate))
  return {
    targetTradeDate: context.tradeDate, previousTradeDate: context.previousTradeDate, calendar: context.status,
    reasonCode: context.status !== 'open' ? context.reasonCode : valid.length ? 'OBSERVED_FACTS_ONLY' : 'AUCTION_MISSING_OR_INVALID',
    phase, source, fingerprint, retryable: lastAttempt?.reasonCode === 'AUCTION_REQUEST_CAPACITY',
    auction: { state: !auction.length ? 'missing_or_empty' : !valid.length ? 'invalid' : valid.length < auction.length ? 'partial' : 'present',
      validRows: valid.length, invalidRows: auction.length - valid.length,
      allMarketInputRows: valid.filter(row => row.floatShare != null && row.floatShare > 0).length,
      observedAt: observations.length ? Math.max(...observations) : null,
      observationSource: observations.length ? 'stk_auction_cache' : null,
      eligibleRows, afterCutoffRows, completeCoverage: false },
    previousLimit: { state: !context.previousTradeDate ? 'unknown' : !limits.length ? 'missing_or_empty'
      : validLimits.length < limits.length ? 'partial' : 'present', rows: limits.length, validRows: validLimits.length },
    pools: {}, lastAttempt,
  }
}

const failureCodes = new Set(['FACT_INVALID', 'PAGINATION_INCOMPLETE', 'QUERY_CANCELLED', 'TUSHARE_REQUEST_TIMEOUT',
  'TUSHARE_AUTH_FAILED', 'TUSHARE_QUOTA_INSUFFICIENT', 'TUSHARE_RATE_LIMITED', 'UPSTREAM_FAILED', 'PERSIST_FAILED',
  'CALENDAR_UNAVAILABLE'])
export function entryFailureCode(error: unknown): string {
  const value = error as { code?: string; message?: string }
  return failureCodes.has(value?.code ?? '') ? value.code! : failureCodes.has(value?.message ?? '') ? value.message! : 'UPSTREAM_FAILED'
}
