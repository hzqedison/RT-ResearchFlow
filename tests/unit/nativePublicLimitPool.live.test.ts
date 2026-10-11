import Database from 'better-sqlite3'
import { expect, it, vi } from 'vitest'
import { isValidPublicLimitPoolDate } from '../../electron/main/services/publicLimitPoolAdapter'
import { readVerifiedPublicLimitPool, syncVerifiedPublicLimitPool } from '../../electron/main/services/verifiedPublicLimitPoolCache'

vi.mock('electron', () => ({ app: { getPath: () => 'ISOLATED_UNUSED_ROOT' } }))
vi.mock('../../electron/main/services/pythonDataSourceBridge', () => ({ callPythonDataSource: vi.fn(() => { throw new Error('PYTHON_MUST_NOT_RUN') }) }))

it.runIf(process.env.RT_PUBLIC_LIMIT_POOL_LIVE === '1')('live public endpoint -> isolated cache -> observable rows, without Python or user data', async () => {
  const date = process.env.RT_PUBLIC_LIMIT_POOL_DATE ?? ''
  expect(isValidPublicLimitPoolDate(date)).toBe(true)
  const db = new Database(':memory:')
  try {
    // Explicit synthetic calendar gate; this is not an exchange-calendar audit.
    db.exec('CREATE TABLE trade_cal(cal_date TEXT PRIMARY KEY,is_open INTEGER); CREATE TABLE daily_close_cache(ts_code TEXT,trade_date TEXT,close REAL)')
    db.prepare('INSERT INTO trade_cal VALUES(?,1)').run(date)
    const receipt = await syncVerifiedPublicLimitPool(db, { dailyProviders: [], reportProviders: [], wencaiEnabled: false, pythonPath: '' }, date)
    expect(receipt.ok, receipt.message).toBe(true)
    expect(receipt.rows).toBeGreaterThan(0)
    expect(receipt).toMatchObject({ dateBasis: 'source-reported', priceCheck: 'not-complete', quality: 'partial' })
    const observed = readVerifiedPublicLimitPool(db)
    expect(observed).toMatchObject({ source: 'eastmoney_public', tradeDate: date, dateBasis: 'source-reported', priceCheck: 'not-complete' })
    expect(observed.rows.length).toBe(receipt.rows)
    console.log(JSON.stringify({ kind: 'native-public-limit-pool-live', source: observed.source, date, rows: observed.rows.length, dateBasis: observed.dateBasis, priceCheck: observed.priceCheck, calendarGate: 'synthetic-fixture', userDataTouched: false, brokerOrdersSubmitted: false, installedAppTested: false }))
  } finally { db.close() }
}, 25000)
