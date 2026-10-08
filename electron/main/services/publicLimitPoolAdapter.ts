import type { MultiSourcePreference, PublicLimitPoolFilterField, PublicLimitPoolMetadata } from '../../shared/dataSourceTypes'
import { validNativeDate } from '../../shared/macThsNativeProtocol'
import { normalizeMarketStockCode } from './multiSourceMarketService'
import { callPythonDataSource } from './pythonDataSourceBridge'

// AKShare's Eastmoney pool covers recent limit-up stocks, not historical
// completeness, auction trades, chip distribution, or broker order execution.
export interface PublicLimitUpFact {
  tradeDate: string
  tsCode: string
  name: string | null
  close: number
  pctChg: number | null
  amountYuan: number | null
  floatMvYuan: number | null
  totalMvYuan: number | null
  turnoverRatio: number | null
  fdAmountYuan: number | null
  firstTime: string | null
  lastTime: string | null
  openTimes: number | null
  upStat: string | null
  limitTimes: number | null
  industry: string | null
  source: 'akshare_eastmoney'
  missingFields?: string[]
  quality?: 'available' | 'partial'
}

export interface PublicLimitUpPoolResult extends PublicLimitPoolMetadata {
  tradeDate: string
  source: 'akshare_eastmoney'
  state: 'available' | 'partial' | 'unavailable'
  rows: PublicLimitUpFact[]
  rejectedRows: number
  missingFields: string[]
}

export function finitePublicLimitPoolNumber(value: unknown, minimum = -Infinity): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null
  const parsed = typeof value === 'number' ? value : Number(value.trim())
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : null
}

export function publicLimitPoolCount(value: unknown, minimum: number): number | null {
  const parsed = finitePublicLimitPoolNumber(value, minimum)
  return parsed !== null && Number.isInteger(parsed) ? parsed : null
}

export function isValidPublicLimitPoolDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{8}$/.test(value) && Number(value.slice(0, 4)) > 0 &&
    validNativeDate(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`)
}

export function publicLimitPoolMissingFields(row: object): string[] {
  return Object.entries(row).filter(([, value]) => value === null).map(([field]) => field).sort()
}

const filterFields: PublicLimitPoolFilterField[] = ['pctChg', 'fdAmountYuan', 'firstTime', 'openTimes', 'limitTimes']

export function publicLimitPoolFilterMissingFields(row: object): PublicLimitPoolFilterField[] {
  return publicLimitPoolMissingFields(row).filter((field): field is PublicLimitPoolFilterField =>
    filterFields.includes(field as PublicLimitPoolFilterField))
}

export function publicLimitPoolRowmissingFields(rows: Array<{ tsCode: string }>): Record<string, PublicLimitPoolFilterField[]> {
  return Object.fromEntries(rows.map(row => [row.tsCode,
    filterFields.filter(field => publicLimitPoolMissingFields(row).includes(field)),
  ]))
}

function optionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

export function publicLimitPoolSealTime(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const raw = typeof value === 'string' ? value.trim() : String(value)
  const compact = /^\d{1,6}$/.test(raw) ? raw.padStart(6, '0') :
    /^\d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replaceAll(':', '') : ''
  if (!/^\d{6}$/.test(compact)) return null
  const hour = Number(compact.slice(0, 2))
  const minute = Number(compact.slice(2, 4))
  const second = Number(compact.slice(4, 6))
  if (hour > 23 || minute > 59 || second > 59) return null
  return `${compact.slice(0, 2)}:${compact.slice(2, 4)}:${compact.slice(4, 6)}`
}

export function normalizePublicLimitUpPool(tradeDate: string, input: unknown): PublicLimitUpPoolResult {
  if (!isValidPublicLimitPoolDate(tradeDate)) throw new Error('INVALID_TRADE_DATE')
  if (!Array.isArray(input)) throw new Error('INVALID_LIMIT_POOL_RESPONSE')

  const rows: PublicLimitUpFact[] = []
  const seen = new Set<string>()
  const missing = new Set<string>()
  let rejectedRows = 0
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      rejectedRows++
      continue
    }
    const raw = item as Record<string, unknown>
    let tsCode: string
    try {
      if (typeof raw['代码'] !== 'string') throw new Error('INVALID_STOCK_CODE')
      tsCode = normalizeMarketStockCode(raw['代码']).tsCode
      const explicitSuffix = raw['代码'].trim().match(/\.(SH|SZ|BJ)$/i)?.[0].toUpperCase()
      if (explicitSuffix && !tsCode.endsWith(explicitSuffix)) throw new Error('INVALID_STOCK_CODE')
    } catch {
      rejectedRows++
      continue
    }
    const close = finitePublicLimitPoolNumber(raw['最新价'], 0.001)
    if (close === null || seen.has(tsCode)) {
      rejectedRows++
      continue
    }
    seen.add(tsCode)
    const row: PublicLimitUpFact = {
      tradeDate,
      tsCode,
      name: optionalText(raw['名称']),
      close,
      pctChg: finitePublicLimitPoolNumber(raw['涨跌幅']),
      amountYuan: finitePublicLimitPoolNumber(raw['成交额'], 0),
      floatMvYuan: finitePublicLimitPoolNumber(raw['流通市值'], 0),
      totalMvYuan: finitePublicLimitPoolNumber(raw['总市值'], 0),
      turnoverRatio: finitePublicLimitPoolNumber(raw['换手率'], 0),
      fdAmountYuan: finitePublicLimitPoolNumber(raw['封板资金'], 0),
      firstTime: publicLimitPoolSealTime(raw['首次封板时间']),
      lastTime: publicLimitPoolSealTime(raw['最后封板时间']),
      openTimes: publicLimitPoolCount(raw['炸板次数'], 0),
      upStat: optionalText(raw['涨停统计']),
      limitTimes: publicLimitPoolCount(raw['连板数'], 1),
      industry: optionalText(raw['所属行业']),
      source: 'akshare_eastmoney',
    }
    row.missingFields = publicLimitPoolMissingFields(row)
    row.quality = row.missingFields.length > 0 ? 'partial' : 'available'
    row.missingFields.forEach(field => missing.add(field))
    rows.push(row)
  }
  return {
    tradeDate,
    source: 'akshare_eastmoney',
    state: rows.length === 0 ? 'unavailable' : rejectedRows > 0 || missing.size > 0 ? 'partial' : 'available',
    rows,
    rejectedRows,
    missingFields: [...missing].sort(),
    verifiedAt: null,
    dateBasis: 'request-only',
    rowmissingFields: publicLimitPoolRowmissingFields(rows),
  }
}

export async function fetchPublicLimitUpPool(
  config: MultiSourcePreference,
  tradeDate: string,
): Promise<PublicLimitUpPoolResult> {
  if (!isValidPublicLimitPoolDate(tradeDate)) throw new Error('INVALID_TRADE_DATE')
  const raw = await callPythonDataSource(config, { operation: 'akshare-limit-pool', tradeDate })
  return normalizePublicLimitUpPool(tradeDate, raw)
}
