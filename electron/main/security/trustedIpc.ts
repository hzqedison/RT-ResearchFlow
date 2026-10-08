import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

export type TrustedWindowGetter = () => BrowserWindow | null

export function isTrustedIpcSender(
  event: IpcMainInvokeEvent,
  getWindow: TrustedWindowGetter,
): boolean {
  try {
    const window = getWindow()
    if (!window || window.isDestroyed()) return false

    const contents = window.webContents
    const sender = event.sender
    if (!contents || !sender || sender !== contents || sender.isDestroyed()) return false

    const senderFrame = event.senderFrame
    const mainFrame = contents.mainFrame
    return !!senderFrame && !!mainFrame && senderFrame === mainFrame
  } catch {
    return false
  }
}

export function registerTrustedIpcHandler(
  channel: string,
  getWindow: TrustedWindowGetter,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedIpcSender(event, getWindow)) {
      throw new Error('UNTRUSTED_IPC_SENDER')
    }
    return handler(event, ...args)
  })
}
