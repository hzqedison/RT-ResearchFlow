import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extensionInstallProgress, installOnDemandExtensions, selectedExtensionProviders } from '../../electron/main/services/onDemandDataExtensions'
import { prepareProductPython } from '../../electron/main/services/productPythonRuntime'

// This unit suite covers extension installation after private-runtime preparation.
// Runtime copying/downloads have separate unit and real packaged-native acceptance.
vi.mock('../../electron/main/services/productPythonRuntime', () => ({
  prepareProductPython: vi.fn(async () => 'product-private-python'),
}))

const config = { dailyProviders: ['akshare' as const], reportProviders: [], wencaiEnabled: false, pythonPath: '' }

describe('explicit online extension installation', () => {
  beforeEach(() => vi.clearAllMocks())
  it('does not create an extension or download packages when private preparation fails', async () => {
    vi.mocked(prepareProductPython).mockRejectedValueOnce(Error('PRODUCT_PYTHON_UNSUPPORTED'))
    const run = vi.fn()
    await expect(installOnDemandExtensions(config, 'python', tmpdir(), run)).rejects.toThrow('PRODUCT_PYTHON_UNSUPPORTED')
    expect(run).not.toHaveBeenCalled()
    expect(extensionInstallProgress().phase).toBe('failed')
  })
  it('deduplicates selected providers and leaves core-only users alone', () => {
    expect(selectedExtensionProviders({ ...config, reportProviders: ['akshare'] })).toEqual(['akshare'])
    expect(selectedExtensionProviders({ ...config, dailyProviders: ['tencent'] })).toEqual([])
  })
  it('rejects an unsupported interpreter before creating or downloading anything', async () => {
    const run = vi.fn().mockResolvedValue('3.10.9\n')
    await expect(installOnDemandExtensions(config, 'python', tmpdir(), run)).rejects.toThrow('AKSHARE_PYTHON_VERSION_UNSUPPORTED')
    expect(run).toHaveBeenCalledTimes(1)
    expect(extensionInstallProgress().phase).toBe('failed')
  })
  it('isolates installation and verifies imports before returning the new interpreter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rt-extension-test-'))
    const run = vi.fn().mockResolvedValueOnce('3.12.0').mockResolvedValueOnce('').mockResolvedValueOnce('').mockResolvedValueOnce('{"akshare":"1.19.1"}')
    try {
      const executable = await installOnDemandExtensions(config, 'python', root, run)
      expect(prepareProductPython).toHaveBeenCalledWith('python', root, 11, run, expect.any(Function))
      expect(run.mock.calls[0][0]).toBe('product-private-python')
      expect(run.mock.calls[1][0]).toBe('product-private-python')
      expect(executable).toContain(join(root, 'data-source-extensions', 'environment-'))
      expect(run.mock.calls[2][1]).toContain('--only-binary=:all:')
      expect(run.mock.calls[2][1]).toContain('--no-binary=jsonpath,PyExecJS')
      expect(run.mock.calls[2][1]).toContain('jsonpath==0.82.2')
      expect(run.mock.calls[2][1]).toContain('akshare==1.19.1')
      expect(run.mock.calls[2][1]).toContain('https://pypi.org/simple')
      expect(run.mock.calls[2][1]).toContain('--cache-dir')
      expect(run.mock.calls[2][1]).toContain(join(root, 'data-source-cache', 'pip'))
      expect(extensionInstallProgress().phase).toBe('complete')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('removes only the newly created staging directory when download fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rt-extension-test-'))
    const run = vi.fn().mockResolvedValueOnce('3.12.0').mockResolvedValueOnce('').mockRejectedValueOnce(Error('BRIDGE_INSTALL_FAILED'))
    try {
      await expect(installOnDemandExtensions(config, 'python', root, run)).rejects.toThrow('BRIDGE_INSTALL_FAILED')
      expect(await readdir(join(root, 'data-source-extensions'))).toEqual([])
      expect(extensionInstallProgress().phase).toBe('failed')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
