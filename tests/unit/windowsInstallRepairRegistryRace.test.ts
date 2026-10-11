import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Execute the actual production ReplaceKey function against in-memory fake
// handles. These fault injections never open or write a Windows registry key.
const source = readFileSync(resolve(__dirname, '../../resources/windows-install-repair-native-host.ps1'), 'utf8')
const start = source.indexOf('function NormalizeImage'), end = source.indexOf('function InitializeNativeFiles')
if (start < 0 || end <= start) throw new Error('REGISTRY_RACE_TEST_SOURCE_BOUNDARY')
const functions = source.slice(start, end)
describe.runIf(process.platform === 'win32')('exact native registry function concurrency seams; no registry IO', () => {
  function run(fault: string) {
    const script = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
${functions}
$script:fault='${fault}'
$expected=@{state='present';values=@(@{name='obsolete';type='REG_SZ';data='old'},@{name='keep';type='REG_SZ';data='old'});children=@()}
$next=@{state='present';values=@(@{name='keep';type='REG_SZ';data='new'});children=@()}
$script:state=NormalizeImage $expected
$script:deleted=@();$script:set=@()
function ReadKey($base,$path) { NormalizeImage $script:state }
$key=[pscustomobject]@{}
$key | Add-Member ScriptMethod DeleteValue {
  param($name,$throwOnMissing)
  $script:deleted+=@($name)
  $script:state.values=@($script:state.values | Where-Object { $_.name -ine $name })
  if($script:fault -eq 'extra-after-delete') { $script:state.values+=@(@{name='foreign';type='REG_SZ';data='preserve'}) }
  if($script:fault -eq 'same-name-after-delete') { $script:state.values[0].data='foreign-same-name' }
}
$key | Add-Member ScriptMethod SetValue {
  param($name,$value,$kind)
  $script:set+=@($name)
  $script:state.values=@($script:state.values | Where-Object { $_.name -ine $name })+@(@{name=$name;type='REG_SZ';data=$value})
}
$key | Add-Member ScriptMethod Flush {}
$key | Add-Member ScriptMethod Dispose {}
$base=[pscustomobject]@{}
$base | Add-Member ScriptMethod CreateSubKey {
  param($path,$writable)
  if($script:fault -eq 'extra-before-write') { $script:state.values+=@(@{name='foreign';type='REG_SZ';data='preserve'}) }
  if($script:fault -eq 'same-name-before-write') { $script:state.values[1].data='foreign-same-name' }
  return $key
}
$ok=$false
try { ReplaceKey $base 'unused-fixture-key' $expected $next; $ok=$true } catch {}
[Console]::Write((@{ok=$ok;deleted=@($script:deleted);set=@($script:set);state=$script:state} | ConvertTo-Json -Depth 12 -Compress))
`
    const raw = execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
    ], { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
    return JSON.parse(raw)
  }
  it('writes the approved complete next image in the healthy seam', () => {
    const result = run('none')
    expect(result.ok).toBe(true); expect(result.deleted).toEqual(['obsolete']); expect(result.set).toEqual(['keep'])
    expect(result.state.values).toEqual([{ name: 'keep', type: 'REG_SZ', data: 'new' }])
  })
  it.each(['extra-before-write', 'same-name-before-write'])('refuses %s without any mutation', fault => {
    const result = run(fault)
    expect(result.ok).toBe(false); expect(result.deleted).toEqual([]); expect(result.set).toEqual([])
    expect(result.state.values.some((value: any) => value.data === 'preserve' || value.data === 'foreign-same-name')).toBe(true)
  })
  it.each(['extra-after-delete', 'same-name-after-delete'])('preserves %s and stops rather than overwrite the next observed change', fault => {
    const result = run(fault)
    expect(result.ok).toBe(false); expect(result.deleted).toEqual(['obsolete']); expect(result.set).toEqual([])
    expect(result.state.values.some((value: any) => value.data === 'preserve' || value.data === 'foreign-same-name')).toBe(true)
    expect(result.deleted).not.toContain('foreign')
  })
})
