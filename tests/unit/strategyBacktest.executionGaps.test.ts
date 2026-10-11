import { describe, expect, it } from 'vitest'
import { simulateTrade } from '../../electron/main/services/backtest/tradeSimulator'
import type { BacktestSignal, OHLC, TradePlan } from '../../electron/main/services/backtest/types'

const signal: BacktestSignal = { strategyKey: 'gap-test', tsCode: '600000.SH', tradeDate: '20261008', strength: 1 }
const plan: TradePlan = { entryRule: 'nextOpen', holdDays: 3, feeBps: 0, stopLoss: 5, stopProfit: 10 }
const bar = (tradeDate: string, open: number | null, high: number | null, low: number | null, close: number): OHLC => ({ tradeDate, open, high, low, close })
const prefix = [bar('20261008', 99, 100, 98, 100), bar('20261009', 100, 110, 90, 100)]
const tail = [bar('20261013', 100, 103, 98, 102), bar('20261014', 102, 104, 101, 103)]

describe('actual trade simulator: observed gap prices and temporal exit boundaries', () => {
  it('does not invent a 95 stop fill when the entire next session is below it', () => {
    const result = simulateTrade(signal, plan, [...prefix, bar('20261012', 80, 82, 75, 81), ...tail])
    expect(result).toMatchObject({ valid: true, exitDate: '20261012', exitPrice: 80, exitReason: 'stop_loss' })
    expect(result.grossReturnPct).toBeCloseTo(-20, 10)
  })
  it('resolves an opening profit trigger before a later intraday loss trigger', () => {
    const result = simulateTrade(signal, plan, [...prefix, bar('20261012', 115, 118, 90, 100), ...tail])
    expect(result).toMatchObject({ valid: true, exitPrice: 115, exitReason: 'stop_profit' })
  })
  it('resolves an opening loss trigger before a later intraday profit trigger', () => {
    const result = simulateTrade(signal, plan, [...prefix, bar('20261012', 90, 115, 89, 110), ...tail])
    expect(result).toMatchObject({ valid: true, exitPrice: 90, exitReason: 'stop_loss' })
  })
  it('keeps stop-loss-first for genuinely ambiguous intraday threshold order', () => {
    const result = simulateTrade(signal, plan, [...prefix, bar('20261012', 100, 115, 90, 100), ...tail])
    expect(result).toMatchObject({ valid: true, exitPrice: 95, exitReason: 'stop_loss' })
  })
  it('counts an observed early loss exit even if the planned holding period is not yet complete', () => {
    expect(simulateTrade(signal, plan, [...prefix, bar('20261012', 80, 82, 75, 81)])).toMatchObject({ valid: true, exitDate: '20261012', exitPrice: 80 })
  })
  it('counts an observed early profit exit without requesting unknown future bars', () => {
    const result = simulateTrade(signal, plan, [...prefix, bar('20261012', 100, 112, 99, 111)])
    expect(result).toMatchObject({ valid: true, exitReason: 'stop_profit' })
    expect(result.exitPrice).toBeCloseTo(110, 10)
  })
  it('keeps an unfinished non-triggered trade unavailable instead of inventing an exit', () => {
    expect(simulateTrade(signal, plan, [...prefix, bar('20261012', 100, 103, 98, 102)])).toMatchObject({ valid: false, returnPct: null, status: 'data_insufficient' })
  })
  it('never sells on the entry day even when entry-day extrema cross both stops', () => {
    const result = simulateTrade(signal, plan, [...prefix, bar('20261012', 100, 103, 98, 102), ...tail])
    expect(result).toMatchObject({ valid: true, entryDate: '20261009', exitDate: '20261014', exitReason: 'hold_expired' })
  })
  it('also waits until the following day for signal-close optimistic entries', () => {
    const result = simulateTrade(signal, { ...plan, entryRule: 'signalClose' }, [bar('20261008', 100, 120, 70, 100), bar('20261009', 80, 85, 75, 82)])
    expect(result).toMatchObject({ valid: true, entryDate: '20261008', exitDate: '20261009', exitPrice: 80 })
  })
  it('deducts both transaction sides from a gap exit, not from the old trigger price', () => {
    const result = simulateTrade(signal, { ...plan, feeBps: 13 }, [...prefix, bar('20261012', 80, 82, 75, 81)])
    expect(result.netReturnPct).toBeCloseTo((80 * (1 - 0.0013) / (100 * (1 + 0.0013)) - 1) * 100, 10)
    expect(result.grossReturnPct).toBeCloseTo(-20, 10)
  })
  it('requires an opening observation to decide gap chronology', () => {
    expect(simulateTrade(signal, plan, [...prefix, bar('20261012', null, 115, 90, 100), ...tail])).toMatchObject({ valid: false, returnPct: null })
  })
  it.each(['high', 'low'] as const)('does not pretend missing %s proves that a stop was untouched', field => {
    const day = { ...bar('20261012', 100, 105, 96, 101), [field]: null }
    expect(simulateTrade(signal, plan, [...prefix, day, ...tail]).valid).toBe(false)
  })
  it('can resolve a known opening exit without needing unused intraday extrema', () => {
    expect(simulateTrade(signal, plan, [...prefix, bar('20261012', 80, null, null, 80)])).toMatchObject({ valid: true, exitPrice: 80 })
  })
  it('rejects a contradictory opening price rather than filling a corrupt bar', () => {
    expect(simulateTrade(signal, plan, [...prefix, bar('20261012', 80, 100, 90, 95)]).valid).toBe(false)
  })
  it('does not let duplicate dates bypass the next-session sell restriction', () => {
    expect(simulateTrade(signal, plan, [...prefix, bar('20261009', 80, 90, 70, 85)]).valid).toBe(false)
  })
  it('does not inspect later corrupt data after an observed exit', () => {
    expect(simulateTrade(signal, plan, [...prefix, bar('20261012', 80, 82, 75, 81), bar('invalid', null, null, null, NaN)]).valid).toBe(true)
  })
  it.each([NaN, Infinity, -1, 10000])('does not emit fictitious finite returns for invalid fees %s', feeBps => {
    expect(simulateTrade(signal, { ...plan, feeBps }, [...prefix, ...tail]).valid).toBe(false)
  })
  it.each([0, 1.5, NaN, Infinity])('rejects invalid holding period %s', holdDays => {
    expect(simulateTrade(signal, { ...plan, holdDays }, [...prefix, ...tail]).valid).toBe(false)
  })
})
