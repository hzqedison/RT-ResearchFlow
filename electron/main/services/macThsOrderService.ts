import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { types as utilTypes } from 'node:util'
import {
  MAC_THS_CODES, MAC_THS_RECOVERY_REASONS, decodeMacThsRequest, decodeMacThsRecovery, decodeMacThsReview,
  type MacThsCapabilities, type MacThsCode, type MacThsConfirmation, type MacThsIntentBinding,
  type MacThsIntentSummary, type MacThsProductState, type MacThsRecoveryPlan,
  type MacThsRecoveryReason, type MacThsRequest, type MacThsResult, type RecoveryCommand, type ReviewCommand,
} from '../../shared/macThsTypes'
import type { AccountContext, IntentRecord, IntentSnapshot, IntentStoreOptions, MacThsIntentStore } from './macThsIntentStore'
import type { LegacyQuiescenceCapability } from './macThsRecoveryCoordinator'
import type { NativeCompatibility, ObservedCancelTarget, createMacThsExecutionAdapter } from './macThsExecutionAdapter'

type Adapter = ReturnType<typeof createMacThsExecutionAdapter>
export interface TrustedCaller {
  readonly id: number
  readonly frame: object
  isCurrent(): boolean
}
export interface NativeConfirmation {
  title: string; message: string; detail: string; confirmLabel: string
}
export interface MacThsOrderServiceOptions {
  /** The existing canonical app userData, never a renderer-selected alternative profile. */
  directory: string
  /** Trusted main-only preparation; production binds the captured Electron default directory. */
  prepareDirectory?: (directory: string) => void
  confirm: (prompt: NativeConfirmation, caller: TrustedCaller) => Promise<boolean>
  accessibility: (request: boolean) => boolean
  testHooks?: {
    platform?: NodeJS.Platform
    store?: IntentStoreOptions['testHooks']
    adapter?: Parameters<typeof createMacThsExecutionAdapter>[0]['testHooks']
    ticketLifetimeMs?: number
    now?: () => number
    monotonic?: () => number
  }
}
interface Ticket {
  token: string; key: string; callerId: number; frame: object; generation: number
  issuedAt: number; expiresAt: number; deadline: number; wallFloor: number
  intent: MacThsIntentBinding | null; presentation: NativeConfirmation
}
interface Answer { code: MacThsCode; confirmation?: MacThsConfirmation; contractNo?: string }
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }) }
function assert(condition: unknown, code: string): asserts condition { if (!condition) fail(code) }
const cents = (value: string): number => {
  const [whole, fraction = ''] = value.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}
const money = (value: number) => (value / 100).toFixed(2)
const isPending = (r: IntentRecord) => Boolean(r.recoveryQuarantine) ||
  (['UNKNOWN', 'LEGACY_UNKNOWN'].includes(r.state) && !r.gateReleased)
/** Reject proxies and accessors before any normalizer/JSON conversion can erase their meaning. */
function inert(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (!value || typeof value !== 'object') return typeof value !== 'function'
  if (utilTypes.isProxy(value)) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  return Reflect.ownKeys(descriptors).length <= 40 && Reflect.ownKeys(descriptors).every(key =>
    typeof key === 'string' && Object.hasOwn(descriptors[key], 'value') && inert(descriptors[key].value, depth + 1))
}
function sameBinding(a: MacThsIntentBinding | null | undefined, b: MacThsIntentBinding | null | undefined): boolean {
  return !a || !b ? !a && !b : a.intentId === b.intentId && a.snapshotHash === b.snapshotHash && a.expectedRevision === b.expectedRevision
}
function requestKey(r: MacThsRequest): string {
  return JSON.stringify({ action: r.action, mode: r.mode ?? 'live', order: r.order ?? null,
    requestId: r.requestId ?? null, contractNo: r.contractNo ?? null,
    risk: r.liveRiskAcknowledged ?? null, additional: r.additionalOrder ? r.additionalOrder.previousIntentId : null })
}
function summary(r: IntentRecord): MacThsIntentSummary {
  const s = r.snapshot
  const outcome = [...r.events].reverse().find(e => e.kind === 'outcome')
  const observed = outcome?.kind === 'outcome' && outcome.evidence.source === 'ths_ui' ? outcome.evidence : null
  return { intentId: r.intentId, requestId: r.originalRequestId, snapshotHash: r.snapshotHash, revision: r.revision,
    state: r.state, gateReleased: r.gateReleased, executionForbidden: Boolean(r.executionForbidden || r.attempt || r.state === 'ABANDONED'),
    recoveryQuarantine: Boolean(r.recoveryQuarantine), recoveryId: r.recoveryId ?? null,
    mode: s?.mode ?? null, action: s?.action ?? null, symbol: s?.symbol ?? null, market: s?.market ?? null,
    side: s?.side ?? null, price: s ? money(s.priceCents) : null, quantity: s?.quantity ?? null,
    maxNotional: s ? money(s.maxNotionalCents) : null, accountLabel: s?.accountContext.label ?? null,
    contractNo: s?.cancelTarget?.contractNo ?? observed?.contractNo ?? null,
    tradingDate: s?.cancelTarget?.tradingDate ?? observed?.tradingDate ?? null }
}

/** One main-process execution domain. No renderer proofs, retry queue, JSON fallback, or automatic recovery. */
export class MacThsOrderService {
  readonly sessionId = randomUUID()
  private sequence = 0
  private generation = 0
  private started = false
  private starting: Promise<MacThsProductState> | null = null
  private busy = false
  private stopping = false
  private closed = false
  private liveEnabled = false
  private liveDigest: string | null = null
  private executing = false
  private nativeWaiting = false
  private unproven = false
  private fresh = false
  private sealedUnprovisioned = false
  private reauthorizationRequired = false
  private storageFailure: MacThsRecoveryReason | null = null
  private blockedReason: MacThsRecoveryReason | null = null
  private lastCode: MacThsCode = 'READY'
  private records: IntentRecord[] = []
  private coverage: MacThsProductState['coverage'] = null
  private recoveryPlan: MacThsRecoveryPlan | null = null
  private capabilities: MacThsCapabilities | null = null
  private ticket: Ticket | null = null
  private active: Promise<Answer> | null = null
  private stoppingTask: Promise<void> | null = null
  private store: MacThsIntentStore | null = null
  private adapter: Adapter | null = null
  private storeClass: typeof MacThsIntentStore | null = null
  private verifyLegacy: typeof import('./macThsRecoveryCoordinator').verifyLegacyQuiescence | null = null
  private restoreLegacy: ((directory: string) => LegacyQuiescenceCapability) | null = null
  private readonly listeners = new Set<(notice: { sessionId: string; stateSequence: number }) => void>()
  private readonly platform: NodeJS.Platform
  private readonly now: () => number
  private readonly monotonic: () => number
  constructor(private readonly options: MacThsOrderServiceOptions) {
    this.platform = options.testHooks?.platform ?? process.platform
    this.now = options.testHooks?.now ?? Date.now
    this.monotonic = options.testHooks?.monotonic ?? (() => performance.now())
  }
  onStateChanged(listener: (notice: { sessionId: string; stateSequence: number }) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private notify(): void {
    this.sequence++
    for (const listener of this.listeners) {
      try { listener({ sessionId: this.sessionId, stateSequence: this.sequence }) }
      catch { /* A detached renderer cannot undo a durable main-process transition. */ }
    }
  }
  private source(): { fresh: boolean; database: boolean; proof?: LegacyQuiescenceCapability } {
    const names = readdirSync(this.options.directory)
    const database = names.includes('mac-ths-orders.v2.sqlite')
    const orderArtifacts = names.filter(n => n.toLowerCase().startsWith('mac-ths-'))
    const legacy = orderArtifacts.filter(n => !['mac-ths-orders.v2.sqlite', 'mac-ths-orders.sqlite-enabled',
      'mac-ths-orders.v2.sqlite-journal', 'mac-ths-orders.v2.sqlite-wal', 'mac-ths-orders.v2.sqlite-shm'].includes(n))
    if (legacy.length) {
      // F3 does not ingest the old handler's .json.tmp, or arbitrary unclassified residues.
      const supported = (n: string) => ['mac-ths-experiment-journal.json', 'mac-ths-intents.v1.json',
        'mac-ths-intents.lock', 'mac-ths-intents.pending', 'mac-ths-intents.enabled',
        'mac-ths-legacy-supervision.v1.json', 'mac-ths-legacy-retirement.v1.json'].includes(n) ||
        (n.startsWith('mac-ths-intents.v1.json.') && n.endsWith('.tmp'))
      assert(legacy.every(supported) && this.restoreLegacy, 'LEGACY_WRITER_UNFENCED')
      return { fresh: false, database, proof: this.restoreLegacy(this.options.directory) }
    }
    if (!database && orderArtifacts.length) fail('CORRUPT_STORE')
    return { fresh: orderArtifacts.length === 0, database }
  }
  start(): Promise<MacThsProductState> {
    if (this.starting) return this.starting
    this.starting = (async () => {
      if (this.platform !== 'darwin') { this.started = true; this.notify(); return this.getState() }
      try {
        this.options.prepareDirectory?.(this.options.directory)
        const backend = await import('./macThsIntentStore')
        const ownership = await import('./macThsRecoveryCoordinator')
        const native = await import('./macThsExecutionAdapter')
        if (this.stopping) { this.started = true; this.notify(); return this.getState() }
        this.storeClass = backend.MacThsIntentStore
        this.restoreLegacy = ownership.MacThsRecoveryCoordinator.restoreLegacyQuiescence
        this.verifyLegacy = ownership.verifyLegacyQuiescence
        this.adapter = native.createMacThsExecutionAdapter({ directory: this.options.directory,
          ...(this.options.testHooks?.adapter ? { testHooks: this.options.testHooks.adapter } : {}) })
        const source = this.source()
        this.fresh = source.fresh
        if (source.fresh) this.lastCode = 'NOT_INITIALIZED'
        else if (!source.database) {
          // Status never provisions. The explicit provisionLegacy action must reconfirm this seal.
          this.sealedUnprovisioned = Boolean(source.proof)
          this.blockedReason = 'IMPORT_REQUIRED'
        } else {
          this.store = this.storeClass.open({ directory: this.options.directory, initialize: false,
            ...(source.proof ? { legacyQuiescence: source.proof } : {}), testHooks: this.options.testHooks?.store })
          this.refresh()
        }
      } catch (error) { this.capture(error) }
      this.started = true; this.notify()
      return this.getState()
    })()
    return this.starting
  }
  private capture(error: unknown): MacThsCode {
    const e = error as { code?: string; reason?: string }
    const reason = MAC_THS_RECOVERY_REASONS.includes(e?.reason as MacThsRecoveryReason) ? e.reason as MacThsRecoveryReason : null
    if (reason) {
      this.liveEnabled = false; this.liveDigest = null; this.ticket = null
      if (['STORAGE_IO', 'CORRUPT_STORE', 'ABI_UNAVAILABLE'].includes(reason)) this.storageFailure = reason
      else this.blockedReason = reason
      return this.lastCode = reason === 'LEGACY_WRITER_UNFENCED' ? 'LEGACY_WRITER_UNFENCED' : 'RECOVERY_REQUIRED'
    }
    if (e?.code === 'LEGACY_WRITER_UNFENCED') {
      this.blockedReason = 'LEGACY_WRITER_UNFENCED'; this.liveEnabled = false; this.ticket = null
      return this.lastCode = 'LEGACY_WRITER_UNFENCED'
    }
    if (e?.code === 'EXECUTOR_EXIT_UNPROVEN' || e?.code === 'EXECUTOR_STOP_FAILED') {
      this.unproven = true; this.liveEnabled = false; this.ticket = null
      return this.lastCode = 'EXECUTOR_EXIT_UNPROVEN'
    }
    if (MAC_THS_CODES.includes(e?.code as MacThsCode)) return this.lastCode = e.code as MacThsCode
    this.storageFailure = e?.code === 'MODULE_NOT_FOUND' || e?.code === 'ERR_DLOPEN_FAILED' ? 'ABI_UNAVAILABLE' :
      e?.code?.startsWith('CORRUPT') ? 'CORRUPT_STORE' : 'STORAGE_IO'
    this.liveEnabled = false; this.ticket = null
    return this.lastCode = 'STORAGE_UNAVAILABLE'
  }
  private refresh(): void {
    if (!this.store || this.closed || this.storageFailure) return
    try {
      this.source() // Sealed sources remain immutable after import, not just during first open.
      const plan = this.store.inspectRecovery()
      this.blockedReason = plan.reason
      this.recoveryPlan = plan.code === 'RECOVERY_REQUIRED' ? {
        recoveryId: plan.recoveryId, manifestHash: plan.manifestHash, revision: plan.revision,
        reason: plan.reason, evidence: plan.evidence, canApply: plan.canApply,
        intentCount: plan.intents.length, reviewCount: plan.intents.filter(i => i.quarantine).length,
      } : null
      if (plan.code === 'RECOVERY_REQUIRED') { this.liveEnabled = false; this.ticket = null }
      if (plan.canInspect) {
        const inspected = this.store.inspect()
        this.records = inspected.intents
        this.coverage = inspected.coverage
      }
    } catch (error) { this.capture(error) }
  }
  getState(): MacThsProductState {
    const owned = this.adapter?.ownedState ?? 'idle'
    const executorState = this.unproven || owned === 'unproven' ? 'unproven' :
      this.stopping ? 'stopping' : this.executing || owned === 'running' ? 'running' : 'idle'
    const unknownPending = this.records.some(isPending)
    const reason = this.storageFailure ?? this.blockedReason
    const serviceState: MacThsProductState['serviceState'] =
      this.platform !== 'darwin' ? 'UNSUPPORTED_PLATFORM' : !this.started ? 'STARTING' :
      this.storageFailure ? 'BLOCKED_STORAGE' : executorState === 'unproven' ? 'EXECUTOR_UNPROVEN' :
      this.stopping ? 'STOPPING' : this.blockedReason ? 'RECOVERY_REQUIRED' :
      this.fresh ? 'NOT_INITIALIZED' : executorState === 'running' ? 'EXECUTING' :
      unknownPending ? 'REVIEW_REQUIRED' : this.ticket || this.nativeWaiting ? 'AWAITING_CONFIRMATION' :
      this.busy ? 'SYNCING' : this.liveEnabled ? 'READY_ENABLED' : 'READY_DISABLED'
    const base = this.started && this.platform === 'darwin' && !!this.store && !reason && !this.stopping &&
      !this.closed && executorState === 'idle'
    const canPrepare = base && !this.busy && !unknownPending && !this.ticket && !this.reauthorizationRequired
    const code: MacThsCode = serviceState === 'UNSUPPORTED_PLATFORM' ? 'MAC_REQUIRED' :
      serviceState === 'BLOCKED_STORAGE' ? 'STORAGE_UNAVAILABLE' : serviceState === 'EXECUTOR_UNPROVEN' ? 'EXECUTOR_EXIT_UNPROVEN' :
      this.stopping ? 'SESSION_STOPPING' : reason ? (reason === 'LEGACY_WRITER_UNFENCED' ? 'LEGACY_WRITER_UNFENCED' : 'RECOVERY_REQUIRED') :
      this.fresh ? 'NOT_INITIALIZED' : this.lastCode
    return { schemaVersion: 1, adapterVersion: '3', sessionId: this.sessionId, stateSequence: this.sequence,
      serviceState, code, recoveryReason: reason, liveEnabled: this.liveEnabled,
      executorState, unknownPending, canPrepare,
      canConfirm: base && !this.busy && !unknownPending && !!this.ticket &&
        this.now() >= this.ticket.wallFloor && this.now() < this.ticket.expiresAt && this.monotonic() < this.ticket.deadline,
      canProvisionLegacy: this.platform === 'darwin' && this.started && this.sealedUnprovisioned &&
        !this.store && !this.storageFailure && !this.stopping && !this.busy && this.blockedReason === 'IMPORT_REQUIRED',
      canInitialize: this.platform === 'darwin' && this.started && this.fresh && !this.stopping && !this.busy && !reason,
      canRecover: !!this.recoveryPlan?.canApply && !this.stopping && !this.busy && !this.storageFailure && executorState === 'idle',
      canReview: base && !this.busy && unknownPending,
      coverage: this.coverage ? { ...this.coverage } : null, intents: this.records.map(summary),
      recovery: this.recoveryPlan ? { ...this.recoveryPlan } : reason ? {
        recoveryId: null, manifestHash: null, revision: 0, reason, evidence: 'unavailable',
        canApply: false, intentCount: this.records.length, reviewCount: this.records.filter(isPending).length,
      } : null,
      capabilities: this.capabilities ? { ...this.capabilities } : null }
  }
  private compatibility(c: NativeCompatibility): void {
    const field = (v: NativeCompatibility['account']): MacThsCapabilities['account'] => v === 'masked_only' ? 'ambiguous' : v
    this.capabilities = { clientVersion: c.clientVersion, layoutProfile: c.layoutProfile,
      account: field(c.account), mode: field(c.mode), tradingDate: field(c.tradingDate), headers: field(c.headers),
      readback: field(c.readback), receipt: field(c.receipt), nextAction: c.nextAction }
    this.notify()
  }
  private nativeCode(code: string): MacThsCode { return MAC_THS_CODES.includes(code as MacThsCode) ? code as MacThsCode : 'CAPABILITY_UNAVAILABLE' }
  private check(caller: TrustedCaller, generation: number, ticket?: Ticket): void {
    assert(caller.isCurrent() && generation === this.generation, 'INVALID_CALLER')
    assert(!this.stopping && !this.closed, 'SESSION_STOPPING')
    if (ticket) {
      const wall = this.now()
      assert(ticket.generation === generation && ticket.callerId === caller.id && ticket.frame === caller.frame &&
        wall >= ticket.wallFloor && wall < ticket.expiresAt && this.monotonic() < ticket.deadline, 'CONFIRMATION_EXPIRED')
      ticket.wallFloor = wall
    }
  }
  private gate(allowReauthorization = false): void {
    this.refresh()
    assert(this.store && !this.fresh, 'NOT_INITIALIZED')
    assert(!this.storageFailure, 'STORAGE_UNAVAILABLE')
    assert(!this.blockedReason, this.blockedReason === 'LEGACY_WRITER_UNFENCED' ? 'LEGACY_WRITER_UNFENCED' : 'RECOVERY_REQUIRED')
    assert(!this.unproven && !this.adapter?.hasUnprovenOwned(), 'EXECUTOR_EXIT_UNPROVEN')
    assert(!this.records.some(isPending), 'REVIEW_REQUIRED')
    assert(allowReauthorization || !this.reauthorizationRequired, 'LIVE_SESSION_REQUIRED')
  }
  private viewGate(): void {
    this.refresh()
    assert(this.store && !this.fresh, 'NOT_INITIALIZED')
    assert(!this.storageFailure, 'STORAGE_UNAVAILABLE')
    assert(!this.blockedReason, this.blockedReason === 'LEGACY_WRITER_UNFENCED' ? 'LEGACY_WRITER_UNFENCED' : 'RECOVERY_REQUIRED')
    assert(!this.unproven && !this.adapter?.hasUnprovenOwned(), 'EXECUTOR_EXIT_UNPROVEN')
    // Current-session exit proofs are known to the adapter and persisted before outcome/review.
    // F3 has no read-only old-attempt executor projection; do not guess an orphan exited.
    assert(!this.records.some(r => r.attempt && r.attempt.sessionId !== this.store!.sessionId &&
      this.reauthorizationRequired), 'LIVE_SESSION_REQUIRED')
  }
  private async run(caller: TrustedCaller, work: (generation: number) => Promise<Answer>): Promise<Answer> {
    if (!caller.isCurrent()) return { code: 'INVALID_CALLER' }
    if (this.platform !== 'darwin') return { code: 'MAC_REQUIRED' }
    if (!this.started) return { code: 'BUSY' }
    if (this.stopping || this.closed) return { code: 'SESSION_STOPPING' }
    if (this.busy) return { code: 'BUSY' }
    this.busy = true; const generation = this.generation; this.notify()
    const task = (async () => {
      try {
        this.check(caller, generation)
        const answer = await work(generation)
        this.lastCode = answer.code
        return answer
      } catch (error) { return { code: this.capture(error) } }
      finally {
        this.busy = false; this.nativeWaiting = false; this.executing = false
        this.refresh(); this.notify()
      }
    })()
    this.active = task
    try { return await task } finally { if (this.active === task) this.active = null }
  }
  private result(request: Pick<MacThsRequest, 'action' | 'mode'>, answer: Answer): MacThsResult {
    const state = this.getState()
    const passed: MacThsCode[] = ['READY', 'FORM_READY', 'VIEW_OPENED', 'LIVE_ENABLED', 'LIVE_DISABLED',
      'PERMISSION_PROMPTED', 'ACCEPTED_OBSERVED', 'CANCEL_OBSERVED', 'NOT_SUBMITTED']
    return { schemaVersion: 1, component: 'mac-ths-ui-experiment', adapterVersion: '3',
      runtime: this.platform === 'darwin' ? 'macos' : 'other',
      architecture: process.arch === 'arm64' || process.arch === 'x64' ? process.arch : 'other',
      action: request.action, mode: request.mode ?? 'live', outcome: passed.includes(answer.code) ? 'passed' :
        ['RECEIPT_UNKNOWN', 'NATIVE_CONFIRMATION_REQUIRED', 'EXECUTOR_EXIT_UNPROVEN'].includes(answer.code) ? 'unknown' : 'blocked',
      ...answer, state, unknownPending: state.unknownPending, canSubmitLiveOrders: state.canPrepare && state.liveEnabled,
      canRunUnattended: false }
  }
  private makeTicket(r: MacThsRequest, caller: TrustedCaller, presentation: NativeConfirmation,
    intent: MacThsIntentBinding | null, issuedAt: number, deadline: number, expiresAt: number): Answer {
    this.ticket = { token: randomUUID(), key: requestKey(r), callerId: caller.id, frame: caller.frame,
      generation: this.generation, issuedAt, deadline, expiresAt, wallFloor: this.now(), intent, presentation }
    this.notify()
    return { code: 'CONFIRMATION_REQUIRED', confirmation: {
      token: this.ticket.token, title: presentation.title, message: presentation.detail,
      confirmLabel: presentation.confirmLabel, sessionId: this.sessionId, expiresAt, intentBinding: intent ? { ...intent } : null } }
  }
  private consume(r: MacThsRequest, caller: TrustedCaller, generation: number): Ticket {
    const ticket = this.ticket
    this.ticket = null
    assert(ticket && ticket.token === r.confirmationToken && ticket.key === requestKey(r), 'CONFIRMATION_EXPIRED')
    try {
      this.check(caller, generation, ticket)
      assert(sameBinding(r.intentBinding, ticket.intent), 'SNAPSHOT_CONFLICT')
      return ticket
    } catch (error) { this.abandon(ticket, 'expired'); throw error }
  }
  private abandon(ticket: Ticket | null, reason: 'cancelled' | 'expired'): void {
    if (!ticket?.intent || !this.store || this.closed) return
    const record = this.store.getIntent(ticket.intent.intentId)
    if (record && !record.attempt && !record.executionForbidden && ['PREPARED', 'CONFIRMED'].includes(record.state))
      this.store.abandonIntent(record.intentId, record.snapshotHash!, record.revision, reason)
  }
  private presentation(snapshot: IntentSnapshot, additional: boolean): NativeConfirmation {
    const detail = [
      '账户：' + snapshot.accountContext.label,
      snapshot.action === 'cancel' ? '撤销指定委托：' + snapshot.cancelTarget!.contractNo + '，交易日：' + snapshot.cancelTarget!.tradingDate :
        (snapshot.side === 'buy' ? '买入' : '卖出') + '：' + snapshot.symbol,
      '证券：' + snapshot.symbol + '，方向：' + snapshot.side + '，限价：' + money(snapshot.priceCents) + '，数量：' + snapshot.quantity,
      '金额上限：' + money(snapshot.maxNotionalCents) + '（不含手续费）',
      additional ? '这是关联旧意图后另下一笔独立委托；本人再次确认本次追加风险，不是重试。' : '同一意图不自动重试。',
      snapshot.mode === 'simulation' ? '仅模拟账户。' : '本人真实账户；请勿切换账户。同花顺自己的确认弹窗仍由本人核对。',
    ].join('\n')
    return { title: snapshot.mode === 'simulation' ? '确认模拟交易' : '确认本笔真实交易',
      message: '请核对持久委托快照；取消不会删除记录。', detail, confirmLabel: snapshot.action === 'cancel' ? '确认单笔撤单' : '确认本笔委托' }
  }
  private sameRequest(record: IntentRecord, request: MacThsRequest): boolean {
    const s = record.snapshot
    if (!s || s.mode !== request.mode || s.action !== (request.action.startsWith('cancel') ? 'cancel' : 'submit') ||
      (record.additionalOrder?.previousIntentId ?? null) !== (request.additionalOrder?.previousIntentId ?? null)) return false
    return s.action === 'cancel' ? s.cancelTarget?.contractNo === request.contractNo :
      !!request.order && s.symbol === request.order.symbol && s.side === request.order.side &&
      s.priceCents === cents(request.order.price) && s.quantity === request.order.quantity &&
      s.maxNotionalCents === cents(request.order.maxNotional)
  }
  async execute(value: unknown, caller: TrustedCaller): Promise<MacThsResult> {
    const r = inert(value) ? decodeMacThsRequest(value) : null
    if (!r) return this.result({ action: 'probe' }, { code: 'INVALID_REQUEST' })
    if (!caller.isCurrent()) return this.result(r, { code: 'INVALID_CALLER' })
    // Revocation is synchronous and bypasses the operation slot, including a pending native dialog.
    if (r.action === 'disableLive') { this.revokeCaller(caller.id); this.lastCode = 'LIVE_DISABLED'; return this.result(r, { code: 'LIVE_DISABLED' }) }
    if (r.action === 'resolveUnknown') return this.result(r, { code: 'REVIEW_REQUIRED' })
    if (r.action === 'dismissConfirmation') {
      const t = this.ticket
      if (!t || t.callerId !== caller.id || t.frame !== caller.frame || t.token !== r.confirmationToken ||
        !sameBinding(t.intent, r.intentBinding))
        return this.result(r, { code: 'CONFIRMATION_EXPIRED' })
      this.ticket = null
      try { this.abandon(t, 'cancelled'); this.lastCode = 'USER_CANCELLED' }
      catch (error) { this.capture(error) }
      this.refresh(); this.notify()
      return this.result(r, { code: this.lastCode })
    }
    const answer = await this.run(caller, async generation => {
      assert(this.adapter, 'CAPABILITY_UNAVAILABLE')
      const mode = r.mode ?? 'live'
      const mutation = ['submitLive', 'submitSimulation', 'cancelLive', 'cancelSimulation'].includes(r.action)
      if (mutation) return this.mutate(r, caller, generation)
      if (r.action === 'probe') {
        assert(!this.adapter.hasUnprovenOwned() && !this.unproven, 'EXECUTOR_EXIT_UNPROVEN')
        const observation = await this.adapter.performAuxiliary('probe', mode)
        this.check(caller, generation); this.compatibility(observation.compatibility)
        return { code: this.nativeCode(observation.code) }
      }
      if (r.action === 'queryOrders' || r.action === 'queryDeals') this.viewGate()
      else this.gate(r.action === 'authorizeLive')
      assert(!this.ticket || !!r.confirmationToken, 'BUSY')
      const needsTicket = r.action === 'authorizeLive' || r.action === 'authorize' || (r.action === 'preview' && mode !== 'simulation')
      if (needsTicket && !r.confirmationToken) {
        const now = this.now(), lifetime = Math.min(120000, this.options.testHooks?.ticketLifetimeMs ?? 120000)
        return this.makeTicket(r, caller, {
          title: r.action === 'authorizeLive' ? '启用本次真实交易会话' : r.action === 'authorize' ? '申请辅助功能权限' : '仅填写，不提交',
          message: '必须本人确认；恢复与页面勾选不能代替授权。',
          detail: r.action === 'authorizeLive' ? '本人核对当前账户，承担真实资金风险。每笔仍需单独确认，重启或窗口失效后授权取消。' :
            r.action === 'authorize' ? '仅请求辅助功能权限，不读取密码、不申请完全磁盘访问。' :
              r.order!.side + ' ' + r.order!.symbol + '，价格 ' + r.order!.price + '，数量 ' + r.order!.quantity + '。仅填写并回读，不提交。',
          confirmLabel: r.action === 'authorizeLive' ? '启用本次本人交易' : '确认',
        }, null, now, this.monotonic() + lifetime, now + lifetime)
      }
      let ticket: Ticket | null = null
      if (needsTicket) {
        ticket = this.consume(r, caller, generation); this.nativeWaiting = true; this.notify()
        const approved = await this.options.confirm(ticket.presentation, caller)
        this.check(caller, generation, ticket); this.gate(r.action === 'authorizeLive')
        if (!approved) return { code: 'USER_CANCELLED' }
      }
      if (r.action === 'authorize') {
        this.options.accessibility(true)
        return { code: 'PERMISSION_PROMPTED' }
      }
      assert(this.options.accessibility(false), 'ACCESSIBILITY_REQUIRED')
      if (r.action === 'authorizeLive') {
        const observation = await this.adapter.observeContext('live')
        this.check(caller, generation, ticket!); this.gate(true); this.compatibility(observation.compatibility)
        if (!observation.ok) return { code: this.nativeCode(observation.code) }
        assert(observation.value.mode === 'live', 'MODE_UNVERIFIED')
        this.store!.enableLiveSession({ accountDigest: observation.value.accountContext.digest, observedAt: observation.value.observedAt })
        this.liveDigest = observation.value.accountContext.digest
        this.liveEnabled = true; this.reauthorizationRequired = false
        return { code: 'LIVE_ENABLED' }
      }
      assert(['preview', 'queryOrders', 'queryDeals'].includes(r.action), 'INVALID_REQUEST')
      const observation = await this.adapter.performAuxiliary(r.action as 'preview' | 'queryOrders' | 'queryDeals', mode, r.order)
      this.check(caller, generation, ticket ?? undefined); this.compatibility(observation.compatibility)
      return { code: this.nativeCode(observation.code) }
    })
    return this.result(r, answer)
  }
  private async mutate(r: MacThsRequest, caller: TrustedCaller, generation: number): Promise<Answer> {
    this.refresh()
    const prior = this.records.find(record => record.originalRequestId === r.requestId)
    if (prior) {
      assert(this.sameRequest(prior, r), 'REQUEST_CONFLICT')
      if (!r.confirmationToken) return { code: 'DUPLICATE_REQUEST' }
      if (prior.attempt || prior.executionForbidden || prior.state === 'ABANDONED') return { code: 'EXECUTION_FORBIDDEN' }
    } else assert(!r.confirmationToken, 'CONFIRMATION_EXPIRED')
    this.gate()
    if (r.mode === 'live') assert(this.liveEnabled, 'LIVE_NOT_ENABLED')
    assert(this.options.accessibility(false), 'ACCESSIBILITY_REQUIRED')
    if (!r.confirmationToken) {
      assert(!this.ticket, 'BUSY')
      const issuedAt = this.now(), lifetime = Math.min(120000, this.options.testHooks?.ticketLifetimeMs ?? 120000)
      const deadline = this.monotonic() + lifetime, expiresAt = issuedAt + lifetime
      const cancellation = r.action.startsWith('cancel')
      const observation = cancellation ? await this.adapter!.observeCancelTarget(r.contractNo!, r.mode!) :
        await this.adapter!.observeContext(r.mode!)
      this.check(caller, generation); this.gate(); this.compatibility(observation.compatibility)
      if (!observation.ok) return { code: this.nativeCode(observation.code) }
      assert(observation.value.mode === r.mode, 'MODE_UNVERIFIED')
      if (r.mode === 'live') assert(this.liveEnabled && this.liveDigest === observation.value.accountContext.digest, 'ACCOUNT_CONTEXT_CONFLICT')
      const now = this.now()
      assert(now >= issuedAt && now < expiresAt && this.monotonic() < deadline, 'CONFIRMATION_EXPIRED')
      const accountContext = observation.value.accountContext
      const target = cancellation ? (observation.value as ObservedCancelTarget).target : null
      if (cancellation) assert(target && target.contractNo === r.contractNo &&
        target.accountDigest === accountContext.digest && target.tradingDate === observation.value.tradingDate, 'TARGET_UNVERIFIED')
      const snapshot: IntentSnapshot = { schemaVersion: 1, executor: 'mac-local-ths', mode: r.mode!, action: cancellation ? 'cancel' : 'submit',
        symbol: target?.symbol ?? r.order!.symbol, market: target?.market ?? (r.order!.symbol.startsWith('6') ? 'SH' : 'SZ'),
        side: target?.side ?? r.order!.side, priceCents: target?.priceCents ?? cents(r.order!.price),
        quantity: target?.quantity ?? r.order!.quantity,
        maxNotionalCents: target ? target.priceCents * target.quantity : cents(r.order!.maxNotional),
        cancelTarget: target ? { contractNo: target.contractNo, tradingDate: target.tradingDate, accountDigest: target.accountDigest } : null,
        accountContext, input: { source: 'manual', capturedAt: now }, createdAt: now, expiresAt }
      const record = this.store!.createIntent(r.requestId!, snapshot, r.additionalOrder ?? null)
      return this.makeTicket(r, caller, this.presentation(snapshot, !!r.additionalOrder),
        { intentId: record.intentId, snapshotHash: record.snapshotHash!, expectedRevision: record.revision },
        issuedAt, deadline, expiresAt)
    }
    const ticket = this.consume(r, caller, generation)
    try {
      assert(ticket.intent, 'SNAPSHOT_CONFLICT')
      const record = this.store!.getIntent(ticket.intent.intentId)!
      assert(record && record.snapshotHash === ticket.intent.snapshotHash && record.revision === ticket.intent.expectedRevision, 'CAS_CONFLICT')
      this.nativeWaiting = true; this.notify()
      const approved = await this.options.confirm(ticket.presentation, caller)
      this.check(caller, generation, ticket); this.gate()
      if (!approved) { this.abandon(ticket, 'cancelled'); return { code: 'USER_CANCELLED' } }
      const confirmedAt = this.now()
      const observed = await this.adapter!.observeContext(record.snapshot!.mode)
      this.check(caller, generation, ticket); this.gate(); this.compatibility(observed.compatibility)
      if (!observed.ok) { this.abandon(ticket, 'cancelled'); return { code: this.nativeCode(observed.code) } }
      const account: AccountContext = observed.value.accountContext
      assert(observed.value.mode === record.snapshot!.mode && account.digest === record.snapshot!.accountContext.digest &&
        observed.value.observedAt >= confirmedAt, 'ACCOUNT_CONTEXT_CONFLICT')
      if (r.mode === 'live') assert(this.liveEnabled && this.liveDigest === account.digest, 'LIVE_NOT_ENABLED')
      const limits = { expiresAt: Math.min(ticket.expiresAt, this.now() + 20000),
        deadlineMonotonic: Math.min(ticket.deadline, this.monotonic() + 20000) }
      const prepared = this.adapter!.prepareExecution(record.snapshot!, limits)
      this.check(caller, generation, ticket)
      // No await between confirmation, durable UNKNOWN/CAS and the supervised one-shot launch.
      const confirmed = this.store!.confirmIntent(record.intentId, record.snapshotHash!, record.revision, {
        method: 'native_dialog', sessionId: this.store!.sessionId, confirmedAt, expiresAt: limits.expiresAt,
        additionalOrderAcknowledged: r.additionalOrder?.additionalOrderAcknowledged === true,
      })
      const claim = this.store!.claimExecution(record.intentId, record.snapshotHash!, confirmed.revision, r.requestId!, {
        accountDigest: account.digest, observedAt: observed.value.observedAt,
      })
      if (!claim.claimed) return { code: 'EXECUTION_PERMISSION_EXPIRED' }
      const instance = this.store!.launchExecutor(claim.attemptId!, this.adapter!.coordinator, prepared.executable, prepared.args)
      this.executing = true; this.nativeWaiting = false; this.refresh(); this.notify()
      const outcome = await this.adapter!.awaitExecution(instance.instanceId, prepared)
      // Housekeeping persists late evidence/real exit even if the caller has been revoked.
      // It never enables trading or resumes the consumed permission.
      this.compatibility(outcome.compatibility)
      if (!outcome.exitProof) { this.unproven = true; return { code: 'EXECUTOR_EXIT_UNPROVEN' } }
      this.store!.recordExecutorExit(claim.attemptId!, outcome.exitProof)
      if (outcome.evidence) {
        const settled = this.store!.recordOutcome(record.intentId, record.snapshotHash!, claim.intent.revision,
          claim.attemptId!, outcome.evidence)
        return { code: settled.state as 'NOT_SUBMITTED' | 'ACCEPTED_OBSERVED' | 'CANCEL_OBSERVED',
          ...(outcome.evidence.source === 'ths_ui' ? { contractNo: outcome.evidence.contractNo } : {}) }
      }
      this.liveEnabled = false; this.liveDigest = null
      return { code: outcome.code === 'NATIVE_CONFIRMATION_REQUIRED' ? 'NATIVE_CONFIRMATION_REQUIRED' : 'RECEIPT_UNKNOWN' }
    } catch (error) {
      this.abandon(ticket, 'expired')
      throw error
    }
  }
  async recover(value: unknown, caller: TrustedCaller): Promise<MacThsProductState> {
    const request: RecoveryCommand | null = inert(value) ? decodeMacThsRecovery(value) : null
    if (!request) { this.lastCode = 'INVALID_REQUEST'; this.notify(); return this.getState() }
    await this.run(caller, async generation => {
      assert(!this.adapter?.hasUnprovenOwned() && !this.unproven, 'EXECUTOR_EXIT_UNPROVEN')
      this.refresh()
      const source = this.source()
      if (request.kind === 'initialize') {
        assert(source.fresh && this.fresh && !this.store && !this.storageFailure && this.storeClass, 'RECOVERY_REQUIRED')
      } else if (request.kind === 'provisionLegacy') {
        assert(!source.database && source.proof && this.sealedUnprovisioned && !this.store &&
          !this.storageFailure && this.storeClass && this.verifyLegacy, 'RECOVERY_REQUIRED')
      } else {
        assert(this.store && !this.storageFailure, 'STORAGE_UNAVAILABLE')
        const prior = this.store.getRecoveryReceipt(request.recoveryId)
        assert(prior || (this.recoveryPlan?.canApply && this.recoveryPlan.recoveryId === request.recoveryId &&
          this.recoveryPlan.manifestHash === request.manifestHash && this.recoveryPlan.revision === request.expectedRevision), 'RECOVERY_PLAN_CHANGED')
      }
      this.nativeWaiting = true; this.notify()
      const approved = await this.options.confirm({
        title: request.kind === 'initialize' ? '初始化本机委托记录' : request.kind === 'provisionLegacy' ? '为已封存旧来源建立订单库' : '恢复本机委托记录',
        message: '这不是清空或重试订单。', detail: request.kind === 'initialize' ?
          '仅为没有旧交易残件的新来源创建记录。之前缺失的历史编号不可恢复，不自动启用真实交易。' : request.kind === 'provisionLegacy' ?
          '仅使用已监督并封存的旧来源。原件与编号保留；建库后仍须按具体计划确认导入及逐条核对，不自动授权或执行。' :
          '保留全部来源与永久编号；旧意图永久不可执行。恢复后仍需逐条核对和新的账户授权。',
        confirmLabel: request.kind === 'initialize' ? '初始化' : request.kind === 'provisionLegacy' ? '为封存来源建库' : '按此计划恢复',
      }, caller)
      this.check(caller, generation)
      if (!approved) return { code: 'USER_CANCELLED' }
      this.liveEnabled = false; this.liveDigest = null; this.ticket = null
      if (request.kind === 'initialize') {
        assert(this.source().fresh && !this.store, 'RECOVERY_REQUIRED')
        this.store = this.storeClass!.open({ directory: this.options.directory, initialize: true, testHooks: this.options.testHooks?.store })
        this.fresh = false; this.blockedReason = null; this.refresh()
        return { code: 'INITIALIZED' }
      }
      if (request.kind === 'provisionLegacy') {
        assert(source.proof && this.verifyLegacy, 'LEGACY_WRITER_UNFENCED')
        this.verifyLegacy(source.proof, this.options.directory)
        const current = this.source()
        assert(!current.database && current.proof && !this.store, 'RECOVERY_PLAN_CHANGED')
        this.store = this.storeClass!.open({ directory: this.options.directory, initialize: true,
          legacyQuiescence: source.proof, testHooks: this.options.testHooks?.store })
        this.sealedUnprovisioned = false; this.reauthorizationRequired = true
        this.refresh()
        return { code: 'RECOVERY_REQUIRED' }
      }
      this.source()
      this.store!.applyRecovery(request.recoveryId, request.manifestHash, request.expectedRevision)
      // F3 intentionally exposes no executor-status read API. A fresh native account authorization
      // must pass its assertNormal gate before this recovered service advertises canPrepare.
      this.reauthorizationRequired = true
      this.refresh()
      return { code: 'STORAGE_RECOVERED_REVIEW_REQUIRED' }
    })
    return this.getState()
  }
  async reviewIntent(value: unknown, caller: TrustedCaller): Promise<MacThsProductState> {
    const request: ReviewCommand | null = inert(value) ? decodeMacThsReview(value) : null
    if (!request) { this.lastCode = 'INVALID_REQUEST'; this.notify(); return this.getState() }
    await this.run(caller, async generation => {
      this.refresh()
      assert(this.store && !this.storageFailure && !this.blockedReason, 'RECOVERY_REQUIRED')
      assert(!this.adapter?.hasUnprovenOwned() && !this.unproven, 'EXECUTOR_EXIT_UNPROVEN')
      const record = this.store.getIntent(request.intentId)
      assert(record && record.snapshotHash === request.snapshotHash, 'SNAPSHOT_CONFLICT')
      assert(record.revision === request.expectedRevision, 'CAS_CONFLICT')
      assert(isPending(record), 'REVIEW_REQUIRED')
      assert((record.recoveryId ?? undefined) === request.recoveryId, 'RECOVERY_CONFLICT')
      this.nativeWaiting = true; this.notify()
      const approved = await this.options.confirm({
        title: '逐条核对结果不明的委托', message: '这是人工陈述，不是自动观察到成交。',
        detail: [record.snapshot ? this.presentation(record.snapshot, false).detail : '旧来源待核对意图：' + record.intentId,
          '核对范围：' + request.observation.scope.join(' / '), '本人陈述：' + request.observation.statement,
          request.observation.releaseGate ? '申请允许创建新的意图；原记录仍永久禁止重执行。' : '保留未决保护。'].join('\n'),
        confirmLabel: '记录本次人工核查',
      }, caller)
      this.check(caller, generation); this.refresh()
      assert(!this.blockedReason && !this.storageFailure && !this.adapter?.hasUnprovenOwned(), 'EXECUTOR_EXIT_UNPROVEN')
      if (!approved) return { code: 'USER_CANCELLED' }
      this.store.recordHumanReview(record.intentId, record.snapshotHash, {
        source: 'human_reported', method: 'native_dialog', ...request.observation,
        accountDigest: record.snapshot?.accountContext.digest ?? null,
        contractNo: record.snapshot?.cancelTarget?.contractNo ?? null,
      }, this.now(), request.expectedRevision, request.recoveryId ? {
        recoveryId: request.recoveryId, reviewRequestId: request.reviewRequestId,
      } : undefined)
      this.liveEnabled = false; this.liveDigest = null; this.reauthorizationRequired = true
      return { code: 'HUMAN_REVIEW_RECORDED' }
    })
    return this.getState()
  }
  revokeCaller(_callerId: number): void {
    this.generation++; this.liveEnabled = false; this.liveDigest = null
    const ticket = this.ticket; this.ticket = null
    try { this.abandon(ticket, 'cancelled') } catch (error) { this.capture(error) }
    this.refresh(); this.notify()
  }
  beginStop(): void {
    if (this.stopping) return
    this.stopping = true; this.revokeCaller(-1); this.lastCode = 'SESSION_STOPPING'; this.notify()
  }
  shutdown(): Promise<void> {
    if (this.stoppingTask) return this.stoppingTask
    this.beginStop()
    this.stoppingTask = (async () => {
      try {
        await this.starting
        await this.adapter?.stopOwned()
        await this.active
        await this.adapter?.stopOwned()
        if (this.store && this.adapter) await this.store.shutdown(this.adapter.coordinator)
        this.closed = true; this.notify()
      } catch (error) { this.capture(error); this.notify(); this.stoppingTask = null; throw error }
    })()
    return this.stoppingTask
  }
}
