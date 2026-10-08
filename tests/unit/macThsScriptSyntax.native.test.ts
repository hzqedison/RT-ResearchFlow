import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { macThsNativeScript, macThsScript } from '../../electron/main/services/macThsScripts'
import type { MacThsOrder } from '../../electron/shared/macThsTypes'
import type { NativeScriptRequest } from '../../electron/shared/macThsNativeProtocol'

// Complements macThsCore.test.ts's existing osacompile check. These cases retain
// failures and cover the private JXA template too. No compiled output is executed.
const FIXTURE_ID = '00000000-0000-4000-8000-000000000001'
const CONTRACT = 'COMPILE-ONLY-001'
interface CompileCase {
  name: string
  language: 'AppleScript' | 'JavaScript'
  render: () => string
}
const cases: CompileCase[] = []
for (const mode of ['live', 'simulation'] as const) {
  cases.push({ name: 'cancel-' + mode, language: 'AppleScript',
    render: () => macThsScript(mode === 'live' ? 'cancelLive' : 'cancelSimulation', mode, undefined, CONTRACT) })
  for (const side of ['buy', 'sell'] as const) {
    const order: MacThsOrder = { requestId: FIXTURE_ID, mode, side, symbol: '600000', price: '10.00',
      quantity: 100, maxNotional: '1000.00' }
    cases.push({ name: 'submit-' + mode + '-' + side, language: 'AppleScript',
      render: () => macThsScript(mode === 'live' ? 'submitLive' : 'submitSimulation', mode, order) })
  }
}
for (const action of ['observe_context', 'observe_cancel_target', 'execute', 'observe_receipt'] as const) {
  // Deliberately synthetic, deterministic identifiers. No application/account query.
  const bound = action === 'execute' || action === 'observe_receipt'
  const request: NativeScriptRequest = {
    nonce: FIXTURE_ID, action, mode: 'live',
    expectedAccount: bound ? { kind: 'fund_account', value: 'SYNTAXFIXTURE001', broker: 'citics', selected: true } : null,
    expectedClientVersion: bound ? '9.0.0' : null,
    expectedDate: bound ? '2026-10-08' : null,
    order: bound ? { symbol: '600000', market: 'SH', side: 'buy', priceCents: 1000, quantity: 100 } : null,
    contractNo: action === 'observe_cancel_target' ? CONTRACT : null,
    beforeContracts: action === 'observe_receipt' ? ['COMPILE-ONLY-OLD'] : null,
  }
  cases.push({ name: 'jxa-' + action.replaceAll('_', '-'), language: 'JavaScript', render: () => macThsNativeScript(request) })
}

describe.skipIf(process.platform !== 'darwin')('Mac native template syntax: compile only (darwin required)', () => {
  it.each(cases)('$name compiles without executing the generated program', testCase => {
    // Canonicalize macOS's temporary-directory aliases before creating our own root.
    // Nothing is created, compiled or cleaned up on non-darwin platforms.
    const temporaryRoot = realpathSync(tmpdir())
    const directory = mkdtempSync(join(temporaryRoot, 'rt-ths-compile-only-'))
    const sourcePath = join(directory, testCase.language === 'AppleScript' ? 'fixture.applescript' : 'fixture.js')
    const outputPath = join(directory, 'compiled.scpt')
    const diagnosticsPath = join(directory, 'compile-diagnostics.json')
    try {
      writeFileSync(sourcePath, testCase.render(), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      // Fixed compiler, no shell, no osascript, no invocation of the output file.
      // Source-level Application/click/select expressions are compiled, never run.
      const result = spawnSync('/usr/bin/osacompile', ['-l', testCase.language, '-o', outputPath, sourcePath], {
        shell: false, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 20_000,
        killSignal: 'SIGKILL', maxBuffer: 128 * 1024,
      })
      writeFileSync(diagnosticsPath, JSON.stringify({
        case: testCase.name, language: testCase.language, compileOnly: true,
        executable: '/usr/bin/osacompile', status: result.status, signal: result.signal,
        errorCode: result.error ? (result.error as NodeJS.ErrnoException).code ?? 'COMPILER_ERROR' : null,
        errorMessage: result.error?.message ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '',
      }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      expect(result.error, 'compiler error; diagnostics retained at ' + diagnosticsPath).toBeUndefined()
      expect(result.signal, 'compiler signal; diagnostics retained at ' + diagnosticsPath).toBeNull()
      expect(result.status, 'compiler rejected source; diagnostics retained at ' + diagnosticsPath).toBe(0)
      expect(lstatSync(outputPath).isFile(), 'compiler output must be a regular file').toBe(true)
    } catch (error) {
      // Do not remove a failed source, partial compiler output or its diagnostics.
      throw new Error('COMPILE_ONLY_FAILED: ' + testCase.name + '; retained directory: ' + directory, { cause: error })
    }
    // Only a successful case's freshly owned, canonical directory can be removed.
    if (dirname(resolve(directory)) !== temporaryRoot || !basename(directory).startsWith('rt-ths-compile-only-')
      || lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) {
      throw new Error('UNOWNED_COMPILE_DIRECTORY: refusing cleanup')
    }
    rmSync(directory, { recursive: true, force: false })
  }, 30_000)
})
