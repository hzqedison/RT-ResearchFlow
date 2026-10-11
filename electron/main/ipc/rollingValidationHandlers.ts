import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { isLedgerId } from '../../shared/accountLedger'
import { decodeValidationRequest, VALIDATION_MESSAGES, type ValidationCode, type ValidationResult } from '../../shared/rollingValidation'
import { advanceValidationStudy, getValidationStudy, listValidationStudies, prepareValidationStudy, ValidationError } from '../services/backtest/rollingValidationService'
export function registerRollingValidationHandlers(getWindow: () => Electron.BrowserWindow | null, getDb: () => Database.Database) {
  const channels = ['rollingValidation:list', 'rollingValidation:get', 'rollingValidation:prepare', 'rollingValidation:advance']
  function reply<T>(event: Electron.IpcMainInvokeEvent, work: () => T): ValidationResult<T> {
    const win = getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed() || event.sender !== win.webContents || !event.senderFrame || event.senderFrame !== win.webContents.mainFrame) return { ok: false, code: 'UNAUTHORIZED', message: VALIDATION_MESSAGES.UNAUTHORIZED }
    try { return { ok: true, data: work() } } catch (e) {
      const code: ValidationCode = e instanceof ValidationError ? e.code : 'STORAGE_UNAVAILABLE'
      return { ok: false, code, message: VALIDATION_MESSAGES[code] }
    }
  }
  ipcMain.handle(channels[0], (e, value) => reply(e, () => { if (value !== undefined) throw new ValidationError('INVALID_INPUT'); return listValidationStudies(getDb()) }))
  ipcMain.handle(channels[1], (e, id) => reply(e, () => { if (!isLedgerId(id)) throw new ValidationError('INVALID_INPUT'); return getValidationStudy(getDb(), id) }))
  ipcMain.handle(channels[2], (e, value) => reply(e, () => { const request = decodeValidationRequest(value); if (!request) throw new ValidationError('INVALID_INPUT'); return prepareValidationStudy(getDb(), request) }))
  ipcMain.handle(channels[3], (e, id) => reply(e, () => { if (!isLedgerId(id)) throw new ValidationError('INVALID_INPUT'); return advanceValidationStudy(getDb(), id) }))
  return () => channels.forEach(c => ipcMain.removeHandler(c))
}
