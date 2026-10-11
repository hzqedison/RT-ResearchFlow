import { describe, expect, it } from 'vitest'
import { decisionDateCaption } from '../../src/components/DecisionCenter/decisionDateCaption'

describe('decision date caption', () => {
  it('does not label weekend news as a trading session', () => {
    const result = decisionDateCaption({ today: '20261011', displayDate: '20261011', latestTradeDate: '20261009', isFallback: false, isTradingDay: false })
    expect(result).toBe('今日休市 · 展示今日资讯与信号 2026-10-11')
    expect(result).not.toContain('交易日')
  })
  it('identifies the displayed historical signal date without certifying calendar provenance', () => {
    expect(decisionDateCaption({ today: '20261011', displayDate: '20261009', latestTradeDate: '20261009', isFallback: true, isTradingDay: false })).toBe('今日休市 · 展示历史信号 2026-10-09')
  })
  it('explains fallback on an open session', () => {
    expect(decisionDateCaption({ today: '20261012', displayDate: '2026-10-09', latestTradeDate: '20261012', isFallback: true, isTradingDay: true })).toBe('今日暂无新信号 · 展示历史信号 2026-10-09')
  })
})
