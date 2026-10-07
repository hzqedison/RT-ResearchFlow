const { execFileSync } = require('node:child_process')
const { lstatSync, readlinkSync, readdirSync } = require('node:fs')
const path = require('node:path')
const base = require('../electron-builder.js')

function describeFramework(label, frameworkPath) {
  const entries = []
  function describe(relative, depth) {
    const target = path.join(frameworkPath, relative)
    try {
      const stat = lstatSync(target)
      if (stat.isSymbolicLink()) {
        entries.push(`${relative || '.'}: symlink -> ${readlinkSync(target)}`)
      } else if (stat.isDirectory()) {
        entries.push(`${relative || '.'}: directory`)
        if (depth < 3) {
          for (const name of readdirSync(target).sort().slice(0, 40)) {
            describe(path.join(relative, name), depth + 1)
          }
        }
      } else {
        entries.push(`${relative}: file`)
      }
    } catch (error) {
      entries.push(`${relative || '.'}: ${error.code || 'unavailable'}`)
    }
  }
  describe('', 0)
  console.error(`Mac framework layout (${label}):\n${entries.join('\n')}`)
}

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
    extendInfo: {
      NSAppleEventsUsageDescription: '仅在用户发起交易实验时控制本机同花顺界面，用于表单预览与模拟委托；不收集账户凭证。',
    },
    gatekeeperAssess: false,
  },
  // Personal builds need an ad-hoc signature on Apple Silicon. This is NOT
  // Developer ID signing or notarization and does not bypass Gatekeeper.
  afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    try {
      execFileSync('/usr/bin/codesign', [
        '--force', '--deep', '--sign', '-', '--timestamp=none', appPath,
      ], { stdio: 'inherit' })
    } catch (error) {
      // Only public runtime filenames and symlink targets, never application data.
      // Keep the build failed rather than distributing an invalid signature.
      const framework = path.join('Contents', 'Frameworks', 'Electron Framework.framework')
      describeFramework('installed Electron', path.join(module.exports.electronDist, 'Electron.app', framework))
      describeFramework('packaged application', path.join(appPath, framework))
      throw error
    }
  },
}
