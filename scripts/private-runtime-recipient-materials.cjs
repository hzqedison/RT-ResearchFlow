'use strict'

// Pre-sign evidence from protected source bytes and the fixed Mac recipient hook.
// This does not attest installation, public redistribution rights or final delivery.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const Module = require('node:module')
const HOOK = 'scripts/mac-distribution-materials.cjs'
const BUILDER = 'electron-builder.js'
const SOURCE = 'resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011'
const MANIFEST = SOURCE + '/delivery-manifest.json'
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function fail(code) { const error = new Error(code); error.code = code; error.sealStatus = 'invalid'; throw error }
function name(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') ||
      value.split('/').some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part))) fail('DISTRIBUTION_EVIDENCE_PATH_INVALID')
  return value
}
function bytes(root, relative, cap = 4 * 1024 * 1024) {
  name(relative)
  const base = fs.realpathSync(root), filename = path.resolve(base, relative)
  if (!filename.startsWith(base + path.sep)) fail('DISTRIBUTION_EVIDENCE_PATH_ESCAPE')
  let cursor = base
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part)
    if (fs.lstatSync(cursor).isSymbolicLink()) fail('DISTRIBUTION_EVIDENCE_LINK')
  }
  const fd = fs.openSync(filename, 'r')
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > cap) fail('DISTRIBUTION_EVIDENCE_FILE_INVALID')
    const raw = fs.readFileSync(fd)
    if (raw.length !== stat.size) fail('DISTRIBUTION_EVIDENCE_FILE_CHANGED')
    return raw
  } finally { fs.closeSync(fd) }
}
function createDistributionEvidenceReader({ repositoryRoot, sourceMembers, trustedContext }) {
  if (!(sourceMembers instanceof Map) || !trustedContext) fail('DISTRIBUTION_EVIDENCE_CONTEXT_REQUIRED')
  // The verified producer constructs this map. Copy it so a caller cannot change
  // accepted source identities while an asynchronous review is being evaluated.
  const members = new Map(sourceMembers), context = structuredClone(trustedContext)
  let materialPlan
  function sourceBytes(filename, expected) {
    name(filename)
    if (!/^[a-f0-9]{64}$/.test(expected || '') || members.get(filename) !== expected) fail('DISTRIBUTION_EVIDENCE_SOURCE_NOT_VERIFIED')
    const raw = bytes(repositoryRoot, filename)
    if (hash(raw) !== expected) fail('DISTRIBUTION_EVIDENCE_SOURCE_CHANGED')
    return raw
  }
  function plan(target) {
    if (!['darwin-arm64', 'darwin-x64'].includes(target)) fail('RECIPIENT_MATERIAL_TARGET_INVALID')
    const pins = context.recipientMaterials
    if (!pins || pins.kind !== 'mac-third-party-source-plan-v1' ||
        pins.manifestPath !== MANIFEST || pins.hookPath !== HOOK || pins.builderPath !== BUILDER ||
        !Array.isArray(pins.targets) || new Set(pins.targets).size !== pins.targets.length ||
        pins.targets.some(value => !['darwin-arm64', 'darwin-x64'].includes(value)) ||
        !pins.targets.includes(target)) fail('RECIPIENT_MATERIAL_PROTECTED_PLAN_REQUIRED')
    if (materialPlan) return materialPlan
    sourceBytes(MANIFEST, pins.manifestSha256)
    sourceBytes(BUILDER, pins.builderSha256)
    const raw = sourceBytes(HOOK, pins.hookSha256)
    const filename = path.join(fs.realpathSync(repositoryRoot), HOOK)
    const child = new Module(filename, module)
    child.filename = filename
    child.require = request => {
      if (!request.startsWith('node:') || !Module.isBuiltin(request)) fail('RECIPIENT_HOOK_DEPENDENCY_UNVERIFIED')
      return require(request)
    }
    child._compile(new TextDecoder('utf-8', { fatal: true }).decode(raw), filename)
    const hook = child.exports
    if (hook.SOURCE !== SOURCE || hook.DESTINATION !== 'third-party/python-runtime-mac' ||
        hook.MANIFEST_SHA256 !== pins.manifestSha256 || typeof hook.loadPlan !== 'function' ||
        typeof hook.recipientIndex !== 'function') fail('RECIPIENT_HOOK_PLAN_MISMATCH')
    const loaded = hook.loadPlan()
    if (!Array.isArray(loaded.files) || loaded.files.length !== 21 ||
        new Set(loaded.files.map(row => row.path)).size !== loaded.files.length) fail('RECIPIENT_MATERIAL_COVERAGE_INVALID')
    const files = new Map()
    for (const row of loaded.files) {
      name(row.path)
      if (members.get(SOURCE + '/' + row.path) !== row.sha256) fail('RECIPIENT_MATERIAL_SOURCE_NOT_VERIFIED')
      files.set(row.path, { ...row })
    }
    const index = Buffer.from(hook.recipientIndex(loaded.files), 'utf8')
    files.set('START-HERE.txt', { path: 'START-HERE.txt', size: index.length, sha256: hash(index), generated: index })
    materialPlan = files
    return materialPlan
  }
  return function read({ target, manifest, file, role, preparedRoot }) {
    if (!file || !['payload', 'evidence'].includes(role) || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) fail('DISTRIBUTION_EVIDENCE_FILE_INVALID')
    name(file.path)
    const location = file.location === undefined ? 'runtime' : file.location
    let raw
    if (location === 'runtime') {
      if (role === 'payload' && !manifest.files.some(row => row.kind === 'file' && row.path === file.path && row.sha256 === file.sha256))
        fail('OBLIGATION_PAYLOAD_BYTES')
      raw = bytes(path.join(preparedRoot, target), file.path)
    } else if (location === 'source-review') {
      if (role !== 'evidence') fail('SOURCE_REVIEW_IS_NOT_RECIPIENT_PAYLOAD')
      raw = sourceBytes(file.path, file.sha256)
    } else if (location === 'mac-recipient-material') {
      const row = plan(target).get(file.path)
      if (!row || row.sha256 !== file.sha256) fail('RECIPIENT_MATERIAL_NOT_IN_PROTECTED_PLAN')
      raw = row.generated ? Buffer.from(row.generated) : sourceBytes(SOURCE + '/' + row.path, row.sha256)
      if (raw.length !== row.size) fail('RECIPIENT_MATERIAL_BYTES_CHANGED')
    } else fail('DISTRIBUTION_EVIDENCE_LOCATION_INVALID')
    if (hash(raw) !== file.sha256) fail('OBLIGATION_EVIDENCE_BYTES')
    return raw
  }
}
module.exports = { createDistributionEvidenceReader, HOOK, BUILDER, SOURCE, MANIFEST, hash }
