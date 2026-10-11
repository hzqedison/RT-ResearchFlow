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
const PREPARE_RUN = 38086414260
const PREPARE_SOURCE = 'b3994908e75c8cec4a8bbc9b0ab7a230e39db35c'
const PREPARE_PINS = {
  'win32-x64': { artifactId: 11681863167, jobId: 114313752780, size: 319283710,
    digest: 'edda78761f4266760340e2add86dd1dae41893b5224473755b6e0fa56839a46b' },
  'darwin-arm64': { artifactId: 11681947938, jobId: 114313752669, size: 308565305,
    digest: 'f8b674eab4bcf7e49afc3f0830218c55f7e1e3453ec4b853982e30c3b436d30f' },
  'darwin-x64': { artifactId: 11682448388, jobId: 114313752546, size: 325921214,
    digest: '996f5409d96d8b5fc73761a3afb91fb656043304db8646b2184e95c5835e3336' },
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
const FORMAL_LOCK_BYTE_CAP = 32 * 1024 * 1024
function readFormalLock(filename) { return read(filename, FORMAL_LOCK_BYTE_CAP) }
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
const SAFE_RUNTIME_REASONS = new Set([
  "AKShare Node derivative identity mismatch",
  "AKShare pin changed",
  "Mac executable architecture mismatch",
  "Mac minimum OS must match the declared 12.0 support",
  "MiniRacer adapter does not match application source",
  "MiniRacer adapter version mismatch",
  "PBS executable evidence missing",
  "PBS full-archive provenance missing",
  "SBOM component missing",
  "SBOM missing",
  "Windows executable architecture mismatch",
  "active dependency absent/URL dependency forbidden",
  "actual installed distribution set mismatch",
  "all providers required",
  "approved download sources missing",
  "asset URL missing",
  "asset URL/name mismatch",
  "asset is not pinned",
  "bootstrap does not match application source",
  "component license requirements missing",
  "conflicting asset filename",
  "dependency audit distribution set mismatch",
  "dependency audit fields missing",
  "dependency audit identity/generator mismatch",
  "dependency audit missing",
  "dependency audit projection SHA mismatch",
  "dependency audit projection bytes invalid",
  "dependency audit projection missing",
  "dependency audit projection reference invalid",
  "dependency audit reference missing",
  "dependency audit validator does not match application source",
  "dependency audit wheel/original metadata mismatch",
  "dependency evaluation index missing",
  "dependency evidence byte mismatch",
  "dependency evidence inventory mismatch",
  "dependency graph/extras fixed-point mismatch",
  "dependency marker environment mismatch",
  "dependency projection input is neither original constraints nor verified graph",
  "dependency projection name invalid",
  "dependency projection requires original constraints",
  "dependency projection wheel invalid",
  "dependency root missing",
  "dependency toolchain identity mismatch",
  "derived asset must not have a URL",
  "derived input hash mismatch",
  "derived wheel identity missing",
  "download source not approved by policy",
  "download wheel must not have derived identity",
  "duplicate audit inventory path",
  "duplicate dependency evaluation index",
  "duplicate inventory path",
  "duplicate pinned license source",
  "duplicate wheel distribution",
  "duplicate/invalid audit wheel",
  "duplicate/invalid installed audit distribution",
  "escaping symlink",
  "executable missing",
  "executable mode missing",
  "file hash/size missing",
  "file inventory missing",
  "incomplete manifest or wrong target",
  "installed METADATA/original constraints mismatch",
  "installed WHEEL tags mismatch",
  "installed closure bytes/facts disagree",
  "installed closure metadata path invalid",
  "installed closure reference missing",
  "invalid SPDX document",
  "invalid Windows executable",
  "invalid dependency audit context",
  "invalid dependency evaluation",
  "invalid executable",
  "invalid installed distribution directory",
  "invalid installed metadata header",
  "invalid inventory entry",
  "invalid license approval",
  "invalid license source list",
  "invalid manifest file",
  "invalid official source",
  "invalid pinned license sources",
  "invalid preparation policy",
  "invalid preparation policy file",
  "invalid recipe approval",
  "invalid scoped license requirement",
  "invalid wheel filename",
  "inventory file absent",
  "license absent from inventory",
  "license approval unavailable",
  "license evidence incomplete",
  "license evidence missing",
  "license member hash missing",
  "license not reviewed",
  "modern MiniRacer compatibility unresolved",
  "mootdx Node derivative identity mismatch",
  "mootdx derived wheel pending",
  "non-runtime directory",
  "non-runtime file in inventory",
  "only locked wheels accepted",
  "original Node notice coverage incomplete",
  "original Python notice coverage incomplete",
  "original Python notice pins missing",
  "original notice retained path missing",
  "original wheel metadata missing",
  "original wheel/dependency graph missing",
  "output must be a new, separate owned directory",
  "platform preparation policy mismatch",
  "preparation policy hash mismatch",
  "preparation policy missing",
  "primary provider/version missing",
  "private Node backend identity unresolved",
  "provider lock missing",
  "provider site empty",
  "pywencai adapter differs from current source",
  "pywencai pin changed",
  "recipe not approved by policy",
  "required license text missing",
  "resolved edges differ from evaluations",
  "retained original bytes missing",
  "runtime file mismatch",
  "runtime identity mismatch",
  "runtime root is not an owned directory",
  "source asset/recipe mismatch",
  "symlink mismatch/escape",
  "target runtime asset/license-source pin mismatch",
  "target runtime pin missing",
  "target runtime pins missing",
  "trusted MiniRacer adapter missing",
  "trusted bootstrap missing",
  "trusted dependency audit validator missing",
  "unbound scoped license text",
  "unexpected original notice scope",
  "unlisted runtime file",
  "unreachable installed distribution",
  "unregistered asset input",
  "unregistered derived input",
  "unsafe relative path",
  "unsafe symlink",
  "unsupported file kind",
  "unsupported target",
  "wheel Python ABI mismatch",
  "wheel dependency closure incomplete",
  "wheel identity missing",
  "wheel platform mismatch"
])
const SAFE_SEAL_CODES = new Set([
  "ARTIFACT_ARCHIVE_INVALID",
  "ARTIFACT_ARCHIVE_READER_MISSING",
  "ARTIFACT_MEMBER_BYTES_INVALID",
  "ARTIFACT_MEMBER_DUPLICATE",
  "ARTIFACT_MEMBER_INVALID",
  "ARTIFACT_MEMBER_MISSING",
  "ARTIFACT_ZIP64_UNSUPPORTED",
  "ASSEMBLY_BLUEPRINT_CHANGED",
  "ASSEMBLY_MANIFEST_CHANGED",
  "ASSEMBLY_NATIVE_TARGET_MISMATCH",
  "DUPLICATE_OBLIGATION_REVIEW",
  "DUPLICATE_PRODUCER_TARGET",
  "EXECUTED_MODULE_CHANGED",
  "EXECUTED_MODULE_ESCAPE",
  "EXECUTED_MODULE_NOT_VERIFIED",
  "EXECUTION_SOURCE_ROOT_MISMATCH",
  "FILE_ESCAPES_ROOT",
  "FOREIGN_TREE_BYTES",
  "FOREIGN_TREE_INVENTORY",
  "FOREIGN_TREE_SYMLINK",
  "INCOMPLETE_SOURCE_ALLOWLIST",
  "INVALID_GITHUB_ENDPOINT",
  "INVALID_JSON",
  "INVALID_PROTECTED_CONTEXT",
  "INVALID_RELATIVE_PATH",
  "INVALID_SHA256",
  "INVALID_SOURCE_FILE",
  "NATIVE_BOOTSTRAP_REPORT_BINDING",
  "NATIVE_BOOTSTRAP_REPORT_MISSING",
  "NATIVE_BOOTSTRAP_VERIFICATION_FAILED",
  "NATIVE_BOOTSTRAP_VERIFICATION_PENDING",
  "NATIVE_BOOTSTRAP_VERIFIER_MISSING",
  "NOTICE_INDEX_ENCODING",
  "NOTICE_INDEX_MISSING_ENTRY",
  "NOTICE_NOT_IN_PAYLOAD",
  "OBLIGATIONS_PROOF_INVALID",
  "OBLIGATIONS_PROOF_MISSING",
  "OBLIGATION_ABSENCE_UNPROVED",
  "OBLIGATION_ASSET_CONFLICT",
  "OBLIGATION_ASSET_NOT_CLASSIFIED",
  "OBLIGATION_CLASSIFICATION",
  "OBLIGATION_EVIDENCE_BYTES",
  "OBLIGATION_EVIDENCE_COVERAGE",
  "OBLIGATION_EVIDENCE_PENDING",
  "OBLIGATION_EVIDENCE_REJECTED",
  "OBLIGATION_PAYLOAD_BINDING",
  "OBLIGATION_PAYLOAD_BYTES",
  "OBLIGATION_PAYLOAD_MISMATCH",
  "OBLIGATION_POLICY_PIN_MISMATCH",
  "OBLIGATION_REVIEW_MISMATCH",
  "OBLIGATION_REVIEW_MISSING",
  "OBLIGATION_REVIEW_SOURCE",
  "OBLIGATION_RULES_INVALID",
  "OBLIGATION_RULES_MISSING",
  "OBLIGATION_RULE_INVALID",
  "OBLIGATION_TARGET_MISSING",
  "OBLIGATION_VERIFIER_MISSING",
  "PREPARATION_AUDIT_BINDING",
  "PREPARATION_EXECUTION_ASSET",
  "PREPARATION_GRAPH_PROJECTION",
  "PREPARATION_HANDOFF_BINDING",
  "PREPARATION_INPUTS_MISSING",
  "PREPARATION_LOCK_BINDING",
  "PREPARATION_NOT_COMPLETE",
  "PREPARATION_PENDING_REMAINS",
  "PREPARATION_PENDING_TYPE",
  "PREPARATION_PROVIDER_PROJECTION",
  "PREPARATION_SOURCE_SNAPSHOT",
  "PREPARATION_TREE_PROJECTION",
  "PREPARATION_WHEEL_PROJECTION",
  "PRODUCER_ARTIFACT_BYTES_MISMATCH",
  "PRODUCER_ARTIFACT_MISMATCH",
  "PRODUCER_IDENTITY_MISMATCH",
  "PRODUCER_JOB_MISMATCH",
  "PRODUCER_MEMBER_BINDING_MISSING",
  "PRODUCER_MEMBER_BYTES_MISMATCH",
  "PRODUCER_NOT_SUCCESSFUL",
  "PRODUCER_PIN_MISMATCH",
  "PRODUCER_TARGET_MISSING",
  "PROTECTED_CONTEXT_REQUIRED",
  "REPOSITORY_IDENTITY_MISMATCH",
  "SOURCE_AUTHORIZATION_PIN_MISMATCH",
  "SOURCE_BLOB_ENCODING",
  "SOURCE_BYTES_MISMATCH",
  "SOURCE_IDENTITY_MISMATCH",
  "SOURCE_MEMBERSHIP_COVERAGE",
  "SOURCE_MEMBER_MISSING",
  "SOURCE_MEMBER_TYPE",
  "SOURCE_PROOF_MISSING",
  "SOURCE_SYMLINK",
  "SOURCE_TREE_INCOMPLETE",
  "SOURCE_TREE_MISMATCH",
  "THREE_PRODUCERS_REQUIRED",
  "UNEXPECTED_OBLIGATION_ASSET",
  "UNEXPECTED_OBLIGATION_REVIEW",
  "UNVERIFIED_MODULE_DEPENDENCY",
  "WORKFLOW_SOURCE_NOT_BOUND"
])
const SAFE_STAGE_PHASES = new Set(['authorization', 'source-verification', 'candidate-origin', 'candidate-extraction',
  'dependency-projection', 'asset-preparation', 'native-producer', 'evidence-copy'])
function stageFailure(error) {
  const message = typeof error?.message === 'string' ? error.message : ''
  const runtime = /^(PRIVATE_RUNTIME_(INVALID|PENDING)): (.+)$/.exec(message)
  const code = /^[A-Z][A-Z0-9_]+$/.test(error?.code || '') ? error.code
    : SAFE_SEAL_CODES.has(message) ? message
      : runtime ? 'STAGE_RUNTIME_' + runtime[2] : 'STAGE_INTEGRATION_FAILED'
  const status = error?.sealStatus === 'invalid' || runtime?.[2] === 'INVALID' ? 'invalid' : 'pending'
  return { status, releaseEligible: false, code,
    ...(SAFE_STAGE_PHASES.has(error?.stagePhase) ? { phase: error.stagePhase } : {}),
    ...(runtime && SAFE_RUNTIME_REASONS.has(runtime[3]) ? { reason: runtime[3] } : {}) }
}
async function run(args, env = process.env) {
  let phase = 'authorization'
  try {
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
  phase = 'source-verification'
  const proof = await sourceProof(authorization, authority)
  const seal = producer.verifiedLoader(ROOT, new Map([[sealName, authorization.entrypoints[sealName]]]))(sealName)
  const source = await seal.verifySourceAuthority(authorization.trustedContext, proof, ROOT, authority)
  const load = producer.verifiedLoader(ROOT, source.verified)
  const foundation = load('electron/shared/privatePythonRuntimeManifest.cjs')
  phase = 'candidate-origin'
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
  phase = 'candidate-extraction'
  pythonCall(args.python, EXTRACT, [archive, retained], work, env, 180000)
  const preparation = { candidateLockPath: path.join(retained, 'prepare/candidate-lock.json'),
    fragmentPath: path.join(retained, 'prepare/candidate-fragment.json'), handoffPath: path.join(retained, 'handoff.json') }
  const lockBytes = readFormalLock(formalLock)
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
  phase = 'dependency-projection'
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
  phase = 'asset-preparation'
  pythonCall(args.python, CACHE, [ROOT, planPath, assetsRoot, work], work, env, 1200000)
  const input = { sourceProof: proof, lockPath, preparedRoot, assetsRoot, preparations: { [args.target]: preparation } }
  const inputPath = path.join(work, 'stage-input.json'); writeJson(inputPath, input)
  phase = 'native-producer'
  const result = await producer.runProducer(inputPath, env, true)
  if (result.status !== 'staged' || result.reporterExitCode !== 0 || result.reporterExitObserved !== true ||
      result.supervisorOwnedTreeEmpty !== true) fail('STAGE_NATIVE_NOT_ACCEPTED')
  phase = 'evidence-copy'
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
    files: fs.readdirSync(evidence).sort().map(name => ({ path: name, sha256: hash(name === 'formal-lock.json' ? readFormalLock(path.join(evidence, name)) : read(path.join(evidence, name))), size: fs.statSync(path.join(evidence, name)).size })) })
  return result
  } catch (error) {
    if (error && typeof error === 'object') error.stagePhase = phase
    throw error
  }
}
if (require.main === module) {
  run(options(process.argv.slice(2))).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(error => {
    process.stderr.write(JSON.stringify(stageFailure(error)) + '\n'); process.exitCode = 1
  })
}
module.exports = { options, sourceProof, verifyCandidateOrigin, assetPlan, owned, childEnvironment, EXTRACT, CACHE, readFormalLock, FORMAL_LOCK_BYTE_CAP, stageFailure, run }
