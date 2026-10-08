import { nativeTestBinding, nativeTestTempRoot } from '../fixtures/macThsNativeTestRuntime'
import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MacThsOrderService, type MacThsOrderServiceOptions, type NativeConfirmation, type TrustedCaller } from '../../electron/main/services/macThsOrderService'
import { MacThsIntentStore } from '../../electron/main/services/macThsIntentStore'
import { MacThsRecoveryCoordinator } from '../../electron/main/services/macThsRecoveryCoordinator'
import { decodeMacThsRequest, decodeMacThsReview, safeMacThsDiagnostic, type ReviewCommand, type MacThsRequest } from '../../electron/shared/macThsTypes'

import type Database from 'better-sqlite3'
import { createNativeObservationFixture, type NativeObservationV1, type NativeTarget } from '../../electron/shared/macThsNativeProtocol'

const binding = nativeTestBinding
const root = mkdtempSync(join(nativeTestTempRoot, 'rt-i13-service-'))
console.info('Product-chain fixtures retained:', root)
const services = new Set<MacThsOrderService>()
const caller: TrustedCaller = { id: 1, frame: {}, isCurrent: () => true }
function directory() { return mkdtempSync(join(root, 'case-')) }
async function start(dir = directory(), changes: Partial<MacThsOrderServiceOptions> = {}) {
  const service = new MacThsOrderService({ directory: dir, accessibility: () => true, confirm: async () => true,
    testHooks: { platform: 'darwin', store: { nativeBinding: binding },
      adapter: { platform: 'darwin', command: () => { throw new Error('Unexpected native launch in storage-only test') } } },
    ...changes })
  services.add(service)
  await service.start()
  return service
}
afterEach(async () => {
  const owned = [...services]; services.clear()
  const errors: unknown[] = []
  for (const service of owned) { try { await service.shutdown() } catch (error) { errors.push(error) } }
  if (errors.length) throw new AggregateError(errors, 'Owned service shutdown failed; fixture bytes retained')
})

describe('1.3 explicit provisioning and service ownership', () => {
  it('does not create records or start automation from startup/status; native initialization is explicit', async () => {
    const dir = directory()
    let confirmations = 0
    const service = await start(dir, { confirm: async () => { confirmations++; return true } })
    const sequence = service.getState().stateSequence
    expect(service.getState()).toMatchObject({ serviceState: 'NOT_INITIALIZED', canInitialize: true, liveEnabled: false })
    expect(service.getState().stateSequence).toBe(sequence)
    expect(readdirSync(dir)).toEqual([])
    expect(confirmations).toBe(0)
    expect(await service.recover({ kind: 'initialize' }, caller)).toMatchObject({
      serviceState: 'READY_DISABLED', canPrepare: true, coverage: { kind: 'fresh', earlierIds: 'unavailable' },
    })
    expect(confirmations).toBe(1)
    expect(readdirSync(dir)).toContain('mac-ths-orders.v2.sqlite')
  })
  it('keeps Windows unsupported without initializing a database or adapter', async () => {
    const dir = directory()
    const service = await start(dir, { testHooks: { platform: 'win32' } })
    expect(service.getState().serviceState).toBe('UNSUPPORTED_PLATFORM')
    expect((await service.execute({ action: 'probe', mode: 'live' }, caller)).code).toBe('MAC_REQUIRED')
    expect(readdirSync(dir)).toEqual([])
  })
  it('rechecks artifacts after the native initialization dialog without deleting new evidence', async () => {
    const dir = directory()
    const service = await start(dir, { confirm: async () => {
      writeFileSync(join(dir, 'mac-ths-experiment-journal.json.tmp'), 'UNFINISHED-SOURCE')
      return true
    } })
    expect(await service.recover({ kind: 'initialize' }, caller)).toMatchObject({
      serviceState: 'RECOVERY_REQUIRED', recoveryReason: 'LEGACY_WRITER_UNFENCED', canInitialize: false,
    })
    expect(readdirSync(dir)).toEqual(['mac-ths-experiment-journal.json.tmp'])
  })
  it.each(['mac-ths-experiment-journal.json', 'mac-ths-experiment-journal.json.tmp',
    'mac-ths-intents.lock', 'mac-ths-intents.pending', 'mac-ths-intents.v1.json.orphan.tmp'])(
    'preserves and blocks an unsupervised source: %s', async name => {
      const dir = directory(), original = Buffer.from('UNTRUSTED-OLD-SOURCE\n')
      writeFileSync(join(dir, name), original)
      const service = await start(dir)
      expect(service.getState()).toMatchObject({ serviceState: 'RECOVERY_REQUIRED',
        recoveryReason: 'LEGACY_WRITER_UNFENCED', canPrepare: false, canRecover: false })
      await service.recover({ kind: 'initialize' }, caller)
      expect(readFileSync(join(dir, name))).toEqual(original)
      expect(readdirSync(dir)).toEqual([name])
    })
  it('holds real SQLite EXCLUSIVE ownership across service calls and commits', async () => {
    const dir = directory(), first = await start(dir)
    await first.recover({ kind: 'initialize' }, caller)
    const second = await start(dir)
    expect(second.getState()).toMatchObject({ serviceState: 'RECOVERY_REQUIRED', recoveryReason: 'ACTIVE_OWNER' })
    expect((await first.execute({ action: 'disableLive' }, caller)).state.serviceState).toBe('READY_DISABLED')
    await first.shutdown()
    const third = await start(dir)
    expect(third.getState().serviceState).toBe('READY_DISABLED')
  })
  it('does not treat a missing previously enabled database as a fresh profile', async () => {
    const dir = directory()
    writeFileSync(join(dir, 'mac-ths-orders.sqlite-enabled'), '{"schemaVersion":2,"database":"mac-ths-orders.v2.sqlite"}')
    const service = await start(dir)
    expect(service.getState()).toMatchObject({ serviceState: 'BLOCKED_STORAGE', canInitialize: false, canPrepare: false })
  })
  it('revokes a pending native action synchronously; stop waits and never initializes afterward', async () => {
    let release!: (value: boolean) => void
    const service = await start(undefined, { confirm: () => new Promise(resolve => { release = resolve }) })
    const pending = service.recover({ kind: 'initialize' }, caller)
    service.beginStop()
    const stopping = service.shutdown()
    expect(service.getState().serviceState).toBe('STOPPING')
    release(true)
    await pending; await stopping
    expect(service.getState()).toMatchObject({ serviceState: 'STOPPING', coverage: null, liveEnabled: false })
  })
})

describe('1.3 strict renderer DTOs and evidence boundaries', () => {
  const order = { requestId: randomUUID(), mode: 'live', side: 'buy', symbol: '600000',
    price: '10.00', quantity: 100, maxNotional: '1000.00' }
  it('requires the same stable top/order request ID and rejects renderer backend capabilities', () => {
    const request = { action: 'submitLive', mode: 'live', requestId: order.requestId, order }
    expect(decodeMacThsRequest(request)).not.toBeNull()
    expect(decodeMacThsRequest({ ...request, requestId: randomUUID() })).toBeNull()
    for (const extra of [{ initialize: true }, { nativeBinding: binding }, { accountDigest: 'a'.repeat(64) },
      { source: 'quote' }, { claimed: true }, { evidence: {} }, { script: 'bad' }])
      expect(decodeMacThsRequest({ ...request, ...extra })).toBeNull()
    expect(decodeMacThsRequest({ ...request, order: { ...order, password: 'secret' } })).toBeNull()
  })
  it('rejects nonfinite numbers, accessors and proxies before serialization', async () => {
    let calls = 0
    const getter = { ...order, get quantity() { calls++; return 100 } }
    expect(decodeMacThsRequest({ action: 'submitLive', mode: 'live', requestId: order.requestId, order: getter })).toBeNull()
    expect(calls).toBe(0)
    for (const quantity of [NaN, Infinity, -Infinity])
      expect(decodeMacThsRequest({ action: 'submitLive', mode: 'live', requestId: order.requestId, order: { ...order, quantity } })).toBeNull()
    const service = await start()
    const proxy = new Proxy({}, { get: () => { throw new Error('must not access proxy') } })
    expect((await service.execute(proxy, caller)).code).toBe('INVALID_REQUEST')
  })
  it('never permits still_uncertain or incomplete human review to release protection', () => {
    const review: ReviewCommand = { intentId: randomUUID(), snapshotHash: null, expectedRevision: 1,
      reviewRequestId: randomUUID(), observation: { statement: 'still_uncertain', scope: ['orders', 'deals', 'confirmation'], releaseGate: true } }
    expect(decodeMacThsReview(review)).toBeNull()
    expect(decodeMacThsReview({ ...review, observation: { ...review.observation, releaseGate: false } })).not.toBeNull()
    expect(decodeMacThsReview({ ...review, observation: { statement: 'no_order_seen', scope: ['orders'], releaseGate: true } })).toBeNull()
    expect(decodeMacThsReview({ ...review, reviewingSessionId: randomUUID() })).toBeNull()
  })
  it('exports state-only diagnostics without pretending a probe ran or exposing local records', async () => {
    const service = await start()
    const state = service.getState()
    const diagnostic = safeMacThsDiagnostic(null, state)
    expect(diagnostic.tested).toBe(false)
    expect(JSON.stringify(diagnostic)).not.toContain(state.sessionId)
    expect(diagnostic.serviceState).toBe('NOT_INITIALIZED')
  })
})

describe('1.3 real supervised-source recovery', () => {
  it('restores a real exited writer seal, imports atomically, reviews without changing UNKNOWN, and retains source bytes', async () => {
    const dir = join(directory(), 'supervised')
    const coordinator = MacThsRecoveryCoordinator.createLegacySource(dir, 'i13-controlled-writer')
    const requestId = randomUUID()
    const raw = JSON.stringify({ unknownPending: true, usedRequests: [requestId] })
    const path = join(dir, 'mac-ths-experiment-journal.json')
    coordinator.launchLegacy(process.execPath, ['-e', 'require("node:fs").writeFileSync(' + JSON.stringify(path) + ',' + JSON.stringify(raw) + ')'])
    const proof = await coordinator.retireLegacyEntry()
    const initial = MacThsIntentStore.open({ directory: dir, initialize: true, legacyQuiescence: proof,
      testHooks: { nativeBinding: binding } })
    initial.close()
    const service = await start(dir)
    const plan = service.getState().recovery!
    expect(plan.canApply).toBe(true)
    const command = { kind: 'apply', recoveryId: plan.recoveryId, manifestHash: plan.manifestHash, expectedRevision: plan.revision }
    const recovered = await service.recover(command, caller)
    expect(recovered.unknownPending).toBe(true)
    expect(recovered.liveEnabled).toBe(false)
    expect(recovered.coverage?.legacyIds).toBe(1)
    expect(readFileSync(path, 'utf8')).toBe(raw)
    const revision = recovered.intents[0].revision
    await service.recover(command, caller)
    expect(service.getState().intents[0].revision).toBe(revision)
    for (const intent of service.getState().intents.filter(i => i.recoveryQuarantine)) {
      const review = { intentId: intent.intentId, snapshotHash: intent.snapshotHash,
        expectedRevision: intent.revision, recoveryId: intent.recoveryId!, reviewRequestId: randomUUID(),
        observation: { statement: 'no_order_seen', scope: ['orders', 'deals', 'confirmation'], releaseGate: true } }
      await service.reviewIntent(review, caller)
    }
    const reviewed = service.getState()
    expect(reviewed.unknownPending).toBe(false)
    expect(reviewed.liveEnabled).toBe(false)
    expect(reviewed.canPrepare).toBe(false) // A fresh native account/session authorization is still required.
    expect(reviewed.intents.every(i => i.executionForbidden)).toBe(true)
    expect(reviewed.intents.some(i => i.state === 'LEGACY_UNKNOWN')).toBe(true)
    expect(readdirSync(dir)).toContain('mac-ths-intents.lock')
  }, 20000)
})

/** Facts are synthetic test observations, never production account/receipt defaults. The shared
 * fixture constructor and the real production decoder belong to the native adapter. */
const nativeFacts = {
  account: { kind: 'fund_account' as const, value: 'FIXTURE00001234', broker: 'citics' as const, selected: true as const },
  clientVersion: '9.0.0', tradingDate: '2026-10-08',
}
const nativeOrder = { symbol: '600000', market: 'SH' as const, side: 'buy' as const, priceCents: 1000, quantity: 100 }
type Scenario = {
  account: string; behavior: 'accepted' | 'lost' | 'before_submit' | 'partial_cancel' | 'slow' | 'masked'
  approved: boolean; delay: number; commands: string[]; prompts: NativeConfirmation[]
  afterConfirm?: (prompt: NativeConfirmation) => void
}
async function chain(dir = directory(), hooks: { now?: () => number; monotonic?: () => number; ticketLifetimeMs?: number } = {}) {
  const scenario: Scenario = { account: nativeFacts.account.value, behavior: 'accepted', approved: true, delay: 5000, commands: [], prompts: [] }
  const spawnLog = join(dir, 'test-only-spawn.log')
  let database!: Database.Database
  const service = await start(dir, {
    confirm: async prompt => { scenario.prompts.push(prompt); scenario.afterConfirm?.(prompt); return scenario.approved },
    testHooks: { platform: 'darwin', ...hooks,
      store: { nativeBinding: binding, onDatabaseOpen: db => { database = db } },
      adapter: { platform: 'darwin', command: (request, script, auxiliary) => {
        scenario.commands.push(auxiliary ?? request.action)
        expect(script.length).toBeGreaterThan(100)
        if (!auxiliary) expect(script).toContain(request.nonce)
        let output: string
        if (auxiliary) output = auxiliary === 'preview' ? 'FORM_READY' : 'VIEW_OPENED'
        else if (request.action === 'execute' && scenario.behavior === 'lost') output = 'LIVE_ACCEPTED|NOT-F3-EVIDENCE'
        else {
          const target: NativeTarget = { ...nativeOrder, contractNo: request.contractNo ?? 'TEST-NEW',
            tradingDate: nativeFacts.tradingDate, observation: request.action === 'execute' && request.contractNo ?
              (scenario.behavior === 'partial_cancel' ? 'partially_cancelled' : 'cancelled') : 'accepted',
            filledQuantity: null, cancelledQuantity: null }
          const facts = { ...nativeFacts, account: { ...nativeFacts.account, value: scenario.account },
            ...(request.action === 'observe_context' ? {} : { target }) }
          const overrides: Partial<NativeObservationV1> = scenario.behavior === 'masked' ? {
            account: null, code: 'ACCOUNT_IDENTITY_UNAVAILABLE', fields: { account: 'masked_only', mode: 'recognized',
              tradingDate: 'recognized', headers: 'recognized', readback: 'missing', receipt: 'missing' },
          } : request.action === 'execute' && scenario.behavior === 'before_submit' ? {
            target: null, contractMatch: null, phase: 'before_submit', submitTouched: false, code: 'READBACK_MISMATCH',
          } : {}
          output = JSON.stringify(createNativeObservationFixture(request, facts, overrides))
        }
        const mark = request.action === 'execute' ? 'require("node:fs").appendFileSync(' + JSON.stringify(spawnLog) + ',"spawn\\n");' : ''
        const emit = 'process.stdout.write(' + JSON.stringify(output) + ')'
        const delayed = request.action === 'execute' && scenario.behavior === 'slow'
        return { executable: process.execPath, args: ['-e', mark + (delayed ? 'setTimeout(()=>{' + emit + '},' + scenario.delay + ')' : emit)] }
      } },
    },
  })
  if (service.getState().canInitialize) await service.recover({ kind: 'initialize' }, caller)
  return { service, scenario, dir, spawnLog, database: () => database }
}
function orderRequest(mode: 'live' | 'simulation' = 'live'): MacThsRequest {
  const requestId = randomUUID()
  return { action: mode === 'live' ? 'submitLive' : 'submitSimulation', mode, requestId,
    order: { requestId, mode, side: 'buy', symbol: '600000', price: '10.00', quantity: 100, maxNotional: '1000.00' } }
}
async function offer(service: MacThsOrderService, request: MacThsRequest): Promise<MacThsRequest> {
  const result = await service.execute(request, caller)
  expect(result.code).toBe('CONFIRMATION_REQUIRED')
  expect(result.confirmation).toMatchObject({ sessionId: service.sessionId })
  return { ...request, confirmationToken: result.confirmation!.token,
    ...(result.confirmation!.intentBinding ? { intentBinding: result.confirmation!.intentBinding } : {}) }
}
async function enable(service: MacThsOrderService) {
  const request: MacThsRequest = { action: 'authorizeLive', mode: 'live', liveRiskAcknowledged: true }
  expect((await service.execute(await offer(service, request), caller)).code).toBe('LIVE_ENABLED')
}
async function review(service: MacThsOrderService, releaseGate = true) {
  for (const record of service.getState().intents.filter(i => i.recoveryQuarantine ||
    (['UNKNOWN', 'LEGACY_UNKNOWN'].includes(i.state) && !i.gateReleased))) {
    await service.reviewIntent({ intentId: record.intentId, snapshotHash: record.snapshotHash, expectedRevision: record.revision,
      reviewRequestId: randomUUID(), ...(record.recoveryId ? { recoveryId: record.recoveryId } : {}),
      observation: { statement: releaseGate ? 'no_order_seen' : 'still_uncertain',
        scope: ['orders', 'deals', 'confirmation'], releaseGate } }, caller)
  }
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Test phase was not reached')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
describe('1.3 production adapter + real SQLite + actual owned harmless child', () => {
  it('persists PREPARED before app confirmation, binds the native snapshot and executes at most once', async () => {
    const { service, scenario, database, spawnLog } = await chain()
    await enable(service)
    const request = orderRequest(), confirmed = await offer(service, request)
    const prepared = service.getState().intents[0]
    expect(prepared).toMatchObject({ state: 'PREPARED', requestId: request.requestId, price: '10.00', quantity: 100 })
    expect(existsSync(spawnLog)).toBe(false)
    expect(confirmed.intentBinding).toMatchObject({ intentId: prepared.intentId, snapshotHash: prepared.snapshotHash, expectedRevision: 1 })
    const result = await service.execute(confirmed, caller)
    expect(result.code).toBe('ACCEPTED_OBSERVED')
    expect(result.state.intents[0].state).toBe('ACCEPTED_OBSERVED')
    expect(scenario.prompts.at(-1)!.detail).toContain('**1234')
    expect(scenario.prompts.at(-1)!.detail).not.toContain(nativeFacts.account.value)
    expect((await service.execute(request, caller)).code).toBe('DUPLICATE_REQUEST')
    expect((await service.execute(confirmed, caller)).code).toBe('EXECUTION_FORBIDDEN')
    expect(readFileSync(spawnLog, 'utf8').trim().split('\n')).toHaveLength(1)
    const attempt = database().prepare('SELECT executor_state FROM attempts').get() as { executor_state: string }
    expect(attempt.executor_state).toBe('exited')
    expect(database().prepare('SELECT COUNT(*) AS n FROM request_tombstones').get()).toEqual({ n: 1 })
    const body = (database().prepare('SELECT body FROM intents').get() as { body: string }).body
    expect(body).not.toContain(nativeFacts.account.value)
    const outcome = JSON.parse(body).events.find((e: { kind: string }) => e.kind === 'outcome')
    expect(outcome.evidence).toMatchObject({ contractMatch: 'unique_new', filledQuantity: null, cancelledQuantity: null })
  })
  it('also confirms simulation orders through the same durable chain without enabling live', async () => {
    const { service } = await chain()
    const result = await service.execute(await offer(service, orderRequest('simulation')), caller)
    expect(result.code).toBe('ACCEPTED_OBSERVED')
    expect(result.state.liveEnabled).toBe(false)
    expect(result.state.intents[0].mode).toBe('simulation')
  })
  it('does not let changed price or a changed binding reuse a persisted confirmation', async () => {
    const { service, spawnLog } = await chain()
    await enable(service)
    const request = await offer(service, orderRequest())
    expect((await service.execute({ ...request, order: { ...request.order!, price: '9.99' } }, caller)).code).toBe('REQUEST_CONFLICT')
    expect(existsSync(spawnLog)).toBe(false)
    expect((await service.execute({ ...request, intentBinding: { ...request.intentBinding!, snapshotHash: 'f'.repeat(64) } }, caller)).code).toBe('SNAPSHOT_CONFLICT')
    expect(service.getState().intents[0].state).toBe('ABANDONED')
  })
  it('native cancellation abandons rather than deleting the request or starting a child', async () => {
    const { service, scenario, database, spawnLog } = await chain()
    await enable(service)
    const request = await offer(service, orderRequest())
    scenario.approved = false
    expect((await service.execute(request, caller)).code).toBe('USER_CANCELLED')
    expect(service.getState().intents[0].state).toBe('ABANDONED')
    expect(database().prepare('SELECT COUNT(*) AS n FROM request_tombstones').get()).toEqual({ n: 1 })
    expect(database().prepare('SELECT COUNT(*) AS n FROM attempts').get()).toEqual({ n: 0 })
    expect(existsSync(spawnLog)).toBe(false)
  })
  it.each(['monotonic', 'wallRollback'] as const)('does not renew a ticket after %s invalidation', async kind => {
    let offset = 0
    const { service, spawnLog } = await chain(undefined, kind === 'monotonic' ?
      { monotonic: () => performance.now() + offset } : { now: () => Date.now() + offset })
    await enable(service)
    const request = await offer(service, orderRequest())
    offset = kind === 'monotonic' ? 120001 : -1000
    expect((await service.execute(request, caller)).code).toBe('CONFIRMATION_EXPIRED')
    expect(service.getState().intents[0].state).toBe('ABANDONED')
    expect(existsSync(spawnLog)).toBe(false)
  })
  it('reobserves the actual account after native confirmation and refuses an account switch', async () => {
    const { service, scenario, spawnLog } = await chain()
    await enable(service)
    const request = await offer(service, orderRequest())
    scenario.afterConfirm = () => { scenario.account = 'FIXTURE99995678' }
    expect((await service.execute(request, caller)).code).toBe('ACCOUNT_CONTEXT_CONFLICT')
    expect(service.getState().intents[0].state).toBe('ABANDONED')
    expect(existsSync(spawnLog)).toBe(false)
  })
  it('generation revocation inside the native dialog cannot revive live authorization', async () => {
    const { service, scenario, spawnLog } = await chain()
    await enable(service)
    const request = await offer(service, orderRequest())
    scenario.afterConfirm = () => service.revokeCaller(caller.id)
    expect((await service.execute(request, caller)).code).toBe('INVALID_CALLER')
    expect(service.getState().liveEnabled).toBe(false)
    expect(existsSync(spawnLog)).toBe(false)
  })
  it('keeps dropped/legacy-only receipts UNKNOWN but permits explicit order/deal viewing after proven exit', async () => {
    const { service, scenario } = await chain()
    await enable(service); scenario.behavior = 'lost'
    const result = await service.execute(await offer(service, orderRequest()), caller)
    expect(result).toMatchObject({ code: 'RECEIPT_UNKNOWN', unknownPending: true })
    expect(service.getState()).toMatchObject({ executorState: 'idle', canPrepare: false, serviceState: 'REVIEW_REQUIRED' })
    expect((await service.execute(orderRequest(), caller)).code).toBe('REVIEW_REQUIRED')
    for (const action of ['queryOrders', 'queryDeals'] as const)
      expect((await service.execute({ action, mode: 'live' }, caller)).code).toBe('VIEW_OPENED')
    expect(service.getState().unknownPending).toBe(true)
    expect(scenario.commands.filter(v => v === 'execute')).toHaveLength(1)
    await review(service, false)
    expect(service.getState().unknownPending).toBe(true)
  })
  it('human review never reexecutes the old intent; a fresh authorized additional intent can execute', async () => {
    const { service, scenario, spawnLog } = await chain()
    await enable(service); scenario.behavior = 'lost'
    const original = orderRequest()
    await service.execute(await offer(service, original), caller)
    const oldId = service.getState().intents[0].intentId
    await review(service)
    expect(service.getState()).toMatchObject({ unknownPending: false, liveEnabled: false, canPrepare: false })
    expect((await service.execute(original, caller)).code).toBe('DUPLICATE_REQUEST')
    scenario.behavior = 'accepted'
    await enable(service)
    expect((await service.execute(orderRequest(), caller)).code).toBe('DUPLICATE_ISOLATED')
    const next = { ...orderRequest(), additionalOrder: { previousIntentId: oldId, additionalOrderAcknowledged: true as const } }
    expect((await service.execute(await offer(service, next), caller)).code).toBe('ACCEPTED_OBSERVED')
    expect(service.getState().intents.find(i => i.intentId === oldId)).toMatchObject({ state: 'UNKNOWN', gateReleased: true, executionForbidden: true })
    expect(scenario.prompts.at(-1)!.detail).toContain('本次追加风险')
    expect(readFileSync(spawnLog, 'utf8').trim().split('\n')).toHaveLength(2)
  }, 15000)
  it('a settled duplicate needs explicit additional-order linkage without poisoning the store', async () => {
    const { service } = await chain()
    await enable(service)
    await service.execute(await offer(service, orderRequest()), caller)
    expect((await service.execute(orderRequest(), caller)).code).toBe('ADDITIONAL_ORDER_LINK_REQUIRED')
    expect(service.getState().serviceState).toBe('READY_ENABLED')
    const previousIntentId = service.getState().intents[0].intentId
    const next = { ...orderRequest(), additionalOrder: { previousIntentId, additionalOrderAcknowledged: true as const } }
    expect((await service.execute(await offer(service, next), caller)).code).toBe('ACCEPTED_OBSERVED')
  }, 15000)
  it('cancel snapshots use the observed full target and preserve partial-cancel/unknown-quantity meaning', async () => {
    const { service, scenario, database } = await chain()
    await enable(service); scenario.behavior = 'partial_cancel'
    const request: MacThsRequest = { action: 'cancelLive', mode: 'live', requestId: randomUUID(), contractNo: 'TEST-TARGET' }
    const confirmed = await offer(service, request)
    expect(service.getState().intents[0]).toMatchObject({ action: 'cancel', contractNo: 'TEST-TARGET',
      symbol: '600000', price: '10.00', quantity: 100, tradingDate: '2026-10-08' })
    expect((await service.execute(confirmed, caller)).code).toBe('CANCEL_OBSERVED')
    const record = JSON.parse((database().prepare('SELECT body FROM intents').get() as { body: string }).body)
    expect(record.events.at(-1).evidence).toMatchObject({ contractMatch: 'unique_target',
      observation: 'partially_cancelled', filledQuantity: null, cancelledQuantity: null })
  })
  it('only verified before-submit native evidence becomes NOT_SUBMITTED', async () => {
    const { service, scenario } = await chain()
    await enable(service); scenario.behavior = 'before_submit'
    expect((await service.execute(await offer(service, orderRequest()), caller)).code).toBe('NOT_SUBMITTED')
    expect(service.getState().unknownPending).toBe(false)
  }, 15000)
  it('projects masked-only account capability as ambiguous and never grants live permission', async () => {
    const { service, scenario } = await chain()
    scenario.behavior = 'masked'
    const result = await service.execute(await offer(service, { action: 'authorizeLive', mode: 'live', liveRiskAcknowledged: true }), caller)
    expect(result.code).toBe('ACCOUNT_IDENTITY_UNAVAILABLE')
    expect(result.state).toMatchObject({ liveEnabled: false, capabilities: { account: 'ambiguous' } })
  })
  it('rejects viewing/new writes while a real owned executor runs; shutdown kills/waits and retains UNKNOWN', async () => {
    const { service, scenario, dir } = await chain()
    await enable(service); scenario.behavior = 'slow'
    const request = await offer(service, orderRequest())
    const running = service.execute(request, caller)
    await until(() => service.getState().intents.some(i => i.state === 'UNKNOWN') && service.getState().executorState === 'running')
    expect((await service.execute({ action: 'queryOrders', mode: 'live' }, caller)).code).toBe('BUSY')
    expect((await service.execute(orderRequest(), caller)).code).toBe('BUSY')
    service.beginStop()
    expect(service.getState().canPrepare).toBe(false)
    await service.shutdown(); await running
    expect(service.getState().intents[0].state).toBe('UNKNOWN')
    const reopened = MacThsIntentStore.open({ directory: dir, testHooks: { nativeBinding: binding } })
    expect(reopened.inspect().intents[0].state).toBe('UNKNOWN')
    reopened.close()
  }, 15000)
  it('SQLite launch_pending latency burns the permission without ever spawning the prepared child', async () => {
    const { service, database, spawnLog, dir } = await chain(undefined, { ticketLifetimeMs: 2500 })
    console.info('Slow launch boundary fixture retained:', dir)
    await enable(service)
    const request = await offer(service, orderRequest())
    database().function('integration_slow_launch', () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2700))
    database().exec("CREATE TEMP TRIGGER integration_delay BEFORE UPDATE OF executor_state ON attempts WHEN NEW.executor_state='launch_pending' BEGIN SELECT integration_slow_launch(); END")
    expect((await service.execute(request, caller)).code).toBe('EXECUTION_PERMISSION_EXPIRED')
    expect(service.getState().intents[0].state).toBe('UNKNOWN')
    expect(existsSync(spawnLog)).toBe(false)
    expect(database().prepare('SELECT executor_state FROM attempts').get()).toEqual({ executor_state: 'not_started' })
  }, 15000)
  it('reopening requires explicit recovery/review/new account authorization and never revives the old ticket', async () => {
    const first = await chain()
    await enable(first.service); first.scenario.behavior = 'lost'
    const request = orderRequest(), original = await offer(first.service, request)
    await first.service.execute(original, caller)
    const oldId = first.service.getState().intents[0].intentId
    await first.service.shutdown()
    const next = await chain(first.dir)
    expect(next.service.getState().serviceState).toBe('RECOVERY_REQUIRED')
    const plan = next.service.getState().recovery!
    await next.service.recover({ kind: 'apply', recoveryId: plan.recoveryId, manifestHash: plan.manifestHash, expectedRevision: plan.revision }, caller)
    expect((await next.service.execute({ action: 'queryOrders', mode: 'live' }, caller)).code).toBe('LIVE_SESSION_REQUIRED')
    expect(next.service.getState().canReview).toBe(true)
    await review(next.service)
    expect(next.service.getState().canPrepare).toBe(false)
    expect((await next.service.execute(original, caller)).code).toBe('EXECUTION_FORBIDDEN')
    await enable(next.service)
    const fresh = { ...orderRequest(), additionalOrder: { previousIntentId: oldId, additionalOrderAcknowledged: true as const } }
    expect((await next.service.execute(await offer(next.service, fresh), caller)).code).toBe('ACCEPTED_OBSERVED')
    expect(next.service.getState().intents.find(i => i.intentId === oldId)?.state).toBe('UNKNOWN')
  }, 15000)
})

describe('1.3 explicit sealed-source provisioning (Hegel integration finding)', () => {
  async function sealedSource() {
    const dir = join(directory(), 'source'), path = join(dir, 'mac-ths-experiment-journal.json')
    const owner = MacThsRecoveryCoordinator.createLegacySource(dir, 'i13-provision-writer')
    const raw = JSON.stringify({ unknownPending: true, usedRequests: [randomUUID()] })
    owner.launchLegacy(process.execPath, ['-e', 'require("node:fs").writeFileSync(' + JSON.stringify(path) + ',' + JSON.stringify(raw) + ')'])
    await owner.retireLegacyEntry()
    return { dir, path, raw }
  }
  it('provisions only after native confirmation, returns a real F3 apply plan, then permits review and a fresh live intent', async () => {
    const source = await sealedSource(), run = await chain(source.dir)
    expect(run.service.getState()).toMatchObject({ serviceState: 'RECOVERY_REQUIRED',
      recoveryReason: 'IMPORT_REQUIRED', canInitialize: false, canProvisionLegacy: true, canRecover: false })
    expect(existsSync(join(source.dir, 'mac-ths-orders.v2.sqlite'))).toBe(false)
    const provisioned = await run.service.recover({ kind: 'provisionLegacy' }, caller)
    expect(provisioned).toMatchObject({ canInitialize: false, canProvisionLegacy: false, canRecover: true, liveEnabled: false })
    const plan = provisioned.recovery!
    expect(plan.recoveryId).toMatch(/^[a-f0-9]{64}$/)
    await run.service.recover({ kind: 'apply', recoveryId: plan.recoveryId, manifestHash: plan.manifestHash, expectedRevision: plan.revision }, caller)
    await review(run.service)
    await enable(run.service)
    expect((await run.service.execute(await offer(run.service, orderRequest()), caller)).code).toBe('ACCEPTED_OBSERVED')
    expect(readFileSync(source.path, 'utf8')).toBe(source.raw)
    expect(run.service.getState().coverage?.kind).toBe('legacy')
  }, 15000)
  it('refuses a seal changed during confirmation and preserves the changed source without creating SQLite', async () => {
    const source = await sealedSource()
    const service = await start(source.dir, { confirm: async () => {
      writeFileSync(source.path, source.raw + '\n')
      return true
    } })
    expect(await service.recover({ kind: 'provisionLegacy' }, caller)).toMatchObject({
      recoveryReason: 'LEGACY_WRITER_UNFENCED', canRecover: false, canProvisionLegacy: false,
    })
    expect(existsSync(join(source.dir, 'mac-ths-orders.v2.sqlite'))).toBe(false)
    expect(readFileSync(source.path, 'utf8')).toBe(source.raw + '\n')
  })
  it('never upgrades an unsupervised journal or a fresh directory into a fabricated legacy source', async () => {
    for (const legacy of [false, true]) {
      const dir = directory()
      if (legacy) writeFileSync(join(dir, 'mac-ths-experiment-journal.json'), '{"unknownPending":false,"usedRequests":[]}')
      const service = await start(dir)
      await service.recover({ kind: 'provisionLegacy' }, caller)
      expect(existsSync(join(dir, 'mac-ths-orders.v2.sqlite'))).toBe(false)
      expect(service.getState().canProvisionLegacy).toBe(false)
    }
  })
})
