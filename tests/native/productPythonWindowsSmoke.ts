import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { prepareProductPython } from '../../electron/main/services/productPythonRuntime'
import { extensionInstallProgress, installOnDemandExtensions } from '../../electron/main/services/onDemandDataExtensions'

async function main() {
  assert.equal(process.platform, 'win32')
  const requestedRoot = process.env.RT_PRODUCT_PYTHON_TEST_ROOT
  const source = process.env.RT_SHARED_PYTHON_TEST_SOURCE
  const receipt = process.env.RT_PRODUCT_PYTHON_RECEIPT
  assert(requestedRoot && source && receipt, 'Explicit isolated paths are required')
  const root = resolve(requestedRoot)
  assert(!existsSync(join(root, 'runtime')), 'Refuse to count an existing runtime as a fresh-copy test')
  const temporary = join(root, 'data-source-cache', 'tmp')
  await mkdir(temporary, { recursive: true })
  const run = (python: string, args: string[], input = '', timeout = 180_000): Promise<string> => new Promise((accept, reject) => {
    const child = execFile(python, ['-X', 'utf8', ...args], {
      timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', TMPDIR: temporary, TEMP: temporary, TMP: temporary }
    }, (error, stdout) => error ? reject(error) : accept(stdout))
    child.stdin?.end(input)
  })
  console.log(JSON.stringify({ phase: 'copying-private-runtime' }))
  const privatePython = await prepareProductPython(source, root, 11, run)
  assert.equal(privatePython, join(root, 'runtime', 'python', 'python.exe'))
  assert(!existsSync(join(root, 'runtime', 'python', 'Scripts', 'pip.exe')), 'Shared absolute pip launcher must not be copied')
  assert(existsSync(join(root, 'runtime', 'python', 'Lib', 'venv', 'scripts', 'nt', 'activate.bat')), 'Standard venv templates must be retained')
  assert.equal(await prepareProductPython('missing-system-python', root, 11, run), privatePython)
  let previousPhase = ''
  const monitor = setInterval(() => {
    const progress = extensionInstallProgress()
    if (progress.running && progress.phase !== previousPhase) {
      previousPhase = progress.phase
      console.log(JSON.stringify({ phase: progress.phase, provider: progress.provider }))
    }
  }, 1000)
  let extensionPython: string
  try {
    extensionPython = await installOnDemandExtensions({ dailyProviders: ['akshare'], reportProviders: [],
      wencaiEnabled: false, pythonPath: '' }, 'missing-system-python', root, run)
  } finally { clearInterval(monitor) }
  const result = JSON.parse(await run(extensionPython, ['-I', '-B', '-c',
    'import sys,json,ssl,sqlite3,pip,akshare,importlib.metadata; print(json.dumps({"base":sys.base_prefix,"version":sys.version.split()[0],"akshare":importlib.metadata.version("akshare"),"sqlite":sqlite3.sqlite_version}))']))
  assert.equal(resolve(result.base), join(root, 'runtime', 'python'))
  assert.equal(result.akshare, '1.19.1')
  const evidence = { ok: true, architecture: process.arch, hostNodeVersion: process.versions.node,
    pythonVersion: result.version, akshareVersion: result.akshare, sqliteVersion: result.sqlite,
    freshRuntimeCopyPassed: true, sharedPipLaunchersExcluded: true, standardVenvTemplatesRetained: true,
    missingSystemPythonAccepted: true, actualExtensionInstallerUsed: true, actualAkshareImportPassed: true,
    liveDataApiTested: false, productionConfigModified: false, packagedGuiTested: false, brokerageConnected: false }
  await writeFile(receipt, JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
