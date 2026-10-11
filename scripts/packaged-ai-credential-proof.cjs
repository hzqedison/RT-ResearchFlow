'use strict'
const SPEC = 'tests/e2e/packaged-ai-credentials.spec.ts'
const TITLE = 'packaged AI partial saves retain drafts and OS-encrypted keys survive restart'
function reject() { throw Error('PACKAGED_CREDENTIAL_EVIDENCE_NOT_ACCEPTED') }
function requireCredentialReport(report) {
  const stats = report?.stats
  if (!stats || stats.expected !== 1 || stats.unexpected !== 0 || stats.skipped !== 0 || stats.flaky !== 0 ||
      !Array.isArray(report.errors) || report.errors.length) reject()
  const specs = []
  function visit(suite) {
    if (!suite || typeof suite !== 'object') reject()
    for (const spec of suite.specs || []) specs.push(spec)
    for (const child of suite.suites || []) visit(child)
  }
  if (!Array.isArray(report.suites)) reject()
  report.suites.forEach(visit)
  if (specs.length !== 1) reject()
  const spec = specs[0], file = String(spec.file || '').replaceAll('\\', '/')
  if (spec.title !== TITLE || !(file === SPEC || file.endsWith('/' + SPEC)) || spec.ok !== true || spec.tests?.length !== 1) reject()
  const test = spec.tests[0]
  if (test.expectedStatus !== 'passed' || test.status !== 'expected' || test.results?.length !== 1) reject()
  const result = test.results[0]
  if (result.status !== 'passed' || result.retry !== 0 || result.error || result.errors?.length) reject()
  return { expected: 1, unexpected: 0, skipped: 0, flaky: 0 }
}
function requireCredentialProof(proof, expected) {
  if (!proof || proof.kind !== 'rt-packaged-ai-credentials-v1' || proof.localCredentialPersistenceVerified !== true ||
      proof.fixture !== 'synthetic-loopback' || proof.brokerOrdersSubmitted !== false) reject()
  for (const key of ['version', 'sourceCommit', 'runId', 'platform', 'arch', 'executableSha256', 'appAsarSha256']) {
    if (!expected[key] || proof[key] !== expected[key]) reject()
  }
  if (proof.stats?.expected !== 1 || proof.stats.unexpected !== 0 || proof.stats.skipped !== 0 || proof.stats.flaky !== 0) reject()
  return true
}
module.exports = { SPEC, requireCredentialReport, requireCredentialProof }
