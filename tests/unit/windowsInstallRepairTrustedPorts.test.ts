import { describe, expect, it, vi } from 'vitest'
import { createWindowsRepairTrustedPorts, recoverWindowsRepairTrustedJournal } from '../../scripts/windows-install-repair-trusted-ports'

const locations = [
  '--receipt', 'D:\\receipt.json', '--signature', 'D:\\receipt.sig',
  '--installer', 'D:\\final.exe', '--program-root',
  'D:\\RT-ResearchFlow-BuildCache\\windows-repair-owned-1.7\\payload',
  '--runtime-seal', 'D:\\seal.json', '--private-node', 'D:\\node.exe',
  '--native-host', 'D:\\host.ps1', '--job-host', 'D:\\job.exe',
]
const packet = () => Uint8Array.from([1, 1, ...Array.from({ length: 32 }, (_, i) => i + 1)])
describe('trusted repair ports', () => {
  it('accepts only the reviewed native inherited-pipe frame', async () => {
    const readInheritedAnonymousStdin = vi.fn(async () => ({
      kind: 'win32-inherited-anonymous-stdin-v1', packet: packet(), eof: true,
    }))
    const ports = createWindowsRepairTrustedPorts({ readInheritedAnonymousStdin } as never, locations)
    await expect(ports.readReviewedInstallerChannel()).rejects.toThrow('WINDOWS_REPAIR_TRUSTED_PORTS_REJECTED')
    expect(readInheritedAnonymousStdin).not.toHaveBeenCalled()
    const complete = { readInheritedAnonymousStdin, systemRoot: () => 'C:\\Windows',
      assertOwnedRoots: async () => {}, deriveReviewedPolicy: async () => ({}),
      collectNonRegistrySnapshot: async () => ({}), journalPorts: () => ({}),
      recoveryJournalPorts: () => ({}),
      verifyNativeCompletion: async () => false }
    const verified = createWindowsRepairTrustedPorts(complete as never, locations)
    const channel = await verified.readReviewedInstallerChannel()
    expect(channel.explicitConsent).toBe(true)
    expect([...channel.nonce]).toEqual([...packet().subarray(2)])
    expect(readInheritedAnonymousStdin).toHaveBeenCalledOnce()
  })
  it('rejects short, extra, absent-consent, nonpipe and non-EOF frames', async () => {
    const complete = { systemRoot: () => 'C:\\Windows', assertOwnedRoots: async () => {},
      deriveReviewedPolicy: async () => ({}), collectNonRegistrySnapshot: async () => ({}),
      journalPorts: () => ({}), recoveryJournalPorts: () => ({}), verifyNativeCompletion: async () => false }
    const bad = [
      { kind: 'win32-inherited-anonymous-stdin-v1', packet: packet().subarray(0, 33), eof: true },
      { kind: 'win32-inherited-anonymous-stdin-v1', packet: Uint8Array.from([1, 0, ...packet().subarray(2)]), eof: true },
      { kind: 'win32-inherited-anonymous-stdin-v1', packet: Uint8Array.from([...packet(), 1]), eof: true },
      { kind: 'caller-stdin', packet: packet(), eof: true },
      { kind: 'win32-inherited-anonymous-stdin-v1', packet: packet(), eof: false },
    ]
    for (const row of bad) {
      const ports = createWindowsRepairTrustedPorts({ ...complete, readInheritedAnonymousStdin: async () => row } as never, locations)
      await expect(ports.readReviewedInstallerChannel()).rejects.toThrow('WINDOWS_REPAIR_TRUSTED_PORTS_REJECTED')
    }
  })
  it('rejects argv nonce and any alternate program root', () => {
    expect(() => createWindowsRepairTrustedPorts({} as never, [...locations, '--nonce', 'caller'])).toThrow()
    const altered = [...locations]
    altered[7] = 'C:\\Program Files\\RT-ResearchFlow'
    const ports = createWindowsRepairTrustedPorts({} as never, altered)
    expect(ports).toBeDefined()
  })
  it('rejects an unbound cold journal before native or filesystem work', async () => {
    const binding = { systemRoot: vi.fn(() => 'C:\\Windows'), assertOwnedRoots: vi.fn(),
      recoveryJournalPorts: vi.fn() }
    await expect(recoverWindowsRepairTrustedJournal({} as never, {
      receipt: { installer: { sha256: 'a'.repeat(64) } },
    } as never, { directParentRunning: true, directParentImageSha256: 'a'.repeat(64) } as never,
    'not-a-journal', binding as never, locations)).rejects.toThrow('WINDOWS_REPAIR_TRUSTED_PORTS_REJECTED')
    expect(binding.systemRoot).not.toHaveBeenCalled()
    expect(binding.assertOwnedRoots).not.toHaveBeenCalled()
    expect(binding.recoveryJournalPorts).not.toHaveBeenCalled()
  })
})
