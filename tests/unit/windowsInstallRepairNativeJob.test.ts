import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { runWindowsRepairNativeJob } from '../../electron/main/services/windowsInstallRepairNativeJob'

// Only owned, non-elevated children and new test directories. No registry,
// installer, account, provider HTTP or production process is touched.
describe.runIf(process.platform === 'win32')('native repair owned Job Object', () => {
  let root: string
  let executable: string
  let sha256: string
  const owned: ChildProcess[] = []
  const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
  const encoded = (script: string) => Buffer.from(script, 'utf16le').toString('base64')
  const spec = (script: string): Parameters<typeof runWindowsRepairNativeJob>[0] => ({
    executable: ps, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(script)],
    input: Buffer.from('owned-test-input'), env: {}, shell: false,
    timeoutMs: 5000, stdoutCap: 262144, stderrCap: 8192,
  })
  const run = (script: string) => runWindowsRepairNativeJob(spec(script), { executable, sha256, privateCache: root })
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
  async function waitFor(test: () => boolean, ms = 5000) {
    const end = Date.now() + ms
    while (!test()) {
      if (Date.now() >= end) throw new Error('OWNED_TEST_OBSERVATION_TIMEOUT')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  beforeAll(() => {
    root = mkdtempSync('D:/RT-ResearchFlow-BuildCache/repair-job-中文 空格-').replaceAll('/', '\\')
    executable = join(root, 'repair-job-host.exe')
    const compile = spawnSync('C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe', [
      '/nologo', '/target:exe', '/out:' + executable.replaceAll('/', '\\'),
      resolve('resources/windows-install-repair-job-host.cs').replaceAll('/', '\\'),
    ], { shell: false, windowsHide: true, encoding: 'utf8', timeout: 15000 })
    expect(compile.status, compile.stdout + compile.stderr).toBe(0)
    const acl = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(`
$ErrorActionPreference='Stop'
$root=${quote(root)}
$acl=[IO.Directory]::GetAccessControl($root)
$acl.SetAccessRuleProtection($true,$false)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
foreach($identity in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
}
[IO.Directory]::SetAccessControl($root,$acl)
`)], { shell: false, windowsHide: true, timeout: 10000, encoding: 'utf8' })
    expect(acl.status, acl.stderr).toBe(0)
    sha256 = createHash('sha256').update(readFileSync(executable)).digest('hex')
  }, 30000)
  afterEach(async () => {
    for (const child of owned.splice(0)) {
      if (child.exitCode === null) {
        child.kill()
        await new Promise<void>(resolve => { child.once('close', () => resolve()); setTimeout(resolve, 3000) })
      }
    }
  })
  it('uses the compiled host, Unicode private cwd and bounded stdin', async () => {
    const result = await run(`[Console]::In.ReadToEnd() | Out-Null; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Write((@{cwd=[Environment]::CurrentDirectory;value='中文'} | ConvertTo-Json -Compress))`)
    const parsed = JSON.parse(Buffer.from(result).toString('utf8'))
    expect(resolve(parsed.cwd)).toBe(resolve(root))
    expect(parsed.value).toBe('中文')
  }, 20000)
  it('rejects an executable hash mismatch before executing it', async () => {
    expect(() => runWindowsRepairNativeJob(spec("[Console]::Write('should-not-run')"), {
      executable, sha256: '0'.repeat(64), privateCache: root,
    })).toThrow('WINDOWS_REPAIR_NATIVE_JOB_REJECTED')
  })
  it('closes descendants after the root exits, without killing an unrelated sentinel', async () => {
    const sentinel = spawn(ps, ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 90'], {
      shell: false, windowsHide: true, stdio: 'ignore',
    })
    owned.push(sentinel)
    await new Promise<void>((resolve, reject) => { sentinel.once('spawn', resolve); sentinel.once('error', reject) })
    expect(alive(sentinel.pid!)).toBe(true)
    const marker = join(root, 'root-exit-descendant.pid')
    const result = await run(`
[Console]::In.ReadToEnd() | Out-Null
$start=[Diagnostics.ProcessStartInfo]::new(${quote(ps)},'-NoProfile -NonInteractive -Command Start-Sleep -Seconds 90')
$start.UseShellExecute=$false; $start.CreateNoWindow=$true
$child=[Diagnostics.Process]::Start($start)
if($child.HasExited) { throw 'descendant-not-started' }
[IO.File]::WriteAllText(${quote(marker)},$child.Id.ToString())
[Console]::Write('root-completed')
`)
    expect(Buffer.from(result).toString('utf8')).toBe('root-completed')
    const pid = Number(readFileSync(marker, 'utf8'))
    expect(Number.isInteger(pid) && pid > 0).toBe(true)
    await waitFor(() => !alive(pid))
    expect(alive(sentinel.pid!)).toBe(true)
  }, 20000)
  it('confirms descendant startup before the deadline, then kills that owned tree only', async () => {
    const sentinel = spawn(ps, ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 90'], {
      shell: false, windowsHide: true, stdio: 'ignore',
    })
    owned.push(sentinel)
    await new Promise<void>((resolve, reject) => { sentinel.once('spawn', resolve); sentinel.once('error', reject) })
    const marker = join(root, 'deadline-descendant.pid')
    const outcome = run(`
[Console]::In.ReadToEnd() | Out-Null
$start=[Diagnostics.ProcessStartInfo]::new(${quote(ps)},'-NoProfile -NonInteractive -Command Start-Sleep -Seconds 90')
$start.UseShellExecute=$false; $start.CreateNoWindow=$true
$child=[Diagnostics.Process]::Start($start)
if($child.HasExited) { throw 'descendant-not-started' }
[IO.File]::WriteAllText(${quote(marker)},$child.Id.ToString())
Start-Sleep -Seconds 90
`).then(() => ({ ok: true }), () => ({ ok: false }))
    await waitFor(() => existsSync(marker), 4000)
    const pid = Number(readFileSync(marker, 'utf8'))
    expect(Number.isInteger(pid) && pid > 0).toBe(true)
    expect(alive(pid)).toBe(true)
    expect(alive(sentinel.pid!)).toBe(true)
    expect(await outcome).toEqual({ ok: false })
    await waitFor(() => !alive(pid))
    expect(alive(sentinel.pid!)).toBe(true)
  }, 25000)
  it('fails closed on nonzero exit and suppresses child error details', async () => {
    let failure: unknown
    try { await run("[Console]::In.ReadToEnd() | Out-Null; [Console]::Error.Write('SECRET_SENTINEL'); exit 7") }
    catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).not.toContain('SECRET_SENTINEL')
  }, 20000)
  it('rejects stdout above the delivery cap', async () => {
    await expect(run("[Console]::In.ReadToEnd() | Out-Null; [Console]::Write(('x'*300000))")).rejects.toThrow()
  }, 20000)
})
