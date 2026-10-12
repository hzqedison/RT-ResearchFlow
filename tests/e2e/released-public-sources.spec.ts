import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { waitForPackagedRuntime } from './packagedRuntimeObservation'

function context() {
  const executable = process.env.RT_PACKAGED_EXE ?? ''
  const root = process.env.RT_PACKAGED_TEST_ROOT ?? ''
  const version = process.env.RT_PACKAGED_VERSION ?? ''
  const date = process.env.RT_PUBLIC_LIMIT_POOL_DATE ?? ''
  if (process.env.RT_RELEASED_PUBLIC_DATA_LIVE !== '1' || !isAbsolute(executable) ||
      !isAbsolute(root) || !/^\d+\.\d+\.\d+$/.test(version) || !/^\d{8}$/.test(date)) {
    throw Error('EXPLICIT_RELEASED_PUBLIC_DATA_ACCEPTANCE_REQUIRED')
  }
  if (process.platform === 'win32') {
    if (!resolve(executable).replace(/\\/g, '/').includes('/release/win-unpacked/')) {
      throw Error('PRODUCTION_WINDOWS_DATA_FORBIDDEN')
    }
  } else if (process.platform === 'darwin') {
    const runnerRoot = process.env.RUNNER_TEMP
    if (process.env.GITHUB_ACTIONS !== 'true' || !runnerRoot ||
        !resolve(root).startsWith(resolve(runnerRoot) + sep) ||
        !resolve(executable).startsWith(resolve(runnerRoot) + sep) ||
        !executable.endsWith('.app/Contents/MacOS/RT-ResearchFlow')) {
      throw Error('OWNED_MAC_CI_APPLICATION_REQUIRED')
    }
  } else throw Error('UNSUPPORTED_ACCEPTANCE_PLATFORM')
  mkdirSync(root, { recursive: true })
  return { executable, root, version, date }
}

async function launch() {
  const config = context()
  const profile = mkdtempSync(join(config.root, 'released-public-'))
  const env = { ...process.env, TEMP: config.root, TMP: config.root }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.NODE_OPTIONS
  delete env.NODE_PATH
  const application = await electron.launch({ executablePath: config.executable,
    args: [`--user-data-dir=${profile}`], env, timeout: 30_000 })
  const errors: string[] = []
  try {
    const page = await application.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    const runtime = await waitForPackagedRuntime(application, config.version)
    const expectedData = process.platform === 'win32' ? join(dirname(config.executable), 'data') : profile
    expect(resolve(runtime.dataPath)).toBe(resolve(expectedData))
    return { ...config, profile, application, page, errors }
  } catch (error) {
    await application.close().catch(() => {})
    throw error
  }
}

async function quit(application: ElectronApplication) {
  const child = application.process()
  const exited = application.waitForEvent('close', { timeout: 15_000 })
  await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
  await exited
  await expect.poll(() => child.exitCode, { timeout: 5_000 }).toBe(0)
}

test('released package synchronizes real public facts and persists all three free rules', async () => {
  test.setTimeout(120_000)
  const c = await launch()
  let normalExit = false
  try {
    const calendar = await c.page.evaluate(() => window.api.diagnostics.runCheck('syncTradeCalendar'))
    expect(calendar).toMatchObject({ ok: true })
    const saved = await c.page.evaluate(date => window.api.datasource.syncPublicLimitPool(date), c.date)
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw Error('PUBLIC_SYNC_FAILED')
    expect(saved.rows).toBeGreaterThan(0)
    const cache = await c.page.evaluate(() => window.api.datasource.listVerifiedPublicLimitPool())
    expect(cache).toMatchObject({ source: 'eastmoney_public', tradeDate: c.date, dateBasis: 'source-reported' })
    expect(cache.rows).toHaveLength(saved.rows)
    const catalog = await c.page.evaluate(() => window.api.strategyLab.listStrategies())
    expect(catalog.ok).toBe(true)
    if (!catalog.ok) throw Error('STRATEGY_CATALOG_FAILED')
    const templates = catalog.strategies.filter(item => item.strategyKey.startsWith('builtin-public-limit-'))
    expect(templates).toHaveLength(3)
    const reports = []
    for (const template of templates) {
      const submitted = await c.page.evaluate(id => window.api.strategyLab.runStrategy(id), template.id)
      expect(submitted.ok).toBe(true)
      if (!submitted.ok) throw Error('PUBLIC_RULE_RUN_FAILED')
      const result = await c.page.evaluate(id => window.api.strategyLab.getRun(id), submitted.runId)
      expect(result.ok).toBe(true)
      if (!result.ok) throw Error('PUBLIC_RULE_RESULT_FAILED')
      expect(result.run.status).toBe('completed')
      const matches = await c.page.evaluate(id => window.api.strategyLab.listMatches({ runId: id, limit: 500 }), submitted.runId)
      expect(matches.ok).toBe(true)
      if (!matches.ok) throw Error('PUBLIC_RULE_EVIDENCE_FAILED')
      expect(matches.matches).toHaveLength(submitted.matchedCount)
      for (const match of matches.matches) {
        expect(JSON.parse(match.evidenceJson)).toMatchObject({ source: 'eastmoney_public', sourceDate: c.date, scoreMeaning: 'rule-pass-only' })
      }
      const backtest = await c.page.evaluate(id => window.api.strategyLab.createBacktestFromRun(id), submitted.runId)
      expect(backtest).toMatchObject({ ok: false, code: 'PUBLIC_LIMIT_BACKTEST_UNAVAILABLE' })
      reports.push({ strategy: template.strategyKey, matched: submitted.matchedCount })
    }
    await quit(c.application)
    normalExit = true
    expect(c.errors).toEqual([])
    const receipt = { kind: 'released-public-rule-acceptance', version: c.version, platform: process.platform,
      arch: process.arch, date: c.date, rows: cache.rows.length, reports, calendarFixtureInjected: false,
      marketRowsMocked: false, normalExit, productionUserDataTouched: false, brokerOrdersSubmitted: false }
    writeFileSync(join(c.root, 'released-public-rule-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
    console.log(JSON.stringify(receipt))
  } finally { if (!normalExit) await c.application.close().catch(() => {}) }
})

test('released package can read each configured public daily provider', async () => {
  test.setTimeout(90_000)
  const c = await launch()
  let normalExit = false
  try {
    const results = []
    for (const provider of ['tencent', 'eastmoney', 'sina'] as const) {
      const code = provider === 'eastmoney' ? '600519' : provider === 'sina' ? '600000' : '000001'
      const result = await c.page.evaluate(({ provider, code }) => window.api.datasource.probe(provider, code), { provider, code })
      results.push({ provider, stockCode: code, ...result })
      expect.soft(result.ok, `${provider} must return real daily data`).toBe(true)
      expect.soft(result.rows, `${provider} daily rows`).toBeGreaterThan(0)
    }
    await quit(c.application)
    normalExit = true
    expect(c.errors).toEqual([])
    const receipt = { kind: 'released-public-daily-acceptance', version: c.version, platform: process.platform,
      arch: process.arch, results, allProvidersAvailable: results.every(item => item.ok && item.rows > 0),
      normalExit, marketRowsMocked: false, productionUserDataTouched: false, brokerOrdersSubmitted: false }
    writeFileSync(join(c.root, 'released-public-daily-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
    console.log(JSON.stringify(receipt))
  } finally { if (!normalExit) await c.application.close().catch(() => {}) }
})

test('Tushare binding remains accessible with only a free provider and rejects an empty credential', async () => {
  test.setTimeout(120_000)
  const c = await launch()
  let previousProviders: Array<'tushare' | 'tencent' | 'eastmoney' | 'sina' | 'tdx' | 'akshare'> | undefined
  let normalExit = false
  try {
    const before = await c.page.evaluate(() => window.api.datasource.getConfig())
    previousProviders = before.dailyProviders
    expect(before.hasTushareToken).toBe(false)
    expect(await c.page.evaluate(() => window.api.datasource.saveConfig({ dailyProviders: ['tencent'] }))).toEqual({ ok: true })
    await expect(async () => {
      const guide = c.page.getByTestId('cold-start-guide')
      if (await guide.isVisible()) await guide.getByLabel('关闭引导').click({ timeout: 2_000 })
      if (!await c.page.getByTestId('config-tab-datasource').isVisible()) {
        await c.page.getByTestId('open-config-drawer-btn').click({ timeout: 2_000 })
      }
      await c.page.getByTestId('config-tab-datasource').click({ timeout: 2_000 })
      await expect(c.page.locator('#tushare-key-binding')).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    const panel = c.page.locator('#tushare-key-binding')
    const token = panel.getByLabel('Tushare Pro Token', { exact: true })
    const bind = panel.getByRole('button', { name: '绑定并验证新 Key', exact: true })
    const recheck = panel.getByRole('button', { name: '复查已绑定 Key', exact: true })
    await expect(token).toHaveAttribute('type', 'password')
    await expect(token).toHaveValue('')
    await expect(bind).toBeDisabled()
    await expect(recheck).toBeDisabled()
    await expect(panel.getByRole('status')).toContainText('未绑定')
    await expect(panel.getByRole('link', { name: '前往 Tushare 获取 Token', exact: true })).toHaveAttribute('href', 'https://tushare.pro/user/token')
    await token.fill('   ')
    await expect(bind).toBeDisabled()
    await token.fill('offline-unsaved-draft-not-a-real-key')
    await expect(bind).toBeEnabled()
    await expect(panel.getByRole('status')).toContainText('新 Key 尚未绑定')
    expect((await c.page.evaluate(() => window.api.datasource.getConfig())).hasTushareToken).toBe(false)
    await token.fill('')
    const verification = await c.page.evaluate(() => window.api.datasource.validateTushare(''))
    expect(verification.state).toBe('unbound')
    const after = await c.page.evaluate(() => window.api.datasource.getConfig())
    expect(after.hasTushareToken).toBe(false)
    expect(after.dailyProviders).toEqual(['tencent'])
    expect(after.tushareEnabled).toBe(false)
    expect(await c.page.evaluate(providers => window.api.datasource.saveConfig({ dailyProviders: providers }), previousProviders)).toEqual({ ok: true })
    expect((await c.page.evaluate(() => window.api.datasource.getConfig())).dailyProviders).toEqual(previousProviders)
    await quit(c.application)
    normalExit = true
    expect(c.errors).toEqual([])
    const receipt = {
      kind: 'released-tushare-binding-entry-acceptance', version: c.version, platform: process.platform, arch: process.arch,
      enabledProvider: 'tencent', bindingEntryVisible: true, passwordInputEditable: true, emptyBindingDisabled: true,
      unsavedDraftPersisted: false, unboundVerificationState: verification.state, actualAuthenticationVerified: false,
      professionalApiPermissionsVerified: false, isolatedPreferenceRestored: true, normalExit,
      productionUserDataTouched: false, brokerOrdersSubmitted: false,
    }
    writeFileSync(join(c.root, 'released-tushare-binding-entry-receipt.json'), JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify(receipt))
  } finally {
    if (!normalExit) {
      if (previousProviders) await c.page.evaluate(providers => window.api.datasource.saveConfig({ dailyProviders: providers }), previousProviders).catch(() => {})
      await c.application.close().catch(() => {})
    }
  }
})

test('selected free source supplies the real stock-chart consumer when Tushare has no credential', async () => {
  test.setTimeout(120_000)
  const c = await launch()
  let normalExit = false
  const previous = await c.page.evaluate(() => window.api.datasource.getConfig())
  try {
    expect(previous.hasTushareToken).toBe(false)
    const saved = await c.page.evaluate(() => window.api.datasource.saveConfig({ dailyProviders: ['tushare', 'tencent'] }))
    expect(saved).toMatchObject({ ok: true })
    const selected = await c.page.evaluate(() => window.api.datasource.getConfig())
    expect(selected.dailyProviders).toEqual(['tushare', 'tencent'])
    expect(selected.hasTushareToken).toBe(false)

    const fetched = await c.page.evaluate(() => window.api.datasource.fetchStock('600036'))
    expect(fetched.error).toBeUndefined()
    expect(fetched.stockCode).toBeTruthy()
    expect(fetched.provider).toBe('tencent')
    expect(fetched.totalRows).toBeGreaterThan(0)
    expect(fetched.latestTradeDate).toBe(c.date)
    const pageOfPrices = await c.page.evaluate(code => window.api.datasource.getStockPricePage(code, undefined, 20), fetched.stockCode!)
    expect(pageOfPrices.ok).toBe(true)
    if (!pageOfPrices.ok) throw Error('REAL_CHART_PRICE_PAGE_FAILED')
    expect(pageOfPrices.rows.length).toBeGreaterThan(0)
    expect(pageOfPrices.rows.every(row => Number.isFinite(row.close) && row.close > 0)).toBe(true)

    await expect(async () => {
      const guide = c.page.getByTestId('cold-start-guide')
      if (await guide.isVisible()) await guide.getByLabel('关闭引导').click({ timeout: 2_000 })
      if (!await c.page.getByTestId('stock-chart-root').isVisible()) {
        await c.page.getByText('股票走势图', { exact: true }).first().click({ timeout: 2_000 })
      }
      await expect(c.page.getByTestId('stock-chart-root')).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    await c.page.getByTestId(`stock-list-item-${fetched.stockCode}`).click()
    await expect(c.page.getByTestId('stock-chart-history-summary')).toContainText(/[1-9]\d*/, { timeout: 30_000 })
    await expect(c.page.getByTestId('daily-chart-container')).toBeVisible()
    const historySummary = await c.page.getByTestId('stock-chart-history-summary').innerText()
    const restored = await c.page.evaluate(providers => window.api.datasource.saveConfig({ dailyProviders: providers }), previous.dailyProviders)
    expect(restored).toMatchObject({ ok: true })
    const after = await c.page.evaluate(() => window.api.datasource.getConfig())
    expect(after.dailyProviders).toEqual(previous.dailyProviders)
    expect(after.hasTushareToken).toBe(false)
    await quit(c.application)
    normalExit = true
    expect(c.errors).toEqual([])
    const receipt = { kind: 'released-stock-chart-consumer-acceptance', version: c.version,
      platform: process.platform, arch: process.arch, configuredProviders: ['tushare', 'tencent'],
      tushareCredentialPresent: false, actualProvider: fetched.provider, stockCode: fetched.stockCode,
      totalRows: fetched.totalRows, latestTradeDate: fetched.latestTradeDate,
      pricePageRows: pageOfPrices.rows.length, visibleHistorySummary: historySummary,
      isolatedPreferenceRestored: true, marketRowsMocked: false, normalExit,
      productionUserDataTouched: false, brokerOrdersSubmitted: false }
    writeFileSync(join(c.root, 'released-stock-chart-consumer-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
    console.log(JSON.stringify(receipt))
  } finally {
    if (!normalExit) {
      await c.page.evaluate(providers => window.api.datasource.saveConfig({ dailyProviders: providers }), previous.dailyProviders).catch(() => {})
      await c.application.close().catch(() => {})
    }
  }
})
