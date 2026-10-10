// Public endpoint parameters verified against AKShare's stock_board_concept_em.py.
// These are observed current memberships, NOT historical or point-in-time facts.
export interface PublicConceptDefinition { code: string; name: string }
export interface PublicConceptMember { tsCode: string; name: string }
export interface PublicConceptSnapshot<T> {
  source: 'eastmoney_public' | 'sina_public'
  dateBasis: 'current-observation'
  observedAt: number
  historicalCoverage: false
  state: 'available' | 'empty'
  rows: T[]
}
export interface PublicConceptFetchOptions {
  signal?: AbortSignal
  onProgress?: (current: number, total: number) => void
  fetcher?: typeof fetch
}

const MAX_RESPONSE_BYTES = 1024 * 1024
const PAGE_SIZE = 100

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('FACT_INVALID')
  return value as Record<string, unknown>
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string') throw new Error('FACT_INVALID')
  const result = value.trim()
  if (!result || result.length > maximum) throw new Error('FACT_INVALID')
  return result
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error('UPSTREAM_FAILED')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw new Error('FACT_INVALID')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new Error('FACT_INVALID') }
}

async function collect<T>(
  hostname: string, filter: string, maximum: number,
  normalize: (row: Record<string, unknown>) => { key: string; value: T },
  options: PublicConceptFetchOptions,
): Promise<PublicConceptSnapshot<T>> {
  const deadline = AbortSignal.timeout(25_000)
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
  const rows: T[] = []
  const keys = new Set<string>()
  let expected: number | null = null
  for (let page = 1; page <= Math.ceil(maximum / PAGE_SIZE); page++) {
    signal.throwIfAborted()
    const url = new URL(`https://${hostname}/api/qt/clist/get`)
    const params = { pn: String(page), pz: String(PAGE_SIZE), po: '1', np: '1',
      ut: 'bd1d9ddb04089700cf9c27f6f7426281', fltt: '2', invt: '2', fid: 'f12',
      fs: filter, fields: 'f12,f13,f14' }
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8_000)])
    const response = await (options.fetcher ?? fetch)(url, {
      signal: requestSignal, redirect: 'error',
      headers: { Referer: 'https://quote.eastmoney.com/' },
    })
    const payload = object(await boundedJson(response))
    requestSignal.throwIfAborted()
    if (payload.rc !== 0) throw new Error('UPSTREAM_FAILED')
    const data = object(payload.data)
    if (typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('FACT_INVALID')
    if (data.total > maximum) throw new Error('PAGINATION_INCOMPLETE')
    if (expected !== null && data.total !== expected) throw new Error('PAGINATION_INCOMPLETE')
    expected = data.total
    // np=1 requests an array; object-shaped responses must not be silently reordered.
    const diff = data.diff === null && expected === 0 ? [] : data.diff
    if (!Array.isArray(diff) || diff.length > PAGE_SIZE) throw new Error('FACT_INVALID')
    if (!diff.length && rows.length < expected) throw new Error('PAGINATION_INCOMPLETE')
    for (const raw of diff) {
      const entry = normalize(object(raw))
      if (keys.has(entry.key)) throw new Error('PAGINATION_INCOMPLETE')
      keys.add(entry.key)
      rows.push(entry.value)
    }
    if (rows.length > expected) throw new Error('FACT_INVALID')
    options.onProgress?.(rows.length, expected)
    signal.throwIfAborted()
    if (rows.length === expected) return {
      source: 'eastmoney_public', dateBasis: 'current-observation',
      observedAt: Date.now(), historicalCoverage: false,
      state: rows.length ? 'available' : 'empty', rows,
    }
  }
  throw new Error('PAGINATION_INCOMPLETE')
}

export function fetchPublicConceptIndex(options: PublicConceptFetchOptions = {}): Promise<PublicConceptSnapshot<PublicConceptDefinition>> {
  return collect('79.push2.eastmoney.com', 'm:90 t:3 f:!50', 1500, row => {
    const code = text(row.f12, 12)
    if (!/^BK\d{4,6}$/.test(code)) throw new Error('FACT_INVALID')
    return { key: code, value: { code, name: text(row.f14, 100) } }
  }, options)
}

export function fetchPublicConceptMembers(code: string, options: PublicConceptFetchOptions = {}): Promise<PublicConceptSnapshot<PublicConceptMember>> {
  if (!/^BK\d{4,6}$/.test(code)) throw new Error('INVALID_SOURCE')
  return collect('29.push2.eastmoney.com', `b:${code} f:!50`, 6000, row => {
    const stockCode = text(row.f12, 6)
    if (!/^(?:[034689]\d{5})$/.test(stockCode)) throw new Error('FACT_INVALID')
    const suffix = stockCode.startsWith('6') ? 'SH' : /^[489]/.test(stockCode) ? 'BJ' : 'SZ'
    const market = suffix === 'SH' ? 1 : suffix === 'SZ' ? 0 : 2
    if (row.f13 !== market) throw new Error('FACT_INVALID')
    const tsCode = `${stockCode}.${suffix}`
    return { key: tsCode, value: { tsCode, name: text(row.f14, 100) } }
  }, options)
}
