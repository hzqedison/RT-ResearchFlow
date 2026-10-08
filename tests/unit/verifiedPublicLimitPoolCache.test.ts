import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MultiSourcePreference } from '../../electron/shared/dataSourceTypes'
import { fetchPublicLimitUpPool } from '../../electron/main/services/publicLimitPoolAdapter'
import { readVerifiedPublicLimitPool, syncVerifiedPublicLimitPool } from '../../electron/main/services/verifiedPublicLimitPoolCache'

vi.mock('electron', () => ({ app: { getPath: () => 'ISOLATED_UNUSED_DATA_ROOT' } }))
vi.mock('../../electron/main/services/pythonDataSourceBridge', () => ({ callPythonDataSource: vi.fn() }))
vi.mock('../../electron/main/services/publicLimitPoolAdapter', async importOriginal => ({
  ...await importOriginal<typeof import('../../electron/main/services/publicLimitPoolAdapter')>(),
  fetchPublicLimitUpPool: vi.fn(),
}))

const config = {
  dailyProviders: ['akshare'], reportProviders: [], wencaiEnabled: false, pythonPath: '',
} as MultiSourcePreference

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE trade_cal (cal_date TEXT PRIMARY KEY, is_open INTEGER, pretrade_date TEXT);
    CREATE TABLE daily_close_cache (ts_code TEXT, trade_date TEXT, close REAL);
  `)
  vi.mocked(fetchPublicLimitUpPool).mockReset()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-09T04:00:00Z'))
})
afterEach(() => { db.close(); vi.restoreAllMocks() })

function completeDailyClose(close = 11.25): void {
  db.prepare("INSERT INTO trade_cal (cal_date, is_open) VALUES ('20261008', 1)").run()
  db.exec(`
    WITH RECURSIVE codes(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM codes WHERE n < 3999)
    INSERT INTO daily_close_cache (ts_code, trade_date, close)
    SELECT printf('%06d', n) || '.SZ', '20261008', ${close} FROM codes;
  `)
}

function sourceSnapshot() {
  return {
    tradeDate: '20261008', source: 'akshare_eastmoney' as const,
    state: 'available' as const, rejectedRows: 0, missingFields: [],
    rows: [{
      tradeDate: '20261008', tsCode: '000001.SZ', source: 'akshare_eastmoney' as const,
      name: '虚构样本', close: 11.25, pctChg: 10, amountYuan: 1000000,
      floatMvYuan: 50000000, totalMvYuan: 70000000, turnoverRatio: 2.5,
      fdAmountYuan: 2200000, firstTime: '09:25:01', lastTime: '14:52:30',
      openTimes: 0, upStat: '2/2', limitTimes: 2, industry: '测试行业',
    }],
  }
}

function hundredRows(mismatches: number) {
  const snapshot = sourceSnapshot()
  snapshot.rows = Array.from({ length: 100 }, (_, index) => ({ ...snapshot.rows[0],
    tsCode: `${String(index + 1).padStart(6, '0')}.SZ`, close: index < mismatches ? 17.5 : 11.25 }))
  return snapshot
}

async function seedCache(): Promise<void> {
  completeDailyClose()
  vi.mocked(fetchPublicLimitUpPool).mockResolvedValue(sourceSnapshot())
  expect((await syncVerifiedPublicLimitPool(db, config, '20261008')).ok).toBe(true)
  db.prepare('UPDATE public_limit_up_facts SET verified_at = 123').run()
  vi.mocked(fetchPublicLimitUpPool).mockClear()
}

function storedCache() {
  return db.prepare('SELECT * FROM public_limit_up_facts ORDER BY trade_date, ts_code, source').all()
}

describe('verified public limit-up cache', () => {
  it('rejects a date not confirmed by the local trading calendar without contacting a provider', async () => {
    const result = await syncVerifiedPublicLimitPool(db, config, '20261008')
    expect(result.ok).toBe(false)
    expect(fetchPublicLimitUpPool).not.toHaveBeenCalled()
    expect(readVerifiedPublicLimitPool(db).rows).toEqual([])
  })

  it('rejects an inconsistent close and leaves the source-specific cache absent', async () => {
    completeDailyClose(9.50)
    vi.mocked(fetchPublicLimitUpPool).mockResolvedValue(sourceSnapshot())
    const result = await syncVerifiedPublicLimitPool(db, config, '20261008')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('未写入')
    expect(readVerifiedPublicLimitPool(db).rows).toEqual([])
  })

  it('saves only matched public facts in a separate table with source provenance', async () => {
    completeDailyClose()
    vi.mocked(fetchPublicLimitUpPool).mockResolvedValue(sourceSnapshot())
    const result = await syncVerifiedPublicLimitPool(db, config, '20261008')
    expect(result.ok).toBe(true)
    expect(result.rows).toBe(1)
    expect(result).toMatchObject({ quality: 'available', verifiedAt: Date.now(), dateBasis: 'request-only' })
    const stored = db.prepare('SELECT trade_date, ts_code, source, fd_amount_yuan FROM public_limit_up_facts').get() as Record<string, unknown>
    expect(stored).toMatchObject({ trade_date: '20261008', ts_code: '000001.SZ', source: 'akshare_eastmoney', fd_amount_yuan: 2200000 })
    expect(readVerifiedPublicLimitPool(db)).toMatchObject({ dateBasis: 'unknown', verifiedAt: Date.now(), rowmissingFields: { '000001.SZ': [] } })
  })

  it.each([{ mismatches: 1, written: 99 }, { mismatches: 2, written: 98 }])('passes the 98% gate but only writes $written matched facts', async ({ mismatches, written }) => {
    completeDailyClose()
    vi.mocked(fetchPublicLimitUpPool).mockResolvedValue(hundredRows(mismatches))
    const result = await syncVerifiedPublicLimitPool(db, config, '20261008')
    expect(result).toMatchObject({ ok: true, rows: written, quality: 'partial', dateBasis: 'request-only' })
    const stored = storedCache() as Array<{ ts_code: string; quality: string }>
    expect(stored).toHaveLength(written)
    for (let index = 1; index <= mismatches; index++) expect(stored.some(row => row.ts_code === `${String(index).padStart(6, '0')}.SZ`)).toBe(false)
    expect(stored.every(row => row.quality === 'available')).toBe(true)
    expect(Object.keys(result.rowmissingFields ?? {})).toHaveLength(written)
  })

  it('blocks below 98% without deleting or relabeling the old cache', async () => {
    await seedCache()
    const before = storedCache()
    vi.mocked(fetchPublicLimitUpPool).mockResolvedValue(hundredRows(3))
    expect(await syncVerifiedPublicLimitPool(db, config, '20261008')).toMatchObject({ ok: false, rows: 0, quality: 'blocked', verifiedAt: null })
    expect(storedCache()).toEqual(before)
  })

  it('uses row missing fields for quality, not the partial batch state', async () => {
    completeDailyClose()
    const snapshot = { ...sourceSnapshot(), state: 'partial' as const, rejectedRows: 1, missingFields: ['pctChg', 'openTimes'] }
    snapshot.rows.push({ ...snapshot.rows[0], tsCode: '000002.SZ', pctChg: null, openTimes: null } as typeof snapshot.rows[number])
    vi.mocked(fetchPublicLimitUpPool).mockResolvedValue(snapshot)
    expect(await syncVerifiedPublicLimitPool(db, config, '20261008')).toMatchObject({ rows: 2, quality: 'partial',
      rowmissingFields: { '000001.SZ': [], '000002.SZ': ['pctChg', 'openTimes'] } })
    expect(db.prepare('SELECT ts_code, quality FROM public_limit_up_facts ORDER BY ts_code').all()).toEqual([
      { ts_code: '000001.SZ', quality: 'available' }, { ts_code: '000002.SZ', quality: 'partial' },
    ])
    const observed = readVerifiedPublicLimitPool(db)
    expect(observed.rows[0]).toMatchObject({ quality: 'available', missingFields: [] })
    expect(observed.rows[1]).toMatchObject({ quality: 'partial', missingFields: ['openTimes', 'pctChg'] })
  })

  it('returns partial for rejected input even when all written rows are complete', async () => {
    completeDailyClose()
    vi.mocked(fetchPublicLimitUpPool).mockResolvedValue({ ...sourceSnapshot(), rejectedRows: 1 })
    expect(await syncVerifiedPublicLimitPool(db, config, '20261008')).toMatchObject({ ok: true, rows: 1, quality: 'partial' })
    expect(readVerifiedPublicLimitPool(db).rows[0].quality).toBe('available')
  })

  it('chooses the latest date only within akshare_eastmoney', async () => {
    await seedCache()
    db.prepare("INSERT INTO public_limit_up_facts (trade_date, ts_code, source, close, quality, verified_at) VALUES ('20261009', '000002.SZ', 'other_provider', 11.25, 'available', 456)").run()
    const observed = readVerifiedPublicLimitPool(db)
    expect(observed.tradeDate).toBe('20261008')
    expect(observed.rows.map(row => row.tsCode)).toEqual(['000001.SZ'])
    expect(observed.verifiedAt).toBe(123)
    db.prepare("DELETE FROM public_limit_up_facts WHERE source = 'akshare_eastmoney'").run()
    expect(readVerifiedPublicLimitPool(db)).toMatchObject({ tradeDate: null, rows: [], verifiedAt: null, dateBasis: 'unknown' })
  })

  it('reports a verification time only when every row in the batch has the same valid stored time', async () => {
    completeDailyClose()
    const snapshot = sourceSnapshot()
    snapshot.rows.push({ ...snapshot.rows[0], tsCode: '000002.SZ' })
    vi.mocked(fetchPublicLimitUpPool).mockResolvedValue(snapshot)
    await syncVerifiedPublicLimitPool(db, config, '20261008')
    expect(readVerifiedPublicLimitPool(db).verifiedAt).toBe(Date.now())
    db.prepare("UPDATE public_limit_up_facts SET verified_at = ? WHERE ts_code = '000002.SZ'").run(Date.now() - 1)
    expect(readVerifiedPublicLimitPool(db).verifiedAt).toBeNull()
    db.prepare('UPDATE public_limit_up_facts SET verified_at = 0').run()
    expect(readVerifiedPublicLimitPool(db).verifiedAt).toBeNull()
    db.prepare("UPDATE public_limit_up_facts SET verified_at = 'invalid'").run()
    expect(readVerifiedPublicLimitPool(db).verifiedAt).toBeNull()
  })

  it('checks the entire batch, not only the displayed 2500 rows, for a common verification time', async () => {
    await seedCache()
    db.exec(`
      WITH RECURSIVE codes(n) AS (SELECT 2 UNION ALL SELECT n + 1 FROM codes WHERE n < 2501)
      INSERT INTO public_limit_up_facts (trade_date, ts_code, source, close, quality, verified_at)
      SELECT '20261008', printf('%06d', n) || '.SZ', 'akshare_eastmoney', 11.25, 'partial',
        CASE WHEN n = 2501 THEN 456 ELSE 123 END FROM codes;
    `)
    const observed = readVerifiedPublicLimitPool(db)
    expect(observed.rows).toHaveLength(2500)
    expect(observed.verifiedAt).toBeNull()
  })

  it('does not retrospectively price-verify legacy rows or infer date provenance/freshness from zeros', async () => {
    await seedCache()
    db.prepare("UPDATE public_limit_up_facts SET close = 99.99, fd_amount_yuan = 0, open_times = 0, pct_chg = NULL, quality = 'partial'").run()
    db.exec('DELETE FROM trade_cal; DELETE FROM daily_close_cache;')
    const observed = readVerifiedPublicLimitPool(db)
    expect(observed).toMatchObject({ dateBasis: 'unknown', verifiedAt: 123, rowmissingFields: { '000001.SZ': ['pctChg'] } })
    expect(observed.rows[0]).toMatchObject({ close: 99.99, fdAmountYuan: 0, openTimes: 0, quality: 'partial', missingFields: ['pctChg'] })
    expect(observed.rows[0]).not.toHaveProperty('verifiedAt')
    expect(fetchPublicLimitUpPool).not.toHaveBeenCalled()
  })

  it('ignores old batch quality and derives each observed row quality only from the five returned fields', async () => {
    await seedCache()
    db.prepare("UPDATE public_limit_up_facts SET quality = 'partial', name = NULL").run()
    const before = storedCache()
    const observed = readVerifiedPublicLimitPool(db)
    expect(observed.rows[0]).toMatchObject({ quality: 'available', missingFields: [], name: null })
    expect(observed).toMatchObject({ dateBasis: 'unknown', verifiedAt: 123, rowmissingFields: { '000001.SZ': [] } })
    expect(storedCache()).toEqual(before)
    expect(fetchPublicLimitUpPool).not.toHaveBeenCalled()
  })

  it('recomputes invalid cached optional values as missing without rewriting legacy storage', async () => {
    await seedCache()
    db.prepare("UPDATE public_limit_up_facts SET fd_amount_yuan = -1, open_times = 1.5, limit_times = 0, pct_chg = ' ', first_time = '24:00:00'").run()
    const before = storedCache()
    const observed = readVerifiedPublicLimitPool(db)
    expect(observed.rowmissingFields?.['000001.SZ']).toEqual(['pctChg', 'fdAmountYuan', 'firstTime', 'openTimes', 'limitTimes'])
    expect(observed.rows[0]).toMatchObject({ pctChg: null, fdAmountYuan: null, firstTime: null, openTimes: null, limitTimes: null, quality: 'partial' })
    expect(storedCache()).toEqual(before)
  })

  it.each(['20260229', '20260431', '20261301', '20261000', '00000101'])('rejects impossible sync date %s without touching a provider or old cache', async date => {
    await seedCache()
    const before = storedCache()
    expect(await syncVerifiedPublicLimitPool(db, config, date)).toMatchObject({ ok: false, rows: 0, quality: 'blocked' })
    expect(fetchPublicLimitUpPool).not.toHaveBeenCalled()
    expect(storedCache()).toEqual(before)
  })

  it.each(['disabled', 'calendar', 'daily', 'empty', 'failure', 'insert'] as const)('preserves the old cache for rejection/failure: %s', async reason => {
    await seedCache()
    const before = storedCache()
    if (reason === 'calendar') db.exec('DELETE FROM trade_cal')
    if (reason === 'daily') db.exec('DELETE FROM daily_close_cache')
    if (reason === 'empty') vi.mocked(fetchPublicLimitUpPool).mockResolvedValue({ ...sourceSnapshot(), rows: [], state: 'unavailable' })
    if (reason === 'failure') vi.mocked(fetchPublicLimitUpPool).mockRejectedValue(new Error('isolated provider failure'))
    if (reason === 'insert') db.exec("CREATE TRIGGER reject_public_insert BEFORE INSERT ON public_limit_up_facts BEGIN SELECT RAISE(ABORT, 'isolated write failure'); END;")
    const result = await syncVerifiedPublicLimitPool(db, reason === 'disabled' ? { ...config, dailyProviders: [] } : config, '20261008')
    expect(result).toMatchObject({ ok: false, rows: 0, quality: 'blocked', verifiedAt: null })
    expect(storedCache()).toEqual(before)
    if (['disabled', 'calendar', 'daily'].includes(reason)) expect(fetchPublicLimitUpPool).not.toHaveBeenCalled()
  })
})
