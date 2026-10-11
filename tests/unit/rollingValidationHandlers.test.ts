import { beforeEach, expect, it, vi } from 'vitest'
const registry = vi.hoisted(() => new Map<string, (...args: any[]) => any>())
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => registry.set(name, fn), removeHandler: (name: string) => registry.delete(name) } }))
import { registerRollingValidationHandlers } from '../../electron/main/ipc/rollingValidationHandlers'
beforeEach(() => registry.clear())
function setup() {
  const frame = {}, contents = { isDestroyed: () => false, mainFrame: frame }, win = { isDestroyed: () => false, webContents: contents }
  const db = vi.fn(() => { throw Error('sk-sensitive ACCOUNT_123 D:/private') })
  const dispose = registerRollingValidationHandlers(() => win as unknown as Electron.BrowserWindow, db)
  return { frame, contents, db, dispose, event: { sender: contents, senderFrame: frame } }
}
it('rejects foreign senders and subframes before touching storage', () => {
  const s = setup()
  for (const event of [{ sender: {}, senderFrame: s.frame }, { sender: s.contents, senderFrame: {} }, { sender: s.contents, senderFrame: null }]) {
    expect(registry.get('rollingValidation:advance')!(event, '10000000-0000-4000-8000-000000000001').code).toBe('UNAUTHORIZED')
  }
  expect(s.db).not.toHaveBeenCalled()
})
it('decodes all input before storage and removes every handler', () => {
  const s = setup()
  for (const [name, value] of [['list', {}], ['get', 'bad-id'], ['advance', 'bad-id'], ['prepare', { extra: 'bad' }]]) expect(registry.get(`rollingValidation:${name}`)!(s.event, value).code).toBe('INVALID_INPUT')
  expect(s.db).not.toHaveBeenCalled(); s.dispose(); expect(registry.size).toBe(0)
})
it('does not disclose storage errors or credentials', () => {
  const s = setup(), response = registry.get('rollingValidation:list')!(s.event)
  expect(response.code).toBe('STORAGE_UNAVAILABLE'); expect(JSON.stringify(response)).not.toMatch(/sk-sensitive|ACCOUNT_123|private/)
})
