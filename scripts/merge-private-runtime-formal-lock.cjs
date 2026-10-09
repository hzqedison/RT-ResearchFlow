'use strict'

// Structural projection only. No source/license/native authority is created here.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const foundation = require('../electron/shared/privatePythonRuntimeManifest.cjs')
const { preparationBytes, PREPARATION_SOURCE, crc32 } = require('./seal-private-python-runtime.cjs')
const { TARGETS, PROVIDERS } = foundation
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const equal = (a, b) => preparationBytes(a).equals(preparationBytes(b))
const canonical = name => String(name).toLowerCase().replace(/[-_.]+/g, '-')
function fail(code) { const error = new Error(code); error.code = code; throw error }
function expect(condition, code) { if (!condition) fail(code) }
function hashFile(filename) {
  const fd = fs.openSync(filename, 'r'), hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024)
  try { let n; while ((n = fs.readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, n)) } finally { fs.closeSync(fd) }
  return hash.digest('hex')
}
function regular(filename, cap = 16 * 1024 * 1024) {
  expect(path.isAbsolute(filename), 'MERGE_ABSOLUTE_INPUT_REQUIRED')
  const stat = fs.lstatSync(filename)
  expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= cap &&
    fs.realpathSync(filename) === path.resolve(filename), 'MERGE_INPUT_FILE_INVALID')
  const bytes = fs.readFileSync(filename)
  expect(bytes.length === stat.size, 'MERGE_INPUT_CHANGED')
  return bytes
}
function parse(bytes) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }

// Same central/local-header, path, duplicate, CRC and bounded-inflate rules as
// seal.artifactMember, but positional reads avoid loading a 350MB payload ZIP.
function readZipMember(filename, member) {
  foundation.safeRelative(member)
  const stat = fs.lstatSync(filename)
  expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
    stat.size >= 22 && stat.size <= 2 * 1024 ** 3, 'MERGE_ARCHIVE_INVALID')
  const fd = fs.openSync(filename, 'r')
  function read(offset, size) {
    expect(Number.isSafeInteger(offset) && size >= 0 && offset >= 0 && offset + size <= stat.size, 'MERGE_ZIP_BOUNDS')
    const bytes = Buffer.alloc(size)
    expect(fs.readSync(fd, bytes, 0, size, offset) === size, 'MERGE_ZIP_TRUNCATED')
    return bytes
  }
  try {
    const startTail = Math.max(0, stat.size - 65557), tail = read(startTail, stat.size - startTail)
    let end = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break }
    }
    expect(end >= 0 && tail.readUInt16LE(end + 4) === 0 && tail.readUInt16LE(end + 6) === 0 &&
      tail.readUInt16LE(end + 8) === tail.readUInt16LE(end + 10), 'MERGE_ZIP_END')
    const count = tail.readUInt16LE(end + 10), size = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16)
    expect(count > 0 && count < 0xffff && size <= 8 * 1024 * 1024 &&
      offset + size === startTail + end, 'MERGE_ZIP_DIRECTORY')
    const directory = read(offset, size), names = new Set()
    let cursor = 0, selected
    for (let i = 0; i < count; i++) {
      expect(cursor + 46 <= size && directory.readUInt32LE(cursor) === 0x02014b50, 'MERGE_ZIP_ENTRY')
      const flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10)
      const crc = directory.readUInt32LE(cursor + 16), compressed = directory.readUInt32LE(cursor + 20)
      const expanded = directory.readUInt32LE(cursor + 24), length = directory.readUInt16LE(cursor + 28)
      const extra = directory.readUInt16LE(cursor + 30), comment = directory.readUInt16LE(cursor + 32)
      const local = directory.readUInt32LE(cursor + 42), mode = directory.readUInt32LE(cursor + 38) >>> 16
      expect(cursor + 46 + length + extra + comment <= size && !(flags & 1) &&
        compressed !== 0xffffffff && expanded !== 0xffffffff && local !== 0xffffffff &&
        (mode & 0xf000) !== 0xa000, 'MERGE_ZIP_ENTRY')
      const nameBytes = directory.subarray(cursor + 46, cursor + 46 + length)
      const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes)
      foundation.safeRelative(name.endsWith('/') ? name.slice(0, -1) : name)
      expect(!names.has(name.toLowerCase()), 'MERGE_ZIP_DUPLICATE')
      names.add(name.toLowerCase())
      if (name === member) {
        expect([0, 8].includes(method) && expanded <= 16 * 1024 * 1024 &&
          compressed <= 32 * 1024 * 1024 && local + 30 <= offset, 'MERGE_ZIP_MEMBER')
        const header = read(local, 30)
        expect(header.readUInt32LE(0) === 0x04034b50 && header.readUInt16LE(6) === flags &&
          header.readUInt16LE(8) === method, 'MERGE_ZIP_LOCAL_HEADER')
        const localName = header.readUInt16LE(26), localExtra = header.readUInt16LE(28)
        expect(read(local + 30, localName).equals(nameBytes), 'MERGE_ZIP_LOCAL_NAME')
        const data = local + 30 + localName + localExtra
        expect(data + compressed <= offset, 'MERGE_ZIP_MEMBER')
        const bytes = read(data, compressed)
        selected = method === 0 ? bytes : zlib.inflateRawSync(bytes, { maxOutputLength: 16 * 1024 * 1024 })
        expect(selected.length === expanded && crc32(selected) === crc, 'MERGE_ZIP_MEMBER_BYTES')
      }
      cursor += 46 + length + extra + comment
    }
    expect(cursor === size && selected !== undefined, 'MERGE_ZIP_MEMBER_MISSING')
    return selected
  } finally { fs.closeSync(fd) }
}
function verifyPreparation({ target, candidateBytes, fragmentBytes, handoffBytes, policySha256, sourceCommit }) {
  const candidate = parse(candidateBytes), fragment = parse(fragmentBytes), handoff = parse(handoffBytes)
  expect(candidate.kind === 'rt-private-python-candidate-lock' && candidate.schemaVersion === 1 &&
    candidate.status === 'candidate' && candidate.resolutionComplete === true && candidate.releaseEligible === false &&
    candidate.target === target, 'MERGE_CANDIDATE_INVALID')
  expect(fragment.kind === 'rt-private-python-candidate-fragment' && fragment.schemaVersion === 1 &&
    fragment.status === 'candidate' && fragment.treeComplete === true && fragment.releaseEligible === false &&
    fragment.target === target && fragment.inputLockSha256 === sha(candidateBytes), 'MERGE_FRAGMENT_BINDING')
  expect(handoff.kind === 'rt-private-python-preparation-handoff' && handoff.status === 'candidate' &&
    handoff.resolutionComplete === true && handoff.treeComplete === true &&
    handoff.lock?.sha256 === sha(candidateBytes) && handoff.fragment?.sha256 === sha(fragmentBytes), 'MERGE_HANDOFF_BINDING')
  expect(candidate.preparationPolicySha256 === policySha256 && fragment.preparationPolicySha256 === policySha256 &&
    handoff.preparationPolicySha256 === policySha256 &&
    candidate.sourceCommit === sourceCommit && fragment.sourceCommit === sourceCommit &&
    handoff.sourceCommit === sourceCommit, 'MERGE_POLICY_SOURCE_BINDING')
  const snapshot = candidate.sourceSnapshot
  expect(snapshot?.policySha256 === policySha256 && Array.isArray(snapshot.files) &&
    equal(snapshot.files.map(row => row.path), [...PREPARATION_SOURCE].sort()) &&
    snapshot.files.every(row => /^[a-f0-9]{64}$/.test(row.sha256)) &&
    equal(fragment.sourceSnapshot, snapshot) && candidate.sourceSha256 === sha(preparationBytes(snapshot)) &&
    fragment.sourceSha256 === candidate.sourceSha256 && handoff.sourceSha256 === candidate.sourceSha256,
  'MERGE_SOURCE_SNAPSHOT_BINDING')
  expect(Array.isArray(fragment.inventory) && fragment.inventory.length > 0 &&
    sha(preparationBytes(fragment.inventory)) === fragment.inventorySha256, 'MERGE_INVENTORY_BINDING')
  return { candidate, fragment, handoff, snapshot }
}
function verifyTree(root, entries) {
  expect(path.isAbsolute(root) && fs.realpathSync(root) === path.resolve(root) &&
    fs.lstatSync(root).isDirectory(), 'MERGE_TREE_ROOT')
  const inventory = new Map(entries.map(row => [foundation.safeRelative(row.path), row]))
  expect(inventory.size === entries.length, 'MERGE_INVENTORY_DUPLICATE')
  const seen = new Set()
  function walk(directory, prefix = '') {
    for (const name of fs.readdirSync(directory)) {
      const relative = prefix ? prefix + '/' + name : name, filename = path.join(directory, name), stat = fs.lstatSync(filename)
      if (stat.isDirectory() && !stat.isSymbolicLink()) { walk(filename, relative); continue }
      const row = inventory.get(relative)
      expect(row && !seen.has(relative), 'MERGE_TREE_EXTRA_MEMBER')
      if (row.kind === 'file') {
        expect(stat.isFile() && !stat.isSymbolicLink() && stat.size === row.size &&
          hashFile(filename) === row.sha256, 'MERGE_TREE_FILE_BYTES')
      } else {
        expect(row.kind === 'symlink' && stat.isSymbolicLink() &&
          fs.readlinkSync(filename).replace(/\\/g, '/') === row.target &&
          foundation.below(fs.realpathSync(root), fs.realpathSync(filename)), 'MERGE_TREE_LINK')
      }
      seen.add(relative)
    }
  }
  walk(root)
  expect(seen.size === inventory.size, 'MERGE_TREE_MEMBER_MISSING')
}
function projectPlatform({ target, candidate, fragment, treeRoot, policy, policySha256 }) {
  const [platform, arch] = target.split('-')
  expect(TARGETS.includes(target) && equal(candidate.python, policy.targets[target].python) &&
    equal(candidate.node, policy.targets[target].node), 'MERGE_RUNTIME_POLICY_PINS')
  const requirements = fragment.licenseRequirements
  expect(Array.isArray(requirements) && requirements.length > 0, 'MERGE_LICENSE_EVIDENCE_MISSING')
  const approved = new Map(policy.licenseApprovals.map(row => [row.id, row]))
  expect(approved.size === policy.licenseApprovals.length, 'MERGE_DUPLICATE_APPROVAL')
  function licenses(component, version, hashes) {
    return requirements.filter(row => canonical(row.component) === canonical(component) && row.version === version &&
      hashes.includes(row.artifactSha256) && row.review === 'approved').map(row => {
      const approval = approved.get(row.approvalId)
      expect(approval?.decision === 'approved' && approval.component === row.component &&
        approval.version === row.version && approval.artifactSha256 === row.artifactSha256 &&
        approval.licenseSha256 === row.licenseSha256 && approval.spdx === row.spdx &&
        approval.reviewedBy && approval.reviewReference, 'MERGE_LICENSE_APPROVAL_BINDING')
      return { approvalId: row.approvalId, path: row.path, sha256: row.licenseSha256, spdx: row.spdx, review: row.review }
    })
  }
  const python = { ...structuredClone(candidate.python), distribution: 'python-build-standalone',
    executable: platform === 'win32' ? 'python/python.exe' : 'python/bin/python3.13',
    licenses: licenses('python-build-standalone', candidate.python.version,
      [candidate.python.asset.sha256, ...(candidate.python.licenseSources || []).map(row => row.sha256)]) }
  const node = { ...structuredClone(candidate.node), executable: platform === 'win32' ? 'node/node.exe' : 'node/bin/node',
    licenses: licenses('node', candidate.node.version, [candidate.node.asset.sha256]) }
  const providers = {}
  for (const name of PROVIDERS) {
    const resolved = candidate.providers?.[name], prepared = fragment.providers?.[name]
    expect(resolved && prepared && resolved.version === prepared.version && resolved.site === prepared.site &&
      resolved.site === 'providers/' + name + '/site', 'MERGE_PROVIDER_BINDING')
    const audit = parse(regular(path.join(treeRoot, prepared.dependencyAudit.path)))
    expect(sha(preparationBytes(audit)) === prepared.dependencyAudit.sha256 ||
      hashFile(path.join(treeRoot, prepared.dependencyAudit.path)) === prepared.dependencyAudit.sha256, 'MERGE_AUDIT_HASH')
    providers[name] = { version: resolved.version, site: resolved.site, dependencyAudit: structuredClone(prepared.dependencyAudit),
      ...(name === 'mootdx' ? { compatibility: resolved.version === '0.11.7+rt.node.1' ? 'private-node-js-runtime' : 'modern-mini-racer' } : {}),
      wheels: resolved.wheels.map(raw => {
        const rows = audit.wheels.filter(row => row.name === canonical(raw.distribution))
        expect(rows.length === 1 && rows[0].version === raw.version && rows[0].wheelSha256 === raw.asset.sha256 &&
          rows[0].metadataSha256 === raw.metadataSha256, 'MERGE_WHEEL_AUDIT_BINDING')
        return { ...structuredClone(raw), requiresDist: structuredClone(raw.dependencies),
          metadata: { path: rows[0].metadataPath, sha256: raw.metadataSha256 },
          licenses: licenses(raw.distribution, raw.version, [raw.asset.sha256]) }
      }) }
  }
  const mini = fragment.inventory.find(row => row.path === 'miniracer_unicode_adapter.py' && row.kind === 'file')
  expect(mini, 'MERGE_MINIRACER_INVENTORY')
  const nodeBackend = candidate.providers.akshare.version === '1.19.1+rt.node.1' && candidate.providers.mootdx.version === '0.11.7+rt.node.1'
  const context = { schemaVersion: 1, kind: 'rt-private-python-runtime', complete: true, releaseEligible: false,
    preparationPolicySha256: policySha256, platform, arch, ...(platform === 'darwin' ? { minimumMacOS: '12.0' } : {}),
    python, node, bootstrap: 'bootstrap.py', dependencyAuditValidator: structuredClone(fragment.dependencyAuditValidator),
    miniRacerAdapter: { path: mini.path, sha256: mini.sha256, version: nodeBackend ? '1.0.0' : '0.12.4', windowsStrategy: nodeBackend ? 'private-node-js-runtime-v1' : 'win32-unicode-resource-prewarm-v1' },
    providers, sbom: structuredClone(fragment.sbom), files: structuredClone(fragment.inventory) }
  const generator = candidate.sourceSnapshot.files.find(row => row.path === 'scripts/prepare-private-python-runtime.py')
  return foundation.projectDependencyGraphs(treeRoot, context, generator.sha256)
}
function finalizeStructuralLock(platforms, policySha256) {
  const lock = { schemaVersion: 1, status: 'locked', structuralOnly: true, releaseEligible: false,
    preparationPolicySha256: policySha256, platforms }
  try {
    foundation.validateLock(lock)
    return { lock, structuralValidationPassed: true }
  } catch (error) {
    // Keep real projections usable for review, never counterfeit approved rows
    // merely to satisfy the production foundation's license-required schema.
    if (error.message !== 'PRIVATE_RUNTIME_INVALID: license evidence missing') throw error
    lock.status = 'pending'
    return { lock, structuralValidationPassed: false, code: 'LICENSE_EVIDENCE_MISSING' }
  }
}
function mergeFromIndex({ index, policyBytes }) {
  const policy = parse(policyBytes), policySha256 = sha(policyBytes)
  expect(index.kind === 'rt-private-runtime-merge-input-v1' && index.schemaVersion === 1 &&
    index.preparationPolicySha256 === policySha256 && /^[a-f0-9]{40}$/.test(index.sourceCommit) &&
    Number.isSafeInteger(index.runId) && index.runId > 0 && Array.isArray(index.targets) && index.targets.length === 3 &&
    equal(index.targets.map(row => row.target).sort(), [...TARGETS].sort()), 'MERGE_INPUT_INDEX')
  const platforms = {}, bindings = {}, evidence = {}
  let sourceSnapshot
  for (const target of TARGETS) {
    const row = index.targets.find(row => row.target === target), stat = fs.lstatSync(row.archivePath)
    expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size === row.archiveSize &&
      hashFile(row.archivePath) === row.archiveSha256, 'MERGE_ARCHIVE_PIN')
    expect(Number.isSafeInteger(row.artifactId) && row.artifactId > 0 &&
      Number.isSafeInteger(row.jobId) && row.jobId > 0, 'MERGE_ARTIFACT_COORDINATES')
    const candidateBytes = regular(row.candidateLockPath), fragmentBytes = regular(row.fragmentPath), handoffBytes = regular(row.handoffPath)
    for (const [member, bytes] of [['prepare-candidate-lock.json', candidateBytes],
      ['prepare-candidate-fragment.json', fragmentBytes], ['handoff.json', handoffBytes]]) {
      expect(readZipMember(row.archivePath, member).equals(bytes), 'MERGE_ARTIFACT_METADATA_BYTES')
    }
    const prepared = verifyPreparation({ target, candidateBytes, fragmentBytes, handoffBytes, policySha256, sourceCommit: index.sourceCommit })
    if (sourceSnapshot) expect(equal(sourceSnapshot, prepared.snapshot), 'MERGE_CROSS_TARGET_SOURCE')
    else sourceSnapshot = prepared.snapshot
    verifyTree(row.treeRoot, prepared.fragment.inventory)
    platforms[target] = projectPlatform({ target, ...prepared, treeRoot: row.treeRoot, policy, policySha256 })
    bindings[target] = { candidateLockSha256: sha(candidateBytes), fragmentSha256: sha(fragmentBytes), handoffSha256: sha(handoffBytes) }
    evidence[target] = { artifactId: row.artifactId, jobId: row.jobId, archiveSha256: row.archiveSha256,
      archiveSize: row.archiveSize, inventorySha256: prepared.fragment.inventorySha256,
      pending: { candidate: prepared.candidate.pending, fragment: prepared.fragment.pending, handoff: prepared.handoff.pending },
      licenseRequirements: prepared.fragment.licenseRequirements, metadataProvenance: prepared.fragment.metadataProvenance,
      licenseApplicabilityEvidence: prepared.fragment.licenseApplicabilityEvidence }
  }
  const finalized = finalizeStructuralLock(platforms, policySha256), lock = finalized.lock
  const lockBytes = preparationBytes(lock), projectedLockSha256 = sha(lockBytes)
  const formalLockSha256 = finalized.structuralValidationPassed ? projectedLockSha256 : null
  if (formalLockSha256) for (const target of TARGETS) bindings[target].formalLockSha256 = formalLockSha256
  const missingLicenseComponents = TARGETS.flatMap(target => {
    const platform = platforms[target]
    const runtimes = ['python', 'node'].flatMap(runtime => {
      const value = platform[runtime]
      return value.licenses.length === 0
        ? [{ target, runtime, component: value.distribution || runtime, version: value.version, artifactSha256: value.asset.sha256 }]
        : []
    })
    const wheels = Object.entries(platform.providers).flatMap(([provider, value]) =>
      value.wheels.filter(wheel => wheel.licenses.length === 0).map(wheel =>
        ({ target, provider, component: wheel.distribution, version: wheel.version, artifactSha256: wheel.asset.sha256 })))
    return [...runtimes, ...wheels]
  })
  const receipt = { schemaVersion: 1, kind: 'rt-private-runtime-structural-merge-receipt-v1',
    structuralOnly: true, releaseEligible: false, sourceVerified: false, nativeBootstrapVerified: false,
    preparationPolicySha256: policySha256, sourceCommit: index.sourceCommit, prepareRunId: index.runId,
    sourceSnapshot, sourceSnapshotSha256: sha(preparationBytes(sourceSnapshot)), formalLockSha256, projectedLockSha256,
    structuralValidationPassed: finalized.structuralValidationPassed,
    ...(finalized.code ? { code: finalized.code } : {}),
    missingLicenseComponents,
    ...(formalLockSha256 ? { stagingInputs: bindings } : { candidateBindings: bindings }),
    preparationEvidence: evidence }
  return { lock, lockBytes, receipt }
}
function options(argv) {
  const result = {}, names = { '--index': 'indexPath', '--policy': 'policyPath', '--output': 'outputRoot' }
  for (let i = 0; i < argv.length; i += 2) {
    expect(names[argv[i]] && argv[i + 1] && !Object.hasOwn(result, names[argv[i]]), 'MERGE_USAGE')
    result[names[argv[i]]] = argv[i + 1]
  }
  expect(Object.keys(result).length === 3 && Object.values(result).every(path.isAbsolute), 'MERGE_USAGE')
  return result
}
function run({ indexPath, policyPath, outputRoot }) {
  expect(path.isAbsolute(outputRoot) && !fs.existsSync(outputRoot) &&
    fs.realpathSync(path.dirname(outputRoot)) === path.resolve(path.dirname(outputRoot)), 'MERGE_FRESH_OUTPUT_REQUIRED')
  const result = mergeFromIndex({ index: parse(regular(indexPath)), policyBytes: regular(policyPath) })
  fs.mkdirSync(outputRoot)
  const lockName = result.receipt.structuralValidationPassed ? 'formal-lock.json' : 'formal-lock.candidate.json'
  fs.writeFileSync(path.join(outputRoot, lockName), result.lockBytes, { flag: 'wx' })
  fs.writeFileSync(path.join(outputRoot, 'binding-receipt.json'), preparationBytes(result.receipt), { flag: 'wx' })
  return { status: result.receipt.structuralValidationPassed ? 'structurally-merged' : 'projection-pending-license',
    releaseEligible: false, formalLockSha256: result.receipt.formalLockSha256,
    projectedLockSha256: result.receipt.projectedLockSha256,
    lockPath: path.join(outputRoot, lockName), receiptPath: path.join(outputRoot, 'binding-receipt.json') }
}
if (require.main === module) {
  try {
    const result = run(options(process.argv.slice(2)))
    process.stdout.write(JSON.stringify(result) + '\n')
    if (result.status !== 'structurally-merged') process.exitCode = 2
  }
  catch (error) {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error.code || '') ? error.code : 'MERGE_INVALID'
    process.stderr.write(JSON.stringify({ status: 'rejected', releaseEligible: false, code }) + '\n'); process.exitCode = 1
  }
}
module.exports = { readZipMember, verifyPreparation, verifyTree, projectPlatform, finalizeStructuralLock, mergeFromIndex, options, run }
