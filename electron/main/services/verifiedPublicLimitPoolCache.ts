import type Database from 'better-sqlite3'
import type { MultiSourcePreference, PublicLimitPoolMetadata, PublicLimitPoolObservationRow, PublicLimitPoolObservationSnapshot } from '../../shared/dataSourceTypes'
import {
  fetchPublicLimitUpPool, finitePublicLimitPoolNumber, isValidPublicLimitPoolDate,
  publicLimitPoolCount, publicLimitPoolFilterMissingFields, publicLimitPoolMissingFields, publicLimitPoolRowmissingFields, publicLimitPoolSealTime,
  type PublicLimitUpPoolResult,
} from './publicLimitPoolAdapter'

export interface PublicLimitPoolCacheResult extends PublicLimitPoolMetadata {
  ok: boolean
  tradeDate: string
  rows: number
  quality: 'available' | 'partial' | 'blocked'
  message: string
}

// This cache is deliberately separate from limit_list_daily: AKShare supplies
// recent limit-up rows only, not Tushare's up/down/failed-board universe.
export async function syncVerifiedPublicLimitPool(
  db: Database.Database,
  config: MultiSourcePreference,
  tradeDate: string,
): Promise<PublicLimitPoolCacheResult> {
  const blocked = (message: string): PublicLimitPoolCacheResult => ({
    ok: false, tradeDate, rows: 0, quality: 'blocked', message,
    verifiedAt: null, dateBasis: 'unknown', rowmissingFields: {},
  })
  if (!isValidPublicLimitPoolDate(tradeDate)) return blocked('请选择有效的交易日期。')
  if (!config.dailyProviders.includes('akshare')) return blocked('请先选择 AKShare 并安装所选本地扩展。')

  const calendar = db.prepare('SELECT is_open FROM trade_cal WHERE cal_date = ?')
    .get(tradeDate) as { is_open: number } | undefined
  if (calendar?.is_open !== 1) return blocked('本地交易日历未确认该日期为交易日，未写入。')

  const dailyRows = db.prepare('SELECT ts_code, close FROM daily_close_cache WHERE trade_date = ?')
    .all(tradeDate) as Array<{ ts_code: string; close: number | null }>
  if (dailyRows.length < 4000) return blocked('该日全市场收盘日线尚未齐备，无法核对公开涨停池日期。')
  const dailyClose = new Map(dailyRows.map(row => [row.ts_code, row.close]))

  let snapshot: PublicLimitUpPoolResult
  try {
    snapshot = await fetchPublicLimitUpPool(config, tradeDate)
  } catch {
    return blocked('公开源未返回有效涨停事实，原缓存保持不变，未写入。')
  }
  if (snapshot.state === 'unavailable' || snapshot.rows.length === 0) {
    return blocked('公开源没有返回可核验的涨停池；这不代表当天没有涨停股票。')
  }
  const matchedRows = snapshot.rows.filter(row => {
    const close = dailyClose.get(row.tsCode)
    return row.tradeDate === tradeDate && row.source === 'akshare_eastmoney' &&
      typeof close === 'number' && Number.isFinite(close) && close > 0 &&
      Number.isFinite(row.close) && row.close > 0 &&
      Math.abs(close - row.close) <= Math.max(0.011, close * 0.001)
  })
  if (matchedRows.length / snapshot.rows.length < 0.98) {
    return blocked(`公开源与本地日线收盘价仅 ${matchedRows.length}/${snapshot.rows.length} 条匹配，疑似日期或数据不一致，未写入。`)
  }

  const quality = snapshot.state === 'partial' || snapshot.rejectedRows > 0 || snapshot.missingFields.length > 0 ||
    matchedRows.length < snapshot.rows.length || matchedRows.some(row => publicLimitPoolMissingFields(row).length > 0)
    ? 'partial' : 'available'
  const verifiedAt = Date.now()
  try {
    db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS public_limit_up_facts (
        trade_date TEXT NOT NULL,
        ts_code TEXT NOT NULL,
        source TEXT NOT NULL,
        name TEXT,
        close REAL NOT NULL,
        pct_chg REAL,
        amount_yuan REAL,
        float_mv_yuan REAL,
        total_mv_yuan REAL,
        turnover_ratio REAL,
        fd_amount_yuan REAL,
        first_time TEXT,
        last_time TEXT,
        open_times INTEGER,
        up_stat TEXT,
        limit_times INTEGER,
        industry TEXT,
        quality TEXT NOT NULL,
        verified_at INTEGER NOT NULL,
        PRIMARY KEY (trade_date, ts_code, source)
      )
    `)
    const insert = db.prepare(`
      INSERT INTO public_limit_up_facts (
        trade_date, ts_code, source, name, close, pct_chg, amount_yuan,
        float_mv_yuan, total_mv_yuan, turnover_ratio, fd_amount_yuan,
        first_time, last_time, open_times, up_stat, limit_times, industry,
        quality, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    db.prepare('DELETE FROM public_limit_up_facts WHERE trade_date = ? AND source = ?')
      .run(tradeDate, 'akshare_eastmoney')
    for (const row of matchedRows) {
      insert.run(
        row.tradeDate, row.tsCode, row.source, row.name, row.close, row.pctChg,
        row.amountYuan, row.floatMvYuan, row.totalMvYuan, row.turnoverRatio,
        row.fdAmountYuan, row.firstTime, row.lastTime, row.openTimes,
        row.upStat, row.limitTimes, row.industry,
        publicLimitPoolMissingFields(row).length > 0 ? 'partial' : 'available', verifiedAt,
      )
    }
    })()
  } catch {
    return blocked('独立研究缓存写入失败，原缓存保持不变，未写入。')
  }

  return {
    ok: true,
    tradeDate,
    rows: matchedRows.length,
    quality,
    verifiedAt,
    dateBasis: 'request-only',
    rowmissingFields: publicLimitPoolRowmissingFields(matchedRows),
    message: `已将 ${matchedRows.length} 条公开涨停事实保存为独立研究缓存（收盘价核对 ${matchedRows.length}/${snapshot.rows.length} 条，质量：${quality === 'available' ? '字段齐全' : '部分行被过滤、拒绝或字段缺失'}）；日期仅来自请求，价格匹配不证明源日期；尚未用于短线策略或交易。`,
  }
}

export type CachedPublicLimitUpRow = PublicLimitPoolObservationRow

export function readVerifiedPublicLimitPool(db: Database.Database): PublicLimitPoolObservationSnapshot {
  const empty: PublicLimitPoolObservationSnapshot = {
    tradeDate: null, source: 'akshare_eastmoney', rows: [],
    verifiedAt: null, dateBasis: 'unknown', rowmissingFields: {},
  }
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'public_limit_up_facts'").get()
  if (!exists) return empty
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll('-', '')
  const latest = db.prepare("SELECT MAX(trade_date) AS trade_date FROM public_limit_up_facts WHERE trade_date <= ? AND source = 'akshare_eastmoney'")
    .get(today) as { trade_date: string | null } | undefined
  const tradeDate = latest?.trade_date ?? null
  if (!tradeDate || !isValidPublicLimitPoolDate(tradeDate)) return empty
  const batch = db.prepare(`
    SELECT COUNT(*) AS rowCount, COUNT(verified_at) AS timeCount,
      MIN(verified_at) AS minTime, MAX(verified_at) AS maxTime
    FROM public_limit_up_facts WHERE trade_date = ? AND source = 'akshare_eastmoney'
  `).get(tradeDate) as { rowCount: number; timeCount: number; minTime: unknown; maxTime: unknown }
  const verifiedAt = batch.rowCount > 0 && batch.rowCount === batch.timeCount &&
    typeof batch.minTime === 'number' && Number.isSafeInteger(batch.minTime) && batch.minTime > 0 &&
    batch.minTime === batch.maxTime ? batch.minTime : null
  const rows = db.prepare(`
    SELECT ts_code AS tsCode, name, close, pct_chg AS pctChg,
      fd_amount_yuan AS fdAmountYuan, first_time AS firstTime,
      open_times AS openTimes, limit_times AS limitTimes, quality
    FROM public_limit_up_facts
    WHERE trade_date = ? AND source = 'akshare_eastmoney'
    ORDER BY limit_times DESC, first_time ASC, ts_code ASC
    LIMIT 2500
  `).all(tradeDate) as CachedPublicLimitUpRow[]
  for (const row of rows) {
    row.pctChg = finitePublicLimitPoolNumber(row.pctChg)
    row.fdAmountYuan = finitePublicLimitPoolNumber(row.fdAmountYuan, 0)
    row.firstTime = publicLimitPoolSealTime(row.firstTime)
    row.openTimes = publicLimitPoolCount(row.openTimes, 0)
    row.limitTimes = publicLimitPoolCount(row.limitTimes, 1)
    row.missingFields = publicLimitPoolFilterMissingFields(row)
    row.quality = row.missingFields.length > 0 ? 'partial' : 'available'
  }
  // No persisted date provenance or per-row price witness exists. Never infer
  // either from legacy quality/zeros, or replace stored time with Date.now().
  return {
    tradeDate, source: 'akshare_eastmoney', rows, verifiedAt,
    dateBasis: 'unknown', rowmissingFields: publicLimitPoolRowmissingFields(rows),
  }
}
