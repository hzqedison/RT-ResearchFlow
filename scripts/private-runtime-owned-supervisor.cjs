'use strict'

// No authority or fixture bypass: the producer verifies this source and the
// native host source before invoking this process-ownership primitive.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const HOST_SOURCE = path.resolve(__dirname, '../resources/private-runtime-owned-job-host.cs')
const ENV_KEYS = new Set(['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'HOME', 'USERPROFILE',
  'LANG', 'LC_ALL', 'PYTHONUTF8', 'PYTHONDONTWRITEBYTECODE', 'XDG_CACHE_HOME',
  'TMPDIR', 'TEMP', 'TMP', 'NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH'])
function fail(code) { const error = new Error(code); error.code = code; throw error }
function regularFile(filename, limit, existingFrameworkCompiler = false) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) fail('OWNED_SUPERVISOR_PATH')
  const resolved = path.resolve(filename)
  for (let part = resolved; ; part = path.dirname(part)) {
    if (fs.lstatSync(part).isSymbolicLink()) fail('OWNED_SUPERVISOR_REPARSE')
    if (path.dirname(part) === part) break
  }
  const stat = fs.lstatSync(resolved)
  const systemCompiler = process.platform === 'win32' && existingFrameworkCompiler &&
    resolved === path.resolve(process.env.SystemRoot || '', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  // Windows servicing keeps this existing system compiler hardlinked into
  // WinSxS. Runtime inputs and our compiled host retain the single-link rule.
  if (!stat.isFile() || (!systemCompiler && stat.nlink !== 1) || stat.size > limit) fail('OWNED_SUPERVISOR_FILE')
  return fs.readFileSync(resolved)
}
function validateSpec(spec, platform = process.platform) {
  if (!spec || spec.shell !== false || !path.isAbsolute(spec.executable || '') ||
      !path.isAbsolute(spec.cwd || '') || !Array.isArray(spec.args) ||
      spec.args.length < 6 || spec.args.slice(0, 5).join('\0') !== ['-X', 'utf8', '-I', '-S', '-B'].join('\0') ||
      spec.args.some(value => typeof value !== 'string' || /[\x00\r\n]/.test(value)) ||
      spec.args.reduce((sum, value) => sum + value.length, 0) > 16000 ||
      !Buffer.isBuffer(spec.input) || spec.input.length > 1024 * 1024 ||
      !Number.isInteger(spec.deadlineMs) || spec.deadlineMs < 100 || spec.deadlineMs > 300000 ||
      !Number.isInteger(spec.stdoutByteCap) || spec.stdoutByteCap < 1 || spec.stdoutByteCap > 1024 * 1024 ||
      !Number.isInteger(spec.stderrByteCap) || spec.stderrByteCap < 0 || spec.stderrByteCap > 8192 ||
      spec.ownershipMode !== (platform === 'win32' ? 'windows-job' : 'posix-owned-session') ||
      !spec.env || typeof spec.env !== 'object' || Array.isArray(spec.env)) fail('OWNED_SUPERVISOR_SPEC')
  if (spec.preSealPosixInherited !== undefined && (typeof spec.preSealPosixInherited !== 'boolean' ||
      (spec.preSealPosixInherited && platform === 'win32'))) fail('OWNED_SUPERVISOR_PRESEAL_MODE')
  for (const [key, value] of Object.entries(spec.env)) {
    if (!ENV_KEYS.has(key) || typeof value !== 'string' || /[\x00\r\n]/.test(value)) fail('OWNED_SUPERVISOR_ENV')
  }
  if (spec.env.PYTHONUTF8 !== '1' || spec.env.PYTHONDONTWRITEBYTECODE !== '1' ||
      ['NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH'].some(key => spec.env[key] !== '')) fail('OWNED_SUPERVISOR_ENV')
  return spec
}
function quoteWindowsArgument(value) {
  if (typeof value !== 'string' || /[\x00\r\n]/.test(value)) fail('OWNED_SUPERVISOR_ARGUMENT')
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'
}
function parseWindowsProof(bytes, nonce) {
  if (!/^[a-f0-9]{64}$/.test(nonce)) fail('OWNED_SUPERVISOR_NONCE')
  const match = /^RT_PRIVATE_JOB_EMPTY:([a-f0-9]{64}):([1-9][0-9]*):0$/.exec(bytes.toString('ascii'))
  if (!match || match[1] !== nonce || !Number.isSafeInteger(Number(match[2]))) fail('OWNED_SUPERVISOR_NATIVE_PROOF')
  return { nativeRootPid: Number(match[2]), activeProcesses: 0 }
}
function childCapture(executable, args, options, timeout, outCap, errCap, compilerSystemRoot) {
  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, { ...options, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = 0, err = 0, failed = false, exitObserved = false
    const stdout = [], stderr = []
    function stop() {
      if (failed) return
      failed = true
      if (compilerSystemRoot && proc.pid) {
        // The only non-Job child is the trusted framework compiler. Terminate
        // its OWN tree, never a process name or caller-provided PID.
        const killer = spawn(path.join(compilerSystemRoot, 'System32/taskkill.exe'),
          ['/PID', String(proc.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore', env: {} })
        const timer = setTimeout(() => { killer.kill(); proc.kill() }, 5000)
        killer.once('error', () => { clearTimeout(timer); proc.kill() })
        killer.once('close', () => { clearTimeout(timer); proc.kill() })
      } else {
        // A native host death closes its non-inherited KILL_ON_JOB_CLOSE handle.
        proc.kill()
      }
    }
    const timer = setTimeout(stop, timeout)
    proc.stdout.on('data', bytes => { out += bytes.length; if (out > outCap) stop(); else stdout.push(bytes) })
    proc.stderr.on('data', bytes => { err += bytes.length; if (err > errCap) stop(); else stderr.push(bytes) })
    proc.once('error', stop); proc.stdin.on('error', stop)
    proc.once('exit', () => { exitObserved = true })
    proc.once('close', (exitCode, signal) => {
      clearTimeout(timer)
      if (failed || !exitObserved) reject(new Error('OWNED_SUPERVISOR_CHILD_FAILED'))
      else resolve({ pid: proc.pid, exitCode, signal, exitObserved, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
    })
    proc.stdin.end(options.input || Buffer.alloc(0))
  })
}
const WINDOWS_LOADER = String.raw`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);
function QuoteArg([string]$v){'"'+[regex]::Replace([regex]::Replace($v,'(\\*)"','$1$1\"'),'(\\+)$','$1$1')+'"'}
try {
  $body=[Console]::In.ReadToEnd()|ConvertFrom-Json;
  $start=[Diagnostics.ProcessStartInfo]::new([string]$body.executable);
  $start.Arguments=(($body.args|ForEach-Object {QuoteArg ([string]$_)}) -join ' ');
  $start.WorkingDirectory=[string]$body.cwd;
  $start.UseShellExecute=$false;$start.CreateNoWindow=$true;
  $start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true;
  $start.EnvironmentVariables.Clear();
  foreach($p in $body.env.psobject.Properties){$start.EnvironmentVariables[$p.Name]=[string]$p.Value}
  $start.EnvironmentVariables['SystemRoot']=$env:SystemRoot;$start.EnvironmentVariables['WINDIR']=$env:WINDIR;
  $proc=[Diagnostics.Process]::new();$proc.StartInfo=$start;[void]$proc.Start();
  $out=$proc.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput());
  $err=$proc.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError());
  $inputBytes=[Convert]::FromBase64String([string]$body.inputBase64);
  $proc.StandardInput.BaseStream.Write($inputBytes,0,$inputBytes.Length);$proc.StandardInput.Close();
  $proc.WaitForExit();$code=$proc.ExitCode;[Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($out,$err));$proc.Dispose();exit $code
}catch{exit 124}`
async function runWindows(spec) {
  const pin = spec.nativeHostSource
  if (!pin || path.resolve(pin.path || '') !== HOST_SOURCE || !/^[a-f0-9]{64}$/.test(pin.sha256 || '') ||
      sha(regularFile(HOST_SOURCE, 65536)) !== pin.sha256) fail('OWNED_SUPERVISOR_HOST_SOURCE_PIN')
  const systemRoot = process.env.SystemRoot
  if (!/^[A-Z]:\\Windows$/i.test(systemRoot || '')) fail('OWNED_SUPERVISOR_SYSTEM_ROOT')
  const framework = path.join(systemRoot, 'Microsoft.NET/Framework64/v4.0.30319')
  const compiler = path.join(framework, 'csc.exe')
  const compilerSha256 = sha(regularFile(compiler, 16 * 1024 * 1024, true))
  const cwd = fs.realpathSync(spec.cwd)
  if (!/^[DK]:\\/i.test(cwd)) fail('OWNED_SUPERVISOR_CACHE_DRIVE')
  const helperRoot = fs.mkdtempSync(path.join(cwd, 'rt-outer-host-'))
  const executable = path.join(helperRoot, 'owned-job.exe'), cache = path.join(helperRoot, 'job-cache')
  fs.mkdirSync(cache)
  try {
    const compiled = await childCapture(compiler, ['/nologo', '/noconfig', '/nostdlib+', '/target:exe',
      '/out:' + executable, '/reference:' + path.join(framework, 'mscorlib.dll'),
      '/reference:' + path.join(framework, 'System.dll'), '/reference:' + path.join(framework, 'System.Core.dll'), HOST_SOURCE],
    { cwd: helperRoot, env: { SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: helperRoot, TMP: helperRoot } },
    60000, 8192, 8192, systemRoot)
    if (compiled.exitCode !== 0 || compiled.signal) fail('OWNED_SUPERVISOR_HOST_COMPILE')
    const hostSha256 = sha(regularFile(executable, 2 * 1024 * 1024)), nonce = crypto.randomBytes(32).toString('hex')
    const envelope = Buffer.from(JSON.stringify({ executable: spec.executable, args: spec.args, cwd,
      env: spec.env, inputBase64: spec.input.toString('base64') }), 'utf8')
    const execution = await childCapture(executable,
      [Buffer.from(WINDOWS_LOADER, 'utf16le').toString('base64'), cache, String(spec.deadlineMs), nonce],
      { cwd: helperRoot, env: { SystemRoot: systemRoot, WINDIR: systemRoot }, input: envelope },
      spec.deadlineMs + 10000, spec.stdoutByteCap, 8192)
    if (execution.exitCode !== 0 || execution.signal) {
      const stage = /^RT_PRIVATE_RUNTIME_JOB_HOST_FAILED:([a-z-]+)$/.exec(execution.stderr.toString('ascii'));
      fail('OWNED_SUPERVISOR_NATIVE_FAILED' + (stage ? ':' + stage[1] : ''))
    }
    const observed = parseWindowsProof(execution.stderr, nonce)
    return { ...execution, stderr: Buffer.alloc(0), ownershipMode: 'windows-job', ownedTreeEmpty: observed.activeProcesses === 0,
      nativeRootPid: observed.nativeRootPid,
      compilation: { hostSourceSha256: pin.sha256, compilerSha256, hostSha256 } }
  } finally {
    // This exact newly-created owned helper directory contains no user data.
    const target = path.resolve(helperRoot)
    if (!target.startsWith(cwd + path.sep) || !path.basename(target).startsWith('rt-outer-host-')) fail('OWNED_SUPERVISOR_CLEANUP')
    fs.rmSync(target, { recursive: true, force: true })
  }
}
function groupExists(pid) {
  try { process.kill(-pid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
async function cleanGroup(pid) {
  if (!groupExists(pid)) return true
  process.kill(-pid, 'SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 100))
  if (groupExists(pid)) process.kill(-pid, 'SIGKILL')
  const end = Date.now() + 5000
  while (Date.now() < end && groupExists(pid)) await new Promise(resolve => setTimeout(resolve, 20))
  return !groupExists(pid)
}
function posixLaunchArgs(spec) {
  if (spec.preSealPosixInherited !== true) return [...spec.args]
  if (path.basename(spec.args[5]) !== 'report-private-runtime-native-bootstrap.py' ||
      !spec.args.includes('--pre-seal-bootstrap-contract') || spec.args.includes('--pre-seal-owned-posix-root')) fail('OWNED_SUPERVISOR_PRESEAL_REPORTER')
  // Child PID is unknown while constructing argv. This source-bound standard
  // library gate derives its ACTUAL new session identity, then execs the pinned
  // reporter without changing PID or the final interpreter isolation flags.
  const gate = 'import os,sys; p=os.getpid(); assert p>1 and os.getpgrp()==p and os.getsid(0)==p; os.execv(sys.executable,[sys.executable]+sys.argv[1:]+["--pre-seal-owned-posix-root",str(p)])'
  return ['-X', 'utf8', '-I', '-S', '-B', '-c', gate, ...spec.args]
}
function runPosix(spec) {
  return new Promise((resolve, reject) => {
    const proc = spawn(spec.executable, posixLaunchArgs(spec), { cwd: spec.cwd, env: spec.env,
      shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = 0, err = 0, failed = false, exitObserved = false
    const stdout = [], stderr = []
    const stop = () => {
      failed = true
      if (proc.pid) { try { process.kill(-proc.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') proc.kill() } }
    }
    const timer = setTimeout(stop, spec.deadlineMs)
    proc.stdout.on('data', bytes => { out += bytes.length; if (out > spec.stdoutByteCap) stop(); else stdout.push(bytes) })
    proc.stderr.on('data', bytes => { err += bytes.length; if (err > spec.stderrByteCap) stop(); else stderr.push(bytes) })
    proc.stdin.on('error', stop); proc.once('error', stop)
    proc.once('exit', () => { exitObserved = true })
    proc.once('close', async (exitCode, signal) => {
      clearTimeout(timer)
      try {
        if (!proc.pid) fail('OWNED_SUPERVISOR_NO_PROCESS')
        const leftover = groupExists(proc.pid), empty = await cleanGroup(proc.pid)
        if (failed || leftover || !empty || !exitObserved) fail('OWNED_SUPERVISOR_GROUP_FAILED')
        resolve({ pid: proc.pid, exitCode, signal, exitObserved, ownedTreeEmpty: true,
          ownershipMode: 'posix-owned-session', stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
      } catch { reject(new Error('OWNED_SUPERVISOR_GROUP_FAILED')) }
    })
    proc.stdin.end(spec.input)
  })
}
async function runOwnedPrivatePython(spec) {
  validateSpec(spec)
  spec = { ...spec, args: [...spec.args], env: { ...spec.env }, input: Buffer.from(spec.input),
    ...(spec.nativeHostSource ? { nativeHostSource: { ...spec.nativeHostSource } } : {}) }
  regularFile(spec.executable, 128 * 1024 * 1024)
  if (!fs.lstatSync(spec.cwd).isDirectory() || fs.lstatSync(spec.cwd).isSymbolicLink()) fail('OWNED_SUPERVISOR_CWD')
  return process.platform === 'win32' ? runWindows(spec) : runPosix(spec)
}
module.exports = { runOwnedPrivatePython, validateSpec, quoteWindowsArgument, parseWindowsProof, posixLaunchArgs, WINDOWS_LOADER }
