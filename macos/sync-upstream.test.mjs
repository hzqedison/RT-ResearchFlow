import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncUpstream } from './sync-upstream.mjs'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'rt-macos-sync-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const upstream = join(directory, 'upstream')
  const local = join(directory, 'local')
  mkdirSync(upstream)
  function git(cwd, ...args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git(upstream, 'init', '-b', 'main')
  git(upstream, 'config', 'user.name', 'Mac sync test')
  git(upstream, 'config', 'user.email', 'mac-sync@example.invalid')
  writeFileSync(join(upstream, 'base.txt'), 'initial\n')
  git(upstream, 'add', '.')
  git(upstream, 'commit', '-m', 'initial')
  git(directory, 'clone', upstream, local)
  git(local, 'config', 'user.name', 'Mac sync test')
  git(local, 'config', 'user.email', 'mac-sync@example.invalid')
  git(local, 'switch', '-c', 'codex/macos-support')
  function commit(cwd, filename, content) {
    writeFileSync(join(cwd, filename), content)
    git(cwd, 'add', filename)
    git(cwd, 'commit', '-m', `update ${filename}`)
  }
  return { upstream, local, git, commit }
}

test('checks without merging, then preserves local Mac changes when merging upstream', (t) => {
  const f = fixture(t)
  f.commit(f.local, 'mac-only.txt', 'personal Mac changes\n')
  f.commit(f.upstream, 'new-feature.txt', 'upstream feature\n')
  const head = f.git(f.local, 'rev-parse', 'HEAD')
  assert.equal(syncUpstream({ cwd: f.local, url: f.upstream }).status, 'updates-available')
  assert.equal(f.git(f.local, 'rev-parse', 'HEAD'), head)
  assert.equal(syncUpstream({ cwd: f.local, url: f.upstream, apply: true }).status, 'merged')
  assert.equal(readFileSync(join(f.local, 'mac-only.txt'), 'utf8'), 'personal Mac changes\n')
  assert.equal(readFileSync(join(f.local, 'new-feature.txt'), 'utf8'), 'upstream feature\n')
  assert.equal(syncUpstream({ cwd: f.local, url: f.upstream }).status, 'up-to-date')
})

test('refuses dirty worktrees, the wrong branch, and unrelated upstream remotes', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.local, 'uncommitted.txt'), 'keep me\n')
  assert.throws(() => syncUpstream({ cwd: f.local, url: f.upstream, apply: true }), /Nothing was overwritten/)
  assert.equal(readFileSync(join(f.local, 'uncommitted.txt'), 'utf8'), 'keep me\n')
  f.git(f.local, 'add', '.')
  f.git(f.local, 'commit', '-m', 'local changes')
  f.git(f.local, 'switch', 'main')
  assert.throws(() => syncUpstream({ cwd: f.local, url: f.upstream, apply: true }), /Switch to/)
  f.git(f.local, 'remote', 'add', 'upstream', 'https://example.invalid/unrelated.git')
  assert.throws(() => syncUpstream({ cwd: f.local, url: f.upstream }), /points elsewhere/)
})

test('keeps a conflicted merge available for human resolution instead of resetting changes', (t) => {
  const f = fixture(t)
  f.commit(f.local, 'base.txt', 'personal edit\n')
  f.commit(f.upstream, 'base.txt', 'upstream edit\n')
  assert.throws(() => syncUpstream({ cwd: f.local, url: f.upstream, apply: true }), /Merge stopped/)
  assert.match(f.git(f.local, 'status', '--porcelain'), /UU base.txt/)
  assert.match(readFileSync(join(f.local, 'base.txt'), 'utf8'), /personal edit/)
  f.git(f.local, 'merge', '--abort')
  assert.equal(readFileSync(join(f.local, 'base.txt'), 'utf8'), 'personal edit\n')
})
