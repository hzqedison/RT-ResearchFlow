import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

test('released short-term UI runs all three free rules and displays their saved factual evidence', async () => {
  test.setTimeout(180_000)
  const executableInput = process.env.RT_PACKAGED_EXE
  const rootInput = process.env.RT_PACKAGED_TEST_ROOT
  const version = process.env.RT_PACKAGED_VERSION
  const date = process.env.RT_PUBLIC_LIMIT_POOL_DATE
  if (process.env.RT_RELEASED_PUBLIC_UI_LIVE !== '1' || !executableInput || !rootInput || !version || !date || !/^\d{8}$/.test(date)) {
    throw new Error('EXPLICIT_RELEASED_PUBLIC_UI_CONTEXT_REQUIRED')
  }
  const executable = resolve(executableInput), root = resolve(rootInput)
  if (process.platform === 'win32' && !executable.replaceAll('\\', '/').includes('/release/win-unpacked/')) throw new Error('PRODUCTION_WINDOWS_FORBIDDEN')
  if (process.platform === 'darwin') {
    const runner = resolve(process.env.RUNNER_TEMP ?? '')
    if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP || !root.startsWith(runner + sep) ||
        !executable.startsWith(runner + sep) || !executable.endsWith('.app/Contents/MacOS/RT-ResearchFlow')) throw new Error('OWNED_NATIVE_MAC_REQUIRED')
  }
  mkdirSync(root, { recursive: true })
  const profile = mkdtempSync(join(root, 'free-rule-ui-profile-'))
  const env = { ...process.env, TEMP: root, TMP: root }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'NODE_PATH']) delete env[key]
  const application = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env })
  let normalExit = false
  const pageErrors: string[] = []
  try {
    const page = await application.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    await expect(async () => {
      const runtime = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), dataPath: app.getPath('userData') }))
      expect(runtime.packaged).toBe(true)
      expect(runtime.version).toBe(version)
      expect(resolve(runtime.dataPath)).toBe(process.platform === 'win32' ? join(dirname(executable), 'data') : profile)
    }).toPass({ timeout: 30_000 })
    expect((await page.evaluate(() => window.api.datasource.getConfig())).hasTushareToken).toBe(false)
    const guide = page.getByTestId('cold-start-guide')
    if (await guide.isVisible()) await guide.getByLabel('关闭引导').click()
    await page.evaluate(() => window.api.diagnostics.runCheck('syncTradeCalendar'))
    const synchronized = await page.evaluate(d => window.api.datasource.syncPublicLimitPool(d), date)
    expect(synchronized.ok).toBe(true)
    expect(synchronized.rows).toBeGreaterThan(0)
    const listed = await page.evaluate(() => window.api.strategyLab.listStrategies())
    expect(listed.ok).toBe(true)
    if (!listed.ok) throw new Error('STRATEGY_LIST_NOT_AVAILABLE')
    await page.getByTestId('nav-tab-short-term-strategy').click()
    await page.getByTestId('secondary-nav-short-term-strategy-strategyLab').click()
    const main = page.getByTestId('strategy-lab-main')
    await expect(main).toBeVisible()
    const checks: Array<Record<string, unknown>> = []
    for (const [label, strategyKey] of [
      ['免费 · 早封首板', 'builtin-public-limit-earlyFirst'],
      ['免费 · 二板观察', 'builtin-public-limit-secondBoard'],
      ['免费 · 连板观察', 'builtin-public-limit-continuous'],
    ]) {
      const strategy = listed.strategies.find(value => value.strategyKey === strategyKey)
      expect(strategy).toBeDefined()
      if (!strategy) throw new Error('FREE_RULE_NOT_AVAILABLE')
      const before = await page.evaluate(id => window.api.strategyLab.listRuns({ strategyId: id, limit: 10 }), strategy.id)
      expect(before.ok).toBe(true)
      if (!before.ok) throw new Error('PRIOR_RUNS_NOT_READABLE')
      const priorIds = new Set(before.runs.map(run => run.id))
      await page.getByRole('button', { name: new RegExp(label) }).click()
      await expect(main.getByRole('heading', { name: label, exact: true })).toBeVisible()
      const runButton = main.getByRole('button', { name: '运行扫描', exact: true })
      await expect(runButton).toBeEnabled()
      await runButton.click()
      let run: { id: number; summaryJson: string | null } | undefined
      await expect(async () => {
        const after = await page.evaluate(id => window.api.strategyLab.listRuns({ strategyId: id, limit: 10 }), strategy.id)
        expect(after.ok).toBe(true)
        if (!after.ok) throw new Error('NEW_RUN_NOT_READABLE')
        const added = after.runs.filter(value => !priorIds.has(value.id))
        expect(added).toHaveLength(1)
        expect(added[0].status).toBe('completed')
        run = added[0]
      }).toPass({ timeout: 30_000 })
      if (!run?.summaryJson) throw new Error('SAVED_RUN_SUMMARY_MISSING')
      const summary = JSON.parse(run.summaryJson)
      expect(summary.engine).toBe('publicLimitUp')
      expect(summary.dateStart).toBe(date)
      expect(summary.dateEnd).toBe(date)
      expect(summary.matchedCount).toBeGreaterThan(0)
      await expect(main.getByText('来自 run #' + run.id, { exact: true })).toBeVisible()
      const evidenceButtons = main.getByRole('button', { name: '证据', exact: true })
      await expect(evidenceButtons).toHaveCount(summary.matchedCount)
      const firstRow = await evidenceButtons.first().evaluate(button => button.closest('tr')?.innerText ?? '')
      const code = firstRow.match(/\b\d{6}\b/)?.[0]
      expect(code).toBeDefined()
      if (!code) throw new Error('VISIBLE_MATCH_STOCK_CODE_MISSING')
      await evidenceButtons.first().click()
      const sidebar = page.getByTestId('strategy-evidence-sidebar'), drawer = page.getByTestId('strategy-evidence-drawer')
      const pane = await sidebar.isVisible() ? sidebar : drawer
      await expect(pane).toBeVisible()
      await expect(async () => {
        const text = await pane.innerText()
        expect(text).toContain(code)
        expect(text.replace(/[\/-]/g, '')).toContain(date)
      }).toPass({ timeout: 30_000 })
      checks.push({ strategyKey, runEnabledWithoutKey: true, newRunCount: 1, completed: true,
        displayedMatches: summary.matchedCount, evidenceOpened: true, visibleEvidenceCode: code, visibleEvidenceDate: date })
      if (await drawer.isVisible()) await drawer.getByRole('button', { name: '关闭证据', exact: true }).click()
    }
    const child = application.process(), closed = application.waitForEvent('close', { timeout: 15_000 })
    await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
    await closed
    await expect.poll(() => child.exitCode, { timeout: 5_000 }).toBe(0)
    normalExit = true
    expect(pageErrors).toEqual([])
    const receipt = { kind: 'released-public-rule-ui-acceptance', version, platform: process.platform, arch: process.arch,
      date, publicFacts: synchronized.rows, checks, normalExit, calendarFixtureInjected: false, marketRowsMocked: false,
      actualTushareAuthenticationVerified: false, productionUserDataTouched: false, brokerOrdersSubmitted: false }
    writeFileSync(join(root, 'released-public-rule-ui-receipt.json'), JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify(receipt))
  } finally { if (!normalExit) await application.close().catch(() => {}) }
})
