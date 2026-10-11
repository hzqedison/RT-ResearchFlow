import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATABASE_MIGRATIONS, runMigrations } from '../../electron/main/database/db'
import { buildOfficialSseTradingCalendar } from '../../electron/shared/officialSseTradingCalendar'

vi.mock('../../electron/main/database/dataSourceRepository', () => ({ getDataSourceConfig: () => ({ tushareEnabled: false, tushareTokenEncrypted: null }) }))
vi.mock('../../electron/main/database/aiConfigRepository', () => ({ getConfiguredProviders: () => [] }))
vi.mock('../../electron/main/database/settingsRepository', () => ({ getConceptSource: () => 'dc' }))
vi.mock('../../electron/main/services/diagnosticFactSyncService', () => ({
  getReadinessAttempt: (_db: unknown, key: string) => key === 'syncAuctionSnapshot'
    ? { outcome: 'blocked', source: 'tushare', targetDate: '20260930', insertedRows: 0, reasonCode: 'TUSHARE_QUOTA_INSUFFICIENT', access: 'confirmed_denied', checkedAt: 1, coverage: 'unknown' } : undefined,
  syncDiagnosticFacts: vi.fn(),
}))
import { getDiagnosticsHealth } from '../../electron/main/services/diagnosticsService'
import { shouldSkipInitializationTask, INITIALIZATION_TASKS } from '../../src/components/Onboarding/initializationTaskModel'

describe('actual SQLite diagnostics by trading session', () => {
  let db: Database.Database
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-07T02:00:00Z'))
    db = new Database(':memory:')
    runMigrations(db, DATABASE_MIGRATIONS)
    const calendar = db.prepare('INSERT INTO trade_cal (cal_date, is_open, pretrade_date) VALUES (?, ?, ?)')
    db.transaction(() => {
      for (const row of buildOfficialSseTradingCalendar()) calendar.run(row.calDate, row.isOpen, row.pretradeDate)
    })()
    db.prepare("INSERT INTO stock_basic_cache (ts_code, name, list_status, updated_at) VALUES ('600001.SH', '测试', 'L', ?)").run(Date.now())
    db.prepare("INSERT INTO daily_close_cache (ts_code, trade_date, close, pct_chg, open, high, low, vol) VALUES ('600001.SH', '20260930', 10, 0, 10, 11, 9, 100)").run()
  })
  afterEach(() => { db.close(); vi.useRealTimers() })

  it.each(['2026-10-07T02:00:00Z', '2026-10-08T00:00:00Z'])('holiday or pre-open %s uses the actual settled session', time => {
    vi.setSystemTime(new Date(time))
    const health = getDiagnosticsHealth(db)
    const daily = health.groups.flatMap(group => group.items).find(item => item.key === 'freshness.dailyClose')!
    expect(daily).toMatchObject({ status: 'warning', evidence: { expectedTradeDate: '20260930', missingTradeDays: 0, calendarBasis: 'local_verified', readiness: 'partial' } })
    expect(daily.message).not.toContain('STALE_TRADING_DAYS')
    expect(shouldSkipInitializationTask(health, INITIALIZATION_TASKS.find(task => task.key === 'sync-historical-daily')!)).toBeNull()
    expect(health.groups.find(group => group.key === 'database')?.items.every(item => item.status !== 'error')).toBe(true)
  })
  it('post-settlement identifies the missing completed session rather than holiday age', () => {
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
    const daily = getDiagnosticsHealth(db).groups.flatMap(group => group.items).find(item => item.key === 'freshness.dailyClose')!
    expect(daily.evidence?.expectedTradeDate).toBe('20261008')
    expect(daily.evidence?.missingTradeDays).toBe(1)
    expect(daily.status).toBe('warning')
  })
  it('scope warnings and permission denial do not turn the whole database into an error', () => {
    const health = getDiagnosticsHealth(db)
    expect(health.groups.find(group => group.key === 'config')?.items.find(item => item.key === 'config.tushare')?.status).toBe('warning')
    const auction = health.dataQuality?.datasets.find(item => item.key === 'auction')!
    expect(auction).toMatchObject({ status: 'blocked', evidence: { access: 'confirmed_denied' } })
    expect(auction.reasons.map(reason => reason.code)).toContain('LAST_ATTEMPT_INCOMPLETE')
    expect(health.groups.find(group => group.key === 'database')?.items.every(item => item.status !== 'error')).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS count FROM daily_close_cache').get()).toEqual({ count: 1 })
  })
  it('unknown calendar fails closed and offers calendar recovery before historical sync', () => {
    db.prepare("DELETE FROM trade_cal WHERE cal_date = '20261007'").run()
    const daily = getDiagnosticsHealth(db).groups.flatMap(group => group.items).find(item => item.key === 'freshness.dailyClose')!
    expect(daily).toMatchObject({ status: 'warning', evidence: { readiness: 'unknown', calendarBasis: 'unknown' } })
    expect(daily.actions?.[0].key).toBe('syncTradeCalendar')
    expect(shouldSkipInitializationTask({ ...getDiagnosticsHealth(db) }, INITIALIZATION_TASKS.find(task => task.key === 'sync-historical-daily')!)).toBeNull()
  })
})
