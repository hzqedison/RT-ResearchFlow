import type { DiagnosticItem, DiagnosticStatus, DiagnosticsHealthSnapshot } from './onboardingModel'

/** Only database failures block basic local use. Provider failures stay scoped. */
export function basicUseBlockers(snapshot: DiagnosticsHealthSnapshot | null): DiagnosticItem[] {
  return snapshot?.groups.filter(group => group.key === 'database')
    .flatMap(group => group.items)
    .filter(item => item.status === 'error' && item.displayStatus !== 'neutral') ?? []
}

/** Task availability is not data evidence; callers must pass freshness items. */
export function diagnosticFactStatus(item: DiagnosticItem | undefined): DiagnosticStatus {
  if (!item || item.displayStatus === 'neutral') return 'warning'
  if (item.status === 'error') return 'error'
  if (item.evidence?.readiness === 'partial') return 'warning'
  if (item.evidence && !['ready', 'partial'].includes(item.evidence.readiness)) return 'warning'
  if (item.recordCount != null && (!Number.isFinite(item.recordCount) || item.recordCount < 0)) return 'warning'
  if (item.recordCount === 0 && item.evidence?.readiness !== 'ready') return 'warning'
  return item.status
}

export function isUsableDiagnosticFact(item: DiagnosticItem | undefined): boolean {
  if (!item || diagnosticFactStatus(item) === 'error' || item.displayStatus === 'neutral') return false
  if (item.evidence && !['ready', 'partial'].includes(item.evidence.readiness)) return false
  if (item.recordCount != null && (!Number.isFinite(item.recordCount) || item.recordCount < 0)) return false
  if (item.evidence?.readiness === 'ready' && item.status === 'ok') return true
  return (item.recordCount ?? 0) > 0 && (item.status === 'ok' || item.evidence?.readiness === 'partial')
}
