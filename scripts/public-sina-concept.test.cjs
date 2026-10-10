'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename)
}
const adapter = require('../electron/main/services/publicSinaConceptSnapshotAdapter.ts')
const index = 'var S_Finance_bankuai_class = {"gn_test":"gn_test,Test,1"};'
const response = value => new Response(typeof value === 'string' ? value : JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=utf-8' } })
const member = { symbol: 'sh600000', code: '600000', name: 'Test stock' }

test('index stays current-only with source and code namespace', async () => {
  const result = await adapter.fetchSinaConceptIndex({ fetcher: async () => response(index) })
  assert.equal(result.source, 'sina_public')
  assert.equal(result.historicalCoverage, false)
  assert.equal(result.dateBasis, 'current-observation')
  assert.deepEqual(result.rows, [{ code: 'SINA:gn_test', name: 'Test' }])
})
test('GBK text is decoded without evaluating scripts', async () => {
  const bytes = Buffer.concat([Buffer.from('var S_Finance_bankuai_class = {"gn_test":"gn_test,'), Buffer.from('d6f7cce2', 'hex'), Buffer.from(',1"};')])
  const result = await adapter.fetchSinaConceptIndex({ fetcher: async () => new Response(bytes, { headers: { 'content-type': 'text/javascript; charset=gbk' } }) })
  assert.equal(result.rows[0].name, '\u4e3b\u9898')
  await assert.rejects(adapter.fetchSinaConceptIndex({ fetcher: async () => response(index + 'process.exit()') }), /FACT_INVALID/)
})
test('members use the actual count, validate symbols, and report progress', async () => {
  const progress = []
  const result = await adapter.fetchSinaConceptMembers('SINA:gn_test', { fetcher: async url => response(String(url).includes('StockCount') ? '"1"' : [member]), onProgress: (current, total) => progress.push([current, total]) })
  assert.deepEqual(result.rows, [{ tsCode: '600000.SH', name: 'Test stock' }])
  assert.deepEqual(progress, [[1, 1]])
})
test('incomplete, duplicate, or inconsistent members are rejected', async () => {
  for (const values of [[member], [member, member], [member, { ...member, symbol: 'sz600001', code: '600001' }]]) {
    await assert.rejects(adapter.fetchSinaConceptMembers('SINA:gn_test', { fetcher: async url => response(String(url).includes('StockCount') ? '"2"' : values) }), /FACT_INVALID/)
  }
})
test('empty boards are not reported as available and invalid codes do not fetch', async () => {
  const result = await adapter.fetchSinaConceptMembers('SINA:gn_test', { fetcher: async () => response('"0"') })
  assert.equal(result.state, 'empty')
  await assert.rejects(adapter.fetchSinaConceptMembers('SINA:../../bad', { fetcher: async () => { throw Error('UNEXPECTED_FETCH') } }), /FACT_INVALID/)
})
test('Eastmoney transport failure falls back to Sina', async () => {
  const result = await adapter.fetchPublicConceptIndexWithFallback({ fetcher: async url => {
    if (new URL(url).hostname.includes('eastmoney')) throw Error('UPSTREAM_FAILED')
    return response(index)
  } })
  assert.equal(result.source, 'sina_public')
})
test('cancellation is preserved without a fallback request', async () => {
  const controller = new AbortController(); controller.abort()
  let calls = 0
  await assert.rejects(adapter.fetchPublicConceptIndexWithFallback({ signal: controller.signal, fetcher: async () => { calls++; return response(index) } }))
  assert.equal(calls, 0)
})
