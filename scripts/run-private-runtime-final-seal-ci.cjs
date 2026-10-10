'use strict'

// Transport and compose the existing final producer inputs. No approval is minted.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const producer = require('./seal-private-python-runtime-producer.cjs')
const stage = require('./run-private-runtime-stage-ci.cjs')
const consumer = require('./materialize-sealed-private-runtime-ci.cjs')
const ROOT = path.resolve(__dirname, '..')
const ENTRY = 'scripts/run-private-runtime-final-seal-ci.cjs'
const WORKFLOW = '.github/workflows/release.yml'
const STAGE_WORKFLOW = '.github/workflows/private-runtime-stage-native.yml'
const TARGETS = ['win32-x64', 'darwin-arm64', 'darwin-x64']
const MEMBERS = { candidateLock: 'candidate-lock.json', fragment: 'candidate-fragment.json',
  handoff: 'handoff.json', nativeReport: 'native-bootstrap-report.json' }
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const positive = value => /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value))
function fail(code) { const error = new Error(code); error.code = code; throw error }
function read(filename, cap = 16 * 1024 * 1024) {
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > cap) fail('FINAL_INPUT_FILE')
  const bytes = fs.readFileSync(filename)
  if (bytes.length !== stat.size) fail('FINAL_INPUT_CHANGED')
  return bytes
}
function fileHash(filename) {
  const digest = crypto.createHash('sha256'), fd = fs.openSync(filename, 'r'), buffer = Buffer.alloc(1024 * 1024)
  try { let n; while ((n = fs.readSync(fd, buffer)) > 0) digest.update(buffer.subarray(0, n)) } finally { fs.closeSync(fd) }
  return digest.digest('hex')
}
async function readObligationsProof(inputs, temporary, authorization, pins, authority) {
  const filename = path.join(inputs, 'obligations-proof.json')
  const pin = authorization.obligationsProof
  // Preserve the existing transported input contract. Missing metadata cannot
  // be inferred from structural receipts, license text or a GitHub login.
  if (pin === undefined) {
    if (!fs.existsSync(filename)) fail('FINAL_OBLIGATIONS_PROOF_MISSING')
    return JSON.parse(read(stage.owned(filename, temporary)))
  }
  // An optional, independently authorized Git object transports real proof.
  // Its commit can follow approvedSourceCommit: reviews refer to that source,
  // so requiring proof to live in that same source commit could self-reference.
  if (!pin || Array.isArray(pin) || !/^[a-f0-9]{40}$/.test(pin.commit || '') ||
      !/^[a-f0-9]{64}$/.test(pin.sha256 || '') || typeof pin.path !== 'string' ||
      pin.path.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part))) fail('FINAL_OBLIGATIONS_PROOF_PIN')
  const prefix = '/repos/' + pins.repository
  const commit = await authority.readJson(prefix + '/git/commits/' + pin.commit)
  if (commit.sha !== pin.commit || !/^[a-f0-9]{40}$/.test(commit.tree?.sha || '')) fail('FINAL_OBLIGATIONS_PROOF_COMMIT')
  const parts = pin.path.split('/'); let tree = commit.tree.sha, member
  for (let index = 0; index < parts.length; index++) {
    const response = await authority.readJson(prefix + '/git/trees/' + tree)
    if (response.sha !== tree || response.truncated === true || !Array.isArray(response.tree)) fail('FINAL_OBLIGATIONS_PROOF_TREE')
    const matches = response.tree.filter(item => item.path === parts[index])
    if (matches.length !== 1) fail('FINAL_OBLIGATIONS_PROOF_MEMBER')
    member = matches[0]
    if (!/^[a-f0-9]{40}$/.test(member.sha || '')) fail('FINAL_OBLIGATIONS_PROOF_MEMBER')
    if (index < parts.length - 1) {
      if (member.type !== 'tree' || member.mode !== '040000') fail('FINAL_OBLIGATIONS_PROOF_MEMBER')
      tree = member.sha
    }
  }
  if (member.type !== 'blob' || !['100644', '100755'].includes(member.mode)) fail('FINAL_OBLIGATIONS_PROOF_MEMBER')
  const blob = await authority.readJson(prefix + '/git/blobs/' + member.sha)
  const encoded = typeof blob.content === 'string' ? blob.content.replace(/[\r\n]/g, '') : ''
  if (blob.sha !== member.sha || blob.encoding !== 'base64' || !encoded || encoded.length > 8 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail('FINAL_OBLIGATIONS_PROOF_BLOB')
  const bytes = Buffer.from(encoded, 'base64')
  const oid = crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')
  if (blob.size !== bytes.length || oid !== member.sha || hash(bytes) !== pin.sha256) fail('FINAL_OBLIGATIONS_PROOF_BYTES')
  // A conflicting downloaded copy must not silently fall back to Git bytes.
  if (fs.existsSync(filename) && !read(stage.owned(filename, temporary)).equals(bytes)) fail('FINAL_OBLIGATIONS_PROOF_CONFLICT')
  return JSON.parse(bytes)
}
function options(argv) {
  const keys = { '--target': 'target', '--formal-inputs': 'formalInputs', '--derived-cache': 'derivedCache',
    '--work-root': 'workRoot', '--python': 'python' }, args = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!keys[argv[i]] || !argv[i + 1] || Object.hasOwn(args, keys[argv[i]])) fail('FINAL_SEAL_USAGE')
    args[keys[argv[i]]] = argv[i + 1]
  }
  if (Object.keys(args).length !== 5 || !TARGETS.includes(args.target)) fail('FINAL_SEAL_USAGE')
  return args
}
async function stageOrigin(authority, pins, trust, root) {
  if (!TARGETS.includes(root?.target) || root.workflowPath !== STAGE_WORKFLOW ||
      root.jobName !== 'formal-native-stage-' + root.target || root.artifactName !== 'private-runtime-native-stage-' + root.target ||
      ![root.runId, root.attempt, root.jobId, root.fragmentArtifactId].every(positive) ||
      !/^[a-f0-9]{64}$/.test(root.artifactArchiveSha256 || '')) fail('FINAL_STAGE_PINS')
  const prefix = '/repos/' + pins.repository
  const run = await authority.readJson(prefix + '/actions/runs/' + root.runId + '/attempts/' + root.attempt)
  const job = await authority.readJson(prefix + '/actions/jobs/' + root.jobId)
  const artifact = await authority.readJson(prefix + '/actions/artifacts/' + root.fragmentArtifactId)
  if (run.id !== Number(root.runId) || run.run_attempt !== Number(root.attempt) || run.head_sha !== trust.approvedSourceCommit ||
      run.path !== STAGE_WORKFLOW || run.repository?.id !== pins.repositoryId || run.head_repository?.id !== pins.repositoryId ||
      run.status !== 'completed' || run.conclusion !== 'success' || !root.allowedEvents?.includes(run.event) ||
      job.id !== Number(root.jobId) || job.run_id !== run.id || job.run_attempt !== run.run_attempt ||
      job.head_sha !== run.head_sha || job.name !== root.jobName || job.status !== 'completed' || job.conclusion !== 'success' ||
      artifact.id !== Number(root.fragmentArtifactId) || artifact.expired || artifact.name !== root.artifactName ||
      artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== run.head_sha ||
      artifact.digest !== 'sha256:' + root.artifactArchiveSha256 || !Number.isSafeInteger(artifact.size_in_bytes) ||
      artifact.size_in_bytes < 1 || artifact.size_in_bytes > 128 * 1024 ** 2) fail('FINAL_STAGE_ORIGIN')
  return artifact
}
async function prepareOrigin(authority, pins, target, origin) {
  if (!origin || ![origin.runId, origin.runAttempt, origin.artifactId, origin.jobId].every(positive) ||
      !/^[a-f0-9]{40}$/.test(origin.sourceCommit || '') || !/^[a-f0-9]{64}$/.test(origin.artifactArchiveSha256 || '')) fail('FINAL_PREPARE_COORDINATES')
  const prefix = '/repos/' + pins.repository
  const run = await authority.readJson(prefix + '/actions/runs/' + origin.runId + '/attempts/' + origin.runAttempt)
  const job = await authority.readJson(prefix + '/actions/jobs/' + origin.jobId)
  const artifact = await authority.readJson(prefix + '/actions/artifacts/' + origin.artifactId)
  const runner = { 'win32-x64': 'windows-latest', 'darwin-arm64': 'macos-15', 'darwin-x64': 'macos-15-intel' }[target]
  if (run.id !== Number(origin.runId) || run.run_attempt !== Number(origin.runAttempt) ||
      run.path !== '.github/workflows/private-runtime-prepare-native.yml' || run.head_sha !== origin.sourceCommit ||
      run.repository?.id !== pins.repositoryId || run.head_repository?.id !== pins.repositoryId ||
      run.status !== 'completed' || run.conclusion !== 'success' || job.id !== Number(origin.jobId) ||
      job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== run.head_sha ||
      job.name !== 'native-prepare (' + target + ', ' + runner + ')' || job.status !== 'completed' || job.conclusion !== 'success' ||
      artifact.id !== Number(origin.artifactId) || artifact.expired || artifact.name !== 'private-runtime-prepare-' + target ||
      artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== run.head_sha ||
      artifact.digest !== 'sha256:' + origin.artifactArchiveSha256 || !Number.isSafeInteger(artifact.size_in_bytes) ||
      artifact.size_in_bytes < 1 || artifact.size_in_bytes > 2 * 1024 ** 3) fail('FINAL_PREPARE_ORIGIN')
  return artifact
}
const PREPARE_ZIP = String.raw`
import pathlib,sys,zipfile
archive,output=map(pathlib.Path,sys.argv[1:]);wanted={'summary.json':4*1024**2,'native-preparation-candidate.tar.gz':2*1024**3}
with zipfile.ZipFile(archive) as packed:
 infos=packed.infolist();seen=set()
 if len(infos)>10000:raise ValueError('ZIP_COUNT')
 for info in infos:
  name=info.filename.rstrip('/')
  if not name or name.startswith('/') or chr(92) in name or any(p in ('','..','.') or ':' in p for p in name.split('/')) or name.casefold() in seen:raise ValueError('ZIP_PATH')
  seen.add(name.casefold())
 for name,cap in wanted.items():
  info=packed.getinfo(name)
  if info.flag_bits&1 or info.file_size>cap:raise ValueError('ZIP_BOUND')
  total=0
  with packed.open(info) as source,(output/name).open('xb') as dest:
   while chunk:=source.read(1024**2):
    total+=len(chunk)
    if total>cap:raise ValueError('ZIP_BOUND')
    dest.write(chunk)
  if total!=info.file_size:raise ValueError('ZIP_SIZE')
`
const PACK = String.raw`
import pathlib,sys,tarfile
root,output=map(pathlib.Path,sys.argv[1:3]);target=sys.argv[3]
if root.name!=target or root.is_symlink():raise ValueError('PACK_ROOT')
def neutral(member):
 member.uid=member.gid=0;member.uname=member.gname='';member.pax_headers={}
 return member
with tarfile.open(output,'w:gz',format=tarfile.PAX_FORMAT,dereference=False) as packed:packed.add(root,arcname=target,filter=neutral)
if output.stat().st_size>2*1024**3:raise ValueError('PACK_BOUND')
`
function pythonCall(python, code, args, work, env, timeout) {
  const result = spawnSync(python, ['-X', 'utf8', '-I', '-B', '-c', code, ...args],
    { cwd: work, env: stage.childEnvironment(env, work), shell: false, windowsHide: true, timeout, maxBuffer: 8192 })
  if (result.error || result.signal || result.status !== 0) fail('FINAL_INPUT_SUBPROCESS_FAILED')
}
function cachedDerived(directory, asset) {
  let count = 0; const found = []
  function walk(root) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (++count > 20000 || entry.isSymbolicLink()) fail('FINAL_DERIVED_CACHE_INVALID')
      const filename = path.join(root, entry.name)
      if (entry.isDirectory()) walk(filename)
      else if (entry.isFile() && entry.name === asset.filename && fs.statSync(filename).size === asset.size && fileHash(filename) === asset.sha256) found.push(filename)
    }
  }
  walk(directory)
  if (found.length > 1) fail('FINAL_DERIVED_DUPLICATE')
  return found[0]
}
async function sealAndArchive(inputPath, env, target, evidence, python, work, validate) {
  // A staged result is never a final seal. The real producer performs every gate.
  const result = await producer.runProducer(inputPath, env, false)
  const accepted = consumer.acceptedResult(result, target)
  const runtime = path.join(ROOT, 'resources/python-runtime/bundles', target)
  const checked = validate(runtime, target)
  if (checked.manifestSha256 !== accepted.manifestSha256 || checked.files !== accepted.files) fail('FINAL_OUTPUT_BINDING')
  fs.mkdirSync(evidence)
  const archive = path.join(evidence, 'sealed-runtime.tar.gz')
  pythonCall(python, PACK, [runtime, archive, target], work, env, 600000)
  const after = validate(runtime, target)
  if (after.manifestSha256 !== accepted.manifestSha256 || after.files !== accepted.files) fail('FINAL_OUTPUT_CHANGED')
  fs.writeFileSync(path.join(evidence, 'seal-result.json'), JSON.stringify(result) + '\n', { flag: 'wx' })
  return result
}
async function run(args, env = process.env) {
  const pins = producer.protectedPins(env)
  if (args.target !== process.platform + '-' + process.arch || env.SOURCE_SHA !== env.GITHUB_SHA) fail('FINAL_NATIVE_SOURCE')
  const temporary = fs.realpathSync(env.RUNNER_TEMP)
  const inputs = stage.owned(args.formalInputs, temporary, true), derivedCache = stage.owned(args.derivedCache, temporary, true)
  const work = path.resolve(args.workRoot)
  if (path.dirname(work) !== temporary || !path.basename(work).startsWith('rt-final-seal-') || fs.existsSync(work)) fail('FINAL_FRESH_WORK')
  const authority = producer.githubReader(env.GITHUB_TOKEN), authorization = await producer.readAuthorization(pins, authority)
  const trust = authorization.trustedContext
  if (trust.approvedSourceCommit !== env.GITHUB_SHA || authorization.consumer?.workflowPath !== WORKFLOW ||
      ![ENTRY, WORKFLOW, 'scripts/materialize-sealed-private-runtime-ci.cjs'].every(name => trust.requiredSourceFiles?.includes(name))) fail('FINAL_EXECUTION_SOURCE_REQUIRED')
  const sealName = 'scripts/seal-private-python-runtime.cjs'
  if (hash(read(path.join(ROOT, sealName))) !== authorization.entrypoints?.[sealName]) fail('FINAL_SEAL_SOURCE')
  const seal = producer.verifiedLoader(ROOT, new Map([[sealName, authorization.entrypoints[sealName]]]))(sealName)
  const proof = await stage.sourceProof(authorization, authority), source = await seal.verifySourceAuthority(trust, proof, ROOT, authority)
  const load = producer.verifiedLoader(ROOT, source.verified), foundation = load('electron/shared/privatePythonRuntimeManifest.cjs')
  const lockBytes = read(stage.owned(path.join(inputs, 'formal-lock.json'), temporary)), lock = foundation.validateLock(JSON.parse(lockBytes))
  const policyBytes = read(path.join(ROOT, 'resources/python-runtime/preparation.policy.json'))
  for (const target of TARGETS) {
    if (hash(lockBytes) !== authorization.stagingInputs?.[target]?.formalLockSha256) fail('FINAL_FORMAL_LOCK_PIN')
    foundation.validatePreparationPolicy(lock.platforms[target], JSON.parse(policyBytes), hash(policyBytes))
  }
  const obligationsProof = await readObligationsProof(inputs, temporary, authorization, pins, authority)
  if (!Array.isArray(trust.producers) || trust.producers.length !== 3 || new Set(trust.producers.map(row => row.target)).size !== 3 ||
      trust.producers.some(row => !TARGETS.includes(row.target))) fail('FINAL_THREE_STAGE_PRODUCERS_REQUIRED')
  fs.mkdirSync(work)
  const preparedRoot = path.join(work, 'prepared'); fs.mkdirSync(preparedRoot)
  const preparations = {}, artifactArchives = {}; proof.producers = []
  async function download(artifact) {
    const transfer = path.join(work, 'transfer-' + artifact.id); fs.mkdirSync(transfer)
    const filename = path.join(transfer, 'artifact.zip')
    await consumer.downloadArchive('/repos/' + pins.repository + '/actions/artifacts/' + artifact.id + '/zip', filename, artifact, env, transfer)
    return filename
  }
  for (const target of TARGETS) {
    const root = trust.producers.find(row => row.target === target)
    const artifact = await stageOrigin(authority, pins, trust, root), archivePath = await download(artifact)
    artifactArchives[String(artifact.id)] = archivePath
    const archive = read(archivePath, 128 * 1024 ** 2), metadata = path.join(work, 'metadata-' + target); fs.mkdirSync(metadata)
    const preparation = {}
    for (const [logical, filename] of Object.entries(MEMBERS)) {
      if (root.members?.[logical] !== filename) fail('FINAL_STAGE_MEMBER_PIN')
      const bytes = seal.artifactMember(archive, filename), output = path.join(metadata, filename)
      fs.writeFileSync(output, bytes, { flag: 'wx' }); preparation[logical + 'Path'] = output
    }
    const stageLock = seal.artifactMember(archive, 'formal-lock.json')
    if (!stageLock.equals(lockBytes)) fail('FINAL_STAGE_FORMAL_LOCK')
    const receipt = JSON.parse(seal.artifactMember(archive, 'stage-input-receipt.json'))
    if (receipt.target !== target || receipt.sourceCommit !== trust.approvedSourceCommit || receipt.runId !== Number(root.runId) ||
        receipt.runAttempt !== Number(root.attempt) || receipt.rawInputAssets !== false || receipt.finalSealAccepted !== false) fail('FINAL_STAGE_INPUT_RECEIPT')
    producer.verifyStagingInputPins({ formalLockSha256: lockBytes, candidateLockSha256: read(preparation.candidateLockPath),
      fragmentSha256: read(preparation.fragmentPath), handoffSha256: read(preparation.handoffPath) }, authorization.stagingInputs[target])
    const candidateArtifact = await prepareOrigin(authority, pins, target, receipt.candidateOrigin)
    const candidateZip = await download(candidateArtifact), retained = path.join(work, 'retained-' + target); fs.mkdirSync(retained)
    pythonCall(args.python, PREPARE_ZIP, [candidateZip, retained], work, env, 180000)
    const summary = JSON.parse(read(path.join(retained, 'summary.json'))), retainedPin = summary.unapprovedNativePayload
    const retainedTar = path.join(retained, 'native-preparation-candidate.tar.gz')
    if (retainedPin?.filename !== path.basename(retainedTar) || retainedPin.rawInputAssets !== false || retainedPin.assetsRootIncluded !== false ||
        retainedPin.size !== fs.statSync(retainedTar).size || retainedPin.sha256 !== fileHash(retainedTar)) fail('FINAL_PREPARED_ARCHIVE_PIN')
    const unpacked = path.join(retained, 'unpacked'); fs.mkdirSync(unpacked)
    pythonCall(args.python, stage.EXTRACT, [retainedTar, unpacked], work, env, 180000)
    for (const [file, expected] of [['prepare/candidate-lock.json', preparation.candidateLockPath],
      ['prepare/candidate-fragment.json', preparation.fragmentPath], ['handoff.json', preparation.handoffPath]]) {
      if (!read(path.join(unpacked, file)).equals(read(expected))) fail('FINAL_PREPARE_STAGE_BYTES')
    }
    fs.renameSync(path.join(unpacked, 'prepare/materialize/tree'), path.join(preparedRoot, target))
    preparations[target] = { candidateLockPath: preparation.candidateLockPath, fragmentPath: preparation.fragmentPath,
      handoffPath: preparation.handoffPath, nativeReportPath: preparation.nativeReportPath }
    proof.producers.push({ target, runId: root.runId, attempt: root.attempt, workflowPath: root.workflowPath,
      workflowBlobOid: root.workflowBlobOid, fragmentArtifactId: root.fragmentArtifactId, fragmentSha256: hash(read(preparation.fragmentPath)) })
  }
  const assetsRoot = path.join(work, 'clean-assets'); fs.mkdirSync(assetsRoot)
  const plan = stage.assetPlan(lock.platforms[args.target], trust.approvedPolicySha256); plan.reproduce = []
  for (const wheel of plan.derived) {
    const cached = cachedDerived(derivedCache, wheel.asset)
    if (cached) fs.copyFileSync(cached, path.join(assetsRoot, wheel.asset.filename), fs.constants.COPYFILE_EXCL)
    else if (wheel.nativeBuildInputs || !['scripts/build-provider-source-wheels.py', 'scripts/build-mootdx-compat-wheel.py',
      'scripts/build-akshare-node-wheel.py', 'scripts/build-private-node-js-runtime-wheel.py'].includes(wheel.derived.recipe.path)) fail('FINAL_NATIVE_DERIVED_ASSET_MISSING')
    else plan.reproduce.push(wheel)
  }
  for (const recipe of plan.recipes) {
    if (source.verified.get(recipe.path) !== recipe.sha256) fail('FINAL_RECIPE_SOURCE')
    const output = path.join(assetsRoot, 'recipes', recipe.path); fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.copyFileSync(path.join(ROOT, recipe.path), output, fs.constants.COPYFILE_EXCL)
  }
  const planPath = path.join(work, 'asset-plan.json'); fs.writeFileSync(planPath, JSON.stringify(plan), { flag: 'wx' })
  pythonCall(args.python, stage.CACHE, [ROOT, planPath, assetsRoot, work], work, env, 1200000)
  const lockPath = path.join(work, 'formal-lock.json'); fs.writeFileSync(lockPath, lockBytes, { flag: 'wx' })
  const inputPath = path.join(work, 'final-seal-input.json')
  fs.writeFileSync(inputPath, JSON.stringify({ sourceProof: proof, obligationsProof, lockPath, preparedRoot, assetsRoot, preparations, artifactArchives }), { flag: 'wx' })
  const validate = load('scripts/validate-private-python-runtime.cjs').validate
  return sealAndArchive(inputPath, env, args.target, path.join(work, 'evidence'), args.python, work, validate)
}
if (require.main === module) {
  run(options(process.argv.slice(2))).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(error => {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error.code || '') ? error.code : 'FINAL_SEAL_FAILED'
    process.stderr.write(JSON.stringify({ status: 'pending', releaseEligible: false, code }) + '\n'); process.exitCode = 1
  })
}
module.exports = { options, stageOrigin, prepareOrigin, readObligationsProof, sealAndArchive, PREPARE_ZIP, PACK, run }
