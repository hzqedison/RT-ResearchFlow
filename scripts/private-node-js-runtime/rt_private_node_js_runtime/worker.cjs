// SPDX-License-Identifier: AGPL-3.0-only
'use strict'
// Audited/trusted offline JS only. node:vm is not an OS security sandbox.
const vm = require('node:vm')
const context = vm.createContext(Object.create(null), {
  codeGeneration: { strings: true, wasm: false }, microtaskMode: 'afterEvaluate',
})
const MAX = 1024 * 1024
let pending = Buffer.alloc(0), serial = 0
function send(value) {
  const data = Buffer.from(JSON.stringify(value) + '\n', 'utf8')
  if (data.length > MAX) throw new Error('response bound exceeded')
  process.stdout.write(data)
}
// Serialization executes INSIDE the VM timeout, including getters/toJSON.
const serialize = expression => `(() => {
  const value = (${expression});
  const seen = new WeakSet();
  function check(v, depth) {
    if (depth > 128) throw Error('RT_UNSUPPORTED: value depth');
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint')
      throw Error('RT_UNSUPPORTED: function/symbol/bigint');
    if (v && typeof v === 'object') {
      if (Object.prototype.toString.call(v) === '[object Promise]' || typeof v.then === 'function')
        throw Error('RT_UNSUPPORTED: Promise/thenable');
      if (seen.has(v)) throw Error('RT_UNSUPPORTED: cyclic value');
      seen.add(v);
      for (const key of Object.keys(v)) check(v[key], depth + 1);
      seen.delete(v);
    }
  }
  check(value, 0);
  const result = JSON.stringify(value);
  if (typeof result !== 'string') throw Error('RT_UNSUPPORTED: non-JSON result');
  return result;
})()`
function request(bytes) {
  let input
  try {
    input = JSON.parse(bytes.toString('utf8'))
    if (!input || input.id !== ++serial || !['eval', 'execute', 'call'].includes(input.op) ||
        typeof input.code !== 'string' || !Array.isArray(input.args) ||
        !Number.isInteger(input.timeout) || input.timeout < 1 || input.timeout > 5000) throw Error('invalid protocol')
    const source = input.op === 'eval' ? input.code : serialize(input.op === 'call'
      ? `(${input.code})(...${JSON.stringify(input.args)})` : input.code)
    const value = new vm.Script(source).runInContext(context, { timeout: input.timeout })
    if (input.op !== 'eval') send({ id: input.id, type: 'json', value })
    else if (value === undefined) send({ id: input.id, type: 'undefined' })
    else if (value === null) send({ id: input.id, type: 'null', value: null })
    else if (['boolean', 'string', 'number'].includes(typeof value) &&
             (typeof value !== 'number' || Number.isFinite(value))) send({ id: input.id, type: typeof value, value })
    else send({ id: input.id, kind: 'unsupported', error: 'eval object/proxy/Promise/nonfinite result is unsupported; use execute for JSON' })
  } catch (error) {
    const timeout = error && error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
    const message = String(error && error.message || 'JavaScript error').slice(0, 2048)
    send({ id: input && input.id, kind: timeout ? 'timeout' : message.startsWith('RT_UNSUPPORTED:') ? 'unsupported' : 'javascript', error: message })
  }
}
process.stdin.on('data', chunk => {
  pending = Buffer.concat([pending, chunk])
  for (;;) {
    const end = pending.indexOf(10)
    if (end < 0) break
    if (end > MAX) process.exit(70)
    const line = pending.subarray(0, end); pending = pending.subarray(end + 1)
    request(line)
  }
  if (pending.length > MAX) process.exit(70)
})
process.stdin.on('end', () => process.exit(0))
send({ ready: true, pid: process.pid, nodeVersion: process.versions.node })
