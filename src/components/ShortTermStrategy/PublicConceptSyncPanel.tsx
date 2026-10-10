import { useEffect, useRef, useState } from 'react'
import type { PublicConceptSyncFailure, PublicConceptSyncStatus } from '../../../electron/shared/publicConceptSnapshots'

const LABELS: Record<PublicConceptSyncStatus['state'], string> = {
  idle: '尚未开始本轮同步', running: '正在同步', completed: '本轮索引中的板块已同步',
  partial: '部分成功，请检查失败项后重试', failed: '未取得可保存的数据', cancelled: '已取消或达到时间上限',
}

const FAILURE_LABELS: Record<PublicConceptSyncFailure['reason'], string> = {
  SOURCE_COUNT_MISMATCH: '源站数量接口与实际名单不一致，数据未入库',
  UPSTREAM_EMPTY: '源站未返回可保存的当前成分',
  UPSTREAM_FAILED: '源站请求失败，请稍后重试',
  FACT_INVALID: '源站数据格式或完整性校验未通过',
  BOARD_REQUEST_OR_WRITE_FAILED: '请求或本地保存失败，请稍后重试',
}

export function PublicConceptSyncPanel({ open }: { open: boolean }): JSX.Element {
  const [status, setStatus] = useState<PublicConceptSyncStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [revision, setRevision] = useState(0)
  const live = useRef(false)
  useEffect(() => {
    live.current = open
    return () => { live.current = false }
  }, [open])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const reply = await window.api.shortTerm.getPublicConceptSyncStatus()
        if (cancelled) return
        if (!reply.ok) throw new Error('STATUS_FAILED')
        setStatus(reply.status)
        setError(null)
        if (reply.status.state === 'running') timer = setTimeout(poll, 1500)
      } catch {
        if (!cancelled) setError('读取同步状态失败，请点击重新检查。已有缓存不会被清除。')
      }
    }
    void poll()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [open, revision])
  const act = async (cancel = false) => {
    if (starting || !open || (!cancel && status?.state === 'running')) return
    setStarting(true)
    try {
      const reply = cancel ? await window.api.shortTerm.cancelPublicConceptSync()
        : await window.api.shortTerm.syncPublicConceptSnapshots()
      if (!live.current) return
      if (!reply.ok) throw new Error('ACTION_FAILED')
      setStatus(reply.status)
      setError(null)
      setRevision(value => value + 1)
    } catch {
      if (live.current) setError('操作未完成，请重新检查同步状态；不会报告同步成功。')
    } finally { setStarting(false) }
  }
  const busy = starting || status?.state === 'running'
  return (
    <section aria-label="免费当前题材同步" className="rounded-md border border-cyan-200 bg-cyan-50/50 p-4 dark:border-cyan-900 dark:bg-cyan-950/20">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">免费当前题材 · 东方财富 / 新浪兜底</h3>
      <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">无需 Tushare Token 或额外 Python 环境；东方财富不可用时自动尝试新浪，两者题材口径可能不同。只保存采集时的题材成分，不提供历史成分，也不会自动替换策略使用的历史题材。</p>
      <div className="mt-3 space-y-1 text-xs leading-5 text-slate-600 dark:text-slate-300" role="status" aria-live="polite">
        <p>{status ? LABELS[status.state] : '正在读取缓存状态'}</p>
        {status && <>
          <p>本轮已处理 {status.attemptedBoards}/{status.totalBoards || '待确认'} 个板块；保存 {status.savedBoards}，失败 {status.failedBoards}。</p>
          <p>本地累计缓存 {status.cachedBoards} 个板块、{status.cachedMembers} 条成员记录（包含旧观察，不代表本轮覆盖）。</p>
          <p>最近采集：{status.latestObservedAt ? new Date(status.latestObservedAt).toLocaleString() : '暂无'}</p>
        </>}
        {error && <p className="text-amber-800 dark:text-amber-300">{error}</p>}
      </div>
      {!!status?.failures?.length && <div aria-label="题材同步失败详情" className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <p className="font-semibold">本轮失败详情（最多显示 8 项）</p>
        <ul className="mt-1 space-y-2">
          {status.failures.map((failure, index) => <li key={`${failure.conceptCode}:${index}`}>
            <p>{failure.conceptName}（{failure.conceptCode}）：{FAILURE_LABELS[failure.reason]}</p>
            {failure.countMismatch && <p>数量接口报 {failure.countMismatch.reportedTotal} 条；第 {failure.countMismatch.page} 页预期 {failure.countMismatch.expectedPageRows} 条，实际返回 {failure.countMismatch.receivedPageRows} 条。这是源站数据不一致，无需重新填写 Tushare Token。</p>}
          </li>)}
        </ul>
        <p className="mt-2">失败题材的旧缓存不会被清除；有缓存不代表本轮同步成功。</p>
      </div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void act()} className="min-h-10 rounded-md bg-cyan-700 px-3 text-xs font-semibold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? '同步处理中' : '同步全部当前题材'}</button>
        {status?.state === 'running' && <button type="button" disabled={starting} onClick={() => void act(true)} className="min-h-10 rounded-md border border-slate-300 px-3 text-xs disabled:opacity-50">取消同步</button>}
        <button type="button" onClick={() => setRevision(value => value + 1)} className="min-h-10 rounded-md border border-slate-300 px-3 text-xs">重新检查</button>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">任务在后台执行；关闭此面板不会取消，重新打开可查看进度。遇到连续失败会停止采集，已保存的观察保留；网络接口可用性仍需实际使用验证。</p>
    </section>
  )
}
