import { spawnSync } from 'node:child_process'
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

run(['run', 'build'])
run(['exec', 'electron-builder', '--mac', `--${process.arch}`,
  '--config', 'macos/electron-builder.cjs', '--publish', 'never', ...args])
