'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const names = ['application-source.zip', 'DEVELOPMENT-RUNTIME.txt', 'SOURCE-ACCESS.txt']
const formal = '030b7a5200052ecdf3cef0a2611b61e40f0dfa71adf1b018898f1cb137144cc2'
const development = 'b032e0adf559ecb2ae08248748a2c77923521c6a172c4cec478dbd24e4ef6953'
const hash = raw => crypto.createHash('sha256').update(raw).digest('hex')
function read(root, name, cap = 128 * 1024 * 1024) {
  if (!path.isAbsolute(root) || fs.lstatSync(root).isSymbolicLink() || ![...names, 'source-receipt.json'].includes(name)) throw Error('MAC_SOURCE_PATH_INVALID')
  const filename = path.join(root, name), stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > cap) throw Error('MAC_SOURCE_FILE_INVALID')
  const raw = fs.readFileSync(filename)
  if (raw.length !== stat.size) throw Error('MAC_SOURCE_FILE_CHANGED')
  return raw
}
function load(root, { version = require('../package.json').version, sourceCommit } = {}) {
  const raw = read(root, 'source-receipt.json', 65536), plan = JSON.parse(raw)
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || plan.kind !== 'rt-mac-owner-source-plan-v1' || plan.version !== version || plan.repository !== 'hzqedison/RT-ResearchFlow' ||
      !/^[a-f0-9]{40}$/.test(plan.sourceCommit || '') || plan.formalLockSha256 !== formal || plan.releaseEligible !== false ||
      (sourceCommit !== undefined && plan.sourceCommit !== sourceCommit) ||
      !Array.isArray(plan.files) || plan.files.length !== names.length || new Set(plan.files.map(f => f.path)).size !== names.length ||
      names.some(n => !plan.files.some(f => f.path === n))) throw Error('MAC_SOURCE_PLAN_INVALID')
  for (const file of plan.files) {
    const bytes = read(root, file.path)
    if (!Number.isSafeInteger(file.size) || file.size !== bytes.length || !/^[a-f0-9]{64}$/.test(file.sha256 || '') || hash(bytes) !== file.sha256) throw Error('MAC_SOURCE_BYTES_CHANGED')
  }
  if (plan.files.find(f => f.path === 'DEVELOPMENT-RUNTIME.txt').sha256 !== development) throw Error('MAC_DEVELOPMENT_INSTRUCTIONS_CHANGED')
  const notice = read(root, 'SOURCE-ACCESS.txt').toString('utf8')
  if (!notice.includes(plan.sourceCommit) || !notice.includes(plan.version) || !notice.includes('application-source.zip')) throw Error('MAC_SOURCE_NOTICE_INVALID')
  return { raw, plan }
}
function withMacSourceDelivery(base) {
  const root = process.env.RT_MAC_OWNER_SOURCE_ROOT
  if (!root) return base
  const extras = base.mac?.extraResources == null ? [] : Array.isArray(base.mac.extraResources) ? base.mac.extraResources : [base.mac.extraResources]
  function verify(context) {
    const binding = { version: context.packager.appInfo.version, sourceCommit: process.env.GITHUB_SHA }
    const expected = load(root, binding), app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app')
    const dest = path.join(app, 'Contents', 'Resources', 'third-party', 'application-source')
    const actual = load(dest, binding)
    if (!actual.raw.equals(expected.raw)) throw Error('MAC_SOURCE_RECEIPT_CHANGED')
    return { target: context.electronPlatformName, version: actual.plan.version, sourceCommit: actual.plan.sourceCommit, copiedFiles: names.length + 1, copyVerified: true, releaseEligible: false }
  }
  return { ...base, mac: { ...base.mac, extraResources: [...extras, { from: root, to: 'third-party/application-source', filter: [...names, 'source-receipt.json'] }] },
    async beforePack(context) { if (context.electronPlatformName === 'darwin') load(root, { version: context.packager.appInfo.version, sourceCommit: process.env.GITHUB_SHA }); if (base.beforePack) await base.beforePack(context) },
    async afterPack(context) { if (base.afterPack) await base.afterPack(context); if (context.electronPlatformName === 'darwin') console.log('Mac source delivery: ' + JSON.stringify(verify(context))) },
    async afterSign(context) { if (base.afterSign) await base.afterSign(context); if (context.electronPlatformName === 'darwin') verify(context) },
  }
}
module.exports = { withMacSourceDelivery, load, read, names, formal, development }
