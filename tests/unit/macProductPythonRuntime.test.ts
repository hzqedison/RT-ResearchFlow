import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { macProductPythonArtifact } from '../../electron/shared/productPythonDownloads'
import { assertMacPythonArchiveEntries, prepareMacProductPython, verifyMacPythonArchive } from '../../electron/main/services/macProductPythonRuntime'

const fixtures: string[] = []
afterEach(async () => { for (const path of fixtures.splice(0)) await rm(path, { recursive: true, force: true }) })
const validEntries = ['python/', 'python/bin/python3', 'python/lib/python3.13/LICENSE.txt']

describe('Mac product Python integrity gates', () => {
  it('accepts the intended archive layout', () => {
    expect(() => assertMacPythonArchiveEntries(validEntries, '3.13.16')).not.toThrow()
  })
  it.each(['/tmp/escape', 'python/../../escape', 'python/dir/../escape', 'python\\escape', 'other/bin/python3'])(
    'rejects an unsafe archive path: %s', path => {
      expect(() => assertMacPythonArchiveEntries([...validEntries, path], '3.13.16')).toThrow('PRODUCT_PYTHON_UNSAFE_ARCHIVE')
    })
  it('requires an interpreter and retained Python license', () => {
    expect(() => assertMacPythonArchiveEntries(['python/bin/python3'], '3.13.16')).toThrow('PRODUCT_PYTHON_INCOMPLETE_ARCHIVE')
    expect(() => assertMacPythonArchiveEntries([], '3.13.16')).toThrow('PRODUCT_PYTHON_UNSAFE_ARCHIVE')
  })
  it('verifies exact bytes rather than only the archive filename', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rt-mac-python-integrity-'))
    fixtures.push(root)
    const path = join(root, 'fixture.tar.gz')
    const bytes = Buffer.from('test archive content')
    await writeFile(path, bytes)
    const artifact = { ...macProductPythonArtifact('arm64'), size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') }
    await expect(verifyMacPythonArchive(path, artifact)).resolves.toBeUndefined()
    await expect(verifyMacPythonArchive(path, { ...artifact, size: bytes.length + 1 })).rejects.toThrow('PRODUCT_PYTHON_ARCHIVE_SIZE_MISMATCH')
    await expect(verifyMacPythonArchive(path, { ...artifact, sha256: '0'.repeat(64) })).rejects.toThrow('PRODUCT_PYTHON_ARCHIVE_CHECKSUM_MISMATCH')
    await mkdir(join(root, 'directory'))
    await expect(verifyMacPythonArchive(join(root, 'directory'), artifact)).rejects.toThrow('PRODUCT_PYTHON_ARCHIVE_SIZE_MISMATCH')
  })
  it.skipIf(process.platform === 'darwin')('does not execute Mac provisioning on Windows or Linux', async () => {
    const run = async () => { throw Error('must not run') }
    await expect(prepareMacProductPython(tmpdir(), 11, run)).rejects.toThrow('PRODUCT_PYTHON_PLATFORM_UNSUPPORTED')
  })
})
