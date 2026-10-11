import { PublicMarketWorkOwner } from './publicMarketWorkOwner'
// Reuse the pure cancellation implementation, not the public-data singleton.
export const tushareHistoricalWorkOwner = new PublicMarketWorkOwner()
export const stopTushareHistoricalWork = () => tushareHistoricalWorkOwner.stop()
export const waitForTushareHistoricalWorkIdle = (timeoutMs: number) => tushareHistoricalWorkOwner.waitForIdle(timeoutMs)
