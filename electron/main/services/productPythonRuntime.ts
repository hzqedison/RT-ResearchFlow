import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { prepareMacProductPython } from './macProductPythonRuntime'

type Runner = (executable: string, args: string[], input?: string, timeout?: number, collect?: boolean) => Promise<string>
type RuntimeInfo = { base: string; version: number[]; bits: number }
const pending = new Map<string, Promise<string>>()
const probe = 'import sys,json,struct,ssl,sqlite3,venv,ensurepip; print(json.dumps({"base":sys.base_prefix,"version":list(sys.version_info[:2]),"bits":struct.calcsize("P")*8}))'

async function inspect(executable: string, minimumMinor: number, run: Runner): Promise<RuntimeInfo> {
  const info = JSON.parse(await run(executable, ['-I', '-B', '-c', probe], '', 30_000)) as RuntimeInfo
  if (typeof info.base !== 'string' || !isAbsolute(info.base) || !Array.isArray(info.version)
    || info.version[0] !== 3 || !Number.isInteger(info.version[1]) || info.version[1] < minimumMinor || info.bits !== 64) {
    throw Error('PRODUCT_PYTHON_UNSUPPORTED')
  }
  return info
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

// A Windows full Python install is relocatable when its complete standard
// library and DLLs are retained. Never copy site-packages, venvs, pip launchers
// or symbolic links from the shared installation. macOS framework/Homebrew
// installations have different relocation rules and are deliberately excluded.
export async function prepareProductPython(configuredPython: string, userData: string, minimumMinor: number, run: Runner, report?: (message: string) => void): Promise<string> {
  if (process.platform === 'darwin') return prepareMacProductPython(userData, minimumMinor, run, report)
  if (process.platform !== 'win32') return configuredPython
  const root = resolve(userData, 'runtime')
  if (parse(root).root.replace(/[\\/]+$/, '').toLowerCase() === (process.env.SystemDrive ?? 'C:').toLowerCase()) {
    throw Error('PRODUCT_PYTHON_REQUIRES_NON_SYSTEM_DRIVE')
  }
  const active = pending.get(root)
  if (active) return active
  const operation = prepare(root, configuredPython, minimumMinor, run)
  pending.set(root, operation)
  try { return await operation } finally { if (pending.get(root) === operation) pending.delete(root) }
}

async function prepare(root: string, configuredPython: string, minimumMinor: number, run: Runner): Promise<string> {
  const destination = join(root, 'python')
  const executable = join(destination, 'python.exe')
  if (await exists(destination)) {
    const info = await inspect(executable, minimumMinor, run)
    if (resolve(info.base).toLowerCase() !== destination.toLowerCase()) throw Error('PRODUCT_PYTHON_NOT_SELF_CONTAINED')
    return executable
  }
  const source = await inspect(configuredPython, minimumMinor, run)
  const sourceRoot = resolve(source.base)
  const nested = relative(sourceRoot, destination)
  if (!nested || (!nested.startsWith(`..${sep}`) && nested !== '..' && !isAbsolute(nested))) {
    throw Error('PRODUCT_PYTHON_UNSAFE_SOURCE')
  }
  await mkdir(root, { recursive: true })
  const stage = await mkdtemp(join(root, 'python-preparing-'))
  try {
    await cp(sourceRoot, stage, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: async path => {
        const parts = relative(sourceRoot, path).split(sep)
        if (parts.some(part => ['site-packages', '__pycache__', 'test', 'tests'].includes(part.toLowerCase()))
          || parts[0]?.toLowerCase() === 'scripts' || /\.py[co]$/i.test(path)) return false
        if ((await lstat(path)).isSymbolicLink()) throw Error('PRODUCT_PYTHON_SYMLINK_SOURCE_UNSUPPORTED')
        return true
      }
    })
    const stagePython = join(stage, 'python.exe')
    const sourceHash = createHash('sha256').update(await readFile(join(sourceRoot, 'python.exe'))).digest('hex')
    if (createHash('sha256').update(await readFile(stagePython)).digest('hex') !== sourceHash) throw Error('PRODUCT_PYTHON_COPY_MISMATCH')
    const info = await inspect(stagePython, minimumMinor, run)
    if (resolve(info.base).toLowerCase() !== stage.toLowerCase()) throw Error('PRODUCT_PYTHON_NOT_SELF_CONTAINED')
    await writeFile(join(stage, 'product-runtime.json'), JSON.stringify({ schemaVersion: 1, mode: 'local-copy',
      pythonVersion: info.version.join('.'), sourceExecutableSha256: sourceHash, modifiesSharedPython: false }) + '\n', { flag: 'wx' })
    // Windows refuses a rename onto an existing directory. A concurrent
    // installer cannot silently replace an already working private runtime.
    await rename(stage, destination)
    return executable
  } catch (error) {
    // Remove only the staging directory allocated by this invocation.
    await rm(stage, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
