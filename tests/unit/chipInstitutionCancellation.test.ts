import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ fetch: vi.fn(), coverage: vi.fn(), replace: vi.fn(), failed: vi.fn() }))
vi.mock('../../electron/main/database/topInstDailyRepository', () => ({
  getTopInstByStockAndDate: () => [], getTopInstCoverage: m.coverage,
  recordTopInstSyncFailure: m.failed, replaceTopInstForTradeDate: m.replace,
}))
vi.mock('../../electron/main/services/tushareService', () => ({ fetchTopInst: m.fetch }))
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); m.coverage.mockReturnValue(null); m.replace.mockReturnValue(1) })

it('owns standalone institution work through settlement and prevents late replacement or failure records', async () => {
  let finish!: (rows: unknown[]) => void
  m.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { syncChipInstitutionEvidenceTradeDate } = await import('../../electron/main/services/chipInstitutionEvidenceService')
  const { chipStructureWorkOwner, stopChipStructureWork, waitForChipStructureWorkIdle } = await import('../../electron/main/services/chipStructureWorkOwner')
  const pending = syncChipInstitutionEvidenceTradeDate({} as never, 'fixture', '20260710')
  await vi.waitFor(() => expect(m.fetch).toHaveBeenCalledOnce())
  expect(chipStructureWorkOwner.snapshot().pendingTasks).toBe(1)
  const signal = m.fetch.mock.calls[0][2]
  stopChipStructureWork()
  expect(signal.aborted).toBe(true)
  expect(await waitForChipStructureWorkIdle(0)).toBe(false)
  finish([{ tsCode: '600000.SH', tradeDate: '20260710' }])
  await expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  expect(m.replace).not.toHaveBeenCalled(); expect(m.failed).not.toHaveBeenCalled()
  expect(await waitForChipStructureWorkIdle(1000)).toBe(true)
})

it('closed admission also rejects cached institution work', async () => {
  m.coverage.mockReturnValue({ status: 'success', rowCount: 1 })
  const { syncChipInstitutionEvidenceTradeDate } = await import('../../electron/main/services/chipInstitutionEvidenceService')
  const { stopChipStructureWork } = await import('../../electron/main/services/chipStructureWorkOwner')
  stopChipStructureWork()
  await expect(syncChipInstitutionEvidenceTradeDate({} as never, 'fixture', '20260710')).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  expect(m.coverage).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled()
})

it('preserves genuine provider failures rather than treating them as cancellation', async () => {
  m.fetch.mockRejectedValue(new Error('UPSTREAM_UNAVAILABLE'))
  const { syncChipInstitutionEvidenceTradeDate } = await import('../../electron/main/services/chipInstitutionEvidenceService')
  expect(await syncChipInstitutionEvidenceTradeDate({} as never, 'fixture', '20260710')).toMatchObject({ status: 'failed', requested: true, errorCode: 'UPSTREAM_UNAVAILABLE' })
  expect(m.failed).toHaveBeenCalledWith(expect.anything(), '20260710', 'UPSTREAM_UNAVAILABLE')
  expect(m.replace).not.toHaveBeenCalled()
})

it('still persists successful institution facts while admission is open', async () => {
  const rows = [{ tsCode: '600000.SH', tradeDate: '20260710' }]; m.fetch.mockResolvedValue(rows)
  const { syncChipInstitutionEvidenceTradeDate } = await import('../../electron/main/services/chipInstitutionEvidenceService')
  expect(await syncChipInstitutionEvidenceTradeDate({} as never, 'fixture', '20260710')).toMatchObject({ status: 'success', rowCount: 1, requested: true })
  expect(m.replace).toHaveBeenCalledWith(expect.anything(), '20260710', rows)
  expect(m.failed).not.toHaveBeenCalled()
})
