import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

// Explicit opt-in only: ordinary unit/CI runs never access a production file or public network.
vi.mock('electron', () => ({ app: { getPath: () => process.env.RT_PUBLIC_LIMIT_DATA_ROOT ?? 'D:/rt-public-live-isolated' } }))
import * as adapter from '../../electron/main/services/publicLimitPoolAdapter'
import { readVerifiedPublicLimitPool, syncVerifiedPublicLimitPool } from '../../electron/main/services/verifiedPublicLimitPoolCache'

describe.skipIf(process.env.RT_PUBLIC_LIMIT_LIVE !== '1')('opt-in real public source with memory-only cache writes', () => {
  it('reads one actual public response through the application bridge and cross-checks it against a read-only local daily snapshot', async () => {
    const { RT_PUBLIC_LIMIT_PYTHON: pythonPath, RT_PUBLIC_LIMIT_DATABASE: database, RT_PUBLIC_LIMIT_DATE: tradeDate, RT_PUBLIC_LIMIT_DATA_ROOT: dataRoot } = process.env
    expect(pythonPath && database && tradeDate && dataRoot).toBeTruthy()
    const source = new Database(database!, { readonly: true, fileMustExist: true })
    const memory = new Database(':memory:')
    try {
      const calendar = source.prepare('SELECT is_open FROM trade_cal WHERE cal_date = ?').get(tradeDate!) as { is_open: number } | undefined
      const daily = source.prepare('SELECT ts_code, close FROM daily_close_cache WHERE trade_date = ?').all(tradeDate!) as Array<{ ts_code: string; close: number }>
      expect(calendar?.is_open).toBe(1)
      expect(daily.length).toBeGreaterThanOrEqual(4000)
      memory.exec('CREATE TABLE trade_cal (cal_date TEXT, is_open INTEGER); CREATE TABLE daily_close_cache (trade_date TEXT, ts_code TEXT, close REAL)')
      memory.prepare('INSERT INTO trade_cal VALUES (?, ?)').run(tradeDate!, 1)
      const insert = memory.prepare('INSERT INTO daily_close_cache VALUES (?, ?, ?)')
      memory.transaction(() => { for (const row of daily) insert.run(tradeDate!, row.ts_code, row.close) })()
      const config = { dailyProviders: ['akshare'] as const, reportProviders: [], wencaiEnabled: false, pythonPath: pythonPath! }
      const selection = { ...config, dailyProviders: [...config.dailyProviders] }
      const facts = await adapter.fetchPublicLimitUpPool(selection, tradeDate!)
      expect(facts.rows.length).toBeGreaterThan(0)
      expect(facts.dateBasis).toBe('request-only')
      expect(facts.rows.some(row => row.name && /[\u3400-\u9fff]/.test(row.name))).toBe(true)
      // Do not make a second network request: reuse exactly the observed response.
      vi.spyOn(adapter, 'fetchPublicLimitUpPool').mockResolvedValue(facts)
      const saved = await syncVerifiedPublicLimitPool(memory, selection, tradeDate!)
      expect(saved.ok).toBe(true)
      expect(saved.rows).toBeGreaterThan(0)
      const cached = readVerifiedPublicLimitPool(memory)
      expect(cached.rows.length).toBe(saved.rows)
      expect(cached.dateBasis).toBe('unknown')
      console.info(JSON.stringify({ source: facts.source, requestedDate: tradeDate, receivedRows: facts.rows.length, writtenMemoryRows: saved.rows, quality: saved.quality, productionDatabase: 'readonly', brokerActions: 0 }))
    } finally {
      vi.restoreAllMocks()
      memory.close()
      source.close()
    }
  }, 45_000)
})
