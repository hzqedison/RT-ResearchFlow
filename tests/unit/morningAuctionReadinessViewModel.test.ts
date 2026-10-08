import { describe, expect, it, vi } from 'vitest'
import { buildMorningAuctionReadinessViewModel as build, type MorningAuctionReadinessDto, type MorningAuctionReadinessPhase } from '../../src/components/ShortTermStrategy/morningAuctionReadinessViewModel'

const observedAt = Date.parse('2026-10-08T09:31:00+08:00')
function fixture(): MorningAuctionReadinessDto {
  return {
    targetTradeDate: '20261008', previousTradeDate: '20260930', calendar: 'open',
    reasonCode: 'OBSERVED_FACTS_ONLY', phase: 'observed_after_cutoff', source: 'ths',
    auction: { state: 'present', validRows: 62, invalidRows: 0, allMarketInputRows: 50,
      observedAt, observationSource: 'stk_auction_cache', eligibleRows: 62, afterCutoffRows: 62, completeCoverage: false },
    previousLimit: { state: 'present', rows: 8, validRows: 8 },
    pools: { allMarket: { state: 'no_match', reasonCode: 'NO_MATCH', candidates: 0 } }, lastAttempt: null,
  }
}
function render(readiness: unknown, selectedTradeDate = '20261008', snapshotTradeDate = '20261008') {
  return build({ readiness, selectedTradeDate, snapshotTradeDate })
}

describe('morning auction renderer readiness boundary', () => {
  it.each<[MorningAuctionReadinessPhase, string]>([
    ['blocked', '竞价输入受阻'], ['waiting', '等待竞价观察记录'], ['preview', '竞价预览记录'],
    ['observed_provisional', '09:28 暂定观察'], ['due_unconfirmed', '09:30 确认时点已到，观察未确认'],
    ['observed_after_cutoff', '已有确认时点后记录'], ['historical', '历史竞价记录'],
  ])('maps backend phase %s without claiming full coverage', (phase, title) => {
    const r = fixture()
    r.phase = phase
    if (phase === 'blocked') { r.calendar = 'unknown'; r.reasonCode = 'CALENDAR_UNAVAILABLE' }
    if (phase === 'waiting' || phase === 'due_unconfirmed') {
      r.auction!.observedAt = null; r.auction!.observationSource = null
      r.auction!.eligibleRows = 0; r.auction!.afterCutoffRows = 0
    }
    if (phase === 'observed_provisional') {
      r.auction!.observedAt = Date.parse('2026-10-08T09:28:10+08:00'); r.auction!.afterCutoffRows = 0
    }
    const v = render(r)
    expect(v.phase).toBe(phase)
    expect(v.title).toBe(title)
    expect(v.completeCoverage).toBe(false)
    expect(v.coverageLabel).toContain('完整性未知')
    expect(v.tone).not.toBe('success')
  })
  it('never promotes provisional records using the frontend clock', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-09T16:00:00+08:00'))
      const r = fixture(); r.phase = 'observed_provisional'
      r.auction!.observedAt = Date.parse('2026-10-08T09:28:00+08:00'); r.auction!.afterCutoffRows = 0
      expect(render(r).phase).toBe('observed_provisional')
    } finally { vi.useRealTimers() }
  })
  it('shows usable auction facts separately from the exact predecessor limit gap', () => {
    const r = fixture(); r.previousLimit = { state: 'missing_or_empty', rows: 0, validRows: 0 }
    r.pools!.firstBoard = { state: 'blocked', reasonCode: 'LIMIT_INPUT_MISSING', candidates: 0 }
    const v = render(r)
    expect(v.phase).toBe('observed_after_cutoff')
    expect(v.auctionLabel).toContain('62 / 0')
    expect(v.previousLimitLabel).toContain('2026-09-30')
    expect(v.previousLimitLabel).toContain('输入缺口')
    expect(v.blockedPoolsLabel).toBe('受阻分池：1 / 2')
    expect(v.queueEmptyMessage).toBe('数据尚未齐备，空列表不代表没有机会')
  })
  it.each(['failed', 'empty', 'partial', 'blocked'] as const)('preserves existing observations after a %s attempt', outcome => {
    const r = fixture()
    r.lastAttempt = { targetTradeDate: '20261008', source: 'tushare', startedAt: observedAt, endedAt: observedAt + 1000, outcome, reasonCode: 'UPSTREAM_FAILED' }
    const v = render(r)
    expect(v.lastAttemptLabel).toContain('已有 62 条缓存记录仍保留，本次未补齐')
    expect(v.auctionLabel).toContain('62 / 0')
    expect(v.observedAtLabel).toContain('2026-10-08 09:31:00（北京时间）')
    expect(v.tone).toBe('warning')
  })
  it('does not reinterpret the concept source as the auction provider', () => {
    const v = render(fixture())
    expect(v.conceptSourceLabel).toBe('题材源：THS')
    expect(v.observedAtLabel).not.toContain('THS')
  })
  it('distinguishes a known no-match from incomplete or unknown pool inputs', () => {
    const r = fixture()
    expect(render(r).queueEmptyMessage).toBe('暂无符合当前筛选的竞价候选')
    r.pools = {}
    expect(render(r).queueEmptyMessage).toContain('空列表不代表没有机会')
    expect(render(r).blockedPoolsLabel).toContain('状态未知')
  })
  it.each([undefined, null, {}, { phase: 'surprise' }])('treats legacy or absent metadata as unknown: %s', readiness => {
    const v = render(readiness)
    expect(v.phase).toBe('unknown')
    expect(v.tone).toBe('warning')
    expect(v.queueEmptyMessage).toContain('空列表不代表没有机会')
  })
  it('rejects both metadata and snapshot date mismatches', () => {
    const r = fixture(); r.targetTradeDate = '20260930'
    expect(render(r).phase).toBe('unknown')
    expect(render(fixture(), '20261008', '20260930').phase).toBe('unknown')
    expect(render(fixture(), '20260230').targetDateLabel).toBe('未知')
  })
  it.each([NaN, Infinity, -1, 0.5, '62', Number.MAX_SAFE_INTEGER + 1])('rejects malformed row counts: %s', value => {
    const r = fixture()
    const broken = { ...r, auction: { ...r.auction, validRows: value } }
    expect(render(broken).phase).toBe('unknown')
  })
  it.each([NaN, Infinity, -1, 0, 'now', 8.64e15])('rejects malformed observed timestamps: %s', observedAtValue => {
    const r = fixture()
    expect(render({ ...r, auction: { ...r.auction, observedAt: observedAtValue } }).phase).toBe('unknown')
  })
  it('does not accept cutoff claims without real observation metadata', () => {
    const r = fixture(); r.auction!.afterCutoffRows = 0
    expect(render(r).phase).toBe('unknown')
    r.auction!.afterCutoffRows = 62; r.auction!.observedAt = null; r.auction!.observationSource = null
    expect(render(r).phase).toBe('unknown')
    r.auction!.observedAt = Date.parse('2026-10-08T09:29:59+08:00'); r.auction!.observationSource = 'stk_auction_cache'
    expect(render(r).phase).toBe('unknown')
  })
  it('rejects inconsistent counters, future predecessor and unknown pool states', () => {
    const r = fixture(); r.auction!.invalidRows = 1
    expect(render(r).phase).toBe('unknown')
    r.auction!.invalidRows = 0; r.auction!.afterCutoffRows = 63
    expect(render(r).phase).toBe('unknown')
    r.auction!.afterCutoffRows = 62; r.previousTradeDate = '20261009'
    expect(render(r).phase).toBe('unknown')
    expect(render({ ...fixture(), pools: { x: { state: 'surprise', candidates: 0 } } }).phase).toBe('unknown')
  })
  it('never echoes arbitrary reason codes, paths or tokens', () => {
    const r = fixture(); const secret = 'K:/private/Token=SECRET'
    r.reasonCode = secret; r.source = secret
    r.lastAttempt = { targetTradeDate: '20261008', startedAt: observedAt, endedAt: observedAt, outcome: 'failed', reasonCode: secret }
    const v = render(r)
    expect(JSON.stringify(v)).not.toContain(secret)
    expect(v.description).toContain('原因未知')
    expect(v.lastAttemptLabel).toContain('原因未知')
    expect(v.conceptSourceLabel).toBe('题材源：未知')
  })
  it('reports missing credentials and permissions without hiding failures', () => {
    for (const [code, label] of [['TOKEN_MISSING', '尚未配置凭证'], ['TUSHARE_QUOTA_INSUFFICIENT', '接口权限或额度不足']]) {
      const r = fixture(); r.lastAttempt = { targetTradeDate: '20261008', startedAt: observedAt, endedAt: observedAt, outcome: 'blocked', reasonCode: code }
      expect(render(r).lastAttemptLabel).toContain(label)
    }
  })
  it('does not accept or emit a complete-market coverage promise', () => {
    const r = fixture()
    const v = render({ ...r, auction: { ...r.auction, completeCoverage: true } })
    expect(v.phase).toBe('unknown'); expect(v.completeCoverage).toBe(false)
  })
  it('treats malformed and wrong-date attempts as unknown, not successful', () => {
    const r = fixture(); r.lastAttempt = { targetTradeDate: '20260930', startedAt: observedAt, endedAt: observedAt, outcome: 'success' }
    expect(render(r).lastAttemptLabel).toContain('状态未知')
    expect(render(r).queueEmptyMessage).toContain('空列表不代表没有机会')
  })
  it.each([
    ['NOT_CONFIGURED', 'blocked', '尚未配置采集凭证', 'warning'],
    ['OBSERVED_ROWS_PERSISTED', 'success', '真实观察记录已落库，覆盖完整性未知', 'neutral'],
    ['PARTIAL_OBSERVATION_RETAINED_FACTS', 'partial', '仅部分观察，旧事实仍保留，输入尚未补齐', 'warning'],
  ] as const)('explains actual backend reason %s without changing readiness or attempt outcome', (code, outcome, label, tone) => {
    const r = fixture()
    r.reasonCode = code
    r.lastAttempt = { targetTradeDate: '20261008', startedAt: observedAt, endedAt: observedAt, outcome, reasonCode: code }
    const v = render(r)
    expect(v.description).toContain(label)
    expect(v.lastAttemptLabel).toContain(label)
    expect(v.description).not.toContain('原因未知')
    expect(v.phase).toBe('observed_after_cutoff')
    expect(v.tone).toBe(tone)
    expect(v.completeCoverage).toBe(false)
    expect(r.lastAttempt.outcome).toBe(outcome)
    if (outcome === 'partial') {
      expect(v.lastAttemptLabel).toContain('最近采集仅部分完成')
      expect(v.lastAttemptLabel).toContain('已有 62 条缓存记录仍保留，本次未补齐')
      expect(v.lastAttemptLabel).not.toContain('最近采集已保存事实')
      expect(v.queueEmptyMessage).toBe('数据尚未齐备，空列表不代表没有机会')
    }
    if (outcome === 'blocked') expect(v.queueEmptyMessage).toContain('空列表不代表没有机会')
  })
  it('never treats mock records as verified facts', () => {
    expect(build({ readiness: fixture(), selectedTradeDate: '20261008', snapshotTradeDate: '20261008', isMock: true }).phase).toBe('unknown')
  })
})
