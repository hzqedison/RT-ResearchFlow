import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { AppUpdateResult } from '../../shared/appUpdateTypes'
import {
  AppUpdateError, cancelAppUpdateDownload, checkAppRelease, downloadAppInstaller,
  getAppUpdateInfo, getVerifiedAppInstaller, setAppUpdateDirectory,
} from '../services/githubReleaseUpdateService'

export function registerAppUpdateHandlers(getWindow: () => BrowserWindow | null): void {
  async function run<T>(event: IpcMainInvokeEvent, operation: () => Promise<T> | T): Promise<AppUpdateResult<T>> {
    const window = getWindow()
    if (!window || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) {
      return { ok: false, code: 'UNAUTHORIZED', message: '此窗口无权调用应用更新服务。' }
    }
    try {
      return { ok: true, data: await operation() }
    } catch (error) {
      return error instanceof AppUpdateError
        ? { ok: false, code: error.code, message: error.message }
        : { ok: false, code: 'UPDATE_FAILED', message: '应用更新请求未完成，请检查网络或下载目录后重试。' }
    }
  }

  ipcMain.handle('appUpdates:info', event => run(event, getAppUpdateInfo))
  ipcMain.handle('appUpdates:check', (event, includePrereleases: unknown) => run(event, () => {
    if (typeof includePrereleases !== 'boolean') throw new AppUpdateError('INVALID_REQUEST', '更新渠道参数不正确。')
    return checkAppRelease(includePrereleases)
  }))
  ipcMain.handle('appUpdates:chooseDirectory', event => run(event, async () => {
    const window = getWindow()
    if (!window) throw new AppUpdateError('WINDOW_CLOSED', '应用窗口已关闭。')
    const info = getAppUpdateInfo()
    const selection = await dialog.showOpenDialog(window, {
      title: '选择安装包下载位置',
      defaultPath: info.downloadDirectory,
      properties: ['openDirectory', 'createDirectory'],
    })
    return selection.canceled || !selection.filePaths[0]
      ? info : setAppUpdateDirectory(selection.filePaths[0])
  }))
  ipcMain.handle('appUpdates:download', (event, version: unknown) => run(event, () => {
    if (typeof version !== 'string') throw new AppUpdateError('INVALID_REQUEST', '版本号参数不正确。')
    return downloadAppInstaller(version, value => {
      const window = getWindow()
      if (window && !window.isDestroyed()) window.webContents.send('appUpdates:progress', value)
    })
  }))
  ipcMain.handle('appUpdates:cancel', event => run(event, cancelAppUpdateDownload))
  ipcMain.handle('appUpdates:showInstaller', event => run(event, () => {
    const path = getVerifiedAppInstaller()
    if (!path) throw new AppUpdateError('DOWNLOAD_REQUIRED', '尚未下载并校验安装包。')
    shell.showItemInFolder(path)
  }))
}
