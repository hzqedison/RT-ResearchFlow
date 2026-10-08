import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseStartupError, runDatabaseStartup } from '../../electron/main/database/databaseStartup'

const roots: string[] = []
const connections: Database.Database[] = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rt-startup-backup-'))
  roots.push(root)
  const databasePath = join(root, 'trade-watch.db')
  const db = new Database(databasePath)
  connections.push(db)
  db.pragma('journal_mode = WAL')
  db.pragma('wal_autocheckpoint = 0')
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES (1); CREATE TABLE facts (value TEXT); INSERT INTO facts VALUES (\'committed-in-wal\')')
  return { root, databasePath, db }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const db of connections.splice(0)) if (db.open) db.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('database startup recovery', () => {
  it('backs up committed WAL data and old schema before any migration', async () => {
    const { root, databasePath, db } = fixture()
    expect(readFileSync(`${databasePath}-wal`).length).toBeGreaterThan(0)
    const result = await runDatabaseStartup(db, { databasePath, existedBeforeOpen: true, migrationVersions: [1, 2] }, () => {
      expect(readdirSync(join(root, 'backups', 'startup')).filter(name => name.endsWith('.db'))).toHaveLength(1)
      db.exec("ALTER TABLE facts ADD COLUMN added TEXT; INSERT INTO schema_migrations VALUES (2); UPDATE facts SET value = 'after-migration'")
    })
    expect(result.backupKind).toBe('upgrade')
    const restored = new Database(result.backupPath!, { readonly: true })
    connections.push(restored)
    expect(restored.prepare('SELECT value FROM facts').get()).toEqual({ value: 'committed-in-wal' })
    expect(restored.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }])
    expect(restored.pragma('table_info(facts)')).toHaveLength(1)
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(readdirSync(join(root, 'backups', 'startup')).some(name => name.endsWith('.tmp'))).toBe(false)
  })

  it('does not migrate when a mandatory upgrade backup fails', async () => {
    const { databasePath, db } = fixture()
    vi.spyOn(db, 'backup').mockRejectedValueOnce(new Error('disk full'))
    const migrate = vi.fn()
    await expect(runDatabaseStartup(db, { databasePath, existedBeforeOpen: true, migrationVersions: [1, 2] }, migrate))
      .rejects.toMatchObject({ code: 'UPGRADE_BACKUP_FAILED' })
    expect(migrate).not.toHaveBeenCalled()
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }])
  })

  it('keeps the recovery point when a later migration fails', async () => {
    const { root, databasePath, db } = fixture()
    await expect(runDatabaseStartup(db, { databasePath, existedBeforeOpen: true, migrationVersions: [1, 2] }, () => {
      db.exec("UPDATE facts SET value = 'partially-upgraded'")
      throw new Error('migration failed')
    })).rejects.toThrow('migration failed')
    const backup = readdirSync(join(root, 'backups', 'startup')).find(name => name.endsWith('.db'))!
    const restored = new Database(join(root, 'backups', 'startup', backup), { readonly: true })
    connections.push(restored)
    expect(restored.prepare('SELECT value FROM facts').get()).toEqual({ value: 'committed-in-wal' })
  })

  it('rejects unknown future migration records before backup or migration', async () => {
    const { databasePath, db } = fixture()
    db.exec('INSERT INTO schema_migrations VALUES (999999)')
    const backup = vi.spyOn(db, 'backup')
    const migrate = vi.fn()
    await expect(runDatabaseStartup(db, { databasePath, existedBeforeOpen: true, migrationVersions: [1, 2] }, migrate))
      .rejects.toBeInstanceOf(DatabaseStartupError)
    expect(backup).not.toHaveBeenCalled()
    expect(migrate).not.toHaveBeenCalled()
  })

  it('creates a consistent periodic backup when the schema is already current', async () => {
    const { databasePath, db } = fixture()
    const migrate = vi.fn()
    const result = await runDatabaseStartup(db, { databasePath, existedBeforeOpen: true, migrationVersions: [1] }, migrate)
    expect(result).toEqual({ backupKind: 'periodic', backupPath: `${databasePath}.bak` })
    const restored = new Database(result.backupPath!, { readonly: true })
    connections.push(restored)
    expect(restored.prepare('SELECT value FROM facts').get()).toEqual({ value: 'committed-in-wal' })
    expect(migrate).toHaveBeenCalledOnce()
  })

  it('preserves the previous periodic backup if its refresh fails', async () => {
    const { databasePath, db } = fixture()
    const previous = 'previous-backup-marker'
    writeFileSync(`${databasePath}.bak`, previous)
    const backup = vi.spyOn(db, 'backup').mockImplementationOnce(async (file) => {
      writeFileSync(file, 'incomplete')
      throw new Error('write failed')
    })
    const onWarning = vi.fn()
    const migrate = vi.fn()
    const result = await runDatabaseStartup(db, {
      databasePath, existedBeforeOpen: true, migrationVersions: [1], now: Date.now() + 48 * 60 * 60 * 1000, onWarning,
    }, migrate)
    expect(backup).toHaveBeenCalledOnce()
    expect(readFileSync(`${databasePath}.bak`, 'utf8')).toBe(previous)
    expect(result.backupKind).toBe('none')
    expect(onWarning).toHaveBeenCalledWith('PERIODIC_BACKUP_FAILED')
    expect(migrate).toHaveBeenCalledOnce()
    expect(readdirSync(join(databasePath, '..')).some(name => name.endsWith('.tmp'))).toBe(false)
  })

  it('replaces a recent legacy raw copy instead of assuming its mtime proves consistency', async () => {
    const { databasePath, db } = fixture()
    writeFileSync(`${databasePath}.bak`, 'recent legacy copy without verified receipt')
    const backup = vi.spyOn(db, 'backup')
    const result = await runDatabaseStartup(db, { databasePath, existedBeforeOpen: true, migrationVersions: [1] }, () => undefined)
    expect(backup).toHaveBeenCalledOnce()
    expect(result.backupKind).toBe('periodic')
    const restored = new Database(result.backupPath!, { readonly: true })
    connections.push(restored)
    expect(restored.prepare('SELECT value FROM facts').get()).toEqual({ value: 'committed-in-wal' })
    expect(JSON.parse(readFileSync(`${databasePath}.bak.json`, 'utf8')).method).toBe('sqlite-online-backup')
  })

  it('reuses only a recent periodic snapshot with a matching receipt', async () => {
    const { databasePath, db } = fixture()
    const options = { databasePath, existedBeforeOpen: true, migrationVersions: [1] }
    await runDatabaseStartup(db, options, () => undefined)
    const backup = vi.spyOn(db, 'backup')
    const result = await runDatabaseStartup(db, options, () => undefined)
    expect(result.backupKind).toBe('none')
    expect(backup).not.toHaveBeenCalled()
  })

  it('skips snapshots for a genuinely new empty database', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rt-startup-new-'))
    roots.push(root)
    const databasePath = join(root, 'new.db')
    const db = new Database(databasePath)
    connections.push(db)
    const backup = vi.spyOn(db, 'backup')
    const migrate = vi.fn(() => db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)'))
    const result = await runDatabaseStartup(db, { databasePath, existedBeforeOpen: false, migrationVersions: [1] }, migrate)
    expect(result.backupKind).toBe('none')
    expect(backup).not.toHaveBeenCalled()
    expect(migrate).toHaveBeenCalledOnce()
  })
})
