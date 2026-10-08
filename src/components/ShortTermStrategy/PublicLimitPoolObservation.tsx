import React from 'react'
import { SHORT_TERM_WORKBENCH_ACTION_CLASS, ShortTermCombobox } from './ShortTermDecisionControls'
import {
  formatPublicSealAmount, selectPublicLimitPoolRows, publicObservationMissingFields,
  type PublicLimitPoolFilters, type PublicLimitPoolObservationRow, type PublicLimitPoolObservationSnapshot,
} from './publicLimitPoolViewModel'

interface Props {
  snapshot: PublicLimitPoolObservationSnapshot | null
  loading: boolean
  readFailed: boolean
  filters: PublicLimitPoolFilters
  onFiltersChange: (filters: PublicLimitPoolFilters) => void
  onRefresh: () => void
  onOpenStock: (row: PublicLimitPoolObservationRow) => void
  defaultExpanded?: boolean
}

const BOARD_OPTIONS = [
  { value: 'all', label: '全部连板状态（含待补）' },
  { value: '1', label: '首板及以上' }, { value: '2', label: '至少2板' },
  { value: '3', label: '至少3板' }, { value: '5', label: '至少5板' },
]
const OPEN_OPTIONS = [
  { value: 'all', label: '全部炸板状态（含待补）' },
  { value: '0', label: '未炸板' }, { value: '1', label: '最多1次炸板' },
  { value: '2', label: '最多2次炸板' },
]

export function PublicLimitPoolObservation({ snapshot, loading, readFailed, filters, onFiltersChange, onRefresh, onOpenStock, defaultExpanded = false }: Props) {
  const selection = selectPublicLimitPoolRows(snapshot?.rows ?? [], filters)
  const date = snapshot?.tradeDate?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
  return (
    <section aria-label="公开涨停观察" className="shrink-0 border-b border-slate-200 bg-cyan-50/40 px-4 py-3 dark:border-slate-800 dark:bg-cyan-950/15">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-100">公开涨停观察 · 东方财富 / AKShare</h3>
          <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            {date ? `缓存标记日期 ${date} · ${selection.total} 只。按请求日期与本地收盘行情交叉核对，不代表上游已证明日期或全市场覆盖。` :
              loading ? '正在读取本地公开资料…' : readFailed ? '暂时无法读取本地公开资料。' :
                '暂无已保存的公开涨停资料。可在数据源选择 AKShare，检测并保存同日资料后返回这里刷新。'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">可用于只读筛选和查看日K；不冒充竞价、筹码，也不自动生成下方策略评分或交易订单。</p>
          {date && <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-200">
            日期依据：{snapshot?.dateBasis === 'request-only' ? '请求参数，非上游日期证明' : snapshot?.dateBasis === 'source-reported' ? '上游声明，尚未独立验证' : '未知，旧缓存未记录日期来历'}
            {snapshot?.verifiedAt && Number.isFinite(snapshot.verifiedAt) ? ` · 最近行情核对 ${new Date(snapshot.verifiedAt).toLocaleString('zh-CN', { hour12: false })}` : ' · 核对时间未知'}
          </p>}
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className={SHORT_TERM_WORKBENCH_ACTION_CLASS}>
          {loading ? '读取中…' : '刷新本地观察'}
        </button>
      </div>
      {readFailed && <p role="alert" className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        读取失败，显示内容尚未更新{snapshot ? '；已保留上次读取的资料，不代表当前来源可用' : ''}。可刷新重试，不会重复启动同步任务。
      </p>}
      {selection.total > 0 && <>
        <details open={defaultExpanded} className="mt-2">
        <summary className="flex min-h-11 cursor-pointer items-center rounded px-2 text-xs font-medium text-cyan-800 hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-cyan-200 dark:hover:bg-cyan-950/30">
          查看公开资料列表 · {selection.total} 只（可收起）
        </summary>
        <div className="mt-3 grid grid-cols-1 items-center gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          <ShortTermCombobox value={filters.minBoards === null ? 'all' : String(filters.minBoards)} options={BOARD_OPTIONS}
            ariaLabel="公开观察连板筛选" testId="public-limit-board-filter"
            onChange={value => onFiltersChange({ ...filters, minBoards: value === 'all' ? null : Number(value) })} />
          <ShortTermCombobox value={filters.maxOpens === null ? 'all' : String(filters.maxOpens)} options={OPEN_OPTIONS}
            ariaLabel="公开观察炸板筛选" testId="public-limit-open-filter"
            onChange={value => onFiltersChange({ ...filters, maxOpens: value === 'all' ? null : Number(value) })} />
          <span className="text-[11px] tabular-nums text-slate-600 dark:text-slate-300">匹配 {selection.rows.length} / {selection.total} 只</span>
        </div>
        {selection.excludedUnknown > 0 && <p role="status" className="mt-2 text-[11px] text-amber-800 dark:text-amber-200">
          {selection.excludedUnknown} 只缺少当前筛选所需字段，未纳入匹配；选择“全部”可查看。缺失不按0次炸板或0板处理。
        </p>}
        <div className="mt-2 max-h-44 overflow-auto rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full min-w-[640px] text-left text-[11px]">
            <caption className="sr-only">独立公共涨停资料，可点击股票查看日K</caption>
            <thead className="sticky top-0 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr><th className="px-3 py-2">股票</th><th className="px-3 py-2">连板</th><th className="px-3 py-2">首次封板</th><th className="px-3 py-2">炸板次数</th><th className="px-3 py-2">封板资金</th><th className="px-3 py-2">返回字段</th></tr>
            </thead>
            <tbody>
              {selection.rows.map(row => <tr key={row.tsCode} onDoubleClick={() => onOpenStock(row)} className="border-t border-slate-100 hover:bg-cyan-50 dark:border-slate-800 dark:hover:bg-cyan-950/30">
                <td className="px-3 py-2"><button type="button" onClick={() => onOpenStock(row)} aria-label={`查看${row.name ?? row.tsCode}日K`}
                  className="min-h-9 rounded px-1 text-left font-medium text-cyan-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-cyan-200">
                  {row.name ?? row.tsCode} <span className="font-mono text-slate-400">{row.tsCode}</span>
                </button></td>
                <td className="px-3 py-2">{row.limitTimes == null ? '待补' : row.limitTimes === 1 ? '首板' : `${row.limitTimes}板`}</td>
                <td className="px-3 py-2 tabular-nums">{row.firstTime ?? '待补'}</td>
                <td className="px-3 py-2 tabular-nums">{row.openTimes ?? '待补'}</td>
                <td className="px-3 py-2 tabular-nums">{formatPublicSealAmount(row.fdAmountYuan)}</td>
                <td className="px-3 py-2">{publicObservationMissingFields(row).length === 0 ? '所示筛选字段齐全' : `待补：${publicObservationMissingFields(row).join('、')}`}</td>
              </tr>)}
              {selection.rows.length === 0 && <tr><td colSpan={6} className="px-3 py-5 text-center text-slate-500">没有满足当前条件的记录；这不是当日无涨停，可切换“全部”查看待补字段的资料。</td></tr>}
            </tbody>
          </table>
        </div>
        </details>
      </>}
    </section>
  )
}
