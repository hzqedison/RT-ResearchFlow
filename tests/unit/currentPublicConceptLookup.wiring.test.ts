import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryCurrentPublicConcepts } from '../../electron/main/services/currentPublicConceptLookupService'
import { CurrentPublicConceptLookupPanel } from '../../src/components/ShortTermStrategy/CurrentPublicConceptLookupPanel'

afterEach(() => vi.unstubAllGlobals())
function source(path: string) {
  return ts.createSourceFile(path, readFileSync(resolve(path), 'utf8'), ts.ScriptTarget.Latest, true)
}
function compile(expression: string, names: string[], values: unknown[]) {
  const compiled = ts.transpileModule(`const callback = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...names, `${compiled}\nreturn callback;`)(...values)
}
describe('current public concept actual wiring', () => {
  const main = source('electron/main/ipc/shortTermHandlers.ts')
  let callback: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(main) === 'ipcMain.handle' &&
        ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'shortTerm:lookupCurrentPublicConcepts') callback = node.arguments[1]
    ts.forEachChild(node, visit)
  }
  visit(main)
  it('actual main callback invokes the no-Key use case and distinguishes absent cache', () => {
    expect(callback).toBeDefined()
    const getDb = vi.fn(() => ({ prepare: () => ({ get: () => undefined }) }))
    const handler = compile(callback!.getText(main), ['queryCurrentPublicConcepts', 'getDb'], [queryCurrentPublicConcepts, getDb])
    expect(handler({}, { tsCode: '600000' })).toMatchObject({ ok: true, data: { state: 'cache-missing', historicalCoverage: false } })
    expect(getDb).toHaveBeenCalledOnce()
  })
  it('actual main callback rejects history and unknown fields before DB access', () => {
    const getDb = vi.fn()
    const handler = compile(callback!.getText(main), ['queryCurrentPublicConcepts', 'getDb'], [queryCurrentPublicConcepts, getDb])
    expect(handler({}, { tsCode: '600000', tradeDate: '2020-01-01' })).toMatchObject({ ok: false, code: 'INVALID_STOCK_QUERY' })
    expect(getDb).not.toHaveBeenCalled()
  })
  it('actual preload method invokes only the restricted channel with a stock code payload', async () => {
    const preload = source('electron/preload/index.ts')
    let method: ts.Expression | undefined
    const visitPreload = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText(preload) === 'lookupCurrentPublicConcepts') method = node.initializer
      ts.forEachChild(node, visitPreload)
    }
    visitPreload(preload)
    expect(method).toBeDefined()
    const invoke = vi.fn().mockResolvedValue({ ok: true })
    const call = compile(method!.getText(preload), ['ipcRenderer'], [{ invoke }])
    await call('600000.SH')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('shortTerm:lookupCurrentPublicConcepts', { tsCode: '600000.SH' })
  })
  it('renders the actual query panel with stock input, actionable control and historical limitation', () => {
    vi.stubGlobal('React', React)
    const html = renderToStaticMarkup(React.createElement(CurrentPublicConceptLookupPanel, { open: true }))
    expect(html).toContain('aria-label="查询题材的股票代码"')
    expect(html).toContain('查询本地题材')
    expect(html).toContain('不能直接作为历史回测依据')
    expect(html).toContain('无需 Token 或 Python')
  })
})
