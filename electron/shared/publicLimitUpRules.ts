import type { PublicLimitPoolObservationRow, PublicLimitPoolObservationSnapshot } from './dataSourceTypes'
import { validNativeDate } from './macThsNativeProtocol'

export const PUBLIC_LIMIT_UP_RULE_VERSION = 'public-limit-rules-1'
export const PUBLIC_LIMIT_UP_RULES = {
  earlyFirst: { label: '早封首板', minBoards: 1, maxBoards: 1, maxOpens: 1, before: '10:00:00', minFundingYuan: 5_000_000 },
  secondBoard: { label: '二板观察', minBoards: 2, maxBoards: 2, maxOpens: 2, before: '10:30:00', minFundingYuan: 10_000_000 },
  continuous: { label: '连板观察', minBoards: 3, maxBoards: null, maxOpens: 1, before: '10:30:00', minFundingYuan: 20_000_000 },
} as const
export type PublicLimitUpRuleId = keyof typeof PUBLIC_LIMIT_UP_RULES

export interface PublicLimitUpRuleResult {
  version: string
  tradeDate: string | null
  state: 'ready' | 'blocked'
  reason: 'CACHE_MISSING' | 'SOURCE_DATE_UNKNOWN' | 'INVALID_RULE' | 'INVALID_DATE' | null
  totalRows: number
  insufficientRows: number
  matches: Array<{ row: PublicLimitPoolObservationRow; evidence: string[] }>
}

// A transparent fact filter, not a return predictor, trading instruction or
// replacement for the professional auction/chip/whole-market strategy engine.
export function screenPublicLimitUpPool(snapshot: PublicLimitPoolObservationSnapshot | null, ruleId: PublicLimitUpRuleId, now = Date.now()): PublicLimitUpRuleResult {
  const result: PublicLimitUpRuleResult = { version: PUBLIC_LIMIT_UP_RULE_VERSION, tradeDate: snapshot?.tradeDate ?? null, state: 'blocked', reason: 'CACHE_MISSING', totalRows: snapshot?.rows.length ?? 0, insufficientRows: 0, matches: [] }
  if (!Object.prototype.hasOwnProperty.call(PUBLIC_LIMIT_UP_RULES, ruleId)) return { ...result, reason: 'INVALID_RULE' }
  if (!snapshot || !snapshot.rows.length) return result
  if (snapshot.source !== 'eastmoney_public' || snapshot.dateBasis !== 'source-reported' || !Number.isSafeInteger(snapshot.verifiedAt) || (snapshot.verifiedAt ?? 0) <= 0) return { ...result, reason: 'SOURCE_DATE_UNKNOWN' }
  const date = snapshot.tradeDate ?? ''
  const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10).replaceAll('-', '')
  if (!/^\d{8}$/.test(date) || !validNativeDate(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`) || date > today) return { ...result, reason: 'INVALID_DATE' }
  const rule = PUBLIC_LIMIT_UP_RULES[ruleId]
  const counts = new Map<string, number>()
  for (const row of snapshot.rows) counts.set(row.tsCode, (counts.get(row.tsCode) ?? 0) + 1)
  for (const row of snapshot.rows) {
    if (!/^\d{6}\.(SH|SZ|BJ)$/.test(row.tsCode) || counts.get(row.tsCode) !== 1 ||
        !Number.isFinite(row.close) || row.close <= 0 ||
        row.limitTimes === null || !Number.isSafeInteger(row.limitTimes) || row.limitTimes < 1 ||
        row.openTimes === null || !Number.isSafeInteger(row.openTimes) || row.openTimes < 0 ||
        row.fdAmountYuan === null || !Number.isFinite(row.fdAmountYuan) || row.fdAmountYuan < 0 ||
        !row.firstTime || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(row.firstTime)) {
      result.insufficientRows++
      continue
    }
    if (row.limitTimes < rule.minBoards || (rule.maxBoards !== null && row.limitTimes > rule.maxBoards) ||
        row.openTimes > rule.maxOpens || row.firstTime < '09:25:00' || row.firstTime > rule.before || row.fdAmountYuan < rule.minFundingYuan) continue
    result.matches.push({ row, evidence: [
      `${row.limitTimes}板`, `首次封板 ${row.firstTime}`, `炸板 ${row.openTimes}次`, `封板资金 ${(row.fdAmountYuan / 10000).toFixed(2)}万元`,
    ] })
  }
  result.matches.sort((a, b) => a.row.firstTime!.localeCompare(b.row.firstTime!) || b.row.fdAmountYuan! - a.row.fdAmountYuan! || a.row.tsCode.localeCompare(b.row.tsCode))
  result.state = 'ready'
  result.reason = null
  return result
}
