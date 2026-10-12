import { useEffect, useRef, useState } from 'react'
import { decodeValidationRequest, hasFrozenValidationData, type ValidationStudy } from '../../../electron/shared/rollingValidation'
import { validationSummary } from '../../../electron/main/services/backtest/rollingValidationEngine'
import type { CapitalPlan } from '../../../electron/shared/capitalSimulation'
const defaultPlan: CapitalPlan = { holdDays: 1, maxPositions: 5, maxPositionPct: 20, cashReservePct: 10, lotSize: 100, feeBps: 13, minimumFee: '0.00', slippageBps: 0, stopLossPct: null, stopProfitPct: null }
const pct = (v: number | null) => v === null ? '无法形成结论' : `${v.toFixed(2)}%`
export function RollingValidationPanel() {
  const [sources, setSources] = useState<Array<{ value: string; label: string; count: number }>>([]), [runs, setRuns] = useState<Array<{ id: string; createdAt: number; status: string }>>([])
  const [source, setSource] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [cash, setCash] = useState('100000')
  const [train, setTrain] = useState('60'), [test, setTest] = useState('20'), [embargo, setEmbargo] = useState('5'), [folds, setFolds] = useState('3'), [holds, setHolds] = useState('1,3,5'), [min, setMin] = useState('5'), [risk, setRisk] = useState('40')
  const [plan, setPlan] = useState(defaultPlan), [confirmed, setConfirmed] = useState(false), [study, setStudy] = useState<ValidationStudy | null>(null)
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState<string | null>(null), [error, setError] = useState('')
  const stop = useRef(false), mounted = useRef(true), preparing = useRef<string | null>(null)
  async function refresh() {
    const [catalog, history] = await Promise.all([window.api.capitalSimulation.catalog(), window.api.rollingValidation.list()])
    if (!mounted.current) return
    if (catalog.ok) setSources(catalog.data.sources); else setError(catalog.message)
    if (history.ok) setRuns(history.data); else setError(history.message)
  }
  useEffect(() => { mounted.current = true; refresh().catch(() => setError('无法载入研究数据，请稍后重试。')); return () => { mounted.current = false; stop.current = true } }, [])
  async function prepare() {
    const id = crypto.randomUUID(), selected = source.startsWith('lab:') ? { kind: 'lab' as const, runId: Number(source.slice(4)) } : { kind: 'short-term' as const, key: source.slice(11) }
    const request = decodeValidationRequest({ capital: { id, source: selected, dateStart: start, dateEnd: end, funding: { kind: 'manual', cash }, plan, assumptionsConfirmed: true },
      trainDays: Number(train), testDays: Number(test), embargoDays: Number(embargo), foldCount: Number(folds), holdDays: holds.split(',').map(v => Number(v.trim())), minEntries: Number(min), maxTrainingDrawdownPct: Number(risk), confirmation: confirmed })
    if (!request) { setError('参数不完整：请核对日期、预算、候选持有期和隔离间隔，并勾选确认。'); return }
    setBusy(true); setError(''); preparing.current = id
    try {
      const result = await window.api.rollingValidation.prepare(request)
      if (!mounted.current) return
      if (result.ok) { setStudy(result.data); setUncertain(null); preparing.current = null; await refresh() }
      else { setError(result.message); if (result.code === 'STORAGE_UNAVAILABLE') setUncertain(id); else preparing.current = null }
    } catch { if (mounted.current) { setUncertain(id); setError('保存结果未知，请先按编号恢复，不重复新建。') } }
    finally { if (mounted.current) setBusy(false) }
  }
  async function load(id: string) {
    if (!id) return
    setBusy(true); setError('')
    try {
      const r = await window.api.rollingValidation.get(id)
      if (!mounted.current) return
      if (r.ok) { setStudy(r.data); setUncertain(null); preparing.current = null }
      else {
        setError(r.message)
        // Only a confirmed absence for the pending ID resolves an unknown save.
        // Storage/transport failures must retain the lock to avoid duplicate work.
        if (r.code === 'NOT_FOUND' && uncertain === id) {
          setUncertain(null); preparing.current = null
          setStudy(current => current?.id === id ? null : current)
          setError('该编号没有已保存协议。参数已保留，可核对后重新保存。')
        }
      }
    }
    catch { if (mounted.current) setError('读取结果未知，请保留研究编号。') } finally { if (mounted.current) setBusy(false) }
  }
  async function run() {
    if (!study || study.status !== 'running' || !hasFrozenValidationData(study)) return
    setBusy(true); setError(''); stop.current = false
    let current = study
    try {
      while (!stop.current && mounted.current && current.status === 'running') {
        const result = await window.api.rollingValidation.advance(current.id)
        if (!mounted.current) return
        if (!result.ok) { setError(result.message); if (result.code === 'STORAGE_UNAVAILABLE') setUncertain(current.id); break }
        current = result.data; setStudy(current)
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      if (mounted.current) await refresh()
    } catch { if (mounted.current) { setUncertain(current.id); setError('执行结果未知，请先恢复已保存步骤；不会自动重试。') } }
    finally { if (mounted.current) setBusy(false) }
  }
  const summary = study ? validationSummary(study) : null
  const number = (label: string, value: string, setter: (v: string) => void) => <label className="text-xs text-slate-600">{label}<input aria-label={label} type="number" value={value} onChange={e => setter(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
  return <div data-testid="rolling-validation-panel" className="h-full overflow-auto p-5 text-slate-800 dark:text-slate-200">
    <h2 className="text-lg font-semibold">样本外与滚动验证</h2>
    <p className="mt-2 text-sm text-slate-500">先保存协议，再只用训练收益选择持有期；隔离后逐窗运行测试。各窗口独立重置研究预算，不拼接成连续实盘净值，也不提交订单。</p>
    <p className="my-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">保存新协议时冻结整份研究的信号、行情与复权事实，训练和测试复用共同快照，不跟随缓存刷新。价格口径、历史信号当时可得性和撮合仍有研究限制。亏损测试窗口不按收益或回撤过滤；数据不足不计零收益。</p>
    {error && <p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
    {uncertain && <div className="my-3 rounded border p-3 text-sm">结果待核对 · {uncertain}<button type="button" disabled={busy} onClick={() => load(uncertain)} className="ml-3 rounded border px-3 py-2">按编号恢复</button></div>}
    <fieldset disabled={busy || uncertain !== null} className="grid grid-cols-2 gap-3 rounded border p-4 md:grid-cols-4">
      <label className="col-span-2 text-xs">滚动验证数据集<select aria-label="滚动验证数据集" value={source} onChange={e => setSource(e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">选择已保存的信号</option>{sources.map(s => <option key={s.value} value={s.value}>{s.label} · {s.count} 条</option>)}</select></label>
      <label className="text-xs">滚动验证起始日<input aria-label="滚动验证起始日" type="date" value={start} onChange={e => setStart(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="text-xs">滚动验证结束日<input aria-label="滚动验证结束日" type="date" value={end} onChange={e => setEnd(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="text-xs">每窗研究预算<input aria-label="每窗研究预算" value={cash} onChange={e => setCash(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      {number('训练开市日数', train, setTrain)}{number('测试开市日数', test, setTest)}{number('隔离开市日数', embargo, setEmbargo)}{number('测试窗口数量', folds, setFolds)}
      <label className="text-xs">候选持有期（逗号分隔）<input aria-label="候选持有期（逗号分隔）" value={holds} onChange={e => setHolds(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      {number('训练最少入场数', min, setMin)}{number('训练最大回撤（%）', risk, setRisk)}
      {(['maxPositions', 'maxPositionPct', 'cashReservePct', 'lotSize', 'feeBps', 'slippageBps'] as const).map((key, i) => number(['滚动最多持仓', '滚动单股预算（%）', '滚动现金预留（%）', '滚动买入单位', '滚动单边费率（bps）', '滚动滑点（bps）'][i], String(plan[key]), value => setPlan(p => ({ ...p, [key]: Number(value) }))))}
      <label className="text-xs">滚动最低单边费用<input aria-label="滚动最低单边费用" value={plan.minimumFee} onChange={e => setPlan(p => ({ ...p, minimumFee: e.target.value }))} className="mt-1 w-full rounded border p-2" /></label>
      <label className="col-span-2 text-xs md:col-span-4"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} aria-label="确认固定训练选择规则和独立测试窗口，不将研究结果作为实盘成交证明" /> 确认固定训练选择规则和独立测试窗口，不将研究结果作为实盘成交证明</label>
      <button type="button" disabled={!confirmed || !source} onClick={prepare} className="col-span-2 rounded bg-cyan-700 px-4 py-2 text-sm text-white">保存新验证协议</button>
    </fieldset>
    <div className="my-4 flex flex-wrap items-center gap-3"><label className="text-sm">已保存验证<select aria-label="已保存验证" value={study?.id ?? ''} disabled={busy} onChange={e => load(e.target.value)} className="ml-2 rounded border p-2"><option value="">选择协议</option>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString()} · {r.status} · {r.id.slice(0, 8)}</option>)}</select></label>
      <button type="button" disabled={busy} onClick={() => refresh().catch(() => setError('无法刷新研究。'))} className="rounded border px-3 py-2 text-sm">刷新记录</button>
      {study?.status === 'running' && <button type="button" disabled={busy || uncertain !== null || !hasFrozenValidationData(study)} onClick={run} className="rounded bg-cyan-700 px-3 py-2 text-sm text-white">运行或继续验证</button>}
      {busy && study && <button type="button" onClick={() => { stop.current = true }} className="rounded border px-3 py-2 text-sm">当前步骤完成后暂停</button>}
    </div>
    {study && summary && <section data-testid="rolling-validation-report" className="rounded border p-4">
      <p className="text-sm">研究 {study.id} · {study.status === 'completed' ? '窗口执行完成' : study.status === 'blocked' ? '研究有阻断' : busy ? '正在执行本地步骤' : '已保存，可继续'} · 报告 {study.reportsCompleted} / {study.reportsPlanned}</p>
      {hasFrozenValidationData(study) && study.marketSnapshot ? <div data-testid="rolling-frozen-facts" className="my-3 rounded border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-900">
        <p>共同冻结数据 · {study.marketSnapshot.dateStart} 至 {study.marketSnapshot.dateEnd} · 信号 {study.marketSnapshot.signalCount} 条 · 日线 {study.marketSnapshot.barCount} 条</p>
        <p className="break-all">数据摘要 {study.marketSnapshot.digest}</p>
        <p>冻结于 {new Date(study.marketSnapshot.createdAt).toLocaleString()}；复现研究输入，不证明这些信号在历史当时已经可得。</p>
      </div> : <p data-testid="rolling-legacy-facts" className="my-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">旧协议未冻结共同数据：原结果保留可读，但不能继续追加报告。请核对上方参数后另存新协议；不会改写旧研究。</p>}
      <progress aria-label="滚动验证报告进度" className="my-3 w-full" max={study.reportsPlanned} value={study.reportsCompleted} />
      {study.blockedReason && <p className="text-sm text-red-700">{study.blockedReason}</p>}
      <p className="text-xs text-slate-500">固定规则：训练净收益降序、回撤升序、预设候选顺序。同一来源、每窗预算 {study.request.capital.funding.kind === 'manual' ? study.request.capital.funding.cash : '未知'}；未使用区间尾部 {study.unusedMarketDays} 个开市日。日历摘要 {study.calendarFingerprint}。</p>
      <div className="my-4 grid grid-cols-2 gap-3 md:grid-cols-4"><p>有效测试窗口 {summary.usable} / {study.folds.length}</p><p>样本外收益均值 {pct(summary.meanTest)}</p><p>训练与测试均值差 {pct(summary.degradation)}</p><p>样本外最差回撤 {pct(summary.worstDrawdown)}</p></div>
      <p className="mb-3 text-xs text-slate-500">均值是独立窗口统计，不是复利或年化收益。少于 3 个有效窗口不足以讨论稳定性；历史信号时点限制仍适用。</p>
      {study.folds.map((fold, i) => <details key={fold.testId} className="border-t py-3" open><summary className="text-sm">窗口 {i + 1} · 训练 {fold.trainStart} 至 {fold.trainEnd} · 测试 {fold.testStart} 至 {fold.testEnd}</summary>
        <p className="mt-2 text-xs">训练选择：{fold.selected === null ? '尚未固定' : `${fold.candidates[fold.selected].holdDays} 个开市日持有期`} · 样本外：{fold.test === null ? '尚未运行' : pct(fold.test.returnPct)} · 测试入场 {fold.test?.entries ?? '—'} · 未平持仓 {fold.test?.openPositions ?? '—'}</p>
        <p className="mt-1 break-all text-xs text-slate-500">测试报告 {fold.test?.reportId ?? '未生成'} · 事实摘要 {fold.test?.factsFingerprint ?? '未生成'}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">{fold.candidates.map(c => <span key={c.id}>持有 {c.holdDays} 日：{c.result ? `${pct(c.result.returnPct)} / 入场 ${c.result.entries}` : '待运行'}</span>)}</div>
      </details>)}
    </section>}
  </div>
}
