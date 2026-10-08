import { spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MultiSourcePreference } from '../../electron/shared/dataSourceTypes'

const native = vi.hoisted(() => ({
  root: '',
  fixtureRoot: '',
  launches: [] as Array<{
    executable: string
    args: string[]
    shell: SpawnOptions['shell']
    windowsHide: boolean | undefined
    temporary: string | undefined
    child: ChildProcess
  }>,
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData' || !native.root) throw new Error('NATIVE_FIXTURE_NOT_INITIALIZED')
      return native.root
    },
  },
}))

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    // runPython is private. This seam only bootstraps owned Python fixtures;
    // the real application bridge, flags, pipes, JSON, timer and OS spawn run.
    // No fake child process, output envelope, Python executable or filesystem.
    spawn: (executable: string, args: string[], options: SpawnOptions) => {
      const scriptIndex = args.indexOf('-c') + 1
      if (scriptIndex === 0 || typeof args[scriptIndex] !== 'string') throw new Error('UNEXPECTED_NATIVE_BRIDGE_COMMAND')
      const bootstrap = [
        'import sys, socket',
        `sys.path.insert(0, ${JSON.stringify(native.fixtureRoot)})`,
        'def _native_deny_network(*args, **kwargs):',
        '    raise RuntimeError("NATIVE_FIXTURE_NETWORK_DENIED")',
        'socket.socket = _native_deny_network',
        'socket.create_connection = _native_deny_network',
        'socket.getaddrinfo = _native_deny_network',
        'socket.gethostbyname = _native_deny_network',
        'socket.gethostbyname_ex = _native_deny_network',
        '',
      ].join('\n')
      const fixtureArgs = [...args]
      fixtureArgs[scriptIndex] = bootstrap + args[scriptIndex]
      const child = actual.spawn(executable, fixtureArgs, options)
      native.launches.push({
        executable, args: [...args], shell: options.shell,
        windowsHide: options.windowsHide, temporary: options.env?.TMPDIR, child,
      })
      return child
    },
  }
})

import { callPythonDataSource, dataBridgeMessage } from '../../electron/main/services/pythonDataSourceBridge'

interface NativeProbe {
  python: string
  executable: string
  platform: string
  machine: string
  isolated: number
  utf8Mode: number
  safePath: boolean
  stdinEncoding: string
  stdoutEncoding: string
  stderrEncoding: string
  ignoredPythonPath: boolean
  fixtureFile: string
}

interface NativeFixtureRow {
  '代码': string
  '名称': string
  echo: string
  date?: string
  probe: NativeProbe
  networkBlocked?: boolean
}

// Only standard-library modules; no pandas, provider installation or pip.
const fixtureSupport = String.raw`
import json, os, platform, sys

def probe():
    return {
        "python": platform.python_version(),
        "executable": sys.executable,
        "platform": sys.platform,
        "machine": platform.machine(),
        "isolated": sys.flags.isolated,
        "utf8Mode": sys.flags.utf8_mode,
        "safePath": sys.flags.safe_path,
        "stdinEncoding": sys.stdin.encoding,
        "stdoutEncoding": sys.__stdout__.encoding,
        "stderrEncoding": sys.__stderr__.encoding,
        "ignoredPythonPath": os.environ.get("PYTHONPATH") not in sys.path,
        "fixtureFile": __file__,
    }

class Frame:
    empty = False
    def __init__(self, rows):
        self.rows = rows
    def __len__(self):
        return len(self.rows)
    def tail(self, maximum):
        return Frame(self.rows[-maximum:])
    def to_json(self, orient, date_format, force_ascii):
        assert orient == "records" and date_format == "iso" and force_ascii is False
        return json.dumps(self.rows, ensure_ascii=False, allow_nan=False)

def frame(echo, **extra):
    return Frame([{"代码": "000001", "名称": "中文原生探针：沪深北", "echo": echo,
                   "probe": probe(), **extra}])
`

const akshareFixture = String.raw`
import socket, sys
from _native_fixture import frame

def stock_zh_a_hist(symbol, period, start_date, end_date, adjust, timeout):
    assert period == "daily" and adjust == "" and timeout == 12
    print("不应泄露的中文供应商日志")
    print("不应泄露的中文标准错误", file=sys.stderr)
    if symbol == "FAIL_NATIVE_FIXTURE":
        raise RuntimeError("仅测试的中文私密诊断")
    if symbol == "PROBE_NETWORK_DENIED":
        try:
            socket.socket()
        except RuntimeError as error:
            assert str(error) == "NATIVE_FIXTURE_NETWORK_DENIED"
            return frame(symbol, networkBlocked=True)
        raise AssertionError("NETWORK_GUARD_MISSING")
    return frame(symbol)

def stock_zt_pool_em(date):
    return frame("涨停池中文探针", date=date)
`

const wencaiFixture = String.raw`
from _native_fixture import frame

def get(query, cookie, page, perpage, loop, retry, sleep, log, no_detail, request_params):
    assert cookie == "" and page == 1 and perpage == 50 and loop is False
    assert retry == 1 and sleep == 1 and log is False and no_detail is True
    assert request_params == {"timeout": (5, 12)}
    return frame(query)
`

let config: MultiSourcePreference
let systemProbe: { executable: string; version: string; platform: string; machine: string }

function assertOwnedTemporary(path: string): void {
  const child = relative(resolve(tmpdir()), resolve(path))
  if (!child || child.startsWith('..') || isAbsolute(child) || !basename(path).startsWith('rt-native-python-')) {
    throw new Error('NATIVE_FIXTURE_CLEANUP_OUTSIDE_OWNED_TEMP')
  }
}

function lastLaunch() {
  const launch = native.launches[native.launches.length - 1]
  expect(launch).toBeDefined()
  expect(launch.executable).toBe(systemProbe.executable)
  expect(launch.args.slice(0, 4)).toEqual(['-X', 'utf8', '-I', '-c'])
  expect(launch.shell).toBe(false)
  expect(launch.windowsHide).toBe(true)
  expect(launch.temporary).toBe(join(native.root, 'data-source-cache', 'tmp'))
  expect(launch.child.pid).toBeGreaterThan(0)
  expect(launch.child.exitCode).toBe(0)
  return launch
}

function assertNativeProbe(probe: NativeProbe): void {
  expect(probe).toMatchObject({
    executable: systemProbe.executable, python: systemProbe.version,
    platform: process.platform, isolated: 1, utf8Mode: 1,
    safePath: true, ignoredPythonPath: true,
  })
  for (const encoding of [probe.stdinEncoding, probe.stdoutEncoding, probe.stderrEncoding]) {
    expect(encoding.toLowerCase().replaceAll('-', '')).toBe('utf8')
  }
  expect(resolve(probe.fixtureFile)).toBe(join(native.fixtureRoot, '_native_fixture.py'))
}

beforeAll(async () => {
  native.root = await mkdtemp(join(tmpdir(), 'rt-native-python-'))
  assertOwnedTemporary(native.root)
  native.fixtureRoot = join(native.root, '中文 fixtures')
  const untrusted = join(native.root, 'untrusted-pythonpath')
  await mkdir(native.fixtureRoot, { recursive: true })
  await mkdir(untrusted, { recursive: true })
  await writeFile(join(native.fixtureRoot, '_native_fixture.py'), fixtureSupport, 'utf8')
  await writeFile(join(native.fixtureRoot, 'akshare.py'), akshareFixture, 'utf8')
  await writeFile(join(native.fixtureRoot, 'pywencai.py'), wencaiFixture, 'utf8')
  await writeFile(join(untrusted, 'akshare.py'), 'raise RuntimeError("UNTRUSTED_PYTHONPATH_USED")\n', 'utf8')

  const executable = process.env.DATA_SOURCE_NATIVE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const discovery = spawnSync(executable, ['-I', '-X', 'utf8', '-c',
    'import json, platform, sys; print(json.dumps({"executable": sys.executable, "version": platform.python_version(), "platform": sys.platform, "machine": platform.machine()}))'],
  { encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000 })
  if (discovery.error || discovery.status !== 0) throw new Error('NATIVE_SYSTEM_PYTHON_REQUIRED_NOT_SKIPPED')
  systemProbe = JSON.parse(discovery.stdout) as typeof systemProbe
  expect(isAbsolute(systemProbe.executable)).toBe(true)
  expect(systemProbe.platform).toBe(process.platform)
  expect(Number(systemProbe.version.split('.')[0])).toBe(3)
  expect(Number(systemProbe.version.split('.')[1])).toBeGreaterThanOrEqual(11)
  if (process.env.DATA_SOURCE_NATIVE_PYTHON_VERSION) {
    expect(systemProbe.version.split('.').slice(0, 2).join('.')).toBe(process.env.DATA_SOURCE_NATIVE_PYTHON_VERSION)
  }
  if (process.env.DATA_SOURCE_NATIVE_ARCH) {
    expect(process.arch).toBe(process.env.DATA_SOURCE_NATIVE_ARCH)
    const pythonArch = /^(arm64|aarch64)$/i.test(systemProbe.machine) ? 'arm64' :
      /^(amd64|x86_64|x64)$/i.test(systemProbe.machine) ? 'x64' : systemProbe.machine
    expect(pythonArch).toBe(process.env.DATA_SOURCE_NATIVE_ARCH)
  }
  config = { dailyProviders: ['akshare'], reportProviders: [], wencaiEnabled: false, pythonPath: systemProbe.executable }
  // -I must ignore hostile Python environment settings; explicit -X utf8 wins.
  vi.stubEnv('PYTHONIOENCODING', 'ascii')
  vi.stubEnv('PYTHONUTF8', '0')
  vi.stubEnv('PYTHONPATH', untrusted)
  console.info(JSON.stringify({ nativePythonEvidence: {
    commit: process.env.GITHUB_SHA ?? 'local-unreported-commit',
    platform: process.platform, arch: process.arch, node: process.versions.node,
    python: systemProbe.version, pythonMachine: systemProbe.machine,
    subprocess: 'real-system-python', provider: 'owned-offline-fixtures',
  } }))
}, 20_000)

beforeEach(() => { native.launches.length = 0 })

afterAll(async () => {
  try {
    for (const { child } of native.launches) {
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise<void>(done => { child.once('close', () => done()); child.kill() })
      }
    }
    if (native.root) {
      assertOwnedTemporary(native.root)
      await rm(native.root, { recursive: true, force: true })
    }
  } finally {
    native.root = ''
    native.fixtureRoot = ''
    native.launches.length = 0
    vi.unstubAllEnvs()
  }
}, 15_000)

describe('application Python bridge on native OS subprocesses (offline)', () => {
  it('executes the real system interpreter through the status operation', async () => {
    const result = await callPythonDataSource(config, { operation: 'status' }) as { python: string; packages: Record<string, string | null> }
    expect(result.python).toBe(systemProbe.version)
    expect(Object.keys(result.packages).sort()).toEqual(['akshare', 'mootdx', 'pywencai'])
    lastLaunch()
  }, 30_000)

  it('round-trips Chinese stdin and JSON under -I and explicit -X utf8 without a shell', async () => {
    const text = '中文探针-沪深北;不是命令'
    const result = await callPythonDataSource(config, { operation: 'akshare-daily', stockCode: text,
      startDate: '20261001', endDate: '20261008' }) as NativeFixtureRow[]
    expect(result[0]).toMatchObject({ '代码': '000001', '名称': '中文原生探针：沪深北', echo: text })
    assertNativeProbe(result[0].probe)
    expect(lastLaunch().args.join(' ')).not.toContain(text)
    expect(JSON.stringify(result)).not.toContain('不应泄露')
  }, 30_000)

  it('preserves a large multibyte Chinese query through real pipes rather than mock output chunks', async () => {
    const query = '昨日涨停、封板资金、炸板次数；'.repeat(4000)
    const result = await callPythonDataSource(config, { operation: 'iwencai', query, cookie: '' }) as NativeFixtureRow[]
    expect(result[0].echo).toBe(query)
    assertNativeProbe(result[0].probe)
    expect(lastLaunch().args.join(' ')).not.toContain(query)
  }, 30_000)

  it('runs the actual limit-pool bridge branch against an owned Chinese module fixture', async () => {
    const result = await callPythonDataSource(config, { operation: 'akshare-limit-pool', tradeDate: '20261008' }) as NativeFixtureRow[]
    expect(result[0]).toMatchObject({ date: '20261008', echo: '涨停池中文探针', '名称': '中文原生探针：沪深北' })
    assertNativeProbe(result[0].probe)
    lastLaunch()
  }, 30_000)

  it('rejects an impossible calendar date in the real Python bridge without requesting a source', async () => {
    await expect(callPythonDataSource(config, { operation: 'akshare-limit-pool', tradeDate: '20260229' })).rejects.toThrow('SOURCE_REQUEST_FAILED')
    lastLaunch()
  }, 30_000)

  it('sanitizes actual Python fixture errors without exposing Chinese provider diagnostics', async () => {
    const error = await callPythonDataSource(config, { operation: 'akshare-daily', stockCode: 'FAIL_NATIVE_FIXTURE',
      startDate: '20261001', endDate: '20261008' }).then(() => null, reason => reason as Error)
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe('SOURCE_REQUEST_FAILED')
    expect(dataBridgeMessage(error)).not.toContain('仅测试的中文私密诊断')
    lastLaunch()
  }, 30_000)

  it('blocks network socket creation inside the native fixture before any connection can be attempted', async () => {
    const result = await callPythonDataSource(config, { operation: 'akshare-daily', stockCode: 'PROBE_NETWORK_DENIED',
      startDate: '20261001', endDate: '20261008' }) as NativeFixtureRow[]
    expect(result[0].networkBlocked).toBe(true)
    assertNativeProbe(result[0].probe)
    lastLaunch()
  }, 30_000)
})
