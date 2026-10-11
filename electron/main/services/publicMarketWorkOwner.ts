export class LocalWorkCancelledError extends Error {
  readonly code = 'LOCAL_WORK_CANCELLED'
  constructor() { super('LOCAL_WORK_CANCELLED'); this.name = 'AbortError' }
}
export function isLocalWorkCancelled(error: unknown): boolean {
  return error instanceof LocalWorkCancelledError || !!error && typeof error === 'object' && 'code' in error && error.code === 'LOCAL_WORK_CANCELLED'
}
export function checkLocalWork(signal?: AbortSignal): void { if (signal?.aborted) throw new LocalWorkCancelledError() }
export function waitForLocalWork<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending
  if (signal.aborted) { void pending.catch(() => undefined); return Promise.reject(new LocalWorkCancelledError()) }
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(new LocalWorkCancelledError()) }
    signal.addEventListener('abort', aborted, { once: true })
    pending.then(value => { signal.removeEventListener('abort', aborted); resolve(value) }, error => { signal.removeEventListener('abort', aborted); reject(error) })
  })
}
export function localWorkDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new LocalWorkCancelledError())
  return new Promise<void>((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(new LocalWorkCancelledError()) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve() }, Math.max(0, Math.min(ms, 2147483647)))
    signal?.addEventListener('abort', aborted, { once: true })
  })
}
export function publicRequestSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const aborted = () => controller.abort(new LocalWorkCancelledError())
  if (parent?.aborted) aborted(); else parent?.addEventListener('abort', aborted, { once: true })
  const timer = setTimeout(() => { const error = new Error('PUBLIC_REQUEST_TIMEOUT'); error.name = 'TimeoutError'; controller.abort(error) }, Math.max(1, Math.min(timeoutMs, 2147483647)))
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', aborted) } }
}
export class PublicMarketWorkOwner {
  private closed = false
  private readonly active = new Set<AbortController>()
  private readonly listeners = new Set<() => void>()
  assertAccepting(signal?: AbortSignal) { checkLocalWork(signal); if (this.closed) throw new LocalWorkCancelledError() }
  run<T>(task: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
    try { this.assertAccepting(parent) } catch (error) { return Promise.reject(error) }
    const controller = new AbortController(), aborted = () => controller.abort(new LocalWorkCancelledError())
    parent?.addEventListener('abort', aborted, { once: true }); this.active.add(controller)
    const pending = Promise.resolve().then(() => { checkLocalWork(controller.signal); return task(controller.signal) })
    const finish = () => {
      parent?.removeEventListener('abort', aborted); this.active.delete(controller)
      if (!this.active.size) for (const listener of [...this.listeners]) listener()
    }
    void pending.then(finish, finish)
    return pending
  }
  stop() { this.closed = true; for (const controller of this.active) controller.abort(new LocalWorkCancelledError()) }
  snapshot() { return { admissionClosed: this.closed, pendingTasks: this.active.size } }
  waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return Promise.reject(new RangeError('Invalid work deadline'))
    if (!this.active.size) return Promise.resolve(true)
    if (!timeoutMs) return Promise.resolve(false)
    return new Promise(resolve => {
      const finished = () => { clearTimeout(timer); this.listeners.delete(finished); resolve(this.active.size === 0) }
      const timer = setTimeout(finished, Math.min(timeoutMs, 2147483647)); this.listeners.add(finished)
    })
  }
}
export const publicMarketWorkOwner = new PublicMarketWorkOwner()
export const stopPublicMarketWork = () => publicMarketWorkOwner.stop()
export const waitForPublicMarketWorkIdle = (timeoutMs: number) => publicMarketWorkOwner.waitForIdle(timeoutMs)
