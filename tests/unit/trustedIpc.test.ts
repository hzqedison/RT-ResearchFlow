import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
}))
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))

import {
  isTrustedIpcSender,
  registerTrustedIpcHandler,
} from '../../electron/main/security/trustedIpc'

function fixture() {
  const frame = {}
  const contents = { isDestroyed: vi.fn(() => false), mainFrame: frame }
  const window = { isDestroyed: vi.fn(() => false), webContents: contents }
  const event = { sender: contents, senderFrame: frame }
  return { window, contents, frame, event }
}
function asEvent(value: unknown): IpcMainInvokeEvent {
  return value as IpcMainInvokeEvent
}
function asWindow(value: unknown): BrowserWindow {
  return value as BrowserWindow
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.handle.mockImplementation((channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    mocks.handlers.set(channel, handler)
  })
})

describe('trusted IPC sender identity', () => {
  it('accepts only the live current window main frame', () => {
    const f = fixture()
    expect(isTrustedIpcSender(asEvent(f.event), () => asWindow(f.window))).toBe(true)
  })

  it.each([
    'missing window', 'destroyed window', 'missing contents', 'other sender',
    'destroyed sender', 'missing sender', 'child frame', 'missing sender frame',
    'missing main frame', 'null event',
  ])('rejects %s', (kind) => {
    const f = fixture()
    let window: unknown = f.window
    let event: unknown = f.event
    switch (kind) {
      case 'missing window': window = null; break
      case 'destroyed window': f.window.isDestroyed.mockReturnValue(true); break
      case 'missing contents': window = { isDestroyed: () => false, webContents: null }; break
      case 'other sender': event = { ...f.event, sender: fixture().contents }; break
      case 'destroyed sender': f.contents.isDestroyed.mockReturnValue(true); break
      case 'missing sender': event = { ...f.event, sender: null }; break
      case 'child frame': event = { ...f.event, senderFrame: {} }; break
      case 'missing sender frame': event = { ...f.event, senderFrame: null }; break
      case 'missing main frame': Object.defineProperty(f.contents, 'mainFrame', { value: null }); break
      case 'null event': event = null; break
    }
    expect(isTrustedIpcSender(asEvent(event), () => window as BrowserWindow | null)).toBe(false)
  })

  it.each([
    'getWindow', 'window.isDestroyed', 'window.webContents', 'event.sender',
    'sender.isDestroyed', 'event.senderFrame', 'contents.mainFrame',
  ])('fails closed when %s throws', (kind) => {
    const f = fixture()
    const fail = () => { throw new Error('private native detail') }
    let getWindow = () => asWindow(f.window)
    switch (kind) {
      case 'getWindow': getWindow = fail; break
      case 'window.isDestroyed': f.window.isDestroyed.mockImplementation(fail); break
      case 'window.webContents': Object.defineProperty(f.window, 'webContents', { get: fail }); break
      case 'event.sender': Object.defineProperty(f.event, 'sender', { get: fail }); break
      case 'sender.isDestroyed': f.contents.isDestroyed.mockImplementation(fail); break
      case 'event.senderFrame': Object.defineProperty(f.event, 'senderFrame', { get: fail }); break
      case 'contents.mainFrame': Object.defineProperty(f.contents, 'mainFrame', { get: fail }); break
    }
    expect(isTrustedIpcSender(asEvent(f.event), getWindow)).toBe(false)
  })

  it('reads sender identity once instead of accepting a changing accessor', () => {
    const f = fixture()
    const senderGetter = vi.fn().mockReturnValueOnce(f.contents).mockReturnValue(fixture().contents)
    Object.defineProperty(f.event, 'sender', { get: senderGetter })
    expect(isTrustedIpcSender(asEvent(f.event), () => asWindow(f.window))).toBe(true)
    expect(senderGetter).toHaveBeenCalledTimes(1)
  })
})

describe('trusted IPC handler registration', () => {
  it('forwards the original event and arguments and preserves synchronous results', () => {
    const f = fixture()
    const result = { ok: true, data: 'local fixture' }
    const business = vi.fn(() => result)
    registerTrustedIpcHandler('offline:sync', () => asWindow(f.window), business)
    const payload = { id: 7 }
    expect(mocks.handlers.get('offline:sync')!(asEvent(f.event), payload, 3)).toBe(result)
    expect(business).toHaveBeenCalledWith(f.event, payload, 3)
    expect(mocks.handle).toHaveBeenCalledTimes(1)
  })

  it('preserves promise results and business rejection', async () => {
    const f = fixture()
    const result = { ok: true }
    const business = vi.fn().mockResolvedValueOnce(result).mockRejectedValueOnce(new Error('business failure'))
    registerTrustedIpcHandler('offline:async', () => asWindow(f.window), business)
    const handler = mocks.handlers.get('offline:async')!
    await expect(handler(asEvent(f.event))).resolves.toBe(result)
    await expect(handler(asEvent(f.event))).rejects.toThrow('business failure')
  })

  it('preserves synchronous business exceptions', () => {
    const f = fixture()
    const error = new Error('business failure')
    registerTrustedIpcHandler('offline:throws', () => asWindow(f.window), () => { throw error })
    expect(() => mocks.handlers.get('offline:throws')!(asEvent(f.event))).toThrow(error)
  })

  it('rejects before reading arguments or calling the business handler', () => {
    const f = fixture()
    const business = vi.fn()
    const payload = Object.defineProperty({}, 'secret', { get: () => { throw new Error('payload inspected') } })
    registerTrustedIpcHandler('offline:denied', () => asWindow(f.window), business)
    expect(() => mocks.handlers.get('offline:denied')!(asEvent({ ...f.event, senderFrame: {} }), payload))
      .toThrow('UNTRUSTED_IPC_SENDER')
    expect(business).not.toHaveBeenCalled()
  })

  it('uses the dynamic current window after destruction and recreation', () => {
    const first = fixture()
    const second = fixture()
    let current: BrowserWindow | null = asWindow(first.window)
    const business = vi.fn(() => ({ ok: true }))
    registerTrustedIpcHandler('offline:recreated', () => current, business)
    const handler = mocks.handlers.get('offline:recreated')!
    expect(handler(asEvent(first.event))).toEqual({ ok: true })
    first.window.isDestroyed.mockReturnValue(true)
    current = null
    expect(() => handler(asEvent(first.event))).toThrow('UNTRUSTED_IPC_SENDER')
    current = asWindow(second.window)
    expect(() => handler(asEvent(first.event))).toThrow('UNTRUSTED_IPC_SENDER')
    expect(handler(asEvent(second.event))).toEqual({ ok: true })
    expect(business).toHaveBeenCalledTimes(2)
  })

  it('rejects when navigation replaces the previous main frame', () => {
    const f = fixture()
    const oldEvent = { ...f.event }
    registerTrustedIpcHandler('offline:navigation', () => asWindow(f.window), vi.fn())
    const nextFrame = {}
    f.contents.mainFrame = nextFrame
    const handler = mocks.handlers.get('offline:navigation')!
    expect(() => handler(asEvent(oldEvent))).toThrow('UNTRUSTED_IPC_SENDER')
    expect(handler(asEvent({ sender: f.contents, senderFrame: nextFrame }))).toBeUndefined()
  })
})
