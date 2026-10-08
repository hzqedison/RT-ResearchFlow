import { spawnSync } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)

if (process.platform !== 'darwin') {
  throw new Error('Build macOS packages on a Mac or with the macOS GitHub Actions workflow.')
}
if (!['arm64', 'x64'].includes(process.arch)) {
  throw new Error(`Unsupported macOS architecture: ${process.arch}`)
}
if (process.versions.node.split('.')[0] !== '20') {
  throw new Error('This upstream version requires Node.js 20. Use Node.js 20 and pnpm 10.')
}
if (args.some((arg) => arg !== '--dir') || args.length > 1) {
  throw new Error('Usage: node macos/build.mjs [--dir]')
}

function run(args) {
  const result = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit', env: {
    ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  } })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function hasFrameworkLinks() {
  try {
    const require = createRequire(import.meta.url)
    const framework = join(dirname(require.resolve('electron/package.json')), 'dist',
      'Electron.app', 'Contents', 'Frameworks', 'Electron Framework.framework')
    return ['Electron Framework', 'Helpers', 'Libraries', 'Resources', 'Versions/Current']
      .every((entry) => lstatSync(join(framework, entry)).isSymbolicLink())
  } catch {
    return false
  }
}

// Repair installations restored from an older, symlink-flattening pnpm cache.
// Reinstall pinned dependencies with their normal installers; never rewrite
// framework contents or bypass code signing to make a broken runtime pass.
if (!hasFrameworkLinks()) {
  console.warn('Restoring native Electron framework links from the pinned dependency installers.')
  run(['install', '--frozen-lockfile', '--force', '--config.side-effects-cache=false'])
  if (!hasFrameworkLinks()) {
    throw new Error('Electron framework links are still invalid after reinstall; refusing to package.')
  }
}

run(['run', 'build'])
run(['exec', 'electron-builder', '--mac', `--${process.arch}`,
  '--config', 'macos/electron-builder.cjs', '--publish', 'never', ...args])
