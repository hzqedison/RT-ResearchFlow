import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type BetterSqlite from 'better-sqlite3'
import {
  cleanupScreenerResults, deleteByDate, getByDate, getCachedScreenerRun, replaceResultsForDate, upsertResults,
  type ScreenerRunMetadata,
} from '../../electron/main/database/stockScreenerResultsRepository'
import type { StockScreenerResultRow } from '../../electron/main/database/types'

// The optional module override lets local acceptance use the actual packaged
// binding. CI defaults to its native, rebuilt better-sqlite3. Memory DB only.
const Database = createRequire(__filename)(process.env.RT_TEST_SQLITE_MODULE || 'better-sqlite3') as typeof BetterSqlite
let db: BetterSqlite.Database
const date = '20261008'
const metadata: ScreenerRunMetadata = {
  calculatedAt: '2026-10-09T01:00:00.000Z', mode: 'eod', totalScanned: 3, rankConfigUpdatedAt: 7,
}
function row(tsCode: string, tradeDate = date): StockScreenerResultRow {
  return { tsCode, tradeDate, stockName: tsCode, close: 10, pctChg: 1, turnoverRate: null,
    vol: 1000, amount: 1000000, signalScore: 2, conditionsMet: '[]', concepts: '[]' }
}
beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`CREATE TABLE stock_screener_results (
    ts_code TEXT NOT NULL, trade_date TEXT NOT NULL, stock_name TEXT, close REAL,
    pct_chg REAL, turnover_rate REAL, vol REAL, amount REAL, signal_score INTEGER NOT NULL,
    conditions_met TEXT, concepts TEXT, rank_score REAL, rank_breakdown_json TEXT,
    moneyflow_json TEXT, signal_strength_json TEXT, PRIMARY KEY(ts_code, trade_date)
  )`)
})
afterEach(() => db.close())

describe('actual SQLite screener derived-cache replacement', () => {
  it('expires provenance even when the old run has no result rows', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T02:00:00Z'))
    try {
      replaceResultsForDate(db, '20200101', [], metadata)
      replaceResultsForDate(db, date, [row('current')], metadata)
      expect(getCachedScreenerRun(db, '20200101', 7)).not.toBeNull()
      expect(cleanupScreenerResults(db, 30)).toBe(0)
      expect(getCachedScreenerRun(db, '20200101', 7)).toBeNull()
      expect(getCachedScreenerRun(db, date, 7)).toEqual(metadata)
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not trust a legacy row-only cache or create provenance merely by reading', () => {
    upsertResults(db, [row('A')])
    expect(getCachedScreenerRun(db, date, 7)).toBeNull()
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='stock_screener_runs'").get()).toBeUndefined()
  })
  it('replaces disappearing candidates and retains other dates', () => {
    replaceResultsForDate(db, date, [row('A'), row('B')], metadata)
    upsertResults(db, [row('C', '20261007')])
    replaceResultsForDate(db, date, [row('A')], metadata)
    expect(getByDate(db, date).map(value => value.tsCode)).toEqual(['A'])
    expect(getByDate(db, '20261007')).toHaveLength(1)
    expect(getCachedScreenerRun(db, date, 7)).toEqual(metadata)
  })
  it('replaces an old positive cache with a verified empty scan, preserving its actual calculation time/count', () => {
    replaceResultsForDate(db, date, [row('A')], metadata)
    replaceResultsForDate(db, date, [], metadata)
    expect(getByDate(db, date)).toEqual([])
    expect(getCachedScreenerRun(db, date, 7)).toEqual(metadata)
  })
  it('rolls back deletion, inserts and provenance together when an insert fails', () => {
    replaceResultsForDate(db, date, [row('old')], metadata)
    db.exec("CREATE TRIGGER fail_test BEFORE INSERT ON stock_screener_results WHEN NEW.ts_code='bad' BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
    expect(() => replaceResultsForDate(db, date, [row('new'), row('bad')], {
      ...metadata, calculatedAt: '2026-10-09T02:00:00.000Z',
    })).toThrow('fixture failure')
    expect(getByDate(db, date).map(value => value.tsCode)).toEqual(['old'])
    expect(getCachedScreenerRun(db, date, 7)).toEqual(metadata)
  })
  it('refuses a mixed-date batch before altering the existing cache', () => {
    replaceResultsForDate(db, date, [row('old')], metadata)
    expect(() => replaceResultsForDate(db, date, [row('new', '20261007')], metadata)).toThrow('INVALID_SCREENER_RUN_METADATA')
    expect(getByDate(db, date).map(value => value.tsCode)).toEqual(['old'])
  })
  it.each(['realtime', 'eod-fallback'] as const)('does not present %s provenance as a confirmed EOD cache', mode => {
    replaceResultsForDate(db, date, [row('A')], { ...metadata, mode })
    expect(getCachedScreenerRun(db, date, 7)).toBeNull()
  })
  it('does not use a cache produced with an old ranking configuration', () => {
    replaceResultsForDate(db, date, [row('A')], metadata)
    expect(getCachedScreenerRun(db, date, 8)).toBeNull()
  })
  it('invalidates provenance on a legacy partial upsert or explicit date deletion', () => {
    replaceResultsForDate(db, date, [row('A')], metadata)
    upsertResults(db, [row('A')])
    expect(getCachedScreenerRun(db, date, 7)).toBeNull()
    replaceResultsForDate(db, date, [row('A')], metadata)
    deleteByDate(db, date)
    expect(getByDate(db, date)).toEqual([])
    expect(getCachedScreenerRun(db, date, 7)).toBeNull()
  })
  it('rejects count/algorithm mismatches and zero-scanned provenance', () => {
    replaceResultsForDate(db, date, [row('A')], metadata)
    db.prepare('DELETE FROM stock_screener_results WHERE ts_code=?').run('A')
    expect(getCachedScreenerRun(db, date, 7)).toBeNull()
    replaceResultsForDate(db, date, [row('A')], metadata)
    db.prepare('UPDATE stock_screener_runs SET cache_version=?').run('old')
    expect(getCachedScreenerRun(db, date, 7)).toBeNull()
    replaceResultsForDate(db, date, [], { ...metadata, totalScanned: 0 })
    expect(getCachedScreenerRun(db, date, 7)).toBeNull()
  })
})
