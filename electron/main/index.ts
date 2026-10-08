import { app, BrowserWindow, shell, net, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { initDb, getDb } from './database/db'
import { seedBuiltInSources } from './database/sourceRepository'
import { BUILT_IN_SOURCES } from './database/seeds'
import { registerBriefingHandlers } from './ipc/briefingHandlers'
import { registerSourceHandlers } from './ipc/sourceHandlers'
import { registerScanHandlers, sendScanEvent } from './ipc/scanHandlers'
import { registerSettingsHandlers } from './ipc/settingsHandlers'
import { registerArchiveHandlers } from './ipc/archiveHandlers'
import { registerDetailHandlers } from './ipc/detailHandlers'
import { registerAIHandlers } from './ipc/aiHandlers'
import { registerAiEvaluationHandlers } from './ipc/aiEvaluationHandlers'
import { registerSkillHandlers } from './ipc/skillHandlers'
import { registerBacktestHandlers } from './ipc/backtestHandlers'
import { registerMarketHeatmapHandlers } from './ipc/marketHeatmapHandlers'
import { registerShortTermHandlers } from './ipc/shortTermHandlers'
import { registerMarketOverviewHandlers } from './ipc/marketOverviewHandlers'
import { registerScreenerHandlers } from './ipc/screenerHandlers'
import { registerSectorFlowHandlers } from './ipc/sectorFlowHandlers'
import { registerTradeCalHandlers } from './ipc/tradeCalHandlers'
import { registerMacThsHandlers, createMacThsNativeConfirmation, macThsAccessibility } from './ipc/macThsHandlers'
import { MacThsOrderService } from './services/macThsOrderService'
import { createMacThsOrderDirectoryPreparation } from './services/macThsOrderDirectory'
import { registerAppUpdateHandlers } from './ipc/appUpdateHandlers'
import { registerSupportDiagnosticsHandlers } from './ipc/supportDiagnosticsHandlers'
import { registerTrendHandlers } from './ipc/trendHandlers'
import { registerDecisionHandlers } from './ipc/decisionHandlers'
import { registerPortfolioHandlers } from './ipc/portfolioHandlers'
import { registerSupplyChainHandlers } from './ipc/supplyChainHandlers'
import { registerIndustryResearchHandlers } from './ipc/industryResearchHandlers'
import { registerDiagnosticsHandlers } from './ipc/diagnosticsHandlers'
import { registerDataSafetyHandlers } from './ipc/dataSafetyHandlers'
import { registerBaseDataPackageHandlers } from './ipc/baseDataPackageHandlers'
import { registerConditionBlockHandlers } from './ipc/conditionBlockHandlers'
import { registerStrategyBacktestHandlers } from './ipc/strategyBacktestHandlers'
import { registerMinuteDataHandlers } from './ipc/minuteDataHandlers'
import { registerStrategyLabHandlers } from './ipc/strategyLabHandlers'
import { registerChipStructureHandlers } from './ipc/chipStructureHandlers'
import { registerStockFundamentalHandlers } from './ipc/stockFundamentalHandlers'
import { registerResearchEvidenceHandlers } from './ipc/researchEvidenceHandlers'
import { registerResearchAccessHandlers } from './ipc/researchAccessHandlers'
import { registerResearchAgentHandlers } from './ipc/researchAgentHandlers'
import { registerPremarketHandlers } from './ipc/premarketHandlers'
import {
  startResearchAccessTransport,
  stopResearchAccessTransport,
} from './services/researchAccessTransport'
import { initDefaultEdgesIfEmpty } from './database/supplyChainRepository'
import { getAIConfig } from './database/aiConfigRepository'
import { deleteSessionsOlderThan } from './database/aiAnalysisSessionRepository'
import { getDataSourceConfig } from './database/dataSourceRepository'
import { setEventHandlers, stopScan, isScanning } from './services/scanEngine'
import { decryptApiKey } from './utils/apiKeyEncryption'
import { isArticleExpired } from './utils/articleAgeUtils'
import { startScheduler, stopScheduler, waitForSchedulerIdle, runConceptMembersSyncJob } from './services/schedulerService'
import { syncTradeCalIfNeeded } from './services/tradeCalSyncService'
import { scheduleDailyCleanup, stopDailyCleanup } from './services/cleanerService'
import { registerTrustedIpcHandler, isTrustedIpcSender } from './security/trustedIpc'
import { recordSupportFailure } from './services/supportDiagnosticsService'
import { emitPriorityNewsSignalsForScan } from './services/newsDecisionSignalService'
import {
  startHeartbeat,
  stopHeartbeat,
  recordCloseTime,
  runCatchUpIfNeeded
} from './services/catchUpService'
import {
  applicationDataPathErrorMessage,
  configureApplicationDataPaths,
} from './services/applicationDataPathService'
import { showFatalErrorWindow } from './fatalErrorWindow'
import {
  isAllowedApplicationNavigation,
  normalizeExternalHttpUrl,
  shouldAllowRendererPermission,
} from './security/navigationPolicy'

let mainWindow: BrowserWindow | null = null
let databaseReady = false
let applicationStarted = false
let applicationStopping = false
let shutdownComplete = false
let shutdownTask: Promise<void> | null = null
let macThsOrderService: MacThsOrderService | null = null
let restartRequested = false
let bootstrapTask: Promise<void> | null = null
let networkMonitor: ReturnType<typeof setInterval> | null = null
const startupTasks = new Set<Promise<unknown>>()
const getTrustedWindow = () => applicationStopping ? null : mainWindow

function trackStartupTask<T>(task: Promise<T>): Promise<T> {
  startupTasks.add(task)
  void task.finally(() => startupTasks.delete(task)).catch(() => undefined)
  return task
}

async function waitForScanIdle(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (isScanning() && Date.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, 50))
  }
}

async function stopApplication(): Promise<void> {
  applicationStopping = true
  macThsOrderService?.beginStop()
  stopHeartbeat()
  stopScheduler()
  stopDailyCleanup()
  stopScan()
  if (networkMonitor) clearInterval(networkMonitor)
  networkMonitor = null
  if (applicationDataReady && databaseReady) recordCloseTime()

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  const drain = (async () => {
    await bootstrapTask?.catch(() => undefined)
    await Promise.allSettled([...startupTasks])
    await Promise.allSettled([
      waitForSchedulerIdle(5000),
      waitForScanIdle(5000),
      stopResearchAccessTransport(),
    ])
  })()
  try {
    await Promise.race([
      drain,
      new Promise<void>(resolve => {
        deadlineTimer = setTimeout(() => {
          console.warn('[Shutdown] Grace period expired; exiting with SQLite recovery enabled.')
          resolve()
        }, 8000)
      }),
    ])
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer)
    // The research-task grace period is not an order-executor exit proof.
  }
  await macThsOrderService?.shutdown()
  shutdownComplete = true
}

/**
 * FR-050/053: Check if AI analysis should be triggered after a scan.
 * Queries qualifying briefings, applies time filter, pushes scan:aiAnalysisAvailable.
 */
function triggerAIAnalysisIfAvailable(scanRunId: number | null, briefingScanRunId: number): void {
  if (!mainWindow || applicationStopping) return
  try {
    emitPriorityNewsSignalsForScan(getDb(), briefingScanRunId, mainWindow)
  } catch (err) {
    console.error('[DecisionSignal] Failed to emit priority news signals:', err)
  }

  try {
    const db = getDb()
    const aiConfig = getAIConfig(db)
    const hasKey = !!(aiConfig.provider && aiConfig.model && decryptApiKey(aiConfig.apiKeyEncrypted))
    if (!hasKey) return

    const ratingOrder = ['CRITICAL', 'IMPORTANT', 'GENERAL']
    const minIdx = ratingOrder.indexOf(aiConfig.triggerRating)
    const eligibleRatings = ratingOrder.slice(0, minIdx + 1)
    const placeholders = eligibleRatings.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT id, title, originalUrl, impactRating, impactRatingScore, publishedAt, summary
         FROM briefings
         WHERE scanRunId = ? AND impactRating IN (${placeholders})
         ORDER BY impactRatingScore DESC
         LIMIT ?`
      )
      .all(briefingScanRunId, ...eligibleRatings, aiConfig.maxArticlesPerBatch) as {
        id: number
        title: string
        originalUrl: string
        impactRating: string
        impactRatingScore: number
        publishedAt: number | null
        summary: string
      }[]

    if (rows.length === 0) return

    const articles = rows.map((r) => ({
      id: r.id,
      title: r.title,
      originalUrl: r.originalUrl,
      impactRating: r.impactRating,
      publishedAt: r.publishedAt,
      isExpired: isArticleExpired(r.publishedAt, r.summary ?? '', aiConfig.maxArticleAgeDays)
    }))

    // Only push event if at least one non-expired article exists
    const activeCount = articles.filter((a) => !a.isExpired).length
    if (activeCount === 0) return

    sendScanEvent(mainWindow, 'scan:aiAnalysisAvailable', { scanRunId, articles })
  } catch (err) {
    console.error('[AI] Failed to check analysis availability:', err)
  }
}

function createWindow(): void {
  const rendererFilePath = join(__dirname, '../renderer/index.html')
  const rendererEntryUrl = !app.isPackaged && process.env['ELECTRON_RENDERER_URL']
    ? process.env['ELECTRON_RENDERER_URL']
    : pathToFileURL(rendererFilePath).toString()

  mainWindow = new BrowserWindow({
    width: 1680,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    title: 'RT-ResearchFlow',
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    },
    backgroundColor: '#f9fafb',
    show: false
  })

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false)
  })
  mainWindow.on('will-resize', (event) => {
    event.preventDefault()
  })

  const createdWindow = mainWindow
  createdWindow.once('ready-to-show', () => {
    if (!createdWindow.isDestroyed()) createdWindow.show()
  })
  const callerId = createdWindow.webContents.id
  createdWindow.on('close', event => {
    macThsOrderService?.revokeCaller(callerId)
    if (!shutdownComplete && (applicationStopping || process.platform !== 'darwin')) {
      event.preventDefault()
      if (!applicationStopping) app.quit()
    }
  })
  createdWindow.webContents.on('render-process-gone', () => macThsOrderService?.revokeCaller(callerId))
  createdWindow.webContents.on('destroyed', () => macThsOrderService?.revokeCaller(callerId))
  createdWindow.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) macThsOrderService?.revokeCaller(callerId)
  })
  createdWindow.on('closed', () => {
    if (mainWindow === createdWindow) mainWindow = null
  })

  const windowSession = mainWindow.webContents.session
  windowSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(shouldAllowRendererPermission())
  })
  windowSession.setPermissionCheckHandler(() => shouldAllowRendererPermission())
  windowSession.setDevicePermissionHandler(() => shouldAllowRendererPermission())

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedApplicationNavigation(url, rendererEntryUrl)) event.preventDefault()
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedApplicationNavigation(url, rendererEntryUrl)) event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = normalizeExternalHttpUrl(url)
    if (externalUrl) {
      void shell.openExternal(externalUrl).catch((error) => {
        console.warn('[Security] Failed to open external URL:', error)
      })
    }
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(rendererEntryUrl)
  } else {
    void mainWindow.loadFile(rendererFilePath)
  }
}

async function bootstrap(): Promise<void> {
  if (applicationStopping) return
  // macOS needs native edit shortcuts, window management, and Command+Q.
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ])
    : null)

  registerTrustedIpcHandler('window:minimize', getTrustedWindow, () => {
    mainWindow?.minimize()
  })
  registerTrustedIpcHandler('window:toggleMaximize', getTrustedWindow, () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  registerTrustedIpcHandler('window:close', getTrustedWindow, () => {
    mainWindow?.close()
  })
  registerTrustedIpcHandler('window:isMaximized', getTrustedWindow, () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('system:openExternal', async (event, value: unknown) => {
    if (!isTrustedIpcSender(event, getTrustedWindow)) {
      return { ok: false as const, error: 'UNAUTHORIZED' as const }
    }
    const externalUrl = normalizeExternalHttpUrl(value)
    if (!externalUrl) return { ok: false as const, error: 'INVALID_URL' as const }
    try {
      await shell.openExternal(externalUrl)
      return { ok: true as const }
    } catch (error) {
      console.warn('[Security] Failed to open external URL:', error)
      return { ok: false as const, error: 'OPEN_FAILED' as const }
    }
  })
  registerTrustedIpcHandler('app:relaunch', getTrustedWindow, () => {
    restartRequested = true
    app.quit()
  })

  // A single order service owns the existing execution domain, separately from the research DB.
  // Native/ABI/storage failures become trading state instead of fatal research-app startup.
  macThsOrderService = new MacThsOrderService({ directory: app.getPath('userData'),
    prepareDirectory: directory => {
      try { prepareMacThsOrderDirectory(directory) }
      catch (error) {
        const code = (error as { code?: string })?.code
        console.warn('[MacTHS] Order directory unavailable:', code ?? 'ORDER_DIRECTORY_IO')
        throw error
      }
    },
    confirm: createMacThsNativeConfirmation(() => mainWindow), accessibility: macThsAccessibility })
  await macThsOrderService.start()
  if (applicationStopping) { macThsOrderService.beginStop(); return }

  // 1. Initialize database
  await initDb()
  databaseReady = true
  if (applicationStopping) return
  seedBuiltInSources(BUILT_IN_SOURCES)
  initDefaultEdgesIfEmpty(getDb())
  const researchAccessStatus = await startResearchAccessTransport(getDb(), app.getPath('userData'))
  if (applicationStopping) return
  if (researchAccessStatus.state !== 'ready') {
    console.warn(`[ResearchAccess] Local transport unavailable: ${researchAccessStatus.errorCode ?? 'unknown'}`)
  }

  // 2. Register all IPC handlers
  registerBriefingHandlers()
  registerSourceHandlers()
  registerScanHandlers()
  registerSettingsHandlers(getTrustedWindow)
  registerArchiveHandlers()
  registerDetailHandlers()
  registerAIHandlers(getTrustedWindow)
  registerAiEvaluationHandlers()
  registerSkillHandlers()
  registerBacktestHandlers()
  registerMarketHeatmapHandlers()
  registerShortTermHandlers()
  registerMarketOverviewHandlers()
  registerScreenerHandlers()
  registerSectorFlowHandlers()
  registerTradeCalHandlers()
  registerMacThsHandlers(() => mainWindow, macThsOrderService)
  registerAppUpdateHandlers(getTrustedWindow)
  registerSupportDiagnosticsHandlers(getTrustedWindow)
  registerTrendHandlers()
  registerDecisionHandlers()
  registerPortfolioHandlers(() => mainWindow)
  registerSupplyChainHandlers()
  registerIndustryResearchHandlers(() => mainWindow)
  registerDiagnosticsHandlers(getTrustedWindow)
  registerDataSafetyHandlers(getTrustedWindow)
  registerBaseDataPackageHandlers()
  registerConditionBlockHandlers()
  registerStrategyBacktestHandlers()
  registerMinuteDataHandlers()
  registerStrategyLabHandlers(() => mainWindow)
  registerChipStructureHandlers()
  registerStockFundamentalHandlers()
  registerResearchEvidenceHandlers()
  registerResearchAccessHandlers()
  registerResearchAgentHandlers(() => mainWindow)
  registerPremarketHandlers()

  // 3. Wire scan engine events to renderer push events
  setEventHandlers({
    onScanStarted: (runId) => {
      mainWindow && sendScanEvent(mainWindow, 'scan:started', { runId })
    },
    onScanCompleted: (runId, newCount) => {
      mainWindow && sendScanEvent(mainWindow, 'scan:completed', { runId, newCount })
      if (newCount > 0) triggerAIAnalysisIfAvailable(runId, runId)
    },
    onNewBriefings: (count) => {
      mainWindow && sendScanEvent(mainWindow, 'briefings:new', { count })
    },
    onSourceStatusChanged: (sourceId, status) => {
      mainWindow && sendScanEvent(mainWindow, 'source:statusChanged', { sourceId, status })
    },
    onSourceProgress: (sourceId, sourceName, url, status, newCount, error) => {
      mainWindow && sendScanEvent(mainWindow, 'scan:source-progress', { sourceId, sourceName, url, status, newCount, error })
    }
  })

  // 4. Create window
  createWindow()

  // 5. Start heartbeat
  startHeartbeat()

  // 6 & 7. Defer catch-up scan and scheduler until renderer signals ready (FR-001)
  // This prevents scan tasks from competing with startup rendering and slowing down UI display.
  // 使用 handle（非 handleOnce）以兼容开发模式下渲染进程热重载时的重复调用；
  // rendererReadyHandled 守卫确保副作用仅执行一次。
  let rendererReadyHandled = false
  registerTrustedIpcHandler('renderer:ready', getTrustedWindow, () => {
    if (rendererReadyHandled) return
    rendererReadyHandled = true
    return trackStartupTask((async () => {
    const catchupResult = await runCatchUpIfNeeded((msg) => {
      mainWindow && sendScanEvent(mainWindow, 'catchup:status', { message: msg })
    })
    if (catchupResult.ran && catchupResult.newCount > 0 && catchupResult.scanRunId) {
      triggerAIAnalysisIfAvailable(null, catchupResult.scanRunId)
    }

    if (applicationStopping) return
    startScheduler()

    // 9c. 首次启动检查：kpl_concept_members 表为空时立即触发全量同步
    // 解决新数据库/首次部署时题材数据永远为空（cron 只在每周一 04:00 执行）
    const conceptCount = (getDb().prepare('SELECT COUNT(*) as c FROM kpl_concept_members').get() as { c: number }).c
    if (conceptCount === 0) {
      console.log('[Startup] kpl_concept_members is empty, triggering initial sync...')
      void trackStartupTask(runConceptMembersSyncJob()).catch(() => {
        recordSupportFailure('INTERNAL_ERROR', 'data')
      })
    }

    // 9d. 启动时按需同步交易日历（FR-162）
    const dsCfg = getDataSourceConfig(getDb())
    if (dsCfg.tushareEnabled && dsCfg.tushareTokenEncrypted) {
      const token = decryptApiKey(dsCfg.tushareTokenEncrypted)
      if (token) {
        void trackStartupTask(syncTradeCalIfNeeded(getDb(), token)).catch((err) =>
          console.warn('[Startup] syncTradeCalIfNeeded failed:', err instanceof Error ? err.message : String(err))
        )
      }
    }
    })())
  })

  // 8. Schedule daily data cleanup
  scheduleDailyCleanup()

  // 9a. Auto-cleanup AI analysis sessions if configured
  const db = getDb()
  const aiConfig = getAIConfig(db)
  if (aiConfig.autoCleanupDays && aiConfig.autoCleanupDays > 0) {
    const olderThanMs = aiConfig.autoCleanupDays * 24 * 60 * 60 * 1000
    const { deleted } = deleteSessionsOlderThan(db, olderThanMs, false)
    if (deleted > 0) {
      console.log(`[AI] Auto-cleaned ${deleted} old analysis session(s)`)
    }
  }

  // 9. Network status monitoring
  let lastOnlineState = net.isOnline()
  networkMonitor = setInterval(() => {
    const online = net.isOnline()
    if (online !== lastOnlineState) {
      lastOnlineState = online
      mainWindow && sendScanEvent(mainWindow, 'network:statusChanged', { online })
    }
  }, 30_000)
  applicationStarted = true
}

// Capture Electron's app-specific default before configureApplicationDataPaths can change it.
// This is read-only capture; permission work runs inside the nonfatal order-service start gate.
const prepareMacThsOrderDirectory = createMacThsOrderDirectoryPreparation(app)
let applicationDataReady = true
let applicationDataFailure: string | null = null
try {
  const dataPath = configureApplicationDataPaths(app)
  console.log(`[AppData] mode=${dataPath.mode} root=${dataPath.dataRoot} migrated=${dataPath.migrated}`)
} catch (error) {
  applicationDataReady = false
  applicationDataFailure = applicationDataPathErrorMessage(error)
  console.error('[AppData] Initialization failed:', error)
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.tradewatch.app')
}

const ownsApplicationInstance = applicationDataReady ? app.requestSingleInstanceLock() : true
app.on('second-instance', () => {
  if (applicationStopping) return
  if (applicationStarted && (!mainWindow || mainWindow.isDestroyed())) createWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

if (!ownsApplicationInstance) {
  app.quit()
} else if (applicationDataReady) {
  bootstrapTask = app.whenReady().then(bootstrap)
  void bootstrapTask.catch((error) => {
    if (applicationStopping) return
    const incident = recordSupportFailure('DATABASE_UNAVAILABLE', 'runtime')
    const details = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error('[Startup] Bootstrap failed:', error)
    showFatalErrorWindow({
      title: '应用启动失败',
      message: '应用无法安全完成本地数据库或启动服务初始化。你的数据没有被自动覆盖，请根据下方信息检查后重新启动。',
      details: `问题编号：${incident.correlationId}\n\n${details}`,
    })
  })
} else {
  app.whenReady().then(() => {
    showFatalErrorWindow({
      title: '本地数据目录初始化失败',
      message: '应用无法安全准备本地数据目录，因此已停止继续启动，避免使用空数据或覆盖旧数据。',
      details: applicationDataFailure ?? '未提供错误详情。',
    })
  }).catch(console.error)
}

app.on('window-all-closed', () => {
  // macOS keeps the application and background services alive after window close.
  if (process.platform === 'darwin') return
  app.quit()
})

app.on('activate', () => {
  if (!applicationStopping && applicationStarted && (!mainWindow || mainWindow.isDestroyed())) {
    createWindow()
  }
})

app.on('before-quit', (event) => {
  if (shutdownComplete || !ownsApplicationInstance) return
  event.preventDefault()
  if (shutdownTask) return
  macThsOrderService?.beginStop()
  shutdownTask = stopApplication().then(() => {
    if (restartRequested) app.relaunch()
    app.quit()
  }).catch(() => {
    // Retain the order owner and visible failure state. Never treat timeout/kill as a clean exit.
    console.warn('[Shutdown] Order shutdown is unproven; process teardown was not authorized.')
    shutdownTask = null
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() }
  })
})
