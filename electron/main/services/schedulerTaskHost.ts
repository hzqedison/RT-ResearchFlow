/**
 * Pure lifecycle ownership for scheduler timers and admitted asynchronous work.
 * Clearing timers invalidates admission, but does not cancel promises already running.
 */
export interface SchedulerScope {
  readonly generation: number
  readonly revision: number
  readonly key: string
}

export interface SchedulerIdleResult {
  idle: boolean
  timedOut: boolean
  pendingTasks: number
}

type TimerHandle = ReturnType<typeof setTimeout>
type OwnedTimer = { handle: TimerHandle; interval: boolean }

export class SchedulerTaskHost {
  private active = false
  private generation = 0
  private readonly revisions = new Map<string, number>()
  private readonly timers = new Map<string, OwnedTimer>()
  private readonly tasks = new Set<Promise<unknown>>()
  private readonly idleListeners = new Set<() => void>()

  get running(): boolean { return this.active }

  start(): boolean {
    if (this.active) return false
    this.active = true
    this.generation += 1
    return true
  }

  stop(): void {
    if (this.active) this.generation += 1
    this.active = false
    for (const timer of this.timers.values()) this.clear(timer)
    this.timers.clear()
    this.revisions.clear()
  }

  replaceScope(key: string): SchedulerScope {
    const timer = this.timers.get(key)
    if (timer) this.clear(timer)
    this.timers.delete(key)
    const revision = (this.revisions.get(key) ?? 0) + 1
    this.revisions.set(key, revision)
    return { generation: this.generation, revision, key }
  }

  isCurrent(scope: SchedulerScope): boolean {
    return this.active && scope.generation === this.generation
      && this.revisions.get(scope.key) === scope.revision
  }

  run<T>(task: () => T | Promise<T>): Promise<T> {
    const promise = Promise.resolve().then(task)
    this.tasks.add(promise)
    const finish = (): void => {
      this.tasks.delete(promise)
      if (this.tasks.size === 0) {
        for (const listener of [...this.idleListeners]) listener()
      }
    }
    // Handle both outcomes without creating an unobserved rejected finally promise.
    void promise.then(finish, finish)
    return promise
  }

  timeout(scope: SchedulerScope, task: () => void | Promise<void>, delayMs: number): TimerHandle | null {
    if (!this.isCurrent(scope)) return null
    const previous = this.timers.get(scope.key)
    if (previous) this.clear(previous)
    const handle = setTimeout(() => {
      if (this.timers.get(scope.key)?.handle !== handle) return
      this.timers.delete(scope.key)
      if (!this.isCurrent(scope)) return
      void this.run(() => {
        if (this.isCurrent(scope)) return task()
      }).catch(() => {
        // Business callbacks keep their own contextual reporting; rejection must not
        // become an unhandled timer promise or leave the idle registry stuck.
      })
    }, delayMs)
    this.timers.set(scope.key, { handle, interval: false })
    return handle
  }

  interval(scope: SchedulerScope, task: () => void | Promise<void>, delayMs: number): TimerHandle | null {
    if (!this.isCurrent(scope)) return null
    const previous = this.timers.get(scope.key)
    if (previous) this.clear(previous)
    let busy = false
    const handle = setInterval(() => {
      if (!this.isCurrent(scope) || busy) return
      busy = true
      void this.run(() => {
        if (this.isCurrent(scope)) return task()
      }).then(
        () => { busy = false },
        () => { busy = false },
      )
    }, delayMs)
    this.timers.set(scope.key, { handle, interval: true })
    return handle
  }

  waitForIdle(timeoutMs: number): Promise<SchedulerIdleResult> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      return Promise.reject(new RangeError('timeoutMs must be finite and non-negative'))
    }
    if (this.tasks.size === 0) return Promise.resolve({ idle: true, timedOut: false, pendingTasks: 0 })
    if (timeoutMs === 0) return Promise.resolve({ idle: false, timedOut: true, pendingTasks: this.tasks.size })
    return new Promise((resolve) => {
      let done = false
      const finish = (timedOut: boolean): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        this.idleListeners.delete(onIdle)
        resolve({ idle: this.tasks.size === 0, timedOut, pendingTasks: this.tasks.size })
      }
      const onIdle = (): void => finish(false)
      const timer = setTimeout(() => finish(true), Math.min(timeoutMs, 2_147_483_647))
      this.idleListeners.add(onIdle)
    })
  }

  private clear(timer: OwnedTimer): void {
    if (timer.interval) clearInterval(timer.handle)
    else clearTimeout(timer.handle)
  }
}
