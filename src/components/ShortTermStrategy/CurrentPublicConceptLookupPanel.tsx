import { useEffect, useRef, useState } from 'react'
import type { CurrentPublicConceptLookup } from '../../../electron/shared/publicConceptSnapshots'

export function CurrentPublicConceptLookupPanel({ open }: { open: boolean }): JSX.Element {
  const [code, setCode] = useState('')
  const [result, setResult] = useState<CurrentPublicConceptLookup | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const sequence = useRef(0)
  useEffect(() => {
    sequence.current++
    setPending(false)
    return () => { sequence.current++ }
  }, [open])
  const lookup = async () => {
    if (!open || pending) return
    const request = ++sequence.current
    setPending(true)
    setResult(null)
    setMessage(null)
    try {
      const reply = await window.api.shortTerm.lookupCurrentPublicConcepts(code)
      if (request !== sequence.current) return
      if (reply.ok) setResult(reply.data)
      else setMessage(`${reply.message} ${reply.action} 问题编号：${reply.correlationId}`)
    } catch {
      if (request === sequence.current) setMessage('查询通信失败，请重试。没有修改缓存或策略配置。')
    } finally {
      if (request === sequence.current) setPending(false)
    }
  }
  return <section aria-label="免费题材股票查询" className="mt-3 rounded-md border border-cyan-200 bg-white p-3 dark:border-cyan-900 dark:bg-slate-900">
    <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">按股票查免费题材</h4>
    <form className="mt-2 flex gap-2" onSubmit={event => { event.preventDefault(); void lookup() }}>
      <input aria-label="查询题材的股票代码" value={code} maxLength={20} placeholder="600000 或 600000.SH"
        onChange={event => { sequence.current++; setCode(event.target.value); setResult(null); setMessage(null); setPending(false) }}
        className="min-w-0 flex-1 rounded-md border border-slate-300 bg-transparent px-2 text-xs dark:border-slate-700" />
      <button type="submit" disabled={pending || !code.trim()} className="min-h-10 shrink-0 rounded-md bg-cyan-700 px-3 text-xs font-semibold text-white disabled:opacity-50">{pending ? '查询中' : '查询本地题材'}</button>
    </form>
    <div role="status" aria-live="polite" className="mt-2 space-y-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
      {message && <p className="text-amber-800 dark:text-amber-300">{message}</p>}
      {result?.state === 'cache-missing' && <p>尚未建立免费题材缓存，请先点击「同步全部当前题材」。</p>}
      {result?.state === 'not-cached' && <p>当前缓存中未找到 {result.query} 的有效记录。这不代表该股票没有题材；请同步后重查。</p>}
      {!!result?.rows.length && <ul className="max-h-64 space-y-2 overflow-y-auto">
        {result.rows.map(row => <li key={`${row.source}:${row.conceptCode}`} className="rounded border border-slate-100 px-2 py-1.5 dark:border-slate-800">
          <p className="font-medium">{row.conceptName} · {row.stockName}（{row.tsCode}）</p>
          <p>{row.source === 'eastmoney_public' ? '东方财富' : '新浪'} · 采集于 {new Date(row.observedAt).toLocaleString()}</p>
          {row.age === 'older-than-24h' && <p className="text-amber-800 dark:text-amber-300">采集已超过 24 小时，请同步确认最新成分。</p>}
        </li>)}
      </ul>}
      {result?.truncated && <p>本次最多查询 50 个匹配板块，不代表完整覆盖。</p>}
      {!!result?.discardedBoards && <p>有 {result.discardedBoards} 个匹配缓存未通过校验，未用于展示。</p>}
    </div>
    <p className="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">只读本地采集观察，无需 Token 或 Python。它不补齐历史题材、竞价或涨停数据，不修改所选策略数据源，也不能直接作为历史回测依据。</p>
  </section>
}
