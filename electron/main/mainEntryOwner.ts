import { types as utilTypes } from 'node:util'

export type MainEntryPhase = 'starting' | 'ready' | 'failed'

export interface MainEntryOwner {
  protocol: 'RT-ResearchFlow.main-owner.v1'
  buildIdentity: string
  phase: MainEntryPhase
  startupPromise: Promise<void>
  suppressedEvaluations: number
}

export const mainEntryOwnerKey = Symbol.for('RT-ResearchFlow.main.owner.v1')

export type MainEntryClaim =
  | { acquired: true; owner: MainEntryOwner; complete: () => void; fail: (error: unknown) => void }
  | { acquired: false; owner: MainEntryOwner }

export function claimMainEntryOwner(host: object, buildIdentity: string): MainEntryClaim {
  const existing = Reflect.get(host, mainEntryOwnerKey) as unknown
  if (existing === undefined && !Reflect.has(host, mainEntryOwnerKey)) {
    let resolveStartup!: () => void
    let rejectStartup!: (error: unknown) => void
    const startupPromise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolveStartup = resolvePromise
      rejectStartup = rejectPromise
    })
    void startupPromise.catch(() => undefined)
    const owner: MainEntryOwner = Object.seal({
      protocol: 'RT-ResearchFlow.main-owner.v1',
      buildIdentity,
      phase: 'starting' as MainEntryPhase,
      startupPromise,
      suppressedEvaluations: 0,
    })
    Object.defineProperty(host, mainEntryOwnerKey, {
      value: owner, writable: false, configurable: false, enumerable: false,
    })
    let settled = false
    return {
      acquired: true,
      owner,
      complete: () => {
        if (settled) return
        settled = true
        owner.phase = 'ready'
        resolveStartup()
      },
      fail: (error) => {
        if (settled) return
        settled = true
        owner.phase = 'failed'
        rejectStartup(error)
      },
    }
  }

  if (!existing || typeof existing !== 'object' || !Object.isSealed(existing)) {
    throw new Error('MAIN_ENTRY_OWNER_CONFLICT')
  }
  const hostDescriptor = Object.getOwnPropertyDescriptor(host, mainEntryOwnerKey)
  if (!hostDescriptor || hostDescriptor.value !== existing
    || hostDescriptor.writable !== false || hostDescriptor.configurable !== false
    || hostDescriptor.enumerable !== false) {
    throw new Error('MAIN_ENTRY_OWNER_CONFLICT')
  }
  const owner = existing as MainEntryOwner
  const phaseDescriptor = Object.getOwnPropertyDescriptor(owner, 'phase')
  const countDescriptor = Object.getOwnPropertyDescriptor(owner, 'suppressedEvaluations')
  if (owner.protocol !== 'RT-ResearchFlow.main-owner.v1'
    || owner.buildIdentity !== buildIdentity
    || !['starting', 'ready', 'failed'].includes(owner.phase)
    || !Number.isSafeInteger(owner.suppressedEvaluations)
    || owner.suppressedEvaluations < 0
    || !phaseDescriptor?.writable || !countDescriptor?.writable
    || !utilTypes.isPromise(owner.startupPromise)) {
    throw new Error('MAIN_ENTRY_OWNER_CONFLICT')
  }
  owner.suppressedEvaluations += 1
  return { acquired: false, owner }
}
