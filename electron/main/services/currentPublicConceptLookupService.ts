import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { parseCurrentPublicConceptQuery, type CurrentPublicConceptLookup, type CurrentPublicConceptLookupReply, type CurrentPublicConceptMembership } from '../../shared/publicConceptSnapshots'

const MAX_ROWS = 50
const DAY = 24 * 60 * 60_000

interface CachedBoard {
  concept_code: string
  concept_name: string
  observed_at: number
  member_count: number
  payload: string
}

function text(value: unknown, maximum = 100): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= maximum
}

function membership(board: CachedBoard, query: string, now: number): CurrentPublicConceptMembership | null {
  try {
    const value = JSON.parse(board.payload)
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.state !== 'available' || value.dateBasis !== 'current-observation' || value.historicalCoverage !== false ||
        !['eastmoney_public', 'sina_public'].includes(value.source) ||
        !Number.isSafeInteger(value.observedAt) || value.observedAt <= 0 || value.observedAt > now || value.observedAt !== board.observed_at ||
        !text(board.concept_code) || !text(board.concept_name) ||
        (value.source === 'eastmoney_public' ? !/^BK\d{4,6}$/.test(board.concept_code) : !/^SINA:gn_[A-Za-z0-9_]{1,60}$/.test(board.concept_code)) ||
        !Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > 6000 || value.rows.length !== board.member_count) return null
    const matches = value.rows.filter((row: unknown) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return false
      const item = row as Record<string, unknown>
      return typeof item.tsCode === 'string' && (query.includes('.') ? item.tsCode === query : item.tsCode.slice(0, 6) === query)
    })
    if (matches.length !== 1 || !/^\d{6}\.(SH|SZ|BJ)$/.test(matches[0].tsCode) || !text(matches[0].name)) return null
    // Construct a whitelist projection; never forward stored payloads to IPC.
    return {
      conceptCode: board.concept_code, conceptName: board.concept_name.trim(),
      tsCode: matches[0].tsCode, stockName: matches[0].name.trim(), source: value.source,
      observedAt: value.observedAt, age: now - value.observedAt > DAY ? 'older-than-24h' : 'within-24h',
    }
  } catch { return null }
}

export function lookupCurrentPublicConcepts(db: Database.Database, query: string, now = Date.now()): CurrentPublicConceptLookup {
  if (parseCurrentPublicConceptQuery({ tsCode: query }) !== query || !Number.isSafeInteger(now) || now <= 0) throw new Error('INVALID_STOCK_QUERY')
  const result: CurrentPublicConceptLookup = {
    query, state: 'cache-missing', checkedAt: now, dateBasis: 'current-observation', historicalCoverage: false,
    rows: [], truncated: false, discardedBoards: 0,
  }
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='public_concept_snapshots'").get()) return result
  // JSON guards also cover old/corrupt cache rows. Stock codes remain bound parameters.
  const match = query.includes('.') ? "json_extract(CASE WHEN j.type='object' THEN j.value ELSE '{}' END,'$.tsCode') = ?"
    : "substr(json_extract(CASE WHEN j.type='object' THEN j.value ELSE '{}' END,'$.tsCode'),1,6) = ?"
  const boards = db.prepare(`SELECT concept_code, concept_name, observed_at, member_count, payload
    FROM public_concept_snapshots c
    WHERE length(c.payload) <= 1048576 AND EXISTS (
      SELECT 1 FROM json_each(CASE WHEN json_valid(c.payload) THEN c.payload ELSE '{}' END,'$.rows') j WHERE ${match}
    ) ORDER BY observed_at DESC, concept_code ASC LIMIT ?`).all(query, MAX_ROWS + 1) as CachedBoard[]
  for (const board of boards) {
    const row = membership(board, query, now)
    if (!row) result.discardedBoards++
    else if (result.rows.length < MAX_ROWS) result.rows.push(row)
  }
  result.truncated = boards.length > MAX_ROWS
  result.state = result.rows.length ? 'available' : 'not-cached'
  return result
}

export function queryCurrentPublicConcepts(input: unknown, dependencies: { getDb: () => Database.Database; now?: () => number }): CurrentPublicConceptLookupReply {
  const query = parseCurrentPublicConceptQuery(input)
  if (!query) return {
    ok: false, code: 'INVALID_STOCK_QUERY', message: '请输入六位股票代码，或带交易所后缀的股票代码。',
    action: '例如 600000 或 600000.SH；此入口仅查询采集时的题材，不接受历史交易日。', retryable: false, correlationId: randomUUID(),
  }
  try { return { ok: true, data: lookupCurrentPublicConcepts(dependencies.getDb(), query, dependencies.now?.() ?? Date.now()) } }
  catch { return {
    ok: false, code: 'PUBLIC_CONCEPT_CACHE_UNAVAILABLE', message: '暂时无法读取本地免费题材缓存。',
    action: '重新查询；如仍失败，请在配置中心诊断中生成脱敏反馈。已有数据不会被清除。', retryable: true, correlationId: randomUUID(),
  } }
}
