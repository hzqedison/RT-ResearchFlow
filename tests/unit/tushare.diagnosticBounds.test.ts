import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchStkAuction, fetchLimitListDaily } from '../../electron/main/services/tushareService'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

const fields = ['ts_code', 'trade_date', 'price', 'vol', 'amount', 'pre_close']
const page = (items: unknown[][]) => ({ ok: true, json: async () => ({ code: 0, data: { fields, items } }) })
const fullPage = () => Array.from({ length: 5000 }, (_, i) => [String(100000 + i) + '.SH', '20261008', 10, 1, 10, 10])
const options = (extra = {}) => ({ deadlineMs: Date.now() + 30_000, maxPages: 4, maxAttempts: 1, ...extra })
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] }); vi.setSystemTime(Date.parse('2026-10-08T02:00:00Z')) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('bounded diagnostic Tushare transport', () => {
  it('real local HTTP body is aborted, without any upstream network request', async () => {
    vi.useRealTimers()
    const nativeFetch = globalThis.fetch
    let bodyStarted = false
    const server = createServer((_request, response) => { bodyStarted = true; response.writeHead(200, { 'content-type': 'application/json' }); response.write('{"code":0,"data":'); })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/fixture-only`
    const fetcher = vi.fn((_url: unknown, init: RequestInit) => nativeFetch(url, init))
    vi.stubGlobal('fetch', fetcher)
    try {
      await expect(fetchLimitListDaily('fixture-token', '20260930', options({ deadlineMs: Date.now() + 1000 }))).rejects.toMatchObject({ code: 'TUSHARE_REQUEST_TIMEOUT' })
      expect(bodyStarted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
  it('finite pagination returns only after the terminal page', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(page(fullPage())).mockResolvedValueOnce(page([['600001.SH', '20261008', 10, 1, 10, 10]]))
    vi.stubGlobal('fetch', fetcher)
    expect(await fetchStkAuction('fixture-token', '20261008', undefined, options())).toHaveLength(5001)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetcher.mock.calls[1][1].body).params.offset).toBe('5000')
  })
  it.each([1, 2])('page cap %i or repeated page rejects the collected subset', async maxPages => {
    const fetcher = vi.fn().mockResolvedValue(page(fullPage())); vi.stubGlobal('fetch', fetcher)
    await expect(fetchStkAuction('fixture-token', '20261008', undefined, options({ maxPages }))).rejects.toMatchObject({ code: 'PAGINATION_INCOMPLETE' })
    expect(fetcher).toHaveBeenCalledTimes(maxPages)
  })
  it('a later failed page does not return the first page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(page(fullPage())).mockRejectedValueOnce(new Error('fixture offline')))
    await expect(fetchStkAuction('fixture-token', '20261008', undefined, options())).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' })
  })
  it('deadline really aborts a slow network operation and prevents more pages', async () => {
    let aborted = false
    const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('fixture', 'AbortError')) }, { once: true })))
    vi.stubGlobal('fetch', fetcher)
    const result = fetchStkAuction('fixture-token', '20261008', undefined, options({ deadlineMs: Date.now() + 100 })).catch(error => error)
    await vi.advanceTimersByTimeAsync(100)
    expect(await result).toMatchObject({ code: 'TUSHARE_REQUEST_TIMEOUT' }); expect(aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('the propagated signal aborts stalled response body consumption', async () => {
    let bodyCancelled = false
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({ ok: true, json: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => { bodyCancelled = true; reject(new DOMException('fixture', 'AbortError')) }, { once: true })) })))
    const result = fetchLimitListDaily('fixture-token', '20260930', options({ deadlineMs: Date.now() + 50 })).catch(error => error)
    await vi.advanceTimersByTimeAsync(50)
    expect(await result).toMatchObject({ code: 'TUSHARE_REQUEST_TIMEOUT' }); expect(bodyCancelled).toBe(true)
  })
  it('user cancellation aborts fetch and does not become a retry', async () => {
    const controller = new AbortController(); let innerSignal!: AbortSignal
    const fetcher = vi.fn((_url, init) => { innerSignal = init.signal; return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('fixture', 'AbortError')), { once: true })) })
    vi.stubGlobal('fetch', fetcher)
    const result = fetchLimitListDaily('fixture-token', '20260930', options({ signal: controller.signal, maxAttempts: 3 })).catch(error => error)
    controller.abort()
    expect(await result).toMatchObject({ code: 'QUERY_CANCELLED' }); expect(innerSignal.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['cancel', 'deadline'])('retry waiting is interruptible by %s', async kind => {
    const controller = new AbortController(); const fetcher = vi.fn().mockRejectedValue(new Error('fixture network'))
    vi.stubGlobal('fetch', fetcher)
    const result = fetchLimitListDaily('fixture-token', '20260930', options({ signal: controller.signal, deadlineMs: Date.now() + 100, maxAttempts: 3, retryDelayMs: 1000 })).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    if (kind === 'cancel') controller.abort(); else await vi.advanceTimersByTimeAsync(100)
    expect(await result).toMatchObject({ code: kind === 'cancel' ? 'QUERY_CANCELLED' : 'TUSHARE_REQUEST_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(3000); expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('expired or pre-aborted requests never fetch', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(fetchLimitListDaily('fixture-token', '20260930', options({ deadlineMs: Date.now() }))).rejects.toMatchObject({ code: 'TUSHARE_REQUEST_TIMEOUT' })
    const controller = new AbortController(); controller.abort()
    await expect(fetchLimitListDaily('fixture-token', '20260930', options({ signal: controller.signal }))).rejects.toMatchObject({ code: 'QUERY_CANCELLED' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([[401, 'TUSHARE_AUTH_FAILED'], [403, 'TUSHARE_QUOTA_INSUFFICIENT'], [429, 'TUSHARE_RATE_LIMITED']])('HTTP %s is stable and not retried', async (status, code) => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status }); vi.stubGlobal('fetch', fetcher)
    await expect(fetchLimitListDaily('fixture-token', '20260930', options({ maxAttempts: 3 }))).rejects.toMatchObject({ code })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('permission rejection also cancels the unread response body', async () => {
    let cancelled = false
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      init.signal.addEventListener('abort', () => { cancelled = true }, { once: true })
      return { ok: false, status: 403 }
    }))
    await expect(fetchLimitListDaily('fixture-token', '20260930', options())).rejects.toMatchObject({ code: 'TUSHARE_QUOTA_INSUFFICIENT' })
    expect(cancelled).toBe(true)
  })
  it('malformed key rows fail rather than silently dropping invalid facts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page([['', '20261008', 10]])))
    await expect(fetchStkAuction('fixture-token', '20261008', undefined, options())).rejects.toMatchObject({ code: 'FACT_INVALID' })
  })
  it('default callers retain their existing signature and pagination', async () => {
    const fetcher = vi.fn().mockResolvedValue(page([['600001.SH', '20261008', 10, 1, 10, 10]])); vi.stubGlobal('fetch', fetcher)
    expect(await fetchStkAuction('fixture-token', '20261008')).toHaveLength(1)
    expect(await fetchLimitListDaily('fixture-token', '20260930')).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it.each([undefined, null, {}, { fields: [], items: null }])('missing or invalid terminal data %j rejects the accumulated subset', async data => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(page(fullPage())).mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data }) }))
    await expect(fetchStkAuction('fixture-token', '20261008', undefined, options())).rejects.toMatchObject({ code: 'FACT_INVALID' })
  })
  it('explicit empty items are valid both as the first page and the terminal page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page([])))
    expect(await fetchStkAuction('fixture-token', '20261008', undefined, options())).toEqual([])
    expect(await fetchLimitListDaily('fixture-token', '20260930', options())).toEqual([])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(page(fullPage())).mockResolvedValueOnce(page([])))
    expect(await fetchStkAuction('fixture-token', '20261008', undefined, options())).toHaveLength(5000)
  })
  it.each(['vol', 'price', 'amount', 'pre_close', 'turnover_rate', 'volume_ratio', 'float_share'])('rejects an illegal raw auction %s value', async field => {
    const fs = ['ts_code', 'trade_date', field]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { fields: fs, items: [['600001.SH', '20261008', 'not-a-number']] } }) }))
    await expect(fetchStkAuction('fixture-token', '20261008', undefined, options())).rejects.toMatchObject({ code: 'FACT_INVALID' })
  })
  it.each(['close', 'pct_chg', 'amount', 'float_mv', 'total_mv', 'turnover_ratio', 'fd_amount', 'open_times', 'limit_times'])('rejects an illegal raw limit %s value', async field => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { fields: ['ts_code', 'trade_date', field], items: [['600001.SH', '20260930', 'not-a-number']] } }) }))
    await expect(fetchLimitListDaily('fixture-token', '20260930', options())).rejects.toMatchObject({ code: 'FACT_INVALID' })
  })
  it.each(['12junk', '1.2.3', '0x10', '', ' ', Infinity, NaN, true, -1])('rejects non-decimal, nonfinite or negative raw amount %s', async amount => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page([['600001.SH', '20261008', 10, 1, amount, 10]])))
    await expect(fetchStkAuction('fixture-token', '20261008', undefined, options())).rejects.toMatchObject({ code: 'FACT_INVALID' })
  })
  it('retains real null, accepts whole decimal strings and negative limit pct change, but not fractional counts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page([['600001.SH', '20261008', '10.5', '1', null, '1e1']])))
    expect((await fetchStkAuction('fixture-token', '20261008', undefined, options()))[0]).toMatchObject({ price: 10.5, vol: 1, amount: null, preClose: 10 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page([['600001.SH', '20261008', 10, 1.5, 10, 10]])))
    await expect(fetchStkAuction('fixture-token', '20261008', undefined, options())).rejects.toMatchObject({ code: 'FACT_INVALID' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { fields: ['ts_code', 'trade_date', 'close', 'pct_chg', 'amount'], items: [['600001.SH', '20260930', 10, '-3.5', null]] } }) }))
    expect((await fetchLimitListDaily('fixture-token', '20260930', options()))[0]).toMatchObject({ close: 10, pctChg: -3.5, amount: null })
  })
  it('timestamps bounded observations when the response is obtained, not when the request starts', async () => {
    const start = Date.now()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => setTimeout(() => resolve(page([['600001.SH', '20261008', 10, 1, 10, 10]])), 1000))))
    const pending = fetchStkAuction('fixture-token', '20261008', undefined, options())
    await vi.advanceTimersByTimeAsync(1000)
    expect((await pending)[0].fetchedAt).toBe(start + 1000)
  })
  it.each(['fetch', 'body', 'retry'] as const)('wall rollback cannot extend the total deadline during %s', async stage => {
    const controller = new AbortController()
    let lastSignal: AbortSignal | undefined
    const fetcher = vi.fn((_url: unknown, init: RequestInit) => {
      lastSignal = init.signal!
      const stalled = () => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('fixture', 'AbortError')), { once: true }))
      return stage === 'fetch' ? stalled() : stage === 'body' ? Promise.resolve({ ok: true, json: stalled }) : Promise.reject(new Error('fixture network'))
    })
    vi.stubGlobal('fetch', fetcher)
    const pending = fetchLimitListDaily('fixture-token', '20260930', options({ signal: controller.signal, deadlineMs: Date.now() + 1000, maxAttempts: 3, retryDelayMs: 5000 })).catch(error => error)
    await vi.advanceTimersByTimeAsync(500); vi.setSystemTime(Date.now() - 3_600_000)
    await vi.advanceTimersByTimeAsync(500)
    expect(await pending).toMatchObject({ code: 'TUSHARE_REQUEST_TIMEOUT' })
    expect(lastSignal!.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('default callers still use the legacy permissive number parser and missing-data behavior', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page([['600001.SH', '20261008', 10, 1, '12junk', 10]])))
    expect((await fetchStkAuction('fixture-token', '20261008'))[0].amount).toBe(12)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(page(fullPage())).mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0 }) }))
    expect(await fetchStkAuction('fixture-token', '20261008')).toHaveLength(5000)
  })
})
