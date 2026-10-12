import test from 'node:test'
import assert from 'node:assert/strict'
import { renderHomepage, synchronizeHomepage } from '../.github/scripts/sync-release-homepage.mjs'

const repo = 'hzqedison/RT-ResearchFlow'
const expected = { repository: repo, version: '1.20.0', sourceCommit: 'a'.repeat(40) }
const prefix = 'https://github.com/' + repo
const release = {
  id: 20, tag_name: 'v1.20.0', target_commitish: expected.sourceCommit,
  draft: false, prerelease: false, html_url: prefix + '/releases/tag/v1.20.0',
  body: '## Fixes\n\nRestored manual authorization. Real broker acceptance remains unverified.',
  assets: [
    'RT-ResearchFlow-Setup-1.20.0-x64.exe',
    'RT-ResearchFlow-macOS-1.20.0-arm64.dmg',
    'RT-ResearchFlow-macOS-1.20.0-x64.dmg'
  ].map(name => ({ name, state: 'uploaded', size: 123, browser_download_url: prefix + '/releases/download/v1.20.0/' + name }))
}
const readme = '# Product\n<!-- CURRENT-RELEASE-START -->\n## 当前正式版本：1.19\nold\n<!-- CURRENT-RELEASE-END -->\n\n## Features\nKeep user edits.\n\ngit clone --branch v1.19.0 https://github.com/hzqedison/RT-ResearchFlow.git\n\nAGPL-3.0-only / NOTICE / original credits\nHistorical 1.19 notes stay unchanged.'
const sha = 'b'.repeat(40)

test('updates downloads and actual release notes while preserving unrelated content and credits', () => {
  const body = renderHomepage(readme, release, expected)
  assert.ok(body.includes('当前正式版本：1.20'))
  assert.ok(body.includes(release.body))
  for (const asset of release.assets) assert.ok(body.includes(asset.browser_download_url))
  assert.ok(body.includes('Keep user edits.'))
  assert.ok(body.includes('AGPL-3.0-only / NOTICE / original credits'))
  assert.ok(body.includes('Historical 1.19 notes stay unchanged.'))
  assert.ok(body.includes('git clone --branch v1.20.0'))
  assert.equal(renderHomepage(body, release, expected), body)
})

test('refuses draft, wrong source, missing or substituted installers, and invalid notes', () => {
  for (const changed of [
    { draft: true }, { prerelease: true }, { target_commitish: 'c'.repeat(40) },
    { assets: release.assets.slice(1) }, { body: '' },
    { assets: release.assets.map(a => ({ ...a, browser_download_url: 'https://example.com/file' })) },
    { body: '<!-- CURRENT-RELEASE-END -->' }
  ]) assert.throws(() => renderHomepage(readme, { ...release, ...changed }, expected))
})

test('refuses missing, duplicate or reversed markers and version downgrades', () => {
  for (const body of [
    '# No markers', readme + '\n<!-- CURRENT-RELEASE-START -->',
    '<!-- CURRENT-RELEASE-END --><!-- CURRENT-RELEASE-START -->',
    readme.replace('当前正式版本：1.19', '当前正式版本：1.21')
  ]) assert.throws(() => renderHomepage(body, release, expected))
})

function fakeRequest(options = {}) {
  const calls = []
  let latestReads = 0
  const request = (endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (payload) {
      if (options.conflict) throw Error('HTTP 409')
      return { commit: { sha: 'd'.repeat(40) }, content: { path: 'README.md' } }
    }
    if (endpoint.endsWith('/releases/latest')) {
      latestReads++
      return options.notLatest || (options.changedLatest && latestReads === 2)
        ? { id: 21, tag_name: 'v1.21.0' } : release
    }
    if (endpoint.includes('/releases/tags/')) return release
    if (endpoint.includes('/contents/README.md')) return {
      type: 'file', encoding: 'base64', sha,
      content: Buffer.from(options.readme ?? readme, 'utf8').toString('base64')
    }
    return { default_branch: 'product-home' }
  }
  return { request, calls }
}

test('uses actual default branch and exact blob SHA for a README-only write', () => {
  const { request, calls } = fakeRequest()
  const result = synchronizeHomepage(expected, request)
  const writes = calls.filter(call => call.payload)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].endpoint, 'repos/' + repo + '/contents/README.md')
  assert.equal(writes[0].payload.branch, 'product-home')
  assert.equal(writes[0].payload.sha, sha)
  assert.ok(Buffer.from(writes[0].payload.content, 'base64').toString('utf8').includes(release.body))
  assert.equal(result.changed, true)
})

test('does not write when a newer release is already latest or becomes latest', () => {
  for (const options of [{ notLatest: true }, { changedLatest: true }]) {
    const { request, calls } = fakeRequest(options)
    assert.throws(() => synchronizeHomepage(expected, request))
    assert.equal(calls.filter(call => call.payload).length, 0)
  }
})

test('identical documentation is a no-op', () => {
  const { request, calls } = fakeRequest({ readme: renderHomepage(readme, release, expected) })
  assert.equal(synchronizeHomepage(expected, request).changed, false)
  assert.equal(calls.filter(call => call.payload).length, 0)
})

test('does not retry a concurrent README edit', () => {
  const { request, calls } = fakeRequest({ conflict: true })
  assert.throws(() => synchronizeHomepage(expected, request), /HTTP 409/)
  assert.equal(calls.filter(call => call.payload).length, 1)
})

test('rejects any other repository before API calls', () => {
  const { request, calls } = fakeRequest()
  assert.throws(() => synchronizeHomepage({ ...expected, repository: 'other/repo' }, request))
  assert.equal(calls.length, 0)
})
