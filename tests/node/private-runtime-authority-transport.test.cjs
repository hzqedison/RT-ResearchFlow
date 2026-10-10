'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const https = require('node:https')
const { EventEmitter } = require('node:events')
const { githubReader } = require('../../scripts/seal-private-python-runtime-producer.cjs')
let sequence = 0
const endpoint = () => '/repos/test/runtime/git/blobs/' + (++sequence).toString(16).padStart(40, '0')
async function mock(replies, action) {
 const original = https.request; let calls = 0
 https.request = (_options, callback) => {
  const req = new EventEmitter(); req.destroy = () => {}
  req.end = () => queueMicrotask(() => {
   const reply = replies[calls++]; assert.ok(reply, 'unexpected transport request')
   if (reply.error) { req.emit('error', new Error('redacted network failure')); return }
   const res = new EventEmitter(); res.statusCode = reply.status; res.destroy = () => {}; callback(res)
   if (reply.status === 200) { res.emit('data', Buffer.from(JSON.stringify(reply.value))); res.emit('end') }
  }); return req
 }
 try { await action(() => calls) } finally { https.request = original }
}
test('immutable official Git objects reused across readers, returned objects not shared', async () => {
 await mock([{ status: 200, value: { sha: 'original' } }], async calls => {
  const path = endpoint(); const a = await githubReader('same-token').readJson(path); a.sha = 'mutated'
  assert.equal((await githubReader('same-token').readJson(path)).sha, 'original'); assert.equal(calls(), 1)
 })
})
test('immutable cache is isolated by credential identity', async () => {
 await mock([{ status: 200, value: 1 }, { status: 200, value: 2 }], async calls => {
  const path = endpoint(); await githubReader('credential-one').readJson(path); await githubReader('credential-two').readJson(path)
  assert.equal(calls(), 2)
 })
})
test('mutable Actions state is always fetched again', async () => {
 await mock([{ status: 200, value: { status: 'in_progress' } }, { status: 200, value: { status: 'completed' } }], async calls => {
  const reader = githubReader(); const path = '/repos/test/runtime/actions/runs/123'
  assert.equal((await reader.readJson(path)).status, 'in_progress'); assert.equal((await reader.readJson(path)).status, 'completed'); assert.equal(calls(), 2)
 })
})
test('authorization denial is reported without retries or response body', async () => {
 await mock([{ status: 403 }], async calls => {
  await assert.rejects(githubReader().readJson(endpoint()), { code: 'AUTHORITY_HTTP_403' }); assert.equal(calls(), 1)
 })
})
test('temporary server failure receives a bounded retry', async () => {
 await mock([{ status: 503 }, { status: 200, value: { ok: true } }], async calls => {
  assert.deepEqual(await githubReader().readJson(endpoint()), { ok: true }); assert.equal(calls(), 2)
 })
})
test('network failure receives a bounded retry', async () => {
 await mock([{ error: true }, { status: 200, value: { ok: true } }], async calls => {
  assert.deepEqual(await githubReader().readJson(endpoint()), { ok: true }); assert.equal(calls(), 2)
 })
})
test('invalid endpoint never makes a request', async () => {
 await mock([], async calls => {
  await assert.rejects(githubReader().readJson('https://untrusted.invalid/path'), { code: 'AUTHORITY_ENDPOINT_INVALID' }); assert.equal(calls(), 0)
 })
})
