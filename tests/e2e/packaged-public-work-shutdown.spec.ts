import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { observePackagedProcess, waitForPackagedRuntime } from './packagedRuntimeObservation'
test('actual packaged quit cancels a manually started public history request and retains its checkpoint', async () => {
  test.setTimeout(90000)
  const executable = process.env.RT_PACKAGED_EXE, root = process.env.RT_PACKAGED_TEST_ROOT
  if (process.env.RT_PUBLIC_WORK_FIXTURE_ALLOWED !== '1' || !executable || !root || !isAbsolute(executable) || !isAbsolute(root)) throw Error('ISOLATED_PUBLIC_WORK_REQUIRED')
  if (process.platform === 'win32' && !resolve(executable).replace(/\\/g, '/').includes('/release/win-unpacked/')) throw Error('PRODUCTION_PUBLIC_WORK_FIXTURES_FORBIDDEN')
  if (process.platform === 'darwin' && process.env.GITHUB_ACTIONS !== 'true') throw Error('MAC_PUBLIC_WORK_REQUIRES_ISOLATED_CI')
  mkdirSync(root, { recursive: true }); const profile = mkdtempSync(join(root, 'public-work-shutdown-')), proofFile = join(profile, 'isolated-shutdown-proof.json')
  const { ELECTRON_RUN_AS_NODE: _node, ELECTRON_RENDERER_URL: _url, NODE_PATH: _path, NODE_OPTIONS: _options, ...env } = process.env
  const app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env })
  const reportProcess = observePackagedProcess(app), errors: string[] = []
  let closed = false
  try {
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30000 })
    const runtime = await waitForPackagedRuntime(app, process.env.RT_PACKAGED_VERSION!)
    const actual = runtime.dataPath
    const expected = process.platform === 'win32' ? resolve(dirname(executable), 'data') : resolve(profile)
    expect(process.platform === 'win32' ? resolve(actual).toLowerCase() : resolve(actual)).toBe(process.platform === 'win32' ? expected.toLowerCase() : expected)
    await app.evaluate(({ app }, destination) => {
      const load = process.mainModule!.require.bind(process.mainModule!), path = load('node:path'), fs = load('node:fs'), Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
      const dbPath = path.join(app.getPath('userData'), 'trade-watch.db'), db = new Database(dbPath)
      try {
        db.exec("DELETE FROM stock_basic_cache; DELETE FROM public_daily_sync_checkpoints; DELETE FROM public_market_sync_jobs WHERE job_key='historical_daily_public'; DELETE FROM daily_close_cache WHERE ts_code='600000.SH'")
        db.prepare('INSERT INTO stock_basic_cache(ts_code,name,market,list_status,updated_at) VALUES(?,?,?,?,?)').run('600000.SH', 'isolated shutdown fixture', '主板', 'L', Date.now())
        db.exec('UPDATE public_market_request_global_state SET next_allowed_at=0,batch_blocked_until=0 WHERE id=1')
      } finally { db.close() }
      const state = { historicalRequests: 0, abortedRequests: 0, requestedAt: 0, abortedAt: 0 }
      ;(globalThis as unknown as { __rtPublicQuitFixture: typeof state }).__rtPublicQuitFixture = state
      globalThis.fetch = async (input, init) => {
        if (!String(input).includes('CN_MarketData.getKLineData')) return new Response('isolated unavailable', { status: 503 })
        state.historicalRequests++; state.requestedAt = Date.now()
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal, aborted = () => { state.abortedRequests++; state.abortedAt = Date.now(); reject(signal?.reason ?? new Error('isolated abort')) }
          if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true })
        })
      }
      app.once('will-quit', () => {
        const inspect = new Database(dbPath)
        try {
          const job = inspect.prepare("SELECT status,processed_items,written_rows FROM public_market_sync_jobs WHERE job_key='historical_daily_public'").get()
          const checkpoint = inspect.prepare("SELECT status,last_error FROM public_daily_sync_checkpoints WHERE ts_code='600000.SH'").get()
          const rows = inspect.prepare("SELECT COUNT(*) AS n FROM daily_close_cache WHERE ts_code='600000.SH'").get()
          fs.writeFileSync(destination, JSON.stringify({ ...state, job, checkpoint, rows, willQuitSeen: true }))
        } catch { fs.writeFileSync(destination, JSON.stringify({ proofReadFailed: true })) } finally { inspect.close() }
      })
    }, proofFile)
    const started = await page.evaluate(() => window.api.diagnostics.runCheck('syncHistoricalDaily'))
    expect(started.ok).toBe(true)
    await expect.poll(async () => {
      try {
        return await app.evaluate(() => (globalThis as unknown as { __rtPublicQuitFixture: { historicalRequests: number } }).__rtPublicQuitFixture.historicalRequests)
      } catch (error) {
        if (app.process().exitCode !== null || !/Execution context was destroyed|Cannot find context/i.test(String(error))) throw error
        // Retry only the read-only observation, never fixture installation or the request.
        return 'observation-pending'
      }
    }, { timeout: 30000 }).toBe(1)
    const child = app.process(), exited = app.waitForEvent('close'), at = Date.now()
    await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 25) }); await exited; closed = true
    await expect.poll(() => child.exitCode).toBe(0); expect(Date.now() - at).toBeLessThan(10000)
    const proof = JSON.parse(readFileSync(proofFile, 'utf8'))
    expect(proof).toMatchObject({ historicalRequests: 1, abortedRequests: 1, willQuitSeen: true,
      job: { status: 'partial', processed_items: 0, written_rows: 0 }, checkpoint: { status: 'pending', last_error: null }, rows: { n: 0 } })
    expect(proof.abortedAt - proof.requestedAt).toBeLessThan(10000)
    expect(errors).toEqual([])
  } finally { if (!closed) { reportProcess(); await app.close() } }
})
