import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { decodeLedgerAccount, decodeLedgerAppend, type CreateLedgerAccount, type AppendLedgerEvent, type LedgerAccount, type LedgerCode, type LedgerRecord, type LedgerSnapshot } from '../../shared/accountLedger'
import { projectAccountLedger } from '../services/accountLedgerProjection'

export class AccountLedgerError extends Error { constructor(readonly code: LedgerCode) { super(code) } }
function fail(code: LedgerCode): never { throw new AccountLedgerError(code) }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
interface AccountRow { id: string; payload: string; digest: string; revision: number; created_at: number }
interface EventRow { id: string; payload: string; digest: string; revision: number; recorded_at: number }
function schema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS rf_account_ledger_accounts (
    id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, digest TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rf_account_ledger_events (
    account_id TEXT NOT NULL REFERENCES rf_account_ledger_accounts(id), id TEXT NOT NULL, payload TEXT NOT NULL,
    digest TEXT NOT NULL, revision INTEGER NOT NULL, recorded_at INTEGER NOT NULL,
    PRIMARY KEY(account_id, id), UNIQUE(account_id, revision));`)
}
function accountFrom(row: AccountRow): LedgerAccount {
  const input = decodeLedgerAccount(JSON.parse(row.payload)); if (!input || row.digest !== digest(input)) fail('STORAGE_UNAVAILABLE')
  return { id: input.accountId, label: input.label, openingCash: input.openingCash, openingAt: input.openingAt,
    openingPositions: input.openingPositions, openingPositionsComplete: input.openingPositionsComplete,
    currency: 'CNY', source: 'manual-confirmed', revision: row.revision, createdAt: row.created_at }
}
function recordFrom(row: EventRow, accountId: string): LedgerRecord {
  const input = decodeLedgerAppend({ accountId, eventId: row.id, expectedRevision: 0, event: JSON.parse(row.payload) })
  if (!input || row.digest !== digest({ accountId, eventId: row.id, event: input.event })) fail('STORAGE_UNAVAILABLE')
  return { id: row.id, revision: row.revision, recordedAt: row.recorded_at, event: input.event }
}
function read(db: Database.Database, accountId: string): { account: LedgerAccount; records: LedgerRecord[] } {
  const row = db.prepare('SELECT * FROM rf_account_ledger_accounts WHERE id = ?').get(accountId) as AccountRow | undefined
  if (!row) fail('ACCOUNT_NOT_FOUND')
  const account = accountFrom(row)
  const rows = db.prepare('SELECT * FROM rf_account_ledger_events WHERE account_id = ? ORDER BY revision').all(accountId) as EventRow[]
  if (rows.length !== account.revision || rows.some((r, index) => r.revision !== index + 1)) fail('STORAGE_UNAVAILABLE')
  return { account, records: rows.map(r => recordFrom(r, accountId)) }
}
export function listLedgerAccounts(db: Database.Database): LedgerAccount[] {
  schema(db)
  return (db.prepare('SELECT * FROM rf_account_ledger_accounts ORDER BY created_at, id').all() as AccountRow[]).map(accountFrom)
}
export function getAccountLedger(db: Database.Database, accountId: string): LedgerSnapshot {
  schema(db)
  return db.transaction(() => { const { account, records } = read(db, accountId); return projectAccountLedger(account, records) })()
}
export function findLedgerEvent(db: Database.Database, accountId: string, eventId: string): LedgerRecord | null {
  schema(db)
  const row = db.prepare('SELECT * FROM rf_account_ledger_events WHERE account_id = ? AND id = ?').get(accountId, eventId) as EventRow | undefined
  return row ? recordFrom(row, accountId) : null
}
export function createLedgerAccount(db: Database.Database, value: CreateLedgerAccount, now = Date.now()): LedgerSnapshot {
  const input = decodeLedgerAccount(value); if (!input || input.openingAt > now) fail('INVALID_INPUT')
  schema(db)
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM rf_account_ledger_accounts WHERE id = ?').get(input.accountId) as AccountRow | undefined
    if (existing) { if (existing.digest !== digest(input)) fail('ACCOUNT_CONFLICT'); return getAccountLedger(db, input.accountId) }
    if (db.prepare('SELECT 1 FROM rf_account_ledger_accounts WHERE label = ?').get(input.label)) fail('ALIAS_EXISTS')
    if ((db.prepare('SELECT COUNT(*) AS count FROM rf_account_ledger_accounts').get() as { count: number }).count >= 50) fail('LIMIT_REACHED')
    db.prepare('INSERT INTO rf_account_ledger_accounts(id,label,payload,digest,revision,created_at) VALUES (?,?,?,?,0,?)')
      .run(input.accountId, input.label, JSON.stringify(input), digest(input), now)
    return getAccountLedger(db, input.accountId)
  })()
}
export function appendAccountLedger(db: Database.Database, value: AppendLedgerEvent, now = Date.now()): LedgerSnapshot {
  const input = decodeLedgerAppend(value); if (!input) fail('INVALID_INPUT')
  schema(db)
  return db.transaction(() => {
    const hash = digest({ accountId: input.accountId, eventId: input.eventId, event: input.event })
    const existing = db.prepare('SELECT * FROM rf_account_ledger_events WHERE account_id = ? AND id = ?').get(input.accountId, input.eventId) as EventRow | undefined
    if (existing) { if (existing.digest !== hash) fail('EVENT_CONFLICT'); return getAccountLedger(db, input.accountId) }
    const { account, records } = read(db, input.accountId)
    if (input.expectedRevision !== account.revision) fail('REVISION_CONFLICT')
    if (records.length >= 50000) fail('LIMIT_REACHED')
    const e = input.event
    const reversed = new Set(records.flatMap(r => r.event.kind === 'reversal' ? [r.event.targetEventId] : []))
    if (e.kind === 'reversal') {
      const target = records.find(r => r.id === e.targetEventId)
      if (!target || target.event.kind === 'reversal' || reversed.has(target.id)) fail('INVALID_REVERSAL')
    } else {
      if (e.occurredAt < account.openingAt || e.occurredAt > now) fail('INVALID_INPUT')
      const prior = [...records].reverse().find(r => r.event.kind === e.kind && r.event.reference === e.reference)
      if (prior && (!reversed.has(prior.id) || e.correctionOf !== prior.id)) fail('REFERENCE_EXISTS')
      if (!prior && e.correctionOf !== null) fail('INVALID_CORRECTION')
    }
    const changed = db.prepare('UPDATE rf_account_ledger_accounts SET revision = revision + 1 WHERE id = ? AND revision = ?').run(input.accountId, input.expectedRevision)
    if (changed.changes !== 1) fail('REVISION_CONFLICT')
    db.prepare('INSERT INTO rf_account_ledger_events(account_id,id,payload,digest,revision,recorded_at) VALUES (?,?,?,?,?,?)')
      .run(input.accountId, input.eventId, JSON.stringify(e), hash, input.expectedRevision + 1, now)
    return getAccountLedger(db, input.accountId)
  })()
}
