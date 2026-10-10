const assert = require('node:assert/strict')
const test = require('node:test')
const ts = require('typescript')
const fs = require('node:fs')
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  module._compile(output, filename)
}
const { syncPublicConceptSnapshots, getPublicConceptSyncStatus, cancelPublicConceptSync } = require('../electron/main/services/publicConceptSnapshotSyncService.ts')
function database() {
  const rows = new Map()
  return {
    rows, exec() {}, prepare(sql) {
      if (sql.startsWith('SELECT')) return { get: () => ({ boards: rows.size, members: [...rows.values()].reduce((n, row) => n + row.count, 0), latestObservedAt: rows.size ? Math.max(...[...rows.values()].map(row => row.time)) : null }) }
      return { run: (code, name, time, count, payload) => rows.set(code, { name, time, count, payload }) }
    },
  }
}
const snapshot = rows => ({ source: 'eastmoney_public', dateBasis: 'current-observation', observedAt: Date.now(), historicalCoverage: false, state: rows.length ? 'available' : 'empty', rows })
const definitions = [{ code: 'BK0655', name: 'Concept' }]
const members = [{ tsCode: '600036.SH', name: 'Stock' }]
test('cache is separate, persisted only after collection, and singleflight', async () => {
  const db = database()
  let calls = 0
  const deps = { index: async () => { calls++; return snapshot(definitions) }, members: async () => snapshot(members) }
  const first = syncPublicConceptSnapshots(db, deps)
  assert.equal(syncPublicConceptSnapshots(db, deps), first)
  assert.equal(getPublicConceptSyncStatus(db).state, 'running')
  const result = await first
  assert.equal(calls, 1)
  assert.equal(result.state, 'completed')
  assert.equal(result.cachedMembers, 1)
  assert.equal(JSON.parse(db.rows.get('BK0655').payload).historicalCoverage, false)
})
test('empty and failed member requests preserve old cache', async () => {
  for (const fetchMembers of [async () => snapshot([]), async () => { throw new Error('secret upstream text') }]) {
    const db = database()
    db.rows.set('BK0655', { time: 1, count: 2, payload: 'old' })
    const result = await syncPublicConceptSnapshots(db, { index: async () => snapshot(definitions), members: fetchMembers })
    assert.equal(result.state, 'failed')
    assert.equal(result.failedBoards, 1)
    assert.equal(db.rows.get('BK0655').payload, 'old')
    assert.equal(JSON.stringify(result).includes('secret'), false)
  }
})
test('cancelled task does not save returned data', async () => {
  const db = database()
  let release
  const pending = new Promise(resolve => { release = resolve })
  const task = syncPublicConceptSnapshots(db, { index: () => pending, members: async () => snapshot(members) })
  cancelPublicConceptSync(db)
  release(snapshot(definitions))
  const result = await task
  assert.equal(result.state, 'cancelled')
  assert.equal(db.rows.size, 0)
})
test('three consecutive failures stop requests without pretending all boards were processed', async () => {
  const db = database()
  const boards = Array.from({ length: 5 }, (_, i) => ({ code: `BK${1000 + i}`, name: 'Concept' }))
  const result = await syncPublicConceptSnapshots(db, { index: async () => snapshot(boards), members: async () => { throw new Error('unavailable') } })
  assert.equal(result.state, 'failed')
  assert.equal(result.attemptedBoards, 3)
  assert.equal(result.totalBoards, 5)
})
