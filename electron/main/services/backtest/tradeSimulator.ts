/**
 * 策略级回测引擎 - 单笔撮合（P1）
 *
 * 纯函数：给定一条信号 + 交易假设 + 该股票的升序日线序列，返回单笔交易结果。
 * 不触碰数据库、不依赖时间，便于单元测试。
 *
 * 关键纪律（见 strategy-backtest-engine.md §7 无前视偏差）：
 *  1. 信号日 = 决策日 T，入场最早 T+1（nextOpen）。signalClose 仅作乐观上限。
 *  2. A股 T+1：入场当日不可卖出，止盈止损扫描从入场日的下一交易日开始。
 *  3. 止盈止损同日判定保守口径：先判止损、再判止盈（避免高估收益）。
 *  4. 只使用入场日及之后、且不超过计划出场日的行；未来数据不足则判 data_insufficient
 *     （这同时防止了对"尚未发生"日期的前视）。
 *  5. 交易日序列由该股票自身的日线行派生——停牌日无行，逐行推进天然跳过，
 *     "持有 N 日"语义为"持有 N 个该股票实际成交的交易日"。
 */

import type { BacktestSignal, OHLC, TradePlan, TradeResult } from './types'

function invalid(signal: BacktestSignal): TradeResult {
  return {
    signal,
    entryDate: null,
    entryPrice: null,
    exitDate: null,
    exitPrice: null,
    returnPct: null,
    grossReturnPct: null,
    netReturnPct: null,
    exitReason: 'data_insufficient',
    status: 'data_insufficient',
    valid: false
  }
}

function isPositive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/**
 * @param signal 归一化信号
 * @param plan   交易假设
 * @param rows   该股票按 tradeDate 升序排列的日线序列（来自 daily_close_cache）
 */
export function simulateTrade(
  signal: BacktestSignal,
  plan: TradePlan,
  rows: OHLC[]
): TradeResult {
  if (rows.length === 0 || !Number.isSafeInteger(plan.holdDays) || plan.holdDays < 1
    || !Number.isFinite(plan.feeBps) || plan.feeBps < 0 || plan.feeBps >= 10000) return invalid(signal)

  // 定位入场日索引 idxE
  let idxE: number
  if (plan.entryRule === 'signalClose') {
    // T 日收盘入场：必须存在信号日当天的行
    idxE = rows.findIndex(r => r.tradeDate === signal.tradeDate)
    if (idxE < 0) return invalid(signal)
  } else {
    // nextOpen：第一根 tradeDate 严格大于信号日的行（= T+1，自动跳过停牌/非交易日）
    idxE = rows.findIndex(r => r.tradeDate > signal.tradeDate)
    if (idxE < 0) return invalid(signal)
  }

  const entryRow = rows[idxE]
  const entryPrice = plan.entryRule === 'signalClose' ? entryRow.close : entryRow.open
  if (!isPositive(entryPrice)) return invalid(signal)

  // 计划出场行索引：持有 holdDays 个交易日后的收盘
  const exitIdxPlanned = idxE + plan.holdDays
  // An observed early exit does not require future bars beyond its exit date.
  const plannedExit = rows[exitIdxPlanned]

  const stopLossPct = plan.stopLoss ?? plan.stopLossPct ?? null
  const stopProfitPct = plan.stopProfit ?? plan.takeProfitPct ?? null
  const stopLossPrice = isPositive(stopLossPct) ? entryPrice * (1 - stopLossPct / 100) : null
  const stopProfitPrice = isPositive(stopProfitPct) ? entryPrice * (1 + stopProfitPct / 100) : null

  let exitDate = plannedExit?.tradeDate ?? null
  let exitPrice = plannedExit?.close ?? null
  let exitReason: TradeResult['exitReason'] = 'hold_expired'

  // 止盈止损扫描：从 T+1 入场日的下一交易日（idxE+1）到计划出场日（含）
  for (let j = idxE + 1; j <= Math.min(exitIdxPlanned, rows.length - 1); j++) {
    const day = rows[j]
    if (day.tradeDate <= rows[j - 1].tradeDate) return invalid(signal)
    if (stopLossPrice !== null || stopProfitPrice !== null) {
      // The opening auction precedes intraday extremes. Do not fill a gap at
      // a trigger price that the market never offered after the open.
      if (!isPositive(day.open)) return invalid(signal)
      if ((day.high != null && (!isPositive(day.high) || day.open > day.high))
        || (day.low != null && (!isPositive(day.low) || day.open < day.low))) return invalid(signal)
      if (stopLossPrice !== null && day.open <= stopLossPrice) {
        exitDate = day.tradeDate
        exitPrice = day.open
        exitReason = 'stop_loss'
        break
      }
      if (stopProfitPrice !== null && day.open >= stopProfitPrice) {
        exitDate = day.tradeDate
        exitPrice = day.open
        exitReason = 'stop_profit'
        break
      }
      // Missing extrema cannot prove that a configured stop did not trigger.
      if ((stopLossPrice !== null && !isPositive(day.low))
        || (stopProfitPrice !== null && !isPositive(day.high))) return invalid(signal)
    }
    // 保守：先止损后止盈
    if (stopLossPrice !== null && isPositive(day.low) && day.low <= stopLossPrice) {
      exitDate = day.tradeDate
      exitPrice = stopLossPrice
      exitReason = 'stop_loss'
      break
    }
    if (stopProfitPrice !== null && isPositive(day.high) && day.high >= stopProfitPrice) {
      exitDate = day.tradeDate
      exitPrice = stopProfitPrice
      exitReason = 'stop_profit'
      break
    }
  }

  if (!exitDate || !isPositive(exitPrice)) return invalid(signal)

  // 扣双边费用：买入垫高、卖出折让
  const fee = plan.feeBps / 1e4
  const grossReturn = exitPrice / entryPrice - 1
  const netReturn = (exitPrice * (1 - fee)) / (entryPrice * (1 + fee)) - 1

  return {
    signal,
    entryDate: entryRow.tradeDate,
    entryPrice,
    exitDate,
    exitPrice,
    returnPct: netReturn * 100,
    grossReturnPct: grossReturn * 100,
    netReturnPct: netReturn * 100,
    exitReason,
    status: 'executed',
    valid: true
  }
}
