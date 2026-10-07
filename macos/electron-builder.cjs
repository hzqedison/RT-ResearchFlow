const { execFileSync } = require('node:child_process')
const path = require('node:path')
const base = require('../electron-builder.js')

module.exports = {
  ...base,
  // Rebuild for the target Electron ABI and architecture, never reuse Windows bindings.
  npmRebuild: true,
  // Reuse the pinned, native Electron installed by pnpm instead of downloading
  // it again through the older builder's incompatible mirror URL template.
  electronDist: path.join(path.dirname(require.resolve('electron/package.json')), 'dist'),
  asarUnpack: ['**/*.node'],
  mac: {
    category: 'public.app-category.finance',
    target: ['dmg', 'zip'],
    artifactName: '${productName}-macOS-${version}-${arch}.${ext}',
    minimumSystemVersion: '12.0',
    identity: null,
    hardenedRuntime: false,
    gatekeeperAssess: false,
  },
  // Personal builds need an ad-hoc signature on Apple Silicon. This is NOT
  // Developer ID signing or notarization and does not bypass Gatekeeper.
  afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    execFileSync('/usr/bin/codesign', [
      '--force', '--deep', '--sign', '-', '--timestamp=none', appPath,
    ], { stdio: 'inherit' })
  },
}
