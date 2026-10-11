import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve('resources/installer.nsh'), 'utf8')
const patch = readFileSync(resolve('patches/app-builder-lib@24.13.3.patch'), 'utf8')
const additions = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n')

describe('native installer parameter and owned-probe source contracts', () => {
  it('normalizes fresh paths without requiring their parents to exist', () => {
    const guard = source.slice(source.indexOf('Function ${PREFIX}AssertSafeInstallDirectory'), source.indexOf('FunctionEnd'))
    expect(guard).toContain('kernel32::GetFullPathNameW')
    expect(guard).not.toMatch(/^\s*GetFullPathName /m)
    expect(guard).toContain('IntCmp $R6 ${NSIS_MAX_STRLEN} tw_target_invalid 0 tw_target_invalid')
  })
  it('receives native multi-output values in distinct registers', () => {
    expect(source.split('\n').filter(line => line.includes('System::Call')).some(line => (line.match(/\.s\b/g) ?? []).length > 1)).toBe(false)
  })
  it('captures last error immediately from the same attribute query', () => {
    expect(source).toContain('GetFileAttributesW(w "$R0") i .R3 ?e')
    expect(source).toContain('GetFileAttributesW(w "$R5") i .R3 ?e')
  })
  it('does not mark a directory delete-pending before creating its child', () => {
    expect(source).toContain('i 3, i 0x02200080, p 0) p .R9')
    expect(source).not.toContain('i 3, i 0x06200080')
    expect(source.indexOf('SetFileInformationByHandle')).toBeGreaterThan(source.indexOf('kernel32::CloseHandle(p $R7)'))
  })
  it('receives the known-folder path directly rather than leaving it on the NSIS stack', () => {
    expect(additions).toContain('kernel32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})')
    expect(additions).not.toContain('(&w${NSIS_MAX_STRLEN}')
    expect(additions).toContain('System::Store "p1 p2"')
    expect(additions).toContain('System::Store "r2 r1"')
    expect(additions).not.toContain('StrCpy $0 $1')
  })
})
