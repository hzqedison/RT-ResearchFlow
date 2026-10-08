import type Database from 'better-sqlite3'
import type { ResearchReportReference, ResearchReportResult, ReportDataProvider, WencaiResult } from '../../shared/dataSourceTypes'
import { getMultiSourcePreference, getWencaiCookieEncrypted } from '../database/dataSourceRepository'
import { decryptApiKey } from '../utils/apiKeyEncryption'
import { callPythonDataSource, dataBridgeMessage } from './pythonDataSourceBridge'
import { normalizeMarketStockCode } from './multiSourceMarketService'

function safePdfUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value))
    return url.protocol === 'https:' && url.hostname === 'pdf.dfcfw.com' && !url.username && !url.password ? url.toString() : null
  } catch { return null }
}

export function normalizeReportReferences(provider: ReportDataProvider, code: string, input: unknown): ResearchReportReference[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((value) => {
    if (typeof value !== 'object' || value === null) return []
    const row = value as Record<string, unknown>
    const rowCode = String(row.stockCode ?? row['股票代码'] ?? code).padStart(6, '0')
    if (rowCode !== code) return []
    const title = String(row.title ?? row['报告名称'] ?? '').trim().slice(0, 300)
    const info = String(row.infoCode ?? '')
    const pdfUrl = safePdfUrl(row['报告PDF链接'] ?? (/^AP\d{10,40}$/.test(info) ? 'https://pdf.dfcfw.com/pdf/H3_' + info + '_1.pdf' : null))
    const publishedAt = String(row.publishDate ?? row['日期'] ?? '').slice(0, 10)
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) return []
    return [{
      id: pdfUrl ?? code + ':' + publishedAt + ':' + title, stockCode: code, title,
      institution: String(row.orgSName ?? row.orgName ?? row['机构'] ?? '').slice(0, 100),
      publishedAt, pdfUrl, providers: [provider],
    }]
  }).slice(0, 50)
}

function ensureReportCache(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS multi_source_report_cache (stock_code TEXT NOT NULL, provider TEXT NOT NULL, payload TEXT NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY(stock_code, provider))')
}

async function fetchEastmoneyReportReferences(code: string): Promise<ResearchReportReference[]> {
  const url = new URL('https://reportapi.eastmoney.com/report/list')
  const parameters: Record<string, string> = {
    industryCode: '*', industry: '*', rating: '*', ratingChange: '*', pageSize: '50',
    pageNo: '1', p: '1', pageNum: '1', pageNumber: '1', qType: '0', code,
    beginTime: String(new Date().getFullYear() - 2) + '-01-01',
    endTime: String(new Date().getFullYear() + 1) + '-01-01', fields: '', orgCode: '', rcode: '',
  }
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
  const response = await fetch(url, { headers: { Referer: 'https://data.eastmoney.com/' }, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('REPORT_SOURCE_UNAVAILABLE')
  const payload = await response.json() as { data?: unknown }
  if (!Array.isArray(payload.data)) throw new Error('REPORT_SOURCE_UNAVAILABLE')
  return normalizeReportReferences('eastmoney', code, payload.data)
}

export async function getSelectedResearchReports(db: Database.Database, input: string, only?: ReportDataProvider): Promise<ResearchReportResult> {
  const { stockCode } = normalizeMarketStockCode(input)
  const preference = getMultiSourcePreference(db)
  const providers = only ? [only] : preference.reportProviders
  ensureReportCache(db)
  const result: ResearchReportResult = { reports: [], statuses: [], fetchedAt: Date.now(), metadataOnly: true }
  const reportMap = new Map<string, ResearchReportReference>()
  for (const provider of providers) {
    const cached = db.prepare('SELECT payload, fetched_at FROM multi_source_report_cache WHERE stock_code = ? AND provider = ?').get(stockCode, provider) as { payload: string; fetched_at: number } | undefined
    try {
      let reports: ResearchReportReference[]
      let state: 'ready' | 'empty' | 'cached' = 'ready'
      if (cached && Date.now() - cached.fetched_at < 15 * 60 * 1000) {
        reports = JSON.parse(cached.payload) as ResearchReportReference[]
        state = 'cached'
      } else {
        reports = provider === 'eastmoney' ? await fetchEastmoneyReportReferences(stockCode)
          : normalizeReportReferences('akshare', stockCode, await callPythonDataSource(preference, { operation: 'akshare-reports', stockCode }))
        db.prepare('INSERT INTO multi_source_report_cache(stock_code, provider, payload, fetched_at) VALUES(?,?,?,?) ON CONFLICT(stock_code,provider) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at')
          .run(stockCode, provider, JSON.stringify(reports), Date.now())
        if (!reports.length) state = 'empty'
      }
      result.statuses.push({ provider, state, message: state === 'empty' ? '未找到研报，不代表连接已验证' : `取得 ${reports.length} 条研报索引（非全文）` })
      for (const report of reports) {
        const existing = reportMap.get(report.id)
        reportMap.set(report.id, existing ? { ...existing, providers: [...new Set([...existing.providers, ...report.providers])] } : report)
      }
    } catch (error) {
      result.statuses.push({ provider, state: 'failed', message: provider === 'akshare' ? dataBridgeMessage(error) : '东财研报接口未完成取数，请稍后再试。' })
    }
  }
  result.reports = [...reportMap.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 50)
  return result
}

const wencaiLastAttempt = new WeakMap<Database.Database, number>()
export async function queryWencai(db: Database.Database, input: string): Promise<WencaiResult> {
  const preference = getMultiSourcePreference(db)
  if (!preference.wencaiEnabled) throw new Error('请先选择并保存 i问财来源')
  const query = String(input).trim()
  if (!query || query.length > 300) throw new Error('请输入不超过300字的选股条件')
  const encrypted = getWencaiCookieEncrypted(db)
  const cookie = encrypted?.length ? decryptApiKey(encrypted) : null
  if (!cookie) throw new Error('i问财需要你自己的登录 Cookie，请仅在本机设置，不要发送给他人')
  if (Date.now() - (wencaiLastAttempt.get(db) ?? 0) < 10_000) throw new Error('问财采用低频查询，请等待10秒后再试')
  wencaiLastAttempt.set(db, Date.now())
  let payload: unknown
  try {
    payload = await callPythonDataSource(preference, { operation: 'iwencai', query, cookie })
  } catch (error) { throw new Error(dataBridgeMessage(error)) }
  if (!Array.isArray(payload) || payload.length === 0) throw new Error('问财未返回表格结果，可能无匹配、登录失效或接口限制；本次不绕过验证')
  const rows: Record<string, string | number | null>[] = []
  for (const value of payload.slice(0, 50)) {
    if (typeof value !== 'object' || value === null) continue
    const row: Record<string, string | number | null> = {}
    for (const [key, cell] of Object.entries(value).slice(0, 12)) {
      row[key.slice(0, 100)] = typeof cell === 'number' && Number.isFinite(cell) ? cell : cell == null ? null : String(cell).slice(0, 300)
    }
    rows.push(row)
  }
  return { columns: [...new Set(rows.flatMap(row => Object.keys(row)))].slice(0, 12), rows, fetchedAt: Date.now(), truncated: payload.length >= 50 }
}
