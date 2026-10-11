import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { describeScreenerEmptyResult, STOCK_BASIC_SYNC_FAILURE_MESSAGE } from '../../src/components/ShortTermStrategy/screenerDataPresentation'

const sources = Object.fromEntries([
  ['personal', 'src/components/ShortTermStrategy/PersonalScreener.tsx'],
  ['chart', 'src/components/StockChart/StockChart.tsx'],
].map(([name, path]) => {
  const filename = resolve(__dirname, '../../', path)
  return [name, ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)]
}))

// Execute production callbacks with state/IPC doubles, not a duplicate workflow.
// These tests do not render a native window, read user data, or reach the network.
function callback(source: ts.SourceFile, name: string, deps: object) {
  let arrow: ts.Expression | undefined
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name &&
      node.initializer && ts.isCallExpression(node.initializer)) arrow = node.initializer.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!arrow || !ts.isArrowFunction(arrow)) throw new Error(`Production callback ${name} missing`)
  const executable = ts.transpileModule(`const callback = ${arrow.getText(source)}; callback;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  return runInNewContext(executable, deps) as (...args: unknown[]) => Promise<void>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function basicFixture() {
  const sync = vi.fn(async () => ({ ok: true }))
  const deps = {
    mountedRef: { current: true }, stockBasicSyncRef: { current: false }, stockBasicRequestRef: { current: 0 },
    window: { api: { shortTerm: { syncDataNow: sync } } },
    setSyncingBasic: vi.fn(), setStockBasicSyncError: vi.fn(),
    loadSnapshot: vi.fn(async (_force: boolean) => undefined),
    STOCK_BASIC_SYNC_FAILURE_MESSAGE,
  }
  return { deps, sync, invoke: callback(sources.personal, 'handleSyncStockBasic', deps) }
}

describe('personal screener stock-identity workflow', () => {
  it('refreshes immediately after the completed write and awaits the refreshed snapshot', async () => {
    const { deps, sync, invoke } = basicFixture()
    const refresh = deferred<void>()
    const refreshStarted = deferred<void>()
    const write = deferred<{ ok: boolean }>()
    sync.mockReturnValue(write.promise)
    deps.loadSnapshot.mockImplementation(() => {
      refreshStarted.resolve()
      return refresh.promise
    })
    let finished = false
    const pending = invoke().then(() => { finished = true })
    expect(sync).toHaveBeenCalledWith('stockBasic')
    expect(deps.loadSnapshot).not.toHaveBeenCalled()
    write.resolve({ ok: true })
    await refreshStarted.promise
    expect(deps.loadSnapshot).toHaveBeenCalledWith(false)
    expect(finished).toBe(false)
    expect(deps.setSyncingBasic).toHaveBeenLastCalledWith(true)
    refresh.resolve()
    await pending
    expect(deps.setSyncingBasic).toHaveBeenLastCalledWith(false)
  })

  it('prevents a second click before React state has rendered', async () => {
    const { deps, sync, invoke } = basicFixture()
    const write = deferred<{ ok: boolean }>()
    sync.mockReturnValue(write.promise)
    const first = invoke()
    await invoke()
    expect(sync).toHaveBeenCalledOnce()
    write.resolve({ ok: true })
    await first
    expect(deps.stockBasicSyncRef.current).toBe(false)
  })

  it('keeps the retry workflow available after a failed write without blaming Tushare', async () => {
    const { deps, sync, invoke } = basicFixture()
    sync.mockResolvedValue({ ok: false })
    await invoke()
    expect(deps.setStockBasicSyncError).toHaveBeenLastCalledWith(STOCK_BASIC_SYNC_FAILURE_MESSAGE)
    expect(deps.loadSnapshot).not.toHaveBeenCalled()
    expect(deps.stockBasicSyncRef.current).toBe(false)
    sync.mockResolvedValue({ ok: true })
    await invoke()
    expect(sync).toHaveBeenCalledTimes(2)
    expect(deps.loadSnapshot).toHaveBeenCalledOnce()
  })

  it('does not expose raw rejected IPC details', async () => {
    const { deps, sync, invoke } = basicFixture()
    sync.mockRejectedValue(new Error('credential-or-local-path-placeholder'))
    await invoke()
    expect(deps.setStockBasicSyncError).toHaveBeenLastCalledWith(STOCK_BASIC_SYNC_FAILURE_MESSAGE)
    expect(deps.loadSnapshot).not.toHaveBeenCalled()
  })

  it.each(['unmounted', 'new-generation'])('ignores a write response from an obsolete %s operation', async mode => {
    const { deps, sync, invoke } = basicFixture()
    const write = deferred<{ ok: boolean }>()
    sync.mockReturnValue(write.promise)
    const pending = invoke()
    if (mode === 'unmounted') deps.mountedRef.current = false
    else ++deps.stockBasicRequestRef.current
    write.resolve({ ok: true })
    await pending
    expect(deps.loadSnapshot).not.toHaveBeenCalled()
    expect(deps.setSyncingBasic).toHaveBeenCalledTimes(1)
  })
})

describe('personal screener snapshot request ordering', () => {
  function fixture() {
    const get = vi.fn(), run = vi.fn()
    const deps = {
      mountedRef: { current: true }, snapshotRequestRef: { current: 0 },
      window: { api: { shortTerm: { screener: { get, run } } } },
      setLoading: vi.fn(), setRunning: vi.fn(), setErrorMsg: vi.fn(), setSnapshot: vi.fn(),
    }
    return { deps, get, run, invoke: callback(sources.personal, 'loadSnapshot', deps) }
  }
  it('does not let an older success replace a newer result or clear its loading state', async () => {
    const { deps, get, run, invoke } = fixture()
    const old = deferred<unknown>(), current = deferred<unknown>()
    get.mockReturnValue(old.promise)
    run.mockReturnValue(current.promise)
    const first = invoke(false), second = invoke(true)
    old.resolve({ ok: true, snapshot: 'old-result' })
    await first
    expect(deps.setSnapshot).not.toHaveBeenCalled()
    expect(deps.setLoading.mock.calls.filter(([value]) => value === false)).toHaveLength(0)
    current.resolve({ ok: true, snapshot: 'current-result' })
    await second
    expect(deps.setSnapshot).toHaveBeenCalledOnce()
    expect(deps.setSnapshot).toHaveBeenCalledWith('current-result')
    expect(deps.setLoading).toHaveBeenLastCalledWith(false)
  })

  it('ignores an older failure after a newer snapshot succeeded', async () => {
    const { deps, get, invoke } = fixture()
    const old = deferred<unknown>()
    get.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ok: true, snapshot: 'new-result' })
    const first = invoke()
    await invoke()
    old.reject(new Error('stale-error'))
    await first
    expect(deps.setErrorMsg.mock.calls.flat()).not.toContain('stale-error')
    expect(deps.setSnapshot).toHaveBeenCalledOnce()
    expect(deps.setSnapshot).toHaveBeenCalledWith('new-result')
  })

  it('ignores results after unmount', async () => {
    const { deps, get, invoke } = fixture()
    const response = deferred<unknown>()
    get.mockReturnValue(response.promise)
    const pending = invoke()
    deps.mountedRef.current = false
    response.resolve({ ok: true, snapshot: 'obsolete-result' })
    await pending
    expect(deps.setSnapshot).not.toHaveBeenCalled()
  })
})

describe('stock search identity sync', () => {
  it.each(['reply', 'reject'])('gives public-source retry guidance on %s failure', async mode => {
    const sync = mode === 'reply' ? vi.fn(async () => ({ ok: false, error: 'TUSHARE_DISABLED' }))
      : vi.fn(async () => { throw new Error('sensitive-detail') })
    const deps = {
      searchCode: ' 600000 ', stockBasicSyncing: false,
      window: { api: { shortTerm: { syncDataNow: sync } } },
      setStockBasicSyncing: vi.fn(), setSearchError: vi.fn(), querySearchCandidates: vi.fn(),
    }
    await callback(sources.chart, 'handleSyncStockBasic', deps)()
    expect(deps.setSearchError).toHaveBeenLastCalledWith(STOCK_BASIC_SYNC_FAILURE_MESSAGE)
    expect(deps.querySearchCandidates).not.toHaveBeenCalled()
    expect(deps.setStockBasicSyncing).toHaveBeenLastCalledWith(false)
  })
})

describe('screener empty-state coverage', () => {
  function selectionUpdater(codes: Set<string>) {
    let updater: ts.Expression | undefined
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && node.expression.getText(sources.personal) === 'setSelectedInsightCodes' &&
        node.arguments[0]?.getText(sources.personal).includes('prev.filter(code => displayedCodeSet.has(code))')) updater = node.arguments[0]
      ts.forEachChild(node, visit)
    }
    visit(sources.personal)
    if (!updater) throw new Error('Production selection cleanup missing')
    const code = ts.transpileModule(`const update = ${updater.getText(sources.personal)}; update;`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    return runInNewContext(code, { displayedCodeSet: codes }) as (prev: string[]) => string[]
  }
  it('does not schedule another render when empty selection remains empty', () => {
    const prev: string[] = []
    expect(selectionUpdater(new Set())(prev)).toBe(prev)
  })
  it('preserves state identity when all selected candidates remain visible', () => {
    const prev = ['A', 'B']
    expect(selectionUpdater(new Set(['A', 'B', 'C']))(prev)).toBe(prev)
  })
  it('removes hidden selections once, then becomes idempotent', () => {
    const update = selectionUpdater(new Set(['A']))
    const next = update(['A', 'B'])
    expect(next).toEqual(['A'])
    expect(update(next)).toBe(next)
  })
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])('does not report scan count %s as no trading signals', totalScanned => {
    expect(describeScreenerEmptyResult({ totalScanned, totalSignals: 0, minSignal: 5, requireTurnover: true }).kind).toBe('not-scanned')
  })
  it('limits the no-signal claim to the actual scanned universe', () => {
    const result = describeScreenerEmptyResult({ totalScanned: 23, totalSignals: 0, minSignal: 5, requireTurnover: true })
    expect(result.kind).toBe('no-signals')
    expect(result.detail).toContain('23')
    expect(result.detail).toContain('不代表全市场')
  })
  it.each([true, false])('reports existing candidates hidden by display filters, turnover=%s', requireTurnover => {
    const result = describeScreenerEmptyResult({ totalScanned: 23, totalSignals: 4, minSignal: 5, requireTurnover })
    expect(result.kind).toBe('filtered-empty')
    expect(result.detail).toContain('4')
    expect(result.title.includes('有效换手')).toBe(requireTurnover)
  })
})
