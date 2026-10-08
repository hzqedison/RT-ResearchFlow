import { registerTrustedIpcHandler, type TrustedWindowGetter } from '../security/trustedIpc'
import {
  getDecisionCenterFilters,
  getMarketHeatmapProvider,
  getSettings,
  getTheme,
  setDecisionCenterFilters,
  setMarketHeatmapProvider,
  setTheme,
  updateSettings,
} from '../database/settingsRepository'
import { reschedule } from '../services/schedulerService'
import type { AppSettingsRow } from '../database/types'

export function registerSettingsHandlers(getWindow: TrustedWindowGetter): void {
  registerTrustedIpcHandler('settings:get', getWindow, () => {
    return getSettings()
  })

  registerTrustedIpcHandler('settings:update', getWindow, (_e, data: Partial<Omit<AppSettingsRow, 'id'>>) => {
    const updated = updateSettings(data)
    // If scan interval changed, reschedule
    if (data.scanIntervalMinutes !== undefined) {
      reschedule()
    }
    return updated
  })

  registerTrustedIpcHandler('settings:getDecisionCenterFilters', getWindow, () => getDecisionCenterFilters())

  registerTrustedIpcHandler('settings:setDecisionCenterFilters', getWindow, (_e, filters: unknown) => (
    setDecisionCenterFilters(filters)
  ))

  registerTrustedIpcHandler('settings:getTheme', getWindow, () => {
    return getTheme()
  })

  registerTrustedIpcHandler('settings:setTheme', getWindow, (_e, theme: 'light' | 'dark') => {
    setTheme(theme)
  })

  registerTrustedIpcHandler('settings:getMarketHeatmapProvider', getWindow, () => {
    return getMarketHeatmapProvider()
  })

  registerTrustedIpcHandler('settings:setMarketHeatmapProvider', getWindow, (_e, provider: 'sina' | 'eastmoney' | 'tushare') => {
    setMarketHeatmapProvider(provider)
    return 'ok'
  })
}
