import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { getHistoricalDailyProgress } from '../../electron/main/services/historicalDailyProgressService'

function fixture(status = 'running') {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE public_market_sync_jobs (
      job_key TEXT, status TEXT, total_items INTEGER, processed_items INTEGER,
      written_rows INTEGER, current_item TEXT, message TEXT, started_at INTEGER,
      completed_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE public_market_request_global_state (
      id INTEGER, next_allowed_at INTEGER, batch_blocked_until INTEGER
    );
    INSERT INTO public_market_request_global_state VALUES (1, 0, 0);
  `)
  db.prepare('INSERT INTO public_market_sync_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('historical_daily_public', status, 5571, 1541, 732735, '600000.SH', 'secret upstream text', 1000, null, 2000)
  return db
}

describe('historical daily progress snapshot', () => {
  it('is a read-only lightweight snapshot and does not expose stored messages', () => {
    const db = fixture()
    try {
      const changes = db.prepare('SELECT total_changes() AS count').get()
      const result = getHistoricalDailyProgress(db, true, 3000)
      expect(result).toMatchObject({ status: 'running', totalItems: 5571, processedItems: 1541, writtenRows: 732735, currentItem: '600000.SH', stale: false })
      expect(JSON.stringify(result)).not.toContain('secret')
      expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(changes)
    } finally { db.close() }
  })

  it('distinguishes a persisted running record from an actual active worker', () => {
    const db = fixture()
    try { expect(getHistoricalDailyProgress(db, false, 3000).status).toBe('interrupted') }
    finally { db.close() }
  })

  it('shows a scheduled batch wait without declaring the task stalled', () => {
    const db = fixture()
    try {
      db.exec('UPDATE public_market_request_global_state SET batch_blocked_until = 200000')
      expect(getHistoricalDailyProgress(db, true, 100000)).toMatchObject({ status: 'waiting', resumeAt: 200000, stale: false })
      expect(getHistoricalDailyProgress(db, true, 200001)).toMatchObject({ status: 'running', resumeAt: null, stale: true })
    } finally { db.close() }
  })

  it.each(['success', 'partial', 'failed', 'cooldown', 'idle'])('preserves %s without promising automatic recovery', status => {
    const db = fixture(status)
    try { expect(getHistoricalDailyProgress(db, false, 200000)).toMatchObject({ status, stale: false, resumeAt: null }) }
    finally { db.close() }
  })

  it('tolerates an old database and an empty job table', () => {
    const db = new Database(':memory:')
    try { expect(getHistoricalDailyProgress(db, false, 3000)).toMatchObject({ status: 'idle', updatedAt: null }) }
    finally { db.close() }
    const empty = fixture()
    try {
      empty.exec('DELETE FROM public_market_sync_jobs')
      expect(getHistoricalDailyProgress(empty, false, 3000).status).toBe('idle')
    } finally { empty.close() }
  })

  it('filters non-stock text in the persisted current item', () => {
    const db = fixture()
    try {
      db.exec("UPDATE public_market_sync_jobs SET current_item = 'https://example.invalid/?key=secret'")
      expect(getHistoricalDailyProgress(db, true, 3000).currentItem).toBeNull()
    } finally { db.close() }
  })

  it('shows preparation when the worker is acquiring the initial stock universe', () => {
    const db = fixture('success')
    try {
      expect(getHistoricalDailyProgress(db, true, 3000)).toMatchObject({ status: 'preparing', totalItems: 0, updatedAt: null })
      db.exec('DELETE FROM public_market_sync_jobs')
      expect(getHistoricalDailyProgress(db, true, 3000).status).toBe('preparing')
    } finally { db.close() }
  })
})
