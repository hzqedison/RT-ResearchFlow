import React from 'react'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RollingValidationPanel } from '../../src/components/StrategyBacktest/RollingValidationPanel'
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())
it('shows explicit protocol fields and requires consent before saving', () => {
  const html = renderToStaticMarkup(<RollingValidationPanel />)
  for (const label of ['滚动验证数据集', '滚动验证起始日', '滚动验证结束日', '训练开市日数', '测试开市日数', '隔离开市日数', '候选持有期（逗号分隔）', '每窗研究预算']) expect(html).toContain(`aria-label="${label}"`)
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>保存新验证协议<\/button>/)
})
it('states independent budgets, imperfect historical facts and no orders', () => {
  const html = renderToStaticMarkup(<RollingValidationPanel />)
  for (const text of ['各窗口独立重置研究预算', '不提交订单', '历史信号当时可得性', '不是整个研究的一次性行情快照', '亏损测试窗口不按收益或回撤过滤', '数据不足不计零收益']) expect(html).toContain(text)
})
