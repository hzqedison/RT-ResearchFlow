import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const repository = 'hzqedison/RT-ResearchFlow'
const start = '<!-- CURRENT-RELEASE-START -->'
const end = '<!-- CURRENT-RELEASE-END -->'
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function renderHomepage(readme, release, expected) {
  const { version, sourceCommit } = expected
  if (!versionPattern.test(version) || !/^[a-f0-9]{40}$/.test(sourceCommit)) throw Error('INVALID_RELEASE_IDENTITY')
  const tag = 'v' + version
  const releaseUrl = 'https://github.com/' + repository + '/releases/tag/' + tag
  if (release.tag_name !== tag || release.target_commitish !== sourceCommit ||
      release.draft !== false || release.prerelease !== false || release.html_url !== releaseUrl) {
    throw Error('RELEASE_NOT_PUBLIC_OR_SOURCE_MISMATCH')
  }
  if (typeof readme !== 'string' || Buffer.byteLength(readme) > 256 * 1024 ||
      readme.split(start).length !== 2 || readme.split(end).length !== 2 ||
      readme.indexOf(start) >= readme.indexOf(end)) throw Error('HOMEPAGE_MARKERS_INVALID')
  const current = readme.slice(readme.indexOf(start), readme.indexOf(end)).match(/当前正式版本：[ \t]*(\d+)\.(\d+)(?:\.(\d+))?/)
  if (current) {
    const oldParts = [current[1], current[2], current[3] ?? '0'].map(Number)
    const newParts = version.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
      if (oldParts[i] > newParts[i]) throw Error('HOMEPAGE_DOWNGRADE_REFUSED')
      if (oldParts[i] < newParts[i]) break
    }
  }
  const notes = release.body
  if (typeof notes !== 'string' || !notes.trim() || Buffer.byteLength(notes) > 64 * 1024 ||
      notes.includes(start) || notes.includes(end)) throw Error('RELEASE_NOTES_INVALID')
  const packages = [
    ['Windows x64', 'RT-ResearchFlow-Setup-' + version + '-x64.exe'],
    ['Mac Apple Silicon', 'RT-ResearchFlow-macOS-' + version + '-arm64.dmg'],
    ['Mac Intel', 'RT-ResearchFlow-macOS-' + version + '-x64.dmg']
  ]
  const downloads = packages.map(([label, name]) => {
    const matches = (release.assets ?? []).filter(asset => asset.name === name)
    const url = 'https://github.com/' + repository + '/releases/download/' + tag + '/' + name
    if (matches.length !== 1 || matches[0].state !== 'uploaded' || !(matches[0].size > 0) ||
        matches[0].browser_download_url !== url) throw Error('RELEASE_INSTALLER_MISSING')
    return '- [' + label + ' 安装包](' + url + ')'
  })
  const displayVersion = version.endsWith('.0') ? version.slice(0, -2) : version
  const block = [
    start, '## 当前正式版本：' + displayVersion, '',
    '同一产品，按系统和芯片选择安装包；无需再解压源码压缩包。', '',
    ...downloads, '',
    '[发布说明与验收范围](' + releaseUrl + ') · [对应版本源码](https://github.com/' + repository + '/tree/' + tag + ')', '',
    '<details>', '<summary>本版本更新与使用限制</summary>', '', notes.trim(), '', '</details>', '',
    '以下旧版本说明保留为历史记录；当前下载以上方正式版本为准。开发候选不作为正式发布。',
    end
  ].join('\n')
  let result = readme.slice(0, readme.indexOf(start)) + block + readme.slice(readme.indexOf(end) + end.length)
  result = result.replace(/\*\*当前正式版本为 [\d.]+，直接下载链接见本文顶部。/g,
    '**当前正式版本为 ' + displayVersion + '，直接下载链接见本文顶部。')
  result = result.replace(/git clone --branch v\d+\.\d+\.\d+ https:\/\/github\.com\/hzqedison\/RT-ResearchFlow\.git/g,
    'git clone --branch ' + tag + ' https://github.com/' + repository + '.git')
  result = result.replace(/正式版本源码见 \[v\d+\.\d+\.\d+ 标签\]\(https:\/\/github\.com\/hzqedison\/RT-ResearchFlow\/tree\/v\d+\.\d+\.\d+\)/g,
    '正式版本源码见 [' + tag + ' 标签](https://github.com/' + repository + '/tree/' + tag + ')')
  return result
}

export function synchronizeHomepage(expected, request) {
  if (expected.repository !== repository || !versionPattern.test(expected.version)) throw Error('REPOSITORY_OR_VERSION_INVALID')
  const base = 'repos/' + repository
  const release = request(base + '/releases/tags/v' + expected.version)
  const latest = request(base + '/releases/latest')
  if (!release.id || latest.id !== release.id || latest.tag_name !== release.tag_name) throw Error('RELEASE_IS_NOT_LATEST')
  const repo = request(base)
  if (typeof repo.default_branch !== 'string' || !repo.default_branch) throw Error('DEFAULT_BRANCH_MISSING')
  const endpoint = base + '/contents/README.md'
  const file = request(endpoint + '?ref=' + encodeURIComponent(repo.default_branch))
  if (file.type !== 'file' || file.encoding !== 'base64' || !/^[a-f0-9]{40}$/.test(file.sha)) throw Error('README_RESPONSE_INVALID')
  const before = Buffer.from(file.content, 'base64').toString('utf8')
  const after = renderHomepage(before, release, expected)
  if (after === before) return { changed: false, version: expected.version, branch: repo.default_branch }
  const stillLatest = request(base + '/releases/latest')
  if (stillLatest.id !== release.id || stillLatest.tag_name !== release.tag_name) throw Error('LATEST_RELEASE_CHANGED')
  const response = request(endpoint, {
    message: 'docs: synchronize product homepage with released ' + expected.version,
    branch: repo.default_branch,
    sha: file.sha,
    content: Buffer.from(after, 'utf8').toString('base64')
  })
  if (!response.commit?.sha || response.content?.path !== 'README.md') throw Error('HOMEPAGE_UPDATE_NOT_CONFIRMED')
  return { changed: true, version: expected.version, branch: repo.default_branch, commit: response.commit.sha }
}

function githubRequest(endpoint, payload) {
  const args = ['api', endpoint]
  if (payload) args.push('--method', 'PUT', '--input', '-')
  const result = spawnSync('gh', args, {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    input: payload ? JSON.stringify(payload) : undefined
  })
  if (result.error || result.status !== 0) throw Error(result.error?.message || result.stderr || 'GITHUB_API_FAILED')
  return JSON.parse(result.stdout)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    console.log(JSON.stringify(synchronizeHomepage({
      repository: process.env.REPOSITORY,
      version: process.env.RELEASE_VERSION,
      sourceCommit: process.env.SOURCE_COMMIT
    }, githubRequest)))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
