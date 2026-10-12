import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

it('keeps the health check critical but finishes setup before optional summary refresh', () => {
  const path = 'src/App.tsx'
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let flow: ts.FunctionDeclaration | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'runInitializationFlow') flow = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  const statements = flow?.body?.statements ?? []
  const isCall = (node: ts.Node, name: string) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name
  const health = statements.findIndex(node => ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression) && isCall(node.expression.expression, 'loadOnboardingHealth'))
  const finish = statements.findIndex(node => ts.isExpressionStatement(node) && isCall(node.expression, 'setInitializationFlow') && node.getText(source).includes('running: false'))
  const summary = statements.findIndex(node => ts.isExpressionStatement(node) && ts.isVoidExpression(node.expression) && isCall(node.expression.expression, 'loadDecisionSignalSummary'))
  expect(health).toBeGreaterThanOrEqual(0)
  expect(finish).toBeGreaterThan(health)
  expect(summary).toBeGreaterThan(finish)
  expect(statements.some(node => ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression) && isCall(node.expression.expression, 'loadDecisionSignalSummary'))).toBe(false)
})
