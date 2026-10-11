'use strict'
// Called only after real packaged-app acceptance. Never uploads or publishes.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const version = require('../package.json').version
const commit = process.env.GITHUB_SHA
const root = path.resolve(__dirname, '..', 'release')
if (version !== '1.11.0' || !/^[a-f0-9]{40}$/.test(commit || '')) throw Error('INVALID_RELEASE_CONTEXT')
const name = process.platform === 'darwin'
  ? `RT-ResearchFlow-macOS-${version}-${process.arch}.dmg`
  : `RT-ResearchFlow-Setup-${version}-${process.arch}.exe`
const filename = path.join(root, name)
async function main() {
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
    liveMarketDataAccepted: false, brokerOrdersSubmitted: false, published: false }
  fs.writeFileSync(path.join(root, `acceptance-${label}.json`), JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify(receipt))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
