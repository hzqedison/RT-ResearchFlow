import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface DatabaseStartupOptions {
  databasePath: string
  existedBeforeOpen: boolean
  migrationVersions: readonly number[]
  now?: number
  onWarning?: (code: 'PERIODIC_BACKUP_FAILED') => void
}

export interface DatabaseStartupResult {
  backupKind: 'none' | 'upgrade' | 'periodic'
  backupPath: string | null
}

export class DatabaseStartupError extends Error {
  constructor(readonly code: 'UNSUPPORTED_SCHEMA' | 'UPGRADE_BACKUP_FAILED', options?: ErrorOptions) {
    super(code === 'UNSUPPORTED_SCHEMA'
      ? '数据库包含当前版本不支持的迁移记录，请使用匹配的应用版本。'
      : '升级前数据库快照未能完成，已停止迁移。请检查数据盘空间和写入权限后重试。', options)
    this.name = 'DatabaseStartupError'
  }
}

function appliedVersions(db: Database.Database): number[] {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
  if (!table) return []
  return (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[])
    .map(row => row.version)
}

async function verifiedSnapshot(db: Database.Database, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    await db.backup(temporary)
    const snapshot = new Database(temporary, { readonly: true, fileMustExist: true })
    try {
      const check = snapshot.pragma('quick_check') as { quick_check: string }[]
      if (check.length !== 1 || check[0].quick_check !== 'ok') {
        throw new Error('Database snapshot validation failed.')
      }
    } finally {
      snapshot.close()
    }
    // A same-directory rename publishes only a complete, verified snapshot.
    await rename(temporary, destination)
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') console.warn('[DB] Snapshot temporary file cleanup failed.')
    })
  }
}

async function hasVerifiedPeriodicReceipt(destination: string, size: number, modifiedAt: number): Promise<boolean> {
  try {
    const receipt = JSON.parse(await readFile(`${destination}.json`, 'utf8'))
    return receipt?.formatVersion === 1 && receipt.method === 'sqlite-online-backup' &&
      receipt.size === size && receipt.modifiedAt === modifiedAt
  } catch {
    return false
  }
}

async function writePeriodicReceipt(destination: string): Promise<void> {
  const snapshot = await stat(destination)
  const path = `${destination}.json`
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({
      formatVersion: 1, method: 'sqlite-online-backup', size: snapshot.size, modifiedAt: snapshot.mtimeMs,
    }), { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

/** No migration callback is invoked before an existing database has its required recovery point. */
export async function runDatabaseStartup(
  db: Database.Database,
  options: DatabaseStartupOptions,
  migrate: () => void,
): Promise<DatabaseStartupResult> {
  const known = new Set(options.migrationVersions)
  if (known.size !== options.migrationVersions.length ||
    options.migrationVersions.some(version => !Number.isSafeInteger(version) || version <= 0)) {
    throw new DatabaseStartupError('UNSUPPORTED_SCHEMA')
  }
  const applied = appliedVersions(db)
  if (applied.some(version => !Number.isSafeInteger(version) || !known.has(version))) {
    throw new DatabaseStartupError('UNSUPPORTED_SCHEMA')
  }
  const recorded = new Set(applied)
  const needsMigration = options.migrationVersions.some(version => !recorded.has(version))
  const now = options.now ?? Date.now()
  let result: DatabaseStartupResult = { backupKind: 'none', backupPath: null }

  if (options.existedBeforeOpen && needsMigration) {
    const from = applied.length ? Math.max(...applied) : 0
    const to = options.migrationVersions.length ? Math.max(...options.migrationVersions) : 0
    const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-')
    const destination = join(dirname(options.databasePath), 'backups', 'startup',
      `pre-upgrade-v${from}-to-v${to}-${timestamp}-${randomUUID()}.db`)
    try {
      await verifiedSnapshot(db, destination)
    } catch (cause) {
      throw new DatabaseStartupError('UPGRADE_BACKUP_FAILED', { cause })
    }
    result = { backupKind: 'upgrade', backupPath: destination }
  } else if (options.existedBeforeOpen) {
    const destination = `${options.databasePath}.bak`
    try {
      const previous = await stat(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      const verified = previous ? await hasVerifiedPeriodicReceipt(destination, previous.size, previous.mtimeMs) : false
      if (!previous || !verified || now - previous.mtimeMs > 24 * 60 * 60 * 1000) {
        await verifiedSnapshot(db, destination)
        await writePeriodicReceipt(destination)
        result = { backupKind: 'periodic', backupPath: destination }
      }
    } catch {
      // A periodic refresh is optional only when no schema migration is pending.
      options.onWarning?.('PERIODIC_BACKUP_FAILED')
    }
  }

  migrate()
  return result
}
