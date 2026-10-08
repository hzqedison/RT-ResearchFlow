/**
 * Scheduled SSE cash-equity calendar from published annual notices.
 * This is not an auction feed, an instrument suspension feed, or an
 * authorization to submit orders. Dates outside coverage remain unknown.
 */
export const OFFICIAL_SSE_CALENDAR = {
  "schemaVersion": 1,
  "exchange": "SSE",
  "market": "cash-equity",
  "timezone": "Asia/Shanghai",
  "preparedOn": "2026-10-08",
  "status": "integrated-unverified",
  "coverage": {
    "start": "2024-01-01",
    "end": "2026-12-31"
  },
  "rules": {
    "closedWeekdays": [
      0,
      6
    ],
    "weekdayConvention": "Sunday=0, Monday=1, Saturday=6",
    "holidayRangeEndpoints": "inclusive",
    "governmentWeekendMakeupDaysRemainClosed": true,
    "outsideCoverage": "unknown-do-not-infer",
    "missingPreviousSessionAtCoverageBoundary": "unknown",
    "unscheduledClosureHandling": "requires-additional-official-notice",
    "nonHolidayWeekdays": "scheduled-open-not-proof-of-actual-session"
  },
  "exclusions": [
    "unscheduled-closures",
    "intraday-session-times",
    "instrument-suspensions",
    "auction-quotes",
    "non-SSE-markets"
  ],
  "years": [
    {
      "year": 2024,
      "source": {
        "publisher": "Shanghai Stock Exchange",
        "url": "https://www.sse.com.cn/disclosure/announcement/general/c/c_20231226_5733939.shtml",
        "publishedOn": "2023-12-26",
        "noticeNumber": "SSE-2023-47"
      },
      "holidayClosures": [
        {
          "holiday": "new-year",
          "start": "2023-12-30",
          "end": "2024-01-01",
          "announcedReopening": "2024-01-02"
        },
        {
          "holiday": "spring-festival",
          "start": "2024-02-09",
          "end": "2024-02-17",
          "announcedReopening": "2024-02-19"
        },
        {
          "holiday": "qingming",
          "start": "2024-04-04",
          "end": "2024-04-06",
          "announcedReopening": "2024-04-08"
        },
        {
          "holiday": "labour-day",
          "start": "2024-05-01",
          "end": "2024-05-05",
          "announcedReopening": "2024-05-06"
        },
        {
          "holiday": "dragon-boat",
          "start": "2024-06-10",
          "end": "2024-06-10",
          "announcedReopening": "2024-06-11"
        },
        {
          "holiday": "mid-autumn",
          "start": "2024-09-15",
          "end": "2024-09-17",
          "announcedReopening": "2024-09-18"
        },
        {
          "holiday": "national-day",
          "start": "2024-10-01",
          "end": "2024-10-07",
          "announcedReopening": "2024-10-08"
        }
      ],
      "explicitlyMentionedWeekendClosures": [
        "2024-02-04",
        "2024-02-18",
        "2024-04-07",
        "2024-04-28",
        "2024-05-11",
        "2024-09-14",
        "2024-09-29",
        "2024-10-12"
      ]
    },
    {
      "year": 2025,
      "source": {
        "publisher": "Shanghai Stock Exchange",
        "url": "https://www.sse.com.cn/disclosure/announcement/general/c/c_20241223_10767108.shtml",
        "publishedOn": "2024-12-23",
        "noticeNumber": "SSE-2024-38"
      },
      "holidayClosures": [
        {
          "holiday": "new-year",
          "start": "2025-01-01",
          "end": "2025-01-01",
          "announcedReopening": "2025-01-02"
        },
        {
          "holiday": "spring-festival",
          "start": "2025-01-28",
          "end": "2025-02-04",
          "announcedReopening": "2025-02-05"
        },
        {
          "holiday": "qingming",
          "start": "2025-04-04",
          "end": "2025-04-06",
          "announcedReopening": "2025-04-07"
        },
        {
          "holiday": "labour-day",
          "start": "2025-05-01",
          "end": "2025-05-05",
          "announcedReopening": "2025-05-06"
        },
        {
          "holiday": "dragon-boat",
          "start": "2025-05-31",
          "end": "2025-06-02",
          "announcedReopening": "2025-06-03"
        },
        {
          "holiday": "national-day-and-mid-autumn",
          "start": "2025-10-01",
          "end": "2025-10-08",
          "announcedReopening": "2025-10-09"
        }
      ],
      "explicitlyMentionedWeekendClosures": [
        "2025-01-26",
        "2025-02-08",
        "2025-04-27",
        "2025-09-28",
        "2025-10-11"
      ]
    },
    {
      "year": 2026,
      "source": {
        "publisher": "Shanghai Stock Exchange",
        "url": "https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml",
        "publishedOn": "2025-12-22",
        "noticeNumber": "SSE-2025-45"
      },
      "holidayClosures": [
        {
          "holiday": "new-year",
          "start": "2026-01-01",
          "end": "2026-01-03",
          "announcedReopening": "2026-01-05"
        },
        {
          "holiday": "spring-festival",
          "start": "2026-02-15",
          "end": "2026-02-23",
          "announcedReopening": "2026-02-24"
        },
        {
          "holiday": "qingming",
          "start": "2026-04-04",
          "end": "2026-04-06",
          "announcedReopening": "2026-04-07"
        },
        {
          "holiday": "labour-day",
          "start": "2026-05-01",
          "end": "2026-05-05",
          "announcedReopening": "2026-05-06"
        },
        {
          "holiday": "dragon-boat",
          "start": "2026-06-19",
          "end": "2026-06-21",
          "announcedReopening": "2026-06-22"
        },
        {
          "holiday": "mid-autumn",
          "start": "2026-09-25",
          "end": "2026-09-27",
          "announcedReopening": "2026-09-28"
        },
        {
          "holiday": "national-day",
          "start": "2026-10-01",
          "end": "2026-10-07",
          "announcedReopening": "2026-10-08"
        }
      ],
      "explicitlyMentionedWeekendClosures": [
        "2026-01-04",
        "2026-02-14",
        "2026-02-28",
        "2026-05-09",
        "2026-09-20",
        "2026-10-10"
      ]
    }
  ]
} as const

export const OFFICIAL_SSE_CALENDAR_START = '20240101'
export const OFFICIAL_SSE_CALENDAR_END = '20261231'
export const OFFICIAL_SSE_CALENDAR_LABEL = '上交所官方年度休市安排（免 Key）'

export interface OfficialSseTradeCalRow {
  calDate: string
  isOpen: number
  pretradeDate: string | null
}

function formatYmd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

function parseYmd(ymd: string): Date | null {
  if (!/^\d{8}$/.test(ymd)) return null
  const date = new Date(Date.UTC(
    Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)),
  ))
  return formatYmd(date) === ymd ? date : null
}

export function isOfficialSseTradingDay(ymd: string): boolean | null {
  const date = parseYmd(ymd)
  if (!date || ymd < OFFICIAL_SSE_CALENDAR_START || ymd > OFFICIAL_SSE_CALENDAR_END) return null
  const schedule = OFFICIAL_SSE_CALENDAR.years.find((item) => item.year === date.getUTCFullYear())
  if (!schedule) return null
  const weekday = date.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return !schedule.holidayClosures.some((range) =>
    ymd >= range.start.replace(/-/g, '') && ymd <= range.end.replace(/-/g, ''),
  )
}

export function getLastOfficialSseTradingDay(onOrBefore: string): string | null {
  const date = parseYmd(onOrBefore)
  if (!date || isOfficialSseTradingDay(onOrBefore) === null) return null
  while (formatYmd(date) >= OFFICIAL_SSE_CALENDAR_START) {
    const ymd = formatYmd(date)
    if (isOfficialSseTradingDay(ymd) === true) return ymd
    date.setUTCDate(date.getUTCDate() - 1)
  }
  return null
}

export function getPreviousOfficialSseTradingDay(ymd: string): string | null {
  const date = parseYmd(ymd)
  if (!date || isOfficialSseTradingDay(ymd) === null) return null
  date.setUTCDate(date.getUTCDate() - 1)
  return getLastOfficialSseTradingDay(formatYmd(date))
}

export function buildOfficialSseTradingCalendar(
  requestedStart = OFFICIAL_SSE_CALENDAR_START,
  requestedEnd = OFFICIAL_SSE_CALENDAR_END,
): OfficialSseTradeCalRow[] {
  if (!parseYmd(requestedStart) || !parseYmd(requestedEnd) || requestedStart > requestedEnd) {
    throw new Error('INVALID_CALENDAR_RANGE')
  }
  const start = requestedStart < OFFICIAL_SSE_CALENDAR_START ? OFFICIAL_SSE_CALENDAR_START : requestedStart
  const end = requestedEnd > OFFICIAL_SSE_CALENDAR_END ? OFFICIAL_SSE_CALENDAR_END : requestedEnd
  if (start > end) return []
  const rows: OfficialSseTradeCalRow[] = []
  const date = parseYmd(OFFICIAL_SSE_CALENDAR_START)!
  let previous: string | null = null
  while (formatYmd(date) <= end) {
    const calDate = formatYmd(date)
    const isOpen = isOfficialSseTradingDay(calDate) === true ? 1 : 0
    if (calDate >= start) rows.push({ calDate, isOpen, pretradeDate: previous })
    if (isOpen === 1) previous = calDate
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return rows
}
