import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchPublicConceptIndex, fetchPublicConceptMembers } from '../electron/main/services/publicConceptSnapshotAdapter.ts'

const page = (total, diff) => new Response(JSON.stringify({ rc: 0, data: { total, diff } }))
const board = (code = 'BK0655') => ({ f12: code, f14: 'Concept' })
const stock = (code = '600036', market = 1) => ({ f12: code, f13: market, f14: 'Stock' })

test('index is explicitly current-only, not a historical trade date', async () => {
  const result = await fetchPublicConceptIndex({ fetcher: async url => {
    assert.equal(new URL(url).hostname, '79.push2.eastmoney.com')
    return page(1, [board()])
  } })
  assert.equal(result.state, 'available')
  assert.equal(result.historicalCoverage, false)
  assert.equal(result.dateBasis, 'current-observation')
  assert.equal(Object.hasOwn(result, 'tradeDate'), false)
})
test('all pages are required and progress counts collected rows', async () => {
  const progress = []
  const result = await fetchPublicConceptMembers('BK0655', {
    fetcher: async url => page(2, [new URL(url).searchParams.get('pn') === '1' ? stock() : stock('000001', 0)]),
    onProgress: (...args) => progress.push(args),
  })
  assert.deepEqual(result.rows.map(row => row.tsCode), ['600036.SH', '000001.SZ'])
  assert.deepEqual(progress, [[1, 2], [2, 2]])
})
test('empty is not available', async () => {
  const result = await fetchPublicConceptIndex({ fetcher: async () => page(0, null) })
  assert.equal(result.state, 'empty')
  assert.deepEqual(result.rows, [])
})
test('missing page and repeated page reject the entire collection', async () => {
  for (const second of [[], [stock()]]) {
    let calls = 0
    await assert.rejects(fetchPublicConceptMembers('BK0655', {
      fetcher: async () => page(2, ++calls === 1 ? [stock()] : second),
    }), /PAGINATION_INCOMPLETE/)
  }
})
test('changing totals, missing totals and excessive counts are rejected', async () => {
  let calls = 0
  await assert.rejects(fetchPublicConceptMembers('BK0655', {
    fetcher: async () => page(++calls === 1 ? 2 : 1, [stock()]),
  }), /PAGINATION_INCOMPLETE/)
  await assert.rejects(fetchPublicConceptIndex({ fetcher: async () => page(undefined, [board()]) }), /FACT_INVALID/)
  await assert.rejects(fetchPublicConceptIndex({ fetcher: async () => page(1501, [board()]) }), /PAGINATION_INCOMPLETE/)
})
test('invalid market and unsafe concept identifier reject without fallback', async () => {
  await assert.rejects(fetchPublicConceptMembers('BK0655', { fetcher: async () => page(1, [stock('600036', 0)]) }), /FACT_INVALID/)
  assert.throws(() => fetchPublicConceptMembers('BK0655&fs=anything'), /INVALID_SOURCE/)
})
test('cancellation does not start a request', async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  await assert.rejects(fetchPublicConceptIndex({ signal: controller.signal, fetcher: async () => {
    calls++
    return page(1, [board()])
  } }), { name: 'AbortError' })
  assert.equal(calls, 0)
})
test('oversized responses are rejected', async () => {
  await assert.rejects(fetchPublicConceptIndex({ fetcher: async () => new Response('x'.repeat(1024 * 1024 + 1)) }), /FACT_INVALID/)
})
