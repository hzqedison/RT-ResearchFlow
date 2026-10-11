import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDailyByDate, getTushareAccessErrorCode } from '../../electron/main/services/tushareService'
import { LocalWorkCancelledError } from '../../electron/main/services/publicMarketWorkOwner'
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers() })
describe('Tushare transport cancellation without a real Key', () => {
  it('does not classify explicit local cancellation as provider timeout', () => {
    expect(getTushareAccessErrorCode(new LocalWorkCancelledError())).toBeNull()
    const timeout = new Error('timed out'); timeout.name = 'AbortError'
    expect(getTushareAccessErrorCode(timeout)).toBe('TUSHARE_REQUEST_TIMEOUT')
  })
  it('pre-aborted daily request sends no network request', async () => {
    const controller = new AbortController(), client = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { fields: [], items: [] } }), { status: 200 }))
    vi.stubGlobal('fetch', client); controller.abort()
    await expect(fetchDailyByDate('synthetic', '20260814', controller.signal)).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    expect(client).not.toHaveBeenCalled()
  })
  it('aborts an actual pending transport once without retrying', async () => {
    const controller = new AbortController(); let observed: AbortSignal | null | undefined
    const client = vi.fn((_url, init) => { observed = init.signal; return new Promise<Response>((_resolve, reject) => observed!.addEventListener('abort', () => reject(observed!.reason))) })
    vi.stubGlobal('fetch', client)
    const pending = fetchDailyByDate('synthetic', '20260814', controller.signal), rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    for (let i = 0; i < 10 && !observed; i++) await Promise.resolve()
    controller.abort(); await rejected; expect(observed?.aborted).toBe(true); expect(client).toHaveBeenCalledTimes(1)
  })
  it('rejects a body delivered after cancellation', async () => {
    const controller = new AbortController(); let release!: (v: unknown) => void
    const client = vi.fn(async () => ({ ok: true, json: () => new Promise(resolve => { release = resolve }) }))
    vi.stubGlobal('fetch', client)
    const pending = fetchDailyByDate('synthetic', '20260814', controller.signal), rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve()
    controller.abort(); release({ code: 0, data: { fields: [], items: [] } }); await rejected; expect(client).toHaveBeenCalledTimes(1)
  })
  it('cancels retry waiting and releases all scope timers', async () => {
    vi.useFakeTimers(); const controller = new AbortController(), client = vi.fn(async () => ({ ok: false, status: 500 }))
    vi.stubGlobal('fetch', client)
    const pending = fetchDailyByDate('synthetic', '20260814', controller.signal), rejected = expect(pending).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(client).toHaveBeenCalledTimes(1); controller.abort(); await rejected
    expect(client).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
})
