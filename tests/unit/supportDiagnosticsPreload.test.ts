import { describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: bridge.expose },
  ipcRenderer: { invoke: bridge.invoke }
}))

import type { API } from '../../electron/preload'
import '../../electron/preload'

describe('limited support feedback preload API', () => {
  it('exposes only preview generation and identifier-based saving on fixed channels', async () => {
    const call = bridge.expose.mock.calls.find(args => args[0] === 'api')
    expect(call).toBeDefined()
    const api = call?.[1] as API
    expect(Object.keys(api.supportDiagnostics).sort()).toEqual(['generatePreview', 'savePreview'])
    bridge.invoke.mockResolvedValue({ ok: true })
    await api.supportDiagnostics.generatePreview()
    expect(bridge.invoke).toHaveBeenLastCalledWith('supportDiagnostics:generatePreview')
    await api.supportDiagnostics.savePreview('5932b684-7ee4-4c98-a05d-405ccd0e1104')
    expect(bridge.invoke).toHaveBeenLastCalledWith(
      'supportDiagnostics:savePreview', '5932b684-7ee4-4c98-a05d-405ccd0e1104'
    )
  })
})
