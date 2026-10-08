import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auction: vi.fn(), limit: vi.fn(), strategies: vi.fn(), signals: vi.fn() }))
vi.mock('../../electron/main/database/dataSourceRepository', () => ({ getDataSourceConfig: () => ({ tushareEnabled: true, tushareTokenEncrypted: 'fixture-cipher' }) }))
vi.mock('../../electron/main/utils/apiKeyEncryption', () => ({ decryptApiKey: () => 'fixture-token' }))
vi.mock('../../electron/main/database/settingsRepository', () => ({ getConceptSource: () => 'ths' }))
vi.mock('../../electron/main/services/schedulerService', () => ({ runStockBasicSyncJob: mocks.strategies, runConceptMembersSyncJob: mocks.strategies }))
vi.mock('../../electron/main/services/decisionSignalBackfillService', () => ({ ensureTodayDecisionSignalsBackfilled: mocks.signals }))
vi.mock('../../electron/main/services/tushareService', async importOriginal => ({ ...await importOriginal<typeof import('../../electron/main/services/tushareService')>(), fetchStkAuction: mocks.auction, fetchLimitListDaily: mocks.limit, fetchIndexDailyForCodes: mocks.strategies, getTushareAccessErrorCode: (error: unknown) => error instanceof Error && error.message.startsWith('TUSHARE_') ? error.message : null }))
import { DATABASE_MIGRATIONS, runMigrations } from '../../electron/main/database/db'
import { buildOfficialSseTradingCalendar } from '../../electron/shared/officialSseTradingCalendar'
import { runDiagnosticAction } from '../../electron/main/services/diagnosticsService'
import { getDataQualitySnapshot } from '../../electron/main/services/dataQualityService'

const NOW = Date.parse('2026-10-08T10:00:00+08:00')
const row = () => ({ tsCode: '600001.SH', tradeDate: '20261008', price: 10, vol: 100, amount: 1000, preClose: 9.9, turnoverRate: null, volumeRatio: null, floatShare: null, fetchedAt: NOW })
let db: Database.Database
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] }); vi.setSystemTime(NOW)
  const nativeBinding = process.env.RT_READINESS_TEST_NATIVE_BINDING
  db = new Database(':memory:', nativeBinding ? { nativeBinding } : undefined); runMigrations(db, DATABASE_MIGRATIONS)
  const insert = db.prepare('INSERT INTO trade_cal (cal_date, is_open, pretrade_date) VALUES (?, ?, ?)')
  db.transaction(() => { for (const date of buildOfficialSseTradingCalendar()) insert.run(date.calDate, date.isOpen, date.pretradeDate) })()
  mocks.auction.mockResolvedValue([row()])
  mocks.limit.mockResolvedValue([{ tsCode: '600001.SH', tradeDate: '20260930', close: 10, name: 'fixture', pctChg: 10, amount: null, floatMv: null, totalMv: null, turnoverRatio: null, fdAmount: null, firstTime: null, lastTime: null, openTimes: null, upStat: null, limitTimes: 1, limit: 'U', fetchedAt: NOW }])
})
afterEach(() => { db?.close(); vi.unstubAllGlobals(); vi.useRealTimers() })
function seedOld() { db.prepare("INSERT INTO stk_auction_cache (ts_code, trade_date, price, vol, amount, pre_close, fetched_at) VALUES ('600001.SH', '20261008', 10, 100, 1000, 9.9, ?)").run(NOW - 1000) }
const stored = () => db.prepare('SELECT ts_code, trade_date, price, vol, amount, pre_close FROM stk_auction_cache ORDER BY ts_code').all()

describe('fact-only actions against isolated in-memory SQLite repositories', () => {
  it('auction can persist while limit table is empty; precise predecessor is independent', async () => {
    expect(await runDiagnosticAction(db, 'syncAuctionSnapshot')).toMatchObject({ outcome: 'success', insertedRows: 1, targetDate: '20261008' })
    expect(db.prepare('SELECT COUNT(*) AS count FROM limit_list_daily').get()).toEqual({ count: 0 })
    expect(stored()).toEqual([{ ts_code: '600001.SH', trade_date: '20261008', price: 10, vol: 100, amount: 1000, pre_close: 9.9 }])
    expect(await runDiagnosticAction(db, 'syncLimitList')).toMatchObject({ outcome: 'success', targetDate: '20260930', insertedRows: 1 })
    expect(db.prepare('SELECT trade_date, close FROM limit_list_daily').all()).toEqual([{ trade_date: '20260930', close: 10 }])
    expect(mocks.strategies).not.toHaveBeenCalled(); expect(mocks.signals).not.toHaveBeenCalled()
    expect(db.prepare('SELECT COUNT(*) AS count FROM decision_signals').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM data_quality_runs').get()).toEqual({ count: 0 })
    const quality = getDataQualitySnapshot(db, NOW)
    expect(quality.datasets.find(item => item.key === 'auction')).toMatchObject({ status: 'degraded', evidence: { reasonCode: 'COVERAGE_UNKNOWN' } })
    expect(quality.datasets.find(item => item.key === 'financials')).toMatchObject({ displayStatus: 'neutral' })
    expect(quality.summary.neutral).toBe(1)
  })
  it('empty, permission failure, bad row and conflicting row leave old facts unchanged', async () => {
    seedOld(); const old = stored()
    mocks.auction.mockResolvedValue([])
    expect(await runDiagnosticAction(db, 'syncAuctionSnapshot')).toMatchObject({ outcome: 'empty' }); expect(stored()).toEqual(old)
    mocks.auction.mockRejectedValue(new Error('TUSHARE_QUOTA_INSUFFICIENT'))
    expect(await runDiagnosticAction(db, 'syncAuctionSnapshot')).toMatchObject({ outcome: 'blocked' }); expect(stored()).toEqual(old)
    mocks.auction.mockResolvedValue([{ ...row(), tradeDate: '20261009' }])
    expect(await runDiagnosticAction(db, 'syncAuctionSnapshot')).toMatchObject({ reasonCode: 'FACT_INVALID' }); expect(stored()).toEqual(old)
    mocks.auction.mockResolvedValue([{ ...row(), price: 11 }])
    expect(await runDiagnosticAction(db, 'syncAuctionSnapshot')).toMatchObject({ reasonCode: 'FACT_CONFLICT' }); expect(stored()).toEqual(old)
  })
  it('new null does not erase prior value and valid repeats remain primary-key idempotent', async () => {
    seedOld(); mocks.auction.mockResolvedValue([{ ...row(), amount: null, preClose: null }])
    expect(await runDiagnosticAction(db, 'syncAuctionSnapshot')).toMatchObject({ outcome: 'partial', reasonCode: 'PARTIAL_OBSERVATION_RETAINED_FACTS' })
    expect(await runDiagnosticAction(db, 'syncAuctionSnapshot')).toMatchObject({ outcome: 'partial' })
    expect(stored()).toEqual([{ ts_code: '600001.SH', trade_date: '20261008', price: 10, vol: 100, amount: 1000, pre_close: 9.9 }])
    expect(db.prepare('SELECT fetched_at FROM stk_auction_cache').get()).toEqual({ fetched_at: NOW - 1000 })
  })
  it('real bounded parser rejects illegal numbers on either interface before any SQLite write', async () => {
    const actual = await vi.importActual<typeof import('../../electron/main/services/tushareService')>('../../electron/main/services/tushareService')
    mocks.auction.mockImplementation(actual.fetchStkAuction); mocks.limit.mockImplementation(actual.fetchLimitListDaily)
    seedOld()
    db.exec("INSERT INTO limit_list_daily (ts_code, trade_date, close, fetched_at) VALUES ('600001.SH', '20260930', 10, 1)")
    const auctionOld = db.prepare('SELECT * FROM stk_auction_cache').all()
    const limitOld = db.prepare('SELECT * FROM limit_list_daily').all()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: {
      fields: ['ts_code', 'trade_date', 'price', 'close', 'vol', 'amount', 'pre_close'],
      items: [['600001.SH', '20261008', 10, 10, 100, 'not-a-number', 9.9]],
    } }) })))
    expect(await runDiagnosticAction(db, 'syncAuctionSnapshot')).toMatchObject({ outcome: 'failed', reasonCode: 'FACT_INVALID', insertedRows: 0 })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ code: 0, data: {
      fields: ['ts_code', 'trade_date', 'close', 'amount'], items: [['600001.SH', '20260930', 10, 'not-a-number']],
    } }) })))
    expect(await runDiagnosticAction(db, 'syncLimitList')).toMatchObject({ outcome: 'failed', reasonCode: 'FACT_INVALID', insertedRows: 0 })
    expect(db.prepare('SELECT * FROM stk_auction_cache').all()).toEqual(auctionOld)
    expect(db.prepare('SELECT * FROM limit_list_daily').all()).toEqual(limitOld)
  })
  it('malformed terminal envelope discards a full batch and keeps old SQLite facts including time', async () => {
    const actual = await vi.importActual<typeof import('../../electron/main/services/tushareService')>('../../electron/main/services/tushareService')
    mocks.auction.mockImplementation(actual.fetchStkAuction); seedOld()
    const old = db.prepare('SELECT * FROM stk_auction_cache').all()
    const items = Array.from({ length: 5000 }, (_, i) => [`${100000 + i}.SH`, '20261008', 10, 100, 1000, 9.9])
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { fields: ['ts_code', 'trade_date', 'price', 'vol', 'amount', 'pre_close'], items } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0 }) })
    vi.stubGlobal('fetch', fetcher)
    expect(await runDiagnosticAction(db, 'syncAuctionSnapshot')).toMatchObject({ outcome: 'failed', reasonCode: 'FACT_INVALID', insertedRows: 0 })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(db.prepare('SELECT * FROM stk_auction_cache').all()).toEqual(old)
  })
  it('whole diagnostic operation aborts the in-flight third page at 30 seconds despite wall rollback', async () => {
    const actual = await vi.importActual<typeof import('../../electron/main/services/tushareService')>('../../electron/main/services/tushareService')
    mocks.auction.mockImplementation(actual.fetchStkAuction)
    const signals: AbortSignal[] = []
    const aborts: number[] = []
    const fetcher = vi.fn((_url: unknown, init: RequestInit) => new Promise((resolve, reject) => {
      const signal = init.signal!; signals.push(signal)
      const pageIndex = signals.length - 1
      const timer = setTimeout(() => {
        const items = Array.from({ length: 5000 }, (_, i) => [`${100000 + pageIndex * 5000 + i}.SH`, '20261008', 10, 100, 1000, 9.9])
        resolve({ ok: true, json: async () => ({ code: 0, data: { fields: ['ts_code', 'trade_date', 'price', 'vol', 'amount', 'pre_close'], items } }) })
      }, 12_000)
      signal.addEventListener('abort', () => { clearTimeout(timer); aborts.push(performance.now()); reject(new DOMException('fixture', 'AbortError')) }, { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    let settled = false
    const pending = runDiagnosticAction(db, 'syncAuctionSnapshot').then(result => { settled = true; return result })
    await vi.advanceTimersByTimeAsync(12_000); vi.setSystemTime(NOW - 3_600_000)
    await vi.advanceTimersByTimeAsync(18_000)
    expect(settled).toBe(true)
    expect(await pending).toMatchObject({ reasonCode: 'TUSHARE_REQUEST_TIMEOUT', insertedRows: 0 })
    expect(fetcher).toHaveBeenCalledTimes(3); expect(signals[2].aborted).toBe(true)
    expect(aborts.at(-1)).toBe(30_000)
    expect(stored()).toEqual([]); expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('repository transaction failure rolls back even an INSERT OR REPLACE attempt', async () => {
    seedOld(); const old = stored()
    db.exec("CREATE TRIGGER fixture_reject BEFORE INSERT ON stk_auction_cache BEGIN SELECT RAISE(ABORT, 'fixture transaction failure'); END")
    expect(await runDiagnosticAction(db, 'syncAuctionSnapshot')).toMatchObject({ outcome: 'failed', reasonCode: 'WRITE_FAILED', insertedRows: 0 })
    expect(stored()).toEqual(old)
  })
  it('calendar gap makes zero upstream requests, zero writes, and does not repair by guessing', async () => {
    seedOld(); const old = stored(); db.prepare("DELETE FROM trade_cal WHERE cal_date = '20261003'").run()
    expect(await runDiagnosticAction(db, 'syncAuctionSnapshot')).toMatchObject({ outcome: 'blocked', reasonCode: 'CALENDAR_UNAVAILABLE' })
    expect(mocks.auction).not.toHaveBeenCalled(); expect(mocks.limit).not.toHaveBeenCalled(); expect(stored()).toEqual(old)
  })
})
