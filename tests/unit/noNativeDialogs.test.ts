import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import ts from 'typescript'

const ROOT = join(__dirname, '../..')
const SOURCE_ROOTS = [join(ROOT, 'src'), join(ROOT, 'electron')]
const IGNORED_DIRECTORIES = new Set(['node_modules', 'out', 'dist', 'coverage'])
const LIVE_HANDLER = join(ROOT, 'electron/main/ipc/macThsHandlers.ts')
const ORDER_SERVICE = join(ROOT, 'electron/main/services/macThsOrderService.ts')
const sources = new Map<string, ts.SourceFile>()

function source(path: string): ts.SourceFile {
  if (!sources.has(path)) sources.set(path, ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true,
    /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS))
  return sources.get(path)!
}
function nodes<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const result: T[] = []
  function visit(node: ts.Node) { if (predicate(node)) result.push(node); ts.forEachChild(node, visit) }
  visit(root)
  return result
}
function name(node: ts.Node): string { return node.getText().replace(/\s+/g, '') }
function callName(node: ts.CallExpression): string { return name(node.expression) }
function calls(root: ts.Node, target: string): ts.CallExpression[] {
  return nodes(root, ts.isCallExpression).filter(node => callName(node) === target)
}
function required<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error('Missing safety structure: ' + label)
  return value
}
function declaration(file: ts.SourceFile, target: string): ts.FunctionDeclaration {
  return required(file.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === target), target)
}
function terms(node: ts.Expression, operator: ts.SyntaxKind): string[] {
  if (ts.isParenthesizedExpression(node)) return terms(node.expression, operator)
  return ts.isBinaryExpression(node) && node.operatorToken.kind === operator
    ? [...terms(node.left, operator), ...terms(node.right, operator)] : [name(node)]
}
function nativeCalls(root: ts.Node): ts.CallExpression[] {
  return nodes(root, ts.isCallExpression).filter(node => {
    const fn = node.expression
    if (ts.isIdentifier(fn)) return ['alert', 'confirm', 'prompt'].includes(fn.text)
    if (!ts.isPropertyAccessExpression(fn)) return false
    if (['showMessageBox', 'showMessageBoxSync', 'showErrorBox'].includes(fn.name.text)) return true
    return ['alert', 'confirm', 'prompt'].includes(fn.name.text) && ['window', 'globalThis', 'self'].includes(name(fn.expression))
  })
}
function confirmationBody(file: ts.SourceFile): ts.Block {
  const factory = declaration(file, 'createMacThsNativeConfirmation')
  const returned = required(factory.body?.statements.find(ts.isReturnStatement)?.expression, 'confirmation callback')
  expect(ts.isArrowFunction(returned)).toBe(true)
  const callback = returned as ts.ArrowFunction
  expect(callback.modifiers?.some(node => node.kind === ts.SyntaxKind.AsyncKeyword)).toBe(true)
  expect(ts.isBlock(callback.body)).toBe(true)
  return callback.body as ts.Block
}
function afterAwait(call: ts.CallExpression): ts.Statement[] {
  expect(ts.isAwaitExpression(call.parent)).toBe(true)
  let statement: ts.Node = call
  while (statement.parent && !ts.isBlock(statement.parent)) statement = statement.parent
  const block = required(statement.parent && ts.isBlock(statement.parent) ? statement.parent : undefined, 'await block')
  return [...block.statements].slice(block.statements.indexOf(statement as ts.Statement) + 1)
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return IGNORED_DIRECTORIES.has(entry) ? [] : sourceFiles(path)
    return /\.(?:ts|tsx|js|jsx)$/.test(entry) ? [path] : []
  })
}

describe('项目内反馈契约', () => {
  it('普通业务反馈不调用浏览器或Electron原生消息框，实盘逐笔安全确认除外', () => {
    const violations = SOURCE_ROOTS
      .flatMap(sourceFiles)
      .filter((path) => {
        const file = source(path)
        // Exempt one exact awaited call in the trusted factory, not a service or file.
        // The second contract below checks the factory's cancellation/caller guards.
        const review = path === LIVE_HANDLER ? calls(confirmationBody(file), 'dialog.showMessageBox')[0] : undefined
        return nativeCalls(file).some(call => call !== review)
      })
      .map((path) => relative(ROOT, path))

    expect(violations).toEqual([])
    const fixture = ts.createSourceFile('dialog-policy.ts',
      'window.confirm("feedback"); globalThis.alert("feedback"); self.prompt("feedback"); dialog.showErrorBox("x", "y"); this.options.confirm(prompt, caller)',
      ts.ScriptTarget.Latest, true)
    expect(nativeCalls(fixture)).toHaveLength(4)
  })

  it('唯一的系统确认由受信handler提供，默认取消，await后复核caller及service授权门禁', () => {
    const handler = source(LIVE_HANDLER), service = source(ORDER_SERVICE)
    const body = confirmationBody(handler)
    const reviews = calls(handler, 'dialog.showMessageBox')
    expect(reviews).toHaveLength(1)
    const review = reviews[0]
    expect(calls(body, 'dialog.showMessageBox')).toEqual([review])
    expect(name(review.arguments[0])).toBe('parent')
    const options = review.arguments[1]
    expect(ts.isObjectLiteralExpression(options)).toBe(true)
    const properties = new Map((options as ts.ObjectLiteralExpression).properties.filter(ts.isPropertyAssignment)
      .map(property => [name(property.name), property.initializer]))
    expect(name(required(properties.get('type'), 'warning type'))).toMatch(/^['"]warning['"]$/)
    expect(name(required(properties.get('defaultId'), 'cancel default'))).toBe('0')
    expect(name(required(properties.get('cancelId'), 'cancel escape'))).toBe('0')
    expect(name(required(properties.get('noLink'), 'plain buttons'))).toBe('true')
    const buttons = required(properties.get('buttons'), 'confirmation buttons')
    expect(ts.isArrayLiteralExpression(buttons)).toBe(true)
    const buttonItems = (buttons as ts.ArrayLiteralExpression).elements
    expect(buttonItems).toHaveLength(2)
    expect(ts.isStringLiteral(buttonItems[0]) && buttonItems[0].text).toBe('取消')
    expect(name(buttonItems[1])).toBe('prompt.confirmLabel')
    expect(calls(body, 'getWindow')).toHaveLength(1)
    const before = required(body.statements.find((node): node is ts.IfStatement => ts.isIfStatement(node) && node.end < review.getStart()), 'pre-dialog caller guard')
    expect(terms(before.expression, ts.SyntaxKind.BarBarToken)).toEqual(['!parent', 'parent.isDestroyed()', '!caller.isCurrent()'])
    expect(nodes(before.thenStatement, ts.isReturnStatement).map(node => node.expression && name(node.expression))).toEqual(['false'])
    const completed = required(afterAwait(review).find(ts.isReturnStatement)?.expression, 'post-dialog caller guard')
    expect(terms(completed, ts.SyntaxKind.AmpersandAmpersandToken)).toEqual(['caller.isCurrent()', 'result.response===1'])

    const trusted = declaration(handler, 'trustedCaller')
    const current = required(nodes(trusted, ts.isVariableDeclaration).find(node => name(node.name) === 'isCurrent')?.initializer, 'trusted current-frame capability') as ts.ArrowFunction
    const currentReturn = required(nodes(current.body, ts.isReturnStatement)[0]?.expression, 'caller identity conjunction')
    expect(terms(currentReturn, ts.SyntaxKind.AmpersandAmpersandToken)).toEqual(expect.arrayContaining([
      '!!window', '!window.isDestroyed()', 'event.sender===window.webContents', '!event.sender.isDestroyed()',
      'frame!==null', 'frame===window.webContents.mainFrame',
    ]))
    const trustedGuard = required(trusted.body?.statements.find(ts.isIfStatement), 'caller rejected before capability creation')
    expect(terms(trustedGuard.expression, ts.SyntaxKind.BarBarToken)).toEqual(['!frame', '!isCurrent()'])
    expect(nodes(trustedGuard.thenStatement, ts.isThrowStatement)).toHaveLength(1)
    for (const method of ['execute', 'recover', 'reviewIntent']) {
      const registered = required(calls(declaration(handler, 'registerMacThsHandlers'), 'ipcMain.handle')
        .find(call => ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === 'macThs:' + method), method + ' IPC')
      const callback = registered.arguments[1]
      const trust = calls(callback, 'trustedCaller')
      const operation = calls(callback, 'service.' + method)
      expect(trust).toHaveLength(1); expect(operation).toHaveLength(1)
      expect(trust[0].getStart()).toBeLessThan(operation[0].getStart())
      expect(trust[0].arguments.map(name)).toEqual(['event', 'getWindow'])
      expect(operation[0].arguments.map(name)).toEqual(['payload', 'caller'])
      const recheck = required(afterAwait(operation[0]).find(ts.isIfStatement), method + ' post-await rejection')
      expect(name(recheck.expression)).toBe('!caller.isCurrent()')
      expect(nodes(recheck.thenStatement, ts.isThrowStatement)).toHaveLength(1)
    }

    const klass = required(service.statements.find((node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === 'MacThsOrderService'), 'order service')
    const method = (target: string) => required(klass.members.find((node): node is ts.MethodDeclaration =>
      ts.isMethodDeclaration(node) && name(node.name) === target), target)
    // These are injected main-only callbacks, not browser confirm() calls or a file exemption.
    expect(calls(service, 'this.options.confirm')).toHaveLength(4)
    for (const target of ['execute', 'mutate', 'recover', 'reviewIntent']) {
      const confirmations = calls(method(target), 'this.options.confirm')
      expect(confirmations).toHaveLength(1)
      expect(name(confirmations[0].arguments[1])).toBe('caller')
      const following = afterAwait(confirmations[0])
      const check = calls(required(following[0], target + ' immediate authority recheck'), 'this.check')
      expect(check).toHaveLength(1)
      expect(check[0].arguments.slice(0, 2).map(name)).toEqual(['caller', 'generation'])
      const cancelled = required(following.find((node): node is ts.IfStatement =>
        ts.isIfStatement(node) && name(node.expression) === '!approved'), target + ' cancellation branch')
      expect(nodes(cancelled.thenStatement, ts.isReturnStatement).some(node => node.expression &&
        nodes(node.expression, ts.isPropertyAssignment).some(property => name(property.name) === 'code' &&
          ts.isStringLiteral(property.initializer) && property.initializer.text === 'USER_CANCELLED'))).toBe(true)
      if (target === 'execute' || target === 'mutate') {
        expect(following.slice(0, following.indexOf(cancelled)).flatMap(statement => calls(statement, 'this.gate'))).toHaveLength(1)
      }
    }
    const assertions = calls(method('check'), 'assert').flatMap(call => terms(call.arguments[0], ts.SyntaxKind.AmpersandAmpersandToken))
    expect(assertions).toEqual(expect.arrayContaining(['caller.isCurrent()', '!this.stopping', 'generation===this.generation']))
  })
})
