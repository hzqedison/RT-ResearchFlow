import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decodeCapitalRequest, type CapitalBar, type CapitalRequest, type CapitalSignal, type CapitalOpening } from '../../electron/shared/capitalSimulation'
import { simulateCapital } from '../../electron/main/services/backtest/capitalSimulationEngine'
const days = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05']
export function capitalRequest(): CapitalRequest { return { id: randomUUID(), source: { kind: 'short-term', key: 'fixture' }, dateStart: days[0], dateEnd: days[4], funding: { kind: 'manual', cash: '10000.00' }, assumptionsConfirmed: true, plan: { holdDays: 1, maxPositions: 1, maxPositionPct: 100, cashReservePct: 0, lotSize: 100, feeBps: 0, minimumFee: '0.00', slippageBps: 0, stopLossPct: null, stopProfitPct: null } } }
const sig = (id: string, date: string, symbol = '600001.SH', strength = 1): CapitalSignal => ({ id, date, symbol, strength, direction: null })
const bar = (date: string, symbol = '600001.SH', close = 10): CapitalBar => ({ date, symbol, open: close, high: close + 1, low: close - 1, close, volume: 1000, factor: 1, source: 'isolated-fixture' })
function simulate(options: { request?: CapitalRequest; signals?: CapitalSignal[]; bars?: CapitalBar[]; opening?: CapitalOpening } = {}) {
  return simulateCapital({ request: options.request ?? capitalRequest(), opening: options.opening ?? { cash: '10000.00', positions: [], evidence: { kind: 'manual' } },
    days, signals: options.signals ?? [sig('a', days[0])], bars: options.bars ?? days.map(d => bar(d, '600001.SH', d >= days[2] ? 12 : 10)), fingerprint: 'fixture', now: 1 })
}
describe('shared capital event loop', () => {
  it('uses one wallet and cannot reuse closing proceeds for the same morning', () => {
    const r = simulate({ signals: [sig('a', days[0]), sig('b', days[1], '600002.SH')], bars: [...days.map(d => bar(d, '600001.SH', d >= days[2] ? 12 : 10)), ...days.map(d => bar(d, '600002.SH'))] })
    expect(r.finalCash).toBe('12000.00'); expect(r.totalReturnPct).toBe(20)
    expect(r.fills.map(f => [f.date, f.side, f.quantity])).toEqual([[days[1], 'buy', 1000], [days[2], 'sell', 1000]])
    expect(r.decisions.find(d => d.signalId === 'b')?.reason).toBe('POSITION_LIMIT')
  })
  it('sorts only by known signal strength and stable symbols, never future profit', () => {
    const request = capitalRequest(), bars = [...days.map(d => bar(d, '600001.SH')), ...days.map(d => bar(d, '600002.SH', d >= days[2] ? 20 : 10))]
    const signals = [sig('b', days[0], '600002.SH'), sig('a', days[0])]
    const r = simulate({ request, bars, signals }); expect(r.fills[0].symbol).toBe('600001.SH')
    expect(simulate({ request, bars: [...bars].reverse(), signals: [...signals].reverse() })).toEqual(r)
  })
  it('accounts for minimum fees before rounding to lots and keeps exact cents', () => {
    const request = capitalRequest(); request.plan.minimumFee = '5.01'
    const r = simulate({ request }); expect(r.fills[0].quantity).toBe(900); expect(r.feesTotal).toBe('10.02'); expect(r.finalCash).toBe('11789.98')
  })
  it('reserves cash and caps each entry budget', () => {
    const request = capitalRequest(); request.plan.cashReservePct = 20; request.plan.maxPositionPct = 50
    const r = simulate({ request }); expect(r.fills[0].quantity).toBe(500); expect(r.curve[1].cash).toBe('5000.00')
  })
  it('does not stop out on the entry day and gaps before intraday extrema', () => {
    const request = capitalRequest(); request.plan.holdDays = 3; request.plan.stopLossPct = 5; request.plan.stopProfitPct = 5
    const bars = days.map(d => bar(d)); bars[1].low = 1; bars[2] = { ...bar(days[2], '600001.SH', 9), open: 8, high: 12, low: 7 }
    const r = simulate({ request, bars }); expect(r.fills[1]).toMatchObject({ date: days[2], price: '8.00', reason: 'stop-loss' })
  })
  it('chooses the conservative loss when both intraday thresholds are touched', () => {
    const request = capitalRequest(); request.plan.stopLossPct = 5; request.plan.stopProfitPct = 5
    const r = simulate({ request, bars: days.map(d => ({ ...bar(d), high: 11, low: 9 })) }); expect(r.fills[1].price).toBe('9.50')
  })
  it('never postpones a missing next-open bar to a later favorable day', () => {
    const r = simulate({ bars: days.filter(d => d !== days[1]).map(d => bar(d)) }); expect(r.fills).toHaveLength(0); expect(r.totalReturnPct).toBeNull(); expect(r.decisions[0].reason).toBe('ENTRY_DATA_MISSING')
  })
  it('missing holding prices cannot invent a full equity curve', () => {
    const r = simulate({ bars: days.filter(d => d !== days[2]).map(d => bar(d)) }); expect(r.status).toBe('blocked'); expect(r.curve[2].equity).toBeNull(); expect(r.totalReturnPct).toBeNull()
  })
  it('stops at an observed corporate action without guessing share ratios or dividends', () => {
    const bars = days.map(d => bar(d)); bars[2].factor = 2
    const r = simulate({ bars }); expect(r.issues).toContain('CORPORATE_ACTION_UNSUPPORTED'); expect(r.fills).toHaveLength(1); expect(r.totalReturnPct).toBeNull()
  })
  it('keeps unknown adjustment coverage unknown', () => {
    const r = simulate({ bars: days.map(d => ({ ...bar(d), factor: null })) }); expect(r.issues).toContain('CORPORATE_ACTIONS_UNVERIFIED'); expect(r.status).toBe('partial')
  })
  it('does not invent end-of-window liquidation or a zero-return empty sample', () => {
    const r = simulate({ signals: [sig('a', days[3])] }); expect(r.openPositions).toEqual([{ symbol: '600001.SH', quantity: 800 }]); expect(r.fills).toHaveLength(1)
    expect(simulate({ signals: [] })).toMatchObject({ status: 'blocked', totalReturnPct: null, maxDrawdownPct: null, annualizedSharpe: null })
  })
  it('rejects sell-direction signals and unobserved one-price liquidity', () => {
    const r = simulate({ signals: [{ ...sig('a', days[0]), direction: 'bearish' }] }); expect(r.decisions[0].reason).toBe('NOT_LONG_SIGNAL')
    const bars = days.map(d => ({ ...bar(d), high: 10, low: 10 })); expect(simulate({ bars }).decisions[0].reason).toBe('LIQUIDITY_NOT_OBSERVED')
  })
  it('must not manufacture borrowing to pay unaffordable exit fees', () => {
    const request = capitalRequest(); request.plan.minimumFee = '100.00'
    const r = simulate({ request, signals: [], bars: days.map(d => bar(d)), opening: { cash: '0.00', positions: [{ symbol: '600001.SH', quantity: 1 }], evidence: { kind: 'ledger-opening' } } })
    expect(Number(r.finalCash)).toBeGreaterThanOrEqual(0); expect(r.openPositions).toHaveLength(1); expect(r.status).toBe('blocked')
  })
})
describe('capital request decoder', () => {
  it('normalizes money while preserving explicit assumptions', () => { const r = capitalRequest(); r.funding = { kind: 'manual', cash: '10000' }; expect(decodeCapitalRequest(r)?.funding).toEqual({ kind: 'manual', cash: '10000.00' }) })
  it.each(['2026-02-30', '20260601', '1999-12-31', 'invalid'])('rejects invalid dates %s', date => expect(decodeCapitalRequest({ ...capitalRequest(), dateStart: date })).toBeNull())
  it.each(['', 'NaN', '-1', '1e4'])('rejects invalid funding %s', cash => expect(decodeCapitalRequest({ ...capitalRequest(), funding: { kind: 'manual', cash } })).toBeNull())
  it('rejects unconfirmed, extra, accessor and unbounded inputs', () => {
    expect(decodeCapitalRequest({ ...capitalRequest(), assumptionsConfirmed: false })).toBeNull()
    expect(decodeCapitalRequest({ ...capitalRequest(), brokerAccount: 'private' })).toBeNull()
    expect(decodeCapitalRequest({ ...capitalRequest(), get plan() { throw Error('not data') } })).toBeNull()
    expect(decodeCapitalRequest({ ...capitalRequest(), plan: { ...capitalRequest().plan, maxPositions: 51 } })).toBeNull()
  })
})
