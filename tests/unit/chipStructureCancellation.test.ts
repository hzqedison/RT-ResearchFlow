import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  daily: vi.fn(), perf: vi.fn(), chips: vi.fn(), institution: vi.fn(),
  writeDaily: vi.fn(), writePerf: vi.fn(), writeChips: vi.fn(),
}))
vi.mock('../../electron/main/database/chipMonitorRepository', () => ({ getMonitorStocks: () => [] }))
vi.mock('../../electron/main/database/cyqPerfCacheRepository', () => ({
  getCyqPerf: () => null, listCyqPerfHistory: () => [], upsertCyqPerf: mocks.writePerf,
}))
vi.mock('../../electron/main/database/cyqChipsCacheRepository', () => ({
  listChipTradeDates: () => [], queryChips: () => [], upsertChips: mocks.writeChips,
}))
vi.mock('../../electron/main/database/dailyCloseCacheRepository', () => ({ upsertDailyClose: mocks.writeDaily }))
vi.mock('../../electron/main/services/tushareService', () => ({
  fetchCyqPerf: mocks.perf, fetchCyqChips: mocks.chips, fetchDailyForCandidates: mocks.daily,
}))
vi.mock('../../electron/main/services/chipStructureService', () => ({
  normalizeChipStructureTsCode: (value: string) => value,
  getChipStructureSummaries: (_db: unknown, requests: Array<{ tsCode: string }>) => requests.map(({ tsCode }) => ({ tsCode, tradeDate: '20260710' })),
}))
vi.mock('../../electron/main/services/chipInstitutionEvidenceService', () => ({
  syncChipInstitutionEvidenceTradeDate: mocks.institution,
  getChipInstitutionEvidence: () => ({ coverageStatus: 'available' }),
}))

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks()
  mocks.daily.mockResolvedValue([]); mocks.perf.mockResolvedValue([]); mocks.chips.mockResolvedValue([])
  mocks.institution.mockResolvedValue({ tradeDate: '20260710', status: 'success', rowCount: 1, errorCode: null, skipped: false })
})

for (const stage of ['daily', 'perf', 'chips'] as const) {
  it(`owns a pending ${stage} request and rejects late facts and subsequent stages on stop`, async () => {
    let finish!: (rows: unknown[]) => void
    mocks[stage].mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const { runChipStructureSync } = await import('../../electron/main/services/chipStructureSyncService')
    const { chipStructureWorkOwner, stopChipStructureWork, waitForChipStructureWorkIdle } = await import('../../electron/main/services/chipStructureWorkOwner')
    const events: string[] = []
    const job = runChipStructureSync({} as never, 'isolated-not-a-key', {
      tsCodes: ['600000.SH', '000001.SZ'], tradeDate: '20260710', scope: 'all', force: true,
      webContents: { isDestroyed: () => false, send: (channel: string) => events.push(channel) } as never,
    })
    await vi.waitFor(() => expect(mocks[stage]).toHaveBeenCalledOnce())
    const pendingBeforeStop = chipStructureWorkOwner.snapshot().pendingTasks
    const writesBeforeStop = [mocks.writeDaily.mock.calls.length, mocks.writePerf.mock.calls.length, mocks.writeChips.mock.calls.length]
    const requestSignal = mocks[stage].mock.calls[0].at(-1)
    stopChipStructureWork()
    const idleBeforeSettlement = await waitForChipStructureWorkIdle(0)
    finish([{ tsCode: '600000.SH', tradeDate: '20260710', open: 10, high: 11, low: 9, close: 10, price: 10, percent: 100 }])
    const result = await job
    expect(pendingBeforeStop).toBeGreaterThan(0)
    expect(idleBeforeSettlement).toBe(false)
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(requestSignal.aborted).toBe(true)
    expect(result.state).toBe('cancelled')
    expect(result.failed).toBe(0)
    expect(result.done).toBeLessThan(result.total)
    expect([mocks.writeDaily.mock.calls.length, mocks.writePerf.mock.calls.length, mocks.writeChips.mock.calls.length]).toEqual(writesBeforeStop)
    expect(mocks[stage]).toHaveBeenCalledOnce()
    expect(mocks.institution).not.toHaveBeenCalled()
    expect(events).not.toContain('chipStructure:done')
    expect(await waitForChipStructureWorkIdle(1000)).toBe(true)
  })
}

it('closes new structure-job admission before making provider requests', async () => {
  const { runChipStructureSync } = await import('../../electron/main/services/chipStructureSyncService')
  const { stopChipStructureWork } = await import('../../electron/main/services/chipStructureWorkOwner')
  stopChipStructureWork()
  expect(() => runChipStructureSync({} as never, 'isolated-not-a-key', {
    tsCodes: ['600000.SH'], scope: 'structure', force: true,
  })).toThrowError(expect.objectContaining({ code: 'LOCAL_WORK_CANCELLED' }))
  expect(mocks.daily).not.toHaveBeenCalled()
  expect(mocks.perf).not.toHaveBeenCalled()
  expect(mocks.chips).not.toHaveBeenCalled()
})
