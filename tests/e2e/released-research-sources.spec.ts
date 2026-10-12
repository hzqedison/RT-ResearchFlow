import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

test('released app queries real Eastmoney reports through its page and reuses metadata without a Key', async () => {
  test.setTimeout(120_000)
  const executableInput = process.env.RT_PACKAGED_EXE, rootInput = process.env.RT_PACKAGED_TEST_ROOT
  const version = process.env.RT_PACKAGED_VERSION
  if (process.env.RT_RELEASED_PUBLIC_RESEARCH_LIVE !== '1' || !executableInput || !rootInput || !version) {
    throw new Error('EXPLICIT_RELEASED_RESEARCH_CONTEXT_REQUIRED')
  }
  const root = resolve(rootInput), executable = resolve(executableInput)
  if (process.platform === 'win32' && !executable.replaceAll('\\', '/').includes('/release/win-unpacked/')) throw new Error('PRODUCTION_WINDOWS_FORBIDDEN')
  if (process.platform === 'darwin') {
    const runner = resolve(process.env.RUNNER_TEMP ?? '')
    if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP || !root.startsWith(runner + sep) ||
        !executable.startsWith(runner + sep) || !executable.endsWith('.app/Contents/MacOS/RT-ResearchFlow')) throw new Error('OWNED_NATIVE_MAC_REQUIRED')
  }
  mkdirSync(root, { recursive: true })
  const profile = process.platform === 'win32' ? join(dirname(executable), 'data') : mkdtempSync(join(root, 'report-profile-'))
  const env = { ...process.env, TEMP: root, TMP: root }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'NODE_PATH']) delete env[key]
  const application = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env })
  let normalExit = false
  try {
    const page = await application.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    await expect(async () => {
      const runtime = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), dataPath: app.getPath('userData') }))
      expect(runtime.packaged).toBe(true); expect(runtime.version).toBe(version); expect(resolve(runtime.dataPath)).toBe(profile)
    }).toPass({ timeout: 30_000 })
    const configuration = await page.evaluate(() => window.api.datasource.getConfig())
    expect(configuration.hasTushareToken).toBe(false)
    expect(configuration.reportProviders).toEqual(['eastmoney'])
    const first = await page.evaluate(() => window.api.datasource.reports('000333'))
    expect(first.metadataOnly).toBe(true)
    expect(first.statuses).toHaveLength(1)
    expect(first.statuses[0]).toMatchObject({ provider: 'eastmoney', state: 'ready' })
    expect(first.reports.length).toBeGreaterThan(0)
    expect(first.reports.length).toBeLessThanOrEqual(50)
    expect(first.reports.every(report => report.stockCode === '000333' && report.title.trim() &&
      /^\d{4}-\d{2}-\d{2}$/.test(report.publishedAt) && report.providers.includes('eastmoney'))).toBe(true)
    const dates = first.reports.map(report => report.publishedAt)
    expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)))
    const pdfs = first.reports.flatMap(report => report.pdfUrl ? [report.pdfUrl] : [])
    expect(pdfs.length).toBeGreaterThan(0)
    for (const input of pdfs) {
      const url = new URL(input)
      expect(url.protocol).toBe('https:'); expect(url.hostname).toBe('pdf.dfcfw.com')
      expect(url.username).toBe(''); expect(url.password).toBe('')
    }
    const cached = await page.evaluate(() => window.api.datasource.reports('000333'))
    expect(cached.metadataOnly).toBe(true)
    expect(cached.statuses).toHaveLength(1)
    expect(cached.statuses[0]).toMatchObject({ provider: 'eastmoney', state: 'cached' })
    expect(cached.reports).toEqual(first.reports)
    const guide = page.getByTestId('cold-start-guide')
    if (await guide.isVisible()) await guide.getByLabel('关闭引导').click()
    await page.getByTestId('open-config-drawer-btn').click()
    await page.getByTestId('config-tab-datasource').click()
    const panel = page.getByTestId('config-panel-datasource')
    await panel.getByLabel('测试股票代码').fill('601318')
    const queryButton = panel.getByRole('button', { name: '查询研报', exact: true })
    await expect(queryButton).toHaveCount(1)
    await expect(queryButton).toBeEnabled()
    const originalButton = await queryButton.elementHandle()
    if (!originalButton) throw new Error('ORIGINAL_REPORT_QUERY_BUTTON_MISSING')
    await originalButton.click()
    await expect.poll(() => originalButton.evaluate(button => !(button as HTMLButtonElement).disabled), { timeout: 30_000 }).toBe(true)
    const uiResult = await page.evaluate(() => window.api.datasource.reports('601318'))
    expect(uiResult.metadataOnly).toBe(true)
    expect(uiResult.statuses).toEqual([expect.objectContaining({ provider: 'eastmoney', state: 'cached' })])
    expect(uiResult.reports.length).toBeGreaterThanOrEqual(3)
    expect(uiResult.reports.length).toBeLessThanOrEqual(50)
    expect(uiResult.reports.every(report => report.stockCode === '601318')).toBe(true)
    for (const report of uiResult.reports.slice(0, 3)) await expect(panel).toContainText(report.title)
    expect(pageErrors).toEqual([])
    const child = application.process(), closed = application.waitForEvent('close', { timeout: 15_000 })
    await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
    await closed
    await expect.poll(() => child.exitCode, { timeout: 5_000 }).toBe(0)
    normalExit = true
    const receipt = { kind: 'released-research-source-acceptance', version, platform: process.platform, arch: process.arch,
      stockCode: '000333', provider: 'eastmoney', reportCount: first.reports.length, publicPdfReferences: pdfs.length,
      latestReportDate: dates[0], firstState: first.statuses[0].state, secondState: cached.statuses[0].state,
      identicalCacheRead: true, metadataOnly: true, pdfDownloadVerified: false, fullTextVerified: false,
      packagedReportQueryUiVerified: true, uiStockCode: '601318', queryButtonClicked: true, originalButtonWaitCompleted: true,
      uiReportCount: uiResult.reports.length, visibleSampleTitles: 3, uiCacheState: uiResult.statuses[0].state, rendererErrors: 0,
      userCredentialUsed: false, marketRowsMocked: false, reportRowsMocked: false, normalExit,
      productionUserDataTouched: false, brokerOrdersSubmitted: false }
    writeFileSync(join(root, 'released-research-source-receipt.json'), JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify(receipt))
  } finally { if (!normalExit) await application.close().catch(() => {}) }
})
