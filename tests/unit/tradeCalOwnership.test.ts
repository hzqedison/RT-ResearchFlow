import { beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ fetch: vi.fn(), write: vi.fn(), official: vi.fn(), coverage: vi.fn() }))
vi.mock('../../electron/main/services/tushareService', () => ({ fetchTradeCal: m.fetch }))
vi.mock('../../electron/main/database/tradeCalRepository', () => ({
  upsertTradeCal: m.write, insertTradeCalIfMissing: m.official, hasTradeCalCoverage: m.coverage,
}))
type Calendar = typeof import('../../electron/main/services/tradeCalSyncService')
let calendar: Calendar
const db = {} as never
const rows = [{ calDate: '20260814', isOpen: 1, pretradeDate: '20260813' }]
const cancelled = { code: 'LOCAL_WORK_CANCELLED' }

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  m.official.mockReturnValue({ insertedRows: 1096, conflictRows: 0, firstConflictDate: null })
  calendar = await import('../../electron/main/services/tradeCalSyncService')
})

it('an independently started calendar request has an owned cancellation signal', async () => {
  m.fetch.mockResolvedValue(rows)
  expect(await calendar.syncTradeCalFull(db, 'synthetic')).toMatchObject({ source: 'tushare' })
  expect(m.fetch.mock.calls[0][4]).toBeInstanceOf(AbortSignal)
})

it('coalesces standalone calls without changing their shared promise identity', async () => {
  m.fetch.mockResolvedValue(rows)
  const first = calendar.syncTradeCalFull(db, 'synthetic')
  const second = calendar.syncTradeCalFull(db, 'synthetic')
  expect(first).toBe(second)
  await first
  expect(m.fetch).toHaveBeenCalledTimes(1)
  expect(m.write).toHaveBeenCalledTimes(1)
})

it('global stop aborts but does not claim idle until uncooperative transport settles', async () => {
  let release!: (value: typeof rows) => void
  m.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const pending = calendar.syncTradeCalFull(db, 'synthetic')
  const rejected = expect(pending).rejects.toMatchObject(cancelled)
  await vi.waitFor(() => expect(m.fetch).toHaveBeenCalledTimes(1))
  const signal: AbortSignal = m.fetch.mock.calls[0][4]
  calendar.stopTradeCalendarWork()
  calendar.stopTradeCalendarWork()
  expect(signal.aborted).toBe(true)
  expect(calendar.isTradeCalSyncRunning()).toBe(true)
  expect(await calendar.waitForTradeCalendarWorkIdle(0)).toBe(false)
  release(rows)
  await rejected
  expect(await calendar.waitForTradeCalendarWorkIdle(0)).toBe(true)
  expect(calendar.isTradeCalSyncRunning()).toBe(false)
  expect(m.write).not.toHaveBeenCalled()
  expect(m.official).not.toHaveBeenCalled()
})

it('does not convert cancellation into official fallback when transport rejects', async () => {
  let reject!: (error: Error) => void
  m.fetch.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  const pending = calendar.syncTradeCalFull(db, 'synthetic')
  const rejected = expect(pending).rejects.toMatchObject(cancelled)
  await vi.waitFor(() => expect(m.fetch).toHaveBeenCalledTimes(1))
  calendar.stopTradeCalendarWork()
  reject(new Error('late transport failure'))
  await rejected
  expect(m.write).not.toHaveBeenCalled()
  expect(m.official).not.toHaveBeenCalled()
})

it('closes admission even for cached calendars and no-Key fallback', async () => {
  m.coverage.mockReturnValue(true)
  calendar.stopTradeCalendarWork()
  await expect(calendar.syncTradeCalIfNeeded(db)).rejects.toMatchObject(cancelled)
  await expect(calendar.syncTradeCalFull(db)).rejects.toMatchObject(cancelled)
  expect(m.coverage).not.toHaveBeenCalled()
  expect(m.fetch).not.toHaveBeenCalled()
  expect(m.official).not.toHaveBeenCalled()
})

it('stopping before the task starts prevents an official calendar write', async () => {
  const pending = calendar.syncTradeCalFull(db)
  const rejected = expect(pending).rejects.toMatchObject(cancelled)
  calendar.stopTradeCalendarWork()
  await rejected
  expect(m.official).not.toHaveBeenCalled()
  expect(await calendar.waitForTradeCalendarWorkIdle(0)).toBe(true)
})

it('cancelling a joining waiter leaves the shared standalone request running', async () => {
  let release!: (value: typeof rows) => void
  m.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const first = calendar.syncTradeCalFull(db, 'synthetic')
  await vi.waitFor(() => expect(m.fetch).toHaveBeenCalledTimes(1))
  const waiter = new AbortController()
  const joined = calendar.syncTradeCalIfNeeded(db, 'synthetic', waiter.signal)
  const rejected = expect(joined).rejects.toMatchObject(cancelled)
  waiter.abort()
  await rejected
  expect(m.fetch.mock.calls[0][4].aborted).toBe(false)
  expect(await calendar.waitForTradeCalendarWorkIdle(0)).toBe(false)
  release(rows)
  expect(await first).toMatchObject({ source: 'tushare' })
  expect(m.write).toHaveBeenCalledTimes(1)
  expect(m.official).not.toHaveBeenCalled()
})
