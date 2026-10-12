import { decodeCapitalRequest, isResearchSnapshotReference, type CapitalRequest, type ResearchSnapshotReference } from './capitalSimulation'
export interface ValidationRequest {
  capital: CapitalRequest; trainDays: number; testDays: number; embargoDays: number; foldCount: number
  holdDays: number[]; minEntries: number; maxTrainingDrawdownPct: number; confirmation: true
}
export interface ValidationScore {
  reportId: string; digest: string; factsFingerprint: string; usable: boolean; returnPct: number | null
  drawdownPct: number | null; entries: number; issues: string[]; openPositions: number
}
export interface ValidationFold {
  trainStart: string; trainEnd: string; testStart: string; testEnd: string
  candidates: Array<{ holdDays: number; id: string; result: ValidationScore | null }>
  testId: string; selected: number | null; selectedAt: number | null; test: ValidationScore | null
}
export interface ValidationStudy {
  schema: 1 | 2; id: string; createdAt: number; request: ValidationRequest; calendarFingerprint: string
  marketSnapshot?: ResearchSnapshotReference
  status: 'running' | 'completed' | 'blocked'; blockedReason: string | null; folds: ValidationFold[]
  unusedMarketDays: number; reportsCompleted: number; reportsPlanned: number
}
export type ValidationCode = 'INVALID_INPUT' | 'UNAUTHORIZED' | 'CALENDAR_INCOMPLETE' | 'CALENDAR_CHANGED' | 'INSUFFICIENT_DAYS' | 'CAPACITY_LIMIT' | 'REQUEST_CONFLICT' | 'NOT_FOUND' | 'REPORT_CONFLICT' | 'INPUT_NOT_READY' | 'STORAGE_UNAVAILABLE' | 'SNAPSHOT_REQUIRED' | 'SNAPSHOT_UNAVAILABLE'
export type ValidationResult<T> = { ok: true; data: T } | { ok: false; code: ValidationCode; message: string }
export function hasFrozenValidationData(study: ValidationStudy | null): boolean {
  if (!study || study.schema !== 2 || !isResearchSnapshotReference(study.marketSnapshot)) return false
  const ref = study.marketSnapshot, capital = study.request?.capital
  return !!capital && capital.id === study.id && ref.id === study.id && ref.createdAt === study.createdAt
    && ref.dateStart === capital.dateStart && ref.dateEnd === capital.dateEnd
}
export const VALIDATION_MESSAGES: Record<ValidationCode, string> = {
  INVALID_INPUT: '请核对窗口、持有期、研究预算及确认项。隔离间隔不能短于最大候选持有期。',
  UNAUTHORIZED: '只允许当前工作台执行本地验证。', CALENDAR_INCOMPLETE: '区间内交易日历不完整，请先补齐。',
  CALENDAR_CHANGED: '保存协议后交易日历发生变化，已停止；请使用新协议，不覆盖旧研究。',
  INSUFFICIENT_DAYS: '开市日不足以覆盖全部训练、隔离和测试窗口，请扩大区间或减少窗口。',
  CAPACITY_LIMIT: '研究记录、冻结数据或报告容量已达限制，请先检查已保存记录。', REQUEST_CONFLICT: '此研究编号已有不同参数，请另建研究。',
  NOT_FOUND: '未找到保存的验证协议。', REPORT_CONFLICT: '底层报告与固定协议不一致，或样本外报告早于训练选择，已停止。',
  INPUT_NOT_READY: '底层资金回测尚不能执行，请检查行情、信号和日期；已完成的步骤会保留。', STORAGE_UNAVAILABLE: '暂时无法安全读写研究，请保留编号后恢复。',
  SNAPSHOT_REQUIRED: '旧协议没有共同数据快照，只能读取原结果；请核对参数后保存新协议，不覆盖旧研究。',
  SNAPSHOT_UNAVAILABLE: '冻结研究数据缺失或校验不通过，已停止推进；原报告保留，不自动改用当前缓存。',
}
const integer = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= lo && v <= hi
export function decodeValidationRequest(v: unknown): ValidationRequest | null {
  try {
    if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return null
    const d = Object.getOwnPropertyDescriptors(v), keys = ['capital', 'trainDays', 'testDays', 'embargoDays', 'foldCount', 'holdDays', 'minEntries', 'maxTrainingDrawdownPct', 'confirmation']
    if (Reflect.ownKeys(d).length !== keys.length || keys.some(k => !Object.hasOwn(d, k) || !Object.hasOwn(d[k], 'value'))) return null
    const r = v as Record<string, unknown>, capital = decodeCapitalRequest(r.capital)
    if (!capital || capital.funding.kind !== 'manual' || r.confirmation !== true || !integer(r.trainDays, 2, 500) || !integer(r.testDays, 1, 120)
      || !integer(r.embargoDays, 1, 120) || !integer(r.foldCount, 1, 12) || !integer(r.minEntries, 1, 1000) || !integer(r.maxTrainingDrawdownPct, 0, 100)
      || !Array.isArray(r.holdDays) || r.holdDays.length < 1 || r.holdDays.length > 8 || r.holdDays.some(n => !integer(n, 1, 120))
      || new Set(r.holdDays).size !== r.holdDays.length || r.embargoDays < Math.max(...r.holdDays)) return null
    return { capital, trainDays: r.trainDays, testDays: r.testDays, embargoDays: r.embargoDays, foldCount: r.foldCount,
      holdDays: [...r.holdDays], minEntries: r.minEntries, maxTrainingDrawdownPct: r.maxTrainingDrawdownPct, confirmation: true }
  } catch { return null }
}
