import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const scheduler = readFileSync(
  new URL('../../electron/main/services/schedulerService.ts', import.meta.url),
  'utf8',
)
const chipMonitor = readFileSync(
  new URL('../../src/components/ShortTermStrategy/ChipMonitor.tsx', import.meta.url),
  'utf8',
)

const schedulerSyntax = ts.createSourceFile('schedulerService.ts', scheduler, ts.ScriptTarget.Latest, true)

function schedulerBody(name: string): ts.Block {
  const declaration = schedulerSyntax.statements.find((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === name
  ))
  if (!declaration?.body) throw new Error(`Missing scheduler function: ${name}`)
  return declaration.body
}

function callsWithin(node: ts.Node, name: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = []
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === name) {
      calls.push(child)
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return calls
}

describe('18:00统一盘后调度契约', () => {
  it('只注册一个盘后协调器且不保留17点计时器', () => {
    expect(scheduler).toContain('runUnifiedAfterCloseSyncJob')
    expect(scheduler).toContain('delayUntilBjTime(AFTER_CLOSE_SYNC_HOUR_BJ, AFTER_CLOSE_SYNC_MINUTE_BJ)')
    expect(scheduler).not.toContain('delayUntilBjTime(17, 0)')
    expect(scheduler).not.toContain('scheduleChipMonitorCron')
    expect(scheduler).not.toContain('scheduleTopListSync')
  })

  it('修改资讯扫描频率只重排资讯计时器', () => {
    const declaration = schedulerBody('reschedule')
    const body = declaration.getText(schedulerSyntax)
    expect(body).not.toContain('stopScheduler()')
    expect(body).toContain('clearTimeout(_timer)')
    const schedules = callsWithin(declaration, 'scheduleNext')
    expect(schedules).toHaveLength(1)
    expect(schedules[0].getText(schedulerSyntax)).toBe("scheduleNext(_scheduler.replaceScope('scan'))")
  })

  it('启动补漏不依赖Tushare配置且市场任务等待个性选股收敛', () => {
    const startup = schedulerBody('startScheduler')
    const startScheduler = startup.getText(schedulerSyntax)
    const catchUps = callsWithin(startup, 'runStartupAfterCloseCatchUp')
    expect(catchUps).toHaveLength(1)
    expect(ts.isAwaitExpression(catchUps[0].parent)).toBe(true)
    // The shared catch-up must remain outside either Token branch, not merely appear twice in source.
    for (let ancestor = catchUps[0].parent; ancestor !== startup; ancestor = ancestor.parent) {
      if (ts.isIfStatement(ancestor)) {
        expect(ancestor.expression.getText(schedulerSyntax)).not.toMatch(/\btoken\b/)
      }
    }
    expect(startScheduler.match(/runStartupPublicHistoricalDailySyncIfNeeded\(/g)).toHaveLength(2)
    expect(startScheduler).toContain('schedulePublicHistoricalDailyResumeCheck()')
    expect(startScheduler.match(/schedulePublicHistoricalDailyResumeCheck\(\)/g)).toHaveLength(2)
    const resume = schedulerBody('schedulePublicHistoricalDailyResumeCheck').getText(schedulerSyntax)
    expect(resume).toContain('_publicDailyResumeTimer = _scheduler.interval(scope,')
    expect(resume).toContain('if (!_scheduler.isCurrent(scope)) return')
    expect(scheduler).toContain('if (_publicDailyResumeTimer)')

    const marketTask = scheduler.slice(
      scheduler.indexOf('export async function runTopListSyncJob'),
      scheduler.indexOf('export async function runDailyOHLCVSyncJob'),
    )
    expect(marketTask).toContain("const { runScreener } = await import('./stockScreenerService')")
    expect(marketTask).toContain('screenerCompleted = true')
    expect(marketTask).not.toContain(';(async () =>')
  })

  it('盘前验证作为独立子任务接入18点协调器且晚于市场日线任务', () => {
    const coordinator = scheduler.slice(
      scheduler.indexOf('export function runUnifiedAfterCloseSyncJob'),
      scheduler.indexOf('function scheduleAfterCloseDailySync'),
    )
    expect(coordinator).toContain("runTrackedAfterCloseTask(tradeDate, 'premarket_validation'")
    expect(coordinator.indexOf("'premarket_validation'")).toBeGreaterThan(coordinator.indexOf("'market_daily'"))
    expect(coordinator).toContain('runPremarketOutcomeValidation(db, tradeDate)')
  })

  it('市场共振在板块截面完成后由18点协调器固化', () => {
    const coordinator = scheduler.slice(
      scheduler.indexOf('export function runUnifiedAfterCloseSyncJob'),
      scheduler.indexOf('function scheduleAfterCloseDailySync'),
    )
    expect(coordinator).toContain("runTrackedAfterCloseTask(tradeDate, 'market_resonance'")
    expect(coordinator).toContain('archiveMarketResonanceSnapshot(db, tradeDate)')
    expect(coordinator.indexOf("'market_resonance'")).toBeGreaterThan(coordinator.indexOf("'sector_snapshot'"))
    expect(coordinator.indexOf("'market_resonance'")).toBeLessThan(coordinator.indexOf("'trend_scores'"))
  })

  it('证券主数据独立于题材源接入18点协调器并提供启动过期补偿', () => {
    const coordinator = scheduler.slice(
      scheduler.indexOf('export function runUnifiedAfterCloseSyncJob'),
      scheduler.indexOf('export function scheduleAfterCloseDailySync'),
    )
    expect(coordinator).toContain("runTrackedAfterCloseTask(tradeDate, 'security_master'")
    expect(coordinator.indexOf("'security_master'")).toBeLessThan(coordinator.indexOf("'market_daily'"))

    const conceptSync = scheduler.slice(
      scheduler.indexOf('export async function runConceptMembersSyncForSource'),
      scheduler.indexOf('export interface StockBasicSyncResult'),
    )
    expect(conceptSync).not.toContain('runStockBasicSyncJob()')
    expect(scheduler).toContain('runStartupStockBasicSyncIfStale()')
    expect(scheduler).toContain('if (_stockBasicSyncPromise) return _stockBasicSyncPromise')
    expect(scheduler).toContain("remapUnmatchedIndustryResearchCompanyCandidates(getDb())")
    expect(scheduler).toContain('.sort((left, right) => right.localeCompare(left))[0] ?? null')
    expect(scheduler).not.toContain("reverse().find(r => r.isOpen === 1)?.calDate")
  })

  it('盘前通知在09:28确认版之后于09:29执行并只允许五分钟启动收敛', () => {
    expect(scheduler).toContain('PREMARKET_NOTIFICATION_HOUR_BJ = 9')
    expect(scheduler).toContain('PREMARKET_NOTIFICATION_MINUTE_BJ = 29')
    expect(scheduler).toContain('PREMARKET_NOTIFICATION_GRACE_MS = 5 * 60 * 1000')
    expect(scheduler).toContain('reconcilePremarketNotificationForToday()')
  })

  it('筹码工作台以紧凑状态带展示18点、上次和下次运行', () => {
    expect(chipMonitor).toContain('data-testid="after-close-schedule-status"')
    expect(chipMonitor).toContain('统一盘后同步 · 18:00')
    expect(chipMonitor).toContain('scheduleStatus.lastRun')
    expect(chipMonitor).toContain('scheduleStatus.nextRunAt')
  })
})
