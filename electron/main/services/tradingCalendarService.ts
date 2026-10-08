/**
 * Today's scheduled SSE session, in Beijing time.
 * Published official schedules are available without a Key. Outside covered
 * dates, an unknown calendar does not authorize trading-day-dependent jobs.
 */
import { fetchTradeCal } from './tushareService'
import { getBeijingYmd } from './marketSettlementPolicy'
import { isOfficialSseTradingDay } from '../../shared/officialSseTradingCalendar'

let _isTodayOpen: boolean | null = null
let _cachedForDate: string | null = null
let _inflight: Promise<void> | null = null

export function isTodayTradingDay(): boolean {
  const today = getBeijingYmd()
  if (_cachedForDate === today && _isTodayOpen !== null) return _isTodayOpen
  return isOfficialSseTradingDay(today) === true
}

export function refreshTradingCalendar(token?: string | null): Promise<void> {
  const today = getBeijingYmd()
  if (_cachedForDate === today && _isTodayOpen !== null) return Promise.resolve()
  if (_inflight) return _inflight
  const official = isOfficialSseTradingDay(today)
  if (official !== null) {
    _isTodayOpen = official
    _cachedForDate = today
  }
  if (!token?.trim()) return Promise.resolve()
  let promise: Promise<void>
  promise = Promise.resolve().then(async () => {
    try {
      const rows = await fetchTradeCal(token, 'SSE', today, today)
      const row = rows.find((item) => item.calDate === today && (item.isOpen === 0 || item.isOpen === 1))
      if (row) {
        _isTodayOpen = row.isOpen === 1
        _cachedForDate = today
      } else {
        console.warn('[TradingCalendar] No confirmed provider row; retaining announced schedule or unknown status')
      }
    } catch {
      console.warn('[TradingCalendar] Provider unavailable; retaining announced schedule or unknown status')
    }
  }).finally(() => {
    if (_inflight === promise) _inflight = null
  })
  _inflight = promise
  return promise
}

export function clearTradingCalendarCache(): void {
  _isTodayOpen = null
  _cachedForDate = null
  _inflight = null
}
