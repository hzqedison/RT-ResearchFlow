'use strict'
// This helper is loaded by the installed Electron, never by a workspace SQLite build.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
function check(value, code) { if (!value) throw Object.assign(new Error(code), { acceptanceCode: code }) }
function snapshot(input, safeStorage) {
  const { appPath, userData, contract, expected, sourceId, keys, activeKey, previousKey } = input
  const installedRequire = createRequire(path.join(appPath, 'package.json'))
  const resolved = installedRequire.resolve('better-sqlite3')
  check(resolved.startsWith(appPath + path.sep) || resolved.startsWith(appPath + '.unpacked' + path.sep), 'SQLITE_OUTSIDE_INSTALLED_PACKAGE')
  const Database = installedRequire('better-sqlite3')
  const database = path.join(userData, contract.databaseBasename)
  check(fs.lstatSync(database).isFile() && !fs.lstatSync(database).isSymbolicLink(), 'DATABASE_NOT_REGULAR')
  const db = new Database(database, { readonly: true, fileMustExist: true, timeout: 3000 })
  let result
  try {
    check(db.readonly === true, 'SQLITE_NOT_READONLY')
    const settings = db.prepare(contract.sql.settings).get()
    const ai = db.prepare(contract.sql.ai).get()
    const provider = db.prepare(contract.sql.provider).get(contract.provider.provider)
    const source = db.prepare(contract.sql.source).get(sourceId)
    const migrations = db.prepare(contract.sql.migrations).all().map(row => row.version)
    const cipherValue = db.prepare(contract.sql.cipher).get(contract.provider.provider)?.apiKeyEncrypted
    const cipher = cipherValue == null ? Buffer.alloc(0) : Buffer.from(cipherValue)
    check(settings && Object.entries(contract.settings).every(([key, value]) => settings[key] === value), 'SETTINGS_VALUES_CHANGED')
    check(provider && provider.model === contract.provider.model && provider.baseUrl === expected.baseUrl
      && provider.maxTokens === expected.maxTokens && provider.presetPrompt === expected.presetPrompt, 'PROVIDER_VALUES_CHANGED')
    check(source && source.id === sourceId && source.nameCN === expected.sourceName && source.nameEN === expected.sourceName
      && source.url === expected.origin && source.feedUrl === expected.origin + '/rss' && source.parseStrategy === 'RSS'
      && source.authorityWeight === 3 && source.isBuiltIn === 0 && source.isEnabled === 0, 'BUSINESS_SOURCE_CHANGED')
    check(db.prepare(contract.sql.otherKeys).get(contract.provider.provider).count === 0, 'OTHER_PROVIDER_HAS_KEY')
    let encryptionAvailable = false, decryptMatches = false, rejectsPrevious = false
    if (activeKey && safeStorage) {
      encryptionAvailable = safeStorage.isEncryptionAvailable()
      check(encryptionAvailable && cipher.length > 0, 'SYSTEM_ENCRYPTION_UNAVAILABLE')
      const decrypted = safeStorage.decryptString(cipher)
      decryptMatches = decrypted === activeKey
      rejectsPrevious = !previousKey || decrypted !== previousKey
      check(decryptMatches && rejectsPrevious, 'SYSTEM_DECRYPT_MISMATCH')
    } else if (!activeKey) check(cipher.length === 0, 'WINDOWS_UNEXPECTED_CREDENTIAL')
    result = { sqliteReadonly: true, sqliteModuleInsidePackage: true, settingsSha256: digest(settings), aiSha256: digest(ai),
      providerSha256: digest(provider), sourceSha256: digest(source), sourceId, migrations,
      cipherSha256: digest(cipher), cipherBytes: cipher.length, otherKeysEmpty: true,
      encryptionAvailable, decryptMatches, rejectsPrevious }
  } finally { db.close() }
  result.dbFiles = ['', '-wal', '-shm'].map((suffix, index) => {
    const file = database + suffix
    if (!fs.existsSync(file)) { check(index !== 0, 'DATABASE_MISSING'); return { fileClass: ['database', 'wal', 'shm'][index], absent: true, plaintextAbsent: true } }
    check(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), 'DATABASE_FILE_NOT_REGULAR')
    const bytes = fs.readFileSync(file)
    for (const key of keys) for (const encoding of ['utf8', 'utf16le']) check(!bytes.includes(Buffer.from(key, encoding)), 'PLAINTEXT_CREDENTIAL_ON_DISK')
    return { fileClass: ['database', 'wal', 'shm'][index], absent: false, plaintextAbsent: true }
  })
  return result
}
module.exports = { snapshot }
if (require.main === module) {
  const chunks = []; let size = 0
  process.stdin.on('data', chunk => { size += chunk.length; if (size > 65536) process.exit(2); chunks.push(chunk) })
  process.stdin.on('end', () => {
    try { process.stdout.write(JSON.stringify({ ok: true, snapshot: snapshot(JSON.parse(Buffer.concat(chunks).toString('utf8')), null) })) }
    catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.acceptanceCode || 'POST_EXIT_SQLITE_FAILED' })); process.exitCode = 1 }
  })
}
