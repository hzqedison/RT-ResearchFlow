import type { PublicLimitPoolObservationRow } from '../../../electron/shared/dataSourceTypes'
export type { PublicLimitPoolObservationRow, PublicLimitPoolObservationSnapshot } from '../../../electron/shared/dataSourceTypes'

export interface PublicLimitPoolFilters {
  minBoards: number | null
  maxOpens: number | null
}

function knownCount(value: number | null, minimum: number): value is number {
  return value !== null && Number.isInteger(value) && value >= minimum
}

type FilterResult = 'pass' | 'fail' | 'unknown'

function evaluateCountFilter(value: number | null, minimum: number, threshold: number | null, mode: 'min' | 'max'): FilterResult {
  if (threshold === null) return 'pass'
  if (!knownCount(value, minimum)) return 'unknown'
  const matches = mode === 'min' ? value >= threshold : value <= threshold
  return matches ? 'pass' : 'fail'
}

export function selectPublicLimitPoolRows(rows: PublicLimitPoolObservationRow[], filters: PublicLimitPoolFilters) {
  let excludedUnknown = 0
  const selected = rows.filter(row => {
    const boards = evaluateCountFilter(row.limitTimes, 1, filters.minBoards, 'min')
    const opens = evaluateCountFilter(row.openTimes, 0, filters.maxOpens, 'max')
    if (boards === 'fail' || opens === 'fail') return false
    if (boards === 'unknown' || opens === 'unknown') {
      excludedUnknown++
      return false
    }
    return true
  })
  return { rows: selected, excludedUnknown, total: rows.length }
}

export function formatPublicSealAmount(yuan: number | null): string {
  if (yuan === null || !Number.isFinite(yuan) || yuan < 0) return '待补'
  if (yuan >= 100_000_000) return `${(yuan / 100_000_000).toFixed(2)}亿`
  if (yuan >= 10_000) return `${(yuan / 10_000).toFixed(2)}万`
  return `${yuan.toLocaleString('zh-CN')}元`
}

// Legacy quality was a batch flag: judge the displayed row from its actual optional facts.
export function publicObservationMissingFields(row: PublicLimitPoolObservationRow): string[] {
  const fields: string[] = []
  if (row.pctChg === null || !Number.isFinite(row.pctChg)) fields.push('涨幅')
  if (row.fdAmountYuan === null || !Number.isFinite(row.fdAmountYuan) || row.fdAmountYuan < 0) fields.push('封板资金')
  if (!row.firstTime || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(row.firstTime)) fields.push('首次封板')
  if (!knownCount(row.openTimes, 0)) fields.push('炸板次数')
  if (!knownCount(row.limitTimes, 1)) fields.push('连板数')
  return fields
}
