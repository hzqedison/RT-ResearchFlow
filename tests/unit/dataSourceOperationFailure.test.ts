import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { describePublicDataFailure, describeSelectedDataFailure } from '../../electron/main/utils/publicDataFailure'

const prefix = '所选日线来源均未完成取数：'
const interrupted = describePublicDataFailure({ code: 'UND_ERR_SOCKET' })
const timeout = describePublicDataFailure({ code: 'ETIMEDOUT' })
const limited = describePublicDataFailure(undefined, 429)
const unknown = describePublicDataFailure(new Error('synthetic private error'))

describe('selected-source refresh failure boundary', () => {
  it('preserves source order with fixed public messages and labels', () => {
    expect(describeSelectedDataFailure(new Error(prefix + 'eastmoney: ' + limited + '；tencent: ' + timeout)))
      .toBe(prefix + '东方财富: ' + limited + '；腾讯财经: ' + timeout)
  })
  it('does not split a semicolon inside a trusted TLS explanation', () => {
    const tls = describePublicDataFailure({ code: 'CERT_HAS_EXPIRED' })
    expect(describeSelectedDataFailure(new Error(prefix + 'eastmoney: ' + tls + '；sina: ' + interrupted)))
      .toBe(prefix + '东方财富: ' + tls + '；新浪财经: ' + interrupted)
  })
  it.each([
    prefix + 'eastmoney: synthetic-private-key',
    prefix + 'unknown-provider: ' + interrupted,
    prefix + 'eastmoney: ' + interrupted + '；eastmoney: ' + timeout,
    prefix + 'eastmoney: ' + limited + ' extra-private-body',
    prefix + 'eastmoney: ' + 'x'.repeat(1800),
    prefix,
  ])('rejects untrusted or ambiguous aggregate input', message => {
    expect(describeSelectedDataFailure(new Error(message))).toBe(unknown)
  })
  it('keeps fixed setup and input instructions without reflecting raw input', () => {
    expect(describeSelectedDataFailure(new Error('请至少选择一个日线数据源'))).toBe('请至少选择一个日线数据源')
    expect(describeSelectedDataFailure(new Error('INVALID_STOCK_CODE'))).toBe('请输入有效的六位股票代码。')
    expect(describeSelectedDataFailure({ code: 'UND_ERR_SOCKET', message: 'synthetic-private-url' })).toBe(interrupted)
    expect(describeSelectedDataFailure(null)).toBe(unknown)
  })

  function actualRefreshHandler(failure?: unknown) {
    const source = ts.createSourceFile('aiHandlers.ts', readFileSync(new URL('../../electron/main/ipc/aiHandlers.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
    const matches: ts.Expression[] = []
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'registerTrustedIpcHandler' &&
          node.arguments.length === 3 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'datasource:refreshStock') matches.push(node.arguments[2])
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(matches).toHaveLength(1)
    const success = { provider: 'tencent', latestTradeDate: '20261012', rowsWritten: 2, totalRows: 2, dataState: 'degraded', message: 'synthetic completed daily result' }
    const fetchSelectedStockDaily = failure === undefined ? vi.fn().mockResolvedValue(success) : vi.fn().mockRejectedValue(failure)
    const send = vi.fn(), getCachedPrices = vi.fn(), forecastCacheMap = new Map([['000333', { synthetic: true }]])
    const context = { exports: {} as { handler?: (_event: unknown, data: { stockCode: string }) => Promise<Record<string, unknown>> },
      getDb: vi.fn(() => ({})), fetchSelectedStockDaily, send, forecastCacheMap, getCachedPrices,
      getWindow: () => ({ webContents: { send } }), describeSelectedDataFailure }
    const javascript = ts.transpileModule('exports.handler = ' + matches[0].getText(source), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    runInNewContext(javascript, context)
    if (!context.exports.handler) throw new Error('ACTUAL_REFRESH_HANDLER_NOT_EXTRACTED')
    return { handler: context.exports.handler, fetchSelectedStockDaily, send, forecastCacheMap, getCachedPrices, success }
  }
  it('actual refresh callback preserves safe reasons and performs no success side effects on failure', async () => {
    const context = actualRefreshHandler(new Error(prefix + 'eastmoney: ' + limited + '；tencent: ' + timeout))
    expect(await context.handler(null, { stockCode: '000333' })).toEqual({
      ok: false, reason: 'fetch_error', message: prefix + '东方财富: ' + limited + '；腾讯财经: ' + timeout,
    })
    expect(context.forecastCacheMap.has('000333')).toBe(true)
    expect(context.send).not.toHaveBeenCalled()
    expect(context.getCachedPrices).not.toHaveBeenCalled()
  })
  it('actual refresh callback does not expose arbitrary exception bodies', async () => {
    const context = actualRefreshHandler(new Error('synthetic-private-token-and-path'))
    expect(await context.handler(null, { stockCode: '000333' })).toEqual({ ok: false, reason: 'fetch_error', message: unknown })
  })
  it('actual refresh callback rejects invalid input before fetching', async () => {
    const context = actualRefreshHandler()
    expect(await context.handler(null, { stockCode: '' })).toEqual({ ok: false, reason: 'invalid_code', message: '请输入有效的六位股票代码。' })
    expect(context.fetchSelectedStockDaily).not.toHaveBeenCalled()
  })
  it('actual successful refresh still invalidates forecasts and emits the existing update event', async () => {
    const context = actualRefreshHandler()
    expect(await context.handler(null, { stockCode: '000333' })).toEqual({ ok: true, ...context.success })
    expect(context.forecastCacheMap.has('000333')).toBe(false)
    expect(context.send).toHaveBeenCalledWith('datasource:stocksUpdated', {})
  })
})
