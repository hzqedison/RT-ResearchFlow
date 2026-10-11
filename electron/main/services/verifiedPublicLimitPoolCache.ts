import type Database from 'better-sqlite3'
import type { MultiSourcePreference, PublicLimitPoolMetadata, PublicLimitPoolObservationRow, PublicLimitPoolObservationSnapshot, PublicLimitPoolSource } from '../../shared/dataSourceTypes'
import { latestClosedCalendarDate } from './multiSourceMarketService'
import { recommendPublicLimitPoolDate } from './publicLimitPoolCalendarService'
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
  if (tradeDate > latestClosedCalendarDate()) return blocked('该日尚未完成收盘，未将盘中价格保存为盘后事实。')

  const calendar = db.prepare('SELECT is_open FROM trade_cal WHERE cal_date = ?')
    .get(tradeDate) as { is_open: number } | undefined
  if (calendar?.is_open !== 1) return blocked('本地交易日历未确认该日期为交易日，未写入。')

  const dailyRows = db.prepare('SELECT ts_code, close FROM daily_close_cache WHERE trade_date = ?')
    .all(tradeDate) as Array<{ ts_code: string; close: number | null }>
  const dailyClose = new Map(dailyRows.map(row => [row.ts_code, row.close]))

  let snapshot: PublicLimitUpPoolResult
  try {
    snapshot = await fetchPublicLimitUpPool(config, tradeDate)
  } catch {
    return blocked('公开源未返回有效涨停事实，原缓存保持不变，未写入。')
  }
  if (!snapshot || !Array.isArray(snapshot.rows) || snapshot.state === 'unavailable' || snapshot.rows.length === 0) {
    return blocked('公开源没有返回可核验的涨停池；这不代表当天没有涨停股票。')
  }
  const sourceDated = snapshot.source === 'eastmoney_public' && snapshot.dateBasis === 'source-reported' && snapshot.sourceReportedTradeDate === tradeDate
  if (snapshot.source !== 'akshare_eastmoney' && !sourceDated) return blocked('公开源日期或来源未通过校验，未写入。')
  if (!sourceDated && (!config.dailyProviders.includes('akshare') || dailyRows.length < 4000)) return blocked('旧版请求日期样本仍需要完整本地日线核对，未写入。')
  const matchedRows = snapshot.rows.filter(row => {
    const close = dailyClose.get(row.tsCode)
    return row.tradeDate === tradeDate && row.source === snapshot.source &&
      typeof close === 'number' && Number.isFinite(close) && close > 0 &&
      Number.isFinite(row.close) && row.close > 0 &&
      Math.abs(close - row.close) <= Math.max(0.011, close * 0.001)
  })
  const priceComplete = dailyRows.length >= 4000
  const witnessedRows = snapshot.rows.filter(row => dailyClose.has(row.tsCode))
  if ((priceComplete && matchedRows.length / snapshot.rows.length < 0.98) || (!priceComplete && matchedRows.length < witnessedRows.length)) {
    return blocked(`公开源与本地日线收盘价仅 ${matchedRows.length}/${snapshot.rows.length} 条匹配，疑似日期或数据不一致，未写入。`)
  }
  const writtenRows = sourceDated && !priceComplete ? snapshot.rows : matchedRows
  if (writtenRows.some(row => row.tradeDate !== tradeDate || row.source !== snapshot.source || !Number.isFinite(row.close) || row.close <= 0)) return blocked('公开源记录日期、来源或价格不一致，未写入。')

  const quality = snapshot.state === 'partial' || snapshot.rejectedRows > 0 || snapshot.missingFields.length > 0 ||
    !priceComplete || writtenRows.length < snapshot.rows.length || writtenRows.some(row => publicLimitPoolMissingFields(row).length > 0)
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
      .run(tradeDate, snapshot.source)
    for (const row of writtenRows) {
      insert.run(
        row.tradeDate, row.tsCode, row.source, row.name, row.close, row.pctChg,
        row.amountYuan, row.floatMvYuan, row.totalMvYuan, row.turnoverRatio,
        row.fdAmountYuan, row.firstTime, row.lastTime, row.openTimes,
        row.upStat, row.limitTimes, row.industry,
        publicLimitPoolMissingFields(row).length > 0 ? 'partial' : 'available', verifiedAt,
      )
    }
    if (sourceDated) {
      db.exec(`CREATE TABLE IF NOT EXISTS public_limit_up_batch_provenance (
        trade_date TEXT NOT NULL, source TEXT NOT NULL, source_trade_date TEXT NOT NULL,
        verified_at INTEGER NOT NULL, row_count INTEGER NOT NULL, price_check TEXT NOT NULL,
        PRIMARY KEY(trade_date, source)
      )`)
      db.prepare(`INSERT OR REPLACE INTO public_limit_up_batch_provenance
        (trade_date, source, source_trade_date, verified_at, row_count, price_check) VALUES(?,?,?,?,?,?)`)
        .run(tradeDate, snapshot.source, snapshot.sourceReportedTradeDate, verifiedAt, writtenRows.length, priceComplete ? 'matched-local-closes' : 'not-complete')
    }
    })()
  } catch {
    return blocked('独立研究缓存写入失败，原缓存保持不变，未写入。')
  }

  return {
    ok: true,
    tradeDate,
    rows: writtenRows.length,
    quality,
    verifiedAt,
    dateBasis: sourceDated ? 'source-reported' : 'request-only',
    priceCheck: priceComplete ? 'matched-local-closes' : 'not-complete',
    rowmissingFields: publicLimitPoolRowmissingFields(writtenRows),
    message: `已保存 ${writtenRows.length} 条独立公开涨停资料；${sourceDated ? `源站声明日期 ${tradeDate}` : '日期仅来自请求，价格匹配不证明源日期'}；${priceComplete ? `本地收盘价核对 ${matchedRows.length}/${snapshot.rows.length} 条` : '本地同日日线未完整核对'}。不代表全市场涨跌停、竞价或筹码齐备；未提交交易。`,
  }
}

export type CachedPublicLimitUpRow = PublicLimitPoolObservationRow

export function readVerifiedPublicLimitPool(db: Database.Database): PublicLimitPoolObservationSnapshot {
  const empty: PublicLimitPoolObservationSnapshot = {
    recommendedTradeDate: recommendPublicLimitPoolDate(db),
    tradeDate: null, source: 'akshare_eastmoney', rows: [],
    verifiedAt: null, dateBasis: 'unknown', rowmissingFields: {},
  }
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'public_limit_up_facts'").get()
  if (!exists) return empty
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll('-', '')
  const latest = db.prepare("SELECT trade_date, source FROM public_limit_up_facts WHERE trade_date <= ? AND source IN ('akshare_eastmoney','eastmoney_public') ORDER BY trade_date DESC, verified_at DESC LIMIT 1")
    .get(today) as { trade_date: string; source: PublicLimitPoolSource } | undefined
  const tradeDate = latest?.trade_date ?? null
  if (!tradeDate || !isValidPublicLimitPoolDate(tradeDate)) return empty
  const source = latest!.source
  const batch = db.prepare(`
    SELECT COUNT(*) AS rowCount, COUNT(verified_at) AS timeCount,
      MIN(verified_at) AS minTime, MAX(verified_at) AS maxTime
    FROM public_limit_up_facts WHERE trade_date = ? AND source = ?
  `).get(tradeDate, source) as { rowCount: number; timeCount: number; minTime: unknown; maxTime: unknown }
  const verifiedAt = batch.rowCount > 0 && batch.rowCount === batch.timeCount &&
    typeof batch.minTime === 'number' && Number.isSafeInteger(batch.minTime) && batch.minTime > 0 &&
    batch.minTime === batch.maxTime ? batch.minTime : null
  const rows = db.prepare(`
    SELECT ts_code AS tsCode, name, close, pct_chg AS pctChg,
      fd_amount_yuan AS fdAmountYuan, first_time AS firstTime,
      open_times AS openTimes, limit_times AS limitTimes, quality
    FROM public_limit_up_facts
    WHERE trade_date = ? AND source = ?
    ORDER BY limit_times DESC, first_time ASC, ts_code ASC
    LIMIT 2500
  `).all(tradeDate, source) as CachedPublicLimitUpRow[]
  for (const row of rows) {
    row.pctChg = finitePublicLimitPoolNumber(row.pctChg)
    row.fdAmountYuan = finitePublicLimitPoolNumber(row.fdAmountYuan, 0)
    row.firstTime = publicLimitPoolSealTime(row.firstTime)
    row.openTimes = publicLimitPoolCount(row.openTimes, 0)
    row.limitTimes = publicLimitPoolCount(row.limitTimes, 1)
    row.missingFields = publicLimitPoolFilterMissingFields(row)
    row.quality = row.missingFields.length > 0 ? 'partial' : 'available'
  }
  const hasProvenance = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='public_limit_up_batch_provenance'").get()
  const proof = hasProvenance ? db.prepare('SELECT source_trade_date, verified_at, row_count, price_check FROM public_limit_up_batch_provenance WHERE trade_date=? AND source=?').get(tradeDate, source) as {
    source_trade_date: string; verified_at: number; row_count: number; price_check: string
  } | undefined : undefined
  const sourceDated = source === 'eastmoney_public' && verifiedAt !== null && proof?.source_trade_date === tradeDate && proof.verified_at === verifiedAt && proof.row_count === batch.rowCount
  const priceCheck = sourceDated && proof && ['matched-local-closes', 'not-complete'].includes(proof.price_check) ? proof.price_check as 'matched-local-closes' | 'not-complete' : 'unknown'
  // Legacy rows never acquire a date witness retrospectively.
  return {
    recommendedTradeDate: empty.recommendedTradeDate, tradeDate, source, rows, verifiedAt, priceCheck,
    dateBasis: sourceDated ? 'source-reported' : 'unknown', rowmissingFields: publicLimitPoolRowmissingFields(rows),
  }
}
