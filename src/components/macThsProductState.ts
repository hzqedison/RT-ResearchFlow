import type { MacThsProductState, MacThsRequest, MacThsResult } from '../../electron/shared/macThsTypes'

const STATES = {
  STARTING: ['正在检查本机委托记录', '尚未完成持久检查，不能提交或重试。'],
  SYNCING: ['正在读取防重复状态', '同步完成前保持保护，不以旧页面结果判断可交易。'],
  NOT_INITIALIZED: ['本机委托记录尚未初始化', '仅无旧交易残件的新域可明确初始化；不是清空旧记录。'],
  READY_DISABLED: ['记录可用，真实会话关闭', '不会自动启用；本人授权后，每笔仍需应用内和原生确认。'],
  READY_ENABLED: ['真实会话已启用', '允许准备不等于已下单；每笔真实操作仍需逐项确认。'],
  AWAITING_CONFIRMATION: ['等待本人确认', '确认绑定同一持久意图；不会自动接受原生确认框。'],
  EXECUTING: ['本机操作进行中', '不要重复提交、排队或切换账户；等待权威回报。'],
  REVIEW_REQUIRED: ['有委托结果待逐条核对', '原意图禁止重试；人工陈述不是机器对账或成交证明。'],
  RECOVERY_REQUIRED: ['本机记录需要恢复检查', '恢复不是重发；只确认当前可信计划，不自动恢复或启用交易。'],
  BLOCKED_STORAGE: ['委托存储不可用', '保持禁止交易，不清空、重建或绕开旧记录。'],
  EXECUTOR_UNPROVEN: ['执行器退出尚未证实', '终止请求或超时不是退出证明，人审也不能替代此证明。'],
  STOPPING: ['正在停止本机交易服务', '退出未完成不代表订单已取消；不接收新的交易操作。'],
  UNSUPPORTED_PLATFORM: ['此平台不支持本机交易执行', '不能启用真实交易，不控制此平台的同花顺。'],
} as const
const CODES: Record<string, string> = {
  READY: '连接观察不等于券商权限或成交已验证。', MAC_REQUIRED: '本机执行仅支持 Mac。',
  UNSUPPORTED_PLATFORM: '当前平台不执行同花顺交易。', CLIENT_NOT_RUNNING: '请本人启动同花顺、登录并打开交易页面。',
  ACCESSIBILITY_REQUIRED: '请在系统设置授予辅助功能权限，不需要完全磁盘访问。',
  AUTOMATION_DENIED: '请检查同花顺与 System Events 的自动化权限。',
  TRADE_VIEW_REQUIRED: '请本人打开交易页面并处理仍存在的弹窗，本应用不代点券商确认。',
  MODE_UNVERIFIED: '真实 A 股模式未可靠识别，不能继续提交。',
  LAYOUT_UNSUPPORTED: '布局未兼容，请反馈缺失的字段类别，不提供账户表格或原始日志。',
  BROKER_UNVERIFIED: '账户标记未可靠识别或已变化，不能继续提交。', ACCOUNT_UNVERIFIED: '当前账户无法可靠区分。',
  INVALID_ORDER: '参数不合格，请核对普通主板、手工限价、数量及金额上限。', BUSY: '已有本机操作，不重复发送或排队。',
  JOURNAL_UNAVAILABLE: '防重复记录不可用，不能继续交易。', STORAGE_UNAVAILABLE: '持久记录不可用，未确认操作禁止重试。',
  STORAGE_RECOVERED_REVIEW_REQUIRED: '记录已恢复，仍须逐条本人核对，未自动启用或重发。',
  LEGACY_WRITER_UNFENCED: '旧 1.2 来源没有可信退役封存，迁移尚未可用；保留旧记录，不绕过。',
  LEGACY_SOURCE_UNSUPPORTED: '旧来源尚无可用的可信迁移证明，保持保护。',
  RECOVERY_REQUIRED: '需要检查并明确确认可信恢复计划。', RECOVERY_PLAN_CHANGED: '恢复计划已变化，不用新计划自动重试。',
  UNKNOWN_PENDING: '结果尚待核对，原意图禁止重试。', EXECUTOR_EXIT_UNPROVEN: '执行器真实退出未被证实，保持保护。',
  DUPLICATE_REQUEST: '原请求不会重新发送，请查看持久记录。', USER_CANCELLED: '本次确认已取消，不自动重试。',
  READBACK_MISMATCH: '参数回读不一致，停止继续提交。', FORM_READY: '仅填写并回读，不代表已提交委托。',
  VIEW_OPENED: '已请求打开对应页面，请本人在同花顺查看。', TABLE_UNSUPPORTED: '委托字段未可靠识别，停止继续操作。',
  RECEIPT_UNKNOWN: '可能已经送出但回报未知，请逐条核对，不再次提交。',
  CANCEL_CONTROL_UNSUPPORTED: '单笔撤单控件未可靠识别，不使用全撤或盲目操作。',
  CONFIRMATION_UNRECOGNIZED: '确认内容未通过核对，不重复发送。', SCRIPT_ERROR: '本机调用未完成，不能推断没有送出。',
  PERMISSION_PROMPTED: '权限申请已发出，允许后由本人检查。', CONFIRMATION_REQUIRED: '核对同一操作后才继续。',
  CONFIRMATION_EXPIRED: '确认已过期或绑定已变化，不执行或自动续期。', LIVE_ENABLED: '会话授权不等于每笔订单授权。',
  LIVE_DISABLED: '真实会话已关闭，不等于取消已送出的委托。', LIVE_NOT_ENABLED: '请本人明确授权本次真实会话。',
  LIVE_ACCEPTED: '已有受理观察，不等于成交。', LIVE_CANCELLED: '已有撤单观察，已成交部分不能撤销。',
  NATIVE_CONFIRMATION_REQUIRED: '请到同花顺本人确认或取消原生弹窗，本应用不替你点击。',
  ORDER_CONTROL_DISABLED: '原生提交或撤单控件不可用。', NOT_INITIALIZED: '本机记录尚未初始化。', STOPPING: '服务停止中。',
}
export function macThsCodeMessage(code: unknown): string {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(CODES, code)
    ? CODES[code] : '原因未识别；保持当前持久门禁，未确认操作不要重试。'
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
export function isMacThsProductState(value: unknown): value is MacThsProductState {
  if (!value || typeof value !== 'object') return false
  const s = value as MacThsProductState
  return s.schemaVersion === 1 && s.adapterVersion === '3' && text(s.sessionId)
    && Number.isSafeInteger(s.stateSequence) && s.stateSequence >= 0 && typeof s.code === 'string'
    && Object.prototype.hasOwnProperty.call(STATES, s.serviceState) && ['idle', 'running', 'unproven', 'stopping'].includes(s.executorState)
    && [s.liveEnabled, s.unknownPending, s.canPrepare, s.canConfirm, s.canRecover, s.canReview, s.canInitialize].every(x => typeof x === 'boolean')
    && Array.isArray(s.intents) && s.intents.every(i => i && text(i.intentId) && Number.isSafeInteger(i.revision) && i.revision >= 0
      && ['PREPARED', 'CONFIRMED', 'UNKNOWN', 'ABANDONED', 'NOT_SUBMITTED', 'ACCEPTED_OBSERVED', 'CANCEL_OBSERVED', 'LEGACY_UNKNOWN'].includes(i.state)
      && [i.gateReleased, i.executionForbidden, i.recoveryQuarantine].every(x => typeof x === 'boolean'))
}
export type MacThsStateNotice = Pick<MacThsProductState, 'sessionId' | 'stateSequence'>
export interface MacThsStateCursor {
  epoch: number; state: MacThsProductState | null; expectedSessionId: string | null
  minimumSequence: number; retiredSessionIds: readonly string[]
}
export function createMacThsStateCursor(): MacThsStateCursor {
  return { epoch: 0, state: null, expectedSessionId: null, minimumSequence: 0, retiredSessionIds: [] }
}
export function beginMacThsStateRead(c: MacThsStateCursor, notice?: MacThsStateNotice): MacThsStateCursor | null {
  if (notice && (!text(notice.sessionId) || !Number.isSafeInteger(notice.stateSequence) || notice.stateSequence < 0
    || c.retiredSessionIds.includes(notice.sessionId))) return null
  if (notice && c.state && notice.sessionId === c.state.sessionId && notice.stateSequence < c.state.stateSequence) return null
  return { ...c, epoch: c.epoch + 1,
    retiredSessionIds: notice && c.state && notice.sessionId !== c.state.sessionId
      ? [...new Set([...c.retiredSessionIds, c.state.sessionId])] : c.retiredSessionIds,
    expectedSessionId: notice?.sessionId ?? c.expectedSessionId,
    minimumSequence: notice ? notice.sessionId === c.expectedSessionId ? Math.max(c.minimumSequence, notice.stateSequence) : notice.stateSequence : c.minimumSequence }
}
export function acceptMacThsStateRead(c: MacThsStateCursor, epoch: number, value: unknown): MacThsStateCursor | null {
  if (epoch !== c.epoch || !isMacThsProductState(value) || c.retiredSessionIds.includes(value.sessionId)) return null
  if (value.sessionId === c.expectedSessionId && value.stateSequence < c.minimumSequence) return null
  if (value.sessionId === c.state?.sessionId && value.stateSequence < c.state.stateSequence) return null
  return { ...c, state: { ...value, intents: value.intents.map(i => ({ ...i })), recovery: value.recovery ? { ...value.recovery } : null,
    coverage: value.coverage ? { ...value.coverage } : null, capabilities: value.capabilities ? { ...value.capabilities } : null },
    retiredSessionIds: c.state && c.state.sessionId !== value.sessionId ? [...new Set([...c.retiredSessionIds, c.state.sessionId])] : c.retiredSessionIds,
    expectedSessionId: value.sessionId, minimumSequence: value.stateSequence }
}
export function currentMacThsActionResponse(c: MacThsStateCursor, state: MacThsProductState, sessionId: string): boolean {
  return state.sessionId === sessionId && c.state?.sessionId === sessionId && !!acceptMacThsStateRead(c, c.epoch, state)
}
export function needsMacThsIntentReview(i: MacThsProductState['intents'][number]): boolean {
  return ((i.state === 'UNKNOWN' || i.state === 'LEGACY_UNKNOWN') && !i.gateReleased) || i.recoveryQuarantine
}
const FIELDS = [['account', '账户区分'], ['mode', '真实 A 股模式'], ['tradingDate', '实际交易日'], ['headers', '委托表头'], ['readback', '参数回读'], ['receipt', '原生回报']] as const
const NEXT_ACTIONS = {
  open_trade_view: '请本人打开同花顺交易页面。', select_account: '请本人选择可区分的正确账户。',
  show_dated_orders: '请本人打开带实际交易日期的委托页面。', review_native_dialog: '请本人核对并处理原生确认弹窗。',
  check_again: '请本人检查客户端后明确检查连接，不自动重试未决操作。',
}
export function macThsCapabilityHints(s: MacThsProductState | null): string[] {
  const caps = s?.capabilities
  if (!caps) return ['原生字段能力尚未观察；未验证你的客户端或账户兼容性。']
  const labels: Record<string, string> = { missing: '缺失', ambiguous: '有歧义', invalid: '无效' }
  const hints = FIELDS.filter(([field]) => caps[field] !== 'recognized').map(([field, label]) => label + '：' + (labels[caps[field]] ?? '尚未可靠识别'))
  if (Object.prototype.hasOwnProperty.call(NEXT_ACTIONS, caps.nextAction)) hints.push(NEXT_ACTIONS[caps.nextAction])
  if (!hints.length) hints.push('已有字段观察，不代表真实设备兼容、券商权限或成交已经验证。')
  return hints
}
export function buildMacThsProductView(state: MacThsProductState | null, options: { isMac: boolean; synchronized: boolean; uncertainOperation?: boolean }) {
  const s = isMacThsProductState(state) ? state : null
  const pendingIntents = s?.intents.filter(needsMacThsIntentReview) ?? []
  const idle = s?.executorState === 'idle'
  const pending = pendingIntents.length > 0 || s?.unknownPending === true
  const available = options.isMac && options.synchronized && !!s
  let phase: keyof typeof STATES | 'UNAVAILABLE' = s?.serviceState ?? 'UNAVAILABLE'
  if (!options.isMac) phase = 'UNSUPPORTED_PLATFORM'
  else if (!options.synchronized || !s) phase = 'UNAVAILABLE'
  else if (phase !== 'BLOCKED_STORAGE' && phase !== 'STARTING' && phase !== 'SYNCING') {
    if (s.executorState === 'stopping' || phase === 'STOPPING') phase = 'STOPPING'
    else if (s.executorState === 'unproven') phase = 'EXECUTOR_UNPROVEN'
    else if (phase !== 'RECOVERY_REQUIRED') {
      if (s.executorState === 'running') phase = 'EXECUTING'
      else if (pending) phase = 'REVIEW_REQUIRED'
    }
  }
  const ready = phase === 'READY_DISABLED' || phase === 'READY_ENABLED'
  const preparation = available && ready && idle && !pending && !options.uncertainOperation && s?.canPrepare === true
  const nativeViews = available && idle && (ready || phase === 'REVIEW_REQUIRED')
  const p = s?.recovery
  const messages = phase === 'UNAVAILABLE' ? ['权威状态尚未读取成功', '保持保护；不能把旧结果或调用失败当作没有送出。'] : STATES[phase]
  return { phase, title: messages[0], description: messages[1], pendingIntents,
    canInspect: nativeViews, canPreview: preparation,
    canEnable: preparation && phase === 'READY_DISABLED' && s?.liveEnabled === false,
    canDisable: available && s?.liveEnabled === true && phase !== 'STOPPING' && phase !== 'UNSUPPORTED_PLATFORM',
    canSubmit: preparation && phase === 'READY_ENABLED' && s?.liveEnabled === true,
    canConfirm: available && idle && phase === 'AWAITING_CONFIRMATION' && !pending && s?.canConfirm === true,
    canInitialize: available && phase === 'NOT_INITIALIZED' && idle && !pending && s?.canInitialize === true,
    canProvisionLegacy: available && phase === 'RECOVERY_REQUIRED' && idle && !options.uncertainOperation
      && s?.canProvisionLegacy === true,
    canRecover: available && phase === 'RECOVERY_REQUIRED' && idle && s?.canRecover === true && p?.canApply === true
      && text(p.recoveryId) && text(p.manifestHash) && Number.isSafeInteger(p.revision) && p.revision >= 0,
    canReview: available && idle && phase === 'REVIEW_REQUIRED' && s?.canReview === true,
    capabilityHints: macThsCapabilityHints(s) }
}
export function bindMacThsRequestId(request: MacThsRequest, requestId: string): MacThsRequest {
  return { ...request, requestId, ...(request.order ? { order: { ...request.order, requestId } } : {}) }
}
export function isMacThsTradeRequest(r: MacThsRequest): boolean { return r.action === 'submitLive' || r.action === 'cancelLive' }
export function macThsConfirmationMatches(s: MacThsProductState | null, confirmation: NonNullable<MacThsResult['confirmation']>, now: number, request: MacThsRequest): boolean {
  if (!isMacThsProductState(s) || confirmation.sessionId !== s.sessionId || !Number.isFinite(confirmation.expiresAt)
    || confirmation.expiresAt <= now || !request || !buildMacThsProductView(s, { isMac: true, synchronized: true }).canConfirm) return false
  const requiresBinding = ['submitLive', 'cancelLive', 'submitSimulation', 'cancelSimulation'].includes(request.action)
  const b = confirmation.intentBinding
  if (!b) return !requiresBinding
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
  if (typeof b.intentId !== 'string' || !uuid.test(b.intentId) || typeof b.snapshotHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(b.snapshotHash) || !Number.isSafeInteger(b.expectedRevision) || b.expectedRevision <= 0) return false
  if (requiresBinding && (typeof request.requestId !== 'string' || !uuid.test(request.requestId)
    || (request.order && request.order.requestId !== request.requestId))) return false
  return s.intents.some(i => i.intentId === b.intentId && i.snapshotHash === b.snapshotHash && i.revision === b.expectedRevision
    && !i.gateReleased && (!requiresBinding || i.requestId === request.requestId))
}
export function macThsIntentLabel(state: MacThsProductState['intents'][number]['state']): string {
  return { PREPARED: '已持久准备，未证明已提交', CONFIRMED: '已确认，仍以执行回报为准', UNKNOWN: '结果未知',
    LEGACY_UNKNOWN: '旧来源结果未知', ABANDONED: '已放弃此意图', NOT_SUBMITTED: '已有未提交证据',
    ACCEPTED_OBSERVED: '已有受理观察，不等于成交', CANCEL_OBSERVED: '已有撤单观察' }[state] ?? '意图状态未知'
}
/** Whitelist projection for export, not a new IPC DTO or native evidence. */
export function safeMacThsProductStateDiagnostic(s: MacThsProductState | null) {
  if (!isMacThsProductState(s)) return { loaded: false }
  return { loaded: true, schemaVersion: 1, adapterVersion: '3', serviceState: s.serviceState,
    code: Object.prototype.hasOwnProperty.call(CODES, s.code) ? s.code : 'UNRECOGNIZED_STATE',
    liveEnabled: s.liveEnabled, executorState: s.executorState, unknownPending: s.unknownPending,
    intentCount: s.intents.length, pendingReviewCount: s.intents.filter(needsMacThsIntentReview).length,
    quarantineCount: s.intents.filter(i => i.recoveryQuarantine).length,
    executionForbiddenCount: s.intents.filter(i => i.executionForbidden).length,
    recoveryAvailable: s.canRecover && s.recovery?.canApply === true, earlierIds: 'unavailable', capabilityHints: macThsCapabilityHints(s) }
}
