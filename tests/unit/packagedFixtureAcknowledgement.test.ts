import { describe, expect, it, vi } from 'vitest'
import { installFixtureWithAcknowledgement } from '../e2e/packagedFixtureAcknowledgement'

describe('packaged fixture acknowledgement', () => {
  it('confirms a successful installation exactly once', async () => {
    const install = vi.fn().mockResolvedValue(undefined), confirm = vi.fn().mockResolvedValue(undefined)
    await installFixtureWithAcknowledgement(install, confirm)
    expect(install).toHaveBeenCalledTimes(1); expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('recovers a lost response by confirmation, never by repeating installation', async () => {
    const install = vi.fn().mockRejectedValue(new Error('electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.'))
    const confirm = vi.fn().mockResolvedValue(undefined)
    await installFixtureWithAcknowledgement(install, confirm)
    expect(install).toHaveBeenCalledTimes(1); expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('fails on incomplete confirmation after a lost response', async () => {
    const install = vi.fn().mockRejectedValue(new Error('Execution context was destroyed, most likely because of a navigation.'))
    const confirm = vi.fn().mockRejectedValue(new Error('INCOMPLETE_FIXTURE_RECEIPT'))
    await expect(installFixtureWithAcknowledgement(install, confirm)).rejects.toThrow('INCOMPLETE_FIXTURE_RECEIPT')
    expect(install).toHaveBeenCalledTimes(1); expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('does not waive unrelated installation errors', async () => {
    const failure = new Error('ISOLATED_STORAGE_REQUIRED'), install = vi.fn().mockRejectedValue(failure), confirm = vi.fn()
    await expect(installFixtureWithAcknowledgement(install, confirm)).rejects.toBe(failure)
    expect(install).toHaveBeenCalledTimes(1); expect(confirm).not.toHaveBeenCalled()
  })
  it('requires confirmation even after a successful RPC', async () => {
    const install = vi.fn().mockResolvedValue(undefined), confirm = vi.fn().mockRejectedValue(new Error('INCOMPLETE_FIXTURE_RECEIPT'))
    await expect(installFixtureWithAcknowledgement(install, confirm)).rejects.toThrow('INCOMPLETE_FIXTURE_RECEIPT')
    expect(install).toHaveBeenCalledTimes(1); expect(confirm).toHaveBeenCalledTimes(1)
  })
})
