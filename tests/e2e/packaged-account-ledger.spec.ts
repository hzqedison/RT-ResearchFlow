import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

test('real packaged ledger records confirmed fills, reverses explicitly and survives restart', async () => {
  test.setTimeout(120_000)
  const executable = process.env.RT_PACKAGED_EXE, root = process.env.RT_PACKAGED_TEST_ROOT
  if (process.env.RT_LEDGER_FIXTURE_ALLOWED !== '1' || !executable || !root || !isAbsolute(executable) || !isAbsolute(root)) throw Error('ISOLATED_PACKAGED_LEDGER_REQUIRED')
  if (process.platform === 'win32' && !resolve(executable).replace(/\\/g, '/').includes('/release/win-unpacked/')) throw Error('PRODUCTION_LEDGER_FIXTURES_FORBIDDEN')
  if (process.platform === 'darwin' && process.env.GITHUB_ACTIONS !== 'true') throw Error('MAC_LEDGER_REQUIRES_ISOLATED_CI')
  mkdirSync(root, { recursive: true })
  const profile = mkdtempSync(join(root, 'account-ledger-'))
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ELECTRON_RENDERER_URL: _renderer, NODE_PATH: _nodePath, NODE_OPTIONS: _options, ...environment } = process.env
  const alias = `隔离验收-${randomUUID().slice(0, 8)}`
  const errors: string[] = []
  let app: ElectronApplication | undefined
  async function launch() {
    app = await electron.launch({ executablePath: executable!, args: [`--user-data-dir=${profile}`], env: environment })
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(process.env.RT_PACKAGED_VERSION)
    await expect(async () => {
      const guide = page.getByTestId('cold-start-guide')
      if (await guide.isVisible()) await guide.getByLabel('关闭引导').click({ timeout: 2000 })
      if (!await page.getByTestId('open-account-ledger').isVisible()) {
        if (!await page.getByText('持仓总览', { exact: true }).first().isVisible()) await page.getByTestId('nav-tab-trend-watcher').click({ timeout: 2000 })
        await page.getByText('持仓总览', { exact: true }).first().click({ timeout: 2000 })
      }
      await page.getByTestId('open-account-ledger').click({ timeout: 2000 })
      await expect(page.getByTestId('account-ledger-panel')).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 45000 })
    return page.getByTestId('account-ledger-panel')
  }
  async function quit() {
    if (!app) return
    const child = app.process(), closed = app.waitForEvent('close')
    await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 25) })
    await closed
    await expect.poll(() => child.exitCode).toBe(0)
    app = undefined
  }
  try {
    let panel = await launch()
    // Open explicitly if a previous isolated acceptance account already exists.
    const opening = panel.locator('details')
    if (!await opening.getAttribute('open').then(v => v !== null)) await opening.locator('summary').click()
    await panel.getByLabel('新账户别名', { exact: true }).fill(alias)
    await panel.getByLabel('期初现金', { exact: true }).fill('10000')
    await panel.getByLabel('已核对全部期初持仓（确认无持仓也须勾选）').check()
    await panel.getByLabel('我已核对期初现金；这不是自动读取的券商余额').check()
    await panel.getByRole('button', { name: '保存期初事实', exact: true }).click()
    await expect(panel.getByTestId('ledger-summary')).toContainText('10000.00')
    await panel.getByLabel('成交或流水编号', { exact: true }).fill('isolated-buy')
    await panel.getByLabel('成交证券代码', { exact: true }).fill('600001.SH')
    await panel.getByLabel('成交价格', { exact: true }).fill('10')
    await panel.getByLabel('成交数量', { exact: true }).fill('1e2')
    await expect(panel).toContainText('按该笔成交计算金额：待填写')
    await panel.getByLabel('成交数量', { exact: true }).fill('100')
    for (const [label, value] of [['佣金', '5'], ['印花税', '0'], ['过户费', '0.01'], ['其他费用', '0']]) await panel.getByLabel(label, { exact: true }).fill(value)
    const confirmation = panel.getByLabel('我已核对真实成交或资金明细；不是仅提交、未成交或结果未知的委托')
    await expect(panel.getByRole('button', { name: '保存核对记录', exact: true })).toBeDisabled()
    await confirmation.check()
    await panel.getByRole('button', { name: '保存核对记录', exact: true }).click()
    await expect(panel.getByTestId('ledger-summary')).toContainText('8994.99')
    await expect(panel).toContainText('累计 1 条')
    await panel.getByLabel('成交或流水编号', { exact: true }).fill('isolated-buy')
    await confirmation.check()
    await panel.getByRole('button', { name: '保存核对记录', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('该成交或流水编号已记录')
    await expect(panel).toContainText('累计 1 条')
    app!.context().pages()[0].once('dialog', dialog => dialog.accept())
    await panel.getByRole('button', { name: '冲销本地记录', exact: true }).click()
    await expect(panel).toContainText('累计 2 条')
    await expect(panel.getByTestId('ledger-summary')).toContainText('10000.00')
    await panel.getByLabel('成交或流水编号', { exact: true }).fill('isolated-unknown-fees')
    await panel.getByLabel('该笔费用尚未确认（保留未知，不填零）').check()
    await confirmation.check()
    await panel.getByRole('button', { name: '保存核对记录', exact: true }).click()
    await expect(panel).toContainText('累计 3 条')
    await expect(panel.getByTestId('ledger-summary')).toContainText('未核验')
    await expect(panel).toContainText('费用未核对，现金及成本不能视为完整')
    await quit()
    panel = await launch()
    await panel.getByLabel('选择账户账本', { exact: true }).selectOption({ label: alias })
    await expect(panel).toContainText('累计 3 条')
    await expect(panel.getByTestId('ledger-summary')).toContainText('未核验')
    await expect(panel).toContainText('券商可用资金、可卖数量及实时市值均未接入')
    expect(errors).toEqual([])
    await quit()
  } finally { if (app) await app.close() }
})
