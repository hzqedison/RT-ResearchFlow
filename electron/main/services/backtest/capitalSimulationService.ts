import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getAccountLedger, listLedgerAccounts } from '../../database/accountLedgerRepository'
import { toSuffixedTsCode } from './signalSources'
import { simulateCapital } from './capitalSimulationEngine'
import { decodeCapitalRequest, type CapitalBar, type CapitalCatalog, type CapitalCode, type CapitalOpening, type CapitalReport, type CapitalRequest, type CapitalSignal } from '../../../shared/capitalSimulation'

export class CapitalError extends Error { constructor(readonly code: CapitalCode) { super(code) } }
function fail(code: CapitalCode): never { throw new CapitalError(code) }
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const compact = (s: string) => s.replace(/-/g, '')
const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
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
export function runCapitalSimulation(db: Database.Database, value: CapitalRequest, now = Date.now()): CapitalReport {
  const request = decodeCapitalRequest(value); if (!request) fail('INVALID_INPUT')
  const bj = new Date(now + 8 * 3600000), today = bj.toISOString().slice(0, 10)
  if (request.dateEnd > today || request.dateEnd === today && bj.getUTCHours() < 18) fail('INVALID_INPUT')
  schema(db)
  return db.transaction(() => {
    const existing = db.prepare('SELECT request_digest FROM rf_capital_runs WHERE id=?').get(request.id) as { request_digest: string } | undefined
    if (existing) { if (existing.request_digest !== hash(request)) fail('REQUEST_CONFLICT'); return getCapitalReport(db, request.id) }
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
    const calendar = db.prepare('SELECT cal_date,is_open FROM trade_cal WHERE cal_date BETWEEN ? AND ? ORDER BY cal_date').all(compact(request.dateStart), compact(request.dateEnd)) as Array<{ cal_date: string; is_open: number }>
    const naturalDays = (Date.parse(request.dateEnd) - Date.parse(request.dateStart)) / 86400000 + 1
    if (calendar.length !== naturalDays || calendar.some((r, i) => r.cal_date !== compact(new Date(Date.parse(request.dateStart) + i * 86400000).toISOString().slice(0, 10)) || ![0, 1].includes(r.is_open))) fail('CALENDAR_INCOMPLETE')
    const days = calendar.filter(r => r.is_open === 1).map(r => iso(r.cal_date)); if (!days.length) fail('CALENDAR_INCOMPLETE')
    type Row = { id: number; ts_code: string; trade_date: string; strength: number | null; meta?: string | null }
    let rows: Row[]
    if (request.source.kind === 'short-term') rows = db.prepare('SELECT id,ts_code,trade_date,signal_strength AS strength,signal_meta AS meta FROM short_term_signals WHERE strategy=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date,id LIMIT 5001').all(request.source.key, compact(request.dateStart), compact(request.dateEnd)) as Row[]
    else {
      if (!(db.prepare('SELECT id FROM strategy_lab_runs WHERE id=? AND status=\'completed\'').get(request.source.runId))) fail('NOT_FOUND')
      rows = db.prepare('SELECT id,ts_code,trade_date,COALESCE(signal_strength,score) AS strength,action_json AS meta FROM strategy_lab_matches WHERE run_id=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date,id LIMIT 5001').all(request.source.runId, compact(request.dateStart), compact(request.dateEnd)) as Row[]
    }
    if (rows.length > 5000) fail('FACT_LIMIT')
    const signals: CapitalSignal[] = rows.map(r => {
      let direction: string | null = null
      if (r.meta) { try { const meta = JSON.parse(r.meta); direction = typeof meta?.direction === 'string' ? meta.direction : null } catch { /* unavailable, not broker proof */ } }
      return { id: `${request.source.kind}:${r.id}`, symbol: toSuffixedTsCode(r.ts_code) ?? String(r.ts_code ?? ''), date: iso(r.trade_date), strength: Number.isFinite(r.strength) ? r.strength! : 0, direction }
    })
    const symbols = [...new Set([...signals.map(s => s.symbol), ...opening.positions.map(p => p.symbol)])].sort(); if (symbols.length > 250) fail('FACT_LIMIT')
    type BarRow = { ts_code: string; trade_date: string; open: number | null; high: number | null; low: number | null; close: number; vol: number | null; adj_factor: number | null; data_source: string }
    const barRows = symbols.length ? db.prepare(`SELECT d.ts_code,d.trade_date,d.open,d.high,d.low,d.close,d.vol,d.data_source,a.adj_factor FROM daily_close_cache d LEFT JOIN security_adjustment_factor_cache a ON a.ts_code=d.ts_code AND a.trade_date=d.trade_date WHERE d.ts_code IN (${symbols.map(() => '?').join(',')}) AND d.trade_date BETWEEN ? AND ? ORDER BY d.trade_date,d.ts_code LIMIT 300001`).all(...symbols, compact(request.dateStart), compact(request.dateEnd)) as BarRow[] : []
    if (barRows.length > 300000) fail('FACT_LIMIT')
    const bars: CapitalBar[] = barRows.map(r => ({ symbol: r.ts_code, date: iso(r.trade_date), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.vol, factor: r.adj_factor, source: r.data_source ?? 'unknown' }))
    const fingerprint = hash({ opening, calendar, rows, barRows })
    const report = simulateCapital({ request, opening, days, signals, bars, fingerprint, now })
    const json = JSON.stringify(report); if (Buffer.byteLength(json) > 5 * 1024 * 1024) fail('FACT_LIMIT')
    db.prepare('INSERT INTO rf_capital_runs(id,request_json,request_digest,report_json,digest,created_at) VALUES(?,?,?,?,?,?)').run(request.id, JSON.stringify(request), hash(request), json, hash(report), now)
    return report
  })()
}
