import type Database from 'better-sqlite3'
import type { CapitalBar, CapitalRequest, CapitalSignal } from '../../../shared/capitalSimulation'
import { CapitalError } from './capitalSimulationError'
import { toSuffixedTsCode } from './signalSources'

export interface CalendarFact { cal_date: string; is_open: number }
export interface SignalFact { id: number; ts_code: string; trade_date: string; strength: number | null; meta?: string | null }
export interface BarFact { ts_code: string; trade_date: string; open: number | null; high: number | null; low: number | null; close: number; vol: number | null; adj_factor: number | null; data_source: string; factor_source: string | null }
export interface CapitalMarketFacts { calendar: CalendarFact[]; rows: SignalFact[]; barRows: BarFact[] }
const compact = (s: string) => s.replace(/-/g, '')
const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
const symbol = (r: SignalFact) => toSuffixedTsCode(r.ts_code) ?? String(r.ts_code ?? '')
export function validateCapitalCalendar(rows: CalendarFact[], start: string, end: string): void {
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1
  if (rows.length !== days || rows.some((r, i) => r.cal_date !== compact(new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10)) || ![0, 1].includes(r.is_open)) || !rows.some(r => r.is_open === 1)) throw new CapitalError('CALENDAR_INCOMPLETE')
}
export function readCapitalMarketFacts(db: Database.Database, request: CapitalRequest, openingSymbols: string[] = []): CapitalMarketFacts {
  const calendar = db.prepare('SELECT cal_date,is_open FROM trade_cal WHERE cal_date BETWEEN ? AND ? ORDER BY cal_date').all(compact(request.dateStart), compact(request.dateEnd)) as CalendarFact[]
  validateCapitalCalendar(calendar, request.dateStart, request.dateEnd)
  let rows: SignalFact[]
  if (request.source.kind === 'short-term') rows = db.prepare('SELECT id,ts_code,trade_date,signal_strength AS strength,signal_meta AS meta FROM short_term_signals WHERE strategy=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date,id LIMIT 5001').all(request.source.key, compact(request.dateStart), compact(request.dateEnd)) as SignalFact[]
  else {
    if (!db.prepare("SELECT id FROM strategy_lab_runs WHERE id=? AND status='completed'").get(request.source.runId)) throw new CapitalError('NOT_FOUND')
    rows = db.prepare('SELECT id,ts_code,trade_date,COALESCE(signal_strength,score) AS strength,action_json AS meta FROM strategy_lab_matches WHERE run_id=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date,id LIMIT 5001').all(request.source.runId, compact(request.dateStart), compact(request.dateEnd)) as SignalFact[]
  }
  if (rows.length > 5000) throw new CapitalError('FACT_LIMIT')
  const symbols = [...new Set([...rows.map(symbol), ...openingSymbols])].sort()
  if (symbols.length > 250) throw new CapitalError('FACT_LIMIT')
  // Older cache schemas have no origin column: retain unknown, never invent provenance.
  const factorColumns = symbols.length ? db.pragma('table_info(security_adjustment_factor_cache)') as Array<{ name: string }> : []
  const factorSource = factorColumns.some(c => c.name === 'source') ? 'a.source' : 'NULL'
  const barRows = symbols.length ? db.prepare(`SELECT d.ts_code,d.trade_date,d.open,d.high,d.low,d.close,d.vol,d.data_source,a.adj_factor,${factorSource} AS factor_source FROM daily_close_cache d LEFT JOIN security_adjustment_factor_cache a ON a.ts_code=d.ts_code AND a.trade_date=d.trade_date WHERE d.ts_code IN (${symbols.map(() => '?').join(',')}) AND d.trade_date BETWEEN ? AND ? ORDER BY d.trade_date,d.ts_code LIMIT 300001`).all(...symbols, compact(request.dateStart), compact(request.dateEnd)) as BarFact[] : []
  if (barRows.length > 300000) throw new CapitalError('FACT_LIMIT')
  return { calendar, rows, barRows }
}
export function windowCapitalFacts(facts: CapitalMarketFacts, request: CapitalRequest): CapitalMarketFacts {
  const start = compact(request.dateStart), end = compact(request.dateEnd)
  const rows = facts.rows.filter(r => r.trade_date >= start && r.trade_date <= end), symbols = new Set(rows.map(symbol))
  const calendar = facts.calendar.filter(r => r.cal_date >= start && r.cal_date <= end)
  validateCapitalCalendar(calendar, request.dateStart, request.dateEnd)
  return { calendar, rows, barRows: facts.barRows.filter(r => symbols.has(r.ts_code) && r.trade_date >= start && r.trade_date <= end) }
}
export function projectCapitalFacts(facts: CapitalMarketFacts, request: CapitalRequest) {
  const signals: CapitalSignal[] = facts.rows.map(r => {
    let direction: string | null = null
    if (r.meta) { try { const meta = JSON.parse(r.meta); direction = typeof meta?.direction === 'string' ? meta.direction : null } catch { /* unavailable, not broker proof */ } }
    return { id: `${request.source.kind}:${r.id}`, symbol: symbol(r), date: iso(r.trade_date), strength: Number.isFinite(r.strength) ? r.strength! : 0, direction }
  })
  const bars: CapitalBar[] = facts.barRows.map(r => ({ symbol: r.ts_code, date: iso(r.trade_date), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.vol, factor: r.adj_factor, source: r.data_source ?? 'unknown' }))
  return { days: facts.calendar.filter(r => r.is_open === 1).map(r => iso(r.cal_date)), signals, bars }
}
