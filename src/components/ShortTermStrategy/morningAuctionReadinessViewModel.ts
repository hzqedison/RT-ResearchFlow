// Renderer-only boundary DTO. Do not import the Electron policy at runtime.
export type MorningAuctionReadinessPhase = 'blocked' | 'waiting' | 'preview'
  | 'observed_provisional' | 'due_unconfirmed' | 'observed_after_cutoff' | 'historical'

export interface MorningAuctionReadinessDto {
  targetTradeDate?: string
  previousTradeDate?: string | null
  calendar?: 'open' | 'closed' | 'unknown' | 'future'
  reasonCode?: string
  phase?: MorningAuctionReadinessPhase
  source?: string
  auction?: {
    state?: 'missing_or_empty' | 'invalid' | 'partial' | 'present'
    validRows?: number
    invalidRows?: number
    allMarketInputRows?: number
    observedAt?: number | null
    observationSource?: 'stk_auction_cache' | null
    eligibleRows?: number
    afterCutoffRows?: number
    completeCoverage?: false
  }
  previousLimit?: { state?: 'unknown' | 'missing_or_empty' | 'partial' | 'present'; rows?: number; validRows?: number }
  pools?: Record<string, { state?: 'blocked' | 'partial' | 'ready' | 'no_match'; reasonCode?: string; candidates?: number }>
  lastAttempt?: {
    targetTradeDate?: string
    startedAt?: number
    endedAt?: number
    source?: string
    outcome?: 'success' | 'partial' | 'empty' | 'failed' | 'blocked'
    reasonCode?: string
  } | null
}

export interface MorningAuctionReadinessView {
  phase: MorningAuctionReadinessPhase | 'unknown'
  tone: 'neutral' | 'warning' | 'blocked'
  title: string
  description: string
  targetDateLabel: string
  auctionLabel: string
  previousLimitLabel: string
  blockedPoolsLabel: string
  observedAtLabel: string
  conceptSourceLabel: string
  lastAttemptLabel: string | null
  coverageLabel: string
  completeCoverage: false
  queueEmptyMessage: string
}

const INCOMPLETE_EMPTY = '数据尚未齐备，空列表不代表没有机会'
const COVERAGE = '仅展示已存事实，全市场覆盖完整性未知'
const phases: Record<MorningAuctionReadinessPhase, { title: string; description: string }> = {
  blocked: { title: '竞价输入受阻', description: '请先检查目标交易日与输入条件；未据此确认候选可用。' },
  waiting: { title: '等待竞价观察记录', description: '尚无当前阶段可用的观察记录，空列表不代表没有机会。' },
  preview: { title: '竞价预览记录', description: '仅供预览，不是 09:28 暂定或 09:30 确认记录。' },
  observed_provisional: { title: '09:28 暂定观察', description: '后端已有暂定阶段观察；不因前端时间到 09:30 自动升级。' },
  due_unconfirmed: { title: '09:30 确认时点已到，观察未确认', description: '后端尚无确认时点后的有效观察记录，旧记录不替代确认。' },
  observed_after_cutoff: { title: '已有确认时点后记录', description: '后端已有 09:30 确认时点后的观察记录，不代表全市场完整。' },
  historical: { title: '历史竞价记录', description: '展示所选历史交易日的已存事实，不代表当时全市场完整或当前实时状态。' },
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false
  const parsed = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10).replace(/-/g, '') === value
}
function dateLabel(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}
function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8.64e15 - 28_800_000
}
function beijingTime(value: number): string {
  return `${new Date(value + 28_800_000).toISOString().slice(0, 19).replace('T', ' ')}（北京时间）`
}
function reason(value: unknown): string {
  const labels: Record<string, string> = {
    CALENDAR_UNAVAILABLE: '交易日历未知', NON_TRADING_DAY: '目标日不是已知交易日', FUTURE_TRADE_DATE: '目标日尚未到来',
    KNOWN_TRADE_DATE: '已知交易日', OBSERVED_FACTS_ONLY: '仅有已观察事实', AUCTION_MISSING_OR_INVALID: '竞价事实缺失或异常',
    FACT_INVALID: '返回事实校验失败', PAGINATION_INCOMPLETE: '分页未完成', QUERY_CANCELLED: '请求已取消',
    TUSHARE_REQUEST_TIMEOUT: '请求超时', TUSHARE_AUTH_FAILED: '凭证校验失败', TUSHARE_QUOTA_INSUFFICIENT: '接口权限或额度不足',
    TUSHARE_RATE_LIMITED: '请求受限', UPSTREAM_FAILED: '上游采集失败', PERSIST_FAILED: '事实保存失败',
    UPSTREAM_EMPTY: '上游未返回数据', TOKEN_MISSING: '尚未配置凭证',
    NOT_CONFIGURED: '尚未配置采集凭证',
    OBSERVED_ROWS_PERSISTED: '真实观察记录已落库，覆盖完整性未知',
    PARTIAL_OBSERVATION_RETAINED_FACTS: '仅部分观察，旧事实仍保留，输入尚未补齐',
  }
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(labels, value)
    ? labels[value] : '原因未知，请在配置中心-诊断核查'
}

export function buildMorningAuctionReadinessViewModel(input: {
  readiness?: unknown
  selectedTradeDate: string
  snapshotTradeDate?: string
  isMock?: boolean
}): MorningAuctionReadinessView {
  const view: MorningAuctionReadinessView = {
    phase: 'unknown', tone: 'warning', title: '竞价就绪度未知',
    description: '缺少可核验的就绪度信息，不能据此判断输入正常。',
    targetDateLabel: date(input.selectedTradeDate) ? dateLabel(input.selectedTradeDate) : '未知',
    auctionLabel: '有效 / 异常竞价行：未知', previousLimitLabel: '前一交易日涨跌停输入：未知',
    blockedPoolsLabel: '受阻分池：未知', observedAtLabel: '实际观察时间：未知（北京时间）',
    conceptSourceLabel: '题材源：未知', lastAttemptLabel: null, coverageLabel: COVERAGE,
    completeCoverage: false, queueEmptyMessage: INCOMPLETE_EMPTY,
  }
  const r = object(input.readiness)
  if (input.isMock) return { ...view, description: '当前为演示数据，不能据此确认真实竞价输入就绪。' }
  if (!r || !date(input.selectedTradeDate)) return view
  if (r.targetTradeDate !== input.selectedTradeDate || input.snapshotTradeDate !== input.selectedTradeDate) {
    return { ...view, description: '就绪度或快照目标日与所选日期不匹配，当前状态未知。' }
  }
  const a = object(r.auction)
  const l = object(r.previousLimit)
  const pools = object(r.pools)
  const phase = r.phase
  if (typeof phase !== 'string' || !Object.prototype.hasOwnProperty.call(phases, phase)
    || !['open', 'closed', 'unknown', 'future'].includes(String(r.calendar)) || !a || !l || !pools
    || !['missing_or_empty', 'invalid', 'partial', 'present'].includes(String(a.state))
    || !['unknown', 'missing_or_empty', 'partial', 'present'].includes(String(l.state))
    || ![a.validRows, a.invalidRows, a.allMarketInputRows, a.eligibleRows, a.afterCutoffRows, l.rows, l.validRows].every(count)
    || a.completeCoverage !== false) return view
  const validRows = a.validRows as number
  const invalidRows = a.invalidRows as number
  const limitRows = l.rows as number
  const validLimits = l.validRows as number
  const afterCutoffRows = a.afterCutoffRows as number
  const eligibleRows = a.eligibleRows as number
  if ((a.allMarketInputRows as number) > validRows || eligibleRows > validRows || afterCutoffRows > validRows
    || validLimits > limitRows || (a.observedAt !== null && !timestamp(a.observedAt))
    || (a.observedAt === null ? a.observationSource !== null : a.observationSource !== 'stk_auction_cache')
    || (r.previousTradeDate !== null && (!date(r.previousTradeDate) || r.previousTradeDate >= input.selectedTradeDate))
    || (phase !== 'blocked' && r.calendar !== 'open')
    || (a.state === 'present' && (!validRows || invalidRows > 0))
    || (a.state === 'missing_or_empty' && (validRows > 0 || invalidRows > 0))
    || (a.state === 'invalid' && (validRows > 0 || invalidRows === 0))) return view
  const targetMidnight = new Date(`${dateLabel(input.selectedTradeDate)}T00:00:00+08:00`).getTime()
  if ((timestamp(a.observedAt) && a.observedAt < targetMidnight)
    || (a.observedAt === null && (eligibleRows > 0 || afterCutoffRows > 0))
    || (phase === 'observed_provisional' && (!eligibleRows || !timestamp(a.observedAt) || a.observedAt < targetMidnight + 34_080_000))
    || (phase === 'observed_after_cutoff' && (!afterCutoffRows || !timestamp(a.observedAt) || a.observedAt < targetMidnight + 34_200_000))) return view
  const poolValues = Object.values(pools).map(object)
  if (poolValues.some(pool => !pool || !['blocked', 'partial', 'ready', 'no_match'].includes(String(pool.state)) || !count(pool.candidates))) return view
  const blocked = poolValues.filter(pool => pool!.state === 'blocked').length
  const poolIncomplete = poolValues.length === 0 || poolValues.some(pool => pool!.state === 'blocked' || pool!.state === 'partial')
  const limitsPresent = date(r.previousTradeDate) && l.state === 'present' && validLimits > 0 && validLimits === limitRows
  const inputsMissing = !validRows || a.state !== 'present' || !limitsPresent || poolIncomplete
    || !['observed_provisional', 'observed_after_cutoff', 'historical'].includes(phase)
  const selectedPhase = phase as MorningAuctionReadinessPhase
  view.phase = selectedPhase
  view.tone = selectedPhase === 'blocked' ? 'blocked' : inputsMissing || selectedPhase === 'due_unconfirmed' ? 'warning' : 'neutral'
  view.title = phases[selectedPhase].title
  view.description = `${phases[selectedPhase].description} ${reason(r.reasonCode)}。`
  view.auctionLabel = `有效 / 异常竞价行：${validRows} / ${invalidRows}；全市场分池输入 ${a.allMarketInputRows} 行`
  const previousDate = date(r.previousTradeDate) ? dateLabel(r.previousTradeDate) : '日期未知'
  view.previousLimitLabel = `前一交易日 ${previousDate} 涨跌停：有效 ${validLimits} / 已存 ${limitRows} 行；${limitsPresent ? '已有记录（覆盖未知）' : l.state === 'partial' ? '部分记录，仍有输入缺口' : '输入缺口，需补齐或核查日历'}`
  view.blockedPoolsLabel = `受阻分池：${blocked} / ${poolValues.length}${poolValues.length === 0 ? '（分池状态未知）' : ''}`
  view.observedAtLabel = timestamp(a.observedAt) ? `实际观察时间：${beijingTime(a.observedAt)}` : view.observedAtLabel
  const conceptLabels: Record<string, string> = { kpl: 'KPL', ths: 'THS', dc: 'DC' }
  if (typeof r.source === 'string' && Object.prototype.hasOwnProperty.call(conceptLabels, r.source)) view.conceptSourceLabel = `题材源：${conceptLabels[r.source]}`
  view.queueEmptyMessage = inputsMissing ? INCOMPLETE_EMPTY : '暂无符合当前筛选的竞价候选'
  if (r.lastAttempt !== null) {
    const attempt = object(r.lastAttempt)
    const outcomes: Record<string, string> = { success: '已保存事实', partial: '仅部分完成', empty: '未返回数据', failed: '失败', blocked: '受阻' }
    if (!attempt || attempt.targetTradeDate !== input.selectedTradeDate || !timestamp(attempt.startedAt)
      || !timestamp(attempt.endedAt) || attempt.endedAt < attempt.startedAt
      || typeof attempt.outcome !== 'string' || !Object.prototype.hasOwnProperty.call(outcomes, attempt.outcome)) {
      view.lastAttemptLabel = '最近采集状态未知，不能确认本次补齐成功。'
      view.queueEmptyMessage = INCOMPLETE_EMPTY
    } else {
      const retained = attempt.outcome !== 'success' && validRows > 0 ? `；已有 ${validRows} 条缓存记录仍保留，本次未补齐` : ''
      view.lastAttemptLabel = `最近采集${outcomes[attempt.outcome]}：${reason(attempt.reasonCode)}${retained}；结束于 ${beijingTime(attempt.endedAt)}`
      if (attempt.outcome !== 'success') {
        view.tone = selectedPhase === 'blocked' ? 'blocked' : 'warning'
        view.queueEmptyMessage = INCOMPLETE_EMPTY
      }
    }
  }
  return view
}
