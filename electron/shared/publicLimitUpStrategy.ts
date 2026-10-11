import { PUBLIC_LIMIT_UP_RULES, PUBLIC_LIMIT_UP_RULE_VERSION, type PublicLimitUpRuleId } from './publicLimitUpRules'

export interface PublicLimitUpStrategyProfile {
  ruleId: PublicLimitUpRuleId
  ruleVersion: typeof PUBLIC_LIMIT_UP_RULE_VERSION
}

export const PUBLIC_LIMIT_UP_STRATEGY_ERRORS: Record<string, string> = {
  PUBLIC_LIMIT_CACHE_MISSING: '没有已核验的免费涨停池。请在配置中心的数据源页同步免费涨停池，再运行策略。',
  PUBLIC_LIMIT_SOURCE_DATE_UNKNOWN: '涨停池来源或日期尚未核验，请重新同步原生免费涨停池。',
  PUBLIC_LIMIT_INVALID_DATE: '涨停池日期无效或晚于当前日期，请重新同步。',
  PUBLIC_LIMIT_DATE_MISMATCH: '所选日期与当前免费缓存日期不同。请同步该日数据，或清空日期使用当前缓存。',
  PUBLIC_LIMIT_CALENDAR_UNKNOWN: '涨停池日期没有被本地交易日历确认，请先补齐交易日历。',
  PUBLIC_LIMIT_NOT_AFTER_CLOSE: '涨停池采集时间不能证明是盘后事实，请在收盘后重新同步。',
  PUBLIC_LIMIT_SINGLE_DATE_ONLY: '免费涨停规则每次只运行一个已缓存交易日，不支持历史区间或分钟扫描。',
  PUBLIC_LIMIT_RULE_INVALID: '免费涨停规则配置无效，请重新选择内置模板。',
  PUBLIC_LIMIT_BACKTEST_UNAVAILABLE: '本次免费涨停筛选未形成可回测的历史时点数据，不能生成收益回测。可先查看命中证据及走势图。',
}

export function isPublicLimitUpRuleId(value: unknown): value is PublicLimitUpRuleId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PUBLIC_LIMIT_UP_RULES, value)
}

export function publicLimitUpRuleDescription(id: PublicLimitUpRuleId): string {
  const rule = PUBLIC_LIMIT_UP_RULES[id]
  return `${rule.minBoards}${rule.maxBoards === null ? '板及以上' : '板'}，首次封板 09:25:00 至 ${rule.before}，炸板不超过 ${rule.maxOpens} 次，封板资金至少 ${rule.minFundingYuan / 10000} 万元。`
}
