import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, statfsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { types as utilTypes } from 'node:util'
import Database from 'better-sqlite3'
import { MacThsIntentRecovery, RecoveryRequiredError, type RecoveryReviewBinding, type RecoveryCheckpoint } from './macThsIntentRecovery'
import { canonicalOrderDirectory, flushOrderDirectory, MacThsRecoveryCoordinator, verifyExecutorExit,
  type LegacyQuiescenceCapability, type ExecutorExitCapability } from './macThsRecoveryCoordinator'

/** Main-process-only storage. It neither displays confirmation nor calls an adapter.
 * A claimed=true result is a one-shot permission, never a recoverable execution ticket.
 * The caller must still check its native dialog, sender, account and live-session gate.
 * SQLite ownership lasts for the entire session, including while no transaction is open.
 * Recovery never recreates an execution ticket. This module is not wired to a live adapter.
 */
export const MAC_THS_INTENT_TRANSITIONS = Object.freeze({
  PREPARED: Object.freeze(['CONFIRMED', 'ABANDONED']),
  CONFIRMED: Object.freeze(['CONFIRMED', 'ABANDONED', 'UNKNOWN']),
  UNKNOWN: Object.freeze(['NOT_SUBMITTED', 'ACCEPTED_OBSERVED', 'CANCEL_OBSERVED']),
  ABANDONED: Object.freeze([]), NOT_SUBMITTED: Object.freeze([]),
  ACCEPTED_OBSERVED: Object.freeze([]), CANCEL_OBSERVED: Object.freeze([]),
  LEGACY_UNKNOWN: Object.freeze([])
})
export type IntentState = keyof typeof MAC_THS_INTENT_TRANSITIONS
export interface AccountContext {
  digest: string
  /** Only a masked suffix, e.g. **1234, never the full UI text/account/broker. */
  label: string
  /** Caller assertion only; a later adapter must actually distinguish the observed account. */
  distinguishable: true
  capturedAt: number
  clientVersion: string
  adapterVersion: string
}
export interface IntentSnapshot {
  schemaVersion: 1
  executor: 'mac-local-ths'
  mode: 'simulation' | 'livePreview' | 'live'
  action: 'submit' | 'cancel'
  symbol: string
  market: 'SH' | 'SZ' | 'BJ'
  side: 'buy' | 'sell'
  priceCents: number
  quantity: number
  maxNotionalCents: number
  cancelTarget: { contractNo: string; tradingDate: string; accountDigest: string } | null
  accountContext: AccountContext
  input: { source: 'manual'; capturedAt: number } | {
    source: 'quote'; capturedAt: number; quoteSource: string; maxAgeMs: number
  }
  createdAt: number
  expiresAt: number
}
export interface ConfirmationRecord {
  method: 'native_dialog'
  sessionId: string
  confirmedAt: number
  expiresAt: number
  /** Required for deliberately additional orders referencing an earlier intent. */
  additionalOrderAcknowledged: boolean
}
export interface AdditionalOrder {
  previousIntentId: string
  additionalOrderAcknowledged: true
}
export type AdapterEvidence = {
  source: 'adapter'
  effectPhase: 'before_submit'
  accountDigest: string
  observedAt: number
  reason: 'account_changed' | 'readback_mismatch' | 'control_disabled' | 'layout_unsupported' | 'client_unavailable'
} | {
  source: 'ths_ui'
  effectPhase: 'after_submit'
  accountDigest: string
  observedAt: number
  contractNo: string
  tradingDate: string
  symbol: string
  market: 'SH' | 'SZ' | 'BJ'
  side: 'buy' | 'sell'
  priceCents: number
  quantity: number
  contractMatch: 'unique_new' | 'unique_target'
  /** Observed UI status, never an inference that the whole order was filled/cancelled. */
  observation: 'accepted' | 'cancelled' | 'partially_cancelled'
  /** Explicit null means unobserved. Do not substitute zero or infer the other quantity. */
  filledQuantity: number | null
  cancelledQuantity: number | null
}
export interface HumanObservation {
  source: 'human_reported'
  method: 'native_dialog'
  statement: 'still_uncertain' | 'order_seen' | 'cancel_seen' | 'no_order_seen'
  scope: Array<'orders' | 'deals' | 'confirmation'>
  accountDigest: string | null
  contractNo: string | null
  releaseGate: boolean
}
interface Attempt {
  attemptId: string; requestId: string; sessionId: string; claimedAt: number
}
type IntentEvent = { sequence: number; at: number } & (
  { kind: 'prepared' | 'legacy_unknown' } |
  { kind: 'confirmed'; confirmation: ConfirmationRecord } |
  { kind: 'abandoned'; reason: 'cancelled' | 'expired' } |
  { kind: 'claimed'; attempt: Attempt } |
  { kind: 'outcome'; evidence: AdapterEvidence } |
  { kind: 'human_review'; reviewingSessionId: string; observation: HumanObservation } |
  { kind: 'recovery_review'; reviewingSessionId: string; observation: HumanObservation;
    recoveryId: string; reviewRequestId: string; snapshotHash: string | null; expectedRevision: number }
)
export interface StoredIntent {
  intentId: string
  originalRequestId: string | null
  snapshot: IntentSnapshot | null
  snapshotHash: string | null
  fingerprint: string | null
  additionalOrder: AdditionalOrder | null
  events: IntentEvent[]
}
export interface IntentRecord extends StoredIntent {
  state: IntentState
  revision: number
  attempt: Attempt | null
  gateReleased: boolean
  executionForbidden?: boolean
  recoveryQuarantine?: boolean
  recoveryId?: string | null
}
export interface RequestTombstone {
  requestId: string; intentId: string | null; snapshotHash: string | null; origin: 'intent' | 'legacy'
}
export interface Payload {
  storeId: string
  revision: number
  coverage: { kind: 'fresh' | 'legacy'; since: number; legacyIds: number; earlierIds: 'unavailable' }
  intents: StoredIntent[]
  requests: RequestTombstone[]
}
export type StoreCheckpoint = 'transaction_started' | 'events_written' | 'attempts_written' |
  'requests_written' | 'before_commit' | 'after_commit' | 'before_permission'
export interface IntentStoreOptions {
  /** Trusted main-process configuration: one canonical private local directory per execution domain.
   * Never accept a renderer-selected profile/copy. Cross-device deduplication is not promised.
   */
  directory: string
  /** Only the explicit installation/provisioning path may initialize a never-enabled database. */
  initialize?: boolean
  legacyJournalPath?: string
  legacyQuiescence?: LegacyQuiescenceCapability
  testHooks?: {
    /** Offline-only native addon override, never read from environment by production code. */
    nativeBinding?: string
    checkpoint?: (checkpoint: StoreCheckpoint | RecoveryCheckpoint) => void
    /** Tests inspect the actual owned connection, not a mock transaction implementation. */
    onDatabaseOpen?: (database: Database.Database) => void
  }
}
export class IntentStoreError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'IntentStoreError'
  }
}
const ID = /^[a-f0-9-]{36}$/
const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const DIGEST = /^[a-f0-9]{64}$/
const CONTRACT = /^[a-zA-Z0-9-]{1,32}$/
const VERSION = /^[a-zA-Z0-9._-]{1,40}$/
function requireThat(value: unknown, code = 'INVALID_DATA'): asserts value {
  if (!value) throw new IntentStoreError(code)
}
function object(value: unknown): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value))
}
function keys(value: unknown, expected: string[]) {
  object(value)
  requireThat(Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)))
}
function timestamp(value: unknown): asserts value is number {
  requireThat(Number.isSafeInteger(value) && (value as number) > 0)
}
function integer(value: unknown, minimum = 0): asserts value is number {
  requireThat(Number.isSafeInteger(value) && (value as number) >= minimum)
}
function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value)
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' +
    canonical((value as Record<string, unknown>)[key])).join(',') + '}'
}
function digest(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex') }
/** Snapshot plain data without invoking accessors/toJSON or losing number semantics. */
function copy<T>(value: T): T {
  const active = new WeakSet<object>()
  function validate(raw: unknown): void {
    if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') return
    if (typeof raw === 'number') { requireThat(Number.isFinite(raw)); return }
    requireThat(typeof raw === 'object' && !utilTypes.isProxy(raw))
    const array = Array.isArray(raw)
    const prototype = Object.getPrototypeOf(raw)
    requireThat(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null)
    requireThat(!active.has(raw))
    active.add(raw)
    const descriptors = Object.getOwnPropertyDescriptors(raw)
    const names = Reflect.ownKeys(descriptors)
    if (array) {
      const length = descriptors.length.value as number
      requireThat(names.length === length + 1)
      for (let index = 0; index < length; index++) requireThat(Object.hasOwn(descriptors, String(index)))
    }
    for (const name of names) {
      requireThat(typeof name === 'string')
      if (array && name === 'length') continue
      const descriptor = descriptors[name]
      requireThat(Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true)
      validate(descriptor.value)
    }
    active.delete(raw)
  }
  validate(value)
  return structuredClone(value)
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
function validateSnapshot(s: IntentSnapshot) {
  keys(s, ['schemaVersion', 'executor', 'mode', 'action', 'symbol', 'market', 'side', 'priceCents',
    'quantity', 'maxNotionalCents', 'cancelTarget', 'accountContext', 'input', 'createdAt', 'expiresAt'])
  requireThat(s.schemaVersion === 1 && s.executor === 'mac-local-ths')
  requireThat(['simulation', 'livePreview', 'live'].includes(s.mode) && ['submit', 'cancel'].includes(s.action))
  requireThat(matches(s.symbol, /^\d{6}$/) && ['SH', 'SZ', 'BJ'].includes(s.market) && ['buy', 'sell'].includes(s.side))
  integer(s.priceCents, 1); integer(s.quantity, 1); integer(s.maxNotionalCents, 1)
  requireThat(Number.isSafeInteger(s.priceCents * s.quantity) && s.priceCents * s.quantity <= s.maxNotionalCents)
  keys(s.accountContext, ['digest', 'label', 'distinguishable', 'capturedAt', 'clientVersion', 'adapterVersion'])
  const a = s.accountContext
  requireThat(matches(a.digest, DIGEST) && matches(a.label, /^\*{2,}[a-zA-Z0-9]{1,4}$/) && a.distinguishable === true)
  timestamp(a.capturedAt)
  requireThat(matches(a.clientVersion, VERSION) && matches(a.adapterVersion, VERSION))
  timestamp(s.createdAt); timestamp(s.expiresAt)
  requireThat(s.expiresAt > s.createdAt && a.capturedAt <= s.createdAt)
  object(s.input)
  if (s.input.source === 'manual') keys(s.input, ['source', 'capturedAt'])
  else {
    keys(s.input, ['source', 'capturedAt', 'quoteSource', 'maxAgeMs'])
    requireThat(s.input.source === 'quote' && matches(s.input.quoteSource, VERSION))
    integer(s.input.maxAgeMs, 1)
  }
  timestamp(s.input.capturedAt); requireThat(s.input.capturedAt <= s.createdAt)
  if (s.input.source === 'quote') requireThat(Number.isSafeInteger(s.input.capturedAt + s.input.maxAgeMs))
  if (s.action === 'submit') requireThat(s.cancelTarget === null)
  else {
    keys(s.cancelTarget, ['contractNo', 'tradingDate', 'accountDigest'])
    requireThat(matches(s.cancelTarget!.contractNo, CONTRACT) && validDate(s.cancelTarget!.tradingDate)
      && s.cancelTarget!.accountDigest === a.digest)
  }
}
function validDate(value: unknown) {
  return matches(value, /^\d{4}-\d{2}-\d{2}$/) && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
}
/** Canonical digest excludes object-key order, not any snapshot field. */
export function hashIntentSnapshot(snapshot: IntentSnapshot): string {
  const raw = copy(snapshot)
  validateSnapshot(raw)
  return digest(raw)
}
function fingerprint(s: IntentSnapshot) {
  const common = { executor: s.executor, mode: s.mode, action: s.action, accountDigest: s.accountContext.digest }
  return s.action === 'submit'
    ? digest({ ...common, market: s.market, symbol: s.symbol, side: s.side, priceCents: s.priceCents, quantity: s.quantity })
    : digest({ ...common, tradingDate: s.cancelTarget!.tradingDate, contractNo: s.cancelTarget!.contractNo })
}
function validateConfirmation(c: ConfirmationRecord, s: IntentSnapshot, additional: AdditionalOrder | null) {
  keys(c, ['method', 'sessionId', 'confirmedAt', 'expiresAt', 'additionalOrderAcknowledged'])
  requireThat(c.method === 'native_dialog' && matches(c.sessionId, ID))
  timestamp(c.confirmedAt); timestamp(c.expiresAt)
  requireThat(c.confirmedAt >= s.createdAt && c.expiresAt > c.confirmedAt && c.expiresAt <= s.expiresAt
    && c.expiresAt - c.confirmedAt <= 120000 && typeof c.additionalOrderAcknowledged === 'boolean')
  requireThat(!additional || c.additionalOrderAcknowledged === true, 'ADDITIONAL_ORDER_RISK_REQUIRED')
}
function validateHuman(o: HumanObservation, s: IntentSnapshot | null) {
  keys(o, ['source', 'method', 'statement', 'scope', 'accountDigest', 'contractNo', 'releaseGate'])
  requireThat(o.source === 'human_reported' && o.method === 'native_dialog'
    && ['still_uncertain', 'order_seen', 'cancel_seen', 'no_order_seen'].includes(o.statement))
  requireThat(Array.isArray(o.scope) && o.scope.length > 0 && new Set(o.scope).size === o.scope.length
    && o.scope.every(item => ['orders', 'deals', 'confirmation'].includes(item)))
  requireThat(o.accountDigest === null ? s === null : matches(o.accountDigest, DIGEST)
    && (!s || o.accountDigest === s.accountContext.digest))
  requireThat(o.contractNo === null || matches(o.contractNo, CONTRACT))
  requireThat(typeof o.releaseGate === 'boolean')
  requireThat(!o.releaseGate || o.scope.length === 3, 'INCOMPLETE_REVIEW')
}
function evidenceState(e: AdapterEvidence, s: IntentSnapshot): IntentState {
  timestamp(e.observedAt)
  requireThat(e.accountDigest === s.accountContext.digest, 'EVIDENCE_ACCOUNT_CONFLICT')
  if (e.source === 'adapter') {
    keys(e, ['source', 'effectPhase', 'accountDigest', 'observedAt', 'reason'])
    requireThat(e.effectPhase === 'before_submit' && ['account_changed', 'readback_mismatch',
      'control_disabled', 'layout_unsupported', 'client_unavailable'].includes(e.reason), 'UNSAFE_NOT_SUBMITTED')
    return 'NOT_SUBMITTED'
  }
  keys(e, ['source', 'effectPhase', 'accountDigest', 'observedAt', 'contractNo', 'tradingDate',
    'symbol', 'market', 'side', 'priceCents', 'quantity', 'contractMatch', 'observation',
    'filledQuantity', 'cancelledQuantity'])
  requireThat(e.source === 'ths_ui' && e.effectPhase === 'after_submit')
  requireThat(matches(e.contractNo, CONTRACT) && validDate(e.tradingDate))
  requireThat(e.symbol === s.symbol && e.market === s.market && e.side === s.side
    && e.priceCents === s.priceCents && e.quantity === s.quantity, 'EVIDENCE_PARAMETERS_CONFLICT')
  for (const quantity of [e.filledQuantity, e.cancelledQuantity]) {
    if (quantity !== null) { integer(quantity); requireThat(quantity <= s.quantity) }
  }
  if (e.filledQuantity !== null && e.cancelledQuantity !== null)
    requireThat(e.filledQuantity + e.cancelledQuantity <= s.quantity)
  if (s.action === 'submit') {
    requireThat(e.contractMatch === 'unique_new', 'EVIDENCE_CONTRACT_KIND_CONFLICT')
    requireThat(e.observation === 'accepted' && (e.cancelledQuantity === null || e.cancelledQuantity === 0))
    return 'ACCEPTED_OBSERVED'
  }
  requireThat(e.contractMatch === 'unique_target', 'EVIDENCE_CONTRACT_KIND_CONFLICT')
  requireThat(e.contractNo === s.cancelTarget!.contractNo && e.tradingDate === s.cancelTarget!.tradingDate)
  requireThat(['cancelled', 'partially_cancelled'].includes(e.observation))
  requireThat(e.cancelledQuantity === null || e.cancelledQuantity > 0)
  requireThat(e.filledQuantity === null || e.filledQuantity < s.quantity)
  // A UI status can be observed without quantities. Missing quantities never imply completion.
  if (e.observation === 'cancelled' && e.filledQuantity !== null && e.cancelledQuantity !== null)
    requireThat(e.filledQuantity + e.cancelledQuantity === s.quantity)
  requireThat(e.observation !== 'partially_cancelled' || e.cancelledQuantity === null || e.cancelledQuantity < s.quantity)
  return 'CANCEL_OBSERVED'
}
function view(record: StoredIntent): IntentRecord {
  let state: IntentState = record.snapshot ? 'PREPARED' : 'LEGACY_UNKNOWN'
  let attempt: Attempt | null = null
  let confirmed: ConfirmationRecord | null = null
  let gateReleased = false
  let previousAt = 0
  requireThat(Array.isArray(record.events) && record.events.length > 0, 'CORRUPT_HISTORY')
  for (const [index, event] of record.events.entries()) {
    object(event); timestamp(event.at)
    requireThat(event.sequence === index + 1 && event.at >= previousAt, 'CORRUPT_HISTORY')
    previousAt = event.at
    let next: IntentState = state
    const common = ['sequence', 'at', 'kind']
    if (index === 0) {
      keys(event, common)
      requireThat(event.kind === (record.snapshot ? 'prepared' : 'legacy_unknown'), 'CORRUPT_HISTORY')
      requireThat(!record.snapshot || event.at === record.snapshot.createdAt)
      continue
    }
    switch (event.kind) {
      case 'confirmed':
        keys(event, [...common, 'confirmation'])
        requireThat(record.snapshot && ['PREPARED', 'CONFIRMED'].includes(state), 'ILLEGAL_TRANSITION')
        validateConfirmation(event.confirmation, record.snapshot, record.additionalOrder)
        requireThat(event.at === event.confirmation.confirmedAt)
        confirmed = event.confirmation; next = 'CONFIRMED'; break
      case 'abandoned':
        keys(event, [...common, 'reason'])
        requireThat(event.reason === 'cancelled' || event.reason === 'expired')
        next = 'ABANDONED'; break
      case 'claimed':
        keys(event, [...common, 'attempt'])
        keys(event.attempt, ['attemptId', 'requestId', 'sessionId', 'claimedAt'])
        requireThat(!attempt && confirmed && matches(event.attempt.attemptId, ID) && matches(event.attempt.requestId, ID)
          && event.attempt.sessionId === confirmed.sessionId && event.at === event.attempt.claimedAt
          && event.at < confirmed.expiresAt && event.at < record.snapshot!.expiresAt, 'CORRUPT_ATTEMPT')
        attempt = event.attempt; next = 'UNKNOWN'; break
      case 'outcome':
        keys(event, [...common, 'evidence'])
        requireThat(state === 'UNKNOWN' && attempt && record.snapshot, 'ILLEGAL_TRANSITION')
        requireThat(event.evidence.observedAt >= attempt.claimedAt && event.at >= event.evidence.observedAt)
        next = evidenceState(event.evidence, record.snapshot); break
      case 'recovery_review':
        keys(event, [...common, 'reviewingSessionId', 'observation', 'recoveryId', 'reviewRequestId', 'snapshotHash', 'expectedRevision'])
        requireThat(matches(event.reviewingSessionId, SESSION_ID) && matches(event.recoveryId, DIGEST)
          && matches(event.reviewRequestId, ID) && event.snapshotHash === record.snapshotHash
          && event.expectedRevision === index, 'INVALID_RECOVERY_REVIEW')
        validateHuman(event.observation, record.snapshot)
        gateReleased = event.observation.releaseGate
        break
      case 'human_review':
        keys(event, [...common, 'reviewingSessionId', 'observation'])
        requireThat(matches(event.reviewingSessionId, SESSION_ID), 'INVALID_REVIEW_SESSION')
        requireThat(state === 'UNKNOWN' || state === 'LEGACY_UNKNOWN', 'ILLEGAL_TRANSITION')
        validateHuman(event.observation, record.snapshot)
        // Each review appends history. It never supplies adapter facts or execution authority.
        gateReleased = event.observation.releaseGate
        break
      default: throw new IntentStoreError('CORRUPT_HISTORY')
    }
    if (event.kind !== 'human_review' && event.kind !== 'recovery_review') requireThat(
      (MAC_THS_INTENT_TRANSITIONS[state] as readonly string[]).includes(next), 'ILLEGAL_TRANSITION')
    state = next
  }
  return freeze(copy({ ...record, state, revision: record.events.length, attempt, gateReleased }))
}
function validatePayload(payload: Payload) {
  keys(payload, ['storeId', 'revision', 'coverage', 'intents', 'requests'])
  requireThat(matches(payload.storeId, ID)); integer(payload.revision, 1)
  keys(payload.coverage, ['kind', 'since', 'legacyIds', 'earlierIds'])
  requireThat(['fresh', 'legacy'].includes(payload.coverage.kind) && payload.coverage.earlierIds === 'unavailable')
  timestamp(payload.coverage.since); integer(payload.coverage.legacyIds)
  requireThat(Array.isArray(payload.intents) && Array.isArray(payload.requests))
  const intents = new Map<string, StoredIntent>()
  for (const record of payload.intents) {
    keys(record, ['intentId', 'originalRequestId', 'snapshot', 'snapshotHash', 'fingerprint', 'additionalOrder', 'events'])
    requireThat(matches(record.intentId, ID) && !intents.has(record.intentId), 'CORRUPT_INTENT_INDEX')
    if (record.snapshot) {
      requireThat(record.snapshotHash === hashIntentSnapshot(record.snapshot) && record.fingerprint === fingerprint(record.snapshot), 'CORRUPT_SNAPSHOT')
      requireThat(matches(record.originalRequestId, ID))
    } else requireThat(record.snapshot === null && record.snapshotHash === null && record.fingerprint === null
      && record.originalRequestId === null && record.additionalOrder === null, 'CORRUPT_LEGACY')
    if (record.additionalOrder) {
      keys(record.additionalOrder, ['previousIntentId', 'additionalOrderAcknowledged'])
      requireThat(matches(record.additionalOrder.previousIntentId, ID) && record.additionalOrder.additionalOrderAcknowledged === true)
    }
    view(record)
    intents.set(record.intentId, record)
  }
  const requests = new Map<string, RequestTombstone>()
  for (const r of payload.requests) {
    keys(r, ['requestId', 'intentId', 'snapshotHash', 'origin'])
    requireThat(matches(r.requestId, ID) && !requests.has(r.requestId), 'CORRUPT_REQUEST_INDEX')
    if (r.origin === 'legacy') requireThat(r.intentId === null && r.snapshotHash === null)
    else requireThat(r.origin === 'intent' && r.intentId !== null && intents.has(r.intentId)
      && r.snapshotHash === intents.get(r.intentId)!.snapshotHash, 'CORRUPT_REQUEST_INDEX')
    requests.set(r.requestId, r)
  }
  requireThat(payload.requests.filter(r => r.origin === 'legacy').length === payload.coverage.legacyIds)
  for (const record of payload.intents) {
    if (record.snapshot) requireThat(requests.get(record.originalRequestId!)?.intentId === record.intentId)
    if (record.additionalOrder) requireThat(record.additionalOrder.previousIntentId !== record.intentId
      && intents.get(record.additionalOrder.previousIntentId)?.fingerprint === record.fingerprint, 'CORRUPT_RELATION')
    const attempt = view(record).attempt
    if (attempt) requireThat(requests.get(attempt.requestId)?.intentId === record.intentId, 'CORRUPT_ATTEMPT')
  }
}
function missing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT' }
function exists(path: string) {
  try { lstatSync(path); return true } catch (error) { if (missing(error)) return false; throw error }
}

/** Internal decoder for immutable, unpublished JSON v1 evidence. Never writes old files. */
export const intentRecoveryCodec = {
  copy, canonical, digest, validatePayload, view, freeze,
  decode(bytes: Buffer): Payload {
    const envelope = copy(JSON.parse(bytes.toString('utf8'))) as { schemaVersion: number; checksum: string; payload: Payload }
    keys(envelope, ['schemaVersion', 'checksum', 'payload'])
    requireThat(envelope.schemaVersion === 1, 'UNSUPPORTED_VERSION')
    requireThat(envelope.checksum === digest(envelope.payload), 'CORRUPT_DIGEST')
    validatePayload(envelope.payload)
    return envelope.payload
  }
}
const SCHEMA = `
CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL CHECK(schema_version=2),
  store_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, checksum TEXT NOT NULL,
  imported INTEGER NOT NULL DEFAULT 0, source_complete INTEGER NOT NULL DEFAULT 1);
CREATE TABLE sessions (session_id TEXT PRIMARY KEY, opened_at INTEGER NOT NULL, closed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE recovery_cases (recovery_id TEXT PRIMARY KEY, manifest_hash TEXT NOT NULL, base_revision INTEGER NOT NULL,
  plan TEXT NOT NULL, receipt TEXT NOT NULL);
CREATE TABLE intents (intent_id TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL,
  created_session TEXT NOT NULL, execution_forbidden INTEGER NOT NULL DEFAULT 0,
  recovery_quarantine INTEGER NOT NULL DEFAULT 0, recovery_id TEXT REFERENCES recovery_cases(recovery_id),
  potential_effect INTEGER NOT NULL DEFAULT 0);
CREATE TABLE events (intent_id TEXT NOT NULL REFERENCES intents(intent_id), sequence INTEGER NOT NULL,
  body TEXT NOT NULL, PRIMARY KEY(intent_id,sequence));
CREATE TABLE attempts (intent_id TEXT PRIMARY KEY REFERENCES intents(intent_id), attempt_id TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL, executor_state TEXT NOT NULL DEFAULT 'not_started'
    CHECK(executor_state IN ('not_started','launch_pending','running','exited')),
  executor_instance TEXT);
CREATE TABLE request_tombstones (request_id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE intent_reservations (intent_id TEXT PRIMARY KEY);
CREATE TABLE human_reviews (review_request_id TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES intents(intent_id),
  recovery_id TEXT NOT NULL REFERENCES recovery_cases(recovery_id), input_hash TEXT NOT NULL, result TEXT NOT NULL);
CREATE TABLE recovery_artifacts (recovery_id TEXT NOT NULL REFERENCES recovery_cases(recovery_id),
  name TEXT NOT NULL, role TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, validation TEXT NOT NULL,
  raw BLOB NOT NULL, PRIMARY KEY(recovery_id,name));
CREATE TABLE recovery_conflicts (recovery_id TEXT NOT NULL REFERENCES recovery_cases(recovery_id),
  kind TEXT NOT NULL, entity_id TEXT NOT NULL, evidence TEXT NOT NULL,
  PRIMARY KEY(recovery_id,kind,entity_id));
`
export class MacThsIntentStore {
  readonly sessionId = randomUUID()
  readonly paths: Readonly<{ data: string; activated: string; pending: string; lock: string; legacyData: string }>
  readonly durability: Readonly<{ sqliteVersion: string; journalMode: string; lockingMode: string; synchronous: number; fullfsync: number }>
  private readonly directory: string
  private readonly openedAt = Date.now()
  private readonly openedMonotonic = performance.now()
  private readonly deadlines = new Map<string, { revision: number; deadline: number; quoteDeadline: number | null }>()
  private readonly quoteAuthority = new Map<string, { snapshotHash: string; deadline: number }>()
  private readonly executionPermits = new Map<string, { deadline: number; expiresAt: number; confirmedAt: number; wallFloor: number }>()
  private broken = false
  private closing = false
  private stopping = false
  private liveAccount: { digest: string; observedAt: number } | null = null
  private readonly db: Database.Database
  private readonly recovery: MacThsIntentRecovery
  private owner = false

  private constructor(private readonly options: IntentStoreOptions) {
    this.directory = canonicalOrderDirectory(options.directory)
    // Refuse known network filesystem types as well as UNC/realpath aliases.
    const fsType = statfsSync(this.directory).type
    requireThat(![0x6969, 0xff534d42, 0x517b, 0x564c].includes(fsType), 'INVALID_DIRECTORY')
    if (process.platform !== 'win32') requireThat((lstatSync(this.directory).mode & 0o077) === 0, 'PRIVATE_DIRECTORY_REQUIRED')
    this.paths = Object.freeze({ data: join(this.directory, 'mac-ths-orders.v2.sqlite'),
      activated: join(this.directory, 'mac-ths-orders.sqlite-enabled'),
      legacyData: join(this.directory, 'mac-ths-intents.v1.json'),
      pending: join(this.directory, 'mac-ths-intents.pending'), lock: join(this.directory, 'mac-ths-intents.lock') })
    const wasEnabled = exists(this.paths.activated)
    const hadDatabase = exists(this.paths.data)
    if (wasEnabled && !hadDatabase) throw new RecoveryRequiredError('CORRUPT_STORE')
    if (!hadDatabase && !options.initialize) throw new RecoveryRequiredError('IMPORT_REQUIRED')
    if (hadDatabase) this.assertRegular(this.paths.data)
    for (const suffix of ['-journal', '-wal', '-shm'])
      if (exists(this.paths.data + suffix)) this.assertRegular(this.paths.data + suffix)
    if (wasEnabled) this.assertRegular(this.paths.activated)
    let db: Database.Database
    try {
      db = new Database(this.paths.data, { timeout: 0, fileMustExist: !options.initialize,
        ...(options.testHooks?.nativeBinding ? { nativeBinding: options.testHooks.nativeBinding } : {}) })
    } catch (error) {
      const code = (error as {code?: string}).code
      throw RecoveryRequiredError.from(error, code === 'MODULE_NOT_FOUND' || code === 'ERR_DLOPEN_FAILED' ? 'ABI_UNAVAILABLE' : 'STORAGE_IO')
    }
    this.db = db
    try {
      db.pragma('busy_timeout = 0'); db.pragma('foreign_keys = ON')
      db.pragma('journal_mode = DELETE'); db.pragma('synchronous = EXTRA')
      db.pragma('locking_mode = EXCLUSIVE')
      if (process.platform === 'darwin') db.pragma('fullfsync = ON')
      db.exec('BEGIN EXCLUSIVE')
      this.owner = true
      if (!hadDatabase) {
        requireThat(!wasEnabled, 'STORE_MISSING_AFTER_ENABLE')
        db.exec(SCHEMA)
        const initial: Payload = { storeId: randomUUID(), revision: 1, coverage: {
          kind: 'fresh', since: Date.now(), legacyIds: 0, earlierIds: 'unavailable' }, intents: [], requests: [] }
        db.prepare('INSERT INTO meta(id,schema_version,store_id,revision,payload,checksum) VALUES(1,2,?,?,?,?)')
          .run(initial.storeId, initial.revision, canonical(initial), digest(initial))
      } else {
        requireThat(db.pragma('integrity_check', { simple: true }) === 'ok', 'CORRUPT_STORE')
        requireThat((db.pragma('foreign_key_check') as unknown[]).length === 0, 'CORRUPT_STORE')
        const meta = db.prepare('SELECT schema_version FROM meta WHERE id=1').get() as { schema_version: number }
        requireThat(meta?.schema_version === 2, 'UNSUPPORTED_VERSION')
        const actualSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{sql:string}>
        const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim()
        requireThat(canonical(actualSchema.map(row => normalize(row.sql)).sort()) ===
          canonical(SCHEMA.split(';').map(normalize).filter(Boolean).sort()), 'CORRUPT_SCHEMA')
        if (wasEnabled) requireThat(readFileSync(this.paths.activated, 'utf8') ===
          canonical({ schemaVersion: 2, database: 'mac-ths-orders.v2.sqlite' }), 'CORRUPT_MARKER')
        this.load()
      }
      this.durability = Object.freeze({ sqliteVersion: (db.prepare('SELECT sqlite_version() AS version').get() as {version: string}).version,
        journalMode: String(db.pragma('journal_mode', { simple: true })), lockingMode: String(db.pragma('locking_mode', { simple: true })),
        synchronous: Number(db.pragma('synchronous', { simple: true })), fullfsync: Number(db.pragma('fullfsync', { simple: true })) })
      requireThat(this.durability.journalMode === 'delete' && this.durability.lockingMode === 'exclusive'
        && this.durability.synchronous === 3 && (process.platform !== 'darwin' || this.durability.fullfsync === 1), 'DURABILITY_UNAVAILABLE')
      // Marker precedes first committed schema. Missing/partial initialization fails closed, never resets.
      if (!wasEnabled) {
        const fd = openSync(this.paths.activated, 'wx', 0o600)
        try { writeFileSync(fd, canonical({ schemaVersion: 2, database: 'mac-ths-orders.v2.sqlite' })); fsyncSync(fd) }
        finally { closeSync(fd) }
        flushOrderDirectory(this.directory)
      }
      db.prepare('INSERT INTO sessions(session_id,opened_at) VALUES(?,?)').run(this.sessionId, this.openedAt)
      db.exec('COMMIT')
      // locking_mode=EXCLUSIVE deliberately remains in force across this COMMIT.
      this.recovery = new MacThsIntentRecovery({ db, directory: this.directory, sessionId: this.sessionId,
        legacyJournalPath: options.legacyJournalPath, legacyQuiescence: options.legacyQuiescence,
        assertOwner: () => this.assertOwner(), load: () => this.load(),
        save: (payload, previous) => this.save(payload, previous),
        checkpoint: stage => this.checkpoint(stage), codec: intentRecoveryCodec,
        poison: () => { this.broken = true; this.liveAccount = null } })
      options.testHooks?.onDatabaseOpen?.(db)
    } catch (error) {
      this.owner = false
      if (db.inTransaction) { try { db.exec('ROLLBACK') } catch { /* retain the primary failure */ } }
      db.close()
      throw RecoveryRequiredError.from(error, 'CORRUPT_STORE')
    }
  }
  static open(options: IntentStoreOptions): MacThsIntentStore { return new MacThsIntentStore(options) }
  private assertRegular(path: string) {
    const stat = lstatSync(path)
    requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'UNSAFE_STORAGE_FILE')
    return stat
  }
  private checkpoint(stage: StoreCheckpoint | RecoveryCheckpoint) { this.options.testHooks?.checkpoint?.(stage) }
  private assertOwner() {
    requireThat(this.owner && this.db.open && !this.closing, 'OWNER_REVOKED')
    requireThat(!this.broken, 'STORE_POISONED')
  }
  /** Revokes tickets first. Running/uncertain executor associations keep the real owner locked. */
  close(): void {
    if (!this.owner) return
    this.stopping = true
    this.liveAccount = null; this.deadlines.clear(); this.quoteAuthority.clear(); this.executionPermits.clear()
    requireThat(!(this.db.prepare("SELECT 1 FROM attempts WHERE executor_state IN ('launch_pending','running') LIMIT 1").get()),
      'EXECUTOR_EXIT_UNPROVEN')
    this.closing = true
    if (!this.broken) this.db.prepare('UPDATE sessions SET closed=1 WHERE session_id=?').run(this.sessionId)
    this.db.close(); this.owner = false
  }
  async shutdown(coordinator: MacThsRecoveryCoordinator): Promise<void> {
    this.assertOwner(); this.stopping = true
    this.liveAccount = null; this.deadlines.clear(); this.quoteAuthority.clear(); this.executionPermits.clear()
    const children = this.db.prepare("SELECT attempt_id,executor_instance FROM attempts WHERE executor_state IN ('launch_pending','running')")
      .all() as Array<{attempt_id:string;executor_instance:string|null}>
    for (const child of children) {
      requireThat(child.executor_instance, 'EXECUTOR_EXIT_UNPROVEN')
      const proof = await coordinator.stopExecutor(child.executor_instance)
      this.recordExecutorExit(child.attempt_id, proof)
    }
    this.close()
  }
  enableLiveSession(context: { accountDigest: string; observedAt: number }): void {
    const current = copy(context); keys(current, ['accountDigest', 'observedAt']); timestamp(current.observedAt)
    requireThat(!this.stopping, 'SESSION_STOPPING')
    this.assertOwner(); this.recovery.assertNormal()
    requireThat(!this.stopping, 'SESSION_STOPPING')
    requireThat(!this.inspect().unknownPending, 'UNKNOWN_PENDING')
    requireThat(matches(current.accountDigest, DIGEST) && current.observedAt >= this.openedAt
      && current.observedAt <= Date.now() && Date.now() - current.observedAt <= 120000, 'ACCOUNT_CONTEXT_CONFLICT')
    this.liveAccount = { digest: current.accountDigest, observedAt: current.observedAt }
  }
  inspectRecovery() { this.assertOwner(); return this.recovery.inspectRecovery() }
  applyRecovery(recoveryId: string, manifestHash: string, expectedRevision: number) {
    this.assertOwner(); this.liveAccount = null; this.deadlines.clear(); this.quoteAuthority.clear(); this.executionPermits.clear()
    return this.recovery.applyRecovery(recoveryId, manifestHash, expectedRevision)
  }
  getRecoveryReceipt(recoveryId: string) { this.assertOwner(); return this.recovery.getRecoveryReceipt(recoveryId) }
  private load(): Payload {
    const meta = this.db.prepare('SELECT * FROM meta WHERE id=1').get() as {
      store_id: string; revision: number; payload: string; checksum: string; schema_version: number }
    requireThat(meta?.schema_version === 2, 'UNSUPPORTED_VERSION')
    const payload = copy(JSON.parse(meta.payload)) as Payload
    requireThat(meta.checksum === digest(payload) && meta.store_id === payload.storeId && meta.revision === payload.revision, 'CORRUPT_DIGEST')
    validatePayload(payload)
    const intents = this.db.prepare('SELECT intent_id,body,revision FROM intents ORDER BY intent_id').all() as Array<{intent_id:string;body:string;revision:number}>
    requireThat(intents.length === payload.intents.length, 'CORRUPT_INTENT_INDEX')
    for (const record of payload.intents) {
      const row = intents.find(row => row.intent_id === record.intentId)
      requireThat(row && row.body === canonical(record) && row.revision === record.events.length, 'CORRUPT_HISTORY')
      const events = this.db.prepare('SELECT body FROM events WHERE intent_id=? ORDER BY sequence').all(record.intentId) as Array<{body:string}>
      requireThat(canonical(events.map(row => JSON.parse(row.body))) === canonical(record.events), 'CORRUPT_HISTORY')
      const attempt = view(record).attempt
      const stored = this.db.prepare('SELECT body FROM attempts WHERE intent_id=?').get(record.intentId) as {body:string}|undefined
      requireThat(attempt ? stored?.body === canonical(attempt) : !stored, 'CORRUPT_ATTEMPT')
    }
    const requests = this.db.prepare('SELECT body FROM request_tombstones ORDER BY request_id').all() as Array<{body:string}>
    requireThat(canonical(requests.map(row => JSON.parse(row.body))) ===
      canonical([...payload.requests].sort((a,b) => a.requestId.localeCompare(b.requestId))), 'CORRUPT_REQUEST_INDEX')
    return payload
  }
  private save(payload: Payload, previous: Payload): void {
    validatePayload(payload)
    for (const record of payload.intents) {
      const old = previous.intents.find(item => item.intentId === record.intentId)
      if (old) {
        requireThat(canonical(record.events.slice(0,old.events.length)) === canonical(old.events)
          && canonical({...record,events:[]}) === canonical({...old,events:[]}), 'IMMUTABLE_HISTORY')
        if (record.events.length === old.events.length) continue
        const result = this.db.prepare('UPDATE intents SET body=?,revision=? WHERE intent_id=? AND revision=?')
          .run(canonical(record),record.events.length,record.intentId,old.events.length)
        requireThat(result.changes === 1, 'CAS_CONFLICT')
      } else {
        this.db.prepare('INSERT INTO intents(intent_id,body,revision,created_session) VALUES(?,?,?,?)')
          .run(record.intentId,canonical(record),record.events.length,this.sessionId)
        this.db.prepare('INSERT OR IGNORE INTO intent_reservations(intent_id) VALUES(?)').run(record.intentId)
      }
      for (const event of record.events.slice(old?.events.length ?? 0))
        this.db.prepare('INSERT INTO events(intent_id,sequence,body) VALUES(?,?,?)').run(record.intentId,event.sequence,canonical(event))
      const attempt = view(record).attempt
      if (attempt && !old?.events.some(event => event.kind === 'claimed'))
        this.db.prepare('INSERT INTO attempts(intent_id,attempt_id,body) VALUES(?,?,?)').run(record.intentId,attempt.attemptId,canonical(attempt))
    }
    this.checkpoint('events_written'); this.checkpoint('attempts_written')
    for (const request of payload.requests) {
      const old = previous.requests.find(item => item.requestId === request.requestId)
      if (old) requireThat(canonical(old) === canonical(request), 'IMMUTABLE_REQUEST')
      else this.db.prepare('INSERT INTO request_tombstones(request_id,body) VALUES(?,?)').run(request.requestId,canonical(request))
    }
    requireThat(previous.intents.every(old => payload.intents.some(r => r.intentId === old.intentId))
      && previous.requests.every(old => payload.requests.some(r => r.requestId === old.requestId)), 'IMMUTABLE_INDEX')
    this.checkpoint('requests_written')
    const result = this.db.prepare('UPDATE meta SET revision=?,payload=?,checksum=? WHERE id=1 AND revision=?')
      .run(payload.revision,canonical(payload),digest(payload),previous.revision)
    requireThat(result.changes === 1, 'CAS_CONFLICT')
  }
  private transaction<T>(work: (payload: Payload, commit: () => void) => T, recoveryReview = false): T {
    this.assertOwner()
    const previous = this.load()
    const payload = copy(previous)
    let changed = false
    const result = work(payload, () => { changed = true })
    if (!changed) return result
    if (!recoveryReview) this.recovery.assertNormal()
    try {
      this.db.exec('BEGIN EXCLUSIVE'); this.checkpoint('transaction_started')
      payload.revision++; this.save(payload, previous)
      this.checkpoint('before_commit'); this.db.exec('COMMIT'); this.checkpoint('after_commit')
      return result
    } catch (error) {
      this.broken = true; this.liveAccount = null
      if (this.db.inTransaction) this.db.exec('ROLLBACK')
      if (typeof (error as {code?:string}).code === 'string' && (error as {code:string}).code.startsWith('SQLITE_'))
        throw RecoveryRequiredError.from(error, 'STORAGE_IO')
      throw error
    }
  }
  private present(record: StoredIntent): IntentRecord {
    const projection = this.db.prepare('SELECT execution_forbidden,recovery_quarantine,recovery_id FROM intents WHERE intent_id=?')
      .get(record.intentId) as {execution_forbidden:number;recovery_quarantine:number;recovery_id:string|null}|undefined
    return freeze({...view(record), executionForbidden: Boolean(projection?.execution_forbidden),
      recoveryQuarantine: Boolean(projection?.recovery_quarantine), recoveryId: projection?.recovery_id ?? null})
  }
  private requireExecutable(record: StoredIntent) {
    const old = this.db.prepare('SELECT execution_forbidden,created_session FROM intents WHERE intent_id=?')
      .get(record.intentId) as {execution_forbidden:number;created_session:string}
    requireThat(!old.execution_forbidden && old.created_session === this.sessionId,
      record.snapshot?.input.source === 'quote' ? 'QUOTE_SESSION_REQUIRED' : 'EXECUTION_FORBIDDEN')
  }
  /** Only this supervised launch path may turn a claim into an automation child.
   * Launch-pending is durable before spawn; uncertain launch cannot be cleared by human review.
   */
  launchExecutor(attemptId: string, coordinator: MacThsRecoveryCoordinator, executable: string, args: readonly string[]) {
    this.assertOwner(); this.recovery.assertNormal()
    const permit = this.executionPermits.get(attemptId)
    this.executionPermits.delete(attemptId)
    const validPermit = () => {
      const wall = Date.now()
      const valid = permit && performance.now() < permit.deadline && wall >= permit.confirmedAt
        && wall >= permit.wallFloor && wall < permit.expiresAt && !this.stopping
      if (valid) permit.wallFloor = wall
      return Boolean(valid)
    }
    requireThat(validPermit(), 'EXECUTION_PERMISSION_EXPIRED')
    const row = this.db.prepare('SELECT body,executor_state FROM attempts WHERE attempt_id=?').get(attemptId) as {body:string;executor_state:string}|undefined
    requireThat(row && row.executor_state === 'not_started' && JSON.parse(row.body).sessionId === this.sessionId, 'ATTEMPT_CONFLICT')
    const intent = this.db.prepare('SELECT body FROM intents WHERE intent_id=(SELECT intent_id FROM attempts WHERE attempt_id=?)')
      .get(attemptId) as {body:string}
    requireThat(view(JSON.parse(intent.body)).state === 'UNKNOWN', 'ATTEMPT_CONFLICT')
    // The local sentinel is set only by our final, synchronous PRE-spawn guard.
    // Arbitrary spawn errors or post-spawn SQL errors do not prove "not started".
    let deniedBeforeSpawn: IntentStoreError | null = null
    let instance: ReturnType<MacThsRecoveryCoordinator['launchExecutor']>
    try {
      this.db.prepare("UPDATE attempts SET executor_state='launch_pending' WHERE attempt_id=?").run(attemptId)
      instance = coordinator.launchExecutor(executable, args, {}, () => {
        if (!validPermit()) {
          deniedBeforeSpawn = new IntentStoreError('EXECUTION_PERMISSION_EXPIRED')
          throw deniedBeforeSpawn
        }
      })
      this.db.prepare("UPDATE attempts SET executor_state='running',executor_instance=? WHERE attempt_id=?").run(instance.instanceId,attemptId)
    } catch (error) {
      if (deniedBeforeSpawn !== null && error === deniedBeforeSpawn) {
        try {
          const result = this.db.prepare("UPDATE attempts SET executor_state='not_started' WHERE attempt_id=? AND executor_state='launch_pending' AND executor_instance IS NULL").run(attemptId)
          requireThat(result.changes === 1, 'ATTEMPT_CONFLICT')
        } catch (storageError) {
          this.broken = true; this.liveAccount = null
          throw RecoveryRequiredError.from(storageError, 'STORAGE_IO')
        }
      } else if (typeof (error as {code?: string}).code === 'string' &&
          (error as {code:string}).code.startsWith('SQLITE_')) {
        this.broken = true; this.liveAccount = null
        throw RecoveryRequiredError.from(error, 'STORAGE_IO')
      }
      throw error
    }
    return instance
  }
  recordExecutorExit(attemptId: string, proof: ExecutorExitCapability): void {
    this.assertOwner()
    const row = this.db.prepare('SELECT executor_instance FROM attempts WHERE attempt_id=?').get(attemptId) as {executor_instance:string}|undefined
    requireThat(row?.executor_instance, 'EXECUTOR_EXIT_UNPROVEN')
    verifyExecutorExit(proof,row.executor_instance)
    this.db.prepare("UPDATE attempts SET executor_state='exited' WHERE attempt_id=?").run(attemptId)
  }
  private record(payload: Payload, intentId: string, snapshotHash: string | null): StoredIntent {
    requireThat(matches(intentId, ID), 'INVALID_ID')
    const record = payload.intents.find(item => item.intentId === intentId)
    requireThat(record, 'INTENT_NOT_FOUND')
    requireThat(record.snapshotHash === snapshotHash, 'SNAPSHOT_CONFLICT')
    return record
  }
  private cas(record: StoredIntent, expectedRevision: number) {
    integer(expectedRevision, 1)
    requireThat(record.events.length === expectedRevision, 'CAS_CONFLICT')
  }
  private append(record: StoredIntent, event: IntentEvent) {
    record.events.push(event)
    return this.present(record)
  }
  private bindRequest(payload: Payload, requestId: string, record: StoredIntent): boolean {
    requireThat(matches(requestId, ID), 'INVALID_ID')
    const old = payload.requests.find(r => r.requestId === requestId)
    if (old) {
      requireThat(old.origin === 'intent' && old.intentId === record.intentId && old.snapshotHash === record.snapshotHash, 'REQUEST_CONFLICT')
      return false
    }
    payload.requests.push({ requestId, intentId: record.intentId, snapshotHash: record.snapshotHash, origin: 'intent' })
    return true
  }
  private requireAssociation(payload: Payload, record: StoredIntent) {
    const previous = payload.intents.filter(other => other.intentId !== record.intentId
      && other.fingerprint === record.fingerprint)
    const unknown = previous.filter(other => view(other).state === 'UNKNOWN' || Boolean((this.db.prepare('SELECT potential_effect FROM intents WHERE intent_id=?').get(other.intentId) as {potential_effect:number})?.potential_effect))
    if (unknown.length > 0) {
      requireThat(record.additionalOrder && unknown.some(other => other.intentId === record.additionalOrder!.previousIntentId),
        'DUPLICATE_ISOLATED')
      return
    }
    const observed = previous.filter(other => ['ACCEPTED_OBSERVED', 'CANCEL_OBSERVED'].includes(view(other).state))
    if (observed.length > 0) requireThat(record.additionalOrder
      && observed.some(other => other.intentId === record.additionalOrder!.previousIntentId), 'ADDITIONAL_ORDER_LINK_REQUIRED')
  }
  /** ID+different hash conflicts; request tombstones and intent records are never evicted. */
  createIntent(requestId: string, snapshot: IntentSnapshot, additionalOrder: AdditionalOrder | null = null,
    intentId: string = randomUUID()): IntentRecord {
    requireThat(matches(requestId, ID) && matches(intentId, ID), 'INVALID_ID')
    const savedSnapshot = copy(snapshot)
    const hash = hashIntentSnapshot(savedSnapshot)
    const relation = copy(additionalOrder)
    if (relation !== null) object(relation)
    return this.transaction((payload, commit) => {
      const request = payload.requests.find(r => r.requestId === requestId)
      if (request) {
        requireThat(request.origin === 'intent' && request.snapshotHash === hash, 'REQUEST_CONFLICT')
        const existing = payload.intents.find(r => r.intentId === request.intentId)!
        requireThat(canonical(existing.additionalOrder) === canonical(relation), 'INTENT_CONFLICT')
        return this.present(existing)
      }
      const existing = payload.intents.find(r => r.intentId === intentId)
      if (existing) {
        requireThat(existing.snapshotHash === hash && canonical(existing.additionalOrder) === canonical(relation), 'INTENT_CONFLICT')
        this.bindRequest(payload, requestId, existing); commit(); return this.present(existing)
      }
      requireThat(!this.db.prepare('SELECT 1 FROM intent_reservations WHERE intent_id=?').get(intentId), 'INTENT_CONFLICT')
      requireThat(savedSnapshot.createdAt <= Date.now() && savedSnapshot.expiresAt > Date.now(), 'SNAPSHOT_EXPIRED')
      const record: StoredIntent = { intentId, originalRequestId: requestId, snapshot: savedSnapshot, snapshotHash: hash,
        fingerprint: fingerprint(savedSnapshot), additionalOrder: relation,
        events: [{ sequence: 1, at: savedSnapshot.createdAt, kind: 'prepared' }] }
      if (relation) {
        keys(relation, ['previousIntentId', 'additionalOrderAcknowledged'])
        requireThat(relation.additionalOrderAcknowledged === true && relation.previousIntentId !== intentId
          && payload.intents.some(r => r.intentId === relation.previousIntentId && r.fingerprint === record.fingerprint), 'INVALID_ADDITIONAL_ORDER')
      }
      this.requireAssociation(payload, record)
      const input = savedSnapshot.input
      const monotonicNow = performance.now()
      const quoteNow = Math.max(Date.now(), this.openedAt + monotonicNow - this.openedMonotonic)
      const quoteDeadline = input.source === 'quote' ? monotonicNow + (input.capturedAt + input.maxAgeMs - quoteNow) : null
      payload.intents.push(record); this.bindRequest(payload, requestId, record); commit()
      if (quoteDeadline !== null) this.quoteAuthority.set(intentId, { snapshotHash: hash, deadline: quoteDeadline })
      return this.present(record)
    })
  }
  getIntent(intentId: string): IntentRecord | null {
    return this.transaction(payload => {
      const record = payload.intents.find(item => item.intentId === intentId)
      return record ? this.present(record) : null
    })
  }
  inspect(): Readonly<{ intents: IntentRecord[]; unknownPending: boolean; coverage: Payload['coverage']; requestCount: number }> {
    return this.transaction(payload => {
      const intents = payload.intents.map(record => this.present(record))
      return freeze({ intents, unknownPending: intents.some(r => (['UNKNOWN', 'LEGACY_UNKNOWN'].includes(r.state) && !r.gateReleased) || r.recoveryQuarantine),
        coverage: copy(payload.coverage), requestCount: payload.requests.length })
    })
  }
  confirmIntent(intentId: string, snapshotHash: string, expectedRevision: number, confirmation: ConfirmationRecord): IntentRecord {
    const c = copy(confirmation)
    requireThat(!this.stopping, 'SESSION_STOPPING')
    return this.transaction((payload, commit) => {
      const record = this.record(payload, intentId, snapshotHash); this.cas(record, expectedRevision)
      requireThat(record.snapshot, 'LEGACY_NOT_EXECUTABLE')
      this.requireExecutable(record)
      validateConfirmation(c, record.snapshot, record.additionalOrder)
      const now = Date.now()
      requireThat(c.sessionId === this.sessionId && c.confirmedAt <= now && now < c.expiresAt, 'CONFIRMATION_EXPIRED')
      const monotonicNow = performance.now()
      const monotonicDeadline = monotonicNow + c.expiresAt - now
      const input = record.snapshot.input
      const authority = this.quoteAuthority.get(intentId)
      if (input.source === 'quote') requireThat(authority?.snapshotHash === snapshotHash, 'QUOTE_SESSION_REQUIRED')
      const quoteDeadline = input.source === 'quote' ? authority!.deadline : null
      this.requireAssociation(payload, record)
      const result = this.append(record, { sequence: expectedRevision + 1, at: c.confirmedAt, kind: 'confirmed', confirmation: c })
      commit()
      this.deadlines.set(intentId, { revision: result.revision, deadline: monotonicDeadline, quoteDeadline })
      return result
    })
  }
  abandonIntent(intentId: string, snapshotHash: string, expectedRevision: number, reason: 'cancelled' | 'expired'): IntentRecord {
    return this.transaction((payload, commit) => {
      const record = this.record(payload, intentId, snapshotHash); this.cas(record, expectedRevision)
      const result = this.append(record, { sequence: expectedRevision + 1, at: Date.now(), kind: 'abandoned', reason })
      commit(); this.deadlines.delete(intentId); return result
    })
  }
  claimExecution(intentId: string, snapshotHash: string, expectedRevision: number, requestId: string,
    context: { accountDigest: string; observedAt: number }): Readonly<{ claimed: boolean; intent: IntentRecord; attemptId: string | null }> {
    const current = copy(context)
    keys(current, ['accountDigest', 'observedAt'])
    let executionDeadline = 0
    let executionExpiresAt = 0
    let executionConfirmedAt = 0
    const result = this.transaction((payload, commit) => {
      const record = this.record(payload, intentId, snapshotHash)
      const state = this.present(record)
      if (state.attempt || state.state === 'ABANDONED') {
        if (this.bindRequest(payload, requestId, record)) commit()
        return freeze({ claimed: false, intent: state, attemptId: null })
      }
      this.requireExecutable(record)
      requireThat(!this.stopping, 'SESSION_STOPPING')
      this.cas(record, expectedRevision)
      requireThat(state.state === 'CONFIRMED' && record.snapshot, 'CONFIRMATION_REQUIRED')
      requireThat(!payload.intents.map(view).some(r => ['UNKNOWN', 'LEGACY_UNKNOWN'].includes(r.state) && !r.gateReleased), 'UNKNOWN_PENDING')
      this.recovery.assertNormal()
      requireThat(!this.inspect().unknownPending, 'UNKNOWN_PENDING')
      this.requireAssociation(payload, record)
      const deadline = this.deadlines.get(intentId)
      const s = record.snapshot
      if (s.input.source === 'quote') requireThat(this.quoteAuthority.get(intentId)?.snapshotHash === snapshotHash, 'QUOTE_SESSION_REQUIRED')
      const c = (record.events[record.events.length - 1] as Extract<IntentEvent, { kind: 'confirmed' }>).confirmation
      const now = Date.now()
      requireThat(deadline && deadline.revision === expectedRevision && performance.now() < deadline.deadline
        && c.sessionId === this.sessionId && now >= c.confirmedAt && now < c.expiresAt && now < s.expiresAt, 'CONFIRMATION_EXPIRED')
      executionDeadline = deadline.deadline
      executionExpiresAt = Math.min(c.expiresAt, s.expiresAt)
      executionConfirmedAt = c.confirmedAt
      requireThat(s.mode !== 'livePreview', 'PREVIEW_NOT_EXECUTABLE')
      if (s.mode === 'live') requireThat(this.liveAccount?.digest === s.accountContext.digest, 'LIVE_SESSION_REQUIRED')
      timestamp(current.observedAt)
      requireThat(current.accountDigest === s.accountContext.digest && current.observedAt >= c.confirmedAt
        && current.observedAt >= this.openedAt && current.observedAt <= now && now - current.observedAt <= 120000, 'ACCOUNT_CONTEXT_CONFLICT')
      if (s.input.source === 'quote') {
        const quoteExpiresAt = s.input.capturedAt + s.input.maxAgeMs
        requireThat(deadline.quoteDeadline !== null && performance.now() < deadline.quoteDeadline
          && now < quoteExpiresAt, 'QUOTE_EXPIRED')
        executionDeadline = Math.min(executionDeadline, deadline.quoteDeadline)
        executionExpiresAt = Math.min(executionExpiresAt, quoteExpiresAt)
      }
      this.bindRequest(payload, requestId, record)
      const attempt: Attempt = { attemptId: randomUUID(), requestId, sessionId: this.sessionId, claimedAt: now }
      const result = this.append(record, { sequence: expectedRevision + 1, at: now, kind: 'claimed', attempt })
      commit(); this.deadlines.delete(intentId)
      // A lock-release fsync failure also throws before the caller can execute.
      return freeze({ claimed: true, intent: result, attemptId: attempt.attemptId })
    })
    // Include all commit and lock-release latency, not just the pre-commit validation.
    // UNKNOWN remains consumed even when expiry prevents returning a permission.
    this.checkpoint('before_permission')
    const returnedAt = Date.now()
    if (result.claimed && (performance.now() >= executionDeadline || returnedAt < executionConfirmedAt
      || returnedAt >= executionExpiresAt)) return freeze({ claimed: false, intent: result.intent, attemptId: null })
    if (result.claimed) this.executionPermits.set(result.attemptId!, {
      deadline: executionDeadline, expiresAt: executionExpiresAt, confirmedAt: executionConfirmedAt, wallFloor: returnedAt })
    return result
  }
  recordOutcome(intentId: string, snapshotHash: string, expectedRevision: number, attemptId: string,
    evidence: AdapterEvidence): IntentRecord {
    const e = copy(evidence)
    return this.transaction((payload, commit) => {
      const record = this.record(payload, intentId, snapshotHash); this.cas(record, expectedRevision)
      requireThat(view(record).attempt?.attemptId === attemptId, 'ATTEMPT_CONFLICT')
      requireThat(e.observedAt <= Date.now(), 'INVALID_EVIDENCE_TIME')
      const result = this.append(record, { sequence: expectedRevision + 1, at: Date.now(), kind: 'outcome', evidence: e })
      commit(); return result
    })
  }
  /** A null hash is accepted only for a LEGACY_UNKNOWN placeholder. Never rewrites state. */
  recordHumanReview(intentId: string, snapshotHash: string | null, observation: HumanObservation, reviewedAt: number,
    expectedRevision: number, binding?: RecoveryReviewBinding): IntentRecord {
    const o = copy(observation)
    requireThat(matches(intentId, ID) && (snapshotHash === null || matches(snapshotHash, DIGEST)), 'INVALID_ID')
    timestamp(reviewedAt); requireThat(reviewedAt <= Date.now(), 'INVALID_REVIEW_TIME')
    if (binding) return this.recovery.recordHumanReview(intentId, snapshotHash, o, reviewedAt, expectedRevision, copy(binding))
    requireThat(!this.present(this.record(this.load(), intentId, snapshotHash)).recoveryQuarantine, 'RECOVERY_REVIEW_REQUIRED')
    return this.transaction((payload, commit) => {
      const record = this.record(payload, intentId, snapshotHash); this.cas(record, expectedRevision)
      const result = this.append(record, { sequence: expectedRevision + 1, at: reviewedAt, kind: 'human_review',
        reviewingSessionId: this.sessionId, observation: o })
      if (result.attempt) this.executionPermits.delete(result.attempt.attemptId)
      commit(); return result
    })
  }
}
