/**
 * Persist exchange calendars without making the default route require a Key.
 * Tushare remains the preferred configured provider. Official fallback only
 * fills missing rows within announced coverage; no future weekdays are guessed.
 */
import Database from 'better-sqlite3'
import { upsertTradeCal, getLatestCalDate, insertTradeCalIfMissing } from '../database/tradeCalRepository'
import { fetchTradeCal } from './tushareService'
import { getBeijingYmd, offsetYmd } from './marketSettlementPolicy'
import {
  buildOfficialSseTradingCalendar,
  OFFICIAL_SSE_CALENDAR_START,
  OFFICIAL_SSE_CALENDAR_END,
} from '../../shared/officialSseTradingCalendar'

let _syncRunning = false
let _syncPromise: Promise<TradeCalSyncResult> | null = null

export interface TradeCalSyncResult {
  status: 'completed' | 'empty' | 'failed'
  rowCount: number
  source?: 'tushare' | 'official-sse'
  insertedRows?: number
  conflictRows?: number
  firstConflictDate?: string | null
  coverageStart?: string
  coverageEnd?: string
}

export function seedOfficialTradeCalendar(db: Database.Database): TradeCalSyncResult {
  const rows = buildOfficialSseTradingCalendar()
  if (rows.length === 0) return { status: 'empty', rowCount: 0 }
  const merged = insertTradeCalIfMissing(db, rows)
  if (merged.conflictRows > 0) {
    console.warn(`[TradeCal] Retained ${merged.conflictRows} existing rows differing from annual schedules; first=${merged.firstConflictDate}`)
  }
  return {
    status: 'completed',
    rowCount: rows.length,
    source: 'official-sse',
    ...merged,
    coverageStart: OFFICIAL_SSE_CALENDAR_START,
    coverageEnd: OFFICIAL_SSE_CALENDAR_END,
  }
}

export async function syncTradeCalIfNeeded(db: Database.Database, token?: string | null): Promise<void> {
  if (_syncPromise) {
    await _syncPromise
    return
  }
  seedOfficialTradeCalendar(db)
  const latest = getLatestCalDate(db)
  if (latest !== null && latest >= offsetYmd(getBeijingYmd(), 60)) return
  await syncTradeCalFull(db, token)
}

export function syncTradeCalFull(db: Database.Database, token?: string | null): Promise<TradeCalSyncResult> {
  if (_syncPromise) return _syncPromise
  _syncRunning = true
  let promise: Promise<TradeCalSyncResult>
  promise = Promise.resolve().then(async (): Promise<TradeCalSyncResult> => {
    try {
      const today = getBeijingYmd()
      const startDate = offsetYmd(today, -3 * 365)
      const endDate = offsetYmd(today, 365)
      if (token?.trim()) {
        try {
          const rows = await fetchTradeCal(token, 'SSE', startDate, endDate)
          if (rows.length > 0 && rows.every((row) =>
            /^\d{8}$/.test(row.calDate) && (row.isOpen === 0 || row.isOpen === 1),
          )) {
            upsertTradeCal(db, rows.map((row) => ({
              calDate: row.calDate, isOpen: row.isOpen, pretradeDate: row.pretradeDate,
            })))
            return {
              status: 'completed',
              rowCount: rows.length,
              source: 'tushare',
              coverageStart: rows.reduce((min, row) => row.calDate < min ? row.calDate : min, rows[0].calDate),
              coverageEnd: rows.reduce((max, row) => row.calDate > max ? row.calDate : max, rows[0].calDate),
            }
          }
          console.warn('[TradeCal] Tushare returned no usable calendar; using published official schedules')
        } catch {
          console.warn('[TradeCal] Tushare calendar unavailable; using published official schedules')
        }
      }
      return seedOfficialTradeCalendar(db)
    } catch {
      console.warn('[TradeCal] Calendar persistence failed; existing data was not cleared')
      return { status: 'failed', rowCount: 0 }
    }
  }).finally(() => {
    if (_syncPromise === promise) {
      _syncPromise = null
      _syncRunning = false
    }
  })
  _syncPromise = promise
  return promise
}

export function isTradeCalSyncRunning(): boolean {
  return _syncRunning
}
