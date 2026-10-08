import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchTradeCal: vi.fn(),
  hasTradeCalCoverage: vi.fn(),
  upsertTradeCal: vi.fn(),
  insertTradeCalIfMissing: vi.fn(),
}))

vi.mock('../../electron/main/services/tushareService', () => ({ fetchTradeCal: mocks.fetchTradeCal }))
vi.mock('../../electron/main/database/tradeCalRepository', () => ({
  hasTradeCalCoverage: mocks.hasTradeCalCoverage,
  upsertTradeCal: mocks.upsertTradeCal,
  insertTradeCalIfMissing: mocks.insertTradeCalIfMissing,
}))

import { isTradeCalSyncRunning, syncTradeCalFull } from '../../electron/main/services/tradeCalSyncService'

describe('tradeCalSyncService', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.insertTradeCalIfMissing.mockImplementation((_db, rows) => ({
      insertedRows: rows.length, conflictRows: 0, firstConflictDate: null,
    }))
  })

  it('并发请求等待同一个完整日历任务，不让后到调用方误判完成', async () => {
    let resolveRows: (rows: Array<{ calDate: string; isOpen: number; pretradeDate: string }>) => void = () => undefined
    mocks.fetchTradeCal.mockReturnValue(new Promise((resolve) => { resolveRows = resolve }))

    const first = syncTradeCalFull({} as never, 'token')
    const second = syncTradeCalFull({} as never, 'token')
    expect(second).toBe(first)
    expect(isTradeCalSyncRunning()).toBe(true)
    let finished = false
    void second.then(() => { finished = true })
    await Promise.resolve()
    expect(mocks.fetchTradeCal).toHaveBeenCalledOnce()
    expect(finished).toBe(false)

    resolveRows([{ calDate: '20260720', isOpen: 1, pretradeDate: '20260717' }])
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(mocks.upsertTradeCal).toHaveBeenCalledOnce()
    expect(firstResult).toEqual({
      status: 'completed', rowCount: 1, source: 'tushare',
      coverageStart: '20260720', coverageEnd: '20260720',
    })
    expect(secondResult).toEqual(firstResult)
    expect(mocks.insertTradeCalIfMissing).not.toHaveBeenCalled()
    expect(isTradeCalSyncRunning()).toBe(false)
  })

  it.each(['empty', 'network-failure'])('上游 %s 使用官方补缺兜底，不覆盖已有事实', async (scenario) => {
    if (scenario === 'empty') mocks.fetchTradeCal.mockResolvedValueOnce([])
    else mocks.fetchTradeCal.mockRejectedValueOnce(new Error('MOCK_NETWORK_FAILURE'))
    await expect(syncTradeCalFull({} as never, 'token')).resolves.toEqual({
      status: 'completed', rowCount: 1096, source: 'official-sse',
      insertedRows: 1096, conflictRows: 0, firstConflictDate: null,
      coverageStart: '20240101', coverageEnd: '20261231',
    })
    expect(mocks.insertTradeCalIfMissing).toHaveBeenCalledOnce()
    expect(mocks.upsertTradeCal).not.toHaveBeenCalled()
    expect(isTradeCalSyncRunning()).toBe(false)
  })

  it('持久化失败返回可判断终态并释放并发任务，后续请求可以重试', async () => {
    mocks.fetchTradeCal.mockRejectedValue(new Error('MOCK_NETWORK_FAILURE'))
    mocks.insertTradeCalIfMissing.mockImplementationOnce(() => { throw new Error('MOCK_STORAGE_FAILURE') })
    await expect(syncTradeCalFull({} as never, 'token')).resolves.toEqual({ status: 'failed', rowCount: 0 })
    expect(isTradeCalSyncRunning()).toBe(false)
    await expect(syncTradeCalFull({} as never, 'token')).resolves.toMatchObject({ status: 'completed', source: 'official-sse' })
    expect(mocks.fetchTradeCal).toHaveBeenCalledTimes(2)
    expect(mocks.upsertTradeCal).not.toHaveBeenCalled()
  })
})
