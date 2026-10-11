import { describe, expect, it } from 'vitest'
import { closeSync, copyFileSync, fstatSync, ftruncateSync, mkdtempSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WindowsRepairDurableJournal } from '../../electron/main/services/windowsInstallRepairRecovery'
import { createReviewedWindowsRepairStdinBinding } from '../../scripts/windows-install-repair-reviewed-binding'

describe('reviewed Windows repair stdin binding', () => {
  it('rejects non-owned roots without loading native code', () => {
    for (const root of ['C:\\Program Files\\RT-ResearchFlow', 'D:\\other\\payload',
      'D:\\RT-ResearchFlow-BuildCache\\windows-repair-owned-1.7\\payload\\other']) {
      expect(() => createReviewedWindowsRepairStdinBinding(root)).toThrow('WINDOWS_REPAIR_STDIN_BINDING_REJECTED')
    }
  })
  it('exposes the existing reviewed port contract without loading native code', () => {
    const binding = createReviewedWindowsRepairStdinBinding(
      'D:\\RT-ResearchFlow-BuildCache\\windows-repair-owned-1.7\\payload')
    expect(Object.keys(binding)).toEqual(['readInheritedAnonymousStdin', 'systemRoot',
      'assertOwnedRoots', 'deriveReviewedPolicy', 'collectNonRegistrySnapshot',
      'journalPorts', 'recoveryJournalPorts', 'verifyNativeCompletion'])
    expect(Object.isFrozen(binding)).toBe(true)
  })
  it('does not infer old product identity from a detached receipt or a missing static rule', async () => {
    const binding = createReviewedWindowsRepairStdinBinding(
      'D:\\RT-ResearchFlow-BuildCache\\windows-repair-owned-1.7\\payload')
    await expect(binding.deriveReviewedPolicy({ receipt: { appId: 'rt.repair.fixture.' + 'a'.repeat(32) } } as never,
      { directParentRunning: true } as never)).rejects.toThrow()
  })
  it('refuses caller-selected journal completion without an active native context', async () => {
    const binding = createReviewedWindowsRepairStdinBinding(
      'D:\\RT-ResearchFlow-BuildCache\\windows-repair-owned-1.7\\payload')
    await expect(binding.verifyNativeCompletion({ kind: 'journal-committed', journalPath: 'D:\\fake.journal' },
      {} as never)).rejects.toThrow('WINDOWS_REPAIR_STDIN_BINDING_REJECTED')
  })
  it('binds cold replay to the original open journal object, not a replacement path', () => {
    const root = mkdtempSync(join(tmpdir(), 'rt-reviewed-journal-pin-'))
    const name = 'a'.repeat(32) + '.journal'
    const binding = { consumerSha256: 'a'.repeat(64), producerSha256: 'b'.repeat(64),
      planSha256: 'c'.repeat(64), target: 'D:\\Program Files\\RT-ResearchFlow',
      appId: 'rt.repair.fixture.' + 'd'.repeat(32), scope: 'per-user' as const, view: '64' as const }
    const before = { identity: 'absent', bytes: null }
    const after = { identity: 'present', bytes: '{}' }
    const operations = [{ id: 'file:a', before, after },
      { id: 'registry-install:fixture', before, after },
      { id: 'registry-uninstall:fixture', before, after }]
    const journal = WindowsRepairDurableJournal.open(root, name, binding, operations)
    WindowsRepairDurableJournal.pinColdReopen(journal)
    journal.close()
    const same = WindowsRepairDurableJournal.reopen(root, name)
    expect(same.binding().producerSha256).toBe(binding.producerSha256)
    same.close()
    const again = WindowsRepairDurableJournal.reopen(root, name)
    WindowsRepairDurableJournal.pinColdReopen(again)
    again.close()
    const file = join(root, name)
    renameSync(file, file + '.old')
    copyFileSync(file + '.old', file)
    expect(() => WindowsRepairDurableJournal.reopen(root, name)).toThrow('journal-identity')
  })
  it('rejects a valid journal chain rewritten in place after cold replay review', () => {
    const root = mkdtempSync(join(tmpdir(), 'rt-reviewed-journal-content-'))
    const name = 'c'.repeat(32) + '.journal'
    const alternateName = 'd'.repeat(32) + '.journal'
    const binding = { consumerSha256: 'a'.repeat(64), producerSha256: 'b'.repeat(64),
      planSha256: 'c'.repeat(64), target: 'D:\\Program Files\\RT-ResearchFlow',
      appId: 'rt.repair.fixture.' + 'd'.repeat(32), scope: 'per-user' as const, view: '64' as const }
    const before = { identity: 'absent', bytes: null }
    const after = { identity: 'present', bytes: '{}' }
    const operations = [{ id: 'file:a', before, after },
      { id: 'registry-install:fixture', before, after },
      { id: 'registry-uninstall:fixture', before, after }]
    const original = WindowsRepairDurableJournal.open(root, name, binding, operations)
    WindowsRepairDurableJournal.pinColdReopen(original)
    original.close()
    const alternate = WindowsRepairDurableJournal.open(root, alternateName,
      { ...binding, producerSha256: 'e'.repeat(64) }, operations)
    alternate.close()
    const file = join(root, name)
    const fd = openSync(file, 'r+')
    const inode = fstatSync(fd, { bigint: true }).ino
    try {
      ftruncateSync(fd, 0)
      writeFileSync(fd, readFileSync(join(root, alternateName)))
      expect(fstatSync(fd, { bigint: true }).ino).toBe(inode)
    } finally { closeSync(fd) }
    expect(() => WindowsRepairDurableJournal.reopen(root, name)).toThrow('journal-identity')
  })
})
