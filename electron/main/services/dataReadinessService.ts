import type Database from 'better-sqlite3'
import { isOfficialSseTradingDay } from '../../shared/officialSseTradingCalendar'
import { getBeijingYmd, getLastSettledCalendarDate, offsetYmd } from './marketSettlementPolicy'

export interface CalendarDay { isOpen: number; conflict?: boolean }
export type KnownCalendar = (date: string) => CalendarDay | undefined
export interface FactDates { auctionDate: string; previousTradeDate: string }

export function validTradeDate(date: string): boolean {
  if (!/^\d{8}$/.test(date)) return false
  const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10).replace(/-/g, '') === date
}

function knownOpen(calendar: KnownCalendar, date: string): number {
  const day = calendar(date)
  if (!day || ![0, 1].includes(day.isOpen) || day.conflict) throw new Error('CALENDAR_UNAVAILABLE')
  return day.isOpen
}

function previousOpen(calendar: KnownCalendar, start: string): string {
  let date = start
  // Explicit finite safety bound, not a weekday or holiday-length assumption.
  for (let i = 0; i < 3660; i++, date = offsetYmd(date, -1)) {
    if (knownOpen(calendar, date) === 1) return date
  }
  throw new Error('CALENDAR_UNAVAILABLE')
}

export function readKnownCalendar(db: Database.Database): KnownCalendar {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get('trade_cal')
  if (!exists) return () => undefined
  const statement = db.prepare('SELECT is_open FROM trade_cal WHERE cal_date = ?')
  return date => {
    const row = statement.get(date) as { is_open: number } | undefined
    if (!row) return undefined
    const official = isOfficialSseTradingDay(date)
    return { isOpen: row.is_open, conflict: official !== null && Number(official) !== row.is_open }
  }
}

export function resolveFactDates(calendar: KnownCalendar, now: number, explicitAuctionDate?: string): FactDates {
  const today = getBeijingYmd(now)
  const todayOpen = knownOpen(calendar, today)
  const bj = new Date(now + 8 * 60 * 60 * 1000)
  const due = bj.getUTCHours() * 60 + bj.getUTCMinutes() >= 9 * 60 + 30
  if (explicitAuctionDate === today && todayOpen === 1 && !due) throw new Error('NOT_DUE')
  const auctionDate = previousOpen(calendar, todayOpen === 1 && due ? today : offsetYmd(today, -1))
  // Renderer dates are not accepted by IPC. Internal explicit targets must match the proved default.
  if (explicitAuctionDate && explicitAuctionDate !== auctionDate) throw new Error('CALENDAR_UNAVAILABLE')
  const previousTradeDate = previousOpen(calendar, offsetYmd(auctionDate, -1))
  return { auctionDate, previousTradeDate }
}

export function resolveCompletedTradeDate(calendar: KnownCalendar, now: number): string {
  knownOpen(calendar, getBeijingYmd(now))
  return previousOpen(calendar, getLastSettledCalendarDate(now))
}

export function tradingDayAge(calendar: KnownCalendar, latestDate: string, now: number): { expectedTradeDate: string; missingTradeDays: number } {
  const latest = latestDate.replace(/-/g, '')
  if (!validTradeDate(latest)) throw new Error('CALENDAR_UNAVAILABLE')
  const expectedTradeDate = resolveCompletedTradeDate(calendar, now)
  if (latest > expectedTradeDate || knownOpen(calendar, latest) !== 1) throw new Error('FACT_INVALID')
  let count = 0
  let date = latest
  for (let i = 0; date <= expectedTradeDate && i < 3660; i++, date = offsetYmd(date, 1)) {
    const open = knownOpen(calendar, date)
    if (date !== latest) count += open
    if (date === expectedTradeDate) return { expectedTradeDate, missingTradeDays: count }
  }
  throw new Error('CALENDAR_UNAVAILABLE')
}
