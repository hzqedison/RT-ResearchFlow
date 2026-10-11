import type { DecisionSignalDateContextData } from './decisionReviewStatsModel'

function dateLabel(value: string): string {
  const compact = value.replace(/-/g, '')
  return /^\d{8}$/.test(compact)
    ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
    : value
}

// Signal dates include weekend news; they are not proof of an exchange session.
export function decisionDateCaption(context: DecisionSignalDateContextData): string {
  if (!context.isTradingDay && !context.isFallback) {
    return `今日休市 · 展示今日资讯与信号 ${dateLabel(context.displayDate)}`
  }
  const state = context.isTradingDay ? '今日暂无新信号' : '今日休市'
  return `${state} · 展示历史信号 ${dateLabel(context.displayDate)}`
}
