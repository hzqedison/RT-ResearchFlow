import { describe, expect, it } from 'vitest'
import { buildInitializationModel } from '../../src/components/Onboarding/initializationModel'
import {
  createInitialFlowState,
  getFlowProgress,
  getQuickStartDeferral,
  INITIALIZATION_TASKS,
  shouldSkipInitializationTask,
} from '../../src/components/Onboarding/initializationTaskModel'
import type { DiagnosticsHealthSnapshot } from '../../src/components/Onboarding/onboardingModel'

function snapshotWith(options: { tushare: 'ok' | 'warning'; stockRows: number }): DiagnosticsHealthSnapshot {
  const checkedAt = Date.now()
  return {
    status: 'warning',
    checkedAt,
    summary: { ok: 1, warning: 2, error: 0 },
    groups: [
      {
        key: 'config',
        title: '配置',
        items: [{
          key: 'config.tushare',
          title: 'Tushare',
          status: options.tushare,
          message: options.tushare === 'ok' ? '已配置' : '未配置',
          checkedAt,
        }],
      },
      {
        key: 'freshness',
        title: '数据新鲜度',
        items: [
          {
            key: 'freshness.stockBasic',
            title: '股票基础数据',
            status: options.stockRows > 0 ? 'ok' : 'warning',
            message: options.stockRows > 0 ? '已可用' : '暂无本地数据',
            recordCount: options.stockRows,
            checkedAt,
          },
          {
            key: 'freshness.decisionSignals',
            title: '今日看板',
            status: 'warning',
            message: '暂无信号',
            recordCount: 0,
            checkedAt,
          },
        ],
      },
    ],
  }
}

describe('new-user initialization task model', () => {
  it('only the explicitly selected source with proved target scope may skip', () => {
    const snapshot = snapshotWith({ tushare: 'ok', stockRows: 5572 })
    snapshot.selectedConceptSource = 'ths'
    const task = INITIALIZATION_TASKS.find(task => task.key === 'sync-concepts')!
    const items = snapshot.groups[1].items
    items.push({ key: 'freshness.kplConcept', title: 'KPL', status: 'ok', message: 'other source has rows', recordCount: 100, checkedAt: 1 })
    const ths = { key: 'freshness.thsConcept', title: 'THS', status: 'warning' as const, message: 'selected source empty', recordCount: 0, checkedAt: 1 }
    items.push(ths)
    expect(shouldSkipInitializationTask(snapshot, task)).toBeNull()
    items[items.length - 1] = { ...ths, status: 'ok', recordCount: 1, evidence: { applicability: 'selected', selectedSource: 'ths', readiness: 'ready', reasonCode: 'FACTS_SAVED', targetScope: 'complete-directory-members', lastAttempt: { outcome: 'success', source: 'ths', targetDate: null, insertedRows: 1, reasonCode: 'FACTS_SAVED', access: 'unknown', checkedAt: 1, coverage: 'unknown' } } }
    expect(shouldSkipInitializationTask(snapshot, task)).toContain('THS')
    snapshot.selectedConceptSource = 'dc'
    expect(shouldSkipInitializationTask(snapshot, task)).toBeNull()
  })
  it('neutral or a mismatched session never proves current-source readiness', () => {
    const snapshot = snapshotWith({ tushare: 'ok', stockRows: 5572 }); snapshot.selectedConceptSource = 'dc'
    const task = INITIALIZATION_TASKS.find(task => task.key === 'sync-concepts')!
    const item = { key: 'freshness.dcConcept', title: 'DC', status: 'ok' as const, message: 'old', recordCount: 1, checkedAt: 1, evidence: { applicability: 'selected' as const, selectedSource: 'dc' as const, readiness: 'ready' as const, reasonCode: 'FACTS_SAVED', expectedTradeDate: '20261008', lastAttempt: { outcome: 'success' as const, source: 'dc', targetDate: '20260930', insertedRows: 1, reasonCode: 'FACTS_SAVED', access: 'unknown' as const, checkedAt: 1, coverage: 'unknown' as const } } }
    snapshot.groups[1].items.push(item)
    expect(shouldSkipInitializationTask(snapshot, task)).toBeNull()
    item.evidence.lastAttempt.targetDate = '20261008'
    expect(shouldSkipInitializationTask(snapshot, task)).toContain('DC')
    snapshot.groups[1].items[snapshot.groups[1].items.length - 1] = { ...item, displayStatus: 'neutral' }
    expect(shouldSkipInitializationTask(snapshot, task)).toBeNull()
    delete snapshot.selectedConceptSource
    expect(shouldSkipInitializationTask(snapshot, task)).toBeNull()
  })
  it('快速初始化延后两年全市场日线，单独执行时不延后', () => {
    const historical = INITIALIZATION_TASKS.find(task => task.key === 'sync-historical-daily')
    expect(historical).toBeDefined()
    expect(getQuickStartDeferral(historical!, false)).toContain('增强能力')
    expect(getQuickStartDeferral(historical!, true)).toBeNull()
  })

  it('全市场增强任务失败继续后续步骤，只有首次诊断失败才停止', () => {
    expect(INITIALIZATION_TASKS.find(task => task.key === 'refresh-before')?.failurePolicy).toBe('stop')
    expect(INITIALIZATION_TASKS.find(task => task.key === 'sync-stock-basic')?.failurePolicy).toBe('continue')
    expect(INITIALIZATION_TASKS.find(task => task.key === 'sync-historical-daily')?.failurePolicy).toBe('continue')
    expect(INITIALIZATION_TASKS.find(task => task.key === 'sync-concepts')).toMatchObject({
      quickStart: 'defer',
      failurePolicy: 'continue',
    })
    expect(INITIALIZATION_TASKS.find(task => task.key === 'backfill-decision')?.requiresTushare).toBe(false)
  })

  it('延后任务不冒充完成，并保留立即同步入口所需状态', () => {
    const flow = createInitialFlowState()
    flow.tasks = flow.tasks.map(task => task.key === 'sync-historical-daily'
      ? { ...task, status: 'deferred' }
      : { ...task, status: 'success' })
    expect(getFlowProgress(flow)).toEqual({ done: 5, total: 6, failed: 0, deferred: 1, pct: 83 })
  })

  it('没有 Tushare 或全市场索引时仍声明基础能力可用', () => {
    const noKey = buildInitializationModel(snapshotWith({ tushare: 'warning', stockRows: 0 }))
    expect(noKey.status).toBe('usable')
    expect(noKey.minimumUsable).toBe(true)
    expect(noKey.description).toContain('六位代码直查')

    const noStockBase = buildInitializationModel(snapshotWith({ tushare: 'ok', stockRows: 0 }))
    expect(noStockBase.status).toBe('actionRequired')
    expect(noStockBase.minimumUsable).toBe(true)
    expect(noStockBase.emptyReason).toBe('stockBasicMissing')
  })
})
