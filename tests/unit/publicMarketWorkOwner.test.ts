import { afterEach, expect, it, vi } from 'vitest'
import { LocalWorkCancelledError, PublicMarketWorkOwner, localWorkDelay, publicRequestSignal } from '../../electron/main/services/publicMarketWorkOwner'
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
it('rejects already cancelled work without executing its callback', async () => {
  const owner = new PublicMarketWorkOwner(), controller = new AbortController(), work = vi.fn(async () => 1)
  controller.abort('sk-private reason')
  await expect(owner.run(work, controller.signal)).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  expect(work).not.toHaveBeenCalled(); expect(await owner.waitForIdle(0)).toBe(true)
})
it('stop prevents admission and does not pretend ignored cancellation is idle', async () => {
  const owner = new PublicMarketWorkOwner(); let release!: () => void, observed: AbortSignal | undefined
  const pending = owner.run(signal => { observed = signal; return new Promise<void>(resolve => { release = resolve }) })
  await Promise.resolve(); owner.stop()
  expect(observed?.aborted).toBe(true); expect(owner.snapshot()).toEqual({ admissionClosed: true, pendingTasks: 1 })
  expect(await owner.waitForIdle(0)).toBe(false)
  await expect(owner.run(async () => 1)).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  release(); await pending; expect(await owner.waitForIdle(0)).toBe(true)
})
it('rejected work drains and removes the caller cancellation listener', async () => {
  const owner = new PublicMarketWorkOwner(), parent = new AbortController(), remove = vi.spyOn(parent.signal, 'removeEventListener')
  await expect(owner.run(async () => { throw Error('fixture') }, parent.signal)).rejects.toThrow('fixture')
  expect(remove).toHaveBeenCalled(); expect(await owner.waitForIdle(0)).toBe(true)
})
it('owned cancellation reason contains no caller-provided secrets', async () => {
  const owner = new PublicMarketWorkOwner(), parent = new AbortController()
  const pending = owner.run(signal => new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))), parent.signal)
  await Promise.resolve(); parent.abort('ACCOUNT_PRIVATE sk-private D:/private')
  await expect(pending).rejects.toBeInstanceOf(LocalWorkCancelledError)
  await expect(pending).rejects.not.toThrow(/PRIVATE|sk-private/)
})
it('cancelled default wait releases its timer', async () => {
  vi.useFakeTimers(); const parent = new AbortController(), waiting = localWorkDelay(60000, parent.signal), result = expect(waiting).rejects.toMatchObject({ code: 'LOCAL_WORK_CANCELLED' })
  parent.abort(); await result; expect(vi.getTimerCount()).toBe(0)
})
it('request cleanup releases timeout and forwarded abort listener', () => {
  vi.useFakeTimers(); const parent = new AbortController(), request = publicRequestSignal(parent.signal, 15000)
  expect(vi.getTimerCount()).toBe(1); parent.abort('private'); expect(request.signal.reason).toBeInstanceOf(LocalWorkCancelledError)
  request.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('wait deadline is not proof of completion and can be retried', async () => {
  vi.useFakeTimers(); const owner = new PublicMarketWorkOwner(); let release!: () => void
  const pending = owner.run(() => new Promise<void>(resolve => { release = resolve })); await Promise.resolve()
  const waited = owner.waitForIdle(5); await vi.advanceTimersByTimeAsync(5)
  expect(await waited).toBe(false); expect(owner.snapshot().pendingTasks).toBe(1); expect(vi.getTimerCount()).toBe(0)
  release(); await pending; expect(await owner.waitForIdle(0)).toBe(true)
})
