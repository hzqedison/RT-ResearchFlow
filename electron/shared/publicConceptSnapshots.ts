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

export interface CurrentPublicConceptMembership {
  conceptCode: string
  conceptName: string
  tsCode: string
  stockName: string
  source: 'eastmoney_public' | 'sina_public'
  observedAt: number
  age: 'within-24h' | 'older-than-24h'
}

export interface CurrentPublicConceptLookup {
  query: string
  state: 'available' | 'not-cached' | 'cache-missing'
  checkedAt: number
  dateBasis: 'current-observation'
  historicalCoverage: false
  rows: CurrentPublicConceptMembership[]
  truncated: boolean
  discardedBoards: number
}

export type CurrentPublicConceptLookupReply =
  | { ok: true; data: CurrentPublicConceptLookup }
  | { ok: false; code: 'INVALID_STOCK_QUERY' | 'PUBLIC_CONCEPT_CACHE_UNAVAILABLE'; message: string; action: string; retryable: boolean; correlationId: string }

// No trade-date parameter: an observation cannot answer a historical query.
export function parseCurrentPublicConceptQuery(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const fields = Object.keys(input)
  if (fields.length !== 1 || fields[0] !== 'tsCode') return null
  const value = (input as Record<string, unknown>).tsCode
  if (typeof value !== 'string' || value.length > 20) return null
  const code = value.trim().toUpperCase()
  return /^\d{6}(?:\.(?:SH|SZ|BJ))?$/.test(code) ? code : null
}
