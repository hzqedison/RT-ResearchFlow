import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createLedgerAccount } from '../../electron/main/database/accountLedgerRepository'
import { capitalCatalog, getCapitalReport, runCapitalSimulation } from '../../electron/main/services/backtest/capitalSimulationService'
import type { CapitalRequest } from '../../electron/shared/capitalSimulation'
function capitalRequest(): CapitalRequest { return { id: randomUUID(), source: { kind: 'short-term', key: 'fixture' }, dateStart: '2026-06-01', dateEnd: '2026-06-05', funding: { kind: 'manual', cash: '10000.00' }, assumptionsConfirmed: true,
  plan: { holdDays: 1, maxPositions: 1, maxPositionPct: 100, cashReservePct: 0, lotSize: 100, feeBps: 0, minimumFee: '0.00', slippageBps: 0, stopLossPct: null, stopProfitPct: null } } }
const now = Date.parse('2026-10-12T02:00:00Z')
describe('real SQLite capital snapshots', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`CREATE TABLE short_term_signals(id INTEGER PRIMARY KEY,strategy TEXT,ts_code TEXT,trade_date TEXT,signal_strength REAL,signal_meta TEXT);
      CREATE TABLE strategy_lab_runs(id INTEGER PRIMARY KEY,strategy_name TEXT,status TEXT);
      CREATE TABLE strategy_lab_matches(id INTEGER PRIMARY KEY,run_id INTEGER,ts_code TEXT,trade_date TEXT,signal_strength REAL,score REAL,action_json TEXT);
      CREATE TABLE trade_cal(cal_date TEXT PRIMARY KEY,is_open INTEGER);
      CREATE TABLE daily_close_cache(ts_code TEXT,trade_date TEXT,open REAL,high REAL,low REAL,close REAL,vol REAL,data_source TEXT,PRIMARY KEY(ts_code,trade_date));
      CREATE TABLE security_adjustment_factor_cache(ts_code TEXT,trade_date TEXT,adj_factor REAL,PRIMARY KEY(ts_code,trade_date));`)
    for (let i = 1; i <= 5; i++) { const date = `2026060${i}`, price = i >= 3 ? 12 : 10; db.prepare('INSERT INTO trade_cal VALUES(?,1)').run(date); db.prepare('INSERT INTO daily_close_cache VALUES(?,?,?,?,?,?,?,?)').run('600001.SH', date, price, price + 1, price - 1, price, 1000, 'isolated-fixture'); db.prepare('INSERT INTO security_adjustment_factor_cache VALUES(?,?,1)').run('600001.SH', date) }
    db.prepare('INSERT INTO short_term_signals VALUES(1,?,?,?,?,?)').run('fixture', '600001.SH', '20260601', 1, null)
  })
  afterEach(() => db.close())
  it('runs, saves, catalogs and reloads the exact report through actual SQLite', () => {
    const request = capitalRequest(), report = runCapitalSimulation(db, request, now)
    expect(report.finalCash).toBe('12000.00'); expect(getCapitalReport(db, request.id)).toEqual(report)
    expect(capitalCatalog(db).sources[0].value).toBe('short-term:fixture'); expect(capitalCatalog(db).runs[0].id).toBe(request.id)
  })
  it('does not silently rerun a request after market facts change', () => {
    const request = capitalRequest(), original = runCapitalSimulation(db, request, now)
    db.prepare('UPDATE daily_close_cache SET close=13,open=13,high=14,low=12 WHERE trade_date>=?').run('20260603')
    expect(runCapitalSimulation(db, request, now)).toEqual(original)
    const fresh = runCapitalSimulation(db, { ...request, id: randomUUID() }, now)
    expect(fresh.factsFingerprint).not.toBe(original.factsFingerprint); expect(fresh.finalCash).toBe('13000.00')
    expect(() => runCapitalSimulation(db, { ...request, plan: { ...request.plan, holdDays: 2 } }, now)).toThrow('REQUEST_CONFLICT')
  })
  it('requires every natural calendar date, not just a convenient set of market bars', () => {
    db.prepare('DELETE FROM trade_cal WHERE cal_date=?').run('20260604'); expect(() => runCapitalSimulation(db, capitalRequest(), now)).toThrow('CALENDAR_INCOMPLETE')
    expect(db.prepare('SELECT COUNT(*) AS n FROM rf_capital_runs').get()).toEqual({ n: 0 })
  })
  it('uses the immutable laboratory run, not the latest edited strategy definition', () => {
    db.exec("INSERT INTO strategy_lab_runs VALUES(1,'lab-fixture','completed'); INSERT INTO strategy_lab_matches VALUES(1,1,'600001.SH','20260601',1,90,NULL)")
    expect(runCapitalSimulation(db, { ...capitalRequest(), source: { kind: 'lab', runId: 1 } }, now).finalCash).toBe('12000.00')
  })
  it('binds ledger funding to the declared opening date and revision', () => {
    const account = createLedgerAccount(db, { accountId: randomUUID(), label: 'fixture-opening', openingCash: '10000', openingAt: Date.parse('2026-06-01T00:00:00+08:00'), openingPositions: [], openingPositionsComplete: true, cashConfirmed: true }, now).account
    const request = { ...capitalRequest(), funding: { kind: 'ledger-opening' as const, accountId: account.id, revision: 0 } }
    expect(runCapitalSimulation(db, request, now).fundingEvidence).toMatchObject({ accountId: account.id, revision: 0 })
    expect(() => runCapitalSimulation(db, { ...request, id: randomUUID(), dateStart: '2026-06-02' }, now)).toThrow('OPENING_DATE_MISMATCH')
    expect(() => runCapitalSimulation(db, { ...request, id: randomUUID(), funding: { ...request.funding, revision: 1 } }, now)).toThrow('ACCOUNT_CONFLICT')
  })
  it('rejects incomplete opening holdings and future windows', () => {
    const account = createLedgerAccount(db, { accountId: randomUUID(), label: 'unknown-opening', openingCash: '10000', openingAt: Date.parse('2026-06-01T00:00:00+08:00'), openingPositions: [], openingPositionsComplete: false, cashConfirmed: true }, now).account
    expect(() => runCapitalSimulation(db, { ...capitalRequest(), funding: { kind: 'ledger-opening', accountId: account.id, revision: 0 } }, now)).toThrow('OPENING_INCOMPLETE')
    expect(() => runCapitalSimulation(db, { ...capitalRequest(), dateEnd: '2027-01-01' }, now)).toThrow('INVALID_INPUT')
  })
  it('rejects corrupted saved reports and never publishes storage details', () => {
    const request = capitalRequest(); runCapitalSimulation(db, request, now); db.prepare('UPDATE rf_capital_runs SET report_json=? WHERE id=?').run('{}', request.id)
    expect(() => getCapitalReport(db, request.id)).toThrow('STORAGE_UNAVAILABLE')
  })
  it('a failed write leaves no half-saved report', () => {
    capitalCatalog(db); db.exec("CREATE TRIGGER reject_capital BEFORE INSERT ON rf_capital_runs BEGIN SELECT RAISE(ABORT,'isolated'); END")
    expect(() => runCapitalSimulation(db, capitalRequest(), now)).toThrow()
    expect(db.prepare('SELECT COUNT(*) AS n FROM rf_capital_runs').get()).toEqual({ n: 0 })
  })
})
