import fs from 'node:fs'
import { safeDiagnostic } from '../evidence.mjs'
import path from 'node:path'
import { command, controlledRoot, requireCondition as need, AcceptanceError, hashFile } from '../evidence.mjs'

const [action, suppliedRoot, installer, version] = process.argv.slice(2)
const { root, owner } = controlledRoot()
need(suppliedRoot === root && owner.platform === 'macOS', 'BLOCKED_ENVIRONMENT', 'MAC_OWNER_INVALID')
const bundle = path.join(root, 'install', 'RT-ResearchFlow.app')
const executable = path.join(bundle, 'Contents/MacOS/RT-ResearchFlow')
const keychain = path.join(root, 'acceptance.keychain-db')
const mount = path.join(root, 'mounted-installer')
const stateFile = path.join(root, 'mac-state.json')
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {}
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 })
async function run(exe, args, options = {}) {
  const result = await command(exe, args, options)
  if (result.code !== 0) {
    const failure = new AcceptanceError(options.kind || 'BLOCKED_ENVIRONMENT', options.code || 'MAC_NATIVE_COMMAND_FAILED')
    failure.nativeError = { name: result.diagnostic?.errorClass, code: result.diagnostic?.errno,
      errno: result.diagnostic?.errnoNumber, syscall: result.diagnostic?.syscall, exitCode: result.code, signal: result.signal }
    throw failure
  }
  return result.stdout.trim()
}
function quotedPaths(value) {
  const lines = value.split('\n').map(line => line.trim()).filter(Boolean)
  need(lines.every(line => /^"[^"\n]+"$/.test(line)), 'BLOCKED_ENVIRONMENT', 'KEYCHAIN_LIST_FORMAT_UNSUPPORTED')
  return lines.map(line => line.slice(1, -1))
}
async function processes() {
  const output = await run('/bin/ps', ['-axo', 'pid=,ppid=,comm='])
  const all = output.split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    return match ? { pid: +match[1], parentId: +match[2], exe: match[3] } : null
  }).filter(Boolean)
  const selected = all.filter(item => item.exe.startsWith(root + '/') && item.exe.includes('.app/'))
  for (let previous = -1; previous !== selected.length;) {
    previous = selected.length
    for (const item of all) if (selected.some(parent => parent.pid === item.parentId) && !selected.some(other => other.pid === item.pid)) selected.push(item)
  }
  return selected
}
async function main() {
  if (action === 'setup') {
    need(!fs.existsSync(bundle) && !fs.existsSync(stateFile), 'BLOCKED_ENVIRONMENT', 'MAC_CASE_NOT_EMPTY')
    need(fs.existsSync('/usr/bin/sandbox-exec'), 'BLOCKED_ENVIRONMENT', 'SANDBOX_UNAVAILABLE')
    const publicProcesses = await run('/bin/ps', ['-axo', 'comm='])
    need(!publicProcesses.split('\n').some(line => line.trim().endsWith('/Contents/MacOS/RT-ResearchFlow')), 'BLOCKED_ENVIRONMENT', 'PREEXISTING_PRODUCT_PROCESS')
    need(!fs.existsSync('/Applications/RT-ResearchFlow.app') && !fs.existsSync(path.join(process.env.HOME, 'Applications/RT-ResearchFlow.app')), 'BLOCKED_ENVIRONMENT', 'PREEXISTING_PRODUCT_INSTALL')
    const parts = []
    for await (const part of process.stdin) { parts.push(part); need(parts.reduce((n, p) => n + p.length, 0) <= 512, 'BLOCKED_INPUT', 'PASSWORD_INPUT_TOO_LARGE') }
    const password = Buffer.concat(parts).toString('utf8').trim()
    need(/^NA_KEYCHAIN_PASSWORD:[a-f0-9]{64}$/.test(password), 'BLOCKED_INPUT', 'KEYCHAIN_PASSWORD_INVALID')
    state = { default: quotedPaths(await run('/usr/bin/security', ['default-keychain', '-d', 'user']))[0],
      search: quotedPaths(await run('/usr/bin/security', ['list-keychains', '-d', 'user'])), uid: process.getuid(), keychainCreated: false }
    save()
    // Creation itself changes the search list on some macOS versions. Save originals first.
    await run('/usr/bin/security', ['create-keychain', '-p', password, keychain]); state.keychainCreated = true; save()
    await run('/usr/bin/security', ['set-keychain-settings', '-lut', '21600', keychain])
    await run('/usr/bin/security', ['unlock-keychain', '-p', password, keychain])
    await run('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', keychain])
    await run('/usr/bin/security', ['default-keychain', '-d', 'user', '-s', keychain])
    need(quotedPaths(await run('/usr/bin/security', ['default-keychain', '-d', 'user']))[0] === keychain,
      'BLOCKED_ENVIRONMENT', 'TEMP_KEYCHAIN_NOT_DEFAULT')
    const policy = '(version 1)\n(allow default)\n(deny network-outbound)\n(allow network-outbound (remote ip "127.0.0.1:*"))\n(allow network-outbound (remote ip "[::1]:*"))\n(allow network-outbound (remote unix-socket))\n'
    fs.writeFileSync(path.join(root, 'network.sb'), policy, { flag: 'wx', mode: 0o600 })
    const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"
    fs.writeFileSync(path.join(root, 'launch-app.sh'), '#!/bin/bash\nexec /usr/bin/sandbox-exec -f '
      + shellQuote(path.join(root, 'network.sb')) + ' -- ' + shellQuote(executable) + ' "$@"\n', { flag: 'wx', mode: 0o700 })
    return { ok: true, uid: String(state.uid), policy: 'inherited-sandbox-loopback-only' }
  }
  if (action === 'install') {
    need(['1.0.0', '1.1.0'].includes(version), 'BLOCKED_INPUT', 'INSTALL_VERSION_INVALID')
    const receipt = JSON.parse(fs.readFileSync(path.join(root, 'download-receipt.json'), 'utf8'))
    const pin = receipt.installers.find(item => item.version === version)
    need(pin && path.resolve(process.env.RUNNER_TEMP, pin.path) === installer
      && fs.statSync(installer).size === pin.size && await hashFile(installer) === pin.sha256, 'BLOCKED_INPUT', 'INSTALLER_BYTES_CHANGED')
    need((await processes()).length === 0, 'FAIL_LIFECYCLE', 'PRODUCT_NOT_EXITED')
    need(state.uid === process.getuid() && state.keychainCreated, 'BLOCKED_ENVIRONMENT', 'MAC_OWNER_CHANGED')
    if (version === '1.0.0') need(!fs.existsSync(bundle), 'FAIL_INSTALL', 'OLD_INSTALL_NOT_CLEAN')
    else need(fs.existsSync(bundle), 'FAIL_INSTALL', 'UPGRADE_BUNDLE_MISSING')
    fs.mkdirSync(path.dirname(bundle), { recursive: true })
    if (!fs.existsSync(mount)) fs.mkdirSync(mount)
    const started = Date.now()
    state.mountPending = true; save()
    await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, installer], { timeout: 60000, kind: 'FAIL_INSTALL', code: 'DMG_ATTACH_FAILED' })
    try {
      const source = path.join(mount, 'RT-ResearchFlow.app')
      need(fs.lstatSync(source).isDirectory() && !fs.lstatSync(source).isSymbolicLink(), 'FAIL_INSTALL', 'DMG_BUNDLE_INVALID')
      if (version === '1.1.0') {
        const retired = path.join(root, 'retired-1.0.0.app')
        need(!fs.existsSync(retired), 'FAIL_INSTALL', 'RETIRED_BUNDLE_EXISTS')
        // Both paths are fixed children of the owned root; do not merge old and new bundles.
        fs.renameSync(bundle, retired)
      }
      await run('/usr/bin/ditto', [source, bundle], { timeout: 60000, kind: 'FAIL_INSTALL', code: 'DMG_COPY_FAILED' })
    } finally {
      await run('/usr/bin/hdiutil', ['detach', mount], { timeout: 30000, kind: 'FAIL_INSTALL', code: 'DMG_DETACH_FAILED' })
      state.mountPending = false; save()
    }
    const plist = path.join(bundle, 'Contents/Info.plist')
    const identifier = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist])
    const actualVersion = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist])
    need(identifier === 'com.tradewatcher.app' && actualVersion === version, 'FAIL_INSTALL', 'BUNDLE_IDENTITY_MISMATCH')
    const architecture = await run('/usr/bin/lipo', ['-archs', executable])
    need(architecture === (owner.arch === 'x64' ? 'x86_64' : 'arm64'), 'FAIL_INSTALL', 'BUNDLE_ARCH_MISMATCH')
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { kind: 'FAIL_INSTALL', code: 'BUNDLE_SIGNATURE_INVALID' })
    return { ok: true, exitCode: 0, uid: String(process.getuid()), appId: identifier, events: [], durationMs: Date.now() - started }
  }
  if (action === 'processes') return { ok: true, processes: await processes() }
  if (action === 'cleanup') {
    let failed = false
    for (const item of await processes()) {
      if (!item.exe.startsWith(root + '/')) { failed = true; continue }
      // Re-read PID/executable before signalling. No killall, no user-wide process kill.
      const current = (await processes()).find(other => other.pid === item.pid && other.exe === item.exe)
      if (current) { try { process.kill(item.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') failed = true } }
    }
    if (state.mountPending) {
      try { await run('/usr/bin/hdiutil', ['detach', mount], { timeout: 20000 }); state.mountPending = false } catch { failed = true }
    }
    if (state.default && state.search) {
      try { await run('/usr/bin/security', ['default-keychain', '-d', 'user', '-s', state.default]) } catch { failed = true }
      try { await run('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...state.search]) } catch { failed = true }
      if (state.keychainCreated && fs.existsSync(keychain)) {
        try { await run('/usr/bin/security', ['delete-keychain', keychain]); state.keychainCreated = false } catch { failed = true }
      }
    }
    save()
    need(!failed && (await processes()).length === 0, 'BLOCKED_ENVIRONMENT', 'MAC_CLEANUP_INCOMPLETE')
    return { ok: true, cleanupSucceeded: true }
  }
  throw new AcceptanceError('BLOCKED_INPUT', 'UNKNOWN_MAC_ACTION')
}
main().then(value => process.stdout.write(JSON.stringify(value))).catch(error => {
  process.stdout.write(JSON.stringify({ ok: false, diagnostic: safeDiagnostic(error, 'unknown', 'MAC_PLATFORM_FAILURE'), kind: error.kind || 'BLOCKED_ENVIRONMENT', code: error.code && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'MAC_CONTROL_FAILED' }))
  process.exitCode = 1
})
