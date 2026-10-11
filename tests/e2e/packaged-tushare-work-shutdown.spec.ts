import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isolatedPackagedExecutable } from './isolatedPackagedExecutable'
test('packaged quit cancels synthetic Tushare history without committing the interrupted date', async () => {
  test.setTimeout(90000)
  const executable = process.env.RT_PACKAGED_EXE, root = process.env.RT_PACKAGED_TEST_ROOT
  if (process.env.RT_TUSHARE_WORK_FIXTURE_ALLOWED !== '1' || !executable || !root || !isAbsolute(executable) || !isAbsolute(root)) throw Error('ISOLATED_TUSHARE_WORK_REQUIRED')
  if (process.platform === 'win32' && !resolve(executable).replace(/\\/g, '/').includes('/release/win-unpacked/')) throw Error('PRODUCTION_TUSHARE_WORK_FIXTURES_FORBIDDEN')
  if (process.platform === 'darwin' && process.env.GITHUB_ACTIONS !== 'true') throw Error('MAC_TUSHARE_WORK_REQUIRES_ISOLATED_CI')
  mkdirSync(root, { recursive: true }); const profile = mkdtempSync(join(root, 'tushare-work-shutdown-')), proofFile = join(profile, 'isolated-tushare-shutdown-proof.json')
  const { ELECTRON_RUN_AS_NODE: _node, ELECTRON_RENDERER_URL: _url, NODE_PATH: _path, NODE_OPTIONS: _options, ...env } = process.env
  const isolatedExecutable = isolatedPackagedExecutable(executable, profile)
  const app = await electron.launch({ executablePath: isolatedExecutable, args: [`--user-data-dir=${profile}`], env }); let closed = false
  try {
    const page = await app.firstWindow(); await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30000 })
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true); expect(await app.evaluate(({ app }) => app.getVersion())).toBe(process.env.RT_PACKAGED_VERSION)
    const actual = resolve(await app.evaluate(({ app }) => app.getPath('userData'))), expected = process.platform === 'win32' ? resolve(dirname(isolatedExecutable), 'data') : resolve(profile)
    expect(process.platform === 'win32' ? actual.toLowerCase() : actual).toBe(process.platform === 'win32' ? expected.toLowerCase() : expected)
    await app.evaluate(({ app, BrowserWindow, safeStorage }, destination) => {
      const load = process.mainModule!.require.bind(process.mainModule!), path = load('node:path'), fs = load('node:fs'), Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
      if (!safeStorage.isEncryptionAvailable()) throw Error('ISOLATED_STORAGE_REQUIRED')
      const dbPath = path.join(app.getPath('userData'), 'trade-watch.db'), db = new Database(dbPath)
      db.exec('INSERT OR IGNORE INTO data_source_config(id) VALUES(1)')
      const previous = db.prepare('SELECT tushareEnabled,tushareTokenEncrypted FROM data_source_config WHERE id=1').get()
      const bj = new Date(Date.now() + 8 * 3600000), end = new Date(bj.getTime() - (bj.getUTCHours() < 18 ? 86400000 : 0)).toISOString().slice(0, 10).replace(/-/g, '')
      const days = db.prepare('SELECT cal_date FROM trade_cal WHERE is_open=1 AND cal_date<=? ORDER BY cal_date DESC LIMIT 480').all(end)
      if (days.length !== 480) { db.close(); throw Error('ISOLATED_CALENDAR_REQUIRED') }
      const firstDate = days.at(-1).cal_date
      db.prepare('DELETE FROM daily_close_cache WHERE trade_date=?').run(firstDate)
      const state = { dailyRequests: 0, abortedRequests: 0, requestedAt: 0, abortedAt: 0, stoppedProgress: null as null | { processedTradeDays: number; failedTradeDays: number; syncedTradeDays: number } }
      ;(globalThis as unknown as { __rtTushareQuitFixture: typeof state }).__rtTushareQuitFixture = state
      globalThis.fetch = async (input, init) => {
        let body: { api_name?: string; params?: { trade_date?: string } } = {}; try { body = JSON.parse(String(init?.body ?? '{}')) } catch { /* isolated non-Tushare request */ }
        if (String(input).includes('api.tushare.pro') && body.api_name === 'daily' && body.params?.trade_date === firstDate) {
          state.dailyRequests++; state.requestedAt = Date.now()
          return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal, aborted = () => { state.abortedRequests++; state.abortedAt = Date.now(); reject(signal?.reason ?? new Error('isolated abort')) }
            if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true })
          })
        }
        return String(input).includes('api.tushare.pro') ? new Response(JSON.stringify({ code: -1, msg: '权限不足：隔离测试响应' }), { status: 200 }) : new Response('isolated unavailable', { status: 503 })
      }
      const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())!
      const send = win.webContents.send.bind(win.webContents)
      win.webContents.send = (channel, ...values) => {
        if (channel === 'diagnostics:historicalDailyProgress' && String(values[0]?.message ?? '').includes('同步已停止')) {
          const p = values[0]; state.stoppedProgress = { processedTradeDays: p.processedTradeDays, failedTradeDays: p.failedTradeDays, syncedTradeDays: p.syncedTradeDays }
        }
        send(channel, ...values)
      }
      const restore = () => { const fix = new Database(dbPath); try { fix.prepare('UPDATE data_source_config SET tushareEnabled=?,tushareTokenEncrypted=? WHERE id=1').run(previous.tushareEnabled, previous.tushareTokenEncrypted) } finally { fix.close() } }
      app.once('will-quit', () => {
        restore(); const inspect = new Database(dbPath)
        try { const rows = inspect.prepare('SELECT COUNT(*) AS n FROM daily_close_cache WHERE trade_date=?').get(firstDate); fs.writeFileSync(destination, JSON.stringify({ ...state, rows, willQuitSeen: true, syntheticCredentialOnly: true })) }
        catch { fs.writeFileSync(destination, JSON.stringify({ proofReadFailed: true })) } finally { inspect.close() }
      })
      try { db.prepare('UPDATE data_source_config SET tushareEnabled=1,tushareTokenEncrypted=? WHERE id=1').run(safeStorage.encryptString('isolated-tushare-not-a-real-key')) } finally { db.close() }
    }, proofFile)
    const request = page.evaluate(() => window.api.diagnostics.runCheck('syncHistoricalDaily')).catch(() => null)
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __rtTushareQuitFixture: { dailyRequests: number } }).__rtTushareQuitFixture.dailyRequests), { timeout: 30000 }).toBe(1)
    const child = app.process(), exited = app.waitForEvent('close'), at = Date.now()
    await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 25) }); await exited; closed = true; await request
    await expect.poll(() => child.exitCode).toBe(0); expect(Date.now() - at).toBeLessThan(10000)
    const proof = JSON.parse(readFileSync(proofFile, 'utf8'))
    expect(proof).toMatchObject({ dailyRequests: 1, abortedRequests: 1, rows: { n: 0 }, willQuitSeen: true, syntheticCredentialOnly: true,
      stoppedProgress: { processedTradeDays: 0, failedTradeDays: 0, syncedTradeDays: 0 } })
    expect(proof.abortedAt - proof.requestedAt).toBeLessThan(10000)
  } finally { if (!closed) await app.close() }
})
