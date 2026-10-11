import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as adapter from '../../electron/main/services/publicLimitPoolAdapter'
import { readVerifiedPublicLimitPool, syncVerifiedPublicLimitPool } from '../../electron/main/services/verifiedPublicLimitPoolCache'

vi.mock('electron', () => ({ app: { getPath: () => 'ISOLATED_UNUSED_ROOT' } }))
vi.mock('../../electron/main/services/pythonDataSourceBridge', () => ({ callPythonDataSource: vi.fn() }))
const DATE = '20261009'
const config = { dailyProviders: [], reportProviders: [], wencaiEnabled: false, pythonPath: '' }
const rawRow = { c: '002058', m: 0, n: '测试股票', p: 24440, zdp: 9.99, amount: 100791831, ltsz: 3503860934, tshare: 3505877234, hs: 2.87, lbc: 4, fbt: 92500, lbt: 92500, fund: 89302489, zbc: 0, hybk: '测试行业', zttj: { days: 4, ct: 4 } }
function envelope() { return { rc: 0, data: { tc: 1, qdate: Number(DATE), pool: [{ ...rawRow }] } } }
afterEach(() => vi.restoreAllMocks())
describe('native public limit pool protocol', () => {
  it('retains a real response date, validates market and converts only milli-yuan prices', () => {
    const result = adapter.normalizeNativePublicLimitUpPool(DATE, envelope())
    expect(result).toMatchObject({ source: 'eastmoney_public', dateBasis: 'source-reported', sourceReportedTradeDate: DATE, rows: [{ tsCode: '002058.SZ', close: 24.44, amountYuan: 100791831, fdAmountYuan: 89302489, firstTime: '09:25:00', limitTimes: 4, openTimes: 0 }] })
  })
  it.each([null, [], { rc: 1, data: {} }, { rc: 0, data: null }])('rejects malformed/failed envelopes %j', value => {
    expect(() => adapter.normalizeNativePublicLimitUpPool(DATE, value)).toThrow()
  })
  it.each([20261008, '20261008', null, true, '20260229'])('rejects absent, contradictory and invalid source date %j', qdate => {
    const value = { ...envelope(), data: { ...envelope().data, qdate } }
    expect(() => adapter.normalizeNativePublicLimitUpPool(DATE, value)).toThrow('SOURCE_DATE_MISMATCH')
  })
  it('rejects incomplete count and cannot interpret an empty pool as no limit-ups', () => {
    expect(() => adapter.normalizeNativePublicLimitUpPool(DATE, { rc: 0, data: { tc: 2, qdate: Number(DATE), pool: [rawRow] } })).toThrow('SOURCE_COUNT_MISMATCH')
    expect(adapter.normalizeNativePublicLimitUpPool(DATE, { rc: 0, data: { tc: 0, qdate: Number(DATE), pool: [] } }).state).toBe('unavailable')
  })
  it('rejects code/market contradictions rather than rewriting the source identity', () => {
    const value = envelope(); value.data.pool[0].m = 1
    expect(adapter.normalizeNativePublicLimitUpPool(DATE, value)).toMatchObject({ state: 'unavailable', rejectedRows: 1 })
  })
  it('requests the public endpoint with no secrets, redirects or Python', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope())))
    const result = await adapter.fetchNativePublicLimitUpPool(DATE, { fetcher })
    expect(result.rows).toHaveLength(1)
    const [url, options] = fetcher.mock.calls[0]
    expect(url.origin).toBe('https://push2ex.eastmoney.com')
    expect(url.searchParams.get('date')).toBe(DATE)
    expect(options.redirect).toBe('error')
    expect(options.headers).not.toHaveProperty('Authorization')
  })
  it('rejects oversized bodies and cancellation before contacting a provider', async () => {
    await expect(adapter.fetchNativePublicLimitUpPool(DATE, { fetcher: vi.fn().mockResolvedValue(new Response(' '.repeat(1024 * 1024 + 1))) })).rejects.toThrow('PUBLIC_LIMIT_POOL_RESPONSE_TOO_LARGE')
    const controller = new AbortController(); controller.abort()
    const fetcher = vi.fn()
    await expect(adapter.fetchNativePublicLimitUpPool(DATE, { fetcher, signal: controller.signal })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
describe('source-dated native pool cache', () => {
  function fixture() {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE trade_cal(cal_date TEXT PRIMARY KEY, is_open INTEGER);
      INSERT INTO trade_cal VALUES('${DATE}',1);
      CREATE TABLE daily_close_cache(ts_code TEXT,trade_date TEXT,close REAL);`)
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-12T00:00:00Z'))
    vi.spyOn(adapter, 'fetchPublicLimitUpPool').mockResolvedValue(adapter.normalizeNativePublicLimitUpPool(DATE, envelope()))
    return db
  }
  it('works with no selected Python/data provider or 4000-stock history, preserving the date witness across reads', async () => {
    const db = fixture()
    try {
      const saved = await syncVerifiedPublicLimitPool(db, config, DATE)
      expect(saved).toMatchObject({ ok: true, rows: 1, quality: 'partial', dateBasis: 'source-reported', priceCheck: 'not-complete' })
      const cached = readVerifiedPublicLimitPool(db)
      expect(cached).toMatchObject({ source: 'eastmoney_public', tradeDate: DATE, dateBasis: 'source-reported', priceCheck: 'not-complete', rows: [{ tsCode: '002058.SZ', close: 24.44 }] })
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='limit_list_daily'").get()).toBeUndefined()
      db.prepare('UPDATE public_limit_up_batch_provenance SET row_count=99').run()
      expect(readVerifiedPublicLimitPool(db).dateBasis).toBe('unknown')
    } finally { db.close() }
  })
  it('does not ignore a contradictory known local close', async () => {
    const db = fixture()
    try {
      db.prepare('INSERT INTO daily_close_cache VALUES(?,?,?)').run('002058.SZ', DATE, 10)
      expect(await syncVerifiedPublicLimitPool(db, config, DATE)).toMatchObject({ ok: false, quality: 'blocked' })
    } finally { db.close() }
  })
  it('rolls back rows and date provenance together on write failure', async () => {
    const db = fixture()
    try {
      await syncVerifiedPublicLimitPool(db, config, DATE)
      const before = db.serialize()
      db.exec("CREATE TRIGGER reject_pool BEFORE INSERT ON public_limit_up_facts BEGIN SELECT RAISE(ABORT,'isolated'); END")
      const rows = db.prepare('SELECT * FROM public_limit_up_facts').all()
      const proof = db.prepare('SELECT * FROM public_limit_up_batch_provenance').all()
      expect(await syncVerifiedPublicLimitPool(db, config, DATE)).toMatchObject({ ok: false })
      expect(db.prepare('SELECT * FROM public_limit_up_facts').all()).toEqual(rows)
      expect(db.prepare('SELECT * FROM public_limit_up_batch_provenance').all()).toEqual(proof)
      expect(before.length).toBeGreaterThan(0)
    } finally { db.close() }
  })
})
