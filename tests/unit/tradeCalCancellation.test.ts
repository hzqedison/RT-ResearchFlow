import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ fetch: vi.fn(), write: vi.fn(), official: vi.fn(), coverage: vi.fn() }))
vi.mock('../../electron/main/services/tushareService', () => ({ fetchTradeCal: m.fetch }))
vi.mock('../../electron/main/database/tradeCalRepository', () => ({ upsertTradeCal: m.write, insertTradeCalIfMissing: m.official, hasTradeCalCoverage: m.coverage }))
import { isTradeCalSyncRunning, syncTradeCalFull, syncTradeCalIfNeeded } from '../../electron/main/services/tradeCalSyncService'
beforeEach(() => { vi.resetAllMocks(); m.coverage.mockReturnValue(false); m.official.mockReturnValue({ insertedRows: 1096, conflictRows: 0, firstConflictDate: null }) })
it('pre-aborted calendar does not seed, fetch or write', async () => {
  const c = new AbortController(); c.abort()
  await expect(syncTradeCalIfNeeded({} as never, 'synthetic', c.signal)).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  await expect(syncTradeCalFull({} as never, 'synthetic', c.signal)).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  expect(m.official).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled()
})
it('late cancelled calendar does not write or use official fallback', async () => {
  const c = new AbortController(); let release!: (v: unknown) => void
  m.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const pending = syncTradeCalFull({} as never, 'synthetic', c.signal), rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  await Promise.resolve(); c.abort(); release([{ calDate: '20260814', isOpen: 1, pretradeDate: '20260813' }]); await rejected
  expect(m.write).not.toHaveBeenCalled(); expect(m.official).not.toHaveBeenCalled(); expect(isTradeCalSyncRunning()).toBe(false)
})
it('cancelling a joining waiter does not cancel the unrelated existing calendar owner', async () => {
  const c = new AbortController(); let release!: (v: unknown) => void
  m.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const first = syncTradeCalFull({} as never, 'synthetic'), joined = syncTradeCalFull({} as never, 'synthetic', c.signal)
  const rejected = expect(joined).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' }); await Promise.resolve(); c.abort(); await rejected
  expect(isTradeCalSyncRunning()).toBe(true)
  release([{ calDate: '20260814', isOpen: 1, pretradeDate: '20260813' }]); await first
  expect(m.write).toHaveBeenCalledTimes(1); expect(isTradeCalSyncRunning()).toBe(false)
})
