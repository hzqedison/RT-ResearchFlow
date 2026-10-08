import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const upstreamUrl = 'https://github.com/caoritian002-wq/RT-ResearchFlow.git'
const root = fileURLToPath(new URL('../', import.meta.url))

function git(cwd, args, allowFailure = false) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: {
    ...process.env, GIT_TERMINAL_PROMPT: '0',
  } })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`)
  }
  return { status: result.status, output: result.stdout.trim(), error: result.stderr.trim() }
}

export function syncUpstream({ cwd = root, apply = false, url = upstreamUrl } = {}) {
  const branch = git(cwd, ['branch', '--show-current']).output
  if (apply && branch !== 'codex/macos-support') {
    throw new Error('Switch to codex/macos-support before applying upstream changes.')
  }
  if (apply && git(cwd, ['status', '--porcelain']).output) {
    throw new Error('Commit or stash your local changes first. Nothing was overwritten.')
  }
  const remote = git(cwd, ['config', '--get', 'remote.upstream.url'], true)
  if (remote.status !== 0) {
    git(cwd, ['remote', 'add', 'upstream', url])
  } else if (remote.output.replace(/\.git$/, '') !== url.replace(/\.git$/, '')) {
    throw new Error('The existing upstream remote points elsewhere; it was not changed.')
  }
  git(cwd, ['fetch', '--prune', 'upstream', 'main'])
  const pending = Number(git(cwd, ['rev-list', '--count', 'HEAD..upstream/main']).output)
  if (pending === 0) return { status: 'up-to-date', pending }
  if (!apply) return { status: 'updates-available', pending }
  const merged = git(cwd, ['merge', '--no-edit', 'upstream/main'], true)
  if (merged.status !== 0) {
    throw new Error(`Merge stopped. Resolve conflicts and commit, or use git merge --abort.\n${merged.output}\n${merged.error}`)
  }
  return { status: 'merged', pending }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length > 1 || args.some((arg) => !['--check', '--apply'].includes(arg))) {
    throw new Error('Usage: node macos/sync-upstream.mjs [--check|--apply]')
  }
  console.log(JSON.stringify(syncUpstream({ apply: args[0] === '--apply' })))
}
