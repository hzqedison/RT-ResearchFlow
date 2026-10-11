import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
test('packaged capital simulation uses the real database, shared wallet and restart-persistent report', async () => {
  test.setTimeout(120000)
  const executable = process.env.RT_PACKAGED_EXE, root = process.env.RT_PACKAGED_TEST_ROOT
  if (process.env.RT_CAPITAL_FIXTURE_ALLOWED !== '1' || !executable || !root || !isAbsolute(executable) || !isAbsolute(root)) throw Error('ISOLATED_CAPITAL_ACCEPTANCE_REQUIRED')
  if (process.platform === 'win32' && !resolve(executable).replace(/\\/g, '/').includes('/release/win-unpacked/')) throw Error('PRODUCTION_CAPITAL_FIXTURES_FORBIDDEN')
  if (process.platform === 'darwin' && process.env.GITHUB_ACTIONS !== 'true') throw Error('MAC_CAPITAL_REQUIRES_ISOLATED_CI')
  mkdirSync(root, { recursive: true }); const profile = mkdtempSync(join(root, 'capital-')), key = `isolated-capital-${randomUUID().slice(0, 8)}`
  const { ELECTRON_RUN_AS_NODE: _node, ELECTRON_RENDERER_URL: _url, NODE_PATH: _path, NODE_OPTIONS: _options, ...env } = process.env
  let app: ElectronApplication | undefined
  const errors: string[] = []
  async function launch() {
    app = await electron.launch({ executablePath: executable!, args: [`--user-data-dir=${profile}`], env })
    const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message))
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30000 })
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(process.env.RT_PACKAGED_VERSION)
    return page
  }
  async function open() {
    const page = await app!.firstWindow()
    await expect(async () => {
      const guide = page.getByTestId('cold-start-guide'); if (await guide.isVisible()) await guide.getByLabel('关闭引导').click({ timeout: 2000 })
      if (!await page.getByTestId('strategy-backtest-view-capital').isVisible()) {
        if (!await page.getByText('策略评估', { exact: true }).first().isVisible()) await page.getByText('短线策略', { exact: true }).first().click({ timeout: 2000 })
        await page.getByText('策略评估', { exact: true }).first().click({ timeout: 2000 })
      }
      await page.getByTestId('strategy-backtest-view-capital').click({ timeout: 2000 })
      await expect(page.getByTestId('capital-simulation-panel')).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 45000 })
    return page.getByTestId('capital-simulation-panel')
  }
  async function quit() {
    const child = app!.process(), closed = app!.waitForEvent('close')
    await app!.evaluate(({ app }) => { setTimeout(() => app.quit(), 25) }); await closed
    await expect.poll(() => child.exitCode).toBe(0); app = undefined
  }
  try {
    await launch()
    await app!.evaluate(({ app }, strategy) => {
      const load = process.mainModule!.require.bind(process.mainModule!), path = load('node:path'), Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
      const db = new Database(path.join(app.getPath('userData'), 'trade-watch.db'))
      try {
        db.transaction(() => {
          for (let i = 1; i <= 5; i++) {
            const date = `2026060${i}`
            db.prepare('INSERT OR REPLACE INTO trade_cal(cal_date,is_open) VALUES(?,1)').run(date)
            for (const symbol of ['600001.SH', '600002.SH']) {
              const price = symbol === '600001.SH' && i >= 3 ? 12 : 10
              db.prepare('INSERT OR REPLACE INTO daily_close_cache(ts_code,trade_date,open,high,low,close,pct_chg,vol,data_source) VALUES(?,?,?,?,?,?,0,1000,?)').run(symbol, date, price, price + 1, price - 1, price, 'isolated-fixture')
              db.prepare('INSERT OR REPLACE INTO security_adjustment_factor_cache(ts_code,trade_date,adj_factor,source,fetched_at) VALUES(?,?,1,?,?)').run(symbol, date, 'isolated-fixture', Date.now())
            }
          }
          const insert = db.prepare('INSERT INTO short_term_signals(strategy,ts_code,trade_date,signal_strength,created_at) VALUES(?,?,?,1,?)')
          insert.run(strategy, '600001.SH', '20260601', Date.now()); insert.run(strategy, '600002.SH', '20260602', Date.now())
        })()
      } finally { db.close() }
    }, key)
    let panel = await open()
    await panel.getByLabel('资金回测数据集', { exact: true }).selectOption(`short-term:${key}`)
    await panel.getByLabel('资金回测起始日', { exact: true }).fill('2026-06-01'); await panel.getByLabel('资金回测结束日', { exact: true }).fill('2026-06-05')
    await panel.getByLabel('资金回测初始现金', { exact: true }).fill('10000')
    for (const [label, value] of [['最多同时持仓', '1'], ['单股预算上限（%）', '100'], ['现金预留目标（%）', '0'], ['单边综合费率假设（bps）', '0']]) await panel.getByLabel(label, { exact: true }).fill(value)
    await expect(panel.getByRole('button', { name: '运行并保存组合回测', exact: true })).toBeDisabled()
    await panel.getByLabel('我确认将所选信号用于做多研究，并理解资金、买入单位和费用是回测假设，不是真实委托或可用资金证明').check()
    await panel.getByRole('button', { name: '运行并保存组合回测', exact: true }).click()
    const result = panel.getByTestId('capital-report'); await expect(result).toContainText('12000.00'); await expect(result).toContainText('资金收益：20.00%'); await expect(result).toContainText('入场 1，跳过 1')
    const reports = await app!.firstWindow().then(page => page.evaluate(() => window.api.capitalSimulation.catalog()))
    expect(reports.ok).toBe(true); if (!reports.ok) throw Error(reports.code)
    const id = reports.data.runs[0].id
    await quit(); await launch(); panel = await open()
    await panel.getByLabel('组合资金历史报告', { exact: true }).selectOption(id)
    await expect(panel.getByTestId('capital-report')).toContainText(id); await expect(panel.getByTestId('capital-report')).toContainText('12000.00')
    const validationKey = `${key}-rolling`
    await app!.evaluate(({ app }, strategy) => {
      const load = process.mainModule!.require.bind(process.mainModule!), path = load('node:path'), Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
      const db = new Database(path.join(app.getPath('userData'), 'trade-watch.db'))
      try { const insert = db.prepare('INSERT INTO short_term_signals(strategy,ts_code,trade_date,signal_strength,created_at) VALUES(?,?,?,1,?)'); insert.run(strategy, '600001.SH', '20260601', Date.now()); insert.run(strategy, '600002.SH', '20260604', Date.now()) } finally { db.close() }
    }, validationKey)
    const page = await app!.firstWindow(); await page.getByTestId('strategy-backtest-view-validation').click()
    const validation = page.getByTestId('rolling-validation-panel')
    await validation.getByLabel('滚动验证数据集', { exact: true }).selectOption(`short-term:${validationKey}`)
    await validation.getByLabel('滚动验证起始日', { exact: true }).fill('2026-06-01'); await validation.getByLabel('滚动验证结束日', { exact: true }).fill('2026-06-05')
    for (const [label, value] of [['每窗研究预算', '10000'], ['训练开市日数', '2'], ['测试开市日数', '2'], ['隔离开市日数', '1'], ['测试窗口数量', '1'], ['候选持有期（逗号分隔）', '1'], ['训练最少入场数', '1'], ['滚动最多持仓', '1'], ['滚动单股预算（%）', '100'], ['滚动现金预留（%）', '0'], ['滚动单边费率（bps）', '0']]) await validation.getByLabel(label, { exact: true }).fill(value)
    await expect(validation.getByRole('button', { name: '保存新验证协议', exact: true })).toBeDisabled()
    await validation.getByLabel('确认固定训练选择规则和独立测试窗口，不将研究结果作为实盘成交证明').check()
    await validation.getByRole('button', { name: '保存新验证协议', exact: true }).click()
    await expect(validation.getByTestId('rolling-validation-report')).toContainText('报告 0 / 2')
    await validation.getByRole('button', { name: '运行或继续验证', exact: true }).click()
    await expect(validation.getByTestId('rolling-validation-report')).toContainText('窗口执行完成')
    await expect(validation.getByTestId('rolling-validation-report')).toContainText('样本外收益均值 0.00%')
    const studies = await page.evaluate(() => window.api.rollingValidation.list()); expect(studies.ok).toBe(true); if (!studies.ok) throw Error(studies.code)
    const studyId = studies.data[0].id
    await quit(); await launch(); await open()
    const restarted = await app!.firstWindow(); await restarted.getByTestId('strategy-backtest-view-validation').click()
    await restarted.getByLabel('已保存验证', { exact: true }).selectOption(studyId)
    await expect(restarted.getByTestId('rolling-validation-report')).toContainText(studyId)
    await expect(restarted.getByTestId('rolling-validation-report')).toContainText('窗口执行完成')
    expect(errors).toEqual([]); await quit()
  } finally { if (app) await app.close() }
})
