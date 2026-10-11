import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

// Execute the actual registered callback, without importing Electron, opening
// a user database, making network requests, or loading any broker integration.
const filename = resolve(__dirname, '../../electron/main/ipc/shortTermHandlers.ts')
const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
let callback: ts.Expression | undefined
let tasks: ts.Expression | undefined
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'ALLOWED_TASKS') tasks = node.initializer
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'ipcMain.handle' &&
    ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'shortTerm:syncDataNow') {
    callback = node.arguments[1]
  }
  ts.forEachChild(node, visit)
}
visit(source)
if (!callback || !tasks) throw new Error('Actual manual sync handler or task allowlist missing')
const executable = ts.transpileModule(
  `const ALLOWED_TASKS = ${tasks.getText(source)}; const handler = ${callback.getText(source)}; handler;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText

function fixture() {
  const db = {}
  const deps = {
    getDb: vi.fn(() => db),
    getDataSourceConfig: vi.fn(() => ({ tushareEnabled: false, tushareTokenEncrypted: null as string | null })),
    runStockBasicSyncJob: vi.fn(async () => ({ source: 'sina', rowCount: 2 } as { source: string; rowCount: number } | null)),
    runAfterCloseDailySyncJob: vi.fn(async () => true),
    runTopListSyncJob: vi.fn(async () => true),
    runConceptMembersSyncJob: vi.fn(async () => true),
    runDailyOHLCVSyncJob: vi.fn(async (_date: string) => true),
    console: { error: vi.fn() },
  }
  const invoke = runInNewContext(executable, deps) as (_event: unknown, payload: unknown) => Promise<{ ok: boolean; error?: string }>
  return { deps, invoke }
}

describe('actual manual stock-basic sync callback', () => {
  it('allows the existing public fallback without requiring or reading Tushare configuration', async () => {
    const { deps, invoke } = fixture()
    deps.getDataSourceConfig.mockImplementation(() => { throw new Error('Configuration must not gate stock identities') })
    expect(await invoke(null, { task: 'stockBasic' })).toEqual({ ok: true })
    expect(deps.runStockBasicSyncJob).toHaveBeenCalledOnce()
    expect(deps.getDataSourceConfig).not.toHaveBeenCalled()
    expect(deps.getDb).not.toHaveBeenCalled()
    expect(deps.runAfterCloseDailySyncJob).not.toHaveBeenCalled()
  })

  it('waits for the stock identity write result instead of acknowledging an unfinished job', async () => {
    const { deps, invoke } = fixture()
    let finish!: (value: { source: string; rowCount: number }) => void
    deps.runStockBasicSyncJob.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    let acknowledged = false
    const pending = invoke(null, { task: 'stockBasic' }).then(reply => { acknowledged = true; return reply })
    await Promise.resolve()
    expect(acknowledged).toBe(false)
    finish({ source: 'sina', rowCount: 3 })
    expect(await pending).toEqual({ ok: true })
  })

  it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])('does not report missing/invalid write count %s as success', async value => {
    const { deps, invoke } = fixture()
    deps.runStockBasicSyncJob.mockResolvedValue(value === null ? null : { source: 'sina', rowCount: value })
    expect(await invoke(null, { task: 'stockBasic' })).toEqual({ ok: false, error: 'SYNC_FAILED' })
  })

  it('reports a failed public or paid identity write without leaking upstream details', async () => {
    const { deps, invoke } = fixture()
    deps.runStockBasicSyncJob.mockRejectedValue(new Error('sensitive upstream detail'))
    expect(await invoke(null, { task: 'stockBasic' })).toEqual({ ok: false, error: 'SYNC_FAILED' })
    expect(deps.console.error).toHaveBeenCalledOnce()
  })

  it.each(['afterCloseDaily', 'topList', 'conceptMembers', 'dailyOHLCV'])('keeps the Tushare gate for %s', async task => {
    const { deps, invoke } = fixture()
    expect(await invoke(null, { task })).toEqual({ ok: false, error: 'TUSHARE_DISABLED' })
    expect(deps.runStockBasicSyncJob).not.toHaveBeenCalled()
    expect(deps.runAfterCloseDailySyncJob).not.toHaveBeenCalled()
    expect(deps.runTopListSyncJob).not.toHaveBeenCalled()
    expect(deps.runConceptMembersSyncJob).not.toHaveBeenCalled()
    expect(deps.runDailyOHLCVSyncJob).not.toHaveBeenCalled()
  })

  it.each([null, undefined, {}, { task: 'invalid' }, { task: 1 }])('rejects invalid payload %# before reading config or starting a job', async payload => {
    const { deps, invoke } = fixture()
    expect(await invoke(null, payload)).toEqual({ ok: false, error: 'INVALID_PARAM' })
    expect(deps.getDataSourceConfig).not.toHaveBeenCalled()
    expect(deps.runStockBasicSyncJob).not.toHaveBeenCalled()
  })

  it('preserves the paid-task submission contract and handles background failure', async () => {
    const { deps, invoke } = fixture()
    deps.getDataSourceConfig.mockReturnValue({ tushareEnabled: true, tushareTokenEncrypted: 'test-marker-not-a-token' })
    deps.runAfterCloseDailySyncJob.mockRejectedValue(new Error('test failure'))
    expect(await invoke(null, { task: 'afterCloseDaily' })).toEqual({ ok: true })
    await Promise.resolve()
    expect(deps.runAfterCloseDailySyncJob).toHaveBeenCalledOnce()
    expect(deps.console.error).toHaveBeenCalledOnce()
    expect(deps.runStockBasicSyncJob).not.toHaveBeenCalled()
  })
})
