'use strict'

const path = require('node:path')
const { createRequire } = require('node:module')

function runtimeSigningExclusion(appPath) {
  if (typeof appPath !== 'string' || !path.isAbsolute(appPath) || !appPath.endsWith('.app')) {
    throw new Error('A native absolute application bundle path is required')
  }
  const runtime = path.join(appPath, 'Contents', 'Resources', 'private-python-runtime')
  return file => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) return false
    const relative = path.relative(runtime, file)
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' &&
      !relative.startsWith('..' + path.sep))
  }
}

async function signAppPreservingRuntime(appPath, signAsync) {
  const ignore = runtimeSigningExclusion(appPath)
  if (!signAsync) {
    // Use the existing lockfile-pinned builder dependency, not a new installer.
    const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'))
    signAsync = builderRequire('@electron/osx-sign').signAsync
  }
  // Sign enclosing components inside-out, but never rewrite the runtime whose
  // signatures and inventory were already verified before packaging. The signer
  // still verifies the complete app with codesign --verify --deep --strict.
  await signAsync({
    app: appPath,
    platform: 'darwin',
    type: 'distribution',
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    // osx-sign 1.0.5 defaults to --strict. Passing true emits the invalid
    // --strict=true spelling; omission preserves strict verification.
    ignore,
    optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }),
  })
}

module.exports = { runtimeSigningExclusion, signAppPreservingRuntime }
