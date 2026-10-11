import { createHash } from 'node:crypto'
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { WindowsRepairNativeJournalAuthorization } from './windowsInstallRepairNativeBackend'

// Internal host protocol. These operations are constructed from a verified
// producer by the consumer, never deserialized as an IPC authorization grant.
// Registry writes are NOT atomic: durable intents and conditional compensation
// cover both keys, including a child failure after its write but before reply.
export interface WindowsRepairImage { identity: string; bytes: string | null }
export interface WindowsRepairMutation {
  id: string; before: WindowsRepairImage; after: WindowsRepairImage
  // Native backups are immutable begin-frame evidence, not rollback requests.
  backup?: { name: string; image: WindowsRepairImage }
  forwardBackupName?: string
  restoreBackupName?: string
}
export interface WindowsRepairRecoveryBinding {
  consumerSha256: string; producerSha256: string; planSha256: string
  target: string; appId: string; scope: 'per-user' | 'all-users'; view: '32' | '64'
  nativeAuthorization?: WindowsRepairNativeJournalAuthorization
}
export interface WindowsRepairRecoveryHost {
  assertProtectedFactsUnchanged(): Promise<void>
  read(operation: WindowsRepairMutation): Promise<WindowsRepairImage>
  // The native implementation must recheck identities on its opened handles.
  // This is not an assertion of atomic compare-and-set on the Windows registry.
  writeChecked(operation: WindowsRepairMutation, expected: WindowsRepairImage, next: WindowsRepairImage): Promise<void | WindowsRepairImage>
  verifyProgramStage?(): Promise<void>
  verifyComplete(): Promise<void>
}
type Event = { kind: 'begin'; binding: WindowsRepairRecoveryBinding; operations: WindowsRepairMutation[] }
  | { kind: 'intent' | 'applied' | 'restored'; index: number }
  | { kind: 'owned-after'; index: number; image: WindowsRepairImage }
  | { kind: 'committed' | 'rolled-back' | 'recovery-required' }
type Frame = { sequence: number; previous: string; event: Event; sha256: string }
export interface WindowsRepairJournalIO {
  write(fd: number, bytes: Uint8Array, offset: number): number
  sync(fd: number): void
}
const nativeJournalIO: WindowsRepairJournalIO = { write: (fd, bytes, offset) => writeSync(fd, bytes, offset), sync: fsyncSync }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const same = (a: WindowsRepairImage, b: WindowsRepairImage) => a.identity === b.identity && a.bytes === b.bytes
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value) }
  return value
}
function fail(reason: string): never { throw new Error('WINDOWS_REPAIR_RECOVERY_FAILED:' + reason) }
function validateBinding(binding: WindowsRepairRecoveryBinding) {
  if (!binding || ![binding.consumerSha256, binding.producerSha256, binding.planSha256].every(x => /^[a-f0-9]{64}$/.test(x)) ||
      !['per-user', 'all-users'].includes(binding.scope) || !['32', '64'].includes(binding.view) ||
      !/^[A-Za-z]:\\/.test(binding.target) || !binding.appId) fail('binding')
}
function validateOperations(operations: WindowsRepairMutation[]) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 100000 ||
      new Set(operations.map(x => x.id)).size !== operations.length) fail('operations')
  for (const operation of operations) {
    if (!operation || !/^(file|registry-install|registry-uninstall):[^\x00-\x1f]+$/.test(operation.id)) fail('operation')
    for (const image of [operation.before, operation.after]) {
      if (!image || typeof image.identity !== 'string' || !image.identity ||
          !(image.bytes === null || typeof image.bytes === 'string')) fail('image')
    }
  }
  // Program payload must precede the install key, then the uninstall key.
  const registry = operations.filter(x => x.id.startsWith('registry-'))
  if (registry.length !== 2 || !operations.at(-2)?.id.startsWith('registry-install:') ||
      !operations.at(-1)?.id.startsWith('registry-uninstall:')) fail('both-key-order')
}

// One linear replay on open; one constant-size transition per append. The
// cursor contains no caller-owned operation/event references or write authority.
export class WindowsRepairJournalCursor {
  private readonly total: number
  private readonly operations: WindowsRepairMutation[]
  private readonly owned = new Set<number>()
  private state = { next: 0, pending: null as number | null, compensating: false,
    terminal: false, restoreCursor: -1, transitionChecks: 1 }
  constructor(begin: Event) {
    if (begin?.kind !== 'begin') fail('journal-begin')
    validateBinding(begin.binding); validateOperations(begin.operations)
    this.operations = freeze(structuredClone(begin.operations))
    this.total = begin.operations.length
  }
  summary() { return freeze({ ...this.state }) }
  advance(event: Event, persist: () => void = () => {}) {
      const state = { ...this.state }
      if (state.terminal || !event || typeof event !== 'object' || event.kind === 'begin') fail('journal-transition')
      if (['intent', 'applied', 'restored'].includes(event.kind)) {
        if (!('index' in event) || !Number.isInteger(event.index) || event.index < 0 || event.index >= this.total ||
            Object.keys(event).sort().join(',') !== 'index,kind') fail('journal-index')
      } else if (event.kind === 'owned-after') {
        const operation = this.operations[event.index]
        if (Object.keys(event).sort().join(',') !== 'image,index,kind' ||
            !Number.isInteger(event.index) || state.compensating || state.pending !== event.index ||
            !operation || operation.before.identity !== 'absent' || operation.before.bytes !== null ||
            operation.after.identity !== 'pending-owned-create' || this.owned.has(event.index) ||
            !event.image || Object.keys(event.image).sort().join(',') !== 'bytes,identity' ||
            !/^win32:[a-f0-9]{8}:[a-f0-9]{8}:[a-f0-9]{8}$/.test(event.image.identity) ||
            event.image.bytes !== operation.after.bytes) fail('journal-owned-after')
      } else if (Object.keys(event).join(',') !== 'kind') fail('journal-event')
      if (event.kind === 'intent') {
        if (state.compensating || state.pending !== null || event.index !== state.next) fail('journal-intent-order')
        state.pending = event.index; state.restoreCursor = event.index
      } else if (event.kind === 'owned-after') {
        // Actual native identity is persisted before compensation can delete.
      } else if (event.kind === 'applied') {
        if (state.compensating || state.pending !== event.index) fail('journal-applied-order')
        if (this.operations[event.index].after.identity === 'pending-owned-create' && !this.owned.has(event.index)) fail('journal-create-ownership')
        state.pending = null; state.next++
      } else if (event.kind === 'restored') {
        state.compensating = true
        if (state.restoreCursor !== event.index) fail('journal-restore-order')
        state.restoreCursor--; state.pending = null
      } else if (event.kind === 'recovery-required') {
        state.compensating = true
      } else if (event.kind === 'committed') {
        if (state.compensating || state.pending !== null || state.next !== this.total) fail('journal-commit-order')
        state.terminal = true
      } else if (event.kind === 'rolled-back') {
        if (state.restoreCursor !== -1) fail('journal-rollback-order')
        state.terminal = true
      } else fail('journal-event')
      // No in-memory advance until durable append and fsync have succeeded.
      persist(); if (event.kind === 'owned-after') this.owned.add(event.index)
      state.transitionChecks++; this.state = state
  }
}

export class WindowsRepairDurableJournal {
  private static readonly coldReopenPins = new Map<string, { dev: bigint; ino: bigint; frameCount: number; lastFrameSha256: string; expiresAtMs: number }>()
  private fd: number
  private frames: Frame[]
  private cursor: WindowsRepairJournalCursor | null
  private poisoned = false
  private readonly ownedAfter = new Map<number, WindowsRepairImage>()
  private constructor(readonly path: string, fd: number, frames: Frame[], cursor: WindowsRepairJournalCursor | null, private readonly io: WindowsRepairJournalIO) {
    this.fd = fd; this.frames = frames.map(frame => freeze(structuredClone(frame))); this.cursor = cursor
    for (const frame of this.frames) if (frame.event.kind === 'owned-after') this.ownedAfter.set(frame.event.index, frame.event.image)
  }
  static open(root: string, name: string, binding: WindowsRepairRecoveryBinding | null, operations: WindowsRepairMutation[] | null, io: WindowsRepairJournalIO = nativeJournalIO, requireExisting = false) {
    if (binding !== null) validateBinding(binding)
    if (operations !== null) validateOperations(operations)
    if (!isAbsolute(root) || !/^[a-f0-9]{32}\.journal$/.test(name)) fail('journal-path')
    const canonical = resolve(root)
    // A trusted host must additionally hold native parent handles/ACLs. This
    // portable store is used in isolated tests and by that reviewed host only.
    for (let part = canonical; ; part = dirname(part)) {
      const stat = lstatSync(part)
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('journal-reparse')
      if (dirname(part) === part) break
    }
    if (realpathSync(canonical).toLowerCase() !== canonical.toLowerCase()) fail('journal-root')
    const file = join(canonical, name), frames: Frame[] = [], existing = existsSync(file)
    if (requireExisting && !existing) fail('journal-missing')
    if (!existing && (!binding || !operations)) fail('journal-begin')
    let fd = -1
    try {
      fd = openSync(file, existing ? constants.O_RDWR | constants.O_APPEND :
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600)
      const opened = fstatSync(fd, { bigint: true }), named = lstatSync(file, { bigint: true })
      if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() ||
          opened.nlink !== 1n || opened.size > 32n * 1024n * 1024n ||
          opened.dev !== named.dev || opened.ino !== named.ino) fail('journal-file')
      if (existing) {
        // Replay bytes through the SAME descriptor retained for append/recovery.
        const raw = readFileSync(fd, 'utf8')
        if (!raw.endsWith('\n')) fail('journal-truncated')
        for (const line of raw.trimEnd().split('\n')) {
          let frame: Frame
          try { frame = JSON.parse(line) } catch { fail('journal-frame') }
          const { sha256, ...content } = frame
          if (frame.sequence !== frames.length || frame.previous !== (frames.at(-1)?.sha256 ?? '0'.repeat(64)) ||
              sha256 !== digest(content)) fail('journal-chain')
          frames.push(frame)
        }
        const begin = frames[0]?.event
        if (begin?.kind !== 'begin' ||
            (binding !== null && operations !== null &&
              (digest(begin.binding) !== digest(binding) || digest(begin.operations) !== digest(operations)))) fail('journal-binding')
      }
      let cursor: WindowsRepairJournalCursor | null = null
      if (frames.length) {
        cursor = new WindowsRepairJournalCursor(frames[0].event)
        for (let index = 1; index < frames.length; index++) cursor.advance(frames[index].event)
      }
      const journal = new WindowsRepairDurableJournal(file, fd, frames, cursor, Object.freeze({ ...io }))
      if (!frames.length) journal.append({ kind: 'begin', binding: binding!, operations: operations! })
      return journal
    } catch (error) {
      if (fd >= 0) { try { closeSync(fd) } catch { /* already closed after poison */ } }
      throw error
    }
  }
  static reopen(root: string, name: string) {
    if (!isAbsolute(root) || !/^[a-f0-9]{32}\.journal$/.test(name)) fail('journal-path')
    const file = join(resolve(root), name)
    const pin = this.coldReopenPins.get(file)
    if (pin) this.coldReopenPins.delete(file)
    const journal = WindowsRepairDurableJournal.open(root, name, null, null, undefined, true)
    if (pin) {
      const opened = fstatSync(journal.fd, { bigint: true })
      if (Date.now() > pin.expiresAtMs || opened.dev !== pin.dev || opened.ino !== pin.ino ||
          journal.frames.length !== pin.frameCount || journal.frames.at(-1)?.sha256 !== pin.lastFrameSha256) {
        journal.close(); fail('journal-identity')
      }
    }
    return journal
  }
  static pinColdReopen(journal: WindowsRepairDurableJournal) {
    journal.assertUsable()
    const opened = fstatSync(journal.fd, { bigint: true }), named = lstatSync(journal.path, { bigint: true })
    if (opened.dev !== named.dev || opened.ino !== named.ino ||
        this.coldReopenPins.size >= 16 || this.coldReopenPins.has(journal.path)) fail('journal-identity')
    this.coldReopenPins.set(journal.path, { dev: opened.dev, ino: opened.ino,
      frameCount: journal.frames.length, lastFrameSha256: journal.frames.at(-1)?.sha256 ?? '',
      expiresAtMs: Date.now() + 30000 })
  }
  append(event: Event) {
    this.assertUsable()
    const safeEvent = freeze(structuredClone(event))
    const content = { sequence: this.frames.length, previous: this.frames.at(-1)?.sha256 ?? '0'.repeat(64), event: safeEvent }
    const frame = { ...content, sha256: digest(content) }, bytes = Buffer.from(JSON.stringify(frame) + '\n')
    const persist = () => {
      try {
        let offset = 0
        while (offset < bytes.length) { const count = this.io.write(this.fd, bytes, offset); if (count <= 0 || count > bytes.length - offset) fail('journal-short-write'); offset += count }
        this.io.sync(this.fd); this.frames.push(freeze(frame))
        if (safeEvent.kind === 'owned-after') this.ownedAfter.set(safeEvent.index, safeEvent.image)
      } catch {
        // A partial frame or failed fsync leaves persistence uncertain. Never
        // continue from the old cursor/hash chain on this same descriptor.
        this.poisoned = true
        try { this.close() } catch { this.fd = -1 }
        fail('recovery-required')
      }
    }
    if (!this.cursor) { const cursor = new WindowsRepairJournalCursor(safeEvent); persist(); this.cursor = cursor }
    else this.cursor.advance(safeEvent, persist)
  }
  events(): readonly Event[] { return freeze(structuredClone(this.frames.map(x => x.event))) }
  boundOperations(operations: WindowsRepairMutation[]): WindowsRepairMutation[] {
    this.assertUsable()
    validateOperations(operations)
    const begin = this.frames[0]?.event
    if (begin?.kind !== 'begin' || digest(operations) !== digest(begin.operations)) fail('operation-binding')
    return begin.operations
  }
  binding(): WindowsRepairRecoveryBinding {
    this.assertUsable()
    const begin = this.frames[0]?.event
    if (begin?.kind !== 'begin') fail('journal-begin')
    return begin.binding
  }
  resolvedOperation(index: number): WindowsRepairMutation {
    this.assertUsable()
    const begin = this.frames[0]?.event
    if (begin?.kind !== 'begin' || !Number.isInteger(index) || !begin.operations[index]) fail('journal-index')
    const operation = begin.operations[index], after = this.ownedAfter.get(index)
    return after ? freeze({ ...operation, after }) : operation
  }
  progress() { this.assertUsable(); if (!this.cursor) fail('journal-begin'); return this.cursor.summary() }
  recoveryCursor() { if (!this.cursor) fail('journal-begin'); return this.cursor.summary().restoreCursor }
  lastEventKind() { return this.frames.at(-1)?.event.kind }
  isPoisoned() { return this.poisoned }
  private assertUsable() { if (this.poisoned || this.fd < 0) fail('recovery-required') }
  close() { if (this.fd >= 0) { closeSync(this.fd); this.fd = -1 } }
}

async function compensate(journal: WindowsRepairDurableJournal, operations: WindowsRepairMutation[], host: WindowsRepairRecoveryHost) {
  while (journal.recoveryCursor() >= 0) {
    const index = journal.recoveryCursor()
    if (!Number.isInteger(index) || index < 0 || index >= operations.length) fail('journal-index')
    const operation = journal.resolvedOperation(index)
    await host.assertProtectedFactsUnchanged()
    const current = await host.read(operation)
    if (!same(current, operation.before)) {
      // Never overwrite a third-party concurrent value/file, including a
      // newly-created key with extra values or children not owned by this run.
      if (!same(current, operation.after)) fail('concurrent-change')
      await host.writeChecked(operation, operation.after, operation.before)
      if (!same(await host.read(operation), operation.before)) fail('restore-readback')
    }
    journal.append({ kind: 'restored', index })
  }
  await host.assertProtectedFactsUnchanged()
  journal.append({ kind: 'rolled-back' })
}

export async function recoverWindowsRepairJournal(journal: WindowsRepairDurableJournal, operations: WindowsRepairMutation[], host: WindowsRepairRecoveryHost) {
  operations = journal.boundOperations(operations)
  const terminal = journal.lastEventKind()
  if (terminal === 'committed') { await host.verifyComplete(); return 'committed' as const }
  if (terminal === 'rolled-back') return 'rolled-back' as const
  try { await compensate(journal, operations, host); return 'rolled-back' as const }
  catch { if (!journal.isPoisoned()) journal.append({ kind: 'recovery-required' }); fail('recovery-required') }
}

export async function applyRecoverableWindowsRepair(journal: WindowsRepairDurableJournal, operations: WindowsRepairMutation[], host: WindowsRepairRecoveryHost) {
  operations = journal.boundOperations(operations)
  if (journal.events().length !== 1) fail('recover-before-new-write')
  try {
    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index]
      if (operation.id.startsWith('registry-install:')) await host.verifyProgramStage?.()
      await host.assertProtectedFactsUnchanged()
      if (!same(await host.read(operation), operation.before)) fail('pre-write-change')
      journal.append({ kind: 'intent', index })
      const actual = await host.writeChecked(operation, operation.before, operation.after)
      if (operation.after.identity === 'pending-owned-create') {
        if (!actual) fail('create-ownership-missing')
        journal.append({ kind: 'owned-after', index, image: actual })
      }
      if (!same(await host.read(journal.resolvedOperation(index)), journal.resolvedOperation(index).after)) fail('write-readback')
      journal.append({ kind: 'applied', index })
    }
    await host.assertProtectedFactsUnchanged(); await host.verifyComplete()
    journal.append({ kind: 'committed' })
    return { kind: 'journal-committed' as const, independentlyAccepted: false as const }
  } catch {
    if (journal.isPoisoned()) fail('recovery-required')
    await recoverWindowsRepairJournal(journal, operations, host)
    fail('rolled-back')
  }
}
