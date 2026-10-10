export interface PublicConceptSyncStatus {
  state: 'idle' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
  attemptedBoards: number
  totalBoards: number
  savedBoards: number
  failedBoards: number
  cachedBoards: number
  cachedMembers: number
  latestObservedAt: number | null
  reason: string | null
  historicalCoverage: false
}
export type PublicConceptSyncReply = { ok: true; status: PublicConceptSyncStatus } | { ok: false; error: string }
