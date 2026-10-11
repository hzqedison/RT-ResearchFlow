import { ledgerAmount, ledgerCents, ledgerMoney } from '../../../shared/accountLedger'
import type { CapitalBar, CapitalDecision, CapitalFill, CapitalOpening, CapitalPoint, CapitalReport, CapitalRequest, CapitalSignal } from '../../../shared/capitalSimulation'

const zero = BigInt(0), hundred = BigInt(100), bps = BigInt(10000)
const min = (a: bigint, b: bigint) => a < b ? a : b
const ceil = (a: bigint, b: bigint) => (a + b - BigInt(1)) / b
const ratio = (a: bigint, b: bigint) => b > zero ? Number(a) / Number(b) * 100 : null
const cents = (v: number | null): bigint | null => { const m = ledgerMoney(String(v)); return m !== null && Number(m) > 0 ? ledgerCents(m) : null }
function validBar(bar: CapitalBar | undefined): bar is CapitalBar {
  return !!bar && [bar.open, bar.high, bar.low, bar.close].every(v => cents(v) !== null)
    && bar.high! >= Math.max(bar.open!, bar.close) && bar.low! <= Math.min(bar.open!, bar.close) && bar.high! >= bar.low!
}
function liquid(bar: CapitalBar | undefined): bar is CapitalBar { return validBar(bar) && Number.isFinite(bar.volume) && bar.volume! > 0 && bar.high! > bar.low! }
interface Position { symbol: string; quantity: number; entryPrice: bigint; entered: number; factor: number | null }
/** Calendar event loop. Opening allocations never use proceeds from that day's later exits. */
export function simulateCapital(input: { request: CapitalRequest; opening: CapitalOpening; days: string[]; signals: CapitalSignal[]; bars: CapitalBar[]; fingerprint: string; now: number }): CapitalReport {
  const { request, opening, days } = input, plan = request.plan
  const barMap = new Map(input.bars.map(b => [`${b.date}:${b.symbol}`, b]))
  const issues = new Set(['PRICE_BASIS_UNVERIFIED', 'SIGNAL_POINT_IN_TIME_UNVERIFIED', 'EXECUTION_ASSUMPTIONS'])
  const positions = new Map<string, Position>(), fills: CapitalFill[] = [], decisions: CapitalDecision[] = [], curve: CapitalPoint[] = []
  let cash = ledgerCents(opening.cash), feesTotal = zero, initial: bigint | null = cash, peak: bigint | null = null, previousEquity: bigint | null = null, blocked = false
  const fee = (gross: bigint) => { const computed = ceil(gross * BigInt(plan.feeBps), bps), floor = ledgerCents(plan.minimumFee); return computed > floor ? computed : floor }
  const slipped = (price: bigint, buy: boolean) => buy ? ceil(price * BigInt(10000 + plan.slippageBps), bps) : price * BigInt(10000 - plan.slippageBps) / bps
  for (const p of opening.positions) {
    const bar = barMap.get(`${days[0]}:${p.symbol}`), price = bar && cents(bar.open)
    if (!price) { initial = null; blocked = true; issues.add('HOLDING_PRICE_MISSING') }
    else if (initial !== null) initial += price * BigInt(p.quantity)
    positions.set(p.symbol, { symbol: p.symbol, quantity: p.quantity, entryPrice: price ?? zero, entered: 0, factor: bar?.factor ?? null })
  }
  previousEquity = initial; peak = initial
  const byEntry = new Map<string, CapitalSignal[]>()
  for (const signal of [...input.signals].sort((a, b) => a.date.localeCompare(b.date) || b.strength - a.strength || a.symbol.localeCompare(b.symbol) || a.id.localeCompare(b.id))) {
    const next = days.find(d => d > signal.date)
    if (!next) { decisions.push({ signalId: signal.id, date: signal.date, symbol: signal.symbol, outcome: 'skipped', reason: 'OUTSIDE_WINDOW' }); continue }
    byEntry.set(next, [...(byEntry.get(next) ?? []), signal])
  }
  if (!input.signals.length) issues.add('NO_SIGNALS')
  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const date = days[dayIndex]
    let corporateStop = false
    for (const p of positions.values()) {
      const bar = barMap.get(`${date}:${p.symbol}`)
      if (bar?.factor == null || p.factor == null) issues.add('CORPORATE_ACTIONS_UNVERIFIED')
      if (bar?.factor != null && p.factor != null && Math.abs(bar.factor - p.factor) > 1e-10) { corporateStop = true; issues.add('CORPORATE_ACTION_UNSUPPORTED') }
    }
    if (corporateStop) { blocked = true; break }
    const seen = new Set<string>()
    for (const signal of byEntry.get(date) ?? []) {
      let reason = ''
      const bar = barMap.get(`${date}:${signal.symbol}`)
      if (!/^((6\d{5}\.SH)|([03]\d{5}\.SZ)|([489]\d{5}\.BJ))$/.test(signal.symbol)) reason = 'SYMBOL_UNSUPPORTED'
      else if (signal.direction && !['bullish', 'buy', 'long'].includes(signal.direction)) reason = 'NOT_LONG_SIGNAL'
      else if (seen.has(signal.symbol)) reason = 'DUPLICATE_SAME_DAY'
      else if (positions.has(signal.symbol)) reason = 'ALREADY_HELD'
      else if (positions.size >= plan.maxPositions) reason = 'POSITION_LIMIT'
      else if (!validBar(bar)) { reason = 'ENTRY_DATA_MISSING'; issues.add('ENTRY_DATA_MISSING') }
      else if (!liquid(bar)) reason = 'LIQUIDITY_NOT_OBSERVED'
      else if (previousEquity === null || previousEquity <= zero) reason = 'EQUITY_UNKNOWN'
      seen.add(signal.symbol)
      let quantity = 0, price = zero, gross = zero, costFee = zero
      if (!reason && bar && previousEquity !== null) {
        price = slipped(cents(bar.open)!, true)
        const reserve = ceil(previousEquity * BigInt(plan.cashReservePct), hundred)
        const budget = min(cash - reserve, previousEquity * BigInt(plan.maxPositionPct) / hundred)
        let left = 0, right = Math.min(1000000000 / plan.lotSize | 0, Number(budget > zero ? budget / (price * BigInt(plan.lotSize)) : zero))
        while (left < right) { const mid = Math.ceil((left + right) / 2), amount = price * BigInt(mid * plan.lotSize); if (amount + fee(amount) <= budget) left = mid; else right = mid - 1 }
        quantity = left * plan.lotSize; gross = price * BigInt(quantity); costFee = quantity ? fee(gross) : zero
        if (!quantity) reason = 'CASH_OR_LOT_LIMIT'
      }
      if (reason) decisions.push({ signalId: signal.id, date, symbol: signal.symbol, outcome: 'skipped', reason })
      else {
        cash -= gross + costFee; feesTotal += costFee
        if (cash < zero) throw Error('CAPITAL_INVARIANT_VIOLATION')
        positions.set(signal.symbol, { symbol: signal.symbol, quantity, entryPrice: price, entered: dayIndex, factor: bar!.factor })
        if (bar!.factor === null) issues.add('CORPORATE_ACTIONS_UNVERIFIED')
        fills.push({ signalId: signal.id, date, symbol: signal.symbol, side: 'buy', quantity, price: ledgerAmount(price), gross: ledgerAmount(gross), fee: ledgerAmount(costFee), reason: 'entry' })
        decisions.push({ signalId: signal.id, date, symbol: signal.symbol, outcome: 'entered', reason: 'NEXT_MARKET_OPEN' })
      }
    }
    for (const p of [...positions.values()]) {
      if (dayIndex <= p.entered) continue // research T+1; not a broker available-quantity assertion
      const bar = barMap.get(`${date}:${p.symbol}`)
      if (!liquid(bar)) continue
      const open = cents(bar.open)!, low = cents(bar.low)!, high = cents(bar.high)!
      const loss = plan.stopLossPct === null ? null : p.entryPrice * BigInt(100 - plan.stopLossPct) / hundred
      const profit = plan.stopProfitPct === null ? null : ceil(p.entryPrice * BigInt(100 + plan.stopProfitPct), hundred)
      let exitPrice: bigint | null = null, reason: CapitalFill['reason'] = 'hold'
      if (loss !== null && open <= loss) { exitPrice = open; reason = 'stop-loss' }
      else if (profit !== null && open >= profit) { exitPrice = open; reason = 'stop-profit' }
      else if (loss !== null && low <= loss) { exitPrice = loss; reason = 'stop-loss' }
      else if (profit !== null && high >= profit) { exitPrice = profit; reason = 'stop-profit' }
      else if (dayIndex - p.entered >= plan.holdDays) exitPrice = cents(bar.close)
      if (exitPrice === null) continue
      const price = slipped(exitPrice, false), gross = price * BigInt(p.quantity), costFee = fee(gross)
      if (price <= zero || cash + gross < costFee) { blocked = true; issues.add('EXIT_FEE_UNAFFORDABLE'); continue }
      cash += gross - costFee; feesTotal += costFee; positions.delete(p.symbol)
      fills.push({ signalId: null, date, symbol: p.symbol, side: 'sell', quantity: p.quantity, price: ledgerAmount(price), gross: ledgerAmount(gross), fee: ledgerAmount(costFee), reason })
    }
    let market: bigint | null = zero, largest = zero
    for (const p of positions.values()) {
      const bar = barMap.get(`${date}:${p.symbol}`), price = bar && cents(bar.close)
      if (bar && !validBar(bar)) { blocked = true; issues.add('HOLDING_PRICE_MISSING') }
      if (!price) { market = null; blocked = true; issues.add('HOLDING_PRICE_MISSING'); continue }
      const value = price * BigInt(p.quantity); if (value > largest) largest = value; if (market !== null) market += value
    }
    const equity: bigint | null = market === null ? null : cash + market
    if (equity !== null && (peak === null || equity > peak)) peak = equity
    const concentration = equity === null ? null : ratio(largest, equity)
    if (positions.size > plan.maxPositions || concentration !== null && concentration > plan.maxPositionPct + 1e-8 || equity !== null && cash * hundred < equity * BigInt(plan.cashReservePct)) issues.add('RISK_LIMIT_BREACH')
    curve.push({ date, cash: ledgerAmount(cash), marketValue: market === null ? null : ledgerAmount(market), equity: equity === null ? null : ledgerAmount(equity),
      exposurePct: equity === null || market === null ? null : ratio(market, equity), concentrationPct: concentration,
      drawdownPct: equity === null || peak === null ? null : ratio(peak - equity, peak) })
    previousEquity = equity
  }
  if (!fills.some(f => f.side === 'buy')) issues.add('NO_ENTRIES')
  const unavailable = blocked || !input.signals.length || !fills.some(f => f.side === 'buy') || initial === null || initial <= zero || !curve.length
  const final = !unavailable && curve[curve.length - 1].equity !== null ? ledgerCents(curve[curve.length - 1].equity!) : null
  let sharpe: number | null = null
  if (curve.length < 30) issues.add('SMALL_SAMPLE')
  else if (final !== null && initial !== null) {
    const values = [Number(initial), ...curve.map(p => Number(p.equity))], changes = values.slice(1).map((v, i) => values[i] > 0 ? v / values[i] - 1 : 0)
    const mean = changes.reduce((a, b) => a + b, 0) / changes.length, variance = changes.reduce((a, b) => a + (b - mean) ** 2, 0) / changes.length
    sharpe = variance > 0 ? mean / Math.sqrt(variance) * Math.sqrt(252) : null
  }
  return { schema: 1, engine: 'capital-calendar-cents-1', id: request.id, createdAt: input.now, request, fundingEvidence: opening.evidence, factsFingerprint: input.fingerprint,
    status: unavailable ? 'blocked' : 'partial', issues: [...issues], initialEquity: initial === null ? null : ledgerAmount(initial), finalEquity: final === null ? null : ledgerAmount(final),
    finalCash: ledgerAmount(cash), totalPnl: final === null || initial === null ? null : ledgerAmount(final - initial), totalReturnPct: final === null || initial === null ? null : ratio(final - initial, initial),
    maxDrawdownPct: final === null ? null : Math.max(0, ...curve.map(p => p.drawdownPct ?? 0)), annualizedSharpe: sharpe, annualizationDays: 252, feesTotal: ledgerAmount(feesTotal),
    curve, fills, decisions, openPositions: [...positions.values()].map(p => ({ symbol: p.symbol, quantity: p.quantity })) }
}
