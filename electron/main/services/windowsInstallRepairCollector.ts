import { spawn } from 'node:child_process'
import { win32 } from 'node:path'
import {
  windowsInstallRepairRegistryDigest, windowsInstallRepairTypedValuesDigest,
} from './windowsInstallRepairPreflight'
import type {
  WindowsInstallRepairPolicy, WindowsRepairRegistrySlot, WindowsRepairTypedRegistryValue,
} from './windowsInstallRepairPreflight'

// Internal collector, not an IPC authorization endpoint. The consumer supplies
// keys from its independently verified producer policy, never from user JSON.
// No registry writes, uninstall command interpretation, profile or credential IO.
export const WINDOWS_REPAIR_REGISTRY_COLLECTOR_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function ReadExactKey($base, $path) {
  $key = $base.OpenSubKey($path, $false)
  if ($null -eq $key) { return @{state='absent';values=$null} }
  try {
    $items = @()
    foreach ($name in $key.GetValueNames()) {
      $kind = $key.GetValueKind($name)
      $value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      switch ($kind.ToString()) {
        'String'       { $type='REG_SZ'; $data=[string]$value }
        'ExpandString' { $type='REG_EXPAND_SZ'; $data=[string]$value }
        'DWord' { $type='REG_DWORD'; $data=[BitConverter]::ToUInt32([BitConverter]::GetBytes([int32]$value),0) }
        'QWord' { $type='REG_QWORD'; $data=[BitConverter]::ToUInt64([BitConverter]::GetBytes([int64]$value),0).ToString([Globalization.CultureInfo]::InvariantCulture) }
        'Binary' { $type='REG_BINARY'; $data=-join @($value | ForEach-Object { $_.ToString('x2') }) }
        'MultiString' { $type='REG_MULTI_SZ'; $data=@($value) }
        default { throw 'unsupported-registry-type' }
      }
      $items += @{name=[string]$name;type=$type;data=$data}
    }
    return @{state='present';values=@($items)}
  } finally { $key.Dispose() }
}
try {
  $inputObject = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $rows = @()
  foreach ($scope in @('per-user','all-users')) {
    $hive = if ($scope -eq 'per-user') {[Microsoft.Win32.RegistryHive]::CurrentUser} else {[Microsoft.Win32.RegistryHive]::LocalMachine}
    foreach ($view in @('32','64')) {
      $nativeView = if ($view -eq '32') {[Microsoft.Win32.RegistryView]::Registry32} else {[Microsoft.Win32.RegistryView]::Registry64}
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$nativeView)
      try { $rows += @{scope=$scope;view=$view;install=(ReadExactKey $base $inputObject.installKey);uninstall=(ReadExactKey $base $inputObject.uninstallKey)} }
      finally { $base.Dispose() }
    }
  }
  [Console]::Write((@{schemaVersion=1;rows=@($rows)} | ConvertTo-Json -Depth 12 -Compress))
} catch { [Console]::Error.Write('WINDOWS_INSTALL_REPAIR_COLLECTOR_FAILED'); exit 1 }
`

type Keys = Pick<WindowsInstallRepairPolicy, 'installKey' | 'uninstallKey'>
export interface WindowsRepairCollectorInvocation {
  executable: string
  args: string[]
  input: Uint8Array
  env: NodeJS.ProcessEnv
  shell: false
  timeoutMs: 5000
  stdoutCap: 262144
  stderrCap: 8192
}
function fail(): never { throw new Error('WINDOWS_INSTALL_REPAIR_COLLECTOR_FAILED') }

export function windowsRepairCollectorInvocation(keys: Keys, systemRoot: string): WindowsRepairCollectorInvocation {
  if (!keys || !/^Software\\[^\\\x00-\x1f]+$/i.test(keys.installKey) ||
      !/^Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^\\\x00-\x1f]+$/i.test(keys.uninstallKey) ||
      !/^[A-Za-z]:\\[^<>:"/|?*\x00-\x1f]+$/.test(systemRoot) || win32.normalize(systemRoot) !== systemRoot ||
      systemRoot.split('\\').some(part => /[ .]$/.test(part))) fail()
  return {
    executable: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_REPAIR_REGISTRY_COLLECTOR_SCRIPT, 'utf16le').toString('base64')],
    input: Buffer.from(JSON.stringify(keys), 'utf8'),
    env: { SystemRoot: systemRoot, WINDIR: systemRoot }, shell: false,
    timeoutMs: 5000, stdoutCap: 262144, stderrCap: 8192,
  }
}

export function runWindowsRepairRegistryCollector(spec: WindowsRepairCollectorInvocation): Promise<Uint8Array> {
  if (process.platform !== 'win32') return Promise.reject(new Error('WINDOWS_INSTALL_REPAIR_COLLECTOR_FAILED'))
  // This fixed script only invokes in-process .NET registry APIs and starts no
  // descendants. On timeout/cap failure, kill this owned child and await close.
  return new Promise((resolve, reject) => {
    const child = spawn(spec.executable, spec.args, { shell: false, windowsHide: true, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let stdout = 0, stderr = 0, failed = false
    const stop = () => { failed = true; child.kill() }
    const timer = setTimeout(stop, spec.timeoutMs)
    child.stdout.on('data', (bytes: Buffer) => { stdout += bytes.length; if (stdout > spec.stdoutCap) stop(); else chunks.push(bytes) })
    child.stderr.on('data', (bytes: Buffer) => { stderr += bytes.length; if (stderr > spec.stderrCap) stop() })
    child.on('error', () => { failed = true })
    child.stdin.on('error', stop)
    child.once('close', code => {
      clearTimeout(timer)
      if (failed || code !== 0) reject(new Error('WINDOWS_INSTALL_REPAIR_COLLECTOR_FAILED'))
      else resolve(Buffer.concat(chunks))
    })
    child.stdin.end(spec.input)
  })
}

function values(key: any): WindowsRepairTypedRegistryValue[] | null {
  if (!key || !['present', 'absent'].includes(key.state) ||
      (key.state === 'absent' ? key.values !== null : !Array.isArray(key.values))) fail()
  windowsInstallRepairTypedValuesDigest(key.values)
  return key.values
}

export async function collectWindowsInstallRepairRegistry(
  keys: Keys,
  run: (spec: WindowsRepairCollectorInvocation) => Promise<Uint8Array> = runWindowsRepairRegistryCollector,
  systemRoot = process.env.SystemRoot ?? '',
): Promise<WindowsRepairRegistrySlot[]> {
  const spec = windowsRepairCollectorInvocation(keys, systemRoot)
  const bytes = await run(spec)
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > spec.stdoutCap) fail()
  let result: any
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { fail() }
  if (result?.schemaVersion !== 1 || !Array.isArray(result.rows) || result.rows.length !== 4) fail()
  const seen = new Set<string>()
  return result.rows.map((row: any) => {
    if (!row || !['per-user', 'all-users'].includes(row.scope) || !['32', '64'].includes(row.view)) fail()
    const id = row.scope + '/' + row.view
    if (seen.has(id)) fail()
    seen.add(id)
    const installValues = values(row.install), uninstallValues = values(row.uninstall)
    if ((installValues === null) !== (uninstallValues === null)) fail()
    const location = installValues?.find(value => value.name.toLowerCase() === 'installlocation')
    if (installValues !== null && (!location || !['REG_SZ', 'REG_EXPAND_SZ'].includes(location.type) || typeof location.data !== 'string')) fail()
    const installValuesSha256 = windowsInstallRepairTypedValuesDigest(installValues)
    const uninstallValuesSha256 = windowsInstallRepairTypedValuesDigest(uninstallValues)
    return {
      scope: row.scope, view: row.view, ...keys,
      state: installValues === null ? 'absent' : 'present',
      installKeyState: row.install.state, uninstallKeyState: row.uninstall.state,
      installValues, uninstallValues,
      ...(location ? { installLocation: location.data as string } : {}),
      installValuesSha256, uninstallValuesSha256,
      rawValuesSha256: windowsInstallRepairRegistryDigest(installValuesSha256, uninstallValuesSha256),
    }
  })
}
