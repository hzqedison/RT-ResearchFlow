import { describe, expect, it, vi } from 'vitest'
import {
  assertRunningPrivateNode, parseWindowsRepairConsumerPaths, prepareWindowsRepairConsumerExecution,
  runWindowsRepairConsumerCli,
} from '../../scripts/windows-install-repair-consumer'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const validPaths = [
  '--receipt', 'D:\\receipt.json', '--signature', 'D:\\receipt.sig',
  '--installer', 'D:\\final.exe', '--program-root', 'D:\\payload',
  '--runtime-seal', 'D:\\seal.json', '--private-node', 'D:\\node.exe',
  '--native-host', 'D:\\host.ps1', '--job-host', 'D:\\job.exe',
]
describe('Windows repair consumer entry', () => {
  it('accepts only artifact locations, never caller nonce, consent, key or plan', () => {
    expect(parseWindowsRepairConsumerPaths(validPaths)['program-root']).toBe('D:\\payload')
    for (const forbidden of ['nonce', 'consent', 'registry-key', 'policy', 'plan', 'sid']) {
      expect(() => parseWindowsRepairConsumerPaths([...validPaths, '--' + forbidden, 'caller'])).toThrow()
    }
    expect(() => parseWindowsRepairConsumerPaths([...validPaths.slice(0, -2), '--receipt', 'again'])).toThrow()
  })
  it('rejects missing reviewed handle-pipe and plan/execute ports before file access', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(await runWindowsRepairConsumerCli(validPaths, {} as never, {} as never)).toBe(23)
      expect(stderr).toHaveBeenCalledWith('WINDOWS_REPAIR_CONSUMER_REJECTED\n')
      await expect(prepareWindowsRepairConsumerExecution(validPaths, {} as never, {
        readReviewedInstallerChannel: async () => ({ nonce: new Uint8Array(32), explicitConsent: true }),
      } as never)).rejects.toThrow('WINDOWS_REPAIR_CONSUMER_REJECTED')
    } finally { stderr.mockRestore() }
  })
  it('binds the running Node path and bytes to the signed privateNode', () => {
    const root = join('D:\\RT-ResearchFlow-BuildCache', 'repair-node-identity-' + randomUUID())
    mkdirSync(root)
    const declared = join(root, 'node.exe'), copy = join(root, 'copy.exe')
    try {
      writeFileSync(declared, 'reviewed-node-bytes')
      copyFileSync(declared, copy)
      const approved = createHash('sha256').update('reviewed-node-bytes').digest('hex')
      expect(() => assertRunningPrivateNode(declared, approved, declared)).not.toThrow()
      expect(() => assertRunningPrivateNode(declared, approved, copy)).toThrow()
      expect(() => assertRunningPrivateNode(declared, '0'.repeat(64), declared)).toThrow()
    } finally { unlinkSync(copy); unlinkSync(declared); rmdirSync(root) }
  })
})
