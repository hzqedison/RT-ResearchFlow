'use strict'
// CI-only instrumentation. Diagnostic installers must never be published.
const fs = require('node:fs')
const path = require('node:path')
const resource = path.join(__dirname, '..', 'resources', 'installer.nsh')
const template = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates', 'nsis', 'multiUser.nsh')
const helper = `
!macro defineRTNativeTrace PREFIX
Function ${'${PREFIX}'}rtNativeTrace
  Exch $9
  Push $8
  Push $7
  StrCpy $7 "0"
  IfErrors 0 +2
    StrCpy $7 "1"
  ClearErrors
  FileOpen $8 "$TEMP\\rt-native-installer.log" a
  FileSeek $8 0 END
  FileWrite $8 "$9$\\r$\\n"
  FileClose $8
  StrCmp $7 "1" rt_trace_restore_error
  ClearErrors
  Goto rt_trace_done
  rt_trace_restore_error:
  SetErrors
  rt_trace_done:
  Pop $7
  Pop $8
  Pop $9
FunctionEnd
!macroend
!ifdef BUILD_UNINSTALLER
  !insertmacro defineRTNativeTrace "un."
!else
  !insertmacro defineRTNativeTrace ""
!endif
!macro rtNativeTrace LABEL
  Push "${'${LABEL}'}"
  !ifdef BUILD_UNINSTALLER
    Call un.rtNativeTrace
  !else
    Call rtNativeTrace
  !endif
!macroend
`
function instrument(file, label) {
  let counter = 0
  const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split('\n').map(line => line.includes('System::Call')
    ? `  !insertmacro rtNativeTrace "${label}-${++counter}"\n${line}\n  !insertmacro rtNativeTrace "${label}-${counter}-returned"` : line).join('\n')
  fs.writeFileSync(file, '\uFEFF' + (file === resource ? helper : '') + content.replace(/^\uFEFF/, ''))
}
instrument(resource, 'resource')
instrument(template, 'multi-user')
