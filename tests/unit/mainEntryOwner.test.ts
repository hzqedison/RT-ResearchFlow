import { describe, expect, it, vi } from 'vitest'
import { claimMainEntryOwner, mainEntryOwnerKey } from '../../electron/main/mainEntryOwner'

describe('process-wide main entry owner', () => {
  it('publishes a pending owner before work and shares only the first lifecycle', async () => {
    const host = {}
    const first = claimMainEntryOwner(host, 'version/build/path')
    expect(first.acquired).toBe(true)
    if (!first.acquired) throw new Error('FIRST_CLAIM_FAILED')
    expect(first.owner.phase).toBe('starting')
    const second = claimMainEntryOwner(host, 'version/build/path')
    expect(second.acquired).toBe(false)
    expect(second.owner).toBe(first.owner)
    expect(second.owner.startupPromise).toBe(first.owner.startupPromise)
    expect(second.owner.suppressedEvaluations).toBe(1)
    first.complete()
    await expect(first.owner.startupPromise).resolves.toBeUndefined()
    expect(second.owner.phase).toBe('ready')
  })

  it('retains the first partial failure and never executes duplicate initialization', async () => {
    const host = {}
    const installIpc = vi.fn()
    const initializeData = vi.fn()
    const enter = () => {
      const claim = claimMainEntryOwner(host, 'same-build')
      if (claim.acquired) {
        installIpc()
        initializeData()
      }
      return claim
    }
    const first = enter()
    if (!first.acquired) throw new Error('FIRST_CLAIM_FAILED')
    const failure = new Error('PARTIAL_STARTUP_FAILED')
    first.fail(failure)
    const second = enter()
    expect(second.acquired).toBe(false)
    expect(second.owner.phase).toBe('failed')
    expect(second.owner.startupPromise).toBe(first.owner.startupPromise)
    expect(installIpc).toHaveBeenCalledTimes(1)
    expect(initializeData).toHaveBeenCalledTimes(1)
    first.complete()
    await expect(second.owner.startupPromise).rejects.toBe(failure)
    expect(second.owner.phase).toBe('failed')
  })

  it('fails closed for foreign or malformed owners', async () => {
    const host = {}
    const first = claimMainEntryOwner(host, 'build-A')
    if (!first.acquired) throw new Error('FIRST_CLAIM_FAILED')
    expect(() => claimMainEntryOwner(host, 'build-B')).toThrow('MAIN_ENTRY_OWNER_CONFLICT')
    first.fail(new Error('STOP'))
    await expect(first.owner.startupPromise).rejects.toThrow('STOP')

    const foreign = {}
    Object.defineProperty(foreign, mainEntryOwnerKey, { value: { protocol: 'foreign' } })
    expect(() => claimMainEntryOwner(foreign, 'build-A')).toThrow('MAIN_ENTRY_OWNER_CONFLICT')

    const forgedThenable = Object.seal({
      protocol: 'RT-ResearchFlow.main-owner.v1',
      buildIdentity: 'build-A',
      phase: 'starting',
      startupPromise: { then: () => undefined, catch: () => undefined },
      suppressedEvaluations: 0,
    })
    const forgedHost = {}
    Object.defineProperty(forgedHost, mainEntryOwnerKey, {
      value: forgedThenable, writable: false, configurable: false, enumerable: false,
    })
    expect(() => claimMainEntryOwner(forgedHost, 'build-A')).toThrow('MAIN_ENTRY_OWNER_CONFLICT')

    const writableHost = {}
    const plausibleOwner = Object.seal({
      protocol: 'RT-ResearchFlow.main-owner.v1',
      buildIdentity: 'build-A',
      phase: 'starting',
      startupPromise: Promise.resolve(),
      suppressedEvaluations: 0,
    })
    Object.defineProperty(writableHost, mainEntryOwnerKey, {
      value: plausibleOwner, writable: true, configurable: true, enumerable: false,
    })
    expect(() => claimMainEntryOwner(writableHost, 'build-A')).toThrow('MAIN_ENTRY_OWNER_CONFLICT')
  })
})
