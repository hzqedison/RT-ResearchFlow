import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(__dirname, '../..')
const SOURCE_ROOTS = [join(ROOT, 'src'), join(ROOT, 'electron')]
const IGNORED_DIRECTORIES = new Set(['node_modules', 'out', 'dist', 'coverage'])
const NATIVE_DIALOG_PATTERN = /(?:(?:window|globalThis|self)\s*\.\s*)?(?:alert|confirm|prompt)\s*\(|dialog\s*\.\s*show(?:MessageBox(?:Sync)?|ErrorBox)\s*\(/
const LIVE_HANDLER = join(ROOT, 'electron/main/ipc/macThsHandlers.ts')
// Only the cancel-by-default, main-process live-order review is exempt from feedback dialogs.
const LIVE_REVIEW_PATTERN = /await dialog\.showMessageBox\(parent, \{ type: 'warning',[\s\S]*?defaultId: 0, cancelId: 0, noLink: true \}\)/

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
        const source = readFileSync(path, 'utf8')
        return NATIVE_DIALOG_PATTERN.test(path === LIVE_HANDLER ? source.replace(LIVE_REVIEW_PATTERN, '') : source)
      })
      .map((path) => relative(ROOT, path))

    expect(violations).toEqual([])
  })

  it('唯一的系统确认必须绑定主进程实盘操作，默认取消并在确认后重新检查授权', () => {
    const source = readFileSync(LIVE_HANDLER, 'utf8')
    expect(source.match(/dialog\s*\.\s*showMessageBox\s*\(/g)).toHaveLength(1)
    expect(source).toMatch(LIVE_REVIEW_PATTERN)
    expect(source).toContain('if (liveMutates) {')
    expect(source).toContain('const parent = getWindow()')
    expect(source).toContain("if (review.response !== 1) return result(action, mode, 'USER_CANCELLED'")
    expect(source).toContain("if (!authorized(event) || !liveEnabled) return result(action, mode, 'INVALID_ORDER'")
  })
})
