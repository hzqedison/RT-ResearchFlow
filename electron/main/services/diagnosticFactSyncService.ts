import type Database from 'better-sqlite3'
import { getDataSourceConfig } from '../database/dataSourceRepository'
import { decryptApiKey } from '../utils/apiKeyEncryption'
import { queryByDate, upsertStkAuctionCache } from '../database/stkAuctionCacheRepository'
import { getLimitListByDate, upsertLimitList } from '../database/limitListDailyRepository'
import { fetchStkAuction, fetchLimitListDaily, getTushareAccessErrorCode, createBoundedTushareScope } from './tushareService'
import { readKnownCalendar, resolveFactDates } from './dataReadinessService'
import { accessForReason, FACT_REASON_MESSAGES, type FactSyncReceipt } from '../../shared/dataReadiness'

export type DiagnosticFactAction = 'syncAuctionSnapshot' | 'syncLimitList'
export const DIAGNOSTIC_FACT_BUDGET_MS = 30_000
const flights = new WeakMap<Database.Database, Map<string, Promise<FactSyncReceipt>>>()
const attempts = new WeakMap<Database.Database, Map<string, FactSyncReceipt>>()

export function saveReadinessAttempt(db: Database.Database, key: string, receipt: FactSyncReceipt): FactSyncReceipt {
  let records = attempts.get(db)
  if (!records) { records = new Map(); attempts.set(db, records) }
  records.set(key, receipt)
  return receipt
}

export function getReadinessAttempt(db: Database.Database, key: string): FactSyncReceipt | undefined {
  return attempts.get(db)?.get(key)
}

export function safeFactError(error: unknown): string {
  const access = getTushareAccessErrorCode(error)
  if (access) return access
  const code = error instanceof Error ? error.message : (error as { code?: string })?.code
  return code && Object.hasOwn(FACT_REASON_MESSAGES, code) ? code : 'UPSTREAM_FAILED'
}

export function factReceipt(source: string, targetDate: string | null, reasonCode: string, insertedRows = 0, now = Date.now()): FactSyncReceipt {
  const outcome = reasonCode === 'FACTS_SAVED' ? 'success'
    : reasonCode === 'UPSTREAM_EMPTY' ? 'empty'
      : reasonCode === 'NOT_DUE' ? 'waiting'
        : ['CALENDAR_UNAVAILABLE', 'TUSHARE_DISABLED', 'TUSHARE_AUTH_FAILED', 'TUSHARE_QUOTA_INSUFFICIENT', 'INVALID_SOURCE'].includes(reasonCode) ? 'blocked'
          : ['PAGINATION_INCOMPLETE', 'CONCEPT_PARTIAL', 'PARTIAL_OBSERVATION_RETAINED_FACTS'].includes(reasonCode) ? 'partial' : 'failed'
  return { outcome, source, targetDate, insertedRows, reasonCode, access: accessForReason(reasonCode), checkedAt: now, coverage: 'unknown' }
}

/** Validate the entire batch before writing. Conflicts reject, nulls preserve prior facts. */
export function preserveFactBatch<T extends { tsCode: string; tradeDate: string; fetchedAt?: number }>(incoming: T[], existing: T[], targetDate: string, kind: 'auction' | 'limit', onRetainedFact?: () => void): T[] {
  const old = new Map(existing.map(row => [row.tsCode, row]))
  const unique = new Map<string, T>()
  for (const row of incoming) {
    const values = row as unknown as Record<string, unknown>
    const price = values[kind === 'auction' ? 'price' : 'close']
    if (row.tradeDate !== targetDate || !/^\d{6}\.(SH|SZ|BJ)$/.test(row.tsCode) || typeof price !== 'number' || !Number.isFinite(price) || price <= 0) throw new Error('FACT_INVALID')
    for (const value of Object.values(values)) if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('FACT_INVALID')
    const prior = unique.get(row.tsCode) ?? old.get(row.tsCode)
    const merged = { ...row } as unknown as Record<string, unknown>
    let retainedFact = false
    if (prior) {
      for (const [field, value] of Object.entries(prior)) {
        if (field === 'fetchedAt' || field === 'tsCode' || field === 'tradeDate') continue
        const next = merged[field]
        if (next === null || next === undefined) {
          merged[field] = value
          if (value !== null && value !== undefined) retainedFact = true
        }
        else if (value !== null && value !== undefined && value !== next) throw new Error('FACT_CONFLICT')
      }
    }
    if (retainedFact) {
      // A synthesized row is not a fresh complete observation. Fully supplied rows can advance time.
      if (kind === 'auction') {
        if (!Number.isFinite(prior?.fetchedAt) || prior!.fetchedAt! <= 0) throw new Error('FACT_INVALID')
        merged.fetchedAt = prior!.fetchedAt
      }
      onRetainedFact?.()
    }
    unique.set(row.tsCode, merged as unknown as T)
  }
  return [...unique.values()]
}

/** Reusable fact-only API; never calls snapshots, strategies, scheduler, or signal generation. */
export function syncDiagnosticFacts(db: Database.Database, action: DiagnosticFactAction, now = Date.now(), signal?: AbortSignal): Promise<FactSyncReceipt> {
  const monotonicDeadlineMs = performance.now() + DIAGNOSTIC_FACT_BUDGET_MS
  const deadlineMs = Date.now() + DIAGNOSTIC_FACT_BUDGET_MS
  const source = action === 'syncAuctionSnapshot' ? 'tushare/stk_auction' : 'tushare/limit_list_d'
  let targetDate: string
  try {
    const dates = resolveFactDates(readKnownCalendar(db), now)
    targetDate = action === 'syncAuctionSnapshot' ? dates.auctionDate : dates.previousTradeDate
  } catch (error) {
    return Promise.resolve(saveReadinessAttempt(db, action, factReceipt(source, null, safeFactError(error), 0, now)))
  }
  let jobs = flights.get(db)
  if (!jobs) { jobs = new Map(); flights.set(db, jobs) }
  const key = `${action}/${targetDate}`
  const active = jobs.get(key)
  if (active) return active
  const scope = createBoundedTushareScope({ deadlineMs, monotonicDeadlineMs, signal, maxPages: 4, maxAttempts: 1 })
  const job = Promise.resolve().then(async () => {
    try {
      scope.check()
      const cfg = getDataSourceConfig(db)
      if (!cfg.tushareEnabled || !cfg.tushareTokenEncrypted) throw new Error('TUSHARE_DISABLED')
      let token: string | null
      try { token = decryptApiKey(cfg.tushareTokenEncrypted) } catch { throw new Error('TUSHARE_AUTH_FAILED') }
      if (!token) throw new Error('TUSHARE_DISABLED')
      scope.check()
      const options = scope.options
      let retainedFacts = false
      const retained = () => { retainedFacts = true }
      if (action === 'syncAuctionSnapshot') {
        const rows = await fetchStkAuction(token, targetDate, undefined, options)
        if (rows.length === 0) throw new Error('UPSTREAM_EMPTY')
        const batch = preserveFactBatch(rows, queryByDate(db, targetDate), targetDate, 'auction', retained)
        scope.check()
        try { upsertStkAuctionCache(db, batch) } catch { throw new Error('WRITE_FAILED') }
        return factReceipt(source, targetDate, retainedFacts ? 'PARTIAL_OBSERVATION_RETAINED_FACTS' : 'FACTS_SAVED', batch.length)
      }
      const rows = await fetchLimitListDaily(token, targetDate, options)
      if (rows.length === 0) throw new Error('UPSTREAM_EMPTY')
      const batch = preserveFactBatch(rows, getLimitListByDate(db, targetDate), targetDate, 'limit', retained)
      scope.check()
      try { upsertLimitList(db, batch) } catch { throw new Error('WRITE_FAILED') }
      return factReceipt(source, targetDate, retainedFacts ? 'PARTIAL_OBSERVATION_RETAINED_FACTS' : 'FACTS_SAVED', batch.length)
    } catch (error) { return factReceipt(source, targetDate, safeFactError(error)) }
    finally { scope.dispose() }
  }).then(receipt => saveReadinessAttempt(db, action, receipt)).finally(() => jobs!.delete(key))
  jobs.set(key, job)
  return job
}
