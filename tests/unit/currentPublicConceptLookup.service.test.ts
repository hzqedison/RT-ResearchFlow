import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { lookupCurrentPublicConcepts, queryCurrentPublicConcepts } from '../../electron/main/services/currentPublicConceptLookupService'
import { parseCurrentPublicConceptQuery } from '../../electron/shared/publicConceptSnapshots'

const NOW = 1_800_000_000_000
let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`CREATE TABLE public_concept_snapshots(concept_code TEXT PRIMARY KEY, concept_name TEXT NOT NULL, observed_at INTEGER NOT NULL, member_count INTEGER NOT NULL, payload TEXT NOT NULL)`)
})
afterEach(() => { db.close(); vi.restoreAllMocks() })
function add(code = 'BK1234', overrides: Record<string, unknown> = {}, members = [{ tsCode: '600000.SH', name: '测试股票', secret: 'NEVER_FORWARD' }]) {
  const value = { source: 'eastmoney_public', dateBasis: 'current-observation', observedAt: NOW - 1000, historicalCoverage: false, state: 'available', rows: members, token: 'NEVER_FORWARD', ...overrides }
  db.prepare('INSERT INTO public_concept_snapshots VALUES(?,?,?,?,?)').run(code, '测试题材', value.observedAt, members.length, JSON.stringify(value))
}
describe('current public concept input', () => {
  it.each(['600000', '600000.SH', ' 600000.sh ', '000001.SZ', '920001.BJ'])('accepts %s without exchange inference', code => {
    expect(parseCurrentPublicConceptQuery({ tsCode: code })).toBe(code.trim().toUpperCase())
  })
  it.each([null, [], {}, { tsCode: 600000 }, { tsCode: '600000;DROP TABLE x' }, { tsCode: '600000.HK' }, { tsCode: '600000', tradeDate: '2020-01-01' }, { tsCode: '600000', token: 'secret' }])('rejects invalid or historical query %j before accessing DB', input => {
    const getDb = vi.fn(() => db)
    const result = queryCurrentPublicConcepts(input, { getDb })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_STOCK_QUERY', retryable: false })
    expect(getDb).not.toHaveBeenCalled()
  })
})
describe('SQLite current public concept observations', () => {
  it('reads six-digit and exact-suffix membership, whitelists outputs and never writes or uses network', () => {
    add()
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NETWORK_MUST_NOT_RUN'))
    const before = db.serialize()
    const data = lookupCurrentPublicConcepts(db, '600000', NOW)
    expect(data).toMatchObject({ state: 'available', historicalCoverage: false, dateBasis: 'current-observation', rows: [{ conceptCode: 'BK1234', tsCode: '600000.SH', source: 'eastmoney_public', age: 'within-24h' }] })
    expect(JSON.stringify(data)).not.toContain('NEVER_FORWARD')
    expect(lookupCurrentPublicConcepts(db, '600000.SH', NOW).rows).toEqual(data.rows)
    expect(lookupCurrentPublicConcepts(db, '600000.SZ', NOW).state).toBe('not-cached')
    expect(db.serialize()).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('distinguishes missing cache from unobserved stock', () => {
    expect(lookupCurrentPublicConcepts(db, '000001', NOW).state).toBe('not-cached')
    db.exec('DROP TABLE public_concept_snapshots')
    expect(lookupCurrentPublicConcepts(db, '000001', NOW).state).toBe('cache-missing')
  })
  it('retains Sina provenance and warns on old observations without inventing a trade date', () => {
    add('SINA:gn_test', { source: 'sina_public', observedAt: NOW - 2 * 86400000 })
    expect(lookupCurrentPublicConcepts(db, '600000', NOW).rows[0]).toMatchObject({ source: 'sina_public', age: 'older-than-24h' })
    expect(lookupCurrentPublicConcepts(db, '600000', NOW)).not.toHaveProperty('tradeDate')
  })
  it.each([{ historicalCoverage: true }, { dateBasis: 'trade-date' }, { source: 'unknown' }, { state: 'empty' }, { observedAt: NOW + 1 }, { observedAt: 0 }])('discards contradictory observation %j', overrides => {
    add('BK1234', overrides)
    expect(lookupCurrentPublicConcepts(db, '600000', NOW)).toMatchObject({ state: 'not-cached', discardedBoards: 1 })
  })
  it('does not fail on malformed JSON, scalar members or inconsistent counts', () => {
    db.prepare('INSERT INTO public_concept_snapshots VALUES(?,?,?,?,?)').run('broken', 'bad', NOW, 1, '{not-json')
    db.prepare('INSERT INTO public_concept_snapshots VALUES(?,?,?,?,?)').run('scalar', 'bad', NOW, 1, JSON.stringify({ rows: ['text', null, 17] }))
    add()
    db.exec("UPDATE public_concept_snapshots SET member_count=99 WHERE concept_code='BK1234'")
    expect(lookupCurrentPublicConcepts(db, '600000', NOW)).toMatchObject({ state: 'not-cached', discardedBoards: 1 })
  })
  it('rejects duplicate stock membership and mismatched observed timestamps', () => {
    add('BK1234', {}, [{ tsCode: '600000.SH', name: 'a', secret: '' }, { tsCode: '600000.SH', name: 'b', secret: '' }])
    add('BK1235')
    db.exec("UPDATE public_concept_snapshots SET observed_at=1 WHERE concept_code='BK1235'")
    expect(lookupCurrentPublicConcepts(db, '600000', NOW)).toMatchObject({ state: 'not-cached', discardedBoards: 2 })
  })
  it('caps responses and discloses incomplete coverage', () => {
    for (let i = 0; i < 55; i++) add(`BK${1000 + i}`)
    const result = lookupCurrentPublicConcepts(db, '600000', NOW)
    expect(result.rows).toHaveLength(50)
    expect(result.truncated).toBe(true)
  })
  it('contains DB errors in a safe, correlated public reply', () => {
    const reply = queryCurrentPublicConcepts({ tsCode: '600000' }, { getDb: () => { throw new Error('secret /private/user/path') } })
    expect(reply).toMatchObject({ ok: false, code: 'PUBLIC_CONCEPT_CACHE_UNAVAILABLE', retryable: true })
    expect(JSON.stringify(reply)).not.toMatch(/secret|private\/user/)
    if (!reply.ok) expect(reply.correlationId).toMatch(/^[a-f\d-]{36}$/)
  })
})
