import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isolatedPackagedExecutable } from './isolatedPackagedExecutable'
import { observePackagedProcess, waitForPackagedRuntime } from './packagedRuntimeObservation'

for (const stage of ['daily', 'chips'] as const) {
  test(`packaged quit cancels chip monitor ${stage} without changing committed facts`, async () => {
    test.setTimeout(90000)
    const executable = process.env.RT_PACKAGED_EXE, root = process.env.RT_PACKAGED_TEST_ROOT
    if (process.env.RT_TUSHARE_WORK_FIXTURE_ALLOWED !== '1' || !executable || !root || !isAbsolute(executable) || !isAbsolute(root)) throw Error('ISOLATED_CHIP_WORK_REQUIRED')
    if (process.platform === 'win32' && !resolve(executable).replace(/\\/g, '/').includes('/release/win-unpacked/')) throw Error('PRODUCTION_CHIP_FIXTURES_FORBIDDEN')
    if (process.platform === 'darwin' && process.env.GITHUB_ACTIONS !== 'true') throw Error('MAC_CHIP_WORK_REQUIRES_ISOLATED_CI')
    mkdirSync(root, { recursive: true })
    const profile = mkdtempSync(join(root, `chip-${stage}-shutdown-`)), proofFile = join(profile, `isolated-chip-${stage}-shutdown-proof.json`)
    const { ELECTRON_RUN_AS_NODE: _node, ELECTRON_RENDERER_URL: _url, NODE_PATH: _path, NODE_OPTIONS: _options, ...env } = process.env
    const isolatedExecutable = isolatedPackagedExecutable(executable, profile)
    const app = await electron.launch({ executablePath: isolatedExecutable, args: [`--user-data-dir=${profile}`], env })
    let closed = false
    const reportProcess = observePackagedProcess(app), errors: string[] = []
    try {
      const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
      await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30000 })
      const runtime = await waitForPackagedRuntime(app, process.env.RT_PACKAGED_VERSION!)
      const actual = resolve(runtime.dataPath), expected = process.platform === 'win32' ? resolve(dirname(isolatedExecutable), 'data') : resolve(profile)
      expect(process.platform === 'win32' ? actual.toLowerCase() : actual).toBe(process.platform === 'win32' ? expected.toLowerCase() : expected)
      expect((await page.evaluate(() => window.api.diagnostics.runCheck('syncTradeCalendar'))).ok).toBe(true)
      await app.evaluate(({ app, safeStorage, BrowserWindow }, { destination, stage }) => {
        const load = process.mainModule!.require.bind(process.mainModule!), path = load('node:path'), fs = load('node:fs'), crypto = load('node:crypto')
        const Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
        if (!safeStorage.isEncryptionAvailable()) throw Error('ISOLATED_STORAGE_REQUIRED')
        const dbPath = path.join(app.getPath('userData'), 'trade-watch.db'), db = new Database(dbPath)
        db.exec('INSERT OR IGNORE INTO data_source_config(id) VALUES(1)')
        const previous = db.prepare('SELECT tushareEnabled,tushareTokenEncrypted FROM data_source_config WHERE id=1').get()
        const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '')
        const tradeDate = db.prepare('SELECT MAX(cal_date) AS d FROM trade_cal WHERE is_open=1 AND cal_date<=?').get(today).d
        if (!tradeDate) { db.close(); throw Error('ISOLATED_CALENDAR_REQUIRED') }
        db.prepare('INSERT INTO chip_monitor_stocks(ts_code,source,stock_name,added_at) VALUES(?,?,?,?)').run('600000.SH', 'watchlist', 'isolated fixture', Date.now())
        const fingerprint = () => {
          const inspect = new Database(dbPath)
          try {
            const queries = {
              daily: 'SELECT * FROM daily_close_cache ORDER BY ts_code,trade_date',
              chips: 'SELECT * FROM cyq_chips_cache ORDER BY ts_code,trade_date,price',
              results: 'SELECT * FROM chip_monitor_results ORDER BY ts_code,trade_date,mode',
              stocks: 'SELECT * FROM chip_monitor_stocks ORDER BY ts_code',
            }
            return Object.fromEntries(Object.entries(queries).map(([name, sql]) => {
              const rows = inspect.prepare(sql).all()
              return [name, { rows: rows.length, hash: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') }]
            }))
          } finally { inspect.close() }
        }
        const state = { pendingRequests: 0, abortedRequests: 0, doneEvents: 0, baseline: null as null | ReturnType<typeof fingerprint> }
        ;(globalThis as unknown as { __rtChipQuitFixture: typeof state }).__rtChipQuitFixture = state
        globalThis.fetch = async (input, init) => {
          let body: { api_name?: string } = {}
          try { body = JSON.parse(String(init?.body ?? '{}')) } catch { /* isolated non-Tushare request */ }
          if (String(input).includes('api.tushare.pro') && body.api_name === (stage === 'daily' ? 'daily' : 'cyq_chips')) {
            state.pendingRequests++; state.baseline = fingerprint()
            return new Promise<Response>((_resolve, reject) => {
              const signal = init?.signal
              const aborted = () => { state.abortedRequests++; reject(signal?.reason ?? new Error('isolated abort')) }
              if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true })
            })
          }
          if (String(input).includes('api.tushare.pro') && body.api_name === 'daily') {
            return new Response(JSON.stringify({ code: 0, data: { fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pct_chg', 'vol'], items: [['600000.SH', tradeDate, 10, 10, 10, 10, 1, 100]] } }), { status: 200 })
          }
          return new Response('isolated unavailable', { status: 503 })
        }
        const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())!, send = win.webContents.send.bind(win.webContents)
        win.webContents.send = (channel, ...values) => { if (channel === 'shortTerm:chipMonitor:done') state.doneEvents++; send(channel, ...values) }
        app.once('will-quit', () => {
          const inspect = new Database(dbPath)
          try {
            inspect.prepare('UPDATE data_source_config SET tushareEnabled=?,tushareTokenEncrypted=? WHERE id=1').run(previous.tushareEnabled, previous.tushareTokenEncrypted)
            fs.writeFileSync(destination, JSON.stringify({ ...state, after: fingerprint(), stage, willQuitSeen: true, syntheticCredentialOnly: true }))
          } catch { fs.writeFileSync(destination, JSON.stringify({ proofReadFailed: true })) }
          finally { inspect.close() }
        })
        try { db.prepare('UPDATE data_source_config SET tushareEnabled=1,tushareTokenEncrypted=? WHERE id=1').run(safeStorage.encryptString('isolated-tushare-not-a-real-key')) }
        finally { db.close() }
      }, { destination: proofFile, stage })
      expect((await page.evaluate(() => window.api.shortTerm.chipMonitorStart({ source: 'watchlist' }))).ok).toBe(true)
      await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __rtChipQuitFixture: { pendingRequests: number } }).__rtChipQuitFixture.pendingRequests), { timeout: 30000 }).toBe(1)
      const child = app.process(), exited = app.waitForEvent('close'), at = Date.now()
      await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 25) }); await exited; closed = true
      await expect.poll(() => child.exitCode).toBe(0); expect(Date.now() - at).toBeLessThan(10000)
      const proof = JSON.parse(readFileSync(proofFile, 'utf8'))
      expect(proof).toMatchObject({ stage, pendingRequests: 1, abortedRequests: 1, doneEvents: 0, willQuitSeen: true, syntheticCredentialOnly: true })
      expect(proof.baseline).not.toBeNull(); expect(proof.after).toEqual(proof.baseline)
      expect(proof.after.daily.rows).toBe(stage === 'daily' ? 0 : 1)
      expect(proof.after.chips.rows).toBe(0); expect(proof.after.results.rows).toBe(0)
      expect(errors).toEqual([])
    } finally { if (!closed) { reportProcess(); await app.close() } }
  })
}
