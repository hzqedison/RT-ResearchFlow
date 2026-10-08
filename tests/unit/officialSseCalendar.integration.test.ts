import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const provider = vi.hoisted(() => ({ fetchTradeCal: vi.fn() }))

// No provider implementation, credentials store, broker, or external request is loaded.
vi.mock('../../electron/main/services/tushareService', () => ({
  fetchTradeCal: provider.fetchTradeCal,
}))

import {
  buildOfficialSseTradingCalendar,
  getPreviousOfficialSseTradingDay,
  isOfficialSseTradingDay,
} from '../../electron/shared/officialSseTradingCalendar'
import {
  getLatestCalDate,
  hasTradeCalCoverage,
  insertTradeCalIfMissing,
  getNextTradeDay,
  getPrevTradeDay,
  getTradingDaysInRange,
  isTradeDay,
  upsertTradeCal,
} from '../../electron/main/database/tradeCalRepository'
import {
  isTradeCalSyncRunning,
  seedOfficialTradeCalendar,
  syncTradeCalFull,
  syncTradeCalIfNeeded,
} from '../../electron/main/services/tradeCalSyncService'
import {
  clearTradingCalendarCache,
  isTodayTradingDay,
  refreshTradingCalendar,
} from '../../electron/main/services/tradingCalendarService'

interface StoredRow {
  cal_date: string
  is_open: number
  pretrade_date: string | null
}

function setBeijingDate(ymd: string): void {
  vi.setSystemTime(new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T04:00:00Z`))
}

describe('official SSE calendar: bounded real SQLite integration', () => {
  let db: Database.Database
  let directory: string
  let temporaryRoot: string

  function storedRows(): StoredRow[] {
    return db.prepare('SELECT cal_date, is_open, pretrade_date FROM trade_cal ORDER BY cal_date').all() as StoredRow[]
  }

  beforeEach(() => {
    provider.fetchTradeCal.mockReset()
    provider.fetchTradeCal.mockRejectedValue(new Error('MOCK_PROVIDER_UNAVAILABLE'))
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('EXTERNAL_NETWORK_FORBIDDEN') }))
    vi.useFakeTimers({ toFake: ['Date'] })
    setBeijingDate('20261008')
    clearTradingCalendarCache()
    const root = join(process.cwd(), '.cache', 'test-temp', 'official-sse-calendar')
    mkdirSync(root, { recursive: true })
    temporaryRoot = realpathSync(root)
    directory = mkdtempSync(join(root, 'sqlite-'))
    db = new Database(join(directory, 'calendar.db'))
    db.pragma('journal_mode = WAL')
    // Calendar-only fixture; production repository SQL executes against a real file.
    // This intentionally does not claim to exercise the complete migration chain.
    db.exec(`CREATE TABLE trade_cal (
      cal_date TEXT PRIMARY KEY,
      is_open INTEGER NOT NULL,
      pretrade_date TEXT
    )`)
  })

  afterEach(() => {
    clearTradingCalendarCache()
    db.close()
    const cleanupTarget = realpathSync(directory)
    const childPath = relative(temporaryRoot, cleanupTarget)
    if (!childPath || childPath === '..' || childPath.startsWith(`..${sep}`) || isAbsolute(childPath)) {
      throw new Error('UNSAFE_TEST_CLEANUP_PATH')
    }
    rmSync(cleanupTarget, { recursive: true, force: true })
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each([undefined, null, '', '   '])('fills every 2024-2026 date without a Key (%s)', async (token) => {
    expect(await syncTradeCalFull(db, token)).toMatchObject({
      status: 'completed', source: 'official-sse', rowCount: 1096,
      insertedRows: 1096, conflictRows: 0, firstConflictDate: null,
      coverageStart: '20240101', coverageEnd: '20261231',
    })
    const rows = storedRows()
    expect(rows).toHaveLength(1096)
    expect(new Set(rows.map((row) => row.cal_date)).size).toBe(1096)
    expect(rows[0].cal_date).toBe('20240101')
    expect(rows.at(-1)?.cal_date).toBe('20261231')
    expect(db.pragma('quick_check', { simple: true })).toBe('ok')
    expect(provider.fetchTradeCal).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(isTradeCalSyncRunning()).toBe(false)
  })

  it('retains holiday closures and announced reopening boundaries across all three years', async () => {
    await syncTradeCalFull(db)
    const boundaries = [
      ['20240101', '20240102', null],
      ['20240209', '20240219', '20240208'],
      ['20240404', '20240408', '20240403'],
      ['20240501', '20240506', '20240430'],
      ['20240610', '20240611', '20240607'],
      ['20240917', '20240918', '20240913'],
      ['20241007', '20241008', '20240930'],
      ['20250101', '20250102', '20241231'],
      ['20250128', '20250205', '20250127'],
      ['20250404', '20250407', '20250403'],
      ['20250505', '20250506', '20250430'],
      ['20250602', '20250603', '20250530'],
      ['20251008', '20251009', '20250930'],
      ['20260101', '20260105', '20251231'],
      ['20260223', '20260224', '20260213'],
      ['20260406', '20260407', '20260403'],
      ['20260505', '20260506', '20260430'],
      ['20260619', '20260622', '20260618'],
      ['20260925', '20260928', '20260924'],
      ['20261007', '20261008', '20260930'],
    ] as const
    for (const [closed, reopened, previous] of boundaries) {
      expect(isOfficialSseTradingDay(closed), closed).toBe(false)
      expect(isTradeDay(db, closed), closed).toBe(false)
      expect(isTradeDay(db, reopened), reopened).toBe(true)
      expect(getPrevTradeDay(db, reopened), reopened).toBe(previous)
      setBeijingDate(closed)
      await refreshTradingCalendar()
      expect(isTodayTradingDay(), closed).toBe(false)
      setBeijingDate(reopened)
      await refreshTradingCalendar()
      expect(isTodayTradingDay(), reopened).toBe(true)
    }
    expect(provider.fetchTradeCal).not.toHaveBeenCalled()
  })

  it('never treats government weekend makeup dates as exchange sessions', async () => {
    await syncTradeCalFull(db)
    const makeupWeekends = [
      '20240204', '20240218', '20240407', '20240428', '20240511', '20240914', '20240929', '20241012',
      '20250126', '20250208', '20250427', '20250928', '20251011',
      '20260104', '20260214', '20260228', '20260509', '20260920', '20261010',
    ]
    for (const date of makeupWeekends) {
      expect(isOfficialSseTradingDay(date), date).toBe(false)
      expect(isTradeDay(db, date), date).toBe(false)
      setBeijingDate(date)
      await refreshTradingCalendar()
      expect(isTodayTradingDay(), date).toBe(false)
    }
  })

  it('keeps all previous-session links correct, including coverage start and year crossings', async () => {
    await syncTradeCalFull(db)
    let previous: string | null = null
    for (const row of storedRows()) {
      expect(row.pretrade_date, row.cal_date).toBe(previous)
      expect(getPrevTradeDay(db, row.cal_date), row.cal_date).toBe(previous)
      if (row.is_open === 1) previous = row.cal_date
    }
    expect(getPreviousOfficialSseTradingDay('20240101')).toBeNull()
    expect(getPreviousOfficialSseTradingDay('20250102')).toBe('20241231')
    expect(getPreviousOfficialSseTradingDay('20260105')).toBe('20251231')
    expect(getNextTradeDay(db, '20260930')).toBe('20261008')
    expect(getTradingDaysInRange(db, '20261001', '20261009')).toEqual(['20261008', '20261009'])
  })

  it('retains the preceding session when building a restricted official range', () => {
    expect(buildOfficialSseTradingCalendar('20261008', '20261009')).toEqual([
      { calDate: '20261008', isOpen: 1, pretradeDate: '20260930' },
      { calDate: '20261009', isOpen: 1, pretradeDate: '20261008' },
    ])
  })

  it.each(['20270101', '20270104', '20271231'])('leaves unannounced 2027 dates unknown (%s)', async (date) => {
    setBeijingDate(date)
    await syncTradeCalFull(db)
    await refreshTradingCalendar()
    expect(isOfficialSseTradingDay(date)).toBeNull()
    expect(isTradeDay(db, date)).toBeNull()
    expect(getPrevTradeDay(db, date)).toBeNull()
    expect(getPreviousOfficialSseTradingDay(date)).toBeNull()
    expect(buildOfficialSseTradingCalendar('20270101', '20271231')).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM trade_cal WHERE cal_date >= ?').get('20270101')).toEqual({ n: 0 })
    // This boolean API fails closed; it does not expose a distinct unknown state.
    expect(isTodayTradingDay()).toBe(false)
    expect(provider.fetchTradeCal).not.toHaveBeenCalled()
  })

  it('fills holes over the next 60 days inside announced coverage without a Key', async () => {
    setBeijingDate('20261008')
    seedOfficialTradeCalendar(db)
    db.prepare('DELETE FROM trade_cal WHERE cal_date BETWEEN ? AND ?').run('20261009', '20261207')
    expect(db.prepare('SELECT COUNT(*) AS n FROM trade_cal WHERE cal_date BETWEEN ? AND ?').get('20261009', '20261207')).toEqual({ n: 0 })
    await syncTradeCalIfNeeded(db)
    expect(db.prepare('SELECT COUNT(*) AS n FROM trade_cal WHERE cal_date BETWEEN ? AND ?').get('20261009', '20261207')).toEqual({ n: 60 })
    expect(getPrevTradeDay(db, '20261009')).toBe('20261008')
    expect(provider.fetchTradeCal).not.toHaveBeenCalled()
  })

  it('does not invent the unannounced portion of a future 60-day window without a Key', async () => {
    setBeijingDate('20261201')
    await syncTradeCalIfNeeded(db)
    expect(getLatestCalDate(db)).toBe('20261231')
    expect(isTradeDay(db, '20270104')).toBeNull()
    expect(db.prepare('SELECT COUNT(*) AS n FROM trade_cal WHERE cal_date BETWEEN ? AND ?').get('20270101', '20270130')).toEqual({ n: 0 })
    expect(provider.fetchTradeCal).not.toHaveBeenCalled()
  })

  it('detects a missing future 60-day span even if a later isolated provider row exists', async () => {
    setBeijingDate('20261201')
    upsertTradeCal(db, [{ calDate: '20270131', isOpen: 0, pretradeDate: '20270129' }])
    provider.fetchTradeCal.mockResolvedValue([{ calDate: '20270104', isOpen: 1, pretradeDate: '20261231' }])
    await syncTradeCalIfNeeded(db, 'mock-test-token-not-a-credential')
    // MAX(cal_date) alone cannot prove continuity or a complete provider response.
    expect(provider.fetchTradeCal).toHaveBeenCalledOnce()
    expect(isTradeDay(db, '20270104')).toBe(true)
    expect(hasTradeCalCoverage(db, '20261201', '20270130')).toBe(false)
    expect(isTradeDay(db, '20270105')).toBeNull()
  })

  it('preserves existing conflicting facts and reports both status and previous-date conflicts', async () => {
    upsertTradeCal(db, [
      { calDate: '20261008', isOpen: 0, pretradeDate: '20260930' },
      { calDate: '20261012', isOpen: 1, pretradeDate: '20261008' },
    ])
    const result = await syncTradeCalFull(db)
    expect(result).toMatchObject({ insertedRows: 1094, conflictRows: 2, firstConflictDate: '20261008' })
    expect(db.prepare('SELECT cal_date, is_open, pretrade_date FROM trade_cal WHERE cal_date IN (?, ?) ORDER BY cal_date').all('20261008', '20261012')).toEqual([
      { cal_date: '20261008', is_open: 0, pretrade_date: '20260930' },
      { cal_date: '20261012', is_open: 1, pretrade_date: '20261008' },
    ])
    expect(isTradeDay(db, '20261008')).toBe(false)
  })

  it('does not publish a new previous-session link pointing at a retained closed conflict', async () => {
    upsertTradeCal(db, [{ calDate: '20261008', isOpen: 0, pretradeDate: '20260930' }])
    await syncTradeCalFull(db)
    expect(isTradeDay(db, '20261008')).toBe(false)
    const previous = getPrevTradeDay(db, '20261009')
    // Either an unknown dependency or a verified open predecessor is acceptable.
    // A retained closed date must not be advertised as a previous trading session.
    expect(previous === null || isTradeDay(db, previous) === true).toBe(true)
    expect(previous).toBe('20260930')
    const before = storedRows()
    expect(seedOfficialTradeCalendar(db)).toMatchObject({ insertedRows: 0, conflictRows: 1 })
    expect(storedRows()).toEqual(before)
  })

  it('honors an explicitly unknown predecessor instead of restoring a conflicting official link', () => {
    upsertTradeCal(db, [{ calDate: '20261009', isOpen: 1, pretradeDate: null }])
    expect(getPreviousOfficialSseTradingDay('20261009')).toBe('20261008')
    expect(getPrevTradeDay(db, '20261009')).toBeNull()
    seedOfficialTradeCalendar(db)
    expect(getPrevTradeDay(db, '20261009')).toBeNull()
  })

  it('does not bridge a missing date when deriving a predecessor for restricted unsorted input', () => {
    upsertTradeCal(db, [{ calDate: '20261008', isOpen: 1, pretradeDate: '20260930' }])
    insertTradeCalIfMissing(db, [
      { calDate: '20261013', isOpen: 1, pretradeDate: '20261012' },
      { calDate: '20261012', isOpen: 1, pretradeDate: '20261009' },
    ])
    expect(getPrevTradeDay(db, '20261012')).toBeNull()
    expect(getPrevTradeDay(db, '20261013')).toBe('20261012')
    expect(isTradeDay(db, '20261010')).toBe(false)
    expect(db.prepare('SELECT cal_date FROM trade_cal WHERE cal_date = ?').get('20261010')).toBeUndefined()
  })

  it('requires valid daily statuses, not just the row count or latest date', async () => {
    setBeijingDate('20261201')
    const rows = Array.from({ length: 61 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 11, 1 + index))
      return { calDate: date.toISOString().slice(0, 10).replace(/-/g, ''), isOpen: 0, pretradeDate: null }
    })
    upsertTradeCal(db, rows)
    expect(hasTradeCalCoverage(db, '20261201', '20270130')).toBe(true)
    await syncTradeCalIfNeeded(db, 'mock-test-token-not-a-credential')
    expect(provider.fetchTradeCal).not.toHaveBeenCalled()
    db.prepare('UPDATE trade_cal SET is_open = 2 WHERE cal_date = ?').run('20270104')
    expect(hasTradeCalCoverage(db, '20261201', '20270130')).toBe(false)
    await syncTradeCalIfNeeded(db, 'mock-test-token-not-a-credential')
    expect(provider.fetchTradeCal).toHaveBeenCalledOnce()
    expect(db.prepare('SELECT is_open FROM trade_cal WHERE cal_date = ?').get('20270104')).toEqual({ is_open: 2 })
    expect(hasTradeCalCoverage(db, '20261201', '20270130')).toBe(false)
    expect(hasTradeCalCoverage(db, '20260230', '20260301')).toBe(false)
    expect(hasTradeCalCoverage(db, '20270130', '20261201')).toBe(false)
  })

  it('is byte-for-byte row idempotent on repeated default sync and seed calls', async () => {
    const first = await syncTradeCalFull(db)
    const before = storedRows()
    const second = await syncTradeCalFull(db)
    const third = seedOfficialTradeCalendar(db)
    await syncTradeCalIfNeeded(db)
    expect(first.insertedRows).toBe(1096)
    expect(second).toMatchObject({ insertedRows: 0, conflictRows: 0 })
    expect(third).toMatchObject({ insertedRows: 0, conflictRows: 0 })
    expect(storedRows()).toEqual(before)
    expect(provider.fetchTradeCal).not.toHaveBeenCalled()
  })

  it('shares a full-sync promise until the real SQLite fallback is complete', async () => {
    let rejectProvider!: (reason: Error) => void
    provider.fetchTradeCal.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectProvider = reject }))
    const first = syncTradeCalFull(db, 'mock-test-token-not-a-credential')
    const second = syncTradeCalFull(db, 'mock-test-token-not-a-credential')
    expect(second).toBe(first)
    await Promise.resolve()
    expect(provider.fetchTradeCal).toHaveBeenCalledOnce()
    expect(storedRows()).toHaveLength(0)
    expect(isTradeCalSyncRunning()).toBe(true)
    rejectProvider(new Error('MOCK_NETWORK_FAILURE'))
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual(b)
    expect(a).toMatchObject({ status: 'completed', source: 'official-sse', insertedRows: 1096 })
    expect(storedRows()).toHaveLength(1096)
    expect(isTradeCalSyncRunning()).toBe(false)
  })

  it.each(['MOCK_TUSHARE_PERMISSION_DENIED', 'MOCK_NETWORK_FAILURE'])('falls back after %s without losing previous-session links', async (reason) => {
    provider.fetchTradeCal.mockRejectedValue(new Error(reason))
    expect(await syncTradeCalFull(db, 'mock-test-token-not-a-credential')).toMatchObject({
      status: 'completed', source: 'official-sse', insertedRows: 1096,
    })
    await refreshTradingCalendar('mock-test-token-not-a-credential')
    expect(isTodayTradingDay()).toBe(true)
    expect(getPrevTradeDay(db, '20261008')).toBe('20260930')
    expect(provider.fetchTradeCal).toHaveBeenCalledTimes(2)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('falls back after an empty provider response without guessing future sessions', async () => {
    provider.fetchTradeCal.mockResolvedValue([])
    expect(await syncTradeCalFull(db, 'mock-test-token-not-a-credential')).toMatchObject({ status: 'completed', source: 'official-sse' })
    expect(isTradeDay(db, '20270104')).toBeNull()
    expect(getPrevTradeDay(db, '20261008')).toBe('20260930')
  })

  it('does not discard retained conflicting facts during provider failure fallback', async () => {
    upsertTradeCal(db, [{ calDate: '20261008', isOpen: 0, pretradeDate: '20260930' }])
    provider.fetchTradeCal.mockRejectedValue(new Error('MOCK_TUSHARE_PERMISSION_DENIED'))
    expect(await syncTradeCalFull(db, 'mock-test-token-not-a-credential')).toMatchObject({
      source: 'official-sse', conflictRows: 1, firstConflictDate: '20261008',
    })
    expect(isTradeDay(db, '20261008')).toBe(false)
    expect(getPrevTradeDay(db, '20261008')).toBe('20260930')
  })

  it('keeps an unannounced weekday unknown when the provider fails', async () => {
    setBeijingDate('20270104')
    await syncTradeCalFull(db, 'mock-test-token-not-a-credential')
    await refreshTradingCalendar('mock-test-token-not-a-credential')
    expect(isOfficialSseTradingDay('20270104')).toBeNull()
    expect(isTradeDay(db, '20270104')).toBeNull()
    expect(isTodayTradingDay()).toBe(false)
    expect(getPrevTradeDay(db, '20270104')).toBeNull()
    expect(provider.fetchTradeCal).toHaveBeenCalledTimes(2)
  })
})
