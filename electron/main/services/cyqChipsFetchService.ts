import { fetchCyqChips, type CyqChipsRow } from './tushareService'
import { createHash } from 'node:crypto'
import { checkLocalWork } from './publicMarketWorkOwner'

const inFlight = new Map<string, Promise<CyqChipsRow[]>>()
const signalScopes = new WeakMap<AbortSignal, number>()
let nextScope = 0

export function fetchCyqChipsSingleflight(
  token: string,
  tsCode: string,
  tradeDate?: string,
  signal?: AbortSignal,
): Promise<CyqChipsRow[]> {
  try { checkLocalWork(signal) } catch (error) { return Promise.reject(error) }
  let scope = 0
  if (signal) {
    scope = signalScopes.get(signal) ?? ++nextScope
    signalScopes.set(signal, scope)
  }
  // Never share credentials or let one cancellation domain stop another.
  // Raw tokens are not used as map keys or exposed in diagnostics.
  const credential = createHash('sha256').update(token).digest('hex')
  const key = `${credential}|${tsCode.trim().toUpperCase()}|${tradeDate ?? '*'}|${scope}`
  const existing = inFlight.get(key)
  if (existing) return existing

  const request = fetchCyqChips(token, tsCode, tradeDate, signal).finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, request)
  return request
}
