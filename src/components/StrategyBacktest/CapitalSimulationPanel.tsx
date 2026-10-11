import { useEffect, useRef, useState } from 'react'
import { CAPITAL_DECISION_LABELS, CAPITAL_ISSUE_LABELS, type CapitalCatalog, type CapitalPlan, type CapitalReport, type CapitalRequest } from '../../../electron/shared/capitalSimulation'
import { ledgerMoney } from '../../../electron/shared/accountLedger'
const field = 'w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900'
const button = 'min-h-10 rounded border border-cyan-600 px-4 text-sm text-cyan-700 disabled:opacity-40 dark:text-cyan-300'
const bjDate = () => new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10)
export function CapitalSimulationPanel() {
  const [catalog, setCatalog] = useState<CapitalCatalog | null>(null), [report, setReport] = useState<CapitalReport | null>(null)
  const [source, setSource] = useState(''), [dateStart, setDateStart] = useState(bjDate), [dateEnd, setDateEnd] = useState(bjDate)
  const [funding, setFunding] = useState('manual'), [cash, setCash] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [plan, setPlan] = useState<CapitalPlan>({ holdDays: 1, maxPositions: 5, maxPositionPct: 20, cashReservePct: 10, lotSize: 100, feeBps: 13, minimumFee: '0', slippageBps: 0, stopLossPct: null, stopProfitPct: null })
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState('')
  const pending = useRef<CapitalRequest | null>(null), id = useRef(crypto.randomUUID())
  async function refresh() { try { const r = await window.api.capitalSimulation.catalog(); if (r.ok) { setCatalog(r.data); setSource(old => old || r.data.sources[0]?.value || '') } else setError(r.message) } catch { setError('无法读取本地回测数据集。') } }
  useEffect(() => { void refresh() }, [])
  async function run() {
    const selectedAccount = catalog?.accounts.find(a => a.id === funding)
    const request: CapitalRequest = { id: id.current, source: source.startsWith('lab:') ? { kind: 'lab', runId: Number(source.slice(4)) } : { kind: 'short-term', key: source.slice(11) },
      dateStart, dateEnd, plan, funding: funding === 'manual' ? { kind: 'manual', cash } : { kind: 'ledger-opening', accountId: funding, revision: selectedAccount?.revision ?? -1 }, assumptionsConfirmed: confirmed as true }
    pending.current = request; setBusy(true); setError('')
    try {
      const result = await window.api.capitalSimulation.run(request)
      if (!result.ok) { setError(result.message); if (result.code === 'STORAGE_UNAVAILABLE') setUncertain(true); return }
      setReport(result.data); pending.current = null; id.current = crypto.randomUUID(); await refresh()
    } catch { setUncertain(true); setError('保存结果未确认，先核对原编号，不另建编号重复运行。') } finally { setBusy(false) }
  }
  async function recover() {
    if (!pending.current) return
    setBusy(true)
    try {
      const r = await window.api.capitalSimulation.get(pending.current.id)
      if (r.ok) { setReport(r.data); setUncertain(false); pending.current = null; id.current = crypto.randomUUID(); setError('报告已保存，未重复执行。'); await refresh() }
      else if (r.code === 'NOT_FOUND') { setUncertain(false); setError('原编号尚无报告，可以保持原编号手动再运行；不会自动重试。') }
      else setError(r.message)
    } catch { setError('核对仍未完成，继续保留重复写入保护。') } finally { setBusy(false) }
  }
  async function loadReport(value: string) { if (!value) return; setBusy(true); try { const r = await window.api.capitalSimulation.get(value); if (r.ok) setReport(r.data); else setError(r.message) } catch { setError('报告读取失败。') } finally { setBusy(false) } }
  const disabled = busy || uncertain
  return <div data-testid="capital-simulation-panel" className="h-full overflow-y-auto p-5 text-slate-900 dark:text-slate-100">
    <header className="mb-5"><p className="text-xs font-semibold tracking-wider text-cyan-700">SHARED CAPITAL</p><h2 className="mt-1 text-2xl font-semibold">组合资金回测</h2><p className="mt-2 text-sm text-slate-500">多只股票共用现金与仓位预算；开盘买入不使用当日稍后卖出的资金。结果是本地研究情景，不连接券商、不下单。</p></header>
    {error && <p role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="grid gap-3 md:grid-cols-3"><label>已保存的策略信号<select aria-label="资金回测数据集" className={field} value={source} onChange={e => setSource(e.target.value)}><option value="">选择数据集</option>{catalog?.sources.map(s => <option key={s.value} value={s.value}>{s.label} · {s.count} 条</option>)}</select></label><label>起始日<input aria-label="资金回测起始日" className={field} type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} /></label><label>结束日<input aria-label="资金回测结束日" className={field} type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} /></label></div>
      <div className="grid gap-3 md:grid-cols-2"><label>初始资金来源<select aria-label="资金回测资金来源" className={field} value={funding} onChange={e => setFunding(e.target.value)}><option value="manual">手动研究资金情景</option>{catalog?.accounts.map(a => <option key={a.id} value={a.id}>账户期初 · {a.label}</option>)}</select></label>{funding === 'manual' ? <label>初始现金（元）<input aria-label="资金回测初始现金" className={field} value={cash} onChange={e => setCash(e.target.value)} placeholder="填写研究预算，不自动读券商余额" /></label> : <p className="self-end rounded bg-slate-50 p-3 text-xs dark:bg-slate-800">只使用核对过的期初声明；起始日须等于该账户期初日。后续成交及当前余额不倒灌历史。</p>}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([
        ['holdDays', '持有开市日数'], ['maxPositions', '最多同时持仓'], ['maxPositionPct', '单股预算上限（%）'], ['cashReservePct', '现金预留目标（%）'],
        ['lotSize', '买入单位假设（股）'], ['feeBps', '单边综合费率假设（bps）'], ['minimumFee', '每笔最低费用假设（元）'], ['slippageBps', '单边滑点假设（bps）'],
      ] as const).map(([key, label]) => <label key={key}>{label}<input aria-label={label} className={field} value={plan[key]} onChange={e => setPlan(old => ({ ...old, [key]: key === 'minimumFee' ? e.target.value : Number(e.target.value) }))} /></label>)}</div>
      <div className="grid gap-3 sm:grid-cols-2"><label>止损假设（%，留空不设）<input aria-label="资金回测止损" className={field} value={plan.stopLossPct ?? ''} onChange={e => setPlan(old => ({ ...old, stopLossPct: e.target.value === '' ? null : Number(e.target.value) }))} /></label><label>止盈假设（%，留空不设）<input aria-label="资金回测止盈" className={field} value={plan.stopProfitPct ?? ''} onChange={e => setPlan(old => ({ ...old, stopProfitPct: e.target.value === '' ? null : Number(e.target.value) }))} /></label></div>
      <p className="text-xs text-slate-500">T 日信号最早下一开市日开盘入场，入场日不卖出；跳空优先于盘中触发，同日先止损后止盈。期末保留未平仓头寸，不虚构清仓。买入单位和费用不是已验证的券商规则；最大区间 1096 天、5000 条信号、250 只标的。专业竞价不可由普通日线替代。</p>
      <label className="block text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> 我确认将所选信号用于做多研究，并理解资金、买入单位和费用是回测假设，不是真实委托或可用资金证明</label>
      <button type="button" className={button} disabled={!confirmed || !source || funding === 'manual' && ledgerMoney(cash) === null} onClick={() => { void run() }}>{busy ? '正在推进交易日并保存报告…' : '运行并保存组合回测'}</button>
      {!catalog?.sources.length && <p className="text-sm text-amber-700">暂无已保存信号。请先在策略实验室运行策略，或完成短线策略的数据同步；不会生成虚构样本。</p>}
    </fieldset>
    <div className="my-4 flex flex-wrap items-center gap-3"><button type="button" disabled={busy} className={button} onClick={() => { void refresh() }}>刷新数据集和报告</button>{uncertain && <button className={button} disabled={busy} onClick={() => { void recover() }}>核对刚才保存的报告</button>}<label className="min-w-64 flex-1">本地历史报告<select aria-label="组合资金历史报告" className={field} disabled={disabled} value="" onChange={e => { void loadReport(e.target.value) }}><option value="">选择已保存报告（显示最近 100 条）</option>{catalog?.runs.map(r => <option key={r.id} value={r.id}>{r.sourceLabel} · {new Date(r.createdAt).toLocaleString()} · {r.id.slice(0, 8)}</option>)}</select></label>{catalog?.limited && <span className="text-xs text-amber-700">数据集或报告列表达到显示边界，不代表全部历史。</span>}</div>
    {report && <section data-testid="capital-report" className="space-y-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-lg font-semibold">已保存报告 · {report.status === 'blocked' ? '结论受阻' : '研究假设下的结果'}</h3><span className="text-xs text-slate-500">编号 {report.id}</span></div>
      <p className="text-xs text-slate-500">报告参数：{report.request.dateStart} 至 {report.request.dateEnd}，最多 {report.request.plan.maxPositions} 只，单股 {report.request.plan.maxPositionPct}%，持有 {report.request.plan.holdDays} 日。上方编辑不会改变本报告；需另行运行。</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['期初权益', report.initialEquity], ['期末权益', report.finalEquity], ['期末现金', report.finalCash], ['累计费用', report.feesTotal]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums">{value ?? '不可核算'}</p></div>)}</div>
      <p className="text-sm">资金收益：{report.totalReturnPct === null ? '不可核算' : `${report.totalReturnPct.toFixed(2)}%`} · 最大回撤：{report.maxDrawdownPct === null ? '不可核算' : `${report.maxDrawdownPct.toFixed(2)}%`} · 年化 Sharpe（252 日假设）：{report.annualizedSharpe?.toFixed(2) ?? '样本不足或不可核算'}</p>
      {report.totalReturnPct !== null && <CapitalCurve report={report} />}
      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{report.issues.map(issue => <p key={issue}>{CAPITAL_ISSUE_LABELS[issue] ?? issue}</p>)}</div>
      <p className="text-xs text-slate-500">模型 {report.engine} · 事实摘要 {report.factsFingerprint} · 模型成交 {report.fills.length} 笔，入场 {report.decisions.filter(d => d.outcome === 'entered').length}，跳过 {report.decisions.filter(d => d.outcome === 'skipped').length}，期末未平仓 {report.openPositions.length} 只。仅本机保存，不进入默认诊断反馈。</p>
      <details><summary>交易日资金、仓位和回撤（最近 100 日）</summary><div className="overflow-x-auto"><table className="mt-3 w-full text-left text-xs"><thead><tr><th>日期</th><th>现金</th><th>权益</th><th>股票占比</th><th>最大单股占比</th></tr></thead><tbody>{report.curve.slice(-100).map(p => <tr key={p.date} className="border-t"><td className="py-2">{p.date}</td><td>{p.cash}</td><td>{p.equity ?? '未知'}</td><td>{p.exposurePct?.toFixed(2) ?? '未知'}%</td><td>{p.concentrationPct?.toFixed(2) ?? '未知'}%</td></tr>)}</tbody></table></div></details>
      <details><summary>逐信号资金分配与跳过原因（最近 100 条）</summary>{report.decisions.slice(-100).map(d => <p key={d.signalId} className="mt-2 text-xs">{d.date} · {d.symbol} · {d.outcome === 'entered' ? '入场' : '跳过'} · {CAPITAL_DECISION_LABELS[d.reason] ?? d.reason}</p>)}</details>
    </section>}
  </div>
}
function CapitalCurve({ report }: { report: CapitalReport }) {
  const values = report.curve.map(p => p.equity === null ? null : Number(p.equity))
  if (values.some(v => v === null) || !values.length) return null
  const min = Math.min(...values as number[]), max = Math.max(...values as number[]), span = max - min || 1
  const points = values.map((v, i) => `${20 + i * 760 / Math.max(1, values.length - 1)},${160 - (v! - min) / span * 130}`).join(' ')
  return <figure className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><figcaption className="text-sm font-semibold">每日组合权益（研究情景）</figcaption><svg role="img" aria-label="每日组合权益曲线" viewBox="0 0 800 180" className="mt-3 w-full text-cyan-600"><path d="M20 160H780" stroke="currentColor" opacity="0.2" /><polyline points={points} stroke="currentColor" strokeWidth="2" fill="none" /></svg><p className="text-xs text-slate-500">{report.curve[0].date} 至 {report.curve[report.curve.length - 1].date} · 按全部交易日统计，不仅统计平仓日。</p></figure>
}
