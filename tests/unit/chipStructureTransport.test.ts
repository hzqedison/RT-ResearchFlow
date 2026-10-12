import { afterEach, expect, it, vi } from 'vitest'
import { fetchCyqPerf, fetchTopInst } from '../../electron/main/services/tushareService'
afterEach(() => vi.unstubAllGlobals())
for (const api of ['cyq_perf', 'top_inst'] as const) {
  it(`aborts ${api} transport without retrying or reporting permission failure`, async () => {
    const calls: Array<{ api: string; signal: AbortSignal }> = []
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init.signal!; calls.push({ api: JSON.parse(String(init.body)).api_name, signal })
      const abort = () => reject(signal.reason)
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
    })))
    const parent = new AbortController()
    const request = api === 'cyq_perf'
      ? fetchCyqPerf('fixture', '600000.SH', '20260710', undefined, undefined, parent.signal)
      : fetchTopInst('fixture', '20260710', parent.signal)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    parent.abort()
    await expect(request).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    expect(calls[0].api).toBe(api); expect(calls[0].signal.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledOnce()
  })
}
