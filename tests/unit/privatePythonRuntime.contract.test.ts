import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, symlinkSync, readdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { PrivatePythonRuntimeManifest, PrivateRuntimeFile, PrivateRuntimeWheel } from '../../electron/shared/privatePythonRuntimeTypes'
import { hash, validateManifestShape, validateRuntimeTree, validateLock, readValidatedRuntime } from '../../electron/shared/privatePythonRuntimeManifest.cjs'
import { privateProviderForOperation, privatePythonInvocation, resolvePrivatePythonRuntime } from '../../electron/main/services/privatePythonRuntimeResolver'

const state = vi.hoisted(() => ({ packaged: true, userData: '', calls: [] as Array<{ executable: string; args: string[]; options: any; input: string }> }))
vi.mock('electron', () => ({ app: { get isPackaged() { return state.packaged }, getPath: () => state.userData } }))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn((executable: string, args: string[], options: any) => {
      const child = new EventEmitter() as any
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.stdin = new EventEmitter()
      child.kill = vi.fn()
      child.stdin.end = (input: string) => {
        state.calls.push({ executable, args, options, input })
        const provider = args[args.length - 2]
        const request = JSON.parse(input).request
        const versions = { akshare: '1.19.1', mootdx: '0.11.7+rt.1', pywencai: '0.13.1' }
        const data = request.operation === 'status'
          ? { python: fixturePythonVersion, packages: { [provider]: versions[provider as keyof typeof versions] } }
          : [{ provider, name: '\u4e2d\u6587\u884c', volume: 0 }]
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true, data })))
          child.emit('close', 0)
        })
      }
      return child
    }),
  }
})
import { callPythonDataSource, installSelectedDataSourceExtensions } from '../../electron/main/services/pythonDataSourceBridge'

const require = createRequire(import.meta.url)
const { assemble } = require('../../scripts/bundle-private-python-runtime.cjs')
const { nativeTarget, withPrivatePythonRuntime, withPrivatePythonPostPackValidation } = require('../../scripts/private-python-runtime-builder.cjs')
const sourceBootstrap = readFileSync(resolve('resources/python-runtime/bootstrap.py'))
const sourceMiniRacerAdapter = readFileSync(resolve('resources/python-runtime/miniracer_unicode_adapter.py'))
const sourceHolidayDecoder = readFileSync(resolve('tests/fixtures/runtime/mootdx-holiday.original.js'))
const sourcePreparationPolicy = readFileSync(resolve('resources/python-runtime/preparation.policy.json'))
const fixturePythonVersion: string = JSON.parse(sourcePreparationPolicy.toString('utf8')).targets['win32-x64'].python.version
const sourceAuditValidator = readFileSync(resolve('electron/shared/privatePythonRuntimeManifest.cjs'))
const sourcePreparationGenerator = readFileSync(resolve('scripts/prepare-private-python-runtime.py'))
const mootdxRecipe = { path: 'scripts/build-mootdx-compat-wheel.py' as const,
  sha256: hash(readFileSync(resolve('scripts/build-mootdx-compat-wheel.py'))) }
let owned: string
let resources: string
let runtimeRoot: string
let manifest: PrivatePythonRuntimeManifest
let originalResources: PropertyDescriptor | undefined

function executable(platform: string, arch: string) {
  const bytes = Buffer.alloc(128)
  if (platform === 'win32') {
    bytes.writeUInt16LE(0x5a4d, 0)
    bytes.writeUInt32LE(64, 0x3c)
    bytes.writeUInt32LE(0x00004550, 64)
    bytes.writeUInt16LE(0x8664, 68)
  } else {
    bytes.writeUInt32LE(0xfeedfacf, 0)
    bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4)
  }
  return bytes
}

function fixture(root: string, platform: 'win32' | 'darwin' = 'win32', arch: 'x64' | 'arm64' = 'x64') {
  // Owned synthetic fixtures are contract inputs, NOT PBS/provider-release evidence.
  const files: PrivateRuntimeFile[] = []
  function file(name: string, content: string | Buffer) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
    mkdirSync(join(root, name, '..'), { recursive: true })
    writeFileSync(join(root, name), bytes)
    files.push({ path: name, kind: 'file', sha256: hash(bytes), size: bytes.length })
    return hash(bytes)
  }
  mkdirSync(root, { recursive: true })
  const pythonExe = platform === 'win32' ? 'python/python.exe' : 'python/bin/python3.13'
  const nodeExe = platform === 'win32' ? 'node/node.exe' : 'node/bin/node'
  const pythonExecutableSha = file(pythonExe, executable(platform, arch))
  file(nodeExe, executable(platform, arch))
  chmodSync(join(root, pythonExe), 0o755)
  chmodSync(join(root, nodeExe), 0o755)
  file('bootstrap.py', sourceBootstrap)
  const auditValidatorSha = file('private_runtime_manifest.cjs', sourceAuditValidator)
  const adapterSha = file('miniracer_unicode_adapter.py', sourceMiniRacerAdapter)
  const licenseSha = file('licenses/FIXTURE.txt', 'LicenseRef-Test-Fixture. Not a distributable dependency license.\n')
  const license = { approvalId: 'synthetic-contract-only-not-release-approval', spdx: 'LicenseRef-Test-Fixture', path: 'licenses/FIXTURE.txt', sha256: licenseSha, review: 'approved' as const }
  const asset = (filename: string) => ({ kind: 'download' as const, filename, url: 'https://example.invalid/' + filename, sha256: hash(filename), size: filename.length })
  const wheel = (provider: string, distribution: string, version: string, dependencies: string[] = []): PrivateRuntimeWheel => {
    const requiresDist = dependencies.map(name => name + '==0.12.4')
    const metadataPath = 'providers/' + provider + '/site/' + distribution.replace(/-/g, '_') + '-' + version + '.dist-info/METADATA'
    const metadataSha = file(metadataPath, 'Metadata-Version: 2.3\nName: ' + distribution + '\nVersion: ' + version + '\nRequires-Python: >=3.13\n' +
      requiresDist.map(requirement => 'Requires-Dist: ' + requirement + '\n').join('') + '\n')
    file(metadataPath.replace(/METADATA$/, 'WHEEL'), 'Wheel-Version: 1.0\nTag: py3-none-any\n\n')
    return { distribution, version, dependencies, requiresDist, requiresPython: '>=3.13', tags: ['py3-none-any'],
      metadata: { path: metadataPath, sha256: metadataSha },
      asset: asset(distribution.replace(/-/g, '_') + '-' + version + '-py3-none-any.whl'), licenses: [license] }
  }
  const mootdxUpstream = { ...asset('mootdx-0.11.7-py3-none-any.whl'),
    sha256: 'eab475f1d08b1c71ea51212c8b1b1038c4739798f7d95ad1a6fb7bb26e348ef2' }
  const mootdx: PrivateRuntimeWheel = { ...wheel('mootdx', 'mootdx', '0.11.7+rt.1', ['mini-racer']),
    asset: { kind: 'derived', filename: 'mootdx-0.11.7+rt.1-py3-none-any.whl',
      sha256: '35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77', size: 413852 },
    derived: { id: 'fixture-mootdx-compat', upstreamVersion: '0.11.7', upstreamSha256: mootdxUpstream.sha256,
      patchSha256: mootdxRecipe.sha256, upstreamAsset: mootdxUpstream, recipe: mootdxRecipe } }
  const auditPlaceholder = (provider: string) => ({ path: 'providers/' + provider + '/dependency-audit.json',
    sha256: hash('unwritten-synthetic-audit'), format: 'rt-private-provider-dependency-audit-v1' as const })
  const providers = {
    akshare: { version: '1.19.1', site: 'providers/akshare/site', dependencyAudit: auditPlaceholder('akshare'), wheels: [wheel('akshare', 'akshare', '1.19.1', ['mini-racer']), wheel('akshare', 'mini-racer', '0.12.4')] },
    mootdx: { version: '0.11.7+rt.1', site: 'providers/mootdx/site', dependencyAudit: auditPlaceholder('mootdx'), compatibility: 'modern-mini-racer' as const, wheels: [mootdx, wheel('mootdx', 'mini-racer', '0.12.4')] },
    pywencai: { version: '0.13.1', site: 'providers/pywencai/site', dependencyAudit: auditPlaceholder('pywencai'), wheels: [wheel('pywencai', 'pywencai', '0.13.1')] },
  }
  for (const provider of Object.keys(providers)) {
    const site = 'providers/' + provider + '/site/'
    file(site + 'fixture_provider.py', 'VALUE = "' + provider + '"\n')
    if (provider === 'pywencai') continue
    if (provider === 'mootdx') file(site + 'mootdx/utils/holiday.js', sourceHolidayDecoder)
    file(site + 'py_mini_racer/_dll.py', String.raw`
from pathlib import Path
def _open_resource_file(filename, stack):
    return str(Path(__file__).parent / filename)
`)
    file(site + 'py_mini_racer/__init__.py', String.raw`
import contextlib
from . import _dll
class MiniRacer:
    initialized = False
    def __enter__(self):
        if not MiniRacer.initialized:
            with contextlib.ExitStack() as stack:
                for filename in ("mini_racer.dll", "icudtl.dat", "snapshot_blob.bin"):
                    _dll._open_resource_file(filename, stack)
            MiniRacer.initialized = True
        return self
    def eval(self, expression):
        if "Intl.DateTimeFormat" in expression:
            return True
        if expression.startswith("JSON.stringify(d("):
            return '["1990-12-19"]' if "LC/AAAAAAA" in expression else '["1990-12-20"]'
        return "\u4e2d\u6587" if expression.startswith("'") else 42
    def __exit__(self, *args):
        return False
`)
    for (const resource of ['mini_racer.dll', 'icudtl.dat', 'snapshot_blob.bin']) {
      file(site + 'py_mini_racer/' + resource, 'OWNED-CONTRACT-FIXTURE-NOT-NATIVE-V8\n')
    }
  }
  // Synthetic closure facts bind the fixture's actual metadata bytes and graph.
  // No provider, PBS, pip or marker evaluator is executed or certified here.
  const environment = { implementation_name: 'cpython', implementation_version: fixturePythonVersion,
    os_name: platform === 'win32' ? 'nt' : 'posix', platform_machine: platform === 'win32' ? 'AMD64' : arch === 'arm64' ? 'arm64' : 'x86_64',
    platform_python_implementation: 'CPython', platform_release: 'contract-fixture', platform_system: platform === 'win32' ? 'Windows' : 'Darwin',
    platform_version: 'contract-fixture', python_full_version: fixturePythonVersion, python_version: '3.13', sys_platform: platform }
  const packaging = { id: 'pip-vendored-packaging', version: 'synthetic-fixture', sourceSha256: hash('synthetic-fixture-packaging') }
  for (const [provider, lock] of Object.entries(providers)) {
    const installed = lock.wheels.map(w => ({ name: w.distribution, version: w.version,
      metadataPath: w.metadata.path, metadataSha256: w.metadata.sha256, rawRequiresDist: w.requiresDist }))
    const extras = Object.fromEntries(lock.wheels.map(w => [w.distribution, []]))
    const evaluations = lock.wheels.flatMap(w => w.requiresDist.map((requirement, requiresDistIndex) => ({
      from: w.distribution, requiresDistIndex, requirement, to: w.dependencies[requiresDistIndex], extras: [], active: true })))
    const activeRequiresDist = evaluations.map(e => ({ from: e.from, requiresDistIndex: e.requiresDistIndex, requirement: e.requirement, dependencyName: e.to }))
    const closurePath = 'providers/' + provider + '/installed-closure.json'
    const closureSha = file(closurePath, JSON.stringify({ python: fixturePythonVersion, distributionCount: installed.length,
      installedMetadataVerified: true, environment, extras, packaging, evaluations, activeRequiresDist,
      installed: installed.map(row => ({ ...row, metadataPath: row.metadataPath.slice(lock.site.length + 1) })) }))
    lock.dependencyAudit.sha256 = file(lock.dependencyAudit.path, JSON.stringify({ schemaVersion: 1,
      kind: lock.dependencyAudit.format, provider, target: platform + '-' + arch, site: lock.site, roots: [provider + '==' + lock.version],
      generator: { id: 'rt-private-python-prep-closure-v1', scriptSha256: hash(sourcePreparationGenerator) },
      toolchain: { pythonAssetSha256: asset('fixture-python.tar.gz').sha256, executableSha256: pythonExecutableSha,
        pipVersion: 'synthetic-fixture', pipMetadataSha256: hash('synthetic-fixture-pip'), packaging },
      markerEnvironment: environment, activatedExtras: extras, installed, evaluations, resolvedEdges: activeRequiresDist,
      installedClosure: { path: closurePath, sha256: closureSha },
      wheels: lock.wheels.map(w => ({ name: w.distribution, version: w.version, wheelSha256: w.asset.sha256,
        metadataPath: w.metadata.path, metadataSha256: w.metadata.sha256, requiresDist: w.requiresDist, requiresPython: w.requiresPython, tags: w.tags })) }))
  }
  const sbomSha = file('sbom.spdx.json', JSON.stringify({
    spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT',
    packages: [{ name: 'python', versionInfo: fixturePythonVersion }, { name: 'node', versionInfo: '22.23.3' },
      ...Object.values(providers).flatMap(p => p.wheels.map(w => ({ name: w.distribution, versionInfo: w.version })))],
  }))
  const value: PrivatePythonRuntimeManifest = {
    schemaVersion: 1, kind: 'rt-private-python-runtime', complete: true, platform, arch, sourceLockSha256: hash('fixture-lock'),
    preparationPolicySha256: hash(sourcePreparationPolicy),
    python: { distribution: 'python-build-standalone', version: fixturePythonVersion, executable: pythonExe, asset: asset('fixture-python.tar.gz'), licenses: [license] },
    node: { version: '22.23.3', executable: nodeExe, asset: asset('fixture-node.zip'), licenses: [license] },
    bootstrap: 'bootstrap.py',
    dependencyAuditValidator: { path: 'private_runtime_manifest.cjs', sha256: auditValidatorSha },
    miniRacerAdapter: { path: 'miniracer_unicode_adapter.py', version: '0.12.4', sha256: adapterSha, windowsStrategy: 'win32-unicode-resource-prewarm-v1' },
    ...(platform === 'darwin' ? { minimumMacOS: '12.0' as const } : {}),
    providers, sbom: { path: 'sbom.spdx.json', sha256: sbomSha, format: 'SPDX-2.3' }, files,
  }
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(value))
  return value
}

function numpyFixture(root: string, value: PrivatePythonRuntimeManifest, version: string, asset: PrivateRuntimeWheel['asset']) {
  const metadataPath = 'providers/akshare/site/numpy-' + version + '.dist-info/METADATA'
  const tags = [asset.filename.slice(0, -4).split('-').slice(-3).join('-')]
  const metadata = Buffer.from('Metadata-Version: 2.3\nName: numpy\nVersion: ' + version + '\nRequires-Python: >=3.13\n\n')
  const wheel = Buffer.from('Wheel-Version: 1.0\nTag: ' + tags[0] + '\n\n')
  for (const [path, bytes] of [[metadataPath, metadata], [metadataPath.replace(/METADATA$/, 'WHEEL'), wheel]] as const) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), bytes)
    value.files.push({ path, kind: 'file', sha256: hash(bytes), size: bytes.length })
  }
  value.providers.akshare.wheels.push({ distribution: 'numpy', version, dependencies: [], requiresDist: [],
    requiresPython: '>=3.13', tags, metadata: { path: metadataPath, sha256: hash(metadata) },
    asset, licenses: value.providers.akshare.wheels[0].licenses })
}

function isolatedNativeFixture(root: string) {
  // Real interpreter/Node, synthetic provider modules and closure facts. This is
  // explicitly NOT a complete manifest, native V8 proof or release approval.
  const value: any = fixture(root, process.platform as 'win32' | 'darwin', process.arch as 'x64' | 'arm64')
  const python = process.env.DATA_SOURCE_NATIVE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  rmSync(join(root, 'python'), { recursive: true })
  const stage = spawnSync(python, ['-X', 'utf8', '-I', '-S', '-B', '-c', String.raw`
import json, pathlib, shutil, sys, sysconfig
root = pathlib.Path(sys.argv[1]) / 'python'
root.mkdir()
stdlib = pathlib.Path(sysconfig.get_path('stdlib'))
target = root / ('Lib' if sys.platform == 'win32' else 'lib/python3.13')
shutil.copytree(stdlib, target, ignore=shutil.ignore_patterns('site-packages', 'dist-packages', '__pycache__', '*.pyc', 'test', 'tests', 'ensurepip'))
prefix = pathlib.Path(sys.base_prefix)
if sys.platform == 'win32':
    executable = root / 'python.exe'
    for library in prefix.glob('*.dll'):
        shutil.copy2(library, root / library.name)
    if (prefix / 'DLLs').is_dir():
        shutil.copytree(prefix / 'DLLs', root / 'DLLs', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    paths = [root / 'python313.zip', root / 'DLLs', target, root]
else:
    executable = root / 'bin/python3.13'
    executable.parent.mkdir()
    for library in (prefix / 'lib').glob('*.dylib'):
        shutil.copy2(library, root / 'lib' / library.name)
    paths = [root / 'lib/python313.zip', target, target / 'lib-dynload']
shutil.copy2(sys.executable, executable)
print(json.dumps({'version': '.'.join(map(str, sys.version_info[:3])), 'executable': str(executable), 'paths': list(map(str, paths))}))
`, root], { shell: false, windowsHide: true, encoding: 'utf8', timeout: 120_000 })
  expect(stage.error).toBeUndefined()
  expect(stage.status, stage.stderr).toBe(0)
  const native = JSON.parse(stage.stdout)
  expect(native.version).toMatch(/^3\.13\.\d+$/)
  value.python.version = native.version
  value.node.version = process.versions.node
  copyFileSync(process.execPath, join(root, value.node.executable))
  chmodSync(join(root, value.node.executable), 0o755)
  const executableSha = hash(readFileSync(native.executable))
  for (const [provider, lock] of Object.entries(value.providers) as Array<[string, any]>) {
    const auditPath = join(root, lock.dependencyAudit.path)
    const audit = JSON.parse(readFileSync(auditPath, 'utf8'))
    const closurePath = join(root, audit.installedClosure.path)
    const closure = JSON.parse(readFileSync(closurePath, 'utf8'))
    audit.toolchain.executableSha256 = executableSha
    audit.markerEnvironment.implementation_version = native.version
    audit.markerEnvironment.python_full_version = native.version
    closure.python = native.version
    closure.environment = audit.markerEnvironment
    const closureBytes = Buffer.from(JSON.stringify(closure))
    writeFileSync(closurePath, closureBytes)
    audit.installedClosure.sha256 = hash(closureBytes)
    const auditBytes = Buffer.from(JSON.stringify(audit))
    writeFileSync(auditPath, auditBytes)
    lock.dependencyAudit.sha256 = hash(auditBytes)
    const packageRoot = join(root, lock.site, provider)
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(join(packageRoot, '__init__.py'), String.raw`
import pathlib, sys
assert (sys.flags.isolated, sys.flags.utf8_mode, sys.flags.no_site, sys.flags.dont_write_bytecode) == (1, 1, 1, 1)
sites = [pathlib.Path(p).resolve() for p in sys.path if '/providers/' in p.replace('\\', '/')]
assert sites == [pathlib.Path(__file__).resolve().parent.parent]
`)
    if (provider === 'mootdx') {
      writeFileSync(join(packageRoot, 'quotes.py'), 'class Quotes: pass\n')
      writeFileSync(join(packageRoot, 'reader.py'), 'class Reader: pass\n')
    }
  }
  delete value.complete
  value.kind = 'rt-private-python-bootstrap-test-fixture'
  value.releaseEligible = false
  value.treeRoot = root
  value.fixtureCacheRoot = join(owned, 'explicit-fixture-cache')
  value.bootstrapSourceSha256 = hash(sourceBootstrap)
  value.dependencyAuditGeneratorSha256 = hash(sourcePreparationGenerator)
  value.files = []
  function inventory(directory: string, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + entry.name
      if (path === 'manifest.json') continue
      if (entry.isDirectory()) inventory(join(directory, entry.name), path + '/')
      else {
        expect(entry.isSymbolicLink()).toBe(false)
        const bytes = readFileSync(join(directory, entry.name))
        value.files.push({ path, kind: 'file', sha256: hash(bytes), size: bytes.length })
      }
    }
  }
  inventory(root)
  const harness = String.raw`
import json, runpy, sys
bootstrap, manifest, provider, digest, paths = sys.argv[1:]
sys.path = json.loads(paths)
sys.argv = [bootstrap, '--isolated-test-fixture', manifest, provider, digest]
runpy.run_path(bootstrap, run_name='__main__')
`
  function run(provider: string, input = value) {
    const raw = Buffer.from(JSON.stringify(input))
    writeFileSync(join(root, 'manifest.json'), raw)
    return spawnSync(native.executable, ['-X', 'utf8', '-I', '-S', '-B', '-c', harness,
      resolve('resources/python-runtime/bootstrap.py'), join(root, 'manifest.json'), provider, hash(raw), JSON.stringify(native.paths)], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 30_000,
    })
  }
  return { value, run }
}

beforeEach(() => {
  owned = mkdtempSync(join(tmpdir(), 'rt-private-runtime-contract-'))
  resources = join(owned, 'resources')
  runtimeRoot = join(resources, 'private-python-runtime')
  state.userData = join(owned, 'user-data')
  state.packaged = true
  state.calls = []
  manifest = fixture(runtimeRoot)
  originalResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resources })
})
afterEach(() => {
  if (originalResources) Object.defineProperty(process, 'resourcesPath', originalResources)
  else Reflect.deleteProperty(process, 'resourcesPath')
  const root = resolve(owned)
  if (!root.startsWith(resolve(tmpdir()) + '\\') && !root.startsWith(resolve(tmpdir()) + '/')) throw new Error('unsafe fixture cleanup')
  if (!root.split(/[\\/]/).pop()?.startsWith('rt-private-runtime-contract-')) throw new Error('unsafe fixture cleanup')
  rmSync(root, { recursive: true, force: true })
})

describe('private Python complete offline contract', () => {
  it('registers the real Franklin patch while retaining native packager versions', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'))
    const lock = builderRequire('js-yaml').load(readFileSync(resolve('pnpm-lock.yaml'), 'utf8'))
    expect(pkg.version).toBe('1.7.0')
    expect(pkg.pnpm.patchedDependencies['app-builder-lib@24.13.3']).toBe('patches/app-builder-lib@24.13.3.patch')
    expect(lock.patchedDependencies['app-builder-lib@24.13.3'].path).toBe('patches/app-builder-lib@24.13.3.patch')
    expect(lock.patchedDependencies['app-builder-lib@24.13.3'].hash).toMatch(/^[a-f0-9]{64}$/)
    expect(lock.importers['.'].devDependencies['electron-builder'].version.split('(')[0]).toBe('24.13.3')
    expect(lock.importers['.'].devDependencies.electron.version).toBe('41.1.0')
    expect(lock.importers['.'].dependencies['better-sqlite3'].version).toBe('12.8.0')
  })
  it('validates a complete, explicitly synthetic three-provider fixture', () => {
    expect(readValidatedRuntime(runtimeRoot, 'win32-x64').manifest.providers.mootdx.version).toBe('0.11.7+rt.1')
  })
  it.each(['win32-x64', 'darwin-arm64', 'darwin-x64'])('requires matching target metadata and checks host-native permissions %s', target => {
    const [platform, arch] = target.split('-') as ['win32' | 'darwin', 'x64' | 'arm64']
    const root = join(owned, target)
    const value = fixture(root, platform, arch)
    expect(validateManifestShape(value, target).arch).toBe(arch)
    if (platform === process.platform) expect(validateRuntimeTree(root, value, target).arch).toBe(arch)
  })
  it('rejects a wrong architecture even if its file hash is valid', () => {
    manifest.arch = 'arm64'
    manifest.platform = 'darwin'
    manifest.minimumMacOS = '12.0'
    expect(() => validateRuntimeTree(runtimeRoot, manifest, 'darwin-arm64')).toThrow(/architecture/)
  })
  it('does not approve the pending template as a lock', () => {
    expect(() => validateLock(JSON.parse(readFileSync(resolve('resources/python-runtime/runtime.lock.template.json'), 'utf8')))).toThrow('PRIVATE_RUNTIME_PENDING')
  })
  it.each(['akshare', 'mootdx', 'pywencai'] as const)('does not delete missing provider %s from the product', provider => {
    delete (manifest.providers as Partial<typeof manifest.providers>)[provider]
    expect(() => validateManifestShape(manifest)).toThrow(/all providers/)
  })
  it.each(['python', 'node'] as const)('requires exact %s asset hashes', runtime => {
    manifest[runtime].asset.sha256 = '0'.repeat(64)
    expect(() => validateManifestShape(manifest)).toThrow(/pinned/)
  })
  it('requires URL asset names to agree', () => {
    manifest.python.asset.url = 'https://example.invalid/other.tar.gz'
    expect(() => validateManifestShape(manifest)).toThrow(/URL\/name/)
  })
  it('binds the product MiniRacer adapter to the complete file inventory', () => {
    manifest.miniRacerAdapter.sha256 = hash('changed-adapter')
    expect(() => validateManifestShape(manifest)).toThrow(/adapter missing/)
  })
  it('accepts only MiniRacer 0.12.4, not a silently upgraded wheel', () => {
    manifest.providers.akshare.wheels[1].version = '0.12.5'
    expect(() => validateManifestShape(manifest)).toThrow(/MiniRacer/)
  })
  it('does not treat pending asset pins as a release lock', () => {
    const pins = JSON.parse(readFileSync(resolve('resources/python-runtime/asset-pins.pending.json'), 'utf8'))
    expect(pins.pythonAssets['win32-x64'].sha256).toBe('5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778')
    expect(pins.nodeVersion).toBe('22.23.3')
    expect(pins.nodeAssets['darwin-arm64'].sha256).toBe('23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53')
    expect(() => validateLock(pins)).toThrow('PRIVATE_RUNTIME_PENDING')
  })
  it('rejects macOS 14-only NumPy wheels without raising the minimum OS', () => {
    const root = join(owned, 'mac-fixture')
    const value = fixture(root, 'darwin', 'arm64')
    const filename = 'numpy-2.0.0-cp313-cp313-macosx_14_0_arm64.whl'
    numpyFixture(root, value, '2.0.0', { kind: 'download', filename,
      url: 'https://example.invalid/' + filename, sha256: hash(filename), size: filename.length })
    expect(value.minimumMacOS).toBe('12.0')
    expect(() => validateManifestShape(value)).toThrow(/platform/)
  })
  it.each(['darwin-arm64', 'darwin-x64'])('accepts only the explicit NumPy 2.5.3 compatible target %s', target => {
    const pins = JSON.parse(readFileSync(resolve('resources/python-runtime/asset-pins.pending.json'), 'utf8'))
    const arch = target === 'darwin-arm64' ? 'arm64' : 'x64'
    const root = join(owned, 'numpy-' + arch)
    const value = fixture(root, 'darwin', arch)
    numpyFixture(root, value, '2.5.3', { ...pins.nativeWheelCandidates.numpy[target], kind: 'download' })
    expect(validateManifestShape(value, target).minimumMacOS).toBe('12.0')
  })
  it('pins private Node without upgrading the Node 20 buildchain', () => {
    manifest.node.version = '20.18.0'
    expect(() => validateManifestShape(manifest)).toThrow(/identity mismatch/)
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    expect(pkg.engines.node).toBe('>=20.0.0 <21')
  })
  it('requires all dependency edges to resolve within the provider site', () => {
    manifest.providers.pywencai.wheels[0].dependencies.push('missing-dependency')
    expect(() => validateManifestShape(manifest)).toThrow(/closure/)
  })
  it('rejects an incompatible wheel ABI', () => {
    const asset = manifest.providers.pywencai.wheels[0].asset
    asset.filename = 'pywencai-0.13.1-cp312-cp312-win_amd64.whl'
    asset.url = 'https://example.invalid/' + asset.filename
    expect(() => validateManifestShape(manifest)).toThrow(/ABI/)
  })
  it('rejects an incompatible native wheel target', () => {
    const asset = manifest.providers.akshare.wheels[1].asset
    asset.filename = 'mini_racer-0.12.4-py3-none-macosx_11_0_arm64.whl'
    asset.url = 'https://example.invalid/' + asset.filename
    expect(() => validateManifestShape(manifest)).toThrow(/platform/)
  })
  it('requires the derived mootdx version, not the unchanged upstream identity', () => {
    manifest.providers.mootdx.version = '0.11.7'
    manifest.providers.mootdx.wheels[0].version = '0.11.7'
    expect(() => validateManifestShape(manifest)).toThrow(/derived wheel pending/)
  })
  it('requires explicit upstream and patch hashes for the derivative', () => {
    manifest.providers.mootdx.wheels[0].derived!.patchSha256 = ''
    expect(() => validateManifestShape(manifest)).toThrow(/derived wheel identity/)
  })
  it('requires the real derivative wheel SHA and byte size', () => {
    manifest.providers.mootdx.wheels[0].asset.sha256 = hash('different-wheel')
    expect(() => validateManifestShape(manifest)).toThrow(/derived wheel pending/)
  })
  it('rejects the original conflicting py-mini-racer distribution', () => {
    manifest.providers.mootdx.wheels[1].distribution = 'py-mini-racer'
    manifest.providers.mootdx.wheels[0].dependencies = ['py-mini-racer']
    expect(() => validateManifestShape(manifest)).toThrow(/MiniRacer/)
  })
  it('requires license review evidence', () => {
    manifest.node.licenses[0].review = 'pending' as 'approved'
    expect(() => validateManifestShape(manifest)).toThrow(/reviewed/)
  })
  it('requires SPDX coverage of every locked component', () => {
    const bytes = Buffer.from(JSON.stringify({ spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT', packages: [] }))
    writeFileSync(join(runtimeRoot, manifest.sbom.path), bytes)
    manifest.sbom.sha256 = hash(bytes)
    Object.assign(manifest.files.find(f => f.path === manifest.sbom.path)!, { sha256: hash(bytes), size: bytes.length })
    expect(() => validateRuntimeTree(runtimeRoot, manifest)).toThrow(/SBOM component/)
  })
  it.each(['data/trade.db', 'providers/akshare/site/.env', 'providers/mootdx/site/accounts.json'])('rejects data or credentials path %s', name => {
    manifest.files.push({ path: name, kind: 'file', sha256: hash('private'), size: 7 })
    expect(() => validateManifestShape(manifest)).toThrow(/non-runtime file/)
  })
  it('rejects modified payload bytes', () => {
    writeFileSync(join(runtimeRoot, 'providers/akshare/site/fixture_provider.py'), 'tampered')
    expect(() => validateRuntimeTree(runtimeRoot, manifest)).toThrow(/file mismatch/)
  })
  it('rejects files not listed by the lock', () => {
    writeFileSync(join(runtimeRoot, 'unlisted.txt'), 'unexpected')
    expect(() => validateRuntimeTree(runtimeRoot, manifest)).toThrow(/unlisted/)
  })
  it('rejects case-folded duplicate paths', () => {
    manifest.files.push({ ...manifest.files[0], path: manifest.files[0].path.toUpperCase() })
    expect(() => validateManifestShape(manifest)).toThrow()
  })
  it('rejects symlinks escaping the runtime', () => {
    manifest.files.push({ path: 'python/escape', kind: 'symlink', target: '../../outside' })
    expect(() => validateManifestShape(manifest)).toThrow(/escaping/)
  })
  it('accepts contained executable symlinks, never external interpreter links', () => {
    // Windows CI can lack symlink privileges; manifest traversal coverage is platform-independent.
    if (process.platform === 'win32') {
      manifest.files.push({ path: 'python/alias', kind: 'symlink', target: 'python.exe' })
      expect(validateManifestShape(manifest)).toBe(manifest)
    } else {
      symlinkSync('python.exe', join(runtimeRoot, 'python/alias'))
      manifest.files.push({ path: 'python/alias', kind: 'symlink', target: 'python.exe' })
      expect(validateRuntimeTree(runtimeRoot, manifest)).toBe(manifest)
    }
  })
  it('fails before creating output for an unfinished lock', () => {
    const lock = join(owned, 'pending.json')
    writeFileSync(lock, JSON.stringify({ status: 'pending' }))
    const output = join(owned, 'output')
    expect(() => assemble({ lockPath: lock, preparedRoot: owned, assetsRoot: owned, outputRoot: output, target: 'win32-x64' })).toThrow('PRIVATE_RUNTIME_PENDING')
    expect(existsSync(output)).toBe(false)
  })
  it.each([
    ['akshare-daily', 'akshare'], ['akshare-limit-pool', 'akshare'], ['akshare-reports', 'akshare'],
    ['tdx-daily', 'mootdx'], ['iwencai', 'pywencai'],
  ])('maps only supported operation %s to %s', (operation, provider) => {
    expect(privateProviderForOperation(operation)).toBe(provider)
  })
  it.each([null, 'pip-install', 'status', '../mootdx'])('rejects unsupported provider selection %s', operation => {
    expect(() => privateProviderForOperation(operation)).toThrow('SOURCE_REQUEST_FAILED')
  })
  it('sets isolated flags, private Node and provider-only writable caches', async () => {
    const runtime = resolvePrivatePythonRuntime(resources, 'win32', 'x64')
    const command = await privatePythonInvocation(runtime, 'mootdx', state.userData, 'print(1)', { operation: 'tdx-daily', query: '\u4e2d\u6587' })
    expect(command.args.slice(0, 5)).toEqual(['-I', '-S', '-B', '-X', 'utf8'])
    expect(command.env.PATH).toBe(join(runtimeRoot, 'node'))
    expect(command.env.RT_MOOTDX_CACHE_ROOT).toBe(join(state.userData, 'data-source-cache/bundled/mootdx'))
    expect(command.env.TEMP).toBe(join(command.cwd, 'tmp'))
    expect(command.env.NODE_OPTIONS).toBe('')
    expect(command.input).toContain('\u4e2d\u6587')
    expect(command.args.join(' ')).not.toContain('\u4e2d\u6587')
  })
  it('does not leak parent credential or Python lookup environment', async () => {
    vi.stubEnv('RT_TEST_CREDENTIAL', 'must-not-leak')
    vi.stubEnv('PYTHONPATH', 'hostile-system-site')
    try {
      const command = await privatePythonInvocation(resolvePrivatePythonRuntime(resources, 'win32', 'x64'), 'akshare', state.userData, 'pass', { operation: 'status' })
      expect(command.env.RT_TEST_CREDENTIAL).toBeUndefined()
      expect(command.env.PYTHONPATH).toBe('')
      expect(command.env.RT_MOOTDX_CACHE_ROOT).toBeUndefined()
    } finally { vi.unstubAllEnvs() }
  })
  it('preserves native builder gates and existing resources/hooks', async () => {
    const existing = vi.fn()
    const base = { extraResources: [{ from: 'public-assets', to: 'public-assets' }], beforePack: existing }
    const config = withPrivatePythonRuntime(base)
    expect(config.extraResources[0]).toEqual(base.extraResources[0])
    expect(config.extraResources[1].to).toBe('private-python-runtime')
    expect(() => nativeTarget({ electronPlatformName: 'linux', arch: 'x64' })).toThrow()
    await expect(config.beforePack({ electronPlatformName: process.platform, arch: process.arch })).rejects.toThrow('PRIVATE_RUNTIME_PENDING')
    expect(existing).not.toHaveBeenCalled()
  })
  it('does not bypass Mac signing before the final runtime check', async () => {
    const signing = vi.fn(async () => { throw new Error('SIGNING_FAILED') })
    const config = withPrivatePythonPostPackValidation({ afterPack: signing })
    await expect(config.afterPack({})).rejects.toThrow('SIGNING_FAILED')
    expect(signing).toHaveBeenCalledOnce()
  })
})

describe('actual packaged bridge selection without system fallback', () => {
  const config = { pythonPath: 'Z:/must-never-run/python.exe', dailyProviders: ['akshare', 'tdx'], reportProviders: ['akshare'], wencaiEnabled: true } as any
  beforeEach(() => {
    manifest = fixture(join(owned, 'native-resources/private-python-runtime'), process.platform as 'win32' | 'darwin', process.arch as 'x64' | 'arm64')
    resources = join(owned, 'native-resources')
    runtimeRoot = join(resources, 'private-python-runtime')
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resources })
  })
  it.each(['akshare-limit-pool', 'tdx-daily', 'iwencai'])('uses its own provider site for %s', async operation => {
    const data = await callPythonDataSource(config, { operation, query: '\u4e2d\u6587', cookie: 'fixture-only-cookie' })
    expect(data).toEqual([{ provider: privateProviderForOperation(operation), name: '\u4e2d\u6587\u884c', volume: 0 }])
    const call = state.calls[0]
    expect(call.executable).toBe(join(runtimeRoot, manifest.python.executable))
    expect(call.args.slice(0, 5)).toEqual(['-X', 'utf8', '-I', '-S', '-B'])
    expect(call.options.shell).toBe(false)
    expect(call.args.join(' ')).not.toContain('fixture-only-cookie')
  })
  it('reports independent provider versions without combining their sites', async () => {
    const status = await callPythonDataSource(config, { operation: 'status' })
    expect(status).toEqual({ python: fixturePythonVersion, packages: { akshare: '1.19.1', mootdx: '0.11.7+rt.1', pywencai: '0.13.1' } })
    expect(state.calls.map(c => c.args[c.args.length - 2])).toEqual(['akshare', 'mootdx', 'pywencai'])
  })
  it('fails closed on missing bundle even with a configured system interpreter', async () => {
    rmSync(runtimeRoot, { recursive: true })
    await expect(callPythonDataSource(config, { operation: 'tdx-daily' })).rejects.toThrow('PRIVATE_RUNTIME_PENDING')
    expect(state.calls).toHaveLength(0)
  })
  it('turns the old install entry point into offline validation, never pip', async () => {
    expect(await installSelectedDataSourceExtensions(config)).toBe(join(runtimeRoot, manifest.python.executable))
    expect(state.calls).toHaveLength(3)
    expect(state.calls.every(c => !c.args.includes('pip') && !c.args.includes('venv'))).toBe(true)
  })
})

describe('trusted bootstrap with a real native Python, controlled fixture sites only', () => {
  it('uses real invocation flags for UTF-8 instead of the environment ignored by -I', async () => {
    const python = process.env.DATA_SOURCE_NATIVE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
    // Only exercise invocation arguments/stdio; this descriptor is not a sealed runtime.
    const runtime = { root: runtimeRoot, executable: python, nodeExecutable: join(runtimeRoot, 'node/node.exe'),
      bootstrap: join(owned, 'invocation-probe.py'), manifestPath: join(runtimeRoot, 'manifest.json'),
      manifestSha256: hash('owned-invocation-probe'), manifest }
    const command = await privatePythonInvocation(runtime, 'mootdx', state.userData, 'pass',
      { operation: 'status', query: '\u4e2d\u6587\u96f6\u503c' })
    const flags = command.args.slice(0, command.args.indexOf(runtime.bootstrap))
    expect(flags).toEqual(['-I', '-S', '-B', '-X', 'utf8'])
    const probe = String.raw`
import json, sys
result = {"isolated": sys.flags.isolated, "utf8": sys.flags.utf8_mode,
          "no_site": sys.flags.no_site, "no_bytecode": sys.flags.dont_write_bytecode,
          "stdinEncoding": sys.stdin.encoding, "stdoutEncoding": sys.stdout.encoding}
if sys.flags.utf8_mode != 1:
    print(json.dumps(result))
    raise SystemExit(70)
result["query"] = json.loads(sys.stdin.buffer.read())["request"]["query"]
print(json.dumps(result, ensure_ascii=False))
`
    writeFileSync(runtime.bootstrap, probe, 'utf8')
    const options = { shell: false, windowsHide: true, encoding: 'utf8' as const, timeout: 15_000,
      cwd: command.cwd, env: { ...command.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'cp1252' }, input: command.input }
    // Negative control removes only the interpreter option from the actual command.
    const negative = spawnSync(command.executable, [...command.args.slice(0, 3), ...command.args.slice(5)], options)
    expect(negative.error).toBeUndefined()
    expect(negative.status, negative.stderr).toBe(70)
    expect(JSON.parse(negative.stdout).utf8).toBe(0)
    const positive = spawnSync(command.executable, command.args, options)
    expect(positive.error).toBeUndefined()
    expect(positive.status, positive.stderr).toBe(0)
    expect(positive.stderr).toBe('')
    expect(JSON.parse(positive.stdout)).toEqual({ isolated: 1, utf8: 1, no_site: 1, no_bytecode: 1,
      stdinEncoding: 'utf-8', stdoutEncoding: 'utf-8', query: '\u4e2d\u6587\u96f6\u503c' })
  })
  it('runs the auditable Python adapter contracts in a separate isolated process', () => {
    const python = process.env.DATA_SOURCE_NATIVE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
    const result = spawnSync(python, ['-X', 'utf8', '-I', '-S', '-B', resolve('tests/python/test_private_miniracer_unicode_adapter.py')], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 30_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toMatch(/Ran 20 tests/)
    expect(result.stderr).toMatch(/\bOK\b/)
  })
  it('binds the pywencai child adapter to the actual product source digest', () => {
    const source = readFileSync(resolve('resources/python-runtime/pywencai_adapter.py'))
    const path = 'providers/pywencai/pywencai_adapter.py'
    writeFileSync(join(runtimeRoot, path), source)
    manifest.files.push({ path, kind: 'file', sha256: hash(source), size: source.length })
    writeFileSync(join(runtimeRoot, 'manifest.json'), JSON.stringify(manifest))
    const python = process.env.DATA_SOURCE_NATIVE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
    const probe = String.raw`
import json, pathlib, runpy, sys
bootstrap, root, adapter = sys.argv[1:]
root = pathlib.Path(root)
manifest_path = root / 'manifest.json'
namespace = runpy.run_path(bootstrap, run_name='inventory_contract_only')
index = namespace['check_inventory'](root, json.loads(manifest_path.read_bytes()), manifest_path)
print(json.dumps({'sha256': index[adapter]['sha256']}))
`
    const run = () => spawnSync(python, ['-X', 'utf8', '-I', '-S', '-B', '-c', probe,
      resolve('resources/python-runtime/bootstrap.py'), runtimeRoot, path], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 15_000,
    })
    const positive = run()
    expect(positive.error).toBeUndefined()
    expect(positive.status, positive.stderr).toBe(0)
    expect(JSON.parse(positive.stdout)).toEqual({ sha256: hash(source) })
    const sentinel = join(owned, 'adapter-must-not-execute.txt')
    writeFileSync(join(runtimeRoot, path), `import pathlib\npathlib.Path(${JSON.stringify(sentinel)}).write_text('UNTRUSTED')\n`)
    const tampered = run()
    expect(tampered.error).toBeUndefined()
    expect(tampered.status).toBe(70)
    expect(tampered.stderr.trim()).toBe('PRIVATE_RUNTIME_INVALID')
    expect(tampered.stdout).toBe('')
    expect(existsSync(sentinel)).toBe(false)
  })
  it.each(['threading.py', 'queue.py', 'importlib.py'])('rejects unlisted provider %s before its sentinel executes', filename => {
    const python = process.env.DATA_SOURCE_NATIVE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
    const site = join(runtimeRoot, 'providers/mootdx/site')
    const marker = join(owned, 'must-not-execute.txt')
    writeFileSync(join(site, filename), `import pathlib\npathlib.Path(${JSON.stringify(marker)}).write_text("UNTRUSTED")\nraise RuntimeError("sentinel executed")\n`)
    mkdirSync(join(runtimeRoot, 'python/lib'), { recursive: true })
    // Controlled stdlib stand-in keeps this fixture independent of installed PBS.
    // Eviction makes the old early-site bug observable, even after preloading stdlib.
    const stdThread = Buffer.from('def active_count(): return 1\ndef current_thread(): return None\ndef main_thread(): return None\ndef _shutdown(): pass\n')
    writeFileSync(join(runtimeRoot, 'python/lib/threading.py'), stdThread)
    manifest.files.push({ path: 'python/lib/threading.py', kind: 'file', size: stdThread.length, sha256: hash(stdThread) })
    const raw = Buffer.from(JSON.stringify(manifest))
    writeFileSync(join(runtimeRoot, 'manifest.json'), raw)
    const harness = String.raw`
import contextlib, email.parser, hashlib, importlib, importlib.metadata, io, json, os, pathlib, sys, threading
bootstrap, manifest, digest, root, cache = sys.argv[1:]
source = pathlib.Path(bootstrap).read_text(encoding="utf-8")
sys.argv = [bootstrap, manifest, "mootdx", digest]
sys.path = [str(pathlib.Path(root) / "python" / "lib")]
sys.modules.pop("threading", None)
os.environ["HOME"] = cache
os.environ["RT_MOOTDX_CACHE_ROOT"] = cache
exec(compile(source, bootstrap, "exec"), {"__name__": "__main__"})
`
    const result = spawnSync(python, ['-X', 'utf8', '-I', '-S', '-B', '-c', harness,
      join(runtimeRoot, 'bootstrap.py'), join(runtimeRoot, 'manifest.json'), hash(raw), runtimeRoot, state.userData], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 15_000,
      input: JSON.stringify({ request: { operation: 'status' }, script: 'raise RuntimeError("must not execute provider")' }),
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(70)
    expect(result.stderr.trim()).toBe('PRIVATE_RUNTIME_INVALID')
    expect(result.stdout).toBe('')
    expect(existsSync(marker)).toBe(false)
    expect(existsSync(join(site, '__pycache__'))).toBe(false)
  })
  it.each(['akshare', 'mootdx', 'pywencai'])('enforces %s isolation and new source-hash gates without provider pycache', provider => {
    const controlled = isolatedNativeFixture(runtimeRoot)
    const site = join(runtimeRoot, 'providers', provider, 'site')
    const result = controlled.run(provider)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.kind).toBe('rt-private-python-bootstrap-test-fixture')
    expect(output.releaseEligible).toBe(false)
    expect(output.provider).toBe(provider)
    expect(output.imported).toBe(provider)
    expect(output.dependencyAudits.map((report: { provider: string }) => report.provider)).toEqual(['akshare', 'mootdx', 'pywencai'])
    expect(output.workerPid).toBeGreaterThan(0)
    expect(existsSync(join(site, '__pycache__'))).toBe(false)
    for (const negativeInput of [
      { ...controlled.value, bootstrapSourceSha256: hash('changed-bootstrap') },
      { ...controlled.value, dependencyAuditGeneratorSha256: hash('changed-generator') },
      { ...controlled.value, complete: true },
      { ...controlled.value, releaseEligible: true },
    ]) {
      const negative = controlled.run(provider, negativeInput)
      expect(negative.error).toBeUndefined()
      expect(negative.status).toBe(70)
      expect(negative.stderr.trim()).toBe('PRIVATE_RUNTIME_INVALID')
      expect(negative.stdout).toBe('')
    }
  }, 180_000)
})
