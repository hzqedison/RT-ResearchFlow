import { useCallback, useEffect, useRef, useState } from 'react'
import { FACT_REASON_MESSAGES, type FactSyncReceipt } from '../../../electron/shared/dataReadiness'
import { useAppStore, type ShortTermSubTab } from '../../store/appStore'
import { MorningAuction } from './MorningAuction'
import { ClosingHalfHour } from './ClosingHalfHour'
import { LimitBoardMonitor } from './LimitBoardMonitor'
import { SecondBoardLeader } from './SecondBoardLeader'
import { FirstYinDip } from './FirstYinDip'
import { DipBuyRadar } from './DipBuyRadar'
import { ChipMonitor } from './ChipMonitor'
import { StrategyLab } from './StrategyLab/StrategyLab'
import { StrategyBacktestPanel } from '../StrategyBacktest/StrategyBacktestPanel'
import {
  ConceptDataToolsButton,
  ShortTermDataToolsDrawer,
  conceptSourceName,
  type ConceptDataSource,
} from './ShortTermDataToolsDrawer'

export { SHORT_TERM_SUB_TABS } from './shortTermNavigation'

function isStrategyLabSubTab(subTab: ShortTermSubTab): boolean {
  return subTab === 'strategyLab' || subTab === 'personalScreener' || subTab === 'conditionBlocks'
}

export function ShortTermStrategy(): JSX.Element {
  const subTab = useAppStore((s) => s.shortTermActiveSubTab)
  const setShortTermActiveSubTab = useAppStore((s) => s.setShortTermActiveSubTab)
  const [backtestEntry, setBacktestEntry] = useState<{ initialView: 'history'; strategyKey: string } | null>(null)
  const [tushareReady, setTushareReady] = useState<boolean | null>(null)
  const [checkingTushare, setCheckingTushare] = useState(false)
  const [tushareCheckError, setTushareCheckError] = useState<string | null>(null)
  const [syncingMembers, setSyncingMembers] = useState(false)
  const [changingSource, setChangingSource] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [syncMenuOpen, setSyncMenuOpen] = useState(false)
  const [syncingConcepts, setSyncingConcepts] = useState(false)
  const [conceptsProgress, setConceptsProgress] = useState<{ done: number; total: number } | null>(null)
  const [conceptSource, setConceptSourceState] = useState<ConceptDataSource>('kpl')
  // null=未检查, true=数据充足, false=没有本地数据
  const [thsOrDcReady, setThsOrDcReady] = useState<boolean | null>(null)
  // THS 最近一次同步时间戳（ms）
  const [thsSyncedAt, setThsSyncedAt] = useState<number | null>(null)
  // THS/DC 题材成分同步进度
  const [thsSyncProgress, setThsSyncProgress] = useState<{ current: number; total: number; message: string } | null>(null)
  const conceptsCleanupRef = useRef<Array<() => void>>([])
  const mountedRef = useRef(true)
  const configRequestRef = useRef(0)
  const sourceRequestRef = useRef(0)
  const statusRequestRef = useRef(0)
  const operationRequestRef = useRef(0)
  const operationRef = useRef<'base' | 'members' | 'all' | 'source' | null>(null)
  const conceptSourceRef = useRef<ConceptDataSource>('kpl')

  // 仅检查配置标志，不读取 Token，也不推断接口权限。
  const refreshTushareStatus = useCallback(async (): Promise<void> => {
    const request = ++configRequestRef.current
    setCheckingTushare(true)
    setTushareReady(null)
    setTushareCheckError(null)
    try {
      const cfg = await window.api.datasource.getConfig()
      if (mountedRef.current && request === configRequestRef.current) {
        setTushareReady(!!(cfg?.tushareEnabled && cfg?.hasTushareToken))
      }
    } catch {
      if (mountedRef.current && request === configRequestRef.current) {
        setTushareCheckError('配置状态读取失败，请点击刷新重试；无法确认当前配置。')
      }
    } finally {
      if (mountedRef.current && request === configRequestRef.current) setCheckingTushare(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refreshTushareStatus()
    return () => {
      mountedRef.current = false
      ++configRequestRef.current
      ++sourceRequestRef.current
      ++statusRequestRef.current
      ++operationRequestRef.current
      operationRef.current = null
      conceptsCleanupRef.current.forEach(fn => fn())
      conceptsCleanupRef.current = []
    }
  }, [refreshTushareStatus])

  useEffect(() => {
    if (syncMenuOpen) void refreshTushareStatus()
  }, [syncMenuOpen, refreshTushareStatus])

  // 进入短线策略 Tab 时立即触发 rt_k 缓存刷新（30s 防抖由 handler 控制）
  useEffect(() => {
    void window.api.shortTerm.refreshRtKNow()
  }, [])

  // FR-153: 检查指定数据源的本地数据量
  const checkConceptDataStatus = async (source: ConceptDataSource): Promise<void> => {
    const request = ++statusRequestRef.current
    const isCurrent = (): boolean => mountedRef.current && request === statusRequestRef.current && source === conceptSourceRef.current
    if (!isCurrent()) return
    if (source === 'kpl') { setThsOrDcReady(true); setThsSyncedAt(null); return }
    try {
      const r = await window.api.shortTerm.getConceptDataStatus()
      if (!isCurrent()) return
      // 存储 THS 的同步时间（DC 暂不需要）
      setThsSyncedAt(r.thsSyncedAt)
      if (source === 'ths') {
        const ready = r.thsCount > 0
        console.log(`[ShortTermStrategy] THS 数据检查: thsCount=${r.thsCount}, syncedAt=${r.thsSyncedAt}, ready=${ready}`)
        setThsOrDcReady(ready)
      } else {
        const ready = r.dcHasData
        console.log(`[ShortTermStrategy] DC 数据检查: dcHasData=${r.dcHasData}, ready=${ready}`)
        setThsOrDcReady(ready)
      }
    } catch (err) {
      if (!isCurrent()) return
      console.warn('[ShortTermStrategy] getConceptDataStatus 失败:', err)
      setThsOrDcReady(false)
    }
  }

  // FR-153: 读取题材数据源初始值
  useEffect(() => {
    let cancelled = false
    const request = sourceRequestRef.current
    void (async () => {
      try {
        const r = await window.api.shortTerm.getConceptSource()
        if (!cancelled && mountedRef.current && request === sourceRequestRef.current && r.ok) {
          conceptSourceRef.current = r.source
          setConceptSourceState(r.source)
          await checkConceptDataStatus(r.source)
        }
      } catch { /* 静默 */ }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleConceptSourceChange = async (val: ConceptDataSource): Promise<void> => {
    if (!mountedRef.current || operationRef.current || val === conceptSourceRef.current) return
    operationRef.current = 'source'
    const operation = ++operationRequestRef.current
    const isCurrent = (): boolean => mountedRef.current && operation === operationRequestRef.current
    const previous = conceptSourceRef.current
    ++sourceRequestRef.current
    ++statusRequestRef.current
    conceptSourceRef.current = val
    setChangingSource(true)
    setSyncMsg(null)
    setThsSyncProgress(null)
    setThsSyncedAt(null)
    setConceptSourceState(val)
    setThsOrDcReady(null)  // 切换时先设 null，等待检查完成
    try {
      const r = await window.api.shortTerm.setConceptSource(val)
      if (!isCurrent()) return
      if (!r.ok) throw new Error(r.error)
      await checkConceptDataStatus(val)
    } catch (err) {
      if (!isCurrent()) return
      conceptSourceRef.current = previous
      setConceptSourceState(previous)
      setSyncMsg(`题材来源切换失败：${err instanceof Error ? err.message : String(err)}`)
      await checkConceptDataStatus(previous)
    } finally {
      if (isCurrent()) {
        operationRef.current = null
        setChangingSource(false)
      }
    }
  }

  const handleSyncConceptMembers = async (): Promise<void> => {
    if (!mountedRef.current || operationRef.current || tushareReady !== true) return
    operationRef.current = 'members'
    const operation = ++operationRequestRef.current
    const source = conceptSourceRef.current
    const isCurrent = (): boolean => mountedRef.current && operation === operationRequestRef.current
    setSyncingMembers(true)
    setSyncMsg(null)
    setThsSyncProgress({ current: 0, total: 0, message: `正在请求${conceptSourceName(source)}题材，等待写入回执` })
    try {
      // IPC 增加 receipt 字段，保留 preload 的既有 ok/error 契约。
      const r = await window.api.shortTerm.syncConceptMembers(source) as
        ({ ok: true } | { ok: false; error: string }) & Partial<FactSyncReceipt>
      if (!isCurrent()) return
      if (r.outcome) {
        const labels: Record<FactSyncReceipt['outcome'], string> = {
          success: '本次事实已保存', partial: '本次同步不完整', empty: '本次未取得有效数据',
          blocked: '本次同步受阻', failed: '本次同步失败', waiting: '等待采集条件', started: '后台已提交，尚未确认写入',
        }
        const reason = r.reasonCode ?? 'UPSTREAM_FAILED'
        setSyncMsg(`「${conceptSourceName(source)}」${labels[r.outcome]}：${FACT_REASON_MESSAGES[reason] ?? reason} 写入 ${r.insertedRows ?? 0} 行${r.targetDate ? `，目标日 ${r.targetDate}` : ''}。`)
      } else {
        setSyncMsg(r.ok ? '未返回题材写入回执，无法确认同步完成。' : `题材同步失败：${FACT_REASON_MESSAGES[r.error] ?? r.error}`)
      }
      await checkConceptDataStatus(source)
    } catch (err) {
      if (isCurrent()) setSyncMsg(`题材同步调用失败，无法确认写入结果：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (isCurrent()) {
        operationRef.current = null
        setSyncingMembers(false)
        setThsSyncProgress(null)
      }
    }
  }

  const handleSync = async (): Promise<void> => {
    if (!mountedRef.current || operationRef.current || tushareReady !== true) return
    operationRef.current = 'base'
    const operation = ++operationRequestRef.current
    const isCurrent = (): boolean => mountedRef.current && operation === operationRequestRef.current
    setSyncing(true)
    setSyncMsg(null)
    try {
      const messages: string[] = []
      const tasks = [['afterCloseDaily', '盘后日数据'], ['topList', '龙虎榜']] as const
      for (const [task, label] of tasks) {
        if (!isCurrent()) return
        try {
          const r = await window.api.shortTerm.syncDataNow(task)
          messages.push(r.ok ? `${label}：后台任务已提交，尚未确认写入完成。` : `${label}：提交失败，${FACT_REASON_MESSAGES[r.error] ?? r.error}`)
        } catch (err) {
          messages.push(`${label}：提交调用失败，${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (isCurrent()) setSyncMsg(messages.join('\n'))
    } finally {
      if (isCurrent()) {
        operationRef.current = null
        setSyncing(false)
      }
    }
  }

  const handleSyncAllConcepts = async (): Promise<void> => {
    if (!mountedRef.current || operationRef.current || tushareReady !== true) return
    operationRef.current = 'all'
    const operation = ++operationRequestRef.current
    const isCurrent = (): boolean => mountedRef.current && operation === operationRequestRef.current && operationRef.current === 'all'
    // 清理上次的事件监听
    conceptsCleanupRef.current.forEach(fn => fn())
    conceptsCleanupRef.current = []
    setSyncingConcepts(true)
    setConceptsProgress(null)
    setSyncMsg(null)
    const cleanProgress = window.api.shortTerm.screener.onSyncConceptsProgress(p => {
      if (!isCurrent()) return
      setConceptsProgress(p)
    })
    const cleanDone = window.api.shortTerm.screener.onSyncConceptsDone(r => {
      if (!isCurrent()) return
      operationRef.current = null
      setSyncingConcepts(false)
      setConceptsProgress(null)
      conceptsCleanupRef.current.forEach(fn => fn())
      conceptsCleanupRef.current = []
      setSyncMsg(`题材同步完成：扫描 ${r.total} 只股票，写入 ${r.inserted} 条新记录`)
    })
    conceptsCleanupRef.current = [cleanProgress, cleanDone]

    try {
      const r = await window.api.shortTerm.screener.syncAllConcepts()
      if (!isCurrent()) return
      if (!r.ok) {
        operationRef.current = null
        const code = (r as { code?: string }).code
        setSyncMsg(
          code === 'TUSHARE_DISABLED'
            ? 'Tushare 未配置，无法同步题材'
            : code === 'STOCK_BASIC_NOT_READY'
              ? 'stock_basic 尚未初始化，请先同步盘后数据'
              : `题材同步失败：${(r as { error: string }).error}`
        )
        setSyncingConcepts(false)
        conceptsCleanupRef.current.forEach(fn => fn())
        conceptsCleanupRef.current = []
      }
    } catch (err) {
      if (!isCurrent()) return
      operationRef.current = null
      setSyncMsg(`题材同步失败：${err instanceof Error ? err.message : String(err)}`)
      setSyncingConcepts(false)
      conceptsCleanupRef.current.forEach(fn => fn())
      conceptsCleanupRef.current = []
    }
  }


  // 当前 THS/DC 源持续订阅，兼容后台同步；进度不代表成功回执。
  useEffect(() => {
    setThsSyncProgress(null)
    if (conceptSource === 'kpl') return
    let active = true
    const cleanup = window.api.shortTerm.onConceptSyncProgress(p => {
      if (active && mountedRef.current && p.source === conceptSource && conceptSourceRef.current === conceptSource) {
        setThsSyncProgress({ current: p.current, total: p.total, message: p.message })
      }
    })
    return () => {
      active = false
      cleanup()
    }
  }, [conceptSource])

  const compactDataTools = (
    <ConceptDataToolsButton
      source={conceptSource}
      onClick={() => setSyncMenuOpen(true)}
    />
  )
  const workbenchDataTools = (
    <ConceptDataToolsButton
      source={conceptSource}
      onClick={() => setSyncMenuOpen(true)}
      variant="workbench"
    />
  )

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-white dark:bg-slate-900">
      {syncMsg && (
        <div className="absolute right-3 top-3 z-40 max-w-md whitespace-pre-line rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 shadow-lg dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200" role="status">
          {syncMsg}
        </div>
      )}

      {/* 子 Tab 内容区 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {subTab === 'morningAuction' && (
          <MorningAuction dataTools={compactDataTools} onOpenDataTools={() => setSyncMenuOpen(true)} />
        )}
        {subTab === 'closingHalfHour' && (
          <ClosingHalfHour
            dataTools={workbenchDataTools}
            onOpenHistory={() => {
              setBacktestEntry({ initialView: 'history', strategyKey: 'shortTerm.closingHalfHour' })
              void setShortTermActiveSubTab('strategyBacktest')
            }}
          />
        )}
        {subTab === 'limitBoardMonitor' && (
          <LimitBoardMonitor
            dataTools={workbenchDataTools}
            onOpenHistory={() => {
              setBacktestEntry({ initialView: 'history', strategyKey: 'shortTerm.limitBoardMonitor' })
              void setShortTermActiveSubTab('strategyBacktest')
            }}
          />
        )}
        {subTab === 'secondBoardLeader' && (
          <SecondBoardLeader
            dataTools={workbenchDataTools}
            onOpenHistory={() => {
              setBacktestEntry({ initialView: 'history', strategyKey: 'shortTerm.secondBoardLeader' })
              void setShortTermActiveSubTab('strategyBacktest')
            }}
          />
        )}
        {subTab === 'firstYinDip' && (
          <FirstYinDip
            dataTools={workbenchDataTools}
            onOpenHistory={() => {
              setBacktestEntry({ initialView: 'history', strategyKey: 'shortTerm.firstYinDip' })
              void setShortTermActiveSubTab('strategyBacktest')
            }}
          />
        )}
        {subTab === 'dipBuyRadar' && (
          <DipBuyRadar
            dataTools={workbenchDataTools}
            onOpenHistory={(strategyKey) => {
              setBacktestEntry({ initialView: 'history', strategyKey })
              void setShortTermActiveSubTab('strategyBacktest')
            }}
          />
        )}
        {isStrategyLabSubTab(subTab) && (
          <StrategyLab
            initialView={
              subTab === 'personalScreener'
                ? 'personalScreener'
                : subTab === 'conditionBlocks'
                  ? 'conditionBlocks'
                  : 'overview'
            }
          />
        )}
        {subTab === 'chipMonitor' && <ChipMonitor />}
        {subTab === 'strategyBacktest' && (
          <StrategyBacktestPanel
            initialView={backtestEntry?.initialView}
            initialStrategyKey={backtestEntry?.strategyKey}
            onInitialEntryApplied={() => setBacktestEntry(null)}
          />
        )}
      </div>

      <ShortTermDataToolsDrawer
        open={syncMenuOpen}
        source={conceptSource}
        sourceReady={thsOrDcReady}
        sourceSyncedAt={thsSyncedAt}
        sourceSyncProgress={thsSyncProgress}
        fullSyncProgress={conceptsProgress}
        tushareReady={tushareReady}
        checkingTushare={checkingTushare}
        tushareCheckError={tushareCheckError}
        syncingMembers={syncingMembers}
        changingSource={changingSource}
        syncingBaseData={syncing}
        syncingAllConcepts={syncingConcepts}
        message={syncMsg}
        onSourceChange={(source) => void handleConceptSourceChange(source)}
        onSyncCurrentSource={() => void handleSyncConceptMembers()}
        onSyncBaseData={() => void handleSync()}
        onSyncAllConcepts={() => void handleSyncAllConcepts()}
        onRefreshTushareStatus={() => void refreshTushareStatus()}
        onClose={() => setSyncMenuOpen(false)}
      />
    </div>
  )
}
