import { describe, expect, it } from 'vitest'
import { evaluationCounts, factReceiptMessage } from '../../electron/shared/dataReadiness'
import { resolveFactDates, resolveCompletedTradeDate, tradingDayAge, type KnownCalendar } from '../../electron/main/services/dataReadinessService'
import { offsetYmd } from '../../electron/main/services/marketSettlementPolicy'

function calendar(overrides: Record<string, number | null> = {}): KnownCalendar {
  const days = new Map<string, number>()
  for (let date = '20260929'; date <= '20261009'; date = offsetYmd(date, 1)) days.set(date, date >= '20261001' && date <= '20261007' ? 0 : 1)
  for (const [date, open] of Object.entries(overrides)) { if (open === null) days.delete(date); else days.set(date, open) }
  return date => days.has(date) ? { isOpen: days.get(date)! } : undefined
}
const at = (time: string) => Date.parse(`2026-10-08T${time}+08:00`)

describe('readiness calendar and aggregation contract', () => {
  it('partial retained observations have a stable fact-only explanation, not a success or permission claim', () => {
    const message = factReceiptMessage({ outcome: 'partial', source: 'tushare/stk_auction', targetDate: '20261008',
      insertedRows: 1, reasonCode: 'PARTIAL_OBSERVATION_RETAINED_FACTS', access: 'unknown', checkedAt: at('09:31:00'), coverage: 'unknown' })
    expect(message).toContain('本次观察未补齐')
    expect(message).toContain('已保留旧事实及其竞价观察时间')
    expect(message).not.toContain('上游采集失败')
  })
  it('before 09:30 chooses prior session and its exact predecessor across the holiday', () => {
    expect(resolveFactDates(calendar(), at('09:29:59'))).toEqual({ auctionDate: '20260930', previousTradeDate: '20260929' })
  })
  it('09:30 chooses today, never a natural-day predecessor', () => {
    expect(resolveFactDates(calendar(), at('09:30:00'))).toEqual({ auctionDate: '20261008', previousTradeDate: '20260930' })
  })
  it('an explicit not-yet-due today is waiting', () => {
    expect(() => resolveFactDates(calendar(), at('09:29:59'), '20261008')).toThrow('NOT_DUE')
  })
  it.each(['20261008', '20261003', '20260930'])('missing required date %s fails closed', date => {
    expect(() => resolveFactDates(calendar({ [date]: null }), at('09:30:00'))).toThrow('CALENDAR_UNAVAILABLE')
  })
  it('invalid open flags and conflicts fail closed', () => {
    expect(() => resolveFactDates(calendar({ '20261002': 2 }), at('09:30:00'))).toThrow('CALENDAR_UNAVAILABLE')
    const known = calendar()
    expect(() => resolveFactDates(date => date === '20261008' ? { isOpen: 1, conflict: true } : known(date), at('09:30:00'))).toThrow('CALENDAR_UNAVAILABLE')
  })
  it('market settlement uses 18:00; a long closed interval adds no stale days', () => {
    expect(resolveCompletedTradeDate(calendar(), at('17:59:59'))).toBe('20260930')
    expect(tradingDayAge(calendar(), '2026-09-30', at('17:59:59'))).toEqual({ expectedTradeDate: '20260930', missingTradeDays: 0 })
    expect(tradingDayAge(calendar(), '20260930', at('18:00:00')).missingTradeDays).toBe(1)
  })
  it('unknown intervals and invalid/future fact dates cannot be normal', () => {
    expect(() => tradingDayAge(calendar({ '20261005': null }), '20260930', at('18:00:00'))).toThrow('CALENDAR_UNAVAILABLE')
    expect(() => tradingDayAge(calendar(), '20260931', at('18:00:00'))).toThrow('CALENDAR_UNAVAILABLE')
    expect(() => tradingDayAge(calendar(), '20261009', at('18:00:00'))).toThrow('FACT_INVALID')
  })
  it('neutral does not increase health ok or quality reliable', () => {
    expect(evaluationCounts([{ status: 'warning', displayStatus: 'neutral' as const }, { status: 'ok' }, { status: 'error' }], ['ok', 'warning', 'error'])).toEqual({ ok: 1, warning: 0, error: 1, neutral: 1, evaluatedCount: 2, totalCount: 3 })
    expect(evaluationCounts([{ status: 'degraded', displayStatus: 'neutral' as const }], ['reliable', 'degraded', 'blocked'])).toEqual({ reliable: 0, degraded: 0, blocked: 0, neutral: 1, evaluatedCount: 0, totalCount: 1 })
  })
})
