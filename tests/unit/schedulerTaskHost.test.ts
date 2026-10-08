import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SchedulerTaskHost } from '../../electron/main/services/schedulerTaskHost'

function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() { for (let i = 0; i < 10; i += 1) await Promise.resolve() }
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('pure scheduler task ownership', () => {
  it('start/stop and stale scopes are explicit and idempotent', () => {
    const host = new SchedulerTaskHost()
    expect(host.start()).toBe(true)
    const old = host.replaceScope('scan')
    expect(host.start()).toBe(false)
    host.stop()
    host.stop()
    expect(host.isCurrent(old)).toBe(false)
    expect(host.start()).toBe(true)
    expect(host.isCurrent(old)).toBe(false)
  })

  it('replacing one chain invalidates only that chain', async () => {
    const host = new SchedulerTaskHost()
    host.start()
    const old = host.replaceScope('scan')
    const other = host.replaceScope('calendar')
    const scan = vi.fn()
    const calendar = vi.fn()
    host.timeout(old, scan, 5)
    host.timeout(other, calendar, 5)
    const next = host.replaceScope('scan')
    expect(host.timeout(old, scan, 5)).toBeNull()
    host.timeout(next, scan, 5)
    await vi.advanceTimersByTimeAsync(5)
    expect(scan).toHaveBeenCalledTimes(1)
    expect(calendar).toHaveBeenCalledTimes(1)
  })

  it('stop during an awaited task prevents a recursive registration but still waits', async () => {
    const host = new SchedulerTaskHost()
    host.start()
    const scope = host.replaceScope('chain')
    const task = deferred()
    host.timeout(scope, async () => {
      await task.promise
      host.timeout(scope, vi.fn(), 1)
    }, 1)
    await vi.advanceTimersByTimeAsync(1)
    host.stop()
    const idle = host.waitForIdle(100)
    task.resolve()
    expect(await idle).toEqual({ idle: true, timedOut: false, pendingTasks: 0 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('interval tasks do not overlap and remain tracked after interval disposal', async () => {
    const host = new SchedulerTaskHost()
    host.start()
    const task = deferred()
    const work = vi.fn(() => task.promise)
    host.interval(host.replaceScope('poll'), work, 1)
    await vi.advanceTimersByTimeAsync(10)
    expect(work).toHaveBeenCalledTimes(1)
    host.stop()
    expect(await host.waitForIdle(0)).toMatchObject({ idle: false, pendingTasks: 1 })
    task.resolve()
    await flush()
    expect(await host.waitForIdle(0)).toMatchObject({ idle: true })
  })

  it('idle listeners account for children admitted while a parent finishes', async () => {
    const host = new SchedulerTaskHost()
    host.start()
    const parent = deferred()
    const child = deferred()
    void host.run(async () => {
      await parent.promise
      void host.run(() => child.promise)
    })
    await flush()
    host.stop()
    const idle = host.waitForIdle(100)
    parent.resolve()
    await flush()
    expect(await host.waitForIdle(0)).toMatchObject({ idle: false, pendingTasks: 1 })
    child.resolve()
    expect(await idle).toMatchObject({ idle: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejection drains tracking without an unhandled finally rejection', async () => {
    const host = new SchedulerTaskHost()
    const task = deferred()
    const running = host.run(() => task.promise)
    const failed = expect(running).rejects.toThrow('isolated')
    task.reject(new Error('isolated'))
    await failed
    expect(await host.waitForIdle(0)).toMatchObject({ idle: true })
  })

  it('timeout leaves work tracked and releases its own waiter timer', async () => {
    const host = new SchedulerTaskHost()
    const task = deferred()
    void host.run(() => task.promise)
    const idle = host.waitForIdle(5)
    await vi.advanceTimersByTimeAsync(5)
    expect(await idle).toEqual({ idle: false, timedOut: true, pendingTasks: 1 })
    expect(vi.getTimerCount()).toBe(0)
    task.resolve()
    await flush()
    expect(await host.waitForIdle(0)).toMatchObject({ idle: true })
  })

  it('invalid wait deadlines are rejected without starting a timer', async () => {
    const host = new SchedulerTaskHost()
    await expect(host.waitForIdle(-1)).rejects.toThrow(RangeError)
    await expect(host.waitForIdle(Infinity)).rejects.toThrow(RangeError)
    expect(vi.getTimerCount()).toBe(0)
  })
})
