import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

const mocks = vi.hoisted(() => {
  const touch = vi.fn()
  const functions = new Map<string, ReturnType<typeof vi.fn>>()
  const database = {
    transaction: vi.fn((work: () => unknown) => {
      touch('db.transaction')
      return () => work()
    }),
  }
  const health = { status: 'offline-health' }
  const actionResult = { status: 'offline-action' }
  const safety = { status: 'offline-safety' }
  const backup = { path: 'offline-backup' }
  const exported = { path: 'offline-export' }
  const settings = { scanIntervalMinutes: 30 }
  const correlationId = '12345678-1234-4123-8123-123456789abc'
  const recordSupportFailure = vi.fn((code: string, module: string) => {
    touch('support', 'recordSupportFailure', code, module)
    return { code, message: 'offline public failure', action: 'offline action', retryable: false, correlationId }
  })
  const makeModule = (name: string) => {
    const values: Record<PropertyKey, unknown> = {}
    return new Proxy(values, {
      has: () => true,
      get: (target, key) => {
        if (key === 'then') return undefined
        if (key === '__esModule') return true
        if (key === Symbol.toStringTag) return 'Module'
        if (key in target) return target[key]
        const known = functions.get(name + ':' + String(key))
        if (known) return known
        const fn = vi.fn((...args: unknown[]) => {
          touch(name, String(key), ...args)
          if (name === 'db' && key === 'getDb') return database
          if (name === 'settings' && (key === 'getSettings' || key === 'updateSettings')) return settings
          if (name === 'diagnostics' && key === 'getDiagnosticsHealth') return health
          if (name === 'diagnostics' && key === 'runDiagnosticAction') return Promise.resolve(actionResult)
          if (name === 'safety' && key === 'getDataSafetyStatus') return safety
          if (name === 'safety' && key === 'createDatabaseBackup') return Promise.resolve(backup)
          if (name === 'safety' && key === 'openBackupDirectory') return Promise.resolve('offline-directory')
          if (name === 'safety' && key === 'exportData') return exported
          return undefined
        })
        target[key] = fn
        functions.set(name + ':' + String(key), fn)
        return fn
      },
    })
  }
  const fromWebContents = vi.fn(() => {
    touch('electron', 'fromWebContents')
    return { fixture: 'diagnostic-window' }
  })
  const showOpenDialog = vi.fn(() => {
    touch('electron', 'showOpenDialog')
    return Promise.resolve({ canceled: false, filePaths: ['offline-python'] })
  })
  const openExternal = vi.fn(() => {
    touch('electron', 'openExternal')
    return Promise.resolve()
  })
  return {
    touch, functions, database, health, actionResult, safety, backup, exported, settings,
    correlationId, recordSupportFailure, showOpenDialog, openExternal,
    makeModule, fromWebContents, handle: vi.fn(),
    handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
  }
})
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  shell: { openExternal: mocks.openExternal },
}))
vi.mock('../../electron/main/database/db', () => mocks.makeModule('db'))
vi.mock('../../electron/main/database/settingsRepository', () => mocks.makeModule('settings'))
vi.mock('../../electron/main/database/aiConfigRepository', () => mocks.makeModule('aiConfig'))
vi.mock('../../electron/main/services/schedulerService', () => mocks.makeModule('scheduler'))
vi.mock('../../electron/main/services/diagnosticsService', () => mocks.makeModule('diagnostics'))
vi.mock('../../electron/main/services/dataSafetyService', () => mocks.makeModule('safety'))
vi.mock('../../electron/main/services/supportDiagnosticsService', () => ({ recordSupportFailure: mocks.recordSupportFailure }))
vi.mock('../../electron/main/database/aiAnalysisSessionRepository', () => mocks.makeModule('database/aiAnalysisSessionRepository'))
vi.mock('../../electron/main/database/dataSourceRepository', () => mocks.makeModule('database/dataSourceRepository'))
vi.mock('../../electron/main/services/multiSourceResearchService', () => mocks.makeModule('services/multiSourceResearchService'))
vi.mock('../../electron/main/services/pythonDataSourceBridge', () => mocks.makeModule('services/pythonDataSourceBridge'))
vi.mock('../../electron/main/services/multiSourceMarketService', () => mocks.makeModule('services/multiSourceMarketService'))
vi.mock('../../electron/main/utils/apiKeyEncryption', () => mocks.makeModule('utils/apiKeyEncryption'))
vi.mock('../../electron/main/services/aiProvider', () => mocks.makeModule('services/aiProvider'))
vi.mock('../../electron/main/aiPromptDefaults', () => mocks.makeModule('aiPromptDefaults'))
vi.mock('../../electron/main/services/aiFallbackService', () => mocks.makeModule('services/aiFallbackService'))
vi.mock('../../electron/main/services/aiCandidateRecoveryService', () => mocks.makeModule('services/aiCandidateRecoveryService'))
vi.mock('../../electron/main/services/aiSkillsPromptService', () => mocks.makeModule('services/aiSkillsPromptService'))
vi.mock('../../electron/main/services/tushareService', () => mocks.makeModule('services/tushareService'))
vi.mock('../../electron/main/services/trendBenchmarkFreshness', () => mocks.makeModule('services/trendBenchmarkFreshness'))
vi.mock('../../electron/main/database/stockPriceCacheRepository', () => mocks.makeModule('database/stockPriceCacheRepository'))
vi.mock('../../electron/main/database/trendForecastRepository', () => mocks.makeModule('database/trendForecastRepository'))
vi.mock('../../electron/main/database/detailCacheRepository', () => mocks.makeModule('database/detailCacheRepository'))
vi.mock('../../electron/main/utils/hashUtils', () => mocks.makeModule('utils/hashUtils'))
vi.mock('../../electron/main/ipc/detailHandlers', () => mocks.makeModule('ipc/detailHandlers'))
vi.mock('../../electron/main/services/detailContentExtraction', () => mocks.makeModule('services/detailContentExtraction'))
vi.mock('../../electron/main/database/stockMinuteCacheRepository', () => mocks.makeModule('database/stockMinuteCacheRepository'))
vi.mock('../../electron/main/database/stockBasicCacheRepository', () => mocks.makeModule('database/stockBasicCacheRepository'))
vi.mock('../../electron/main/database/stkFactorCacheRepository', () => mocks.makeModule('database/stkFactorCacheRepository'))
vi.mock('../../electron/main/database/limitListDailyRepository', () => mocks.makeModule('database/limitListDailyRepository'))
vi.mock('../../electron/main/services/conceptRouter', () => mocks.makeModule('services/conceptRouter'))
vi.mock('../../electron/main/database/kplConceptDailyRepository', () => mocks.makeModule('database/kplConceptDailyRepository'))
vi.mock('../../electron/main/services/decisionSignalService', () => mocks.makeModule('services/decisionSignalService'))
vi.mock('../../electron/main/database/sectorFlowObservationRepository', () => mocks.makeModule('database/sectorFlowObservationRepository'))
vi.mock('../../electron/main/database/dailyCloseCacheRepository', () => mocks.makeModule('database/dailyCloseCacheRepository'))
vi.mock('../../electron/main/database/aiAnalysisStructuredResultRepository', () => mocks.makeModule('database/aiAnalysisStructuredResultRepository'))
vi.mock('../../electron/main/services/aiStructuredResultService', () => mocks.makeModule('services/aiStructuredResultService'))
vi.mock('../../electron/main/utils/smcAnalysisNode', () => mocks.makeModule('utils/smcAnalysisNode'))
vi.mock('../../electron/main/services/aiRound2MarketContextService', () => mocks.makeModule('services/aiRound2MarketContextService'))
vi.mock('../../electron/main/services/researchFactPromptService', () => mocks.makeModule('services/researchFactPromptService'))
vi.mock('../../electron/main/services/researchDiscussionContextService', () => mocks.makeModule('services/researchDiscussionContextService'))
vi.mock('../../electron/main/services/researchEvidenceAuditService', () => mocks.makeModule('services/researchEvidenceAuditService'))
vi.mock('../../electron/main/database/researchDiscussionRepository', () => mocks.makeModule('database/researchDiscussionRepository'))
vi.mock('../../electron/main/services/researchAgentRunManager', () => mocks.makeModule('services/researchAgentRunManager'))

import { registerSettingsHandlers } from '../../electron/main/ipc/settingsHandlers'
import { registerAIHandlers } from '../../electron/main/ipc/aiHandlers'
import { registerDiagnosticsHandlers } from '../../electron/main/ipc/diagnosticsHandlers'
import { registerDataSafetyHandlers } from '../../electron/main/ipc/dataSafetyHandlers'

const channels = [
  'datasource:choosePython',
  'datasource:bridgeStatus',
  'datasource:installExtensions',
  'datasource:reports',
  'datasource:wencai',
  'datasource:probe',
  'datasource:openSourceLink',
  "settings:get",
  "settings:update",
  "settings:getDecisionCenterFilters",
  "settings:setDecisionCenterFilters",
  "settings:getTheme",
  "settings:setTheme",
  "settings:getMarketHeatmapProvider",
  "settings:setMarketHeatmapProvider",
  "diagnostics:getHealth",
  "diagnostics:runCheck",
  "dataSafety:getStatus",
  "dataSafety:createBackup",
  "dataSafety:openBackupDirectory",
  "dataSafety:exportData",
  "ai:getConfig",
  "ai:saveConfig",
  "ai:analyze",
  "ai:listSessions",
  "ai:getSession",
  "ai:startResearchDiscussion",
  "ai:updateResearchDiscussionContext",
  "ai:listResearchDiscussions",
  "ai:generateStructuredResult",
  "ai:deleteAllSessions",
  "ai:cleanupOldSessions",
  "ai:deleteSession",
  "ai:recoverCandidates",
  "ai:triggerRound2",
  "ai:followUp",
  "datasource:getConfig",
  "datasource:saveConfig",
  "datasource:validateTushare",
  "datasource:listStocks",
  "datasource:getStockPrices",
  "datasource:getStockPricePage",
  "datasource:deleteStock",
  "datasource:clearAllStocks",
  "datasource:refreshStock",
  "datasource:fetchStock",
  "datasource:updateStockName",
  "datasource:searchStock",
  "datasource:getIntradayData",
  "datasource:getStockMinuteKline",
  "datasource:subscribeStockMinute",
  "datasource:unsubscribeStockMinute",
  "ai:predictTrendToday",
  "ai:predictTrendMorrow",
  "ai:clearForecast",
  "ai:getPredictionCache",
  "ai:listForecasts",
  "ai:getForecast",
  "ai:reviseTrendForecast",
  "ai:deleteForecast",
  "ai:deleteAllForecasts"
]
const rejectionCases = [
  'missing window', 'destroyed window', 'other sender', 'destroyed sender',
  'child frame', 'missing frame', 'missing main frame', 'null event',
  'window getter throws', 'window destruction throws', 'contents getter throws',
  'sender getter throws', 'sender destruction throws', 'frame getter throws',
  'main frame getter throws',
]

function fixture() {
  const frame = {}
  const contents = { isDestroyed: vi.fn(() => false), mainFrame: frame }
  const window = { isDestroyed: vi.fn(() => false), webContents: contents }
  return { window, contents, frame, event: { sender: contents, senderFrame: frame } }
}
type Fixture = ReturnType<typeof fixture>
let currentWindow: BrowserWindow | null
let current: Fixture
let getWindow: () => BrowserWindow | null

function invoke(channel: string, event: unknown, payload?: unknown): unknown {
  return mocks.handlers.get(channel)!(event as IpcMainInvokeEvent, payload)
}
function fail() { throw new Error('private fixture native failure') }

function dependency(name: string, key: string): ReturnType<typeof vi.fn> {
  return mocks.functions.get(name + ':' + key) ?? mocks.makeModule(name)[key] as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  current = fixture()
  currentWindow = current.window as unknown as BrowserWindow
  getWindow = () => currentWindow
  mocks.handle.mockImplementation((channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    mocks.handlers.set(channel, handler)
  })
  const dynamicGetter = () => getWindow()
  registerSettingsHandlers(dynamicGetter)
  registerAIHandlers(dynamicGetter)
  registerDiagnosticsHandlers(dynamicGetter)
  registerDataSafetyHandlers(dynamicGetter)
  // Clear registration observations before exercising real guarded callbacks.
  vi.clearAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('the four handler modules reject before business execution', () => {
  it('registers every direct channel expected in the scoped modules', () => {
    expect([...mocks.handlers.keys()].sort()).toEqual([...channels].sort())
  })

  it.each(channels.flatMap(channel => rejectionCases.map(kind => [channel, kind])))(
    '%s rejects %s without a database, service or export call',
    (channel, kind) => {
      let event: unknown = current.event
      switch (kind) {
        case 'missing window': currentWindow = null; break
        case 'destroyed window': current.window.isDestroyed.mockReturnValue(true); break
        case 'other sender': event = fixture().event; break
        case 'destroyed sender': current.contents.isDestroyed.mockReturnValue(true); break
        case 'child frame': event = { ...current.event, senderFrame: {} }; break
        case 'missing frame': event = { ...current.event, senderFrame: null }; break
        case 'missing main frame': Object.defineProperty(current.contents, 'mainFrame', { value: null }); break
        case 'null event': event = null; break
        case 'window getter throws': getWindow = fail; break
        case 'window destruction throws': current.window.isDestroyed.mockImplementation(fail); break
        case 'contents getter throws': Object.defineProperty(current.window, 'webContents', { get: fail }); break
        case 'sender getter throws': Object.defineProperty(current.event, 'sender', { get: fail }); break
        case 'sender destruction throws': current.contents.isDestroyed.mockImplementation(fail); break
        case 'frame getter throws': Object.defineProperty(current.event, 'senderFrame', { get: fail }); break
        case 'main frame getter throws': Object.defineProperty(current.contents, 'mainFrame', { get: fail }); break
      }
      expect(() => invoke(channel, event)).toThrow('UNTRUSTED_IPC_SENDER')
      expect(mocks.touch).not.toHaveBeenCalled()
      for (const fn of mocks.functions.values()) expect(fn).not.toHaveBeenCalled()
      expect(mocks.database.transaction).not.toHaveBeenCalled()
      expect(mocks.fromWebContents).not.toHaveBeenCalled()
      expect(mocks.showOpenDialog).not.toHaveBeenCalled()
      expect(mocks.openExternal).not.toHaveBeenCalled()
      expect(mocks.recordSupportFailure).not.toHaveBeenCalled()
    },
  )
})

describe('diagnostic failure records are correlated and contain no raw details', () => {
  it.each([
  [
    "TUSHARE_DISABLED",
    "TUSHARE_DISABLED",
    "CONFIG_MISSING"
  ],
  [
    "TUSHARE_QUOTA_INSUFFICIENT",
    "TUSHARE_QUOTA_INSUFFICIENT",
    "PROVIDER_PERMISSION_DENIED"
  ],
  [
    "TUSHARE_AUTH_FAILED",
    "TUSHARE_AUTH_FAILED",
    "PROVIDER_PERMISSION_DENIED"
  ],
  [
    "TUSHARE_REQUEST_TIMEOUT",
    "TUSHARE_REQUEST_TIMEOUT",
    "NETWORK_FAILED"
  ],
  [
    "TUSHARE_RATE_LIMITED",
    "TUSHARE_RATE_LIMITED",
    "INTERNAL_ERROR"
  ],
  [
    "HISTORICAL_DAILY_UPSTREAM_UNAVAILABLE",
    "HISTORICAL_DAILY_UPSTREAM_UNAVAILABLE",
    "DATA_MISSING"
  ],
  [
    "TRADE_CAL_HISTORY_INCOMPLETE",
    "TRADE_CAL_HISTORY_INCOMPLETE",
    "DATA_MISSING"
  ],
  [
    "TRADE_CAL_SYNC_EMPTY",
    "TRADE_CAL_SYNC_EMPTY",
    "DATA_MISSING"
  ],
  [
    "TRADE_CAL_SYNC_FAILED",
    "TRADE_CAL_SYNC_FAILED",
    "INTERNAL_ERROR"
  ],
  [
    "BENCHMARK_SYNC_EMPTY",
    "BENCHMARK_SYNC_EMPTY",
    "DATA_MISSING"
  ],
  [
    "PUBLIC_PROVIDER_COOLDOWN",
    "PUBLIC_PROVIDER_COOLDOWN",
    "INTERNAL_ERROR"
  ],
  [
    "PUBLIC_STOCK_UNIVERSE_INCOMPLETE",
    "PUBLIC_STOCK_UNIVERSE_INCOMPLETE",
    "DATA_MISSING"
  ],
  [
    "PUBLIC_STOCK_UNIVERSE_INVALID_RESPONSE",
    "PUBLIC_STOCK_UNIVERSE_INVALID_RESPONSE",
    "INTERNAL_ERROR"
  ],
  [
    "PUBLIC_STOCK_UNIVERSE_NOT_READY",
    "PUBLIC_STOCK_UNIVERSE_NOT_READY",
    "DATA_MISSING"
  ],
  [
    "PUBLIC_DAILY_INVALID_TARGET_DATE",
    "PUBLIC_DAILY_INVALID_TARGET_DATE",
    "INVALID_INPUT"
  ],
  [
    "HISTORICAL_DAILY_SYNC_RUNNING",
    "ALREADY_RUNNING",
    "INTERNAL_ERROR"
  ],
  [
    "INVALID_ACTION",
    "INVALID_PARAM",
    "INVALID_INPUT"
  ],
  [
    "UNKNOWN_DIAGNOSTIC_FAILURE",
    "DIAGNOSTICS_FAILED",
    "INTERNAL_ERROR"
  ]
])(
    'maps %s to %s and records only %s',
    async (rawCode, legacyCode, supportCode) => {
      const secret = ['sk', 'offline', 'private', 'secret', 'fixture'].join('-')
      const sql = 'SELECT private_token FROM private_credentials'
      const message = rawCode === 'HISTORICAL_DAILY_SYNC_RUNNING' || rawCode === 'INVALID_ACTION'
        ? rawCode : rawCode + ' ' + secret + ' ' + sql
      const error = new Error(message, { cause: { secret, sql } })
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      dependency('diagnostics', 'runDiagnosticAction').mockRejectedValueOnce(error)
      const result = await invoke('diagnostics:runCheck', current.event, { action: 'syncTradeCalendar' }) as {
        ok: false; error: string; message: string; correlationId: string
      }
      expect(result.ok).toBe(false)
      expect(result.error).toBe(legacyCode)
      expect(result.correlationId).toBe(mocks.correlationId)
      expect(result.message).toContain('问题编号：' + mocks.correlationId)
      expect(mocks.recordSupportFailure).toHaveBeenCalledTimes(1)
      expect(mocks.recordSupportFailure.mock.calls[0]).toEqual([supportCode, 'data'])
      expect(log).toHaveBeenCalledWith(
        '[diagnostics:runCheck] action=syncTradeCalendar failed:',
        { code: legacyCode, correlationId: mocks.correlationId },
      )
      const visible = JSON.stringify({
        result,
        records: mocks.recordSupportFailure.mock.calls,
        logs: log.mock.calls,
      })
      expect(visible).not.toContain(secret)
      expect(visible).not.toContain(sql)
    },
  )

  it.each([
    ['refreshHealth', 'runtime'],
    ['refreshDataQuality', 'data'],
    ['syncStockBasic', 'data'],
    ['syncTradeCalendar', 'data'],
    ['syncHistoricalDaily', 'data'],
    ['syncMarketBenchmarks', 'data'],
    ['syncConceptMembers', 'data'],
    ['backfillDecisionSignals', 'data'],
  ])('records %s in the %s module', async (action, module) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dependency('diagnostics', 'runDiagnosticAction').mockRejectedValueOnce(new Error('unclassified fixture'))
    await invoke('diagnostics:runCheck', current.event, { action })
    expect(mocks.recordSupportFailure.mock.calls).toEqual([['INTERNAL_ERROR', module]])
  })

  it('uses the ID returned by the recorder rather than generating a second ID', async () => {
    const correlationId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    mocks.recordSupportFailure.mockReturnValueOnce({
      code: 'DATA_MISSING', message: 'public fixture', action: 'public action',
      retryable: false, correlationId,
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dependency('diagnostics', 'runDiagnosticAction').mockRejectedValueOnce({ code: 'BENCHMARK_SYNC_EMPTY' })
    await expect(invoke('diagnostics:runCheck', current.event, { action: 'syncMarketBenchmarks' }))
      .resolves.toEqual({
        ok: false, error: 'BENCHMARK_SYNC_EMPTY', correlationId,
        message: '核心基准接口暂未返回可用日线 问题编号：' + correlationId,
      })
  })
})

describe('AI-registered multi-source handlers use the same live getter', () => {
  it.each([
    'datasource:choosePython', 'datasource:bridgeStatus', 'datasource:installExtensions',
    'datasource:reports', 'datasource:wencai', 'datasource:probe', 'datasource:openSourceLink',
  ])('%s works in the recreated window and preserves its result', async channel => {
    const old = current
    const next = fixture()
    old.window.isDestroyed.mockReturnValue(true)
    currentWindow = next.window as unknown as BrowserWindow
    expect(() => invoke(channel, old.event)).toThrow('UNTRUSTED_IPC_SENDER')
    expect(mocks.touch).not.toHaveBeenCalled()
    let payload: unknown
    let expected: unknown
    switch (channel) {
      case 'datasource:choosePython':
        expected = 'offline-python'
        break
      case 'datasource:bridgeStatus':
        dependency('services/pythonDataSourceBridge', 'callPythonDataSource').mockResolvedValueOnce({ version: 'offline-bridge' })
        expected = { ok: true, data: { version: 'offline-bridge' } }
        break
      case 'datasource:installExtensions':
        dependency('services/pythonDataSourceBridge', 'installSelectedDataSourceExtensions').mockResolvedValueOnce('offline-python')
        expected = { ok: true, pythonPath: 'offline-python', message: '所选扩展已安装到本机应用数据目录，不占用系统 Python。' }
        break
      case 'datasource:reports':
        payload = { stockCode: '000001' }
        dependency('services/multiSourceResearchService', 'getSelectedResearchReports')
          .mockResolvedValueOnce({ reports: [{ title: 'offline report' }], statuses: [] })
        expected = { ok: true, reports: [{ title: 'offline report' }], statuses: [] }
        break
      case 'datasource:wencai':
        payload = { query: 'offline query' }
        dependency('services/multiSourceResearchService', 'queryWencai').mockResolvedValueOnce({ rows: [{ fixture: 1 }] })
        expected = { ok: true, rows: [{ fixture: 1 }] }
        break
      case 'datasource:probe':
        payload = { provider: 'iwencai', stockCode: '000001' }
        dependency('services/multiSourceResearchService', 'queryWencai').mockResolvedValueOnce({ rows: [{ fixture: 1 }] })
        expected = { ok: true, provider: 'iwencai', rows: 1, message: '取得问财样本结果；不代表交易已开通。' }
        break
      case 'datasource:openSourceLink':
        payload = 'https://www.python.org/downloads/'
        expected = { ok: true }
        break
    }
    await expect(invoke(channel, next.event, payload)).resolves.toEqual(expected)
    expect(mocks.touch).toHaveBeenCalled()
    if (channel === 'datasource:installExtensions') {
      expect(dependency('database/dataSourceRepository', 'updateMultiSourcePreference'))
        .toHaveBeenCalledWith(mocks.database, { pythonPath: 'offline-python' })
    }
    if (channel === 'datasource:openSourceLink') {
      expect(mocks.openExternal).toHaveBeenCalledWith(payload)
    }
  })

  it('rejects all nested channels when the quitting getter returns null', () => {
    currentWindow = null
    for (const channel of [
      'datasource:choosePython', 'datasource:bridgeStatus', 'datasource:installExtensions',
      'datasource:reports', 'datasource:wencai', 'datasource:probe', 'datasource:openSourceLink',
    ]) expect(() => invoke(channel, current.event)).toThrow('UNTRUSTED_IPC_SENDER')
    expect(mocks.touch).not.toHaveBeenCalled()
  })

  it('preserves dialog cancellation', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(invoke('datasource:choosePython', current.event)).resolves.toBeNull()
  })

  it('keeps the source link allowlist after caller authorization', async () => {
    await expect(invoke('datasource:openSourceLink', current.event, 'https://example.invalid/'))
      .resolves.toEqual({ ok: false })
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
})

describe('trusted calls preserve business contracts', () => {
  it('preserves settings results and interval rescheduling', () => {
    expect(invoke('settings:get', current.event)).toBe(mocks.settings)
    expect(invoke('settings:update', current.event, { scanIntervalMinutes: 60 })).toBe(mocks.settings)
    expect(mocks.functions.get('settings:updateSettings')).toHaveBeenCalledWith({ scanIntervalMinutes: 60 })
    expect(mocks.functions.get('scheduler:reschedule')).toHaveBeenCalledTimes(1)
    expect(invoke('settings:setTheme', current.event, 'dark')).toBeUndefined()
    expect(mocks.functions.get('settings:setTheme')).toHaveBeenCalledWith('dark')
  })

  it('preserves AI save transactions without real credentials or SQLite', () => {
    expect(invoke('ai:saveConfig', current.event, { model: 'offline-model' })).toEqual({ ok: true })
    expect(mocks.database.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.functions.get('aiConfig:updateAIConfig')).toHaveBeenCalledWith(mocks.database, { model: 'offline-model' })
  })

  it('preserves AI delete results and arguments', () => {
    expect(invoke('ai:deleteForecast', current.event, { id: 7 })).toEqual({ ok: true })
    expect(mocks.functions.get('database/trendForecastRepository:deleteForecast')).toHaveBeenCalledWith(mocks.database, 7)
  })

  it('preserves diagnostic results and passing the originating window', async () => {
    expect(invoke('diagnostics:getHealth', current.event)).toEqual({ ok: true, data: mocks.health })
    await expect(invoke('diagnostics:runCheck', current.event, { action: 'refreshHealth' }))
      .resolves.toEqual({ ok: true, data: mocks.actionResult })
    expect(mocks.fromWebContents).toHaveBeenCalledWith(current.contents)
    expect(mocks.functions.get('diagnostics:runDiagnosticAction')).toHaveBeenCalledWith(
      mocks.database, 'refreshHealth', { fixture: 'diagnostic-window' },
    )
  })

  it('preserves diagnostic action validation before service execution', async () => {
    await expect(invoke('diagnostics:runCheck', current.event, { action: 'not-an-action' }))
      .resolves.toEqual({ ok: false, error: 'INVALID_PARAM', message: '诊断动作参数无效' })
    expect(mocks.touch).not.toHaveBeenCalled()
  })

  it('preserves diagnostic catch error mapping and adds the recorder correlation ID', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = dependency('diagnostics', 'runDiagnosticAction')
    run.mockRejectedValueOnce(new Error('TRADE_CAL_SYNC_EMPTY'))
    await expect(invoke('diagnostics:runCheck', current.event, { action: 'syncTradeCalendar' }))
      .resolves.toEqual({
        ok: false, error: 'TRADE_CAL_SYNC_EMPTY',
        message: `交易日历接口暂未返回可用数据，本地已有数据保持不变 问题编号：${mocks.correlationId}`,
        correlationId: mocks.correlationId,
      })
    expect(mocks.recordSupportFailure).toHaveBeenCalledTimes(1)
    expect(mocks.recordSupportFailure).toHaveBeenCalledWith('DATA_MISSING', 'data')
  })

  it('preserves backup and export return structures', async () => {
    expect(invoke('dataSafety:getStatus', current.event)).toEqual({ ok: true, data: mocks.safety })
    await expect(invoke('dataSafety:createBackup', current.event)).resolves.toEqual({ ok: true, data: mocks.backup })
    await expect(invoke('dataSafety:openBackupDirectory', current.event))
      .resolves.toEqual({ ok: true, data: { backupDirectory: 'offline-directory' } })
    expect(invoke('dataSafety:exportData', current.event, { scope: 'portfolio' }))
      .toEqual({ ok: true, data: mocks.exported })
    expect(mocks.functions.get('safety:exportData')).toHaveBeenCalledWith(mocks.database, 'portfolio')
  })

  it('preserves invalid export validation and performs no service call', () => {
    expect(invoke('dataSafety:exportData', current.event, { scope: 'invalid' }))
      .toEqual({ ok: false, error: 'INVALID_PARAM', message: '导出范围无效' })
    expect(mocks.touch).not.toHaveBeenCalled()
  })

  it.each([
    ['settings:get', undefined, { ok: 'settings' }],
    ['ai:deleteForecast', { id: 7 }, { ok: true }],
    ['diagnostics:getHealth', undefined, { ok: true, data: mocks.health }],
    ['dataSafety:exportData', { scope: 'all' }, { ok: true, data: mocks.exported }],
  ])('%s remains usable after the main window is recreated', (channel, payload, expected) => {
    const first = current
    const before = invoke(channel as string, first.event, payload)
    if (channel === 'settings:get') expect(before).toBe(mocks.settings)
    else expect(before).toEqual(expected)
    const next = fixture()
    first.window.isDestroyed.mockReturnValue(true)
    currentWindow = next.window as unknown as BrowserWindow
    vi.clearAllMocks()
    expect(() => invoke(channel as string, first.event, payload)).toThrow('UNTRUSTED_IPC_SENDER')
    expect(mocks.touch).not.toHaveBeenCalled()
    const after = invoke(channel as string, next.event, payload)
    if (channel === 'settings:get') expect(after).toBe(mocks.settings)
    else expect(after).toEqual(expected)
    expect(mocks.touch).toHaveBeenCalled()
  })
})
