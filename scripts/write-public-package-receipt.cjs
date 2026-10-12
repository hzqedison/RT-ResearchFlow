'use strict'
// Called only after real packaged-app acceptance. Never uploads or publishes.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { requireCredentialProof } = require('./packaged-ai-credential-proof.cjs')
const { digest, asarPath } = require('./verify-packaged-ai-credentials.cjs')
const version = require('../package.json').version
const commit = process.env.GITHUB_SHA
const root = path.resolve(__dirname, '..', 'release')
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || process.env.RT_PACKAGED_VERSION !== version || !/^[a-f0-9]{40}$/.test(commit || '')) throw Error('INVALID_RELEASE_CONTEXT')
const name = process.platform === 'darwin'
  ? `RT-ResearchFlow-macOS-${version}-${process.arch}.dmg`
  : `RT-ResearchFlow-Setup-${version}-${process.arch}.exe`
const filename = path.join(root, name)
async function main() {
  if (Number(version.split('.')[1]) >= 16 && process.env.RT_PACKAGED_LEDGER_VERIFIED !== '1') throw Error('PACKAGED_LEDGER_ACCEPTANCE_REQUIRED')
  if (Number(version.split('.')[1]) >= 17 && process.env.RT_PACKAGED_CAPITAL_VERIFIED !== '1') throw Error('PACKAGED_CAPITAL_ACCEPTANCE_REQUIRED')
  if (Number(version.split('.')[1]) >= 18 && process.env.RT_PACKAGED_VALIDATION_VERIFIED !== '1') throw Error('PACKAGED_VALIDATION_ACCEPTANCE_REQUIRED')
  if (Number(version.split('.')[1]) >= 18 && process.env.RT_PACKAGED_PUBLIC_WORK_VERIFIED !== '1') throw Error('PACKAGED_PUBLIC_WORK_ACCEPTANCE_REQUIRED')
  if (Number(version.split('.')[1]) >= 18 && process.env.RT_PACKAGED_TUSHARE_WORK_VERIFIED !== '1') throw Error('PACKAGED_TUSHARE_WORK_ACCEPTANCE_REQUIRED')
  if (Number(version.split('.')[1]) >= 19 && process.env.RT_PACKAGED_STRUCTURE_WORK_VERIFIED !== '1') throw Error('PACKAGED_STRUCTURE_WORK_ACCEPTANCE_REQUIRED')
  if (Number(version.split('.')[1]) >= 21 && process.env.RT_PACKAGED_RESEARCH_SNAPSHOT_VERIFIED !== '1') throw Error('PACKAGED_RESEARCH_SNAPSHOT_ACCEPTANCE_REQUIRED')
  const executable = process.env.RT_PACKAGED_EXE
  if (!executable || !path.isAbsolute(executable)) throw Error('PACKAGED_EXECUTABLE_REQUIRED')
  const proof = JSON.parse(fs.readFileSync(path.join(root, `packaged-ai-credentials-proof-${process.platform}-${process.arch}.json`), 'utf8'))
  requireCredentialProof(proof, { version, sourceCommit: commit, runId: process.env.GITHUB_RUN_ID,
    platform: process.platform, arch: process.arch, executableSha256: await digest(executable), appAsarSha256: await digest(asarPath(executable)) })
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('INVALID_INSTALLER_FILE')
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk)
  const sha256 = hash.digest('hex')
  const label = `${process.platform}-${process.arch}`
  fs.writeFileSync(path.join(root, `SHA256SUMS-${label}.txt`), `${sha256}  ${name}\n`)
  const receipt = { version, sourceCommit: commit, runId: process.env.GITHUB_RUN_ID, platform: process.platform,
    arch: process.arch, file: name, size: stat.size, sha256, extensionDelivery: 'on-demand',
    packagedStartupAndExit: true, packagedPdfCanvasSqlite: true, actualPrivateAkshareInstall: true,
    localCredentialPersistenceVerified: true, credentialFixture: 'synthetic-loopback',
    localAccountLedgerPersistenceVerified: process.env.RT_PACKAGED_LEDGER_VERIFIED === '1',
    localPortfolioSimulationPersistenceVerified: process.env.RT_PACKAGED_CAPITAL_VERIFIED === '1',
    localRollingValidationPersistenceVerified: process.env.RT_PACKAGED_VALIDATION_VERIFIED === '1',
    localPublicWorkShutdownVerified: process.env.RT_PACKAGED_PUBLIC_WORK_VERIFIED === '1',
    localSyntheticTushareWorkShutdownVerified: process.env.RT_PACKAGED_TUSHARE_WORK_VERIFIED === '1',
    localChipStructureWorkShutdownVerified: process.env.RT_PACKAGED_STRUCTURE_WORK_VERIFIED === '1',
    localFrozenResearchSnapshotVerified: process.env.RT_PACKAGED_RESEARCH_SNAPSHOT_VERIFIED === '1',
    liveMarketDataAccepted: false, brokerOrdersSubmitted: false, published: false }
  fs.writeFileSync(path.join(root, `acceptance-${label}.json`), JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify(receipt))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
