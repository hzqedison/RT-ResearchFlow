'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const seal = require('../../scripts/seal-private-python-runtime.cjs')
const H = '1'.repeat(64)
const context = { approvedPolicySha256: H, sourceSnapshotSha256: H, approvedSourceCommit: 'a'.repeat(40) }
function fixture(scope, selected = 'darwin-arm64') {
  const trust = { ...context, assemblyTarget: selected, ...(scope === undefined ? {} : { distributionScope: scope }) }
  const manifests = Object.fromEntries(seal.TARGETS.map(target => {
    const [platform, arch] = target.split('-')
    return [target, { platform, arch, python: { version: '3.13', asset: { sha256: H } },
      node: { version: '22', asset: { sha256: H } }, providers: {}, files: [] }]
  }))
  const rules = { schemaVersion: 1, kind: 'rt-runtime-distribution-obligation-policy-v1',
    preparationPolicySha256: H, assets: [] }
  const sourceMembers = new Map([['review.json', H]])
  for (const target of seal.TARGETS) for (const asset of seal.executionAssets(manifests[target]))
    rules.assets.push({ target, ...asset, classification: 'notice-only', obligations: [], reviewRecord: { path: 'review.json', sha256: H } })
  const proof = { kind: 'runtime-distribution-obligations-v1', policySha256: H, sourceSnapshotSha256: H,
    targets: seal.TARGETS.map(target => ({ target, artifactSetSha256: seal.digest(seal.executionAssets(manifests[target])),
      inventorySha256: seal.digest([]), dependencyAuditSha256: seal.digest([]), reviews: [] })) }
  return { trust, manifests, rules, proof, sourceMembers, authority: {}, preparedRoot: '.' }
}
test('default scope retains all three target gates', () => {
  assert.deepEqual(seal.distributionTargets(context), seal.TARGETS)
})
test('only a known source-authorized scope and target are accepted', () => {
  for (const trust of [{ distributionScope: 'skip' }, { distributionScope: 'assembly-target', assemblyTarget: 'linux-x64' }])
    assert.throws(() => seal.distributionTargets(trust), /DISTRIBUTION_SCOPE_INVALID/)
})
test('Mac delivery checks its policy, not Windows policy, while Windows remains blocked', () => {
  const f = fixture('assembly-target')
  const visited = []
  const foundation = { validatePreparationPolicy(manifest) {
    const target = manifest.platform + '-' + manifest.arch
    visited.push(target)
    if (target === 'win32-x64') throw Error('WINDOWS_ENTITLEMENT_PENDING')
  } }
  assert.deepEqual(seal.verifyDistributionPolicies({ ...f, policy: {}, policySha256: H, foundation }), ['darwin-arm64'])
  assert.deepEqual(visited, ['darwin-arm64'])
  assert.throws(() => seal.verifyDistributionPolicies({ ...f, trust: { ...f.trust, assemblyTarget: 'win32-x64' },
    policy: {}, policySha256: H, foundation }), /WINDOWS_ENTITLEMENT_PENDING/)
})
test('selected Mac policy denial is never skipped', () => {
  const f = fixture('assembly-target')
  assert.throws(() => seal.verifyDistributionPolicies({ ...f, policy: {}, policySha256: H,
    foundation: { validatePreparationPolicy() { throw Error('MAC_LICENSE_PENDING') } } }), /MAC_LICENSE_PENDING/)
})
test('unreviewed non-delivered target does not discharge its obligations', async () => {
  const f = fixture('assembly-target')
  const rule = f.rules.assets.find(row => row.target === 'win32-x64')
  rule.classification = 'additional-obligations'
  rule.obligations = [{ kind: 'redistribution-entitlement', id: 'windows-entitlement',
    scope: { licenseSha256: H }, requiredEvidence: ['original-notice-bytes'], payloadFiles: [] }]
  await seal.verifyObligationCoverage(f)
  await assert.rejects(seal.verifyObligationCoverage({ ...f, trust: { ...f.trust, assemblyTarget: 'win32-x64' } }), /OBLIGATION_REVIEW_MISSING/)
  await assert.rejects(seal.verifyObligationCoverage({ ...f, trust: { ...f.trust, distributionScope: undefined } }), /OBLIGATION_REVIEW_MISSING/)
})
test('selected-target missing classification, duplicate rule and byte binding still fail', async () => {
  for (const mutation of [
    f => { f.rules.assets = f.rules.assets.filter(row => row.target !== 'darwin-arm64') },
    f => { f.rules.assets.push({ ...f.rules.assets.find(row => row.target === 'darwin-arm64') }) },
    f => { f.proof.targets.find(row => row.target === 'darwin-arm64').inventorySha256 = '2'.repeat(64) }
  ]) {
    const f = fixture('assembly-target'); mutation(f)
    await assert.rejects(seal.verifyObligationCoverage(f))
  }
})
test('unknown asset targets are rejected even with selected distribution scope', async () => {
  const f = fixture('assembly-target')
  f.rules.assets.push({ ...f.rules.assets[0], target: 'unreviewed-platform' })
  await assert.rejects(seal.verifyObligationCoverage(f), /UNEXPECTED_OBLIGATION_ASSET/)
})
test('all producers retain unknown-pending rejection, without claiming other target assembly', () => {
  const fragments = Object.fromEntries(seal.TARGETS.map(target => [target, { pending: [
    'Per-artifact applicable license approvals are pending; candidate is not release eligible'
  ] }]))
  seal.verifyDistributionPending(fragments, ['darwin-arm64'], true)
  fragments['win32-x64'].pending.push('unrecognized-stop')
  assert.throws(() => seal.verifyDistributionPending(fragments, ['darwin-arm64'], true), /PREPARATION_PENDING_REMAINS/)
})
