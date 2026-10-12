import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getAccountLedger, listLedgerAccounts } from '../../database/accountLedgerRepository'
import { simulateCapital } from './capitalSimulationEngine'
import { decodeCapitalRequest, type CapitalCatalog, type CapitalCode, type CapitalOpening, type CapitalReport, type CapitalRequest, type ResearchSnapshotReference } from '../../../shared/capitalSimulation'
import { CapitalError } from './capitalSimulationError'
import { projectCapitalFacts, readCapitalMarketFacts } from './capitalMarketFacts'
import { researchWindowFacts, sameResearchSnapshot } from './researchFactSnapshotStore'

export { CapitalError } from './capitalSimulationError'
function fail(code: CapitalCode): never { throw new CapitalError(code) }
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
function schema(db: Database.Database) { db.exec('CREATE TABLE IF NOT EXISTS rf_capital_runs(id TEXT PRIMARY KEY,request_json TEXT NOT NULL,request_digest TEXT NOT NULL,report_json TEXT NOT NULL,digest TEXT NOT NULL,created_at INTEGER NOT NULL)') }
export function capitalCatalog(db: Database.Database): CapitalCatalog {
  schema(db)
  const short = db.prepare('SELECT strategy AS key,COUNT(*) AS count FROM short_term_signals GROUP BY strategy ORDER BY MAX(trade_date) DESC LIMIT 201').all() as Array<{ key: string; count: number }>
  const lab = db.prepare('SELECT r.id,r.strategy_name,COUNT(m.id) AS count FROM strategy_lab_runs r LEFT JOIN strategy_lab_matches m ON m.run_id=r.id WHERE r.status=\'completed\' GROUP BY r.id ORDER BY r.id DESC LIMIT 201').all() as Array<{ id: number; strategy_name: string; count: number }>
  const runs = db.prepare('SELECT id,created_at,request_json,report_json FROM rf_capital_runs ORDER BY created_at DESC LIMIT 100').all() as Array<{ id: string; created_at: number; request_json: string; report_json: string }>
  return { sources: [...short.slice(0, 200).map(r => ({ value: `short-term:${r.key}`, label: `短线 · ${r.key}`, count: r.count })), ...lab.slice(0, 200).map(r => ({ value: `lab:${r.id}`, label: `实验室 · ${r.strategy_name} · 批次 ${r.id}`, count: r.count }))],
    accounts: listLedgerAccounts(db), runs: runs.map(r => { const request = decodeCapitalRequest(JSON.parse(r.request_json)); if (!request) fail('STORAGE_UNAVAILABLE'); return { id: r.id, createdAt: r.created_at, sourceLabel: request.source.kind === 'lab' ? `实验室批次 ${request.source.runId}` : request.source.key, status: (JSON.parse(r.report_json) as CapitalReport).status } }), limited: short.length > 200 || lab.length > 200 || runs.length === 100 }
}
export function getCapitalReport(db: Database.Database, id: string): CapitalReport {
  schema(db)
  const row = db.prepare('SELECT report_json,digest FROM rf_capital_runs WHERE id=?').get(id) as { report_json: string; digest: string } | undefined
  if (!row) fail('NOT_FOUND')
  const report = JSON.parse(row.report_json) as CapitalReport
  if (hash(report) !== row.digest || report.id !== id || report.schema !== 1 || report.engine !== 'capital-calendar-cents-1') fail('STORAGE_UNAVAILABLE')
  return report
}
export function runCapitalSimulation(db: Database.Database, value: CapitalRequest, now = Date.now(), marketSnapshot?: ResearchSnapshotReference): CapitalReport {
  const request = decodeCapitalRequest(value); if (!request) fail('INVALID_INPUT')
  const bj = new Date(now + 8 * 3600000), today = bj.toISOString().slice(0, 10)
  if (request.dateEnd > today || request.dateEnd === today && bj.getUTCHours() < 18) fail('INVALID_INPUT')
  schema(db)
  return db.transaction(() => {
    const existing = db.prepare('SELECT request_digest FROM rf_capital_runs WHERE id=?').get(request.id) as { request_digest: string } | undefined
    if (existing) {
      if (existing.request_digest !== hash(request)) fail('REQUEST_CONFLICT')
      const saved = getCapitalReport(db, request.id)
      if (marketSnapshot && !sameResearchSnapshot(saved.marketSnapshot, marketSnapshot)) fail('SNAPSHOT_CONFLICT')
      return saved
    }
    if ((db.prepare('SELECT COUNT(*) AS n FROM rf_capital_runs').get() as { n: number }).n >= 500) fail('FACT_LIMIT')
    let opening: CapitalOpening
    if (request.funding.kind === 'manual') opening = { cash: request.funding.cash, positions: [], evidence: { kind: 'manual' } }
    else {
      const account = getAccountLedger(db, request.funding.accountId).account
      if (account.revision !== request.funding.revision) fail('ACCOUNT_CONFLICT')
      if (new Date(account.openingAt + 8 * 3600000).toISOString().slice(0, 10) !== request.dateStart) fail('OPENING_DATE_MISMATCH')
      if (!account.openingPositionsComplete) fail('OPENING_INCOMPLETE')
      opening = { cash: account.openingCash, positions: account.openingPositions.map(p => ({ symbol: p.symbol, quantity: p.quantity })), evidence: { kind: 'ledger-opening', accountId: account.id, revision: account.revision, asOf: account.openingAt } }
    }
    const facts = marketSnapshot ? researchWindowFacts(db, marketSnapshot, request) : readCapitalMarketFacts(db, request, opening.positions.map(p => p.symbol))
    const { calendar, rows, barRows } = facts, { days, signals, bars } = projectCapitalFacts(facts, request)
    const fingerprint = hash({ opening, calendar, rows, barRows })
    const report = simulateCapital({ request, opening, days, signals, bars, fingerprint, now })
    if (marketSnapshot) report.marketSnapshot = { ...marketSnapshot }
    const json = JSON.stringify(report); if (Buffer.byteLength(json) > 5 * 1024 * 1024) fail('FACT_LIMIT')
    db.prepare('INSERT INTO rf_capital_runs(id,request_json,request_digest,report_json,digest,created_at) VALUES(?,?,?,?,?,?)').run(request.id, JSON.stringify(request), hash(request), json, hash(report), now)
    return report
  })()
}
