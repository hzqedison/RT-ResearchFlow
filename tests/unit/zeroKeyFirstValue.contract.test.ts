import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

function trustedHandlerBody(syntax: ts.SourceFile, channel: string): string {
  const matches: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'registerTrustedIpcHandler'
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === channel) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(syntax)
  expect(matches).toHaveLength(1)
  expect(matches[0].arguments[1]?.getText(syntax)).toBe('getWindow')
  const handler = matches[0].arguments[2]
  if (!handler || (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler))) {
    throw new Error(`Missing trusted callback: ${channel}`)
  }
  return handler.body.getText(syntax)
}

describe('FR-252 zero-key first-value contracts', () => {
  it('keeps the fallback inside existing narrow IPC channels', () => {
    const handlers = source('electron/main/ipc/aiHandlers.ts')
    const syntax = ts.createSourceFile('aiHandlers.ts', handlers, ts.ScriptTarget.Latest, true)
    const fetchHandler = trustedHandlerBody(syntax, 'datasource:fetchStock')
    const refreshHandler = trustedHandlerBody(syntax, 'datasource:refreshStock')
    expect(fetchHandler).toContain("getCachedStockFetchSummary(db, stockCode, 'local-cache', 0)")
    expect(fetchHandler).toContain('fetchSelectedStockDaily(db, stockCode)')
    expect(fetchHandler).not.toContain('TUSHARE_NOT_CONFIGURED')
    expect(refreshHandler).toContain('fetchSelectedStockDaily(db, stockCode)')
    expect(refreshHandler).toContain("reason: 'invalid_code'")

    const router = source('electron/main/services/multiSourceMarketService.ts')
    expect(router).toContain('const config = getMultiSourcePreference(db)')
    expect(router).toContain('config.dailyProviders')
    expect(router).toContain("provider === 'eastmoney'")
    expect(router).toContain('fetchEastmoneySingleStockDaily(db, stockCode)')
    expect(router).toContain("provider === 'tencent' || provider === 'sina'")
  })

  it('exposes source, fact date and coverage without adding a preload namespace', () => {
    const preload = source('electron/preload/index.ts')
    const chart = source('src/components/StockChart/StockChart.tsx')

    expect(preload).toContain("provider: DailyDataProvider | 'local-cache'")
    expect(preload).toContain("dataState: 'complete' | 'degraded'")
    expect(preload).toContain('latestTradeDate: string | null')
    expect(preload).toContain('totalRows: number')
    expect(chart).toContain('data-testid="stock-data-source-status"')
    expect(chart).toContain('data-provider={stockDataStatus.provider}')
    expect(chart).toContain('aria-live="polite"')
    expect(chart).toContain('await reloadStocks();')
  })

  it('uses one fixed benchmark and does not put it into the stock-list cache', () => {
    const service = source('electron/main/services/tushareService.ts')

    expect(service).toContain('const benchmark = await ensureTrendBenchmarkFreshness(db)')
    expect(service).toContain("const dailyOnly = tsCode === '000300.SH'")
    expect(service).toContain('if (!dailyOnly) insertPrices(db, sortedRows)')
    expect(service).toContain('upsertDailyClose(db, dailyRows)')
  })
})
