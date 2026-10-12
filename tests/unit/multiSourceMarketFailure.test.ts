import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../../electron/main/database/db'
import { updateMultiSourcePreference } from '../../electron/main/database/dataSourceRepository'
import { fetchSelectedStockDaily } from '../../electron/main/services/multiSourceMarketService'
import { describePublicDataFailure } from '../../electron/main/utils/publicDataFailure'

const sources = vi.hoisted(() => ({ eastmoney: vi.fn(), history: vi.fn(), benchmark: vi.fn(), tushare: vi.fn() }))
vi.mock('../../electron/main/services/tushareService', () => ({
  fetchEastmoneySingleStockDaily: sources.eastmoney, ensureTrendBenchmarkFreshness: sources.benchmark, forceFetchSingleStock: sources.tushare,
}))
vi.mock('../../electron/main/services/publicHistoricalDailySyncService', () => ({ fetchPublicDailyHistoryForCode: sources.history }))
vi.mock('electron', () => ({
  app: { getPath: () => 'ISOLATED_UNUSED_DATA_ROOT' },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))
let db: Database.Database
beforeEach(() => {
  vi.clearAllMocks()
  sources.eastmoney.mockReset(); sources.history.mockReset(); sources.benchmark.mockReset(); sources.tushare.mockReset()
  db = new Database(':memory:'); runMigrations(db)
  db.prepare('INSERT INTO stock_info (stockCode, stockName, fetchedAt) VALUES (?, ?, ?)').run('000001', 'Isolated fixture', 1)
  sources.benchmark.mockResolvedValue({ state: 'current' })
})
afterEach(() => { db.close() })
const rows = [{ tsCode: '000001.SZ', tradeDate: '20261012', open: 10, high: 12, low: 9, close: 11, pctChg: 10, vol: 100, amount: 110, turnoverRate: null }]

describe('multi-source failure explanation and unchanged ordered fallback', () => {
  it('retains an adapter-classified interruption instead of collapsing it to permissions', async () => {
    sources.eastmoney.mockResolvedValue({ ok: false, code: 'FETCH_FAILED', message: describePublicDataFailure({ code: 'UND_ERR_SOCKET' }) })
    await expect(fetchSelectedStockDaily(db, '000001', { onlyProvider: 'eastmoney' })).rejects.toThrow('连接中断')
    expect(db.prepare('SELECT COUNT(*) AS n FROM stock_price_cache').get()).toEqual({ n: 0 })
  })
  it('continues to the selected Tencent source after Eastmoney fails and writes only successful facts', async () => {
    updateMultiSourcePreference(db, { dailyProviders: ['eastmoney', 'tencent'] })
    sources.eastmoney.mockResolvedValue({ ok: false, code: 'FETCH_FAILED', message: describePublicDataFailure(undefined, 429) })
    sources.history.mockResolvedValue({ rows })
    const result = await fetchSelectedStockDaily(db, '000001')
    expect(result).toMatchObject({ provider: 'tencent', totalRows: 1, rowsWritten: 1, latestTradeDate: '20261012' })
    expect(sources.eastmoney).toHaveBeenCalledTimes(1)
    expect(sources.history).toHaveBeenCalledWith(db, '000001.SZ', expect.any(String), { providers: ['tencent'] })
    expect(db.prepare('SELECT close FROM stock_price_cache WHERE stockCode = ?').get('000001')).toEqual({ close: 11 })
  })
  it('keeps missing Tushare credentials separate from a public network failure', async () => {
    await expect(fetchSelectedStockDaily(db, '000001', { onlyProvider: 'tushare' })).rejects.toThrow('绑定并验证')
    expect(sources.tushare).not.toHaveBeenCalled()
  })
  it('redacts unknown provider bodies and retains each selected provider name on total failure', async () => {
    updateMultiSourcePreference(db, { dailyProviders: ['eastmoney', 'tencent'] })
    sources.eastmoney.mockResolvedValue({ ok: false, message: 'Token=SECRET Cookie=SECRET C:/Users/private' })
    sources.history.mockRejectedValue({ cause: { code: 'ENOTFOUND' }, message: 'SECRET' })
    const error = await fetchSelectedStockDaily(db, '000001').catch(value => value)
    expect(error.message).toContain('eastmoney: 行情取数未完成')
    expect(error.message).toContain('tencent: 行情服务器域名解析失败')
    expect(error.message).not.toMatch(/SECRET|Cookie|C:\//)
    expect(db.prepare('SELECT COUNT(*) AS n FROM stock_price_cache').get()).toEqual({ n: 0 })
  })
})
