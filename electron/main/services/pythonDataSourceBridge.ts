import { app } from 'electron'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { MultiSourcePreference } from '../../shared/dataSourceTypes'

// Packages are optional, installed into a private venv, never the system Python.
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
  PYTHON_UNAVAILABLE: '未找到可运行的 Python。请安装 Python 3.10 或以上，或在扩展设置中选择解释器。',
  DEPENDENCY_NOT_INSTALLED: '本地扩展依赖未安装。请点击“安装所选扩展”，腾讯和东财不受影响。',
  SOURCE_REQUEST_FAILED: '扩展未取得数据，可能是网络、上游接口、登录权限或 Node.js 运行时问题；不会重试绕过验证码。',
  BRIDGE_TIMEOUT: '本地数据扩展请求超时，已停止本次请求。',
  BRIDGE_INVALID_RESPONSE: '本地扩展响应不符合预期，请检查依赖版本。',
  BRIDGE_INSTALL_FAILED: '扩展安装未完成，请检查 Python、网络与磁盘空间；原有数据未被改动。',
}

export function dataBridgeMessage(error: unknown): string {
  return error instanceof Error ? bridgeMessages[error.message] ?? '数据源请求未完成，请检查连接与权限。' : '数据源请求未完成。'
}

function pythonExecutable(config: MultiSourcePreference): string {
  const value = config.pythonPath.trim()
  if (!value) return process.platform === 'win32' ? 'python' : 'python3'
  if (!isAbsolute(value) || value.includes('\0')) throw new Error('PYTHON_UNAVAILABLE')
  return value
}

function runPython(executable: string, args: string[], input = '', timeoutMs = 25_000, collect = true): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
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
  const temporary = join(app.getPath('userData'), 'data-source-cache', 'tmp')
  await mkdir(temporary, { recursive: true })
  const output = await runPython(pythonExecutable(config), ['-I', '-c', PYTHON_BRIDGE], JSON.stringify(request))
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
    const packages: string[] = []
    if (config.dailyProviders.includes('akshare') || config.reportProviders.includes('akshare')) packages.push('akshare==1.19.1')
    if (config.dailyProviders.includes('tdx')) packages.push('mootdx==0.11.7')
    if (config.wencaiEnabled) packages.push('pywencai==0.13.1')
    if (packages.length === 0) throw new Error('DEPENDENCY_NOT_INSTALLED')
    const root = join(app.getPath('userData'), 'data-source-cache')
    await mkdir(join(root, 'tmp'), { recursive: true })
    const envDir = join(root, 'python-venv')
    const status = await callPythonDataSource(config, { operation: 'status' }) as { python?: string }
    const version = String(status.python ?? '').split('.').map(Number)
    if (version[0] !== 3 || version[1] < 10) throw new Error('PYTHON_UNAVAILABLE')
    await runPython(pythonExecutable(config), ['-I', '-m', 'venv', envDir], '', 90_000, false)
    const managed = process.platform === 'win32' ? join(envDir, 'Scripts', 'python.exe') : join(envDir, 'bin', 'python')
    await runPython(managed, ['-I', '-m', 'pip', 'install', '--disable-pip-version-check',
      '--no-input', '--index-url', 'https://pypi.org/simple', ...packages], '', 600_000, false)
    return managed
  })().finally(() => { installation = null })
  return installation
}
