import type Database from 'better-sqlite3'
import { latestClosedCalendarDate } from './multiSourceMarketService'
import { validNativeDate } from '../../shared/macThsNativeProtocol'

function validDate(date: string): boolean {
  return /^\d{8}$/.test(date) && validNativeDate(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`)
}

// Only recommend an actually recorded open day. Never guess weekdays/holidays.
export function recommendPublicLimitPoolDate(db: Database.Database, now = Date.now()): string | null {
  if (!Number.isSafeInteger(now) || now <= 0) return null
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='trade_cal'").get()) return null
  const bound = latestClosedCalendarDate(now)
  const candidate = (db.prepare('SELECT MAX(cal_date) AS date FROM trade_cal WHERE is_open=1 AND cal_date<=?').get(bound) as { date: string | null }).date
  if (!candidate || !validDate(candidate)) return null
  const start = Date.parse(`${candidate.slice(0, 4)}-${candidate.slice(4, 6)}-${candidate.slice(6, 8)}T00:00:00Z`)
  const end = Date.parse(`${bound.slice(0, 4)}-${bound.slice(4, 6)}-${bound.slice(6, 8)}T00:00:00Z`)
  const days = (end - start) / 86400000
  if (!Number.isInteger(days) || days < 0 || days > 60) return null
  const rows = db.prepare('SELECT cal_date,is_open FROM trade_cal WHERE cal_date>=? AND cal_date<=? ORDER BY cal_date').all(candidate, bound) as Array<{ cal_date: string; is_open: number }>
  if (rows.length !== days + 1) return null
  for (let i = 0; i < rows.length; i++) {
    const expected = new Date(start + i * 86400000).toISOString().slice(0, 10).replaceAll('-', '')
    if (rows[i].cal_date !== expected || ![0, 1].includes(rows[i].is_open)) return null
  }
  return candidate
}
