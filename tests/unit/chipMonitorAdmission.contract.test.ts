import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

it('checks chip admission in the chip start handler before stock-pool writes', () => {
  const path = 'electron/main/ipc/shortTermHandlers.ts'
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  let handler = ''
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'ipcMain.handle'
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === 'shortTerm:chipMonitor:start') handler = node.arguments[1].getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  const admission = handler.indexOf('chipMonitorWorkOwner.assertAccepting()')
  expect(admission).toBeGreaterThanOrEqual(0)
  expect(admission).toBeLessThan(handler.indexOf('replaceMonitorStocksBySource('))
  expect(handler).toContain("error: 'LOCAL_WORK_CANCELLED'")
})
