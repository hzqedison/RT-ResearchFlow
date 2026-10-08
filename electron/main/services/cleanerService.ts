import { getSettings } from '../database/settingsRepository'
import { deleteOldBriefings } from '../database/briefingRepository'
import { utcToBjDate } from '../utils/dateUtils'

let _cleanupTimer: ReturnType<typeof setInterval> | null = null
let _cleanupGeneration = 0

let _lastCleanDate: string | null = null

/**
 * Run data retention cleanup if it hasn't run today (Beijing time).
 * Deletes briefings older than retentionDays.
 */
export function runCleanupIfNeeded(): void {
  const todayBj = utcToBjDate(Date.now())
  if (_lastCleanDate === todayBj) return

  const settings = getSettings()
  const deleted = deleteOldBriefings(settings.retentionDays)
  _lastCleanDate = todayBj

  if (deleted > 0) {
    console.log(`[Cleaner] Deleted ${deleted} briefings older than ${settings.retentionDays} days`)
  }
}

/**
 * Schedule daily cleanup at midnight Beijing time.
 */
export function scheduleDailyCleanup(): void {
  if (_cleanupTimer !== null) return
  const generation = ++_cleanupGeneration
  runCleanupIfNeeded()
  _cleanupTimer = setInterval(() => {
    if (generation !== _cleanupGeneration) return
    runCleanupIfNeeded()
  }, 60 * 60 * 1000)
}

/** Release the hourly resource; repeated stops and subsequent starts are safe. */
export function stopDailyCleanup(): void {
  if (_cleanupTimer === null) return
  clearInterval(_cleanupTimer)
  _cleanupTimer = null
  _cleanupGeneration += 1
}
