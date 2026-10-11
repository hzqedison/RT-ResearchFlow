import { app } from 'electron'
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { prepareMacProductPython } from '../../electron/main/services/macProductPythonRuntime'
import { installOnDemandExtensions } from '../../electron/main/services/onDemandDataExtensions'

const requestedRoot = process.env.RT_PRODUCT_PYTHON_TEST_ROOT
const receipt = process.env.RT_PRODUCT_PYTHON_RECEIPT
if (!requestedRoot || !receipt) throw Error('An explicit isolated test directory and receipt are required')
const root = resolve(requestedRoot)
mkdirSync(root, { recursive: true })
app.setPath('userData', root)
app.disableHardwareAcceleration()

async function main() {
  assert.equal(process.platform, 'darwin')
  assert.equal(process.arch, process.env.RT_EXPECTED_ARCH)
  const temporary = join(root, 'data-source-cache', 'tmp')
  await mkdir(temporary, { recursive: true })
  const run = (python: string, args: string[], input = '', timeout = 180_000): Promise<string> => new Promise((accept, reject) => {
    const child = execFile(python, ['-X', 'utf8', ...args], {
      timeout, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', TMPDIR: temporary, TEMP: temporary, TMP: temporary }
    }, (error, stdout) => error ? reject(error) : accept(stdout))
    child.stdin?.end(input)
  })
  const privatePython = await prepareMacProductPython(root, 11, run, message => console.log(message))
  assert.equal(privatePython, join(root, 'runtime', 'python', 'bin', 'python3'))
  const reused = await prepareMacProductPython(root, 11, run)
  assert.equal(reused, privatePython)
  // An unavailable system interpreter is intentional: the app's real extension
  // installer must use the product-private runtime, not framework/Homebrew Python.
  const extensionPython = await installOnDemandExtensions({ dailyProviders: ['akshare'], reportProviders: [],
    wencaiEnabled: false, pythonPath: '' }, 'missing-system-python', root, run)
  const result = JSON.parse(await run(extensionPython, ['-I', '-B', '-c',
    'import sys,json,platform,akshare,importlib.metadata; print(json.dumps({"base":sys.base_prefix,"prefix":sys.prefix,"version":sys.version.split()[0],"machine":platform.machine(),"akshare":importlib.metadata.version("akshare")}))']))
  assert.equal(resolve(result.base), join(root, 'runtime', 'python'))
  assert.equal(result.akshare, '1.19.1')
  assert.equal(result.machine, process.arch === 'arm64' ? 'arm64' : 'x86_64')
  const evidence = { ok: true, sourceCommit: process.env.GITHUB_SHA, architecture: process.arch,
    pythonVersion: result.version, akshareVersion: result.akshare,
    privateRuntimeCreated: true, existingRuntimeReused: true, missingSystemPythonAccepted: true,
    actualExtensionInstallerUsed: true, actualAkshareImportPassed: true,
    liveDataApiTested: false, packagedGuiTested: false, brokerageConnected: false }
  await writeFile(receipt!, JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence))
}

app.whenReady().then(main).then(() => app.exit(0)).catch(async error => {
  console.error(error)
  await writeFile(receipt!, JSON.stringify({ ok: false, sourceCommit: process.env.GITHUB_SHA,
    architecture: process.arch, error: String(error?.message ?? error) }, null, 2) + '\n').catch(() => {})
  app.exit(1)
})
