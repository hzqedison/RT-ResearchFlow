'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { verifyCandidateOrigin } = require('./run-private-runtime-stage-ci.cjs')
const repository = 'hzqedison/RT-ResearchFlow'
const source = 'b3994908e75c8cec4a8bbc9b0ab7a230e39db35c'
const runId = 38086414260
const pins = {
  'win32-x64': [11681863167, 114313752780, 319283710, 'edda78761f4266760340e2add86dd1dae41893b5224473755b6e0fa56839a46b', 'windows-latest'],
  'darwin-arm64': [11681947938, 114313752669, 308565305, 'f8b674eab4bcf7e49afc3f0830218c55f7e1e3453ec4b853982e30c3b436d30f', 'macos-15'],
  'darwin-x64': [11682448388, 114313752546, 325921214, '996f5409d96d8b5fc73761a3afb91fb656043304db8646b2184e95c5835e3336', 'macos-15-intel'],
}

// These are isolated transport fixtures, never release authorization or native evidence.
function fixture(target, mutate = () => {}) {
  const [artifactId, jobId, size, digest, runner] = pins[target]
  const run = { id: runId, head_sha: source, status: 'completed', conclusion: 'success', run_attempt: 1,
    path: '.github/workflows/private-runtime-prepare-native.yml', repository: { full_name: repository },
    head_repository: { full_name: repository } }
  const artifact = { id: artifactId, expired: false, name: 'private-runtime-prepare-' + target,
    workflow_run: { id: runId, head_sha: source }, size_in_bytes: size, digest: 'sha256:' + digest }
  const job = { id: jobId, run_id: runId, run_attempt: 1, name: 'native-prepare (' + target + ', ' + runner + ')',
    status: 'completed', conclusion: 'success', head_sha: source }
  mutate({ run, artifact, job })
  const prefix = '/repos/' + repository
  const replies = new Map([[prefix + '/actions/runs/' + runId, run],
    [prefix + '/actions/artifacts/' + artifactId, artifact], [prefix + '/actions/jobs/' + jobId, job]])
  return { coordinates: { prepareRun: runId, prepareArtifact: artifactId, prepareJob: jobId },
    authority: { async readJson(endpoint) { assert.ok(replies.has(endpoint)); return replies.get(endpoint) } } }
}

for (const target of Object.keys(pins)) {
  test('accepts exact fresh origin without claiming archive verification: ' + target, async () => {
    const f = fixture(target)
    const origin = await verifyCandidateOrigin(f.authority, repository, target, f.coordinates)
    assert.equal(origin.sourceCommit, source)
    assert.equal(origin.runId, runId)
    assert.equal(origin.artifactArchiveVerified, false)
  })
}

test('rejects obsolete candidate before transport', async () => {
  await assert.rejects(verifyCandidateOrigin({ readJson() { throw new Error('unexpected transport') } },
    repository, 'win32-x64', { prepareRun: 37974116851, prepareArtifact: 11637518821, prepareJob: 113967912155 }),
  { code: 'STAGE_PREPARE_PIN_MISMATCH' })
})

for (const [name, mutate, code] of [
  ['wrong archive hash', ({ artifact }) => { artifact.digest = 'sha256:' + '0'.repeat(64) }, 'STAGE_CANDIDATE_ORIGIN'],
  ['expired artifact', ({ artifact }) => { artifact.expired = true }, 'STAGE_CANDIDATE_ORIGIN'],
  ['wrong source', ({ run }) => { run.head_sha = '0'.repeat(40) }, 'STAGE_CANDIDATE_ORIGIN'],
  ['failed native job', ({ job }) => { job.conclusion = 'failure' }, 'STAGE_PREPARE_JOB'],
]) {
  test('rejects ' + name, async () => {
    const f = fixture('win32-x64', mutate)
    await assert.rejects(verifyCandidateOrigin(f.authority, repository, 'win32-x64', f.coordinates), { code })
  })
}
