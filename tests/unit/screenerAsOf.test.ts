import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  basics: vi.fn(), daily: vi.fn(), replace: vi.fn(), rank: vi.fn(), money: vi.fn(),
  summary: vi.fn(), estimated: vi.fn(), rt: vi.fn(), cachedAt: vi.fn(), stale: vi.fn(),
}))
vi.mock('../../electron/main/database/stockBasicCacheRepository', () => ({ queryAllActive: deps.basics }))
vi.mock('../../electron/main/database/dailyCloseCacheRepository', () => ({ queryDailyClose: deps.daily }))
vi.mock('../../electron/main/database/stockScreenerResultsRepository', () => ({ replaceResultsForDate: deps.replace }))
vi.mock('../../electron/main/database/screenerRankConfigRepository', () => ({ getScreenerRankConfig: deps.rank }))
vi.mock('../../electron/main/database/moneyFlowRepository', () => ({
  getMoneyFlowMapByDate: deps.money, buildMoneyFlowSummary: deps.summary, buildEstimatedMoneyFlowSummary: deps.estimated,
}))
vi.mock('../../electron/main/services/sharedRtKCache', () => ({
  getRtKCache: deps.rt, getRtKCachedAt: deps.cachedAt, isRtKStale: deps.stale,
}))
import { runScreener, validateScreenerTradeDate } from '../../electron/main/services/stockScreenerService'

const code = '600000.SH'
const now = Date.parse('2026-10-09T02:00:00Z')
function history(end: string, count = 65, turnoverRate: number | null = 2) {
  const day = new Date(`${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}T00:00:00Z`)
  const dates: string[] = []
  while (dates.length < count) {
    if (day.getUTCDay() > 0 && day.getUTCDay() < 6) dates.unshift(day.toISOString().slice(0, 10).replace(/-/g, ''))
    day.setUTCDate(day.getUTCDate() - 1)
  }
  return dates.map((tradeDate, index) => ({
    tsCode: code, tradeDate, open: 10, high: 11, low: 9,
    close: 10 + index / 100, pctChg: 0.1, vol: 1000, turnoverRate,
  }))
}
function database() {
  return { prepare: vi.fn((sql: string) => ({ get: vi.fn(() => ({ cnt: 65 })), all: vi.fn(() => []) })) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(now)
  deps.basics.mockReturnValue([{ tsCode: code, name: '示例股份', industry: '制造', circFloat: 10 }])
  deps.daily.mockReturnValue(new Map([[code, history('20261008')]]))
  deps.rank.mockReturnValue({
    weights: { crossUp: 1, volAmplified: 1, bullTrend: 1, macdBull: 1, hasTurnover: 1, moneyInflow: 0 },
    tieBreaker: 'pctChg', normalizeEnabled: false,
    normalizationCaps: { volAmplified: 3, macdBull: 0.08, hasTurnover: 8, moneyInflow: 5 }, updatedAt: 7,
  })
  deps.money.mockReturnValue(new Map())
  deps.estimated.mockReturnValue({ source: 'none', mainNetInflow: null })
  deps.rt.mockReturnValue(new Map([[code, { price: 99, change: 20, vol: 99000, amount: 99000000 }]]))
  deps.cachedAt.mockReturnValue(now - 1000)
  deps.stale.mockReturnValue(false)
})
afterEach(() => vi.useRealTimers())

describe('actual screener day-level as-of boundaries', () => {
  it('does not substitute today\'s quote into a historical date during trading hours', () => {
    const snapshot = runScreener(database() as never, '20261008')
    expect(snapshot.mode).toBe('eod')
    expect(snapshot.rtTime).toBeUndefined()
    expect(snapshot.totalScanned).toBe(1)
    expect(snapshot.stocks[0].close).toBeCloseTo(10.64)
    expect(snapshot.stocks[0].amount).not.toBe(99000000)
  })
  it('does not estimate historical turnover from current share capital', () => {
    deps.daily.mockReturnValue(new Map([[code, history('20261008', 65, null)]]))
    const snapshot = runScreener(database() as never, '20261008')
    expect(snapshot.stocks[0].turnoverRate).toBeNull()
    expect(snapshot.stocks[0].turnoverMissing).toBe(true)
    expect(snapshot.stocks[0].conditionsMet).not.toContain('有效换手')
  })
  it('still uses a fresh same-day quote for today\'s live calculation', () => {
    const snapshot = runScreener(database() as never, '20261009')
    expect(snapshot.mode).toBe('realtime')
    expect(snapshot.stocks[0].close).toBe(99)
    expect(snapshot.stocks[0].amount).toBe(99000000)
    expect(snapshot.totalScanned).toBe(1)
  })
  it.each([Date.parse('2026-10-08T02:00:00Z'), now + 1000, 0])('refuses an invalid-date/future-time realtime cache %s', cachedAt => {
    deps.cachedAt.mockReturnValue(cachedAt)
    deps.daily.mockReturnValue(new Map([[code, history('20261009')]]))
    const snapshot = runScreener(database() as never, '20261009')
    expect(snapshot.mode).toBe('eod-fallback')
    expect(snapshot.stocks[0].close).toBeCloseTo(10.64)
  })
  it('does not relabel a stock\'s previous closing row as a new target-date signal', () => {
    deps.daily.mockReturnValue(new Map([[code, history('20261007')]]))
    const snapshot = runScreener(database() as never, '20261008')
    expect(snapshot.totalScanned).toBe(0)
    expect(snapshot.stocks).toEqual([])
    expect(deps.replace).toHaveBeenCalledWith(expect.anything(), '20261008', [], expect.objectContaining({ totalScanned: 0 }))
  })
  it('does not count a stock whose sufficient rows are entirely after the target date', () => {
    deps.daily.mockReturnValue(new Map([[code, history('20261009').map(row => ({ ...row, tradeDate: '20261009' }))]]))
    const snapshot = runScreener(database() as never, '20261008')
    expect(snapshot.totalScanned).toBe(0)
    expect(snapshot.stocks).toEqual([])
  })
  it('bounds the calendar coverage check to the requested history window', () => {
    const db = database()
    runScreener(db as never, '20261008')
    const call = db.prepare.mock.calls.find(([sql]) => sql.includes('COUNT(DISTINCT trade_date)'))
    expect(call?.[0]).toContain('trade_date >= ? AND trade_date <= ?')
  })
  it.each(['20260230', 'not-a-date', '2026-10-08', '20261010'])('rejects invalid/future date %s before reading or saving data', date => {
    expect(() => runScreener(database() as never, date)).toThrow()
    expect(deps.basics).not.toHaveBeenCalled()
    expect(deps.replace).not.toHaveBeenCalled()
  })
  it('accepts a real historical leap date', () => {
    expect(() => validateScreenerTradeDate('20240229')).not.toThrow()
  })
})
