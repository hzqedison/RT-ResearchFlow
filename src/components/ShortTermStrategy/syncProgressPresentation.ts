export interface SyncProgressPresentation {
  current: number
  total: number | null
  percent: number | null
}

export function syncProgressPresentation(current: number, total: number): SyncProgressPresentation {
  const validCurrent = Number.isFinite(current)
  const count = validCurrent ? Math.max(0, Math.floor(current)) : 0
  const limit = Number.isFinite(total) ? Math.floor(total) : 0
  if (!validCurrent || limit <= 0) {
    return { current: count, total: null, percent: null }
  }
  const boundedCount = Math.min(count, limit)
  return {
    current: boundedCount,
    total: limit,
    percent: Math.round(boundedCount / limit * 100),
  }
}
