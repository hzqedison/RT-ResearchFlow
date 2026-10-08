import Database from 'better-sqlite3'
import { TradeCalRow } from './types'
import { isOfficialSseTradingDay, getPreviousOfficialSseTradingDay } from '../../shared/officialSseTradingCalendar'

/**
 * 批量写入/更新交易日历（幂等，INSERT OR REPLACE）
 */
export function upsertTradeCal(db: Database.Database, rows: TradeCalRow[]): void {
  if (rows.length === 0) return
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO trade_cal (cal_date, is_open, pretrade_date)
    VALUES (?, ?, ?)
  `)
  const insert = db.transaction((items: TradeCalRow[]) => {
    for (const r of items) {
      stmt.run(r.calDate, r.isOpen, r.pretradeDate ?? null)
    }
  })
  insert(rows)
}

/**
 * 查询指定日期是否为交易日。
 * 优先返回本地记录，缺失时查官方已公布范围；范围外返回 null（未知）
 */
export function isTradeDay(db: Database.Database, calDate: string): boolean | null {
  const row = db
    .prepare('SELECT is_open FROM trade_cal WHERE cal_date = ?')
    .get(calDate) as { is_open: number } | undefined
  if (row === undefined) return isOfficialSseTradingDay(calDate)
  return row.is_open === 1
}

/**
 * 查询某日期的上一交易日（读取 pretrade_date 列）。
 * 无记录或表为空时返回 null
 */
export function getPrevTradeDay(db: Database.Database, calDate: string): string | null {
  const row = db
    .prepare('SELECT pretrade_date FROM trade_cal WHERE cal_date = ?')
    .get(calDate) as { pretrade_date: string | null } | undefined
  return row === undefined ? getPreviousOfficialSseTradingDay(calDate) : row.pretrade_date
}

/**
 * 查询某日期的下一交易日。
 * 无数据时返回 null
 */
export function getNextTradeDay(db: Database.Database, calDate: string): string | null {
  const row = db
    .prepare(
      'SELECT cal_date FROM trade_cal WHERE cal_date > ? AND is_open = 1 ORDER BY cal_date ASC LIMIT 1'
    )
    .get(calDate) as { cal_date: string } | undefined
  return row?.cal_date ?? null
}

/**
 * 返回 [startDate, endDate] 区间内所有交易日（升序）。
 * 表为空时返回 []
 */
export function getTradingDaysInRange(
  db: Database.Database,
  startDate: string,
  endDate: string
): string[] {
  const rows = db
    .prepare(
      'SELECT cal_date FROM trade_cal WHERE cal_date >= ? AND cal_date <= ? AND is_open = 1 ORDER BY cal_date ASC'
    )
    .all(startDate, endDate) as { cal_date: string }[]
  return rows.map((r) => r.cal_date)
}

/**
 * 返回 beforeDate（含）往前数 n 个交易日的所有交易日（升序）。
 * 常用于"近 N 交易日"区间计算。
 * 表为空或不足 n 条时返回已有条目；表空返回 []
 */
export function getLastNTradingDays(
  db: Database.Database,
  n: number,
  beforeDate: string
): string[] {
  const rows = db
    .prepare(
      'SELECT cal_date FROM trade_cal WHERE cal_date <= ? AND is_open = 1 ORDER BY cal_date DESC LIMIT ?'
    )
    .all(beforeDate, n) as { cal_date: string }[]
  // 结果是降序，需反转为升序
  return rows.map((r) => r.cal_date).reverse()
}

/**
 * 查询数据库中已有的最晚 cal_date。
 * 表为空时返回 null
 */
export function getLatestCalDate(db: Database.Database): string | null {
  const row = db
    .prepare('SELECT MAX(cal_date) as latest FROM trade_cal')
    .get() as { latest: string | null }
  return row?.latest ?? null
}

function parseCalendarDate(ymd: string): Date | null {
  if (!/^\d{8}$/.test(ymd)) return null
  const date = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))))
  return formatCalendarDate(date) === ymd ? date : null
}

function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

/** Every calendar date must have an explicit valid open/closed fact. */
export function hasTradeCalCoverage(db: Database.Database, startDate: string, endDate: string): boolean {
  const date = parseCalendarDate(startDate)
  if (!date || !parseCalendarDate(endDate) || startDate > endDate) return false
  const rows = db.prepare('SELECT cal_date, is_open FROM trade_cal WHERE cal_date BETWEEN ? AND ?')
    .all(startDate, endDate) as { cal_date: string; is_open: number }[]
  const facts = new Map(rows.map((row) => [row.cal_date, row.is_open]))
  while (formatCalendarDate(date) <= endDate) {
    const status = facts.get(formatCalendarDate(date))
    if (status !== 0 && status !== 1) return false
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return true
}

/** Do not bridge a missing or invalid daily fact with an assumed predecessor. */
function getVerifiedPredecessor(facts: Map<string, number>, calDate: string): string | null {
  const date = parseCalendarDate(calDate)
  if (!date) return null
  for (;;) {
    date.setUTCDate(date.getUTCDate() - 1)
    const ymd = formatCalendarDate(date)
    const status = facts.get(ymd)
    if (status === 1) return ymd
    if (status !== 0) return null
  }
}

/** Only fill absent dates; retain existing facts and report schedule differences. */
export function insertTradeCalIfMissing(
  db: Database.Database,
  rows: TradeCalRow[],
): { insertedRows: number; conflictRows: number; firstConflictDate: string | null } {
  const existing = db.prepare('SELECT is_open, pretrade_date FROM trade_cal WHERE cal_date = ?')
  const insert = db.prepare('INSERT OR IGNORE INTO trade_cal (cal_date, is_open, pretrade_date) VALUES (?, ?, ?)')
  return db.transaction(() => {
    const stored = db.prepare('SELECT cal_date, is_open FROM trade_cal').all() as { cal_date: string; is_open: number }[]
    const facts = new Map(stored.map((row) => [row.cal_date, row.is_open]))
    let insertedRows = 0
    let conflictRows = 0
    let firstConflictDate: string | null = null
    for (const row of [...rows].sort((a, b) => a.calDate.localeCompare(b.calDate))) {
      if (!parseCalendarDate(row.calDate) || (row.isOpen !== 0 && row.isOpen !== 1)) {
        throw new Error('INVALID_CALENDAR_ROW')
      }
      const previous = getVerifiedPredecessor(facts, row.calDate)
      const current = existing.get(row.calDate) as { is_open: number; pretrade_date: string | null } | undefined
      if (current) {
        const differs = current.is_open !== row.isOpen
          || (current.pretrade_date !== null && previous !== null && current.pretrade_date !== previous)
        if (differs) {
          conflictRows += 1
          firstConflictDate ??= row.calDate
        }
        continue
      }
      insertedRows += insert.run(row.calDate, row.isOpen, previous).changes
      facts.set(row.calDate, row.isOpen)
    }
    return { insertedRows, conflictRows, firstConflictDate }
  })()
}
