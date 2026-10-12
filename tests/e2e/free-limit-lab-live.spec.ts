import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { observePackagedProcess, waitForPackagedRuntime } from './packagedRuntimeObservation'

test('opt-in public data reaches actual packaged free-strategy IPC and persisted evidence', async () => {
  test.skip(process.env.RT_PUBLIC_LIMIT_POOL_LIVE !== '1', 'Explicit public-network acceptance opt-in required')
  test.setTimeout(90_000)
  const executable = process.env.RT_PACKAGED_EXE ?? ''
  const version = process.env.RT_PACKAGED_VERSION ?? ''
  const rootInput = process.env.RT_PACKAGED_TEST_ROOT ?? ''
  if (process.platform !== 'win32' || !isAbsolute(executable) ||
      !resolve(executable).replaceAll('\\', '/').includes('/release/win-unpacked/') ||
      !isAbsolute(rootInput) || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Live fixture is restricted to the isolated Windows distribution directory')
  }
  const date = process.env.RT_PUBLIC_LIMIT_POOL_DATE ?? ''
  if (!/^\d{8}$/.test(date)) throw new Error('Explicit fixture date required')
  const root = resolve(rootInput)
  mkdirSync(root, { recursive: true })
  const profile = mkdtempSync(join(root, 'free-limit-live-'))
  const env = { ...process.env, TEMP: root, TMP: root }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.NODE_OPTIONS
  delete env.NODE_PATH
  const application = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env })
  const reportProcess = observePackagedProcess(application)
  const errors: string[] = []
  let closed = false
  try {
    const page = await application.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    const runtime = await waitForPackagedRuntime(application, version)
    expect(resolve(runtime.dataPath).toLowerCase()).toBe(resolve(dirname(executable), 'data').toLowerCase())
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
    const processHandle = application.process()
    const exited = application.waitForEvent('close', { timeout: 15_000 })
    await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
    await exited
    closed = true
    await expect.poll(() => processHandle.exitCode).toBe(0)
    expect(errors).toEqual([])
    const receipt = { kind: 'packaged-free-limit-lab-live', version, date, reports,
      source: cached.source, sourceDate: cached.tradeDate, inputRows: cached.rows.length,
      calendarGate: 'synthetic-fixture', publicNetworkUsed: true, actualPackagedIpc: true,
      normalExit: true, productionUserDataTouched: false, brokerOrdersSubmitted: false }
    writeFileSync(join(root, 'public-limit-live-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
    console.log(JSON.stringify(receipt))
  } finally { if (!closed) { reportProcess(); await application.close().catch(() => {}) } }
})
