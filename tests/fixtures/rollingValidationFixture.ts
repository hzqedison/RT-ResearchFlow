import Database from 'better-sqlite3'
import type { ValidationRequest } from '../../electron/shared/rollingValidation'
export const validationNow = Date.parse('2026-10-01T12:00:00Z')
export function validationRequest(): ValidationRequest {
  return { capital: { id: '10000000-0000-4000-8000-000000000001', source: { kind: 'short-term', key: 'isolated-rolling' }, dateStart: '2026-06-01', dateEnd: '2026-06-12', funding: { kind: 'manual', cash: '10000.00' },
    plan: { holdDays: 1, maxPositions: 1, maxPositionPct: 100, cashReservePct: 0, lotSize: 100, feeBps: 0, minimumFee: '0.00', slippageBps: 0, stopLossPct: null, stopProfitPct: null }, assumptionsConfirmed: true },
    trainDays: 4, testDays: 2, embargoDays: 2, foldCount: 2, holdDays: [1, 2], minEntries: 1, maxTrainingDrawdownPct: 40, confirmation: true }
}
export function validationDatabase() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE trade_cal(cal_date TEXT PRIMARY KEY,is_open INTEGER NOT NULL);
    CREATE TABLE short_term_signals(id INTEGER PRIMARY KEY,strategy TEXT,ts_code TEXT,trade_date TEXT,signal_strength REAL,signal_meta TEXT);
    CREATE TABLE daily_close_cache(ts_code TEXT,trade_date TEXT,open REAL,high REAL,low REAL,close REAL,vol REAL,data_source TEXT,PRIMARY KEY(ts_code,trade_date));
    CREATE TABLE security_adjustment_factor_cache(ts_code TEXT,trade_date TEXT,adj_factor REAL,PRIMARY KEY(ts_code,trade_date));`)
  for (let i = 1; i <= 12; i++) {
    const date = `202606${String(i).padStart(2, '0')}`, price = 10 + i
    db.prepare('INSERT INTO trade_cal VALUES(?,1)').run(date)
    db.prepare('INSERT INTO short_term_signals VALUES(?,?,?,?,1,NULL)').run(i, 'isolated-rolling', '600001.SH', date)
    db.prepare('INSERT INTO daily_close_cache VALUES(?,?,?,?,?, ?,1000,?)').run('600001.SH', date, price, price + 1, price - 1, price, 'synthetic-fixture')
    db.prepare('INSERT INTO security_adjustment_factor_cache VALUES(?,?,1)').run('600001.SH', date)
  }
  return db
}
