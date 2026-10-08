import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isOfficialSseTradingDay } from '../../electron/shared/officialSseTradingCalendar'
const mocks = vi.hoisted(() => ({ source: vi.fn(), concepts: vi.fn(), stock: vi.fn() }))
vi.mock('../../electron/main/database/dataSourceRepository', () => ({ getDataSourceConfig: () => ({ tushareEnabled: true, tushareTokenEncrypted: 'fixture' }) }))
vi.mock('../../electron/main/database/settingsRepository', () => ({ getConceptSource: mocks.source }))
vi.mock('../../electron/main/database/aiConfigRepository', () => ({ getConfiguredProviders: () => [] }))
vi.mock('../../electron/main/services/schedulerService', () => ({ runStockBasicSyncJob: mocks.stock, runConceptMembersSyncJob: mocks.concepts }))
vi.mock('../../electron/main/services/decisionSignalBackfillService', () => ({ ensureTodayDecisionSignalsBackfilled: vi.fn() }))
vi.mock('../../electron/main/services/dataQualityService', () => ({ CORE_BENCHMARK_CODES: [], getDataQualitySnapshot: () => undefined, persistDataQualitySnapshot: vi.fn() }))
vi.mock('../../electron/main/services/historicalDailySyncService', () => ({ getHistoricalDailyDefaultEndDate: () => '20261007', HISTORICAL_DAILY_TARGET_TRADE_DAYS: 480, runHistoricalDailySync: vi.fn() }))
vi.mock('../../electron/main/services/publicHistoricalDailySyncService', () => ({ runPublicHistoricalDailySync: vi.fn() }))
vi.mock('../../electron/main/database/tradeCalRepository', () => ({ getLastNTradingDays: () => [] }))
vi.mock('../../electron/main/database/dailyCloseCacheRepository', () => ({
  DAILY_CLOSE_RETENTION_TRADE_DAYS: 500, getDailyCloseMaintenanceState: () => null, countDailyCloseByTradeDates: () => new Map(), upsertDailyClose: vi.fn(),
  getDailyCloseQualitySummary: () => ({ actualTradeDays: 480, totalRows: 2603547, earliestTradeDate: '20240101', latestTradeDate: '20260930', fields: Object.fromEntries(['open', 'high', 'low', 'close', 'pctChg', 'vol', 'turnoverRate'].map(key => [key, { missingRows: 0, missingRate: 0 }])) }),
}))
import { getDiagnosticsHealth } from '../../electron/main/services/diagnosticsService'
import { saveReadinessAttempt, factReceipt } from '../../electron/main/services/diagnosticFactSyncService'
import { shouldSkipInitializationTask, INITIALIZATION_TASKS } from '../../src/components/Onboarding/initializationTaskModel'

const NOW = Date.parse('2026-10-08T10:00:00+08:00')
function fixture(missingDate?: string) {
  const counts: Record<string, number> = { stock_basic_cache: 5572, trade_cal: 1096, daily_close_cache: 2603547, stock_minute_cache: 0, limit_list_daily: 0, kpl_concept_members: 100, ths_concept_members: 0, dc_concept_members: 0, chip_monitor_results: 0, trend_scores: 62, decision_signals: 0, schema_migrations: 1 }
  const db = { prepare(sql: string) {
    const table = sql.match(/FROM\s+(\w+)/i)?.[1]
    return {
      get(value?: string) {
        if (sql.includes('sqlite_master')) return value && value in counts ? { name: value } : undefined
        if (sql.includes('SELECT is_open')) return value === missingDate || !value || isOfficialSseTradingDay(value) === null ? undefined : { is_open: Number(isOfficialSseTradingDay(value)) }
        if (sql.includes('COUNT(*)')) return { count: counts[table!] ?? 0 }
        if (sql.includes('MAX(')) return { value: table === 'stock_basic_cache' ? NOW : counts[table!] > 0 ? '20260930' : null }
        throw new Error(`unhandled fixture query: ${sql}`)
      },
      all() {
        if (sql.includes('PRAGMA')) return ['trade_date', 'updated_at', 'signal_time'].map(name => ({ name }))
        if (table === 'schema_migrations') return [{ version: 1, appliedAt: NOW }]
        if (sql.includes('GROUP BY')) return []
        throw new Error(`unhandled fixture query: ${sql}`)
      },
    }
  } } as unknown as Database.Database
  return { db, counts }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); mocks.source.mockReturnValue('ths') })
afterEach(() => vi.useRealTimers())
describe('health readiness is source-aware and not natural-day stale', () => {
  it('screenshot-like facts are retained, unselected source is neutral, selected empty source cannot skip', () => {
    const { db } = fixture(); const snapshot = getDiagnosticsHealth(db)
    const items = snapshot.groups.flatMap(group => group.items)
    expect(items.find(item => item.key === 'freshness.stockBasic')).toMatchObject({ recordCount: 5572 })
    expect(items.find(item => item.key === 'freshness.kplConcept')).toMatchObject({ recordCount: 100, status: 'warning', displayStatus: 'neutral', evidence: { reasonCode: 'NOT_SELECTED' } })
    expect(items.find(item => item.key === 'freshness.kplConcept')?.actions?.some(action => action.key === 'syncConceptMembers')).toBe(false)
    expect(items.find(item => item.key === 'freshness.thsConcept')).toMatchObject({ recordCount: 0, status: 'warning', evidence: { selectedSource: 'ths', readiness: 'missing' } })
    expect(shouldSkipInitializationTask(snapshot, INITIALIZATION_TASKS.find(task => task.key === 'sync-concepts')!)).toBeNull()
    expect(items.find(item => item.key === 'freshness.trendScores')).toMatchObject({ recordCount: 62, status: 'ok', evidence: { expectedTradeDate: '20260930', missingTradeDays: 0 } })
    expect(items.find(item => item.key === 'freshness.minute')).toMatchObject({ displayStatus: 'neutral', evidence: { readiness: 'unknown', reasonCode: 'ON_DEMAND_EMPTY' } })
    expect(items.find(item => item.key === 'freshness.chipResults')).toMatchObject({ status: 'warning', evidence: { readiness: 'unknown' } })
    expect(snapshot.summary.neutral).toBe(3)
    expect(snapshot.summary.evaluatedCount).toBe(snapshot.summary.ok + snapshot.summary.warning + snapshot.summary.error)
    expect(snapshot.summary.totalCount).toBe(snapshot.summary.evaluatedCount! + snapshot.summary.neutral!)
  })
  it('unknown calendar never calls old natural-day state normal', () => {
    const { db } = fixture('20261003'); const snapshot = getDiagnosticsHealth(db)
    expect(snapshot.groups.flatMap(group => group.items).find(item => item.key === 'freshness.trendScores')).toMatchObject({ status: 'warning', evidence: { readiness: 'unknown', calendarBasis: 'unknown' } })
  })
  it('keeps the existing signal lifecycle maintenance TTL separate from market trading-day freshness', () => {
    const { db, counts } = fixture(); counts.decision_signals = 1
    const item = getDiagnosticsHealth(db).groups.flatMap(group => group.items).find(item => item.key === 'freshness.decisionSignals')
    expect(item?.status).toBe('warning'); expect(item?.message).toContain('自然日维护 TTL')
  })
  it('a completed old-source attempt cannot ready the newly selected source', () => {
    const { db, counts } = fixture(); counts.ths_concept_members = 1
    saveReadinessAttempt(db, 'concept/ths', factReceipt('ths', null, 'FACTS_SAVED', 1, NOW))
    expect(getDiagnosticsHealth(db).groups.flatMap(group => group.items).find(item => item.key === 'freshness.thsConcept')).toMatchObject({ status: 'ok', evidence: { readiness: 'ready' } })
    mocks.source.mockReturnValue('dc')
    const changed = getDiagnosticsHealth(db)
    expect(changed.selectedConceptSource).toBe('dc')
    expect(changed.groups.flatMap(group => group.items).find(item => item.key === 'freshness.thsConcept')?.displayStatus).toBe('neutral')
    expect(changed.groups.flatMap(group => group.items).find(item => item.key === 'freshness.dcConcept')).toMatchObject({ status: 'warning', evidence: { readiness: 'missing' } })
    expect(shouldSkipInitializationTask(changed, INITIALIZATION_TASKS.find(task => task.key === 'sync-concepts')!)).toBeNull()
  })
})
