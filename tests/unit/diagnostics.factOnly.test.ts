import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isOfficialSseTradingDay } from '../../electron/shared/officialSseTradingCalendar'
import { offsetYmd } from '../../electron/main/services/marketSettlementPolicy'

const mocks = vi.hoisted(() => ({ config: vi.fn(), decrypt: vi.fn(), auction: vi.fn(), limit: vi.fn(), auctionRows: new Map<string, any>(), limitRows: new Map<string, any>(), writeAuction: vi.fn(), writeLimit: vi.fn(), strategies: vi.fn(), snapshot: vi.fn(), signals: vi.fn(), quality: vi.fn(), concepts: vi.fn() }))
vi.mock('../../electron/main/database/dataSourceRepository', () => ({ getDataSourceConfig: mocks.config }))
vi.mock('../../electron/main/utils/apiKeyEncryption', () => ({ decryptApiKey: mocks.decrypt }))
vi.mock('../../electron/main/services/tushareService', async importOriginal => ({ ...await importOriginal<typeof import('../../electron/main/services/tushareService')>(), fetchStkAuction: mocks.auction, fetchLimitListDaily: mocks.limit, fetchIndexDailyForCodes: vi.fn(), getTushareAccessErrorCode: (error: unknown) => { const text = error instanceof Error ? error.message : String(error); return ['TUSHARE_AUTH_FAILED', 'TUSHARE_QUOTA_INSUFFICIENT', 'TUSHARE_RATE_LIMITED', 'TUSHARE_REQUEST_TIMEOUT'].find(code => text.includes(code)) ?? null } }))
vi.mock('../../electron/main/database/stkAuctionCacheRepository', () => ({ queryByDate: (_db: unknown, date: string) => [...mocks.auctionRows.values()].filter(row => row.tradeDate === date), upsertStkAuctionCache: mocks.writeAuction }))
vi.mock('../../electron/main/database/limitListDailyRepository', () => ({ getLimitListByDate: (_db: unknown, date: string) => [...mocks.limitRows.values()].filter(row => row.tradeDate === date), upsertLimitList: mocks.writeLimit }))
vi.mock('../../electron/main/services/schedulerService', () => ({ runStockBasicSyncJob: mocks.strategies, runConceptMembersSyncJob: mocks.concepts }))
vi.mock('../../electron/main/services/morningAuctionService', () => ({ refreshMorningAuctionSnapshot: mocks.snapshot, getOrCreateMorningAuctionSnapshot: mocks.snapshot }))
vi.mock('../../electron/main/services/decisionSignalBackfillService', () => ({ ensureTodayDecisionSignalsBackfilled: mocks.signals }))
vi.mock('../../electron/main/services/dataQualityService', () => ({ CORE_BENCHMARK_CODES: [], getDataQualitySnapshot: mocks.quality, persistDataQualitySnapshot: mocks.quality }))
vi.mock('../../electron/main/database/settingsRepository', () => ({ getConceptSource: () => 'ths' }))
vi.mock('../../electron/main/database/aiConfigRepository', () => ({ getConfiguredProviders: () => [] }))
vi.mock('../../electron/main/services/historicalDailySyncService', () => ({ getHistoricalDailyDefaultEndDate: () => '20261008', HISTORICAL_DAILY_TARGET_TRADE_DAYS: 480, runHistoricalDailySync: mocks.strategies }))
vi.mock('../../electron/main/services/publicHistoricalDailySyncService', () => ({ runPublicHistoricalDailySync: mocks.strategies }))
import { syncDiagnosticFacts, getReadinessAttempt, preserveFactBatch } from '../../electron/main/services/diagnosticFactSyncService'
import { runDiagnosticAction } from '../../electron/main/services/diagnosticsService'

const NOW = Date.parse('2026-10-08T10:00:00+08:00')
function fakeDb(missing?: string, conflict?: string): Database.Database {
  return { prepare(sql: string) { return { get(value: string) {
    if (sql.includes('sqlite_master')) return value === 'trade_cal' ? { name: value } : undefined
    if (sql.includes('SELECT is_open')) {
      if (value === missing || value < '20260901' || value > '20261009') return undefined
      const open = Number(isOfficialSseTradingDay(value))
      return { is_open: value === conflict ? 1 - open : open }
    }
    throw new Error('unexpected fixture query')
  } } } } as unknown as Database.Database
}
const auctionRow = (date = '20261008') => ({ tsCode: '600001.SH', tradeDate: date, price: 10, vol: 100, amount: 1000, preClose: 9.9, turnoverRate: null, volumeRatio: null, floatShare: null, fetchedAt: NOW })
const limitRow = (date = '20260930') => ({ tsCode: '600001.SH', tradeDate: date, close: 10, name: 'fixture', pctChg: 10, amount: null, floatMv: null, totalMv: null, turnoverRatio: null, fdAmount: null, firstTime: null, lastTime: null, openTimes: null, upStat: null, limitTimes: 1, limit: 'U', fetchedAt: NOW })

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] }); vi.setSystemTime(NOW)
  mocks.auctionRows.clear(); mocks.limitRows.clear()
  mocks.config.mockReturnValue({ tushareEnabled: true, tushareTokenEncrypted: 'fixture-cipher' })
  mocks.decrypt.mockReturnValue('fixture-token')
  mocks.auction.mockResolvedValue([auctionRow()]); mocks.limit.mockResolvedValue([limitRow()])
  mocks.writeAuction.mockImplementation((_db, rows) => { for (const row of rows) mocks.auctionRows.set(`${row.tsCode}/${row.tradeDate}`, row) })
  mocks.writeLimit.mockImplementation((_db, rows) => { for (const row of rows) mocks.limitRows.set(`${row.tsCode}/${row.tradeDate}`, row) })
})
afterEach(() => vi.useRealTimers())

describe('diagnostic fact-only actions', () => {
  it('auction does not depend on an empty limit list; both actions use exact independent dates', async () => {
    const db = fakeDb()
    const auction = await runDiagnosticAction(db, 'syncAuctionSnapshot')
    expect(auction).toMatchObject({ outcome: 'success', targetDate: '20261008', insertedRows: 1, coverage: 'unknown' })
    expect(mocks.limit).not.toHaveBeenCalled()
    expect(mocks.auction).toHaveBeenCalledWith('fixture-token', '20261008', undefined, expect.objectContaining({ maxPages: 4, maxAttempts: 1, deadlineMs: NOW + 30_000 }))
    const limit = await runDiagnosticAction(db, 'syncLimitList')
    expect(limit).toMatchObject({ outcome: 'success', targetDate: '20260930', insertedRows: 1 })
    expect(mocks.limit).toHaveBeenCalledWith('fixture-token', '20260930', expect.objectContaining({ maxAttempts: 1 }))
    expect(mocks.auctionRows.size).toBe(1); expect(mocks.limitRows.size).toBe(1)
    for (const entry of [mocks.snapshot, mocks.signals, mocks.strategies, mocks.concepts, mocks.quality]) expect(entry).not.toHaveBeenCalled()
  })
  it.each(['20261008', '20261003', '20260930'])('missing calendar %s makes zero requests and writes', async date => {
    const result = await syncDiagnosticFacts(fakeDb(date), 'syncAuctionSnapshot')
    expect(result).toMatchObject({ outcome: 'blocked', reasonCode: 'CALENDAR_UNAVAILABLE', insertedRows: 0 })
    expect(mocks.auction).not.toHaveBeenCalled(); expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.writeAuction).not.toHaveBeenCalled()
  })
  it('a calendar conflict does not use the local MAX date as a fallback', async () => {
    expect(await syncDiagnosticFacts(fakeDb(undefined, '20261008'), 'syncLimitList')).toMatchObject({ reasonCode: 'CALENDAR_UNAVAILABLE' })
    expect(mocks.limit).not.toHaveBeenCalled()
  })
  it('09:29:59 requests the prior completed session, 09:30 requests today', async () => {
    const before = NOW - 30 * 60_000 - 1000
    mocks.auction.mockResolvedValue([auctionRow('20260930')])
    expect(await syncDiagnosticFacts(fakeDb(), 'syncAuctionSnapshot', before)).toMatchObject({ targetDate: '20260930', outcome: 'success' })
    mocks.auction.mockResolvedValue([auctionRow()])
    expect(await syncDiagnosticFacts(fakeDb(), 'syncAuctionSnapshot', before + 1000)).toMatchObject({ targetDate: '20261008', outcome: 'success' })
  })
  it('not configured does not request; saved Token does not imply permissions', async () => {
    mocks.config.mockReturnValue({ tushareEnabled: false })
    expect(await syncDiagnosticFacts(fakeDb(), 'syncAuctionSnapshot')).toMatchObject({ outcome: 'blocked', access: 'not_configured' })
    expect(mocks.auction).not.toHaveBeenCalled()
  })
  it.each(['TUSHARE_AUTH_FAILED', 'TUSHARE_QUOTA_INSUFFICIENT', 'TUSHARE_RATE_LIMITED', 'TUSHARE_REQUEST_TIMEOUT', 'PAGINATION_INCOMPLETE', 'QUERY_CANCELLED', 'UPSTREAM_FAILED'])('preserves facts on %s without false success', async code => {
    const db = fakeDb(); const old = auctionRow(); mocks.auctionRows.set('600001.SH/20261008', old)
    mocks.auction.mockRejectedValue(new Error(code))
    const result = await syncDiagnosticFacts(db, 'syncAuctionSnapshot')
    expect(result.reasonCode).toBe(code); expect(result.outcome).not.toBe('success'); expect(result.insertedRows).toBe(0)
    expect(mocks.auctionRows.get('600001.SH/20261008')).toEqual(old); expect(mocks.writeAuction).not.toHaveBeenCalled()
    expect(getReadinessAttempt(db, 'syncAuctionSnapshot')).toEqual(result)
  })
  it('empty response remains empty, not permission-denied or repaired', async () => {
    mocks.auction.mockResolvedValue([])
    expect(await syncDiagnosticFacts(fakeDb(), 'syncAuctionSnapshot')).toMatchObject({ outcome: 'empty', access: 'unknown', reasonCode: 'UPSTREAM_EMPTY' })
    expect(mocks.writeAuction).not.toHaveBeenCalled()
  })
  it.each([{ tradeDate: '20261009' }, { tsCode: 'bad' }, { price: 0 }, { price: null }, { amount: Infinity }])('invalid whole batch is rejected: %j', async invalid => {
    mocks.auction.mockResolvedValue([auctionRow(), { ...auctionRow(), tsCode: '600002.SH', ...invalid }])
    expect(await syncDiagnosticFacts(fakeDb(), 'syncAuctionSnapshot')).toMatchObject({ outcome: 'failed', reasonCode: 'FACT_INVALID' })
    expect(mocks.writeAuction).not.toHaveBeenCalled()
  })
  it('nulls preserve prior non-null facts, zero is a real zero, conflicts reject', () => {
    const old = auctionRow()
    expect(preserveFactBatch([{ ...old, amount: null }], [old], '20261008', 'auction')[0].amount).toBe(1000)
    expect(() => preserveFactBatch([{ ...old, price: 11 }], [old], '20261008', 'auction')).toThrow('FACT_CONFLICT')
    expect(preserveFactBatch([{ ...old, vol: 0 }], [], '20261008', 'auction')[0].vol).toBe(0)
  })
  it('a borrowed old fact retains its 09:15 observation, while a complete 09:31 response advances it', async () => {
    const db = fakeDb()
    const old = { ...auctionRow(), fetchedAt: Date.parse('2026-10-08T09:15:00+08:00') }
    const freshAt = Date.parse('2026-10-08T09:31:00+08:00')
    mocks.auctionRows.set('600001.SH/20261008', old)
    mocks.auction.mockResolvedValue([{ ...old, amount: null, fetchedAt: freshAt }])
    expect(await syncDiagnosticFacts(db, 'syncAuctionSnapshot')).toMatchObject({ outcome: 'partial', reasonCode: 'PARTIAL_OBSERVATION_RETAINED_FACTS', insertedRows: 1 })
    expect(mocks.auctionRows.get('600001.SH/20261008')).toEqual(old)
    mocks.auction.mockResolvedValue([{ ...old, fetchedAt: freshAt }])
    expect(await syncDiagnosticFacts(db, 'syncAuctionSnapshot')).toMatchObject({ outcome: 'success', reasonCode: 'FACTS_SAVED' })
    expect(mocks.auctionRows.get('600001.SH/20261008').fetchedAt).toBe(freshAt)
    expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.signals).not.toHaveBeenCalled()
  })
  it('null stays null without prior facts; duplicate partial rows cannot mint an observation time', () => {
    const old = { ...auctionRow(), fetchedAt: NOW - 60_000 }
    const partial = { ...old, amount: null, fetchedAt: NOW }
    expect(preserveFactBatch([partial, partial], [old], '20261008', 'auction')[0].fetchedAt).toBe(old.fetchedAt)
    expect(preserveFactBatch([partial], [], '20261008', 'auction')[0].amount).toBeNull()
  })
  it('transaction failure keeps old facts and is not completed success', async () => {
    const old = auctionRow(); mocks.auctionRows.set('600001.SH/20261008', old)
    mocks.writeAuction.mockImplementation(() => { throw new Error('fixture transaction failure') })
    expect(await syncDiagnosticFacts(fakeDb(), 'syncAuctionSnapshot')).toMatchObject({ reasonCode: 'WRITE_FAILED', outcome: 'failed' })
    expect([...mocks.auctionRows.values()]).toEqual([old])
  })
  it('repeated clicks share one flight and repeated valid writes remain keyed', async () => {
    const db = fakeDb(); let release!: (rows: any[]) => void
    mocks.auction.mockReturnValue(new Promise(resolve => { release = resolve }))
    const a = syncDiagnosticFacts(db, 'syncAuctionSnapshot'); const b = syncDiagnosticFacts(db, 'syncAuctionSnapshot')
    expect(a).toBe(b); await Promise.resolve(); release([auctionRow()])
    expect((await a).outcome).toBe('success'); await b; expect(mocks.auction).toHaveBeenCalledTimes(1)
    mocks.auction.mockResolvedValue([auctionRow()]); await syncDiagnosticFacts(db, 'syncAuctionSnapshot')
    expect(mocks.auctionRows.size).toBe(1)
  })
  it('late/aborted transport results cannot write', async () => {
    mocks.auction.mockImplementation(async () => { await vi.advanceTimersByTimeAsync(30_000); return [auctionRow()] })
    expect(await syncDiagnosticFacts(fakeDb(), 'syncAuctionSnapshot')).toMatchObject({ reasonCode: 'TUSHARE_REQUEST_TIMEOUT' })
    expect(mocks.writeAuction).not.toHaveBeenCalled()
    vi.setSystemTime(NOW); const controller = new AbortController(); controller.abort()
    mocks.auction.mockResolvedValue([auctionRow()])
    expect(await syncDiagnosticFacts(fakeDb(), 'syncAuctionSnapshot', NOW, controller.signal)).toMatchObject({ reasonCode: 'QUERY_CANCELLED' })
    expect(mocks.writeAuction).not.toHaveBeenCalled()
  })
})
