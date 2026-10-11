import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
test('packaged rolling protocol can recover a failed save without permanently locking its form', async () => {
  test.setTimeout(90000)
  const executable = process.env.RT_PACKAGED_EXE, root = process.env.RT_PACKAGED_TEST_ROOT
  if (process.env.RT_CAPITAL_FIXTURE_ALLOWED !== '1' || !executable || !root || !isAbsolute(executable) || !isAbsolute(root)) throw Error('ISOLATED_ROLLING_ACCEPTANCE_REQUIRED')
  if (process.platform === 'win32' && !resolve(executable).replace(/\\/g, '/').includes('/release/win-unpacked/')) throw Error('PRODUCTION_ROLLING_FIXTURES_FORBIDDEN')
  if (process.platform === 'darwin' && process.env.GITHUB_ACTIONS !== 'true') throw Error('MAC_ROLLING_REQUIRES_ISOLATED_CI')
  mkdirSync(root, { recursive: true }); const profile = mkdtempSync(join(root, 'rolling-recovery-'))
  const { ELECTRON_RUN_AS_NODE: _node, ELECTRON_RENDERER_URL: _url, NODE_PATH: _path, NODE_OPTIONS: _options, ...env } = process.env
  const app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env })
  try {
    const page = await app.firstWindow(); await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30000 })
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true); expect(await app.evaluate(({ app }) => app.getVersion())).toBe(process.env.RT_PACKAGED_VERSION)
    await app.evaluate(({ app }) => {
      const load = process.mainModule!.require.bind(process.mainModule!), path = load('node:path'), Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
      const db = new Database(path.join(app.getPath('userData'), 'trade-watch.db'))
      try {
        for (let i = 1; i <= 4; i++) db.prepare('INSERT OR REPLACE INTO trade_cal(cal_date,is_open) VALUES(?,1)').run(`2026060${i}`)
        db.prepare('INSERT INTO short_term_signals(strategy,ts_code,trade_date,signal_strength,created_at) VALUES(?,?,?,1,?)').run('isolated-recovery', '600001.SH', '20260601', Date.now())
      } finally { db.close() }
    })
    await expect(async () => {
      const guide = page.getByTestId('cold-start-guide'); if (await guide.isVisible()) await guide.getByLabel('关闭引导').click({ timeout: 2000 })
      if (!await page.getByTestId('strategy-backtest-view-validation').isVisible()) {
        if (!await page.getByText('策略评估', { exact: true }).first().isVisible()) await page.getByText('短线策略', { exact: true }).first().click({ timeout: 2000 })
        await page.getByText('策略评估', { exact: true }).first().click({ timeout: 2000 })
      }
      await page.getByTestId('strategy-backtest-view-validation').click({ timeout: 2000 })
      await expect(page.getByTestId('rolling-validation-panel')).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 45000 })
    const panel = page.getByTestId('rolling-validation-panel')
    await panel.getByLabel('滚动验证数据集', { exact: true }).selectOption('short-term:isolated-recovery')
    await panel.getByLabel('滚动验证起始日', { exact: true }).fill('2026-06-01'); await panel.getByLabel('滚动验证结束日', { exact: true }).fill('2026-06-04')
    for (const [label, value] of [['训练开市日数', '2'], ['测试开市日数', '1'], ['隔离开市日数', '1'], ['测试窗口数量', '1'], ['候选持有期（逗号分隔）', '1']]) await panel.getByLabel(label, { exact: true }).fill(value)
    await panel.getByLabel('确认固定训练选择规则和独立测试窗口，不将研究结果作为实盘成交证明').check()
    await page.evaluate(() => window.api.rollingValidation.list())
    await app.evaluate(({ app }) => {
      const load = process.mainModule!.require.bind(process.mainModule!), path = load('node:path'), Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
      const db = new Database(path.join(app.getPath('userData'), 'trade-watch.db'))
      try { db.exec("CREATE TRIGGER refuse_rolling_fixture BEFORE INSERT ON rf_validation_studies BEGIN SELECT RAISE(ABORT,'isolated save failure'); END") } finally { db.close() }
    })
    await panel.getByRole('button', { name: '保存新验证协议', exact: true }).click()
    await expect(panel.getByRole('button', { name: '按编号恢复', exact: true })).toBeVisible()
    await app.evaluate(({ app }) => {
      const load = process.mainModule!.require.bind(process.mainModule!), path = load('node:path'), Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
      const db = new Database(path.join(app.getPath('userData'), 'trade-watch.db'))
      try { db.exec('DROP TRIGGER refuse_rolling_fixture') } finally { db.close() }
    })
    await panel.getByRole('button', { name: '按编号恢复', exact: true }).click()
    await expect(panel.getByLabel('滚动验证起始日', { exact: true })).toBeEnabled()
    await expect(panel.getByRole('button', { name: '保存新验证协议', exact: true })).toBeEnabled()
    await panel.getByRole('button', { name: '保存新验证协议', exact: true }).click()
    await expect(panel.getByTestId('rolling-validation-report')).toContainText('报告 0 / 2')
  } finally { await app.close() }
})
