import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
const { handles } = vi.hoisted(() => ({ handles: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (key: string, fn: (...args: unknown[]) => unknown) => handles.set(key, fn), removeHandler: (key: string) => handles.delete(key) } }))
import { registerAccountLedgerHandlers } from '../../electron/main/ipc/accountLedgerHandlers'
describe('account ledger trusted IPC boundary', () => {
  afterEach(() => handles.clear())
  function setup() {
    const db = new Database(':memory:'), frame = {}, sender = { mainFrame: frame, isDestroyed: () => false }
    const getDb = vi.fn(() => db), window = { webContents: sender, isDestroyed: () => false }
    const unregister = registerAccountLedgerHandlers(() => window as never, getDb)
    return { db, getDb, frame, sender, unregister, event: { sender, senderFrame: frame } }
  }
  it('rejects foreign and child frames before opening the database', () => {
    const f = setup()
    try { for (const e of [{ sender: { isDestroyed: () => false }, senderFrame: f.frame }, { sender: f.sender, senderFrame: {} }, { sender: f.sender, senderFrame: null }]) {
      expect(handles.get('accountLedger:list')!(e, undefined)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' })
    }; expect(f.getDb).not.toHaveBeenCalled() } finally { f.db.close() }
  })
  it('validates payloads before database calls and does not expose arbitrary invocation', () => {
    const f = setup()
    try { expect(handles.size).toBe(5); expect(handles.get('accountLedger:create')!(f.event, { openingCash: 'secret' })).toMatchObject({ ok: false, code: 'INVALID_INPUT' }); expect(f.getDb).not.toHaveBeenCalled(); f.unregister(); expect(handles.size).toBe(0) } finally { f.db.close() }
  })
  it('uses the real repository and returns stable public storage errors without raw exceptions', () => {
    const f = setup(), id = randomUUID()
    try {
      expect(handles.get('accountLedger:create')!(f.event, { accountId: id, label: '隔离', openingCash: '0', openingAt: Date.now() - 1000, openingPositions: [], openingPositionsComplete: true, cashConfirmed: true })).toMatchObject({ ok: true, data: { cashBalance: '0.00', brokerVerified: false } })
      f.db.close()
      const result = handles.get('accountLedger:get')!(f.event, id)
      expect(result).toMatchObject({ ok: false, code: 'STORAGE_UNAVAILABLE' }); expect(JSON.stringify(result)).not.toMatch(/sqlite|closed database|secret/i)
    } finally { if (f.db.open) f.db.close() }
  })
})
