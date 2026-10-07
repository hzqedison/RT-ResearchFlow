import { dialog, ipcMain, shell } from 'electron'
import { getDb } from '../database/db'
import { getMultiSourcePreference, updateMultiSourcePreference } from '../database/dataSourceRepository'
import { fetchSelectedStockDaily } from '../services/multiSourceMarketService'
import { getSelectedResearchReports, queryWencai } from '../services/multiSourceResearchService'
import { callPythonDataSource, dataBridgeMessage, installSelectedDataSourceExtensions } from '../services/pythonDataSourceBridge'
import { DAILY_DATA_PROVIDERS, type DataProbeProvider, type DataSourceProbeResult } from '../../shared/dataSourceTypes'

export function registerMultiSourceHandlers(): void {
  ipcMain.handle('datasource:choosePython', async () => {
    const result = await dialog.showOpenDialog({ title: '选择本机 Python 解释器', properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('datasource:bridgeStatus', async () => {
    try {
      return { ok: true, data: await callPythonDataSource(getMultiSourcePreference(getDb()), { operation: 'status' }) }
    } catch (error) { return { ok: false, message: dataBridgeMessage(error) } }
  })
  ipcMain.handle('datasource:installExtensions', async () => {
    try {
      const path = await installSelectedDataSourceExtensions(getMultiSourcePreference(getDb()))
      updateMultiSourcePreference(getDb(), { pythonPath: path })
      return { ok: true, pythonPath: path, message: '所选扩展已安装到本机应用数据目录，不占用系统 Python。' }
    } catch (error) { return { ok: false, message: dataBridgeMessage(error) } }
  })
  ipcMain.handle('datasource:reports', async (_event, data: { stockCode?: unknown }) => {
    try { return { ok: true, ...await getSelectedResearchReports(getDb(), String(data?.stockCode ?? '')) } }
    catch { return { ok: false, message: '请输入有效的六位 A 股代码。' } }
  })
  ipcMain.handle('datasource:wencai', async (_event, data: { query?: unknown }) => {
    try { return { ok: true, ...await queryWencai(getDb(), String(data?.query ?? '')) } }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '问财查询未完成。' } }
  })
  ipcMain.handle('datasource:probe', async (_event, data: { provider?: unknown; stockCode?: unknown }): Promise<DataSourceProbeResult> => {
    const provider = String(data?.provider ?? '') as DataProbeProvider
    const stockCode = String(data?.stockCode ?? '000001')
    try {
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
  ipcMain.handle('datasource:openSourceLink', async (_event, input: unknown) => {
    try {
      const url = new URL(String(input))
      const allowed = ['pdf.dfcfw.com', 'www.iwencai.com', 'www.python.org', 'nodejs.org', 'data.eastmoney.com']
      if (url.protocol !== 'https:' || url.username || url.password || !allowed.includes(url.hostname)) return { ok: false }
      await shell.openExternal(url.toString())
      return { ok: true }
    } catch { return { ok: false } }
  })
}
