import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ run: vi.fn(), record: vi.fn(), handlers: new Map<string, (...args: any[]) => any>() }))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => undefined } }))
vi.mock('../../electron/main/security/trustedIpc', () => ({ registerTrustedIpcHandler: (name: string, _window: unknown, fn: (...args: any[]) => any) => m.handlers.set(name, fn) }))
vi.mock('../../electron/main/database/db', () => ({ getDb: () => ({}) }))
vi.mock('../../electron/main/services/diagnosticsService', () => ({ runDiagnosticAction: m.run, getDiagnosticsHealth: vi.fn() }))
vi.mock('../../electron/main/services/supportDiagnosticsService', () => ({ recordSupportFailure: m.record }))
vi.mock('../../electron/main/services/historicalDailyProgressService', () => ({ getHistoricalDailyProgress: vi.fn() }))
vi.mock('../../electron/main/services/publicHistoricalDailySyncService', () => ({ isPublicHistoricalDailySyncRunning: () => false }))
import { registerDiagnosticsHandlers } from '../../electron/main/ipc/diagnosticsHandlers'
import { LocalWorkCancelledError } from '../../electron/main/services/publicMarketWorkOwner'
beforeEach(() => { vi.resetAllMocks(); m.handlers.clear(); m.record.mockReturnValue({ correlationId: 'isolated-failure' }); registerDiagnosticsHandlers(() => null) })
it('returns cancellation without falsely creating an internal-error feedback record', async () => {
  m.run.mockRejectedValue(new LocalWorkCancelledError())
  const reply = await m.handlers.get('diagnostics:runCheck')!({ sender: {} }, { action: 'syncHistoricalDaily' })
  expect(reply).toMatchObject({ ok: false, error: 'LOCAL_WORK_CANCELLED' }); expect(reply.message).toContain('已提交的数据保留'); expect(m.record).not.toHaveBeenCalled()
})
it('still records actual unknown failures', async () => {
  m.run.mockRejectedValue(Error('isolated storage failure'))
  const reply = await m.handlers.get('diagnostics:runCheck')!({ sender: {} }, { action: 'syncHistoricalDaily' })
  expect(reply.error).toBe('DIAGNOSTICS_FAILED'); expect(m.record).toHaveBeenCalledTimes(1); expect(reply.correlationId).toBe('isolated-failure')
})
