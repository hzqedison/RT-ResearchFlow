'use strict'

// Production host for the existing seal API. The authorization pins belong in
// reviewed, protected release configuration, never in a preparation fragment.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const https = require('node:https')
const Module = require('node:module')
const ENTRY = 'scripts/seal-private-python-runtime-producer.cjs'
const VERIFIERS = 'scripts/private-runtime-release-verifiers.cjs'
const SEAL = 'scripts/seal-private-python-runtime.cjs'
const NATIVE_REPORTER = 'scripts/report-private-runtime-native-bootstrap.py'
const NATIVE_HOST = 'resources/private-runtime-owned-job-host.cs'
const ROOT = path.resolve(__dirname, '..')
const TARGETS = ['win32-x64', 'darwin-arm64', 'darwin-x64']
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const blobOid = bytes => crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')
function fail(code, status = 'invalid') {
  const error = new Error(code); error.code = code; error.sealStatus = status; throw error
}
function relative(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') ||
      name.split('/').some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part))) fail('INVALID_RELATIVE_PATH')
  return name
}
function parse(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { fail('INVALID_JSON') }
}
function below(root, filename) {
  const base = fs.realpathSync(root), resolved = path.resolve(filename)
  const rel = path.relative(base, resolved)
  if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) fail('INPUT_ESCAPES_ROOT')
  let cursor = base
  for (const part of rel.split(path.sep)) {
    cursor = path.join(cursor, part)
    if (fs.lstatSync(cursor).isSymbolicLink()) fail('INPUT_SYMLINK')
  }
  const actual = fs.realpathSync(resolved)
  if (actual !== resolved) fail('INPUT_PATH_IDENTITY')
  return resolved
}
function readFile(root, filename, cap = 8 * 1024 * 1024) {
  const resolved = below(root, filename), fd = fs.openSync(resolved, 'r')
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > cap) fail('INPUT_FILE_INVALID')
    const bytes = fs.readFileSync(fd)
    if (bytes.length !== stat.size || bytes.length > cap) fail('INPUT_FILE_CHANGED')
    return bytes
  } finally { fs.closeSync(fd) }
}
function protectedPins(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || !env.RUNNER_TEMP) fail('PROTECTED_CONTEXT_REQUIRED', 'pending')
  const pins = {
    repository: env.GITHUB_REPOSITORY,
    repositoryId: Number(env.RT_RUNTIME_RELEASE_AUTHORIZATION_REPOSITORY_ID),
    commit: env.RT_RUNTIME_RELEASE_AUTHORIZATION_COMMIT,
    path: env.RT_RUNTIME_RELEASE_AUTHORIZATION_PATH,
    sha256: env.RT_RUNTIME_RELEASE_AUTHORIZATION_SHA256,
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pins.repository || '') ||
      !Number.isSafeInteger(pins.repositoryId) || pins.repositoryId < 1 ||
      !/^[a-f0-9]{40}$/.test(pins.commit || '') || !/^[a-f0-9]{64}$/.test(pins.sha256 || '')) fail('AUTHORIZATION_PINS_REQUIRED', 'pending')
  relative(pins.path)
  if (!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || '') ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) fail('RELEASE_RUN_IDENTITY_REQUIRED', 'pending')
  return pins
}
function githubReader(token) {
  if (token !== undefined && (typeof token !== 'string' || /[\r\n]/.test(token))) fail('AUTHORITY_TOKEN_INVALID')
  return {
    readJson(apiPath) {
      if (!/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/|$)/.test(apiPath) || /[\\#\s]/.test(apiPath)) fail('AUTHORITY_ENDPOINT_INVALID')
      return new Promise((resolve, reject) => {
        const chunks = []; let size = 0, response, finished = false
        const timer = setTimeout(() => stop('AUTHORITY_DEADLINE'), 15000)
        const request = https.request({ hostname: 'api.github.com', port: 443, path: apiPath, method: 'GET', rejectUnauthorized: true,
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'RT-ResearchFlow-release-seal',
            'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, res => {
          response = res
          if (res.statusCode !== 200) return stop('AUTHORITY_UNAVAILABLE')
          res.on('error', () => stop('AUTHORITY_UNAVAILABLE'))
          res.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) stop('AUTHORITY_RESPONSE_CAP'); else chunks.push(chunk) })
          res.on('end', () => {
            if (finished) return
            finished = true; clearTimeout(timer)
            try { resolve(parse(Buffer.concat(chunks))) } catch (error) { reject(error) }
          })
        })
        function stop(code) {
          if (finished) return
          finished = true; clearTimeout(timer); response?.destroy(); request.destroy()
          const error = new Error(code); error.code = code; error.sealStatus = 'pending'; reject(error)
        }
        request.on('error', () => stop('AUTHORITY_UNAVAILABLE')); request.end()
      })
    },
  }
}

// Exported for isolated transport fixtures. runProducer always constructs the
// fixed official HTTPS reader itself; candidate JSON cannot supply a transport.
async function readAuthorization(pins, authority) {
  const prefix = '/repos/' + pins.repository
  const repository = await authority.readJson(prefix)
  if (repository.id !== pins.repositoryId || repository.full_name !== pins.repository) fail('AUTHORIZATION_REPOSITORY_MISMATCH')
  const commit = await authority.readJson(prefix + '/git/commits/' + pins.commit)
  if (commit.sha !== pins.commit || !/^[a-f0-9]{40}$/.test(commit.tree?.sha || '')) fail('AUTHORIZATION_COMMIT_MISMATCH')
  let tree = commit.tree.sha, member
  const parts = relative(pins.path).split('/')
  for (let index = 0; index < parts.length; index++) {
    const response = await authority.readJson(prefix + '/git/trees/' + tree)
    if (response.sha !== tree || response.truncated === true || !Array.isArray(response.tree)) fail('AUTHORIZATION_TREE_INCOMPLETE', 'pending')
    const matches = response.tree.filter(item => item.path === parts[index])
    if (matches.length !== 1) fail('AUTHORIZATION_MEMBER_MISMATCH')
    member = matches[0]
    if (index < parts.length - 1) {
      if (member.type !== 'tree' || member.mode !== '040000') fail('AUTHORIZATION_MEMBER_TYPE')
      tree = member.sha
    }
  }
  if (member.type !== 'blob' || !['100644', '100755'].includes(member.mode)) fail('AUTHORIZATION_MEMBER_TYPE')
  const blob = await authority.readJson(prefix + '/git/blobs/' + member.sha)
  const encoded = typeof blob.content === 'string' ? blob.content.replace(/[\r\n]/g, '') : ''
  if (blob.sha !== member.sha || blob.encoding !== 'base64' || !encoded || encoded.length > 3 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail('AUTHORIZATION_BLOB_INVALID')
  const bytes = Buffer.from(encoded, 'base64')
  if (blob.size !== bytes.length || blobOid(bytes) !== member.sha || hash(bytes) !== pins.sha256) fail('AUTHORIZATION_BYTES_MISMATCH')
  const record = parse(bytes)
  if (record.kind !== 'rt-private-runtime-release-authorization-v1' || record.schemaVersion !== 1 || record.decision !== 'approved' ||
      record.trustedContext?.repositoryId !== pins.repositoryId || record.trustedContext?.repositoryFullName !== pins.repository ||
      !Array.isArray(record.assemblyTargets) || !record.assemblyTargets.length || new Set(record.assemblyTargets).size !== record.assemblyTargets.length ||
      record.assemblyTargets.some(target => !TARGETS.includes(target))) fail('AUTHORIZATION_RECORD_INVALID')
  return record
}
function verifiedLoader(repositoryRoot, members) {
  const loaded = new Map(), base = fs.realpathSync(repositoryRoot)
  function load(name) {
    relative(name)
    if (!members.has(name)) fail('EXECUTED_MODULE_NOT_VERIFIED')
    if (loaded.has(name)) return loaded.get(name).exports
    const bytes = readFile(base, path.join(base, name))
    if (hash(bytes) !== members.get(name)) fail('EXECUTED_MODULE_CHANGED')
    const filename = path.join(base, name), child = new Module(filename, module)
    child.filename = filename
    child.require = request => {
      if (request.startsWith('node:') && Module.isBuiltin(request)) return require(request)
      if (!request.startsWith('.')) fail('UNVERIFIED_MODULE_DEPENDENCY')
      const dependency = path.relative(base, path.resolve(path.dirname(filename), request)).split(path.sep).join('/')
      return load(dependency)
    }
    loaded.set(name, child)
    child._compile(new TextDecoder('utf-8', { fatal: true }).decode(bytes), filename)
    child.loaded = true
    return child.exports
  }
  return load
}
function archiveReader(input, trust, temporaryRoot) {
  if (!input.artifactArchives || typeof input.artifactArchives !== 'object' || Array.isArray(input.artifactArchives)) fail('ARTIFACT_ARCHIVES_REQUIRED', 'pending')
  return async ({ artifactId }) => {
    const producers = trust.producers.filter(item => item.fragmentArtifactId === artifactId)
    if (!producers.length || new Set(producers.map(item => item.artifactArchiveSha256)).size !== 1) fail('UNAUTHORIZED_ARTIFACT')
    const filename = input.artifactArchives[String(artifactId)]
    if (typeof filename !== 'string') fail('ARTIFACT_ARCHIVE_MISSING', 'pending')
    const bytes = readFile(temporaryRoot, filename, 128 * 1024 * 1024)
    if (hash(bytes) !== producers[0].artifactArchiveSha256) fail('ARTIFACT_ARCHIVE_BYTES_MISMATCH')
    return bytes
  }
}
function verifyStagingInputPins(bytes, approved) {
  const names = ['formalLockSha256', 'candidateLockSha256', 'fragmentSha256', 'handoffSha256']
  if (!approved || names.some(name => !/^[a-f0-9]{64}$/.test(approved[name] || ''))) fail('STAGING_INPUT_AUTHORIZATION_REQUIRED', 'pending')
  for (const name of names) if (!Buffer.isBuffer(bytes[name]) || hash(bytes[name]) !== approved[name]) fail('STAGING_APPROVED_INPUT_BYTES_MISMATCH')
}
function verifiedNativeHostSource(pin, sourceMembers, repositoryRoot = ROOT) {
  if (!pin) fail('STAGING_NATIVE_HOST_PIN_REQUIRED', 'pending')
  if (pin.path !== NATIVE_HOST || !/^[a-f0-9]{64}$/.test(pin.sha256 || '') ||
      !(sourceMembers instanceof Map) || sourceMembers.get(pin.path) !== pin.sha256) fail('STAGING_NATIVE_HOST_SOURCE_NOT_VERIFIED')
  const filename = path.join(fs.realpathSync(repositoryRoot), pin.path)
  if (hash(readFile(repositoryRoot, filename)) !== pin.sha256) fail('STAGING_NATIVE_HOST_SOURCE_CHANGED')
  return { path: filename, sha256: pin.sha256 }
}
async function resolveStageProducer({ policy, target, trustedContext, run, runId, attempt, authority }) {
  const keys = ['target', 'workflowPath', 'jobName', 'allowedEvents']
  if (!policy || Object.keys(policy).some(key => !keys.includes(key)) || policy.target !== target ||
      target !== process.platform + '-' + process.arch || !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(policy.workflowPath || '') ||
      typeof policy.jobName !== 'string' || !policy.jobName.trim() || /[\x00-\x1f]/.test(policy.jobName) ||
      !Array.isArray(policy.allowedEvents) || !policy.allowedEvents.length ||
      policy.allowedEvents.some(event => !['push', 'workflow_dispatch', 'workflow_run'].includes(event))) fail('STAGE_PRODUCER_POLICY_INVALID')
  if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(attempt) || attempt < 1 ||
      run?.id !== runId || run.run_attempt !== attempt || run.repository?.id !== trustedContext.repositoryId ||
      run.head_repository?.id !== trustedContext.repositoryId || run.head_sha !== trustedContext.approvedSourceCommit ||
      run.path !== policy.workflowPath || !policy.allowedEvents.includes(run.event) ||
      run.status !== 'in_progress' || run.conclusion != null) fail('STAGING_CURRENT_RUN_MISMATCH')
  const jobs = await authority.readJson('/repos/' + trustedContext.repositoryFullName + '/actions/runs/' + runId +
    '/attempts/' + attempt + '/jobs?per_page=100')
  // Never select the first match from a truncated or paginated job list. These
  // reviewed three-target workflows are bounded; >100 jobs requires a new review.
  if (!Number.isSafeInteger(jobs.total_count) || jobs.total_count < 1 || jobs.total_count > 100 ||
      !Array.isArray(jobs.jobs) || jobs.jobs.length !== jobs.total_count) fail('STAGING_JOB_LIST_INCOMPLETE', 'pending')
  const matches = jobs.jobs.filter(job => job.name === policy.jobName)
  if (matches.length !== 1) fail('STAGING_JOB_NOT_UNIQUE')
  const job = matches[0]
  if (!Number.isSafeInteger(job.id) || job.id < 1 || job.run_id !== runId || job.run_attempt !== attempt ||
      job.head_sha !== trustedContext.approvedSourceCommit || job.status !== 'in_progress' || job.conclusion != null) fail('STAGING_CURRENT_JOB_MISMATCH')
  return { target, runId, attempt, workflowPath: policy.workflowPath, jobId: job.id, jobName: job.name }
}
async function runProducer(inputPath, env = process.env, staging = false) {
  const pins = protectedPins(env), temporaryRoot = fs.realpathSync(env.RUNNER_TEMP)
  const authority = githubReader(env.GITHUB_TOKEN)
  const authorization = await readAuthorization(pins, authority)
  const input = parse(readFile(temporaryRoot, inputPath))
  const allowed = new Set(['sourceProof', 'obligationsProof', 'lockPath', 'preparedRoot', 'assetsRoot', 'preparations', 'artifactArchives'])
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.has(key))) fail('UNTRUSTED_INPUT_AUTHORITY')
  const trust = structuredClone(authorization.trustedContext), target = process.platform + '-' + process.arch
  if (!authorization.assemblyTargets.includes(target) || (trust.assemblyTarget !== undefined && trust.assemblyTarget !== target)) fail('ASSEMBLY_TARGET_NOT_AUTHORIZED')
  trust.assemblyTarget = target
  const consumer = staging ? authorization.stageProducerPolicies?.[target] : authorization.consumer
  if (trust.approvedSourceCommit !== env.GITHUB_SHA ||
      (staging ? !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(consumer?.workflowPath || '') : consumer?.workflowPath !== '.github/workflows/release.yml') ||
      !Array.isArray(consumer.allowedEvents) || !consumer.allowedEvents.length ||
      consumer.allowedEvents.some(event => !['push', 'workflow_dispatch', 'workflow_run'].includes(event))) fail('RELEASE_CONSUMER_NOT_AUTHORIZED')
  const run = await authority.readJson('/repos/' + pins.repository + '/actions/runs/' + env.GITHUB_RUN_ID + '/attempts/' + env.GITHUB_RUN_ATTEMPT)
  if (run.id !== Number(env.GITHUB_RUN_ID) || run.run_attempt !== Number(env.GITHUB_RUN_ATTEMPT) ||
      run.repository?.id !== pins.repositoryId || run.head_repository?.id !== pins.repositoryId ||
      run.head_sha !== trust.approvedSourceCommit || run.path !== consumer.workflowPath || !consumer.allowedEvents.includes(run.event)) fail('RELEASE_CONSUMER_IDENTITY_MISMATCH')
  if (!Array.isArray(trust.requiredSourceFiles) || [ENTRY, VERIFIERS, SEAL].some(name => !trust.requiredSourceFiles.includes(name))) fail('PRODUCER_SOURCE_ALLOWLIST_MISSING')
  const entrypoints = authorization.entrypoints
  if (!entrypoints || [ENTRY, VERIFIERS, SEAL].some(name => !/^[a-f0-9]{64}$/.test(entrypoints[name] || ''))) fail('PRODUCER_SOURCE_PINS_MISSING')
  for (const name of [ENTRY, VERIFIERS, SEAL]) if (hash(readFile(ROOT, path.join(ROOT, name))) !== entrypoints[name]) fail('PRODUCER_SOURCE_BYTES_MISMATCH')
  if (entrypoints[SEAL] !== trust.approvedSealImplementationSha256) fail('SEAL_IMPLEMENTATION_PIN_MISMATCH')
  // Only the seal bootstrap itself is loaded on the independent authorization
  // pin. All other repository modules wait for official Git membership checks.
  const seal = verifiedLoader(ROOT, new Map([[SEAL, entrypoints[SEAL]]]))(SEAL)
  const source = await seal.verifySourceAuthority(trust, input.sourceProof, ROOT, authority)
  for (const name of [ENTRY, VERIFIERS, SEAL]) if (source.verified.get(name) !== entrypoints[name]) fail('PRODUCER_GIT_SOURCE_MISMATCH')
  if (!source.verified.has(consumer.workflowPath)) fail('CONSUMER_WORKFLOW_SOURCE_NOT_VERIFIED')
  for (const name of ['lockPath', 'preparedRoot', 'assetsRoot']) {
    if (typeof input[name] !== 'string') fail('PREPARATION_INPUT_MISSING', 'pending')
    below(temporaryRoot, input[name])
  }
  for (const targetName of staging ? [target] : TARGETS) {
    const preparation = input.preparations?.[targetName]
    for (const name of staging ? ['candidateLockPath', 'fragmentPath', 'handoffPath'] : ['candidateLockPath', 'fragmentPath', 'handoffPath', 'nativeReportPath']) {
      if (typeof preparation?.[name] !== 'string') fail('THREE_NATIVE_PREPARATIONS_REQUIRED', 'pending')
      below(temporaryRoot, preparation[name])
    }
  }
  const verifiers = verifiedLoader(ROOT, source.verified)(VERIFIERS)
  if (staging) {
    // Only stage derives the currently executing identity from official API
    // facts. Final seal continues to use the three frozen completed producers
    // from authorization.trustedContext, including their exact artifact pins.
    trust.producers = [await resolveStageProducer({ policy: consumer, target, trustedContext: trust, run,
      runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT), authority })]
  }
  const createCallbacks = staging ? verifiers.createNativeBootstrapVerifier : verifiers.createReleaseVerifiers
  const callbacks = createCallbacks({ repositoryRoot: ROOT, sourceMembers: source.verified,
    trustedContext: trust, verifierPolicy: authorization.verifierPolicy })
  if (staging) {
    const producer = trust.producers[0]
    const load = verifiedLoader(ROOT, source.verified)
    const foundation = load('electron/shared/privatePythonRuntimeManifest.cjs')
    const { assemble } = load('scripts/bundle-private-python-runtime.cjs')
    const lockBytes = readFile(temporaryRoot, input.lockPath), lock = foundation.validateLock(parse(lockBytes))
    const preparation = input.preparations[target]
    const fragmentBytes = readFile(temporaryRoot, preparation.fragmentPath)
    const candidateLockBytes = readFile(temporaryRoot, preparation.candidateLockPath)
    const handoffBytes = readFile(temporaryRoot, preparation.handoffPath)
    verifyStagingInputPins({ formalLockSha256: lockBytes, candidateLockSha256: candidateLockBytes,
      fragmentSha256: fragmentBytes, handoffSha256: handoffBytes }, authorization.stagingInputs?.[target])
    const fragment = parse(fragmentBytes)
    if (fragment.target !== target || fragment.sourceSha256 !== trust.sourceSnapshotSha256 ||
        fragment.preparationPolicySha256 !== trust.approvedPolicySha256 || fragment.inputLockSha256 !== hash(candidateLockBytes) ||
        fragment.treeComplete !== true) fail('STAGING_FRAGMENT_BINDING')
    const reporter = authorization.verifierPolicy.nativeReporters[target]
    if (reporter.path !== NATIVE_REPORTER || source.verified.get(reporter.path) !== reporter.sha256 ||
        hash(readFile(ROOT, path.join(ROOT, reporter.path))) !== reporter.sha256) fail('STAGING_REPORTER_SOURCE_NOT_VERIFIED')
    const supervisorPin = authorization.verifierPolicy.stagingSupervisors?.[target]
    const ownershipMode = process.platform === 'win32' ? 'windows-job' : 'posix-owned-session'
    if (!supervisorPin) fail('STAGING_OUTER_SUPERVISOR_REQUIRED', 'pending')
    if (supervisorPin.ownershipMode !== ownershipMode || !supervisorPin.path?.endsWith('.cjs') ||
        source.verified.get(supervisorPin.path) !== supervisorPin.sha256 ||
        hash(readFile(ROOT, path.join(ROOT, supervisorPin.path))) !== supervisorPin.sha256) fail('STAGING_SUPERVISOR_SOURCE_NOT_VERIFIED')
    // Verify the independent native source pin BEFORE loading the compiler host.
    // The supervisor must also recheck these bytes immediately before compiling.
    const nativeHostSource = process.platform === 'win32'
      ? verifiedNativeHostSource(supervisorPin.nativeHostSource, source.verified) : undefined
    const supervisor = load(supervisorPin.path)
    if (typeof supervisor.runOwnedPrivatePython !== 'function') fail('STAGING_SUPERVISOR_IMPLEMENTATION_REQUIRED', 'pending')
    const stagingRoot = fs.mkdtempSync(path.join(temporaryRoot, 'rt-preseal-\u8fd0\u884c-'))
    // The ordinary assembler keeps ALL real policy/license checks. This path
    // removes the final-seal dependency, not the approval dependency. No flag or
    // license status is rewritten, and nothing is copied to release bundles.
    const assembly = assemble({ lockPath: input.lockPath, preparedRoot: input.preparedRoot,
      assetsRoot: input.assetsRoot, outputRoot: stagingRoot, target })
    const runtimeRoot = path.join(stagingRoot, target)
    const manifestPath = path.join(runtimeRoot, 'manifest.json'), manifestBytes = readFile(stagingRoot, manifestPath)
    const manifest = parse(manifestBytes)
    foundation.validateRuntimeTree(runtimeRoot, manifest, target)
    // The existing API performs the full candidate/handoff/source/blueprint
    // projection before its final report check. Its sole expected missing-report
    // stop is permitted here; any earlier mismatch still prevents execution.
    try {
      seal.verifyPreparationBinding({ target, manifest: lock.platforms[target], fragmentBytes,
        candidateLockBytes, handoffBytes, nativeReportBytes: undefined, preparedRoot: stagingRoot,
        sourceMembers: source.verified, trust, foundation, formalLockSha256: hash(lockBytes) })
      fail('STAGING_REPORT_GATE_DID_NOT_STOP')
    } catch (error) {
      if (error.sealStatus !== 'pending' || error.message !== 'NATIVE_BOOTSTRAP_REPORT_MISSING' || error.evidenceId !== target) throw error
    }
    const contract = verifiers.buildPreSealBootstrapContract({ stagingRoot, runtimeRoot, manifest,
      manifestSha256: hash(manifestBytes), fragment, fragmentSha256: hash(fragmentBytes),
      candidateLockSha256: hash(candidateLockBytes), trustedContext: trust, sourceMembers: source.verified,
      repositoryRoot: ROOT, verifierPolicy: authorization.verifierPolicy, environment: env })
    const contractPath = path.join(stagingRoot, 'stage-contract.json')
    fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + '\n', { flag: 'wx' })
    // No direct spawnSync fallback: its timeout kills only the reporter. The
    // separately reviewed supervisor must own the OUTER job/session and clean
    // the entire tree on deadline, byte cap, cancellation and normal exit.
    const execution = await supervisor.runOwnedPrivatePython({ executable: contract.pythonExecutable,
      args: ['-X', 'utf8', '-I', '-S', '-B', path.join(ROOT, reporter.path), '--pre-seal-bootstrap-contract', contractPath],
      cwd: contract.reporterCwd, env: contract.reporterEnvironment, input: Buffer.alloc(0),
      shell: false, windowsHide: true, deadlineMs: 300000, stdoutByteCap: 1024 * 1024,
      stderrByteCap: 8192, ownershipMode,
      // Only the source-pinned pre-seal chain inherits the supervisor's session.
      // The supervisor derives the root PID; input/env cannot supply that grant.
      ...(process.platform === 'darwin' ? { preSealPosixInherited: true } : {}),
      ...(nativeHostSource ? { nativeHostSource } : {}) })
    if (!execution || execution.error || execution.exitCode !== 0 || execution.signal || execution.exitObserved !== true ||
        execution.ownedTreeEmpty !== true || execution.ownershipMode !== ownershipMode ||
        !Number.isSafeInteger(execution.pid) || execution.pid < 1 ||
        !Buffer.isBuffer(execution.stdout) || !Buffer.isBuffer(execution.stderr) || execution.stdout.length > 1024 * 1024 ||
        execution.stderr.length || !execution.stdout.length) fail('STAGING_NATIVE_REPORTER_FAILED')
    const nativeReportBytes = execution.stdout
    const binding = seal.verifyPreparationBinding({ target, manifest: lock.platforms[target], fragmentBytes,
      candidateLockBytes, handoffBytes, nativeReportBytes, preparedRoot: stagingRoot,
      sourceMembers: source.verified, trust, foundation, formalLockSha256: hash(lockBytes) })
    const accepted = await callbacks.verifyNativeBootstrap({ target, reportBytes: nativeReportBytes,
      expectedBinding: binding.binding, producer })
    if (accepted.status !== 'accepted' || accepted.reportSha256 !== hash(nativeReportBytes)) fail('STAGING_NATIVE_REPORT_NOT_ACCEPTED')
    // Repeat the real tree/source checks after native code has executed. A native
    // probe changing packaged bytes cannot be repaired by updating the ledger.
    foundation.validateRuntimeTree(runtimeRoot, manifest, target)
    await seal.verifySourceAuthority(trust, input.sourceProof, ROOT, authority)
    const reportPath = path.join(stagingRoot, 'native-bootstrap-report.json')
    fs.writeFileSync(reportPath, nativeReportBytes, { flag: 'wx' })
    return { status: 'staged', stage: 'pre-seal-native-bootstrap', releaseEligible: false, target,
      stagingRoot, runtimeRoot, contractPath, reportPath, reportSha256: hash(nativeReportBytes),
      bindingSha256: accepted.bindingSha256, manifestSha256: assembly.manifestSha256,
      formalManifestIdentitySha256: binding.binding.formalManifestIdentitySha256,
      reporterExitCode: execution.exitCode, reporterExitObserved: execution.exitObserved, supervisorOwnedTreeEmpty: execution.ownedTreeEmpty,
      producerArtifactSuccessVerified: false, finalSealAccepted: false,
      pending: ['Completed successful three-target producer artifacts and independent final seal are still required'] }
  }
  return seal.sealPrivateRuntime({ repositoryRoot: ROOT, trustedContext: trust, sourceProof: input.sourceProof,
    obligationsProof: input.obligationsProof, lockPath: input.lockPath, preparedRoot: input.preparedRoot,
    assetsRoot: input.assetsRoot, preparations: input.preparations,
    outputRoot: path.join(ROOT, 'resources/python-runtime/bundles') },
  { ...authority, readArtifactArchive: archiveReader(input, trust, temporaryRoot), ...callbacks })
}
function options(argv) {
  if (argv.length !== 2 || argv[0] !== '--input' || !argv[1]) fail('USAGE_INPUT_REQUIRED')
  return argv[1]
}
if (require.main === module) {
  const args = process.argv.slice(2), staging = args[0] === '--stage'
  Promise.resolve().then(() => runProducer(options(staging ? args.slice(1) : args), process.env, staging)).then(result => {
    process.stdout.write(JSON.stringify(result) + '\n')
    process.exitCode = ['accepted', 'staged'].includes(result.status) ? 0 : result.status === 'pending' ? 2 : 1
  }).catch(error => {
    const status = error.sealStatus === 'pending' || /^PRIVATE_RUNTIME_PENDING(?:\b|:)/.test(error.message || '') ? 'pending' : 'invalid'
    // Do not print transport errors, paths, credential-bearing input or stack.
    const code = /^[A-Z][A-Z0-9_]+$/.test(error.code || '') ? error.code : status === 'pending' ? 'PRIVATE_RUNTIME_PENDING' : 'PRODUCER_ENTRY_FAILED'
    process.stdout.write(JSON.stringify({ status, releaseEligible: false, reasons: [{ code }] }) + '\n')
    process.exitCode = status === 'pending' ? 2 : 1
  })
}
module.exports = { runProducer, readAuthorization, protectedPins, githubReader, verifiedLoader, archiveReader, verifyStagingInputPins, verifiedNativeHostSource, resolveStageProducer, options }
