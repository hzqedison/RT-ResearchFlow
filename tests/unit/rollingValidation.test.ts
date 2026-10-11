import { describe, expect, it } from 'vitest'
import { decodeValidationRequest, type ValidationScore, type ValidationStudy } from '../../electron/shared/rollingValidation'
import { chooseTraining, rollingWindows, scoreValidationReport, validationSummary } from '../../electron/main/services/backtest/rollingValidationEngine'
import { advanceValidationStudy, getValidationStudy, listValidationStudies, prepareValidationStudy } from '../../electron/main/services/backtest/rollingValidationService'
import { getCapitalReport, runCapitalSimulation } from '../../electron/main/services/backtest/capitalSimulationService'
import { validationDatabase, validationNow, validationRequest } from '../fixtures/rollingValidationFixture'
const score = (gain: number, dd = 1, entries = 5): ValidationScore => ({ reportId: 'fixture', digest: 'a'.repeat(64), factsFingerprint: 'b'.repeat(64), usable: true, returnPct: gain, drawdownPct: dd, entries, issues: [], openPositions: 0 })
describe('fixed rolling protocol', () => {
  it('uses market days, embargo and non-overlapping test windows', () => {
    const r = validationRequest(), days = Array.from({ length: 12 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`)
    expect(rollingWindows(days, r)).toEqual([{ trainStart: days[0], trainEnd: days[3], testStart: days[6], testEnd: days[7] }, { trainStart: days[2], trainEnd: days[5], testStart: days[8], testEnd: days[9] }])
    expect(rollingWindows(days.slice(0, 9), r)).toBeNull(); expect(rollingWindows([...days].reverse(), r)).toBeNull()
  })
  it('selects only eligible training returns with deterministic ties', () => {
    const r = validationRequest()
    expect(chooseTraining([score(5), score(6)], r)).toBe(1)
    expect(chooseTraining([score(6, 2), score(6, 1)], r)).toBe(1)
    expect(chooseTraining([score(6), score(6)], r)).toBe(0)
    expect(chooseTraining([score(90, 41), score(6, 1, 0)], r)).toBeNull()
  })
  it.each(['foldCount', 'trainDays', 'testDays', 'embargoDays', 'minEntries'])('rejects invalid integer %s', key => {
    expect(decodeValidationRequest({ ...validationRequest(), [key]: 0 })).toBeNull()
  })
  it('rejects duplicate/oversize candidates, short embargo and missing consent', () => {
    const r = validationRequest()
    for (const extra of [{ holdDays: [1, 1] }, { holdDays: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, { embargoDays: 1 }, { confirmation: false }]) expect(decodeValidationRequest({ ...r, ...extra })).toBeNull()
  })
  it('rejects extraneous fields, accessors and current ledger money', () => {
    const r = validationRequest(), v = { ...r }; let called = false
    Object.defineProperty(v, 'trainDays', { enumerable: true, get: () => { called = true; return 4 } })
    expect(decodeValidationRequest(v)).toBeNull(); expect(called).toBe(false)
    expect(decodeValidationRequest({ ...r, extra: 1 })).toBeNull()
    expect(decodeValidationRequest({ ...r, capital: { ...r.capital, funding: { kind: 'ledger-opening', accountId: r.capital.id, revision: 1 } } })).toBeNull()
  })
  it('includes test losses and large test drawdown, excludes missing observations rather than zero', () => {
    const r = validationRequest(), study = { folds: [
      { selected: 0, candidates: [{ result: score(20) }], test: score(-10, 60) },
      { selected: 0, candidates: [{ result: score(30) }], test: score(10, 5) },
      { selected: 0, candidates: [{ result: score(40) }], test: { ...score(0), usable: false, returnPct: null } },
    ], request: r } as unknown as ValidationStudy
    const summary = validationSummary(study)
    expect(summary.meanTest).toBe(0); expect(summary.meanTrain).toBe(25); expect(summary.degradation).toBe(-25)
    expect(summary.worstDrawdown).toBe(60); expect(summary.usable).toBe(2); expect(summary.observed).toBe(3)
  })
})
describe('real SQLite rolling steps', () => {
  it('persists protocol before any report and is idempotent', () => {
    const db = validationDatabase()
    try {
      const r = validationRequest(), first = prepareValidationStudy(db, r, validationNow)
      expect(prepareValidationStudy(db, r, validationNow + 1)).toEqual(first)
      expect(listValidationStudies(db)[0].reportsCompleted).toBe(0); expect(first.unusedMarketDays).toBe(2)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='rf_capital_runs'").get()).toBeUndefined()
      expect(() => prepareValidationStudy(db, { ...r, testDays: 3 }, validationNow)).toThrow('REQUEST_CONFLICT')
    } finally { db.close() }
  })
  it('runs one report per step and commits selection in a separate step before test', () => {
    const db = validationDatabase()
    try {
      const r = validationRequest(); prepareValidationStudy(db, r, validationNow)
      const first = advanceValidationStudy(db, r.capital.id, validationNow + 1)
      expect(first.reportsCompleted).toBe(1); expect(first.folds[0].selected).toBeNull()
      const second = advanceValidationStudy(db, r.capital.id, validationNow + 2)
      expect(second.reportsCompleted).toBe(2)
      const choice = advanceValidationStudy(db, r.capital.id, validationNow + 3)
      expect(choice.reportsCompleted).toBe(2); expect(choice.folds[0].selectedAt).toBe(validationNow + 3); expect(choice.folds[0].test).toBeNull()
      const test = advanceValidationStudy(db, r.capital.id, validationNow + 4)
      expect(test.reportsCompleted).toBe(3); expect(test.folds[0].test?.usable).toBe(true)
      let final = test
      for (let i = 5; final.status === 'running' && i < 20; i++) final = advanceValidationStudy(db, r.capital.id, validationNow + i)
      expect(final.status).toBe('completed'); expect(final.reportsCompleted).toBe(6)
      expect(getValidationStudy(db, r.capital.id)).toEqual(final)
      expect(advanceValidationStudy(db, r.capital.id, validationNow + 100)).toEqual(final)
    } finally { db.close() }
  })
  it('blocks rather than relaxing predeclared training quality', () => {
    const db = validationDatabase()
    try {
      const r = { ...validationRequest(), minEntries: 1000 }; prepareValidationStudy(db, r, validationNow)
      advanceValidationStudy(db, r.capital.id, validationNow + 1); advanceValidationStudy(db, r.capital.id, validationNow + 2)
      const blocked = advanceValidationStudy(db, r.capital.id, validationNow + 3)
      expect(blocked.status).toBe('blocked'); expect(blocked.folds.every(f => f.test === null)).toBe(true)
    } finally { db.close() }
  })
  it('rejects market calendar changes without rewriting saved progress', () => {
    const db = validationDatabase()
    try {
      const r = validationRequest(), original = prepareValidationStudy(db, r, validationNow)
      db.prepare("UPDATE trade_cal SET is_open=0 WHERE cal_date='20260602'").run()
      expect(() => advanceValidationStudy(db, r.capital.id, validationNow + 1)).toThrow('CALENDAR_CHANGED')
      expect(getValidationStudy(db, r.capital.id)).toEqual(original)
    } finally { db.close() }
  })
  it('rejects incomplete calendars and insufficient market days', () => {
    const db = validationDatabase()
    try {
      const r = validationRequest()
      expect(() => prepareValidationStudy(db, { ...r, foldCount: 4 }, validationNow)).toThrow('INSUFFICIENT_DAYS')
      db.prepare("DELETE FROM trade_cal WHERE cal_date='20260602'").run()
      expect(() => prepareValidationStudy(db, r, validationNow)).toThrow('CALENDAR_INCOMPLETE')
    } finally { db.close() }
  })
  it('rejects an OOS report created before the committed training choice', () => {
    const db = validationDatabase()
    try {
      const r = validationRequest(), prepared = prepareValidationStudy(db, r, validationNow), fold = prepared.folds[0]
      runCapitalSimulation(db, { ...r.capital, id: fold.testId, dateStart: fold.testStart, dateEnd: fold.testEnd, plan: { ...r.capital.plan, holdDays: 2 } }, validationNow + 1)
      advanceValidationStudy(db, r.capital.id, validationNow + 2); advanceValidationStudy(db, r.capital.id, validationNow + 3)
      const choice = advanceValidationStudy(db, r.capital.id, validationNow + 4)
      expect(choice.folds[0].candidates[choice.folds[0].selected!].holdDays).toBe(2)
      expect(() => advanceValidationStudy(db, r.capital.id, validationNow + 5)).toThrow('REPORT_CONFLICT')
      expect(getValidationStudy(db, r.capital.id).reportsCompleted).toBe(2)
    } finally { db.close() }
  })
  it('rolls back new capital reports if progress persistence fails', () => {
    const db = validationDatabase()
    try {
      const r = validationRequest(); prepareValidationStudy(db, r, validationNow)
      expect(() => getCapitalReport(db, '20000000-0000-4000-8000-000000000001')).toThrow('NOT_FOUND')
      db.exec("CREATE TRIGGER refuse_validation BEFORE UPDATE ON rf_validation_studies BEGIN SELECT RAISE(ABORT,'fixture refusal'); END")
      expect(() => advanceValidationStudy(db, r.capital.id, validationNow + 1)).toThrow('fixture refusal')
      expect(getValidationStudy(db, r.capital.id).reportsCompleted).toBe(0)
      expect((db.prepare('SELECT COUNT(*) AS n FROM rf_capital_runs').get() as { n: number }).n).toBe(0)
    } finally { db.close() }
  })
  it('does not overwrite an underlying report with conflicting parameters', () => {
    const db = validationDatabase()
    try {
      const r = validationRequest(), prepared = prepareValidationStudy(db, r, validationNow), fold = prepared.folds[0]
      runCapitalSimulation(db, { ...r.capital, id: fold.candidates[0].id, dateStart: fold.trainStart, dateEnd: fold.trainEnd, plan: { ...r.capital.plan, feeBps: 7 } }, validationNow + 1)
      expect(() => advanceValidationStudy(db, r.capital.id, validationNow + 2)).toThrow('REPORT_CONFLICT')
      expect(getCapitalReport(db, fold.candidates[0].id).request.plan.feeBps).toBe(7)
    } finally { db.close() }
  })
  it('rejects corrupted saved study and future periods', () => {
    const db = validationDatabase()
    try {
      const r = validationRequest(); prepareValidationStudy(db, r, validationNow)
      db.prepare('UPDATE rf_validation_studies SET digest=? WHERE id=?').run('invalid', r.capital.id)
      expect(() => getValidationStudy(db, r.capital.id)).toThrow('STORAGE_UNAVAILABLE')
      expect(() => prepareValidationStudy(db, { ...r, capital: { ...r.capital, dateEnd: '2027-06-12' } }, validationNow)).toThrow('INVALID_INPUT')
    } finally { db.close() }
  })
  it('keeps no-observation scores null instead of zero', () => {
    const db = validationDatabase()
    try {
      db.prepare('DELETE FROM short_term_signals').run()
      const r = validationRequest(), report = runCapitalSimulation(db, r.capital, validationNow)
      const result = scoreValidationReport(report, 'a'.repeat(64))
      expect(result.usable).toBe(false); expect(result.returnPct).toBeNull(); expect(result.entries).toBe(0)
    } finally { db.close() }
  })
})
