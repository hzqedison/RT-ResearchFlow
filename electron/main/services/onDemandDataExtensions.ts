import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { MultiSourcePreference, DataExtensionInstallProgress } from '../../shared/dataSourceTypes'
import { minimumDataSourcePythonMinor, supportsDataSourcePython } from '../../shared/pythonSourceRequirements'

type Runner = (executable: string, args: string[], input?: string, timeout?: number, collect?: boolean) => Promise<string>
const requirements = { akshare: 'akshare==1.19.1', mootdx: 'mootdx==0.11.7', pywencai: 'pywencai==0.13.1' } as const
type Provider = keyof typeof requirements
let progress: DataExtensionInstallProgress = { running: false, phase: 'idle', message: '尚未开始安装扩展' }

export function extensionInstallProgress(): DataExtensionInstallProgress { return { ...progress } }
export function selectedExtensionProviders(config: MultiSourcePreference): Provider[] {
  const selected: Provider[] = []
  if (config.dailyProviders.includes('akshare') || config.reportProviders.includes('akshare')) selected.push('akshare')
  if (config.dailyProviders.includes('tdx')) selected.push('mootdx')
  if (config.wencaiEnabled) selected.push('pywencai')
  return selected
}

export async function installOnDemandExtensions(config: MultiSourcePreference, basePython: string, userData: string, run: Runner): Promise<string> {
  const selected = selectedExtensionProviders(config)
  if (!selected.length) throw Error('DEPENDENCY_NOT_INSTALLED')
  let stage: string | undefined
  const root = resolve(userData, 'data-source-extensions')
  try {
    progress = { running: true, phase: 'checking', message: '检查本机 Python 版本' }
    const version = (await run(basePython, ['-I', '-c', 'import sys; print(sys.version.split()[0])'])).trim()
    if (!supportsDataSourcePython(version, config)) throw Error(minimumDataSourcePythonMinor(config) === 11 ? 'AKSHARE_PYTHON_VERSION_UNSUPPORTED' : 'PYTHON_UNAVAILABLE')
    await mkdir(root, { recursive: true })
    stage = await mkdtemp(join(root, 'environment-'))
    progress = { running: true, phase: 'creating', message: '在应用数据目录创建独立环境，不修改系统 Python' }
    await run(basePython, ['-I', '-m', 'venv', stage], '', 180_000, false)
    const executable = join(stage, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    for (const provider of selected) {
      progress = { running: true, phase: 'downloading', provider, message: `正在下载并安装 ${provider}，请勿退出；网络较慢时可能需要数分钟` }
      // Prefer prebuilt wheels; jsonpath and PyExecJS are source-only Python
      // dependencies. Explicitly limit those exceptions and pin their versions.
      // Never inherit custom pip configuration or use an unofficial mirror.
      const sourceDependencies = provider === 'pywencai' ? ['jsonpath==0.82.2', 'PyExecJS==1.5.1']
        : provider === 'akshare' ? ['jsonpath==0.82.2'] : []
      await run(executable, ['-I', '-m', 'pip', '--isolated', '--disable-pip-version-check',
        '--cache-dir', join(userData, 'data-source-cache', 'pip'), 'install',
        '--index-url', 'https://pypi.org/simple', '--only-binary=:all:', '--no-binary=jsonpath,PyExecJS',
        '--timeout', '30', '--retries', '1', requirements[provider], ...sourceDependencies], '', 600_000, false)
    }
    progress = { running: true, phase: 'verifying', message: '检查所选扩展能否实际导入' }
    const script = 'import importlib, importlib.metadata, json; names=json.loads(input()); [importlib.import_module(n) for n in names]; print(json.dumps({n:importlib.metadata.version(n) for n in names}))'
    const result = JSON.parse(await run(executable, ['-I', '-c', script], JSON.stringify(selected))) as Record<string, unknown>
    if (selected.some(provider => typeof result[provider] !== 'string' || !result[provider])) throw Error('BRIDGE_INSTALL_FAILED')
    progress = { running: false, phase: 'complete', message: '所选扩展已安装并通过导入检查；尚不代表上游数据连接成功' }
    return executable
  } catch (error) {
    // Delete only this newly created owned staging environment. Existing working
    // environments and the persisted interpreter setting remain untouched.
    if (stage && dirname(resolve(stage)) === root && resolve(stage) !== root) {
      await rm(stage, { recursive: true, force: true }).catch(() => {})
    }
    progress = { running: false, phase: 'failed', message: '安装未完成，已有扩展与数据保持不变，可检查 Python、网络及架构兼容性后重试' }
    throw error
  }
}
