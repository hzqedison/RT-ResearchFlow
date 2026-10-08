import { dialog, shell } from 'electron'
import { registerTrustedIpcHandler, type TrustedWindowGetter } from '../security/trustedIpc'
import { getDb } from '../database/db'
import { getMultiSourcePreference, updateMultiSourcePreference } from '../database/dataSourceRepository'
import { fetchSelectedStockDaily } from '../services/multiSourceMarketService'
import { getSelectedResearchReports, queryWencai } from '../services/multiSourceResearchService'
import { callPythonDataSource, dataBridgeMessage, installSelectedDataSourceExtensions } from '../services/pythonDataSourceBridge'
import { fetchPublicLimitUpPool } from '../services/publicLimitPoolAdapter'
import { readVerifiedPublicLimitPool, syncVerifiedPublicLimitPool } from '../services/verifiedPublicLimitPoolCache'
import { DAILY_DATA_PROVIDERS, type DataProbeProvider, type DataSourceProbeResult } from '../../shared/dataSourceTypes'

export function registerMultiSourceHandlers(getWindow: TrustedWindowGetter): void {
  registerTrustedIpcHandler('datasource:choosePython', getWindow, async () => {
    const result = await dialog.showOpenDialog({ title: '选择本机 Python 解释器', properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  registerTrustedIpcHandler('datasource:bridgeStatus', getWindow, async () => {
    try {
      return { ok: true, data: await callPythonDataSource(getMultiSourcePreference(getDb()), { operation: 'status' }) }
    } catch (error) { return { ok: false, message: dataBridgeMessage(error) } }
  })
  registerTrustedIpcHandler('datasource:installExtensions', getWindow, async () => {
    try {
      const path = await installSelectedDataSourceExtensions(getMultiSourcePreference(getDb()))
      updateMultiSourcePreference(getDb(), { pythonPath: path })
      return { ok: true, pythonPath: path, message: '所选扩展已安装到本机应用数据目录，不占用系统 Python。' }
    } catch (error) { return { ok: false, message: dataBridgeMessage(error) } }
  })
  registerTrustedIpcHandler('datasource:reports', getWindow, async (_event, data: { stockCode?: unknown }) => {
    try { return { ok: true, ...await getSelectedResearchReports(getDb(), String(data?.stockCode ?? '')) } }
    catch { return { ok: false, message: '请输入有效的六位 A 股代码。' } }
  })
  registerTrustedIpcHandler('datasource:wencai', getWindow, async (_event, data: { query?: unknown }) => {
    try { return { ok: true, ...await queryWencai(getDb(), String(data?.query ?? '')) } }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '问财查询未完成。' } }
  })
  registerTrustedIpcHandler('datasource:probe', getWindow, async (_event, data: { provider?: unknown; stockCode?: unknown; tradeDate?: unknown }): Promise<DataSourceProbeResult> => {
    const provider = String(data?.provider ?? '') as DataProbeProvider
    const stockCode = String(data?.stockCode ?? '000001')
    try {
      if (provider === 'akshare-limit-pool') {
        const tradeDate = String(data?.tradeDate ?? '')
        if (!/^\d{8}$/.test(tradeDate)) {
          return { ok: false, provider, message: '请选择有效的交易日期。' }
        }
        const config = getMultiSourcePreference(getDb())
        if (!config.dailyProviders.includes('akshare')) {
          return { ok: false, provider, message: '请先选择 AKShare 并安装所选本地扩展。' }
        }
        const result = await fetchPublicLimitUpPool(config, tradeDate)
        const detail = result.missingFields.length > 0 ? `；缺失字段：${result.missingFields.join('、')}` : ''
        return {
          ok: result.state === 'available', provider, rows: result.rows.length,
          message: result.state === 'unavailable'
            ? `请求日期 ${tradeDate} 未取得近期涨停池；不代表当天没有涨停股票。`
            : `请求日期 ${tradeDate}，取得 ${result.rows.length} 条，拒收 ${result.rejectedRows} 条${detail}。仅为公开源样本，未写入策略库或核验实际交易日。`,
        }
      }
      if (provider === 'iwencai') {
        const result = await queryWencai(getDb(), stockCode)
        return { ok: result.rows.length > 0, provider, rows: result.rows.length, message: '取得问财样本结果；不代表交易已开通。' }
      }
      if (provider === 'eastmoney-reports' || provider === 'akshare-reports') {
        const result = await getSelectedResearchReports(getDb(), stockCode, provider === 'eastmoney-reports' ? 'eastmoney' : 'akshare')
        return { ok: result.reports.length > 0, provider, rows: result.reports.length,
          message: result.statuses.map(status => status.message).join('；') }
      }
      if (!DAILY_DATA_PROVIDERS.includes(provider as typeof DAILY_DATA_PROVIDERS[number])) throw new Error('INVALID_PROVIDER')
      const result = await fetchSelectedStockDaily(getDb(), stockCode, { onlyProvider: provider as typeof DAILY_DATA_PROVIDERS[number], benchmark: false })
      return { ok: result.rowsWritten > 0, provider, rows: result.rowsWritten, latestTradeDate: result.latestTradeDate, message: result.message }
    } catch (error) {
      return { ok: false, provider, message: error instanceof Error && /^(所选|请至少|请输入|问财|i问财)/.test(error.message)
        ? error.message : dataBridgeMessage(error) }
    }
  })
  registerTrustedIpcHandler('datasource:syncPublicLimitPool', getWindow, async (_event, data: { tradeDate?: unknown }) => {
    try {
      return await syncVerifiedPublicLimitPool(
        getDb(), getMultiSourcePreference(getDb()), String(data?.tradeDate ?? ''),
      )
    } catch (error) {
      return { ok: false, tradeDate: typeof data?.tradeDate === 'string' && /^\d{8}$/.test(data.tradeDate) ? data.tradeDate : '', quality: 'blocked' as const, rows: 0, message: dataBridgeMessage(error) }
    }
  })
  registerTrustedIpcHandler('datasource:listVerifiedPublicLimitPool', getWindow, () =>
    readVerifiedPublicLimitPool(getDb()))
  registerTrustedIpcHandler('datasource:openSourceLink', getWindow, async (_event, input: unknown) => {
    try {
      const url = new URL(String(input))
      const allowed = ['pdf.dfcfw.com', 'www.iwencai.com', 'www.python.org', 'nodejs.org', 'data.eastmoney.com']
      if (url.protocol !== 'https:' || url.username || url.password || !allowed.includes(url.hostname)) return { ok: false }
      await shell.openExternal(url.toString())
      return { ok: true }
    } catch { return { ok: false } }
  })
}
