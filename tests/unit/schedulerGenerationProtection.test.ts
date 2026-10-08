import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getPremarketNetworkEnabled: vi.fn(),
  getSettings: vi.fn(),
  getDb: vi.fn(),
  runScan: vi.fn(),
  syncIntradayForPredictedStocks: vi.fn(),
  runAllPendingBacktests: vi.fn(),
  fetchStockMinuteDaily: vi.fn(),
  fetchLimitListDaily: vi.fn(),
  fetchKplList: vi.fn(),
  fetchKplConceptCons: vi.fn(),
  fetchTopList: vi.fn(),
  fetchDailyByDate: vi.fn(),
  fetchDailyBasicByDate: vi.fn(),
  fetchIndexPrices: vi.fn(),
  fetchStockBasic: vi.fn(),
  fetchTradeCal: vi.fn(),
  fetchEastmoneyMinuteOHLCV: vi.fn(),
  getTushareAccessErrorCode: vi.fn(),
  upsertStockMinute: vi.fn(),
  cleanupStockMinuteCache: vi.fn(),
  upsertLimitList: vi.fn(),
  cleanupOlderThan: vi.fn(),
  upsertConceptDaily: vi.fn(),
  clearAllAndReplace: vi.fn(),
  upsertThsConceptIndex: vi.fn(),
  clearAllAndReplaceThsMembers: vi.fn(),
  upsertDcConceptMembers: vi.fn(),
  fetchThsIndex: vi.fn(),
  fetchThsMembers: vi.fn(),
  fetchDcConceptCons: vi.fn(),
  upsertTopList: vi.fn(),
  upsertDailyClose: vi.fn(),
  runDailyCloseMaintenance: vi.fn(),
  listStockInfos: vi.fn(),
  insertPricesIfMissing: vi.fn(),
  cleanupChipsCache: vi.fn(),
  cleanupCyqPerfCache: vi.fn(),
  cleanupTopInstDaily: vi.fn(),
  cleanupFactorCache: vi.fn(),
  clearAllAndInsert: vi.fn(),
  isStockBasicCacheStale: vi.fn(),
  replaceStockBasicIdentityProvenance: vi.fn(),
  cleanupScreenerResults: vi.fn(),
  getDataSourceConfig: vi.fn(),
  decryptApiKey: vi.fn(),
  BrowserWindow: { getAllWindows: vi.fn() },
  refreshRtKCache: vi.fn(),
  clearRtKCache: vi.fn(),
  getOrCreateMorningAuctionSnapshot: vi.fn(),
  refreshMorningAuctionSnapshot: vi.fn(),
  refreshClosingHalfHourSnapshot: vi.fn(),
  appendTimelinePoint: vi.fn(),
  clearTodayTimeline: vi.fn(),
  clearConceptHeatCache: vi.fn(),
  refreshTradingCalendar: vi.fn(),
  clearTradingCalendarCache: vi.fn(),
  runChipStructureSync: vi.fn(),
  cleanupMonitorResults: vi.fn(),
  archiveCurrentSnapshot: vi.fn(),
  archiveMarketResonanceSnapshot: vi.fn(),
  cleanupStkAuctionCache: vi.fn(),
  cleanupBacktestDetail: vi.fn(),
  cleanupBacktestRuns: vi.fn(),
  getLastNTradingDays: vi.fn(),
  isTradeDay: vi.fn(),
  seedOfficialTradeCalendar: vi.fn(),
  syncTradeCalIfNeeded: vi.fn(),
  cleanupTimelineOlderThan: vi.fn(),
  recomputeTrendScoresRealtime: vi.fn(),
  computeAndSaveTrendScoresEOD: vi.fn(),
  cleanupTrendData: vi.fn(),
  cleanupOldDecisionSignals: vi.fn(),
  expireOldDecisionSignals: vi.fn(),
  runPortfolioForecastJob: vi.fn(),
  HISTORICAL_DAILY_TARGET_TRADE_DAYS: vi.fn(),
  runHistoricalDailySync: vi.fn(),
  runPublicStockUniverseSync: vi.fn(),
  runStartupPublicHistoricalDailySyncIfNeeded: vi.fn(),
  runPublicDailySnapshotSync: vi.fn(),
  runStartupDailyCloseCatchUp: vi.fn(),
  beginAfterCloseSyncRun: vi.fn(),
  completeAfterCloseSyncRun: vi.fn(),
  getAfterCloseSyncRun: vi.fn(),
  getLatestAfterCloseSyncRun: vi.fn(),
  shouldStartAfterCloseSyncRun: vi.fn(),
  updateAfterCloseSyncTask: vi.fn(),
  buildPremarketCaptureStatus: vi.fn(),
  captureCurrentPremarketStage: vi.fn(),
  getNextPremarketCaptureRun: vi.fn(),
  isPremarketTradingDay: vi.fn(),
  reconcilePremarketCaptureForToday: vi.fn(),
  runPremarketCaptureStage: vi.fn(),
  reconcilePremarketScenariosForToday: vi.fn(),
  runPremarketScenarioStage: vi.fn(),
  runPremarketOutcomeValidation: vi.fn(),
  deliverPremarketScenarioNotification: vi.fn(),
}))
vi.mock('../../electron/main/services/../database/settingsRepository', () => ({
  getPremarketNetworkEnabled: m.getPremarketNetworkEnabled,
  getSettings: m.getSettings,
}))
vi.mock('../../electron/main/services/../database/db', () => ({
  getDb: m.getDb,
}))
vi.mock('../../electron/main/services/./scanEngine', () => ({
  runScan: m.runScan,
}))
vi.mock('../../electron/main/services/./backtestService', () => ({
  syncIntradayForPredictedStocks: m.syncIntradayForPredictedStocks,
  runAllPendingBacktests: m.runAllPendingBacktests,
}))
vi.mock('../../electron/main/services/./tushareService', () => ({
  fetchStockMinuteDaily: m.fetchStockMinuteDaily,
  fetchLimitListDaily: m.fetchLimitListDaily,
  fetchKplList: m.fetchKplList,
  fetchKplConceptCons: m.fetchKplConceptCons,
  fetchTopList: m.fetchTopList,
  fetchDailyByDate: m.fetchDailyByDate,
  fetchDailyBasicByDate: m.fetchDailyBasicByDate,
  fetchIndexPrices: m.fetchIndexPrices,
  fetchStockBasic: m.fetchStockBasic,
  fetchTradeCal: m.fetchTradeCal,
  fetchEastmoneyMinuteOHLCV: m.fetchEastmoneyMinuteOHLCV,
  getTushareAccessErrorCode: m.getTushareAccessErrorCode,
  fetchThsIndex: m.fetchThsIndex,
  fetchThsMembers: m.fetchThsMembers,
  fetchDcConceptCons: m.fetchDcConceptCons,
}))
vi.mock('../../electron/main/services/../database/stockMinuteCacheRepository', () => ({
  upsertStockMinute: m.upsertStockMinute,
  cleanupStockMinuteCache: m.cleanupStockMinuteCache,
}))
vi.mock('../../electron/main/services/../database/limitListDailyRepository', () => ({
  upsertLimitList: m.upsertLimitList,
  cleanupOlderThan: m.cleanupOlderThan,
}))
vi.mock('../../electron/main/services/../database/kplConceptDailyRepository', () => ({
  upsertConceptDaily: m.upsertConceptDaily,
  cleanupOlderThan: m.cleanupOlderThan,
}))
vi.mock('../../electron/main/services/../database/kplConceptMembersRepository', () => ({
  clearAllAndReplace: m.clearAllAndReplace,
}))
vi.mock('../../electron/main/services/../database/thsConceptMembersRepository', () => ({
  upsertThsConceptIndex: m.upsertThsConceptIndex,
  clearAllAndReplaceThsMembers: m.clearAllAndReplaceThsMembers,
}))
vi.mock('../../electron/main/services/../database/dcConceptMembersRepository', () => ({
  upsertDcConceptMembers: m.upsertDcConceptMembers,
}))

vi.mock('../../electron/main/services/../database/topListDailyRepository', () => ({
  upsertTopList: m.upsertTopList,
  cleanupOlderThan: m.cleanupOlderThan,
}))
vi.mock('../../electron/main/services/../database/shortTermSignalsRepository', () => ({
  cleanupOlderThan: m.cleanupOlderThan,
}))
vi.mock('../../electron/main/services/../database/dailyCloseCacheRepository', () => ({
  upsertDailyClose: m.upsertDailyClose,
}))
vi.mock('../../electron/main/services/./dailyCloseMaintenanceService', () => ({
  runDailyCloseMaintenance: m.runDailyCloseMaintenance,
}))
vi.mock('../../electron/main/services/../database/stockPriceCacheRepository', () => ({
  listStockInfos: m.listStockInfos,
  insertPricesIfMissing: m.insertPricesIfMissing,
}))
vi.mock('../../electron/main/services/../database/cyqChipsCacheRepository', () => ({
  cleanupChipsCache: m.cleanupChipsCache,
}))
vi.mock('../../electron/main/services/../database/cyqPerfCacheRepository', () => ({
  cleanupCyqPerfCache: m.cleanupCyqPerfCache,
}))
vi.mock('../../electron/main/services/../database/topInstDailyRepository', () => ({
  cleanupTopInstDaily: m.cleanupTopInstDaily,
}))
vi.mock('../../electron/main/services/../database/stkFactorCacheRepository', () => ({
  cleanupFactorCache: m.cleanupFactorCache,
}))
vi.mock('../../electron/main/services/../database/stockBasicCacheRepository', () => ({
  clearAllAndInsert: m.clearAllAndInsert,
  isStockBasicCacheStale: m.isStockBasicCacheStale,
}))
vi.mock('../../electron/main/services/../database/publicMarketDataRepository', () => ({
  replaceStockBasicIdentityProvenance: m.replaceStockBasicIdentityProvenance,
}))
vi.mock('../../electron/main/services/../database/stockScreenerResultsRepository', () => ({
  cleanupScreenerResults: m.cleanupScreenerResults,
}))
vi.mock('../../electron/main/services/../database/dataSourceRepository', () => ({
  getDataSourceConfig: m.getDataSourceConfig,
}))
vi.mock('../../electron/main/services/../utils/apiKeyEncryption', () => ({
  decryptApiKey: m.decryptApiKey,
}))
vi.mock('electron', () => ({
  BrowserWindow: m.BrowserWindow,
}))
vi.mock('../../electron/main/services/./sharedRtKCache', () => ({
  refreshRtKCache: m.refreshRtKCache,
  clearRtKCache: m.clearRtKCache,
}))
vi.mock('../../electron/main/services/./morningAuctionService', () => ({
  getOrCreateMorningAuctionSnapshot: m.getOrCreateMorningAuctionSnapshot,
  refreshMorningAuctionSnapshot: m.refreshMorningAuctionSnapshot,
}))
vi.mock('../../electron/main/services/./closingHalfHourService', () => ({
  refreshClosingHalfHourSnapshot: m.refreshClosingHalfHourSnapshot,
}))
vi.mock('../../electron/main/services/./marketOverviewService', () => ({
  appendTimelinePoint: m.appendTimelinePoint,
  clearTodayTimeline: m.clearTodayTimeline,
  clearConceptHeatCache: m.clearConceptHeatCache,
}))
vi.mock('../../electron/main/services/./tradingCalendarService', () => ({
  refreshTradingCalendar: m.refreshTradingCalendar,
  clearTradingCalendarCache: m.clearTradingCalendarCache,
}))
vi.mock('../../electron/main/services/./chipStructureSyncService', () => ({
  runChipStructureSync: m.runChipStructureSync,
}))
vi.mock('../../electron/main/services/../database/chipMonitorRepository', () => ({
  cleanupMonitorResults: m.cleanupMonitorResults,
}))
vi.mock('../../electron/main/services/./sectorFlowService', () => ({
  archiveCurrentSnapshot: m.archiveCurrentSnapshot,
}))
vi.mock('../../electron/main/services/./marketResonanceService', () => ({
  archiveMarketResonanceSnapshot: m.archiveMarketResonanceSnapshot,
}))
vi.mock('../../electron/main/services/../database/stkAuctionCacheRepository', () => ({
  cleanupStkAuctionCache: m.cleanupStkAuctionCache,
}))
vi.mock('../../electron/main/services/../database/backtestDetailRepository', () => ({
  cleanupBacktestDetail: m.cleanupBacktestDetail,
}))
vi.mock('../../electron/main/services/../database/strategyBacktestRepository', () => ({
  cleanupBacktestRuns: m.cleanupBacktestRuns,
}))
vi.mock('../../electron/main/services/../database/tradeCalRepository', () => ({
  getLastNTradingDays: m.getLastNTradingDays,
  isTradeDay: m.isTradeDay,
}))
vi.mock('../../electron/main/services/./tradeCalSyncService', () => ({
  seedOfficialTradeCalendar: m.seedOfficialTradeCalendar,
  syncTradeCalIfNeeded: m.syncTradeCalIfNeeded,
}))
vi.mock('../../electron/main/services/../database/marketTimelineRepository', () => ({
  cleanupTimelineOlderThan: m.cleanupTimelineOlderThan,
}))
vi.mock('../../electron/main/services/./trendWatchlistService', () => ({
  recomputeTrendScoresRealtime: m.recomputeTrendScoresRealtime,
  computeAndSaveTrendScoresEOD: m.computeAndSaveTrendScoresEOD,
  cleanupTrendData: m.cleanupTrendData,
}))
vi.mock('../../electron/main/services/./decisionSignalService', () => ({
  cleanupOldDecisionSignals: m.cleanupOldDecisionSignals,
  expireOldDecisionSignals: m.expireOldDecisionSignals,
}))
vi.mock('../../electron/main/services/./portfolioForecastService', () => ({
  runPortfolioForecastJob: m.runPortfolioForecastJob,
}))
vi.mock('../../electron/main/services/./historicalDailySyncService', () => ({
  HISTORICAL_DAILY_TARGET_TRADE_DAYS: m.HISTORICAL_DAILY_TARGET_TRADE_DAYS,
  runHistoricalDailySync: m.runHistoricalDailySync,
}))
vi.mock('../../electron/main/services/./publicStockUniverseService', () => ({
  runPublicStockUniverseSync: m.runPublicStockUniverseSync,
}))
vi.mock('../../electron/main/services/./publicHistoricalDailySyncService', () => ({
  runStartupPublicHistoricalDailySyncIfNeeded: m.runStartupPublicHistoricalDailySyncIfNeeded,
}))
vi.mock('../../electron/main/services/./publicDailySnapshotService', () => ({
  runPublicDailySnapshotSync: m.runPublicDailySnapshotSync,
}))
vi.mock('../../electron/main/services/./dailyCloseCatchUpService', () => ({
  runStartupDailyCloseCatchUp: m.runStartupDailyCloseCatchUp,
}))
vi.mock('../../electron/main/services/../database/afterCloseSyncRepository', () => ({
  beginAfterCloseSyncRun: m.beginAfterCloseSyncRun,
  completeAfterCloseSyncRun: m.completeAfterCloseSyncRun,
  getAfterCloseSyncRun: m.getAfterCloseSyncRun,
  getLatestAfterCloseSyncRun: m.getLatestAfterCloseSyncRun,
  shouldStartAfterCloseSyncRun: m.shouldStartAfterCloseSyncRun,
  updateAfterCloseSyncTask: m.updateAfterCloseSyncTask,
}))
vi.mock('../../electron/main/services/./premarketCaptureCoordinator', () => ({
  buildPremarketCaptureStatus: m.buildPremarketCaptureStatus,
  captureCurrentPremarketStage: m.captureCurrentPremarketStage,
  getNextPremarketCaptureRun: m.getNextPremarketCaptureRun,
  isPremarketTradingDay: m.isPremarketTradingDay,
  PREMARKET_CAPTURE_STAGES: ['overnight', 'asia_open'],
  reconcilePremarketCaptureForToday: m.reconcilePremarketCaptureForToday,
  runPremarketCaptureStage: m.runPremarketCaptureStage,
}))
vi.mock('../../electron/main/services/./premarketRehearsalService', () => ({
  reconcilePremarketScenariosForToday: m.reconcilePremarketScenariosForToday,
  runPremarketScenarioStage: m.runPremarketScenarioStage,
}))
vi.mock('../../electron/main/services/./premarketOutcomeService', () => ({
  runPremarketOutcomeValidation: m.runPremarketOutcomeValidation,
}))
vi.mock('../../electron/main/services/./premarketNotificationService', () => ({
  deliverPremarketScenarioNotification: m.deliverPremarketScenarioNotification,
}))
vi.mock('../../electron/main/services/industryResearchGenerationService', () => ({
  remapUnmatchedIndustryResearchCompanyCandidates: () => ({ remappedCandidates: 0, materializedProjectCompanies: 0, scannedCandidates: 0 }),
}))
vi.mock('../../electron/main/services/stockScreenerService', () => ({ runScreener: vi.fn() }))

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() { for (let i = 0; i < 40; i += 1) await Promise.resolve() }

let service: typeof import('../../electron/main/services/schedulerService')
beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.BrowserWindow.getAllWindows.mockReturnValue([])
  m.getDb.mockReturnValue({ prepare: () => ({ get: () => ({ c: 0 }) }) })
  m.getSettings.mockReturnValue({ scanIntervalMinutes: 60 })
  m.getPremarketNetworkEnabled.mockReturnValue(false)
  m.getDataSourceConfig.mockReturnValue({ tushareEnabled: false })
  m.isTradeDay.mockReturnValue(true)
  m.getLastNTradingDays.mockReturnValue(['20261007'])
  m.getAfterCloseSyncRun.mockReturnValue({ status: 'completed' })
  m.shouldStartAfterCloseSyncRun.mockReturnValue(false)
  m.isStockBasicCacheStale.mockReturnValue(false)
  m.runStartupPublicHistoricalDailySyncIfNeeded.mockResolvedValue(null)
  m.getNextPremarketCaptureRun.mockReturnValue(null)
  m.runPublicStockUniverseSync.mockResolvedValue({ totalRows: 2, preservedCircFloatRows: 0, insertedRows: 2 })
  m.runPublicDailySnapshotSync.mockResolvedValue({ dailyRows: [], writtenRows: 0 })
  m.archiveMarketResonanceSnapshot.mockResolvedValue({ dataMode: 'partial', coverage: { available: 0, total: 4 } })
  m.completeAfterCloseSyncRun.mockReturnValue({ status: 'partial' })
  m.refreshClosingHalfHourSnapshot.mockResolvedValue({ tradeDate: '20261008', candidateCount: 0, stocks: [] })
  service = await import('../../electron/main/services/schedulerService')
})
afterEach(async () => {
  service.stopScheduler()
  await flush()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function enableToken() {
  m.getDataSourceConfig.mockReturnValue({ tushareEnabled: true, tushareTokenEncrypted: 'encrypted-test' })
  m.decryptApiKey.mockReturnValue('test-token')
  m.runStartupDailyCloseCatchUp.mockResolvedValue({ totalTradeDays: 0, syncedTradeDays: 0, failedTradeDays: 0 })
}
async function start() { service.startScheduler(); await flush() }

describe('scheduler generation ownership with isolated services', () => {
  it('start and stop are idempotent; stopped reschedule cannot restart admission', async () => {
    await start()
    const count = vi.getTimerCount()
    const next = service.getNextScanAt()
    service.startScheduler()
    await flush()
    expect(vi.getTimerCount()).toBe(count)
    expect(service.getNextScanAt()).toBe(next)
    expect(m.seedOfficialTradeCalendar).toHaveBeenCalledTimes(1)
    service.stopScheduler()
    service.stopScheduler()
    service.reschedule()
    service.subscribeStockMinute('600000')
    await service.reconfigurePremarketCaptures()
    expect(vi.getTimerCount()).toBe(0)
    expect(service.getNextScanAt()).toBeNull()
  })

  it('pending scan cannot revive after stop; idle remains false until its promise settles', async () => {
    const scan = deferred()
    m.runScan.mockReturnValue(scan.promise)
    await start()
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(m.runScan).toHaveBeenCalledTimes(1)
    service.stopScheduler()
    expect(await service.waitForSchedulerIdle(0)).toBe(false)
    const idle = service.waitForSchedulerIdle(1000)
    scan.resolve()
    expect(await idle).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reschedule creates one scan chain while the old scan finishes', async () => {
    const first = deferred()
    m.runScan.mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
    await start()
    await vi.advanceTimersByTimeAsync(3_600_000)
    m.getSettings.mockReturnValue({ scanIntervalMinutes: 2 })
    service.reschedule()
    service.reschedule()
    const target = service.getNextScanAt()
    first.resolve()
    await flush()
    expect(service.getNextScanAt()).toBe(target)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(m.runScan).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(m.runScan).toHaveBeenCalledTimes(3)
  })

  it('old scan rejection after restart cannot register into the new generation', async () => {
    const oldScan = deferred()
    m.runScan.mockReturnValueOnce(oldScan.promise).mockResolvedValue(undefined)
    await start()
    await vi.advanceTimersByTimeAsync(3_600_000)
    service.stopScheduler()
    await start()
    const count = vi.getTimerCount()
    const target = service.getNextScanAt()
    oldScan.reject(new Error('isolated scan failure'))
    await flush()
    expect(vi.getTimerCount()).toBe(count)
    expect(service.getNextScanAt()).toBe(target)
  })

  it('backtest cron stopped during intraday sync does not run the DB backtest or rearm', async () => {
    vi.setSystemTime(new Date('2026-10-08T07:04:59Z'))
    const sync = deferred<number>()
    m.syncIntradayForPredictedStocks.mockReturnValue(sync.promise)
    await start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.syncIntradayForPredictedStocks).toHaveBeenCalledTimes(1)
    service.stopScheduler()
    sync.resolve(2)
    await flush()
    expect(m.runAllPendingBacktests).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('capture finally cannot revive a stopped stage', async () => {
    const capture = deferred()
    m.getPremarketNetworkEnabled.mockReturnValue(true)
    m.isPremarketTradingDay.mockReturnValue(true)
    m.getNextPremarketCaptureRun.mockImplementation((_db, stage) => stage === 'overnight'
      ? { scheduledAt: Date.now() + 100, tradeDate: '20261008' } : null)
    m.runPremarketCaptureStage.mockReturnValue(capture.promise)
    await start()
    await vi.advanceTimersByTimeAsync(100)
    expect(m.runPremarketCaptureStage).toHaveBeenCalledTimes(1)
    service.stopScheduler()
    capture.resolve()
    await flush()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('capture reconfiguration invalidates an in-flight stage without duplicate chains', async () => {
    const capture = deferred()
    m.getPremarketNetworkEnabled.mockReturnValue(true)
    m.isPremarketTradingDay.mockReturnValue(true)
    m.getNextPremarketCaptureRun.mockImplementation((_db, stage) => stage === 'overnight'
      ? { scheduledAt: Date.now() + 100, tradeDate: '20261008' } : null)
    m.runPremarketCaptureStage.mockReturnValueOnce(capture.promise).mockResolvedValue(undefined)
    await start()
    await vi.advanceTimersByTimeAsync(100)
    await service.reconfigurePremarketCaptures()
    const count = vi.getTimerCount()
    capture.resolve()
    await flush()
    expect(vi.getTimerCount()).toBe(count)
    await vi.advanceTimersByTimeAsync(100)
    expect(m.runPremarketCaptureStage).toHaveBeenCalledTimes(2)
  })

  it('scenario finally cannot revive after stop even with network disabled', async () => {
    const scenario = deferred()
    m.getNextPremarketCaptureRun.mockImplementation((_db, stage) => stage === 'asia_open'
      ? { scheduledAt: Date.now() + 100, tradeDate: '20261008' } : null)
    m.runPremarketScenarioStage.mockReturnValue(scenario.promise)
    await start()
    await vi.advanceTimersByTimeAsync(100)
    expect(m.runPremarketScenarioStage).toHaveBeenCalledTimes(1)
    service.stopScheduler()
    scenario.resolve()
    await flush()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reconfiguration wait is tracked and does not start the next reconciliation after stop', async () => {
    const reconcile = deferred()
    m.getPremarketNetworkEnabled.mockReturnValue(true)
    m.reconcilePremarketCaptureForToday.mockReturnValue(reconcile.promise)
    await start()
    service.stopScheduler()
    expect(await service.waitForSchedulerIdle(0)).toBe(false)
    reconcile.resolve()
    await flush()
    expect(m.reconcilePremarketScenariosForToday).not.toHaveBeenCalled()
    expect(await service.waitForSchedulerIdle(0)).toBe(true)
  })

  it('no-Key startup history completion cannot rearm resume polling after stop', async () => {
    const history = deferred<null>()
    m.runStartupPublicHistoricalDailySyncIfNeeded.mockReturnValue(history.promise)
    await start()
    service.stopScheduler()
    expect(await service.waitForSchedulerIdle(0)).toBe(false)
    history.resolve(null)
    await flush()
    expect(vi.getTimerCount()).toBe(0)
    expect(m.seedOfficialTradeCalendar).toHaveBeenCalledTimes(1)
    expect(m.syncTradeCalIfNeeded).toHaveBeenCalledWith(expect.anything(), null)
  })

  it('token startup catchup stopped during its await does not start follow-up jobs', async () => {
    enableToken()
    const catchup = deferred()
    m.runStartupDailyCloseCatchUp.mockReturnValue(catchup.promise)
    await start()
    service.stopScheduler()
    catchup.resolve()
    await flush()
    expect(m.runStartupPublicHistoricalDailySyncIfNeeded).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('checkpoint interval is awaited and does not overlap while its task is pending', async () => {
    const history = deferred<null>()
    m.runStartupPublicHistoricalDailySyncIfNeeded.mockResolvedValueOnce(null).mockReturnValue(history.promise)
    await start()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(m.runStartupPublicHistoricalDailySyncIfNeeded).toHaveBeenCalledTimes(2)
    service.stopScheduler()
    expect(await service.waitForSchedulerIdle(0)).toBe(false)
    history.resolve(null)
    await flush()
    expect(await service.waitForSchedulerIdle(0)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('old minute result cannot write data, notify or unsubscribe the new stock', async () => {
    enableToken()
    const oldPull = deferred<unknown[]>()
    m.fetchStockMinuteDaily.mockReturnValueOnce(oldPull.promise).mockResolvedValue([])
    m.fetchEastmoneyMinuteOHLCV.mockResolvedValue([])
    await start()
    service.subscribeStockMinute('600000')
    await flush()
    service.subscribeStockMinute('000001')
    await flush()
    service.subscribeStockMinute('000001')
    const count = vi.getTimerCount()
    oldPull.resolve([{ stockCode: '600000' }])
    await flush()
    expect(m.upsertStockMinute).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(count)
    expect(m.fetchStockMinuteDaily).toHaveBeenCalledTimes(2)
  })

  it('minute task stopped before Tushare resolves does not attempt fallback and is awaited', async () => {
    enableToken()
    const pull = deferred<unknown[]>()
    m.fetchStockMinuteDaily.mockReturnValue(pull.promise)
    await start()
    service.subscribeStockMinute('600000')
    await flush()
    const idle = service.stopSchedulerAndWait(1000)
    pull.resolve([])
    expect(await idle).toBe(true)
    expect(m.fetchEastmoneyMinuteOHLCV).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('minute no-Key fallback result after unsubscribe cannot write or notify', async () => {
    const pull = deferred<unknown[]>()
    m.fetchEastmoneyMinuteOHLCV.mockReturnValue(pull.promise)
    await start()
    service.subscribeStockMinute('600000')
    await flush()
    service.unsubscribeStockMinute()
    pull.resolve([{ tradeDate: '20261008', close: 3 }])
    await flush()
    expect(m.upsertStockMinute).not.toHaveBeenCalled()
  })

  it('real-time interval result after stop cannot append timeline or recompute trends', async () => {
    vi.setSystemTime(new Date('2026-10-08T02:00:00Z'))
    enableToken()
    const refresh = deferred()
    m.refreshRtKCache.mockReturnValue(refresh.promise)
    await start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(m.refreshRtKCache).toHaveBeenCalledTimes(1)
    service.stopScheduler()
    refresh.resolve()
    await flush()
    expect(m.appendTimelinePoint).not.toHaveBeenCalled()
    expect(m.recomputeTrendScoresRealtime).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('daily cache-reset timer is owned and is removed on stop', async () => {
    vi.setSystemTime(new Date('2026-10-08T19:59:59Z'))
    await start()
    service.stopScheduler()
    await vi.advanceTimersByTimeAsync(2000)
    expect(m.clearRtKCache).not.toHaveBeenCalled()
    expect(m.clearTodayTimeline).not.toHaveBeenCalled()
  })

  it.each([
    ['morning warmup', '2026-10-08T01:14:59Z', 'getOrCreateMorningAuctionSnapshot'],
    ['morning confirmation', '2026-10-08T01:27:59Z', 'refreshMorningAuctionSnapshot'],
    ['portfolio forecast', '2026-10-08T05:14:59Z', 'runPortfolioForecastJob'],
    ['monthly calendar', '2026-09-29T16:00:00Z', 'syncTradeCalIfNeeded'],
    ['weekly concept members', '2026-10-11T19:59:59Z', 'fetchKplConceptCons'],
    ['closing half hour', '2026-10-08T07:00:59Z', 'refreshClosingHalfHourSnapshot'],
  ] as const)('%s callback cannot rearm after stop', async (_name, now, method) => {
    vi.setSystemTime(new Date(now))
    const job = deferred<unknown>()
    if (method === 'fetchKplConceptCons') enableToken()
    if (method === 'syncTradeCalIfNeeded') {
      // The initial calendar refresh completes; only the next daily check is held.
      m[method].mockResolvedValueOnce(undefined).mockReturnValue(job.promise)
    } else {
      m[method].mockReturnValue(job.promise)
    }
    await start()
    await vi.advanceTimersByTimeAsync(method === 'syncTradeCalIfNeeded' ? 86_400_000 : 1000)
    expect(m[method]).toHaveBeenCalled()
    service.stopScheduler()
    expect(await service.waitForSchedulerIdle(0)).toBe(false)
    job.resolve(method === 'fetchKplConceptCons' ? [] : method === 'refreshClosingHalfHourSnapshot'
      ? { tradeDate: '20261008', candidateCount: 0, stocks: [] } : undefined)
    await flush()
    expect(vi.getTimerCount()).toBe(0)
    if (method === 'refreshMorningAuctionSnapshot') expect(m.runPremarketScenarioStage).not.toHaveBeenCalled()
  })

  it('after-close coordinator remains tracked through nested tasks but cannot rearm after stop', async () => {
    vi.setSystemTime(new Date('2026-10-08T09:59:59Z'))
    const master = deferred<unknown>()
    m.shouldStartAfterCloseSyncRun.mockReturnValue(true)
    m.runPublicStockUniverseSync.mockResolvedValueOnce({ totalRows: 0, preservedCircFloatRows: 0, insertedRows: 0 })
      .mockReturnValue(master.promise)
    await start()
    await vi.advanceTimersByTimeAsync(1000)
    service.stopScheduler()
    expect(await service.waitForSchedulerIdle(0)).toBe(false)
    master.resolve({ totalRows: 2, preservedCircFloatRows: 0, insertedRows: 2 })
    await flush()
    expect(vi.getTimerCount()).toBe(0)
    expect(await service.waitForSchedulerIdle(0)).toBe(true)
  })

  it('idle timeout reports pending work without pretending to cancel it', async () => {
    const scan = deferred()
    m.runScan.mockReturnValue(scan.promise)
    await start()
    await vi.advanceTimersByTimeAsync(3_600_000)
    service.stopScheduler()
    const idle = service.waitForSchedulerIdle(25)
    await vi.advanceTimersByTimeAsync(25)
    expect(await idle).toBe(false)
    scan.resolve()
    await flush()
    expect(await service.waitForSchedulerIdle(0)).toBe(true)
  })
})
