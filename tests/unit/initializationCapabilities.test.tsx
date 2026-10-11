import { createElement } from 'react'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ColdStartGuide } from '../../src/components/Onboarding/ColdStartGuide'
import { buildInitializationModel } from '../../src/components/Onboarding/initializationModel'
import { buildOnboardingModel, type DiagnosticItem, type DiagnosticsHealthSnapshot } from '../../src/components/Onboarding/onboardingModel'
import { createInitialFlowState } from '../../src/components/Onboarding/initializationTaskModel'
import { buildDecisionEmptyStateModel } from '../../src/components/DecisionCenter/decisionEmptyStateModel'

function fact(key: string, rows = 1): DiagnosticItem {
  return { key, title: key, status: 'ok', message: '本地事实', recordCount: rows, checkedAt: 1 }
}

function snapshot(stockRows = 5572, decisionRows = 1): DiagnosticsHealthSnapshot {
  return { status: 'warning', checkedAt: 1, summary: { ok: 2, warning: 1, error: 0 }, groups: [
    { key: 'config', title: '配置', items: [{ ...fact('config.tushare'), status: 'warning', message: '未绑定 Key' }] },
    { key: 'freshness', title: '事实', items: [fact('freshness.stockBasic', stockRows), fact('freshness.decisionSignals', decisionRows)] }
  ] }
}

describe('capability-scoped initialization', () => {
  beforeAll(() => vi.stubGlobal('React', React))
  afterAll(() => vi.unstubAllGlobals())
  it('keeps the Key entry visible but prioritizes free stock synchronization without a Key', () => {
    const model = buildInitializationModel(snapshot(0, 0))
    expect(model.minimumUsable).toBe(true)
    expect(model.primaryAction.runAction).toBe('syncStockBasic')
    expect(model.secondaryAction?.tab).toBe('datasource')
    const guide = buildOnboardingModel(snapshot(0, 0))
    expect(guide.nextStep?.key).toBe('stock-basic')
    expect(guide.steps.find(step => step.key === 'datasource')).toMatchObject({ optional: true, action: { type: 'config', tab: 'datasource' } })
  })

  it('uses cached basic facts without requiring optional provider or AI setup', () => {
    const health = snapshot()
    expect(buildInitializationModel(health)).toMatchObject({ minimumUsable: true, status: 'usable', primaryAction: { type: 'nav', tab: 'decision-center' } })
    const guide = buildOnboardingModel(health)
    expect(guide.nextStep?.key).toBe('enter-home')
    expect(guide.shouldPrompt).toBe(false)
    expect(guide.completedCount).toBeLessThan(guide.totalCount)
    expect(guide.steps.filter(step => step.optional)).toHaveLength(4)
  })

  it.each(['stockBasic', 'decisionSignals'] as const)('does not treat an available %s job as local data', key => {
    const health = snapshot()
    health.groups[1].items = health.groups[1].items.filter(item => item.key !== `freshness.${key}`)
    health.groups.push({ key: 'sync', title: '任务', items: [fact(key === 'stockBasic' ? 'sync.stockBasic' : 'sync.decisionBackfill', 999)] })
    const guide = buildOnboardingModel(health)
    expect(guide.steps.find(step => step.key === (key === 'stockBasic' ? 'stock-basic' : 'decision-signals'))?.status).toBe('warning')
    expect(buildInitializationModel(health).emptyReason).toBe(key === 'stockBasic' ? 'stockBasicMissing' : 'readyNoSignals')
  })

  it.each(['missing', 'unknown', 'failed', 'waiting', 'not_run', 'not_applicable'] as const)('existing rows with %s evidence do not prove index readiness', readiness => {
    const health = snapshot()
    health.groups[1].items[0].evidence = { applicability: 'required', readiness, reasonCode: 'TEST_FACT_NOT_READY' }
    expect(buildInitializationModel(health).emptyReason).toBe('stockBasicMissing')
    expect(buildOnboardingModel(health).steps[1].status).toBe('warning')
  })

  it.each(['error', 'neutral'] as const)('does not promote %s cached rows to readiness', state => {
    const health = snapshot()
    if (state === 'error') health.groups[1].items[0].status = 'error'
    else health.groups[1].items[0].displayStatus = 'neutral'
    expect(buildInitializationModel(health).emptyReason).toBe('stockBasicMissing')
  })

  it('retains permission failure severity but scopes it to its data module', () => {
    const health = snapshot()
    const denied = { ...fact('freshness.auction'), status: 'error' as const, message: '竞价接口权限不足' }
    health.status = 'error'
    health.groups[1].items.push(denied)
    const model = buildInitializationModel(health)
    expect(model.minimumUsable).toBe(true)
    expect(model.blockers).toEqual([])
    expect(model.warnings).toContain(denied)
    expect(denied.status).toBe('error')
    expect(buildOnboardingModel(health).nextStep?.key).toBe('enter-home')
  })

  it('database failure takes priority and prevents a basic-use claim', () => {
    const health = snapshot(0, 0)
    health.groups.push({ key: 'database', title: '数据库', items: [{ ...fact('database.migrations'), status: 'error', message: '数据库尚不可用' }] })
    expect(buildInitializationModel(health)).toMatchObject({ minimumUsable: false, primaryAction: { type: 'config', tab: 'diagnostics' } })
    expect(buildInitializationModel(health, undefined, true).minimumUsable).toBe(false)
    expect(buildOnboardingModel(health).nextStep?.action).toMatchObject({ type: 'config', tab: 'diagnostics' })
  })

  it('unknown or empty signal facts do not become a no-opportunity conclusion', () => {
    const model = buildInitializationModel(snapshot(5572, 0), { type: 'config', tab: 'datasource', label: '旧引导' })
    expect(model.primaryAction.runAction).toBe('backfillDecisionSignals')
    expect(buildDecisionEmptyStateModel(model).description).toContain('没有信号不等于没有机会')
    expect(buildDecisionEmptyStateModel(model).description).not.toContain('未发现值得处理')
  })

  it('renders active flow state and explicitly optional configuration without hiding Key binding', () => {
    const flow = createInitialFlowState()
    flow.running = true
    const noop = () => undefined
    const html = renderToStaticMarkup(createElement(ColdStartGuide, { snapshot: snapshot(), flow,
      onRefresh: noop, onOpenConfig: noop, onNavigate: noop, onStartInitialization: noop, onRetryTask: noop, onClose: noop }))
    expect(html).toMatch(/data-testid="initialization-status"[^>]*>执行中/)
    expect(html).toContain('初始化中')
    expect(html).toContain('配置 Tushare 数据源')
    expect(html).toContain('打开数据源')
    expect(html.match(/可选增强<\/span>/g)).toHaveLength(4)
  })
})
