import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SaveDialogReturnValue } from 'electron'
import {
  SUPPORT_PREVIEW_TTL_MS, isValidCorrelationId, type SupportDiagnosticPreview
} from '../../electron/shared/supportDiagnostics'

vi.mock('electron', () => ({
  app: { getVersion: () => '1.1.0', getPath: () => { throw new Error('Real userData must never be accessed in tests') } },
  dialog: { showSaveDialog: vi.fn() }
}))

import {
  createSupportDiagnosticsService, recordSupportFailure
} from '../../electron/main/services/supportDiagnosticsService'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

async function fixture(overrides: Partial<Parameters<typeof createSupportDiagnosticsService>[0]> = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'rt-support-diagnostic-'))
  directories.push(directory)
  const destination = join(directory, 'feedback.json')
  let time = Date.parse('2026-10-08T02:00:00.000Z')
  const dialog = vi.fn(async (): Promise<SaveDialogReturnValue> => ({ canceled: false, filePath: destination }))
  const getPath = vi.fn(() => directory)
  const service = createSupportDiagnosticsService({
    app: { getVersion: () => '1.1.0', getPath },
    platform: 'darwin', arch: 'arm64', now: () => time,
    showSaveDialog: dialog, files: fs, ...overrides
  })
  return { service, directory, destination, dialog, getPath, advance: (milliseconds: number) => { time += milliseconds } }
}

function preview(service: ReturnType<typeof createSupportDiagnosticsService>): SupportDiagnosticPreview {
  const result = service.generatePreview()
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected a valid preview')
  return result.value
}

describe('support diagnostic service', () => {
  it('exports the stable main-process recording API with fresh UUID v4 identifiers', () => {
    const first = recordSupportFailure('DATABASE_UNAVAILABLE', 'runtime')
    const second = recordSupportFailure('INTERNAL_ERROR', 'runtime')
    expect(isValidCorrelationId(first.correlationId)).toBe(true)
    expect(second.correlationId).not.toBe(first.correlationId)
    expect(Object.isFrozen(first)).toBe(true)
  })

  it('retains only the most recent 64 safe events and makes immutable independent previews', async () => {
    const { service } = await fixture()
    const errors = Array.from({ length: 70 }, () => service.recordSupportFailure('NETWORK_FAILED', 'data'))
    const snapshot = preview(service)
    expect(snapshot.package.errorEvents.map(event => event.id)).toEqual(errors.slice(-64).map(error => error.correlationId))
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.package)).toBe(true)
    expect(Object.isFrozen(snapshot.package.errorEvents[0])).toBe(true)
    service.recordSupportFailure('DATA_MISSING', 'research')
    expect(snapshot.package.errorEvents).toHaveLength(64)
    expect(snapshot.json).toBe(JSON.stringify(snapshot.package, null, 2))
    expect(snapshot.package.app).toEqual({ version: '1.1.0', buildId: 'unknown' })
    expect(snapshot.package.capabilities).toEqual([])
  })

  it('saves exactly the data previewed even after subsequent failures are recorded', async () => {
    const { service, destination, dialog, getPath, directory } = await fixture()
    service.recordSupportFailure('DATA_MISSING', 'data')
    const snapshot = preview(service)
    service.recordSupportFailure('NETWORK_FAILED', 'research')
    const result = await service.savePreview(snapshot.previewId)
    expect(result).toMatchObject({ ok: true, value: { status: 'saved' } })
    expect(await fs.readFile(destination, 'utf8')).toBe(snapshot.json)
    expect(JSON.parse(await fs.readFile(destination, 'utf8'))).toEqual(snapshot.package)
    expect(getPath).toHaveBeenCalledWith('userData')
    expect(dialog.mock.calls[0]?.length).toBe(1)
    const options = (dialog.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]
    expect(options.defaultPath).toBe(join(directory, 'RT-ResearchFlow-feedback.json'))
    expect(await fs.readdir(directory)).toEqual(['feedback.json'])
  })

  it('rejects replaced previews and arbitrary valid identifiers before opening any dialog', async () => {
    const { service, dialog } = await fixture()
    const old = preview(service)
    const latest = preview(service)
    expect(await service.savePreview(old.previewId)).toMatchObject({ ok: false, status: 'expired' })
    expect(await service.savePreview(randomUUID())).toMatchObject({ ok: false, status: 'expired' })
    expect(dialog).not.toHaveBeenCalled()
    expect(await service.savePreview(latest.previewId)).toMatchObject({ ok: true })
  })

  it('rejects expired previews at the exact TTL boundary', async () => {
    const { service, dialog, advance } = await fixture()
    const snapshot = preview(service)
    advance(SUPPORT_PREVIEW_TTL_MS)
    expect(await service.savePreview(snapshot.previewId)).toMatchObject({ ok: false, status: 'expired' })
    expect(dialog).not.toHaveBeenCalled()
  })

  it('revalidates TTL after the dialog and leaves the selected original file intact', async () => {
    const value = await fixture()
    await fs.writeFile(value.destination, 'original-content')
    value.dialog.mockImplementation(async () => {
      value.advance(SUPPORT_PREVIEW_TTL_MS)
      return { canceled: false, filePath: value.destination }
    })
    expect(await value.service.savePreview(preview(value.service).previewId)).toMatchObject({ ok: false, status: 'expired' })
    expect(await fs.readFile(value.destination, 'utf8')).toBe('original-content')
    expect(await fs.readdir(value.directory)).toEqual(['feedback.json'])
  })

  it('reports cancellation without creating a file and allows a subsequent save', async () => {
    const { service, dialog, directory } = await fixture()
    const snapshot = preview(service)
    dialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    expect(await service.savePreview(snapshot.previewId)).toMatchObject({ ok: true, value: { status: 'cancelled' } })
    expect(await fs.readdir(directory)).toEqual([])
    expect(await service.savePreview(snapshot.previewId)).toMatchObject({ ok: true, value: { status: 'saved' } })
  })

  it('rejects renderer paths, JSON, objects and getters without reading them', async () => {
    const { service, dialog } = await fixture()
    preview(service)
    let reads = 0
    const object = Object.defineProperty({}, 'previewId', { get: () => { reads++; throw new Error('sk-secret') } })
    for (const input of [null, undefined, object, {}, [], 'C:\\Users\\private\\feedback.json', '{"key":"sk-secret"}', 'x'.repeat(100000)]) {
      const result = await service.savePreview(input)
      expect(result).toMatchObject({ ok: false, status: 'invalid' })
      expect(JSON.stringify(result)).not.toContain('sk-secret')
    }
    expect(reads).toBe(0)
    expect(dialog).not.toHaveBeenCalled()
  })

  it('contains no credentials, account details, raw errors or local paths in the payload or responses', async () => {
    const { service, destination, directory } = await fixture()
    const unsafe = { apiKey: 'sk-secret', account: 'broker-private', path: 'C:/Users/private/config', rawError: new Error('secret-balance=123456') }
    service.recordSupportFailure(unsafe as never, unsafe as never)
    const snapshot = preview(service)
    const result = await service.savePreview(snapshot.previewId)
    const json = await fs.readFile(destination, 'utf8')
    for (const secret of ['sk-secret', 'broker-private', 'secret-balance', '123456', 'C:/Users/private', directory]) {
      expect(json).not.toContain(secret)
      expect(JSON.stringify(result)).not.toContain(secret)
      expect(JSON.stringify(snapshot)).not.toContain(secret)
    }
    expect(snapshot.package.errorEvents[0]).toMatchObject({ code: 'INTERNAL_ERROR', module: 'runtime' })
  })

  it.each(['write', 'flush', 'rename'])('cleans its temporary file on %s failure without destroying the original', async stage => {
    const value = await fixture({
      files: {
        ...fs,
        open: async (...args: Parameters<typeof fs.open>) => {
          const handle = await fs.open(...args)
          return {
            writeFile: async (...writeArgs: Parameters<typeof handle.writeFile>) => {
              if (stage === 'write') {
                await handle.writeFile('partial')
                throw new Error('sk-private-write ' + String(args[0]))
              }
              return handle.writeFile(...writeArgs)
            },
            sync: async () => {
              if (stage === 'flush') throw new Error('private-sync-error')
              return handle.sync()
            },
            close: () => handle.close()
          } as Awaited<ReturnType<typeof fs.open>>
        },
        rename: async (...args: Parameters<typeof fs.rename>) => {
          if (stage === 'rename') throw new Error('private-rename-error')
          return fs.rename(...args)
        }
      }
    })
    await fs.writeFile(value.destination, 'original-content')
    const result = await value.service.savePreview(preview(value.service).previewId)
    expect(result).toMatchObject({ ok: false, status: 'failed' })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(await fs.readFile(value.destination, 'utf8')).toBe('original-content')
    expect(await fs.readdir(value.directory)).toEqual(['feedback.json'])
  })

  it('creates no partial final file when writing a new feedback file fails', async () => {
    const { service, directory } = await fixture({
      files: {
        ...fs,
        rename: async () => { throw new Error('private-path') }
      }
    })
    expect(await service.savePreview(preview(service).previewId)).toMatchObject({ ok: false, status: 'failed' })
    expect(await fs.readdir(directory)).toEqual([])
  })

  it('never deletes a temporary file it failed to create exclusively', async () => {
    const unlink = vi.fn()
    const { service } = await fixture({
      files: {
        ...fs, unlink,
        open: async () => { throw new Error('EEXIST') }
      }
    })
    expect(await service.savePreview(preview(service).previewId)).toMatchObject({ ok: false, status: 'failed' })
    expect(unlink).not.toHaveBeenCalled()
  })

  it('blocks duplicate saves and preview replacement while the dialog is open', async () => {
    const { service, dialog, destination } = await fixture()
    let resolve: (choice: SaveDialogReturnValue) => void = () => { throw new Error('Dialog not started') }
    dialog.mockImplementation(() => new Promise(done => { resolve = done }))
    const snapshot = preview(service)
    const pending = service.savePreview(snapshot.previewId)
    expect(await service.savePreview(snapshot.previewId)).toMatchObject({ ok: false, status: 'busy' })
    expect(service.generatePreview()).toMatchObject({ ok: false, status: 'busy' })
    expect(dialog).toHaveBeenCalledTimes(1)
    resolve({ canceled: false, filePath: destination })
    expect(await pending).toMatchObject({ ok: true, value: { status: 'saved' } })
    expect(await fs.readFile(destination, 'utf8')).toBe(snapshot.json)
  })

  it('atomically replaces an existing user-selected file with exactly the preview', async () => {
    const { service, destination, directory } = await fixture()
    await fs.writeFile(destination, 'original-content')
    const snapshot = preview(service)
    expect(await service.savePreview(snapshot.previewId)).toMatchObject({ ok: true, value: { status: 'saved' } })
    expect(await fs.readFile(destination, 'utf8')).toBe(snapshot.json)
    expect(await fs.readdir(directory)).toEqual(['feedback.json'])
  })

  it('cleans a completed temporary write if the preview expires before commit', async () => {
    const value = await fixture()
    const service = createSupportDiagnosticsService({
      app: { getVersion: () => '1.1.0', getPath: () => value.directory },
      platform: 'win32', arch: 'x64', now: () => Date.now(),
      showSaveDialog: value.dialog,
      files: {
        ...fs,
        open: async (...args: Parameters<typeof fs.open>) => {
          const handle = await fs.open(...args)
          return {
            writeFile: (...writeArgs: Parameters<typeof handle.writeFile>) => handle.writeFile(...writeArgs),
            sync: async () => { await handle.sync(); vi.setSystemTime(new Date(Date.now() + SUPPORT_PREVIEW_TTL_MS)) },
            close: () => handle.close()
          } as Awaited<ReturnType<typeof fs.open>>
        }
      }
    })
    vi.useFakeTimers()
    try {
      await fs.writeFile(value.destination, 'original-content')
      expect(await service.savePreview(preview(service).previewId)).toMatchObject({ ok: false, status: 'expired' })
      expect(await fs.readFile(value.destination, 'utf8')).toBe('original-content')
      expect(await fs.readdir(value.directory)).toEqual(['feedback.json'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('contains failures of version lookup and save dialog without exposing exceptions or retaining a stale preview', async () => {
    let broken = false
    const value = await fixture({
      app: { getVersion: () => { if (broken) throw new Error('sk-private'); return '1.1.0' }, getPath: () => '/fake/location' }
    })
    const old = preview(value.service)
    broken = true
    expect(value.service.generatePreview()).toMatchObject({ ok: false, status: 'failed' })
    expect(await value.service.savePreview(old.previewId)).toMatchObject({ ok: false, status: 'expired' })
    broken = false
    value.dialog.mockRejectedValueOnce(new Error('broker-private'))
    const result = await value.service.savePreview(preview(value.service).previewId)
    expect(result).toMatchObject({ ok: false, status: 'failed' })
    expect(JSON.stringify(result)).not.toContain('broker-private')
    expect(value.service.generatePreview().ok).toBe(true)
  })
})
