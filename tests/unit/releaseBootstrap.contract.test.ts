import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// One source read; no YAML dependency, API, subprocess, ref or release mutation.
const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8').replaceAll('\r\n', '\n')
const expectedBootstrapTags = {
  'refs/heads/codex/release-1.3': 'v1.3.0',
  'refs/heads/codex/release-1.6': 'v1.6.0',
}

function requiredMatch(text: string, pattern: RegExp): RegExpMatchArray {
  const match = text.match(pattern)
  if (!match) throw new Error(`Missing release contract: ${pattern.source}`)
  return match
}

function step(name: string): string {
  const marker = `      - name: ${name}\n`
  const start = workflow.indexOf(marker)
  if (start < 0) throw new Error(`Missing release step: ${name}`)
  const rest = workflow.slice(start)
  const next = rest.slice(marker.length).search(/\n      - (?:name:|uses:)/)
  return next < 0 ? rest : rest.slice(0, marker.length + next)
}

const prepare = step('Reject published versions and pin the authorized source commit')
const draft = step('Create or resume only this tested draft; upload without overwriting')
const assemble = step('Verify all native jobs, source provenance and same-byte installers')
const readback = step('Download draft attachments and verify every uploaded byte before publishing')
const seal = step('Seal tested bytes and zero-skipped installation evidence')
const lockExpression = requiredMatch(workflow, /^  group: release-\$\{\{ (.+) \}\}$/m)[1]
const tagExpression = requiredMatch(workflow, /^  RELEASE_TAG: \$\{\{ (.+) \}\}$/m)[1]

function tagFor(expression: string, eventName: string, ref: string, requestedTag = ''): string {
  const github = { event_name: eventName, ref, ref_name: ref.replace(/^refs\/(heads|tags)\//, ''), event: { inputs: { release_tag: requestedTag } } }
  return new Function('github', `return (${expression});`)(github) as string
}

// Execute only the extracted pure authorization clauses. The script bodies
// that access GitHub/fs/gh are never executed, not even through fake services.
const prepareAuthorization = prepare.slice(prepare.indexOf('const build ='), prepare.indexOf('// Check public releases'))
function authorize(ref: string, tag: string, eventName = 'push', deleted = false): { build: boolean; bootstrap: boolean } {
  return new Function('context', 'tag', `${prepareAuthorization}\nreturn { build, bootstrap };`)(
    { eventName, ref, payload: { deleted } }, tag,
  ) as { build: boolean; bootstrap: boolean }
}

const draftAuthorization = draft.slice(draft.indexOf('const bootstrapTags ='), draft.indexOf('async function assertTag()'))
function mayCreateMissingTag(ref: string, tag: string, eventName = 'push'): boolean {
  return new Function('context', 'tag', `${draftAuthorization}\nreturn bootstrap;`)({ eventName, ref }, tag) as boolean
}

const reuseCondition = requiredMatch(prepare, /if \((original\.event[\s\S]*?)\) \{\n/)[1]
function mayReuse(headBranch: string, tag: string, override: Record<string, unknown> = {}): boolean {
  const original = { event: 'push', status: 'completed', head_sha: 'tested-source-sha',
    workflow_id: 42, path: '.github/workflows/release.yml', head_branch: headBranch, ...override }
  return new Function('original', 'current', 'sha', 'tag', 'bootstrapTags', `return !(${reuseCondition});`)(
    original, { workflow_id: 42 }, 'tested-source-sha', tag, expectedBootstrapTags,
  ) as boolean
}

function retain(text: string, guards: string[]): void {
  for (const guard of guards) expect(text).toContain(guard)
}

describe('bounded release bootstrap authorization', () => {
  it('adds only the exact 1.6 branch while preserving the 1.3 branch and tag/dispatch triggers', () => {
    const branches = requiredMatch(workflow, /  push:\n    branches:\n([\s\S]*?)    tags:\n/)[1]
    expect([...branches.matchAll(/^      - '([^']+)'$/gm)].map(match => match[1])).toEqual(['codex/release-1.3', 'codex/release-1.6'])
    expect(branches.trim().split('\n')).toHaveLength(2)
    retain(workflow, ["    tags:\n      - 'v*'", '  workflow_dispatch:', '        required: true', '        default: false'])
  })

  it('uses the same two exact maps for prepare and draft creation', () => {
    const maps = [...workflow.matchAll(/const bootstrapTags = (\{[\s\S]*?\});/g)]
      .map(match => JSON.parse(match[1].replaceAll("'", '"').replace(/,\s*\}/, '}')) as Record<string, string>)
    expect(maps).toEqual([expectedBootstrapTags, expectedBootstrapTags])
    expect(lockExpression).toBe(tagExpression)
  })

  it.each(Object.entries(expectedBootstrapTags))('maps %s to only %s in the tag, lock and both authorization stages', (ref, tag) => {
    expect(tagFor(tagExpression, 'push', ref)).toBe(tag)
    expect(tagFor(lockExpression, 'push', ref)).toBe(tag)
    expect(authorize(ref, tag)).toEqual({ build: true, bootstrap: true })
    expect(mayCreateMissingTag(ref, tag)).toBe(true)
  })

  it.each([
    ['refs/heads/codex/release-1.3', 'v1.6.0'],
    ['refs/heads/codex/release-1.6', 'v1.3.0'],
    ['refs/heads/codex/release-1.6', 'v1.6.1'],
    ['refs/heads/codex/release-1.6', 'v1.6.0-beta.1'],
    ['refs/heads/codex/release-1.3', 'v1.3.0-beta.1'],
  ])('rejects cross-version/bootstrap tag mismatch %s / %s', (ref, tag) => {
    expect(() => authorize(ref, tag)).toThrow('Branch bootstrap must match its exact authorized tag.')
    expect(mayCreateMissingTag(ref, tag)).toBe(false)
  })

  it.each(['refs/heads/main', 'refs/heads/codex/release-1.4', 'refs/heads/codex/release-1.6-extra',
    'refs/heads/codex/release-1.60', 'refs/heads/codex/release-1.6/other', 'refs/heads/other/release-1.6'])('never authorizes an arbitrary bootstrap branch %s', ref => {
    expect(tagFor(tagExpression, 'push', ref)).not.toBe('v1.6.0')
    expect(() => authorize(ref, 'v1.6.0')).toThrow('Only existing release tags')
    expect(mayCreateMissingTag(ref, 'v1.6.0')).toBe(false)
  })

  it.each(['v1.3.0', 'v1.3.0-beta.1', 'v1.6.0', 'v1.6.0-beta.1'])('preserves normal tag builds and publish-only recovery for %s', tag => {
    expect(authorize('refs/tags/' + tag, tag)).toEqual({ build: true, bootstrap: false })
    expect(tagFor(tagExpression, 'push', 'refs/tags/' + tag)).toBe(tag)
    expect(tagFor(lockExpression, 'workflow_dispatch', 'refs/heads/codex/release-1.6', tag)).toBe(tag)
    expect(tagFor(tagExpression, 'workflow_dispatch', 'refs/heads/main', tag)).toBe(tag)
    expect(authorize('refs/heads/main', tag, 'workflow_dispatch')).toEqual({ build: false, bootstrap: false })
    expect(mayCreateMissingTag('refs/heads/codex/release-1.6', tag, 'workflow_dispatch')).toBe(false)
  })

  it.each(Object.entries(expectedBootstrapTags))('rejects a deleted bootstrap ref %s', (ref, tag) => {
    expect(() => authorize(ref, tag, 'push', true)).toThrow('Only existing release tags')
  })

  it.each([
    ['codex/release-1.3', 'v1.3.0', true], ['codex/release-1.6', 'v1.6.0', true],
    ['v1.3.0', 'v1.3.0', true], ['v1.6.0', 'v1.6.0', true],
    ['v1.3.0-beta.1', 'v1.3.0-beta.1', true], ['v1.6.0-beta.1', 'v1.6.0-beta.1', true],
    ['codex/release-1.3', 'v1.6.0', false], ['codex/release-1.6', 'v1.3.0', false],
    ['codex/release-1.6', 'v1.6.0-beta.1', false], ['main', 'v1.6.0', false],
    ['codex/release-1.6-extra', 'v1.6.0', false],
  ] as const)('original run branch/tag pair %s / %s authorizes recovery: %s', (branch, tag, accepted) => {
    expect(mayReuse(branch, tag)).toBe(accepted)
  })

  it.each([{ event: 'workflow_dispatch' }, { status: 'in_progress' }, { head_sha: 'another-sha' },
    { workflow_id: 99 }, { path: '.github/workflows/other.yml' }])('rejects recovery if original run provenance differs: %j', override => {
    expect(mayReuse('codex/release-1.6', 'v1.6.0', override)).toBe(false)
  })
})

describe('release safety gates remain mandatory', () => {
  it('keeps published versions immutable and pins the source/tag without force-moving refs', () => {
    retain(prepare, [
      "if (process.env.GH_REPO !== 'hzqedison/RT-ResearchFlow')",
      "if (!semver.test(tag)) throw new Error('Only stable SemVer and beta.N tags are accepted.')",
      'if (matches.length > 1)', 'if (matches.some(release => !release.draft))',
      'Published versions are immutable; use a new version.',
      'if (error.status !== 404 || !bootstrap) throw error;',
      "if (object && object.type !== 'commit')", 'const sha = bootstrap ? context.sha : object.sha;',
      'if (bootstrap && object && object.sha !== sha)',
      'if (build && !bootstrap && context.sha !== sha && context.sha !== ref.object.sha)',
      String.raw`if (!/^[1-9]\d*$/.test(runId || '') || !Number.isSafeInteger(Number(runId)))`,
      'if (!release.body?.includes(marker))',
    ])
    retain(draft, [
      'if (error.status !== 404 || !bootstrap || context.sha !== process.env.SOURCE_SHA) throw error;',
      "ref: 'refs/tags/' + tag, sha: process.env.SOURCE_SHA",
      'if (creationError.status !== 422) throw creationError;',
      "if (object.type !== 'commit' || object.sha !== process.env.SOURCE_SHA)",
      '!release.draft || release.prerelease !== prerelease || !release.body?.includes(marker)',
      'await assertTag();', 'draft: true, prerelease, make_latest:',
    ])
    expect(workflow).not.toMatch(/github\.rest\.git\.(?:updateRef|deleteRef)\b|\bforce\s*:\s*true|['"]--clobber['"]/)
  })

  it('keeps same-source/same-workflow reuse, version/identity/notes validation and a draft-by-default publication', () => {
    retain(prepare, ["original.event !== 'push'", "original.status !== 'completed'",
      'original.head_sha !== sha', 'original.workflow_id !== current.workflow_id',
      "original.path !== '.github/workflows/release.yml'", 'original.head_branch !== tag',
      "bootstrapTags['refs/heads/' + original.head_branch] !== tag"])
    retain(step('Validate tag, version, product identity and notes'), [
      "if (pkg.version !== version) throw new Error('Tag/package version mismatch.')",
      "pkg.name !== 'rt-research-flow'", "config.appId !== 'com.tradewatcher.app'",
      "config.productName !== 'RT-ResearchFlow'", 'config.nsis.deleteAppDataOnUninstall !== false',
      'config.nsis.perMachine !== false', "config.nsis.include !== 'resources/installer.nsh'",
      "fs.statSync('docs/releases/v' + version + '.md').isFile()",
    ])
    retain(workflow, ["if: needs.prepare.outputs.build_required == 'true'",
      "(needs.prepare.outputs.build_required == 'false' || needs.build.result == 'success')",
      "PUBLISH_RELEASE: ${{ github.event_name == 'workflow_dispatch' && inputs.publish }}", 'persist-credentials: false'])
    retain(readback, ["if (process.env.PUBLISH_RELEASE === 'true')", "make_latest: 'false'"])
  })

  it('declares Python 3.13 and the matrix architecture before full verification, using the selected system interpreter', () => {
    const python = step('Set up native Python for the full source verification')
    retain(python, ['id: python', 'uses: actions/setup-python@v5', "python-version: '3.13'", 'architecture: ${{ matrix.arch }}'])
    const verify = step('Verify pinned release source')
    retain(verify, ['DATA_SOURCE_NATIVE_PYTHON: ${{ steps.python.outputs.python-path }}',
      "DATA_SOURCE_NATIVE_PYTHON_VERSION: '3.13'", 'DATA_SOURCE_NATIVE_ARCH: ${{ matrix.arch }}', 'run: pnpm run verify'])
    expect(workflow.indexOf(python)).toBeLessThan(workflow.indexOf(step('Install pinned native dependencies')))
    expect(workflow.indexOf(python)).toBeLessThan(workflow.indexOf(verify))
    retain(workflow, ['runner: windows-latest\n            platform: windows\n            arch: x64\n            tests: 2',
      'runner: macos-15\n            platform: macos\n            arch: arm64\n            tests: 3',
      'runner: macos-15-intel\n            platform: macos\n            arch: x64\n            tests: 3',
      "node-version: '20'", 'version: 10.14.0', 'pnpm install --frozen-lockfile --config.side-effects-cache=false'])
  })

  it('preserves all three native builds, installed smoke suites and synthetic-data reinstall evidence', () => {
    retain(workflow, [
      "process.env.RUNNER_ENVIRONMENT !== 'github-hosted'", 'process.arch !== process.env.RELEASE_ARCH',
      "process.platform !== (process.env.RELEASE_PLATFORM === 'windows' ? 'win32' : 'darwin')",
      'ref: ${{ needs.prepare.outputs.source_sha }}', '--config.nsis.runAfterFinish=false --publish never',
      'run: node macos/build.mjs', 'run: node --test macos/sync-upstream.test.mjs',
      'rt-release-installed', 'codesign --verify --deep --strict', 'lipo -archs',
      'test "$actual_macho_arch" = "$expected_macho_arch"',
      'tests/e2e/packaged-app-smoke.spec.ts tests/e2e/windows-integrated-app.spec.ts --workers=1 --retries=0 --reporter=line,json',
      'tests/e2e/macos-app-smoke.spec.ts tests/e2e/quant-trading-onboarding.spec.ts tests/e2e/mac-ths-experiment.spec.ts --workers=1 --retries=0 --reporter=line,json',
      'Reinstall changed or removed persisted synthetic CI data.',
      './.github/scripts/Test-PublicBoundary.ps1 -ArtifactDirectory release',
    ])
    retain(seal, ['report.stats.expected !== count', 'report.stats.unexpected !== 0',
      'report.stats.flaky !== 0', 'report.stats.skipped !== 0', 'report.errors?.length',
      "spec.tests[0].results[0].status !== 'passed'", 'hash !== process.env.INSTALLER_SHA256',
      'runId: process.env.GITHUB_RUN_ID, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT)',
      'sourceSha: process.env.SOURCE_SHA', 'windowsSameDirectoryReinstall:'])
  })

  it('preserves attempt-specific manifest provenance, hashes and immutable tested artifact reuse', () => {
    retain(assemble, [
      "['windows', 'x64', 2,", "['macos', 'arm64', 3,", "['macos', 'x64', 3,",
      'JSON.stringify(files) !== JSON.stringify(allowed)', "proof.schema !== 'rt-release-pipeline-v1'",
      'proof.tag !== process.env.RELEASE_TAG', 'proof.version !== version', 'proof.sourceSha !== process.env.SOURCE_SHA',
      'proof.runId !== process.env.TESTED_RUN_ID', 'proof.platform !== platform', 'proof.arch !== arch',
      'proof.installer !== name', 'proof.installed !== true', '!Number.isSafeInteger(proof.runAttempt)',
      'proof.tests?.passed !== count', 'proof.tests?.skipped !== 0', 'proof.tests?.failed !== 0', 'proof.tests?.flaky !== 0',
      'proof.windowsSameDirectoryReinstall !== true', 'JSON.stringify(basenames)',
      'github.rest.actions.listJobsForWorkflowRunAttempt', "job.status !== 'completed' || job.conclusion !== 'success'",
      'job.head_sha !== process.env.SOURCE_SHA', 'bytes.length !== proof.size || hash !== proof.sha256',
      "fs.readFileSync(directory + '/SHA256SUMS.txt', 'ascii') !== sum",
    ])
    retain(workflow, ['overwrite: false', 'name: release-${{ env.RELEASE_TAG }}-windows-x64',
      'name: release-${{ env.RELEASE_TAG }}-macos-arm64', 'name: release-${{ env.RELEASE_TAG }}-macos-x64',
      'run-id: ${{ needs.prepare.outputs.tested_run_id }}'])
  })

  it('never publishes before all uploaded bytes and final tag/draft/asset identities have been rechecked', () => {
    retain(readback, [
      'assets.length !== files.length', 'new Set(assets.map(asset => asset.name)).size !== files.length',
      "asset.state !== 'uploaded'", "['release', 'download', tag, '--dir', downloaded]",
      'expected.length !== actual.length || asset.size !== actual.length || hash(expected) !== hash(actual)',
      "asset.digest && asset.digest !== 'sha256:' + hash(actual)",
      "object.type !== 'commit' || object.sha !== process.env.SOURCE_SHA",
      'release.tag_name !== tag || !release.draft || !release.body?.includes(marker)',
      "release.prerelease !== (process.env.RELEASE_PRERELEASE === 'true')",
      'JSON.stringify(identities(assets)) !== JSON.stringify(identities(finalAssets))',
      'github.rest.repos.updateRelease', 'release_id: id, draft: false',
    ])
    expect(readback.indexOf('JSON.stringify(identities(assets))')).toBeLessThan(readback.indexOf('github.rest.repos.updateRelease'))
  })
})
