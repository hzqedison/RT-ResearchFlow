'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { runtimeSigningExclusion, signAppPreservingRuntime } = require('../../macos/sign-app.cjs')

const app = path.resolve('isolated-fixture', 'RT-ResearchFlow.app')
const runtime = path.join(app, 'Contents', 'Resources', 'private-python-runtime')

test('exclude exactly the locked runtime, including Chinese and space paths', () => {
  const ignore = runtimeSigningExclusion(app)
  assert.equal(ignore(runtime), true)
  assert.equal(ignore(path.join(runtime, 'python', 'bin', 'python3.13')), true)
  assert.equal(ignore(path.join(runtime, 'providers', '\u4e2d\u6587 site', 'module.so')), true)
})

test('do not exclude the app, helpers, SQLite, neighbours or escape paths', () => {
  const ignore = runtimeSigningExclusion(app)
  for (const file of [app, path.join(app, 'Contents', 'Frameworks', 'Helper.app'),
    path.join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'binding.node'),
    runtime + '-backup', path.join(runtime, '..', 'other.so'), 'relative/runtime', null]) {
    assert.equal(ignore(file), false)
  }
})

test('reject relative paths and non-app paths before invoking a signer', async () => {
  for (const file of ['relative.app', path.resolve('not-an-app'), null]) {
    await assert.rejects(signAppPreservingRuntime(file, () => assert.fail('signer must not run')))
  }
})

test('ad-hoc signing retains strict verification and never enables notarization', async () => {
  let options
  await signAppPreservingRuntime(app, async value => { options = value })
  assert.equal(options.app, app)
  assert.equal(options.identity, '-')
  assert.equal(options.platform, 'darwin')
  assert.equal(options.strictVerify, true)
  assert.equal(options.preAutoEntitlements, false)
  assert.equal(options.preEmbedProvisioningProfile, false)
  assert.equal(options.ignore(path.join(runtime, 'node', 'bin', 'node')), true)
  assert.equal(options.ignore(path.join(app, 'Contents', 'MacOS', 'RT-ResearchFlow')), false)
  assert.deepEqual(options.optionsForFile(app), { hardenedRuntime: false, timestamp: 'none' })
})

test('a signer failure remains a packaging failure', async () => {
  await assert.rejects(signAppPreservingRuntime(app, async () => { throw new Error('isolated signature rejection') }),
    /isolated signature rejection/)
})

test('wait for nested signing before returning to the manifest validator', async () => {
  let release
  let done = false
  const gate = new Promise(resolve => { release = resolve })
  const result = signAppPreservingRuntime(app, async () => { await gate; done = true })
  assert.equal(done, false)
  release()
  await result
  assert.equal(done, true)
})
