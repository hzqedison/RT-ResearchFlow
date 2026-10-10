'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { verifyCandidateOrigin } = require('./run-private-runtime-stage-ci.cjs')
const repository = 'hzqedison/RT-ResearchFlow'
const source = 'b91f91ce65fe8bc20e150b770128b62a5fccb98d'
const runId = 38031520327
const pins = {
  'win32-x64': [11661764973, 114153275620, 319285064, 'f49fdd9223c95313e82f79b8a4a14f9b19506d7e1d9703761f11c949b071c837', 'windows-latest'],
  'darwin-arm64': [11661924798, 114153275775, 308560677, '8264afe0373c793193f3fda76b7fe1d57abf4baf827188ac2742ebba220ce5f9', 'macos-15'],
  'darwin-x64': [11662865031, 114153275888, 325913545, 'af0d439c901a6376618777f9927f656b893fe6b4230a9798d7e47eb785786a83', 'macos-15-intel'],
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
