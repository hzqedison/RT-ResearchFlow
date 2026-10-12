import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isolatedPackagedExecutable } from './isolatedPackagedExecutable'
import { observePackagedProcess, waitForPackagedRuntime } from './packagedRuntimeObservation'

test('packaged quit cancels standalone calendar work and preserves the complete calendar', async () => {
  test.setTimeout(90000)
  const executable = process.env.RT_PACKAGED_EXE, root = process.env.RT_PACKAGED_TEST_ROOT
  if (process.env.RT_TUSHARE_WORK_FIXTURE_ALLOWED !== '1' || !executable || !root || !isAbsolute(executable) || !isAbsolute(root)) throw Error('ISOLATED_CALENDAR_WORK_REQUIRED')
  if (process.platform === 'win32' && !resolve(executable).replace(/\\/g, '/').includes('/release/win-unpacked/')) throw Error('PRODUCTION_CALENDAR_FIXTURES_FORBIDDEN')
  if (process.platform === 'darwin' && process.env.GITHUB_ACTIONS !== 'true') throw Error('MAC_CALENDAR_WORK_REQUIRES_ISOLATED_CI')
  mkdirSync(root, { recursive: true })
  const profile = mkdtempSync(join(root, 'calendar-work-shutdown-'))
  const proofFile = join(profile, 'isolated-calendar-shutdown-proof.json')
  const { ELECTRON_RUN_AS_NODE: _node, ELECTRON_RENDERER_URL: _url, NODE_PATH: _path, NODE_OPTIONS: _options, ...env } = process.env
  const isolatedExecutable = isolatedPackagedExecutable(executable, profile)
  const app = await electron.launch({ executablePath: isolatedExecutable, args: [`--user-data-dir=${profile}`], env })
  let closed = false
  const reportProcess = observePackagedProcess(app), errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30000 })
    const runtime = await waitForPackagedRuntime(app, process.env.RT_PACKAGED_VERSION!)
    const actual = resolve(runtime.dataPath), expected = process.platform === 'win32' ? resolve(dirname(isolatedExecutable), 'data') : resolve(profile)
    expect(process.platform === 'win32' ? actual.toLowerCase() : actual).toBe(process.platform === 'win32' ? expected.toLowerCase() : expected)
    expect((await page.evaluate(() => window.api.diagnostics.runCheck('syncTradeCalendar'))).ok).toBe(true)
    await app.evaluate(({ app, safeStorage }, destination) => {
      const load = process.mainModule!.require.bind(process.mainModule!)
      const path = load('node:path'), fs = load('node:fs'), crypto = load('node:crypto')
      const Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
      if (!safeStorage.isEncryptionAvailable()) throw Error('ISOLATED_STORAGE_REQUIRED')
      const dbPath = path.join(app.getPath('userData'), 'trade-watch.db'), db = new Database(dbPath)
      const fingerprint = (connection: typeof db) => {
        const rows = connection.prepare('SELECT * FROM trade_cal ORDER BY cal_date').all()
        return { rowCount: rows.length, hash: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') }
      }
      db.exec('INSERT OR IGNORE INTO data_source_config(id) VALUES(1)')
      const previous = db.prepare('SELECT tushareEnabled,tushareTokenEncrypted FROM data_source_config WHERE id=1').get()
      const before = fingerprint(db)
      if (before.rowCount < 1000) { db.close(); throw Error('ISOLATED_CALENDAR_REQUIRED') }
      const state = { calendarRequests: 0, abortedRequests: 0, requestedAt: 0, abortedAt: 0 }
      ;(globalThis as unknown as { __rtCalendarQuitFixture: typeof state }).__rtCalendarQuitFixture = state
      globalThis.fetch = async (input, init) => {
        let body: { api_name?: string } = {}
        try { body = JSON.parse(String(init?.body ?? '{}')) } catch { /* isolated non-Tushare request */ }
        if (String(input).includes('api.tushare.pro') && body.api_name === 'trade_cal') {
          state.calendarRequests++; state.requestedAt = Date.now()
          return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal
            const aborted = () => { state.abortedRequests++; state.abortedAt = Date.now(); reject(signal?.reason ?? new Error('isolated abort')) }
            if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true })
          })
        }
        return String(input).includes('api.tushare.pro') ? new Response(JSON.stringify({ code: -1, msg: 'isolated unavailable' }), { status: 200 }) : new Response('isolated unavailable', { status: 503 })
      }
      app.once('will-quit', () => {
        const inspect = new Database(dbPath)
        try {
          inspect.prepare('UPDATE data_source_config SET tushareEnabled=?,tushareTokenEncrypted=? WHERE id=1').run(previous.tushareEnabled, previous.tushareTokenEncrypted)
          fs.writeFileSync(destination, JSON.stringify({ ...state, before, after: fingerprint(inspect), willQuitSeen: true, syntheticCredentialOnly: true }))
        } catch { fs.writeFileSync(destination, JSON.stringify({ proofReadFailed: true })) }
        finally { inspect.close() }
      })
      try { db.prepare('UPDATE data_source_config SET tushareEnabled=1,tushareTokenEncrypted=? WHERE id=1').run(safeStorage.encryptString('isolated-tushare-not-a-real-key')) }
      finally { db.close() }
    }, proofFile)
    const request = page.evaluate(() => window.api.diagnostics.runCheck('syncTradeCalendar')).catch(() => null)
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __rtCalendarQuitFixture: { calendarRequests: number } }).__rtCalendarQuitFixture.calendarRequests), { timeout: 30000 }).toBe(1)
    const child = app.process(), exited = app.waitForEvent('close'), at = Date.now()
    await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 25) })
    await exited; closed = true; await request
    await expect.poll(() => child.exitCode).toBe(0)
    expect(Date.now() - at).toBeLessThan(10000)
    const proof = JSON.parse(readFileSync(proofFile, 'utf8'))
    expect(proof).toMatchObject({ calendarRequests: 1, abortedRequests: 1, willQuitSeen: true, syntheticCredentialOnly: true })
    expect(proof.after).toEqual(proof.before)
    expect(proof.before.rowCount).toBeGreaterThanOrEqual(1000)
    expect(proof.abortedAt - proof.requestedAt).toBeLessThan(10000)
    expect(errors).toEqual([])
  } finally { if (!closed) { reportProcess(); await app.close() } }
})
