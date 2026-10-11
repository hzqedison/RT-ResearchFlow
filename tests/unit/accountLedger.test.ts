import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendAccountLedger, createLedgerAccount, getAccountLedger, listLedgerAccounts } from '../../electron/main/database/accountLedgerRepository'
import { decodeLedgerAccount, decodeLedgerAppend, ledgerMoney, type AppendLedgerEvent, type CreateLedgerAccount, type LedgerEvent } from '../../electron/shared/accountLedger'
const now = Date.parse('2026-10-12T01:00:00Z'), start = now - 86400000
const fees = { commission: '5.00', stampDuty: '0.00', transferFee: '0.01', other: '0.00' }
describe('account ledger facts and exact arithmetic', () => {
  let db: Database.Database, account: CreateLedgerAccount
  beforeEach(() => { db = new Database(':memory:'); account = { accountId: randomUUID(), label: '本地别名', openingCash: '10000.00', openingAt: start, openingPositions: [], openingPositionsComplete: true, cashConfirmed: true }; createLedgerAccount(db, account, now) })
  afterEach(() => db.close())
  function command(event: LedgerEvent): AppendLedgerEvent { return { accountId: account.accountId, eventId: randomUUID(), expectedRevision: getAccountLedger(db, account.accountId).account.revision, event } }
  function fill(reference: string, overrides = {}): LedgerEvent { return { kind: 'fill', reference, occurredAt: now - 1000, correctionOf: null, confirmed: true, symbol: '600001.SH', side: 'buy', quantity: 100, price: '10.00', fees, ...overrides } as LedgerEvent }
  it('does not create a broker balance or copy watchlist costs', () => {
    const s = getAccountLedger(db, account.accountId)
    expect(s).toMatchObject({ cashBalance: '10000.00', availableCash: null, brokerVerified: false, positions: [] })
    expect(listLedgerAccounts(db)).toHaveLength(1)
  })
  it('calculates cash, fees, weighted cost and realized PnL in integer cents', () => {
    appendAccountLedger(db, command(fill('buy-1')), now)
    const s = appendAccountLedger(db, command(fill('sell-1', { side: 'sell', price: '12.00', occurredAt: now })), now)
    expect(s).toMatchObject({ cashBalance: '10189.98', feesTotal: '10.02', realizedPnl: '189.98' })
    expect(s.positions[0]).toMatchObject({ quantity: 0, costBasis: '0.00', availableQuantity: null })
  })
  it('unknown fees are unknown, not zero, and explicit reversal can recover known balances', () => {
    const c = command(fill('unknown-fees', { fees: null })); const s = appendAccountLedger(db, c, now)
    expect(s).toMatchObject({ cashBalance: null, feesTotal: null }); expect(s.issues).toContain('FEES_UNKNOWN')
    const restored = appendAccountLedger(db, command({ kind: 'reversal', targetEventId: c.eventId, reason: '更正', confirmed: true }), now)
    expect(restored.cashBalance).toBe('10000.00'); expect(restored.totalRecords).toBe(2); expect(restored.reversedIds).toContain(c.eventId)
  })
  it('replays the same operation once even with an old revision, but rejects changed payloads', () => {
    const c = command(fill('once')); appendAccountLedger(db, c, now)
    expect(appendAccountLedger(db, c, now).totalRecords).toBe(1)
    expect(() => appendAccountLedger(db, { ...c, event: fill('once', { price: '11.00' }) }, now)).toThrow('EVENT_CONFLICT')
  })
  it('isolates stale writers and independent IDs for the same external receipt', () => {
    const a = command(fill('same-ref')), b = command(fill('other')); appendAccountLedger(db, a, now)
    expect(() => appendAccountLedger(db, b, now)).toThrow('REVISION_CONFLICT')
    expect(() => appendAccountLedger(db, command(fill('same-ref')), now)).toThrow('REFERENCE_EXISTS')
    expect(getAccountLedger(db, account.accountId).totalRecords).toBe(1)
  })
  it('canonicalizes fee field order before stable operation hashing', () => {
    const c = command(fill('canonical')); appendAccountLedger(db, c, now)
    const reordered = { other: '0', transferFee: '0.01', stampDuty: '0', commission: '5' }
    expect(appendAccountLedger(db, { ...c, event: fill('canonical', { fees: reordered }) }, now).totalRecords).toBe(1)
  })
  it('requires explicit reversal linkage for a corrected receipt and never mutates original bytes', () => {
    const original = command(fill('corrected')); appendAccountLedger(db, original, now)
    const before = db.prepare('SELECT payload FROM rf_account_ledger_events WHERE id = ?').get(original.eventId)
    appendAccountLedger(db, command({ kind: 'reversal', targetEventId: original.eventId, reason: '原数量有误', confirmed: true }), now)
    expect(() => appendAccountLedger(db, command(fill('corrected', { quantity: 200 })), now)).toThrow('REFERENCE_EXISTS')
    const s = appendAccountLedger(db, command(fill('corrected', { quantity: 200, correctionOf: original.eventId })), now)
    expect(s.positions[0].quantity).toBe(200); expect(s.totalRecords).toBe(3)
    expect(db.prepare('SELECT payload FROM rf_account_ledger_events WHERE id = ?').get(original.eventId)).toEqual(before)
    expect(appendAccountLedger(db, original, now).totalRecords).toBe(3)
  })
  it('does not guess unregistered opening holdings or oversold quantities', () => {
    const second = { ...account, accountId: randomUUID(), label: '未核对持仓', openingPositionsComplete: false }; createLedgerAccount(db, second, now)
    const s = appendAccountLedger(db, { ...command(fill('buy')), accountId: second.accountId, expectedRevision: 0 }, now)
    expect(s.positions[0]).toMatchObject({ quantity: null, quantityDelta: 100, costBasis: null })
    const sell = appendAccountLedger(db, command(fill('missing-position', { side: 'sell' })), now)
    expect(sell.positions[0].quantity).toBeNull(); expect(sell.realizedPnl).toBeNull(); expect(sell.issues).toContain('POSITION_RECONCILIATION_REQUIRED')
  })
  it('supports explicit cash movements and flags negative book cash without inventing a broker deposit', () => {
    const s = appendAccountLedger(db, command({ kind: 'cash', reference: 'withdraw', occurredAt: now, correctionOf: null, confirmed: true, direction: 'out', amount: '20000.00' }), now)
    expect(s.cashBalance).toBe('-10000.00'); expect(s.availableCash).toBeNull(); expect(s.issues).toContain('NEGATIVE_BOOK_CASH')
  })
  it('keeps a cent of residual cost until the final share closes', () => {
    const initial = { ...account, accountId: randomUUID(), label: '分配尾差', openingPositions: [{ symbol: '600001.SH', quantity: 3, costBasis: '1.00' }] }; createLedgerAccount(db, initial, now)
    for (let i = 0; i < 3; i++) appendAccountLedger(db, { accountId: initial.accountId, eventId: randomUUID(), expectedRevision: i, event: fill(`sell-${i}`, { quantity: 1, price: '1.00', side: 'sell', fees: { commission: '0', stampDuty: '0', transferFee: '0', other: '0' } }) }, now)
    const s = getAccountLedger(db, initial.accountId); expect(s.realizedPnl).toBe('2.00'); expect(s.positions[0].costBasis).toBe('0.00')
  })
  it('rejects pre-opening and future facts, cross-account reversals and reversal-of-reversal', () => {
    expect(() => appendAccountLedger(db, command(fill('future', { occurredAt: now + 1 })), now)).toThrow('INVALID_INPUT')
    expect(() => appendAccountLedger(db, command(fill('past', { occurredAt: start - 1 })), now)).toThrow('INVALID_INPUT')
    expect(() => appendAccountLedger(db, command({ kind: 'reversal', targetEventId: randomUUID(), reason: '错误关联', confirmed: true }), now)).toThrow('INVALID_REVERSAL')
  })
  it('rejects a corrupted persisted fact instead of recomputing reassuring balances', () => {
    const c = command(fill('digest')); appendAccountLedger(db, c, now)
    db.prepare('UPDATE rf_account_ledger_events SET payload = ? WHERE id = ?').run('{}', c.eventId)
    expect(() => getAccountLedger(db, account.accountId)).toThrow('STORAGE_UNAVAILABLE')
  })
  it('rolls back revision and record together on a database write failure', () => {
    db.exec("CREATE TRIGGER reject_ledger BEFORE INSERT ON rf_account_ledger_events BEGIN SELECT RAISE(ABORT,'isolated-write-failure'); END")
    expect(() => appendAccountLedger(db, command(fill('rollback')), now)).toThrow()
    expect(getAccountLedger(db, account.accountId)).toMatchObject({ totalRecords: 0, account: { revision: 0 } })
  })
  it('account creation is stable and duplicate aliases cannot make a second accidental account', () => {
    expect(createLedgerAccount(db, account, now).account.id).toBe(account.accountId)
    expect(() => createLedgerAccount(db, { ...account, openingCash: '0' }, now)).toThrow('ACCOUNT_CONFLICT')
    expect(() => createLedgerAccount(db, { ...account, accountId: randomUUID() }, now)).toThrow('ALIAS_EXISTS')
  })
  it.each(['', 'NaN', '-1', '1e2', '0.001', '01.00', '1000000000000'])('rejects invalid money %s', value => expect(ledgerMoney(value)).toBeNull())
  it('requires declared fill confirmation and rejects order/unknown states, extra fields and accessors', () => {
    expect(decodeLedgerAppend(command(fill('bad', { confirmed: false })))).toBeNull()
    expect(decodeLedgerAppend(command({ kind: 'unknown' } as unknown as LedgerEvent))).toBeNull()
    expect(decodeLedgerAppend({ ...command(fill('extra')), orderAccepted: true })).toBeNull()
    expect(decodeLedgerAccount({ ...account, get openingCash() { throw Error('must not read') } })).toBeNull()
  })
})
