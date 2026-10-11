import { describe, expect, it } from 'vitest'
import { alignDiagnosticQuality } from '../../electron/main/services/diagnosticQualityAlignment'
import type { DiagnosticItem } from '../../electron/main/services/diagnosticsService'
import type { DataQualityDatasetResult } from '../../electron/main/services/dataQualityService'
import { INITIALIZATION_TASKS, shouldSkipInitializationTask } from '../../src/components/Onboarding/initializationTaskModel'
import { diagnosticFactStatus } from '../../src/components/Onboarding/initializationCapabilityPolicy'
import type { DiagnosticsHealthSnapshot } from '../../src/components/Onboarding/onboardingModel'

const item: DiagnosticItem = { key: 'freshness.dailyClose', title: '日线', status: 'ok', message: '缓存有记录', checkedAt: 1, recordCount: 2000000,
  evidence: { applicability: 'required', readiness: 'ready', reasonCode: 'LOCAL_FACTS_PRESENT', calendarBasis: 'local_verified' } }
const quality: DataQualityDatasetResult = { key: 'dailyMarket', title: '日线与复权', status: 'reliable', summary: '规模覆盖已核验', recordCount: 2000000,
  earliestDate: '20240701', latestDate: '20261009', sourceLabel: 'fixture', affectedModules: ['策略回测'], reasons: [],
  action: { key: 'syncHistoricalDaily', label: '补齐历史日线' },
  evidence: { applicability: 'required', readiness: 'ready', reasonCode: 'HISTORICAL_SCOPE_CHECKED', targetScope: 'market-history-480', calendarBasis: 'local_verified', expectedTradeDate: '20261009' } }
function snapshot(entry: DiagnosticItem): DiagnosticsHealthSnapshot {
  return { status: entry.status, checkedAt: 1, summary: { ok: 0, warning: 0, error: 0 }, groups: [{ key: 'freshness', title: '事实', items: [entry] }] }
}
const dailyTask = INITIALIZATION_TASKS.find(task => task.key === 'sync-historical-daily')!

describe('quality scope alignment', () => {
  it('uses quality facts and a proved target to skip history, not cache counts', () => {
    const aligned = alignDiagnosticQuality(item, quality)
    expect(aligned.status).toBe('ok')
    expect(shouldSkipInitializationTask(snapshot(aligned), dailyTask)).toContain('目标范围已核验')
    expect(shouldSkipInitializationTask(snapshot(item), dailyTask)).toBeNull()
  })
  it.each(['KEY_FIELDS_MISSING', 'ADJUSTMENT_GAPS', 'FUTURE_FACTS', 'TRADE_DAY_COVERAGE_LOW', 'SECURITY_UNIVERSE_INCOMPLETE'])('does not skip an incomplete %s scope', code => {
    const aligned = alignDiagnosticQuality(item, { ...quality, status: code.includes('INCOMPLETE') || code.includes('COVERAGE') ? 'blocked' : 'degraded',
      evidence: undefined, reasons: [{ code, message: '需要补齐', severity: 'error' }] })
    expect(aligned).toMatchObject({ status: 'warning', evidence: { readiness: 'partial', reasonCode: code } })
    expect(shouldSkipInitializationTask(snapshot(aligned), dailyTask)).toBeNull()
    expect(aligned.actions?.[0].key).toBe('syncHistoricalDaily')
    expect(aligned.message).toContain('已有个股事实保留')
  })
  it('keeps calendar recovery first and does not invent a settled session', () => {
    const aligned = alignDiagnosticQuality(item, { ...quality, status: 'degraded',
      action: { key: 'syncTradeCalendar', label: '补齐交易日历' },
      evidence: { applicability: 'required', readiness: 'unknown', reasonCode: 'CALENDAR_UNAVAILABLE', calendarBasis: 'unknown' },
      reasons: [{ code: 'CALENDAR_UNAVAILABLE', message: '日期未知', severity: 'error' }] })
    expect(aligned.evidence?.readiness).toBe('unknown')
    expect(aligned.actions?.[0].key).toBe('syncTradeCalendar')
    expect(shouldSkipInitializationTask(snapshot(aligned), dailyTask)).toBeNull()
  })
  it('missing or neutral quality is not successful evaluation', () => {
    expect(alignDiagnosticQuality(item, undefined).evidence?.readiness).toBe('unknown')
    expect(alignDiagnosticQuality(item, { ...quality, displayStatus: 'neutral' }).status).toBe('warning')
  })
  it('retains structural errors instead of hiding them behind a quality warning', () => {
    const error = { ...item, status: 'error' as const }
    expect(alignDiagnosticQuality(error, quality)).toBe(error)
  })
  it.each(['partial', 'missing', 'failed', 'unknown', 'waiting', 'not_applicable'] as const)('never skips stock or decision work on %s evidence', readiness => {
    for (const [key, taskKey] of [['freshness.stockBasic', 'sync-stock-basic'], ['freshness.decisionSignals', 'backfill-decision']] as const) {
      const entry = { ...item, key, evidence: { ...item.evidence!, readiness } }
      expect(shouldSkipInitializationTask(snapshot(entry), INITIALIZATION_TASKS.find(task => task.key === taskKey)!)).toBeNull()
    }
  })
  it('partial facts remain a warning even when an old producer says ok', () => {
    expect(diagnosticFactStatus({ ...item, evidence: { ...item.evidence!, readiness: 'partial' } })).toBe('warning')
  })
})
