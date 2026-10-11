import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const path = resolve(__dirname, '../../electron/main/ipc/screenerHandlers.ts')
const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
function functions(names: string[], deps: object) {
  const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''))
  if (declarations.length !== names.length) throw new Error('Production function missing')
  const code = ts.transpileModule(declarations.map(node => node.getText(source)).join('\n') +
    `\n({${names.join(',')}});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return runInNewContext(code, deps) as Record<string, (...args: unknown[]) => Promise<unknown> | unknown>
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('actual screener IPC helper isolation', () => {
  it('deduplicates the same date but not a different date', async () => {
    const first = deferred<void>(), second = deferred<void>()
    const maybeSyncMoneyFlow = vi.fn((date: string) => date === '20261007' ? first.promise : second.promise)
    const runScreener = vi.fn((_db: unknown, tradeDate: string) => ({ tradeDate }))
    const inflight = new Map()
    const { computeScreener } = functions(['computeScreener'], {
      _screenerInflight: inflight, getDb: () => ({}), maybeSyncMoneyFlow, runScreener,
    })
    const a = computeScreener('20261007'), duplicate = computeScreener('20261007'), b = computeScreener('20261008')
    expect(maybeSyncMoneyFlow).toHaveBeenCalledTimes(2)
    second.resolve()
    expect(await b).toEqual({ tradeDate: '20261008' })
    expect(inflight.has('20261007')).toBe(true)
    first.resolve()
    expect(await a).toEqual({ tradeDate: '20261007' })
    expect(await duplicate).toEqual({ tradeDate: '20261007' })
    expect(runScreener).toHaveBeenCalledTimes(2)
    expect(inflight.size).toBe(0)
  })

  it('allows a new calculation after a failed singleflight', async () => {
    const sync = vi.fn().mockRejectedValueOnce(new Error('fixture failure')).mockResolvedValue(undefined)
    const run = vi.fn((_db: unknown, tradeDate: string) => ({ tradeDate }))
    const { computeScreener } = functions(['computeScreener'], {
      _screenerInflight: new Map(), getDb: () => ({}), maybeSyncMoneyFlow: sync, runScreener: run,
    })
    await expect(computeScreener('20261007')).rejects.toThrow('fixture failure')
    expect(await computeScreener('20261007')).toEqual({ tradeDate: '20261007' })
  })

  it('does not invalidate caches when a paid backfill reports no completed write', async () => {
    const deletion = vi.fn()
    const { maybeBackfillTurnover } = functions(['maybeBackfillTurnover'], {
      getDb: () => ({}), isTradeDateTurnoverEmpty: () => true,
      runDailyOHLCVSyncJob: async () => false, deleteByDate: deletion,
      console: { warn: vi.fn() },
    })
    expect(await maybeBackfillTurnover('20261007', false)).toBe(false)
    expect(deletion).not.toHaveBeenCalled()
  })

  it('selects the latest bounded price-data date rather than requiring a paid limit-list cache', () => {
    const get = vi.fn(() => ({ d: '20261008' }))
    const prepare = vi.fn(() => ({ get }))
    const { getLatestTradeDateYmd } = functions(['getLatestTradeDateYmd'], { getBjTodayYmd: () => '20261009' })
    expect(getLatestTradeDateYmd({ prepare })).toBe('20261008')
    expect(prepare.mock.calls[0][0]).toContain('FROM daily_close_cache WHERE trade_date <= ?')
    expect(get).toHaveBeenCalledWith('20261009')
  })

  it('retains the true cached calculation timestamp and scanned count', () => {
    const { dbRowsToSnapshot } = functions(['dbRowsToSnapshot'], {})
    const result = dbRowsToSnapshot([], '20261008', {
      calculatedAt: '2026-10-08T08:00:00.000Z', totalScanned: 57,
    })
    expect(result).toMatchObject({ calculatedAt: '2026-10-08T08:00:00.000Z', totalScanned: 57, isCached: true, stocks: [] })
  })
})
