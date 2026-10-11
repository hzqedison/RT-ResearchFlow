export const STOCK_BASIC_SYNC_FAILURE_MESSAGE =
  '股票基础资料同步未完成，请检查网络或稍后重试。公开源同步无需 Tushare Token。'

export function describeScreenerEmptyResult(input: {
  totalScanned: number
  totalSignals: number
  minSignal: number
  requireTurnover: boolean
}): { kind: 'not-scanned' | 'no-signals' | 'filtered-empty'; title: string; detail: string } {
  if (!Number.isSafeInteger(input.totalScanned) || input.totalScanned <= 0) {
    return {
      kind: 'not-scanned',
      title: '本次没有完成有效扫描，暂时不能判断是否有选股机会',
      detail: '请检查股票基础资料与逐股历史日线覆盖后重新运行；空列表不代表没有机会。',
    }
  }
  if (input.totalSignals === 0) {
    return {
      kind: 'no-signals',
      title: '本次实际扫描范围内没有匹配的策略信号',
      detail: `已扫描 ${input.totalScanned} 只股票；结论仅适用于本次数据与策略条件，不代表全市场没有机会。`,
    }
  }
  return {
    kind: 'filtered-empty',
    title: `当前过滤条件（信号 ≥ ${input.minSignal}${input.requireTurnover ? ' + 有效换手' : ''}）无匹配股票`,
    detail: `本次有 ${input.totalSignals} 只策略候选被当前显示条件过滤，可调整门槛或换手要求查看。`,
  }
}
