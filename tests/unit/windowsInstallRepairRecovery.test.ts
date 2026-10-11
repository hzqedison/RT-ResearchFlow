import { createHash, randomBytes } from 'node:crypto'
import { fsyncSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { WindowsRepairDurableJournal, WindowsRepairJournalCursor, applyRecoverableWindowsRepair, recoverWindowsRepairJournal } from '../../electron/main/services/windowsInstallRepairRecovery'
import type { WindowsRepairMutation, WindowsRepairRecoveryHost, WindowsRepairJournalIO } from '../../electron/main/services/windowsInstallRepairRecovery'

const hash = (s: string) => createHash('sha256').update(s).digest('hex')
function fixture(scope: 'per-user' | 'all-users' = 'all-users', io?: WindowsRepairJournalIO, created = false) {
  const root = mkdtempSync(join(tmpdir(), 'rt-repair-recovery-')), name = randomBytes(16).toString('hex') + '.journal'
  const binding = { consumerSha256: hash('reviewed-consumer'), producerSha256: hash('signed-producer'), planSha256: hash('fresh-plan'),
    target: 'D:\\Program Files\\RT-ResearchFlow', appId: 'fixture.repair', scope, view: '64' as const }
  const ids = ['file:RT-ResearchFlow.exe', 'registry-install:fixture', 'registry-uninstall:fixture']
  const operations: WindowsRepairMutation[] = ids.map((id, i) => ({ id, before: { identity: 'owned-' + i, bytes: 'old-' + i }, after: { identity: 'owned-' + i, bytes: 'new-' + i } }))
  if (created) { operations[0].before = { identity: 'absent', bytes: null }; operations[0].after.identity = 'pending-owned-create' }
  const state = operations.map(x => ({ ...x.before })), foreign = Buffer.from('foreign DProgram 1099'), data = Buffer.from('database-and-backup'), writes: number[] = []
  let fault: number | null = null, changed = false, failComplete = false
  const host: WindowsRepairRecoveryHost = {
    async assertProtectedFactsUnchanged() { if (changed) throw new Error('protected-path-change') },
    async read(op) { return { ...state[ids.indexOf(op.id)] } },
    async writeChecked(op, expected, next) {
      const index = ids.indexOf(op.id)
      expect(state[index]).toEqual(expected)
      state[index] = { ...next, identity: next.identity === 'pending-owned-create' ? 'win32:00000001:00000002:00000003' : next.identity }; writes.push(index)
      if (fault === index && next.bytes?.startsWith('new-')) throw new Error('owned-child-failed-after-write')
      return { ...state[index] }
    },
    async verifyComplete() { if (failComplete) throw new Error('terminal-collector-failure'); expect(state).toEqual(operations.map(x => x.after)) },
  }
  let journal = WindowsRepairDurableJournal.open(root, name, binding, operations, io)
  return { root, binding, operations, state, host, foreign, data, writes,
    get journal() { return journal }, setFault(i: number) { fault = i }, setProtectedChange() { changed = true }, setTerminalFailure() { failComplete = true },
    reopen() { journal.close(); journal = WindowsRepairDurableJournal.open(root, name, binding, operations) },
    close() { journal.close(); rmSync(root, { recursive: true, force: true }) } }
}

describe('durable repair recovery, real isolated journal IO; registry/native effects are seams', () => {
  it.each(['per-user', 'all-users'] as const)('commits both keys only after the program and independently reads back %s', async scope => {
    const f = fixture(scope)
    try { expect(await applyRecoverableWindowsRepair(f.journal, f.operations, f.host)).toEqual({ kind: 'journal-committed', independentlyAccepted: false }); expect(f.writes).toEqual([0, 1, 2]); f.reopen(); expect(await recoverWindowsRepairJournal(f.journal, f.operations, f.host)).toBe('committed') } finally { f.close() }
  })
  it.each([0, 1, 2])('compensates a child failure after mutation %i, including the second key', async fault => {
    const f = fixture()
    try { f.setFault(fault); await expect(applyRecoverableWindowsRepair(f.journal, f.operations, f.host)).rejects.toThrow('rolled-back'); expect(f.state).toEqual(f.operations.map(x => x.before)); expect(f.journal.events().at(-1)?.kind).toBe('rolled-back'); expect(f.foreign.toString()).toBe('foreign DProgram 1099'); expect(f.data.toString()).toBe('database-and-backup') } finally { f.close() }
  })
  it('recovers a durable intent when the process exits before its applied reply', async () => {
    const f = fixture()
    try { f.journal.append({ kind: 'intent', index: 0 }); f.state[0] = { ...f.operations[0].after }; f.reopen(); expect(await recoverWindowsRepairJournal(f.journal, f.operations, f.host)).toBe('rolled-back'); expect(f.state).toEqual(f.operations.map(x => x.before)) } finally { f.close() }
  })
  it('retains the journal and refuses to overwrite concurrent foreign values', async () => {
    const f = fixture()
    try { f.journal.append({ kind: 'intent', index: 0 }); f.state[0] = { ...f.operations[0].after }; f.journal.append({ kind: 'applied', index: 0 }); f.journal.append({ kind: 'intent', index: 1 }); f.state[1] = { identity: 'foreign-key', bytes: 'foreign-change' }; await expect(recoverWindowsRepairJournal(f.journal, f.operations, f.host)).rejects.toThrow('recovery-required'); expect(f.state[1].bytes).toBe('foreign-change'); expect(f.writes).toEqual([]); expect(readFileSync(f.journal.path, 'utf8')).toContain('recovery-required') } finally { f.close() }
  })
  it('preserves program data and compensates a final independent verification failure', async () => {
    const f = fixture()
    try { f.setTerminalFailure(); await expect(applyRecoverableWindowsRepair(f.journal, f.operations, f.host)).rejects.toThrow('rolled-back'); expect(f.writes).toEqual([0, 1, 2, 2, 1, 0]); expect(f.state).toEqual(f.operations.map(x => x.before)) } finally { f.close() }
  })
  it('rejects protected directory identity change before mutation', async () => {
    const f = fixture()
    try { f.setProtectedChange(); await expect(applyRecoverableWindowsRepair(f.journal, f.operations, f.host)).rejects.toThrow('recovery-required'); expect(f.writes).toEqual([]) } finally { f.close() }
  })
  it('rejects a truncated or modified journal rather than assuming no prior effects', () => {
    const f = fixture()
    try { const file = f.journal.path; f.journal.close(); writeFileSync(file, readFileSync(file).subarray(0, 12)); expect(() => f.reopen()).toThrow('journal-truncated') } finally { f.close() }
  })
  it.each(['replace', 'reorder', 'before', 'after'])('refuses %s operations unrelated to its durable begin, with zero writes', async kind => {
    const f = fixture()
    try {
      const other = structuredClone(f.operations)
      if (kind === 'replace') other[0].id = 'file:foreign.exe'
      if (kind === 'reorder') [other[1], other[2]] = [other[2], other[1]]
      if (kind === 'before') other[0].before.bytes = 'foreign-before'
      if (kind === 'after') other[0].after.bytes = 'foreign-after'
      await expect(applyRecoverableWindowsRepair(f.journal, other, f.host)).rejects.toThrow()
      await expect(recoverWindowsRepairJournal(f.journal, other, f.host)).rejects.toThrow()
      expect(f.writes).toEqual([]); expect(f.journal.events()).toHaveLength(1)
    } finally { f.close() }
  })
  it('does not expose mutable journal events or retain caller-owned begin references', async () => {
    const f = fixture()
    try {
      const events = f.journal.events() as any
      expect(() => { events[0].operations[0].after.bytes = 'injected' }).toThrow()
      f.operations[0].after.bytes = 'changed-after-open'
      await expect(applyRecoverableWindowsRepair(f.journal, f.operations, f.host)).rejects.toThrow('operation-binding')
      expect(f.writes).toEqual([])
      expect((f.journal.events()[0] as any).operations[0].after.bytes).toBe('new-0')
    } finally { f.close() }
  })
  it.each(['skipped-intent', 'applied-without-intent', 'early-commit', 'early-rollback', 'duplicate-begin'])('rejects %s before persisting an impossible event', kind => {
    const f = fixture()
    try {
      if (kind === 'early-rollback') f.journal.append({ kind: 'intent', index: 0 })
      const before = readFileSync(f.journal.path, 'utf8')
      const event: any = kind === 'skipped-intent' ? { kind: 'intent', index: 1 }
        : kind === 'applied-without-intent' ? { kind: 'applied', index: 0 }
        : kind === 'early-commit' ? { kind: 'committed' }
        : kind === 'early-rollback' ? { kind: 'rolled-back' }
        : { kind: 'begin', binding: f.binding, operations: f.operations }
      expect(() => f.journal.append(event)).toThrow()
      expect(readFileSync(f.journal.path, 'utf8')).toBe(before)
      expect(f.writes).toEqual([])
    } finally { f.close() }
  })
  it('processes ten thousand forward and restore operations with one transition check per event', () => {
    const f = fixture()
    try {
      const operations: WindowsRepairMutation[] = Array.from({ length: 9998 }, (_, index) => ({ ...f.operations[0], id: 'file:member-' + index }))
      operations.push(...f.operations.slice(1))
      const begin = { kind: 'begin' as const, binding: f.binding, operations }
      const forward = new WindowsRepairJournalCursor(begin), recovery = new WindowsRepairJournalCursor(begin)
      for (let index = 0; index < operations.length; index++) {
        for (const cursor of [forward, recovery]) {
          cursor.advance({ kind: 'intent', index }); cursor.advance({ kind: 'applied', index })
        }
      }
      forward.advance({ kind: 'committed' })
      expect(forward.summary().transitionChecks).toBe(20002)
      recovery.advance({ kind: 'recovery-required' })
      for (let index = operations.length - 1; index >= 0; index--) recovery.advance({ kind: 'restored', index })
      recovery.advance({ kind: 'rolled-back' })
      expect(recovery.summary().transitionChecks).toBe(30003)
      expect(recovery.summary().restoreCursor).toBe(-1)
      expect(() => recovery.advance({ kind: 'intent', index: 0 })).toThrow()
      expect(recovery.summary().transitionChecks).toBe(30003)
    } finally { f.close() }
  })
  it('does not advance the state when persistence fails', () => {
    const f = fixture()
    try {
      const cursor = new WindowsRepairJournalCursor({ kind: 'begin', binding: f.binding, operations: f.operations })
      const before = cursor.summary()
      expect(() => cursor.advance({ kind: 'intent', index: 0 }, () => { throw new Error('DISK_FULL') })).toThrow('DISK_FULL')
      expect(cursor.summary()).toEqual(before)
      cursor.advance({ kind: 'intent', index: 0 })
      expect(cursor.summary().pending).toBe(0)
    } finally { f.close() }
  })
  it.each(['partial-write', 'fsync-after-frame'])('poisons a real journal after %s, preserving bytes without continuing effects', async fault => {
    let armed = false
    const io: WindowsRepairJournalIO = {
      write(fd, bytes, offset) {
        if (armed && fault === 'partial-write') {
          writeSync(fd, bytes, offset, Math.min(31, bytes.length - offset))
          throw new Error('INJECTED_PARTIAL_DISK_WRITE')
        }
        return writeSync(fd, bytes, offset)
      },
      sync(fd) { fsyncSync(fd); if (armed && fault === 'fsync-after-frame') throw new Error('INJECTED_UNCERTAIN_FSYNC') },
    }
    const f = fixture('all-users', io)
    try {
      armed = true
      await expect(applyRecoverableWindowsRepair(f.journal, f.operations, f.host)).rejects.toThrow('recovery-required')
      expect(f.journal.isPoisoned()).toBe(true); expect(f.writes).toEqual([])
      const retained = readFileSync(f.journal.path)
      expect(() => f.journal.append({ kind: 'recovery-required' })).toThrow('recovery-required')
      await expect(recoverWindowsRepairJournal(f.journal, f.operations, f.host)).rejects.toThrow('recovery-required')
      expect(readFileSync(f.journal.path)).toEqual(retained)
      expect(retained.toString()).not.toContain('rolled-back')
      if (fault === 'partial-write') expect(() => f.reopen()).toThrow('journal-truncated')
      else { f.reopen(); expect(await recoverWindowsRepairJournal(f.journal, f.operations, f.host)).toBe('rolled-back') }
    } finally { f.close() }
  })
  it('does not compensate on a poisoned descriptor after a real host mutation', async () => {
    let syncCount = 0
    const io: WindowsRepairJournalIO = { write: (fd, bytes, offset) => writeSync(fd, bytes, offset),
      sync(fd) { fsyncSync(fd); if (++syncCount === 3) throw new Error('INJECTED_APPLIED_FSYNC') } }
    const f = fixture('all-users', io)
    try {
      await expect(applyRecoverableWindowsRepair(f.journal, f.operations, f.host)).rejects.toThrow('recovery-required')
      expect(f.writes).toEqual([0]); expect(f.state[0]).toEqual(f.operations[0].after)
      expect(f.journal.isPoisoned()).toBe(true)
      const retained = readFileSync(f.journal.path)
      await expect(recoverWindowsRepairJournal(f.journal, f.operations, f.host)).rejects.toThrow('recovery-required')
      expect(f.writes).toEqual([0]); expect(readFileSync(f.journal.path)).toEqual(retained)
      expect(retained.toString()).not.toContain('rolled-back')
      f.reopen()
      expect(await recoverWindowsRepairJournal(f.journal, f.operations, f.host)).toBe('rolled-back')
      expect(f.writes).toEqual([0, 0]); expect(f.state).toEqual(f.operations.map(operation => operation.before))
    } finally { f.close() }
  })
})

describe('actual created-file identity is durable before compensation authority', () => {
  it('records owned-after then deletes only the known created identity on failed verification', async () => {
    const f = fixture('all-users', undefined, true)
    try {
      f.setTerminalFailure()
      await expect(applyRecoverableWindowsRepair(f.journal, f.operations, f.host)).rejects.toThrow('rolled-back')
      expect(f.state).toEqual(f.operations.map(operation => operation.before))
      expect(f.journal.events().map(event => event.kind)).toContain('owned-after')
      expect(f.journal.resolvedOperation(0).after.identity).toBe('win32:00000001:00000002:00000003')
    } finally { f.close() }
  })
  it('retains unknown creation when a native child fails before its ownership reply', async () => {
    const f = fixture('all-users', undefined, true)
    try {
      f.setFault(0)
      await expect(applyRecoverableWindowsRepair(f.journal, f.operations, f.host)).rejects.toThrow('recovery-required')
      expect(f.writes).toEqual([0])
      expect(f.state[0].identity).toBe('win32:00000001:00000002:00000003')
      expect(f.journal.events().some(event => event.kind === 'owned-after')).toBe(false)
      f.reopen()
      await expect(recoverWindowsRepairJournal(f.journal, f.operations, f.host)).rejects.toThrow('recovery-required')
      expect(f.writes).toEqual([0])
    } finally { f.close() }
  })
  it.each(['identity', 'bytes', 'before-intent', 'duplicate'])('rejects %s ownership evidence', kind => {
    const f = fixture('all-users', undefined, true)
    try {
      if (kind !== 'before-intent') f.journal.append({ kind: 'intent', index: 0 })
      const event = { kind: 'owned-after' as const, index: 0, image: { identity: 'win32:00000001:00000002:00000003', bytes: 'new-0' } }
      if (kind === 'identity') event.image.identity = 'pending-owned-create'
      if (kind === 'bytes') event.image.bytes = 'different'
      if (kind === 'duplicate') f.journal.append(event)
      expect(() => f.journal.append(event)).toThrow('journal-owned-after')
    } finally { f.close() }
  })
  it('replays known creation from disk and never grants delete from just name/hash', async () => {
    const f = fixture('all-users', undefined, true)
    try {
      f.journal.append({ kind: 'intent', index: 0 })
      const actual = { identity: 'win32:00000001:00000002:00000003', bytes: 'new-0' }
      f.journal.append({ kind: 'owned-after', index: 0, image: actual })
      f.state[0] = actual
      f.reopen()
      expect(f.journal.resolvedOperation(0).after).toEqual(actual)
      expect(await recoverWindowsRepairJournal(f.journal, f.operations, f.host)).toBe('rolled-back')
      expect(f.state[0]).toEqual({ identity: 'absent', bytes: null })
    } finally { f.close() }
  })
  it('runs the post-program gate inside the same journal before either key', async () => {
    const f = fixture()
    try {
      f.host.verifyProgramStage = async () => { throw new Error('stage-not-verified') }
      await expect(applyRecoverableWindowsRepair(f.journal, f.operations, f.host)).rejects.toThrow('rolled-back')
      expect(f.writes).toEqual([0, 0]); expect(f.state).toEqual(f.operations.map(operation => operation.before))
    } finally { f.close() }
  })
})
