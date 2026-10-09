'use strict'

// Consume the existing final producer result. No candidate flag is promoted.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const producer = require('./seal-private-python-runtime-producer.cjs')
const integration = require('./run-private-runtime-stage-ci.cjs')
const ROOT = path.resolve(__dirname, '..')
const ENTRY = 'scripts/materialize-sealed-private-runtime-ci.cjs'
const WORKFLOW = '.github/workflows/release.yml'
const TARGETS = ['win32-x64', 'darwin-arm64', 'darwin-x64']
const REQUIRED = [ENTRY, WORKFLOW, 'scripts/run-private-runtime-stage-ci.cjs',
  'scripts/private-python-runtime-builder.cjs', 'scripts/bundle-private-python-runtime.cjs',
  'scripts/validate-private-python-runtime.cjs', 'electron-builder.js',
  'electron/main/services/privatePythonRuntimeResolver.ts',
  'electron/main/services/pythonDataSourceBridge.ts', 'electron/shared/privatePythonRuntimeTypes.ts',
  'electron/shared/privatePythonRuntimeManifest.d.cts', 'macos/electron-builder.cjs', 'macos/sign-app.cjs']
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function fail(code) { const error = new Error(code); error.code = code; throw error }
function positive(value) { return /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value)) }
function options(argv) {
  const keys = { '--target': 'target', '--run-id': 'runId', '--artifact-id': 'artifactId', '--python': 'python' }, result = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!keys[argv[i]] || !argv[i + 1] || Object.hasOwn(result, keys[argv[i]])) fail('SEALED_RUNTIME_USAGE')
    result[keys[argv[i]]] = argv[i + 1]
  }
  if (Object.keys(result).length !== 4 || !TARGETS.includes(result.target) || !positive(result.runId) || !positive(result.artifactId)) fail('SEALED_RUNTIME_USAGE')
  result.runId = Number(result.runId)
  result.artifactId = Number(result.artifactId)
  return result
}
function artifactIdForTarget(raw, target) {
  let value
  try { value = JSON.parse(raw) } catch { fail('SEALED_RUNTIME_ARTIFACT_INPUT_REQUIRED') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !TARGETS.includes(target) ||
      Object.keys(value).sort().join(',') !== [...TARGETS].sort().join(',') ||
      TARGETS.some(name => !positive(value[name])) ||
      new Set(TARGETS.map(name => Number(value[name]))).size !== 3) fail('SEALED_RUNTIME_ARTIFACT_INPUT_REQUIRED')
  return Number(value[target])
}
function acceptedResult(result, target) {
  if (!result || result.status !== 'accepted' || result.stage !== 'pre-sign-native-assembly' ||
      result.assemblyTarget !== target || result.releaseEligible !== false ||
      !Array.isArray(result.verifiedProducerTargets) || result.verifiedProducerTargets.length !== 3 ||
      [...result.verifiedProducerTargets].sort().join(',') !== [...TARGETS].sort().join(',') ||
      !Array.isArray(result.outputs) || result.outputs.length !== 1 || result.outputs[0].target !== target ||
      !/^[a-f0-9]{64}$/.test(result.outputs[0].manifestSha256 || '') ||
      !Number.isSafeInteger(result.outputs[0].files) || result.outputs[0].files < 1) fail('FINAL_SEAL_RESULT_REQUIRED')
  return result.outputs[0]
}
async function origin(authority, repository, runId, target, sourceCommit, repositoryId, artifactId) {
  if (!positive(artifactId)) fail('SEALED_RUNTIME_ARTIFACT_INPUT_REQUIRED')
  const prefix = '/repos/' + repository
  const run = await authority.readJson(prefix + '/actions/runs/' + runId)
  if (run.id !== runId || run.path !== WORKFLOW || !['in_progress', 'completed'].includes(run.status) ||
      run.head_sha !== sourceCommit || run.repository?.id !== repositoryId ||
      run.head_repository?.id !== repositoryId || !positive(run.run_attempt)) fail('SEALED_RUNTIME_RUN_MISMATCH')
  const jobs = await authority.readJson(prefix + '/actions/runs/' + runId + '/attempts/' + run.run_attempt + '/jobs?per_page=100')
  if (!Number.isSafeInteger(jobs.total_count) || jobs.total_count > 100 || !Array.isArray(jobs.jobs) ||
      jobs.jobs.length !== jobs.total_count) fail('SEALED_RUNTIME_JOB_LIST')
  const matching = jobs.jobs.filter(row => row.name === 'runtime-seal-' + target)
  if (matching.length !== 1 || !positive(matching[0].id) || matching[0].run_id !== runId ||
      matching[0].run_attempt !== run.run_attempt || matching[0].head_sha !== sourceCommit ||
      matching[0].status !== 'completed' || matching[0].conclusion !== 'success') fail('SEALED_RUNTIME_JOB_NOT_SUCCESSFUL')
  const artifacts = await authority.readJson(prefix + '/actions/runs/' + runId + '/artifacts?per_page=100')
  if (!Number.isSafeInteger(artifacts.total_count) || artifacts.total_count > 100 || !Array.isArray(artifacts.artifacts) ||
      artifacts.artifacts.length !== artifacts.total_count) fail('SEALED_RUNTIME_ARTIFACT_LIST')
  const selected = artifacts.artifacts.filter(row => row.name === 'private-runtime-sealed-' + target)
  if (selected.length !== 1 || !positive(selected[0].id) || selected[0].id !== Number(artifactId) || selected[0].expired ||
      selected[0].workflow_run?.id !== runId || selected[0].workflow_run?.head_sha !== sourceCommit ||
      !/^sha256:[a-f0-9]{64}$/.test(selected[0].digest || '') ||
      !Number.isSafeInteger(selected[0].size_in_bytes) || selected[0].size_in_bytes < 1 ||
      selected[0].size_in_bytes > 2 * 1024 ** 3) fail('SEALED_RUNTIME_ARTIFACT_MISMATCH')
  return { run, job: matching[0], artifact: selected[0] }
}
function downloadArchive(apiPath, filename, artifact, env, work) {
  if (!env.GITHUB_TOKEN || /[\r\n]/.test(env.GITHUB_TOKEN) ||
      !/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/artifacts\/[1-9][0-9]*\/zip$/.test(apiPath)) fail('SEALED_RUNTIME_DOWNLOAD_CONTEXT')
  return new Promise((resolve, reject) => {
    const childEnv = integration.childEnvironment(env, work)
    const config = path.join(work, 'gh-config'); fs.mkdirSync(config)
    Object.assign(childEnv, { GH_TOKEN: env.GITHUB_TOKEN, GH_HOST: 'github.com', GH_CONFIG_DIR: config, GH_PROMPT_DISABLED: '1' })
    const fd = fs.openSync(filename, 'wx'), sha = crypto.createHash('sha256')
    let child, total = 0, stderrBytes = 0, failed = false
    const timer = setTimeout(() => stop('SEALED_RUNTIME_DOWNLOAD_TIMEOUT'), 300000)
    function stop(code) {
      if (failed) return
      failed = true; clearTimeout(timer); child?.kill(); reject(Object.assign(new Error(code), { code }))
    }
    try { child = spawn('gh', ['api', '--method', 'GET', apiPath], { cwd: work, env: childEnv, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { clearTimeout(timer); fs.closeSync(fd); stop('SEALED_RUNTIME_DOWNLOAD_FAILED'); return }
    child.stdout.on('data', chunk => {
      if (failed) return
      total += chunk.length
      if (total > artifact.size_in_bytes) { stop('SEALED_RUNTIME_DOWNLOAD_SIZE'); return }
      try {
        let written = 0
        while (written < chunk.length) written += fs.writeSync(fd, chunk, written, chunk.length - written)
        sha.update(chunk)
      } catch { stop('SEALED_RUNTIME_DOWNLOAD_FAILED') }
    })
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > 8192) stop('SEALED_RUNTIME_DOWNLOAD_FAILED') })
    child.on('error', () => stop('SEALED_RUNTIME_DOWNLOAD_FAILED'))
    child.on('close', (code, signal) => {
      clearTimeout(timer); fs.closeSync(fd)
      if (failed) return
      if (code !== 0 || signal || total !== artifact.size_in_bytes ||
          sha.digest('hex') !== artifact.digest.slice(7)) { stop('SEALED_RUNTIME_ARCHIVE_HASH'); return }
      resolve()
    })
  })
}
const EXTRACT = String.raw`
import pathlib,sys,tarfile,zipfile
archive,work=map(pathlib.Path,sys.argv[1:3]);target=sys.argv[3]
with zipfile.ZipFile(archive) as packed:
 infos=packed.infolist()
 if len(infos)!=2 or {i.filename for i in infos}!={'seal-result.json','sealed-runtime.tar.gz'}:raise ValueError('SEALED_ZIP_MEMBERS')
 for info in infos:
  cap=8*1024**2 if info.filename=='seal-result.json' else 2*1024**3
  if info.flag_bits & 1 or info.file_size>cap:raise ValueError('SEALED_ZIP_BOUND')
  count=0
  with packed.open(info) as source,(work/info.filename).open('xb') as output:
   while chunk:=source.read(1024**2):
    count+=len(chunk)
    if count>cap:raise ValueError('SEALED_ZIP_BOUND')
    output.write(chunk)
  if count!=info.file_size:raise ValueError('SEALED_ZIP_SIZE')
output=work/'extracted';output.mkdir();seen=set();count=0;total=0
def checked(member,destination):
 global count,total
 name=member.name
 if chr(92) in name or name.startswith('/') or any(p in ('','..','.') or ':' in p for p in name.split('/')):raise ValueError('SEALED_TAR_PATH')
 if name in seen or (name!=target and not name.startswith(target+'/')):raise ValueError('SEALED_TAR_MEMBER')
 seen.add(name);count+=1;total+=member.size
 if count>150000 or total>8*1024**3:raise ValueError('SEALED_TAR_BOUND')
 if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):raise ValueError('SEALED_TAR_KIND')
 if member.issym():
  link=(output/name).parent/member.linkname
  if not link.resolve().is_relative_to((output/target).resolve()):raise ValueError('SEALED_TAR_LINK')
 if member.islnk() and not (output/member.linkname).resolve().is_relative_to((output/target).resolve()):raise ValueError('SEALED_TAR_LINK')
 filtered=tarfile.data_filter(member,destination)
 return filtered.replace(mode=member.mode & 0o777) if member.isfile() or member.isdir() else filtered
with tarfile.open(work/'sealed-runtime.tar.gz','r:gz') as packed:packed.extractall(output,filter=checked)
if not (output/target/'manifest.json').is_file():raise ValueError('SEALED_MANIFEST_MISSING')
`
async function run(args, env = process.env) {
  const pins = producer.protectedPins(env)
  if (args.target !== process.platform + '-' + process.arch || env.SOURCE_SHA !== env.GITHUB_SHA) fail('SEALED_RUNTIME_NATIVE_SOURCE')
  const authority = producer.githubReader(env.GITHUB_TOKEN)
  const authorization = await producer.readAuthorization(pins, authority), trust = authorization.trustedContext
  if (trust.approvedSourceCommit !== env.SOURCE_SHA || authorization.consumer?.workflowPath !== WORKFLOW ||
      REQUIRED.some(name => !trust.requiredSourceFiles?.includes(name))) fail('SEALED_RUNTIME_EXECUTION_SOURCE_REQUIRED')
  const sealPath = 'scripts/seal-private-python-runtime.cjs'
  const bytes = fs.readFileSync(path.join(ROOT, sealPath))
  if (hash(bytes) !== authorization.entrypoints?.[sealPath]) fail('SEALED_RUNTIME_SEAL_SOURCE')
  const loadSeal = producer.verifiedLoader(ROOT, new Map([[sealPath, authorization.entrypoints[sealPath]]]))
  const seal = loadSeal(sealPath), proof = await integration.sourceProof(authorization, authority)
  const source = await seal.verifySourceAuthority(trust, proof, ROOT, authority)
  const current = await authority.readJson('/repos/' + pins.repository + '/actions/runs/' + env.GITHUB_RUN_ID + '/attempts/' + env.GITHUB_RUN_ATTEMPT)
  if (current.id !== Number(env.GITHUB_RUN_ID) || current.run_attempt !== Number(env.GITHUB_RUN_ATTEMPT) ||
      current.repository?.id !== pins.repositoryId || current.head_repository?.id !== pins.repositoryId ||
      current.head_sha !== env.SOURCE_SHA || current.path !== WORKFLOW ||
      !authorization.consumer.allowedEvents?.includes(current.event)) fail('SEALED_RUNTIME_RELEASE_RUN')
  const found = await origin(authority, pins.repository, args.runId, args.target, env.SOURCE_SHA, pins.repositoryId, args.artifactId)
  const temporary = fs.realpathSync(env.RUNNER_TEMP), work = fs.mkdtempSync(path.join(temporary, 'rt-sealed-consume-'))
  const zip = path.join(work, 'artifact.zip')
  await downloadArchive('/repos/' + pins.repository + '/actions/artifacts/' + found.artifact.id + '/zip', zip, found.artifact, env, work)
  const extract = spawnSync(args.python, ['-X', 'utf8', '-I', '-B', '-c', EXTRACT, zip, work, args.target],
    { cwd: work, env: integration.childEnvironment(env, work), shell: false, windowsHide: true, timeout: 180000, maxBuffer: 8192 })
  if (extract.error || extract.signal || extract.status !== 0) fail('SEALED_RUNTIME_EXTRACT_FAILED')
  const raw = fs.readFileSync(path.join(work, 'seal-result.json'))
  if (raw.length > 8 * 1024 * 1024) fail('FINAL_SEAL_RESULT_REQUIRED')
  const accepted = acceptedResult(JSON.parse(raw), args.target)
  const load = producer.verifiedLoader(ROOT, source.verified)
  const { validate } = load('scripts/validate-private-python-runtime.cjs')
  const { validateBootstrap } = load('scripts/private-python-runtime-builder.cjs')
  const runtimeRoot = path.join(work, 'extracted', args.target)
  const validated = validate(runtimeRoot, args.target), boot = validateBootstrap(runtimeRoot, args.target)
  if (validated.manifestSha256 !== accepted.manifestSha256 || validated.files !== accepted.files ||
      boot.manifest.sourceLockSha256 !== authorization.stagingInputs?.[args.target]?.formalLockSha256 ||
      boot.manifest.preparationPolicySha256 !== trust.approvedPolicySha256) fail('SEALED_RUNTIME_MANIFEST_BINDING')
  const bundles = path.join(ROOT, 'resources/python-runtime/bundles'), destination = path.join(bundles, args.target)
  if (fs.existsSync(destination)) fail('SEALED_RUNTIME_OUTPUT_EXISTS')
  fs.mkdirSync(bundles, { recursive: true })
  fs.renameSync(runtimeRoot, destination)
  validateBootstrap(destination, args.target)
  return { status: 'materialized', target: args.target, manifestSha256: validated.manifestSha256,
    sourceCommit: env.SOURCE_SHA, sealRunId: args.runId, sealJobId: found.job.id, artifactId: found.artifact.id,
    artifactArchiveSha256: found.artifact.digest.slice(7), artifactArchiveVerified: true,
    finalProducerStage: 'pre-sign-native-assembly', releaseEligible: false, installerTested: false }
}
if (require.main === module) {
  run(options(process.argv.slice(2))).then(value => process.stdout.write(JSON.stringify(value) + '\n')).catch(error => {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error.code || '') ? error.code : 'SEALED_RUNTIME_CONSUME_FAILED'
    process.stderr.write(JSON.stringify({ status: 'pending', releaseEligible: false, code }) + '\n'); process.exitCode = 1
  })
}
module.exports = { options, artifactIdForTarget, acceptedResult, origin, EXTRACT, run }
