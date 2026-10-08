import React, { useEffect, useState } from 'react'
import type { HistoricalDailyProgressSnapshot } from '../../../electron/shared/historicalDailyProgress'

export type HistoricalDailyProgressResponse =
  | { ok: true; data: HistoricalDailyProgressSnapshot }
  | { ok: false; message: string }

export interface HistoricalDailyProgressReadState {
  snapshot: HistoricalDailyProgressSnapshot | null
  fetchedAt: number | null
  reading: boolean
  error: 'failed' | 'timeout' | null
  nextReadAt: number | null
}

const initialState: HistoricalDailyProgressReadState = {
  snapshot: null, fetchedAt: null, reading: false, error: null, nextReadAt: null,
}
const ACTIVE_INTERVAL = 3_000
const INACTIVE_INTERVAL = 10_000
const READ_TIMEOUT = 12_000

function isActive(snapshot: HistoricalDailyProgressSnapshot | null) {
  return snapshot?.status === 'preparing' || snapshot?.status === 'running' || snapshot?.status === 'waiting'
}

// Share the actual IPC flight across cards and StrictMode effect remounts.
// A timeout cannot cancel ipcRenderer.invoke: never release its lock on timeout.
export function createHistoricalDailyProgressReader(read: () => Promise<HistoricalDailyProgressResponse>) {
  let flight: Promise<HistoricalDailyProgressResponse> | null = null
  return () => {
    if (!flight) {
      const request = Promise.resolve().then(read)
      flight = request
      const release = () => { if (flight === request) flight = null }
      void request.then(release, release)
    }
    return flight
  }
}

const readProgress = createHistoricalDailyProgressReader(
  () => window.api.diagnostics.getHistoricalDailyProgress(),
)

export function startHistoricalDailyProgressPolling(options: {
  read: () => Promise<HistoricalDailyProgressResponse>
  onChange: (state: HistoricalDailyProgressReadState) => void
  isVisible?: () => boolean
}) {
  let state = { ...initialState }
  let alive = true
  let pending = false
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  const visible = options.isVisible ?? (() => true)
  const publish = (patch: Partial<HistoricalDailyProgressReadState>) => {
    if (!alive) return
    state = { ...state, ...patch }
    options.onChange(state)
  }
  const schedule = () => {
    if (!alive || !visible()) return
    const delay = isActive(state.snapshot) ? ACTIVE_INTERVAL : INACTIVE_INTERVAL
    publish({ nextReadAt: Date.now() + delay })
    pollTimer = setTimeout(refresh, delay)
  }
  function refresh() {
    if (!alive) return
    clearTimeout(pollTimer)
    publish({ nextReadAt: null })
    if (pending || !visible()) return
    pending = true
    publish({ reading: true })
    timeoutTimer = setTimeout(() => publish({ error: 'timeout' }), READ_TIMEOUT)
    // Both synchronous throws and rejected IPC promises use fixed, safe UI text.
    void Promise.resolve().then(options.read).then(result => {
      if (!alive) return
      if (result.ok) {
        publish({ snapshot: result.data, fetchedAt: Date.now(), error: null })
      } else {
        publish({ error: 'failed' })
      }
    }, () => publish({ error: 'failed' })).finally(() => {
      pending = false
      clearTimeout(timeoutTimer)
      if (!alive) return
      publish({ reading: false })
      schedule()
    })
  }
  refresh()
  return {
    refresh,
    stop() {
      alive = false
      clearTimeout(pollTimer)
      clearTimeout(timeoutTimer)
    },
  }
}

const statuses: Record<HistoricalDailyProgressSnapshot['status'], {
  label: string; phase: string; detail: string; color: string
}> = {
  preparing: {
    label: '准备股票列表', phase: '准备', detail: '后台任务正在准备股票列表；总股票数尚未确定。',
    color: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  },
  idle: {
    label: '空闲', phase: '未运行', detail: '当前没有运行中的历史日线任务。',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  running: {
    label: '运行中', phase: '运行', detail: '历史日线后台任务正在运行；下方展示最近记录的进度。',
    color: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  },
  waiting: {
    label: '批次等待中', phase: '等待', detail: '后台任务仍在运行，目前处于批次间隔；不代表任务已停止。',
    color: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  interrupted: {
    label: '已中断', phase: '结束', detail: '上次记录显示任务正在运行，但当前后台任务已中断；本卡片不会自动重启任务。',
    color: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  success: {
    label: '本轮处理完成', phase: '结束', detail: '本轮任务已结束，数据质量仍需单独核对。',
    color: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  },
  partial: {
    label: '部分完成', phase: '结束', detail: '本轮任务已结束，仍有未完成项；请结合数据质量结果核对。',
    color: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  failed: {
    label: '本轮失败', phase: '结束', detail: '本轮任务已结束，进度记录不代表有效数据已补齐。',
    color: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  },
  cooldown: {
    label: '已停止 · 来源冷却', phase: '结束', detail: '任务已停止，正在等待来源冷却；冷却到期不会自动恢复或重启任务。',
    color: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
}

function count(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function timestamp(value: number | null, fallback = '暂无记录') {
  if (value === null || !Number.isFinite(value)) return fallback
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return fallback
  return date.toLocaleString('zh-CN', { hour12: false })
}

function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  if (value < 60) return `${value} 秒`
  if (value < 3600) return `${Math.floor(value / 60)} 分 ${value % 60} 秒`
  return `${Math.floor(value / 3600)} 小时 ${Math.floor(value % 3600 / 60)} 分 ${value % 60} 秒`
}

export interface HistoricalDailyProgressCardViewProps extends HistoricalDailyProgressReadState {
  now: number
  onRefresh?: () => void
  className?: string
}

export function HistoricalDailyProgressCardView({
  snapshot, fetchedAt, reading, error, nextReadAt, now, onRefresh, className = '',
}: HistoricalDailyProgressCardViewProps) {
  const status = snapshot ? statuses[snapshot.status] : null
  const total = snapshot && snapshot.status !== 'preparing' ? count(snapshot.totalItems) : 0
  const processed = snapshot ? count(snapshot.processedItems) : 0
  // Floor the display so that 999/1000 cannot be rounded into "100%".
  const percent = total > 0 ? Math.min(100, Math.floor(processed / total * 1000) / 10) : null
  const remaining = snapshot?.resumeAt != null ? Math.max(0, Math.ceil((snapshot.resumeAt - now) / 1000)) : null

  return (
    <section aria-label="免费历史日线实时进度"
      className={`border border-gray-200 dark:border-gray-700 rounded-lg p-5 space-y-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium text-sm text-gray-900 dark:text-gray-100">免费历史日线实时进度</h3>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" aria-live="polite" className={`rounded px-2 py-1 text-xs ${status?.color ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
            {status ? `${status.phase} · ${status.label}` : '正在读取进度'}
          </span>
          {onRefresh && <button type="button" onClick={onRefresh} disabled={reading}
            className="text-xs px-3 py-2 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">
            {reading ? '正在读取进度' : '刷新进度'}
          </button>}
        </div>
      </div>

      {error && <p role="alert" className="rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3 text-xs text-amber-800 dark:text-amber-300">
        {error === 'timeout'
          ? '进度读取超时，暂未更新。保留上次结果，正在等待当前请求返回；不会重复发送请求。'
          : snapshot
            ? '上次读取失败，进度暂未更新；保留上次结果，不代表任务已停止或完成。'
            : '进度暂不可读取，尚未成功更新；请等待接口就绪后刷新。'}
      </p>}
      {snapshot?.stale && <p role="alert" className="rounded border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
        超过90秒未记录新进度，可能仍在等待来源响应；不能据此判断任务已完成。
      </p>}

      {!snapshot ? <p className="text-xs text-gray-500 dark:text-gray-400">
        正在读取进度，尚未取得快照，不能判断任务状态。
      </p> : <>
        <p className="text-xs text-gray-600 dark:text-gray-300">{status?.detail}</p>
        <div className="flex flex-wrap items-end justify-between gap-2 text-sm">
          <span>已处理 / 总股票：<strong className="tabular-nums">{processed.toLocaleString('zh-CN')} / {total > 0 ? total.toLocaleString('zh-CN') : '未知'}</strong></span>
          <span className="font-medium tabular-nums">{percent === null ? '总量未知，暂无百分比' : `${percent}%`}</span>
        </div>
        <div role="progressbar" aria-label="股票处理进度" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? '总股票数未知' : `${percent}%`}
          className="h-2 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
          <div className="h-full rounded bg-blue-500" style={{ width: `${percent ?? 0}%` }} />
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
          <div><dt className="text-gray-500 dark:text-gray-400">本轮写入行数（非净新增）</dt><dd className="mt-1 tabular-nums">{count(snapshot.writtenRows).toLocaleString('zh-CN')}</dd></div>
          <div><dt className="text-gray-500 dark:text-gray-400">最近记录股票（不保证正在请求）</dt><dd className="mt-1 break-all">{snapshot.currentItem || '暂无记录'}</dd></div>
          <div><dt className="text-gray-500 dark:text-gray-400">开始时间</dt><dd className="mt-1">{timestamp(snapshot.startedAt, snapshot.status === 'preparing' ? '尚未记录' : '尚未开始')}</dd></div>
          <div><dt className="text-gray-500 dark:text-gray-400">最近进度更新时间</dt><dd className="mt-1">{timestamp(snapshot.updatedAt)}{snapshot.updatedAt !== null && `（${duration((now - snapshot.updatedAt) / 1000)}前）`}</dd></div>
          {snapshot.completedAt !== null && <div><dt className="text-gray-500 dark:text-gray-400">结束时间</dt><dd className="mt-1">{timestamp(snapshot.completedAt)}</dd></div>}
        </dl>
        {remaining !== null && (snapshot.status === 'waiting' || snapshot.status === 'cooldown') && <p className="text-xs text-amber-800 dark:text-amber-300">
          {snapshot.status === 'cooldown'
            ? remaining > 0 ? `冷却参考剩余 ${duration(remaining)}；到期不会自动重启任务。` : '参考冷却时间已到，任务仍已停止。'
            : remaining > 0 ? `批次等待参考剩余 ${duration(remaining)}；到时仍以最新状态为准。` : '参考等待时间已到，等待最新批次状态。'}
        </p>}
        <p className="text-xs text-gray-500 dark:text-gray-400">已处理股票包含成功与失败，也包含以前已完成项；处理进度达到 100% 不等于数据质量合格，也不代表每只股票都有有效日线。</p>
      </>}

      <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 dark:border-gray-800 pt-3 text-xs text-gray-500 dark:text-gray-400">
        <span>最近成功读取：{timestamp(fetchedAt, '尚未成功读取')}{fetchedAt !== null && `（${duration((now - fetchedAt) / 1000)}前）`}</span>
        <span>{reading
          ? error === 'timeout' ? '等待当前读取返回' : '正在读取最新状态'
          : nextReadAt !== null ? `${Math.max(0, Math.ceil((nextReadAt - now) / 1000))} 秒后刷新进度` : '返回页面时立即读取进度'}</span>
      </div>
    </section>
  )
}

export function HistoricalDailyProgressCard({ className }: { className?: string }) {
  const [state, setState] = useState<HistoricalDailyProgressReadState>(initialState)
  const [now, setNow] = useState(() => Date.now())
  const [refresh, setRefresh] = useState<(() => void) | undefined>()

  useEffect(() => {
    const polling = startHistoricalDailyProgressPolling({
      read: readProgress, onChange: setState, isVisible: () => document.visibilityState !== 'hidden',
    })
    setRefresh(() => polling.refresh)
    const onReturn = () => {
      setNow(Date.now())
      polling.refresh()
    }
    const clock = setInterval(() => {
      if (document.visibilityState !== 'hidden') setNow(Date.now())
    }, 1_000)
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      polling.stop()
      clearInterval(clock)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [])

  return <HistoricalDailyProgressCardView {...state} now={now} onRefresh={refresh} className={className} />
}

export default HistoricalDailyProgressCard
