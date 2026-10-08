import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactNode } from 'react'
import * as React from 'react'
import { resolve } from 'node:path'
import ts from 'typescript'

const m = vi.hoisted(() => ({
  external: vi.fn(),
  setters: [] as ReturnType<typeof vi.fn>[],
}))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const set = vi.fn()
    m.setters.push(set)
    return [initial, set]
  },
}))
import { AppUpdates } from '../../src/components/AppUpdates/AppUpdates'

function findReleaseButton(node: ReactNode): (() => void) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findReleaseButton(child)
      if (found) return found
    }
    return undefined
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return undefined
  if (node.type === 'button' && node.props.children === '打开发布页面') return node.props.onClick
  return findReleaseButton(node.props.children)
}
async function clickRelease() {
  const click = findReleaseButton(AppUpdates())
  expect(click).toBeTypeOf('function')
  click?.()
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}
beforeEach(() => {
  vi.resetAllMocks()
  m.setters.length = 0
  vi.stubGlobal('React', React)
  vi.stubGlobal('window', { api: { openExternal: m.external } })
})
afterEach(() => vi.unstubAllGlobals())

describe('AppUpdates native external-link contract', () => {
  it('accepts a successful result with no data property', async () => {
    m.external.mockResolvedValue({ ok: true })
    await clickRelease()
    expect(m.external).toHaveBeenCalledWith('https://github.com/hzqedison/RT-ResearchFlow/releases')
    expect(m.setters[5]).toHaveBeenCalledTimes(1)
    expect(m.setters[5]).toHaveBeenCalledWith('')
    expect(m.setters[4].mock.calls).toEqual([[true], [false]])
  })
  it('maps all native error codes and unknown values to static Chinese reasons and next steps', async () => {
    const cases = [
      ['UNAUTHORIZED', '当前窗口无权打开发布页面。请关闭此页面，从应用主窗口重新进入应用更新后重试。'],
      ['INVALID_URL', '发布页面地址未通过安全检查。请重新打开应用更新后重试，仍失败时请反馈此问题。'],
      ['OPEN_FAILED', '系统未能打开浏览器。请确认已设置默认浏览器后重试。'],
      ['UNKNOWN_PROVIDER_SECRET', '发布页面打开失败。请稍后重试，仍失败时请反馈此问题。'],
    ]
    for (const [code, message] of cases) {
      m.setters.length = 0
      m.external.mockResolvedValue({ ok: false, error: code })
      await clickRelease()
      expect(m.setters[5]).toHaveBeenLastCalledWith(message)
      expect(m.setters[4]).toHaveBeenLastCalledWith(false)
    }
  })
  it('handles rejected requests and releases busy state', async () => {
    m.external.mockRejectedValue(new Error('isolated bridge failure'))
    await clickRelease()
    expect(m.setters[5]).toHaveBeenLastCalledWith('发布页面未能打开，请稍后重试。')
    expect(m.setters[4]).toHaveBeenLastCalledWith(false)
  })
  it('typechecks the actual component against the existing window API declaration without casts', () => {
    const configPath = resolve('tsconfig.web.json')
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    expect(config.error).toBeUndefined()
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve('.'))
    const component = resolve('src/components/AppUpdates/AppUpdates.tsx')
    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: { ...parsed.options, noEmit: true },
    })
    const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error
      && d.file && resolve(d.file.fileName) === component)
    expect(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
  }, 30_000)
})
