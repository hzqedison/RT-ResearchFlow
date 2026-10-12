import { afterEach, expect, it, vi } from 'vitest'
import { fetchDailyForCandidates, fetchCyqChips, getTushareAccessErrorCode } from '../../electron/main/services/tushareService'

afterEach(() => vi.restoreAllMocks())
for (const api of ['daily', 'cyq_chips'] as const) {
  const invoke = (signal: AbortSignal) => api === 'daily'
    ? fetchDailyForCandidates('synthetic', ['600000.SH', '000001.SZ'], '20260801', undefined, signal)
    : fetchCyqChips('synthetic', '600000.SH', undefined, signal)
  it(`${api} rejects pre-abort without network access`, async () => {
    const fetch = vi.spyOn(globalThis, 'fetch'), controller = new AbortController(); controller.abort()
    await expect(invoke(controller.signal)).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it(`${api} aborts the actual bounded fetch without provider failure or retry`, async () => {
    const controller = new AbortController()
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      const signal = init!.signal!
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const pending = invoke(controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    controller.abort(); await rejected
    expect(fetch.mock.calls[0][1]!.signal!.aborted).toBe(true)
    expect(JSON.parse(String(fetch.mock.calls[0][1]!.body)).api_name).toBe(api)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(getTushareAccessErrorCode({ code: 'LOCAL_WORK_CANCELLED' })).toBeNull()
  })
}
