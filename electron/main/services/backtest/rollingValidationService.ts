import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { decodeCapitalRequest, type CapitalRequest, type CapitalReport, type ResearchSnapshotReference } from '../../../shared/capitalSimulation'
import { decodeValidationRequest, hasFrozenValidationData, type ValidationCode, type ValidationRequest, type ValidationStudy } from '../../../shared/rollingValidation'
import { CapitalError, getCapitalReport, runCapitalSimulation } from './capitalSimulationService'
import { chooseTraining, rollingWindows, scoreValidationReport } from './rollingValidationEngine'
import { captureResearchSnapshot, getResearchSnapshot, sameResearchSnapshot } from './researchFactSnapshotStore'
export class ValidationError extends Error { constructor(readonly code: ValidationCode) { super(code) } }
function fail(code: ValidationCode): never { throw new ValidationError(code) }
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const compact = (s: string) => s.replace(/-/g, '')
const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
function schema(db: Database.Database) { db.exec('CREATE TABLE IF NOT EXISTS rf_validation_studies(id TEXT PRIMARY KEY,body_json TEXT NOT NULL,digest TEXT NOT NULL,created_at INTEGER NOT NULL)') }
function calendar(db: Database.Database, request: ValidationRequest) {
  const { dateStart, dateEnd } = request.capital
  const rows = db.prepare('SELECT cal_date,is_open FROM trade_cal WHERE cal_date BETWEEN ? AND ? ORDER BY cal_date').all(compact(dateStart), compact(dateEnd)) as Array<{ cal_date: string; is_open: number }>
  const n = (Date.parse(dateEnd) - Date.parse(dateStart)) / 86400000 + 1
  if (rows.length !== n || rows.some((r, i) => r.cal_date !== compact(new Date(Date.parse(dateStart) + i * 86400000).toISOString().slice(0, 10)) || ![0, 1].includes(r.is_open))) fail('CALENDAR_INCOMPLETE')
  return { fingerprint: hash(rows), days: rows.filter(r => r.is_open === 1).map(r => iso(r.cal_date)) }
}
function save(db: Database.Database, study: ValidationStudy) {
  const json = JSON.stringify(study); if (Buffer.byteLength(json) > 512 * 1024) fail('CAPACITY_LIMIT')
  db.prepare('INSERT INTO rf_validation_studies(id,body_json,digest,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body_json=excluded.body_json,digest=excluded.digest').run(study.id, json, hash(study), study.createdAt)
}
export function getValidationStudy(db: Database.Database, id: string): ValidationStudy {
  schema(db)
  const row = db.prepare('SELECT body_json,digest FROM rf_validation_studies WHERE id=?').get(id) as { body_json: string; digest: string } | undefined
  if (!row) fail('NOT_FOUND')
  const study = JSON.parse(row.body_json) as ValidationStudy
  if (hash(study) !== row.digest || study.id !== id || ![1, 2].includes(study.schema) || !decodeValidationRequest(study.request)
    || study.schema === 2 && !hasFrozenValidationData(study)) fail('STORAGE_UNAVAILABLE')
  return study
}
export function listValidationStudies(db: Database.Database) {
  schema(db)
  return (db.prepare('SELECT id FROM rf_validation_studies ORDER BY created_at DESC LIMIT 100').all() as Array<{ id: string }>).map(r => {
    const study = getValidationStudy(db, r.id)
    return { id: study.id, createdAt: study.createdAt, status: study.status, reportsCompleted: study.reportsCompleted, reportsPlanned: study.reportsPlanned }
  })
}
export function prepareValidationStudy(db: Database.Database, value: ValidationRequest, now = Date.now()): ValidationStudy {
  const request = decodeValidationRequest(value); if (!request) fail('INVALID_INPUT')
  const bj = new Date(now + 8 * 3600000), today = bj.toISOString().slice(0, 10)
  if (request.capital.dateEnd > today || request.capital.dateEnd === today && bj.getUTCHours() < 18) fail('INVALID_INPUT')
  schema(db)
  return db.transaction(() => {
    if (db.prepare('SELECT id FROM rf_validation_studies WHERE id=?').get(request.capital.id)) {
      const old = getValidationStudy(db, request.capital.id); if (hash(old.request) !== hash(request)) fail('REQUEST_CONFLICT'); return old
    }
    if ((db.prepare('SELECT COUNT(*) AS n FROM rf_validation_studies').get() as { n: number }).n >= 100) fail('CAPACITY_LIMIT')
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rf_capital_runs'").get()
    const count = existing ? (db.prepare('SELECT COUNT(*) AS n FROM rf_capital_runs').get() as { n: number }).n : 0
    if (count + request.foldCount * (request.holdDays.length + 1) > 500) fail('CAPACITY_LIMIT')
    const cal = calendar(db, request), windows = rollingWindows(cal.days, request); if (!windows) fail('INSUFFICIENT_DAYS')
    let marketSnapshot: ResearchSnapshotReference
    try { marketSnapshot = captureResearchSnapshot(db, request.capital, now) } catch (error) {
      if (error instanceof CapitalError) fail(error.code === 'FACT_LIMIT' ? 'CAPACITY_LIMIT' : error.code === 'CALENDAR_INCOMPLETE' ? 'CALENDAR_INCOMPLETE' : error.code === 'SNAPSHOT_CONFLICT' ? 'SNAPSHOT_UNAVAILABLE' : 'INPUT_NOT_READY')
      throw error
    }
    const study: ValidationStudy = { schema: 2, id: request.capital.id, createdAt: now, request, calendarFingerprint: cal.fingerprint, marketSnapshot,
      status: 'running', blockedReason: null, unusedMarketDays: cal.days.length - request.trainDays - request.embargoDays - request.testDays * request.foldCount,
      reportsCompleted: 0, reportsPlanned: request.foldCount * (request.holdDays.length + 1),
      folds: windows.map(w => ({ ...w, candidates: request.holdDays.map(holdDays => ({ holdDays, id: randomUUID(), result: null })), testId: randomUUID(), selected: null, selectedAt: null, test: null })) }
    save(db, study); return study
  })()
}
function execute(db: Database.Database, expected: CapitalRequest, now: number, selectedAt: number | null, snapshot: ResearchSnapshotReference) {
  let report: CapitalReport
  try { report = runCapitalSimulation(db, expected, now, snapshot) } catch (e) {
    if (e instanceof CapitalError) fail(e.code === 'REQUEST_CONFLICT' || e.code === 'SNAPSHOT_CONFLICT' ? 'REPORT_CONFLICT' : e.code === 'SNAPSHOT_UNAVAILABLE' ? 'SNAPSHOT_UNAVAILABLE' : 'INPUT_NOT_READY')
    throw e
  }
  const request = decodeCapitalRequest(report.request)
  if (!request || hash(request) !== hash(decodeCapitalRequest(expected)) || !sameResearchSnapshot(report.marketSnapshot, snapshot) || selectedAt !== null && report.createdAt < selectedAt) fail('REPORT_CONFLICT')
  const proof = getCapitalReport(db, expected.id)
  return scoreValidationReport(proof, hash(proof))
}
export function advanceValidationStudy(db: Database.Database, id: string, now = Date.now()): ValidationStudy {
  schema(db)
  return db.transaction(() => {
    const study = getValidationStudy(db, id)
    if (study.status !== 'running') return study
    if (study.schema !== 2 || !study.marketSnapshot) fail('SNAPSHOT_REQUIRED')
    try {
      const snapshot = getResearchSnapshot(db, study.marketSnapshot)
      if (hash(snapshot.facts.calendar) !== study.calendarFingerprint || hash(snapshot.source) !== hash(study.request.capital.source)) fail('SNAPSHOT_UNAVAILABLE')
    } catch { fail('SNAPSHOT_UNAVAILABLE') }
    if (calendar(db, study.request).fingerprint !== study.calendarFingerprint) fail('CALENDAR_CHANGED')
    const fold = study.folds.find(f => f.test === null); if (!fold) fail('STORAGE_UNAVAILABLE')
    const base = study.request.capital, candidate = fold.candidates.find(c => c.result === null)
    if (candidate) {
      candidate.result = execute(db, { ...base, id: candidate.id, dateStart: fold.trainStart, dateEnd: fold.trainEnd, plan: { ...base.plan, holdDays: candidate.holdDays } }, now, null, study.marketSnapshot)
      study.reportsCompleted++
    } else if (fold.selected === null) {
      const selected = chooseTraining(fold.candidates.map(c => c.result!), study.request)
      if (selected === null) { study.status = 'blocked'; study.blockedReason = '训练样本、回撤或数据质量未达到预先设定门槛，没有擅自放宽条件。' }
      else { fold.selected = selected; fold.selectedAt = now }
      // Commit the training choice in this call. Never evaluate test outcomes while choosing.
    } else {
      if (fold.selectedAt === null || now < fold.selectedAt) fail('REPORT_CONFLICT')
      fold.test = execute(db, { ...base, id: fold.testId, dateStart: fold.testStart, dateEnd: fold.testEnd, plan: { ...base.plan, holdDays: fold.candidates[fold.selected].holdDays } }, now, fold.selectedAt, study.marketSnapshot)
      study.reportsCompleted++
      if (study.folds.every(f => f.test !== null)) study.status = 'completed'
    }
    save(db, study); return study
  })()
}
