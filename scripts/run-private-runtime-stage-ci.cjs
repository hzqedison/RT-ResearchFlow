'use strict'

// Integrate existing authorization, retained candidates and the native producer.
// This entry never approves policy, licenses or a candidate's own source claims.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const producer = require('./seal-private-python-runtime-producer.cjs')
const ROOT = path.resolve(__dirname, '..')
const ENTRY = 'scripts/run-private-runtime-stage-ci.cjs'
const WORKFLOW = '.github/workflows/private-runtime-stage-native.yml'
const TARGETS = ['win32-x64', 'darwin-arm64', 'darwin-x64']
const PREPARE_RUN = 37966682707
const PREPARE_SOURCE = '8361d331ab631373fc34634df10f1f1e4c144e7b'
const PREPARE_PINS = {
  'win32-x64': { artifactId: 11633792453, jobId: 113942680677, size: 319278985,
    digest: '0c3cdb1b258f6547a1fc854076140d5d80742cf7e42aaa4f8327959dc5ffcb64' },
  'darwin-arm64': { artifactId: 11634431229, jobId: 113942680375, size: 308559945,
    digest: '4bf215473e1944e1def6cbc1af07720115d5003516c0c03383643be8f67a211a' },
  'darwin-x64': { artifactId: 11633807716, jobId: 113942680942, size: 325923057,
    digest: '4e70ab2887e19e4d970cd5d8c159858776eb2d4e0fbd12e29923e19a7aa91ffa' },
}
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function fail(code) { const error = new Error(code); error.code = code; throw error }
function relative(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') ||
      name.split('/').some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part))) fail('STAGE_PATH_INVALID')
  return name
}
function owned(filename, temporary, directory = false) {
  if (!path.isAbsolute(filename)) fail('STAGE_PATH_NOT_ABSOLUTE')
  const base = fs.realpathSync(temporary), resolved = path.resolve(filename), rel = path.relative(base, resolved)
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) fail('STAGE_PATH_ESCAPES_TEMP')
  let cursor = base
  for (const part of rel.split(path.sep)) {
    cursor = path.join(cursor, part)
    if (fs.lstatSync(cursor).isSymbolicLink()) fail('STAGE_INPUT_LINK')
  }
  const stat = fs.statSync(resolved)
  if (fs.realpathSync(resolved) !== resolved || (directory ? !stat.isDirectory() : !stat.isFile())) fail('STAGE_INPUT_KIND')
  return resolved
}
function read(filename, cap = 8 * 1024 * 1024) {
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > cap) fail('STAGE_FILE_INVALID')
  const bytes = fs.readFileSync(filename)
  if (bytes.length !== stat.size) fail('STAGE_FILE_CHANGED')
  return bytes
}
function writeJson(filename, value) { fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }) }
function options(argv) {
  const names = { '--target': 'target', '--candidate-proof': 'candidateProof', '--formal-lock': 'formalLock',
    '--derived-cache': 'derivedCache', '--work-root': 'workRoot', '--python': 'python',
    '--prepare-run': 'prepareRun', '--prepare-artifact': 'prepareArtifact', '--prepare-job': 'prepareJob' }
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!names[argv[i]] || !argv[i + 1] || Object.hasOwn(args, names[argv[i]])) fail('STAGE_USAGE')
    args[names[argv[i]]] = argv[i + 1]
  }
  if (Object.keys(args).length !== 9 || !TARGETS.includes(args.target)) fail('STAGE_USAGE')
  for (const name of ['prepareRun', 'prepareArtifact', 'prepareJob']) {
    if (!/^[1-9][0-9]*$/.test(args[name]) || !Number.isSafeInteger(Number(args[name]))) fail('STAGE_PREPARE_COORDINATES')
    args[name] = Number(args[name])
  }
  return args
}
async function sourceProof(authorization, authority, repositoryRoot = ROOT) {
  const trust = authorization.trustedContext, prefix = '/repos/' + trust.repositoryFullName
  const commit = await authority.readJson(prefix + '/git/commits/' + trust.approvedSourceCommit)
  if (commit.sha !== trust.approvedSourceCommit || !/^[a-f0-9]{40}$/.test(commit.tree?.sha || '')) fail('STAGE_SOURCE_COMMIT')
  const trees = new Map(), files = []
  if (!Array.isArray(trust.requiredSourceFiles) || ![ENTRY, WORKFLOW].every(name => trust.requiredSourceFiles.includes(name))) fail('STAGE_INTEGRATION_SOURCE_NOT_AUTHORIZED')
  for (const name of trust.requiredSourceFiles) {
    const parts = relative(name).split('/'); let parent = commit.tree.sha, member
    for (let i = 0; i < parts.length; i++) {
      if (!trees.has(parent)) {
        const tree = await authority.readJson(prefix + '/git/trees/' + parent)
        if (tree.sha !== parent || tree.truncated || !Array.isArray(tree.tree)) fail('STAGE_SOURCE_TREE')
        trees.set(parent, tree.tree)
      }
      const matches = trees.get(parent).filter(row => row.path === parts[i])
      if (matches.length !== 1) fail('STAGE_SOURCE_MEMBER')
      member = matches[0]
      if (i < parts.length - 1) {
        if (member.type !== 'tree' || member.mode !== '040000') fail('STAGE_SOURCE_MEMBER')
        parent = member.sha
      }
    }
    if (member.type !== 'blob' || !['100644', '100755'].includes(member.mode)) fail('STAGE_SOURCE_MEMBER')
    const bytes = read(path.join(repositoryRoot, name))
    const oid = crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')
    if (oid !== member.sha) fail('STAGE_CHECKOUT_BYTES')
    files.push({ path: name, blobOid: member.sha, mode: member.mode, size: bytes.length, sha256: hash(bytes) })
  }
  return { kind: 'github-tree-membership-v1', repositoryId: trust.repositoryId,
    sourceCommit: trust.approvedSourceCommit, rootTreeOid: commit.tree.sha,
    policySha256: trust.approvedPolicySha256, sourceSnapshotSha256: trust.sourceSnapshotSha256, files }
}
async function verifyCandidateOrigin(authority, repository, target, coordinates) {
  if (!coordinates || !['prepareRun', 'prepareArtifact', 'prepareJob'].every(name =>
    Number.isSafeInteger(coordinates[name]) && coordinates[name] > 0)) fail('STAGE_PREPARE_COORDINATES')
  const pin = PREPARE_PINS[target]
  if (!pin || coordinates.prepareRun !== PREPARE_RUN || coordinates.prepareArtifact !== pin.artifactId ||
      coordinates.prepareJob !== pin.jobId) fail('STAGE_PREPARE_PIN_MISMATCH')
  const prefix = '/repos/' + repository
  const run = await authority.readJson(prefix + '/actions/runs/' + coordinates.prepareRun)
  const artifact = await authority.readJson(prefix + '/actions/artifacts/' + coordinates.prepareArtifact)
  if (run.id !== coordinates.prepareRun || run.head_sha !== PREPARE_SOURCE || run.status !== 'completed' || run.conclusion !== 'success' ||
      run.path !== '.github/workflows/private-runtime-prepare-native.yml' ||
      run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
      artifact.id !== coordinates.prepareArtifact || artifact.expired || artifact.name !== 'private-runtime-prepare-' + target ||
      artifact.workflow_run?.id !== coordinates.prepareRun || artifact.workflow_run?.head_sha !== run.head_sha ||
      artifact.size_in_bytes !== pin.size || artifact.digest !== 'sha256:' + pin.digest) fail('STAGE_CANDIDATE_ORIGIN')
  const job = await authority.readJson(prefix + '/actions/jobs/' + coordinates.prepareJob)
  const runner = { 'win32-x64': 'windows-latest', 'darwin-arm64': 'macos-15', 'darwin-x64': 'macos-15-intel' }[target]
  if (job.id !== coordinates.prepareJob || job.run_id !== run.id || job.run_attempt !== run.run_attempt ||
      job.name !== 'native-prepare (' + target + ', ' + runner + ')' ||
      job.status !== 'completed' || job.conclusion !== 'success' || job.head_sha !== run.head_sha) fail('STAGE_PREPARE_JOB')
  return { runId: run.id, runAttempt: run.run_attempt, sourceCommit: run.head_sha,
    artifactId: artifact.id, artifactArchiveSha256: artifact.digest.slice(7),
    artifactArchiveVerified: false, jobId: job.id }
}
const EXTRACT = String.raw`
import pathlib, sys, tarfile
archive, output = map(pathlib.Path, sys.argv[1:])
required={'prepare/candidate-lock.json','prepare/candidate-fragment.json','handoff.json'}
tree='prepare/materialize/tree'
seen=set(); total=0; count=0
def preflight(member):
 global total,count
 name=member.name
 if name.startswith('/') or chr(92) in name or any(p in ('','..','.') or ':' in p for p in name.split('/')): raise ValueError('ARCHIVE_PATH')
 if name in seen: raise ValueError('ARCHIVE_DUPLICATE:'+name)
 seen.add(name); count+=1; total+=member.size
 if count>150000 or total>8*1024**3: raise ValueError('ARCHIVE_BUDGET')
def checked(member, destination):
 name=member.name
 if name not in required and name!=tree and not name.startswith(tree+'/'): return None
 if name in required and not member.isfile(): raise ValueError('ARCHIVE_METADATA_KIND')
 if not (member.isfile() or member.isdir() or member.issym() or member.islnk()): raise ValueError('ARCHIVE_KIND')
 if member.issym():
  target=(output/name).parent/member.linkname
  if not target.resolve().is_relative_to((output/tree).resolve()): raise ValueError('ARCHIVE_TREE_LINK')
 if member.islnk() and not (output/member.linkname).resolve().is_relative_to((output/tree).resolve()): raise ValueError('ARCHIVE_TREE_HARDLINK')
 filtered=tarfile.data_filter(member,destination)
 return filtered.replace(mode=member.mode & 0o777) if member.isfile() or member.isdir() else filtered
with tarfile.open(archive,'r:gz') as packed:
 members=[]
 for member in packed:
  preflight(member);members.append(member)
 packed.extractall(output,members=members,filter=checked)
if not required.issubset(seen) or not (output/tree).is_dir(): raise ValueError('ARCHIVE_INCOMPLETE')
`
const CACHE = String.raw`
import importlib.util,json,pathlib,sys
repo,plan,assets,work=map(pathlib.Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location('rt_stage_prepare',repo/'scripts/prepare-private-python-runtime.py')
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
policy,policy_sha=module.load_policy(repo/'resources/python-runtime/preparation.policy.json')
value=json.loads(plan.read_bytes())
if policy_sha!=value['policySha256']:raise ValueError('CACHE_POLICY')
for item in value['downloads']:module.fetch(item,assets/item['filename'],policy)
for wheel in value['reproduce']:
 if wheel.get('nativeBuildInputs') is not None:raise ValueError('NATIVE_REBUILD_FORBIDDEN')
 module.reproduce(wheel,assets,work,policy)
print(json.dumps({'downloadedOrVerified':len(value['downloads']),'reproduced':len(value['reproduce'])}))
`
function childEnvironment(env, work) {
  const result = {}
  for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH']) if (env[name]) result[name] = env[name]
  return { ...result, HOME: work, USERPROFILE: work, TMPDIR: work, TEMP: work, TMP: work,
    PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', NODE_OPTIONS: '', NODE_PATH: '', PYTHONPATH: '' }
}
function pythonCall(python, code, args, work, env, timeout) {
  const result = spawnSync(python, ['-X', 'utf8', '-I', '-B', '-c', code, ...args],
    { cwd: work, env: childEnvironment(env, work), timeout, maxBuffer: 1024 * 1024, windowsHide: true, shell: false })
  if (result.error || result.signal || result.status !== 0) fail('STAGE_INPUT_SUBPROCESS_FAILED')
}
function assetPlan(manifest, policySha256) {
  const downloads = new Map(), derived = new Map(), recipes = new Map(), names = new Map()
  function add(asset) {
    if (!asset || !['download', 'derived'].includes(asset.kind) || !Number.isSafeInteger(asset.size) || asset.size < 1 ||
        !/^[a-f0-9]{64}$/.test(asset.sha256 || '') || relative(asset.filename).includes('/')) fail('STAGE_ASSET_PIN')
    const prior = names.get(asset.filename.toLowerCase())
    if (prior && JSON.stringify(prior) !== JSON.stringify(asset)) fail('STAGE_ASSET_COLLISION')
    names.set(asset.filename.toLowerCase(), asset)
    if (asset.kind === 'download') downloads.set(asset.filename, asset)
  }
  for (const runtime of [manifest.python, manifest.node]) {
    add(runtime.asset)
    for (const asset of runtime.licenseSources || []) add(asset)
  }
  for (const provider of Object.values(manifest.providers)) for (const wheel of provider.wheels) {
    add(wheel.asset)
    if (wheel.derived) {
      add(wheel.derived.upstreamAsset); derived.set(wheel.asset.filename, wheel)
      const recipe = wheel.derived.recipe; relative(recipe.path)
      const prior = recipes.get(recipe.path)
      if (prior && prior.sha256 !== recipe.sha256) fail('STAGE_RECIPE_COLLISION')
      recipes.set(recipe.path, recipe)
    }
  }
  return { policySha256, downloads: [...downloads.values()], derived: [...derived.values()], recipes: [...recipes.values()] }
}
function findDerived(root, asset) {
  const matches = []; let count = 0
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++count > 10000 || entry.isSymbolicLink()) fail('STAGE_DERIVED_CACHE')
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(filename)
      else if (entry.isFile() && entry.name === asset.filename && fs.statSync(filename).size === asset.size && hash(read(filename, asset.size)) === asset.sha256) matches.push(filename)
    }
  }
  walk(root)
  if (matches.length > 1) fail('STAGE_DERIVED_DUPLICATE')
  return matches[0]
}
async function run(args, env = process.env) {
  const pins = producer.protectedPins(env)
  if (args.target !== process.platform + '-' + process.arch) fail('STAGE_NATIVE_TARGET')
  const temporary = fs.realpathSync(env.RUNNER_TEMP)
  const proofDir = owned(args.candidateProof, temporary, true), derivedCache = owned(args.derivedCache, temporary, true)
  const formalLock = owned(args.formalLock, temporary)
  const work = path.resolve(args.workRoot)
  if (fs.existsSync(work) || fs.lstatSync(path.dirname(work)).isSymbolicLink() ||
      path.dirname(work) !== temporary || !path.basename(work).startsWith('rt-formal-stage-')) fail('STAGE_FRESH_WORK_REQUIRED')
  const authority = producer.githubReader(env.GITHUB_TOKEN)
  const authorization = await producer.readAuthorization(pins, authority)
  if (authorization.trustedContext.approvedSourceCommit !== env.GITHUB_SHA) fail('STAGE_APPROVED_SOURCE')
  const sealName = 'scripts/seal-private-python-runtime.cjs'
  if (hash(read(path.join(ROOT, sealName))) !== authorization.entrypoints?.[sealName] ||
      hash(read(path.join(ROOT, 'scripts/seal-private-python-runtime-producer.cjs'))) !== authorization.entrypoints?.['scripts/seal-private-python-runtime-producer.cjs']) fail('STAGE_BOOTSTRAP_SOURCE')
  const proof = await sourceProof(authorization, authority)
  const seal = producer.verifiedLoader(ROOT, new Map([[sealName, authorization.entrypoints[sealName]]]))(sealName)
  const source = await seal.verifySourceAuthority(authorization.trustedContext, proof, ROOT, authority)
  const load = producer.verifiedLoader(ROOT, source.verified)
  const foundation = load('electron/shared/privatePythonRuntimeManifest.cjs')
  const origin = await verifyCandidateOrigin(authority, pins.repository, args.target, args)
  const summary = JSON.parse(read(path.join(proofDir, 'summary.json')))
  const archivePin = summary.unapprovedNativePayload
  const archive = owned(path.join(proofDir, 'native-preparation-candidate.tar.gz'), temporary)
  if (archivePin?.filename !== path.basename(archive) || archivePin.rawInputAssets !== false ||
      archivePin.assetsRootIncluded !== false || fs.statSync(archive).size !== archivePin.size) fail('STAGE_CANDIDATE_PAYLOAD')
  const archiveHash = crypto.createHash('sha256')
  const fd = fs.openSync(archive, 'r'); const buffer = Buffer.alloc(1024 * 1024)
  try { let n; while ((n = fs.readSync(fd, buffer)) > 0) archiveHash.update(buffer.subarray(0, n)) } finally { fs.closeSync(fd) }
  if (archiveHash.digest('hex') !== archivePin.sha256 || archivePin.size > 2 * 1024 ** 3) fail('STAGE_CANDIDATE_ARCHIVE_HASH')
  fs.mkdirSync(work)
  const retained = path.join(work, 'retained'); fs.mkdirSync(retained)
  pythonCall(args.python, EXTRACT, [archive, retained], work, env, 180000)
  const preparation = { candidateLockPath: path.join(retained, 'prepare/candidate-lock.json'),
    fragmentPath: path.join(retained, 'prepare/candidate-fragment.json'), handoffPath: path.join(retained, 'handoff.json') }
  const lockBytes = read(formalLock)
  producer.verifyStagingInputPins({ formalLockSha256: lockBytes,
    candidateLockSha256: read(preparation.candidateLockPath), fragmentSha256: read(preparation.fragmentPath),
    handoffSha256: read(preparation.handoffPath) }, authorization.stagingInputs?.[args.target])
  const fragment = JSON.parse(read(preparation.fragmentPath)), trust = authorization.trustedContext
  if (fragment.target !== args.target || fragment.treeComplete !== true || fragment.sourceSha256 !== trust.sourceSnapshotSha256 ||
      fragment.preparationPolicySha256 !== trust.approvedPolicySha256) fail('STAGE_CANDIDATE_FINAL_PINS')
  const lockPath = path.join(work, 'formal-lock.json'); fs.writeFileSync(lockPath, lockBytes, { flag: 'wx' })
  const lock = foundation.validateLock(JSON.parse(lockBytes))
  const preparedRoot = path.join(work, 'prepared'); fs.mkdirSync(preparedRoot)
  fs.renameSync(path.join(retained, 'prepare/materialize/tree'), path.join(preparedRoot, args.target))
  const manifest = structuredClone(lock.platforms[args.target])
  const projected = foundation.projectDependencyGraphs(path.join(preparedRoot, args.target), manifest,
    source.verified.get('scripts/prepare-private-python-runtime.py'))
  for (const provider of ['akshare', 'mootdx', 'pywencai']) manifest.providers[provider].wheels = projected.providers[provider].wheels
  const plan = assetPlan(manifest, trust.approvedPolicySha256), assetsRoot = path.join(work, 'clean-assets')
  fs.mkdirSync(assetsRoot)
  plan.reproduce = []
  for (const wheel of plan.derived) {
    const cached = findDerived(derivedCache, wheel.asset)
    if (cached) fs.copyFileSync(cached, path.join(assetsRoot, wheel.asset.filename), fs.constants.COPYFILE_EXCL)
    else if (wheel.nativeBuildInputs || !['scripts/build-provider-source-wheels.py', 'scripts/build-mootdx-compat-wheel.py',
      'scripts/build-akshare-node-wheel.py', 'scripts/build-private-node-js-runtime-wheel.py'].includes(wheel.derived.recipe.path)) fail('STAGE_PINNED_NATIVE_DERIVED_ASSET_MISSING')
    else plan.reproduce.push(wheel)
  }
  for (const recipe of plan.recipes) {
    if (source.verified.get(recipe.path) !== recipe.sha256) fail('STAGE_RECIPE_SOURCE')
    const output = path.join(assetsRoot, 'recipes', recipe.path)
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.copyFileSync(path.join(ROOT, recipe.path), output, fs.constants.COPYFILE_EXCL)
  }
  const planPath = path.join(work, 'asset-plan.json'); writeJson(planPath, plan)
  pythonCall(args.python, CACHE, [ROOT, planPath, assetsRoot, work], work, env, 1200000)
  const input = { sourceProof: proof, lockPath, preparedRoot, assetsRoot, preparations: { [args.target]: preparation } }
  const inputPath = path.join(work, 'stage-input.json'); writeJson(inputPath, input)
  const result = await producer.runProducer(inputPath, env, true)
  if (result.status !== 'staged' || result.reporterExitCode !== 0 || result.reporterExitObserved !== true ||
      result.supervisorOwnedTreeEmpty !== true) fail('STAGE_NATIVE_NOT_ACCEPTED')
  const evidence = path.join(work, 'evidence'); fs.mkdirSync(evidence)
  for (const [name, filename] of [['candidate-lock.json', preparation.candidateLockPath],
    ['candidate-fragment.json', preparation.fragmentPath], ['handoff.json', preparation.handoffPath],
    ['native-bootstrap-report.json', result.reportPath], ['formal-lock.json', lockPath]]) {
    fs.copyFileSync(filename, path.join(evidence, name), fs.constants.COPYFILE_EXCL)
  }
  writeJson(path.join(evidence, 'source-proof.json'), proof)
  writeJson(path.join(evidence, 'stage-result.json'), result)
  writeJson(path.join(evidence, 'stage-input-receipt.json'), { target: args.target, candidateOrigin: origin,
    sourceCommit: env.GITHUB_SHA, runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    rawInputAssets: false, finalSealAccepted: false, releaseEligible: false,
    files: fs.readdirSync(evidence).sort().map(name => ({ path: name, sha256: hash(read(path.join(evidence, name))), size: fs.statSync(path.join(evidence, name)).size })) })
  return result
}
if (require.main === module) {
  run(options(process.argv.slice(2))).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(error => {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error.code || '') ? error.code : 'STAGE_INTEGRATION_FAILED'
    process.stderr.write(JSON.stringify({ status: 'pending', releaseEligible: false, code }) + '\n'); process.exitCode = 1
  })
}
module.exports = { options, sourceProof, verifyCandidateOrigin, assetPlan, owned, childEnvironment, EXTRACT, CACHE, run }
