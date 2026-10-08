import { nativeTestBinding, nativeTestTempRoot } from '../fixtures/macThsNativeTestRuntime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'
import Database from 'better-sqlite3'
import {
  MacThsIntentStore, hashIntentSnapshot, MAC_THS_INTENT_TRANSITIONS,
  type IntentSnapshot, type IntentRecord, type AdapterEvidence, type HumanObservation,
  type IntentStoreOptions, type StoreCheckpoint
} from '../../electron/main/services/macThsIntentStore'

// No Electron import, network, osascript, broker connection or real trade dependency.
const base = resolve(nativeTestTempRoot, 'mac-ths-intent-tests')
const account = 'a'.repeat(64)
let directory: string
const nativeBinding = nativeTestBinding
let ioTrace: Array<{operation:string}> = []
const connections = new Map<MacThsIntentStore, Database.Database>()
function options(extra: IntentStoreOptions['testHooks'] = {}): IntentStoreOptions {
  return { directory, initialize: true, testHooks: { nativeBinding, ...extra,
    checkpoint: checkpoint => { ioTrace.push({operation:checkpoint}); extra.checkpoint?.(checkpoint) } } }
}
function open(extra: IntentStoreOptions['testHooks'] = {}) {
  let db!: Database.Database
  const store=MacThsIntentStore.open(options({...extra,onDatabaseOpen:connection=>{db=connection;extra.onDatabaseOpen?.(connection)}}))
  connections.set(store,db);return store
}
function reopen(store:MacThsIntentStore) {
  store.close()
  const next=open(); const plan=next.inspectRecovery()
  if(plan.canApply)next.applyRecovery(plan.recoveryId!,plan.manifestHash!,plan.revision)
  return next
}
function moduleForChild() {
  const target=join(directory,'compiled');mkdirSync(target)
  for(const name of ['macThsIntentStore','macThsIntentRecovery','macThsRecoveryCoordinator']) {
    const source=readFileSync(resolve('electron/main/services/'+name+'.ts'),'utf8')
    writeFileSync(join(target,name+'.js'),ts.transpileModule(source,{compilerOptions:{
      target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true
    }}).outputText.replace('require("better-sqlite3")','require('+JSON.stringify(resolve('node_modules/better-sqlite3'))+')'))
  }
  return join(target,'macThsIntentStore.js')
}
function snapshot(overrides: Partial<IntentSnapshot> = {}): IntentSnapshot {
  const now = Date.now()
  return { schemaVersion: 1, executor: 'mac-local-ths', mode: 'simulation', action: 'submit',
    symbol: '600000', market: 'SH', side: 'buy', priceCents: 1000, quantity: 100, maxNotionalCents: 100000,
    cancelTarget: null, accountContext: { digest: account, label: '**1234', distinguishable: true,
      capturedAt: now, clientVersion: '1.0', adapterVersion: '3' },
    input: { source: 'manual', capturedAt: now }, createdAt: now, expiresAt: now + 120000, ...overrides }
}
function prepared(store: MacThsIntentStore, s = snapshot()) { return store.createIntent(randomUUID(), s) }
function confirmed(store: MacThsIntentStore, r = prepared(store), acknowledged = false) {
  const now = Date.now()
  if(r.snapshot!.mode==='live') store.enableLiveSession({accountDigest:account,observedAt:now})
  return store.confirmIntent(r.intentId, r.snapshotHash!, r.revision, { method: 'native_dialog',
    sessionId: store.sessionId, confirmedAt: now, expiresAt: Math.min(now + 120000, r.snapshot!.expiresAt),
    additionalOrderAcknowledged: acknowledged })
}
function claim(store: MacThsIntentStore, r: IntentRecord, request = r.originalRequestId!) {
  return store.claimExecution(r.intentId, r.snapshotHash!, r.revision, request,
    { accountDigest: account, observedAt: Date.now() })
}
function review(releaseGate = true): HumanObservation {
  return { source: 'human_reported', method: 'native_dialog', statement: 'still_uncertain',
    scope: ['orders', 'deals', 'confirmation'], accountDigest: account, contractNo: null, releaseGate }
}
function accepted(r: IntentRecord): AdapterEvidence {
  return { source: 'ths_ui', effectPhase: 'after_submit', accountDigest: account, observedAt: Date.now(),
    contractNo: 'TEST123', tradingDate: '2026-10-08', symbol: r.snapshot!.symbol,
    market: r.snapshot!.market, side: r.snapshot!.side, priceCents: r.snapshot!.priceCents,
    quantity: r.snapshot!.quantity, contractMatch: r.snapshot!.action === 'submit' ? 'unique_new' : 'unique_target',
    observation: 'accepted', filledQuantity: 0, cancelledQuantity: 0 }
}
function disk(store: MacThsIntentStore) {
  const row=connections.get(store)!.prepare('SELECT payload,checksum,schema_version FROM meta WHERE id=1').get() as {payload:string;checksum:string;schema_version:number}
  return {schemaVersion:row.schema_version,checksum:row.checksum,payload:JSON.parse(row.payload)}
}
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}'
}
function corrupt(store: MacThsIntentStore, change: (data: ReturnType<typeof disk>) => void, rehash = false) {
  const data = disk(store); change(data)
  if (rehash) data.checksum = createHash('sha256').update(canonical(data.payload)).digest('hex')
  // Deliberate on-disk future-version corruption. A reopened owner must reject it;
  // this does not weaken the production connection or migration's schema checks.
  if (data.schemaVersion !== 2) connections.get(store)!.pragma('ignore_check_constraints = ON')
  connections.get(store)!.prepare('UPDATE meta SET payload=?,checksum=?,schema_version=? WHERE id=1').run(JSON.stringify(data.payload),data.checksum,data.schemaVersion)
  store.close()
}
beforeEach(() => {
  mkdirSync(base, { recursive: true }); directory = mkdtempSync(join(base, 'isolated-')); ioTrace = []
})
afterEach(({ task }) => {
  vi.restoreAllMocks()
  for(const [store,db] of connections)if(db.open)store.close()
  connections.clear()
  const target = resolve(directory)
  if (!target.startsWith(base + sep)) throw new Error('Unsafe test evidence target')
  // Historical Windows rename EPERM remains unexplained. Retain every fixture so neither
  // a failed assertion nor an expected exception can erase the original lock/pending/temp.
  writeFileSync(join(target, 'test-run.json'), JSON.stringify({ test: task.name,
    node: process.version, platform: process.platform, arch: process.arch,
    result: task.result, ioTrace }, null, 2))
})

describe('durable mac THS intent store, offline only', () => {
  it('persists a versioned immutable snapshot and canonical digest before confirmation', () => {
    const store = open(); const s = snapshot(); const r = prepared(store, s)
    expect(disk(store).schemaVersion).toBe(2)
    expect(r.state).toBe('PREPARED'); expect(r.attempt).toBeNull()
    expect(hashIntentSnapshot({ ...s, accountContext: { ...s.accountContext } })).toBe(r.snapshotHash)
    s.priceCents = 999
    expect(Object.isFrozen(r.snapshot)).toBe(true)
    expect(Object.isFrozen(r.snapshot!.accountContext)).toBe(true)
    expect(store.getIntent(r.intentId)!.snapshot!.priceCents).toBe(1000)
    expect(() => store.createIntent(r.originalRequestId!, snapshot({ priceCents: 999 }))).toThrow('REQUEST_CONFLICT')
    expect(() => store.createIntent(randomUUID(), snapshot({ priceCents: 999 }), null, r.intentId)).toThrow('INTENT_CONFLICT')
  })
  it('rejects credentials, full account labels and unrecognized fields before persistence', () => {
    const store = open(); const s = snapshot()
    expect(() => prepared(store, { ...s, password: 'secret' } as IntentSnapshot)).toThrow('INVALID_DATA')
    expect(() => prepared(store, { ...s, accountContext: { ...s.accountContext, label: '123456789012' } })).toThrow('INVALID_DATA')
    expect(() => prepared(store, { ...s, accountContext: { ...s.accountContext, apiKey: 'secret' } } as IntentSnapshot)).toThrow('INVALID_DATA')
    expect(JSON.stringify(disk(store))).not.toContain('secret')
    expect(store.inspect().intents).toHaveLength(0)
  })
  it('commits UNKNOWN and request tombstones before yielding exactly one execution permission', () => {
    const store = open(); const r = confirmed(store); let executions = 0
    const run = () => {
      const result = claim(store, r)
      if (result.claimed) {
        const data = disk(store)
        expect(data.payload.intents[0].events.at(-1).kind).toBe('claimed')
        expect(data.payload.requests.some((x: { requestId: string }) => x.requestId === r.originalRequestId)).toBe(true)
        expect(existsSync(store.paths.pending)).toBe(false)
        expect(existsSync(store.paths.lock)).toBe(false)
        executions++
      }
      return result
    }
    const result = run(); expect(result.intent.state).toBe('UNKNOWN')
    expect(run().claimed).toBe(false)
    const second = reopen(store)
    expect(claim(second, r, randomUUID()).claimed).toBe(false)
    expect(executions).toBe(1); expect(second.inspect().requestCount).toBe(2)
  })
  it('CAS serializes replays and a second instance cannot take a live owner across COMMIT', async () => {
    const first=open();const r=confirmed(first)
    expect(()=>open()).toThrow('ACTIVE_OWNER')
    const results=await Promise.all([Promise.resolve().then(()=>claim(first,r)),
      Promise.resolve().then(()=>claim(first,r,randomUUID()))])
    expect(results.filter(result=>result.claimed)).toHaveLength(1)
    const second=reopen(first)
    expect(claim(second,r,randomUUID()).claimed).toBe(false)
    expect(second.getIntent(r.intentId)!.events.filter(e=>e.kind==='claimed')).toHaveLength(1)
    const next=prepared(second,snapshot({symbol:'600001'}))
    expect(()=>second.confirmIntent(next.intentId,next.snapshotHash!,999,{method:'native_dialog',
      sessionId:second.sessionId,confirmedAt:Date.now(),expiresAt:Date.now()+1000,additionalOrderAcknowledged:false})).toThrow('CAS_CONFLICT')
  })
  it('requires a NEW intent after restart and still checks fresh confirmation/account', () => {
    const first=open();const r=confirmed(first);const second=reopen(first)
    expect(()=>claim(second,r)).toThrow('EXECUTION_FORBIDDEN')
    expect(()=>confirmed(second,second.getIntent(r.intentId)!)).toThrow('EXECUTION_FORBIDDEN')
    const renewed=confirmed(second,prepared(second))
    expect(()=>second.claimExecution(renewed.intentId,renewed.snapshotHash!,renewed.revision,renewed.originalRequestId!,
      {accountDigest:'b'.repeat(64),observedAt:Date.now()})).toThrow('ACCOUNT_CONTEXT_CONFLICT')
    expect(claim(second,renewed).claimed).toBe(true)
  })
  it('does not extend confirmation when the wall clock rolls back, or reuse expired/preview/quote authority', () => {
    const store = open(); const r = confirmed(store); const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now - 1000)
    expect(() => claim(store, r)).toThrow('CONFIRMATION_EXPIRED')
    vi.restoreAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(r.snapshot!.expiresAt + 1)
    expect(() => claim(store, r)).toThrow('CONFIRMATION_EXPIRED')
    vi.restoreAllMocks()
    const preview = confirmed(store, prepared(store, snapshot({ mode: 'livePreview' })))
    expect(() => claim(store, preview)).toThrow('PREVIEW_NOT_EXECUTABLE')
    const s = snapshot()
    const quote = confirmed(store, prepared(store, { ...s, input: { source: 'quote', capturedAt: s.createdAt - 5000,
      quoteSource: 'isolated-feed', maxAgeMs: 1000 } }))
    expect(() => claim(store, quote)).toThrow('QUOTE_EXPIRED')
  })
  it('does not add confirmation commit latency to the monotonic confirmation window', () => {
    let monotonic = 1000; let wall = Date.now(); let armed = false
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic)
    vi.spyOn(Date, 'now').mockImplementation(() => wall)
    const store = open({ checkpoint: stage => {
      if (armed && stage === 'events_written') monotonic += 10000
    } })
    const p = prepared(store); armed = true
    const r = confirmed(store, p); armed = false
    // Elapsed time is over 120s; the adjusted wall clock misleadingly says only 1s.
    monotonic = 121001; wall += 1000
    expect(() => claim(store, r)).toThrow('CONFIRMATION_EXPIRED')
    expect(store.getIntent(r.intentId)!.state).toBe('CONFIRMED')
  })
  it('does not yield execution permission if claim durability/lock release outlasts confirmation', () => {
    let monotonic = 1000; const wall = Date.now(); let armed = false
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic)
    vi.spyOn(Date, 'now').mockReturnValue(wall)
    const store = open({ checkpoint: stage => {
      if (armed && stage === 'after_commit') monotonic = 121001
    } })
    const r = confirmed(store); armed = true
    const result = claim(store, r)
    expect(result.claimed).toBe(false); expect(result.attemptId).toBeNull()
    expect(store.getIntent(r.intentId)!.state).toBe('UNKNOWN')
    expect(claim(store, r).claimed).toBe(false)
  })
  it('unknown remains quarantined after human review; additional orders require explicit linkage and new acknowledgement', () => {
    const store = open(); const old = claim(store, confirmed(store)).intent
    expect(store.inspect().unknownPending).toBe(true)
    expect(() => prepared(store)).toThrow('DUPLICATE_ISOLATED')
    const reviewed = store.recordHumanReview(old.intentId, old.snapshotHash, review(), Date.now(), old.revision)
    expect(reviewed.state).toBe('UNKNOWN'); expect(reviewed.events.slice(0, old.revision)).toEqual(old.events)
    expect(store.inspect().unknownPending).toBe(false)
    expect(claim(store, reviewed).claimed).toBe(false)
    expect(() => prepared(store)).toThrow('DUPLICATE_ISOLATED')
    const added = store.createIntent(randomUUID(), snapshot(), {
      previousIntentId: old.intentId, additionalOrderAcknowledged: true })
    expect(() => confirmed(store, added)).toThrow('ADDITIONAL_ORDER_RISK_REQUIRED')
    expect(claim(store, confirmed(store, added, true)).claimed).toBe(true)
    expect(store.getIntent(old.intentId)!.state).toBe('UNKNOWN')
  })
  it.each(['submit', 'cancel'] as const)('F1: blocks the reviewed live %s bypass and requires explicit additional-order consent', action => {
    const store = open()
    const s = action === 'submit' ? snapshot({ mode: 'live' }) : snapshot({ mode: 'live', action: 'cancel',
      cancelTarget: { accountDigest: account, tradingDate: '2026-10-08', contractNo: 'TEST123' } })
    const old = claim(store, confirmed(store, prepared(store, s))).intent
    store.recordHumanReview(old.intentId, old.snapshotHash, review(), Date.now(), old.revision)
    const changed = action === 'submit' ? { ...s, maxNotionalCents: 100100 } : { ...s, priceCents: 900 }
    expect(hashIntentSnapshot(changed)).not.toBe(old.snapshotHash)
    expect(() => store.createIntent(randomUUID(), changed)).toThrow('DUPLICATE_ISOLATED')
    const next = store.createIntent(randomUUID(), changed, {
      previousIntentId: old.intentId, additionalOrderAcknowledged: true })
    expect(next.fingerprint).toBe(old.fingerprint)
    expect(() => confirmed(store, next, false)).toThrow('ADDITIONAL_ORDER_RISK_REQUIRED')
    expect(() => store.createIntent(randomUUID(), changed, {
      previousIntentId: randomUUID(), additionalOrderAcknowledged: true })).toThrow('INVALID_ADDITIONAL_ORDER')
    const permit = claim(store, confirmed(store, next, true))
    expect(permit.claimed).toBe(true)
    expect(claim(store, store.getIntent(old.intentId)!).claimed).toBe(false)
  })
  it('F1: cancel identity ignores display fields but binds account, mode, day and target contract', () => {
    const store = open(); const s = snapshot({ action: 'cancel', cancelTarget: {
      accountDigest: account, tradingDate: '2026-10-08', contractNo: 'TEST123' } })
    const old = claim(store, confirmed(store, prepared(store, s))).intent
    store.recordHumanReview(old.intentId, old.snapshotHash, review(), Date.now(), old.revision)
    const displayChanges: Partial<IntentSnapshot>[] = [
      { symbol: '600001' }, { market: 'SZ' }, { side: 'sell' }, { priceCents: 900 },
      { quantity: 99 }, { maxNotionalCents: 100100 },
      { accountContext: { ...s.accountContext, label: '**5678', clientVersion: '2.0' } }
    ]
    for (const changes of displayChanges) expect(() => prepared(store, { ...s, ...changes })).toThrow('DUPLICATE_ISOLATED')
    for (const changed of [
      { ...s, cancelTarget: { ...s.cancelTarget!, tradingDate: '2026-10-09' } },
      { ...s, cancelTarget: { ...s.cancelTarget!, contractNo: 'TEST124' } },
      { ...s, mode: 'live' as const },
      { ...s, accountContext: { ...s.accountContext, digest: 'b'.repeat(64) },
        cancelTarget: { ...s.cancelTarget!, accountDigest: 'b'.repeat(64) } }
    ]) expect(prepared(store, changed).fingerprint).not.toBe(old.fingerprint)
  })
  it('F1: submit identity retains actual execution parameters and ignores UI metadata', () => {
    const store = open(); const s = snapshot(); const old = claim(store, confirmed(store, prepared(store, s))).intent
    store.recordHumanReview(old.intentId, old.snapshotHash, review(), Date.now(), old.revision)
    expect(() => prepared(store, { ...s, accountContext: { ...s.accountContext, label: '**5678', adapterVersion: '4' } }))
      .toThrow('DUPLICATE_ISOLATED')
    for (const changes of [{ priceCents: 900 }, { quantity: 99 }, { symbol: '600001' },
      { market: 'SZ' as const }, { side: 'sell' as const }, { mode: 'live' as const },
      { accountContext: { ...s.accountContext, digest: 'b'.repeat(64) } }])
      expect(prepared(store, { ...s, ...changes }).fingerprint).not.toBe(old.fingerprint)
  })
  it.each([
    ['events_written', false], ['after_commit', false], ['before_permission', false],
    ['events_written', true], ['after_commit', true], ['before_permission', true]
  ] as const)('F2: quote expires during %s (wall rollback=%s) without yielding execution permission', (boundary, rollback) => {
    let monotonic = 1000; let wall = Date.now(); let armed = false
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic)
    vi.spyOn(Date, 'now').mockImplementation(() => wall)
    const advance = () => { monotonic += 1000; wall += rollback ? -50 : 1000; armed = false }
    const store = open({checkpoint: stage => { if (armed && stage === boundary) advance() }})
    const s = snapshot({ mode: 'live', input: { source: 'quote', capturedAt: wall, quoteSource: 'observed-test-feed', maxAgeMs: 500 } })
    const r = confirmed(store, prepared(store, s)); monotonic += 100; wall += 100; armed = true
    const result = claim(store, r)
    expect(result.claimed).toBe(false); expect(result.attemptId).toBeNull()
    expect(existsSync(store.paths.lock)).toBe(false)
    expect(existsSync(store.paths.pending)).toBe(false)
    const restart = reopen(store); const persisted = restart.getIntent(r.intentId)!
    expect(persisted.state).toBe('UNKNOWN'); expect(persisted.attempt).not.toBeNull()
    expect(claim(restart, persisted, randomUUID()).claimed).toBe(false)
    expect(persisted.snapshot).toEqual(s)
  })
  it.each(['before_confirmation', 'after_confirmation'] as const)(
    'F2: rollback %s cannot renew an already expired quote', boundary => {
      let monotonic = 1000; let wall = Date.now()
      vi.spyOn(performance, 'now').mockImplementation(() => monotonic)
      vi.spyOn(Date, 'now').mockImplementation(() => wall)
      const store = open(); const s = snapshot({ input: {
        source: 'quote', capturedAt: wall, quoteSource: 'observed-test-feed', maxAgeMs: 500 } })
      const p = prepared(store, s)
      if (boundary === 'before_confirmation') { monotonic += 600; wall += 100 }
      const r = confirmed(store, p)
      if (boundary === 'after_confirmation') { monotonic += 600; wall += 100 }
      expect(() => claim(store, r)).toThrow('QUOTE_EXPIRED')
      expect(store.getIntent(r.intentId)!.state).toBe('CONFIRMED')
    })
  it('F2: a still-fresh quote can be claimed after durable commit', () => {
    const store = open(); const now = Date.now()
    const s = snapshot({ input: { source: 'quote', capturedAt: now, quoteSource: 'observed-test-feed', maxAgeMs: 10000 } })
    expect(claim(store, confirmed(store, prepared(store, s))).claimed).toBe(true)
  })
  it('reviewing one unknown does not clear another; observation/page opening alone never clears the gate', () => {
    const store = open(); const a = claim(store, confirmed(store)).intent
    store.recordHumanReview(a.intentId, a.snapshotHash, review(), Date.now(), a.revision)
    const b = claim(store, confirmed(store, prepared(store, snapshot({ symbol: '600001' })))).intent
    const a2 = store.getIntent(a.intentId)!
    store.recordHumanReview(a.intentId, a.snapshotHash, review(), Date.now(), a2.revision)
    expect(store.inspect().unknownPending).toBe(true)
    expect(() => store.recordHumanReview(b.intentId, b.snapshotHash, { ...review(), scope: ['orders'] }, Date.now(), b.revision)).toThrow('INCOMPLETE_REVIEW')
    expect(() => store.recordHumanReview(b.intentId, b.snapshotHash, { ...review(), statement: 'VIEW_OPENED' } as unknown as HumanObservation,
      Date.now(), b.revision)).toThrow('INVALID_DATA')
    const next = confirmed(store, prepared(store, snapshot({ symbol: '600002' })))
    expect(() => claim(store, next)).toThrow('UNKNOWN_PENDING')
  })
  it('only accepts explicit pre-submit evidence; arbitrary script failures stay unknown', () => {
    const store = open(); const r = claim(store, confirmed(store)).intent
    const evidence: AdapterEvidence = { source: 'adapter', effectPhase: 'before_submit', accountDigest: account,
      observedAt: Date.now(), reason: 'readback_mismatch' }
    expect(() => store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId,
      { ...evidence, effectPhase: 'after_submit' } as unknown as AdapterEvidence)).toThrow('UNSAFE_NOT_SUBMITTED')
    expect(() => store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, randomUUID(), evidence)).toThrow('ATTEMPT_CONFLICT')
    expect(store.getIntent(r.intentId)!.state).toBe('UNKNOWN')
    const result = store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId, evidence)
    expect(result.state).toBe('NOT_SUBMITTED'); expect(claim(store, result).claimed).toBe(false)
    expect(claim(store, confirmed(store, prepared(store))).claimed).toBe(true)
  })
  it('UI acceptance is not FILLED and rejects ambiguous contracts/account/parameters', () => {
    const store = open(); const r = claim(store, confirmed(store)).intent; const e = accepted(r)
    for (const bad of [{ ...e, contractMatch: 'ambiguous' }, { ...e, accountDigest: 'b'.repeat(64) },
      { ...e, quantity: 101 }, { ...e, observation: 'FILLED' }]) {
      expect(() => store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId, bad as AdapterEvidence)).toThrow()
    }
    const result = store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId, e)
    expect(result.state).toBe('ACCEPTED_OBSERVED')
    expect(Object.keys(MAC_THS_INTENT_TRANSITIONS)).not.toContain('FILLED')
    expect(claim(store, result).claimed).toBe(false)
  })
  it('requires linking and renewed risk confirmation for intentionally repeating an observed order', () => {
    const store = open(); const first = prepared(store)
    const preExistingRepeat = prepared(store)
    const pending = claim(store, confirmed(store, first)).intent
    store.recordOutcome(pending.intentId, pending.snapshotHash!, pending.revision, pending.attempt!.attemptId, accepted(pending))
    expect(() => prepared(store)).toThrow('ADDITIONAL_ORDER_LINK_REQUIRED')
    expect(() => confirmed(store, preExistingRepeat)).toThrow('ADDITIONAL_ORDER_LINK_REQUIRED')
    const next = store.createIntent(randomUUID(), snapshot(), {
      previousIntentId: first.intentId, additionalOrderAcknowledged: true })
    expect(() => confirmed(store, next)).toThrow('ADDITIONAL_ORDER_RISK_REQUIRED')
    expect(claim(store, confirmed(store, next, true)).claimed).toBe(true)
  })
  it('rejects a new-contract assertion on cancellation of an existing scoped target', () => {
    const store = open(); const p = prepared(store, snapshot({ action: 'cancel', cancelTarget: {
      contractNo: 'TEST123', tradingDate: '2026-10-08', accountDigest: account } }))
    const r = claim(store, confirmed(store, p)).intent
    expect(() => store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId,
      { ...accepted(r), contractMatch: 'unique_new', observation: 'cancelled', cancelledQuantity: 100 } as AdapterEvidence)).toThrow('EVIDENCE_CONTRACT_KIND_CONFLICT')
    expect(store.getIntent(r.intentId)!.state).toBe('UNKNOWN')
  })
  it('persists partial cancellation and account/date-scoped target without claiming a full cancellation', () => {
    const store = open(); const s = snapshot({ action: 'cancel', cancelTarget: {
      contractNo: 'TEST123', tradingDate: '2026-10-08', accountDigest: account } })
    const r = claim(store, confirmed(store, prepared(store, s))).intent
    const e = { ...accepted(r), observation: 'partially_cancelled', filledQuantity: 40, cancelledQuantity: 20 } as AdapterEvidence
    expect(() => store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId,
      { ...e, tradingDate: '2026-10-07' } as AdapterEvidence)).toThrow()
    const result = store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId, e)
    expect(result.state).toBe('CANCEL_OBSERVED')
    expect(result.events.at(-1)).toMatchObject({ evidence: { filledQuantity: 40, cancelledQuantity: 20, observation: 'partially_cancelled' } })
  })
  it.each([
    ['submit', 'accepted', null, null], ['submit', 'accepted', 25, null], ['submit', 'accepted', null, 0],
    ['cancel', 'cancelled', null, null], ['cancel', 'cancelled', 40, null], ['cancel', 'cancelled', null, 60],
    ['cancel', 'partially_cancelled', null, null], ['cancel', 'partially_cancelled', 40, null],
    ['cancel', 'partially_cancelled', null, 20]
  ] as const)('F4: preserves observed %s/%s quantities filled=%s cancelled=%s, including explicit unknown',
    (action, observation, filledQuantity, cancelledQuantity) => {
      const store = open(); const s = action === 'submit' ? snapshot() : snapshot({ action: 'cancel', cancelTarget: {
        accountDigest: account, tradingDate: '2026-10-08', contractNo: 'TEST123' } })
      const r = claim(store, confirmed(store, prepared(store, s))).intent
      const evidence = { ...accepted(r), observation, filledQuantity, cancelledQuantity } as AdapterEvidence
      const result = store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId, evidence)
      expect(result.state).toBe(action === 'submit' ? 'ACCEPTED_OBSERVED' : 'CANCEL_OBSERVED')
      expect(reopen(store).getIntent(r.intentId)!.events.at(-1)).toMatchObject({ evidence: { observation, filledQuantity, cancelledQuantity } })
      expect(claim([...connections.keys()].at(-1)!, result).claimed).toBe(false)
    })
  it('F4: validates only observed quantities, rejects contradictions and never fills absent evidence', () => {
    const store = open(); const s = snapshot({ action: 'cancel', cancelTarget: {
      accountDigest: account, tradingDate: '2026-10-08', contractNo: 'TEST123' } })
    const r = claim(store, confirmed(store, prepared(store, s))).intent
    const baseEvidence = { ...accepted(r), observation: 'partially_cancelled', filledQuantity: null, cancelledQuantity: null }
    for (const bad of [
      { filledQuantity: -1 }, { filledQuantity: 1.5 }, { filledQuantity: 101 }, { filledQuantity: 100 },
      { cancelledQuantity: -1 }, { cancelledQuantity: 0 }, { cancelledQuantity: 101 }, { cancelledQuantity: 100 },
      { filledQuantity: 70, cancelledQuantity: 40 },
      { observation: 'cancelled', filledQuantity: 20, cancelledQuantity: 20 },
      { filledQuantity: undefined }, { cancelledQuantity: undefined },
      { tradingDate: undefined }, { tradingDate: null }, { tradingDate: '2026-02-30' },
      { tradingDate: '2026-10-09' }, { observation: 'FILLED' }, { observation: 'fully_cancelled' },
      { contractMatch: 'unique_new' }
    ]) expect(() => store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId,
      { ...baseEvidence, ...bad } as unknown as AdapterEvidence)).toThrow()
    expect(store.getIntent(r.intentId)!.events).toEqual(r.events)
    const unknown = { ...baseEvidence } as AdapterEvidence
    expect(store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId, unknown).events.at(-1))
      .toMatchObject({ evidence: { filledQuantity: null, cancelledQuantity: null, tradingDate: '2026-10-08' } })
  })
  it('F4: appends the reviewing store session, rejects renderer identity and replays sessions', () => {
    const first=open();const r=claim(first,confirmed(first)).intent;const second=reopen(first)
    const recovered=second.getIntent(r.intentId)!
    const binding={recoveryId:recovered.recoveryId!,reviewRequestId:randomUUID()}
    for(const extra of [{sessionId:randomUUID()},{reviewingSessionId:randomUUID()}])
      expect(()=>second.recordHumanReview(r.intentId,r.snapshotHash,{...review(),...extra},Date.now(),r.revision,binding)).toThrow('INVALID_DATA')
    const reviewed=second.recordHumanReview(r.intentId,r.snapshotHash,review(),Date.now(),r.revision,binding)
    expect(reviewed.events.at(-1)).toMatchObject({reviewingSessionId:second.sessionId})
    const third=reopen(second);expect(third.getIntent(r.intentId)!.events).toEqual(reviewed.events)
    const rereview=third.recordHumanReview(r.intentId,r.snapshotHash,review(),Date.now(),reviewed.revision,
      {...binding,reviewRequestId:randomUUID()})
    expect(rereview.events.slice(0,reviewed.revision)).toEqual(reviewed.events)
    expect(rereview.events.at(-1)).toMatchObject({reviewingSessionId:third.sessionId})
    expect(rereview.state).toBe('UNKNOWN');expect(claim(third,rereview).claimed).toBe(false)
  })
  it.each(['missing', 'invalid', 'extra'] as const)('F4: rejects %s persisted reviewing-session evidence even with a recomputed envelope digest', kind => {
    const store = open(); const r = claim(store, confirmed(store)).intent
    store.recordHumanReview(r.intentId, r.snapshotHash, review(), Date.now(), r.revision)
    corrupt(store, data => {
      const event = data.payload.intents[0].events.at(-1)
      if (kind === 'missing') delete event.reviewingSessionId
      if (kind === 'invalid') event.reviewingSessionId = '-'.repeat(36)
      if (kind === 'extra') event.sessionId = randomUUID()
    }, true)
    expect(() => open()).toThrow()
  })
  // JSON import's 300-ID/unknown/raw-byte assertions moved intact to macThsIntentRecovery.test.ts.
  it('refuses legacy import without an actual retired entry and concrete exited writer proof', () => {
    const legacyPath=join(directory,'legacy.json');const ids=Array.from({length:300},()=>randomUUID())
    const contents=JSON.stringify({unknownPending:true,usedRequests:ids});writeFileSync(legacyPath,contents)
    const store=MacThsIntentStore.open({...options(),legacyJournalPath:legacyPath})
    expect(store.inspectRecovery()).toMatchObject({reason:'LEGACY_WRITER_UNFENCED',canApply:false,evidence:'unavailable'})
    expect(()=>prepared(store)).toThrow('LEGACY_WRITER_UNFENCED')
    expect(readFileSync(legacyPath,'utf8')).toBe(contents);store.close()
  })
  it('keeps permanent earliest request/intent tombstones and all history beyond 256 completed intents', () => {
    const store = open(); let first: IntentRecord | undefined
    for (let i = 0; i < 260; i++) {
      const r = prepared(store)
      const done = store.abandonIntent(r.intentId, r.snapshotHash!, r.revision, 'cancelled')
      first ??= done
    }
    const restart = reopen(store); expect(restart.inspect().intents).toHaveLength(260)
    const replay = restart.createIntent(first!.originalRequestId!, first!.snapshot!)
    expect(replay.intentId).toBe(first!.intentId); expect(replay.events).toEqual(first!.events)
    expect(claim(restart, replay, randomUUID()).claimed).toBe(false)
    expect(restart.inspect().requestCount).toBe(261)
  }, 30000)
  it.each(['PREPARED', 'CONFIRMED', 'UNKNOWN', 'ABANDONED', 'NOT_SUBMITTED', 'ACCEPTED_OBSERVED', 'CANCEL_OBSERVED', 'LEGACY_UNKNOWN'])(
    'enumerates only explicit transitions for %s', state => {
      const expected: Record<string, string[]> = { PREPARED: ['CONFIRMED', 'ABANDONED'],
        CONFIRMED: ['CONFIRMED', 'ABANDONED', 'UNKNOWN'], UNKNOWN: ['NOT_SUBMITTED', 'ACCEPTED_OBSERVED', 'CANCEL_OBSERVED'],
        ABANDONED: [], NOT_SUBMITTED: [], ACCEPTED_OBSERVED: [], CANCEL_OBSERVED: [], LEGACY_UNKNOWN: [] }
      const allowed = MAC_THS_INTENT_TRANSITIONS[state as keyof typeof MAC_THS_INTENT_TRANSITIONS]
      expect(allowed).toEqual(expected[state])
      for (const target of [...Object.keys(expected), 'FILLED']) {
        expect(allowed.includes(target as never)).toBe(expected[state].includes(target))
      }
    })
  it.each(['ABANDONED', 'NOT_SUBMITTED', 'ACCEPTED_OBSERVED', 'CANCEL_OBSERVED'] as const)(
    'rejects every mutating transition from terminal %s', state => {
      const store = open()
      let r: IntentRecord
      if (state === 'ABANDONED') {
        const p = prepared(store); r = store.abandonIntent(p.intentId, p.snapshotHash!, p.revision, 'cancelled')
      } else {
        const s = state === 'CANCEL_OBSERVED' ? snapshot({ action: 'cancel', cancelTarget: {
          contractNo: 'TEST123', tradingDate: '2026-10-08', accountDigest: account } }) : snapshot()
        const pending = claim(store, confirmed(store, prepared(store, s))).intent
        const e: AdapterEvidence = state === 'NOT_SUBMITTED' ? { source: 'adapter', effectPhase: 'before_submit',
          accountDigest: account, observedAt: Date.now(), reason: 'control_disabled' } : state === 'CANCEL_OBSERVED' ?
          { ...accepted(pending), observation: 'cancelled', cancelledQuantity: 100 } as AdapterEvidence : accepted(pending)
        r = store.recordOutcome(pending.intentId, pending.snapshotHash!, pending.revision, pending.attempt!.attemptId, e)
      }
      expect(r.state).toBe(state)
      expect(() => confirmed(store, r)).toThrow('ILLEGAL_TRANSITION')
      expect(() => store.abandonIntent(r.intentId, r.snapshotHash!, r.revision, 'cancelled')).toThrow('ILLEGAL_TRANSITION')
      expect(() => store.recordHumanReview(r.intentId, r.snapshotHash, review(), Date.now(), r.revision)).toThrow('ILLEGAL_TRANSITION')
      expect(() => store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt?.attemptId ?? randomUUID(), accepted(r))).toThrow()
      expect(claim(store, r).claimed).toBe(false)
      expect(store.getIntent(r.intentId)!.events).toEqual(r.events)
    })
  it('rejects illegal state transitions without changing durable history', () => {
    const store = open(); const p = prepared(store)
    expect(() => claim(store, p)).toThrow('CONFIRMATION_REQUIRED')
    expect(() => store.recordHumanReview(p.intentId, p.snapshotHash, review(), Date.now(), p.revision)).toThrow('ILLEGAL_TRANSITION')
    const r = claim(store, confirmed(store, p)).intent
    expect(() => store.abandonIntent(r.intentId, r.snapshotHash!, r.revision, 'cancelled')).toThrow('ILLEGAL_TRANSITION')
    expect(() => confirmed(store, r)).toThrow('ILLEGAL_TRANSITION')
    expect(store.getIntent(r.intentId)!.events).toEqual(r.events)
  })
  it.each(['digest', 'snapshot', 'history', 'version', 'request-index'])(
    'rejects corrupted %s rather than resetting storage', kind => {
      const store = open(); prepared(store)
      corrupt(store, data => {
        if (kind === 'digest') data.checksum = '0'.repeat(64)
        if (kind === 'snapshot') data.payload.intents[0].snapshot.quantity = 101
        if (kind === 'history') data.payload.intents[0].events.push({ sequence: 2, at: Date.now(), kind: 'claimed',
          attempt: { attemptId: randomUUID(), requestId: randomUUID(), sessionId: randomUUID(), claimedAt: Date.now() } })
        if (kind === 'version') data.schemaVersion = 3
        if (kind === 'request-index') data.payload.requests = []
      }, kind !== 'digest')
      const before = readFileSync(store.paths.data, 'utf8')
      expect(() => open()).toThrow()
      expect(readFileSync(store.paths.data, 'utf8')).toBe(before)
    })
  it('bad legacy evidence is not auto-imported; missing enabled SQLite data never initializes', () => {
    const legacyPath=join(directory,'legacy.json');writeFileSync(legacyPath,'{broken')
    const legacy=MacThsIntentStore.open({...options(),legacyJournalPath:legacyPath})
    expect(legacy.inspectRecovery().canApply).toBe(false);legacy.close()
    // Preserve the corrupt original in place; use a separately provisioned private fixture.
    directory=mkdtempSync(join(base,'missing-db-'));const store=open();store.close()
    const missing=store.paths.data+'.retained';require('node:fs').renameSync(store.paths.data,missing)
    expect(()=>open()).toThrow('CORRUPT_STORE');expect(existsSync(store.paths.data)).toBe(false)
  })
  it('preserves a foreign legacy lock and refuses to infer its writer exit from SQLite ownership', () => {
    writeFileSync(join(directory,'mac-ths-intents.lock'),'foreign-owner')
    const store=open()
    expect(store.inspectRecovery()).toMatchObject({reason:'LEGACY_WRITER_UNFENCED',canApply:false})
    expect(()=>prepared(store)).toThrow('LEGACY_WRITER_UNFENCED')
    expect(readFileSync(store.paths.lock,'utf8')).toBe('foreign-owner')
  })
  // JSON seven-file boundaries are replaced by seven SQLite transaction/permission boundaries.
  // These injected failures test propagation only; real kill/reopen is in the recovery suite.
  it.each<StoreCheckpoint>(['transaction_started','events_written','attempts_written','requests_written',
    'before_commit','after_commit','before_permission'])(
    'failure at %s never returns permission or silently replays', stage => {
      let armed=false
      const store=open({checkpoint:point=>{if(armed && point===stage)throw new Error('INJECTED_BOUNDARY')}})
      const r=confirmed(store);armed=true;let executions=0
      expect(()=>{if(claim(store,r).claimed)executions++}).toThrow('INJECTED_BOUNDARY')
      expect(executions).toBe(0);expect(()=>open()).toThrow('ACTIVE_OWNER')
      const event=disk(store).payload.intents[0].events.at(-1).kind
      expect(event).toBe(['after_commit','before_permission'].includes(stage)?'claimed':'confirmed')
      armed=false;const next=reopen(store);const old=next.getIntent(r.intentId)!
      if(old.attempt)expect(claim(next,old).claimed).toBe(false)
      else expect(()=>claim(next,old)).toThrow('EXECUTION_FORBIDDEN')
    })
  it.each(['events_written','requests_written','before_commit','after_commit'] as const)(
    'SQL persistence failure at %s propagates without permission (replaces JSON fsync/rename/write hooks)', stage => {
      let armed=false;const store=open({checkpoint:point=>{if(armed && point===stage)throw Object.assign(new Error('IO_FAILURE'),{code:'SQLITE_IOERR'})}})
      const r=confirmed(store);armed=true;expect(()=>claim(store,r)).toThrow('STORAGE_IO')
      expect(()=>open()).toThrow('ACTIVE_OWNER');expect(()=>claim(store,r)).toThrow('STORE_POISONED')
    })
  it('outcome write failure leaves durable UNKNOWN and preserves history', () => {
    let armed=false;const store=open({checkpoint:stage=>{if(armed && stage==='before_commit')throw new Error('RECEIPT_WRITE_FAILURE')}})
    const r=claim(store,confirmed(store)).intent;armed=true
    expect(()=>store.recordOutcome(r.intentId,r.snapshotHash!,r.revision,r.attempt!.attemptId,accepted(r))).toThrow('RECEIPT_WRITE_FAILURE')
    expect(disk(store).payload.intents[0].events).toEqual(r.events)
    expect(()=>open()).toThrow('ACTIVE_OWNER')
  })
  it('does not clean legacy pending or candidate evidence even when the legacy lock is absent', () => {
    writeFileSync(join(directory,'mac-ths-intents.pending'),'{"revision":2}')
    writeFileSync(join(directory,'mac-ths-intents.v1.json.candidate.tmp'),'candidate')
    const store=open();expect(store.inspectRecovery().canApply).toBe(false)
    expect(existsSync(store.paths.pending)).toBe(true)
    expect(readFileSync(join(directory,'mac-ths-intents.v1.json.candidate.tmp'),'utf8')).toBe('candidate')
  })
  it('uses real SQLite durability settings on Windows rather than a no-op directory-sync hook', () => {
    const store=open();expect(store.durability).toMatchObject({journalMode:'delete',lockingMode:'exclusive',synchronous:3})
    expect(()=>open()).toThrow('ACTIVE_OWNER')
  })
  it('real child cannot take a live SQLite owner across commits; closed owner permits non-replay recovery', async () => {
    const store=open();const r=claim(store,confirmed(store)).intent;const modulePath=moduleForChild()
    const childPath=join(directory,'owner-check.cjs')
    writeFileSync(childPath,`const {MacThsIntentStore}=require(${JSON.stringify(modulePath)});
try{const s=MacThsIntentStore.open({directory:${JSON.stringify(directory)},testHooks:{nativeBinding:${JSON.stringify(nativeBinding)}}});
const p=s.inspectRecovery();if(p.canApply)s.applyRecovery(p.recoveryId,p.manifestHash,p.revision);
const r=s.getIntent(${JSON.stringify(r.intentId)});
process.stdout.write(JSON.stringify({claimed:s.claimExecution(r.intentId,r.snapshotHash,r.revision,r.originalRequestId,{accountDigest:${JSON.stringify(account)},observedAt:Date.now()}).claimed}));
s.close();}catch(e){process.stdout.write(e.message);}`)
    const busy=await promisify(execFile)(process.execPath,[childPath],{cwd:directory})
    expect(busy.stdout).toContain('ACTIVE_OWNER');store.close()
    const replay=await promisify(execFile)(process.execPath,[childPath],{cwd:directory})
    expect(JSON.parse(replay.stdout).claimed).toBe(false)
  },10000)
  it.each(['filledQuantity', 'cancelledQuantity'] as const)(
    'R1: rejects raw invalid %s without normalizing it to null or clearing UNKNOWN', field => {
      const store = open(); const r = claim(store, confirmed(store, prepared(store, snapshot({ mode: 'live' })))).intent
      const before = readFileSync(store.paths.data, 'utf8')
      const evidence = { ...accepted(r), filledQuantity: null, cancelledQuantity: null }
      for (const invalid of [NaN, Infinity, -Infinity, undefined, -1, 0.5, '0', Object(0), 0n, Symbol('unknown')]) {
        expect(() => store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId,
          { ...evidence, [field]: invalid } as AdapterEvidence)).toThrow('INVALID_DATA')
        expect(readFileSync(store.paths.data, 'utf8')).toBe(before)
        expect(store.getIntent(r.intentId)!.events).toEqual(r.events)
        expect(store.inspect().unknownPending).toBe(true)
      }
      const result = store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId, evidence)
      expect(result.state).toBe('ACCEPTED_OBSERVED')
      expect(result.events.at(-1)).toMatchObject({ evidence: { filledQuantity: null, cancelledQuantity: null } })
    })
  it('R1: rejects getters, proxies, toJSON, hidden data and cycles without invoking them', () => {
    const store = open(); const r = claim(store, confirmed(store)).intent
    const before = readFileSync(store.paths.data, 'utf8'); let callbacks = 0
    const hook = () => { callbacks++; return null }
    const evidence = { ...accepted(r), filledQuantity: null, cancelledQuantity: null }
    const getter = Object.defineProperty({ ...evidence }, 'filledQuantity', { enumerable: true, get: hook })
    const toJSON = Object.defineProperty({ ...evidence }, 'toJSON', { value: hook })
    const inherited = Object.assign(Object.create({ toJSON: hook }), evidence)
    const hidden = Object.defineProperty({ ...evidence }, 'password', { value: 'must-not-persist' })
    const symbolic = { ...evidence, [Symbol('extra')]: null }
    const cyclic: Record<string, unknown> = { ...evidence }; cyclic.extra = cyclic
    const proxy = new Proxy(evidence, { get: () => { callbacks++; throw new Error('proxy executed') },
      ownKeys: () => { callbacks++; throw new Error('proxy executed') },
      getPrototypeOf: () => { callbacks++; throw new Error('proxy executed') } })
    const revoked = Proxy.revocable(evidence, {}); revoked.revoke()
    for (const invalid of [getter, toJSON, inherited, hidden, symbolic, cyclic, proxy, revoked.proxy]) {
      expect(() => store.recordOutcome(r.intentId, r.snapshotHash!, r.revision, r.attempt!.attemptId,
        invalid as AdapterEvidence)).toThrow('INVALID_DATA')
      expect(readFileSync(store.paths.data, 'utf8')).toBe(before)
    }
    expect(callbacks).toBe(0); expect(store.inspect().unknownPending).toBe(true)
  })
  it('R1: protects snapshot/hash, confirmation, claim context, relation and human-review input paths', () => {
    const store = open(); const s = snapshot(); const p = prepared(store, s)
    let callbacks = 0
    const accessor = <T extends object>(value: T, key: keyof T) => Object.defineProperty({ ...value }, key, {
      enumerable: true, get: () => { callbacks++; return value[key] }
    })
    const badSnapshot = { ...s, cancelTarget: NaN } as unknown as IntentSnapshot
    for (const invalid of [badSnapshot, accessor(s, 'quantity'),
      { ...s, accountContext: accessor(s.accountContext, 'digest') },
      { ...s, symbol: 600000 }, { ...s, accountContext: { ...s.accountContext, clientVersion: 3 } }]) {
      expect(() => prepared(store, invalid as IntentSnapshot)).toThrow('INVALID_DATA')
      expect(() => hashIntentSnapshot(invalid as IntentSnapshot)).toThrow('INVALID_DATA')
    }
    expect(() => store.createIntent(randomUUID(), s, NaN as never)).toThrow('INVALID_DATA')
    const deceptiveId = { toString: () => { callbacks++; return randomUUID() } }
    expect(() => store.createIntent(deceptiveId as never, s)).toThrow('INVALID_ID')
    const c = { method: 'native_dialog' as const, sessionId: store.sessionId,
      confirmedAt: Date.now(), expiresAt: s.expiresAt, additionalOrderAcknowledged: false }
    expect(() => store.confirmIntent(p.intentId, p.snapshotHash!, p.revision, accessor(c, 'confirmedAt'))).toThrow('INVALID_DATA')
    const confirmedRecord = confirmed(store, p)
    expect(() => store.claimExecution(p.intentId, p.snapshotHash!, confirmedRecord.revision, p.originalRequestId!,
      accessor({ accountDigest: account, observedAt: Date.now() }, 'observedAt'))).toThrow('INVALID_DATA')
    const r = claim(store, confirmedRecord).intent; const before = readFileSync(store.paths.data, 'utf8')
    const arrayAccessor = Object.defineProperty(['orders', 'deals', 'confirmation'], '0', { enumerable: true,
      get: () => { callbacks++; return 'orders' } })
    const sparse = ['orders', , 'confirmation']
    for (const invalid of [{ ...review(), contractNo: NaN }, { ...review(), contractNo: Infinity },
      { ...review(), contractNo: 123 }, accessor(review(), 'releaseGate'),
      { ...review(), scope: arrayAccessor }, { ...review(), scope: sparse }]) {
      expect(() => store.recordHumanReview(r.intentId, r.snapshotHash, invalid as HumanObservation,
        Date.now(), r.revision)).toThrow('INVALID_DATA')
      expect(readFileSync(store.paths.data, 'utf8')).toBe(before)
    }
    expect(callbacks).toBe(0); expect(store.inspect().unknownPending).toBe(true)
  })
  it.each(['PREPARED', 'CONFIRMED'] as const)(
    'R2: reopening never re-authorizes a prior-session %s quote, including original/alias request replay', state => {
      let wall = Date.now(); let monotonic = 1000
      vi.spyOn(Date, 'now').mockImplementation(() => wall)
      vi.spyOn(performance, 'now').mockImplementation(() => monotonic)
      const first = open(); const s = snapshot({ mode: 'live', input: {
        source: 'quote', capturedAt: wall, quoteSource: 'observed-test-feed', maxAgeMs: 500 } })
      const p = prepared(first, s); const old = state === 'CONFIRMED' ? confirmed(first, p) : p
      const originalBytes = readFileSync(first.paths.data, 'utf8')
      monotonic += 1000; wall += 100
      const second = reopen(first)
      const recoveredBytes=readFileSync(second.paths.data, 'utf8')
      expect(second.getIntent(old.intentId)!.events).toEqual(old.events)
      expect(disk(second).schemaVersion).toBe(2)
      expect(() => confirmed(second, old)).toThrow('QUOTE_SESSION_REQUIRED')
      expect(readFileSync(second.paths.data, 'utf8')).toBe(recoveredBytes)
      const replay = second.createIntent(old.originalRequestId!, s)
      expect(() => confirmed(second, replay)).toThrow('QUOTE_SESSION_REQUIRED')
      const alias = second.createIntent(randomUUID(), s, null, old.intentId)
      expect(() => confirmed(second, alias)).toThrow('QUOTE_SESSION_REQUIRED')
      if (state === 'CONFIRMED') expect(() => claim(second, old)).toThrow('QUOTE_SESSION_REQUIRED')
      expect(second.inspect().requestCount).toBe(2)
      expect(second.getIntent(old.intentId)!.events).toEqual(old.events)
      expect(second.getIntent(old.intentId)!.state).toBe(state)
      const fresh = prepared(second, snapshot({ mode: 'live', input: {
        source: 'quote', capturedAt: wall, quoteSource: 'observed-test-feed', maxAgeMs: 500 } }))
      expect(fresh.intentId).not.toBe(old.intentId)
      expect(fresh.snapshotHash).not.toBe(old.snapshotHash)
      expect(claim(second, confirmed(second, fresh)).claimed).toBe(true)
      expect(second.getIntent(old.intentId)!.events).toEqual(old.events)
      expect(second.inspect().requestCount).toBe(3)
    })
  it('R2: neither repeated confirmation nor same-session request replay refreshes the quote deadline', () => {
    let wall = Date.now(); let monotonic = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => wall)
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic)
    const store = open(); const s = snapshot({ input: {
      source: 'quote', capturedAt: wall, quoteSource: 'observed-test-feed', maxAgeMs: 500 } })
    const old = confirmed(store, prepared(store, s))
    monotonic += 1000; wall += 100
    const replay = store.createIntent(old.originalRequestId!, s)
    const renewed = confirmed(store, replay)
    expect(() => claim(store, renewed)).toThrow('QUOTE_EXPIRED')
    expect(store.getIntent(old.intentId)!.state).toBe('CONFIRMED')
    expect(store.getIntent(old.intentId)!.attempt).toBeNull()
  })
  it('R2: controlled real process restart rejects rollback of an expired old quote and permits a new intent', async () => {
    const modulePath=moduleForChild();const childPath=join(directory,'restart.cjs')
    writeFileSync(childPath,`const fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {MacThsIntentStore}=require(${JSON.stringify(modulePath)});const directory=${JSON.stringify(directory)};
const base=${JSON.stringify(snapshot({mode:'live'}))};const metadata=directory+'/restart-before.json';
const make=age=>{const now=Date.now();return {...base,createdAt:now,expiresAt:now+120000,
accountContext:{...base.accountContext,capturedAt:now},input:{source:'quote',quoteSource:'fixture',capturedAt:now,maxAgeMs:age}}};
const confirm=(s,r)=>s.confirmIntent(r.intentId,r.snapshotHash,r.revision,{method:'native_dialog',sessionId:s.sessionId,
confirmedAt:Date.now(),expiresAt:r.snapshot.expiresAt,additionalOrderAcknowledged:false});
const claim=(s,r)=>s.claimExecution(r.intentId,r.snapshotHash,r.revision,r.originalRequestId,{accountDigest:base.accountContext.digest,observedAt:Date.now()});
if(process.argv[2]==='before'){const s=MacThsIntentStore.open({directory,initialize:true,testHooks:{nativeBinding:${JSON.stringify(nativeBinding)}}});
const r=confirm(s,s.createIntent(randomUUID(),make(500)));fs.writeFileSync(metadata,JSON.stringify({pid:process.pid,sessionId:s.sessionId,r}));s.close();}
else{const prior=JSON.parse(fs.readFileSync(metadata));const elapsed=Date.now()-prior.r.snapshot.input.capturedAt;Date.now=()=>prior.r.snapshot.input.capturedAt+100;
const s=MacThsIntentStore.open({directory,testHooks:{nativeBinding:${JSON.stringify(nativeBinding)}}});const p=s.inspectRecovery();s.applyRecovery(p.recoveryId,p.manifestHash,p.revision);
const errors=[];for(const work of [()=>confirm(s,prior.r),()=>claim(s,prior.r),()=>confirm(s,s.createIntent(prior.r.originalRequestId,prior.r.snapshot))]){
try{work();errors.push('BAD')}catch(e){errors.push(e.code)}}
s.enableLiveSession({accountDigest:base.accountContext.digest,observedAt:Date.now()});const next=claim(s,confirm(s,s.createIntent(randomUUID(),make(10000))));
const result={pid:process.pid,sessionId:s.sessionId,elapsed,errors,old:s.getIntent(prior.r.intentId),next};
fs.writeFileSync(directory+'/restart-after.json',JSON.stringify(result));process.stdout.write(JSON.stringify(result));s.close();}`)
    await promisify(execFile)(process.execPath,[childPath,'before'],{cwd:directory})
    const original=JSON.parse(readFileSync(join(directory,'restart-before.json'),'utf8'))
    await new Promise(done=>setTimeout(done,600))
    const out=await promisify(execFile)(process.execPath,[childPath,'after'],{cwd:directory})
    const after=JSON.parse(out.stdout)
    expect(after.pid).not.toBe(original.pid);expect(after.sessionId).not.toBe(original.sessionId);expect(after.elapsed).toBeGreaterThanOrEqual(500)
    expect(after.errors).toEqual(['QUOTE_SESSION_REQUIRED','QUOTE_SESSION_REQUIRED','QUOTE_SESSION_REQUIRED'])
    expect(after.old.events).toEqual(original.r.events);expect(after.old.executionForbidden).toBe(true)
    expect(after.next.claimed).toBe(true);expect(after.next.intent.intentId).not.toBe(original.r.intentId)
  },10000)
})
