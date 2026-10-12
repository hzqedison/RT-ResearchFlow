import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

test('released app reads real selected Eastmoney report metadata and reuses its cache without a Key', async () => {
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
    const child = application.process(), closed = application.waitForEvent('close', { timeout: 15_000 })
    await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
    await closed
    await expect.poll(() => child.exitCode, { timeout: 5_000 }).toBe(0)
    normalExit = true
    const receipt = { kind: 'released-research-source-acceptance', version, platform: process.platform, arch: process.arch,
      stockCode: '000333', provider: 'eastmoney', reportCount: first.reports.length, publicPdfReferences: pdfs.length,
      latestReportDate: dates[0], firstState: first.statuses[0].state, secondState: cached.statuses[0].state,
      identicalCacheRead: true, metadataOnly: true, pdfDownloadVerified: false, fullTextVerified: false,
      userCredentialUsed: false, marketRowsMocked: false, reportRowsMocked: false, normalExit,
      productionUserDataTouched: false, brokerOrdersSubmitted: false }
    writeFileSync(join(root, 'released-research-source-receipt.json'), JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify(receipt))
  } finally { if (!normalExit) await application.close().catch(() => {}) }
})
