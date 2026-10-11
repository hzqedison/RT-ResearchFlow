export interface PublicConceptSyncFailure {
  conceptCode: string
  conceptName: string
  reason: 'SOURCE_COUNT_MISMATCH' | 'UPSTREAM_EMPTY' | 'UPSTREAM_FAILED' | 'FACT_INVALID' | 'BOARD_REQUEST_OR_WRITE_FAILED'
  countMismatch?: {
    reportedTotal: number
    expectedPageRows: number
    receivedPageRows: number
    page: number
  }
}

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
  failures?: PublicConceptSyncFailure[]
  historicalCoverage: false
}
export type PublicConceptSyncReply = { ok: true; status: PublicConceptSyncStatus } | { ok: false; error: string }
