import { app, dialog, ipcMain, systemPreferences, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAC_THS_ACTIONS, MAC_THS_CODES, validateMacThsOrder, type MacThsAction, type MacThsCode,
  type MacThsMode, type MacThsRequest, type MacThsResult } from '../../shared/macThsTypes'
import { macThsScript } from '../services/macThsScripts'

interface Journal { unknownPending: boolean; usedRequests: string[] }
export function registerMacThsHandlers(getWindow: () => BrowserWindow | null): void {
  let busy = false
  let liveEnabled = false
  let confirmation: { token: string; senderId: number; key: string; expiresAt: number } | null = null
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
    return { schemaVersion: 1, component: 'mac-ths-ui-experiment', adapterVersion: '2',
      runtime: process.platform === 'darwin' ? 'macos' : 'other',
      architecture: process.arch === 'arm64' || process.arch === 'x64' ? process.arch : 'other',
      action, mode, code, unknownPending: pending,
      outcome: ['READY', 'FORM_READY', 'VIEW_OPENED', 'SIMULATION_ACCEPTED', 'SIMULATION_CANCELLED',
        'LIVE_ACCEPTED', 'LIVE_CANCELLED', 'LIVE_ENABLED', 'LIVE_DISABLED', 'PERMISSION_PROMPTED', 'STATE_RESOLVED'].includes(code)
        ? 'passed' : ['RECEIPT_UNKNOWN', 'CONFIRMATION_UNRECOGNIZED', 'NATIVE_CONFIRMATION_REQUIRED'].includes(code) ? 'unknown' : 'blocked',
      canSubmitLiveOrders: liveEnabled && process.platform === 'darwin', canRunUnattended: false,
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
          resolve(/-1743|-25211|not authorized|not allowed/i.test(stderr) ? 'AUTOMATION_DENIED' : 'SCRIPT_ERROR')
        } else resolve(stdout.trim())
      })
    })
  }
  ipcMain.handle('macThs:execute', async (event, payload: unknown): Promise<MacThsResult> => {
    const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const action: MacThsAction = MAC_THS_ACTIONS.includes(input.action as MacThsAction) ? input.action as MacThsAction : 'probe'
    const mode: MacThsMode = input.mode === 'simulation' ? 'simulation' : input.mode === 'livePreview' ? 'livePreview' : 'live'
    if (!authorized(event) || !MAC_THS_ACTIONS.includes(input.action as MacThsAction)) return result(action, mode, 'INVALID_ORDER')
    if (process.platform !== 'darwin') return result(action, mode, 'MAC_REQUIRED')
    if (busy) return result(action, mode, 'BUSY')
    busy = true
    let journal: Journal
    try {
      try { journal = loadJournal() } catch { return result(action, mode, 'JOURNAL_UNAVAILABLE', true) }
      const request = input as unknown as MacThsRequest
      if (action === 'dismissConfirmation') {
        confirmation = null
        return result(action, mode, 'USER_CANCELLED', journal.unknownPending)
      }
      if (action === 'disableLive') {
        liveEnabled = false
        confirmation = null
        return result(action, mode, 'LIVE_DISABLED', journal.unknownPending)
      }
      if (!['simulation', 'livePreview', 'live'].includes(String(request.mode))) return result(action, mode, 'INVALID_ORDER', journal.unknownPending)
      const needsOrder = action === 'preview' || action === 'submitSimulation' || action === 'submitLive'
      const order = needsOrder ? validateMacThsOrder(request.order) : undefined
      if (needsOrder && (!order || order.mode !== mode)) return result(action, mode, 'INVALID_ORDER', journal.unknownPending)
      const liveMutates = action === 'submitLive' || action === 'cancelLive'
      const simulationMutates = action === 'submitSimulation' || action === 'cancelSimulation'
      const cancels = action === 'cancelLive' || action === 'cancelSimulation'
      const mutates = liveMutates || simulationMutates
      if ((liveMutates && mode !== 'live') || (simulationMutates && mode !== 'simulation')) return result(action, mode, 'INVALID_ORDER', journal.unknownPending)
      if (liveMutates && !liveEnabled) return result(action, mode, 'LIVE_NOT_ENABLED', journal.unknownPending)
      if (action === 'authorizeLive' && (mode !== 'live' || request.liveRiskAcknowledged !== true)) return result(action, mode, 'INVALID_ORDER', journal.unknownPending)
      const requestId = order?.requestId ?? request.requestId
      if (mutates) {
        if (journal.unknownPending) return result(action, mode, 'UNKNOWN_PENDING', true)
        if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestId)) return result(action, mode, 'INVALID_ORDER')
        if (journal.usedRequests.includes(requestId)) return result(action, mode, 'DUPLICATE_REQUEST')
        if (cancels && (typeof request.contractNo !== 'string' || !/^[a-zA-Z0-9-]{1,32}$/.test(request.contractNo))) return result(action, mode, 'INVALID_ORDER')
      }
      const needsConfirmation = mutates || action === 'authorize' || action === 'resolveUnknown'
        || action === 'authorizeLive' || (action === 'preview' && mode !== 'simulation')
      if (needsConfirmation) {
        const key = JSON.stringify({ action, mode, order: order ?? null,
          requestId: mutates ? requestId : null, contractNo: cancels ? request.contractNo : null,
          liveRiskAcknowledged: action === 'authorizeLive' ? request.liveRiskAcknowledged : null })
        if (!request.confirmationToken) {
          const token = randomUUID()
          confirmation = { token, senderId: event.sender.id, key, expiresAt: Date.now() + 120000 }
          let title: string
          let message: string
          let confirmLabel: string
          if (action === 'authorize') {
            title = '允许本机交易模块控制同花顺界面？'
            message = '仅用于你本人发起的表单预览、委托和单笔撤单。不会处理登录密码、收集账户凭证或申请完全磁盘访问权限。'
            confirmLabel = '申请辅助功能权限'
          } else if (action === 'authorizeLive') {
            title = '启用本次会话的中信真实交易？'
            message = '这是真实账户交易，可能产生资金损失。你已核实相关权限并在同花顺选择正确的中信账户。每笔买卖和撤单仍需系统确认，不支持策略自动触发或无人值守；重启应用后需要重新启用。'
            confirmLabel = '启用本人确认的真实交易'
          } else if (action === 'resolveUnknown') {
            title = '先核对真实委托，再解除结果不明保护'
            message = '请先在同花顺核对上次委托、成交、撤单以及仍打开的确认弹窗。这不会认定成交成功，也不会重发原委托。未核对清楚时不要解除保护。'
            confirmLabel = '已到同花顺核对，解除保护'
          } else if (order) {
            const real = action === 'submitLive'
            const simulation = action === 'submitSimulation'
            title = real ? '确认提交中信真实买卖委托？' : simulation ? '确认模拟委托？' : '填写真实账户表单，不提交'
            message = [order.side === 'buy' ? '买入 ' + order.symbol : '卖出 ' + order.symbol,
              '限价 ' + order.price + '，数量 ' + order.quantity,
              '委托金额上限 ' + order.maxNotional + '（不含手续费）',
              real ? '将操作当前同花顺中信真实账户；下一步还需系统确认。请勿切换账户或窗口。同花顺自己的确认弹窗留给本人确认或取消。'
                : simulation ? '仅模拟账户，不切换实盘。' : '只填写并回读，不点击确定买入/卖出。'].join('\n')
            confirmLabel = real ? '继续到系统实盘确认' : simulation ? '确认模拟操作' : '只填写，不提交'
          } else {
            title = liveMutates ? '确认撤销指定的真实委托？' : '确认撤销指定模拟委托？'
            message = '仅操作委托 ' + request.contractNo + '，不使用全撤。已成交部分无法撤销，回报不明时须在同花顺核对。'
            confirmLabel = liveMutates ? '继续到系统撤单确认' : '确认模拟撤单'
          }
          return { ...result(action, mode, 'CONFIRMATION_REQUIRED', journal.unknownPending),
            confirmation: { token, title, message, confirmLabel } }
        }
        const offered = confirmation
        confirmation = null
        if (!offered || typeof request.confirmationToken !== 'string' || offered.token !== request.confirmationToken
          || offered.senderId !== event.sender.id || offered.key !== key || offered.expiresAt < Date.now()) {
          return result(action, mode, 'CONFIRMATION_EXPIRED', journal.unknownPending)
        }
      }
      if (action === 'authorize') {
        systemPreferences.isTrustedAccessibilityClient(true)
        return result(action, mode, 'PERMISSION_PROMPTED', journal.unknownPending)
      }
      if (action === 'resolveUnknown') {
        journal.unknownPending = false
        saveJournal(journal)
        return result(action, mode, 'STATE_RESOLVED')
      }
      if (!systemPreferences.isTrustedAccessibilityClient(false)) return result(action, mode, 'ACCESSIBILITY_REQUIRED', journal.unknownPending)
      if (action === 'authorizeLive') {
        const output = await execute(macThsScript('probe', 'live'))
        const code = MAC_THS_CODES.includes(output as MacThsCode) ? output as MacThsCode : 'SCRIPT_ERROR'
        if (code !== 'READY') return result(action, mode, code, journal.unknownPending)
        liveEnabled = true
        return result(action, mode, 'LIVE_ENABLED', journal.unknownPending)
      }
      if (liveMutates) {
        const parent = getWindow()
        if (!parent || parent.isDestroyed()) return result(action, mode, 'INVALID_ORDER', journal.unknownPending)
        const detail = order ? [
          '方向：' + (order.side === 'buy' ? '买入' : '卖出'), '股票代码：' + order.symbol,
          '限价：' + order.price, '数量：' + order.quantity,
          '委托金额上限：' + order.maxNotional + '（不含手续费）',
          '账户：当前同花顺中选择的中信证券真实账户',
          '请勿切换账户或窗口。本操作不自动重试；同花顺弹窗仍由本人核对确认。',
        ].join('\n') : '仅撤销当前中信真实账户的委托 ' + request.contractNo + '。已成交部分无法撤销，不使用全撤。'
        const review = await dialog.showMessageBox(parent, { type: 'warning',
          title: '中信证券真实交易确认', message: order ? '这笔委托将使用真实资金，请本人核对后确认。' : '确认撤销这笔真实委托？',
          detail, buttons: ['取消', order ? '确认提交真实' + (order.side === 'buy' ? '买入' : '卖出') : '确认真实撤单'],
          defaultId: 0, cancelId: 0, noLink: true })
        if (review.response !== 1) return result(action, mode, 'USER_CANCELLED', journal.unknownPending)
        if (!authorized(event) || !liveEnabled) return result(action, mode, 'INVALID_ORDER', journal.unknownPending)
      }
      if (mutates) {
        journal.unknownPending = true
        journal.usedRequests.push(requestId!)
        saveJournal(journal)
      }
      const output = await execute(macThsScript(action, mode, order ?? undefined, request.contractNo ?? ''))
      const [rawCode, rawContract] = output.split('|')
      let code: MacThsCode = MAC_THS_CODES.includes(rawCode as MacThsCode) ? rawCode as MacThsCode : 'SCRIPT_ERROR'
      const accepted = code === 'SIMULATION_ACCEPTED' || code === 'LIVE_ACCEPTED'
      const contract = accepted && /^[a-zA-Z0-9-]{1,32}$/.test(rawContract ?? '') ? rawContract : undefined
      if (accepted && !contract) code = 'RECEIPT_UNKNOWN'
      if (mutates) {
        const safeBlocked = ['CLIENT_NOT_RUNNING', 'TRADE_VIEW_REQUIRED', 'MODE_UNVERIFIED', 'LAYOUT_UNSUPPORTED',
          'BROKER_UNVERIFIED', 'READBACK_MISMATCH', 'TABLE_UNSUPPORTED', 'CANCEL_CONTROL_UNSUPPORTED', 'ORDER_CONTROL_DISABLED']
        if (['SIMULATION_ACCEPTED', 'SIMULATION_CANCELLED', 'LIVE_ACCEPTED', 'LIVE_CANCELLED'].includes(code) || safeBlocked.includes(code)) journal.unknownPending = false
        else { journal.unknownPending = true; if (code === 'SCRIPT_ERROR' || code === 'AUTOMATION_DENIED') code = 'RECEIPT_UNKNOWN' }
        saveJournal(journal)
      }
      return result(action, mode, code, journal.unknownPending, contract)
    } catch {
      return result(action, mode, 'JOURNAL_UNAVAILABLE', true)
    } finally { busy = false }
  })
}
