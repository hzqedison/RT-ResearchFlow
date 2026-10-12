import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isolatedPackagedExecutable } from './isolatedPackagedExecutable'
import { waitForPackagedRuntime } from './packagedRuntimeObservation'

type UiFixture = {
  reportMode: 'success' | 'pending'; wencaiMode: 'success' | 'pending'; dailyMode: 'success' | 'pending'
  reportRequests: number; dailyRequests: number; wencaiRequests: number
  finishReports?: (value: unknown) => void; finishDaily?: (value: unknown) => void; finishWencai?: (value: unknown) => void
}

test('packaged datasource operations show truthful waiting, stable controls and no stale query results', async () => {
  test.setTimeout(120_000)
  const executable = process.env.RT_PACKAGED_EXE, root = process.env.RT_PACKAGED_TEST_ROOT, version = process.env.RT_PACKAGED_VERSION
  if (process.env.RT_DATASOURCE_UI_FIXTURE_ALLOWED !== '1' || !executable || !root || !version ||
      !isAbsolute(executable) || !isAbsolute(root)) throw new Error('ISOLATED_DATASOURCE_UI_REQUIRED')
  if (process.platform === 'win32' && !resolve(executable).replaceAll('\\', '/').includes('/release/win-unpacked/')) throw new Error('PRODUCTION_DATASOURCE_FIXTURE_FORBIDDEN')
  if (process.platform === 'darwin' && process.env.GITHUB_ACTIONS !== 'true') throw new Error('MAC_DATASOURCE_FIXTURE_REQUIRES_CI')
  const profile = mkdtempSync(join(root, 'datasource-ui-')), isolated = isolatedPackagedExecutable(executable, profile)
  const environment = { ...process.env, NODE_ENV: 'test' }
  for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'NODE_PATH']) delete environment[name]
  const application = await electron.launch({ executablePath: isolated, args: ['--user-data-dir=' + profile], env: environment })
  const child = application.process(), pageErrors: string[] = []
  let normalExit = false
  try {
    const page = await application.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    const runtime = await waitForPackagedRuntime(application, version)
    expect(resolve(runtime.dataPath)).toBe(process.platform === 'win32' ? resolve(dirname(isolated), 'data') : resolve(profile))
    await page.evaluate(() => window.api.datasource.saveConfig({ dailyProviders: ['eastmoney'], reportProviders: ['eastmoney'], wencaiEnabled: true }))
    await application.evaluate(({ ipcMain }) => {
      const global = globalThis as typeof globalThis & { __datasourceUiFixture?: UiFixture }
      const fixture: UiFixture = global.__datasourceUiFixture = { reportMode: 'success', wencaiMode: 'success', dailyMode: 'pending', reportRequests: 0, dailyRequests: 0, wencaiRequests: 0 }
      ipcMain.removeHandler('datasource:reports')
      ipcMain.handle('datasource:reports', (_event, payload: string | { stockCode?: string }) => {
        fixture.reportRequests++
        if (fixture.reportMode === 'pending') return new Promise(resolveReply => { fixture.finishReports = resolveReply })
        const stockCode = typeof payload === 'string' ? payload : payload.stockCode ?? ''
        return { ok: true, reports: [{ id: 'isolated-report-' + stockCode, stockCode, title: '隔离研报 ' + stockCode,
          institution: '合成检查机构', publishedAt: '2026-10-12', pdfUrl: null, providers: ['eastmoney'] }],
          statuses: [{ provider: 'eastmoney', state: 'ready', message: '隔离索引结果' }], fetchedAt: Date.now(), metadataOnly: true }
      })
      ipcMain.removeHandler('datasource:refreshStock')
      ipcMain.handle('datasource:refreshStock', () => {
        fixture.dailyRequests++
        if (fixture.dailyMode === 'pending') return new Promise(resolveReply => { fixture.finishDaily = resolveReply })
        return { ok: true, message: '隔离日线响应已完成' }
      })
      ipcMain.removeHandler('datasource:wencai')
      ipcMain.handle('datasource:wencai', () => {
        fixture.wencaiRequests++
        if (fixture.wencaiMode === 'pending') return new Promise(resolveReply => { fixture.finishWencai = resolveReply })
        return { ok: true, columns: ['名称'], rows: [{ 名称: '隔离问财结果' }], fetchedAt: Date.now(), truncated: false }
      })
    })
    const guide = page.getByTestId('cold-start-guide')
    if (await guide.isVisible()) await guide.getByLabel('关闭引导').click()
    await page.getByTestId('open-config-drawer-btn').click()
    await page.getByTestId('config-tab-datasource').click()
    const panel = page.getByTestId('config-panel-datasource'), progress = panel.getByTestId('data-source-operation-status')
    const save = panel.getByRole('button', { name: '保存全部数据源配置', exact: true })
    const query = panel.getByRole('button', { name: '查询研报', exact: true })
    await panel.getByLabel('测试股票代码').fill('000333')
    await query.click()
    await expect(panel.getByTestId('data-source-report-results')).toContainText('隔离研报 000333')
    await panel.getByLabel('测试股票代码').fill('601318')
    await expect(panel.getByTestId('data-source-report-results')).toHaveCount(0)
    await query.click()
    await expect(panel.getByTestId('data-source-report-results')).toContainText('隔离研报 601318')
    await application.evaluate(() => { (globalThis as typeof globalThis & { __datasourceUiFixture: UiFixture }).__datasourceUiFixture.reportMode = 'pending' })
    await query.click()
    await expect(progress).toContainText('查询研报')
    await expect(query).toHaveCount(1)
    await expect(save).toBeDisabled()
    await expect(panel.getByTestId('data-source-success-message')).toHaveCount(0)
    await expect(panel.getByTestId('data-source-report-results')).toHaveCount(0)
    await expect.poll(() => application.evaluate(() => !!(globalThis as typeof globalThis & { __datasourceUiFixture: UiFixture }).__datasourceUiFixture.finishReports)).toBe(true)
    await application.evaluate(() => {
      const fixture = (globalThis as typeof globalThis & { __datasourceUiFixture: UiFixture }).__datasourceUiFixture
      fixture.finishReports!({ ok: false, message: '隔离研报请求失败，请重试。' })
    })
    await expect(panel.getByRole('alert')).toHaveText('隔离研报请求失败，请重试。')
    await expect(progress).toHaveCount(0)
    await expect(save).toBeEnabled()
    await expect(panel.getByTestId('data-source-report-results')).toHaveCount(0)

    await panel.getByRole('button', { name: '按优先级读取日线', exact: true }).click()
    await expect(progress).toContainText('读取日线')
    await expect(panel.getByTestId('data-source-success-message')).toHaveCount(0)
    await expect.poll(() => application.evaluate(() => !!(globalThis as typeof globalThis & { __datasourceUiFixture: UiFixture }).__datasourceUiFixture.finishDaily)).toBe(true)
    await application.evaluate(() => {
      const fixture = (globalThis as typeof globalThis & { __datasourceUiFixture: UiFixture }).__datasourceUiFixture
      fixture.finishDaily!({ ok: false, reason: 'fetch_error', message: '所选日线来源均未完成取数：东方财富: 行情接口触发限流，请稍后再试或切换来源。 (HTTP 429)' })
      fixture.dailyMode = 'success'
    })
    await expect(panel.getByRole('alert')).toContainText('HTTP 429')
    await expect(panel.getByRole('alert')).toContainText('限流')
    await expect(progress).toHaveCount(0)
    await panel.getByRole('button', { name: '按优先级读取日线', exact: true }).click()
    await expect(panel.getByTestId('data-source-success-message')).toHaveText('隔离日线响应已完成')

    const wencaiInput = panel.getByPlaceholder('输入问财选股条件，例如：沪深A股，市值大于100亿')
    const wencaiButton = panel.getByRole('button', { name: '查询条件（不下单）', exact: true })
    await wencaiInput.fill('合成条件')
    await wencaiButton.click()
    await expect(panel.getByTestId('data-source-wencai-results')).toContainText('隔离问财结果')
    await application.evaluate(() => { (globalThis as typeof globalThis & { __datasourceUiFixture: UiFixture }).__datasourceUiFixture.wencaiMode = 'pending' })
    await wencaiButton.click()
    await expect(progress).toContainText('查询问财')
    await expect(panel.getByTestId('data-source-wencai-results')).toHaveCount(0)
    await expect(panel.getByTestId('data-source-success-message')).toHaveCount(0)
    await expect.poll(() => application.evaluate(() => !!(globalThis as typeof globalThis & { __datasourceUiFixture: UiFixture }).__datasourceUiFixture.finishWencai)).toBe(true)
    await application.evaluate(() => {
      (globalThis as typeof globalThis & { __datasourceUiFixture: UiFixture }).__datasourceUiFixture.finishWencai!({ ok: false, message: '隔离问财请求失败，请重试。' })
    })
    await expect(panel.getByRole('alert')).toHaveText('隔离问财请求失败，请重试。')
    await expect(panel.getByTestId('data-source-wencai-results')).toHaveCount(0)
    await save.click()
    await expect(panel.getByTestId('data-source-success-message')).toContainText('配置已保存')
    await expect(progress).toHaveCount(0)
    expect(pageErrors).toEqual([])
    const requests = await application.evaluate(() => {
      const fixture = (globalThis as typeof globalThis & { __datasourceUiFixture: UiFixture }).__datasourceUiFixture
      return { reports: fixture.reportRequests, daily: fixture.dailyRequests, wencai: fixture.wencaiRequests }
    })
    expect(requests).toEqual({ reports: 3, daily: 2, wencai: 2 })
    const closing = application.waitForEvent('close', { timeout: 15_000 })
    await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
    await closing
    await expect.poll(() => child.exitCode, { timeout: 5_000 }).toBe(0)
    normalExit = true
    const receipt = { kind: 'packaged-datasource-operation-acceptance', version, platform: process.platform, arch: process.arch,
      sourceCommit: process.env.GITHUB_SHA ?? null, requests, waitingStatusVisible: true, stableSaveButton: true,
      automaticSaveNotReportedAsQuerySuccess: true, oldReportsCleared: true, oldWencaiResultsCleared: true,
      classifiedDailyFailureVisible: true, explicitSaveConfirmed: true, rendererErrors: 0, normalExit,
      queryResponsesSynthetic: true, realDataSourceAuthenticationVerified: false, liveMarketDataAccepted: false,
      productionUserDataTouched: false, brokerOrdersSubmitted: false }
    writeFileSync(join(root, 'data-source-ui-acceptance-' + process.platform + '-' + process.arch + '.json'), JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify(receipt))
  } finally { if (!normalExit) await application.close().catch(() => {}) }
})
