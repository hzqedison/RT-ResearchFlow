import * as fs from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'

/** Only the main process supplies this Electron host, before any userData reconfiguration. */
interface DefaultApplicationHost {
  readonly isPackaged: boolean
  getPath(name: 'appData' | 'userData'): string
  getName(): string
}
interface DirectoryTestHooks {
  platform?: NodeJS.Platform
  uid?: () => number
  euid?: () => number
  /** Windows tests model POSIX metadata only; paths, descriptors and inode identity remain real. */
  metadata?: (stat: fs.Stats) => fs.Stats
  chmod?: (fd: number, mode: number) => void
  sync?: (fd: number) => void
}
export interface OrderDirectoryPreparation {
  (directory: string): { created: boolean; tightened: boolean }
}
function fail(code: string): never { throw Object.assign(new Error(code), { code }) }
function requireFact(value: unknown, code: string): asserts value { if (!value) fail(code) }

/** Capture default-location evidence without touching the filesystem or throwing into app startup.
 * No renderer input, environment switch, recursive chmod/mkdir, alternate profile, or source proof.
 * An error is deferred to order-service initialization, leaving research startup independent.
 */
export function createMacThsOrderDirectoryPreparation(
  app: DefaultApplicationHost, testHooks?: DirectoryTestHooks,
): OrderDirectoryPreparation {
  const platform = testHooks?.platform ?? process.platform
  let parent = '', expectedRoot = '', captureError: unknown
  try {
    requireFact(platform === 'darwin', 'ORDER_DIRECTORY_MAC_REQUIRED')
    requireFact(app.isPackaged, 'ORDER_DIRECTORY_DEFAULT_UNPROVEN')
    const name = app.getName(), appData = app.getPath('appData'), initial = app.getPath('userData')
    requireFact(typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' &&
      !/[\\/\x00-\x1f\x7f]/.test(name) && basename(name) === name, 'ORDER_DIRECTORY_DEFAULT_UNPROVEN')
    requireFact(typeof appData === 'string' && isAbsolute(appData) && !appData.includes('\0') &&
      typeof initial === 'string' && isAbsolute(initial) && !initial.includes('\0'), 'ORDER_DIRECTORY_DEFAULT_UNPROVEN')
    parent = resolve(appData)
    expectedRoot = join(parent, name)
    requireFact(resolve(initial) === expectedRoot, 'ORDER_DIRECTORY_DEFAULT_UNPROVEN')
  } catch (error) { captureError = error }

  return directory => {
    if (captureError) throw captureError
    requireFact(typeof directory === 'string' && isAbsolute(directory) && !directory.includes('\0') &&
      resolve(directory) === expectedRoot, 'ORDER_DIRECTORY_DEFAULT_UNPROVEN')
    const uid = (testHooks?.uid ?? process.getuid)?.()
    const euid = (testHooks?.euid ?? process.geteuid)?.()
    requireFact(Number.isSafeInteger(uid) && Number.isSafeInteger(euid) && uid! >= 0 && uid === euid,
      'ORDER_DIRECTORY_OWNER_UNPROVEN')
    const metadata = (stat: fs.Stats) => testHooks?.metadata ? testHooks.metadata(stat) : stat
    const inspect = (path: string) => metadata(fs.lstatSync(path))
    const same = (a: fs.Stats, b: fs.Stats) => a.dev === b.dev && a.ino === b.ino
    const checkPath = (path: string, stat: fs.Stats) => {
      requireFact(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync.native(path) === path,
        'ORDER_DIRECTORY_NONCANONICAL')
    }
    const parentStat = inspect(parent)
    checkPath(parent, parentStat)
    let created = false, rootStat: fs.Stats
    try { rootStat = inspect(expectedRoot) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try { fs.mkdirSync(expectedRoot, { mode: 0o700, recursive: false }); created = true }
      catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError }
      rootStat = inspect(expectedRoot)
    }
    checkPath(expectedRoot, rootStat)
    requireFact(rootStat.uid === uid, 'ORDER_DIRECTORY_OWNER_UNPROVEN')
    // Do not widen an owner's deliberately read-only directory.
    requireFact((rootStat.mode & 0o700) === 0o700, 'ORDER_DIRECTORY_OWNER_ACCESS_REQUIRED')
    // These flags exist on Mac. Windows only enters this branch via constructor-only test hooks.
    requireFact(process.platform !== 'darwin' ||
      (typeof fs.constants.O_NOFOLLOW === 'number' && typeof fs.constants.O_DIRECTORY === 'number'),
      'ORDER_DIRECTORY_NOFOLLOW_UNAVAILABLE')
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_DIRECTORY ?? 0)
    const fd = fs.openSync(expectedRoot, flags)
    let tightened = false
    const sync = testHooks?.sync ?? fs.fsyncSync
    try {
      const opened = metadata(fs.fstatSync(fd))
      requireFact(opened.isDirectory() && same(rootStat, opened) && opened.uid === uid &&
        (opened.mode & 0o700) === 0o700, 'ORDER_DIRECTORY_IDENTITY_CHANGED')
      // Recheck the pathname before modifying the descriptor, including ancestor aliases.
      const current = inspect(expectedRoot)
      checkPath(expectedRoot, current)
      requireFact(same(opened, current) && current.uid === uid, 'ORDER_DIRECTORY_IDENTITY_CHANGED')
      if ((opened.mode & 0o7777) !== 0o700) {
        ;(testHooks?.chmod ?? fs.fchmodSync)(fd, 0o700)
        tightened = true
      }
      if (created || tightened) sync(fd)
      if (created) {
        const parentFd = fs.openSync(parent, flags)
        try {
          requireFact(same(parentStat, metadata(fs.fstatSync(parentFd))), 'ORDER_DIRECTORY_IDENTITY_CHANGED')
          sync(parentFd)
        } finally { fs.closeSync(parentFd) }
      }
      const final = metadata(fs.fstatSync(fd)), named = inspect(expectedRoot), finalParent = inspect(parent)
      checkPath(expectedRoot, named)
      checkPath(parent, finalParent)
      requireFact(same(final, named) && same(rootStat, final) && same(parentStat, finalParent) &&
        final.uid === uid && named.uid === uid && (final.mode & 0o7777) === 0o700 &&
        (named.mode & 0o7777) === 0o700, 'ORDER_DIRECTORY_IDENTITY_CHANGED')
      return { created, tightened }
    } finally { fs.closeSync(fd) }
  }
}
