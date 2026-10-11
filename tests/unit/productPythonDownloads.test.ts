import { describe, expect, it } from 'vitest'
import { macProductPythonArtifact } from '../../electron/shared/productPythonDownloads'

describe('pinned first-use Mac Python downloads', () => {
  it.each(['arm64', 'x64'])('pins the URL, architecture, size and digest for %s', architecture => {
    const artifact = macProductPythonArtifact(architecture)
    const url = new URL(artifact.url)
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('github.com')
    expect(url.pathname).toContain(`/astral-sh/python-build-standalone/releases/download/${artifact.release}/`)
    expect(decodeURIComponent(url.pathname.split('/').at(-1)!)).toBe(artifact.name)
    expect(artifact.name).toContain(architecture === 'arm64' ? '-aarch64-apple-darwin-' : '-x86_64-apple-darwin-')
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(artifact.size).toBeGreaterThan(20_000_000)
    expect(artifact.size).toBeLessThan(32_000_000)
    expect(Object.isFrozen(artifact)).toBe(true)
  })

  it('rejects unsupported architectures rather than silently installing an Intel runtime', () => {
    expect(() => macProductPythonArtifact('ia32')).toThrow('PRODUCT_PYTHON_ARCHITECTURE_UNSUPPORTED')
    expect(() => macProductPythonArtifact('latest')).toThrow('PRODUCT_PYTHON_ARCHITECTURE_UNSUPPORTED')
  })
})
