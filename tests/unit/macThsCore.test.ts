import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeMacThsDiagnostic, validateMacThsOrder, type MacThsResult } from '../../electron/shared/macThsTypes'
import { macThsScript } from '../../electron/main/services/macThsScripts'

const valid = { requestId: '00000000-0000-4000-8000-000000000001', mode: 'simulation', side: 'buy',
  symbol: '600000', price: '10.00', quantity: 100, maxNotional: '1000.00' }
describe('Mac THS experimental bridge boundary', () => {
  it('normalizes only explicitly allowed order fields', () => {
    expect(validateMacThsOrder({ ...valid, password: 'SECRET', account: 'PRIVATE' })).toEqual(valid)
  })
  it.each([
    { symbol: '600000" & do shell script "bad' }, { symbol: '688001' }, { symbol: '300001' },
    { price: 'None' }, { price: '0' }, { price: '1.001' }, { quantity: 101 }, { quantity: -100 },
    { quantity: Number.NaN }, { maxNotional: '999.99' }, { mode: 'live' }, { requestId: 'bad' },
  ])('rejects unsupported or unsafe order input %j', changes => {
    expect(validateMacThsOrder({ ...valid, ...changes })).toBeNull()
  })
  it('does not export local order identifiers or injected private fields', () => {
    const raw = { schemaVersion: 1, component: 'mac-ths-ui-experiment', adapterVersion: '1',
      runtime: 'macos', architecture: 'arm64', action: 'submitSimulation', mode: 'simulation',
      outcome: 'passed', code: 'SIMULATION_ACCEPTED', unknownPending: false, canSubmitLiveOrders: false,
      canRunUnattended: false, contractNo: 'SENSITIVE_ID', account: 'SENSITIVE_ACCOUNT',
      password: 'SENSITIVE_PASSWORD', symbol: 'SENSITIVE_SYMBOL', rawLog: 'SENSITIVE_LOG' } as MacThsResult
    expect(JSON.stringify(safeMacThsDiagnostic(raw))).not.toContain('SENSITIVE')
    expect(safeMacThsDiagnostic(raw)).toMatchObject({ canSubmitLiveOrders: false, canRunUnattended: false })
  })
  it('real preview never presses the submit button', () => {
    const script = macThsScript('preview', 'livePreview', validateMacThsOrder({ ...valid, mode: 'livePreview' })!)
    expect(script).not.toContain('click button "确定买入"')
    expect(script).not.toContain('click button "确认"')
    expect(script).not.toContain('do shell script')
  })
  it('simulation submit requires mode checks and a unique new receipt', () => {
    const script = macThsScript('submitSimulation', 'simulation', validateMacThsOrder(valid)!)
    expect(script).toContain('modeConfirmed(theWindow, "simulation")')
    expect(script).toContain('count of newContracts is not 1')
    expect(script).not.toContain('click button "全撤"')
  })
  it.skipIf(process.platform !== 'darwin')('compiles supported AppleScripts without executing them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rt-ths-script-'))
    try {
      for (const action of ['probe', 'preview', 'submitSimulation', 'queryOrders', 'queryDeals', 'cancelSimulation'] as const) {
        execFileSync('/usr/bin/osacompile', ['-o', join(directory, action + '.scpt'), '-e',
          macThsScript(action, 'simulation', validateMacThsOrder(valid)!, 'TEST123')],
        { timeout: 30000, stdio: 'pipe' })
      }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }, 120000)
})
