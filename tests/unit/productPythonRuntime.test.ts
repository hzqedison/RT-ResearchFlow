import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareProductPython } from '../../electron/main/services/productPythonRuntime'

const fixtures: string[] = []
afterEach(async () => { for (const path of fixtures.splice(0)) await rm(path, { recursive: true, force: true }) })

describe.skipIf(process.platform !== 'win32')('product-local Windows Python', () => {
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'rt-private-python-test-'))
    fixtures.push(root)
    const source = join(root, 'shared-python')
    const data = join(root, 'product', 'data')
    await mkdir(join(source, 'Lib', 'site-packages'), { recursive: true })
    await mkdir(join(source, 'Lib', 'ensurepip'), { recursive: true })
    await mkdir(join(source, 'Scripts'), { recursive: true })
    await mkdir(join(source, 'Lib', 'venv', 'scripts', 'nt'), { recursive: true })
    await writeFile(join(source, 'python.exe'), 'runtime-fixture')
    await writeFile(join(source, 'Lib', 'site-packages', 'shared-secret.py'), 'do not copy')
    await writeFile(join(source, 'Scripts', 'pip.exe'), 'absolute shared launcher')
    await writeFile(join(source, 'Lib', 'venv', 'scripts', 'nt', 'activate.bat'), 'stdlib venv template')
    const run = async (executable: string) => JSON.stringify({ base: dirname(executable), version: [3, 13], bits: 64 })
    return { source, data, run }
  }

  it('copies the runtime but not shared packages or absolute pip launchers', async () => {
    const { source, data, run } = await fixture()
    const python = await prepareProductPython(join(source, 'python.exe'), data, 11, run)
    expect(python).toBe(join(data, 'runtime', 'python', 'python.exe'))
    expect(await readFile(python, 'utf8')).toBe('runtime-fixture')
    await expect(readFile(join(dirname(python), 'Lib', 'site-packages', 'shared-secret.py'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(dirname(python), 'Scripts', 'pip.exe'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(dirname(python), 'Lib', 'venv', 'scripts', 'nt', 'activate.bat'), 'utf8')).toBe('stdlib venv template')
    expect(await readFile(join(source, 'Lib', 'site-packages', 'shared-secret.py'), 'utf8')).toBe('do not copy')
  })

  it('reuses the private runtime even when the old shared interpreter is unavailable', async () => {
    const { source, data, run } = await fixture()
    const privatePython = await prepareProductPython(join(source, 'python.exe'), data, 11, run)
    const onlyPrivate = async (executable: string) => {
      expect(executable).toBe(privatePython)
      return run(executable)
    }
    expect(await prepareProductPython('missing-shared-python', data, 11, onlyPrivate)).toBe(privatePython)
  })

  it('does not overwrite an invalid existing runtime', async () => {
    const { source, data } = await fixture()
    const privateRoot = join(data, 'runtime', 'python')
    await mkdir(privateRoot, { recursive: true })
    await writeFile(join(privateRoot, 'keep.txt'), 'existing runtime')
    const mismatched = async () => JSON.stringify({ base: source, version: [3, 13], bits: 64 })
    await expect(prepareProductPython(join(source, 'python.exe'), data, 11, mismatched)).rejects.toThrow('PRODUCT_PYTHON_NOT_SELF_CONTAINED')
    expect(await readFile(join(privateRoot, 'keep.txt'), 'utf8')).toBe('existing runtime')
  })

  it('deduplicates simultaneous preparation', async () => {
    const { source, data, run } = await fixture()
    const first = prepareProductPython(join(source, 'python.exe'), data, 11, run)
    const second = prepareProductPython(join(source, 'python.exe'), data, 11, run)
    expect(await first).toBe(await second)
  })
})
