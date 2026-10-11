import type { DiagnosticItem } from './diagnosticsService'
import type { DataQualityDatasetResult } from './dataQualityService'

/** Reuse the actual quality result; never promote row presence to scope readiness. */
export function alignDiagnosticQuality(item: DiagnosticItem, quality: DataQualityDatasetResult | undefined): DiagnosticItem {
  if (item.status === 'error') return item
  if (!quality || quality.displayStatus === 'neutral') {
    return { ...item, status: 'warning', message: `${item.message} 对应质量范围尚未核验。`,
      evidence: { ...item.evidence, applicability: 'required', readiness: 'unknown', reasonCode: 'QUALITY_SCOPE_UNKNOWN' } }
  }
  const reason = quality.reasons.find(entry => entry.severity === 'error') ?? quality.reasons[0]
  const readiness = quality.evidence?.readiness
    ?? (quality.recordCount === 0 ? 'missing' : quality.status === 'reliable' ? 'ready' : 'partial')
  const ready = quality.status === 'reliable' && readiness === 'ready'
    && item.evidence?.readiness !== 'unknown' && item.evidence?.readiness !== 'failed'
    && item.displayStatus !== 'neutral'
  const qualityAction = quality.action ? { ...quality.action, kind: 'run' as const } : undefined
  const actions = [...(qualityAction ? [qualityAction] : []), ...(item.actions ?? [])]
    .filter((action, index, all) => all.findIndex(other => other.key === action.key) === index)
  return {
    ...item, status: ready ? 'ok' : 'warning',
    message: `${quality.summary}${reason ? ` ${reason.message}` : ''}${ready ? '' : ' 已有个股事实保留，未通过核验的范围不能视为完整。'}`,
    recordCount: quality.recordCount,
    actions,
    evidence: {
      ...item.evidence, ...quality.evidence, applicability: 'required',
      readiness: ready ? 'ready' : readiness === 'ready' ? 'unknown' : readiness,
      reasonCode: ready ? quality.evidence?.reasonCode ?? 'QUALITY_SCOPE_CHECKED'
        : reason?.code ?? quality.evidence?.reasonCode ?? 'QUALITY_SCOPE_UNKNOWN',
    },
  }
}
