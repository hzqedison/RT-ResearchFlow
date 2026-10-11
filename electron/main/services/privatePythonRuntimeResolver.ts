import { mkdir } from 'node:fs/promises'
import { join, dirname, resolve, isAbsolute } from 'node:path'
import { below, readValidatedRuntime } from '../../shared/privatePythonRuntimeManifest.cjs'
import type { PrivatePythonProvider, PrivatePythonRuntimeManifest } from '../../shared/privatePythonRuntimeTypes'

export interface PrivatePythonRuntimeResolution {
  root: string
  executable: string
  nodeExecutable: string
  bootstrap: string
  manifestPath: string
  manifestSha256: string
  manifest: PrivatePythonRuntimeManifest
}

export function privateProviderForOperation(operation: unknown): PrivatePythonProvider {
  if (typeof operation !== 'string') throw new Error('SOURCE_REQUEST_FAILED')
  if (['akshare-daily', 'akshare-limit-pool', 'akshare-reports'].includes(operation)) return 'akshare'
  if (operation === 'tdx-daily') return 'mootdx'
  if (operation === 'iwencai') return 'pywencai'
  throw new Error('SOURCE_REQUEST_FAILED')
}

export function resolvePrivatePythonRuntime(resourcesPath: string, platform = process.platform, arch = process.arch): PrivatePythonRuntimeResolution {
  if (!isAbsolute(resourcesPath) || resourcesPath.includes('\0')) throw new Error('PRIVATE_RUNTIME_INVALID')
  const root = resolve(resourcesPath, 'private-python-runtime')
  if (!below(resolve(resourcesPath), root)) throw new Error('PRIVATE_RUNTIME_INVALID')
  const { manifest, manifestSha256 } = readValidatedRuntime(root, platform + '-' + arch)
  return {
    root, executable: join(root, manifest.python.executable),
    nodeExecutable: join(root, manifest.node.executable),
    bootstrap: join(root, manifest.bootstrap), manifestPath: join(root, 'manifest.json'),
    manifestSha256, manifest,
  }
}

export async function privatePythonInvocation(runtime: PrivatePythonRuntimeResolution, provider: PrivatePythonProvider,
  userData: string, script: string, request: Record<string, unknown>) {
  if (!['akshare', 'mootdx', 'pywencai'].includes(provider) || !isAbsolute(userData) || userData.includes('\0')) throw new Error('PRIVATE_RUNTIME_INVALID')
  const cache = join(userData, 'data-source-cache', 'bundled', provider)
  const temporary = join(cache, 'tmp')
  await mkdir(temporary, { recursive: true })
  const env: NodeJS.ProcessEnv = {}
  // Do not inherit credentials, Python paths, Node options, or executable lookup paths.
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'LANG', 'LC_ALL', 'TZ']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  Object.assign(env, {
    PATH: dirname(runtime.nodeExecutable), HOME: cache, USERPROFILE: cache,
    PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1',
    XDG_CACHE_HOME: cache, TMPDIR: temporary, TEMP: temporary, TMP: temporary,
    NODE_PATH: '', NODE_OPTIONS: '', PYTHONPATH: '',
  })
  if (provider === 'mootdx') env.RT_MOOTDX_CACHE_ROOT = cache
  return {
    executable: runtime.executable,
    // -I ignores PYTHONUTF8; the interpreter flag is mandatory at this entry.
    args: ['-I', '-S', '-B', '-X', 'utf8', runtime.bootstrap, runtime.manifestPath, provider, runtime.manifestSha256],
    input: JSON.stringify({ script, request }), env, cwd: cache,
  }
}
