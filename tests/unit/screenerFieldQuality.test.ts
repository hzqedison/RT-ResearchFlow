import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { queryDailyClose, queryDailyCloseExact, queryStockOHLCV, queryDailyCloseByDate, upsertDailyClose } from '../../electron/main/database/dailyCloseCacheRepository'
import { buildMoneyFlowSummary } from '../../electron/main/database/moneyFlowRepository'
import type { MoneyFlowDailyRow } from '../../electron/main/database/types'
import type DatabaseType from 'better-sqlite3'
import { compareNullableDescending } from '../../src/components/ShortTermStrategy/screenerNumericSort'

const require = createRequire(import.meta.url)
const Database = require(process.env.RT_TEST_SQLITE_MODULE || 'better-sqlite3') as typeof DatabaseType
const opened: DatabaseType.Database[] = []
afterEach(() => { for (const db of opened.splice(0)) db.close() })

function database(provenance: boolean) {
  const db = new Database(':memory:')
  opened.push(db)
  db.exec(`CREATE TABLE daily_close_cache (
    ts_code TEXT, trade_date TEXT, open REAL, high REAL, low REAL, close REAL,
    pct_chg REAL, vol REAL, turnover_rate REAL${provenance ? ', amount REAL, data_source TEXT, amount_source TEXT, turnover_source TEXT, fetched_at INTEGER' : ''},
    PRIMARY KEY (ts_code, trade_date))`)
  return db
}
const daily = { tsCode: '600000.SH', tradeDate: '20261008', open: 10, high: 11, low: 9, close: 10.5, pctChg: 1, vol: 1000, turnoverRate: 2, amount: 2500 }
const flow = {
  tsCode: daily.tsCode, tradeDate: daily.tradeDate, fetchedAt: 1,
  buySmVol: null, buySmAmount: null, sellSmVol: null, sellSmAmount: null,
  buyMdVol: null, buyMdAmount: null, sellMdVol: null, sellMdAmount: null,
  buyLgVol: null, buyLgAmount: 100, sellLgVol: null, sellLgAmount: 20,
  buyElgVol: null, buyElgAmount: 50, sellElgVol: null, sellElgAmount: 10,
  netMfVol: null, netMfAmount: 110,
} satisfies MoneyFlowDailyRow

describe('nullable amount sorting', () => {
  it('sorts known observations before missing values while preserving a genuine zero', () => {
    expect([null, 0, 10, undefined, 5].sort(compareNullableDescending)).toEqual([10, 5, 0, null, undefined])
  })
  it.each([null, undefined, NaN, Infinity, -Infinity])('keeps unknown %s after finite observations', value => {
    expect(compareNullableDescending(value, 0)).toBe(1)
    expect(compareNullableDescending(0, value)).toBe(-1)
    expect(compareNullableDescending(value, null)).toBe(0)
  })
  it('does not overflow the comparator or return NaN on equal missing values', () => {
    expect(compareNullableDescending(Number.MAX_VALUE, -Number.MAX_VALUE)).toBe(-1)
    expect(compareNullableDescending(null, null)).toBe(0)
  })
})

describe('recorded transaction amount survives the actual SQLite read paths', () => {
  it.each(['batch', 'exact', 'mini-chart', 'date'] as const)('retains thousands-of-yuan amount through %s', kind => {
    const db = database(true)
    upsertDailyClose(db, [daily], { dataSource: 'tushare', amountSource: 'tushare' })
    const row = kind === 'batch' ? queryDailyClose(db, [daily.tsCode], daily.tradeDate).get(daily.tsCode)?.[0]
      : kind === 'exact' ? queryDailyCloseExact(db, [daily.tsCode], daily.tradeDate).get(daily.tsCode)?.[0]
      : kind === 'mini-chart' ? queryStockOHLCV(db, daily.tsCode, daily.tradeDate)[0]
      : queryDailyCloseByDate(db, daily.tradeDate)[0]
    expect(row?.amount).toBe(2500)
  })
  it('keeps legacy databases readable without fabricating an amount column', () => {
    const db = database(false)
    upsertDailyClose(db, [daily])
    expect(queryDailyClose(db, [daily.tsCode], daily.tradeDate).get(daily.tsCode)?.[0].amount).toBeUndefined()
    expect(db.prepare('PRAGMA table_info(daily_close_cache)').all().some((row: any) => row.name === 'amount')).toBe(false)
  })
  it('does not fill an absent amount with the closing-price estimate', () => {
    const db = database(true)
    upsertDailyClose(db, [{ ...daily, amount: null }], { dataSource: 'tencent' })
    expect(queryDailyCloseExact(db, [daily.tsCode], daily.tradeDate).get(daily.tsCode)?.[0].amount).toBeNull()
  })
})

describe('money-flow strength requires complete finite observations', () => {
  it('uses complete large-order observations and a true yuan denominator', () => {
    expect(buildMoneyFlowSummary(flow, 2500000)).toMatchObject({ source: 'real', mainNetInflow: 1200000, mainNetInflowRatio: 48 })
  })
  it.each(['buyLgAmount', 'buyElgAmount', 'sellLgAmount', 'sellElgAmount'] as const)('does not turn missing %s into zero', field => {
    expect(buildMoneyFlowSummary({ ...flow, [field]: null }, 2500000)).toMatchObject({ source: 'none', mainNetInflow: null, mainNetInflowRatio: null })
  })
  it.each([NaN, Infinity, -1, Number.MAX_VALUE])('rejects invalid gross order amount %s', value => {
    expect(buildMoneyFlowSummary({ ...flow, buyLgAmount: value }, 2500000)).toMatchObject({ source: 'none', mainNetInflow: null, mainNetInflowRatio: null })
  })
  it.each([null, 0, -1, NaN, Infinity])('does not divide by invalid/unknown turnover amount %s', value => {
    expect(buildMoneyFlowSummary(flow, value)?.mainNetInflowRatio).toBeNull()
  })
  it('preserves a real zero flow and a negative net flow without relabeling them missing', () => {
    expect(buildMoneyFlowSummary({ ...flow, buyLgAmount: 0, buyElgAmount: 0, sellLgAmount: 0, sellElgAmount: 0 }, 1)).toMatchObject({ source: 'real', mainNetInflow: 0, mainNetInflowRatio: 0 })
    expect(buildMoneyFlowSummary({ ...flow, sellLgAmount: 200 }, 2500000)?.mainNetInflow).toBe(-600000)
  })
})
