import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { DATABASE_MIGRATIONS, runMigrations } from '../../electron/main/database/db'
import { getPublicMarketProviderState } from '../../electron/main/database/publicMarketDataRepository'
import { PersistentPublicMarketRequestGovernor } from '../../electron/main/services/publicMarketRequestGovernor'
import * as history from '../../electron/main/services/publicHistoricalDailySyncService'
import { fetchPublicStockUniverse } from '../../electron/main/services/publicStockUniverseService'
import { publicMarketWorkOwner, stopPublicMarketWork, waitForPublicMarketWorkIdle } from '../../electron/main/services/publicMarketWorkOwner'
function dbFixture() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE daily_close_cache(ts_code TEXT,trade_date TEXT,open REAL,high REAL,low REAL,close REAL NOT NULL,pct_chg REAL,vol REAL,turnover_rate REAL,PRIMARY KEY(ts_code,trade_date));
    CREATE TABLE stock_basic_cache(ts_code TEXT PRIMARY KEY,name TEXT,industry TEXT,market TEXT,list_status TEXT,circ_float REAL,updated_at INTEGER NOT NULL);
    INSERT INTO stock_basic_cache VALUES('600000.SH','fixture A',NULL,'主板','L',NULL,1),('600001.SH','fixture B',NULL,'主板','L',NULL,1);`)
  runMigrations(db, DATABASE_MIGRATIONS.filter(m => m.version === 137))
  return db
}
function governor(db: Database.Database) { return new PersistentPublicMarketRequestGovernor(db, { minIntervalMs: 0, jitterMs: 0, batchSize: 100, batchPauseMs: 0, rateLimitCooldownMs: 1000, failureCooldownMs: 1000, consecutiveFailureLimit: 3 }, { random: () => 0 }) }
const response = () => new Response(JSON.stringify([
  { day: '2026-08-12', open: '10', high: '11', low: '9', close: '10', volume: '10000' },
  { day: '2026-08-13', open: '10', high: '12', low: '10', close: '11', volume: '20000' },
  { day: '2026-08-14', open: '11', high: '12', low: '10', close: '11.5', volume: '30000' },
]), { status: 200 })
describe('historical sync cancellation boundary', () => {
  it('pre-aborted manual history does not contact a provider or write prices', async () => {
    const db = dbFixture(), controller = new AbortController(); controller.abort(); let requests = 0
    try {
      await expect(history.runPublicHistoricalDailySync(db, '20260814', { providers: ['sina'], governor: governor(db), signal: controller.signal, fetchImpl: async () => { requests++; return response() } })).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
      expect(requests).toBe(0); expect((db.prepare('SELECT COUNT(*) AS n FROM daily_close_cache').get() as { n: number }).n).toBe(0)
    } finally { db.close() }
  })
  it('cancel after one committed stock preserves it and does not request the next stock', async () => {
    const db = dbFixture(), controller = new AbortController(); let requests = 0
    try {
      const pending = history.runPublicHistoricalDailySync(db, '20260814', { providers: ['sina'], governor: governor(db), signal: controller.signal,
        fetchImpl: async () => { requests++; return response() }, onProgress: job => { if (job.processedItems >= 1) controller.abort() } })
      await expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
      expect(requests).toBe(1)
      expect((db.prepare('SELECT COUNT(DISTINCT ts_code) AS n FROM daily_close_cache').get() as { n: number }).n).toBe(1)
      expect(db.prepare("SELECT status FROM public_daily_sync_checkpoints WHERE ts_code='600000.SH'").get()).toEqual({ status: 'success' })
    } finally { db.close() }
  })
  it('cancelled queued request does not release the next request before its predecessor settles', async () => {
    const db = dbFixture(), gate = governor(db), controller = new AbortController()
    let release!: () => void, thirdStarted = false
    const first = gate.run('sina', () => new Promise<{ status: number }>(resolve => { release = () => resolve({ status: 200 }) }))
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve()
    const second = gate.run('sina', async () => ({ status: 200 }), controller.signal).then(() => 'ran', e => (e as { code?: string }).code)
    controller.abort()
    const third = gate.run('sina', async () => { thirdStarted = true; return { status: 200 } })
    try {
      const observed = await Promise.race([second, new Promise(resolve => setTimeout(() => resolve('still queued'), 50))])
      expect(observed).toBe('LOCAL_WORK_CANCELLED'); expect(thirdStarted).toBe(false)
    } finally { release(); await Promise.allSettled([first, second, third]); db.close() }
  })
  it('late responses after cancellation neither write prices nor poison the provider failure count', async () => {
    const db = dbFixture(), controller = new AbortController(); let release!: (value: Response) => void, count = 0
    const pending = history.runPublicHistoricalDailySync(db, '20260814', { governor: governor(db), signal: controller.signal, fetchImpl: async () => { count++; return new Promise(resolve => { release = resolve }) } })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    for (let i = 0; i < 40 && !release; i++) await Promise.resolve()
    try {
      expect(release).toBeDefined(); controller.abort(); expect(await waitForPublicMarketWorkIdle(0)).toBe(false)
      release(response()); await rejected
      expect(count).toBe(1); expect((db.prepare('SELECT COUNT(*) AS n FROM daily_close_cache').get() as { n: number }).n).toBe(0)
      expect(db.prepare("SELECT status,last_error FROM public_daily_sync_checkpoints WHERE ts_code='600000.SH'").get()).toEqual({ status: 'pending', last_error: null })
      expect(getPublicMarketProviderState(db, 'sina', Date.now())).toMatchObject({ failureCount: 0, consecutiveFailures: 0 })
    } finally { if (release) release(response()); await Promise.allSettled([pending]); db.close() }
  })
  it('cancels cooldown waiting before starting another request', async () => {
    const db = dbFixture(), gate = governor(db), controller = new AbortController(); let calls = 0
    db.prepare('UPDATE public_market_request_global_state SET next_allowed_at=? WHERE id=1').run(Date.now() + 60000)
    const pending = gate.run('sina', async () => { calls++; return { status: 200 } }, controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    for (let i = 0; i < 10; i++) await Promise.resolve()
    try { controller.abort(); await rejected; expect(calls).toBe(0); expect(gate.snapshot().maximumActiveRequests).toBe(0) } finally { db.close() }
  })
  it('owns direct public-universe fetches during application stop', async () => {
    const db = dbFixture(); let release!: (value: Response) => void
    const pending = fetchPublicStockUniverse(db, { governor: governor(db), fetchImpl: async () => new Promise(resolve => { release = resolve }) })
    const settled = pending.then(() => 'resolved', error => (error as { code?: string }).code)
    for (let i = 0; i < 30 && !release; i++) await Promise.resolve()
    try {
      expect(publicMarketWorkOwner.snapshot().pendingTasks).toBeGreaterThan(0)
      stopPublicMarketWork(); expect(await waitForPublicMarketWorkIdle(0)).toBe(false)
      release(new Response('[]', { status: 200 })); expect(await settled).toBe('LOCAL_WORK_CANCELLED')
      expect(await waitForPublicMarketWorkIdle(0)).toBe(true)
      await expect(history.runPublicHistoricalDailySync(db, '20260814')).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    } finally { if (release) release(new Response('[]', { status: 200 })); await settled; db.close() }
  })
})
