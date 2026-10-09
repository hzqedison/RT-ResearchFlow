'use strict'

// Hosted transport for the existing structural merge. This never grants release approval.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const producer = require('./seal-private-python-runtime-producer.cjs')
const consumer = require('./materialize-sealed-private-runtime-ci.cjs')
const stage = require('./run-private-runtime-stage-ci.cjs')
const final = require('./run-private-runtime-final-seal-ci.cjs')
const merge = require('./merge-private-runtime-formal-lock.cjs')
const ROOT = path.resolve(__dirname, '..')
const REPOSITORY = 'hzqedison/RT-ResearchFlow'
const REPOSITORY_ID = 1408465497
const RUN = 37955904239
const SOURCE = '07f37ae0baea0c3753fca2bedc7b68f837ff8283'
const POLICY_SHA = '6bca783d423422ff2677ea2288acc8d9384ff6e703225af86aede47f7d01ea58'
const PINS = {
  'win32-x64': { artifactId: 11628386460, jobId: 113906230089, size: 319282594,
    digest: '66037f262cc3827211cd624de5a91dec07397d6fccc811ae9247779e0a8bd51e' },
  'darwin-arm64': { artifactId: 11627483495, jobId: 113906230478, size: 308552769,
    digest: 'a54994f667ce0123a4e0e1490b68bac777f4dc1429c0a58a892c7d06b25e08d5' },
  'darwin-x64': { artifactId: 11628006788, jobId: 113906230364, size: 325917559,
    digest: '9d6babb480fa8bf7d5fa99e6d00ceb1f0a24f04f933acfe668b9474841edfe3a' },
}
function fail(code) { const error = new Error(code); error.code = code; throw error }
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex') }
function options(argv) {
  const result = {}, names = { '--work-root': 'workRoot', '--python': 'python' }
  for (let i = 0; i < argv.length; i += 2) {
    if (!names[argv[i]] || !argv[i + 1] || Object.hasOwn(result, names[argv[i]])) fail('MERGE_HOST_USAGE')
    result[names[argv[i]]] = argv[i + 1]
  }
  if (Object.keys(result).length !== 2 || Object.values(result).some(v => !path.isAbsolute(v))) fail('MERGE_HOST_USAGE')
  return result
}
function pythonCall(python, code, args, work, env) {
  const result = spawnSync(python, ['-X', 'utf8', '-I', '-B', '-c', code, ...args], {
    cwd: work, env: stage.childEnvironment(env, work), shell: false,
    windowsHide: true, timeout: 600000, maxBuffer: 8192,
  })
  if (result.error || result.signal || result.status !== 0) {
    const diagnostic = String(result.stderr || result.error?.message || '').slice(0, 4096)
    process.stderr.write(JSON.stringify({ stage: code === final.PREPARE_ZIP ? 'outer-zip' : 'retained-tree',
      exitCode: result.status, signal: result.signal, diagnostic }) + '\n')
    fail('MERGE_HOST_EXTRACT_FAILED')
  }
}
async function run(args, env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      env.GITHUB_REPOSITORY !== REPOSITORY || !env.GITHUB_TOKEN) fail('MERGE_HOST_CONTEXT')
  const temporary = fs.realpathSync(env.RUNNER_TEMP), work = path.resolve(args.workRoot)
  if (path.dirname(work) !== temporary || !path.basename(work).startsWith('rt-structural-merge-') ||
      fs.existsSync(work)) fail('MERGE_HOST_FRESH_WORK')
  const policyPath = path.join(ROOT, 'resources/python-runtime/preparation.policy.json')
  if (hash(fs.readFileSync(policyPath)) !== POLICY_SHA) fail('MERGE_HOST_POLICY_CHANGED')
  const authority = producer.githubReader(env.GITHUB_TOKEN), prefix = '/repos/' + REPOSITORY
  const sourceRun = await authority.readJson(prefix + '/actions/runs/' + RUN + '/attempts/1')
  if (sourceRun.id !== RUN || sourceRun.run_attempt !== 1 || sourceRun.status !== 'completed' ||
      sourceRun.conclusion !== 'success' || sourceRun.head_sha !== SOURCE ||
      sourceRun.repository?.id !== REPOSITORY_ID || sourceRun.head_repository?.id !== REPOSITORY_ID ||
      sourceRun.path !== '.github/workflows/private-runtime-prepare-native.yml') fail('MERGE_HOST_PRODUCER')
  fs.mkdirSync(work)
  const targets = [], origins = []
  for (const [target, pin] of Object.entries(PINS)) {
    const artifact = await authority.readJson(prefix + '/actions/artifacts/' + pin.artifactId)
    const job = await authority.readJson(prefix + '/actions/jobs/' + pin.jobId)
    if (artifact.id !== pin.artifactId || artifact.expired !== false ||
        artifact.name !== 'private-runtime-prepare-' + target || artifact.size_in_bytes !== pin.size ||
        artifact.digest !== 'sha256:' + pin.digest || artifact.workflow_run?.id !== RUN ||
        artifact.workflow_run?.head_sha !== SOURCE || artifact.workflow_run?.repository_id !== REPOSITORY_ID ||
        artifact.workflow_run?.head_repository_id !== REPOSITORY_ID ||
        job.id !== pin.jobId || job.run_id !== RUN || job.status !== 'completed' || job.conclusion !== 'success' ||
        !job.name.startsWith('native-prepare (' + target + ',')) fail('MERGE_HOST_ARTIFACT_ORIGIN')
    const input = path.join(work, target), proof = path.join(input, 'proof'), retained = path.join(input, 'retained')
    fs.mkdirSync(input); fs.mkdirSync(proof); fs.mkdirSync(retained)
    const archivePath = path.join(input, 'candidate.zip')
    console.log('stage=exact-prepared-artifact-download target=' + target)
    await consumer.downloadArchive(prefix + '/actions/artifacts/' + pin.artifactId + '/zip',
      archivePath, artifact, env, input)
    pythonCall(args.python, final.PREPARE_ZIP, [archivePath, proof], input, env)
    const summary = JSON.parse(fs.readFileSync(path.join(proof, 'summary.json')))
    const payload = path.join(proof, 'native-preparation-candidate.tar.gz')
    const payloadPin = summary.unapprovedNativePayload
    const payloadHash = crypto.createHash('sha256'), fd = fs.openSync(payload, 'r'), buffer = Buffer.alloc(1024 * 1024)
    try { let n; while ((n = fs.readSync(fd, buffer)) > 0) payloadHash.update(buffer.subarray(0, n)) }
    finally { fs.closeSync(fd) }
    if (summary.target !== target || summary.sourceCommit !== SOURCE || String(summary.runId) !== String(RUN) ||
        summary.prepareExit !== 0 || summary.sourceAfterExit !== 0 ||
        payloadPin?.filename !== path.basename(payload) || payloadPin.rawInputAssets !== false ||
        payloadPin.assetsRootIncluded !== false || fs.statSync(payload).size !== payloadPin.size ||
        payloadHash.digest('hex') !== payloadPin.sha256) fail('MERGE_HOST_PAYLOAD_BINDING')
    pythonCall(args.python, stage.EXTRACT, [payload, retained], input, env)
    targets.push({ target, archivePath, archiveSize: pin.size, archiveSha256: pin.digest,
      artifactId: pin.artifactId, jobId: pin.jobId,
      candidateLockPath: path.join(retained, 'prepare/candidate-lock.json'),
      fragmentPath: path.join(retained, 'prepare/candidate-fragment.json'),
      handoffPath: path.join(retained, 'handoff.json'),
      treeRoot: path.join(retained, 'prepare/materialize/tree') })
    origins.push({ target, artifactId: artifact.id, jobId: job.id, archiveSha256: pin.digest,
      sourceCommit: SOURCE, runId: RUN, status: 'verified', releaseEligible: false })
  }
  const indexPath = path.join(work, 'merge-input.json')
  fs.writeFileSync(indexPath, JSON.stringify({ schemaVersion: 1, kind: 'rt-private-runtime-merge-input-v1',
    preparationPolicySha256: POLICY_SHA, sourceCommit: SOURCE, runId: RUN, targets }), { flag: 'wx' })
  const result = merge.run({ indexPath, policyPath, outputRoot: path.join(work, 'output') })
  fs.writeFileSync(path.join(work, 'output/origin-evidence.json'), JSON.stringify({
    kind: 'rt-hosted-structural-merge-origin-v1', structuralOnly: true, releaseEligible: false,
    mergeSourceCommit: env.GITHUB_SHA, preparedSourceCommit: SOURCE, prepareRunId: RUN, origins,
  }, null, 2) + '\n', { flag: 'wx' })
  return result
}
if (require.main === module) run(options(process.argv.slice(2))).then(result => {
  process.stdout.write(JSON.stringify(result) + '\n')
  if (result.status !== 'structurally-merged') process.exitCode = 2
}).catch(error => {
  const code = /^[A-Z][A-Z0-9_]+$/.test(error.code || '') ? error.code : 'MERGE_HOST_FAILED'
  process.stderr.write(JSON.stringify({ status: 'rejected', releaseEligible: false, code }) + '\n')
  process.exitCode = 1
})
module.exports = { options, run, PINS }
