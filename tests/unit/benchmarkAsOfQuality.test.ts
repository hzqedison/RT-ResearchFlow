import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { DATABASE_MIGRATIONS, runMigrations } from '../../electron/main/database/db'
import { CORE_BENCHMARK_CODES, getDataQualitySnapshot } from '../../electron/main/services/dataQualityService'
import { buildOfficialSseTradingCalendar } from '../../electron/shared/officialSseTradingCalendar'

const NOW = Date.parse('2026-07-24T02:00:00.000Z')
const AS_OF = '20260723'
const sessions = buildOfficialSseTradingCalendar().filter(row => row.isOpen === 1).map(row => row.calDate)
const past = sessions.filter(date => date <= AS_OF)
const future = sessions.filter(date => date > AS_OF).slice(0, 30)

function withBenchmarkDates(dates: string[], assertion: (result: ReturnType<typeof getDataQualitySnapshot>['datasets'][number]) => void): void {
  const db = new Database(':memory:')
  try {
    runMigrations(db, DATABASE_MIGRATIONS)
    const insert = db.prepare(`
      INSERT INTO daily_close_cache (ts_code, trade_date, close, pct_chg, open, high, low, vol, turnover_rate)
      VALUES (?, ?, 100, 0, 100, 101, 99, 100, 1)
    `)
    db.transaction(() => {
      for (const code of CORE_BENCHMARK_CODES) {
        for (const date of dates) insert.run(code, date)
      }
    })()
    const result = getDataQualitySnapshot(db, NOW).datasets.find(item => item.key === 'benchmarks')
    expect(result).toBeDefined()
    assertion(result!)
  } finally {
    db.close()
  }
}

describe('benchmark quality uses only facts available at the settled cutoff', () => {
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
