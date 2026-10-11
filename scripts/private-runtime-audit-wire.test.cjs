'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const source = fs.readFileSync(require('node:path').join(__dirname, '../resources/python-runtime/bootstrap.py'), 'utf8')
const script = source.match(/AUDIT_NODE_SCRIPT = r'''([\s\S]*?)'''/)[1]

function invoke(pin, omitted = false) {
  const input = { root: '/isolated/runtime', manifest: { node: { version: '22.23.3' } } }
  if (!omitted) input.generatorSha256 = pin
  const stdin = new EventEmitter()
  let actual, stdout = '', stderr = ''
  const process = { stdin, versions: { node: '22.23.3' }, stdout: { write: text => { stdout += text } }, stderr: { write: text => { stderr += text } } }
  vm.runInNewContext(script, { Buffer, process, require: name => {
    if (name === 'node:fs') return {}
    if (name === 'node:path') return require('node:path')
    return { validateDependencyAudits: (_root, _manifest, expected) => {
      actual = expected
      if (expected !== undefined && !(typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected))) throw Error('INVALID_PIN')
      return [{ provider: 'akshare' }, { provider: 'mootdx' }, { provider: 'pywencai' }]
    } }
  } })
  stdin.emit('data', Buffer.from(JSON.stringify(input)))
  stdin.emit('end')
  return { actual, stdout, stderr, exitCode: process.exitCode }
}
test('Python null default is transported as an absent optional pin', () => {
  const result = invoke(null)
  assert.equal(result.actual, undefined)
  assert.equal(result.stderr, '')
  assert.equal(JSON.parse(result.stdout).reports.length, 3)
})
test('explicit generator SHA is preserved, not discarded', () => {
  const pin = 'a'.repeat(64)
  const result = invoke(pin)
  assert.equal(result.actual, pin)
  assert.equal(result.stderr, '')
})
test('invalid explicit pins are still rejected', () => {
  for (const pin of ['', 123, {}, 'not-a-hash']) {
    const result = invoke(pin)
    assert.equal(result.exitCode, 70)
    assert.match(result.stderr, /PRIVATE_RUNTIME_INVALID/)
    assert.equal(result.stdout, '')
  }
})
test('omitted pins remain optional', () => {
  assert.equal(invoke(undefined, true).actual, undefined)
})
