import type Database from 'better-sqlite3'
import type { HistoricalDailyProgressSnapshot } from '../../shared/historicalDailyProgress'
import { getPublicMarketSyncJob } from '../database/publicMarketDataRepository'

// Lightweight, read-only polling: never run a health scan, start a task, or contact a provider.
export function getHistoricalDailyProgress(
  db: Database.Database,
  workerActive: boolean,
  now = Date.now(),
): HistoricalDailyProgressSnapshot {
  const snapshot: HistoricalDailyProgressSnapshot = {
    status: workerActive ? 'preparing' : 'idle', totalItems: 0, processedItems: 0, writtenRows: 0,
    currentItem: null, startedAt: null, completedAt: null, updatedAt: null,
    checkedAt: now, resumeAt: null, stale: false,
  }
  const tableExists = (name: string): boolean => Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name))
  if (!tableExists('public_market_sync_jobs')) return snapshot
  const job = getPublicMarketSyncJob(db, 'historical_daily_public')
  if (!job) return snapshot
  if (workerActive && job.status !== 'running') return snapshot
  snapshot.status = job.status
  snapshot.totalItems = job.totalItems
  snapshot.processedItems = job.processedItems
  snapshot.writtenRows = job.writtenRows
  // Do not surface arbitrary stored text, upstream errors, or URLs to the renderer.
  snapshot.currentItem = job.currentItem && /^\d{6}\.(SH|SZ|BJ)$/.test(job.currentItem) ? job.currentItem : null
  snapshot.startedAt = job.startedAt
  snapshot.completedAt = job.completedAt
  snapshot.updatedAt = job.updatedAt
  if (job.status === 'running') {
    if (!workerActive) {
      snapshot.status = 'interrupted'
      return snapshot
    }
    if (tableExists('public_market_request_global_state')) {
      const state = db.prepare(`
        SELECT next_allowed_at, batch_blocked_until
        FROM public_market_request_global_state WHERE id = 1
      `).get() as { next_allowed_at: number; batch_blocked_until: number } | undefined
      const resumeAt = Math.max(state?.next_allowed_at ?? 0, state?.batch_blocked_until ?? 0)
      // Normal per-request pacing is not a visible pause; batch cooldown is.
      if (resumeAt > now + 1_000) {
        snapshot.status = 'waiting'
        snapshot.resumeAt = resumeAt
      }
    }
    snapshot.stale = snapshot.status === 'running' && now - job.updatedAt > 90_000
  }
  return snapshot
}
