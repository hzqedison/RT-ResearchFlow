import { app } from 'electron'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { MultiSourcePreference } from '../../shared/dataSourceTypes'
import { minimumDataSourcePythonMinor, supportsDataSourcePython } from '../../shared/pythonSourceRequirements'
import { privateProviderForOperation, privatePythonInvocation, resolvePrivatePythonRuntime } from './privatePythonRuntimeResolver'
import type { PrivatePythonProvider } from '../../shared/privatePythonRuntimeTypes'

// Packaged applications use only the complete, offline, per-provider runtime.
// Explicit development interpreter selection remains available for isolated fixtures.
// JSON travels through stdin, not command arguments. Raw package logs are discarded.
const PYTHON_BRIDGE = String.raw`
import contextlib, datetime, importlib.metadata, io, json, sys
request = json.loads(sys.stdin.read())
def records(frame, maximum=500):
    if frame is None or not hasattr(frame, "to_json") or frame.empty:
        return []
    return json.loads(frame.tail(maximum).to_json(orient="records", date_format="iso", force_ascii=False))
def execute():
    op = request["operation"]
    if op == "status":
        versions = {}
        for package in ("akshare", "mootdx", "pywencai"):
            try:
                versions[package] = importlib.metadata.version(package)
            except importlib.metadata.PackageNotFoundError:
                versions[package] = None
        return {"python": sys.version.split()[0], "packages": versions}
    if op == "akshare-daily":
        import akshare as ak
        frame = ak.stock_zh_a_hist(symbol=request["stockCode"], period="daily",
            start_date=request["startDate"], end_date=request["endDate"], adjust="", timeout=12)
        return records(frame, 481)
    if op == "akshare-limit-pool":
        import akshare as ak
        date = request["tradeDate"]
        if not isinstance(date, str) or len(date) != 8 or not date.isdigit():
            raise ValueError("invalid trade date")
        datetime.datetime.strptime(date, "%Y%m%d")
        frame = ak.stock_zt_pool_em(date=date)
        if frame is not None and len(frame) > 2500:
            raise ValueError("limit pool exceeds safe response size")
        return records(frame, 2500)
    if op == "akshare-reports":
        import akshare as ak
        frame = ak.stock_research_report_em(symbol=request["stockCode"])
        if frame is not None and not frame.empty:
            frame = frame.sort_values("日期", ascending=False).head(50)
        return records(frame, 50)
    if op == "tdx-daily":
        from mootdx.quotes import Quotes
        client = Quotes.factory(market="std", timeout=5, multithread=False, heartbeat=False)
        try:
            return records(client.bars(symbol=request["stockCode"], frequency=9, start=0, offset=481), 481)
        finally:
            client.close()
    if op == "iwencai":
        import pywencai
        frame = pywencai.get(query=request["query"], cookie=request["cookie"],
            page=1, perpage=50, loop=False, retry=1, sleep=1, log=False, no_detail=True,
            request_params={"timeout": (5, 12)})
        return records(frame, 50)
    raise ValueError("unsupported operation")
try:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        result = execute()
    print(json.dumps({"ok": True, "data": result}, ensure_ascii=False, allow_nan=False))
except ModuleNotFoundError:
    print(json.dumps({"ok": False, "code": "DEPENDENCY_NOT_INSTALLED"}))
except Exception:
    print(json.dumps({"ok": False, "code": "SOURCE_REQUEST_FAILED"}))
`

interface BridgeEnvelope {
  ok: boolean
  code?: string
  data?: unknown
}

const bridgeMessages: Record<string, string> = {
  PYTHON_UNAVAILABLE: '未找到可运行的 Python。AKShare 需要 Python 3.11+，其他本地扩展需要 Python 3.10+；请在扩展设置中选择解释器。',
  AKSHARE_PYTHON_VERSION_UNSUPPORTED: '所选 AKShare 扩展需要 Python 3.11 或以上。请先选择符合要求的解释器，原有数据源和数据保持不变。',
  DEPENDENCY_NOT_INSTALLED: '本地扩展依赖未安装。请点击“安装所选扩展”，腾讯和东财不受影响。',
  SOURCE_REQUEST_FAILED: '扩展未取得数据，可能是网络、上游接口、登录权限或 Node.js 运行时问题；不会重试绕过验证码。',
  BRIDGE_TIMEOUT: '本地数据扩展请求超时，已停止本次请求。',
  BRIDGE_INVALID_RESPONSE: '本地扩展响应不符合预期，请检查依赖版本。',
  BRIDGE_INSTALL_FAILED: '扩展安装未完成，请检查 Python、网络与磁盘空间；原有数据未被改动。',
  PRIVATE_RUNTIME_PENDING: '随包数据扩展尚未准备完整，不能使用系统 Python 或在线安装代替；原有数据保持不变。',
  PRIVATE_RUNTIME_INVALID: '随包数据扩展校验失败，已停止本次调用；原有数据保持不变。',
}

export function dataBridgeMessage(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('PRIVATE_RUNTIME_')) {
    return bridgeMessages[error.message.startsWith('PRIVATE_RUNTIME_PENDING') ? 'PRIVATE_RUNTIME_PENDING' : 'PRIVATE_RUNTIME_INVALID']
  }
  return error instanceof Error ? bridgeMessages[error.message] ?? '数据源请求未完成，请检查连接与权限。' : '数据源请求未完成。'
}

function pythonExecutable(config: MultiSourcePreference): string {
  const value = config.pythonPath.trim()
  if (!value) return process.platform === 'win32' ? 'python' : 'python3'
  if (!isAbsolute(value) || value.includes('\0')) throw new Error('PYTHON_UNAVAILABLE')
  return value
}

function runPython(executable: string, args: string[], input = '', timeoutMs = 25_000, collect = true,
  privateOptions?: { env: NodeJS.ProcessEnv; cwd: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    // Isolated mode ignores PYTHONUTF8. Explicit UTF-8 also protects Chinese stdin/JSON on Windows.
    const child = spawn(executable, ['-X', 'utf8', ...args], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: privateOptions?.cwd,
      env: privateOptions?.env ?? {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        PIP_CACHE_DIR: join(app.getPath('userData'), 'data-source-cache', 'pip'),
        TMPDIR: join(app.getPath('userData'), 'data-source-cache', 'tmp'),
        TEMP: join(app.getPath('userData'), 'data-source-cache', 'tmp'),
        TMP: join(app.getPath('userData'), 'data-source-cache', 'tmp'),
      },
    })
    let settled = false
    let bytes = 0
    const chunks: Buffer[] = []
    const finish = (error?: Error, output = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(output)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('BRIDGE_TIMEOUT'))
    }, timeoutMs)
    child.on('error', () => finish(new Error('PYTHON_UNAVAILABLE')))
    child.stdout.on('data', (chunk: Buffer) => {
      if (!collect) return
      bytes += chunk.length
      if (bytes > 4 * 1024 * 1024) {
        child.kill()
        finish(new Error('BRIDGE_INVALID_RESPONSE'))
      } else chunks.push(chunk)
    })
    child.stderr.on('data', () => { /* Never expose package logs or credentials. */ })
    child.stdin.on('error', () => { /* Process completion supplies the safe error. */ })
    child.on('close', code => {
      if (code !== 0) finish(new Error('BRIDGE_INSTALL_FAILED'))
      else finish(undefined, Buffer.concat(chunks).toString('utf8'))
    })
    child.stdin.end(input)
  })
}

export async function callPythonDataSource(
  config: MultiSourcePreference,
  request: Record<string, unknown>,
): Promise<unknown> {
  if (app.isPackaged) {
    const runtime = resolvePrivatePythonRuntime(process.resourcesPath)
    const invoke = async (provider: PrivatePythonProvider) => {
      const command = await privatePythonInvocation(runtime, provider, app.getPath('userData'), PYTHON_BRIDGE, request)
      const output = await runPython(command.executable, command.args, command.input, 25_000, true, command)
      return parseBridgeOutput(output)
    }
    if (request.operation === 'status') {
      const packages: Record<string, unknown> = {}
      for (const provider of ['akshare', 'mootdx', 'pywencai'] as const) {
        const status = await invoke(provider) as { python?: string; packages?: Record<string, unknown> }
        if (status.python !== runtime.manifest.python.version || status.packages?.[provider] !== runtime.manifest.providers[provider].version) {
          throw new Error('PRIVATE_RUNTIME_INVALID')
        }
        packages[provider] = status.packages[provider]
      }
      return { python: runtime.manifest.python.version, packages }
    }
    return invoke(privateProviderForOperation(request.operation))
  }
  const temporary = join(app.getPath('userData'), 'data-source-cache', 'tmp')
  await mkdir(temporary, { recursive: true })
  const output = await runPython(pythonExecutable(config), ['-I', '-c', PYTHON_BRIDGE], JSON.stringify(request))
  return parseBridgeOutput(output)
}

function parseBridgeOutput(output: string): unknown {
  let parsed: BridgeEnvelope
  try {
    parsed = JSON.parse(output) as BridgeEnvelope
  } catch {
    throw new Error('BRIDGE_INVALID_RESPONSE')
  }
  if (!parsed.ok) throw new Error(parsed.code ?? 'BRIDGE_INVALID_RESPONSE')
  return parsed.data
}

let installation: Promise<string> | null = null

export function installSelectedDataSourceExtensions(config: MultiSourcePreference): Promise<string> {
  if (installation) return installation
  installation = (async () => {
    const selected: PrivatePythonProvider[] = []
    if (config.dailyProviders.includes('akshare') || config.reportProviders.includes('akshare')) selected.push('akshare')
    if (config.dailyProviders.includes('tdx')) selected.push('mootdx')
    if (config.wencaiEnabled) selected.push('pywencai')
    if (selected.length === 0) throw new Error('DEPENDENCY_NOT_INSTALLED')
    // Keep the explicit development interpreter version guard. Packaged callers
    // never reach this branch, and neither branch runs pip or downloads anything.
    if (!app.isPackaged) {
      const status = await callPythonDataSource(config, { operation: 'status' }) as { python?: string }
      if (!supportsDataSourcePython(String(status.python ?? ''), config)) {
        throw new Error(minimumDataSourcePythonMinor(config) === 11 ? 'AKSHARE_PYTHON_VERSION_UNSUPPORTED' : 'PYTHON_UNAVAILABLE')
      }
    }
    // Compatibility entry point: validate the offline bundle, never install or fetch.
    const runtime = resolvePrivatePythonRuntime(process.resourcesPath)
    if (!supportsDataSourcePython(runtime.manifest.python.version, config)) {
      throw new Error(minimumDataSourcePythonMinor(config) === 11 ? 'AKSHARE_PYTHON_VERSION_UNSUPPORTED' : 'PYTHON_UNAVAILABLE')
    }
    for (const provider of selected) {
      const command = await privatePythonInvocation(runtime, provider, app.getPath('userData'), PYTHON_BRIDGE, { operation: 'status' })
      const status = parseBridgeOutput(await runPython(command.executable, command.args, command.input, 25_000, true, command)) as { packages?: Record<string, unknown> }
      if (status.packages?.[provider] !== runtime.manifest.providers[provider].version) throw new Error('PRIVATE_RUNTIME_INVALID')
    }
    return runtime.executable
  })().finally(() => { installation = null })
  return installation
}
