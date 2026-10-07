import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../../electron/main/database/db'
import { getMultiSourcePreference, getWencaiCookieEncrypted, updateMultiSourcePreference } from '../../electron/main/database/dataSourceRepository'
import { latestClosedCalendarDate, normalizeBridgeDailyRows, normalizeMarketStockCode } from '../../electron/main/services/multiSourceMarketService'
import { normalizeReportReferences } from '../../electron/main/services/multiSourceResearchService'

vi.mock('electron', () => ({
  app: { getPath: () => 'ISOLATED_UNUSED_DATA_ROOT' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from('isolated-encrypted:' + value),
    decryptString: (value: Buffer) => value.toString().replace('isolated-encrypted:', ''),
  },
}))

let db: Database.Database | null = null
function memoryDb() { db = new Database(':memory:'); runMigrations(db); return db }
afterEach(() => { db?.close(); db = null })

describe('Multi-source configuration and canonical boundaries', () => {
  it('defaults to free sources without deleting the optional Tushare configuration', () => {
    const database = memoryDb()
    expect(getMultiSourcePreference(database).dailyProviders).toEqual(['tencent', 'eastmoney', 'sina'])
    expect(getMultiSourcePreference(database).reportProviders).toEqual(['eastmoney'])
  })
  it('persists ordered unique selections and keeps an intentional empty list', () => {
    const database = memoryDb()
    updateMultiSourcePreference(database, { dailyProviders: ['akshare', 'tencent', 'akshare'], reportProviders: [] })
    expect(getMultiSourcePreference(database).dailyProviders).toEqual(['akshare', 'tencent'])
    updateMultiSourcePreference(database, { dailyProviders: [] })
    expect(getMultiSourcePreference(database).dailyProviders).toEqual([])
    expect(getMultiSourcePreference(database).reportProviders).toEqual([])
  })
  it('stores the cookie separately from JSON and preserves it across metadata saves', () => {
    const database = memoryDb()
    updateMultiSourcePreference(database, { wencaiCookie: 'ISOLATED_FAKE_COOKIE', wencaiEnabled: true })
    const encrypted = getWencaiCookieEncrypted(database)
    updateMultiSourcePreference(database, { dailyProviders: ['tencent'] })
    expect(getWencaiCookieEncrypted(database)).toEqual(encrypted)
    const preference = database.prepare('SELECT preference FROM multi_data_source_config').get() as { preference: string }
    expect(preference.preference).not.toContain('COOKIE')
    updateMultiSourcePreference(database, { clearWencaiCookie: true })
    expect(getWencaiCookieEncrypted(database)).toBeNull()
  })
  it('rejects unknown providers without overwriting saved preferences', () => {
    const database = memoryDb()
    updateMultiSourcePreference(database, { dailyProviders: ['tencent'] })
    expect(() => updateMultiSourcePreference(database, { dailyProviders: ['unknown'] as never })).toThrow()
    expect(getMultiSourcePreference(database).dailyProviders).toEqual(['tencent'])
  })
  it('converts AKShare yuan to thousand yuan and excludes incomplete or future bars', () => {
    const rows = normalizeBridgeDailyRows('akshare', '000001.SZ', [
      { '日期': '2026-10-06', '开盘': 10, '最高': 12, '最低': 9, '收盘': 11, '成交量': 100, '成交额': 110000, '涨跌幅': 10, '换手率': 1 },
      { '日期': '2026-10-07', '开盘': 10, '最高': 8, '最低': 9, '收盘': 11, '成交量': 100, '涨跌幅': 1 },
      { '日期': '2026-10-08', '开盘': 10, '最高': 12, '最低': 9, '收盘': 11, '成交量': 100, '涨跌幅': 1 },
    ], '20261007')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ amount: 110, vol: 100, turnoverRate: 1, tradeDate: '20261006' })
  })
  it('does not manufacture the first missing percentage and converts TDX share volume', () => {
    const rows = normalizeBridgeDailyRows('tdx', '600036.SH', [
      { datetime: '2026-10-05', open: 10, high: 11, low: 9, close: 10, volume: 10000, amount: 100000 },
      { datetime: '2026-10-06', open: 10, high: 12, low: 9, close: 11, volume: 20000, amount: 200000 },
    ], '20261006')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ vol: 200, amount: 200 })
    expect(rows[0].pctChg).toBeCloseTo(10)
  })
  it('uses the China close boundary and identifies BJ market codes', () => {
    expect(latestClosedCalendarDate(Date.parse('2026-10-07T06:00:00Z'))).toBe('20261006')
    expect(latestClosedCalendarDate(Date.parse('2026-10-07T08:00:00Z'))).toBe('20261007')
    expect(normalizeMarketStockCode('920001')).toEqual({ stockCode: '920001', tsCode: '920001.BJ' })
    expect(() => normalizeMarketStockCode('not-a-stock')).toThrow()
  })
  it('keeps reports as metadata and rejects unrelated stock IDs or unsafe PDF links', () => {
    const reports = normalizeReportReferences('eastmoney', '000001', [
      { stockCode: '000001', title: 'Isolated research title', publishDate: '2026-10-06', infoCode: 'AP202610061234567890', orgSName: 'Fixture' },
      { stockCode: '000002', title: 'Different stock', publishDate: '2026-10-06' },
    ])
    expect(reports).toHaveLength(1)
    expect(reports[0].pdfUrl).toMatch(/^https:\/\/pdf\.dfcfw\.com\//)
    const unsafe = normalizeReportReferences('akshare', '000001', [{ '报告名称': 'Fixture', '日期': '2026-10-06', '报告PDF链接': 'file:///private/account' }])
    expect(unsafe[0].pdfUrl).toBeNull()
  })
})
