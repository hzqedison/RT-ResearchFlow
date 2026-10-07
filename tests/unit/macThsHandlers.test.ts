import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { MacThsRequest, MacThsResult } from '../../electron/shared/macThsTypes'

type Handler = (event: IpcMainInvokeEvent, request: MacThsRequest) => Promise<MacThsResult>
const hooks = vi.hoisted(() => ({
  directory: '', handler: undefined as Handler | undefined, nativeOutput: 'READY', humanResponse: 1,
  trusted: true, execute: vi.fn(), review: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => hooks.directory },
  ipcMain: { handle: (_name: string, handler: Handler) => { hooks.handler = handler } },
  systemPreferences: { isTrustedAccessibilityClient: () => hooks.trusted },
  dialog: { showMessageBox: (...args: unknown[]) => {
    hooks.review(...args)
    return Promise.resolve({ response: hooks.humanResponse, checkboxChecked: false })
  } },
}))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFile: (...args: unknown[]) => {
    hooks.execute(...args.slice(0, 3))
    const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void
    callback(null, hooks.nativeOutput, '')
  } }
})
import { registerMacThsHandlers } from '../../electron/main/ipc/macThsHandlers'

const frame = {}
const sender = { id: 1, mainFrame: frame }
const window = { isDestroyed: () => false, webContents: sender } as unknown as BrowserWindow
const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent
const order = { requestId: '00000000-0000-4000-8000-000000000001', mode: 'live' as const,
  side: 'buy' as const, symbol: '600000', price: '10.00', quantity: 100, maxNotional: '1000.00' }
let descriptor: PropertyDescriptor
let directory: string
async function invoke(request: MacThsRequest) { return hooks.handler!(event, request) }
async function confirm(request: MacThsRequest) {
  const offered = await invoke(request)
  expect(offered.code).toBe('CONFIRMATION_REQUIRED')
  return invoke({ ...request, confirmationToken: offered.confirmation!.token })
}
async function enable() {
  hooks.nativeOutput = 'READY'
  expect((await confirm({ action: 'authorizeLive', mode: 'live', liveRiskAcknowledged: true })).code).toBe('LIVE_ENABLED')
}
describe('isolated real-trade IPC: no broker or real orders', () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rt-ths-handler-test-'))
    hooks.directory = directory
    hooks.nativeOutput = 'READY'
    hooks.humanResponse = 1
    hooks.trusted = true
    hooks.execute.mockClear()
    hooks.review.mockClear()
    descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { ...descriptor, value: 'darwin' })
    registerMacThsHandlers(() => window)
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', descriptor)
    rmSync(directory, { recursive: true, force: true })
  })
  it('cannot trade from registration, without session opt-in or from another sender', async () => {
    expect((await invoke({ action: 'submitLive', mode: 'live', order })).code).toBe('LIVE_NOT_ENABLED')
    expect((await invoke({ action: 'authorizeLive', mode: 'live', liveRiskAcknowledged: false })).code).toBe('INVALID_ORDER')
    const foreign = { sender: {}, senderFrame: frame } as unknown as IpcMainInvokeEvent
    expect((await hooks.handler!(foreign, { action: 'probe', mode: 'live' })).code).toBe('INVALID_ORDER')
    expect(hooks.execute).not.toHaveBeenCalled()
    expect(hooks.review).not.toHaveBeenCalled()
  })
  it('requires a native human confirmation with Cancel as default', async () => {
    await enable()
    const before = hooks.execute.mock.calls.length
    const offered = await invoke({ action: 'submitLive', mode: 'live', order })
    expect(offered.code).toBe('CONFIRMATION_REQUIRED')
    expect(hooks.execute.mock.calls.length).toBe(before)
    hooks.humanResponse = 0
    const cancelled = await invoke({ action: 'submitLive', mode: 'live', order, confirmationToken: offered.confirmation!.token })
    expect(cancelled.code).toBe('USER_CANCELLED')
    expect(hooks.review).toHaveBeenCalledWith(window, expect.objectContaining({ defaultId: 0, cancelId: 0 }))
    expect(hooks.execute.mock.calls.length).toBe(before)
  })
  it('binds a one-use ticket to exact parameters and supports cancelling the review', async () => {
    await enable()
    const offered = await invoke({ action: 'submitLive', mode: 'live', order })
    const changed = await invoke({ action: 'submitLive', mode: 'live',
      order: { ...order, price: '9.00' }, confirmationToken: offered.confirmation!.token })
    expect(changed.code).toBe('CONFIRMATION_EXPIRED')
    const next = await invoke({ action: 'submitLive', mode: 'live', order })
    expect((await invoke({ action: 'dismissConfirmation', mode: 'live' })).code).toBe('USER_CANCELLED')
    expect((await invoke({ action: 'submitLive', mode: 'live', order, confirmationToken: next.confirmation!.token })).code).toBe('CONFIRMATION_EXPIRED')
    expect(hooks.review).not.toHaveBeenCalled()
  })
  it('does not replay an accepted real request and reset never grants a live session', async () => {
    await enable()
    hooks.nativeOutput = 'LIVE_ACCEPTED|TEST123'
    const accepted = await confirm({ action: 'submitLive', mode: 'live', order })
    expect(accepted.code).toBe('LIVE_ACCEPTED')
    expect(accepted.contractNo).toBe('TEST123')
    expect(accepted.unknownPending).toBe(false)
    expect((await invoke({ action: 'submitLive', mode: 'live', order })).code).toBe('DUPLICATE_REQUEST')
    registerMacThsHandlers(() => window)
    expect((await invoke({ action: 'submitLive', mode: 'live', order })).code).toBe('LIVE_NOT_ENABLED')
  })
  it('native broker confirmation or a missing receipt locks new requests across restart', async () => {
    await enable()
    hooks.nativeOutput = 'NATIVE_CONFIRMATION_REQUIRED'
    expect((await confirm({ action: 'submitLive', mode: 'live', order })).unknownPending).toBe(true)
    expect((await invoke({ action: 'submitLive', mode: 'live',
      order: { ...order, requestId: '00000000-0000-4000-8000-000000000002' } })).code).toBe('UNKNOWN_PENDING')
    registerMacThsHandlers(() => window)
    await enable()
    expect((await invoke({ action: 'submitLive', mode: 'live',
      order: { ...order, requestId: '00000000-0000-4000-8000-000000000003' } })).code).toBe('UNKNOWN_PENDING')
  })
  it('only permits exact real cancellation after session opt-in and native review', async () => {
    await enable()
    expect((await invoke({ action: 'cancelLive', mode: 'live', requestId: order.requestId, contractNo: 'bad" code' })).code).toBe('INVALID_ORDER')
    hooks.nativeOutput = 'LIVE_CANCELLED'
    expect((await confirm({ action: 'cancelLive', mode: 'live', requestId: order.requestId, contractNo: 'TEST123' })).code).toBe('LIVE_CANCELLED')
    expect(hooks.review).toHaveBeenCalledTimes(1)
  })
})
