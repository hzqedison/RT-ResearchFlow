import type Database from 'better-sqlite3'
import type { DataSourceConfigRow } from './types'
import { isAbsolute } from 'node:path'
import { DAILY_DATA_PROVIDERS, type DailyDataProvider, type ReportDataProvider, type MultiSourcePreference, type SaveDataSourcePreference } from '../../shared/dataSourceTypes'
import { encryptRequiredApiKey } from '../utils/apiKeyEncryption'

export function getDataSourceConfig(db: Database.Database): DataSourceConfigRow {
  const row = db.prepare('SELECT * FROM data_source_config WHERE id = 1').get() as DataSourceConfigRow | undefined
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO data_source_config (id) VALUES (1)').run()
    return { id: 1, tushareTokenEncrypted: null, tushareEnabled: 0 }
  }
  return row
}

export function updateDataSourceConfig(
  db: Database.Database,
  update: Partial<Pick<DataSourceConfigRow, 'tushareTokenEncrypted' | 'tushareEnabled'>>
): void {
  const fields: string[] = []
  const values: unknown[] = []

  if (update.tushareTokenEncrypted !== undefined) {
    fields.push('tushareTokenEncrypted = ?')
    values.push(update.tushareTokenEncrypted)
  }
  if (update.tushareEnabled !== undefined) {
    fields.push('tushareEnabled = ?')
    values.push(update.tushareEnabled)
  }

  if (fields.length === 0) return
  values.push(1)
  db.prepare(`UPDATE data_source_config SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

function ensureMultiSourceTable(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS multi_data_source_config (id INTEGER PRIMARY KEY CHECK(id=1), preference TEXT NOT NULL, wencai_cookie_encrypted BLOB)')
}

function validatedProviders<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !allowed.includes(item as T))) {
    throw new Error('数据源配置格式无效，原配置未被覆盖')
  }
  return [...new Set(value)] as T[]
}

export function getMultiSourcePreference(db: Database.Database): MultiSourcePreference {
  ensureMultiSourceTable(db)
  const row = db.prepare('SELECT preference FROM multi_data_source_config WHERE id=1').get() as { preference: string } | undefined
  if (!row) {
    const legacy = getDataSourceConfig(db)
    return {
      dailyProviders: legacy.tushareEnabled ? ['tushare', 'tencent', 'eastmoney', 'sina'] : ['tencent', 'eastmoney', 'sina'],
      reportProviders: ['eastmoney'], wencaiEnabled: false, pythonPath: '',
    }
  }
  const parsed = JSON.parse(row.preference) as MultiSourcePreference
  return {
    dailyProviders: validatedProviders<DailyDataProvider>(parsed.dailyProviders, DAILY_DATA_PROVIDERS),
    reportProviders: validatedProviders<ReportDataProvider>(parsed.reportProviders, ['eastmoney', 'akshare']),
    wencaiEnabled: parsed.wencaiEnabled === true,
    pythonPath: typeof parsed.pythonPath === 'string' ? parsed.pythonPath : '',
  }
}

export function getWencaiCookieEncrypted(db: Database.Database): Buffer | null {
  ensureMultiSourceTable(db)
  return (db.prepare('SELECT wencai_cookie_encrypted AS value FROM multi_data_source_config WHERE id=1').get() as { value: Buffer | null } | undefined)?.value ?? null
}

export function updateMultiSourcePreference(db: Database.Database, update: SaveDataSourcePreference): void {
  const previous = getMultiSourcePreference(db)
  const next: MultiSourcePreference = {
    dailyProviders: update.dailyProviders === undefined ? previous.dailyProviders : validatedProviders(update.dailyProviders, DAILY_DATA_PROVIDERS),
    reportProviders: update.reportProviders === undefined ? previous.reportProviders : validatedProviders<ReportDataProvider>(update.reportProviders, ['eastmoney', 'akshare']),
    wencaiEnabled: update.wencaiEnabled === undefined ? previous.wencaiEnabled : update.wencaiEnabled === true,
    pythonPath: update.pythonPath === undefined ? previous.pythonPath : String(update.pythonPath).trim(),
  }
  if (next.pythonPath && (!isAbsolute(next.pythonPath) || next.pythonPath.includes('\0'))) throw new Error('Python 解释器必须是本机绝对路径')
  if (update.wencaiCookie != null && (typeof update.wencaiCookie !== 'string' || update.wencaiCookie.length > 32768)) throw new Error('Cookie 格式无效')
  if (update.clearWencaiCookie && update.wencaiCookie?.trim()) throw new Error('不能同时保存和清除 Cookie')
  let encrypted = getWencaiCookieEncrypted(db)
  if (update.clearWencaiCookie) encrypted = null
  else if (update.wencaiCookie?.trim()) encrypted = encryptRequiredApiKey(update.wencaiCookie.trim())
  db.prepare('INSERT INTO multi_data_source_config(id,preference,wencai_cookie_encrypted) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET preference=excluded.preference,wencai_cookie_encrypted=excluded.wencai_cookie_encrypted')
    .run(JSON.stringify(next), encrypted)
}
