import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ handlers: new Map<string, Function>(), run: vi.fn(), health: vi.fn(), db: {}, support: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => undefined } }))
vi.mock('../../electron/main/security/trustedIpc', () => ({ registerTrustedIpcHandler: (channel: string, _window: unknown, handler: Function) => state.handlers.set(channel, handler) }))
vi.mock('../../electron/main/database/db', () => ({ getDb: () => state.db }))
vi.mock('../../electron/main/services/diagnosticsService', () => ({ getDiagnosticsHealth: state.health, runDiagnosticAction: state.run }))
vi.mock('../../electron/main/services/supportDiagnosticsService', () => ({ recordSupportFailure: state.support }))
import { registerDiagnosticsHandlers } from '../../electron/main/ipc/diagnosticsHandlers'

beforeEach(() => { vi.clearAllMocks(); state.handlers.clear(); state.support.mockReturnValue({ correlationId: 'fixture-id' }); registerDiagnosticsHandlers(() => null) })
const invoke = (payload: unknown) => state.handlers.get('diagnostics:runCheck')!({ sender: {} }, payload)
describe('readiness IPC allowlist and failure outcomes', () => {
  it.each(['syncAuctionSnapshot', 'syncLimitList'])('allows %s but ignores renderer date injection', async action => {
    state.run.mockResolvedValue({ action, status: 'completed', outcome: 'success', targetDate: '20260930', insertedRows: 1, reasonCode: 'FACTS_SAVED', message: 'fixture facts saved' })
    expect(await invoke({ action, targetDate: '20990101' })).toMatchObject({ ok: true, data: { outcome: 'success', targetDate: '20260930' } })
    expect(state.run).toHaveBeenCalledWith(state.db, action, undefined)
  })
  it.each(['empty', 'partial', 'blocked', 'failed', 'waiting'])('%s cannot become initialization/Panel success', async outcome => {
    state.run.mockResolvedValue({ action: 'syncConceptMembers', status: 'completed', outcome, reasonCode: outcome === 'empty' ? 'UPSTREAM_EMPTY' : 'CONCEPT_PARTIAL', insertedRows: 0, source: 'ths', targetDate: null, message: 'fixture not repaired' })
    expect(await invoke({ action: 'syncConceptMembers' })).toMatchObject({ ok: false, receipt: { outcome, insertedRows: 0 }, message: 'fixture not repaired' })
  })
  it('unlisted actions are rejected before calling any business service', async () => {
    expect(await invoke({ action: 'refreshMorningAuctionSnapshot' })).toMatchObject({ ok: false, error: 'INVALID_PARAM' })
    expect(state.run).not.toHaveBeenCalled()
  })
  it('mapped thrown errors disclose stable code, not raw token/path details', async () => {
    state.run.mockRejectedValue(new Error('FACT_CONFLICT fixture-secret K:/private/profile'))
    const result = await invoke({ action: 'syncAuctionSnapshot' })
    expect(result).toMatchObject({ ok: false, error: 'FACT_CONFLICT' })
    expect(result.message).not.toContain('fixture-secret'); expect(result.message).not.toContain('K:/private')
  })
})
