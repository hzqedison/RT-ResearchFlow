import { beforeEach, expect, it, vi } from 'vitest'
const fetch = vi.hoisted(() => vi.fn())
vi.mock('../../electron/main/services/tushareService', () => ({ fetchCyqChips: fetch }))
let service: typeof import('../../electron/main/services/cyqChipsFetchService')
beforeEach(async () => { vi.resetModules(); fetch.mockReset(); fetch.mockResolvedValue([]); service = await import('../../electron/main/services/cyqChipsFetchService') })

it('keeps the shared promise identity for the same credential and default scope', async () => {
  const first = service.fetchCyqChipsSingleflight('synthetic-a', '600000.SH')
  const second = service.fetchCyqChipsSingleflight('synthetic-a', '600000.SH')
  expect(first).toBe(second); await first; expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not merge different credentials', async () => {
  const first = service.fetchCyqChipsSingleflight('synthetic-a', '600000.SH')
  const second = service.fetchCyqChipsSingleflight('synthetic-b', '600000.SH')
  expect(first).not.toBe(second); await Promise.all([first, second]); expect(fetch).toHaveBeenCalledTimes(2)
})
it('coalesces calls in the same owned signal scope', async () => {
  const controller = new AbortController()
  const first = service.fetchCyqChipsSingleflight('synthetic', '600000.SH', undefined, controller.signal)
  const second = service.fetchCyqChipsSingleflight('synthetic', '600000.SH', undefined, controller.signal)
  expect(first).toBe(second); await first; expect(fetch.mock.calls[0][3]).toBe(controller.signal)
})
it('keeps a legacy request and another owned scope alive when one scope aborts', async () => {
  const a = new AbortController(), b = new AbortController()
  const releases: Array<() => void> = []
  fetch.mockImplementation((_token, _code, _date, signal?: AbortSignal) => new Promise((resolve, reject) => {
    releases.push(() => resolve([]))
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  const first = service.fetchCyqChipsSingleflight('synthetic', '600000.SH', undefined, a.signal)
  const rejected = expect(first).rejects.toBeDefined()
  const legacy = service.fetchCyqChipsSingleflight('synthetic', '600000.SH')
  const other = service.fetchCyqChipsSingleflight('synthetic', '600000.SH', undefined, b.signal)
  a.abort(); await rejected
  expect(b.signal.aborted).toBe(false); releases[1](); releases[2](); await Promise.all([legacy, other])
  expect(fetch).toHaveBeenCalledTimes(3)
})
it('rejects pre-aborted calls without touching transport', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(service.fetchCyqChipsSingleflight('synthetic', '600000.SH', undefined, controller.signal)).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  expect(fetch).not.toHaveBeenCalled()
})
it('removes settled requests so a later call can refresh data', async () => {
  await service.fetchCyqChipsSingleflight('synthetic', '600000.SH')
  await service.fetchCyqChipsSingleflight('synthetic', '600000.SH')
  expect(fetch).toHaveBeenCalledTimes(2)
})
