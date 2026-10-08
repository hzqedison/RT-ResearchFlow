import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import type { FileHandle } from 'node:fs/promises'

const m = vi.hoisted(() => ({
  directory: '',
  bytes: Buffer.from('isolated verified installer bytes'),
  fileName: 'RT-ResearchFlow-Setup-1.2.0-x64.exe',
  fetch: vi.fn(),
  beforeOpen: vi.fn(),
  decorateHandle: vi.fn(),
  beforeLink: vi.fn(),
  space: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '1.1.0', getPath: () => m.directory },
  net: { fetch: m.fetch },
}))
vi.mock('electron-store', () => ({
  default: class {
    get() { return m.directory }
    set(_key: string, value: string) { m.directory = value }
  },
}))
vi.mock('../../electron/shared/appReleasePolicy', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../electron/shared/appReleasePolicy')>(),
  installerFileName: () => m.fileName,
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    copyFile: vi.fn(() => { throw new Error('Final copy must never be used') }),
    open: async (path: string, flags: string, mode: number) => {
      await m.beforeOpen(path)
      const handle = await real.open(path, flags, mode)
      m.decorateHandle(handle)
      return handle
    },
    link: async (from: string, to: string) => {
      await m.beforeLink(from, to)
      return real.link(from, to)
    },
    statfs: m.space,
  }
})

const tempBase = resolve('.cache/test-temp')
const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
let service: typeof import('../../electron/main/services/githubReleaseUpdateService')
function hash(bytes = m.bytes) { return createHash('sha256').update(bytes).digest('hex') }
function errno(code: string) { return Object.assign(new Error('isolated filesystem failure'), { code }) }
function installerResponse(bytes = m.bytes) { return new Response(new Uint8Array(bytes)) }
async function parts() { return (await real.readdir(m.directory)).filter(name => name.endsWith('.part')) }
async function assertReady(name: string) {
  const path = join(m.directory, name)
  expect(await real.readFile(path)).toEqual(m.bytes)
  expect(service.getVerifiedAppInstaller()).toBe(path)
}

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  await real.mkdir(tempBase, { recursive: true })
  m.directory = await real.mkdtemp(join(tempBase, 'updater-'))
  m.space.mockResolvedValue({ bavail: 1024 * 1024, bsize: 4096 })
  m.fetch.mockImplementation((url: string) => {
    if (url.startsWith('https://api.github.com/')) {
      return Promise.resolve(new Response(JSON.stringify([{
        draft: false, prerelease: false, tag_name: 'v1.2.0', published_at: null, body: '',
        assets: [{
          name: m.fileName, size: m.bytes.length, digest: 'sha256:' + hash(),
          browser_download_url: 'https://github.com/hzqedison/RT-ResearchFlow/releases/download/v1.2.0/' + m.fileName,
        }],
      }])))
    }
    return Promise.resolve(installerResponse())
  })
  service = await import('../../electron/main/services/githubReleaseUpdateService')
  expect((await service.checkAppRelease(false)).state).toBe('available')
  m.fetch.mockClear()
})
afterEach(async () => {
  service.cancelAppUpdateDownload()
  vi.useRealTimers()
  vi.restoreAllMocks()
  const target = resolve(m.directory)
  if (!target.startsWith(tempBase + sep)) throw new Error('Test cleanup outside workspace cache refused')
  await real.rm(target, { recursive: true, force: true })
})

describe('verified installer publication and retry ownership', () => {
  it('publishes verified bytes atomically and removes its owned temporary name', async () => {
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    expect(result).toMatchObject({ fileName: m.fileName, sha256: hash(), reused: false })
    await assertReady(result.fileName)
    expect(await parts()).toEqual([])
    expect(m.beforeLink).toHaveBeenCalledTimes(1)
  })

  it('reuses an existing verified installer without fetching or publishing again', async () => {
    await real.writeFile(join(m.directory, m.fileName), m.bytes)
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    expect(result.reused).toBe(true)
    expect(m.fetch).not.toHaveBeenCalled()
    expect(m.beforeLink).not.toHaveBeenCalled()
    await assertReady(result.fileName)
  })

  it('recovers from old partial final files using a fresh name without overwriting them', async () => {
    const partial = Buffer.from('old interrupted copy')
    await real.writeFile(join(m.directory, m.fileName), partial)
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    expect(result.fileName).not.toBe(m.fileName)
    expect(result.fileName.endsWith('.exe')).toBe(true)
    expect(await real.readFile(join(m.directory, m.fileName))).toEqual(partial)
    await assertReady(result.fileName)
  })

  it('preserves an unrelated directory with the installer name', async () => {
    await real.mkdir(join(m.directory, m.fileName))
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    expect((await real.lstat(join(m.directory, m.fileName))).isDirectory()).toBe(true)
    await assertReady(result.fileName)
  })

  it('a failed publication leaves no partial final and a subsequent retry succeeds', async () => {
    m.beforeLink.mockRejectedValueOnce(errno('ENOSPC'))
    await expect(service.downloadAppInstaller('1.2.0', vi.fn())).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' })
    expect(service.getVerifiedAppInstaller()).toBeNull()
    expect(await real.readdir(m.directory)).toEqual([])
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    await assertReady(result.fileName)
  })

  it('unknown files created during publication races are preserved and retried under another name', async () => {
    m.beforeLink.mockImplementationOnce(async (_from: string, to: string) => {
      await real.writeFile(to, 'unrelated race winner')
    })
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    expect(await real.readFile(join(m.directory, m.fileName), 'utf8')).toBe('unrelated race winner')
    expect(m.beforeLink).toHaveBeenCalledTimes(2)
    await assertReady(result.fileName)
  })

  it('can reuse a racing target only after size and SHA validation', async () => {
    m.beforeLink.mockImplementationOnce(async (_from: string, to: string) => {
      await real.writeFile(to, m.bytes)
    })
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    expect(result.reused).toBe(true)
    await assertReady(result.fileName)
  })

  it('uncertain publication failure never marks ready; retry verifies the fully published file', async () => {
    m.beforeLink.mockImplementationOnce(async (from: string, to: string) => {
      await real.link(from, to)
      throw errno('EIO')
    })
    await expect(service.downloadAppInstaller('1.2.0', vi.fn())).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' })
    expect(service.getVerifiedAppInstaller()).toBeNull()
    expect(await real.readFile(join(m.directory, m.fileName))).toEqual(m.bytes)
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    expect(result.reused).toBe(true)
    await assertReady(result.fileName)
  })

  it('never deletes a foreign temporary file when exclusive creation fails', async () => {
    let collision = ''
    m.beforeOpen.mockImplementationOnce(async (path: string) => {
      collision = path
      await real.writeFile(path, 'foreign temporary file')
    })
    await expect(service.downloadAppInstaller('1.2.0', vi.fn())).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' })
    expect(await real.readFile(collision, 'utf8')).toBe('foreign temporary file')
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    expect(await real.readFile(collision, 'utf8')).toBe('foreign temporary file')
    await assertReady(result.fileName)
  })

  it('does not trust substituted temporary bytes or delete the replacement', async () => {
    let replacement = ''
    m.beforeLink.mockImplementationOnce(async (from: string) => {
      await real.rename(from, from + '.original')
      await real.writeFile(from, 'foreign replacement')
      replacement = from
    })
    await expect(service.downloadAppInstaller('1.2.0', vi.fn())).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' })
    expect(service.getVerifiedAppInstaller()).toBeNull()
    expect(await real.readFile(replacement, 'utf8')).toBe('foreign replacement')
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    expect(await real.readFile(replacement, 'utf8')).toBe('foreign replacement')
    await assertReady(result.fileName)
  })

  it('unsupported atomic filesystems fail explicitly without a copy fallback', async () => {
    m.beforeLink.mockRejectedValueOnce(errno('ENOTSUP'))
    await expect(service.downloadAppInstaller('1.2.0', vi.fn())).rejects.toMatchObject({ code: 'ATOMIC_SAVE_UNAVAILABLE' })
    expect(service.getVerifiedAppInstaller()).toBeNull()
    expect(await real.readdir(m.directory)).toEqual([])
  })

  it.each([
    ['oversized', () => Buffer.concat([m.bytes, Buffer.from('extra')]), 'SIZE_MISMATCH'],
    ['truncated', () => m.bytes.subarray(0, -1), 'CHECKSUM_MISMATCH'],
    ['incorrect hash', () => Buffer.alloc(m.bytes.length, 33), 'CHECKSUM_MISMATCH'],
  ] as const)('rejects %s installer data without publishing it', async (_name, bytes, code) => {
    m.fetch.mockResolvedValueOnce(installerResponse(bytes()))
    await expect(service.downloadAppInstaller('1.2.0', vi.fn())).rejects.toMatchObject({ code })
    expect(service.getVerifiedAppInstaller()).toBeNull()
    expect(m.beforeLink).not.toHaveBeenCalled()
    expect(await real.readdir(m.directory)).toEqual([])
  })

  it('cleans an owned file after a partial write fails and permits retry', async () => {
    m.decorateHandle.mockImplementationOnce((handle: FileHandle) => {
      const write = handle.write.bind(handle)
      vi.spyOn(handle, 'write').mockImplementationOnce(async (buffer, offset, length) => {
        await write(buffer, offset, Math.max(1, Math.floor(Number(length) / 2)))
        throw errno('ENOSPC')
      })
    })
    await expect(service.downloadAppInstaller('1.2.0', vi.fn())).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' })
    expect(await real.readdir(m.directory)).toEqual([])
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    await assertReady(result.fileName)
  })

  it('cancelling a completed stream prevents publication and allows retry', async () => {
    const phases: string[] = []
    await expect(service.downloadAppInstaller('1.2.0', progress => {
      phases.push(progress.phase)
      if (progress.phase === 'downloading' && progress.receivedBytes > 0) service.cancelAppUpdateDownload()
    })).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(phases).not.toContain('ready')
    expect(service.getVerifiedAppInstaller()).toBeNull()
    expect(await real.readdir(m.directory)).toEqual([])
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    await assertReady(result.fileName)
  })

  it('cancellation at publication never exposes a verified path; next retry can validate it', async () => {
    m.beforeLink.mockImplementationOnce(() => service.cancelAppUpdateDownload())
    await expect(service.downloadAppInstaller('1.2.0', vi.fn())).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(service.getVerifiedAppInstaller()).toBeNull()
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    expect(result.reused).toBe(true)
    await assertReady(result.fileName)
  })

  it('disk space failure performs no installer fetch and permits a later retry', async () => {
    m.space.mockResolvedValueOnce({ bavail: 0, bsize: 4096 })
    await expect(service.downloadAppInstaller('1.2.0', vi.fn())).rejects.toMatchObject({ code: 'DISK_SPACE' })
    expect(m.fetch).not.toHaveBeenCalled()
    const result = await service.downloadAppInstaller('1.2.0', vi.fn())
    await assertReady(result.fileName)
  })

  it('rejects redirects outside GitHub without writing an installer', async () => {
    m.fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://example.invalid/installer' } }))
    await expect(service.downloadAppInstaller('1.2.0', vi.fn())).rejects.toMatchObject({ code: 'UNTRUSTED_URL' })
    expect(await real.readdir(m.directory)).toEqual([])
    expect(service.getVerifiedAppInstaller()).toBeNull()
  })

  it('times out a waiting network request without trusting or retaining a partial installer', async () => {
    vi.useFakeTimers()
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    m.fetch.mockImplementationOnce((_url, options: { signal: AbortSignal }) => {
      entered()
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('isolated aborted request')), { once: true })
      })
    })
    const download = service.downloadAppInstaller('1.2.0', vi.fn())
    const assertion = expect(download).rejects.toMatchObject({ code: 'TIMEOUT' })
    await started
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    await assertion
    expect(service.getVerifiedAppInstaller()).toBeNull()
    expect(await real.readdir(m.directory)).toEqual([])
  })
})
