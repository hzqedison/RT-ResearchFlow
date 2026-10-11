import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { windowsRepairCollectorInvocation } from '../../electron/main/services/windowsInstallRepairCollector'
import { invokeWindowsRepairNativeFile, windowsRepairNativeHostEnvelope } from '../../electron/main/services/windowsInstallRepairNativeBackend'
import { runWindowsRepairNativeJob } from '../../electron/main/services/windowsInstallRepairNativeJob'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const host = readFileSync(resolve(__dirname, '../../resources/windows-install-repair-native-host.ps1'), 'utf8')
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
// Windows primitive test only. It never creates a grant, invokes an installer,
// accesses any registry key or treats these effects as nine-scenario evidence.
describe.runIf(process.platform === 'win32')('real Unicode Windows file handles in owned temp cache only', () => {
  it('writes through the verified object, backs up old bytes and refuses changed identities', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rt-native-files-')), source = join(root, 'payload 中文.bin'), target = join(root, 'target 中文 空格.bin')
    const old = Buffer.from('old-fixture-zero-0'), next = Buffer.from('new-fixture-中文-0')
    writeFileSync(source, next); writeFileSync(target, old)
    const setup = String.raw`$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$p=[Console]::In.ReadToEnd();$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=[IO.Directory]::GetAccessControl($p,[Security.AccessControl.AccessControlSections]::Access);$acl.SetAccessRuleProtection($true,$false);foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){[void]$acl.RemoveAccessRuleAll($rule)};$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule);[IO.Directory]::SetAccessControl($p,$acl);[Console]::Write($sid.Value)`
    const userSid = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(setup, 'utf16le').toString('base64')],
      { input: root, encoding: 'utf8', windowsHide: true, env: { SystemRoot: process.env.SystemRoot, TEMP: root, TMP: root } }).trim()
    const jobHost = join(root, 'owned-job-host.exe')
    execFileSync('C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe', ['/nologo', '/target:exe', '/out:' + jobHost,
      resolve(__dirname, '../../resources/windows-install-repair-job-host.cs')], { windowsHide: true, timeout: 15000 })
    const reviewedJob = { executable: jobHost, sha256: sha(readFileSync(jobHost)), privateCache: root }
    const base = windowsRepairCollectorInvocation({ installKey: 'Software\\unused-fixture', uninstallKey: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\unused-fixture' }, process.env.SystemRoot ?? 'C:\\Windows')
    const call = (body: object) => invokeWindowsRepairNativeFile(windowsRepairNativeHostEnvelope({ ...base,
      env: { ...base.env, TEMP: root, TMP: root } }, Buffer.from(host), sha(Buffer.from(host)), { schemaVersion: 1, ...body }), spec => runWindowsRepairNativeJob(spec, reviewedJob))
      .catch(() => { throw new Error('NATIVE_FILE_STEP_FAILED:' + (body as { operation: string }).operation) })
    try {
      const before = await call({ operation: 'inspect-file', target })
      expect(before.sha256).toBe(sha(old)); expect(before.identity).toMatch(/^win32:/)
      const backup = join(root, randomBytes(16).toString('hex') + '.old')
      const after = await call({ operation: 'write-file', target, source, backup, beforeId: before.identity,
        beforeSha256: before.sha256, nextSha256: sha(next), nextSize: next.length, userSid })
      expect(after.identity).toBe(before.identity); expect(readFileSync(target)).toEqual(next); expect(readFileSync(backup)).toEqual(old)
      await expect(call({ operation: 'write-file', target, source, backup: join(root, 'wrong.old'), beforeId: 'win32:00000000:00000000:00000000',
        beforeSha256: after.sha256, nextSha256: sha(next), nextSize: next.length, userSid })).rejects.toThrow()
      expect(readFileSync(target)).toEqual(next)
      const restored = await call({ operation: 'write-file', target, source: backup,
        backup: join(root, randomBytes(16).toString('hex') + '.old'), beforeId: after.identity,
        beforeSha256: after.sha256, nextSha256: sha(old), nextSize: old.length, userSid })
      expect(restored.identity).toBe(before.identity); expect(readFileSync(target)).toEqual(old)
      const createdTarget = join(root, 'created 中文 空格.bin')
      const created = await call({ operation: 'write-file', target: createdTarget, source,
        backup: join(root, randomBytes(16).toString('hex') + '.old'), beforeId: 'absent',
        beforeSha256: '', nextSha256: sha(next), nextSize: next.length, userSid })
      await expect(call({ operation: 'delete-owned-file', target: createdTarget,
        beforeId: 'win32:00000000:00000000:00000000', beforeSha256: created.sha256 })).rejects.toThrow()
      expect(readFileSync(createdTarget)).toEqual(next)
      expect(await call({ operation: 'delete-owned-file', target: createdTarget,
        beforeId: created.identity, beforeSha256: created.sha256 })).toEqual({ identity: 'absent', size: '0', sha256: '' })
    } finally {
      const resolved = resolve(root), allowed = resolve(tmpdir()) + '\\'
      if (!resolved.toLowerCase().startsWith(allowed.toLowerCase()) || !resolved.includes('rt-native-files-')) throw new Error('UNSAFE_FIXTURE_CLEANUP')
      rmSync(root, { recursive: true, force: true })
    }
  }, 30000)
})
