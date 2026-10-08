import { dialog, ipcMain, systemPreferences, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { MacThsOrderService, NativeConfirmation, TrustedCaller } from '../services/macThsOrderService'

/** The caller capability is built here from Electron objects, never from IPC payload fields. */
function trustedCaller(event: IpcMainInvokeEvent, getWindow: () => BrowserWindow | null): TrustedCaller {
  const frame = event.senderFrame
  const isCurrent = () => {
    const window = getWindow()
    return !!window && !window.isDestroyed() && event.sender === window.webContents &&
      !event.sender.isDestroyed() && frame !== null && frame === window.webContents.mainFrame
  }
  if (!frame || !isCurrent()) throw new Error('UNAUTHORIZED')
  return { id: event.sender.id, frame, isCurrent }
}
export function createMacThsNativeConfirmation(getWindow: () => BrowserWindow | null) {
  return async (prompt: NativeConfirmation, caller: TrustedCaller): Promise<boolean> => {
    const parent = getWindow()
    if (!parent || parent.isDestroyed() || !caller.isCurrent()) return false
    const result = await dialog.showMessageBox(parent, { type: 'warning',
      title: prompt.title, message: prompt.message, detail: prompt.detail,
      buttons: ['取消', prompt.confirmLabel], defaultId: 0, cancelId: 0, noLink: true })
    return caller.isCurrent() && result.response === 1
  }
}
export const macThsAccessibility = (request: boolean): boolean =>
  process.platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient(request)

export function registerMacThsHandlers(getWindow: () => BrowserWindow | null, service: MacThsOrderService): () => void {
  ipcMain.handle('macThs:status', (event, payload?: unknown) => {
    trustedCaller(event, getWindow)
    if (payload !== undefined) throw new Error('INVALID_REQUEST')
    return service.getState()
  })
  ipcMain.handle('macThs:execute', async (event, payload: unknown) => {
    const caller = trustedCaller(event, getWindow)
    const result = await service.execute(payload, caller)
    if (!caller.isCurrent()) throw new Error('UNAUTHORIZED')
    return result
  })
  ipcMain.handle('macThs:recover', async (event, payload: unknown) => {
    const caller = trustedCaller(event, getWindow)
    const result = await service.recover(payload, caller)
    if (!caller.isCurrent()) throw new Error('UNAUTHORIZED')
    return result
  })
  ipcMain.handle('macThs:reviewIntent', async (event, payload: unknown) => {
    const caller = trustedCaller(event, getWindow)
    const result = await service.reviewIntent(payload, caller)
    if (!caller.isCurrent()) throw new Error('UNAUTHORIZED')
    return result
  })
  const unsubscribe = service.onStateChanged(notice => {
    const window = getWindow()
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send('macThs:stateChanged', notice)
  })
  return () => {
    unsubscribe()
    for (const name of ['macThs:status', 'macThs:execute', 'macThs:recover', 'macThs:reviewIntent'])
      ipcMain.removeHandler(name)
  }
}
