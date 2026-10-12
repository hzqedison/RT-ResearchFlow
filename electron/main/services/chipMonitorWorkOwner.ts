import { PublicMarketWorkOwner } from './publicMarketWorkOwner'

export const chipMonitorWorkOwner = new PublicMarketWorkOwner()
export const stopChipMonitorWork = (): void => chipMonitorWorkOwner.stop()
export const waitForChipMonitorWorkIdle = (timeoutMs: number): Promise<boolean> => chipMonitorWorkOwner.waitForIdle(timeoutMs)
