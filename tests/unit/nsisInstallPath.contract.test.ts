import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const root = resolve(__dirname, '../..')
const patch = readFileSync(resolve(root, 'patches/app-builder-lib@24.13.3.patch'), 'utf8')
const installedTemplate = readFileSync(resolve(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis/multiUser.nsh'), 'utf8')
const installedUtil = readFileSync(resolve(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis/include/installUtil.nsh'), 'utf8')
const installedSection = readFileSync(resolve(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis/installSection.nsh'), 'utf8')
const installer = readFileSync(resolve(root, 'resources/installer.nsh'), 'utf8')

// Apply the actual dependency patch in memory, without editing node_modules.
// Registration may already have applied it: reverse and reapply in that case.
function applyPatch(source: string, reverse = false, file = 'templates/nsis/multiUser.nsh', patchText = patch) {
  let result = source.replace(/\r\n/g, '\n')
  let delta = 0
  const section = patchText.replace(/\r\n/g, '\n').split(/(?=^diff --git )/m).find(part => part.startsWith(`diff --git a/${file} b/${file}\n`))
  if (!section) throw new Error(`Missing patch section: ${file}`)
  const lines = section.trimEnd().split('\n')
  for (let index = 0; index < lines.length; index++) {
    const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(lines[index])
    if (!header) continue
    const before: string[] = []
    const after: string[] = []
    while (index + 1 < lines.length && !lines[index + 1].startsWith('@@ ')) {
      const line = lines[++index]
      if (line[0] === ' ' || line[0] === '-') before.push(line.slice(1))
      if (line[0] === ' ' || line[0] === '+') after.push(line.slice(1))
    }
    if (before.length !== Number(header[2]) || after.length !== Number(header[4])) throw new Error('Invalid patch hunk counts')
    const from = (reverse ? after : before).join('\n') + '\n'
    const to = (reverse ? before : after).join('\n') + '\n'
    const line = Number(reverse ? header[3] : header[1]) - 1 + delta
    const offset = result.split('\n').slice(0, line).reduce((length, part) => length + part.length + 1, 0)
    if (result.slice(offset, offset + from.length) !== from) throw new Error(`Patch context mismatch: ${header[0]}, reverse=${reverse}, expected=${JSON.stringify(from)}, actual=${JSON.stringify(result.slice(offset, offset + from.length))}`)
    result = result.slice(0, offset) + to + result.slice(offset + from.length)
    delta += reverse ? before.length - after.length : after.length - before.length
  }
  return result
}

// A shared local dependency tree may still carry the previous installer patch.
// Undo exactly that older patch in memory, then exercise the complete new patch.
const normalizedPatch = patch.replace(/\r\n/g, '\n')
const legacyPatch = normalizedPatch.slice(0, normalizedPatch.indexOf('@@ -30,11 +30,15 @@'))
  + normalizedPatch.slice(normalizedPatch.indexOf('@@ -41,7 +45,8 @@'))
    .replace('@@ -41,7 +45,8 @@', '@@ -41,7 +41,8 @@')
    .replace('@@ -84,10 +89,49 @@', '@@ -84,10 +85,49 @@')
const original = installedTemplate.includes('!macro GetDParameter outVar')
  ? applyPatch(installedTemplate, true, 'templates/nsis/multiUser.nsh',
    installedTemplate.includes('kernel32::lstrcpynW') ? patch : legacyPatch)
  : installedTemplate.replace(/\r\n/g, '\n')
const repaired = applyPatch(original)
const utilFile = 'templates/nsis/include/installUtil.nsh'
const sectionFile = 'templates/nsis/installSection.nsh'
const utilBase = installedUtil.includes('!insertmacro customValidateOldInstallDirectory')
  ? applyPatch(installedUtil, true, utilFile) : installedUtil.replace(/\r\n/g, '\n')
const sectionBase = installedSection.includes('!insertmacro customValidateInstallTarget')
  ? applyPatch(installedSection, true, sectionFile) : installedSection.replace(/\r\n/g, '\n')
const repairedUtil = applyPatch(utilBase, false, utilFile)
const repairedSection = applyPatch(sectionBase, false, sectionFile)

function macro(source: string, name: string) {
  const start = new RegExp(`^[ \\t]*!macro ${name}(?: .*)?$`, 'm').exec(source)
  if (!start) throw new Error(`Missing macro: ${name}`)
  const bodyStart = source.indexOf('\n', start.index) + 1
  const end = source.indexOf('!macroend', bodyStart)
  if (end < 0) throw new Error(`Unterminated macro: ${name}`)
  return source.slice(bodyStart, end)
}

interface Machine {
  vars: Record<string, string>
  stack: string[]
  errorLevel: number
  aborted: boolean
  effects: string[]
  reads: string[]
}

function machine(path = 'D:\\Program') : Machine {
  return {
    vars: { $INSTDIR: path, $R0: '', $R5: 'keep5', $R6: 'keep6', $R7: 'keep7', $R8: 'keep8', $R9: 'keep9' },
    stack: [], errorLevel: 0, aborted: false, effects: [], reads: [],
  }
}

function nsisFunction(source: string, name: string) {
  const start = new RegExp(`^[ \\t]*Function ${name}$`, 'm').exec(source)
  if (!start) throw new Error(`Missing function: ${name}`)
  const bodyStart = source.indexOf('\n', start.index) + 1
  const end = source.indexOf('FunctionEnd', bodyStart)
  if (end < 0) throw new Error(`Unterminated function: ${name}`)
  return source.slice(bodyStart, end)
}
const safetyFunctions = macro(installer, 'defineSafeInstallTargetCheck').replaceAll('${PREFIX}', '')
const guardBody = nsisFunction(safetyFunctions, 'AssertSafeInstallDirectory')
const existingGuardBody = nsisFunction(safetyFunctions, 'AssertSafeExistingInstallDirectory')

// Explicit injected WINAPI responses, NOT Node path resolution or a Win32 emulator.
// Unknown requests fail the contract; real Windows responses must be checked in CI.
const nativeFullPaths: Record<string, string> = {}
for (const [input, full, parent] of [
  ['D:\\Program', 'D:\\Program', 'D:\\'],
  ['D:\\Program Files\\RT-ResearchFlow', 'D:\\Program Files\\RT-ResearchFlow', 'D:\\Program Files'],
  ['D:\\Program Files\\RT-ResearchFlow\\', 'D:\\Program Files\\RT-ResearchFlow\\', 'D:\\Program Files'],
  ['D:\\投研 数据\\RT-ResearchFlow', 'D:\\投研 数据\\RT-ResearchFlow', 'D:\\投研 数据'],
  ['D:\\New Apps\\RT-ResearchFlow', 'D:\\New Apps\\RT-ResearchFlow', 'D:\\New Apps'],
  ['D:\\Apps\\..\\', 'D:\\', 'D:\\'],
  ['\\\\server\\share\\RT-ResearchFlow', '\\\\server\\share\\RT-ResearchFlow', '\\\\server\\share\\'],
  ['\\\\server\\share\\RT-ResearchFlow\\', '\\\\server\\share\\RT-ResearchFlow\\', '\\\\server\\share'],
  ['\\\\server\\share\\Apps\\..\\', '\\\\server\\share\\', '\\\\server\\share'],
]) {
  nativeFullPaths[input] = full
  nativeFullPaths[`${full}\\..`] = parent
}
interface RegistryFixture {
  scope?: string
  values?: Record<string, { UninstallString: string; InstallLocation: string }>
}

function preprocess(source: string) {
  const result: string[] = []
  const stack: Array<{ parent: boolean; condition: boolean }> = []
  let enabled = true
  for (const line of source.split('\n')) {
    const directive = /^\s*!(ifdef|ifndef|ifmacrodef|ifmacrondef)\s+/.exec(line)
    if (directive) {
      const condition = directive[1] === 'ifndef' || directive[1] === 'ifmacrondef'
      stack.push({ parent: enabled, condition }); enabled = enabled && condition
    } else if (/^\s*!else\s*$/.test(line)) {
      const frame = stack[stack.length - 1]
      enabled = frame.parent && !frame.condition
    } else if (/^\s*!endif\s*$/.test(line)) {
      enabled = stack.pop()!.parent
    } else if (enabled) result.push(line)
  }
  return result.join('\n')
}

// Execute the NSIS instructions from the patched file, not a second JS parser
// implementation. Win32 file attributes are injected: no production files,
// registry, installation, process launching or deletion is accessed here.
// Unsupported opcodes fail closed. Real NSIS/UAC execution remains a CI gate.
function execute(source: string, state: Machine, parameters = '', attributes: (path: string) => number = () => -1, registry: RegistryFixture = {}) {
  const lines = preprocess(source).split('\n').map(line => line.replace(/\s+#.*$/, '').trim())
    .filter(line => line && !line.startsWith('#'))
  const tokens = (line: string) => (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(token =>
    (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")) ? token.slice(1, -1) : token)
  const value = (token: string) => token.replaceAll('${NSIS_MAX_STRLEN}', '1024').replace(/\$(?:[A-Za-z_]\w*|\d)/g, variable => state.vars[variable] ?? '')
  const number = (token: string) => Number(value(token))
  const equal = (left: string, right: string) => value(left).toLowerCase() === value(right).toLowerCase()
  const condition = (parts: string[]) => {
    const [left, operator, right] = parts
    if (operator === '==') return equal(left, right)
    if (operator === '!=') return !equal(left, right)
    if (operator === '>') return number(left) > number(right)
    throw new Error(`Unsupported comparison: ${operator}`)
  }
  const endIf = (start: number, acceptElse = false) => {
    let depth = 0
    for (let index = start + 1; index < lines.length; index++) {
      const op = tokens(lines[index])[0].toLowerCase()
      if (op === '${if}') depth++
      if (op === '${else}' && depth === 0 && acceptElse) return index
      if (op === '${endif}' && depth-- === 0) return index
    }
    throw new Error('Unterminated conditional')
  }
  const loops: number[] = []
  let steps = 0
  for (let pc = 0; pc < lines.length && !state.aborted; pc++) {
    if (++steps > 20_000) throw new Error('NSIS contract instruction limit')
    const [op, ...args] = tokens(lines[pc])
    if (op.endsWith(':')) continue
    const jump = (label?: string) => {
      if (!label || label === '0') return
      if (/^[+-]\d+$/.test(label)) { pc += Number(label) - 1; return }
      const target = lines.indexOf(`${label}:`)
      if (target < 0) throw new Error(`Missing label: ${label}`)
      pc = target
    }
    switch (op.toLowerCase()) {
      case 'push': state.stack.push(value(args[0])); break
      case 'exch': {
        if (!args[0]?.startsWith('$')) throw new Error('Unsupported stack exchange')
        const top = state.stack.pop()
        if (top === undefined) throw new Error('Stack underflow')
        state.stack.push(state.vars[args[0]] ?? '')
        state.vars[args[0]] = top
        break
      }
      case 'pop': {
        const top = state.stack.pop()
        if (top === undefined) throw new Error('Stack underflow')
        state.vars[args[0]] = top
        break
      }
      case 'strcpy': {
        const text = value(args[1])
        const offset = args[3] === undefined ? 0 : number(args[3])
        const tail = text.slice(offset)
        state.vars[args[0]] = args[2] === undefined || args[2] === '' ? tail : tail.slice(0, number(args[2]))
        break
      }
      case 'strlen': state.vars[args[0]] = String(value(args[1]).length); break
      case 'intop': {
        const left = number(args[1]); const right = number(args[3])
        if (!['+', '-', '&'].includes(args[2])) throw new Error('Unsupported IntOp')
        state.vars[args[0]] = String(args[2] === '+' ? left + right : args[2] === '-' ? left - right : left & right)
        break
      }
      case '${stdutils.getallparameters}': state.vars[args[0]] = parameters; break
      case '${stdutils.getparameter}':
        state.vars[args[0]] = /(?:^|\s)\/D=([^\s]+)/i.exec(parameters)?.[1] ?? value(args[2]); break
      case '!insertmacro': {
        const name = args[0]
        if (name === 'readReg') {
          const hive = value(args[2]) === 'SHELL_CONTEXT' ? registry.scope ?? 'HKEY_LOCAL_MACHINE' : value(args[2])
          const field = value(args[4])
          if (field !== 'UninstallString' && field !== 'InstallLocation') throw new Error('Non-whitelisted registry fixture request')
          state.reads.push(`${hive}:${field}`)
          state.vars[args[1]] = registry.values?.[hive]?.[field] ?? ''
        } else if (name === 'GetDParameter') {
          execute(macro(repaired, name).replaceAll('${outVar}', args[1]), state, parameters, attributes, registry)
        } else if (name === 'GetInQuotes') {
          execute(macro(repairedUtil, name).replaceAll('${Var}', args[1]).replaceAll('${Str}', args[2]), state, parameters, attributes, registry)
        } else if (name === 'uninstallOldVersion') {
          execute(macro(repairedUtil, name).replaceAll('${ROOT_KEY}', args[1]), state, parameters, attributes, registry)
        } else if (['customValidateInstallTarget', 'customValidateOldInstallDirectory', 'customPreflightOldInstallDirectories', 'preflightOldInstallDirectory'].includes(name)) {
          execute(macro(installer, name).replaceAll('${OLD_PATH}', args[1] ?? '').replaceAll('${ROOT_KEY}', args[1] ?? ''), state, parameters, attributes, registry)
        } else if (name === 'setIsTryToKeepShortcuts') {
          // Stop at the first post-validation uninstall preparation instruction.
          // This is an observed permission boundary, not a simulated successful uninstall.
          state.effects.push(`uninstall-permitted:${state.vars.$rootKey}`); return state
        } else if (name === 'handleUninstallResult') {
          // The bounded contract ends at permission to uninstall; no result is simulated.
        } else if (name === 'copyFile') {
          state.effects.push('copy-old-uninstaller'); return state
        } else throw new Error(`Unsupported inserted macro: ${name}`)
        break
      }
      case '${do}': loops.push(pc); break
      case '${loopuntil}':
        if (condition(args)) loops.pop()
        else pc = loops[loops.length - 1]
        break
      case '${break}': {
        const end = lines.findIndex((line, index) => index > pc && line.startsWith('${LoopUntil}'))
        if (end < 0) throw new Error('Missing loop end')
        loops.pop(); pc = end; break
      }
      case '${if}': {
        let matches = condition(args)
        while (pc + 1 < lines.length && ['${orif}', '${andif}'].includes(tokens(lines[pc + 1])[0].toLowerCase())) {
          const [operator, ...test] = tokens(lines[++pc])
          matches = operator.toLowerCase() === '${orif}' ? condition(test) || matches : condition(test) && matches
        }
        if (!matches) pc = endIf(pc, true)
        break
      }
      case '${else}': pc = endIf(pc); break
      case '${endif}': break
      case 'strcmp': jump(equal(args[0], args[1]) ? args[2] : args[3]); break
      case 'intcmp': {
        const left = number(args[0]); const right = number(args[1])
        jump(left === right ? args[2] : left < right ? args[3] : args[4]); break
      }
      case 'goto': jump(args[0]); break
      case 'getfullpathname': {
        const input = value(args[1])
        if (!(input in nativeFullPaths)) throw new Error(`Unspecified WINAPI response: ${input}`)
        state.vars[args[0]] = nativeFullPaths[input]; break
      }
      case 'system::call': {
        const fullPath = /^kernel32::GetFullPathNameW\(w "([^"]*)", i \$\{NSIS_MAX_STRLEN\}, w \.(R7|R9), p 0\) i \.R6$/.exec(args[0])
        if (fullPath) {
          const input = value(fullPath[1])
          if (!(input in nativeFullPaths)) throw new Error(`Unspecified WINAPI response: ${input}`)
          state.vars['$' + fullPath[2]] = nativeFullPaths[input]
          state.vars.$R6 = String(nativeFullPaths[input].length)
          break
        }
        const match = /^(kernel32::GetFileAttributesW)\(w "([^"]*)"\) i \.s$/.exec(args[0])
        if (!match) throw new Error('Unsupported System call')
        const path = value(match[2])
        state.stack.push(String(attributes(path)))
        break
      }
      case 'call': {
        const name = args[0].replace(/^un\./, '')
        const body = name === 'AssertSafeInstallDirectory' ? guardBody
          : name === 'AssertSafeExistingInstallDirectory' ? existingGuardBody
            : ['GetInQuotes', 'GetFileParent', 'uninstallOldVersion'].includes(name) ? nsisFunction(repairedUtil, name) : null
        if (body === null) throw new Error('Unsupported function')
        execute(body, state, parameters, attributes, registry); break
      }
      case 'var': case 'clearerrors': break
      case 'return': return state
      case 'initpluginsdir': state.effects.push('init-plugin-dir'); return state
      case 'execwait': state.effects.push('execute-old-uninstaller'); return state
      case 'seterrorlevel': state.errorLevel = number(args[0]); break
      case 'abort': state.aborted = true; break
      case 'rename': case 'rmdir': state.effects.push(op); break
      default: throw new Error(`Unsupported NSIS instruction: ${op}`)
    }
  }
  return state
}

function installPath(scope: 'allusers' | 'currentuser', parameters: string, template = repaired) {
  const body = macro(template, scope === 'allusers' ? 'setInstallModePerAllUsers' : 'setInstallModePerUser')
  const override = body.slice(body.indexOf('# allow /D switch'))
  return execute(override, machine(), parameters)
}

describe('official NSIS install path backport execution contract', () => {
  it('applies and reverses the actual dependency patch without unrelated template changes', () => {
    expect(applyPatch(repaired, true)).toBe(original)
    expect(applyPatch(repairedUtil, true, utilFile)).toBe(utilBase)
    expect(applyPatch(repairedSection, true, sectionFile)).toBe(sectionBase)
    if (installedTemplate.includes('kernel32::lstrcpynW')) expect(repaired).toBe(installedTemplate.replace(/\r\n/g, '\n'))
  })

  it.each(['allusers', 'currentuser'] as const)('preserves the complete unquoted space path for /%s despite a corrupt registered path', scope => {
    const parameters = `/S /${scope} /D=D:\\Program Files\\RT-ResearchFlow`
    expect(installPath(scope, parameters, original).vars.$INSTDIR).toBe('D:\\Program')
    const result = installPath(scope, parameters)
    expect(result.vars.$INSTDIR).toBe('D:\\Program Files\\RT-ResearchFlow')
    expect(result.vars).toMatchObject({ $R5: 'keep5', $R6: 'keep6', $R7: 'keep7', $R8: 'keep8', $R9: 'keep9' })
    expect(result.stack).toEqual([])
  })

  it.each(['allusers', 'currentuser'] as const)('preserves Chinese and spaces for /%s', scope => {
    expect(installPath(scope, `/S /${scope} /D=D:\\投研 数据\\RT-ResearchFlow`).vars.$INSTDIR).toBe('D:\\投研 数据\\RT-ResearchFlow')
  })

  it('supports the official lowercase /d= spelling and a plain absolute path', () => {
    expect(installPath('currentuser', '/S /currentuser /d=D:\\Apps\\RT-ResearchFlow').vars.$INSTDIR).toBe('D:\\Apps\\RT-ResearchFlow')
  })

  it.each(['', '/S /allusers', '/S /currentuser', '/D='])('keeps the registry-selected path when no nonempty override exists: %s', parameters => {
    expect(installPath('allusers', parameters).vars.$INSTDIR).toBe('D:\\Program')
  })

  it('makes the /D-last constraint executable: trailing switches are path content, not extra options', () => {
    expect(installPath('allusers', '/S /D=D:\\Program Files\\RT-ResearchFlow /allusers').vars.$INSTDIR)
      .toBe('D:\\Program Files\\RT-ResearchFlow /allusers')
  })
})

describe('installer target protection before destructive operations', () => {
  it.each(['customInit', 'customRemoveFiles'] as const)('%s rejects an existing plain-file target with a nonzero result before any move/delete', hook => {
    const state = execute(macro(installer, hook), machine('D:\\Program'), '', () => 0x20)
    expect(state).toMatchObject({ aborted: true, errorLevel: 2, effects: [], stack: [] })
    expect(state.vars).toMatchObject({ $R8: 'keep8', $R9: 'keep9' })
  })

  it.each([
    '', 'relative\\RT-ResearchFlow', 'C:目录', '\\目录', '1:\\Apps',
    'D:\\', 'D:\\Apps\\..\\', '"D:\\Program Files\\RT-ResearchFlow"',
    '\\\\server', '\\\\server\\share', '\\\\server\\share\\', '\\\\server\\share\\\\',
    '\\\\server\\share\\Apps\\..\\', '\\\\?\\D:\\Apps', '\\\\.\\Apps',
  ])('blocks non-fully-qualified, root or quoted target: %s', path => {
    expect(execute(macro(installer, 'customInit'), machine(path))).toMatchObject({ aborted: true, errorLevel: 2, effects: [], stack: [] })
  })

  it.each([
    ['D:\\Program Files\\RT-ResearchFlow', 0x10],
    ['D:\\投研 数据\\RT-ResearchFlow', 0x10],
    ['D:\\New Apps\\RT-ResearchFlow', -1],
    ['D:\\Program Files\\RT-ResearchFlow\\', 0x10],
    ['\\\\server\\share\\RT-ResearchFlow', 0x10],
    ['\\\\server\\share\\RT-ResearchFlow\\', 0x10],
  ] as const)('permits an existing directory or new absolute non-root target: %s', (path, attributes) => {
    expect(execute(macro(installer, 'customInit'), machine(path), '', () => attributes))
      .toMatchObject({ aborted: false, errorLevel: 0, effects: [], stack: [] })
  })
})

describe('old registry paths and final installation targets are checked before uninstalling', () => {
  const hives = ['HKEY_LOCAL_MACHINE', 'HKEY_CURRENT_USER'] as const
  const invalidOld = [
    ['D:\\Program', 0x20], ['C:目录', 0x10], ['\\目录', 0x10], ['D:\\', 0x10],
    ['\\\\server\\share', 0x10], ['\\\\server\\share\\', 0x10], ['\\\\server\\share\\\\', 0x10],
    ['D:\\Program Files\\RT-ResearchFlow', -1], ['\\\\server\\share\\Apps\\..\\', 0x10],
  ] as const
  const fixtures = (hive: string, path: string, installLocation = path): RegistryFixture => ({
    values: { [hive]: { InstallLocation: installLocation, UninstallString: `"${path}\\Uninstall RT-ResearchFlow.exe" /allusers` } },
  })

  it.each(hives.flatMap(hive => invalidOld.map(([path, attributes]) => ({ hive, path, attributes }))))(
    'rejects $hive old path $path before any old uninstaller copy or execution', ({ hive, path, attributes }) => {
      const state = machine('D:\\Program Files\\RT-ResearchFlow')
      const script = macro(repairedUtil, 'uninstallOldVersion').replaceAll('${ROOT_KEY}', hive)
      expect(execute(script, state, '', () => attributes, fixtures(hive, path)))
        .toMatchObject({ aborted: true, errorLevel: 2, effects: [] })
    },
  )

  it.each(hives)('permits the parsed existing directory for %s', hive => {
    const path = 'D:\\Program Files\\RT-ResearchFlow'
    const body = nsisFunction(repairedUtil, 'uninstallOldVersion')
    const prefix = body.slice(0, body.indexOf('  ${if} $installMode == "CurrentUser"'))
    const state = machine(path)
    state.stack.push(hive)
    expect(execute(prefix, state, '', () => 0x10, fixtures(hive, path)))
      .toMatchObject({ aborted: false, errorLevel: 0, effects: [] })
    expect(state.vars.$installationDir).toBe(path)
  })

  it.each(hives)('also checks %s paths inferred from the old quoted uninstall string', hive => {
    const script = macro(repairedUtil, 'uninstallOldVersion').replaceAll('${ROOT_KEY}', hive)
    expect(execute(script, machine(), '', () => 0x20, fixtures(hive, 'D:\\Program', '')))
      .toMatchObject({ aborted: true, errorLevel: 2, effects: [] })
  })

  it.each(['C:目录', '\\目录', 'D:\\Program', '\\\\server\\share\\'])('rechecks a final target changed after customInit: %s', path => {
    const attributes = (candidate: string) => candidate === 'D:\\Program' ? 0x20 : 0x10
    const state = execute(macro(installer, 'customInit'), machine('D:\\Program Files\\RT-ResearchFlow'), '', attributes)
    expect(state.aborted).toBe(false)
    state.vars.$INSTDIR = path
    const finalStage = repairedSection.slice(repairedSection.indexOf('!insertmacro customValidateInstallTarget'))
    expect(execute(finalStage, state, '', attributes)).toMatchObject({ aborted: true, errorLevel: 2, effects: [] })
  })

  it('does not copy or execute an old uninstaller when no old registration exists', () => {
    const script = macro(repairedUtil, 'uninstallOldVersion').replaceAll('${ROOT_KEY}', 'HKEY_LOCAL_MACHINE')
    expect(execute(script, machine())).toMatchObject({ aborted: false, errorLevel: 0, effects: [] })
  })

  const upgradeStage = repairedSection.slice(
    repairedSection.indexOf('!insertmacro customPreflightOldInstallDirectories'),
    repairedSection.indexOf('SetOutPath $INSTDIR'),
  )
  const validOld = 'D:\\Program Files\\RT-ResearchFlow'
  const upgrade = (mode: 'all' | 'CurrentUser', values: RegistryFixture['values'], attributes: (path: string) => number) => {
    const state = machine(validOld)
    state.vars.$installMode = mode
    return execute(upgradeStage, state, '', attributes, {
      scope: mode === 'all' ? 'HKEY_LOCAL_MACHINE' : 'HKEY_CURRENT_USER', values,
    })
  }

  it.each(['D:\\Program', 'D:\\', 'C:目录', '\\目录', '\\\\server\\share\\']) (
    'preflights valid HKLM plus invalid HKCU %s before permitting either uninstall', badPath => {
      const result = upgrade('all', {
        ...fixtures('HKEY_LOCAL_MACHINE', validOld).values,
        ...fixtures('HKEY_CURRENT_USER', badPath).values,
      }, path => path === 'D:\\Program' ? 0x20 : 0x10)
      expect(result).toMatchObject({ aborted: true, errorLevel: 2, effects: [] })
      expect(result.reads).toContain('HKEY_LOCAL_MACHINE:InstallLocation')
      expect(result.reads).toContain('HKEY_CURRENT_USER:InstallLocation')
    },
  )

  it('uses the uninstall-string fallback for the complete preflight too', () => {
    expect(upgrade('all', {
      ...fixtures('HKEY_LOCAL_MACHINE', validOld).values,
      ...fixtures('HKEY_CURRENT_USER', 'D:\\Program', '').values,
    }, path => path === 'D:\\Program' ? 0x20 : 0x10))
      .toMatchObject({ aborted: true, errorLevel: 2, effects: [] })
  })

  it('permits HKLM then HKCU only after both have passed preflight and immediate checks', () => {
    const result = upgrade('all', {
      ...fixtures('HKEY_LOCAL_MACHINE', validOld).values,
      ...fixtures('HKEY_CURRENT_USER', validOld).values,
    }, () => 0x10)
    expect(result).toMatchObject({ aborted: false, errorLevel: 0,
      effects: ['uninstall-permitted:SHELL_CONTEXT', 'uninstall-permitted:HKEY_CURRENT_USER'] })
    expect(result.reads.filter(read => read.endsWith(':InstallLocation'))).toEqual([
      'HKEY_LOCAL_MACHINE:InstallLocation', 'HKEY_CURRENT_USER:InstallLocation',
      'HKEY_LOCAL_MACHINE:InstallLocation', 'HKEY_CURRENT_USER:InstallLocation',
    ])
    expect(result.vars.$preflightOldInstallPaths).toBe('')
  })

  it.each(['D:\\Program', 'D:\\', 'C:目录'])('currentuser never reads or uninstalls unrelated invalid HKLM %s', badPath => {
    const result = upgrade('CurrentUser', {
      ...fixtures('HKEY_LOCAL_MACHINE', badPath).values,
      ...fixtures('HKEY_CURRENT_USER', validOld).values,
    }, path => path === 'D:\\Program' ? 0x20 : 0x10)
    expect(result).toMatchObject({ aborted: false, errorLevel: 0, effects: ['uninstall-permitted:SHELL_CONTEXT'] })
    expect(result.reads.every(read => read.startsWith('HKEY_CURRENT_USER:'))).toBe(true)
    expect(result.reads.filter(read => read.endsWith(':InstallLocation'))).toHaveLength(2)
  })

  it('currentuser rejects its actual invalid HKCU before any uninstall', () => {
    expect(upgrade('CurrentUser', {
      ...fixtures('HKEY_LOCAL_MACHINE', validOld).values,
      ...fixtures('HKEY_CURRENT_USER', 'D:\\Program').values,
    }, path => path === 'D:\\Program' ? 0x20 : 0x10))
      .toMatchObject({ aborted: true, errorLevel: 2, effects: [] })
  })

  it('keeps the immediate guard if a path becomes a file after all-scope preflight', () => {
    let calls = 0
    const result = upgrade('all', {
      ...fixtures('HKEY_LOCAL_MACHINE', validOld).values,
      ...fixtures('HKEY_CURRENT_USER', validOld).values,
    }, () => ++calls <= 4 ? 0x10 : 0x20)
    expect(result).toMatchObject({ aborted: true, errorLevel: 2, effects: [] })
  })
})
