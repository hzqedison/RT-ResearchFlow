import type { CapitalReport } from '../../../shared/capitalSimulation'
import type { ValidationRequest, ValidationScore, ValidationStudy } from '../../../shared/rollingValidation'
export function rollingWindows(days: string[], r: ValidationRequest) {
  const required = r.trainDays + r.embargoDays + r.testDays * r.foldCount
  if (days.length < required || days.some((d, i) => i > 0 && d <= days[i - 1])) return null
  return Array.from({ length: r.foldCount }, (_, i) => {
    const start = i * r.testDays, test = start + r.trainDays + r.embargoDays
    return { trainStart: days[start], trainEnd: days[start + r.trainDays - 1], testStart: days[test], testEnd: days[test + r.testDays - 1] }
  })
}
export function scoreValidationReport(report: CapitalReport, digest: string): ValidationScore {
  const entries = report.decisions.filter(d => d.outcome === 'entered').length
  const usable = report.status !== 'blocked' && entries > 0 && report.initialEquity !== null && report.finalEquity !== null
    && report.totalReturnPct !== null && Number.isFinite(report.totalReturnPct) && report.maxDrawdownPct !== null && Number.isFinite(report.maxDrawdownPct)
  return { reportId: report.id, digest, factsFingerprint: report.factsFingerprint, usable,
    returnPct: usable ? report.totalReturnPct : null, drawdownPct: usable ? report.maxDrawdownPct : null, entries,
    issues: [...report.issues], openPositions: report.openPositions.length }
}
export function chooseTraining(scores: ValidationScore[], r: ValidationRequest): number | null {
  const ranked = scores.map((s, i) => ({ s, i })).filter(({ s }) => s.usable && s.entries >= r.minEntries && s.drawdownPct! <= r.maxTrainingDrawdownPct)
  ranked.sort((a, b) => b.s.returnPct! - a.s.returnPct! || a.s.drawdownPct! - b.s.drawdownPct! || a.i - b.i)
  return ranked[0]?.i ?? null
}
export function validationSummary(study: ValidationStudy) {
  const tests = study.folds.flatMap(f => f.test?.usable ? [f.test] : [])
  const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  const train = study.folds.flatMap(f => f.test?.usable && f.selected !== null && f.candidates[f.selected].result?.usable ? [f.candidates[f.selected].result!.returnPct!] : [])
  const meanTest = average(tests.map(t => t.returnPct!)), meanTrain = average(train)
  return { observed: study.folds.filter(f => f.test !== null).length, usable: tests.length, meanTest, meanTrain,
    degradation: meanTest === null || meanTrain === null ? null : meanTest - meanTrain,
    positiveRatio: tests.length ? tests.filter(t => t.returnPct! > 0).length / tests.length * 100 : null,
    worstDrawdown: tests.length ? Math.max(...tests.map(t => t.drawdownPct!)) : null }
}
