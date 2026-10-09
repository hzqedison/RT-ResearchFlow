'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { readValidatedRuntime, hash } = require('../electron/shared/privatePythonRuntimeManifest.cjs')

function nativeTarget(context) {
  const platform = context.electronPlatformName
  const arch = typeof context.arch === 'string' ? context.arch : { 1: 'x64', 3: 'arm64' }[context.arch]
  if (platform !== process.platform || arch !== process.arch ||
      !['win32-x64', 'darwin-arm64', 'darwin-x64'].includes(platform + '-' + arch)) {
    throw new Error('PRIVATE_RUNTIME_INVALID: build on the matching native target')
  }
  return platform + '-' + arch
}
function validateBootstrap(root, target) {
  const result = readValidatedRuntime(root, target)
  const source = fs.readFileSync(path.join(__dirname, '../resources/python-runtime/bootstrap.py'))
  if (result.manifest.files.find(f => f.path === 'bootstrap.py')?.sha256 !== hash(source)) {
    throw new Error('PRIVATE_RUNTIME_INVALID: untrusted bootstrap')
  }
  const adapter = fs.readFileSync(path.join(__dirname, '../resources/python-runtime/miniracer_unicode_adapter.py'))
  if (result.manifest.miniRacerAdapter.sha256 !== hash(adapter)) throw new Error('PRIVATE_RUNTIME_INVALID: untrusted MiniRacer adapter')
  return result
}
function withPrivatePythonRuntime(base) {
  const beforePack = base.beforePack
  const extra = base.extraResources == null ? [] : Array.isArray(base.extraResources) ? base.extraResources : [base.extraResources]
  return {
    ...base,
    extraResources: [...extra, {
      from: path.join(__dirname, '../resources/python-runtime/bundles/' + process.platform + '-${arch}'),
      to: 'private-python-runtime', filter: ['**/*'],
    }],
    async beforePack(context) {
      const target = nativeTarget(context)
      validateBootstrap(path.join(__dirname, '../resources/python-runtime/bundles', target), target)
      if (beforePack) await beforePack(context)
    },
  }
}
function withPrivatePythonPostPackValidation(base) {
  const afterPack = base.afterPack
  const afterSign = base.afterSign
  function verify(context) {
    const target = nativeTarget(context)
    const resources = context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources')
    validateBootstrap(path.join(resources, 'private-python-runtime'), target)
  }
  return {
    ...base,
    async afterPack(context) {
      if (afterPack) await afterPack(context)
      // Signing must not silently invalidate the runtime ledger. A mismatch blocks
      // packaging until a reviewed signing/final-manifest sequence is supplied.
      verify(context)
    },
    async afterSign(context) {
      if (afterSign) await afterSign(context)
      verify(context)
    },
  }
}
module.exports = { nativeTarget, validateBootstrap, withPrivatePythonRuntime, withPrivatePythonPostPackValidation }
