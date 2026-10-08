import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  register: vi.fn(), preview: vi.fn(), save: vi.fn()
}))

vi.mock('../../electron/main/security/trustedIpc', () => ({
  registerTrustedIpcHandler: mocks.register
}))
vi.mock('../../electron/main/services/supportDiagnosticsService', () => ({
  generateSupportFeedbackPreview: mocks.preview,
  saveSupportFeedbackFile: mocks.save
}))

import { registerSupportDiagnosticsHandlers } from '../../electron/main/ipc/supportDiagnosticsHandlers'

describe('support diagnostic IPC registration', () => {
  it('registers exactly two fixed channels through the trusted window helper', async () => {
    mocks.register.mockClear()
    const getWindow = () => null
    registerSupportDiagnosticsHandlers(getWindow)
    expect(mocks.register.mock.calls.map(call => call[0])).toEqual([
      'supportDiagnostics:generatePreview', 'supportDiagnostics:savePreview'
    ])
    expect(mocks.register.mock.calls.every(call => call[1] === getWindow)).toBe(true)
    mocks.preview.mockReturnValue({ ok: true })
    mocks.save.mockResolvedValue({ ok: false, status: 'expired' })
    const generate = mocks.register.mock.calls[0][2]
    const save = mocks.register.mock.calls[1][2]
    expect(generate({}, { apiKey: 'renderer-must-not-be-used' })).toEqual({ ok: true })
    expect(mocks.preview).toHaveBeenCalledWith()
    expect(await save({}, '5932b684-7ee4-4c98-a05d-405ccd0e1104', { path: 'renderer-must-not-be-used' })).toEqual({ ok: false, status: 'expired' })
    expect(mocks.save).toHaveBeenCalledWith('5932b684-7ee4-4c98-a05d-405ccd0e1104')
  })
})
