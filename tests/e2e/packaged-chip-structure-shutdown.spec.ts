import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isolatedPackagedExecutable } from './isolatedPackagedExecutable'
import { observePackagedProcess, waitForPackagedRuntime } from './packagedRuntimeObservation'

for (const stage of ['daily', 'cyq_perf', 'cyq_chips', 'top_inst'] as const) {
  test(`packaged quit aborts owned structure ${stage} work without changing committed facts`, async () => {
    test.setTimeout(90000)
    const executable = process.env.RT_PACKAGED_EXE, root = process.env.RT_PACKAGED_TEST_ROOT
    if (process.env.RT_STRUCTURE_WORK_FIXTURE_ALLOWED !== '1' || !executable || !root || !isAbsolute(executable) || !isAbsolute(root)) throw Error('ISOLATED_STRUCTURE_WORK_REQUIRED')
    if (process.platform === 'win32' && !resolve(executable).replace(/\\/g, '/').includes('/release/win-unpacked/')) throw Error('PRODUCTION_STRUCTURE_FIXTURES_FORBIDDEN')
    if (process.platform === 'darwin' && process.env.GITHUB_ACTIONS !== 'true') throw Error('MAC_STRUCTURE_FIXTURE_REQUIRES_ISOLATED_CI')
    mkdirSync(root, { recursive: true })
    const profile = mkdtempSync(join(root, `structure-shutdown-${stage}-`)), proofFile = join(profile, 'structure-quit-proof.json')
    const { ELECTRON_RUN_AS_NODE: _node, ELECTRON_RENDERER_URL: _url, NODE_OPTIONS: _opts, NODE_PATH: _path, ...env } = process.env
    const isolatedExecutable = isolatedPackagedExecutable(executable, profile)
    const app = await electron.launch({ executablePath: isolatedExecutable, args: [`--user-data-dir=${profile}`], env })
    const reportProcess = observePackagedProcess(app), errors: string[] = []
    let closed = false
    try {
      const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
      await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30000 })
      const runtime = await waitForPackagedRuntime(app, process.env.RT_PACKAGED_VERSION!)
      const actualRoot = resolve(runtime.dataPath), expectedRoot = process.platform === 'win32' ? resolve(dirname(isolatedExecutable), 'data') : resolve(profile)
      expect(process.platform === 'win32' ? actualRoot.toLowerCase() : actualRoot).toBe(process.platform === 'win32' ? expectedRoot.toLowerCase() : expectedRoot)
      await app.evaluate(({ app, BrowserWindow, safeStorage }, fixture) => {
        const load = process.mainModule!.require.bind(process.mainModule!), path = load('node:path'), fs = load('node:fs'), crypto = load('node:crypto')
        const Database = load(path.join(app.getAppPath(), 'node_modules/better-sqlite3'))
        if (!safeStorage.isEncryptionAvailable()) throw Error('ISOLATED_STORAGE_REQUIRED')
        const dbPath = path.join(app.getPath('userData'), 'trade-watch.db'), db = new Database(dbPath)
        db.exec('INSERT OR IGNORE INTO data_source_config(id) VALUES(1)')
        const previous = db.prepare('SELECT tushareEnabled,tushareTokenEncrypted FROM data_source_config WHERE id=1').get()
        const facts = () => {
          const inspect = new Database(dbPath)
          try {
            const tables = inspect.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row: { name: string }) => row.name).filter((name: string) => /^(daily_close_cache|cyq.*|top_inst.*|chip_monitor_results)$/.test(name))
            if (tables.length < 5) throw Error('ISOLATED_STRUCTURE_SCHEMA_REQUIRED')
            return Object.fromEntries(tables.map((name: string) => {
              const rows = inspect.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).all().map((row: unknown) => JSON.stringify(row)).sort()
              return [name, { count: rows.length, sha256: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') }]
            }))
          } finally { inspect.close() }
        }
        const state = { calls: {} as Record<string, number>, abortedRequests: 0, requestedAt: 0, abortedAt: 0, doneEvents: 0, before: null as null | ReturnType<typeof facts> }
        ;(globalThis as unknown as { __rtStructureQuit: typeof state }).__rtStructureQuit = state
        globalThis.fetch = async (input, init) => {
          if (!String(input).includes('api.tushare.pro')) return new Response('isolated unavailable', { status: 503 })
          const body = JSON.parse(String(init?.body ?? '{}')), api = String(body.api_name ?? '')
          const params = body.params ?? {}
          const fixtureStock = ['600000.SH', '000001.SZ'].includes(params.ts_code)
          const isStructureRequest = api === 'daily' ? fixtureStock && params.start_date === '20260526'
            : api === 'cyq_perf' || api === 'cyq_chips' ? fixtureStock && params.trade_date === '20260710'
              : api === 'top_inst' && params.trade_date === '20260710'
          // Keep startup catch-up separate from the explicitly admitted historical fixture.
          if (!isStructureRequest) return new Response(JSON.stringify({ code: 0, data: {
            fields: String(body.fields ?? '').split(',').filter(Boolean), items: [],
          } }), { status: 200 })
          state.calls[api] = (state.calls[api] ?? 0) + 1
          if (api === fixture.stage) {
            state.requestedAt = Date.now(); state.before = facts()
            return new Promise<Response>((_resolve, reject) => {
              const signal = init?.signal
              const aborted = () => { state.abortedRequests++; state.abortedAt = Date.now(); reject(signal?.reason ?? new Error('isolated abort')) }
              if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true })
            })
          }
          const code = String(params.ts_code ?? '600000.SH'), date = '20260710'
          const data = api === 'daily' ? { fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pct_chg', 'vol'], items: [[code, date, 10, 11, 9, 10, 0, 100]] }
            : api === 'cyq_perf' ? { fields: ['ts_code', 'trade_date', 'his_low', 'his_high', 'cost_5pct', 'cost_15pct', 'cost_50pct', 'cost_85pct', 'cost_95pct', 'weight_avg', 'winner_rate'], items: [[code, date, 8, 12, 8.5, 9, 10, 11, 11.5, 10, 55]] }
              : api === 'cyq_chips' ? { fields: ['ts_code', 'trade_date', 'price', 'percent'], items: [[code, date, 10, 100]] } : null
          return new Response(JSON.stringify(data ? { code: 0, data } : { code: -1, msg: 'isolated unavailable' }), { status: 200 })
        }
        const window = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())!
        const send = window.webContents.send.bind(window.webContents)
        window.webContents.send = (channel, ...values) => { if (channel === 'chipStructure:done') state.doneEvents++; send(channel, ...values) }
        app.once('will-quit', () => {
          const restore = new Database(dbPath)
          try { restore.prepare('UPDATE data_source_config SET tushareEnabled=?,tushareTokenEncrypted=? WHERE id=1').run(previous.tushareEnabled, previous.tushareTokenEncrypted) } finally { restore.close() }
          fs.writeFileSync(fixture.proofFile, JSON.stringify({ stage: fixture.stage, ...state, after: facts(), version: app.getVersion(), willQuitSeen: true, syntheticCredentialOnly: true }))
        })
        try { db.prepare('UPDATE data_source_config SET tushareEnabled=1,tushareTokenEncrypted=? WHERE id=1').run(safeStorage.encryptString('isolated-structure-not-a-real-key')) } finally { db.close() }
      }, { stage, proofFile })
      const started = await page.evaluate(stage => window.api.chipStructure.refresh({
        tsCodes: ['600000.SH', '000001.SZ'], tradeDate: '20260710', scope: stage === 'top_inst' ? 'institution' : 'all', force: true,
      }), stage)
      expect(started.ok).toBe(true)
      await expect.poll(() => app.evaluate((_electron, stage) => (globalThis as unknown as { __rtStructureQuit: { calls: Record<string, number> } }).__rtStructureQuit.calls[stage] ?? 0, stage), { timeout: 30000 }).toBe(1)
      console.log(`ISOLATED_STRUCTURE_REQUEST_INTERCEPTED=${stage}`)
      const child = app.process(), exited = app.waitForEvent('close', { timeout: 15000 }), at = Date.now()
      await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 25) })
      await exited; closed = true
      await expect.poll(() => child.exitCode).toBe(0)
      expect(Date.now() - at).toBeLessThan(10000)
      const proof = JSON.parse(readFileSync(proofFile, 'utf8'))
      expect(proof).toMatchObject({ stage, version: process.env.RT_PACKAGED_VERSION, abortedRequests: 1, doneEvents: 0, willQuitSeen: true, syntheticCredentialOnly: true })
      expect(proof.before).not.toBeNull(); expect(proof.after).toEqual(proof.before)
      expect(proof.calls[stage]).toBe(1); expect(proof.abortedAt - proof.requestedAt).toBeLessThan(10000)
      if (stage !== 'top_inst') expect(proof.calls.top_inst ?? 0).toBe(0)
      if (stage === 'daily' || stage === 'cyq_perf') expect(proof.calls.cyq_chips ?? 0).toBe(0)
      expect(errors).toEqual([])
    } finally { if (!closed) { reportProcess(); await app.close() } }
  })
}
