// Read-only public Sina sector endpoints. Never evaluate the JavaScript wrapper.
// These memberships describe the observation time, not a historical trade date.
import {
  fetchPublicConceptIndex, fetchPublicConceptMembers,
  type PublicConceptDefinition, type PublicConceptMember,
  type PublicConceptSnapshot, type PublicConceptFetchOptions,
} from './publicConceptSnapshotAdapter'

const HOST = 'https://vip.stock.finance.sina.com.cn'
const PAGE_SIZE = 100
const MAX_MEMBERS = 6000
const MAX_BYTES = 1024 * 1024
const CODE = /^SINA:(gn_[A-Za-z0-9_]{1,60})$/

export class PublicConceptCountMismatchError extends Error {
  readonly code = 'SOURCE_COUNT_MISMATCH'
  constructor(
    readonly reportedTotal: number,
    readonly expectedPageRows: number,
    readonly receivedPageRows: number,
    readonly page: number,
  ) {
    super('FACT_INVALID')
    this.name = 'PublicConceptCountMismatchError'
  }
}

function snapshot<T>(rows: T[]): PublicConceptSnapshot<T> {
  return { source: 'sina_public', dateBasis: 'current-observation',
    observedAt: Date.now(), historicalCoverage: false,
    state: rows.length ? 'available' : 'empty', rows }
}

async function body(url: URL, options: PublicConceptFetchOptions, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const response = await (options.fetcher ?? fetch)(url, {
    redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    headers: { Referer: 'https://finance.sina.com.cn/' },
  })
  if (!response.ok || !response.body) throw new Error('UPSTREAM_FAILED')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_BYTES) throw new Error('FACT_INVALID')
      chunks.push(part.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const charset = response.headers.get('content-type')?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase()
  if (charset && !['utf-8', 'utf8', 'gbk', 'gb2312', 'gb18030'].includes(charset)) throw new Error('FACT_INVALID')
  try { return new TextDecoder(charset?.startsWith('gb') ? 'gb18030' : 'utf-8', { fatal: true }).decode(bytes).trim() }
  catch { throw new Error('FACT_INVALID') }
}

function deadline(options: PublicConceptFetchOptions): AbortSignal {
  return options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)
}

function parse(text: string): unknown {
  try { return JSON.parse(text) } catch { throw new Error('FACT_INVALID') }
}

export async function fetchSinaConceptIndex(options: PublicConceptFetchOptions = {}): Promise<PublicConceptSnapshot<PublicConceptDefinition>> {
  const raw = await body(new URL('/q/view/newFLJK.php?param=class', HOST), options, deadline(options))
  const match = raw.match(/^var\s+S_Finance_bankuai_class\s*=\s*(\{[\s\S]*\})\s*;?$/)
  if (!match) throw new Error('FACT_INVALID')
  const value = parse(match[1])
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('FACT_INVALID')
  const entries = Object.entries(value)
  if (entries.length > 1500) throw new Error('FACT_INVALID')
  const rows = entries.map(([node, rawValue]) => {
    if (!CODE.test('SINA:' + node) || typeof rawValue !== 'string') throw new Error('FACT_INVALID')
    const fields = rawValue.split(',')
    const count = Number(fields[2])
    if (fields[0] !== node || fields.length < 3 || !fields[1]?.trim() || fields[1].trim().length > 100 ||
        !/^\d+$/.test(fields[2]) || !Number.isSafeInteger(count) || count > MAX_MEMBERS) throw new Error('FACT_INVALID')
    return { code: 'SINA:' + node, name: fields[1].trim() }
  })
  return snapshot(rows)
}

export async function fetchSinaConceptMembers(code: string, options: PublicConceptFetchOptions = {}): Promise<PublicConceptSnapshot<PublicConceptMember>> {
  const node = CODE.exec(code)?.[1]
  if (!node) throw new Error('FACT_INVALID')
  const signal = deadline(options)
  const countUrl = new URL('/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount', HOST)
  countUrl.searchParams.set('node', node)
  const countValue = parse(await body(countUrl, options, signal))
  if (!((typeof countValue === 'string' && /^\d+$/.test(countValue)) || typeof countValue === 'number')) throw new Error('FACT_INVALID')
  const total = Number(countValue)
  if (!Number.isSafeInteger(total) || total < 0 || total > MAX_MEMBERS) throw new Error('FACT_INVALID')
  const rows: PublicConceptMember[] = []
  const keys = new Set<string>()
  for (let page = 1; rows.length < total; page++) {
    const url = new URL('/quotes_service/api/json_v2.php/Market_Center.getHQNodeData', HOST)
    url.search = new URLSearchParams({ node, page: String(page), num: String(PAGE_SIZE), sort: 'symbol', asc: '1' }).toString()
    const values = parse(await body(url, options, signal))
    if (!Array.isArray(values) || values.length > PAGE_SIZE) throw new Error('FACT_INVALID')
    const expectedPageRows = Math.min(PAGE_SIZE, total - rows.length)
    if (values.length !== expectedPageRows) {
      throw new PublicConceptCountMismatchError(total, expectedPageRows, values.length, page)
    }
    for (const value of values) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('FACT_INVALID')
      const { symbol, code: stockCode, name } = value as Record<string, unknown>
      const stock = typeof symbol === 'string' ? /^(sh|sz|bj)(\d{6})$/i.exec(symbol) : null
      if (!stock || stockCode !== stock[2] || typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new Error('FACT_INVALID')
      const market = stock[1].toLowerCase()
      if (!(market === 'sh' ? /^6/.test(stock[2]) : market === 'sz' ? /^[03]/.test(stock[2]) : /^[489]/.test(stock[2]))) throw new Error('FACT_INVALID')
      const tsCode = stock[2] + '.' + ({ sh: 'SH', sz: 'SZ', bj: 'BJ' } as Record<string, string>)[market]
      if (keys.has(tsCode)) throw new Error('FACT_INVALID')
      keys.add(tsCode)
      rows.push({ tsCode, name: name.trim() })
    }
    options.onProgress?.(rows.length, total)
  }
  return snapshot(rows)
}

export async function fetchPublicConceptIndexWithFallback(options: PublicConceptFetchOptions = {}): Promise<PublicConceptSnapshot<PublicConceptDefinition>> {
  try {
    const result = await fetchPublicConceptIndex(options)
    if (result.state === 'available' && result.rows.length) return result
  } catch (error) {
    if (options.signal?.aborted) throw error
  }
  options.signal?.throwIfAborted()
  return fetchSinaConceptIndex(options)
}

export function fetchPublicConceptMembersWithFallback(code: string, options: PublicConceptFetchOptions = {}): Promise<PublicConceptSnapshot<PublicConceptMember>> {
  return code.startsWith('SINA:') ? fetchSinaConceptMembers(code, options) : fetchPublicConceptMembers(code, options)
}
