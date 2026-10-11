import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { DiagnosticsHealthSnapshot } from '../../src/components/Onboarding/onboardingModel'

test('packaged initialization prioritizes free setup, scopes provider errors and displays active tasks', async () => {
  test.setTimeout(90_000)
  const executable = process.env.RT_PACKAGED_EXE
  const root = process.env.RT_PACKAGED_TEST_ROOT
  if (process.env.RT_INITIALIZATION_FIXTURE_ALLOWED !== '1' || !executable || !root || !isAbsolute(executable) || !isAbsolute(root)) throw new Error('ISOLATED_PACKAGED_INITIALIZATION_REQUIRED')
  if (process.platform === 'win32' && !resolve(executable).replace(/\\/g, '/').includes('/release/win-unpacked/')) throw new Error('PRODUCTION_FIXTURES_FORBIDDEN')
  if (process.platform === 'darwin' && process.env.GITHUB_ACTIONS !== 'true') throw new Error('MAC_FIXTURES_REQUIRE_ISOLATED_CI')
  const profile = mkdtempSync(join(root, 'initialization-ui-'))
  const { ELECTRON_RUN_AS_NODE: _runAsNode, NODE_OPTIONS: _nodeOptions, ...environment } = process.env
  const app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env: { ...environment, NODE_ENV: 'test' } })
  const child = app.process()
  try {
    await app.evaluate(({ ipcMain }) => {
      type Item = { key: string; title: string; status: 'ok' | 'warning' | 'error'; message: string; recordCount: number; checkedAt: number }
      type Health = { status: string; checkedAt: number; summary: { ok: number; warning: number; error: number }; groups: { key: string; title: string; items: Item[] }[] }
      const fixture = globalThis as typeof globalThis & { __initializationHealth?: Health; __initializationActions?: string[]; __finishStockSync?: () => void }
      const now = Date.now()
      const fact = (key: string, rows: number, status: Item['status'] = 'ok'): Item => ({ key, title: key, status, message: status === 'error' ? '该模块需要核验' : '合成隔离检查事实', recordCount: rows, checkedAt: now })
      fixture.__initializationHealth = { status: 'error', checkedAt: now, summary: { ok: 2, warning: 1, error: 1 }, groups: [
        { key: 'config', title: '配置', items: [fact('config.tushare', 0, 'warning')] },
        { key: 'freshness', title: '数据', items: [fact('freshness.stockBasic', 5572), fact('freshness.decisionSignals', 1), fact('freshness.auction', 0, 'error')] }
      ] }
      fixture.__initializationActions = []
      ipcMain.removeHandler('diagnostics:getHealth')
      ipcMain.handle('diagnostics:getHealth', () => ({ ok: true, data: fixture.__initializationHealth }))
      ipcMain.removeHandler('diagnostics:runCheck')
      ipcMain.handle('diagnostics:runCheck', (_event, payload?: { action?: string }) => {
        const action = payload?.action ?? ''
        fixture.__initializationActions?.push(action)
        const complete = () => ({ ok: true, data: { action, status: 'completed', message: '隔离任务已完成' } })
        if (action === 'syncStockBasic') return new Promise(resolveAction => {
          fixture.__finishStockSync = () => {
            const stock = fixture.__initializationHealth?.groups[1].items.find(item => item.key === 'freshness.stockBasic')
            if (stock) { stock.status = 'ok'; stock.recordCount = 5572 }
            resolveAction(complete())
          }
        })
        return complete()
      })
    })
    const window = await app.firstWindow()
    await window.reload()
    await window.getByText('配置中心', { exact: true }).first().click()
    await window.getByTestId('config-open-onboarding-guide-btn').click()
    const guide = window.getByTestId('cold-start-guide')
    await expect(guide.getByTestId('initialization-status')).toHaveText('可使用')
    await expect(guide.getByTestId('onboarding-primary-action')).toHaveText('进入今日看板')
    await expect(guide.getByTestId('onboarding-step-datasource')).toContainText('可选增强')
    await expect(guide.getByTestId('onboarding-step-datasource').getByRole('button', { name: '打开数据源', exact: true })).toBeVisible()
    await app.evaluate(() => {
      const fixture = globalThis as typeof globalThis & { __initializationHealth?: DiagnosticsHealthSnapshot }
      const stock = fixture.__initializationHealth?.groups[1].items[0]
      if (stock) { stock.recordCount = 0; stock.status = 'warning' }
    })
    await guide.getByRole('button', { name: '重新检查', exact: true }).click()
    await expect(guide.getByTestId('onboarding-primary-action')).toHaveText('同步股票基础数据')
    await guide.getByTestId('start-initialization-flow-btn').click()
    await expect(guide.getByTestId('initialization-task-sync-stock-basic')).toContainText('执行中')
    await expect(guide.getByTestId('initialization-status')).toHaveText('执行中')
    await app.evaluate(() => {
      const fixture = globalThis as typeof globalThis & { __finishStockSync?: () => void }
      if (!fixture.__finishStockSync) throw new Error('NO_ACTIVE_FIXTURE_TASK')
      fixture.__finishStockSync()
    })
    await expect(guide.getByTestId('start-initialization-flow-btn')).toHaveText('开始初始化')
    await app.evaluate(() => {
      const fixture = globalThis as typeof globalThis & { __initializationHealth?: DiagnosticsHealthSnapshot }
      fixture.__initializationHealth?.groups.push({ key: 'database', title: '数据库', items: [{ key: 'database.migrations', title: '迁移', status: 'error', message: '合成数据库阻断', checkedAt: Date.now() }] })
    })
    await guide.getByRole('button', { name: '重新检查', exact: true }).click()
    await expect(guide.getByTestId('initialization-status')).toHaveText('需处理')
    await expect(guide.getByTestId('onboarding-primary-action')).toHaveText('打开诊断页')
    const exited = new Promise<number | null>(resolveExit => child.once('exit', resolveExit))
    await app.evaluate(({ app: application }) => { setTimeout(() => application.quit(), 25) })
    expect(await exited).toBe(0)
  } finally {
    if (child.exitCode === null) await app.close()
  }
})
