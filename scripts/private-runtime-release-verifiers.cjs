'use strict'

// Loaded only after the producer has checked actual official Git blob bytes.
// These callbacks grant no authority to a candidate's self-reported approvals.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const FORMATS = ['source-asset-pin', 'binary-source-correspondence', 'source-access-notice',
  'relink-inputs', 'native-relink-result', 'issuer-entitlement-review', 'redist-component-map',
  'recipient-terms-delivery', 'rights-scope-review', 'target-absence-evidence']
const TARGETS = ['win32-x64', 'darwin-arm64', 'darwin-x64']
const OBLIGATION_POLICY = 'resources/python-runtime/distribution-obligations.policy.json'
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const digest = value => hash(Buffer.from(canonical(value)))
function reject(code) { const error = new Error(code); error.code = code; error.sealStatus = 'invalid'; throw error }
function safeBytes(root, name, cap = 16 * 1024 * 1024) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part))) reject('VERIFIER_PATH_INVALID')
  const base = fs.realpathSync(root), filename = path.resolve(base, name)
  if (!filename.startsWith(base + path.sep)) reject('VERIFIER_PATH_ESCAPE')
  let cursor = base
  for (const part of name.split('/')) { cursor = path.join(cursor, part); if (fs.lstatSync(cursor).isSymbolicLink()) reject('VERIFIER_PATH_SYMLINK') }
  const fd = fs.openSync(filename, 'r')
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > cap) reject('VERIFIER_FILE_INVALID')
    const bytes = fs.readFileSync(fd)
    if (bytes.length !== stat.size || bytes.length > cap) reject('VERIFIER_FILE_CHANGED')
    return bytes
  } finally { fs.closeSync(fd) }
}
function parse(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { reject('VERIFIER_JSON_INVALID') }
}
function buildPreSealBootstrapContract({ stagingRoot, runtimeRoot, manifest, manifestSha256, fragment, fragmentSha256,
  candidateLockSha256, trustedContext, sourceMembers, repositoryRoot, verifierPolicy, environment = process.env }) {
  const target = manifest.platform + '-' + manifest.arch
  if (target !== process.platform + '-' + process.arch || trustedContext.assemblyTarget !== target ||
      manifest.complete !== true || manifest.kind !== 'rt-private-python-runtime' || !/^[a-f0-9]{64}$/.test(manifestSha256 || '') ||
      !(sourceMembers instanceof Map) || !Array.isArray(manifest.files)) reject('STAGING_MANIFEST_INVALID')
  const root = fs.realpathSync(runtimeRoot), stage = fs.realpathSync(stagingRoot)
  if (root !== path.join(stage, target) || !stage.startsWith(fs.realpathSync(environment.RUNNER_TEMP) + path.sep) ||
      fragment.sourceSha256 !== trustedContext.sourceSnapshotSha256 || fragment.preparationPolicySha256 !== trustedContext.approvedPolicySha256) reject('STAGING_ROOT_BINDING')
  const producer = trustedContext.producers?.find(row => row.target === target)
  const reporter = verifierPolicy.nativeReporters?.[target]
  if (!producer || !reporter || sourceMembers.get(reporter.path) !== reporter.sha256) reject('STAGING_REPORTER_BINDING')
  const manifestBinding = { target, sourceSnapshotSha256: fragment.sourceSha256, candidateLockSha256, fragmentSha256,
    inventorySha256: fragment.inventorySha256, formalManifestIdentitySha256: digest(manifest),
    pythonAssetSha256: manifest.python.asset.sha256, nodeAssetSha256: manifest.node.asset.sha256,
    bootstrapSha256: sourceMembers.get('resources/python-runtime/bootstrap.py'), validatorSha256: manifest.dependencyAuditValidator.sha256,
    miniRacerAdapterSha256: sourceMembers.get('resources/python-runtime/miniracer_unicode_adapter.py'),
    pywencaiAdapterSha256: sourceMembers.get('resources/python-runtime/pywencai_adapter.py'),
    providers: Object.fromEntries(Object.entries(manifest.providers).map(([name, provider]) => [name,
      { version: provider.version, dependencyAuditSha256: provider.dependencyAudit.sha256, wheelsSha256: digest(provider.wheels) }])) }
  const pythonExecutable = path.join(root, manifest.python.executable), nodeExecutable = path.join(root, manifest.node.executable)
  const bootstrap = path.join(root, manifest.bootstrap)
  const applicationSources = [
    ['bootstrap.py', 'resources/python-runtime/bootstrap.py'],
    ['miniracer_unicode_adapter.py', 'resources/python-runtime/miniracer_unicode_adapter.py'],
    ['providers/pywencai/pywencai_adapter.py', 'resources/python-runtime/pywencai_adapter.py'],
    ['private_runtime_manifest.cjs', 'electron/shared/privatePythonRuntimeManifest.cjs'],
  ]
  for (const [name, sourceName] of applicationSources) {
    const expected = sourceMembers.get(sourceName), row = manifest.files.find(item => item.path === name)
    if (!/^[a-f0-9]{64}$/.test(expected || '') || !row || row.kind !== 'file' || row.sha256 !== expected ||
        hash(safeBytes(root, name)) !== expected) reject('STAGING_APPLICATION_SOURCE_BYTES')
  }
  if (manifest.bootstrap !== 'bootstrap.py') reject('STAGING_BOOTSTRAP_PATH')
  for (const name of [manifest.python.executable, manifest.node.executable, manifest.bootstrap]) {
    const row = manifest.files.find(item => item.path === name)
    if (!row || row.kind !== 'file' || hash(safeBytes(root, name, 128 * 1024 * 1024)) !== row.sha256) reject('STAGING_EXECUTABLE_BYTES')
  }
  function isolatedEnvironment(cache) {
    const tmp = path.join(cache, 'tmp'); fs.mkdirSync(tmp, { recursive: true })
    const env = {}
    for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC']) if (environment[key]) env[key] = environment[key]
    return { ...env, PATH: path.dirname(nodeExecutable), HOME: cache, USERPROFILE: cache,
      LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1',
      XDG_CACHE_HOME: cache, TMPDIR: tmp, TEMP: tmp, TMP: tmp, NODE_OPTIONS: '', NODE_PATH: '', PYTHONPATH: '' }
  }
  const invocations = []
  for (const provider of ['akshare', 'mootdx', 'pywencai']) {
    const pin = verifierPolicy.bootstrapSmokes?.[target]?.[provider]
    if (!pin || sourceMembers.get(pin.path) !== pin.sha256) reject('STAGING_SMOKE_SOURCE_NOT_VERIFIED')
    const bytes = safeBytes(repositoryRoot, pin.path, 65536)
    if (hash(bytes) !== pin.sha256) reject('STAGING_SMOKE_SOURCE_CHANGED')
    let script
    try { script = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { reject('STAGING_SMOKE_SOURCE_ENCODING') }
    if (!script || script.includes('\0')) reject('STAGING_SMOKE_SOURCE_INVALID')
    const cache = path.join(stage, 'worker-cache', provider), env = isolatedEnvironment(cache)
    if (provider === 'mootdx') env.RT_MOOTDX_CACHE_ROOT = cache
    invocations.push({ provider, executable: pythonExecutable,
      args: ['-X', 'utf8', '-I', '-S', '-B', bootstrap, path.join(root, 'manifest.json'), provider, manifestSha256],
      input: JSON.stringify({ script, request: { operation: 'status' } }), cwd: cache, env,
      smokeSource: { path: pin.path, sha256: pin.sha256 } })
  }
  const reporterCwd = path.join(stage, 'reporter-cache'), reporterEnvironment = isolatedEnvironment(reporterCwd)
  return { schemaVersion: 1, kind: 'rt-private-python-pre-seal-bootstrap-contract-v1', releaseEligible: false,
    target, runtimeRoot: root, manifestPath: path.join(root, 'manifest.json'), manifestSha256,
    expectedBinding: manifestBinding, reporter, producer: { runId: producer.runId, attempt: producer.attempt,
      jobId: producer.jobId, sourceCommit: trustedContext.approvedSourceCommit },
    pythonExecutable, reporterCwd, reporterEnvironment, invocationFlags: ['-X', 'utf8', '-I', '-S', '-B'], invocations,
    reportKind: 'rt-private-python-native-bootstrap-evidence-v1', reportObservationMethod: 'owned-process-exit-v1',
    ownershipContract: { windows: 'Assign a KILL_ON_JOB_CLOSE job before giving each worker stdin',
      posix: 'Own and clean each worker process group on success, failure, deadline and reporter cancellation',
      evidence: 'Record observed worker and private Node PIDs/exits; do not construct successful synthetic observations' } }
}
// Native staging is non-release evidence production. It must verify real source
// pins and owned process observations, but cannot depend on a final distribution
// proof that is assembled only after those observations exist. Final release
// continues through createReleaseVerifiers and all of its obligation gates.
function createNativeBootstrapVerifier({ repositoryRoot, sourceMembers, trustedContext, verifierPolicy }) {
  if (!(sourceMembers instanceof Map) || !trustedContext || !verifierPolicy || verifierPolicy.schemaVersion !== 1 ||
      verifierPolicy.kind !== 'rt-private-runtime-release-verifier-policy-v1') reject('VERIFIER_POLICY_REQUIRED')
  const context = structuredClone(trustedContext), policy = structuredClone(verifierPolicy), members = new Map(sourceMembers)
  if (policy.preparationPolicySha256 !== context.approvedPolicySha256 || !policy.nativeReporters) reject('VERIFIER_POLICY_BINDING')
  for (const target of TARGETS) {
    const reporter = policy.nativeReporters[target]
    if (!reporter || members.get(reporter.path) !== reporter.sha256 || !/^[a-f0-9]{64}$/.test(reporter.sha256 || '') ||
        hash(safeBytes(repositoryRoot, reporter.path)) !== reporter.sha256) reject('NATIVE_REPORTER_SOURCE_NOT_VERIFIED')
  }
  async function verifyNativeBootstrap({ target, reportBytes, expectedBinding, producer }) {
    if (!TARGETS.includes(target) || !Buffer.isBuffer(reportBytes) || reportBytes.length > 16 * 1024 * 1024) reject('NATIVE_REPORT_INVALID')
    const approvedProducer = context.producers?.find(item => item.target === target)
    if (!approvedProducer || canonical(producer) !== canonical(approvedProducer)) reject('NATIVE_PRODUCER_NOT_AUTHORIZED')
    const report = parse(reportBytes), reporter = policy.nativeReporters[target]
    const identity = { runId: approvedProducer.runId, attempt: approvedProducer.attempt, jobId: approvedProducer.jobId,
      sourceCommit: context.approvedSourceCommit }
    if (report.kind !== 'rt-private-python-native-bootstrap-evidence-v1' || canonical(report.binding) !== canonical(expectedBinding) ||
        canonical(report.producer) !== canonical(identity) || canonical(report.reporter) !== canonical(reporter) ||
        report.nativePlatform + '-' + report.nativeArch !== target || report.validatorPassed !== true || report.executableModeChecked !== true ||
        canonical(report.invocationFlags) !== canonical(['-X', 'utf8', '-I', '-S', '-B']) ||
        report.observationMethod !== 'owned-process-exit-v1' || !Array.isArray(report.results) || report.results.length !== 3 ||
        new Set(report.results.map(row => row.provider)).size !== 3) reject('NATIVE_REPORT_AUTHORITY_BINDING')
    for (const row of report.results) {
      if (!['akshare', 'mootdx', 'pywencai'].includes(row.provider) || !expectedBinding.providers?.[row.provider] ||
          !Number.isSafeInteger(row.workerPid) || row.workerPid < 1 || row.workerExitObserved !== true || row.workerExitCode !== 0 ||
          row.privateNodeExited !== true || row.ownedDescendantsExited !== true || !Array.isArray(row.ownedProcesses) ||
          !row.ownedProcesses.length || new Set(row.ownedProcesses.map(item => item.pid)).size !== row.ownedProcesses.length) reject('NATIVE_WORKER_EXIT_UNPROVED')
      let workerCount = 0
      const successfulNodePids = new Set()
      for (const child of row.ownedProcesses) {
        const start = Date.parse(child.startedAt), end = Date.parse(child.exitedAt)
        if (!Number.isSafeInteger(child.pid) || child.pid < 1 || !['worker', 'private-node', 'owned-descendant'].includes(child.role) ||
            !Number.isFinite(start) || !Number.isFinite(end) || end < start || child.exitObserved !== true || !Number.isInteger(child.exitCode)) reject('NATIVE_CHILD_EXIT_UNPROVED')
        if (child.role === 'worker') { workerCount++; if (child.pid !== row.workerPid || child.exitCode !== row.workerExitCode) reject('NATIVE_WORKER_IDENTITY_MISMATCH') }
        if (child.role === 'private-node') {
          // This report describes positive smoke only. Deliberate failure tests
          // must not be counted as evidence of a working token computation.
          if (child.exitCode !== 0) reject('NATIVE_PRIVATE_NODE_SMOKE_FAILED')
          successfulNodePids.add(child.pid)
        }
      }
      if (workerCount !== 1) reject('NATIVE_PROCESS_OBSERVATIONS_INCOMPLETE')
      if (row.provider === 'pywencai' && (row.privateNodeCheck?.kind !== 'pywencai-token-computation-v1' ||
          row.privateNodeCheck.status !== 'passed' || row.privateNodeCheck.exitCode !== 0 ||
          !successfulNodePids.has(row.privateNodeCheck.pid))) reject('NATIVE_PRIVATE_NODE_COMPUTATION_UNPROVED')
    }
    return { status: 'accepted', reportSha256: hash(reportBytes), bindingSha256: digest(expectedBinding) }
  }
  return { verifyNativeBootstrap }
}

function createReleaseVerifiers({ repositoryRoot, sourceMembers, trustedContext, verifierPolicy }) {
  if (!(sourceMembers instanceof Map) || !trustedContext || !verifierPolicy || verifierPolicy.schemaVersion !== 1 ||
      verifierPolicy.kind !== 'rt-private-runtime-release-verifier-policy-v1') reject('VERIFIER_POLICY_REQUIRED')
  const context = structuredClone(trustedContext), policy = structuredClone(verifierPolicy), members = new Map(sourceMembers)
  if (policy.preparationPolicySha256 !== context.approvedPolicySha256 || policy.obligationPolicySha256 !== context.obligationPolicySha256 ||
      !policy.nativeReporters || !Array.isArray(policy.reviewRecords)) reject('VERIFIER_POLICY_BINDING')
  if (members.get(OBLIGATION_POLICY) !== context.obligationPolicySha256 ||
      hash(safeBytes(repositoryRoot, OBLIGATION_POLICY)) !== context.obligationPolicySha256) reject('OBLIGATION_POLICY_SOURCE_CHANGED')
  for (const target of TARGETS) {
    const reporter = policy.nativeReporters[target]
    if (!reporter || members.get(reporter.path) !== reporter.sha256 || !/^[a-f0-9]{64}$/.test(reporter.sha256 || '') ||
        hash(safeBytes(repositoryRoot, reporter.path)) !== reporter.sha256) reject('NATIVE_REPORTER_SOURCE_NOT_VERIFIED')
  }
  if (new Set(policy.reviewRecords.map(record => record.path)).size !== policy.reviewRecords.length) reject('DUPLICATE_APPROVED_REVIEW_RECORD')
  const records = new Map()
  for (const pin of policy.reviewRecords) {
    if (!pin || !/^[a-f0-9]{64}$/.test(pin.sha256 || '') || members.get(pin.path) !== pin.sha256) reject('REVIEW_RECORD_SOURCE_NOT_VERIFIED')
    const bytes = safeBytes(repositoryRoot, pin.path)
    if (hash(bytes) !== pin.sha256) reject('REVIEW_RECORD_SOURCE_CHANGED')
    const record = parse(bytes)
    if (record.schemaVersion !== 1 || record.kind !== 'rt-runtime-obligation-review-record-v1' ||
        record.preparationPolicySha256 !== context.approvedPolicySha256 ||
        !Array.isArray(record.evidenceAcceptances)) reject('APPROVED_REVIEW_RECORD_INVALID')
    // R is hashed into P. R must not contain hash(P): the separately authorized
    // verifier policy pins both actual byte hashes without a circular reference.
    records.set(pin.path, { sha256: pin.sha256, record })
  }
  const { verifyNativeBootstrap } = createNativeBootstrapVerifier({ repositoryRoot,
    sourceMembers: members, trustedContext: context, verifierPolicy: policy })
  const evidenceVerifiers = Object.fromEntries(FORMATS.map(format => [format, async args => {
    const { target, manifest, asset, rule, obligation, review, evidence, preparedRoot } = args
    const authorized = records.get(rule.reviewRecord?.path)
    if (!authorized) return { status: 'pending', reason: 'APPROVED_MACHINE_REVIEW_RECORD_MISSING' }
    if (authorized.sha256 !== rule.reviewRecord.sha256 || review.reviewRecord?.authorizationCommit !== context.approvedSourceCommit ||
        review.reviewRecord?.path !== rule.reviewRecord.path || review.reviewRecord?.sha256 !== authorized.sha256 ||
        evidence.format !== format || !TARGETS.includes(target) || !manifest || manifest.platform + '-' + manifest.arch !== target) reject('OBLIGATION_REVIEW_AUTHORITY_MISMATCH')
    const expected = { target, id: obligation.id, component: asset.component, version: asset.version,
      artifactSha256: asset.artifactSha256, licenseSha256: obligation.scope.licenseSha256, decision: review.decision,
      format, evidencePath: evidence.path, evidenceSha256: evidence.sha256, payloadFiles: obligation.payloadFiles }
    const matches = authorized.record.evidenceAcceptances.filter(item => canonical(item.binding) === canonical(expected))
    if (!matches.length) return { status: 'pending', reason: 'EXACT_EVIDENCE_REVIEW_MISSING' }
    if (matches.length !== 1 || matches[0].decision !== 'approved' || matches[0].basis !== 'independent-review' ||
        !['satisfied', 'not-applicable'].includes(review.decision) ||
        (review.decision === 'not-applicable' && format !== 'target-absence-evidence' && !obligation.requiredEvidence.includes('target-absence-evidence'))) reject('OBLIGATION_EVIDENCE_NOT_APPROVED')
    const bytes = safeBytes(path.join(preparedRoot, target), evidence.path)
    if (hash(bytes) !== evidence.sha256) reject('OBLIGATION_REVIEWED_BYTES_CHANGED')
    // The semantic decision is an independently reviewed source-authorized
    // record for these exact bytes, not an "accepted" field in payload JSON.
    return { status: 'accepted', evidenceSha256: hash(bytes) }
  }]))
  return { verifyNativeBootstrap, evidenceVerifiers }
}
module.exports = { createReleaseVerifiers, createNativeBootstrapVerifier, buildPreSealBootstrapContract }
