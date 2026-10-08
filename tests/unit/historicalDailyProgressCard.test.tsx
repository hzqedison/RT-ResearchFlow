import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoricalDailyProgressSnapshot } from '../../electron/shared/historicalDailyProgress'
import {
  createHistoricalDailyProgressReader, HistoricalDailyProgressCard, HistoricalDailyProgressCardView, startHistoricalDailyProgressPolling,
  type HistoricalDailyProgressReadState, type HistoricalDailyProgressResponse,
} from '../../src/components/DataSource/HistoricalDailyProgressCard'

const NOW = 1_800_000_000_000
const snapshot = (patch: Partial<HistoricalDailyProgressSnapshot> = {}): HistoricalDailyProgressSnapshot => ({
  status: 'running', totalItems: 100, processedItems: 25, writtenRows: 456,
  currentItem: '000001.SZ', startedAt: NOW - 60_000, completedAt: null,
  updatedAt: NOW - 5_000, checkedAt: NOW, resumeAt: null, stale: false, ...patch,
})
const initial: HistoricalDailyProgressReadState = {
  snapshot: null, fetchedAt: null, reading: false, error: null, nextReadAt: null,
}
function render(patch: Partial<HistoricalDailyProgressSnapshot> = {}, state: Partial<HistoricalDailyProgressReadState> = {}, now = NOW) {
  return renderToStaticMarkup(createElement(HistoricalDailyProgressCardView, {
    ...initial, snapshot: snapshot(patch), fetchedAt: NOW - 1_000, nextReadAt: NOW + 3_000, ...state, now,
  }))
}
function deferred() {
  let resolve!: (result: HistoricalDailyProgressResponse) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<HistoricalDailyProgressResponse>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}
const stops: Array<() => void> = []
function poll(read: () => Promise<HistoricalDailyProgressResponse>, isVisible?: () => boolean) {
  const updates: HistoricalDailyProgressReadState[] = []
  const controller = startHistoricalDailyProgressPolling({ read, onChange: value => updates.push(value), isVisible })
  stops.push(controller.stop)
  return { ...controller, updates, latest: () => updates[updates.length - 1] }
}
afterEach(() => {
  stops.splice(0).forEach(stop => stop())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('免费历史日线进度纯视图', () => {
  it('显示数量、实际进度、写入行、时间和最近记录股票，而不是正在请求股票', () => {
    const html = render()
    expect(html).toContain('25 / 100')
    expect(html).toContain('25%')
    expect(html).toContain('本轮写入行')
    expect(html).toContain('456')
    expect(html).toContain('000001.SZ')
    expect(html).toContain('不保证正在请求')
    expect(html).toContain('开始时间')
    expect(html).toContain('5 秒前')
    expect(html).toContain('aria-valuenow="25"')
    expect(html).toContain('3 秒后刷新进度')
    expect(html).not.toContain('预计完成')
  })

  it.each([
    ['idle', '未运行 · 空闲'], ['preparing', '准备 · 准备股票列表'], ['running', '运行 · 运行中'], ['waiting', '等待 · 批次等待中'],
    ['interrupted', '结束 · 已中断'], ['success', '结束 · 本轮处理完成'],
    ['partial', '结束 · 部分完成'], ['failed', '结束 · 本轮失败'], ['cooldown', '结束 · 已停止'],
  ] as const)('明确区分 %s 状态', (status, label) => {
    expect(render({ status })).toContain(label)
  })

  it('waiting 表示后台任务仍在运行且处于批次间隔，中断表示后台任务已中断', () => {
    expect(render({ status: 'waiting' })).toContain('后台任务仍在运行，目前处于批次间隔')
    expect(render({ status: 'interrupted' })).toContain('当前后台任务已中断')
  })

  it('preparing 表示后台任务正在准备列表但总量未知，不展示 0% 或伪装完成', () => {
    const html = render({ status: 'preparing', totalItems: 0, processedItems: 0, startedAt: null })
    expect(html).toContain('准备股票列表')
    expect(html).toContain('后台任务正在准备股票列表')
    expect(html).toContain('尚未记录')
    expect(html).not.toContain('尚未开始')
    expect(html).toContain('总量未知，暂无百分比')
    expect(html).not.toContain('aria-valuenow=')
    expect(html).not.toContain('>0%</')
  })

  it('未知总量不伪装为 100%，未完成比例不四舍五入为 100%', () => {
    const unknown = render({ totalItems: 0, processedItems: 7 })
    expect(unknown).toContain('7 / 未知')
    expect(unknown).toContain('总量未知，暂无百分比')
    expect(unknown).not.toContain('aria-valuenow=')
    expect(unknown).not.toContain('width:100%')
    expect(render({ totalItems: 1000, processedItems: 999 })).toContain('99.9%')
    expect(render({ totalItems: 10, processedItems: 12 })).toContain('aria-valuenow="100"')
  })

  it('处理 100% 不等于数据质量合格，不以比例改写运行状态', () => {
    const html = render({ processedItems: 100 })
    expect(html).toContain('运行 · 运行中')
    expect(html).toContain('100% 不等于数据质量合格')
    expect(html).toContain('也包含以前已完成项')
    expect(html).not.toContain('worker')
    expect(html).not.toContain('全局批次')
    expect(html).not.toContain('跨断点')
    expect(html).not.toContain('本轮处理完成')
  })

  it('stale 明显警告，不推断任务已完成', () => {
    const html = render({ stale: true })
    expect(html).toContain('role="alert"')
    expect(html).toContain('超过90秒未记录新进度，可能仍在等待来源响应')
    expect(html).toContain('不能据此判断任务已完成')
    expect(html).toContain('运行 · 运行中')
  })

  it('冷却倒计时由绝对时间计算，到期仍停止且不自动恢复', () => {
    const data = { status: 'cooldown' as const, resumeAt: NOW + 61_000 }
    expect(render(data)).toContain('冷却参考剩余 1 分 1 秒')
    expect(render(data, {}, NOW + 60_001)).toContain('冷却参考剩余 1 秒')
    expect(render(data, {}, NOW + 61_000)).toContain('参考冷却时间已到，任务仍已停止')
    expect(render(data)).toContain('到期不会自动重启任务')
  })

  it('等待参考时间到期不声称已经恢复请求，刷新秒数采用真实截止时间', () => {
    expect(render({ status: 'waiting', resumeAt: NOW + 1500 })).toContain('批次等待参考剩余 2 秒')
    expect(render({ status: 'waiting', resumeAt: NOW })).toContain('等待最新批次状态')
    expect(render({}, {}, NOW + 2500)).toContain('1 秒后刷新进度')
    expect(render({}, {}, NOW + 5000)).toContain('0 秒后刷新进度')
  })

  it('读取失败保留快照并告警，超时说明等待原请求', () => {
    expect(render({}, { error: 'failed' })).toContain('上次读取失败，进度暂未更新')
    expect(render({}, { error: 'failed' })).toContain('25 / 100')
    const html = render({}, { error: 'timeout', reading: true, nextReadAt: null })
    expect(html).toContain('不会重复发送请求')
    expect(html).toContain('等待当前读取返回')
  })

  it('首次未读到数据不冒充空闲或完成，不显示虚假百分比', () => {
    const html = render({}, { snapshot: null, fetchedAt: null })
    expect(html).toContain('正在读取进度')
    expect(html).toContain('尚未成功读取')
    expect(html).not.toContain('progressbar')
    expect(html).not.toContain('空闲')
  })

  it('现有窗口 API 缺失新方法时 SSR 不崩溃，首次读取失败明确显示不可读取', () => {
    vi.stubGlobal('window', { api: { diagnostics: {} } })
    expect(() => renderToStaticMarkup(createElement(HistoricalDailyProgressCard))).not.toThrow()
    expect(render({}, { snapshot: null, error: 'failed', fetchedAt: null })).toContain('进度暂不可读取')
  })
})

describe('串行进度读取（不启动任务）', () => {
  it.each(['preparing', 'running', 'waiting'] as const)('%s 每次响应结束后 3 秒读取，非活跃状态改为 10 秒', async status => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const read = vi.fn().mockResolvedValueOnce({ ok: true, data: snapshot({ status }) })
      .mockResolvedValue({ ok: true, data: snapshot({ status: 'success' }) })
    const controller = poll(read)
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
    expect(controller.latest().nextReadAt).toBe(NOW + 3000)
    await vi.advanceTimersByTimeAsync(2999)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(2)
    expect(controller.latest().nextReadAt).toBe(NOW + 13_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it.each(['idle', 'interrupted', 'success', 'partial', 'failed', 'cooldown'] as const)('%s 使用 10 秒非活跃间隔', async status => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const controller = poll(vi.fn().mockResolvedValue({ ok: true, data: snapshot({ status }) }))
    await flush()
    expect(controller.latest().nextReadAt).toBe(NOW + 10_000)
  })

  it('超时及反复刷新不叠加 IPC；迟到结果返回后才恢复轮询', async () => {
    vi.useFakeTimers()
    const request = deferred()
    const read = vi.fn().mockReturnValue(request.promise)
    const controller = poll(read)
    await flush()
    await vi.advanceTimersByTimeAsync(12_000)
    expect(controller.latest()).toMatchObject({ error: 'timeout', reading: true, nextReadAt: null })
    controller.refresh()
    controller.refresh()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(1)
    request.resolve({ ok: true, data: snapshot() })
    await flush()
    expect(controller.latest()).toMatchObject({ error: null, reading: false, snapshot: snapshot() })
    await vi.advanceTimersByTimeAsync(3000)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it.each(['result', 'reject', 'throw'] as const)('失败 %s 保留快照和成功读取时间，不暴露后端消息或凭证', async mode => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const secret = 'token=PRIVATE_SECRET raw backend stack'
    const read = vi.fn().mockResolvedValueOnce({ ok: true, data: snapshot() })
    if (mode === 'result') read.mockResolvedValue({ ok: false, message: secret })
    if (mode === 'reject') read.mockRejectedValue(new Error(secret))
    if (mode === 'throw') read.mockImplementation(() => { throw new Error(secret) })
    const controller = poll(read)
    await flush()
    await vi.advanceTimersByTimeAsync(3000)
    expect(controller.latest()).toMatchObject({ snapshot: snapshot(), fetchedAt: NOW, error: 'failed', reading: false })
    expect(JSON.stringify(controller.updates)).not.toContain(secret)
    expect(render({}, controller.latest())).toContain('进度暂未更新')
  })

  it('隐藏时暂停，返回页面立即读取，并取消旧的刷新计时', async () => {
    vi.useFakeTimers()
    let visible = true
    const read = vi.fn().mockResolvedValue({ ok: true, data: snapshot() })
    const controller = poll(read, () => visible)
    await flush()
    visible = false
    controller.refresh()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(controller.latest().nextReadAt).toBeNull()
    visible = true
    controller.refresh()
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('卸载后迟到响应和超时不再更新状态或安排轮询', async () => {
    vi.useFakeTimers()
    const request = deferred()
    const read = vi.fn().mockReturnValue(request.promise)
    const controller = poll(read)
    await flush()
    controller.stop()
    const updates = controller.updates.length
    await vi.advanceTimersByTimeAsync(30_000)
    request.resolve({ ok: true, data: snapshot() })
    await flush()
    controller.refresh()
    expect(controller.updates).toHaveLength(updates)
    expect(read).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('跨卡片和卸载重挂载仍共享未结束的 IPC 请求', async () => {
    vi.useFakeTimers()
    const request = deferred()
    const nextRequest = deferred()
    const underlyingRead = vi.fn().mockReturnValueOnce(request.promise).mockReturnValue(nextRequest.promise)
    const read = createHistoricalDailyProgressReader(underlyingRead)
    const first = poll(read)
    await flush()
    first.stop()
    const second = poll(read)
    const third = poll(read)
    await flush()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(underlyingRead).toHaveBeenCalledTimes(1)
    request.resolve({ ok: true, data: snapshot() })
    await flush()
    expect(second.latest().snapshot).toEqual(snapshot())
    expect(third.latest().snapshot).toEqual(snapshot())
    await vi.advanceTimersByTimeAsync(3000)
    expect(underlyingRead).toHaveBeenCalledTimes(2)
    expect(second.latest().reading).toBe(true)
    expect(third.latest().reading).toBe(true)
    nextRequest.resolve({ ok: true, data: snapshot({ processedItems: 26 }) })
    await flush()
    expect(second.latest().snapshot?.processedItems).toBe(26)
    expect(third.latest().snapshot?.processedItems).toBe(26)
  })
})
