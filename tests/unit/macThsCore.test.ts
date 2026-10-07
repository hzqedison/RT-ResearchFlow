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
    { quantity: Number.NaN }, { maxNotional: '999.99' }, { mode: 'unverified' }, { requestId: 'bad' },
  ])('rejects unsupported or unsafe order input %j', changes => {
    expect(validateMacThsOrder({ ...valid, ...changes })).toBeNull()
  })
  it('does not export local order identifiers or injected private fields', () => {
    const raw = { schemaVersion: 1, component: 'mac-ths-ui-experiment', adapterVersion: '2',
      runtime: 'macos', architecture: 'arm64', action: 'submitSimulation', mode: 'simulation',
      outcome: 'passed', code: 'SIMULATION_ACCEPTED', unknownPending: false, canSubmitLiveOrders: false,
      canRunUnattended: false, contractNo: 'SENSITIVE_ID', account: 'SENSITIVE_ACCOUNT',
      password: 'SENSITIVE_PASSWORD', symbol: 'SENSITIVE_SYMBOL', rawLog: 'SENSITIVE_LOG',
      confirmation: { token: 'SENSITIVE_TOKEN', title: 'SENSITIVE_TITLE', message: 'SENSITIVE_ORDER', confirmLabel: 'SENSITIVE_LABEL' } } as MacThsResult
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
  it('supports explicit real orders but never automatically confirms broker sheets', () => {
    const order = validateMacThsOrder({ ...valid, mode: 'live' })!
    expect(order.mode).toBe('live')
    for (const side of ['buy', 'sell'] as const) {
      const script = macThsScript('submitLive', 'live', { ...order, side })
      expect(script).toContain('click button "' + (side === 'buy' ? '确定买入' : '确定卖出') + '"')
      expect(script).toContain('brokerLabel(theWindow)')
      expect(script).toContain('readbackMatches')
      expect(script).toContain('matchingNewContracts')
      expect(script).toContain('NATIVE_CONFIRMATION_REQUIRED')
      expect(script).not.toContain('click button "确认"')
      expect(script).not.toContain('do shell script')
    }
    expect(() => macThsScript('submitLive', 'livePreview', { ...order, mode: 'livePreview' })).toThrow()
    expect(() => macThsScript('cancelLive', 'live', undefined, 'bad" injection')).toThrow()
  })
  it('real cancellation is exact, single-order, and never all-revoke', () => {
    const script = macThsScript('cancelLive', 'live', undefined, 'TEST123')
    expect(script).toContain('count of matchedRows is not 1')
    expect(script).toContain('click button "撤单"')
    expect(script).not.toContain('click button "全撤"')
    expect(script).not.toContain('click button "确认"')
  })
  it.skipIf(process.platform !== 'darwin')('compiles supported AppleScripts without executing them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rt-ths-script-'))
    try {
      for (const action of ['probe', 'preview', 'submitSimulation', 'queryOrders', 'queryDeals', 'cancelSimulation', 'submitLive', 'cancelLive'] as const) {
        const mode = action === 'submitLive' || action === 'cancelLive' ? 'live' : 'simulation'
        execFileSync('/usr/bin/osacompile', ['-o', join(directory, action + '.scpt'), '-e',
          macThsScript(action, mode, validateMacThsOrder({ ...valid, mode })!, 'TEST123')],
        { timeout: 30000, stdio: 'pipe' })
      }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }, 120000)
})
