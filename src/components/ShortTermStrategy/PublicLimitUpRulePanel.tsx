import React, { useState } from 'react'
import type { PublicLimitPoolObservationRow, PublicLimitPoolObservationSnapshot } from '../../../electron/shared/dataSourceTypes'
import { PUBLIC_LIMIT_UP_RULES, screenPublicLimitUpPool, type PublicLimitUpRuleId } from '../../../electron/shared/publicLimitUpRules'
import { ShortTermCombobox } from './ShortTermDecisionControls'

const OPTIONS = Object.entries(PUBLIC_LIMIT_UP_RULES).map(([value, rule]) => ({ value, label: rule.label }))

export function PublicLimitUpRulePanel({ snapshot, onOpenStock }: { snapshot: PublicLimitPoolObservationSnapshot | null; onOpenStock: (row: PublicLimitPoolObservationRow) => void }): JSX.Element {
  const [ruleId, setRuleId] = useState<PublicLimitUpRuleId>('earlyFirst')
  const rule = PUBLIC_LIMIT_UP_RULES[ruleId]
  const result = screenPublicLimitUpPool(snapshot, ruleId)
  return <details className="mt-2 rounded-md border border-cyan-200 bg-white p-3 dark:border-cyan-900 dark:bg-slate-900">
    <summary className="min-h-11 cursor-pointer text-xs font-semibold text-cyan-800 dark:text-cyan-200">免费规则选股 · {result.state === 'ready' ? `${result.matches.length} 只匹配` : '数据待补'}</summary>
    <div className="mt-2 space-y-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
      <ShortTermCombobox value={ruleId} options={OPTIONS} ariaLabel="免费涨停选股规则" testId="public-limit-rule"
        onChange={value => { if (Object.prototype.hasOwnProperty.call(PUBLIC_LIMIT_UP_RULES, value)) setRuleId(value as PublicLimitUpRuleId) }} />
      <p>规则：{rule.minBoards}{rule.maxBoards === null ? '板及以上' : rule.maxBoards === rule.minBoards ? '板' : `至${rule.maxBoards}板`}；首次封板 09:25 至 {rule.before}；炸板不超过 {rule.maxOpens} 次；封板资金至少 {rule.minFundingYuan / 10000} 万元。</p>
      <p>排序：首次封板更早，再按封板资金更多，最后按股票代码。规则版本：{result.version}。</p>
      {result.state === 'blocked' ? <p role="status" className="text-amber-800 dark:text-amber-200">{result.reason === 'SOURCE_DATE_UNKNOWN' ? '旧缓存或日期来历未知，暂不用于规则选股。请在数据源页重新同步免费涨停池。' : '尚无可用的源日期事实，请在数据源页同步已收盘交易日的免费涨停池。'}</p> : <>
        <p role="status">事实日期 {result.tradeDate} · 匹配 {result.matches.length}/{result.totalRows} 只 · 必要字段不足或重复 {result.insufficientRows} 只。</p>
        {result.matches.length === 0 && <p>没有满足这组规则的记录，不代表市场没有机会；可以切换规则或检查源覆盖。</p>}
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {result.matches.slice(0, 20).map(({ row, evidence }) => <li key={row.tsCode} className="rounded border border-slate-100 p-2 dark:border-slate-800">
            <button type="button" onClick={() => onOpenStock(row)} className="min-h-9 rounded font-medium text-cyan-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-cyan-200">{row.name ?? row.tsCode}（{row.tsCode}）· 查看日K</button>
            <p>{evidence.join('；')}</p>
          </li>)}
        </ul>
        {result.matches.length > 20 && <p>本区域展示排序前 20 只；下方公开资料列表仍可查看完整缓存。</p>}
      </>}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">这是公开涨停池内的事实规则，不是买入指令、收益预测或回测结论。没有竞价、筹码、龙虎榜与全市场覆盖；不会自动提交订单。{snapshot?.priceCheck !== 'matched-local-closes' ? '本地同日收盘价核对未完成或依据未知。' : ''}</p>
    </div>
  </details>
}
