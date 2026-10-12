import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isolatedPackagedExecutable } from './isolatedPackagedExecutable'
import { observePackagedProcess, waitForPackagedRuntime } from './packagedRuntimeObservation'
import { installFixtureWithAcknowledgement } from './packagedFixtureAcknowledgement'

async function openPanel(page: Page) {
  if (await page.getByTestId('rolling-validation-panel').isVisible()) return
  if (!await page.getByRole('button', { name: '策略评估', exact: true }).isVisible())
    await page.getByRole('button', { name: /短线策略/ }).click()
  await page.getByRole('button', { name: '策略评估', exact: true }).click()
  await page.getByRole('tab', { name: '样本外验证', exact: true }).click()
  await expect(page.getByTestId('rolling-validation-panel')).toBeVisible()
}
async function quit(app: ElectronApplication) {
  const child = app.process(), closed = app.waitForEvent('close', { timeout: 15000 })
  await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 25) })
  await closed; await expect.poll(() => child.exitCode).toBe(0)
}
async function confirmMarker(app: ElectronApplication, key: string, nonce: string) {
  await expect.poll(async () => {
    try { return await app.evaluate((_electron, key) => (globalThis as unknown as Record<string, unknown>)[key], key) }
    catch (error) {
      if (app.process().exitCode !== null || !String(error).includes('Execution context was destroyed, most likely because of a navigation.')) throw error
      return null // Only repeat the read, never the side-effecting fixture operation.
    }
  }, { timeout: 5000 }).toBe(nonce)
}
test('actual product freezes common research facts, survives cache deletion/restart and rejects lost snapshot', async () => {
  test.setTimeout(120000)
  const executable = process.env.RT_PACKAGED_EXE, root = process.env.RT_PACKAGED_TEST_ROOT
  if (process.env.RT_RESEARCH_SNAPSHOT_FIXTURE_ALLOWED !== '1' || !executable || !root || !isAbsolute(executable) || !isAbsolute(root)) throw Error('ISOLATED_RESEARCH_SNAPSHOT_REQUIRED')
  if (process.platform === 'win32' && !resolve(executable).replace(/\\/g, '/').includes('/release/win-unpacked/')) throw Error('PRODUCTION_RESEARCH_FIXTURES_FORBIDDEN')
  if (process.platform === 'darwin' && (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted')) throw Error('MAC_RESEARCH_FIXTURE_REQUIRES_HOSTED_CI')
  mkdirSync(root, { recursive: true })
  const profile = mkdtempSync(join(root, 'frozen-research-')), target = isolatedPackagedExecutable(executable, profile)
  const { ELECTRON_RUN_AS_NODE: _node, ELECTRON_RENDERER_URL: _url, NODE_OPTIONS: _opts, NODE_PATH: _path, ...env } = process.env
  let app = await electron.launch({ executablePath: target, args: [`--user-data-dir=${profile}`], env }), closed = false
  let reportProcess = observePackagedProcess(app)
  const errors: string[] = []
  try {
    let page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message))
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30000 })
    const runtime = await waitForPackagedRuntime(app, process.env.RT_PACKAGED_VERSION!)
    const actual = resolve(runtime.dataPath), expected = process.platform === 'win32' ? resolve(dirname(target), 'data') : resolve(profile)
    expect(process.platform === 'win32' ? actual.toLowerCase() : actual).toBe(process.platform === 'win32' ? expected.toLowerCase() : expected)
    const nonce = randomUUID()
    await installFixtureWithAcknowledgement(() => app.evaluate(({ app }, nonce) => {
      const load = process.mainModule!.require.bind(process.mainModule!), path = load('node:path')
      const Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
      const db = new Database(path.join(app.getPath('userData'), 'trade-watch.db'))
      globalThis.fetch = async () => new Response('isolated research fixture', { status: 503 })
      try {
        if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='security_adjustment_factor_cache'").get()) throw Error('ACTUAL_ADJUSTMENT_SCHEMA_REQUIRED')
        const insert = (table: string, values: Record<string, string | number>) => {
          const columns = new Set(db.pragma(`table_info(${table})`).map((r: { name: string }) => r.name))
          const pairs = Object.entries(values).filter(([name]) => columns.has(name))
          db.prepare(`INSERT OR REPLACE INTO ${table}(${pairs.map(([name]) => name).join(',')}) VALUES(${pairs.map(() => '?').join(',')})`).run(...pairs.map(([, value]) => value))
        }
        db.transaction(() => {
          for (let i = 1; i <= 12; i++) {
            const date = `202606${String(i).padStart(2, '0')}`, price = 10 + i, now = Date.now()
            insert('trade_cal', { cal_date: date, is_open: 1, fetched_at: now, updated_at: now })
            insert('short_term_signals', { strategy: 'synthetic-snapshot-fixture', ts_code: '600001.SH', trade_date: date, signal_strength: 1, signal_meta: '{"direction":"bullish"}', created_at: now })
            insert('daily_close_cache', { ts_code: '600001.SH', trade_date: date, open: price, high: price + 1, low: price - 1, close: price, vol: 1000, data_source: 'synthetic-snapshot-fixture', fetched_at: now, updated_at: now })
            insert('security_adjustment_factor_cache', { ts_code: '600001.SH', trade_date: date, adj_factor: 1, source: 'synthetic-snapshot-fixture', fetched_at: now, updated_at: now })
          }
        })()
      } finally { db.close() }
      ;(globalThis as unknown as { __rtResearchFixture: string }).__rtResearchFixture = nonce
    }, nonce), async () => {
      await confirmMarker(app, '__rtResearchFixture', nonce)
    })
    await openPanel(page)
    await page.getByRole('combobox', { name: '滚动验证数据集', exact: true }).selectOption('short-term:synthetic-snapshot-fixture')
    const fields = { '滚动验证起始日': '2026-06-01', '滚动验证结束日': '2026-06-12', '每窗研究预算': '10000', '训练开市日数': '4', '测试开市日数': '2', '隔离开市日数': '2', '测试窗口数量': '2', '候选持有期（逗号分隔）': '1,2', '训练最少入场数': '1', '滚动最多持仓': '1', '滚动单股预算（%）': '100', '滚动现金预留（%）': '0', '滚动单边费率（bps）': '0' }
    for (const [name, value] of Object.entries(fields)) await page.getByLabel(name, { exact: true }).fill(value)
    await page.getByRole('checkbox', { name: '确认固定训练选择规则和独立测试窗口，不将研究结果作为实盘成交证明' }).check()
    await page.getByRole('button', { name: '保存新验证协议', exact: true }).click()
    await expect(page.getByTestId('rolling-frozen-facts')).toContainText('信号 12 条')
    const id = await page.getByRole('combobox', { name: '已保存验证', exact: true }).inputValue()
    const prepared = await page.evaluate(id => window.api.rollingValidation.get(id), id)
    if (!prepared.ok) throw Error(prepared.code)
    expect(prepared.data.schema).toBe(2); const snapshot = prepared.data.marketSnapshot!
    const first = await page.evaluate(id => window.api.rollingValidation.advance(id), id)
    if (!first.ok) throw Error(first.code)
    expect(first.data.reportsCompleted).toBe(1)
    const removed = randomUUID()
    await installFixtureWithAcknowledgement(() => app.evaluate(({ app }, nonce) => {
      const load = process.mainModule!.require.bind(process.mainModule!), path = load('node:path'), Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
      const db = new Database(path.join(app.getPath('userData'), 'trade-watch.db'))
      try { db.transaction(() => {
        db.prepare('DELETE FROM short_term_signals WHERE strategy=?').run('synthetic-snapshot-fixture')
        for (const table of ['daily_close_cache', 'security_adjustment_factor_cache']) db.prepare(`DELETE FROM ${table} WHERE ts_code=? AND trade_date BETWEEN ? AND ?`).run('600001.SH', '20260601', '20260612')
      })() } finally { db.close() }
      ;(globalThis as unknown as { __rtResearchRemoved: string }).__rtResearchRemoved = nonce
    }, removed), async () => { await confirmMarker(app, '__rtResearchRemoved', removed) })
    await page.getByRole('button', { name: '运行或继续验证', exact: true }).click()
    await expect(page.getByTestId('rolling-validation-report')).toContainText('报告 6 / 6')
    const completed = await page.evaluate(id => window.api.rollingValidation.get(id), id)
    if (!completed.ok) throw Error(completed.code)
    expect(completed.data.status).toBe('completed'); expect(completed.data.marketSnapshot).toEqual(snapshot)
    const ids = completed.data.folds.flatMap(f => [...f.candidates.map(c => c.id), f.testId])
    for (const reportId of ids) {
      const report = await page.evaluate(id => window.api.capitalSimulation.get(id), reportId)
      if (!report.ok) throw Error(report.code)
      expect(report.data.marketSnapshot).toEqual(snapshot)
      expect(report.data.decisions.some(d => d.outcome === 'entered')).toBe(true)
    }
    const nextId = randomUUID()
    const next = await page.evaluate(({ request, id }) => window.api.rollingValidation.prepare({ ...request, capital: { ...request.capital, id } }), { request: prepared.data.request, id: nextId })
    if (!next.ok) throw Error(next.code)
    const lost = randomUUID()
    await installFixtureWithAcknowledgement(() => app.evaluate(({ app }, input) => {
      const load = process.mainModule!.require.bind(process.mainModule!), path = load('node:path'), Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
      const db = new Database(path.join(app.getPath('userData'), 'trade-watch.db'))
      try { db.prepare('DELETE FROM rf_research_fact_snapshots WHERE id=?').run(input.id) } finally { db.close() }
      ;(globalThis as unknown as { __rtResearchLost: string }).__rtResearchLost = input.nonce
    }, { id: nextId, nonce: lost }), async () => { await confirmMarker(app, '__rtResearchLost', lost) })
    const blocked = await page.evaluate(id => window.api.rollingValidation.advance(id), nextId)
    expect(blocked).toMatchObject({ ok: false, code: 'SNAPSHOT_UNAVAILABLE' })
    expect(await page.evaluate(id => window.api.rollingValidation.get(id), nextId)).toEqual(next)
    await quit(app); closed = true
    app = await electron.launch({ executablePath: target, args: [`--user-data-dir=${profile}`], env }); closed = false; reportProcess = observePackagedProcess(app)
    page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message))
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30000 })
    await waitForPackagedRuntime(app, process.env.RT_PACKAGED_VERSION!)
    expect(await page.evaluate(id => window.api.rollingValidation.get(id), id)).toEqual(completed)
    expect(await page.evaluate(id => window.api.rollingValidation.advance(id), nextId)).toMatchObject({ ok: false, code: 'SNAPSHOT_UNAVAILABLE' })
    await openPanel(page)
    await page.getByRole('combobox', { name: '已保存验证', exact: true }).selectOption(id)
    await expect(page.getByTestId('rolling-frozen-facts')).toContainText(snapshot.digest)
    expect(errors).toEqual([])
    await quit(app); closed = true
    writeFileSync(join(profile, 'frozen-research-proof.json'), JSON.stringify({ version: process.env.RT_PACKAGED_VERSION, commonSnapshotAcrossReports: true, cacheDeletionIgnored: true, lostSnapshotRejected: true, reportCount: 6, actualProtocolSaveAndRunUi: true, restartPreserved: true, normalExit: true, syntheticFactsOnly: true, brokerOrdersSubmitted: false }, null, 2))
  } finally { if (!closed) { reportProcess(); await app.close() } }
})
