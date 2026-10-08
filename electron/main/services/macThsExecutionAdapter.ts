import { createHash, randomUUID } from 'node:crypto'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import type { MacThsAction, MacThsMode, MacThsOrder } from '../../shared/macThsTypes'
import {
  decodeNativeObservation, nativeCompatibility, unavailableNativeCompatibility, validateNativeScriptRequest,
  NATIVE_OUTPUT_LIMIT, type NativeCompatibility, type NativeScriptRequest, type NativeObservationV1,
  type NativeAccountWitness, type NativeOrderFields,
} from '../../shared/macThsNativeProtocol'
import { hashIntentSnapshot, type AccountContext, type IntentSnapshot, type AdapterEvidence } from './macThsIntentStore'
import { MacThsRecoveryCoordinator, type ExecutorExitCapability } from './macThsRecoveryCoordinator'
import { macThsNativeScript, macThsScript } from './macThsScripts'

export type { NativeCompatibility, NativeScriptRequest, NativeObservationV1 } from '../../shared/macThsNativeProtocol'
export { createNativeObservationFixture } from '../../shared/macThsNativeProtocol'
export type NativeResult<T> = { ok: true; value: T; compatibility: NativeCompatibility }
  | { ok: false; value: null; code: string; compatibility: NativeCompatibility }
export interface ObservedNativeContext {
  accountContext: AccountContext
  observedAt: number
  mode: MacThsMode
  tradingDate: string
}
export interface ObservedCancelTarget extends ObservedNativeContext {
  target: NativeOrderFields & { contractNo: string; tradingDate: string; accountDigest: string }
}
export interface PreparedExecution {
  readonly executable: string
  readonly args: readonly string[]
  readonly nonce: string
  readonly expiresAt: number
  readonly deadlineMonotonic: number
}
export interface NativeExecutionResult {
  evidence: AdapterEvidence | null
  code: string
  compatibility: NativeCompatibility
  exitProof: ExecutorExitCapability | null
}
export interface MacThsExecutionAdapterOptions {
  directory: string
  /** Trusted construction only. No environment/IPC/configuration switch can enable these hooks. */
  testHooks?: {
    platform?: NodeJS.Platform
    command?: (request: Readonly<NativeScriptRequest>, script: string,
      auxiliaryAction?: 'preview' | 'queryOrders' | 'queryDeals') => { executable: string; args: readonly string[] }
  }
}
interface Plan {
  prepared: PreparedExecution
  request: NativeScriptRequest
  snapshot: Readonly<IntentSnapshot> | null
  wallFloor: number
  used: boolean
  auxiliary: boolean
}
interface Capture {
  instanceId: string
  child: ChildProcess
  plan: Plan
  stdout: Buffer[]
  stdoutBytes: number
  stderrBytes: number
  failure: string | null
  exitCode: number | null
  signal: NodeJS.Signals | null
  proof: ExecutorExitCapability | null
  completion: Promise<Capture>
  stopRequested: boolean
  consumed: boolean
  finish: () => void
}
interface Witness {
  account: NativeAccountWitness
  context: ObservedNativeContext
  deadlineMonotonic: number
}
function fail(code: string): never { throw Object.assign(new Error(code), { code }) }
function sameAccount(a: NativeAccountWitness, b: NativeAccountWitness): boolean {
  return a.kind === b.kind && a.value === b.value && a.broker === b.broker && a.selected === true && b.selected === true
}
function accountDigest(account: NativeAccountWitness, mode: MacThsMode): string {
  return createHash('sha256').update('rt-researchflow/mac-ths/account/v1\0')
    .update(JSON.stringify([account.broker, account.kind, account.value, mode === 'simulation' ? 'simulation' : 'live'])).digest('hex')
}
function sameOrder(a: NativeOrderFields, b: NativeOrderFields): boolean {
  return a.symbol === b.symbol && a.market === b.market && a.side === b.side && a.priceCents === b.priceCents && a.quantity === b.quantity
}
function newRequest(action: NativeScriptRequest['action'], mode: MacThsMode): NativeScriptRequest {
  return { nonce: randomUUID(), action, mode, expectedAccount: null, expectedClientVersion: null,
    expectedDate: null, order: null, contractNo: null, beforeContracts: null }
}
async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('EXECUTOR_EXIT_UNPROVEN'), { code: 'EXECUTOR_EXIT_UNPROVEN' })), milliseconds)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
class AdapterOwnedCoordinator extends MacThsRecoveryCoordinator {
  constructor(directory: string, private readonly admit: (executable: string, args: readonly string[], beforeSpawn?: () => void) => Plan,
    private readonly assertDeadline: (plan: Plan) => void,
    private readonly capture: (instance: { instanceId: string; child: ChildProcess }, plan: Plan) => void) {
    super(directory)
  }
  override launchExecutor(executable: string, args: readonly string[], options: SpawnOptions = {}, beforeSpawn?: () => void) {
    if (Object.keys(options).length) fail('UNOWNED_EXECUTOR')
    const plan = this.admit(executable, args, beforeSpawn)
    // Run at the coordinator's final synchronous PRE-spawn boundary, after argv/options
    // materialization. F3 must get first refusal after its launch-pending SQL: its exact
    // thrown sentinel proves no spawn. Do not catch, wrap or replace that exception.
    // An adapter-only deadline refusal is NOT an F3 sentinel and remains conservative.
    const instance = super.launchExecutor(executable, args, { stdio: 'pipe', shell: false }, () => {
      beforeSpawn?.()
      this.assertDeadline(plan)
    })
    this.capture(instance, plan)
    return instance
  }
}
export class MacThsExecutionAdapter {
  readonly coordinator: MacThsRecoveryCoordinator
  private readonly plans = new WeakMap<PreparedExecution, Plan>()
  private readonly argumentsToPlan = new WeakMap<readonly string[], Plan>()
  private readonly owned = new Map<string, Capture>()
  private readonly witnesses = new Map<string, Witness>()
  private readonly receipts = new Map<string, Plan>()
  private compatibility = unavailableNativeCompatibility()
  private stopping = false
  private readonly platform: NodeJS.Platform
  constructor(private readonly options: MacThsExecutionAdapterOptions) {
    this.platform = options.testHooks?.platform ?? process.platform
    this.coordinator = new AdapterOwnedCoordinator(options.directory,
      (executable, args, guard) => this.admit(executable, args, guard),
      plan => this.assertDeadline(plan),
      (instance, plan) => this.capture(instance, plan))
  }
  get ownedState(): 'idle' | 'running' | 'unproven' {
    const pending = [...this.owned.values()].filter(item => !item.proof)
    return pending.some(item => item.failure !== null) ? 'unproven' : pending.length ? 'running' : 'idle'
  }
  hasUnprovenOwned(): boolean { return this.ownedState !== 'idle' }
  private checkReady(): void {
    if (this.platform !== 'darwin') fail('UNSUPPORTED_PLATFORM')
    if (this.stopping || this.hasUnprovenOwned()) fail('EXECUTOR_EXIT_UNPROVEN')
    for (const [id, item] of this.owned) if (item.proof && item.consumed) this.owned.delete(id)
    if ([...this.owned.values()].some(item => !item.consumed)) fail('EXECUTOR_EXIT_UNPROVEN')
  }
  private admit(executable: string, args: readonly string[], guard?: () => void): Plan {
    this.checkReady()
    const plan = this.argumentsToPlan.get(args)
    if (!plan || plan.used || executable !== plan.prepared.executable) fail('UNOWNED_EXECUTOR')
    if (plan.request.action === 'execute' && !plan.auxiliary && typeof guard !== 'function') fail('STORE_LAUNCH_REQUIRED')
    plan.used = true
    return plan
  }
  private assertDeadline(plan: Plan): void {
    if (Date.now() < plan.wallFloor || Date.now() >= plan.prepared.expiresAt
      || performance.now() >= plan.prepared.deadlineMonotonic) fail('EXECUTION_PERMISSION_EXPIRED')
  }
  private capture(instance: { instanceId: string; child: ChildProcess }, plan: Plan): void {
    let resolve!: (value: Capture) => void
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopTimer: ReturnType<typeof setTimeout> | undefined
    let finished = false
    const item: Capture = { ...instance, plan, stdout: [], stdoutBytes: 0, stderrBytes: 0, failure: null,
      exitCode: null, signal: null, proof: null, stopRequested: false, consumed: false, completion: new Promise(done => { resolve = done }),
      finish: () => {
        if (finished) return
        finished = true
        if (timer) clearTimeout(timer)
        if (stopTimer) clearTimeout(stopTimer)
        resolve(item)
      } }
    // Register before returning to store: a later running-row persistence failure cannot lose ownership.
    this.owned.set(instance.instanceId, item)
    const stop = (code: string) => {
      item.failure ??= code
      if (!item.stopRequested) {
        item.stopRequested = true
        void this.coordinator.stopExecutor(item.instanceId).catch(() => { item.failure ??= 'EXECUTOR_EXIT_UNPROVEN' })
        stopTimer = setTimeout(item.finish, 1000)
      }
    }
    instance.child.stdout?.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      item.stdoutBytes += bytes.length
      if (item.stdoutBytes > NATIVE_OUTPUT_LIMIT) { stop('NATIVE_OUTPUT_LIMIT'); return }
      item.stdout.push(Buffer.from(bytes))
    })
    instance.child.stderr?.on('data', (chunk: Buffer | string) => {
      item.stderrBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
      if (item.stderrBytes > NATIVE_OUTPUT_LIMIT) stop('NATIVE_OUTPUT_LIMIT')
      // Never retain, log or export stderr, including parser/permission diagnostics.
    })
    instance.child.once('error', () => stop('NATIVE_PROCESS_ERROR'))
    instance.child.once('close', (code, signal) => { item.exitCode = code; item.signal = signal })
    if (!instance.child.stdout || !instance.child.stderr) stop('NATIVE_PROCESS_ERROR')
    instance.child.stdin?.on('error', () => {})
    instance.child.stdin?.end()
    void this.coordinator.waitExecutor(instance.instanceId).then(proof => {
      item.proof = proof
      item.finish()
    }, () => { item.failure ??= 'EXECUTOR_EXIT_UNPROVEN'; item.finish() })
    const remaining = Math.min(plan.prepared.expiresAt - Date.now(), plan.prepared.deadlineMonotonic - performance.now())
    timer = setTimeout(() => stop('NATIVE_TIMEOUT'), Math.max(0, remaining))
  }
  private prepare(request: NativeScriptRequest, snapshot: Readonly<IntentSnapshot> | null,
    limits?: { expiresAt: number; deadlineMonotonic: number }, auxiliary?: { action: 'preview' | 'queryOrders' | 'queryDeals'; order?: MacThsOrder }): Plan {
    this.checkReady()
    const wall = Date.now(), mono = performance.now()
    const expiresAt = Math.min(wall + 20_000, limits?.expiresAt ?? Infinity, snapshot?.expiresAt ?? Infinity)
    const deadlineMonotonic = Math.min(mono + 20_000, limits?.deadlineMonotonic ?? Infinity, mono + expiresAt - wall)
    if (!Number.isFinite(expiresAt) || !Number.isFinite(deadlineMonotonic) || expiresAt <= wall || deadlineMonotonic <= mono) fail('EXECUTION_PERMISSION_EXPIRED')
    validateNativeScriptRequest(request)
    const script = auxiliary ? macThsScript(auxiliary.action as MacThsAction, request.mode, auxiliary.order) : macThsNativeScript(request)
    const command = this.options.testHooks?.command?.(Object.freeze(structuredClone(request)), script, auxiliary?.action)
      ?? { executable: '/usr/bin/osascript', args: auxiliary ? ['-e', script] : ['-l', 'JavaScript', '-e', script] }
    if (typeof command.executable !== 'string' || !Array.isArray(command.args) || command.args.some(arg => typeof arg !== 'string')) fail('NATIVE_COMMAND_INVALID')
    const prepared: PreparedExecution = Object.freeze({ executable: command.executable, args: Object.freeze([...command.args]),
      nonce: request.nonce, expiresAt, deadlineMonotonic })
    const plan: Plan = { prepared, request, snapshot, wallFloor: wall, used: false, auxiliary: Boolean(auxiliary) }
    this.plans.set(prepared, plan)
    this.argumentsToPlan.set(prepared.args, plan)
    return plan
  }
  private async launchReadOnly(plan: Plan): Promise<Capture> {
    const instance = this.coordinator.launchExecutor(plan.prepared.executable, plan.prepared.args)
    return this.owned.get(instance.instanceId)!.completion
  }
  private decode(item: Capture): { packet: NativeObservationV1 | null; code: string } {
    try {
      if (!item.proof || item.failure || item.exitCode !== 0 || item.signal || item.stderrBytes || Date.now() < item.plan.wallFloor)
        return { packet: null, code: item.failure ?? (!item.proof ? 'EXECUTOR_EXIT_UNPROVEN' : 'RECEIPT_UNKNOWN') }
      const packet = decodeNativeObservation(Buffer.concat(item.stdout), item.plan.request)
      this.compatibility = nativeCompatibility(packet)
      return { packet, code: packet.code }
    } catch { return { packet: null, code: 'NATIVE_PROTOCOL_INVALID' } }
    finally { for (const chunk of item.stdout) chunk.fill(0); item.stdout.length = 0; item.consumed = true }
  }
  private remember(packet: NativeObservationV1, mode: MacThsMode): ObservedNativeContext | null {
    if (!packet.account || !packet.clientVersion || !packet.tradingDate || packet.layoutProfile === null
      || packet.mode !== (mode === 'simulation' ? 'simulation' : 'live')) return null
    const observedAt = Date.now(), digest = accountDigest(packet.account, mode)
    const accountContext: AccountContext = { digest, label: '**' + packet.account.value.slice(-4), distinguishable: true,
      capturedAt: observedAt, clientVersion: packet.clientVersion, adapterVersion: '3' }
    const context: ObservedNativeContext = { accountContext, observedAt, mode, tradingDate: packet.tradingDate }
    for (const [key, witness] of this.witnesses) if (performance.now() >= witness.deadlineMonotonic) this.witnesses.delete(key)
    if (!this.witnesses.has(digest) && this.witnesses.size >= 32) fail('ACCOUNT_OBSERVATION_CAPACITY')
    this.witnesses.set(digest, { account: { ...packet.account }, context, deadlineMonotonic: performance.now() + 120_000 })
    return structuredClone(context)
  }
  private failure(error: unknown): { ok: false; value: null; code: string; compatibility: NativeCompatibility } {
    const code = (error as { code?: string })?.code
    const safe = ['UNSUPPORTED_PLATFORM', 'EXECUTOR_EXIT_UNPROVEN', 'EXECUTION_PERMISSION_EXPIRED',
      'ACCOUNT_IDENTITY_UNAVAILABLE', 'ACCOUNT_OBSERVATION_CAPACITY', 'NATIVE_PROTOCOL_INVALID'].includes(code ?? '')
    return { ok: false, value: null, code: safe ? code! : 'NATIVE_PROTOCOL_INVALID', compatibility: { ...this.compatibility } }
  }
  async observeContext(mode: MacThsMode = 'live'): Promise<NativeResult<ObservedNativeContext>> {
    try {
      const item = await this.launchReadOnly(this.prepare(newRequest('observe_context', mode), null))
      const decoded = this.decode(item)
      const context = decoded.packet?.code === 'READY' ? this.remember(decoded.packet, mode) : null
      return context ? { ok: true, value: context, compatibility: { ...this.compatibility } }
        : { ok: false, value: null, code: decoded.code, compatibility: { ...this.compatibility } }
    } catch (error) { return this.failure(error) }
  }
  async observeCancelTarget(contractNo: string, mode: MacThsMode = 'live'): Promise<NativeResult<ObservedCancelTarget>> {
    try {
      const request = { ...newRequest('observe_cancel_target', mode), contractNo }
      const decoded = this.decode(await this.launchReadOnly(this.prepare(request, null)))
      const context = decoded.packet?.code === 'TARGET_OBSERVED' ? this.remember(decoded.packet, mode) : null
      const target = decoded.packet?.target
      if (!context || !target || target.contractNo !== contractNo || target.tradingDate !== context.tradingDate)
        return { ok: false, value: null, code: decoded.code === 'TARGET_OBSERVED' ? 'TARGET_UNVERIFIED' : decoded.code, compatibility: { ...this.compatibility } }
      return { ok: true, value: { ...context, target: { contractNo: target.contractNo, tradingDate: target.tradingDate,
        accountDigest: context.accountContext.digest, symbol: target.symbol, market: target.market,
        side: target.side, priceCents: target.priceCents, quantity: target.quantity } }, compatibility: { ...this.compatibility } }
    } catch (error) { return this.failure(error) }
  }
  private witness(snapshot: Readonly<IntentSnapshot>, fresh = true): Witness {
    const witness = this.witnesses.get(snapshot.accountContext.digest)
    if (!witness || witness.context.mode !== snapshot.mode || witness.context.accountContext.clientVersion !== snapshot.accountContext.clientVersion
      || (fresh && (performance.now() >= witness.deadlineMonotonic || Date.now() < witness.context.observedAt))) fail('ACCOUNT_IDENTITY_UNAVAILABLE')
    return witness
  }
  prepareExecution(snapshot: Readonly<IntentSnapshot>, limits: { expiresAt: number; deadlineMonotonic: number }): PreparedExecution {
    if (!limits || !Number.isFinite(limits.expiresAt) || !Number.isFinite(limits.deadlineMonotonic)) fail('EXECUTION_PERMISSION_EXPIRED')
    hashIntentSnapshot(snapshot)
    const witness = this.witness(snapshot)
    const request: NativeScriptRequest = { ...newRequest('execute', snapshot.mode), expectedAccount: { ...witness.account },
      expectedClientVersion: snapshot.accountContext.clientVersion, expectedDate: snapshot.cancelTarget?.tradingDate ?? witness.context.tradingDate,
      order: { symbol: snapshot.symbol, market: snapshot.market, side: snapshot.side, priceCents: snapshot.priceCents, quantity: snapshot.quantity },
      contractNo: snapshot.cancelTarget?.contractNo ?? null }
    const plan = this.prepare(request, structuredClone(snapshot), limits)
    return plan.prepared
  }
  private evidence(packet: NativeObservationV1, plan: Plan): AdapterEvidence | null {
    const snapshot = plan.snapshot, request = plan.request
    if (!snapshot || !packet.account || !request.expectedAccount || !sameAccount(packet.account, request.expectedAccount)
      || packet.layoutProfile === null || packet.fields.account !== 'recognized' || packet.fields.mode !== 'recognized'
      || packet.clientVersion !== snapshot.accountContext.clientVersion
      || packet.mode !== (snapshot.mode === 'simulation' ? 'simulation' : 'live')
      || accountDigest(packet.account, snapshot.mode) !== snapshot.accountContext.digest) return null
    const common = { accountDigest: snapshot.accountContext.digest, observedAt: Date.now() }
    if (packet.action === 'execute' && !packet.submitTouched && packet.phase === 'before_submit') {
      const reasons = { READBACK_MISMATCH: 'readback_mismatch', ORDER_CONTROL_DISABLED: 'control_disabled',
        LAYOUT_UNSUPPORTED: 'layout_unsupported', TABLE_UNSUPPORTED: 'layout_unsupported' } as const
      const reason = reasons[packet.code as keyof typeof reasons]
      return reason ? { source: 'adapter', effectPhase: 'before_submit', ...common, reason } : null
    }
    const target = packet.target
    if (!target || !sameOrder(target, snapshot) || target.tradingDate !== request.expectedDate
      || packet.tradingDate !== request.expectedDate || packet.fields.tradingDate !== 'recognized' || packet.fields.headers !== 'recognized'
      || packet.fields.receipt !== 'recognized' || !packet.contractMatch) return null
    if (packet.action === 'execute' && (!packet.submitTouched || packet.phase !== 'after_submit')) return null
    if (snapshot.action === 'submit') {
      if (packet.action === 'execute' && (packet.fields.readback !== 'recognized' || !packet.readback || !sameOrder(packet.readback, snapshot))) return null
      const baseline = request.action === 'observe_receipt' ? request.beforeContracts : packet.beforeContracts
      if (!baseline || baseline.includes(target.contractNo) || packet.contractMatch !== 'unique_new' || target.observation !== 'accepted'
        || !['LIVE_ACCEPTED', 'SIMULATION_ACCEPTED'].includes(packet.code)) return null
    } else if (target.contractNo !== snapshot.cancelTarget?.contractNo || packet.contractMatch !== 'unique_target'
      || !['cancelled', 'partially_cancelled'].includes(target.observation ?? '')
      || !['LIVE_CANCELLED', 'SIMULATION_CANCELLED'].includes(packet.code)) return null
    return { source: 'ths_ui', effectPhase: 'after_submit', ...common, ...target,
      observation: target.observation!, contractMatch: packet.contractMatch }
  }
  async awaitExecution(instanceId: string, prepared: PreparedExecution): Promise<NativeExecutionResult> {
    const plan = this.plans.get(prepared), item = this.owned.get(instanceId)
    if (!plan || !item || item.plan !== plan || !plan.snapshot || plan.request.action !== 'execute') fail('UNOWNED_EXECUTOR')
    await item.completion
    const decoded = this.decode(item)
    if (decoded.packet?.beforeContracts && decoded.packet.submitTouched) {
      plan.request.beforeContracts = [...decoded.packet.beforeContracts]
      this.receipts.set(hashIntentSnapshot(plan.snapshot), plan)
      while (this.receipts.size > 32) this.receipts.delete(this.receipts.keys().next().value!)
    }
    return { evidence: decoded.packet ? this.evidence(decoded.packet, plan) : null, code: decoded.code,
      compatibility: { ...this.compatibility }, exitProof: item.proof }
  }
  async observeReceipt(snapshot: Readonly<IntentSnapshot>): Promise<NativeExecutionResult> {
    try {
      const hash = hashIntentSnapshot(snapshot), original = this.receipts.get(hash)
      const witness = this.witness(snapshot, false)
      const request: NativeScriptRequest = { ...newRequest('observe_receipt', snapshot.mode), expectedAccount: { ...witness.account },
        expectedClientVersion: snapshot.accountContext.clientVersion, expectedDate: snapshot.cancelTarget?.tradingDate ?? original?.request.expectedDate ?? null,
        order: { symbol: snapshot.symbol, market: snapshot.market, side: snapshot.side, priceCents: snapshot.priceCents, quantity: snapshot.quantity },
        contractNo: snapshot.cancelTarget?.contractNo ?? null, beforeContracts: original?.request.beforeContracts ?? null }
      const plan = this.prepare(request, null)
      plan.snapshot = structuredClone(snapshot) // Read-only observation is allowed after the order authorization expired.
      const item = await this.launchReadOnly(plan), decoded = this.decode(item)
      return { evidence: decoded.packet ? this.evidence(decoded.packet, plan) : null, code: decoded.code,
        compatibility: { ...this.compatibility }, exitProof: item.proof }
    } catch (error) {
      const result = this.failure(error)
      return { evidence: null, code: result.code, compatibility: result.compatibility, exitProof: null }
    }
  }
  async performAuxiliary(action: 'probe' | 'preview' | 'queryOrders' | 'queryDeals', mode: MacThsMode, order?: MacThsOrder): Promise<{ code: string; compatibility: NativeCompatibility }> {
    if (action === 'probe') {
      const result = await this.observeContext(mode)
      return { code: result.ok ? 'READY' : result.code, compatibility: result.compatibility }
    }
    if (!['preview', 'queryOrders', 'queryDeals'].includes(action)) return { code: 'NATIVE_PROTOCOL_INVALID', compatibility: { ...this.compatibility } }
    try {
      const item = await this.launchReadOnly(this.prepare(newRequest('observe_context', mode), null, undefined, { action, order }))
      let code = 'RECEIPT_UNKNOWN'
      if (item.proof && !item.failure && item.exitCode === 0 && !item.signal && !item.stderrBytes) {
        const output = Buffer.concat(item.stdout).toString('utf8').trim()
        if (['READY', 'FORM_READY', 'VIEW_OPENED', 'MODE_UNVERIFIED', 'LAYOUT_UNSUPPORTED', 'BROKER_UNVERIFIED',
          'READBACK_MISMATCH', 'TABLE_UNSUPPORTED', 'CLIENT_NOT_RUNNING', 'TRADE_VIEW_REQUIRED', 'AUTOMATION_DENIED', 'SCRIPT_ERROR'].includes(output)) code = output
      }
      for (const chunk of item.stdout) chunk.fill(0)
      item.stdout.length = 0
      item.consumed = true
      return { code: item.failure ?? code, compatibility: { ...this.compatibility } }
    } catch (error) { const result = this.failure(error); return { code: result.code, compatibility: result.compatibility } }
  }
  async stopOwned(): Promise<void> {
    this.stopping = true
    try {
      await Promise.all([...this.owned.values()].filter(item => !item.proof).map(async item => {
        item.failure ??= 'NATIVE_CANCELLED'
        try { item.proof = await bounded(this.coordinator.stopExecutor(item.instanceId), 1000); item.finish() }
        catch { fail('EXECUTOR_EXIT_UNPROVEN') }
      }))
      if (this.hasUnprovenOwned()) fail('EXECUTOR_EXIT_UNPROVEN')
      for (const item of this.owned.values()) {
        for (const chunk of item.stdout) chunk.fill(0)
        item.stdout.length = 0; item.consumed = true
      }
    } finally { this.stopping = false }
  }
}
export function createMacThsExecutionAdapter(options: MacThsExecutionAdapterOptions): MacThsExecutionAdapter {
  return new MacThsExecutionAdapter(options)
}
