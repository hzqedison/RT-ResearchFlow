import type Database from 'better-sqlite3'
import { getDataSourceConfig, getMultiSourcePreference } from '../database/dataSourceRepository'
import { getCachedPrices, getStockInfo, insertPrices, upsertStockInfo } from '../database/stockPriceCacheRepository'
import { upsertDailyClose } from '../database/dailyCloseCacheRepository'
import { decryptApiKey } from '../utils/apiKeyEncryption'
import type { DailyDataProvider } from '../../shared/dataSourceTypes'
import type { StockPriceCacheRow } from '../database/types'
import { callPythonDataSource } from './pythonDataSourceBridge'
import {
  ensureTrendBenchmarkFreshness,
  fetchEastmoneySingleStockDaily,
  forceFetchSingleStock,
  type DailyRow,
} from './tushareService'
import { inspectTrendBenchmarkHealth } from './trendBenchmarkFreshness'
import { fetchPublicDailyHistoryForCode } from './publicHistoricalDailySyncService'

export function normalizeMarketStockCode(input: string): { stockCode: string; tsCode: string } {
  const code = String(input).trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
  if (!/^[034689]\d{5}$/.test(code)) throw new Error('INVALID_STOCK_CODE')
  return { stockCode: code, tsCode: code + (code.startsWith('6') ? '.SH' : /^[489]/.test(code) ? '.BJ' : '.SZ') }
}

export function latestClosedCalendarDate(now = Date.now()): string {
  const date = new Date(now + 8 * 60 * 60 * 1000)
  if (date.getUTCHours() * 60 + date.getUTCMinutes() < 15 * 60 + 5) date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10).replaceAll('-', '')
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '' || value === '--') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeBridgeDailyRows(provider: 'tdx' | 'akshare', tsCode: string, input: unknown, maxDate: string): DailyRow[] {
  if (!Array.isArray(input)) return []
  const raw = input.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map(row => ({ row, date: String(row['日期'] ?? row.datetime ?? row.date ?? '').slice(0, 10).replaceAll('-', '') }))
    .filter(item => /^\d{8}$/.test(item.date) && item.date <= maxDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  let previousClose: number | null = null
  const normalized: DailyRow[] = []
  for (const { row, date } of raw) {
    const open = numberOrNull(row['开盘'] ?? row.open)
    const high = numberOrNull(row['最高'] ?? row.high)
    const low = numberOrNull(row['最低'] ?? row.low)
    const close = numberOrNull(row['收盘'] ?? row.close)
    const vol = provider === 'akshare' ? numberOrNull(row['成交量']) : numberOrNull(row.vol) ?? (numberOrNull(row.volume) == null ? null : Number(row.volume) / 100)
    if (open == null || high == null || low == null || close == null || low <= 0 ||
      high < Math.max(open, close, low) || low > Math.min(open, close) || (vol != null && vol < 0)) continue
    const percent = numberOrNull(row['涨跌幅']) ?? (previousClose != null && previousClose > 0 ? (close / previousClose - 1) * 100 : null)
    previousClose = close
    if (percent == null) continue
    const amountYuan = numberOrNull(row['成交额'] ?? row.amount)
    normalized.push({
      tsCode, tradeDate: date, open, high, low, close, pctChg: percent, vol,
      amount: amountYuan == null || amountYuan < 0 ? null : amountYuan / 1000,
      turnoverRate: provider === 'akshare' ? numberOrNull(row['换手率']) : null,
    })
  }
  return [...new Map(normalized.map(row => [row.tradeDate, row])).values()].slice(-480)
}

function writeDailyRows(db: Database.Database, code: string, provider: DailyDataProvider, rows: DailyRow[]): void {
  const now = Date.now()
  const prices: StockPriceCacheRow[] = rows.map(row => ({
    stockCode: code, tradeDate: row.tradeDate, open: row.open, high: row.high, low: row.low, close: row.close,
    volume: row.vol, amount: row.amount ?? null, pctChg: row.pctChg, turnoverRate: row.turnoverRate, fetchedAt: now,
  }))
  db.transaction(() => {
    insertPrices(db, prices)
    upsertDailyClose(db, rows, { dataSource: provider, fetchedAt: now })
  })()
}

export async function fetchSelectedStockDaily(
  db: Database.Database,
  input: string,
  options: { onlyProvider?: DailyDataProvider; token?: string | null; benchmark?: boolean } = {},
) {
  const { stockCode, tsCode } = normalizeMarketStockCode(input)
  const config = getMultiSourcePreference(db)
  const providers = options.onlyProvider ? [options.onlyProvider] : config.dailyProviders
  const failures: string[] = []
  for (const provider of providers) {
    try {
      let rowsWritten = 0
      if (provider === 'tushare') {
        const legacy = getDataSourceConfig(db)
        const token = options.token ?? (legacy.tushareEnabled && legacy.tushareTokenEncrypted?.length
          ? decryptApiKey(legacy.tushareTokenEncrypted) : null)
        if (!token) throw new Error('Tushare 未配置 Token 或未启用')
        rowsWritten = await forceFetchSingleStock(db, token, stockCode)
      } else if (provider === 'eastmoney') {
        const result = await fetchEastmoneySingleStockDaily(db, stockCode)
        if (!result.ok) throw new Error(result.message)
        rowsWritten = result.rowsWritten
      } else {
        let rows: DailyRow[]
        if (provider === 'tencent' || provider === 'sina') {
          const result = await fetchPublicDailyHistoryForCode(db, tsCode, latestClosedCalendarDate(), { providers: [provider] })
          rows = result.rows
        } else {
          const data = await callPythonDataSource(config, {
            operation: provider === 'tdx' ? 'tdx-daily' : 'akshare-daily',
            stockCode, startDate: String(Number(latestClosedCalendarDate().slice(0, 4)) - 3) + '0101',
            endDate: latestClosedCalendarDate(),
          })
          rows = normalizeBridgeDailyRows(provider, tsCode, data, latestClosedCalendarDate())
        }
        if (rows.length === 0) throw new Error('未返回有效已收盘日线')
        writeDailyRows(db, stockCode, provider, rows)
        rowsWritten = rows.length
      }
      if (rowsWritten <= 0) throw new Error('未返回新的有效行情')
      if (provider === 'tencent' && !getStockInfo(db, stockCode)?.stockName) {
        try {
          const symbol = tsCode.slice(-2).toLowerCase() + stockCode
          const response = await fetch('https://qt.gtimg.cn/q=' + symbol, { signal: AbortSignal.timeout(8_000) })
          if (response.ok) {
            const text = new TextDecoder('gb18030').decode(await response.arrayBuffer())
            const parts = text.match(/="([^"]*)"/)?.[1].split('~')
            if (parts?.[2] === stockCode && parts[1]?.trim()) upsertStockInfo(db, stockCode, parts[1].trim())
          }
        } catch { /* Name metadata must not invalidate actual OHLC. */ }
      }
      const benchmark = options.benchmark === false ? inspectTrendBenchmarkHealth(db) : await ensureTrendBenchmarkFreshness(db)
      const cached = getCachedPrices(db, stockCode)
      const latestTradeDate = cached.at(-1)?.tradeDate ?? null
      return {
        stockCode, tsCode, stockName: getStockInfo(db, stockCode)?.stockName ?? stockCode,
        provider, latestTradeDate, rowsWritten, totalRows: cached.length, benchmark,
        dataState: cached.length >= 60 && benchmark.state === 'current' ? 'complete' as const : 'degraded' as const,
        message: `${provider} · 截至 ${latestTradeDate ?? '--'} · ${cached.length} 日`,
      }
    } catch (error) {
      // Do not retain upstream exception bodies that could contain a Token or Cookie.
      failures.push(provider + ': ' + (error instanceof Error && /^(Tushare 未|未返回)/.test(error.message) ? error.message : '连接、权限或接口不可用'))
    }
  }
  throw new Error(providers.length === 0 ? '请至少选择一个日线数据源' : '所选日线来源均未完成取数：' + failures.join('；'))
}
