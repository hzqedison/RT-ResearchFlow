import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type Database from 'better-sqlite3'
import { isLedgerId } from '../../shared/accountLedger'
import { decodeCapitalRequest, type CapitalCode, type CapitalResult } from '../../shared/capitalSimulation'
import { CapitalError, capitalCatalog, getCapitalReport, runCapitalSimulation } from '../services/backtest/capitalSimulationService'
const messages: Record<CapitalCode, string> = {
  INVALID_INPUT: '请核对数据集、已完成日期、金额及回测假设。', UNAUTHORIZED: '当前窗口不能访问组合资金回测。',
  CALENDAR_INCOMPLETE: '该区间交易日历不完整，请先在诊断页补齐，不能按工作日猜测开市。', FACT_LIMIT: '数据或报告数量超出单次容量边界，请缩小区间或数据集；已有报告保留。',
  ACCOUNT_CONFLICT: '账户事实版本已变化，请刷新后重新选择。', OPENING_DATE_MISMATCH: '回测起始日须等于账户期初日；当前余额不能冒充历史资金。',
  OPENING_INCOMPLETE: '该账户期初持仓范围未完整核对，请补齐或选择手动资金情景。', REQUEST_CONFLICT: '相同保存编号的参数已变化，请核对原报告。', NOT_FOUND: '所选数据集或报告不存在，请刷新列表。', STORAGE_UNAVAILABLE: '本地回测读取或保存结果未确认，请先核对保存编号；原数据未自动覆盖。',
}
export function registerCapitalSimulationHandlers(getWindow: () => BrowserWindow | null, getDb: () => Database.Database): () => void {
  const channels: string[] = []
  function handle(name: string, run: (v: unknown) => unknown) {
    channels.push(name)
    ipcMain.handle(name, (event: IpcMainInvokeEvent, v: unknown): CapitalResult<unknown> => {
      try {
        const w = getWindow(), frame = event.senderFrame
        if (!w || w.isDestroyed() || !frame || w.webContents.isDestroyed() || event.sender.isDestroyed() || event.sender !== w.webContents || frame !== w.webContents.mainFrame) throw new CapitalError('UNAUTHORIZED')
        return { ok: true, data: run(v) }
      } catch (error) { const code = error instanceof CapitalError ? error.code : 'STORAGE_UNAVAILABLE'; return { ok: false, code, message: messages[code] } }
    })
  }
  handle('capitalSimulation:catalog', v => { if (v !== undefined) throw new CapitalError('INVALID_INPUT'); return capitalCatalog(getDb()) })
  handle('capitalSimulation:get', v => { if (!isLedgerId(v)) throw new CapitalError('INVALID_INPUT'); return getCapitalReport(getDb(), v) })
  handle('capitalSimulation:run', v => { const request = decodeCapitalRequest(v); if (!request) throw new CapitalError('INVALID_INPUT'); return runCapitalSimulation(getDb(), request) })
  return () => { for (const name of channels) ipcMain.removeHandler(name) }
}
