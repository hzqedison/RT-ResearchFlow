import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve('resources/installer.nsh'), 'utf8')
const patch = readFileSync(resolve('patches/app-builder-lib@24.13.3.patch'), 'utf8')
const D = 'D:\\Program Files\\RT-ResearchFlow'
const K = 'K:\\Program Files\\RT-ResearchFlow'
const C = 'C:\\Users\\fixture\\AppData\\Local\\Programs\\RT-ResearchFlow'
function body(kind: 'macro' | 'function', name: string) {
  const start = new RegExp(`^${kind === 'macro' ? '!macro' : 'Function'} ${name}(?: .*)?$`, 'm').exec(source)!
  if (!start) throw new Error('missing native contract')
  const from = source.indexOf('\n', start.index) + 1
  return source.slice(from, source.indexOf(kind === 'macro' ? '!macroend' : 'FunctionEnd', from))
}
interface Fixture {
  types?: Record<string, number>
  attributes?: Record<string, number>
  registry?: Record<string, number>
  explicit?: string
  fail?: 'directory' | 'directory-handle' | 'file-handle' | 'write' | 'close' | 'cleanup'
  collision?: boolean
}
// Executes production NSIS instructions. Only WINAPI observations are injected;
// no real registry, filesystem, process, elevation or installation is performed.
function run(f: Fixture = {}, original = C, errors = false) {
  const vars: Record<string, string> = { $INSTDIR: original }
  for (let n = 0; n < 10; n++) vars['$R' + n] = 'saved-' + n
  const originalVars = { ...vars }
  const stack: string[] = [], effects: string[] = [], observations: string[] = []
  const owned = new Set<string>(), open = new Map<string, string>()
  let aborted = false, errorLevel = 0, nextHandle = 20, lastError = 2
  function expand(text: string): string {
    return text.replace(/\$\{INSTALL_REGISTRY_KEY\}/g, 'Software\\fixture-guid')
      .replace(/\$\{UNINSTALL_REGISTRY_KEY\}/g, 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\fixture-key')
      .replace(/\$(?:INSTDIR|R\d)/g, name => vars[name] ?? '')
  }
  const tokens = (line: string) => (line.match(/'[^']*'|"[^"]*"|\S+/g) ?? [])
    .map(value => /^['"]/.test(value) ? value.slice(1, -1) : value)
  function native(call: string) {
    const text = expand(call)
    observations.push(text)
    const quoted = [...text.matchAll(/w "([^"]*)"/g)].map(value => value[1])
    if (text.startsWith('advapi32::RegOpenKeyExW')) {
      const hive = /p (0x[\da-f]+)/i.exec(text)![1], access = /i (0x[\da-f]+)/i.exec(text)![1]
      const status = f.registry?.[hive + '/' + access + '/' + quoted[0]] ?? 2
      stack.push('10', String(status)); return
    }
    if (text.startsWith('advapi32::RegCloseKey')) { stack.push('0'); return }
    if (text.startsWith('kernel32::GetDriveTypeW')) { stack.push(String(f.types?.[quoted[0]] ?? 3)); return }
    if (text.startsWith('kernel32::GetFileAttributesW')) {
      const name = quoted[0]
      const attrs = f.attributes?.[name] ?? (owned.has(name) ? 16 : /^[DK]:\\$/.test(name) ? 16 : -1)
      stack.push(String(attrs)); lastError = 2; return
    }
    if (text.startsWith('kernel32::GetLastError')) { stack.push(String(lastError)); return }
    if (text.startsWith('ole32::CoCreateGuid')) { stack.push('{fixture-guid}', '0'); return }
    if (text.startsWith('kernel32::CreateDirectoryW')) {
      if (f.collision || f.fail === 'directory') { stack.push('0'); return }
      if (owned.has(quoted[0])) throw new Error('probe reused')
      owned.add(quoted[0]); effects.push('create-owned-directory:' + quoted[0]); stack.push('1'); return
    }
    if (text.startsWith('kernel32::CreateFileW')) {
      const directory = text.includes('0x06200080'), name = quoted[0]
      expect(text).toContain(directory ? 'i 3, i 0x06200080' : 'i 1, i 0x04000080')
      if (f.fail === (directory ? 'directory-handle' : 'file-handle')) { stack.push('-1'); return }
      const handle = String(++nextHandle); open.set(handle, name)
      effects.push((directory ? 'open-owned-directory:' : 'create-owned-file:') + name)
      stack.push(handle); return
    }
    if (text.startsWith('kernel32::WriteFile')) {
      effects.push('write-owned-file'); stack.push(f.fail === 'write' ? '0' : '1', f.fail === 'write' ? '0' : '1'); return
    }
    if (text.startsWith('kernel32::CloseHandle')) {
      const handle = /p (\d+)/.exec(text)![1], name = open.get(handle)
      if (!name) throw new Error('foreign handle cleanup')
      open.delete(handle)
      effects.push('close-owned:' + name)
      if (owned.has(name) && f.fail !== 'cleanup') owned.delete(name)
      stack.push(f.fail === 'close' ? '0' : '1'); return
    }
    throw new Error('unsupported native observation: ' + text)
  }
  function execute(raw: string) {
    raw = raw.replace(/^\s*!insertmacro rtDefaultCheckRegistration (\S+) (\S+) "([^"]*)"\s*$/gm,
      (_, hive, access, key) => body('macro', 'rtDefaultCheckRegistration')
        .replaceAll('${HIVE}', hive).replaceAll('${ACCESS}', access).replaceAll('${KEY}', key))
    const lines = raw.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#') && !/^!ifn?def|^!endif/.test(line))
    function jump(pc: number, label: string) {
      if (!label || label === '0') return pc
      if (/^[+-]\d+$/.test(label)) return pc + Number(label) - 1
      const target = lines.indexOf(label + ':')
      if (target < 0) throw new Error('unknown native label: ' + label)
      return target
    }
    function condition(parts: string[]) {
      const [a, operator, b] = parts.map(expand)
      if (!['==', '!='].includes(operator)) throw new Error('unknown conditional')
      return operator === '==' ? a === b : a !== b
    }
    const conditions: Array<{ taken: boolean }> = []
    function branchEnd(from: number, allowElse: boolean) {
      let depth = 0
      for (let i = from + 1; i < lines.length; i++) {
        if (lines[i].startsWith('${If}')) depth++
        if (lines[i].startsWith('${ElseIf}') && depth === 0 && allowElse) return i
        if (lines[i] === '${EndIf}' && depth-- === 0) return i
      }
      throw new Error('unterminated conditional')
    }
    for (let pc = 0, steps = 0; pc < lines.length && !aborted; pc++) {
      if (++steps > 2000) throw new Error('native instruction limit')
      const [op, ...args] = tokens(lines[pc])
      if (op.endsWith(':')) continue
      switch (op.toLowerCase()) {
        case 'push': stack.push(expand(args[0])); break
        case 'pop': if (!stack.length) throw new Error('stack underflow'); vars[args[0]] = stack.pop()!; break
        case 'exch': { const v = stack.pop(); if (v === undefined) throw new Error('stack underflow'); stack.push(vars[args[0]]); vars[args[0]] = v; break }
        case 'strcpy': vars[args[0]] = args[2] ? expand(args[1]).slice(0, Number(args[2])) : expand(args[1]); break
        case 'strcmp': pc = jump(pc, expand(args[0]).toLowerCase() === expand(args[1]).toLowerCase() ? args[2] : args[3]); break
        case 'intop': if (args[2] !== '&') throw new Error('unsupported integer op'); vars[args[0]] = String(Number(expand(args[1])) & Number(args[3])); break
        case 'goto': pc = jump(pc, args[0]); break
        case 'iferrors': pc = jump(pc, errors ? args[0] : args[1]); break
        case 'clearerrors': errors = false; break
        case 'seterrors': errors = true; break
        case 'seterrorlevel': errorLevel = Number(args[0]); break
        case 'abort': aborted = true; break
        case 'detailprint': effects.push('retained-owned-evidence'); break
        case 'system::call': native(args[0]); break
        case 'getfullpathname': vars[args[0]] = expand(args[1]).replace(/\\[^\\]+\\\.\.$/, '') || 'invalid'; break
        case 'call': expect(['rtProbeFreshInstallDefault', 'rtSelectFreshInstallDirectory']).toContain(args[0]); execute(body('function', args[0])); break
        case '!insertmacro': expect(args[0]).toBe('GetDParameter'); vars[args[1]] = f.explicit ?? ''; break
        case '${if}': case '${elseif}': {
          if (op === '${If}') conditions.push({ taken: false })
          const frame = conditions[conditions.length - 1]
          if (!frame) throw new Error('conditional stack underflow')
          if (op === '${ElseIf}' && frame.taken) { pc = branchEnd(pc, false) - 1; break }
          let value = condition(args)
          while (lines[pc + 1]?.startsWith('${AndIf}')) value = condition(tokens(lines[++pc]).slice(1)) && value
          frame.taken = value
          if (!value) pc = branchEnd(pc, true) - 1
          break
        }
        case '${endif}': if (!conditions.pop()) throw new Error('conditional stack underflow'); break
        default: throw new Error('unsupported production opcode: ' + op)
      }
    }
  }
  execute(body('macro', 'customSelectFreshInstallDirectory'))
  expect(stack).toEqual([])
  for (let n = 0; n < 10; n++) expect(vars['$R' + n]).toBe(originalVars['$R' + n])
  return { target: vars.$INSTDIR, aborted, errorLevel, effects, observations, errors }
}

describe('production NSIS fresh-install defaults', () => {
  it('hooks BOTH scope selectors before their explicit /D override', () => {
    expect(patch.match(/^\+    !insertmacro customSelectFreshInstallDirectory$/gm)).toHaveLength(2)
    expect(body('macro', 'customSelectFreshInstallDirectory')).toContain('Call rtSelectFreshInstallDirectory')
    expect(body('macro', 'customSelectFreshInstallDirectory')).not.toContain('rt_default_restore:')
  })
  it('chooses full D product directory, never DProgram or a root', () => { expect(run().target).toBe(D) })
  it('chooses K only when D is unavailable', () => { expect(run({ types: { 'D:\\': 2 } }).target).toBe(K) })
  it('retains the upstream scope default when both local fixed disks are unavailable', () => {
    expect(run({ types: { 'D:\\': 2, 'K:\\': 4 } }).target).toBe(C)
  })
  it.each(['directory', 'directory-handle', 'file-handle', 'write', 'close', 'cleanup'] as const)('unusable write probe %s never selects the drive', fail => {
    expect(run({ fail }).target).toBe(C)
  })
  it('does not reuse or clean up a colliding probe name', () => {
    const r = run({ collision: true }); expect(r.target).toBe(C); expect(r.effects).toEqual([])
  })
  it.each([D, 'D:\\中文 空格\\RT-ResearchFlow'])('does not override explicit /D: %s', explicit => {
    const r = run({ explicit }); expect(r.target).toBe(C); expect(r.effects).toEqual([])
  })
  it.each(['0x80000001', '0x80000002'])('preserves an existing record in hive %s before any fresh probe', hive => {
    const r = run({ registry: { [hive + '/0x0101/Software\\fixture-guid']: 0 } }, D)
    expect(r.target).toBe(D); expect(r.effects).toEqual([])
  })
  it('does not classify an empty uninstall key or a bad old record as fresh', () => {
    const r = run({ registry: { '0x80000002/0x0201/Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\fixture-key': 0 } }, 'D:\\Program')
    expect(r.target).toBe('D:\\Program'); expect(r.effects).toEqual([])
    expect(source).toContain('!insertmacro preflightOldInstallDirectory HKEY_CURRENT_USER')
    expect(patch).toContain('+!insertmacro customPreflightOldInstallDirectories')
  })
  it('fails closed on unreadable records, without probe or scope change', () => {
    const r = run({ registry: { '0x80000001/0x0101/Software\\fixture-guid': 5 } })
    expect(r.aborted).toBe(true); expect(r.errorLevel).toBe(2); expect(r.effects).toEqual([])
  })
  it.each([D, 'D:\\Program Files'])('refuses foreign or reparse candidate %s', name => {
    const r = run({ attributes: { [name]: 0x410 } }); expect(r.aborted).toBe(true); expect(r.errorLevel).toBe(2)
  })
  it('preserves the caller error state', () => { expect(run({}, C, true).errors).toBe(true) })
})
