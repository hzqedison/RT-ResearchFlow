import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LimitListDailyRow, StkAuctionRow } from '../../electron/main/database/types'

const h = vi.hoisted(() => ({
  auctions: new Map<string, StkAuctionRow[]>(), limits: new Map<string, LimitListDailyRow[]>(),
  calendar: new Map<string, { isOpen: number; conflict?: boolean }>(),
  signals: new Map<string, string>(), source: 'kpl' as 'kpl' | 'ths' | 'dc', enabled: false,
  fetch: vi.fn(), persist: vi.fn(), emit: vi.fn(), dismiss: vi.fn(), route: vi.fn(),
  history: vi.fn(), localHistory: vi.fn(), concepts: vi.fn(), insertConcepts: vi.fn(),
  readAuction: vi.fn(), readLimits: vi.fn(), kpl: vi.fn(), closeRows: new Map(),
  sql: [] as string[],
}))
vi.mock('../../electron/main/database/db', () => ({
  getDb: () => ({
    prepare(sql: string) {
      h.sql.push(sql)
      if (/MAX\s*\([^)]*trade_date/i.test(sql)) throw new Error('OLD_MAX_DATE_FORBIDDEN')
      if (sql.includes('SELECT 1 FROM decision_signals')) return { get: (key: string) => h.signals.has(key) ? { exists: 1 } : undefined }
      if (sql.includes('UPDATE decision_signals')) return { run: h.dismiss }
      if (sql.includes('SELECT DISTINCT') || sql.includes('FROM stock_info')) return { all: () => [] }
      throw new Error('UNEXPECTED_FAKE_SQL')
    },
  }),
}))
vi.mock('../../electron/main/services/dataReadinessService', async importOriginal => ({
  ...await importOriginal<typeof import('../../electron/main/services/dataReadinessService')>(),
  readKnownCalendar: () => (date: string) => h.calendar.get(date),
}))
vi.mock('../../electron/main/database/tradeCalRepository', () => ({ getNextTradeDay: () => null }))
vi.mock('../../electron/main/database/limitListDailyRepository', () => ({ getLimitListByDate: h.readLimits }))
vi.mock('../../electron/main/database/stkAuctionCacheRepository', () => ({ queryByDate: h.readAuction, upsertStkAuctionCache: h.persist }))
vi.mock('../../electron/main/database/settingsRepository', () => ({ getConceptSource: () => h.source }))
vi.mock('../../electron/main/database/dataSourceRepository', () => ({
  getDataSourceConfig: () => ({ tushareEnabled: h.enabled, tushareTokenEncrypted: h.enabled ? 'offline-fixture' : null }),
}))
vi.mock('../../electron/main/utils/apiKeyEncryption', () => ({ decryptApiKey: () => 'offline-synthetic-token' }))
vi.mock('../../electron/main/services/tushareService', () => ({
  fetchStkAuction: h.fetch, fetchDailyForCandidates: vi.fn(() => { throw new Error('NO_REMOTE_HISTORY_IN_UNIT_TEST') }),
  fetchKplConceptConsByStock: h.concepts,
}))
vi.mock('../../electron/main/services/conceptRouter', () => ({ getConceptsByStockRouted: h.route }))
vi.mock('../../electron/main/database/kplConceptMembersRepository', () => ({ insertConceptMembersIfAbsent: h.insertConcepts }))
vi.mock('../../electron/main/services/sharedRtKCache', () => ({ getRtKCache: () => null, getLimitPct: () => 10 }))
vi.mock('../../electron/main/database/dailyCloseCacheRepository', () => ({
  queryDailyClose: () => new Map(), queryDailyCloseExact: () => h.closeRows, upsertDailyClose: vi.fn(),
}))
vi.mock('../../electron/main/database/kplConceptDailyRepository', () => ({ getKplListByDate: h.kpl }))
vi.mock('../../electron/main/database/sectorFlowObservationRepository', () => ({
  getLatestVerifiedObservationDateBefore: () => null, listSectorFlowObservations: () => [],
}))
vi.mock('../../electron/main/services/decisionSignalService', () => ({ emitDecisionSignals: h.emit }))
vi.mock('../../electron/main/services/morningAuctionPriceHistoryCoordinator', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/main/services/morningAuctionPriceHistoryCoordinator')>()
  return {
    ...actual, loadMorningAuctionPriceHistoryEntries: h.localHistory,
    MorningAuctionPriceHistoryCoordinator: class {
      ensure(date: string, codes: string[]) { return h.history(date, codes) }
      getCoverage(_date: string, codes: string[]) { return actual.buildMorningAuctionPriceHistoryCoverage(codes, new Map()) }
    },
  }
})

const DATE = '20260710'
const PREV = '20260709'
const CODE = '600001.SH'
const key = (code = CODE, date = DATE) => 'short_term:morningAuction.allMarket:' + date + ':' + code
const at = (clock: string, date = '2026-07-10') => Date.parse(date + 'T' + clock + '+08:00')
function auction(patch: Partial<StkAuctionRow> = {}): StkAuctionRow {
  return { tsCode: CODE, tradeDate: DATE, price: 10.5, preClose: 10, amount: 6_000_000,
    turnoverRate: 0.2, volumeRatio: 2, floatShare: 40_000, vol: 600_000, fetchedAt: Date.now(), ...patch }
}
function limit(patch: Partial<LimitListDailyRow> = {}): LimitListDailyRow {
  return { tsCode: CODE, tradeDate: PREV, name: 'Fixture', close: 10, pctChg: 10, amount: null, floatMv: null,
    totalMv: null, turnoverRatio: null, fdAmount: null, firstTime: '09:35:00', lastTime: '09:35:00',
    openTimes: 0, upStat: null, limitTimes: 1, limit: 'U', fetchedAt: 1, ...patch }
}
function seed(...rows: StkAuctionRow[]) {
  for (const row of rows) {
    const current = h.auctions.get(row.tradeDate) ?? []
    h.auctions.set(row.tradeDate, [...current.filter(old => old.tsCode !== row.tsCode), structuredClone(row)])
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function microtasks() { for (let i = 0; i < 20; i++) await Promise.resolve() }
let service: typeof import('../../electron/main/services/morningAuctionService')

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: [
    'Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  ] })
  vi.setSystemTime(at('09:28:00'))
  h.auctions.clear(); h.limits.clear(); h.calendar.clear(); h.signals.clear(); h.closeRows.clear()
  h.source = 'kpl'; h.enabled = false; h.sql.length = 0
  for (const date of ['20260707', '20260708', '20260709', '20260710', '20260713', '20260714']) h.calendar.set(date, { isOpen: 1 })
  for (const date of ['20260711', '20260712']) h.calendar.set(date, { isOpen: 0 })
  for (const fn of [h.fetch, h.persist, h.emit, h.dismiss, h.route, h.history, h.localHistory,
    h.concepts, h.insertConcepts, h.readAuction, h.readLimits, h.kpl]) fn.mockReset()
  h.readAuction.mockImplementation((_db, date) => structuredClone(h.auctions.get(date) ?? []))
  h.readLimits.mockImplementation((_db, date) => structuredClone(h.limits.get(date) ?? []))
  h.persist.mockImplementation((_db, rows) => seed(...rows))
  h.fetch.mockResolvedValue([])
  h.emit.mockImplementation((_db, inputs) => { for (const input of inputs) h.signals.set(input.dedupKey, 'NEW'); return inputs })
  h.dismiss.mockImplementation((_now, ...keys) => { for (const id of keys) if (['NEW', 'READ', 'WATCHING'].includes(h.signals.get(id) ?? '')) h.signals.set(id, 'DISMISSED') })
  h.route.mockReturnValue([{ conceptCode: 'fixture', conceptName: 'Local fixture' }])
  h.kpl.mockReturnValue([])
  h.history.mockResolvedValue(new Map())
  h.localHistory.mockResolvedValue(new Map())
  h.concepts.mockResolvedValue([])
  service = await import('../../electron/main/services/morningAuctionService')
})
afterEach(() => { vi.useRealTimers() })

describe('normal morning auction fact entry', () => {
  it('uses valid local auction without token or limit facts; only dependent pools are blocked', async () => {
    seed(auction())
    const snap = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(snap.threeOne.allMarket).toHaveLength(1)
    expect(snap.threeOne.allMarket[0]).toMatchObject({ stockName: CODE, stockNameKnown: false })
    expect(snap.threeOne.firstBoard).toEqual([])
    expect(snap.readiness?.pools['threeOne.firstBoard']).toMatchObject({ state: 'blocked', reasonCode: 'PREVIOUS_LIMIT_MISSING_OR_INVALID' })
    expect(snap.readiness?.auction.completeCoverage).toBe(false)
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.emit).toHaveBeenCalledTimes(1)
  })

  it('same-day empty then diagnostic supplement rebuilds on normal get, without another fetch', async () => {
    const empty = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(empty.readiness?.auction.state).toBe('missing_or_empty')
    expect(empty.readiness?.lastAttempt?.reasonCode).toBe('NOT_CONFIGURED')
    seed(auction())
    expect(service.getCachedMorningAuctionSnapshot(DATE)).toBeNull()
    const next = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(next.threeOne.allMarket).toHaveLength(1)
    expect(next.readiness?.fingerprint).not.toBe(empty.readiness?.fingerprint)
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.emit).toHaveBeenCalledTimes(1)
  })

  it('09:28 refresh fetches the explicit current target, persists, computes and emits provisional facts once', async () => {
    h.enabled = true
    h.fetch.mockResolvedValue([auction()])
    const snap = await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.fetch).toHaveBeenCalledWith('offline-synthetic-token', DATE, undefined, expect.objectContaining({
      deadlineMs: at('09:28:30'), signal: expect.any(AbortSignal), maxPages: 4, maxAttempts: 1, retryDelayMs: 0,
    }))
    expect(h.persist).toHaveBeenCalledTimes(1)
    expect(snap.readiness?.phase).toBe('observed_provisional')
    expect(snap.readiness?.lastAttempt?.outcome).toBe('success')
    expect(h.emit.mock.calls[0][1][0]).toMatchObject({ signalTime: at('09:28:00'), dedupKey: key() })
    await service.getOrCreateMorningAuctionSnapshot(DATE)
    await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(h.emit).toHaveBeenCalledTimes(1)
  })

  it('09:15 warmup keeps previous structure metadata, not zero-price candidates or notifications', async () => {
    vi.setSystemTime(at('09:15:00')); h.enabled = true
    h.limits.set(PREV, [limit()])
    const snap = await service.refreshMorningAuctionSnapshot(DATE)
    expect(snap.readiness?.phase).toBe('waiting')
    expect(snap.readiness?.previousLimit.rows).toBe(1)
    expect(snap.threeOne.firstBoard).toEqual([])
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.emit).not.toHaveBeenCalled(); expect(h.dismiss).not.toHaveBeenCalled()
  })

  it('clock crossing 09:30 cannot confirm old provisional bytes; a later real observation can', async () => {
    seed(auction())
    const first = await service.getOrCreateMorningAuctionSnapshot(DATE)
    vi.setSystemTime(at('09:30:00'))
    const due = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(due.readiness?.phase).toBe('due_unconfirmed')
    expect(due.readiness?.fingerprint).toBe(first.readiness?.fingerprint)
    expect(due.readiness?.auction.observedAt).toBe(at('09:28:00'))
    expect(due.generatedAt).toBe(first.generatedAt)
    seed(auction())
    const observed = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(observed.readiness?.phase).toBe('observed_after_cutoff')
    expect(observed.readiness?.auction.completeCoverage).toBe(false)
    expect(h.emit).toHaveBeenCalledTimes(1)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('early cached data does not acquire signal eligibility by relabeling its time', async () => {
    seed(auction({ fetchedAt: at('09:15:00') }))
    const snap = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(snap.threeOne.allMarket).toHaveLength(1)
    expect(snap.readiness?.phase).toBe('waiting')
    expect(h.emit).not.toHaveBeenCalled(); expect(h.dismiss).not.toHaveBeenCalled()
  })

  it('equal-row-count auction and previous-limit revisions rebuild; an older MAX date is never substituted', async () => {
    seed(auction())
    h.limits.set('20260708', [limit({ tradeDate: '20260708' })])
    const before = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(before.threeOne.firstBoard).toEqual([])
    h.limits.set(PREV, [limit()])
    const first = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(first.threeOne.firstBoard).toHaveLength(1)
    seed(auction({ price: 10.2 }))
    h.limits.set(PREV, [limit({ limitTimes: 2 })])
    const second = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(second.threeOne.allMarket).toEqual([])
    expect(second.threeOne.firstBoard).toEqual([])
    expect(second.threeOne.secondBoard).toHaveLength(1)
    expect(second.readiness?.fingerprint).not.toBe(first.readiness?.fingerprint)
    expect(h.sql.some(sql => /MAX\s*\(/i.test(sql))).toBe(false)
  })

  it('calendar corrections change the exact predecessor; a missing intervening day blocks only that dependency', async () => {
    seed(auction())
    h.limits.set(PREV, [limit()])
    h.limits.set('20260708', [limit({ tradeDate: '20260708', limitTimes: 2 })])
    await service.getOrCreateMorningAuctionSnapshot(DATE)
    h.calendar.set(PREV, { isOpen: 0 })
    const corrected = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(corrected.readiness?.previousTradeDate).toBe('20260708')
    expect(corrected.threeOne.secondBoard).toHaveLength(1)
    h.calendar.delete(PREV)
    const unknown = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(unknown.readiness?.previousTradeDate).toBeNull()
    expect(unknown.threeOne.allMarket).toHaveLength(1)
    expect(unknown.threeOne.secondBoard).toEqual([])
    expect(unknown.readiness?.pools['boardCategory.first'].reasonCode).toBe('PREVIOUS_TRADE_DATE_UNKNOWN')
    expect(h.kpl.mock.calls.every(([, date]) => ['20260708', PREV].includes(date))).toBe(true)
  })

  it.each(['unknown', 'conflict', 'future', 'closed'] as const)('fails closed for %s target without fetch or signal side effects', async mode => {
    h.enabled = true
    let date = DATE
    if (mode === 'unknown') h.calendar.delete(DATE)
    if (mode === 'conflict') h.calendar.set(DATE, { isOpen: 1, conflict: true })
    if (mode === 'future') date = '20260713'
    if (mode === 'closed') h.calendar.set(DATE, { isOpen: 0 })
    const snap = await service.refreshMorningAuctionSnapshot(date)
    expect(snap.tradeDate).toBe(date); expect(snap.readiness?.phase).toBe('blocked')
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.emit).not.toHaveBeenCalled(); expect(h.dismiss).not.toHaveBeenCalled()
  })

  it.each(['empty', 'quota', 'wrong-date', 'invalid-price', 'duplicate'] as const)('preserves old facts and reports %s instead of a successful new observation', async mode => {
    seed(auction())
    const before = structuredClone(h.auctions.get(DATE))
    h.enabled = true
    if (mode === 'quota') h.fetch.mockRejectedValue(Object.assign(new Error('private provider detail'), { code: 'TUSHARE_QUOTA_INSUFFICIENT' }))
    if (mode === 'wrong-date') h.fetch.mockResolvedValue([auction({ tradeDate: PREV })])
    if (mode === 'invalid-price') h.fetch.mockResolvedValue([auction({ price: 0 })])
    if (mode === 'duplicate') h.fetch.mockResolvedValue([auction(), auction()])
    const snap = await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.auctions.get(DATE)).toEqual(before)
    expect(h.persist).not.toHaveBeenCalled()
    expect(snap.threeOne.allMarket).toHaveLength(1)
    expect(snap.readiness?.lastAttempt?.outcome).toBe(mode === 'empty' ? 'empty' : 'failed')
    expect(JSON.stringify(snap.readiness)).not.toContain('private provider detail')
  })

  it('remote null fields preserve old non-null facts and their earlier observation timestamp', async () => {
    seed(auction({ fetchedAt: at('09:15:00') }))
    h.enabled = true
    h.fetch.mockResolvedValue([auction({ price: null, volumeRatio: null })])
    const snap = await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.auctions.get(DATE)?.[0]).toMatchObject({ price: 10.5, volumeRatio: 2, fetchedAt: at('09:15:00') })
    expect(snap.readiness?.lastAttempt?.outcome).toBe('partial')
    expect(snap.readiness?.auction.eligibleRows).toBe(0)
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('persistence failure cannot turn remote results into candidates or signal confirmation', async () => {
    h.enabled = true; h.fetch.mockResolvedValue([auction()])
    h.persist.mockImplementation(() => { throw new Error('fixture write failure') })
    const snap = await service.refreshMorningAuctionSnapshot(DATE)
    expect(snap.threeOne.allMarket).toEqual([])
    expect(snap.readiness?.lastAttempt?.reasonCode).toBe('PERSIST_FAILED')
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('get and refresh share one date flight, including a source change; responses are isolated copies', async () => {
    h.enabled = true; seed(auction())
    const remote = deferred<StkAuctionRow[]>()
    h.fetch.mockReturnValue(remote.promise)
    const one = service.getOrCreateMorningAuctionSnapshot(DATE)
    const two = service.refreshMorningAuctionSnapshot(DATE)
    await microtasks()
    expect(h.fetch).toHaveBeenCalledTimes(1)
    h.source = 'dc'
    const three = service.getOrCreateMorningAuctionSnapshot(DATE)
    remote.resolve([auction()])
    const [a, b, c] = await Promise.all([one, two, three])
    expect(a.readiness?.source).toBe('dc')
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(a).not.toBe(b); expect(b).not.toBe(c)
    a.threeOne.allMarket[0].stockName = 'caller mutation'
    expect(service.getCachedMorningAuctionSnapshot(DATE)?.threeOne.allMarket[0].stockName).not.toBe('caller mutation')
    expect(h.route.mock.calls.every(call => call[3] === DATE)).toBe(true)
  })

  it('late previous-day response cannot replace a newer active date or publish a current opportunity', async () => {
    vi.setSystemTime(at('23:59:50', '2026-07-13')); h.enabled = true
    const remote = deferred<StkAuctionRow[]>()
    h.fetch.mockReturnValue(remote.promise)
    const late = service.refreshMorningAuctionSnapshot('20260713')
    await microtasks()
    vi.setSystemTime(at('00:00:05', '2026-07-14'))
    seed(auction({ tradeDate: '20260714' }))
    const active = await service.getOrCreateMorningAuctionSnapshot('20260714')
    remote.resolve([auction({ tradeDate: '20260713' })])
    const old = await late
    expect(old.readiness?.phase).toBe('historical')
    expect(service.getCachedMorningAuctionSnapshot('20260714')).toEqual(active)
    expect(service.getCachedMorningAuctionSnapshot('20260713')).toBeNull()
    expect(h.emit).not.toHaveBeenCalled(); expect(h.dismiss).not.toHaveBeenCalled()
  })

  it('caps simultaneous dates without creating a queue of historical requests', async () => {
    h.enabled = true
    const first = deferred<StkAuctionRow[]>(), second = deferred<StkAuctionRow[]>()
    h.fetch.mockImplementation((_token, date) => date === DATE ? first.promise : second.promise)
    const a = service.getOrCreateMorningAuctionSnapshot(DATE)
    const b = service.getOrCreateMorningAuctionSnapshot(PREV)
    await microtasks()
    const rejected = await service.getOrCreateMorningAuctionSnapshot('20260708')
    expect(rejected.readiness?.reasonCode).toBe('ENTRY_BUSY')
    expect(h.fetch).toHaveBeenCalledTimes(2)
    first.resolve([auction()]); second.resolve([auction({ tradeDate: PREV })])
    await Promise.all([a, b])
  })

  it('one concurrent fact change gets one local catch-up, with no repeated auction request', async () => {
    seed(auction())
    h.history.mockImplementationOnce(async () => { seed(auction({ price: 10.6 })); return new Map() })
    const snap = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(snap.threeOne.allMarket[0].auctionPrice).toBe(10.6)
    expect(h.history).toHaveBeenCalledTimes(1); expect(h.localHistory).toHaveBeenCalledTimes(1)
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.emit.mock.calls[0][1][0].reason.auctionPrice).toBe(10.6)
  })

  it('a second concurrent revision returns retryable non-ready evidence instead of looping or emitting', async () => {
    seed(auction())
    h.history.mockImplementationOnce(async () => { seed(auction({ price: 10.6 })); return new Map() })
    h.localHistory.mockImplementationOnce(async () => { seed(auction({ price: 10.7 })); return new Map() })
    const snap = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(snap.readiness).toMatchObject({ reasonCode: 'DATA_CHANGED_RETRY', retryable: true, phase: 'blocked' })
    expect(h.history).toHaveBeenCalledTimes(1); expect(h.localHistory).toHaveBeenCalledTimes(1)
    expect(h.emit).not.toHaveBeenCalled(); expect(service.getCachedMorningAuctionSnapshot(DATE)).toBeNull()
  })

  it('historical candidates retain date projection but never emit or dismiss, even one-word boards', async () => {
    seed(auction({ tradeDate: PREV, price: 11 }))
    h.closeRows.set(CODE, [{ tsCode: CODE, tradeDate: PREV, close: 12, pctChg: 20 }])
    h.signals.set(key(CODE, PREV), 'NEW')
    const snap = await service.getOrCreateMorningAuctionSnapshot(PREV)
    expect(snap.threeOne.allMarket[0]).toMatchObject({ currentPrice: 12, currentPctChg: 20 })
    expect(snap.readiness?.phase).toBe('historical')
    expect(h.route.mock.calls.every(call => call[3] === PREV)).toBe(true)
    expect(h.emit).not.toHaveBeenCalled(); expect(h.dismiss).not.toHaveBeenCalled()
    expect(h.signals.get(key(CODE, PREV))).toBe('NEW')
  })

  it('persistent keys in every lifecycle survive service reload; only a genuinely new candidate is emitted', async () => {
    const statuses = ['NEW', 'READ', 'WATCHING', 'DISMISSED', 'ARCHIVED']
    const rows = statuses.map((status, i) => {
      const row = auction({ tsCode: '60000' + (i + 1) + '.SH' })
      h.signals.set(key(row.tsCode), status)
      return row
    })
    seed(...rows)
    await service.getOrCreateMorningAuctionSnapshot(DATE)
    vi.resetModules()
    service = await import('../../electron/main/services/morningAuctionService')
    await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(h.emit).not.toHaveBeenCalled()
    seed(auction({ tsCode: '600099.SH' }))
    await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(h.emit).toHaveBeenCalledTimes(1)
    expect(h.emit.mock.calls[0][1].map((signal: { dedupKey: string }) => signal.dedupKey)).toEqual([key('600099.SH')])
    statuses.forEach((status, i) => expect(h.signals.get(key(rows[i].tsCode))).toBe(status))
  })

  it('real current one-word revision dismisses idempotently and cannot revive a persistent key', async () => {
    seed(auction()); await service.getOrCreateMorningAuctionSnapshot(DATE)
    seed(auction({ price: 11 }))
    await service.getOrCreateMorningAuctionSnapshot(DATE)
    await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(h.dismiss).toHaveBeenCalledTimes(1)
    expect(h.signals.get(key())).toBe('DISMISSED')
    seed(auction({ price: 10.5 }))
    await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(h.emit).toHaveBeenCalledTimes(1); expect(h.signals.get(key())).toBe('DISMISSED')
  })

  it('late concept enhancement cannot write or contaminate the new source/generation', async () => {
    seed(auction()); h.enabled = true; h.route.mockReturnValue([])
    const result = deferred<unknown[]>()
    h.concepts.mockReturnValue(result.promise)
    await service.getOrCreateMorningAuctionSnapshot(DATE)
    await microtasks()
    expect(h.concepts).toHaveBeenCalledTimes(1)
    h.source = 'dc'
    h.route.mockReturnValue([{ conceptCode: 'dc-fixture', conceptName: 'New source' }])
    await service.getOrCreateMorningAuctionSnapshot(DATE)
    result.resolve([{ name: 'Obsolete concept', hotNum: 1 }]); await microtasks()
    expect(h.insertConcepts).not.toHaveBeenCalled()
    expect(service.getCachedMorningAuctionSnapshot(DATE)?.threeOne.allMarket[0].conceptNames).toEqual(['New source'])
  })

  it('read-only cache detects changed dependencies without fetching, computing or emitting', async () => {
    seed(auction()); await service.getOrCreateMorningAuctionSnapshot(DATE)
    h.emit.mockClear(); h.route.mockClear()
    seed(auction({ amount: 7_000_000 }))
    expect(service.getCachedMorningAuctionSnapshot(DATE)).toBeNull()
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.emit).not.toHaveBeenCalled(); expect(h.route).not.toHaveBeenCalled()
  })

  it('the finite auction deadline reaches the transport signal, without an outer race', async () => {
    h.enabled = true
    let signal: AbortSignal | undefined
    h.fetch.mockImplementation((_token, _date, _code, options) => new Promise((_resolve, reject) => {
      signal = options.signal
      signal!.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'QUERY_CANCELLED' })), { once: true })
    }))
    const pending = service.refreshMorningAuctionSnapshot(DATE)
    await microtasks()
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(30_000)
    const snap = await pending
    expect(signal?.aborted).toBe(true)
    expect(snap.readiness?.lastAttempt?.reasonCode).toBe('TUSHARE_REQUEST_TIMEOUT')
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.emit).not.toHaveBeenCalled()
  })

  it('valid zero matches is distinct from absent data, and names or concepts cannot block allMarket', async () => {
    vi.setSystemTime(at('09:31:00'))
    seed(auction({ price: 10.2 }))
    h.route.mockImplementation(() => { throw new Error('optional concept missing') })
    const snap = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(snap.readiness?.auction.state).toBe('present')
    expect(snap.readiness?.pools['threeOne.allMarket']).toMatchObject({ state: 'no_match', reasonCode: 'NO_MATCH' })
    seed(auction({ price: 10.5 }))
    const qualified = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(qualified.threeOne.allMarket).toHaveLength(1)
    expect(qualified.threeOne.allMarket[0].conceptNames).toEqual([])
  })
  it.each(['09:15:00', '09:40:00'])('R-ENTRY-OBS: 09:31 mixed with %s stays partial, retaining both candidates and only the eligible signal', async clock => {
    vi.setSystemTime(at('09:31:00'))
    seed(auction(), auction({ tsCode: '600002.SH', fetchedAt: at(clock) }))
    const snap = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(snap.readiness?.auction).toMatchObject({ eligibleRows: 1, afterCutoffRows: 1, validRows: 2 })
    expect(snap.readiness?.phase).toBe('due_unconfirmed')
    expect(snap.readiness?.pools['threeOne.allMarket']).toMatchObject({
      state: 'partial', reasonCode: 'AUCTION_OBSERVATION_INCOMPLETE', candidates: 2,
    })
    expect(snap.threeOne.allMarket.map(stock => stock.tsCode).sort()).toEqual([CODE, '600002.SH'])
    expect(h.emit).toHaveBeenCalledTimes(1)
    expect(h.emit.mock.calls[0][1].map((signal: { dedupKey: string }) => signal.dedupKey)).toEqual([key()])
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it.each(['09:15:00', '09:40:00'])('mixed %s observation does not suppress 09:28 first publication or a later newly eligible key', async clock => {
    seed(auction(), auction({ tsCode: '600002.SH', fetchedAt: at(clock) }))
    const first = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(first.readiness?.phase).toBe('observed_provisional')
    expect(first.readiness?.pools['threeOne.allMarket']).toMatchObject({ state: 'partial', candidates: 2 })
    expect(h.emit.mock.calls[0][1].map((signal: { dedupKey: string }) => signal.dedupKey)).toEqual([key()])
    seed(auction({ tsCode: '600002.SH' }))
    await service.getOrCreateMorningAuctionSnapshot(DATE)
    await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(h.emit).toHaveBeenCalledTimes(2)
    expect(h.emit.mock.calls[1][1].map((signal: { dedupKey: string }) => signal.dedupKey)).toEqual([key('600002.SH')])
    expect(h.dismiss).not.toHaveBeenCalled()
  })

  const structuralPools: Array<[string, Partial<LimitListDailyRow>]> = [
    ['threeOne.firstBoard', {}],
    ['threeOne.secondBoard', { limitTimes: 2 }],
    ['threeOne.brokenBoard', { openTimes: 3 }],
    ['threeOne.brokenConsec', { limit: 'Z', limitTimes: 2 }],
    ['weakToStrong.badBoard', { openTimes: 3 }],
    ['weakToStrong.tailAttack', { firstTime: '14:35:00' }],
    ['weakToStrong.brokenBoard', { limit: 'Z', limitTimes: 2 }],
    ['weakToStrong.afternoonReseal', { openTimes: 1, lastTime: '13:35:00' }],
    ['weakToStrong.reversal', { limit: 'D' }],
    ['boardCategory.first', {}],
    ['boardCategory.second', { limitTimes: 2 }],
    ['boardCategory.third', { limitTimes: 3 }],
    ['boardCategory.n', { limitTimes: 4 }],
  ]
  it.each(structuralPools)('%s uses its actual structural observation dependency, not an unrelated fresh row', async (pool, patch) => {
    vi.setSystemTime(at('09:31:00'))
    seed(auction(), auction({ tsCode: '600002.SH', fetchedAt: at('09:15:00') }))
    h.limits.set(PREV, [limit({ ...patch, tsCode: '600002.SH' })])
    const partial = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(partial.readiness?.pools[pool]).toMatchObject({ state: 'partial', candidates: 1 })
    expect(h.emit.mock.calls[0][1].map((signal: { dedupKey: string }) => signal.dedupKey)).toEqual([key()])
    seed(auction({ tsCode: '600002.SH' }))
    const observed = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(observed.readiness?.pools[pool]).toMatchObject({ state: 'ready', candidates: 1 })
  })

  it('old or absent second-board inputs do not downgrade an independently observed first-board pool', async () => {
    vi.setSystemTime(at('09:31:00'))
    seed(auction(), auction({ tsCode: '600002.SH', fetchedAt: at('09:15:00') }))
    h.limits.set(PREV, [limit(), limit({ tsCode: '600002.SH', limitTimes: 2 })])
    const mixed = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(mixed.readiness?.phase).toBe('due_unconfirmed')
    for (const pool of ['threeOne.firstBoard', 'boardCategory.first']) {
      expect(mixed.readiness?.pools[pool]).toMatchObject({ state: 'ready', candidates: 1 })
    }
    for (const pool of ['threeOne.secondBoard', 'boardCategory.second']) {
      expect(mixed.readiness?.pools[pool]).toMatchObject({ state: 'partial', candidates: 1 })
    }
    h.auctions.set(DATE, [auction()])
    const missing = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(missing.readiness?.pools['threeOne.firstBoard'].state).toBe('ready')
    expect(missing.readiness?.pools['threeOne.secondBoard']).toMatchObject({ state: 'partial', candidates: 0 })
    expect(missing.readiness?.pools['threeOne.allMarket'].state).toBe('ready')
  })

  it('a stale evaluated row excluded by thresholds cannot produce a confirmed no-match pool', async () => {
    vi.setSystemTime(at('09:31:00'))
    seed(auction(), auction({ tsCode: '600002.SH', price: 10.05, fetchedAt: at('09:15:00') }))
    h.limits.set(PREV, [limit(), limit({ tsCode: '600002.SH', firstTime: '14:35:00' })])
    const stale = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(stale.readiness?.pools['weakToStrong.tailAttack']).toMatchObject({ state: 'partial', candidates: 0 })
    expect(stale.readiness?.pools['threeOne.allMarket']).toMatchObject({ state: 'partial', candidates: 1 })
    seed(auction({ tsCode: '600002.SH', price: 10.05 }))
    const observed = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(observed.readiness?.pools['weakToStrong.tailAttack']).toMatchObject({ state: 'no_match', candidates: 0 })
    expect(observed.readiness?.pools['threeOne.allMarket']).toMatchObject({ state: 'ready', candidates: 1 })
  })

  it('R-ENTRY-COOLDOWN: 0710 -> 0709 -> 0708 -> 0710 makes only three requests, even after snapshot eviction', async () => {
    h.enabled = true
    const startedMonotonic = performance.now()
    for (const date of [DATE, PREV, '20260708', DATE]) await service.refreshMorningAuctionSnapshot(date)
    expect(h.fetch.mock.calls.map(call => call[1])).toEqual([DATE, PREV, '20260708'])
    expect(service.getCachedMorningAuctionSnapshot(DATE)?.readiness?.lastAttempt).toMatchObject({
      startedAt: at('09:28:00'), outcome: 'empty', reasonCode: 'UPSTREAM_EMPTY',
    })
    await vi.advanceTimersByTimeAsync(59_999)
    expect(performance.now() - startedMonotonic).toBe(59_999)
    await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.fetch).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(performance.now() - startedMonotonic).toBe(60_000)
    await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.fetch.mock.calls.map(call => call[1])).toEqual([DATE, PREV, '20260708', DATE])
    expect(h.emit).not.toHaveBeenCalled(); expect(h.dismiss).not.toHaveBeenCalled()
  })

  it('bounded cooldown capacity rejects new requests without evicting live gates or blocking local facts', async () => {
    const { MAX_AUCTION_COOLDOWNS } = await import('../../electron/main/services/morningAuctionEntryPolicy')
    expect(MAX_AUCTION_COOLDOWNS).toBe(32)
    h.enabled = true
    const startedMonotonic = performance.now()
    const dates = Array.from({ length: MAX_AUCTION_COOLDOWNS + 2 }, (_, i) =>
      new Date(Date.UTC(2026, 6, 10) - i * 86_400_000).toISOString().slice(0, 10).replaceAll('-', ''))
    for (const date of dates) h.calendar.set(date, { isOpen: 1 })
    for (const date of dates.slice(0, MAX_AUCTION_COOLDOWNS)) await service.refreshMorningAuctionSnapshot(date)
    const rejectedDate = dates[MAX_AUCTION_COOLDOWNS]
    const rejected = await service.refreshMorningAuctionSnapshot(rejectedDate)
    expect(rejected.readiness).toMatchObject({
      retryable: true, lastAttempt: { outcome: 'blocked', reasonCode: 'AUCTION_REQUEST_CAPACITY' },
    })
    expect(h.fetch).toHaveBeenCalledTimes(MAX_AUCTION_COOLDOWNS)
    await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.fetch.mock.calls.filter(call => call[1] === DATE)).toHaveLength(1)
    seed(auction())
    const local = await service.getOrCreateMorningAuctionSnapshot(DATE)
    expect(local.threeOne.allMarket).toHaveLength(1)
    expect(h.emit).toHaveBeenCalledTimes(1)
    // A wall-clock jump does not release any of the 32 live gates.
    vi.setSystemTime(at('09:29:01'))
    expect(performance.now() - startedMonotonic).toBe(0)
    const jumped = await service.refreshMorningAuctionSnapshot(rejectedDate)
    expect(jumped.readiness?.lastAttempt?.reasonCode).toBe('AUCTION_REQUEST_CAPACITY')
    expect(h.fetch).toHaveBeenCalledTimes(MAX_AUCTION_COOLDOWNS)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(performance.now() - startedMonotonic).toBe(59_999)
    await service.refreshMorningAuctionSnapshot(rejectedDate)
    expect(h.fetch).toHaveBeenCalledTimes(MAX_AUCTION_COOLDOWNS)
    // Roll the wall clock back too: elapsed expiry must still reclaim capacity.
    vi.setSystemTime(at('09:28:00'))
    expect(performance.now() - startedMonotonic).toBe(59_999)
    await vi.advanceTimersByTimeAsync(1)
    expect(performance.now() - startedMonotonic).toBe(60_000)
    const admitted = await service.refreshMorningAuctionSnapshot(rejectedDate)
    expect(h.fetch).toHaveBeenCalledTimes(MAX_AUCTION_COOLDOWNS + 1)
    expect(admitted.readiness?.lastAttempt?.reasonCode).toBe('UPSTREAM_EMPTY')
  })


  it('a 61-second forward wall-clock jump cannot expire the gate without 60 seconds of monotonic elapsed time', async () => {
    vi.setSystemTime(at('09:40:00'))
    h.enabled = true
    const startedMonotonic = performance.now()
    const first = await service.refreshMorningAuctionSnapshot(DATE)
    expect(first.readiness?.lastAttempt).toMatchObject({ startedAt: at('09:40:00'), endedAt: at('09:40:00') })
    vi.setSystemTime(at('09:41:01'))
    expect(performance.now() - startedMonotonic).toBe(0)
    const jumped = await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(jumped.readiness?.lastAttempt).toEqual(first.readiness?.lastAttempt)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(performance.now() - startedMonotonic).toBe(59_999)
    await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(performance.now() - startedMonotonic).toBe(60_000)
    const retried = await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(retried.readiness?.lastAttempt).toMatchObject({ startedAt: Date.now(), endedAt: Date.now() })
    expect(h.emit).not.toHaveBeenCalled(); expect(h.dismiss).not.toHaveBeenCalled()
  })

  it('a backward wall-clock jump cannot extend the gate past 60 monotonic seconds; audit timestamps remain wall-clock facts', async () => {
    vi.setSystemTime(at('09:40:00'))
    h.enabled = true
    const startedMonotonic = performance.now()
    const first = await service.refreshMorningAuctionSnapshot(DATE)
    await vi.advanceTimersByTimeAsync(60_000)
    vi.setSystemTime(at('09:35:00'))
    expect(performance.now() - startedMonotonic).toBe(60_000)
    const retried = await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(first.readiness?.lastAttempt).toMatchObject({ startedAt: at('09:40:00'), endedAt: at('09:40:00') })
    expect(retried.readiness?.lastAttempt).toMatchObject({ startedAt: at('09:35:00'), endedAt: at('09:35:00') })
    // The new gate gets its own elapsed origin, independent of the earlier audit timestamp.
    await vi.advanceTimersByTimeAsync(59_999)
    expect(performance.now() - startedMonotonic).toBe(119_999)
    await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(performance.now() - startedMonotonic).toBe(120_000)
    await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.fetch).toHaveBeenCalledTimes(3)
    expect(h.emit).not.toHaveBeenCalled(); expect(h.dismiss).not.toHaveBeenCalled()
  })

  it('failed request cooldown survives snapshot eviction and source changes', async () => {
    h.enabled = true
    h.fetch.mockRejectedValue(Object.assign(new Error('offline quota'), { code: 'TUSHARE_QUOTA_INSUFFICIENT' }))
    for (const date of [DATE, PREV, '20260708']) await service.refreshMorningAuctionSnapshot(date)
    h.source = 'dc'
    const retry = await service.refreshMorningAuctionSnapshot(DATE)
    expect(h.fetch).toHaveBeenCalledTimes(3)
    expect(retry.readiness?.lastAttempt).toMatchObject({ outcome: 'failed', reasonCode: 'TUSHARE_QUOTA_INSUFFICIENT' })
    expect(retry.readiness?.source).toBe('dc')
  })

  it('a superseded in-flight generation retains its request gate even when no snapshot was published', async () => {
    h.enabled = true
    const older = deferred<StkAuctionRow[]>()
    h.fetch.mockImplementation((_token, date) => date === PREV ? older.promise : Promise.resolve([]))
    const pending = service.refreshMorningAuctionSnapshot(PREV)
    await microtasks()
    await service.refreshMorningAuctionSnapshot(DATE)
    older.resolve([])
    await pending
    expect(service.getCachedMorningAuctionSnapshot(PREV)).toBeNull()
    await service.refreshMorningAuctionSnapshot(PREV)
    expect(h.fetch.mock.calls.map(call => call[1])).toEqual([PREV, DATE])
    expect(h.emit).not.toHaveBeenCalled(); expect(h.dismiss).not.toHaveBeenCalled()
  })

})
