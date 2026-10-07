import { app, dialog, ipcMain, systemPreferences, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAC_THS_CODES, validateMacThsOrder, type MacThsAction, type MacThsCode, type MacThsMode,
  type MacThsRequest, type MacThsResult } from '../../shared/macThsTypes'
import { macThsScript } from '../services/macThsScripts'

const ACTIONS: MacThsAction[] = ['probe', 'preview', 'submitSimulation', 'queryOrders', 'queryDeals',
  'cancelSimulation', 'authorize', 'resolveUnknown']
interface Journal { unknownPending: boolean; usedRequests: string[] }
export function registerMacThsHandlers(getWindow: () => BrowserWindow | null): void {
  let busy = false
  const journalPath = () => join(app.getPath('userData'), 'mac-ths-experiment-journal.json')
  function loadJournal(): Journal {
    if (!existsSync(journalPath())) return { unknownPending: false, usedRequests: [] }
    const raw: unknown = JSON.parse(readFileSync(journalPath(), 'utf8'))
    if (!raw || typeof raw !== 'object') throw new Error('Invalid journal')
    const value = raw as Record<string, unknown>
    if (typeof value.unknownPending !== 'boolean' || !Array.isArray(value.usedRequests)
      || !value.usedRequests.every(item => typeof item === 'string' && /^[a-f0-9-]{36}$/.test(item))) throw new Error('Invalid journal')
    return { unknownPending: value.unknownPending, usedRequests: value.usedRequests.slice(-256) as string[] }
  }
  function saveJournal(value: Journal) {
    const temporary = journalPath() + '.tmp'
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
    renameSync(temporary, journalPath())
  }
  function result(action: MacThsAction, mode: MacThsMode, code: MacThsCode, pending = false, contractNo?: string): MacThsResult {
    return { schemaVersion: 1, component: 'mac-ths-ui-experiment', adapterVersion: '1',
      runtime: process.platform === 'darwin' ? 'macos' : 'other',
      architecture: process.arch === 'arm64' || process.arch === 'x64' ? process.arch : 'other',
      action, mode, code, unknownPending: pending,
      outcome: ['READY', 'FORM_READY', 'VIEW_OPENED', 'SIMULATION_ACCEPTED', 'PERMISSION_PROMPTED', 'STATE_RESOLVED'].includes(code)
        ? 'passed' : ['RECEIPT_UNKNOWN', 'CONFIRMATION_UNRECOGNIZED'].includes(code) ? 'unknown' : 'blocked',
      canSubmitLiveOrders: false, canRunUnattended: false,
      ...(contractNo ? { contractNo } : {}) }
  }
  function authorized(event: IpcMainInvokeEvent): boolean {
    const window = getWindow()
    return !!window && !window.isDestroyed() && event.sender === window.webContents
      && event.senderFrame === window.webContents.mainFrame
  }
  function execute(script: string): Promise<string> {
    return new Promise(resolve => {
      execFile('/usr/bin/osascript', ['-e', script], { timeout: 20000, maxBuffer: 4096 }, (error, stdout, stderr) => {
        if (error) {
          // Never expose raw stderr, native dialog content, process arguments, or account data.
          resolve(/-1743|-25211|not authorized|not allowed/i.test(stderr) ? 'AUTOMATION_DENIED' : 'SCRIPT_ERROR')
        } else resolve(stdout.trim())
      })
    })
  }
  ipcMain.handle('macThs:execute', async (event, payload: unknown): Promise<MacThsResult> => {
    const unknown = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const action: MacThsAction = ACTIONS.includes(unknown.action as MacThsAction) ? unknown.action as MacThsAction : 'probe'
    const mode: MacThsMode = unknown.mode === 'livePreview' ? 'livePreview' : 'simulation'
    if (!authorized(event) || !ACTIONS.includes(unknown.action as MacThsAction)) return result(action, mode, 'INVALID_ORDER')
    if (process.platform !== 'darwin') return result(action, mode, 'MAC_REQUIRED')
    if (busy) return result(action, mode, 'BUSY')
    busy = true
    let journal: Journal
    try {
      try { journal = loadJournal() } catch { return result(action, mode, 'JOURNAL_UNAVAILABLE', true) }
      const request = unknown as unknown as MacThsRequest
      const window = getWindow()!
      if (action === 'authorize') {
        const approval = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消', '申请辅助功能权限'],
          defaultId: 0, cancelId: 0, message: '允许本机实验桥接控制同花顺界面？',
          detail: '只用于你手动发起的表单预览和同花顺模拟交易。不会收集账户凭证或申请完全磁盘访问权限。系统还可能询问控制 System Events 的自动化权限。' })
        if (approval.response !== 1) return result(action, mode, 'USER_CANCELLED', journal.unknownPending)
        systemPreferences.isTrustedAccessibilityClient(true)
        return result(action, mode, 'PERMISSION_PROMPTED', journal.unknownPending)
      }
      if (action === 'resolveUnknown') {
        const approval = await dialog.showMessageBox(window, { type: 'warning', buttons: ['取消', '已在同花顺核对模拟委托'],
          defaultId: 0, cancelId: 0, message: '先核对模拟委托，再解除结果不明保护',
          detail: '这不会认定成交成功，也不会重发原委托。请先在同花顺模拟页面确认上次操作结果。' })
        if (approval.response !== 1) return result(action, mode, 'USER_CANCELLED', true)
        journal.unknownPending = false
        saveJournal(journal)
        return result(action, mode, 'STATE_RESOLVED')
      }
      if (!systemPreferences.isTrustedAccessibilityClient(false)) return result(action, mode, 'ACCESSIBILITY_REQUIRED', journal.unknownPending)
      const order = action === 'preview' || action === 'submitSimulation' ? validateMacThsOrder(request.order) : undefined
      if ((action === 'preview' || action === 'submitSimulation') && (!order || order.mode !== mode)) return result(action, mode, 'INVALID_ORDER', journal.unknownPending)
      if ((action === 'submitSimulation' || action === 'cancelSimulation') && mode !== 'simulation') return result(action, mode, 'INVALID_ORDER', journal.unknownPending)
      const mutates = action === 'submitSimulation' || action === 'cancelSimulation'
      const requestId = order?.requestId ?? request.requestId
      if (mutates) {
        if (journal.unknownPending) return result(action, mode, 'UNKNOWN_PENDING', true)
        if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestId)) return result(action, mode, 'INVALID_ORDER')
        if (journal.usedRequests.includes(requestId)) return result(action, mode, 'DUPLICATE_REQUEST')
        if (action === 'cancelSimulation' && (typeof request.contractNo !== 'string' || !/^[a-zA-Z0-9-]{1,32}$/.test(request.contractNo))) return result(action, mode, 'INVALID_ORDER')
        const approval = await dialog.showMessageBox(window, { type: 'warning', buttons: ['取消', '确认本次模拟操作'],
          defaultId: 0, cancelId: 0, message: action === 'submitSimulation' ? '向同花顺模拟账户提交一笔委托？' : '撤销指定的同花顺模拟委托？',
          detail: order ? `${order.side === 'buy' ? '模拟买入' : '模拟卖出'} ${order.symbol}\n限价 ${order.price}，数量 ${order.quantity}\n单笔额度上限 ${order.maxNotional}\n只适配普通 A 股主板；不会切换为实盘或自动重试。` : '只撤销你指定的模拟委托，不使用全撤按钮。' })
        if (approval.response !== 1) return result(action, mode, 'USER_CANCELLED')
        journal.unknownPending = true
        journal.usedRequests.push(requestId)
        saveJournal(journal)
      } else if (action === 'preview' && mode === 'livePreview') {
        const approval = await dialog.showMessageBox(window, { type: 'warning', buttons: ['取消', '只填写并核对，不发送'],
          defaultId: 0, cancelId: 0, message: '实验性中信实盘表单预览',
          detail: '会切换同花顺至 A 股页面并填写你输入的代码、价格、数量；不会点击确定买入/卖出，不会提交实盘委托。核对完请清空不需要的草稿。' })
        if (approval.response !== 1) return result(action, mode, 'USER_CANCELLED', journal.unknownPending)
      }
      const output = await execute(macThsScript(action, mode, order ?? undefined, request.contractNo ?? ''))
      const [rawCode, rawContract] = output.split('|')
      let code: MacThsCode = MAC_THS_CODES.includes(rawCode as MacThsCode) ? rawCode as MacThsCode : 'SCRIPT_ERROR'
      const contract = code === 'SIMULATION_ACCEPTED' && /^[a-zA-Z0-9-]{1,32}$/.test(rawContract ?? '') ? rawContract : undefined
      if (code === 'SIMULATION_ACCEPTED' && !contract) code = 'RECEIPT_UNKNOWN'
      if (mutates) {
        const safeBlocked = ['CLIENT_NOT_RUNNING', 'TRADE_VIEW_REQUIRED', 'MODE_UNVERIFIED', 'LAYOUT_UNSUPPORTED',
          'BROKER_UNVERIFIED', 'READBACK_MISMATCH', 'TABLE_UNSUPPORTED', 'CANCEL_CONTROL_UNSUPPORTED']
        if (code === 'SIMULATION_ACCEPTED' || safeBlocked.includes(code)) journal.unknownPending = false
        else { journal.unknownPending = true; if (code === 'SCRIPT_ERROR' || code === 'AUTOMATION_DENIED') code = 'RECEIPT_UNKNOWN' }
        saveJournal(journal)
      }
      return result(action, mode, code, journal.unknownPending, contract)
    } catch {
      return result(action, mode, 'JOURNAL_UNAVAILABLE', true)
    } finally { busy = false }
  })
}
