import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { DATABASE_MIGRATIONS, runMigrations } from '../../electron/main/database/db'
import { CORE_BENCHMARK_CODES, getDataQualitySnapshot } from '../../electron/main/services/dataQualityService'
import { buildOfficialSseTradingCalendar } from '../../electron/shared/officialSseTradingCalendar'

const NOW = Date.parse('2026-07-24T02:00:00.000Z')
const AS_OF = '20260723'
const calendar = buildOfficialSseTradingCalendar()
const sessions = calendar.filter(row => row.isOpen === 1).map(row => row.calDate)
const past = sessions.filter(date => date <= AS_OF)
const future = sessions.filter(date => date > AS_OF).slice(0, 30)

function withBenchmarkDates(
  dates: string[],
  assertion: (result: ReturnType<typeof getDataQualitySnapshot>['datasets'][number]) => void,
  calendarRows = calendar,
  mirrorIntoStockPrice = false,
): void {
  const db = new Database(':memory:')
  try {
    runMigrations(db, DATABASE_MIGRATIONS)
    // Migrations create an empty calendar. The strict cutoff requires persisted day facts,
    // not just the in-memory list used to choose benchmark fixture dates.
    const insertCalendar = db.prepare('INSERT INTO trade_cal (cal_date, is_open) VALUES (?, ?)')
    const insert = db.prepare(`
      INSERT INTO daily_close_cache (ts_code, trade_date, close, pct_chg, open, high, low, vol, turnover_rate)
      VALUES (?, ?, 100, 0, 100, 101, 99, 100, 1)
    `)
    const insertAlternate = mirrorIntoStockPrice
      ? db.prepare('INSERT INTO stock_price_cache (stockCode, tradeDate, close, fetchedAt) VALUES (?, ?, 100, ?)') : null
    db.transaction(() => {
      for (const row of calendarRows) insertCalendar.run(row.calDate, row.isOpen)
      for (const code of CORE_BENCHMARK_CODES) {
        for (const date of dates) {
          insert.run(code, date)
          insertAlternate?.run(code, date, NOW)
        }
      }
    })()
    const result = getDataQualitySnapshot(db, NOW).datasets.find(item => item.key === 'benchmarks')
    // Cutoff filtering must not delete future facts from storage.
    expect(db.prepare('SELECT COUNT(*) AS count FROM daily_close_cache').get()).toEqual({ count: dates.length * CORE_BENCHMARK_CODES.length })
    if (mirrorIntoStockPrice) {
      expect(db.prepare('SELECT COUNT(*) AS count FROM stock_price_cache').get()).toEqual({ count: dates.length * CORE_BENCHMARK_CODES.length })
    }
    expect(result).toBeDefined()
    assertion(result!)
  } finally {
    db.close()
  }
}

describe('benchmark quality uses only facts available at the settled cutoff', () => {
  it.each(['known', 'missing', 'conflicting'] as const)('counts each code and eligible date once across both caches when the calendar is %s', mode => {
    const calendarRows = mode === 'missing' ? [] : mode === 'known' ? calendar : calendar.map(row =>
      row.calDate === '20260724' ? { ...row, isOpen: 0 as const } : row)
    withBenchmarkDates([AS_OF, '20260724', '20260727'], result => {
      expect(result.status).toBe('degraded')
      expect(result.recordCount).toBe(4)
      expect(result.earliestDate).toBe(AS_OF)
      expect(result.latestDate).toBe(AS_OF)
      expect(result.reasons.map(reason => reason.code)).toContain(mode === 'known' ? 'HISTORY_SHORT' : 'CALENDAR_UNAVAILABLE')
    }, calendarRows, true)
  })

  it.each(['missing', 'conflicting'] as const)('excludes July 27 future-only facts on July 24 when the calendar is %s', mode => {
    const calendarRows = mode === 'missing' ? [] : calendar.map(row =>
      row.calDate === '20260724' ? { ...row, isOpen: 0 as const } : row)
    withBenchmarkDates(['20260727'], result => {
      expect(result.status).toBe('blocked')
      expect(result.recordCount).toBe(0)
      expect(result.earliestDate).toBeNull()
      expect(result.latestDate).toBeNull()
      expect(result.reasons.map(reason => reason.code)).toEqual(['CALENDAR_UNAVAILABLE'])
      expect(result.action?.key).toBe('syncTradeCalendar')
    }, calendarRows)
  })

  it.each(['missing', 'conflicting'] as const)('preserves the inclusive previous-calendar-day ceiling before settlement when the calendar is %s', mode => {
    const calendarRows = mode === 'missing' ? [] : calendar.map(row =>
      row.calDate === '20260724' ? { ...row, isOpen: 0 as const } : row)
    withBenchmarkDates(['20260722', AS_OF, '20260724', '20260727'], result => {
      expect(result.status).toBe('degraded')
      expect(result.recordCount).toBe(8)
      expect(result.earliestDate).toBe('20260722')
      expect(result.latestDate).toBe(AS_OF)
      expect(result.reasons.map(reason => reason.code)).toEqual(['CALENDAR_UNAVAILABLE'])
      expect(result.action?.key).toBe('syncTradeCalendar')
    }, calendarRows)
  })

  it.each(['missing', 'conflicting'] as const)('does not invent a settled cutoff when the local calendar is %s', mode => {
    const calendarRows = mode === 'missing' ? [] : calendar.map(row =>
      row.calDate === '20260724' ? { ...row, isOpen: 0 as const } : row)
    withBenchmarkDates(past.slice(-30), result => {
      expect(result.status).toBe('degraded')
      expect(result.reasons.map(reason => reason.code)).toEqual(['CALENDAR_UNAVAILABLE'])
      expect(result.action?.key).toBe('syncTradeCalendar')
    }, calendarRows)
  })

  it('retains a reliable result for thirty completed sessions per benchmark', () => {
    withBenchmarkDates(past.slice(-30), result => {
      expect(result.status).toBe('reliable')
      expect(result.recordCount).toBe(120)
      expect(result.latestDate).toBe(AS_OF)
    })
  })

  it('does not report future-only benchmark data as available', () => {
    withBenchmarkDates(future, result => {
      expect(result.status).toBe('blocked')
      expect(result.recordCount).toBe(0)
      expect(result.earliestDate).toBeNull()
      expect(result.latestDate).toBeNull()
      expect(result.reasons.map(reason => reason.code)).toContain('FUTURE_FACTS')
    })
  })

  it('does not let future rows satisfy a thirty-session history requirement', () => {
    withBenchmarkDates([...past.slice(-29), ...future.slice(0, 2)], result => {
      expect(result.status).toBe('degraded')
      expect(result.recordCount).toBe(116)
      expect(result.latestDate).toBe(AS_OF)
      expect(result.reasons.map(reason => reason.code)).toEqual(expect.arrayContaining(['HISTORY_SHORT', 'FUTURE_FACTS']))
    })
  })

  it('does not let future rows conceal a stale completed-session history', () => {
    const stale = past.filter(date => date < AS_OF).slice(-30)
    withBenchmarkDates([...stale, ...future], result => {
      expect(result.status).toBe('degraded')
      expect(result.recordCount).toBe(120)
      expect(result.latestDate).toBe(stale.at(-1))
      expect(result.reasons.map(reason => reason.code)).toEqual(expect.arrayContaining(['STALE', 'FUTURE_FACTS']))
    })
  })
})
