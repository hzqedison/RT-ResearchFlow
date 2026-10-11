import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { registerCapitalSimulationHandlers } from '../../electron/main/ipc/capitalSimulationHandlers'
const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: never) => handlers.set(name, fn), removeHandler: (name: string) => handlers.delete(name) } }))
describe('capital trusted caller boundary', () => {
  beforeEach(() => handlers.clear())
  it('rejects foreign windows and child frames before reading the database', () => {
    const frame = {}, contents = { isDestroyed: () => false, mainFrame: frame }, window = { isDestroyed: () => false, webContents: contents }
    const getDb = vi.fn(); registerCapitalSimulationHandlers(() => window as unknown as BrowserWindow, getDb)
    for (const event of [{ sender: { isDestroyed: () => false }, senderFrame: frame }, { sender: contents, senderFrame: {} }, { sender: contents, senderFrame: null }]) {
      expect(handlers.get('capitalSimulation:catalog')!(event as unknown as IpcMainInvokeEvent)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' })
    }
    expect(getDb).not.toHaveBeenCalled()
  })
  it('validates DTOs before storage and removes all three handlers', () => {
    const frame = {}, contents = { isDestroyed: () => false, mainFrame: frame }, window = { isDestroyed: () => false, webContents: contents }
    const getDb = vi.fn(), dispose = registerCapitalSimulationHandlers(() => window as unknown as BrowserWindow, getDb), event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent
    expect(handlers.get('capitalSimulation:run')!(event, { brokerOrder: true })).toMatchObject({ ok: false, code: 'INVALID_INPUT' }); expect(getDb).not.toHaveBeenCalled()
    dispose(); expect(handlers.size).toBe(0)
  })
  it('does not leak raw filesystem or database errors', () => {
    const frame = {}, contents = { isDestroyed: () => false, mainFrame: frame }, window = { isDestroyed: () => false, webContents: contents }
    registerCapitalSimulationHandlers(() => window as unknown as BrowserWindow, () => { throw Error('C:/private/account-secret.db token=private') })
    const result = handlers.get('capitalSimulation:catalog')!({ sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent)
    expect(result).toMatchObject({ ok: false, code: 'STORAGE_UNAVAILABLE' }); expect(JSON.stringify(result)).not.toContain('private')
  })
})
