import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

test('opt-in public data reaches actual packaged free-strategy IPC and persisted evidence', async () => {
  test.skip(process.env.RT_PUBLIC_LIMIT_POOL_LIVE !== '1', 'Explicit public-network acceptance opt-in required')
  test.setTimeout(90_000)
  const executable = resolve(process.env.RT_PACKAGED_EXE ?? '')
  if (process.platform !== 'win32' || !executable.replaceAll('\\', '/').includes('/release/win-unpacked/')) {
    throw new Error('Live fixture is restricted to the isolated Windows distribution directory')
  }
  const date = process.env.RT_PUBLIC_LIMIT_POOL_DATE ?? ''
  if (!/^\d{8}$/.test(date)) throw new Error('Explicit fixture date required')
  const root = resolve(process.env.RT_PACKAGED_TEST_ROOT ?? '.cache/free-limit-live')
  mkdirSync(root, { recursive: true })
  const env = { ...process.env, TEMP: root, TMP: root }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.NODE_OPTIONS
  delete env.NODE_PATH
  const application = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${join(root, 'profile')}`], env })
  try {
    const page = await application.firstWindow()
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(true)
    expect(await application.evaluate(({ app }) => app.getVersion())).toBe('1.12.0')
    // Explicit synthetic calendar gate, only in win-unpacked/data. This does not
    // claim live exchange-calendar verification, nor write to the installed app.
    await application.evaluate(({ app }, fixtureDate) => {
      const getBuiltinModule = (process as unknown as { getBuiltinModule(name: string): any }).getBuiltinModule
      const nodePath = getBuiltinModule('node:path') as typeof import('node:path')
      const nodeModule = getBuiltinModule('node:module') as typeof import('node:module')
      const requireMain = nodeModule.createRequire(nodePath.join(app.getAppPath(), 'package.json'))
      const Database = requireMain('better-sqlite3')
      const db = new Database(nodePath.join(app.getPath('userData'), 'trade-watch.db'))
      try { db.prepare('INSERT OR REPLACE INTO trade_cal(cal_date,is_open) VALUES (?,1)').run(fixtureDate) }
      finally { db.close() }
    }, date)
    const saved = await page.evaluate(fixtureDate => window.api.datasource.syncPublicLimitPool(fixtureDate), date)
    expect(saved.ok, JSON.stringify(saved)).toBe(true)
    const cached = await page.evaluate(() => window.api.datasource.listVerifiedPublicLimitPool())
    expect(cached).toMatchObject({ source: 'eastmoney_public', tradeDate: date, dateBasis: 'source-reported' })
    expect(cached.rows.length).toBeGreaterThan(0)
    const templates = await page.evaluate(() => window.api.strategyLab.listStrategies())
    expect(templates.ok).toBe(true)
    if (!templates.ok) throw new Error(templates.error)
    const publicTemplates = templates.strategies.filter(item => item.strategyKey.startsWith('builtin-public-limit-'))
    expect(publicTemplates).toHaveLength(3)
    const reports: Array<{ strategy: string; matched: number }> = []
    for (const template of publicTemplates) {
      const result = await page.evaluate(id => window.api.strategyLab.runStrategy(id), template.id)
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (!result.ok) throw new Error(result.error)
      const run = await page.evaluate(id => window.api.strategyLab.getRun(id), result.runId)
      expect(run.ok).toBe(true)
      if (!run.ok || !run.run) throw new Error('Actual run missing')
      expect(run.run.status).toBe('completed')
      const summary = JSON.parse(run.run.summaryJson!)
      expect(summary).toMatchObject({ engine: 'publicLimitUp', dateStart: date, dateEnd: date })
      expect(summary.totalStocks).toBeGreaterThan(0)
      const matches = await page.evaluate(id => window.api.strategyLab.listMatches({ runId: id, limit: 500 }), result.runId)
      expect(matches.ok).toBe(true)
      if (!matches.ok) throw new Error(matches.error)
      expect(matches.matches.length).toBe(result.matchedCount)
      for (const match of matches.matches) expect(JSON.parse(match.evidenceJson)).toMatchObject({ source: 'eastmoney_public', sourceDate: date, scoreMeaning: 'rule-pass-only' })
      const backtest = await page.evaluate(id => window.api.strategyLab.createBacktestFromRun(id), result.runId)
      expect(backtest).toMatchObject({ ok: false, code: 'PUBLIC_LIMIT_BACKTEST_UNAVAILABLE' })
      reports.push({ strategy: template.strategyKey, matched: result.matchedCount })
    }
    console.log(JSON.stringify({ kind: 'packaged-free-limit-lab-live', date, reports, calendarGate: 'synthetic-fixture',
      publicNetworkUsed: true, actualPackagedIpc: true, productionUserDataTouched: false, brokerOrdersSubmitted: false }))
    const processHandle = application.process()
    const closed = application.waitForEvent('close', { timeout: 15_000 })
    await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
    await closed
    await expect.poll(() => processHandle.exitCode).toBe(0)
  } finally { await application.close().catch(() => {}) }
})
