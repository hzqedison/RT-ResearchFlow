export type ConceptSource = 'kpl' | 'ths' | 'dc'
export type Readiness = 'ready' | 'missing' | 'partial' | 'not_run' | 'waiting' | 'failed' | 'unknown' | 'not_applicable'
export type DiagnosticOutcome = 'started' | 'success' | 'empty' | 'partial' | 'blocked' | 'failed' | 'waiting'
export type DataAccess = 'not_configured' | 'unknown' | 'confirmed_denied' | 'auth_failed' | 'rate_limited' | 'timeout' | 'transport_error'

export interface EvaluationCounts {
  neutral: number
  evaluatedCount: number
  totalCount: number
}

export interface FactSyncReceipt {
  outcome: DiagnosticOutcome
  source: string
  targetDate: string | null
  insertedRows: number
  reasonCode: string
  access: DataAccess
  checkedAt: number
  coverage: 'unknown'
}

export interface ReadinessEvidence {
  applicability: 'required' | 'selected' | 'on_demand' | 'derived' | 'not_selected'
  readiness: Readiness
  reasonCode: string
  selectedSource?: ConceptSource
  expectedTradeDate?: string | null
  latestTradeDate?: string | null
  calendarBasis?: 'local_verified' | 'unknown'
  missingTradeDays?: number | null
  targetScope?: string
  access?: DataAccess
  lastAttempt?: FactSyncReceipt
}

/** Neutral is a separate display/evaluation state, never an alias for ok/reliable. */
export interface DiagnosticReadiness {
  displayStatus?: 'neutral'
  evidence?: ReadinessEvidence
}

export function evaluationCounts<T extends { status: string; displayStatus?: 'neutral' }>(items: T[], statuses: string[]): Record<string, number> & EvaluationCounts {
  const counts: Record<string, number> & EvaluationCounts = { neutral: 0, evaluatedCount: 0, totalCount: items.length }
  for (const status of statuses) counts[status] = 0
  for (const item of items) {
    if (item.displayStatus === 'neutral') counts.neutral++
    else { counts[item.status]++; counts.evaluatedCount++ }
  }
  return counts
}

export function accessForReason(code: string): DataAccess {
  if (code === 'TUSHARE_DISABLED') return 'not_configured'
  if (code === 'TUSHARE_QUOTA_INSUFFICIENT') return 'confirmed_denied'
  if (code === 'TUSHARE_AUTH_FAILED') return 'auth_failed'
  if (code === 'TUSHARE_RATE_LIMITED') return 'rate_limited'
  if (code === 'TUSHARE_REQUEST_TIMEOUT') return 'timeout'
  if (code === 'UPSTREAM_FAILED') return 'transport_error'
  return 'unknown'
}

export const FACT_REASON_MESSAGES: Record<string, string> = {
  FACTS_SAVED: '目标日事实已保存；覆盖范围未知，不代表全市场、策略或正常入口已就绪。',
  PARTIAL_OBSERVATION_RETAINED_FACTS: '本次观察未补齐；已保留旧事实及其竞价观察时间，不代表新的完整观察或全市场覆盖。',
  CALENDAR_UNAVAILABLE: '日历缺失、无效或存在冲突，无法证明目标日期；请先补齐并检查交易日历。',
  NOT_DUE: '当天尚未到北京时间 09:30 完整事实采集截止，请等待出数。',
  TUSHARE_DISABLED: '尚未配置可用 Tushare Token，请打开数据源配置；接口权限仍需实际请求确认。',
  TUSHARE_QUOTA_INSUFFICIENT: '上游明确拒绝权限或积分不足，请检查该接口授权；已有事实保留。',
  TUSHARE_AUTH_FAILED: 'Token 认证失败，请更新数据源配置；已有事实保留。',
  TUSHARE_RATE_LIMITED: '上游限流，本次停止，请稍后重试；已有事实保留。',
  TUSHARE_REQUEST_TIMEOUT: '本次采集超时，后续分页和重试已取消；已有事实保留。',
  QUERY_CANCELLED: '本次采集已取消；已有事实保留。',
  UPSTREAM_EMPTY: '接口没有返回目标日有效事实；不推断权限，也不表示补齐成功。',
  FACT_INVALID: '响应存在错日期、无效代码或无效事实，本批未写入，已有事实保留。',
  FACT_CONFLICT: '响应与已有非空事实冲突，本批未写入，需复核来源。',
  PAGINATION_INCOMPLETE: '分页达到上限或没有进展，已停止；子集不作为完整批次写入。',
  WRITE_FAILED: '事务写入失败，未报告采集成功，已有事实保留。',
  UPSTREAM_FAILED: '上游采集失败，已有事实保留；请检查网络或服务状态。',
  CONCEPT_PARTIAL: '题材成员请求不完整，原有成员未被成功子集替换。',
  INVALID_SOURCE: '题材源无效，本次未执行。',
}

export function factReceiptMessage(receipt: FactSyncReceipt): string {
  return `${receipt.source}${receipt.targetDate ? ` · ${receipt.targetDate}` : ''} · ${FACT_REASON_MESSAGES[receipt.reasonCode] ?? FACT_REASON_MESSAGES.UPSTREAM_FAILED} 写入 ${receipt.insertedRows} 行。`
}
