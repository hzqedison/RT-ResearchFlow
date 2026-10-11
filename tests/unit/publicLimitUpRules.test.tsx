import Database from 'better-sqlite3'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recommendPublicLimitPoolDate } from '../../electron/main/services/publicLimitPoolCalendarService'
import { screenPublicLimitUpPool } from '../../electron/shared/publicLimitUpRules'
import type { PublicLimitPoolObservationRow, PublicLimitPoolObservationSnapshot } from '../../electron/shared/dataSourceTypes'
import { PublicLimitUpRulePanel } from '../../src/components/ShortTermStrategy/PublicLimitUpRulePanel'

vi.mock('electron', () => ({ app: { getPath: () => 'ISOLATED_UNUSED_ROOT' } }))
vi.mock('../../electron/main/services/pythonDataSourceBridge', () => ({ callPythonDataSource: vi.fn() }))
afterEach(() => vi.restoreAllMocks())
const NOW = Date.parse('2026-10-12T01:00:00Z')
function row(overrides: Partial<PublicLimitPoolObservationRow> = {}): PublicLimitPoolObservationRow {
  return { tsCode: '600000.SH', name: '测试股票', close: 10, pctChg: 10, fdAmountYuan: 5_000_000, firstTime: '09:30:00', openTimes: 0, limitTimes: 1, quality: 'available', ...overrides }
}
function snapshot(rows = [row()], overrides: Partial<PublicLimitPoolObservationSnapshot> = {}): PublicLimitPoolObservationSnapshot {
  return { tradeDate: '20261009', source: 'eastmoney_public', dateBasis: 'source-reported', verifiedAt: NOW - 1000, priceCheck: 'not-complete', rows, ...overrides }
}
describe('completed-day recommendation uses actual calendar facts', () => {
  function calendar() {
    const db = new Database(':memory:')
    db.exec("CREATE TABLE trade_cal(cal_date TEXT PRIMARY KEY,is_open INTEGER); INSERT INTO trade_cal VALUES('20261009',1),('20261010',0),('20261011',0),('20261012',1)")
    return db
  }
  it('chooses Friday during weekend and Monday before close, but Monday after close', () => {
    const db = calendar()
    try {
      expect(recommendPublicLimitPoolDate(db, Date.parse('2026-10-10T04:00:00Z'))).toBe('20261009')
      expect(recommendPublicLimitPoolDate(db, NOW)).toBe('20261009')
      expect(recommendPublicLimitPoolDate(db, Date.parse('2026-10-12T07:04:59Z'))).toBe('20261009')
      expect(recommendPublicLimitPoolDate(db, Date.parse('2026-10-12T07:05:00Z'))).toBe('20261012')
    } finally { db.close() }
  })
  it('does not assume weekdays or fill a missing calendar day', () => {
    const db = calendar()
    try {
      db.exec("DELETE FROM trade_cal WHERE cal_date='20261011'")
      expect(recommendPublicLimitPoolDate(db, NOW)).toBeNull()
    } finally { db.close() }
  })
  it('keeps missing/out-of-range/invalid calendar states unknown', () => {
    const db = new Database(':memory:')
    try {
      expect(recommendPublicLimitPoolDate(db, NOW)).toBeNull()
      db.exec("CREATE TABLE trade_cal(cal_date TEXT PRIMARY KEY,is_open INTEGER); INSERT INTO trade_cal VALUES('20260101',1)")
      expect(recommendPublicLimitPoolDate(db, NOW)).toBeNull()
      expect(recommendPublicLimitPoolDate(db, NaN)).toBeNull()
    } finally { db.close() }
  })
})
describe('transparent public limit-up rules', () => {
  it('matches inclusive preset boundaries without requiring paid sources', () => {
    expect(screenPublicLimitUpPool(snapshot([row({ firstTime: '10:00:00', openTimes: 1 })]), 'earlyFirst', NOW).matches).toHaveLength(1)
    expect(screenPublicLimitUpPool(snapshot([row({ limitTimes: 2, firstTime: '10:30:00', openTimes: 2, fdAmountYuan: 10_000_000 })]), 'secondBoard', NOW).matches).toHaveLength(1)
    expect(screenPublicLimitUpPool(snapshot([row({ limitTimes: 3, firstTime: '10:30:00', openTimes: 1, fdAmountYuan: 20_000_000 })]), 'continuous', NOW).matches).toHaveLength(1)
  })
  it.each([{ limitTimes: 2 }, { firstTime: '10:00:01' }, { firstTime: '09:24:59' }, { openTimes: 2 }, { fdAmountYuan: 4_999_999 }])('rejects a known non-match %j', values => {
    const result = screenPublicLimitUpPool(snapshot([row(values)]), 'earlyFirst', NOW)
    expect(result.matches).toHaveLength(0)
    expect(result.insufficientRows).toBe(0)
  })
  it.each([{ limitTimes: null }, { openTimes: null }, { fdAmountYuan: null }, { firstTime: null }, { firstTime: '24:00:00' }, { close: 0 }, { openTimes: 1.5 }, { limitTimes: 0 }, { fdAmountYuan: -1 }])('does not convert missing/invalid facts into zero or pass %j', values => {
    expect(screenPublicLimitUpPool(snapshot([row(values)]), 'earlyFirst', NOW)).toMatchObject({ state: 'ready', insufficientRows: 1, matches: [] })
  })
  it('blocks unknown/legacy source dates and rejects impossible or future dates', () => {
    expect(screenPublicLimitUpPool(snapshot([], {}), 'earlyFirst', NOW).state).toBe('blocked')
    expect(screenPublicLimitUpPool(snapshot([row()], { dateBasis: 'unknown' }), 'earlyFirst', NOW).reason).toBe('SOURCE_DATE_UNKNOWN')
    expect(screenPublicLimitUpPool(snapshot([row()], { source: 'akshare_eastmoney' }), 'earlyFirst', NOW).reason).toBe('SOURCE_DATE_UNKNOWN')
    expect(screenPublicLimitUpPool(snapshot([row()], { tradeDate: '20260229' }), 'earlyFirst', NOW).reason).toBe('INVALID_DATE')
    expect(screenPublicLimitUpPool(snapshot([row()], { tradeDate: '20261013' }), 'earlyFirst', NOW).reason).toBe('INVALID_DATE')
  })
  it('sorts deterministically, preserves evidence and does not mutate facts', () => {
    const data = snapshot([row({ tsCode: '600002.SH', fdAmountYuan: 8_000_000 }), row({ tsCode: '600001.SH', fdAmountYuan: 8_000_000 }), row({ tsCode: '600003.SH', firstTime: '09:25:00' })])
    const before = JSON.stringify(data)
    const result = screenPublicLimitUpPool(data, 'earlyFirst', NOW)
    expect(result.matches.map(item => item.row.tsCode)).toEqual(['600003.SH', '600001.SH', '600002.SH'])
    expect(result.matches[0].evidence).toContain('首次封板 09:25:00')
    expect(JSON.stringify(data)).toBe(before)
  })
  it('excludes duplicate stock identities instead of double counting', () => {
    expect(screenPublicLimitUpPool(snapshot([row(), row()]), 'earlyFirst', NOW)).toMatchObject({ insufficientRows: 2, matches: [] })
  })
  it('renders actual rule controls, limits and stock drill-down', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const html = renderToStaticMarkup(React.createElement(PublicLimitUpRulePanel, { snapshot: snapshot(), onOpenStock: vi.fn() }))
    expect(html).toContain('免费涨停选股规则')
    expect(html).toContain('1 只匹配')
    expect(html).toContain('查看日K')
    expect(html).toContain('不是买入指令')
    expect(html).toContain('本地同日收盘价核对未完成')
  })
})
