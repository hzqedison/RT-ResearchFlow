import type { ConfigDrawerTab } from '../ConfigDrawer/ConfigDrawer'
import type { Tab } from '../../store/appStore'
import type { DiagnosticItem, DiagnosticRunAction, DiagnosticsHealthSnapshot, OnboardingAction } from './onboardingModel'
import { basicUseBlockers, isUsableDiagnosticFact } from './initializationCapabilityPolicy'

export type InitializationStatus = 'blocked' | 'actionRequired' | 'syncing' | 'usable' | 'complete'
export type InitializationEmptyReason = 'datasourceMissing' | 'stockBasicMissing' | 'initializing' | 'diagnosticsError' | 'readyNoSignals'

export interface InitializationAction {
  type: 'config' | 'run' | 'nav' | 'guide'
  label: string
  tab?: ConfigDrawerTab | Tab
  runAction?: DiagnosticRunAction
}

export interface InitializationModel {
  status: InitializationStatus
  title: string
  description: string
  minimumUsable: boolean
  emptyReason: InitializationEmptyReason
  primaryAction: InitializationAction
  secondaryAction?: InitializationAction
  blockers: DiagnosticItem[]
  warnings: DiagnosticItem[]
}

function allItems(snapshot: DiagnosticsHealthSnapshot | null): DiagnosticItem[] {
  return snapshot?.groups.flatMap(group => group.items) ?? []
}

function findItem(snapshot: DiagnosticsHealthSnapshot | null, keys: string[]): DiagnosticItem | undefined {
  return allItems(snapshot).find(item => keys.includes(item.key))
}

function isOk(item: DiagnosticItem | undefined): boolean {
  return item?.status === 'ok' && item.displayStatus !== 'neutral'
}

function actionFromOnboarding(action: OnboardingAction | undefined): InitializationAction | undefined {
  if (!action) return undefined
  if (action.type === 'config') return { type: 'config', tab: action.tab, label: action.label }
  if (action.type === 'run') return { type: 'run', runAction: action.action, label: action.label }
  return { type: 'nav', tab: action.tab, label: action.label }
}

export function buildInitializationModel(snapshot: DiagnosticsHealthSnapshot | null, nextAction?: OnboardingAction, syncing = false): InitializationModel {
  if (!snapshot) {
    return {
      status: 'syncing',
      title: '正在读取初始化状态',
      description: '正在检查数据源、基础数据和今日看板状态。',
      minimumUsable: false,
      emptyReason: 'initializing',
      primaryAction: { type: 'guide', label: '查看引导' },
      secondaryAction: { type: 'config', tab: 'diagnostics', label: '打开诊断页' },
      blockers: [],
      warnings: []
    }
  }

  const items = allItems(snapshot)
  const tushare = findItem(snapshot, ['config.tushare'])
  const ai = findItem(snapshot, ['config.ai'])
  const stockBasic = findItem(snapshot, ['freshness.stockBasic', 'stockBasic'])
  const decisionSignals = findItem(snapshot, ['freshness.decisionSignals', 'decisionSignals'])
  const blockers = basicUseBlockers(snapshot)
  // Preserve original severity; these issues restrict their module, not all local use.
  const warnings = items.filter(item => item.displayStatus !== 'neutral'
    && (item.status === 'warning' || (item.status === 'error' && !blockers.includes(item))))
  const stockBasicReady = isUsableDiagnosticFact(stockBasic) && (stockBasic?.recordCount ?? 0) > 0
  const decisionReady = isUsableDiagnosticFact(decisionSignals)
  const minimumUsable = blockers.length === 0

  if (syncing) {
    return {
      status: 'syncing',
      title: '初始化动作正在执行',
      description: '当前同步或补种任务还在执行, 完成后会自动刷新初始化状态。',
      minimumUsable,
      emptyReason: 'initializing',
      primaryAction: { type: 'guide', label: '查看引导' },
      secondaryAction: { type: 'nav', tab: 'decision-center', label: '留在今日看板' },
      blockers,
      warnings
    }
  }

  if (blockers.length > 0) {
    return {
      status: 'actionRequired',
      title: '本地数据库需要处理',
      description: blockers[0]?.message ?? '部分关键数据或数据库状态异常, 建议先进入诊断页处理。',
      minimumUsable: false,
      emptyReason: 'diagnosticsError',
      primaryAction: { type: 'config', tab: 'diagnostics', label: '打开诊断页' },
      secondaryAction: { type: 'guide', label: '查看初始化引导' },
      blockers,
      warnings
    }
  }

  if (!stockBasicReady) {
    return {
      status: isOk(tushare) ? 'actionRequired' : 'usable',
      title: '基础功能可使用，全市场索引待补齐',
      description: `六位代码直查、资讯和本地研究仍可使用；股票索引可免 Key 同步。${stockBasic?.message ?? '当前股票索引尚未核验可用。'} 同步任务可启动不代表资料已补齐。`,
      minimumUsable: true,
      emptyReason: 'stockBasicMissing',
      primaryAction: { type: 'run', runAction: 'syncStockBasic', label: '同步股票基础数据' },
      secondaryAction: { type: 'config', tab: 'datasource', label: '配置增强数据源（可选）' },
      blockers,
      warnings
    }
  }

  if (!decisionReady) {
    const fallbackAction = actionFromOnboarding(nextAction)
    return {
      status: 'usable',
      title: '基础初始化已可用',
      description: '尚无已核验的本地看板信号。股票查询和本地研究可继续使用；请刷新信号并检查对应模块数据。没有信号不等于没有机会。',
      minimumUsable: true,
      emptyReason: 'readyNoSignals',
      primaryAction: fallbackAction?.runAction === 'backfillDecisionSignals' ? fallbackAction : { type: 'run', runAction: 'backfillDecisionSignals', label: '补种今日看板' },
      secondaryAction: isOk(ai) ? { type: 'guide', label: '查看初始化引导' } : { type: 'config', tab: 'ai-config', label: '配置 AI 模型' },
      blockers,
      warnings
    }
  }

  return {
    status: warnings.length > 0 ? 'usable' : 'complete',
    title: warnings.length > 0 ? '基础功能可使用，部分模块待核验' : '基础初始化已完成',
    description: warnings.length > 0 ? '股票索引和本地看板已可使用；其余数据、权限和模型问题仅限制对应模块，请在诊断页逐项核验。' : '基础股票索引和本地看板已具备可用条件；增强策略的数据依赖仍须分别核验。',
    minimumUsable: true,
    emptyReason: 'readyNoSignals',
    primaryAction: { type: 'nav', tab: 'decision-center', label: '查看今日看板' },
    secondaryAction: warnings.length > 0 ? { type: 'config', tab: 'diagnostics', label: '查看诊断' } : { type: 'guide', label: '查看初始化引导' },
    blockers,
    warnings
  }
}
