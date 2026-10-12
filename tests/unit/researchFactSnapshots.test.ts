import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isResearchSnapshotReference } from '../../electron/shared/capitalSimulation'
import { hasFrozenValidationData, type ValidationStudy } from '../../electron/shared/rollingValidation'
import { advanceValidationStudy, getValidationStudy, prepareValidationStudy } from '../../electron/main/services/backtest/rollingValidationService'
import { getCapitalReport, runCapitalSimulation } from '../../electron/main/services/backtest/capitalSimulationService'
import { captureResearchSnapshot, getResearchSnapshot } from '../../electron/main/services/backtest/researchFactSnapshotStore'
import { validationDatabase, validationNow, validationRequest } from '../fixtures/rollingValidationFixture'
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
describe('shared immutable rolling research facts', () => {
  it('atomically captures once, before reports, with a content digest independent of study ID', () => {
    const db = validationDatabase()
    try {
      const request = validationRequest(), study = prepareValidationStudy(db, request, validationNow)
      expect(study.schema).toBe(2); expect(hasFrozenValidationData(study)).toBe(true)
      expect(study.marketSnapshot).toMatchObject({ id: study.id, createdAt: validationNow, signalCount: 12, barCount: 12 })
      expect(prepareValidationStudy(db, request, validationNow + 1)).toEqual(study)
      const second = prepareValidationStudy(db, { ...request, capital: { ...request.capital, id: randomUUID() } }, validationNow + 2)
      expect(second.marketSnapshot!.digest).toBe(study.marketSnapshot!.digest)
      expect((db.prepare('SELECT COUNT(*) AS n FROM rf_research_fact_snapshots').get() as { n: number }).n).toBe(2)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='rf_capital_runs'").get()).toBeUndefined()
      expect(() => captureResearchSnapshot(db, request.capital, validationNow + 3)).toThrow('SNAPSHOT_CONFLICT')
    } finally { db.close() }
  })
  it('uses the same signal, price, source and factor facts after live caches change or disappear', () => {
    const db = validationDatabase()
    try {
      const request = validationRequest(), study = prepareValidationStudy(db, request, validationNow)
      const first = advanceValidationStudy(db, study.id, validationNow + 1)
      const original = getCapitalReport(db, first.folds[0].candidates[0].id)
      db.exec('DELETE FROM short_term_signals; DELETE FROM daily_close_cache; DELETE FROM security_adjustment_factor_cache')
      let current = first
      for (let i = 2; current.status === 'running' && i < 20; i++) current = advanceValidationStudy(db, study.id, validationNow + i)
      expect(current.status).toBe('completed'); expect(current.reportsCompleted).toBe(6)
      const ids = current.folds.flatMap(f => [...f.candidates.map(c => c.id), f.testId])
      for (const id of ids) {
        const report = getCapitalReport(db, id)
        expect(report.marketSnapshot).toEqual(study.marketSnapshot)
        expect(report.decisions.some(d => d.outcome === 'entered')).toBe(true)
        expect(report.issues).toContain('SIGNAL_POINT_IN_TIME_UNVERIFIED')
      }
      expect(getCapitalReport(db, original.id)).toEqual(original)
      expect(getCapitalReport(db, current.folds[0].candidates[1].id).factsFingerprint).toBe(original.factsFingerprint)
    } finally { db.close() }
  })
  it('captures explicit new cache revisions only in a new protocol', () => {
    const db = validationDatabase()
    try {
      const request = validationRequest(), first = prepareValidationStudy(db, request, validationNow)
      const bytes = db.prepare('SELECT body_json FROM rf_research_fact_snapshots WHERE id=?').get(first.id)
      db.exec("UPDATE daily_close_cache SET open=open+1,high=high+1,low=low+1,close=close+1,data_source='new-revision'; UPDATE security_adjustment_factor_cache SET adj_factor=2")
      const second = prepareValidationStudy(db, { ...request, capital: { ...request.capital, id: randomUUID() } }, validationNow + 1)
      expect(second.marketSnapshot!.digest).not.toBe(first.marketSnapshot!.digest)
      expect(db.prepare('SELECT body_json FROM rf_research_fact_snapshots WHERE id=?').get(first.id)).toEqual(bytes)
      expect(getResearchSnapshot(db, first.marketSnapshot!).facts.barRows[0].data_source).toBe('synthetic-fixture')
    } finally { db.close() }
  })
  it('freezes adjustment provenance and preserves unknown origins on older cache schemas', () => {
    const db = validationDatabase()
    try {
      const request = validationRequest(), unknown = prepareValidationStudy(db, request, validationNow)
      expect(getResearchSnapshot(db, unknown.marketSnapshot!).facts.barRows[0].factor_source).toBeNull()
      db.exec("ALTER TABLE security_adjustment_factor_cache ADD COLUMN source TEXT; UPDATE security_adjustment_factor_cache SET source='original-factor-source'")
      const original = prepareValidationStudy(db, { ...request, capital: { ...request.capital, id: randomUUID() } }, validationNow + 1)
      db.exec("UPDATE security_adjustment_factor_cache SET source='revised-factor-source'")
      const revised = prepareValidationStudy(db, { ...request, capital: { ...request.capital, id: randomUUID() } }, validationNow + 2)
      expect(revised.marketSnapshot!.digest).not.toBe(original.marketSnapshot!.digest)
      expect(getResearchSnapshot(db, original.marketSnapshot!).facts.barRows[0].factor_source).toBe('original-factor-source')
      expect(getResearchSnapshot(db, unknown.marketSnapshot!).facts.barRows[0].factor_source).toBeNull()
    } finally { db.close() }
  })
  it.each(['deleted', 'corrupt-body', 'corrupt-digest', 'corrupt-time'] as const)('stops on %s without replacing facts or changing saved progress', kind => {
    const db = validationDatabase()
    try {
      const request = validationRequest(); prepareValidationStudy(db, request, validationNow)
      const first = advanceValidationStudy(db, request.capital.id, validationNow + 1), saved = getCapitalReport(db, first.folds[0].candidates[0].id)
      if (kind === 'deleted') db.prepare('DELETE FROM rf_research_fact_snapshots WHERE id=?').run(first.id)
      else if (kind === 'corrupt-body') db.prepare('UPDATE rf_research_fact_snapshots SET body_json=? WHERE id=?').run('{}', first.id)
      else if (kind === 'corrupt-digest') db.prepare('UPDATE rf_research_fact_snapshots SET digest=? WHERE id=?').run('0'.repeat(64), first.id)
      else db.prepare('UPDATE rf_research_fact_snapshots SET created_at=created_at+1 WHERE id=?').run(first.id)
      expect(() => advanceValidationStudy(db, first.id, validationNow + 2)).toThrow('SNAPSHOT_UNAVAILABLE')
      expect(getValidationStudy(db, first.id)).toEqual(first); expect(getCapitalReport(db, saved.id)).toEqual(saved)
      expect((db.prepare('SELECT COUNT(*) AS n FROM rf_capital_runs').get() as { n: number }).n).toBe(1)
    } finally { db.close() }
  })
  it('keeps old protocols readable without retroactive snapshots or new reports', () => {
    const db = validationDatabase()
    try {
      const request = validationRequest(), prepared = prepareValidationStudy(db, request, validationNow)
      const { marketSnapshot: _snapshot, ...rest } = prepared, legacy: ValidationStudy = { ...rest, schema: 1 }
      db.prepare('UPDATE rf_validation_studies SET body_json=?,digest=? WHERE id=?').run(JSON.stringify(legacy), hash(legacy), legacy.id)
      db.prepare('DELETE FROM rf_research_fact_snapshots WHERE id=?').run(legacy.id)
      expect(getValidationStudy(db, legacy.id)).toEqual(legacy); expect(hasFrozenValidationData(legacy)).toBe(false)
      expect(() => advanceValidationStudy(db, legacy.id, validationNow + 1)).toThrow('SNAPSHOT_REQUIRED')
      expect(getValidationStudy(db, legacy.id)).toEqual(legacy)
      expect((db.prepare('SELECT COUNT(*) AS n FROM rf_research_fact_snapshots').get() as { n: number }).n).toBe(0)
    } finally { db.close() }
  })
  it('does not bind a legacy report or a different source/range to a frozen study', () => {
    const db = validationDatabase()
    try {
      const request = validationRequest(), study = prepareValidationStudy(db, request, validationNow), fold = study.folds[0]
      const reportRequest = { ...request.capital, id: fold.candidates[0].id, dateStart: fold.trainStart, dateEnd: fold.trainEnd }
      const old = runCapitalSimulation(db, reportRequest, validationNow + 1)
      expect(() => advanceValidationStudy(db, study.id, validationNow + 2)).toThrow('REPORT_CONFLICT')
      expect(getCapitalReport(db, old.id)).toEqual(old)
      expect(() => runCapitalSimulation(db, { ...reportRequest, id: randomUUID(), source: { kind: 'short-term', key: 'different' } }, validationNow + 3, study.marketSnapshot)).toThrow('SNAPSHOT_CONFLICT')
      expect(() => runCapitalSimulation(db, { ...reportRequest, id: randomUUID(), dateEnd: '2026-06-13' }, validationNow + 3, study.marketSnapshot)).toThrow('SNAPSHOT_CONFLICT')
    } finally { db.close() }
  })
  it('rolls back snapshot creation together with a refused protocol write', () => {
    const db = validationDatabase()
    try {
      const request = validationRequest(); prepareValidationStudy(db, request, validationNow)
      db.exec("CREATE TRIGGER refuse_new_study BEFORE INSERT ON rf_validation_studies BEGIN SELECT RAISE(ABORT,'snapshot fixture refusal'); END")
      expect(() => prepareValidationStudy(db, { ...request, capital: { ...request.capital, id: randomUUID() } }, validationNow + 1)).toThrow('snapshot fixture refusal')
      expect((db.prepare('SELECT COUNT(*) AS n FROM rf_research_fact_snapshots').get() as { n: number }).n).toBe(1)
      expect((db.prepare('SELECT COUNT(*) AS n FROM rf_validation_studies').get() as { n: number }).n).toBe(1)
    } finally { db.close() }
  })
  it('enforces snapshot-count capacity without deleting prior records', () => {
    const db = validationDatabase()
    try {
      const request = validationRequest(); prepareValidationStudy(db, request, validationNow)
      for (let i = 1; i < 100; i++) db.prepare('INSERT INTO rf_research_fact_snapshots VALUES(?,?,?,?)').run(randomUUID(), '{}', '0'.repeat(64), validationNow)
      expect(() => prepareValidationStudy(db, { ...request, capital: { ...request.capital, id: randomUUID() } }, validationNow + 1)).toThrow('CAPACITY_LIMIT')
      expect((db.prepare('SELECT COUNT(*) AS n FROM rf_research_fact_snapshots').get() as { n: number }).n).toBe(100)
      expect((db.prepare('SELECT COUNT(*) AS n FROM rf_validation_studies').get() as { n: number }).n).toBe(1)
    } finally { db.close() }
  })
  it('rejects malformed snapshot metadata before enabling continuation', () => {
    const db = validationDatabase()
    try {
      const study = prepareValidationStudy(db, validationRequest(), validationNow), ref = study.marketSnapshot!
      expect(isResearchSnapshotReference({ ...ref, extra: 1 })).toBe(false)
      expect(isResearchSnapshotReference({ ...ref, signalCount: -1 })).toBe(false)
      expect(hasFrozenValidationData({ ...study, marketSnapshot: { ...ref, id: randomUUID() } })).toBe(false)
      let called = false
      const getter = { ...ref }; Object.defineProperty(getter, 'digest', { enumerable: true, get: () => { called = true; return ref.digest } })
      expect(isResearchSnapshotReference(getter)).toBe(false); expect(called).toBe(false)
    } finally { db.close() }
  })
})
