import type { KplConceptMembersRow } from '../database/types'
import type { DcConceptConsItem, ThsIndexItem, ThsMemberItem } from './tushareService'
import type { FactSyncReceipt } from '../../shared/dataReadiness'
import { factReceipt, safeFactError } from './diagnosticFactSyncService'
import { resolveCompletedTradeDate, type KnownCalendar } from './dataReadinessService'

export interface ConceptSyncDependencies {
  token: () => string | null
  calendar: KnownCalendar
  kpl: (token: string, date: string) => Promise<KplConceptMembersRow[]>
  dc: (token: string, date: string) => Promise<DcConceptConsItem[]>
  thsIndex: (token: string) => Promise<ThsIndexItem[]>
  thsMembers: (token: string, code: string) => Promise<ThsMemberItem[]>
  writeKpl: (rows: KplConceptMembersRow[]) => void
  writeDc: (rows: DcConceptConsItem[]) => void
  writeThs: (index: ThsIndexItem[], members: ThsMemberItem[]) => void
  progress?: (current: number, total: number, message: string) => void
  pause?: () => Promise<void>
}

/** Typed outcome replaces the old retry/void/null success ambiguity. No global scheduler changes. */
export async function syncConceptFacts(source: string, deps: ConceptSyncDependencies, now = Date.now()): Promise<FactSyncReceipt> {
  let targetDate: string | null = null
  try {
    if (!['kpl', 'ths', 'dc'].includes(source)) throw new Error('INVALID_SOURCE')
    if (source !== 'ths') targetDate = resolveCompletedTradeDate(deps.calendar, now)
    const token = deps.token()
    if (!token) throw new Error('TUSHARE_DISABLED')
    if (source === 'kpl') {
      const rows = await deps.kpl(token, targetDate!)
      if (!rows.length) throw new Error('UPSTREAM_EMPTY')
      if (rows.some(row => !/^\d{6}\.(SH|SZ|BJ)$/.test(row.conCode) || !row.tsCode)) throw new Error('FACT_INVALID')
      try { deps.writeKpl(rows) } catch { throw new Error('WRITE_FAILED') }
      return factReceipt(source, targetDate, 'FACTS_SAVED', rows.length)
    }
    if (source === 'dc') {
      const rows = await deps.dc(token, targetDate!)
      if (!rows.length) throw new Error('UPSTREAM_EMPTY')
      if (rows.some(row => row.tradeDate !== targetDate || !/^\d{6}\.(SH|SZ|BJ)$/.test(row.tsCode) || !row.themeCode)) throw new Error('FACT_INVALID')
      try { deps.writeDc(rows) } catch { throw new Error('WRITE_FAILED') }
      return factReceipt(source, targetDate, 'FACTS_SAVED', rows.length)
    }
    const index = await deps.thsIndex(token)
    if (!index.length) throw new Error('UPSTREAM_EMPTY')
    if (index.some(row => !row.tsCode)) throw new Error('FACT_INVALID')
    const allMembers: ThsMemberItem[] = []
    for (let i = 0; i < index.length; i += 10) {
      const batch = index.slice(i, i + 10)
      const results = await Promise.allSettled(batch.map(async entry => {
        const rows = await deps.thsMembers(token, entry.tsCode)
        if (!rows.length || (entry.count !== null && entry.count > 0 && new Set(rows.map(row => row.tsCode)).size !== entry.count)) throw new Error('CONCEPT_PARTIAL')
        if (rows.some(row => row.conCode !== entry.tsCode || !/^\d{6}\.(SH|SZ|BJ)$/.test(row.tsCode))) throw new Error('FACT_INVALID')
        return rows.map(row => ({ ...row, conName: entry.name }))
      }))
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') {
        const code = safeFactError(failure.reason)
        const receipt = factReceipt(source, null, code === 'UPSTREAM_FAILED' ? 'CONCEPT_PARTIAL' : code)
        return { ...receipt, outcome: 'partial' }
      }
      for (const result of results) if (result.status === 'fulfilled') allMembers.push(...result.value)
      deps.progress?.(Math.min(i + 10, index.length), index.length, `已收集 ${allMembers.length} 条，尚未提交`)
      if (i + 10 < index.length) await deps.pause?.()
    }
    try { deps.writeThs(index, allMembers) } catch { throw new Error('WRITE_FAILED') }
    deps.progress?.(index.length, index.length, `已保存 ${allMembers.length} 条题材成员事实`)
    return factReceipt(source, null, 'FACTS_SAVED', allMembers.length)
  } catch (error) { return factReceipt(source, targetDate, safeFactError(error)) }
}
