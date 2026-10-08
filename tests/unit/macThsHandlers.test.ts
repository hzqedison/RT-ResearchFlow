import { nativeTestBinding, nativeTestTempRoot } from '../fixtures/macThsNativeTestRuntime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createNativeObservationFixture } from '../../electron/shared/macThsNativeProtocol'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { MacThsProductState, MacThsResult, MacThsRequest } from '../../electron/shared/macThsTypes'
import { MacThsOrderService } from '../../electron/main/services/macThsOrderService'

type Handler = (event: IpcMainInvokeEvent, payload?: unknown) => unknown
const hooks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(), response: 1, dialog: vi.fn(), permission: vi.fn(),
  pending: null as null | ((value: { response: number }) => void),
  defer: false, nativeEnabled: false,
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: Handler) => hooks.handlers.set(name, handler),
    removeHandler: (name: string) => hooks.handlers.delete(name) },
  systemPreferences: { isTrustedAccessibilityClient: (...args: unknown[]) => { hooks.permission(...args); return true } },
  dialog: { showMessageBox: (...args: unknown[]) => {
    hooks.dialog(...args)
    return hooks.defer ? new Promise(resolve => { hooks.pending = resolve }) : Promise.resolve({ response: hooks.response })
  } },
}))
import { createMacThsNativeConfirmation, registerMacThsHandlers } from '../../electron/main/ipc/macThsHandlers'
const binding = nativeTestBinding
let service: MacThsOrderService
let window: BrowserWindow | null
let event: IpcMainInvokeEvent
let send: ReturnType<typeof vi.fn>
let unregister: () => void
const invoke = (name: string, payload?: unknown, from = event) => hooks.handlers.get('macThs:' + name)!(from, payload)

describe('product IPC with a real isolated order database', () => {
  beforeEach(async () => {
    hooks.handlers.clear(); hooks.response = 1; hooks.defer = false; hooks.pending = null
    hooks.dialog.mockClear(); hooks.permission.mockClear(); hooks.nativeEnabled = false
    send = vi.fn()
    const frame = {}
    const sender = { id: 21, mainFrame: frame, isDestroyed: () => false, send }
    window = { isDestroyed: () => false, webContents: sender } as unknown as BrowserWindow
    event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent
    const directory = mkdtempSync(join(nativeTestTempRoot, 'rt-i13-ipc-'))
    service = new MacThsOrderService({ directory, confirm: createMacThsNativeConfirmation(() => window),
      accessibility: () => true, testHooks: { platform: 'darwin', adapter: { platform: 'darwin',
        command: (request, script) => {
          if (!hooks.nativeEnabled) throw new Error('Unexpected native launch in boundary test')
          expect(script).toContain(request.nonce)
          const packet = createNativeObservationFixture(request, {
            account: { kind: 'fund_account', value: 'HANDLER00001234', broker: 'citics', selected: true },
            clientVersion: '9.0.0', tradingDate: '2026-10-08',
            ...(request.action === 'execute' ? { target: { symbol: '600000', market: 'SH' as const,
              side: 'buy' as const, priceCents: 1000, quantity: 100, contractNo: 'IPC-NEW', tradingDate: '2026-10-08',
              observation: 'accepted' as const, filledQuantity: null, cancelledQuantity: null } } : {}),
          })
          return { executable: process.execPath, args: ['-e', 'process.stdout.write(' + JSON.stringify(JSON.stringify(packet)) + ')'] }
        } },
        store: { nativeBinding: binding } } })
    await service.start()
    unregister = registerMacThsHandlers(() => window, service)
    console.info('IPC fixture retained:', directory)
  })
  afterEach(async () => { unregister(); await service.shutdown() })
  it('registers fixed methods, initializes explicitly and sends notice-only events', async () => {
    expect([...hooks.handlers.keys()].sort()).toEqual(['macThs:execute', 'macThs:recover', 'macThs:reviewIntent', 'macThs:status'])
    expect((invoke('status') as MacThsProductState).serviceState).toBe('NOT_INITIALIZED')
    expect(hooks.dialog).not.toHaveBeenCalled()
    const state = await invoke('recover', { kind: 'initialize' }) as MacThsProductState
    expect(state).toMatchObject({ serviceState: 'READY_DISABLED', liveEnabled: false, canPrepare: true })
    expect(hooks.dialog.mock.calls[0][1]).toMatchObject({ defaultId: 0, cancelId: 0, noLink: true })
    expect(send).toHaveBeenCalled()
    for (const [channel, notice] of send.mock.calls) {
      expect(channel).toBe('macThs:stateChanged')
      expect(Object.keys(notice).sort()).toEqual(['sessionId', 'stateSequence'])
    }
  })
  it.each(['status', 'execute', 'recover', 'reviewIntent'])('rejects foreign senders and subframes on %s', async channel => {
    for (const foreign of [{ ...event, sender: {} }, { ...event, senderFrame: {} }]) {
      await expect(Promise.resolve().then(() => invoke(channel, undefined, foreign as IpcMainInvokeEvent))).rejects.toThrow('UNAUTHORIZED')
    }
    expect(hooks.dialog).not.toHaveBeenCalled()
  })
  it('rejects arbitrary status payloads and renderer initialization flags', async () => {
    expect(() => invoke('status', { nativeBinding: binding })).toThrow('INVALID_REQUEST')
    expect(await invoke('recover', { kind: 'initialize', initialize: true, directory: 'OTHER' }))
      .toMatchObject({ serviceState: 'NOT_INITIALIZED', canInitialize: true })
    expect(hooks.dialog).not.toHaveBeenCalled()
  })
  it('does not accept a response after the trusted frame changes while native confirmation waits', async () => {
    hooks.defer = true
    const pending = invoke('recover', { kind: 'initialize' }) as Promise<unknown>
    expect(hooks.pending).not.toBeNull()
    window = null
    hooks.pending!({ response: 1 })
    await expect(pending).rejects.toThrow('UNAUTHORIZED')
    expect(service.getState().serviceState).toBe('NOT_INITIALIZED')
  })
  it('does not expose a generic UNKNOWN reset or honor raw evidence', async () => {
    const result = await invoke('execute', { action: 'resolveUnknown', mode: 'live' }) as MacThsResult
    expect(result.code).toBe('REVIEW_REQUIRED')
    const rejected = await invoke('execute', { action: 'submitLive', mode: 'live',
      accountDigest: '0'.repeat(64), claimed: true }) as MacThsResult
    expect(rejected.code).toBe('INVALID_REQUEST')
    expect(hooks.dialog).not.toHaveBeenCalled()
  })
  it('keeps status readable during confirmation and rejects a second write instead of queueing', async () => {
    hooks.defer = true
    const pending = invoke('recover', { kind: 'initialize' }) as Promise<MacThsProductState>
    expect((invoke('status') as MacThsProductState).canInitialize).toBe(false)
    await invoke('recover', { kind: 'initialize' })
    expect(hooks.dialog).toHaveBeenCalledTimes(1)
    hooks.pending!({ response: 0 })
    expect((await pending).serviceState).toBe('NOT_INITIALIZED')
  })
  it('runs a confirmed IPC order through the real service, store, adapter decoder and owned child', async () => {
    hooks.nativeEnabled = true
    await invoke('recover', { kind: 'initialize' })
    async function confirmed(request: MacThsRequest) {
      const offered = await invoke('execute', request) as MacThsResult
      expect(offered.code).toBe('CONFIRMATION_REQUIRED')
      expect(offered.confirmation).toMatchObject({ sessionId: service.sessionId })
      expect(offered.confirmation!.expiresAt).toBeGreaterThan(Date.now())
      return await invoke('execute', { ...request, confirmationToken: offered.confirmation!.token,
        ...(offered.confirmation!.intentBinding ? { intentBinding: offered.confirmation!.intentBinding } : {}) }) as MacThsResult
    }
    expect((await confirmed({ action: 'authorizeLive', mode: 'live', liveRiskAcknowledged: true })).code).toBe('LIVE_ENABLED')
    const requestId = randomUUID()
    const request: MacThsRequest = { action: 'submitLive', mode: 'live', requestId,
      order: { requestId, mode: 'live', side: 'buy', symbol: '600000', price: '10.00', quantity: 100, maxNotional: '1000.00' } }
    const result = await confirmed(request)
    expect(result.code).toBe('ACCEPTED_OBSERVED')
    expect((invoke('status') as MacThsProductState).intents[0]).toMatchObject({ requestId, state: 'ACCEPTED_OBSERVED' })
    expect((await invoke('execute', request) as MacThsResult).code).toBe('DUPLICATE_REQUEST')
    expect(hooks.dialog.mock.calls.every(call => call[1].defaultId === 0 && call[1].cancelId === 0)).toBe(true)
  })
  it('removes only its own listeners and handlers on unregistration', () => {
    unregister()
    const count = send.mock.calls.length
    service.revokeCaller(21)
    expect(send).toHaveBeenCalledTimes(count)
    expect(hooks.handlers.size).toBe(0)
  })
})
