import type Database from 'better-sqlite3'
import type { PublicConceptSyncStatus } from '../../shared/publicConceptSnapshots'
import { fetchPublicConceptIndexWithFallback, fetchPublicConceptMembersWithFallback } from './publicSinaConceptSnapshotAdapter'

const statuses = new WeakMap<object, PublicConceptSyncStatus>()
const flights = new WeakMap<object, Promise<PublicConceptSyncStatus>>()
const controllers = new WeakMap<object, AbortController>()

function ensureCache(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS public_concept_snapshots (
    concept_code TEXT PRIMARY KEY, concept_name TEXT NOT NULL,
    observed_at INTEGER NOT NULL, member_count INTEGER NOT NULL,
    payload TEXT NOT NULL
  )`)
}

export function getPublicConceptSyncStatus(db: Database.Database): PublicConceptSyncStatus {
  ensureCache(db)
  const cache = db.prepare('SELECT COUNT(*) AS boards, COALESCE(SUM(member_count),0) AS members, MAX(observed_at) AS latestObservedAt FROM public_concept_snapshots').get() as {
    boards: number; members: number; latestObservedAt: number | null
  }
  return {
    state: 'idle', attemptedBoards: 0, totalBoards: 0, savedBoards: 0, failedBoards: 0,
    reason: null,
    historicalCoverage: false, ...statuses.get(db),
    cachedBoards: cache.boards, cachedMembers: cache.members, latestObservedAt: cache.latestObservedAt,
  }
}

export function cancelPublicConceptSync(db: Database.Database): PublicConceptSyncStatus {
  controllers.get(db)?.abort()
  return getPublicConceptSyncStatus(db)
}

export function syncPublicConceptSnapshots(db: Database.Database, dependencies = {
  index: fetchPublicConceptIndexWithFallback, members: fetchPublicConceptMembersWithFallback,
}): Promise<PublicConceptSyncStatus> {
  const active = flights.get(db)
  if (active) return active
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)])
  const status: PublicConceptSyncStatus = {
    ...getPublicConceptSyncStatus(db), state: 'running', attemptedBoards: 0,
    totalBoards: 0, savedBoards: 0, failedBoards: 0, reason: null,
  }
  statuses.set(db, status)
  controllers.set(db, controller)
  const job = Promise.resolve().then(async () => {
    try {
      const index = await dependencies.index({ signal })
      signal.throwIfAborted()
      if (index.state !== 'available' || !index.rows.length) throw new Error('UPSTREAM_EMPTY')
      status.totalBoards = index.rows.length
      let consecutiveFailures = 0
      const write = db.prepare('INSERT INTO public_concept_snapshots(concept_code, concept_name, observed_at, member_count, payload) VALUES(?,?,?,?,?) ON CONFLICT(concept_code) DO UPDATE SET concept_name=excluded.concept_name, observed_at=excluded.observed_at, member_count=excluded.member_count, payload=excluded.payload')
      for (const board of index.rows) {
        signal.throwIfAborted()
        try {
          const snapshot = await dependencies.members(board.code, { signal })
          signal.throwIfAborted()
          if (snapshot.state !== 'available' || !snapshot.rows.length || snapshot.historicalCoverage !== false || snapshot.dateBasis !== 'current-observation') throw new Error('UPSTREAM_EMPTY')
          // One atomic row replaces only this board's current observation.
          // No historical tables, strategy snapshots or other boards are cleared.
          write.run(board.code, board.name, snapshot.observedAt, snapshot.rows.length, JSON.stringify(snapshot))
          status.savedBoards++
          consecutiveFailures = 0
        } catch (error) {
          if (signal.aborted) throw error
          status.failedBoards++
          consecutiveFailures++
          status.reason = 'BOARD_REQUEST_OR_WRITE_FAILED'
        }
        status.attemptedBoards++
        if (consecutiveFailures >= 3) break
        if (status.attemptedBoards < status.totalBoards) {
          await new Promise<void>((resolve, reject) => {
            const done = () => { signal.removeEventListener('abort', abort); resolve() }
            const timer = setTimeout(done, 200)
            const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('QUERY_CANCELLED')) }
            signal.addEventListener('abort', abort, { once: true })
            if (signal.aborted) abort()
          })
        }
      }
      signal.throwIfAborted()
      status.state = status.savedBoards === status.totalBoards ? 'completed' : status.savedBoards > 0 ? 'partial' : 'failed'
    } catch (error) {
      status.state = signal.aborted ? 'cancelled' : status.savedBoards > 0 ? 'partial' : 'failed'
      status.reason = signal.aborted ? 'CANCELLED_OR_TIMEOUT' : error instanceof Error && error.message === 'UPSTREAM_EMPTY' ? 'UPSTREAM_EMPTY' : 'INDEX_REQUEST_FAILED'
    }
    return getPublicConceptSyncStatus(db)
  }).finally(() => { flights.delete(db); controllers.delete(db) })
  flights.set(db, job)
  return job
}
