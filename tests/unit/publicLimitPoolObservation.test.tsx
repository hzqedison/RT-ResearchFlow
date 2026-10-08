import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PublicLimitPoolObservation } from '../../src/components/ShortTermStrategy/PublicLimitPoolObservation'
import { formatPublicSealAmount, selectPublicLimitPoolRows, publicObservationMissingFields, type PublicLimitPoolObservationRow } from '../../src/components/ShortTermStrategy/publicLimitPoolViewModel'

const row = (patch: Partial<PublicLimitPoolObservationRow> = {}): PublicLimitPoolObservationRow => ({
  tsCode: '600000.SH', name: '测试股', close: 10, pctChg: 10, fdAmountYuan: null,
  firstTime: null, openTimes: null, limitTimes: null, quality: 'partial', ...patch,
})

function render(rows: PublicLimitPoolObservationRow[], filters = { minBoards: null as number | null, maxOpens: null as number | null }, readFailed = false) {
  return renderToStaticMarkup(createElement(PublicLimitPoolObservation, {
    snapshot: { tradeDate: '20261008', source: 'akshare_eastmoney', rows },
    loading: false, readFailed, filters, onFiltersChange: () => {}, onRefresh: () => {}, onOpenStock: () => {},
  }))
}

describe('public limit observations remain usable with unknown optional facts', () => {
  it('shows unknown board/open counts by default rather than silently hiding the entire pool', () => {
    expect(selectPublicLimitPoolRows([row()], { minBoards: null, maxOpens: null })).toMatchObject({ rows: [row()], excludedUnknown: 0, total: 1 })
    expect(render([row()])).toContain('测试股')
  })
  it('excludes unknown only when the active filter requires its fact, counting each row once', () => {
    const rows = [row(), row({ tsCode: '000001.SZ', limitTimes: 2, openTimes: 0 }), row({ tsCode: '000002.SZ', limitTimes: 1, openTimes: 2 })]
    expect(selectPublicLimitPoolRows(rows, { minBoards: 2, maxOpens: 0 })).toMatchObject({ rows: [rows[1]], excludedUnknown: 1, total: 3 })
    expect(render(rows, { minBoards: 2, maxOpens: 0 })).toContain('缺少当前筛选所需字段')
  })
  it.each([
    { limitTimes: 1, openTimes: null, excludedUnknown: 0, result: 'fail plus unknown' },
    { limitTimes: null, openTimes: 2, excludedUnknown: 0, result: 'unknown plus fail' },
    { limitTimes: 2, openTimes: null, excludedUnknown: 1, result: 'pass plus unknown' },
    { limitTimes: null, openTimes: 0, excludedUnknown: 1, result: 'unknown plus pass' },
  ])('uses fail precedence for combined filters: $result', ({ limitTimes, openTimes, excludedUnknown }) => {
    const result = selectPublicLimitPoolRows([row({ limitTimes, openTimes })], { minBoards: 2, maxOpens: 0 })
    expect(result).toEqual({ rows: [], excludedUnknown, total: 1 })
  })
  it('keeps fully known matches, including the exact board and open-count boundaries', () => {
    const rows = [row({ limitTimes: 2, openTimes: 0 }), row({ tsCode: '000001.SZ', limitTimes: 3, openTimes: 0 })]
    expect(selectPublicLimitPoolRows(rows, { minBoards: 2, maxOpens: 0 })).toEqual({ rows, excludedUnknown: 0, total: 2 })
  })
  it.each([
    { limitTimes: null, openTimes: 0, minBoards: null, maxOpens: 0 },
    { limitTimes: 2, openTimes: null, minBoards: 2, maxOpens: null },
    { limitTimes: null, openTimes: null, minBoards: null, maxOpens: null },
  ])('ignores missing facts for disabled filters: $minBoards / $maxOpens', ({ limitTimes, openTimes, minBoards, maxOpens }) => {
    const rows = [row({ limitTimes, openTimes })]
    expect(selectPublicLimitPoolRows(rows, { minBoards, maxOpens })).toEqual({ rows, excludedUnknown: 0, total: 1 })
  })
  it('counts only unresolved rows once in a mixed batch, excluding known failures before unknown facts', () => {
    const rows = [
      row({ limitTimes: 1, openTimes: null }),
      row({ limitTimes: null, openTimes: 2 }),
      row({ limitTimes: 1, openTimes: 2 }),
      row({ limitTimes: 2, openTimes: null }),
      row({ limitTimes: null, openTimes: 0 }),
      row(),
      row({ limitTimes: 2, openTimes: 0 }),
    ]
    expect(selectPublicLimitPoolRows(rows, { minBoards: 2, maxOpens: 0 })).toEqual({ rows: [rows[6]], excludedUnknown: 3, total: 7 })
    expect(selectPublicLimitPoolRows(rows, { minBoards: null, maxOpens: null })).toEqual({ rows, excludedUnknown: 0, total: 7 })
  })
  it.each([NaN, Infinity, -1, 1.5])('does not treat invalid count %s as an eligible fact', value => {
    expect(selectPublicLimitPoolRows([row({ openTimes: value })], { minBoards: null, maxOpens: 2 }).excludedUnknown).toBe(1)
  })
  it('keeps stale cached rows visible while announcing a read failure independently', () => {
    const html = render([row()], { minBoards: null, maxOpens: null }, true)
    expect(html).toContain('role="alert"')
    expect(html).toContain('保留上次读取的资料')
    expect(html).toContain('测试股')
  })
  it('uses the existing accessible controls and a keyboard-native stock detail action', () => {
    const html = render([row()])
    expect(html).toContain('role="combobox"')
    expect(html).toContain('查看测试股日K')
    expect(html).not.toContain('<select')
    expect(html).toContain('不自动生成下方策略评分或交易订单')
  })
  it('distinguishes no filter matches from no limit-up facts on that day', () => {
    expect(render([row()], { minBoards: 2, maxOpens: null })).toContain('这不是当日无涨停')
  })
  it('does not claim a request-labelled date proves the upstream date', () => {
    expect(render([row()])).toContain('不代表上游已证明日期或全市场覆盖')
  })
  it('preserves a legitimate zero funding value rather than converting it to missing', () => {
    expect(formatPublicSealAmount(null)).toBe('待补')
    expect(formatPublicSealAmount(0)).toBe('0元')
    expect(formatPublicSealAmount(100_000)).toBe('10.00万')
    expect(formatPublicSealAmount(100_000_000)).toBe('1.00亿')
  })
  it('evaluates displayed row facts independently from a legacy batch quality flag', () => {
    expect(publicObservationMissingFields(row({ quality: 'available' }))).toContain('连板数')
    expect(publicObservationMissingFields(row({ quality: 'partial', fdAmountYuan: 0, firstTime: '09:30:00', openTimes: 0, limitTimes: 1 }))).toEqual([])
    expect(render([row({ quality: 'available' })])).not.toContain('所示筛选字段齐全')
  })
  it('treats date provenance and matching timestamp as unknown when legacy metadata is absent', () => {
    expect(render([row()])).toContain('旧缓存未记录日期来历')
    expect(render([row()])).toContain('核对时间未知')
  })
})
