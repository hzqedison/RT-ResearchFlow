import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type Database from 'better-sqlite3'
import { decodeLedgerAccount, decodeLedgerAppend, isLedgerId, type LedgerCode, type LedgerResult } from '../../shared/accountLedger'
import { AccountLedgerError, appendAccountLedger, createLedgerAccount, findLedgerEvent, getAccountLedger, listLedgerAccounts } from '../database/accountLedgerRepository'

const MESSAGES: Record<LedgerCode, string> = {
  INVALID_INPUT: '请检查金额、证券、日期及本人核对选项。', ACCOUNT_NOT_FOUND: '账户账本不存在，请刷新账户列表。',
  ACCOUNT_CONFLICT: '开账请求与已保存内容不同，请核对已有账户。', ALIAS_EXISTS: '该账户别名已存在，请选择已有账户。',
  REVISION_CONFLICT: '账本已更新，请刷新后核对再保存。', EVENT_CONFLICT: '同一保存编号的内容发生变化，请核对原记录。',
  REFERENCE_EXISTS: '该成交或流水编号已记录；更正须先冲销并明确关联原记录。', INVALID_CORRECTION: '更正关联不匹配，请核对已冲销记录。',
  INVALID_REVERSAL: '原记录不存在或已经冲销；冲销记录本身不能再次冲销。', LIMIT_REACHED: '当前账本达到容量边界，请先保留已有记录并联系支持。',
  UNAUTHORIZED: '当前窗口无权访问账户账本。', STORAGE_UNAVAILABLE: '本地账本暂不可读写，原数据未自动覆盖，请检查数据库。',
}
export function registerAccountLedgerHandlers(getWindow: () => BrowserWindow | null, getDb: () => Database.Database): () => void {
  const names: string[] = []
  function handle(name: string, run: (payload: unknown) => unknown) {
    names.push(name)
    ipcMain.handle(name, (event: IpcMainInvokeEvent, payload: unknown): LedgerResult<unknown> => {
      try {
        const window = getWindow(), frame = event.senderFrame
        if (!window || window.isDestroyed() || !frame || window.webContents.isDestroyed() || event.sender.isDestroyed()
          || event.sender !== window.webContents || frame !== window.webContents.mainFrame) throw new AccountLedgerError('UNAUTHORIZED')
        return { ok: true, data: run(payload) }
      } catch (error) {
        const code = error instanceof AccountLedgerError ? error.code : 'STORAGE_UNAVAILABLE'
        return { ok: false, code, message: MESSAGES[code] }
      }
    })
  }
  handle('accountLedger:list', payload => { if (payload !== undefined) throw new AccountLedgerError('INVALID_INPUT'); return listLedgerAccounts(getDb()) })
  handle('accountLedger:get', payload => { if (!isLedgerId(payload)) throw new AccountLedgerError('INVALID_INPUT'); return getAccountLedger(getDb(), payload) })
  handle('accountLedger:create', payload => { const input = decodeLedgerAccount(payload); if (!input) throw new AccountLedgerError('INVALID_INPUT'); return createLedgerAccount(getDb(), input) })
  handle('accountLedger:append', payload => { const input = decodeLedgerAppend(payload); if (!input) throw new AccountLedgerError('INVALID_INPUT'); return appendAccountLedger(getDb(), input) })
  handle('accountLedger:findEvent', payload => {
    const v = payload as { accountId?: unknown; eventId?: unknown } | null
    if (!v || Object.keys(v).length !== 2 || !isLedgerId(v.accountId) || !isLedgerId(v.eventId)) throw new AccountLedgerError('INVALID_INPUT')
    return findLedgerEvent(getDb(), v.accountId, v.eventId)
  })
  return () => { for (const name of names) ipcMain.removeHandler(name) }
}
