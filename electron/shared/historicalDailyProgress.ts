export interface HistoricalDailyProgressSnapshot {
  status: 'idle' | 'preparing' | 'running' | 'waiting' | 'interrupted' | 'success' | 'partial' | 'failed' | 'cooldown'
  totalItems: number
  processedItems: number
  writtenRows: number
  currentItem: string | null
  startedAt: number | null
  completedAt: number | null
  updatedAt: number | null
  checkedAt: number
  resumeAt: number | null
  stale: boolean
}

export type HistoricalDailyProgressResult =
  | { ok: true; data: HistoricalDailyProgressSnapshot }
  | { ok: false; message: string }
