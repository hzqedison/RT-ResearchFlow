import { useCallback, useEffect, useRef, useState } from 'react'
import { safeMacThsDiagnostic, validateMacThsOrder, type MacThsMode, type MacThsConfirmation,
  type MacThsProductState, type MacThsRequest, type MacThsResult } from '../../electron/shared/macThsTypes'
import { AppConfirmDialog } from './shared/AppConfirmDialog'
import { acceptMacThsStateRead, beginMacThsStateRead, bindMacThsRequestId, buildMacThsProductView,
  createMacThsStateCursor, currentMacThsActionResponse, isMacThsTradeRequest, macThsCodeMessage,
  macThsConfirmationMatches, macThsIntentLabel, safeMacThsProductStateDiagnostic, type MacThsStateNotice } from './macThsProductState'
import './MacTradingPanel.css'

type RecoveryCommand = Parameters<Window['api']['macThs']['recover']>[0]
type ReviewCommand = Parameters<Window['api']['macThs']['reviewIntent']>[0]
type Intent = MacThsProductState['intents'][number]
type Choice = ReviewCommand['observation']
type Operation = { request: MacThsRequest; sessionId: string; uncertain: boolean }
type Flow = { kind: 'execute'; operation: Operation; review: MacThsConfirmation; auxiliary: boolean }
  | { kind: 'recovery'; command: RecoveryCommand; sessionId: string }
  | { kind: 'review'; command: ReviewCommand; sessionId: string }
const SCOPES = [['orders', '已查看委托'], ['deals', '已查看成交'], ['confirmation', '已核对仍存在的确认弹窗']] as const
const STATEMENTS: Array<[Choice['statement'], string]> = [['still_uncertain', '仍不确定（不解除门禁）'],
  ['order_seen', '本人看到相关委托'], ['cancel_seen', '本人看到相关撤单'], ['no_order_seen', '本人未看到委托（不是机器未提交证据）']]
const intentKey = (i: Intent) => JSON.stringify([i.intentId, i.snapshotHash, i.revision, i.recoveryId])

export default function MacTradingPanel({ confirmationHost }: { confirmationHost?: HTMLElement | null }) {
  const isMac = typeof navigator !== 'undefined' && /^Mac/i.test(navigator.platform)
  const mode: MacThsMode = 'live'
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [symbol, setSymbol] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [maxNotional, setMaxNotional] = useState('')
  const [contractNo, setContractNo] = useState('')
  const [riskAcknowledged, setRiskAcknowledged] = useState(false)
  const [additionalId, setAdditionalId] = useState('')
  const [additionalAcknowledged, setAdditionalAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(true)
  const [synchronized, setSynchronized] = useState(false)
  const [state, setState] = useState<MacThsProductState | null>(null)
  const [result, setResult] = useState<MacThsResult | null>(null)
  const [notice, setNotice] = useState('')
  const [flow, setFlow] = useState<Flow | null>(null)
  const [pending, setPending] = useState<Operation | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const mounted = useRef(false)
  const busyRef = useRef(false)
  const cursor = useRef(createMacThsStateCursor())
  const latestStateRead = useRef<Promise<MacThsProductState | null> | null>(null)
  const synchronizedRef = useRef(false)
  const pendingRef = useRef<Operation | null>(null)
  const flowRef = useRef<Flow | null>(null)
  const reviewRequests = useRef(new Map<string, { command: ReviewCommand; sent: boolean; uncertain: boolean }>())
  const recoveryUnknown = useRef(new Set<string>())
  const view = buildMacThsProductView(state, { isMac, synchronized, uncertainOperation: pending?.uncertain })
  const valid = isMac && !!validateMacThsOrder({ requestId: '00000000-0000-4000-8000-000000000000',
    mode, side, symbol, price, quantity: Number(quantity), maxNotional })
  const changeFlow = useCallback((next: Flow | null) => { flowRef.current = next; setFlow(next) }, [])
  const changeOperation = useCallback((next: Operation | null) => { pendingRef.current = next; setPending(next) }, [])

  const readState = useCallback(async (notification?: MacThsStateNotice): Promise<MacThsProductState | null> => {
    if (!mounted.current) return null
    const started = beginMacThsStateRead(cursor.current, notification)
    if (!started) return null
    cursor.current = started
    let finishRead!: (value: MacThsProductState | null) => void
    let completedState: MacThsProductState | null = null
    latestStateRead.current = new Promise(resolve => { finishRead = resolve })
    synchronizedRef.current = false
    setReading(true); setSynchronized(false)
    try {
      if (typeof window.api?.macThs?.getState !== 'function') throw new Error('STATE_BRIDGE_UNAVAILABLE')
      const incoming = await window.api.macThs.getState()
      if (!mounted.current) return null
      const accepted = acceptMacThsStateRead(cursor.current, started.epoch, incoming)
      if (!accepted) {
        if (cursor.current.epoch === started.epoch) setNotice('读取结果已过时或无法核验，仍保持保护；请读取最新状态。')
        return null
      }
      cursor.current = accepted
      completedState = accepted.state
      synchronizedRef.current = true
      setState(accepted.state); setSynchronized(true)
      const operation = pendingRef.current
      if (operation && accepted.state) {
        const intent = accepted.state.intents.find(i => i.requestId === operation.request.requestId)
        if (intent?.gateReleased || (!isMacThsTradeRequest(operation.request) && accepted.state.executorState === 'idle')) changeOperation(null)
      }
      return accepted.state
    } catch {
      if (mounted.current && cursor.current.epoch === started.epoch) {
        setNotice('权威状态读取失败，保持禁止交易；不能认为没有送出，不自动重试。')
        changeFlow(null)
      }
      return null
    } finally {
      if (mounted.current && cursor.current.epoch === started.epoch) setReading(false)
      finishRead(completedState)
    }
  }, [changeFlow, changeOperation])

  useEffect(() => {
    mounted.current = true
    const onFocus = () => { void readState() }
    const unsubscribe = typeof window.api?.macThs?.onStateChanged === 'function'
      ? window.api.macThs.onStateChanged(notification => { void readState(notification) }) : undefined
    window.addEventListener('focus', onFocus)
    void readState()
    return () => {
      mounted.current = false
      cursor.current = { ...cursor.current, epoch: cursor.current.epoch + 1 }
      synchronizedRef.current = false
      window.removeEventListener('focus', onFocus)
      unsubscribe?.()
    }
  }, [readState])

  useEffect(() => {
    if (!state || busy || !synchronized || !flow) return
    const sameSession = flow.kind === 'execute' ? flow.review.sessionId === state.sessionId : flow.sessionId === state.sessionId
    const matches = sameSession && (flow.kind === 'execute' ? macThsConfirmationMatches(state, flow.review, Date.now(), flow.operation.request)
      : flow.kind === 'recovery' ? recoveryMatches(flow.command, state) : reviewMatches(flow.command, state))
    if (!matches) {
      changeFlow(null)
      setNotice('确认绑定或状态已变化，本次确认已撤下；不会用新版本自动重试。')
    }
  }, [state, busy, synchronized, flow, changeFlow, isMac])

  async function executeRequest(request: MacThsRequest, operation: Operation, auxiliary = false) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setNotice('')
    if (!auxiliary) changeOperation(operation)
    let response: MacThsResult | null = null
    try {
      response = await window.api.macThs.execute(request)
      if (!mounted.current) return
      if (currentMacThsActionResponse(cursor.current, response.state, operation.sessionId)) {
        setResult(response)
        if (response.contractNo) setContractNo(response.contractNo)
      }
    } catch {
      if (mounted.current) {
        if (!auxiliary) changeOperation({ ...operation, uncertain: true })
        changeFlow(null)
        setNotice('本次调用回报未知，原操作 ID 保留，禁止重试；先读取权威状态并逐条核对。')
      }
    } finally {
      let authoritative = await readState()
      // A notice/focus read may supersede this read. Await those existing reads;
      // do not discard the offered ticket solely because our epoch lost the race.
      // No extra IPC read or execute is issued, and failed latest reads stay closed.
      let latestRead = latestStateRead.current
      while (mounted.current && latestRead) {
        const latestState = await latestRead
        if (latestRead === latestStateRead.current) {
          authoritative = synchronizedRef.current ? latestState : null
          break
        }
        latestRead = latestStateRead.current
      }
      if (mounted.current) {
        if (response?.code === 'CONFIRMATION_REQUIRED' && response.confirmation && authoritative
          && macThsConfirmationMatches(authoritative, response.confirmation, Date.now(), operation.request)) {
          if (!auxiliary) changeOperation(operation)
          changeFlow({ kind: 'execute', operation, review: response.confirmation, auxiliary })
        } else {
          changeFlow(null)
          if (!auxiliary && response && authoritative?.sessionId === operation.sessionId) {
            const intent = authoritative.intents.find(i => i.requestId === operation.request.requestId)
            const ambiguous = ['RECEIPT_UNKNOWN', 'NATIVE_CONFIRMATION_REQUIRED', 'SCRIPT_ERROR', 'STORAGE_UNAVAILABLE', 'JOURNAL_UNAVAILABLE'].includes(response.code)
            if (intent && !intent.gateReleased) changeOperation({ ...operation, uncertain: true })
            else if (!ambiguous || intent?.gateReleased) changeOperation(null)
            else changeOperation({ ...operation, uncertain: true })
          }
        }
        setBusy(false)
      }
      busyRef.current = false
    }
  }

  async function run(action: MacThsRequest['action']) {
    const inspection = ['probe', 'authorize', 'queryOrders', 'queryDeals'].includes(action)
    if (busyRef.current || !synchronizedRef.current || (pendingRef.current && !inspection)) return
    const current = cursor.current.state
    if (!current) return
    const gate = buildMacThsProductView(current, { isMac, synchronized: true, uncertainOperation: pendingRef.current?.uncertain })
    const permitted = action === 'submitLive' || action === 'cancelLive' ? gate.canSubmit
      : action === 'preview' ? gate.canPreview : action === 'authorizeLive' ? gate.canEnable
        : action === 'disableLive' ? gate.canDisable : gate.canInspect
    if (!permitted) return
    const id = crypto.randomUUID()
    const request = bindMacThsRequestId({ action, mode,
      ...(action === 'preview' || action === 'submitLive' ? { order: { requestId: id, mode, side, symbol, price, quantity: Number(quantity), maxNotional } } : {}),
      ...(action === 'cancelLive' ? { contractNo: contractNo.trim() } : {}),
      ...(['authorizeLive', 'submitLive', 'cancelLive'].includes(action) ? { liveRiskAcknowledged: riskAcknowledged } : {}),
      ...(action === 'submitLive' && additionalId && additionalAcknowledged ? { additionalOrder: { previousIntentId: additionalId, additionalOrderAcknowledged: true as const } } : {}),
    }, id)
    await executeRequest(request, { request, sessionId: current.sessionId, uncertain: false }, !!pendingRef.current && inspection)
  }

  function cancelReview() {
    const current = flowRef.current
    changeFlow(null)
    if (current?.kind === 'execute') void executeRequest({ action: 'dismissConfirmation', mode,
      requestId: current.operation.request.requestId, confirmationToken: current.review.token,
      ...(current.review.intentBinding ? { intentBinding: current.review.intentBinding } : {}) }, current.operation, current.auxiliary)
  }
  function editInput(change: () => void) {
    if (busyRef.current) return
    if (flowRef.current?.kind === 'execute') cancelReview()
    change()
  }
  function recoveryMatches(command: RecoveryCommand, current: MacThsProductState): boolean {
    const gate = buildMacThsProductView(current, { isMac, synchronized: synchronizedRef.current })
    if (command.kind === 'initialize') return gate.canInitialize
    if (command.kind === 'provisionLegacy') return gate.canProvisionLegacy
    if (command.kind !== 'apply') return false
    const plan = current.recovery
    return gate.canRecover && !!plan && plan.recoveryId === command.recoveryId
      && plan.manifestHash === command.manifestHash && plan.revision === command.expectedRevision
  }
  function reviewMatches(command: ReviewCommand, current: MacThsProductState): boolean {
    return buildMacThsProductView(current, { isMac, synchronized: synchronizedRef.current }).canReview
      && current.intents.some(i => i.intentId === command.intentId && i.snapshotHash === command.snapshotHash
        && i.revision === command.expectedRevision && (i.recoveryId ?? undefined) === command.recoveryId)
  }
  function stageRecovery() {
    if (!state || busyRef.current || !(view.canInitialize || view.canRecover)) return
    const p = state.recovery
    const command: RecoveryCommand = view.canInitialize ? { kind: 'initialize' }
      : { kind: 'apply', recoveryId: p!.recoveryId!, manifestHash: p!.manifestHash!, expectedRevision: p!.revision }
    if (!recoveryMatches(command, state) || recoveryUnknown.current.has(JSON.stringify(command))) return
    changeFlow({ kind: 'recovery', command, sessionId: state.sessionId })
  }
  function stageProvisionLegacy() {
    if (!state || busyRef.current || pendingRef.current || !view.canProvisionLegacy) return
    const command: RecoveryCommand = { kind: 'provisionLegacy' }
    if (!recoveryMatches(command, state) || recoveryUnknown.current.has(JSON.stringify(command))) return
    changeFlow({ kind: 'recovery', command, sessionId: state.sessionId })
  }
  function stageIntentReview(intent: Intent, choice: Choice) {
    if (!state || !view.canReview || busyRef.current) return
    const key = intentKey(intent)
    const existing = reviewRequests.current.get(key)
    if (existing?.sent || !choice.scope.length || (choice.releaseGate && (choice.statement === 'still_uncertain' || SCOPES.some(([scope]) => !choice.scope.includes(scope))))) return
    const command: ReviewCommand = { intentId: intent.intentId, snapshotHash: intent.snapshotHash, expectedRevision: intent.revision,
      ...(intent.recoveryId ? { recoveryId: intent.recoveryId } : {}), reviewRequestId: existing?.command.reviewRequestId ?? crypto.randomUUID(),
      observation: { ...choice, scope: [...choice.scope] } }
    reviewRequests.current.set(key, { command, sent: false, uncertain: false })
    changeFlow({ kind: 'review', command, sessionId: state.sessionId })
  }
  async function confirmFlow() {
    const selected = flowRef.current
    const current = cursor.current.state
    if (!selected || !current || busyRef.current || !synchronizedRef.current) return
    if (selected.kind === 'execute') {
      if (!macThsConfirmationMatches(current, selected.review, Date.now(), selected.operation.request)) {
        setNotice('确认已过期或绑定已变化，不继续提交。'); cancelReview(); return
      }
      void executeRequest({ ...selected.operation.request, confirmationToken: selected.review.token,
        ...(selected.review.intentBinding ? { intentBinding: selected.review.intentBinding } : {}) }, selected.operation, selected.auxiliary)
      return
    }
    const matches = current.sessionId === selected.sessionId && (selected.kind === 'recovery' ? recoveryMatches(selected.command, current) : reviewMatches(selected.command, current))
    if (!matches) { changeFlow(null); setNotice('计划或版本已变化，请重新核对，不自动重试。'); void readState(); return }
    busyRef.current = true
    setBusy(true); setNotice('')
    if (selected.kind === 'review') for (const record of reviewRequests.current.values()) if (record.command.reviewRequestId === selected.command.reviewRequestId) record.sent = true
    try {
      if (selected.kind === 'recovery') await window.api.macThs.recover(selected.command)
      else await window.api.macThs.reviewIntent(selected.command)
    } catch {
      if (selected.kind === 'recovery') recoveryUnknown.current.add(JSON.stringify(selected.command))
      else for (const record of reviewRequests.current.values()) if (record.command.reviewRequestId === selected.command.reviewRequestId) record.uncertain = true
      if (mounted.current) setNotice('恢复或人审回报未知，禁止重复发送；先读取最新状态，保护仍保留。')
    } finally {
      if (mounted.current) changeFlow(null)
      await readState()
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const diagnostic = { ...safeMacThsDiagnostic(result, state), productState: safeMacThsProductStateDiagnostic(state) }
  function exportResult() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(diagnostic, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'RT-ResearchFlow-mac-ths-result-v3.json'
    document.body.appendChild(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('仅导出白名单状态、字段类别及计数，不含账户、订单、ID/hash、确认票、编号、路径或原始日志，不自动上传。')
  }
  const reviewedIntent = flow?.kind === 'review' ? state?.intents.find(i => i.intentId === flow.command.intentId) : null
  const title = flow?.kind === 'execute' ? flow.review.title : flow?.kind === 'review' ? '逐条核对本机委托记录'
    : flow?.kind === 'recovery' && flow.command.kind === 'provisionLegacy' ? '确认准备可信旧记录导入' : '确认本机委托记录操作'
  const message = flow?.kind === 'execute' ? flow.review.message : flow?.kind === 'recovery'
    ? flow.command.kind === 'initialize' ? '仅初始化后端确认无旧交易残件的新域，不清空或绕过旧保护。接下来仍须本人原生确认。'
      : flow.command.kind === 'apply' ? '当前计划涉及 ' + (state?.recovery?.intentCount ?? 0) + ' 条意图，版本 ' + flow.command.expectedRevision + '。恢复不是重发，不自动启用；恢复后仍须逐条核对和原生确认。'
        : '仅对后端确认已可信封存、尚无 SQLite 的旧来源准备导入。本人原生确认后，主服务会用原封存凭据再校验并建库。准备不等于已应用恢复；返回计划后，还需本人单独确认 apply。不作为新 fresh 初始化，不适用于旧 1.2 未受监督 journal，不启用真实会话、不重发委托。'
    : flow?.kind === 'review' ? '意图 ' + flow.command.intentId.slice(0, 8) + '，版本 ' + flow.command.expectedRevision + '。'
      + STATEMENTS.find(([value]) => value === flow.command.observation.statement)?.[1] + '；'
      + (flow.command.observation.releaseGate ? '申请解除本条新单门禁，原意图仍禁止重试。' : '不申请解除门禁。')
      + '人工陈述不是机器对账，永久 ID 和禁止执行记录保留；接下来仍须原生确认。' : ''
  const additionalOptions = state?.intents.filter(i => i.gateReleased && i.executionForbidden && i.action === 'submit') ?? []
  const recoveryCommand: RecoveryCommand = view.canInitialize ? { kind: 'initialize' } : { kind: 'apply',
    recoveryId: state?.recovery?.recoveryId ?? '', manifestHash: state?.recovery?.manifestHash ?? '', expectedRevision: state?.recovery?.revision ?? -1 }
  return <div className="mt-panel" data-testid="mac-trading-panel">
    <h3>中信证券真实交易</h3>
    {!isMac && <div className="mt-warning" data-testid="mac-ths-platform-warning">本机执行桥接仅支持 Mac。此处不会控制 Windows 同花顺，也不会启用真实交易；可以读取安全状态。</div>}
    <p>本人在 Mac 同花顺登录和操作普通 A 股真实账户。不是券商官方 API，不提供交易密码，不支持无人值守或策略自动下单。</p>
    <div className="mt-warning">可能产生真实资金损失。尚未验证你的客户端与账户兼容性；每笔买卖或撤单仍须应用内核对及原生确认，券商弹窗由本人处理。</div>
    <section className="mt-status mt-product-state" role="status" aria-live="polite" data-testid="mac-ths-product-state">
      <strong>{view.title}</strong><p>{view.description}</p>
      {state && <p>{macThsCodeMessage(state.code)} 已存意图 {state.intents.length} 条，待核对 {view.pendingIntents.length} 条。</p>}
      <p className="mt-small">{reading ? '正在只读同步权威状态…' : synchronized ? '已读取持久投影，不代表真实设备或券商成交已验证。' : '当前状态未核验，保持保护。'}</p>
      {state?.coverage && <p className="mt-small">记录范围：{state.coverage.kind === 'legacy' ? '含旧来源' : '新域记录'}，已知旧 ID {state.coverage.legacyIds} 条；更早 ID 不可得，不宣称旧源迁移完整。</p>}
      <button type="button" disabled={reading} data-testid="mac-ths-refresh-state" onClick={() => void readState()}>读取最新状态（不控制同花顺）</button>
    </section>
    <section className="mt-warning" data-testid="mac-ths-capabilities"><strong>原生字段与可操作提示</strong>
      {view.capabilityHints.map(hint => <p key={hint}>{hint}</p>)}
      <p className="mt-small">仅反馈字段类别，不分享账户表格、原始订单、凭据或日志。</p>
    </section>
    {(view.canInitialize || state?.canProvisionLegacy === true || state?.recovery || state?.serviceState === 'RECOVERY_REQUIRED') && <section className="mt-warning mt-recovery" data-testid="mac-ths-recovery">
      <strong>{view.canInitialize ? '初始化本机委托记录' : '恢复计划'}</strong>
      {state?.recovery && <p>证据：{{ unavailable: '不可得', verified: '已验证', partial: '部分', conflicting: '冲突' }[state.recovery.evidence] ?? '未知'}；涉及意图 {state.recovery.intentCount} 条，需核对 {state.recovery.reviewCount} 条。{macThsCodeMessage(state.recovery.reason)}</p>}
      {!view.canRecover && !view.canInitialize && <p>当前计划不能应用。旧来源未可信封存、存储异常或退出未证实时，保留记录与保护；不是迁移完成。</p>}
      {state?.canProvisionLegacy === true && <div>
        <p>可信旧来源尚无 SQLite：可以申请准备导入，原生确认后主服务仍会重新校验原封存凭据。之后须单独确认恢复计划；不是新 fresh 初始化，不适用于旧 1.2 未受监督 journal，不会启用真实交易或重发。</p>
        <button type="button" data-testid="mac-ths-provision-legacy" disabled={busy || reading || !view.canProvisionLegacy || !!pending || recoveryUnknown.current.has(JSON.stringify({ kind: 'provisionLegacy' }))}
          onClick={stageProvisionLegacy}>准备可信旧记录导入（本人确认，不应用恢复）</button>
        {recoveryUnknown.current.has(JSON.stringify({ kind: 'provisionLegacy' })) && <p>导入准备回报未知，不重复发送；先读取权威状态，保护仍保留。</p>}
      </div>}
      <button type="button" data-testid="mac-ths-recover" disabled={busy || reading || !(view.canInitialize || view.canRecover) || recoveryUnknown.current.has(JSON.stringify(recoveryCommand))}
        onClick={stageRecovery}>{view.canInitialize ? '初始化本机委托记录（本人确认）' : '确认当前恢复计划（不重发）'}</button>
    </section>}
    <section className="mt-intents" data-testid="mac-ths-intents"><strong>本机委托意图与逐条核对</strong>
      {!state ? <p>尚未读取持久记录，不能推断没有未决委托。</p> : state.intents.length === 0 ? <p>当前投影没有摘要，不代表旧历史完整或券商没有订单。</p> : state.intents.map(intent => {
        const key = intentKey(intent)
        const needsReview = view.pendingIntents.some(i => i.intentId === intent.intentId)
        const choice: Choice = choices[key] ?? { statement: 'still_uncertain', scope: [], releaseGate: false }
        const submitted = reviewRequests.current.get(key)
        const update = (next: Choice) => setChoices(previous => ({ ...previous, [key]: next }))
        return <article className="mt-intent" key={key}>
          <strong>{intent.symbol ?? '旧记录证券未知'} · {macThsIntentLabel(intent.state)}</strong>
          <p className="mt-small">本机意图 {intent.intentId.slice(0, 8)}，版本 {intent.revision}；{intent.gateReleased ? '新单门禁已核对释放，原意图不作为重试' : '门禁尚未释放'}{intent.recoveryQuarantine ? '；恢复隔离仍存在' : ''}。</p>
          <p>脱敏账户标签：{intent.accountLabel ?? '未知'}；{intent.side === 'buy' ? '买入' : intent.side === 'sell' ? '卖出' : '方向未知'}，手工限价 {intent.price ?? '未知'}，数量 {intent.quantity ?? '未知'}，实际交易日 {intent.tradingDate ?? '未知'}。</p>
          {intent.executionForbidden && <p className="mt-small">原意图禁止执行或重试，人审不会删除 ID、attempt 或此限制。</p>}
          {needsReview && <div className="mt-intent-review">
            <label>本人核对陈述<select disabled={busy || !view.canReview || submitted?.sent} value={choice.statement}
              onChange={event => update({ ...choice, statement: event.target.value as Choice['statement'], releaseGate: false })}>
              {STATEMENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            {SCOPES.map(([scope, label]) => <label className="mt-check" key={scope}><input type="checkbox" disabled={busy || !view.canReview || submitted?.sent}
              checked={choice.scope.includes(scope)} onChange={event => update({ ...choice, releaseGate: false,
                scope: event.target.checked ? SCOPES.map(([value]) => value).filter(value => value === scope || choice.scope.includes(value)) : choice.scope.filter(value => value !== scope) })} />{label}</label>)}
            <label className="mt-check"><input type="checkbox" checked={choice.releaseGate} disabled={busy || !view.canReview || submitted?.sent || choice.statement === 'still_uncertain' || SCOPES.some(([scope]) => !choice.scope.includes(scope))}
              onChange={event => update({ ...choice, releaseGate: event.target.checked })} />申请解除本条新单门禁，不是重试原意图或机器对账</label>
            <button type="button" disabled={busy || reading || !view.canReview || submitted?.sent || !choice.scope.length} onClick={() => stageIntentReview(intent, choice)}>逐条核对并提交人审（仍须原生确认）</button>
            {submitted?.sent && <p>{submitted.uncertain ? '人审回报未知，不重复发送；先读取最新状态。' : '该版本已提交人审，不重复发送；以最新持久状态为准。'}</p>}
          </div>}
        </article>
      })}
    </section>
    <div className="mt-actions">
      <button type="button" disabled={busy || !view.canInspect} data-testid="mac-ths-probe" onClick={() => void run('probe')}>检查同花顺连接</button>
      <button type="button" disabled={busy || !view.canInspect} data-testid="mac-ths-authorize" onClick={() => void run('authorize')}>申请系统控制权限</button>
    </div>
    <div className="mt-warning">
      <label className="mt-check"><input type="checkbox" disabled={busy || !isMac} data-testid="mac-ths-live-risk-ack" checked={riskAcknowledged}
        onChange={event => editInput(() => { setRiskAcknowledged(event.target.checked); if (!event.target.checked && view.canDisable && !pendingRef.current) void run('disableLive') })} />我已核实权限、选择正确的中信真实账户，并了解真实资金风险</label>
      <div className="mt-actions">
        <button type="button" data-testid="mac-ths-enable-live" disabled={busy || !riskAcknowledged || !view.canEnable || !!pending} onClick={() => void run('authorizeLive')}>启用本次会话真实交易</button>
        <button type="button" data-testid="mac-ths-disable-live" disabled={busy || !view.canDisable || !!pending} onClick={() => void run('disableLive')}>关闭本次会话真实交易</button>
      </div><p className="mt-small">勾选不等于授权。重启和恢复不会自动启用；关闭会话不取消已送出的委托。</p>
    </div>
    <div className="mt-form">
      <label>方向<select value={side} disabled={busy || !view.canPreview || !!pending} onChange={event => editInput(() => setSide(event.target.value as 'buy' | 'sell'))}><option value="buy">买入</option><option value="sell">卖出</option></select></label>
      <label>普通主板代码<input value={symbol} inputMode="numeric" maxLength={6} disabled={busy || !view.canPreview || !!pending} onChange={event => editInput(() => setSymbol(event.target.value))} placeholder="由本人选择，不提供推荐" /></label>
      <label>手工限价<input value={price} inputMode="decimal" disabled={busy || !view.canPreview || !!pending} onChange={event => editInput(() => setPrice(event.target.value))} placeholder="本人填写，不标为实时行情" /></label>
      <label>数量<input value={quantity} inputMode="numeric" disabled={busy || !view.canPreview || !!pending} onChange={event => editInput(() => setQuantity(event.target.value))} placeholder="本人填写数量" /></label>
      <label>金额上限（不含手续费）<input value={maxNotional} inputMode="decimal" disabled={busy || !view.canPreview || !!pending} onChange={event => editInput(() => setMaxNotional(event.target.value))} placeholder="由你明确设置" /></label>
      {additionalOptions.length > 0 && <label>仅明确另下一笔时关联原意图<select value={additionalId} disabled={busy || !!pending} onChange={event => editInput(() => { setAdditionalId(event.target.value); setAdditionalAcknowledged(false) })}>
        <option value="">不关联旧意图</option>{additionalOptions.map(i => <option key={i.intentId} value={i.intentId}>{i.symbol ?? '旧意图'} · {i.intentId.slice(0, 8)}</option>)}</select></label>}
    </div>
    {additionalId && <label className="mt-check"><input type="checkbox" checked={additionalAcknowledged} disabled={busy || !!pending} onChange={event => editInput(() => setAdditionalAcknowledged(event.target.checked))} />这是一笔明确的额外委托，不是重试旧单，仍须两级确认</label>}
    <div className="mt-actions">
      <button type="button" disabled={busy || !valid || !view.canPreview || !!pending} onClick={() => void run('preview')}>填写表单并回读（不提交）</button>
      <button type="button" data-testid="mac-ths-submit-live" disabled={busy || !riskAcknowledged || !valid || !view.canSubmit || !!pending || (!!additionalId && !additionalAcknowledged)} onClick={() => void run('submitLive')}>提交真实买卖委托（本人确认）</button>
      <button type="button" disabled={busy || !view.canInspect} onClick={() => void run('queryOrders')}>在同花顺查看委托</button>
      <button type="button" disabled={busy || !view.canInspect} onClick={() => void run('queryDeals')}>在同花顺查看成交</button>
    </div>
    <div className="mt-cancel">
      <label>真实委托编号<input value={contractNo} disabled={busy || !view.canSubmit || !!pending} onChange={event => editInput(() => setContractNo(event.target.value))} placeholder="本人指定，仅本机使用，不导出" /></label>
      <button type="button" data-testid="mac-ths-cancel-live" disabled={busy || !riskAcknowledged || !view.canSubmit || !!pending || !/^[a-zA-Z0-9-]{1,32}$/.test(contractNo.trim())} onClick={() => void run('cancelLive')}>撤销指定真实委托（本人确认）</button>
    </div>
    {pending && <div className="mt-warning" data-testid="mac-ths-operation-pending">{pending.uncertain ? '本操作回报或门禁尚未终结，保留原 ID，禁止重试。' : '当前操作已绑定固定 ID，确认不会生成第二笔请求。'}请逐条核对，不把空回报当作没有送出。</div>}
    <div className="mt-status" data-testid="mac-ths-status" role="status">{busy ? '正在处理本人操作或等待原生确认，不重复发送。' : result ? macThsCodeMessage(result.code) : '没有自动执行、恢复或授权。'}{notice && <p>{notice}</p>}</div>
    <details open><summary>可分享的去敏运行结果</summary><pre data-testid="mac-ths-diagnostic">{JSON.stringify(diagnostic, null, 2)}</pre></details>
    <button type="button" data-testid="mac-ths-export" disabled={(!state && !result) || busy} onClick={exportResult}>导出去敏运行结果</button>
    <p className="mt-small">预览会填写表单，查看委托/成交会切换同花顺页面，都不是纯状态读取，仅由本人主动操作。不自动关闭弹窗。真实设备兼容和旧 1.2 无可信封存来源迁移仍未完成。</p>
    <a href="https://github.com/zetatez/evolving" target="_blank" rel="noopener noreferrer">查看参考开源项目</a>
    <AppConfirmDialog open={!!flow} title={title} message={<span style={{ whiteSpace: 'pre-line' }}>{message}</span>}
      tone="warning" statusLabel="本人核对后仍须原生确认" confirmLabel={flow?.kind === 'execute' ? flow.review.confirmLabel : '核对无误，继续原生确认'}
      busy={busy || reading} testId="mac-ths-confirmation" portalContainer={confirmationHost} onCancel={cancelReview} onConfirm={() => void confirmFlow()}>
      {reviewedIntent && <p>脱敏账户标签：{reviewedIntent.accountLabel ?? '未知'}；证券 {reviewedIntent.symbol ?? '未知'}；手工限价 {reviewedIntent.price ?? '未知'}；数量 {reviewedIntent.quantity ?? '未知'}。仅在本机展示，不导出。</p>}
    </AppConfirmDialog>
  </div>
}
