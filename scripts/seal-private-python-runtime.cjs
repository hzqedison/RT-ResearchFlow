'use strict'

// Build-time only. A protected producer imports this API and supplies separately
// authorized roots. Candidate JSON and this module's ordinary CLI grant no trust.
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const crypto = require('node:crypto')
const Module = require('node:module')
const zlib = require('node:zlib')
const { createDistributionEvidenceReader } = require('./private-runtime-recipient-materials.cjs')
const TARGETS = ['win32-x64', 'darwin-arm64', 'darwin-x64']
const POLICY = 'resources/python-runtime/preparation.policy.json'
const RULES = 'resources/python-runtime/distribution-obligations.policy.json'
const IMPLEMENTATION = 'scripts/seal-private-python-runtime.cjs'
const PREPARATION_SOURCE = [
  'LICENSE',
  'electron/shared/privatePythonRuntimeManifest.cjs',
  'resources/python-runtime/bootstrap.py',
  'resources/python-runtime/miniracer_unicode_adapter.py',
  'resources/python-runtime/pywencai_adapter.py',
  'resources/python-runtime/reviewed-materials/fetch-runtime-license-materials-ci.py',
  'resources/python-runtime/reviewed-materials/runtime-license-materials.json',
  'scripts/build-akshare-node-wheel.py',
  'scripts/build-lxml-matched-public-source.py',
  'scripts/build-lxml-redistribution-wheel.py',
  'scripts/build-mootdx-compat-wheel.py',
  'scripts/build-private-node-js-runtime-wheel.py',
  'scripts/build-provider-source-wheels.py',
  'scripts/prepare-private-python-runtime.py',
  'scripts/private-node-js-runtime/rt_private_node_js_runtime/__init__.py',
  'scripts/private-node-js-runtime/rt_private_node_js_runtime/worker.cjs',
  'scripts/rebuild-lxml-native.py',
].sort()
const REQUIRED_SOURCE = [IMPLEMENTATION, POLICY, 'scripts/private-runtime-recipient-materials.cjs',
  'scripts/bundle-private-python-runtime.cjs', 'scripts/validate-private-python-runtime.cjs',
  'scripts/private-python-runtime-builder.cjs', ...PREPARATION_SOURCE]
const FORMATS = new Set(['original-notice-bytes', 'readable-notice-index', 'source-asset-pin',
  'binary-source-correspondence', 'source-access-notice', 'relink-inputs', 'native-relink-result',
  'issuer-entitlement-review', 'redist-component-map', 'recipient-terms-delivery',
  'rights-scope-review', 'target-absence-evidence'])
const KINDS = new Set(['notice-payload', 'corresponding-source', 'relinkability',
  'redistribution-entitlement', 'recipient-terms', 'scope-clarification', 'component-applicability'])
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const oid = bytes => crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')
const digest = value => hash(Buffer.from(canonical(value)))
function canonical(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
}
function preparationBytes(value) {
  return Buffer.from(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item, 2)
    .replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')) + '\n', 'ascii')
}
function executionOrigin(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || fs.realpathSync(repositoryRoot) !== fs.realpathSync(path.resolve(__dirname, '..')) ||
      fs.realpathSync(path.join(repositoryRoot, IMPLEMENTATION)) !== fs.realpathSync(__filename)) invalid('EXECUTION_SOURCE_ROOT_MISMATCH')
}
function verifiedModules(repositoryRoot, members) {
  const loaded = new Map()
  function load(name) {
    relative(name)
    if (!members.has(name)) invalid('EXECUTED_MODULE_NOT_VERIFIED', name)
    if (loaded.has(name)) return loaded.get(name).exports
    const bytes = bytesBelow(repositoryRoot, name)
    if (hash(bytes) !== members.get(name)) invalid('EXECUTED_MODULE_CHANGED', name)
    const filename = path.join(fs.realpathSync(repositoryRoot), name), child = new Module(filename, module)
    child.filename = filename
    child.require = request => {
      if (request.startsWith('node:') && Module.isBuiltin(request)) return require(request)
      if (!request.startsWith('.')) invalid('UNVERIFIED_MODULE_DEPENDENCY', name)
      const resolved = path.resolve(path.dirname(filename), request)
      if (!resolved.startsWith(fs.realpathSync(repositoryRoot) + path.sep)) invalid('EXECUTED_MODULE_ESCAPE', name)
      return load(path.relative(repositoryRoot, resolved).split(path.sep).join('/'))
    }
    loaded.set(name, child)
    child._compile(new TextDecoder('utf-8', { fatal: true }).decode(bytes), filename)
    child.loaded = true
    return child.exports
  }
  return load
}
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function artifactMember(archive, member) {
  relative(member)
  if (!Buffer.isBuffer(archive) || archive.length > 128 * 1024 * 1024 || archive.length < 22) invalid('ARTIFACT_ARCHIVE_INVALID')
  let end = -1
  for (let index = archive.length - 22; index >= Math.max(0, archive.length - 65557); index--) {
    if (archive.readUInt32LE(index) === 0x06054b50 && index + 22 + archive.readUInt16LE(index + 20) === archive.length) { end = index; break }
  }
  if (end < 0 || archive.readUInt16LE(end + 4) !== 0 || archive.readUInt16LE(end + 6) !== 0 ||
      archive.readUInt16LE(end + 8) !== archive.readUInt16LE(end + 10)) invalid('ARTIFACT_ARCHIVE_INVALID')
  const count = archive.readUInt16LE(end + 10), centralSize = archive.readUInt32LE(end + 12), start = archive.readUInt32LE(end + 16)
  if (count === 0xffff || centralSize === 0xffffffff || start === 0xffffffff) pending('ARTIFACT_ZIP64_UNSUPPORTED')
  if (start + centralSize !== end) invalid('ARTIFACT_ARCHIVE_INVALID')
  let cursor = start, selected
  const names = new Set()
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || archive.readUInt32LE(cursor) !== 0x02014b50) invalid('ARTIFACT_ARCHIVE_INVALID')
    const flags = archive.readUInt16LE(cursor + 8), method = archive.readUInt16LE(cursor + 10), compressed = archive.readUInt32LE(cursor + 20),
      size = archive.readUInt32LE(cursor + 24), nameLength = archive.readUInt16LE(cursor + 28), extra = archive.readUInt16LE(cursor + 30),
      comment = archive.readUInt16LE(cursor + 32), local = archive.readUInt32LE(cursor + 42)
    if (cursor + 46 + nameLength + extra + comment > end) invalid('ARTIFACT_ARCHIVE_INVALID')
    const name = new TextDecoder('utf-8', { fatal: true }).decode(archive.subarray(cursor + 46, cursor + 46 + nameLength))
    relative(name.endsWith('/') ? name.slice(0, -1) : name)
    if (names.has(name.toLowerCase())) invalid('ARTIFACT_MEMBER_DUPLICATE'); names.add(name.toLowerCase())
    if (name === member) {
      if ((flags & 1) || ![0, 8].includes(method) || size > 16 * 1024 * 1024 || compressed > 32 * 1024 * 1024 ||
          local + 30 > start || archive.readUInt32LE(local) !== 0x04034b50 || archive.readUInt16LE(local + 6) !== flags ||
          archive.readUInt16LE(local + 8) !== method) invalid('ARTIFACT_MEMBER_INVALID')
      const localName = archive.readUInt16LE(local + 26), localExtra = archive.readUInt16LE(local + 28), data = local + 30 + localName + localExtra
      if (data + compressed > start || !archive.subarray(local + 30, local + 30 + localName).equals(Buffer.from(name))) invalid('ARTIFACT_MEMBER_INVALID')
      const raw = archive.subarray(data, data + compressed)
      selected = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw, { maxOutputLength: 16 * 1024 * 1024 })
      if (selected.length !== size || crc32(selected) !== archive.readUInt32LE(cursor + 16)) invalid('ARTIFACT_MEMBER_BYTES_INVALID')
    }
    cursor += 46 + nameLength + extra + comment
  }
  if (cursor !== end) invalid('ARTIFACT_ARCHIVE_INVALID')
  if (!selected) pending('ARTIFACT_MEMBER_MISSING', member)
  return selected
}
function problem(status, code, evidenceId) {
  const error = new Error(code); error.sealStatus = status; error.evidenceId = evidenceId; throw error
}
const invalid = (code, id) => problem('invalid', code, id)
const pending = (code, id) => problem('pending', code, id)
function relative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') ||
      value.split('/').some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part))) invalid('INVALID_RELATIVE_PATH')
  return value
}
function bytesBelow(root, name) {
  const base = fs.realpathSync(root), filename = path.resolve(base, relative(name))
  if (!filename.startsWith(base + path.sep)) invalid('FILE_ESCAPES_ROOT', name)
  let cursor = base
  for (const component of name.split('/')) {
    cursor = path.join(cursor, component)
    if (fs.lstatSync(cursor).isSymbolicLink()) invalid('SOURCE_SYMLINK', name)
  }
  if (!fs.lstatSync(filename).isFile() || !fs.realpathSync(filename).startsWith(base + path.sep)) invalid('INVALID_SOURCE_FILE', name)
  return fs.readFileSync(filename)
}
function jsonBytes(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { invalid('INVALID_JSON') }
}
function sha(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid('INVALID_SHA256'); return value }

// HTTPS transport is deliberately not a general fetch facade: no redirects,
// caller URLs, credential discovery, proxy environment or unbounded responses.
function githubAuthority({ token } = {}) {
  return {
    readJson(apiPath) {
      if (typeof apiPath !== 'string' || !/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/|$)/.test(apiPath) ||
          /[\\#\s]/.test(apiPath)) invalid('INVALID_GITHUB_ENDPOINT')
      return new Promise((resolve, reject) => {
        let size = 0, ended = false, response
        const chunks = [], timer = setTimeout(() => stop('AUTHORITY_DEADLINE'), 15000)
        const req = https.request({ hostname: 'api.github.com', port: 443, path: apiPath, method: 'GET',
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'RT-ResearchFlow-runtime-seal',
            'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
          rejectUnauthorized: true }, res => {
          response = res
          if (res.statusCode !== 200) return stop('AUTHORITY_UNAVAILABLE')
          res.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) stop('AUTHORITY_RESPONSE_CAP'); else chunks.push(chunk) })
          res.on('error', () => stop('AUTHORITY_UNAVAILABLE'))
          res.on('end', () => {
            if (ended) return
            ended = true; clearTimeout(timer)
            try { resolve(jsonBytes(Buffer.concat(chunks))) } catch (error) { reject(error) }
          })
        })
        function stop(code) {
          if (ended) return
          ended = true; clearTimeout(timer); response?.destroy(); req.destroy()
          const error = new Error(code); error.sealStatus = 'pending'; reject(error)
        }
        req.on('error', () => stop('AUTHORITY_UNAVAILABLE')); req.end()
      })
    },
  }
}

async function verifySourceAuthority(trust, proof, repositoryRoot, authority) {
  if (!trust || !authority?.readJson) pending('PROTECTED_CONTEXT_REQUIRED')
  if (!Number.isSafeInteger(trust.repositoryId) || trust.repositoryId < 1 ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trust.repositoryFullName) ||
      !/^[a-f0-9]{40}$/.test(trust.approvedSourceCommit)) invalid('INVALID_PROTECTED_CONTEXT')
  sha(trust.approvedPolicySha256); sha(trust.approvedSealImplementationSha256); sha(trust.sourceSnapshotSha256)
  if (!proof) pending('SOURCE_PROOF_MISSING')
  if (proof.kind !== 'github-tree-membership-v1' || proof.repositoryId !== trust.repositoryId ||
      proof.sourceCommit !== trust.approvedSourceCommit || proof.policySha256 !== trust.approvedPolicySha256 ||
      proof.sourceSnapshotSha256 !== trust.sourceSnapshotSha256) invalid('SOURCE_IDENTITY_MISMATCH')
  const prefix = '/repos/' + trust.repositoryFullName
  const repository = await authority.readJson(prefix)
  if (repository.id !== trust.repositoryId || repository.full_name !== trust.repositoryFullName) invalid('REPOSITORY_IDENTITY_MISMATCH')
  const commit = await authority.readJson(prefix + '/git/commits/' + trust.approvedSourceCommit)
  if (commit.sha !== trust.approvedSourceCommit || commit.tree?.sha !== proof.rootTreeOid) invalid('SOURCE_TREE_MISMATCH')
  const required = trust.requiredSourceFiles
  if (!Array.isArray(required) || new Set(required).size !== required.length || REQUIRED_SOURCE.some(name => !required.includes(name))) invalid('INCOMPLETE_SOURCE_ALLOWLIST')
  if (!Array.isArray(proof.files) || new Set(proof.files.map(file => file.path)).size !== proof.files.length ||
      canonical(proof.files.map(file => file.path).sort()) !== canonical([...required].sort())) invalid('SOURCE_MEMBERSHIP_COVERAGE')
  const treeCache = new Map(), verified = new Map()
  async function tree(treeOid) {
    if (!treeCache.has(treeOid)) {
      const result = await authority.readJson(prefix + '/git/trees/' + treeOid)
      if (result.sha !== treeOid || result.truncated === true || !Array.isArray(result.tree)) pending('SOURCE_TREE_INCOMPLETE')
      treeCache.set(treeOid, result.tree)
    }
    return treeCache.get(treeOid)
  }
  for (const file of proof.files) {
    const parts = relative(file.path).split('/'); let parent = proof.rootTreeOid, member
    for (let index = 0; index < parts.length; index++) {
      const matches = (await tree(parent)).filter(entry => entry.path === parts[index])
      if (matches.length !== 1) invalid('SOURCE_MEMBER_MISSING', file.path)
      member = matches[0]
      if (index < parts.length - 1) {
        if (member.type !== 'tree' || member.mode !== '040000') invalid('SOURCE_MEMBER_TYPE', file.path)
        parent = member.sha
      }
    }
    if (member.type !== 'blob' || !['100644', '100755'].includes(member.mode) ||
        member.sha !== file.blobOid || member.mode !== file.mode) invalid('SOURCE_MEMBER_TYPE', file.path)
    const blob = await authority.readJson(prefix + '/git/blobs/' + member.sha)
    if (blob.sha !== member.sha || blob.encoding !== 'base64' || typeof blob.content !== 'string') invalid('SOURCE_BLOB_ENCODING', file.path)
    const compact = blob.content.replace(/[\r\n]/g, '')
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) invalid('SOURCE_BLOB_ENCODING', file.path)
    const bytes = Buffer.from(compact, 'base64')
    if (blob.size !== bytes.length || file.size !== bytes.length || oid(bytes) !== member.sha ||
        hash(bytes) !== sha(file.sha256) || hash(bytesBelow(repositoryRoot, file.path)) !== file.sha256 ||
        bytes.subarray(0, 43).toString().startsWith('version https://git-lfs.github.com/spec/v1')) invalid('SOURCE_BYTES_MISMATCH', file.path)
    verified.set(file.path, file.sha256)
  }
  if (verified.get(POLICY) !== trust.approvedPolicySha256 || verified.get(IMPLEMENTATION) !== trust.approvedSealImplementationSha256) invalid('SOURCE_AUTHORIZATION_PIN_MISMATCH')
  return { prefix, verified }
}

async function verifyProducers(trust, proof, authority, bindings) {
  if (!Array.isArray(trust.producers) || trust.producers.length !== 3 || !Array.isArray(proof.producers) || proof.producers.length !== 3) pending('THREE_PRODUCERS_REQUIRED')
  if (new Set(trust.producers.map(row => row.target)).size !== 3 || new Set(proof.producers.map(row => row.target)).size !== 3) invalid('DUPLICATE_PRODUCER_TARGET')
  const prefix = '/repos/' + trust.repositoryFullName
  for (const target of TARGETS) {
    const root = trust.producers.find(row => row.target === target), row = proof.producers.find(item => item.target === target)
    if (!root || !row) pending('PRODUCER_TARGET_MISSING', target)
    if (!/^\d+$/.test(String(root.runId)) || !Number.isSafeInteger(root.attempt) || root.attempt < 1 ||
        row.runId !== root.runId || row.attempt !== root.attempt || row.workflowPath !== root.workflowPath ||
        row.workflowBlobOid !== root.workflowBlobOid || row.fragmentArtifactId !== root.fragmentArtifactId ||
        row.fragmentSha256 !== bindings[target].fragmentSha256) invalid('PRODUCER_PIN_MISMATCH', target)
    const run = await authority.readJson(prefix + '/actions/runs/' + root.runId + '/attempts/' + root.attempt)
    if (run.repository?.id !== trust.repositoryId || run.head_repository?.id !== trust.repositoryId ||
        run.head_sha !== trust.approvedSourceCommit || run.path !== root.workflowPath || run.run_attempt !== root.attempt ||
        !root.allowedEvents?.includes(run.event)) invalid('PRODUCER_IDENTITY_MISMATCH', target)
    const job = await authority.readJson(prefix + '/actions/jobs/' + root.jobId)
    if (job.id !== root.jobId || job.run_id !== Number(root.runId) || job.run_attempt !== root.attempt ||
        job.head_sha !== trust.approvedSourceCommit || job.name !== root.jobName) invalid('PRODUCER_JOB_MISMATCH', target)
    if (job.status !== 'completed' || job.conclusion !== 'success') pending('PRODUCER_NOT_SUCCESSFUL', target)
    const artifact = await authority.readJson(prefix + '/actions/artifacts/' + root.fragmentArtifactId)
    if (artifact.id !== root.fragmentArtifactId || artifact.expired || artifact.workflow_run?.id !== Number(root.runId) ||
        artifact.workflow_run?.head_sha !== trust.approvedSourceCommit || artifact.name !== root.artifactName ||
        artifact.digest !== 'sha256:' + sha(root.artifactArchiveSha256)) invalid('PRODUCER_ARTIFACT_MISMATCH', target)
    // Hash the real archive and independently decode members, never trust SHA echoes.
    if (!authority.readArtifactArchive) pending('ARTIFACT_ARCHIVE_READER_MISSING', target)
    const archive = await authority.readArtifactArchive({ artifactId: artifact.id })
    if (!Buffer.isBuffer(archive) || hash(archive) !== root.artifactArchiveSha256) invalid('PRODUCER_ARTIFACT_BYTES_MISMATCH', target)
    for (const name of ['fragment', 'candidateLock', 'handoff', 'nativeReport']) {
      if (!root.members?.[name] || !Buffer.isBuffer(bindings[target][name + 'Bytes'])) pending('PRODUCER_MEMBER_BINDING_MISSING', target + ':' + name)
      if (!artifactMember(archive, root.members[name]).equals(bindings[target][name + 'Bytes'])) invalid('PRODUCER_MEMBER_BYTES_MISMATCH', target + ':' + name)
    }
    if (bindings.sourceMembers?.get(root.workflowPath) !== root.workflowSha256) invalid('WORKFLOW_SOURCE_NOT_BOUND', target)
  }
}

function executionAssets(manifest) {
  const assets = [{ component: 'python-build-standalone', version: manifest.python.version, artifactSha256: manifest.python.asset.sha256 },
    { component: 'node', version: manifest.node.version, artifactSha256: manifest.node.asset.sha256 }]
  for (const provider of Object.values(manifest.providers)) for (const wheel of provider.wheels)
    assets.push({ component: wheel.distribution, version: wheel.version, artifactSha256: wheel.asset.sha256 })
  return [...new Map(assets.map(item => [canonical(item), item])).values()].sort((a, b) => canonical(a).localeCompare(canonical(b), 'en'))
}

function verifyPreparationBinding({ target, manifest, fragmentBytes, candidateLockBytes, handoffBytes, nativeReportBytes,
  preparedRoot, sourceMembers, trust, foundation, formalLockSha256 }) {
  const fragment = jsonBytes(fragmentBytes), candidate = jsonBytes(candidateLockBytes), handoff = jsonBytes(handoffBytes)
  if (fragment.kind !== 'rt-private-python-candidate-fragment' || fragment.schemaVersion !== 1 || fragment.status !== 'candidate' ||
      fragment.target !== target || fragment.sourceSha256 !== trust.sourceSnapshotSha256 || fragment.preparationPolicySha256 !== trust.approvedPolicySha256 ||
      candidate.kind !== 'rt-private-python-candidate-lock' || candidate.schemaVersion !== 1 || candidate.status !== 'candidate' || candidate.target !== target ||
      candidate.sourceSha256 !== fragment.sourceSha256 || candidate.preparationPolicySha256 !== fragment.preparationPolicySha256 ||
      fragment.inputLockSha256 !== hash(candidateLockBytes)) invalid('PREPARATION_LOCK_BINDING', target)
  if (fragment.treeComplete !== true || candidate.resolutionComplete !== true) pending('PREPARATION_NOT_COMPLETE', target)
  if (handoff.kind !== 'rt-private-python-preparation-handoff' || handoff.status !== 'candidate' ||
      handoff.treeComplete !== true || handoff.resolutionComplete !== true || handoff.lock?.sha256 !== hash(candidateLockBytes) ||
      handoff.fragment?.sha256 !== hash(fragmentBytes)) invalid('PREPARATION_HANDOFF_BINDING', target)
  const snapshot = fragment.sourceSnapshot
  if (!snapshot || snapshot.policySha256 !== trust.approvedPolicySha256 || !Array.isArray(snapshot.files) ||
      new Set(snapshot.files.map(file => file.path)).size !== snapshot.files.length || snapshot.files.length !== PREPARATION_SOURCE.length ||
      canonical(snapshot.files.map(file => file.path)) !== canonical(PREPARATION_SOURCE) ||
      !snapshot.files.some(file => file.path === 'scripts/prepare-private-python-runtime.py') ||
      snapshot.files.some(file => sourceMembers.get(file.path) !== file.sha256) ||
      canonical(snapshot.files.map(file => file.path)) !== canonical(snapshot.files.map(file => file.path).sort()) ||
      canonical(candidate.sourceSnapshot) !== canonical(snapshot) || hash(preparationBytes(snapshot)) !== fragment.sourceSha256) invalid('PREPARATION_SOURCE_SNAPSHOT', target)
  const root = path.join(preparedRoot, target)
  if (!Array.isArray(fragment.inventory) || fragment.inventorySha256 !== hash(preparationBytes(fragment.inventory)) ||
      canonical(fragment.inventory) !== canonical(manifest.files) || canonical(fragment.sbom) !== canonical(manifest.sbom) ||
      canonical(fragment.dependencyAuditValidator) !== canonical(manifest.dependencyAuditValidator)) invalid('PREPARATION_TREE_PROJECTION', target)
  for (const runtime of ['python', 'node']) {
    if (candidate[runtime]?.version !== manifest[runtime].version || canonical(candidate[runtime]?.asset) !== canonical(manifest[runtime].asset) ||
        canonical(candidate[runtime]?.licenseSources || []) !== canonical(manifest[runtime].licenseSources || [])) invalid('PREPARATION_EXECUTION_ASSET', target)
  }
  const projection = structuredClone(manifest)
  for (const provider of ['akshare', 'mootdx', 'pywencai']) {
    const actual = manifest.providers[provider], prepared = fragment.providers?.[provider], resolved = candidate.providers?.[provider]
    if (!prepared || !resolved || prepared.version !== actual.version || resolved.version !== actual.version || prepared.site !== actual.site ||
        resolved.site !== actual.site || canonical(prepared.dependencyAudit) !== canonical(actual.dependencyAudit) || !Array.isArray(resolved.wheels) ||
        resolved.wheels.length !== actual.wheels.length) invalid('PREPARATION_PROVIDER_PROJECTION', target + ':' + provider)
    const audit = jsonBytes(bytesBelow(root, actual.dependencyAudit.path))
    if (hash(bytesBelow(root, actual.dependencyAudit.path)) !== actual.dependencyAudit.sha256 ||
        canonical(audit.installedClosure) !== canonical(prepared.installedClosure)) invalid('PREPARATION_AUDIT_BINDING', provider)
    for (const wheel of actual.wheels) {
      const raw = resolved.wheels.filter(item => item.distribution === wheel.distribution)
      const audited = audit.wheels?.filter(item => item.name === wheel.distribution.toLowerCase().replace(/[-_.]+/g, '-'))
      if (raw.length !== 1 || audited?.length !== 1 || raw[0].version !== wheel.version ||
          canonical(raw[0].asset) !== canonical(wheel.asset) || canonical(raw[0].derived) !== canonical(wheel.derived) ||
          canonical(raw[0].dependencies) !== canonical(wheel.requiresDist) || raw[0].requiresPython !== wheel.requiresPython ||
          canonical(raw[0].tags) !== canonical(wheel.tags) || raw[0].metadataSha256 !== wheel.metadata.sha256 ||
          audited[0].metadataPath !== wheel.metadata.path || audited[0].metadataSha256 !== wheel.metadata.sha256 ||
          !Object.entries(raw[0].notices || {}).some(([name, value]) => /\.dist-info\/METADATA$/.test(name) && value === wheel.metadata.sha256)) invalid('PREPARATION_WHEEL_PROJECTION', provider + ':' + wheel.distribution)
      projection.providers[provider].wheels.find(item => item.distribution === wheel.distribution).dependencies = raw[0].dependencies
    }
  }
  const generator = sourceMembers.get('scripts/prepare-private-python-runtime.py')
  const projected = foundation.projectDependencyGraphs(root, projection, generator)
  if (canonical(projected.providers) !== canonical(manifest.providers)) invalid('PREPARATION_GRAPH_PROJECTION', target)
  const formal = { ...manifest, sourceLockSha256: sha(formalLockSha256) }
  if (target === trust.assemblyTarget) foundation.validateRuntimeTree(root, formal, target)
  else {
    // Foreign replicas are byte evidence, not permission/native execution proof.
    // POSIX executable modes must be checked on that target's real native host by
    // the mandatory authority verifier below; NTFS replicas cannot prove +x.
    foundation.validateManifestShape(formal, target)
    const inventory = new Map(manifest.files.map(file => [file.path, file])), seen = new Set()
    function walk(directory, prefix = '') {
      for (const name of fs.readdirSync(directory)) {
        const relative = prefix ? prefix + '/' + name : name, filename = path.join(directory, name), stat = fs.lstatSync(filename)
        if (stat.isDirectory() && !stat.isSymbolicLink()) { walk(filename, relative); continue }
        const entry = inventory.get(relative)
        if (!entry || seen.has(relative)) invalid('FOREIGN_TREE_INVENTORY', target)
        if (entry.kind === 'file') {
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size || hash(bytesBelow(root, relative)) !== entry.sha256) invalid('FOREIGN_TREE_BYTES', target)
        } else if (entry.kind === 'symlink') {
          if (!stat.isSymbolicLink() || fs.readlinkSync(filename).replace(/\\/g, '/') !== entry.target ||
              !fs.realpathSync(filename).startsWith(fs.realpathSync(root) + path.sep)) invalid('FOREIGN_TREE_SYMLINK', target)
        } else invalid('FOREIGN_TREE_INVENTORY', target)
        seen.add(relative)
      }
    }
    walk(root)
    if (seen.size !== inventory.size) invalid('FOREIGN_TREE_INVENTORY', target)
  }
  if (!Buffer.isBuffer(nativeReportBytes)) pending('NATIVE_BOOTSTRAP_REPORT_MISSING', target)
  const native = jsonBytes(nativeReportBytes)
  const binding = { target, sourceSnapshotSha256: fragment.sourceSha256, candidateLockSha256: hash(candidateLockBytes), fragmentSha256: hash(fragmentBytes),
    inventorySha256: fragment.inventorySha256, formalManifestIdentitySha256: digest(formal), pythonAssetSha256: manifest.python.asset.sha256, nodeAssetSha256: manifest.node.asset.sha256,
    bootstrapSha256: sourceMembers.get('resources/python-runtime/bootstrap.py'), validatorSha256: manifest.dependencyAuditValidator.sha256,
    miniRacerAdapterSha256: sourceMembers.get('resources/python-runtime/miniracer_unicode_adapter.py'),
    pywencaiAdapterSha256: sourceMembers.get('resources/python-runtime/pywencai_adapter.py'),
    providers: Object.fromEntries(Object.entries(manifest.providers).map(([name, provider]) => [name,
      { version: provider.version, dependencyAuditSha256: provider.dependencyAudit.sha256, wheelsSha256: digest(provider.wheels) }])) }
  if (native.kind !== 'rt-private-python-native-bootstrap-evidence-v1' || canonical(native.binding) !== canonical(binding) ||
      native.nativePlatform !== manifest.platform || native.nativeArch !== manifest.arch || native.validatorPassed !== true || native.executableModeChecked !== true ||
      !Array.isArray(native.results) || native.results.length !== 3 || new Set(native.results.map(row => row.provider)).size !== 3 ||
      native.results.some(row => !binding.providers[row.provider] || row.workerExitCode !== 0 || row.privateNodeExited !== true || row.ownedDescendantsExited !== true) ||
      canonical(native.invocationFlags) !== canonical(['-X', 'utf8', '-I', '-S', '-B'])) invalid('NATIVE_BOOTSTRAP_REPORT_BINDING', target)
  return { fragmentBytes, candidateLockBytes, handoffBytes, nativeReportBytes, fragmentSha256: hash(fragmentBytes), binding, native }
}
const INTEGRATION_CHECKS = Object.freeze({
  'formal-manifest-assembly': ['assembly'], 'github-source-membership': ['source'], 'production-native-bootstrap': ['native'],
  'Human approval of PBS/Windows Distributable Code, BDB/Tix and complete vendor notices remains pending': ['licenses'],
  'Human approval of all actual provider artifacts/notices, including lxml LGPL/XSL and mootdx noncommercial description, remains pending': ['licenses'],
  'Mac native resolve/materialize and formal manifest bootstrap acceptance have not been executed': ['native', 'assembly'],
  'Per-artifact applicable license approvals are pending; candidate is not release eligible': ['licenses'],
  'Reviewed sourceCommit not provided; candidate binds actual source SHA snapshot instead': ['source'],
  'sourceCommit is pending; sourceSha256 binds actual preparation/application bytes': ['source'],
  'Full manifest production bootstrap/Unicode adapter acceptance remains a separate gate': ['native'],
})
function unresolvedPending(fragments, completed, deferred = new Set()) {
  for (const [target, fragment] of Object.entries(fragments)) {
    if (!Array.isArray(fragment.pending)) invalid('PREPARATION_PENDING_TYPE', target)
    for (const item of fragment.pending) {
      if (typeof item !== 'string' && (!item || typeof item !== 'object' || typeof item.code !== 'string')) invalid('PREPARATION_PENDING_TYPE', target)
      const code = typeof item === 'string' ? item : item.code
      if (!Object.hasOwn(INTEGRATION_CHECKS, code) || INTEGRATION_CHECKS[code].some(check => !completed.has(check) && !deferred.has(check))) pending('PREPARATION_PENDING_REMAINS', target + ':' + code)
    }
  }
}
function distributionTargets(trust) {
  if (trust.distributionScope === undefined) return [...TARGETS]
  if (trust.distributionScope !== 'assembly-target' || !TARGETS.includes(trust.assemblyTarget)) invalid('DISTRIBUTION_SCOPE_INVALID')
  return [trust.assemblyTarget]
}
function verifyDistributionPolicies({ trust, manifests, policy, policySha256, foundation }) {
  const targets = distributionTargets(trust)
  for (const target of targets) foundation.validatePreparationPolicy(manifests[target], policy, policySha256)
  return targets
}
function verifyDistributionPending(fragments, targets, assembled = false) {
  // Every producer must still pass source/native and reject unknown pending codes.
  // Only the selected delivery targets can discharge licenses and assembly.
  unresolvedPending(fragments, new Set(['source', 'native']), new Set(['licenses', 'assembly']))
  const selected = Object.fromEntries(targets.map(target => [target, fragments[target]]))
  unresolvedPending(selected, new Set(['source', 'native', 'licenses', ...(assembled ? ['assembly'] : [])]),
    new Set(assembled ? [] : ['assembly']))
}

async function verifyObligationCoverage({ trust, proof, rules, manifests, preparedRoot, sourceMembers, authority, repositoryRoot }) {
  const targets = distributionTargets(trust)
  const readEvidence = createDistributionEvidenceReader({ repositoryRoot, sourceMembers, trustedContext: trust })
  if (!rules) pending('OBLIGATION_RULES_MISSING')
  if (rules.schemaVersion !== 1 || rules.kind !== 'rt-runtime-distribution-obligation-policy-v1' ||
      rules.preparationPolicySha256 !== trust.approvedPolicySha256 || !Array.isArray(rules.assets)) invalid('OBLIGATION_RULES_INVALID')
  if (!proof) pending('OBLIGATIONS_PROOF_MISSING')
  if (proof.kind !== 'runtime-distribution-obligations-v1' || proof.policySha256 !== trust.approvedPolicySha256 ||
      proof.sourceSnapshotSha256 !== trust.sourceSnapshotSha256 || !Array.isArray(proof.targets) ||
      proof.targets.length !== 3 || new Set(proof.targets.map(row => row.target)).size !== 3) invalid('OBLIGATIONS_PROOF_INVALID')
  if (rules.assets.some(rule => !TARGETS.includes(rule.target))) invalid('UNEXPECTED_OBLIGATION_ASSET')
  const used = new Set()
  for (const target of targets) {
    const manifest = manifests[target], row = proof.targets.find(item => item.target === target), assets = executionAssets(manifest)
    if (!row) pending('OBLIGATION_TARGET_MISSING', target)
    if (row.artifactSetSha256 !== digest(assets) || row.inventorySha256 !== digest(manifest.files) ||
        row.dependencyAuditSha256 !== digest(Object.entries(manifest.providers).sort().map(([name, provider]) => ({ name, ...provider.dependencyAudit })))) invalid('OBLIGATION_PAYLOAD_BINDING', target)
    if (!Array.isArray(row.reviews) || new Set(row.reviews.map(item => item.id)).size !== row.reviews.length) invalid('DUPLICATE_OBLIGATION_REVIEW', target)
    const expectedIds = new Set()
    for (const asset of assets) {
      const matches = rules.assets.filter(rule => rule.target === target && rule.component === asset.component &&
        rule.version === asset.version && rule.artifactSha256 === asset.artifactSha256)
      if (!matches.length) pending('OBLIGATION_ASSET_NOT_CLASSIFIED', target + ':' + asset.component)
      if (matches.length !== 1) invalid('OBLIGATION_ASSET_CONFLICT', target + ':' + asset.component)
      const rule = matches[0]; used.add(rule)
      if (!rule.reviewRecord || sourceMembers.get(rule.reviewRecord.path) !== rule.reviewRecord.sha256) invalid('OBLIGATION_REVIEW_SOURCE', asset.component)
      if (!Array.isArray(rule.obligations) || !['notice-only', 'additional-obligations'].includes(rule.classification) ||
          (rule.classification === 'notice-only' ? rule.obligations.length !== 0 : rule.obligations.length === 0)) invalid('OBLIGATION_CLASSIFICATION', asset.component)
      for (const obligation of rule.obligations) {
        if (!KINDS.has(obligation.kind) || typeof obligation.id !== 'string' || !obligation.id || expectedIds.has(obligation.id) ||
            !obligation.scope || !Array.isArray(obligation.requiredEvidence) || !obligation.requiredEvidence.length ||
            new Set(obligation.requiredEvidence).size !== obligation.requiredEvidence.length || obligation.requiredEvidence.some(format => !FORMATS.has(format)) ||
            !Array.isArray(obligation.payloadFiles)) invalid('OBLIGATION_RULE_INVALID', obligation.id)
        expectedIds.add(obligation.id)
        const review = row.reviews.find(item => item.id === obligation.id)
        if (!review) pending('OBLIGATION_REVIEW_MISSING', obligation.id)
        if (review.component !== asset.component || review.version !== asset.version || review.artifactSha256 !== asset.artifactSha256 ||
            review.licenseSha256 !== obligation.scope.licenseSha256 || review.obligation !== obligation.kind ||
            review.reviewRecord?.authorizationCommit !== trust.approvedSourceCommit ||
            review.reviewRecord?.path !== rule.reviewRecord.path || review.reviewRecord?.sha256 !== rule.reviewRecord.sha256 ||
            !['satisfied', 'not-applicable'].includes(review.decision)) invalid('OBLIGATION_REVIEW_MISMATCH', obligation.id)
        if (review.decision === 'not-applicable' && !obligation.requiredEvidence.includes('target-absence-evidence')) invalid('OBLIGATION_ABSENCE_UNPROVED', obligation.id)
        if (canonical(review.payloadFiles) !== canonical(obligation.payloadFiles)) invalid('OBLIGATION_PAYLOAD_MISMATCH', obligation.id)
        for (const file of obligation.payloadFiles) {
          readEvidence({ target, manifest, file, role: 'payload', preparedRoot })
        }
        if (!Array.isArray(review.evidence) || new Set(review.evidence.map(item => item.format)).size !== review.evidence.length ||
            canonical(review.evidence.map(item => item.format).sort()) !== canonical([...obligation.requiredEvidence].sort())) invalid('OBLIGATION_EVIDENCE_COVERAGE', obligation.id)
        for (const evidence of review.evidence) {
          sha(evidence.sha256); relative(evidence.path)
          const evidenceBytes = readEvidence({ target, manifest, file: evidence, role: 'evidence', preparedRoot })
          if (evidence.format === 'original-notice-bytes') {
            if (!obligation.payloadFiles.some(file => file.path === evidence.path && file.sha256 === evidence.sha256 &&
                (file.location || 'runtime') === (evidence.location || 'runtime'))) invalid('NOTICE_NOT_IN_PAYLOAD', obligation.id)
          } else if (evidence.format === 'readable-notice-index') {
            let text
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(evidenceBytes) }
            catch { invalid('NOTICE_INDEX_ENCODING', obligation.id) }
            if (!obligation.payloadFiles.length || obligation.payloadFiles.some(file => !text.includes(file.path))) invalid('NOTICE_INDEX_MISSING_ENTRY', obligation.id)
          } else {
            const verifier = authority.evidenceVerifiers?.[evidence.format]
            if (typeof verifier !== 'function') pending('OBLIGATION_VERIFIER_MISSING', obligation.id + ':' + evidence.format)
            const result = await verifier({ target, manifest, asset, rule, obligation, review, evidence, preparedRoot })
            if (result?.status === 'pending') pending('OBLIGATION_EVIDENCE_PENDING', obligation.id)
            if (result?.status !== 'accepted' || result.evidenceSha256 !== evidence.sha256) invalid('OBLIGATION_EVIDENCE_REJECTED', obligation.id)
          }
        }
      }
    }
    if (row.reviews.some(review => !expectedIds.has(review.id))) invalid('UNEXPECTED_OBLIGATION_REVIEW', target)
  }
  if (used.size !== rules.assets.filter(rule => targets.includes(rule.target)).length) invalid('UNEXPECTED_OBLIGATION_ASSET')
}

async function sealPrivateRuntime(input, authority = githubAuthority()) {
  try {
    const { trustedContext: trust, sourceProof, obligationsProof, repositoryRoot, lockPath, preparedRoot, assetsRoot, outputRoot, preparations } = input
    if (!trust) pending('PROTECTED_CONTEXT_REQUIRED')
    executionOrigin(repositoryRoot)
    if (!TARGETS.includes(trust.assemblyTarget) || trust.assemblyTarget !== process.platform + '-' + process.arch) invalid('ASSEMBLY_NATIVE_TARGET_MISMATCH')
    const source = await verifySourceAuthority(trust, sourceProof, repositoryRoot, authority)
    if (!trust.obligationPolicySha256 || !source.verified.has(RULES)) pending('OBLIGATION_RULES_MISSING')
    if (source.verified.get(RULES) !== sha(trust.obligationPolicySha256)) invalid('OBLIGATION_POLICY_PIN_MISMATCH')
    const load = verifiedModules(repositoryRoot, source.verified)
    const foundation = load('electron/shared/privatePythonRuntimeManifest.cjs')
    const lockBytes = fs.readFileSync(lockPath), lock = foundation.validateLock(jsonBytes(lockBytes))
    const policyBytes = bytesBelow(repositoryRoot, POLICY), policy = jsonBytes(policyBytes)
    const deliveryTargets = verifyDistributionPolicies({ trust, manifests: lock.platforms, policy,
      policySha256: hash(policyBytes), foundation })
    const bindings = { sourceMembers: source.verified }, fragmentObjects = {}
    for (const target of TARGETS) {
      const preparation = preparations?.[target]
      if (!preparation?.fragmentPath || !preparation.candidateLockPath || !preparation.handoffPath) pending('PREPARATION_INPUTS_MISSING', target)
      if (!preparation.nativeReportPath) pending('NATIVE_BOOTSTRAP_REPORT_MISSING', target)
      const fragmentBytes = fs.readFileSync(preparation.fragmentPath)
      bindings[target] = verifyPreparationBinding({ target, manifest: lock.platforms[target], fragmentBytes,
        candidateLockBytes: fs.readFileSync(preparation.candidateLockPath), handoffBytes: fs.readFileSync(preparation.handoffPath),
        nativeReportBytes: fs.readFileSync(preparation.nativeReportPath), preparedRoot, sourceMembers: source.verified, trust, foundation, formalLockSha256: hash(lockBytes) })
      fragmentObjects[target] = jsonBytes(fragmentBytes)
      const candidate = jsonBytes(bindings[target].candidateLockBytes)
      if (!Array.isArray(candidate.pending) || !Array.isArray(fragmentObjects[target].pending)) invalid('PREPARATION_PENDING_TYPE', target)
      fragmentObjects[target].pending = [...fragmentObjects[target].pending, ...candidate.pending]
    }
    await verifyProducers(trust, sourceProof, authority, bindings)
    if (typeof authority.verifyNativeBootstrap !== 'function') pending('NATIVE_BOOTSTRAP_VERIFIER_MISSING')
    for (const target of TARGETS) {
      const evidence = await authority.verifyNativeBootstrap({ target, reportBytes: bindings[target].nativeReportBytes,
        expectedBinding: bindings[target].binding, producer: trust.producers.find(row => row.target === target) })
      if (evidence?.status === 'pending') pending('NATIVE_BOOTSTRAP_VERIFICATION_PENDING', target)
      if (evidence?.status !== 'accepted' || evidence.reportSha256 !== hash(bindings[target].nativeReportBytes) ||
          evidence.bindingSha256 !== digest(bindings[target].binding)) invalid('NATIVE_BOOTSTRAP_VERIFICATION_FAILED', target)
    }
    await verifyObligationCoverage({ trust, proof: obligationsProof, rules: jsonBytes(bytesBelow(repositoryRoot, RULES)),
      manifests: lock.platforms, preparedRoot, sourceMembers: source.verified, authority, repositoryRoot })
    // Distribution scope is protected source-authorized context, never caller discharge lists.
    verifyDistributionPending(fragmentObjects, deliveryTargets)
    const { assemble } = load('scripts/bundle-private-python-runtime.cjs')
    const { validate } = load('scripts/validate-private-python-runtime.cjs')
    const outputs = []
    for (const target of [trust.assemblyTarget]) {
      const result = assemble({ lockPath, preparedRoot, assetsRoot, outputRoot, target })
      const checked = validate(path.join(outputRoot, target), target)
      if (checked.manifestSha256 !== result.manifestSha256) invalid('ASSEMBLY_MANIFEST_CHANGED', target)
      if (digest(jsonBytes(fs.readFileSync(path.join(outputRoot, target, 'manifest.json')))) !== bindings[target].binding.formalManifestIdentitySha256) invalid('ASSEMBLY_BLUEPRINT_CHANGED', target)
      outputs.push(result)
    }
    verifyDistributionPending(fragmentObjects, deliveryTargets, outputs.length === 1)
    return { status: 'accepted', stage: 'pre-sign-native-assembly', assemblyTarget: trust.assemblyTarget, verifiedProducerTargets: TARGETS,
      verifiedDistributionTargets: deliveryTargets,
      releaseEligible: false, outputs, reasons: [] }
  } catch (error) {
    const status = error.sealStatus || (String(error.message).startsWith('PRIVATE_RUNTIME_PENDING') ? 'pending' : 'invalid')
    return { status, stage: 'pre-sign-assembly', releaseEligible: false,
      reasons: [{ code: error.sealStatus ? error.message : 'FOUNDATION_OR_INPUT_REJECTED', ...(error.evidenceId ? { evidenceId: error.evidenceId } : {}) }] }
  }
}
if (require.main === module) {
  // Protected roots cannot be minted by a --trust JSON path or local env flags.
  console.error(JSON.stringify({ status: 'pending', releaseEligible: false, reasons: [{ code: 'PROTECTED_CONTEXT_REQUIRED' }] }))
  process.exitCode = 1
}
module.exports = { sealPrivateRuntime, verifySourceAuthority, verifyProducers, verifyObligationCoverage,
  githubAuthority, executionAssets, digest, REQUIRED_SOURCE, PREPARATION_SOURCE, TARGETS, preparationBytes, verifyPreparationBinding,
  executionOrigin, artifactMember, crc32, unresolvedPending, distributionTargets, verifyDistributionPolicies, verifyDistributionPending }
