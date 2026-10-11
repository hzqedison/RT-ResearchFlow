import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ basic: vi.fn(), daily: vi.fn(), calendar: vi.fn(), fullCalendar: vi.fn(), days: vi.fn(), count: vi.fn(), missing: vi.fn(), write: vi.fn(), backfill: vi.fn() }))
vi.mock('../../electron/main/database/dailyCloseCacheRepository', () => ({ backfillDailyCloseTurnover: m.backfill, countDailyCloseByTradeDates: m.count, countMissingDailyCloseTurnoverByTradeDates: m.missing, upsertDailyClose: m.write }))
vi.mock('../../electron/main/database/tradeCalRepository', () => ({ getLastNTradingDays: m.days }))
vi.mock('../../electron/main/services/tushareService', () => ({ fetchDailyBasicByDate: m.basic, fetchDailyByDate: m.daily, getTushareAccessErrorCode: () => null }))
vi.mock('../../electron/main/services/tradeCalSyncService', () => ({ syncTradeCalFull: m.fullCalendar, syncTradeCalIfNeeded: m.calendar }))
import { runHistoricalDailySync } from '../../electron/main/services/historicalDailySyncService'
const row = (date: string) => ({ tsCode: '600000.SH', tradeDate: date, open: 10, high: 11, low: 9, close: 10, pctChg: 0, vol: 100, turnoverRate: null })
beforeEach(() => {
  vi.resetAllMocks(); m.calendar.mockResolvedValue(undefined); m.fullCalendar.mockResolvedValue(undefined)
  m.days.mockReturnValue(['20260813', '20260814']); m.count.mockReturnValue(new Map()); m.missing.mockReturnValue(new Map())
  m.basic.mockResolvedValue([]); m.backfill.mockReturnValue(0); m.daily.mockImplementation(async (_token, date) => [row(date)])
})
describe('Tushare historical cancellation', () => {
  it('pre-cancelled history never prepares calendars or writes', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(runHistoricalDailySync({} as never, 'synthetic', undefined, { signal: controller.signal, tradeDayCount: 2, endDate: '20260814', requestDelayMs: 0 })).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    expect(m.calendar).not.toHaveBeenCalled(); expect(m.daily).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled()
  })
  it('rejects a late daily response without writing or fetching the next date', async () => {
    const controller = new AbortController(); let release!: (v: unknown) => void
    m.daily.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = runHistoricalDailySync({} as never, 'synthetic', undefined, { signal: controller.signal, tradeDayCount: 2, endDate: '20260814', requestDelayMs: 0 })
    const failed = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve()
    controller.abort(); release([row('20260813')]); await failed
    expect(m.write).not.toHaveBeenCalled(); expect(m.daily).toHaveBeenCalledTimes(1)
  })
  it('preserves the first committed date and stops before the next date', async () => {
    const controller = new AbortController()
    await expect(runHistoricalDailySync({} as never, 'synthetic', undefined, { signal: controller.signal, tradeDayCount: 2, endDate: '20260814', requestDelayMs: 0,
      onProgress: progress => { if (progress.syncedTradeDays >= 1) controller.abort() } })).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    expect(m.write).toHaveBeenCalledTimes(1); expect(m.daily).toHaveBeenCalledTimes(1)
  })
  it('cancels calendar preparation before reading or requesting daily facts', async () => {
    const controller = new AbortController(); let release!: () => void
    m.calendar.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const pending = runHistoricalDailySync({} as never, 'synthetic', undefined, { signal: controller.signal, tradeDayCount: 2, requestDelayMs: 0 })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve()
    controller.abort(); release(); await rejected
    expect(m.days).not.toHaveBeenCalled(); expect(m.daily).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled()
  })
  it('does not write a late turnover supplement or count the date as failed', async () => {
    const controller = new AbortController(); let release!: (v: unknown) => void
    m.count.mockReturnValue(new Map([['20260813', 5000], ['20260814', 5000]])); m.missing.mockReturnValue(new Map([['20260813', 1]]))
    m.basic.mockImplementationOnce(() => new Promise(resolve => { release = resolve })); const progress: Array<{ failedTradeDays: number; processedTradeDays: number; message: string }> = []
    const pending = runHistoricalDailySync({} as never, 'synthetic', undefined, { signal: controller.signal, tradeDayCount: 2, requestDelayMs: 0, onProgress: p => progress.push(p) })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve()
    controller.abort(); release([{ tsCode: '600000.SH', tradeDate: '20260813', turnoverRate: 1, floatShare: null }]); await rejected
    expect(m.backfill).not.toHaveBeenCalled(); expect(m.daily).not.toHaveBeenCalled(); expect(m.basic).toHaveBeenCalledTimes(1)
    expect(progress.at(-1)).toMatchObject({ failedTradeDays: 0, processedTradeDays: 0 }); expect(progress.at(-1)?.message).toContain('已停止')
  })
  it('does not persist uncommitted daily rows when cancellation interrupts basic-data merging', async () => {
    const controller = new AbortController(); let release!: (v: unknown) => void
    m.basic.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = runHistoricalDailySync({} as never, 'synthetic', undefined, { signal: controller.signal, tradeDayCount: 2, requestDelayMs: 0 })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve()
    controller.abort(); release([]); await rejected
    expect(m.write).not.toHaveBeenCalled(); expect(m.daily).toHaveBeenCalledTimes(1)
  })
})
