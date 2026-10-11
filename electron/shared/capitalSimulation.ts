import { isLedgerId, ledgerMoney, type LedgerAccount } from './accountLedger'

export interface CapitalPlan {
  holdDays: number; maxPositions: number; maxPositionPct: number; cashReservePct: number; lotSize: number
  feeBps: number; minimumFee: string; slippageBps: number; stopLossPct: number | null; stopProfitPct: number | null
}
export type CapitalFunding = { kind: 'manual'; cash: string } | { kind: 'ledger-opening'; accountId: string; revision: number }
export interface CapitalRequest {
  id: string; source: { kind: 'short-term'; key: string } | { kind: 'lab'; runId: number }
  dateStart: string; dateEnd: string; funding: CapitalFunding; plan: CapitalPlan; assumptionsConfirmed: true
}
export interface CapitalSignal { id: string; date: string; symbol: string; strength: number; direction: string | null }
export interface CapitalBar { date: string; symbol: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null; factor: number | null; source: string }
export interface CapitalOpening { cash: string; positions: Array<{ symbol: string; quantity: number }>; evidence: { kind: 'manual' | 'ledger-opening'; accountId?: string; revision?: number; asOf?: number } }
export interface CapitalPoint { date: string; cash: string; marketValue: string | null; equity: string | null; exposurePct: number | null; concentrationPct: number | null; drawdownPct: number | null }
export interface CapitalFill { signalId: string | null; date: string; symbol: string; side: 'buy' | 'sell'; quantity: number; price: string; gross: string; fee: string; reason: 'entry' | 'hold' | 'stop-loss' | 'stop-profit' }
export interface CapitalDecision { signalId: string; date: string; symbol: string; outcome: 'entered' | 'skipped'; reason: string }
export interface CapitalReport {
  schema: 1; engine: 'capital-calendar-cents-1'; id: string; createdAt: number; request: CapitalRequest
  fundingEvidence: CapitalOpening['evidence']; factsFingerprint: string; status: 'partial' | 'blocked'; issues: string[]
  initialEquity: string | null; finalEquity: string | null; finalCash: string; totalPnl: string | null; totalReturnPct: number | null
  maxDrawdownPct: number | null; annualizedSharpe: number | null; annualizationDays: 252; feesTotal: string
  curve: CapitalPoint[]; fills: CapitalFill[]; decisions: CapitalDecision[]; openPositions: Array<{ symbol: string; quantity: number }>
}
export type CapitalCode = 'INVALID_INPUT' | 'UNAUTHORIZED' | 'CALENDAR_INCOMPLETE' | 'FACT_LIMIT' | 'ACCOUNT_CONFLICT' | 'OPENING_DATE_MISMATCH' | 'OPENING_INCOMPLETE' | 'REQUEST_CONFLICT' | 'NOT_FOUND' | 'STORAGE_UNAVAILABLE'
export type CapitalResult<T> = { ok: true; data: T } | { ok: false; code: CapitalCode; message: string }
export interface CapitalCatalog { sources: Array<{ value: string; label: string; count: number }>; accounts: LedgerAccount[]; runs: Array<{ id: string; createdAt: number; sourceLabel: string; status: string }>; limited: boolean }
export const CAPITAL_ISSUE_LABELS: Record<string, string> = {
  PRICE_BASIS_UNVERIFIED: '缓存价格口径未独立核验，不将资金情景作为实盘成交证明',
  SIGNAL_POINT_IN_TIME_UNVERIFIED: '历史信号的当时可得性未完整核验',
  EXECUTION_ASSUMPTIONS: '买入单位、费用、滑点及日线撮合为研究假设；不证明实际成交或容量',
  CORPORATE_ACTIONS_UNVERIFIED: '缺少部分复权因子，不能排除公司行动影响',
  CORPORATE_ACTION_UNSUPPORTED: '持仓期间复权因子发生变化，缺少股数与现金分配事实，已停止推进',
  HOLDING_PRICE_MISSING: '持仓行情缺失，不以前值冒充当日市值或提前释放资金',
  ENTRY_DATA_MISSING: '部分入场日行情缺失，未顺延成未来有利入场',
  NO_SIGNALS: '所选数据集和区间没有策略信号', NO_ENTRIES: '没有可执行入场，不把空样本标为零收益',
  SMALL_SAMPLE: '观察期不足 30 个开市日，不给出年化 Sharpe',
  RISK_LIMIT_BREACH: '已有持仓或被动价格变化超出仓位/现金预留目标，未伪造自动调仓',
  EXIT_FEE_UNAFFORDABLE: '现金与卖出金额不足以支付退出费用，未假定借款或伪造清仓',
}
export const CAPITAL_DECISION_LABELS: Record<string, string> = {
  OUTSIDE_WINDOW: '下一开市日超出本次区间', SYMBOL_UNSUPPORTED: '证券或币种不在当前模型范围', NOT_LONG_SIGNAL: '不是做多信号',
  DUPLICATE_SAME_DAY: '同股同日重复信号', ALREADY_HELD: '该股票已有持仓', POSITION_LIMIT: '同时持仓已达上限',
  ENTRY_DATA_MISSING: '下一开市日入场行情缺失', LIQUIDITY_NOT_OBSERVED: '没有观察到可用日线流动性', EQUITY_UNKNOWN: '上一时点权益不可核算',
  CASH_OR_LOT_LIMIT: '现金预留、费用或买入单位限制', NEXT_MARKET_OPEN: '按下一开市日开盘假设入场',
}
function exact(v: unknown, keys: string[]): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return false
  const descriptors = Object.getOwnPropertyDescriptors(v)
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(k => Object.hasOwn(descriptors, k) && Object.hasOwn(descriptors[k], 'value'))
}
export function capitalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= '2000-01-01'
}
const integer = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max
export function decodeCapitalRequest(value: unknown): CapitalRequest | null {
  try {
    if (!exact(value, ['id', 'source', 'dateStart', 'dateEnd', 'funding', 'plan', 'assumptionsConfirmed']) || !isLedgerId(value.id)
      || !capitalDate(value.dateStart) || !capitalDate(value.dateEnd) || value.dateStart > value.dateEnd
      || (Date.parse(value.dateEnd) - Date.parse(value.dateStart)) / 86400000 > 1095 || value.assumptionsConfirmed !== true) return null
    const source = value.source as Record<string, unknown>, funding = value.funding as Record<string, unknown>, p = value.plan as Record<string, unknown>
    let s: CapitalRequest['source'], f: CapitalFunding
    if (exact(source, ['kind', 'key']) && source.kind === 'short-term' && typeof source.key === 'string' && /^[A-Za-z0-9_.-]{1,120}$/.test(source.key)) s = { kind: 'short-term', key: source.key }
    else if (exact(source, ['kind', 'runId']) && source.kind === 'lab' && integer(source.runId, 1, Number.MAX_SAFE_INTEGER)) s = { kind: 'lab', runId: source.runId }
    else return null
    if (exact(funding, ['kind', 'cash']) && funding.kind === 'manual' && ledgerMoney(funding.cash) !== null && Number(funding.cash) > 0) f = { kind: 'manual', cash: ledgerMoney(funding.cash)! }
    else if (exact(funding, ['kind', 'accountId', 'revision']) && funding.kind === 'ledger-opening' && isLedgerId(funding.accountId) && integer(funding.revision, 0, Number.MAX_SAFE_INTEGER)) f = { kind: 'ledger-opening', accountId: funding.accountId, revision: funding.revision }
    else return null
    if (!exact(p, ['holdDays', 'maxPositions', 'maxPositionPct', 'cashReservePct', 'lotSize', 'feeBps', 'minimumFee', 'slippageBps', 'stopLossPct', 'stopProfitPct'])
      || !integer(p.holdDays, 1, 120) || !integer(p.maxPositions, 1, 50) || !integer(p.maxPositionPct, 1, 100)
      || !integer(p.cashReservePct, 0, 99) || !integer(p.lotSize, 1, 10000) || !integer(p.feeBps, 0, 1000)
      || !integer(p.slippageBps, 0, 1000) || ledgerMoney(p.minimumFee) === null
      || p.stopLossPct !== null && !integer(p.stopLossPct, 1, 99) || p.stopProfitPct !== null && !integer(p.stopProfitPct, 1, 1000)) return null
    return { id: value.id, source: s, dateStart: value.dateStart, dateEnd: value.dateEnd, funding: f, assumptionsConfirmed: true,
      plan: { holdDays: p.holdDays, maxPositions: p.maxPositions, maxPositionPct: p.maxPositionPct, cashReservePct: p.cashReservePct,
        lotSize: p.lotSize, feeBps: p.feeBps, minimumFee: ledgerMoney(p.minimumFee)!, slippageBps: p.slippageBps,
        stopLossPct: p.stopLossPct as number | null, stopProfitPct: p.stopProfitPct as number | null } }
  } catch { return null }
}
