import { describe, expect, it } from 'vitest'
import {
  collectWindowsInstallRepairRegistry, windowsRepairCollectorInvocation, WINDOWS_REPAIR_REGISTRY_COLLECTOR_SCRIPT,
} from '../../electron/main/services/windowsInstallRepairCollector'
import { windowsInstallRepairTypedValuesDigest } from '../../electron/main/services/windowsInstallRepairPreflight'

const keys = { installKey: 'Software\\fixture-guid', uninstallKey: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\fixture-key' }
const target = 'D:\\Program Files\\RT-ResearchFlow'
function data() {
  return { schemaVersion: 1, rows: ['per-user', 'all-users'].flatMap(scope => ['32', '64'].map(view => ({
    scope, view, install: { state: 'absent', values: null as any }, uninstall: { state: 'absent', values: null as any },
  }))) }
}
function read(value: unknown) {
  return collectWindowsInstallRepairRegistry(keys, async spec => {
    expect(spec.shell).toBe(false); expect(spec.args).toContain('-NoProfile')
    expect(spec.env).toEqual({ SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows' })
    expect(JSON.parse(Buffer.from(spec.input).toString('utf8'))).toEqual(keys)
    return Buffer.from(JSON.stringify(value))
  }, 'C:\\Windows')
}
describe('actual registry collector boundary with synthetic observations only', () => {
  it('collects all four empty slots and binds actual typed values', async () => {
    const rows = await read(data()); expect(rows).toHaveLength(4)
    expect(new Set(rows.map(row => row.scope + row.view)).size).toBe(4)
    expect(rows[0].installValuesSha256).toBe(windowsInstallRepairTypedValuesDigest(null))
  })
  it('preserves Chinese data and raw expandable strings without environment expansion', async () => {
    const f = data(); f.rows[3].install = { state: 'present', values: [{ name: 'InstallLocation', type: 'REG_SZ', data: target }, { name: 'Raw', type: 'REG_EXPAND_SZ', data: '%SECRET% 中文' }] }
    f.rows[3].uninstall = { state: 'present', values: [{ name: 'DisplayName', type: 'REG_SZ', data: 'fixture 中文' }] }
    const rows = await read(f); expect(rows[3].installLocation).toBe(target)
    expect(rows[3].installValues![1].data).toBe('%SECRET% 中文')
  })
  it.each(['duplicate', 'missing', 'partial', 'unsupported', 'bool-dword', 'colliding-values', 'wrong-schema', 'missing-location'])('rejects %s observations', async name => {
    const f = data()
    if (name === 'duplicate') f.rows[3] = f.rows[0]
    if (name === 'missing') f.rows.pop()
    if (name === 'partial') f.rows[3].install = { state: 'present', values: [] }
    if (name === 'unsupported') f.rows[0].install = { state: 'unreadable', values: null }
    if (name === 'wrong-schema') f.schemaVersion = 2
    if (['bool-dword', 'colliding-values', 'missing-location'].includes(name)) {
      f.rows[3].install = { state: 'present', values: [{ name: 'InstallLocation', type: 'REG_SZ', data: target }] }
      f.rows[3].uninstall = { state: 'present', values: [] }
      if (name === 'bool-dword') f.rows[3].install.values.push({ name: 'NoModify', type: 'REG_DWORD', data: true })
      if (name === 'colliding-values') f.rows[3].install.values.push({ name: 'INSTALLLOCATION', type: 'REG_SZ', data: target })
      if (name === 'missing-location') f.rows[3].install.values = []
    }
    await expect(read(f)).rejects.toThrow()
  })
  it('rejects oversized or invalid UTF-8 output before interpreting evidence', async () => {
    for (const raw of [Buffer.alloc(262145), Buffer.from([0xff])]) {
      await expect(collectWindowsInstallRepairRegistry(keys, async () => raw, 'C:\\Windows')).rejects.toThrow()
    }
  })
  it.each(['', 'C:\\Windows\\..', '\\\\foreign\\Windows', 'C:\\Windows '])('rejects unsafe system executable root %s', root => {
    expect(() => windowsRepairCollectorInvocation(keys, root)).toThrow()
  })
  it('uses a fixed absolute executable and bounded non-secret invocation', () => {
    const spec = windowsRepairCollectorInvocation(keys, 'C:\\Windows')
    expect(spec.executable).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(spec.timeoutMs).toBe(5000); expect(spec.stdoutCap).toBe(262144); expect(spec.stderrCap).toBe(8192)
    expect(Buffer.from(spec.args.at(-1)!, 'base64').toString('utf16le')).toBe(WINDOWS_REPAIR_REGISTRY_COLLECTOR_SCRIPT)
    expect(WINDOWS_REPAIR_REGISTRY_COLLECTOR_SCRIPT).toContain('DoNotExpandEnvironmentNames')
    expect(WINDOWS_REPAIR_REGISTRY_COLLECTOR_SCRIPT).not.toMatch(/SetValue|DeleteSubKey|Start-Process|Invoke-Expression/)
  })
})
