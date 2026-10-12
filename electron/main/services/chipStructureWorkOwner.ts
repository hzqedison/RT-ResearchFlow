import { PublicMarketWorkOwner } from './publicMarketWorkOwner'

export const chipStructureWorkOwner = new PublicMarketWorkOwner()
export const stopChipStructureWork = (): void => chipStructureWorkOwner.stop()
export const waitForChipStructureWorkIdle = (timeoutMs: number): Promise<boolean> => chipStructureWorkOwner.waitForIdle(timeoutMs)
