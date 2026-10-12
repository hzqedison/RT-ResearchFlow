import React, { type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

vi.mock('../../src/components/shared/RightDrawer', () => ({
  RightDrawer: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
}))
vi.mock('../../src/components/ShortTermStrategy/PublicConceptSyncPanel', () => ({
  PublicConceptSyncPanel: () => null,
}))

import { ShortTermDataToolsDrawer } from '../../src/components/ShortTermStrategy/ShortTermDataToolsDrawer'

function markup(tushareReady: boolean | null): string {
  const noop = vi.fn()
  return renderToStaticMarkup(<ShortTermDataToolsDrawer
    open source="dc" sourceReady={false} sourceSyncedAt={null}
    sourceSyncProgress={null} fullSyncProgress={null} tushareReady={tushareReady}
    checkingTushare={false} tushareCheckError={null} syncingMembers={false}
    changingSource={false} syncingBaseData={false} syncingAllConcepts={false} message={null}
    onSourceChange={noop} onSyncCurrentSource={noop} onSyncBaseData={noop}
    onSyncAllConcepts={noop} onRefreshTushareStatus={noop} onClose={noop}
  />)
}

function professionalButtonAttributes(html: string): string {
  const button = html.match(/<button\b([^>]*)>同步盘后基础数据<\/button>/)
  expect(button).not.toBeNull()
  return button![1]
}

describe('short-term data guidance', () => {
  it.each([false, null])('explains the free route without unlocking professional sync when ready=%s', ready => {
    const html = markup(ready)
    expect(html).toContain('short-term-free-sync-guidance')
    expect(html).toContain('同步免费涨停池')
    expect(html).toContain('策略实验室')
    expect(html).toContain('无需 Tushare Key 或 Python')
    expect(html).toContain('不补齐集合竞价、龙虎榜、筹码或完整题材数据')
    expect(professionalButtonAttributes(html)).toContain('disabled=""')
  })

  it('retains the professional configuration gate and explicit Key entry', () => {
    const html = markup(true)
    expect(html).toContain('Tushare Key 绑定与验证')
    expect(html).toContain('接口权限尚未验证')
    expect(professionalButtonAttributes(html)).not.toContain('disabled=""')
    expect(html).toContain('short-term-free-sync-guidance')
  })
})
