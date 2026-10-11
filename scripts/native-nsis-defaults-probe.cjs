'use strict'
// Diagnostic only: no app launch, broker connection, registry write or installer.
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(process.argv[2])
if (!/^[DK]:\\/i.test(root)) throw Error('NON_SYSTEM_TEST_ROOT_REQUIRED')
fs.mkdirSync(root, { recursive: true })
const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'installer.nsh'), 'utf8')
function block(kind, name, end) {
  const start = source.indexOf(`${kind} ${name}`)
  const finish = source.indexOf(end, start)
  if (start < 0 || finish < 0) throw Error('MISSING_SOURCE_BLOCK')
  return source.slice(start, finish + end.length)
}
const trace = label => `Push $9\nFileOpen $9 "$EXEDIR\\native-defaults.log" a\nFileSeek $9 0 END\nFileWrite $9 "${label}$\\r$\\n"\nFileClose $9\nPop $9\n`
let functions = [block('!macro', 'defineSafeInstallTargetCheck', '!macroend'),
  '!insertmacro defineSafeInstallTargetCheck ""',
  block('!macro', 'rtDefaultCheckRegistration', '!macroend'),
  block('Function', 'rtProbeFreshInstallDefault', 'FunctionEnd'),
  block('Function', 'rtSelectFreshInstallDirectory', 'FunctionEnd')].join('\n')
if (process.env.RT_NSIS_PROBE_LOCAL === '1') functions = functions.replaceAll('D:\\Program Files\\RT-ResearchFlow', path.join(root, 'missing-parent', 'product'))
functions = functions.replace('GetFullPathName $R7 "$R8"', 'GetFullPathName $R7 "$R8"\n' + trace('guard-full-path R8=$R8 R7=$R7'))
  .replace('GetFullPathName $R9 "$R7\\.."', 'GetFullPathName $R9 "$R7\\.."\n' + trace('guard-parent R7=$R7 R9=$R9'))
let counter = 0
functions = functions.split('\n').map(line => line.includes('System::Call')
  ? trace(`native-${++counter} R3=$R3 R4=$R4 R7=$R7 R9=$R9`) + line : line).join('\n')
const knownFolder = [
  'StrCpy $0 "$LocalAppData\\Programs"', 'System::Store "p1 p2"',
  `System::Call 'SHELL32::SHGetKnownFolderPath(g "{5CD7AEE2-2219-4A67-B85D-6C9CE15660CB}", i 0x00008000, p 0, *p .r2)i.r1'`,
  '${If} $1 == 0', `System::Call '*$2(&w${'${NSIS_MAX_STRLEN}'} .r0)'`,
  `System::Call 'OLE32::CoTaskMemFree(p r2)'`, '${endif}', 'System::Store "r2 r1"',
].map((line, index) => trace(`known-folder-${index}`) + line).join('\n')
// The selector is tested without /D. This fixture uses FileFunc parameters,
// not StdUtils; the production StdUtils parser still needs full-EXE acceptance.
const header = ['Unicode true', '!include LogicLib.nsh', '!include FileFunc.nsh',
  '!define INSTALL_REGISTRY_KEY "Software\\RT-ResearchFlow-native-diagnostic-fixture"',
  '!define UNINSTALL_REGISTRY_KEY "Software\\RT-ResearchFlow-native-diagnostic-uninstall-fixture"',
  '!macro GetDParameter outVar', '${GetParameters} ${outVar}',
  'StrCpy ${outVar} ""', '!macroend', 'Name "RT isolated native default probe"',
  `OutFile "${root}\\native-defaults.exe"`, 'RequestExecutionLevel user', 'SilentInstall silent',
].join('\n')
const pluginDirectory = process.env.RT_NSIS_STDUTILS_DIR
let actualHeader = header
if (pluginDirectory) {
  const patch = fs.readFileSync(path.join(__dirname, '..', 'patches', 'app-builder-lib@24.13.3.patch'), 'utf8')
  const added = patch.split(/\r?\n/).filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n')
  const start = added.indexOf('!macro GetDParameter outVar')
  const finish = added.indexOf('!macroend', start)
  if (start < 0 || finish < 0) throw Error('MISSING_PRODUCTION_PARAMETER_PARSER')
  const parser = added.slice(start, finish + '!macroend'.length)
    .replace('${StdUtils.GetAllParameters} $R8 "0"', 'Push "0"\n  StdUtils::GetAllParameters /NOUNLOAD\n  Pop $R8')
  actualHeader = `!addplugindir /x86-unicode "${pluginDirectory}"\n` + header.replace(/!macro GetDParameter outVar[\s\S]*?!macroend/, parser)
}
const section = ['Section', ...Array.from({ length: 5 }, (_, index) => [knownFolder,
  trace(`known-folder-completed-${index}`), 'Call rtSelectFreshInstallDirectory',
  trace(`selector-completed-${index} target=$INSTDIR`), 'Push "$INSTDIR"', 'Call AssertSafeInstallDirectory',
  trace(`target-check-completed-${index}`)].join('\n')), 'SectionEnd'].join('\n')
fs.writeFileSync(path.join(root, 'native-defaults.nsi'), '\uFEFF' + actualHeader + '\n' + functions + '\n' + section)
