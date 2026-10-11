import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const root = resolve(__dirname, '../..')
const installedRoot = dirname(require.resolve('app-builder-lib/package.json'))
const installed = readFileSync(resolve(installedRoot, 'templates/nsis/installer.nsi'), 'utf8')
const source = readFileSync(resolve(root, 'resources/installer.nsh'), 'utf8')
const patch = readFileSync(resolve(root, 'patches/app-builder-lib@24.13.3.patch'), 'utf8')
function macro(name: string) {
  const start = new RegExp('^!macro ' + name + '$', 'm').exec(source)
  if (!start) throw Error('missing actual macro')
  return source.slice(source.indexOf('\n', start.index) + 1, source.indexOf('!macroend', start.index))
}
interface State { registers: Record<string, string>; stack: string[]; errors: boolean; exit: number; aborted: boolean }
function state(errors = false): State {
  return { registers: Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['$R' + i, 'keep-' + i]).concat([['$INSTDIR', 'D:\\OriginalLocation']])),
    stack: [], errors, exit: 0, aborted: false }
}
// Execute only opcodes from the actual macro, not a second option parser.
// This is not a Windows emulator, installer run or real process-effects proof.
function execute(parameters: string, input = state(), uninstaller = false) {
  const raw = macro('customExplicitRepairDispatch')
  // Resolve nested compile-time guards before interpreting runtime instructions.
  // Removing the first !endif incorrectly removes an inner guard, not the outer one.
  const defines = new Set(uninstaller ? ['BUILD_UNINSTALLER'] : [])
  const active = [true]
  const body = raw.split('\n').filter(line => {
    const directive = /^\s*!(ifdef|ifndef)\s+(\w+)\s*$/.exec(line)
    if (directive) {
      active.push(active[active.length - 1] && (defines.has(directive[2]) === (directive[1] === 'ifdef')))
      return false
    }
    if (/^\s*!endif\s*$/.test(line)) {
      if (active.length === 1) throw Error('unmatched compiler guard')
      active.pop(); return false
    }
    return active[active.length - 1]
  }).join('\n')
  if (active.length !== 1) throw Error('unclosed compiler guard')
  const lines = body.split('\n').map(line => line.replace(/\s+#.*$/, '').trim()).filter(line => line && !line.startsWith('#'))
  const tokens = (line: string) => (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(value =>
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1, -1) : value)
  const value = (text: string) => text.replace(/\$(?:R\d|INSTDIR)/g, key => input.registers[key] ?? '')
    .replaceAll('$\\t', '\t').replaceAll('${NSIS_MAX_STRLEN}', '1024')
  const pop = () => { const item = input.stack.pop(); if (item === undefined) throw Error('stack underflow'); return item }
  let steps = 0
  for (let pc = 0; pc < lines.length && !input.aborted; pc++) {
    if (++steps > 50000) throw Error('bounded dispatch exceeded')
    const [opcode, ...args] = tokens(lines[pc])
    const jump = (name?: string) => {
      if (!name || name === '0') return
      if (/^[+-]\d+$/.test(name)) { pc += Number(name) - 1; return }
      const position = lines.indexOf(name + ':')
      if (position < 0) throw Error('missing dispatch label')
      pc = position
    }
    if (opcode.endsWith(':')) continue
    switch (opcode.toLowerCase()) {
      case 'push': input.stack.push(value(args[0])); break
      case 'pop': input.registers[args[0]] = pop(); break
      case 'strcpy': {
        const text = value(args[1]), offset = args[3] === undefined ? 0 : Number(value(args[3]))
        input.registers[args[0]] = args[2] === undefined ? text.slice(offset) : text.slice(offset, offset + Number(value(args[2]))); break
      }
      case 'strlen': input.registers[args[0]] = String(value(args[1]).length); break
      case 'intop': {
        const a = Number(value(args[1])), b = Number(value(args[3]))
        if (!['+', '-', '^', '&'].includes(args[2])) throw Error('unknown arithmetic')
        input.registers[args[0]] = String(args[2] === '+' ? a + b : args[2] === '-' ? a - b : args[2] === '^' ? a ^ b : a & b); break
      }
      case 'intcmp': {
        const a = Number(value(args[0])), b = Number(value(args[1]))
        jump(a === b ? args[2] : a < b ? args[3] : args[4]); break
      }
      case 'strcmp': jump(value(args[0]).toLowerCase() === value(args[1]).toLowerCase() ? args[2] : args[3]); break
      case 'goto': jump(args[0]); break
      case 'iferrors': jump(input.errors ? args[0] : args[1]); break
      case '${getparameters}': input.registers[args[0]] = parameters; input.errors = false; break
      case '!insertmacro':
        if (args[0] !== 'restoreExplicitRepairRegisters') throw Error('unexpected macro')
        for (let i = 9; i >= 0; i--) input.registers['$R' + i] = pop()
        break
      case 'clearerrors': input.errors = false; break
      case 'seterrors': input.errors = true; break
      case 'seterrorlevel': input.exit = Number(value(args[0])); break
      case 'abort': input.aborted = true; break
      default: throw Error('unapproved dispatch instruction:' + opcode)
    }
  }
  return input
}
describe('missing-capability explicit repair dispatch', () => {
  it('hooks actual resolved installer before its first executable initialization instruction', () => {
    const start = installed.indexOf('Function .onInit\n')
    expect(start).toBeGreaterThan(0)
    const body = installed.slice(start, installed.indexOf('FunctionEnd', start))
    expect(body).toMatch(/^Function \.onInit\n\s*#.*\n\s*!ifmacrodef customExplicitRepairDispatch\n\s*!insertmacro customExplicitRepairDispatch\n\s*!endif\n\s*Call setInstallSectionSpaceRequired/)
    expect(body.indexOf('customExplicitRepairDispatch')).toBeLessThan(body.indexOf('SetOutPath'))
    expect(body.indexOf('customExplicitRepairDispatch')).toBeLessThan(body.indexOf('initMultiUser'))
  })
  it('adds only an early hook, not an old-uninstaller bypass or success branch', () => {
    const section = patch.split(/(?=^diff --git )/m).find(value => value.startsWith('diff --git a/templates/nsis/installer.nsi '))
    expect(section).toBeDefined()
    expect(section).toContain('@@ -44,6 +44,11 @@')
    expect(section).not.toContain('uninstallOldVersion')
    expect(section).not.toContain('registryAddInstallInfo')
    expect(patch).not.toContain('\r')
    expect(source).toContain('旧安装目录无效')
    expect(macro('customExplicitRepairDispatch')).not.toMatch(/\b(?:ReadReg|WriteReg|DeleteReg|Exec|RMDir|Rename|CopyFiles|CreateDirectory|SetOutPath|StrCpy \$INSTDIR)/)
  })
  it.each([
    '/RTRepair', '/rtrepair', '/RTREPAIR', '/S /allusers /RTRepair /D=D:\\Program Files\\RT-ResearchFlow',
    '/currentuser\t/RTRepair', '/RTRepair /RTRepair', '/RTRepair=1', '/RTRepairAnything',
    '"/RTRepair"', '/RT"Repair"', '"/RTRepair', '--RTRepair', '--repair', '/repair', '/RT-Repair',
    '/RTRepairReceipt=D:\\owned\\receipt.json',
    '/message="literal \\"quote" /RTRepair',
    '/message="literal \\\\" /RTRepair',
  ])('refuses explicit or malformed repair %s before normal upgrade', parameters => {
    const input = state(true), original = structuredClone(input.registers)
    const result = execute(parameters, input)
    expect(result).toMatchObject({ exit: 23, aborted: true, stack: [] })
    expect(result.registers).toEqual(original)
  })
  it.each([
    '', '/S /allusers', '/S /currentuser /D=D:\\Program Files\\RT-ResearchFlow',
    '/D=D:\\Program Files\\RTRepair /RTRepair path component',
    '/D="D:\\Some quoted /RTRepair folder"', '/log="D:\\logs /RTRepair text"',
    '"D:\\folder /RTRepair value"', '/message="literal /RTRepair"', '/not-RTRepair', '/value=--repair',
    '/message="literal \\"quote /RTRepair"',
  ])('preserves normal state without misreading path/value substrings %s', parameters => {
    for (const errors of [false, true]) {
      const input = state(errors), original = structuredClone(input)
      expect(execute(parameters, input)).toEqual(original)
    }
  })
  it('fails closed if the NSIS buffer could truncate a request', () => {
    expect(execute('x'.repeat(1023))).toMatchObject({ exit: 23, aborted: true, stack: [] })
  })
  it('leaves compiled uninstaller path unchanged', () => {
    const input = state(true), original = structuredClone(input)
    expect(execute('/RTRepair', input, true)).toEqual(original)
    expect(macro('customExplicitRepairDispatch')).toMatch(/^\s*!ifndef BUILD_UNINSTALLER/)
  })
})
