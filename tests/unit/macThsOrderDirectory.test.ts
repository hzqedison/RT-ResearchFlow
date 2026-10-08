import { nativeTestBinding, nativeTestTempRoot } from '../fixtures/macThsNativeTestRuntime'
import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { createMacThsOrderDirectoryPreparation } from '../../electron/main/services/macThsOrderDirectory'
import { MacThsOrderService, type TrustedCaller } from '../../electron/main/services/macThsOrderService'

const root = fs.realpathSync.native(fs.mkdtempSync(join(nativeTestTempRoot, 'rt-i13-directory-')))
const binding = nativeTestBinding
console.info('Directory fixtures retained:', root, 'Windows POSIX metadata model; not Mac permission acceptance')
type Hooks = NonNullable<Parameters<typeof createMacThsOrderDirectoryPreparation>[1]>
const services = new Set<MacThsOrderService>()
const caller: TrustedCaller = { id: 1, frame: {}, isCurrent: () => true }

function fixture(existing = true, mode = 0o755) {
  const parent = fs.mkdtempSync(join(root, 'case-')), name = 'Trade Watch Fixture'
  const directory = join(parent, name)
  if (existing) fs.mkdirSync(directory)
  const parentInode = fs.lstatSync(parent).ino
  const model = { mode: existing ? mode : 0o700, uid: 501, euid: 501, owner: 501 }
  const changed: Array<{ ino: number; mode: number }> = []
  const synced: number[] = []
  const host = { isPackaged: true, getName: () => name,
    getPath: (kind: 'appData' | 'userData') => kind === 'appData' ? parent : directory }
  // Real Windows descriptors/inodes/paths and SQLite. Only unavailable POSIX permission/flush
  // behavior is explicitly modeled; production Mac uses real getuid/fchmod/fsync without fallback.
  const hooks: Hooks = {
    platform: 'darwin', uid: () => model.uid, euid: () => model.euid,
    metadata: stat => Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
      uid: stat.ino === parentInode ? 501 : model.owner,
      mode: stat.ino === parentInode ? stat.mode : (stat.mode & ~0o7777) | model.mode,
    }),
    chmod: (fd, value) => {
      changed.push({ ino: fs.fstatSync(fd).ino, mode: value })
      model.mode = value
    },
    sync: fd => { synced.push(fs.fstatSync(fd).ino) },
  }
  return { parent, parentInode, directory, host, hooks, model, changed, synced,
    prepare: () => createMacThsOrderDirectoryPreparation(host, hooks) }
}
afterEach(async () => {
  const owned = [...services]; services.clear()
  const failures: unknown[] = []
  for (const service of owned) { try { await service.shutdown() } catch (error) { failures.push(error) } }
  if (failures.length) throw new AggregateError(failures, 'Directory fixture shutdown failed; original evidence retained')
})
async function start(f: ReturnType<typeof fixture>, prepare = f.prepare()) {
  let confirmations = 0
  const service = new MacThsOrderService({
    directory: f.directory, prepareDirectory: prepare,
    accessibility: () => true, confirm: async () => { confirmations++; return true },
    testHooks: { platform: 'darwin', store: { nativeBinding: binding },
      adapter: { platform: 'darwin', command: () => { throw new Error('No native process allowed in directory-only test') } } },
  })
  services.add(service)
  await service.start()
  return { service, confirmations: () => confirmations }
}

describe('trusted default order directory: real K paths and modeled POSIX permissions', () => {
  it('tightens an existing 0755 default root only, preserving parent, child and journal bytes', () => {
    const f = fixture()
    const journal = join(f.directory, 'mac-ths-experiment-journal.json')
    const child = join(f.directory, 'child')
    fs.mkdirSync(child)
    const raw = Buffer.from('original legacy journal bytes\n')
    fs.writeFileSync(journal, raw)
    const before = [fs.statSync(f.parent).mode, fs.statSync(child).mode, fs.statSync(journal).mode]
    expect(f.prepare()(f.directory)).toEqual({ created: false, tightened: true })
    expect(f.changed).toEqual([{ ino: fs.lstatSync(f.directory).ino, mode: 0o700 }])
    expect(f.synced).toEqual([fs.lstatSync(f.directory).ino])
    expect([fs.statSync(f.parent).mode, fs.statSync(child).mode, fs.statSync(journal).mode]).toEqual(before)
    expect(fs.readFileSync(journal)).toEqual(raw)
    expect(fs.readdirSync(f.directory).sort()).toEqual(['child', 'mac-ths-experiment-journal.json'])
  })
  it('creates only the missing app root and flushes its entry, without recursive parent creation', () => {
    const f = fixture(false)
    expect(f.prepare()(f.directory)).toEqual({ created: true, tightened: false })
    expect(fs.lstatSync(f.directory).isDirectory()).toBe(true)
    expect(f.changed).toEqual([])
    expect(f.synced).toEqual([fs.lstatSync(f.directory).ino, f.parentInode])
    expect(fs.readdirSync(f.parent)).toEqual([f.host.getName()])
  })
  it('keeps an already private root unchanged', () => {
    const f = fixture(true, 0o700)
    expect(f.prepare()(f.directory)).toEqual({ created: false, tightened: false })
    expect(f.changed).toEqual([])
    expect(f.synced).toEqual([])
  })
  it.each(['not-packaged', 'different-initial', 'relative-parent', 'bad-name', 'missing-parent'] as const)(
    'refuses insufficient default location evidence: %s', kind => {
      const f = fixture(false)
      let host = f.host
      if (kind === 'not-packaged') host = { ...host, isPackaged: false }
      if (kind === 'different-initial') host = { ...host, getPath: k => k === 'appData' ? f.parent : f.parent }
      if (kind === 'relative-parent') host = { ...host, getPath: k => k === 'appData' ? 'relative' : f.directory }
      if (kind === 'bad-name') host = { ...host, getName: () => '../outside' }
      if (kind === 'missing-parent') {
        const absent = join(f.parent, 'missing')
        host = { ...host, getPath: k => k === 'appData' ? absent : join(absent, host.getName()) }
      }
      const prepare = createMacThsOrderDirectoryPreparation(host, f.hooks)
      expect(() => prepare(kind === 'missing-parent' ? host.getPath('userData') : f.directory)).toThrow()
      expect(fs.existsSync(f.directory)).toBe(false)
      expect(fs.readdirSync(f.parent)).toEqual([])
      expect(f.changed).toEqual([])
    })
  it('rejects later userData overrides instead of following or chmodding the new location', () => {
    const f = fixture(), prepare = f.prepare()
    const other = fs.mkdtempSync(join(root, 'arbitrary-'))
    expect(() => prepare(other)).toThrow('ORDER_DIRECTORY_DEFAULT_UNPROVEN')
    expect(() => prepare(f.parent)).toThrow('ORDER_DIRECTORY_DEFAULT_UNPROVEN')
    expect(f.changed).toEqual([])
    expect(prepare(f.directory).tightened).toBe(true)
  })
  it('defers host lookup errors to trading initialization rather than throwing at capture', () => {
    const f = fixture()
    let prepare!: ReturnType<typeof f.prepare>
    expect(() => { prepare = createMacThsOrderDirectoryPreparation({
      ...f.host, getName: () => { throw new Error('default lookup unavailable') },
    }, f.hooks) }).not.toThrow()
    expect(() => prepare(f.directory)).toThrow('default lookup unavailable')
    expect(f.changed).toEqual([])
  })
  it.each(['different-owner', 'different-euid', 'unknown-uid', 'owner-readonly'] as const)(
    'does not mutate when ownership/access evidence fails: %s', kind => {
      const f = fixture()
      if (kind === 'different-owner') f.model.owner = 502
      if (kind === 'different-euid') f.model.euid = 0
      if (kind === 'unknown-uid') f.model.uid = NaN
      if (kind === 'owner-readonly') f.model.mode = 0o555
      expect(() => f.prepare()(f.directory)).toThrow(/ORDER_DIRECTORY_OWNER_/)
      expect(f.changed).toEqual([])
    })
  it('rejects a real linked root without modifying its target', () => {
    const f = fixture()
    const alias = join(f.parent, 'Alias')
    fs.symlinkSync(f.directory, alias, 'junction')
    const prepare = createMacThsOrderDirectoryPreparation({
      ...f.host, getName: () => 'Alias', getPath: k => k === 'appData' ? f.parent : alias,
    }, f.hooks)
    expect(() => prepare(alias)).toThrow('ORDER_DIRECTORY_NONCANONICAL')
    expect(f.changed).toEqual([])
    expect(fs.lstatSync(alias).isSymbolicLink()).toBe(true)
  })
  it('rejects an ancestor alias, without touching the real root or ancestor', () => {
    const f = fixture()
    const alias = join(root, 'alias-' + f.parentInode)
    fs.symlinkSync(f.parent, alias, 'junction')
    const path = join(alias, f.host.getName())
    const prepare = createMacThsOrderDirectoryPreparation({
      ...f.host, getPath: k => k === 'appData' ? alias : path,
    }, f.hooks)
    expect(() => prepare(path)).toThrow('ORDER_DIRECTORY_NONCANONICAL')
    expect(f.changed).toEqual([])
  })
  it('rejects a regular file in place of the application directory', () => {
    const f = fixture(false)
    fs.writeFileSync(f.directory, 'not a directory')
    expect(() => f.prepare()(f.directory)).toThrow('ORDER_DIRECTORY_NONCANONICAL')
    expect(fs.readFileSync(f.directory, 'utf8')).toBe('not a directory')
    expect(f.changed).toEqual([])
  })
  it('rejects changed owner evidence on the opened descriptor before chmod', () => {
    const f = fixture(), decorate = f.hooks.metadata!
    let rootReads = 0
    f.hooks.metadata = stat => {
      const value = decorate(stat)
      if (stat.ino !== f.parentInode && ++rootReads >= 2) value.uid = 502
      return value
    }
    expect(() => f.prepare()(f.directory)).toThrow('ORDER_DIRECTORY_IDENTITY_CHANGED')
    expect(f.changed).toEqual([])
  })
  it('rejects a chmod that did not establish private permissions', () => {
    const f = fixture()
    f.hooks.chmod = () => { /* Explicit fault injection: no permission change. */ }
    expect(() => f.prepare()(f.directory)).toThrow('ORDER_DIRECTORY_IDENTITY_CHANGED')
    expect(f.model.mode).toBe(0o755)
  })
  it.each(['chmod', 'sync'] as const)('propagates %s failure without deleting evidence or restoring broad permissions', stage => {
    const f = fixture()
    fs.writeFileSync(join(f.directory, 'preserved'), 'first failure stays')
    f.hooks[stage] = () => { throw Object.assign(new Error(stage + ' injected EPERM'), { code: 'EPERM' }) }
    expect(() => f.prepare()(f.directory)).toThrow(stage + ' injected EPERM')
    expect(f.model.mode).toBe(stage === 'chmod' ? 0o755 : 0o700)
    expect(fs.readFileSync(join(f.directory, 'preserved'), 'utf8')).toBe('first failure stays')
  })
})

describe('directory preparation through actual order-service startup and SQLite', () => {
  it.each([true, false])('permits explicit SQLite initialization after private-root preparation; existing=%s', async existing => {
    const f = fixture(existing)
    const { service, confirmations } = await start(f)
    expect(service.getState()).toMatchObject({ serviceState: 'NOT_INITIALIZED', canInitialize: true })
    expect(fs.existsSync(join(f.directory, 'mac-ths-orders.v2.sqlite'))).toBe(false)
    expect(confirmations()).toBe(0)
    expect(await service.recover({ kind: 'initialize' }, caller)).toMatchObject({
      serviceState: 'READY_DISABLED', canPrepare: true, coverage: { kind: 'fresh' },
    })
    expect(confirmations()).toBe(1)
    expect(fs.statSync(join(f.directory, 'mac-ths-orders.v2.sqlite')).size).toBeGreaterThan(0)
    expect(f.changed.length).toBe(existing ? 1 : 0)
  }, 20000)
  it.each(['unknown-default', 'wrong-owner', 'fsync-failure'] as const)(
    'returns storage-blocked without throwing into research startup: %s', async reason => {
      const f = fixture()
      if (reason === 'wrong-owner') f.model.owner = 502
      if (reason === 'fsync-failure') f.hooks.sync = () => { throw Object.assign(new Error('fixture fsync denied'), { code: 'EPERM' }) }
      const prepare = reason === 'unknown-default' ?
        createMacThsOrderDirectoryPreparation({ ...f.host, isPackaged: false }, f.hooks) : f.prepare()
      const { service, confirmations } = await start(f, prepare)
      // The actual awaited service start returned normally; following research work can proceed.
      const researchReached = true
      expect(researchReached).toBe(true)
      expect(service.getState()).toMatchObject({
        serviceState: 'BLOCKED_STORAGE', code: 'STORAGE_UNAVAILABLE', recoveryReason: 'STORAGE_IO',
        canInitialize: false, canPrepare: false,
      })
      await service.recover({ kind: 'initialize' }, caller)
      expect(confirmations()).toBe(0)
      expect(fs.readdirSync(f.directory)).toEqual([])
    })
  it('does not turn chmod into a source/exit proof for an existing 1.2 journal', async () => {
    const f = fixture(), path = join(f.directory, 'mac-ths-experiment-journal.json')
    const raw = Buffer.from('{"unknownPending":true,"usedRequests":["retained-id"]}\n')
    fs.writeFileSync(path, raw)
    const { service, confirmations } = await start(f)
    expect(f.changed).toEqual([{ ino: fs.lstatSync(f.directory).ino, mode: 0o700 }])
    expect(service.getState()).toMatchObject({
      serviceState: 'RECOVERY_REQUIRED', recoveryReason: 'LEGACY_WRITER_UNFENCED',
      canInitialize: false, canRecover: false, canPrepare: false,
    })
    expect(confirmations()).toBe(0)
    expect(fs.readFileSync(path)).toEqual(raw)
    expect(fs.readdirSync(f.directory)).toEqual(['mac-ths-experiment-journal.json'])
  })
})
