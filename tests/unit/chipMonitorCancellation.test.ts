import { beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ daily: vi.fn(), chips: vi.fn(), stocks: vi.fn(), dates: vi.fn(), query: vi.fn(), writeDaily: vi.fn(), writeChips: vi.fn(), writeResults: vi.fn() }))
vi.mock('../../electron/main/services/tushareService', () => ({ fetchDailyForCandidates: m.daily }))
vi.mock('../../electron/main/services/cyqChipsFetchService', () => ({ fetchCyqChipsSingleflight: m.chips }))
vi.mock('../../electron/main/database/tradeCalRepository', () => ({ getLastNTradingDays: m.dates }))
vi.mock('../../electron/main/database/chipMonitorRepository', () => ({ getMonitorStocks: m.stocks, upsertMonitorResults: m.writeResults }))
vi.mock('../../electron/main/database/cyqChipsCacheRepository', () => ({ queryChips: m.query, upsertChips: m.writeChips }))
vi.mock('../../electron/main/database/dailyCloseCacheRepository', () => ({ upsertDailyClose: m.writeDaily }))
const db = { prepare: (sql: string) => sql.includes('MAX(trade_date)') ? { get: () => ({ trade_date: '20260814' }) } : { all: () => [{ trade_date: '20260814', close: 10, pct_chg: 1, turnover_rate: 1 }] } } as never
const stock = (code: string) => ({ tsCode: code, source: 'watchlist', stockName: null, addedAt: 1 })
const chips = (code: string) => [5, 7, 10].map(price => ({ tsCode: code, tradeDate: '20260814', price, percent: 30 }))
type Service = typeof import('../../electron/main/services/chipMonitorService')
let service: Service
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks()
  m.daily.mockResolvedValue([]); m.chips.mockImplementation((_token, code) => Promise.resolve(chips(code)))
  m.stocks.mockReturnValue([stock('600000')]); m.dates.mockReturnValue(['20260814']); m.query.mockReturnValue([])
  service = await import('../../electron/main/services/chipMonitorService')
})
it('owns the daily and chip transport signals for a manually invoked job', async () => {
  expect(await service.runChipMonitorJob(db, 'synthetic')).toEqual({ success: 1, failed: 0 })
  expect(m.daily.mock.calls[0][4]).toBeInstanceOf(AbortSignal)
  expect(m.chips.mock.calls[0][3]).toBe(m.daily.mock.calls[0][4])
})

it('stops late daily writes and waits for the daily transport to settle', async () => {
  const owner = await import('../../electron/main/services/chipMonitorWorkOwner')
  let release!: (rows: unknown[]) => void
  m.daily.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const pending = service.runChipMonitorJob(db, 'synthetic')
  const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  await vi.waitFor(() => expect(m.daily).toHaveBeenCalledTimes(1))
  owner.stopChipMonitorWork()
  expect(m.daily.mock.calls[0][4].aborted).toBe(true)
  expect(await owner.waitForChipMonitorWorkIdle(0)).toBe(false)
  expect(service.isChipMonitorJobRunning()).toBe(true)
  release([{ tsCode: '600000.SH', tradeDate: '20260814', close: 10 }])
  await rejected
  expect(m.writeDaily).not.toHaveBeenCalled(); expect(m.chips).not.toHaveBeenCalled()
  expect(m.writeResults).not.toHaveBeenCalled()
  expect(await owner.waitForChipMonitorWorkIdle(0)).toBe(true)
  expect(service.isChipMonitorJobRunning()).toBe(false)
})

it('drains both concurrent chip requests without late cache or result writes', async () => {
  const owner = await import('../../electron/main/services/chipMonitorWorkOwner')
  m.stocks.mockReturnValue([stock('600000'), stock('000001')])
  const releases: Array<(rows: unknown[]) => void> = []
  m.chips.mockImplementation(() => new Promise(resolve => releases.push(resolve)))
  const pending = service.runChipMonitorJob(db, 'synthetic')
  const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  await vi.waitFor(() => expect(releases).toHaveLength(2))
  owner.stopChipMonitorWork()
  releases[0](chips('600000.SH'))
  await Promise.resolve(); await Promise.resolve()
  expect(await owner.waitForChipMonitorWorkIdle(0)).toBe(false)
  releases[1](chips('000001.SZ'))
  await rejected
  expect(m.writeChips).not.toHaveBeenCalled(); expect(m.writeResults).not.toHaveBeenCalled()
  expect(await owner.waitForChipMonitorWorkIdle(0)).toBe(true)
})

it('cancels the inter-batch delay without starting another stock or emitting completion', async () => {
  const owner = await import('../../electron/main/services/chipMonitorWorkOwner')
  m.stocks.mockReturnValue([stock('600000'), stock('000001'), stock('000002')])
  const send = vi.fn()
  const pending = service.runChipMonitorJob(db, 'synthetic', { webContents: { send } } as never)
  const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  await vi.waitFor(() => expect(m.writeChips).toHaveBeenCalledTimes(2))
  owner.stopChipMonitorWork()
  await rejected
  expect(m.chips).toHaveBeenCalledTimes(2)
  expect(m.writeChips).toHaveBeenCalledTimes(2)
  expect(m.writeResults).not.toHaveBeenCalled()
  expect(send.mock.calls.some(([channel]) => channel === 'shortTerm:chipMonitor:done')).toBe(false)
})

it('refuses new admissions without reading or changing the stock pool', async () => {
  const owner = await import('../../electron/main/services/chipMonitorWorkOwner')
  owner.stopChipMonitorWork()
  await expect(service.runChipMonitorJob(db, 'synthetic')).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  expect(m.stocks).not.toHaveBeenCalled(); expect(m.daily).not.toHaveBeenCalled()
  expect(service.isChipMonitorJobRunning()).toBe(false)
})

it('refuses a pre-aborted caller before a job starts', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(service.runChipMonitorJob(db, 'synthetic', undefined, 'relative', undefined, controller.signal)).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  expect(m.stocks).not.toHaveBeenCalled(); expect(m.daily).not.toHaveBeenCalled()
})

it('does not send progress to destroyed web contents', async () => {
  const send = vi.fn()
  await service.runChipMonitorJob(db, 'synthetic', { isDestroyed: () => false, webContents: { isDestroyed: () => true, send } } as never)
  expect(send).not.toHaveBeenCalled()
})

it('still rejects concurrent jobs with JOB_RUNNING', async () => {
  let release!: (rows: unknown[]) => void
  m.daily.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const first = service.runChipMonitorJob(db, 'synthetic')
  await vi.waitFor(() => expect(m.daily).toHaveBeenCalledTimes(1))
  await expect(service.runChipMonitorJob(db, 'synthetic')).rejects.toMatchObject({ name: 'JOB_RUNNING' })
  release([]); await first
})
