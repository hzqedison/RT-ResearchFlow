import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const api = require('../../electron/shared/privatePythonRuntimeManifest.cjs')
const FORMAT = 'rt-private-provider-dependency-audit-v1'
const HASH = 'a'.repeat(64), GENERATOR = 'b'.repeat(64)
const roots: string[] = []
const canonical = (value: string) => value.toLowerCase().replace(/[-_.]+/g, '-')
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!path.isAbsolute(root) || !path.basename(root).startsWith('dependency-audit-contract-')) throw new Error('unsafe fixture cleanup')
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// Synthetic receipts test byte/graph bindings, not real PEP508 execution or licensing.
function fixture() {
  const base = process.platform === 'win32' ? 'D:/RT-ResearchFlow-BuildCache' : process.env.RUNNER_TEMP || process.env.TMPDIR || '/tmp'
  fs.mkdirSync(base, { recursive: true })
  const root = fs.mkdtempSync(path.join(base, 'dependency-audit-contract-')); roots.push(root)
  const manifest: any = {
    platform: 'win32', arch: 'x64', python: { version: '3.13.16', executable: 'python/python.exe', asset: { sha256: HASH } },
    providers: {}, files: []
  }
  function write(relative: string, data: string | Buffer) {
    const bytes = Buffer.from(data), filename = path.join(root, relative)
    fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes)
    const row = { path: relative, kind: 'file', size: bytes.length, sha256: api.hash(bytes) }
    const index = manifest.files.findIndex((file: any) => file.path === relative)
    if (index < 0) manifest.files.push(row); else manifest.files[index] = row
    return row.sha256
  }
  const executableSha256 = write('python/python.exe', 'synthetic-executable-not-a-release')
  const environment = {
    implementation_name: 'cpython', implementation_version: '3.13.16', os_name: 'nt', platform_machine: 'AMD64',
    platform_python_implementation: 'CPython', platform_release: '10', platform_system: 'Windows', platform_version: '10.0.19045',
    python_full_version: '3.13.16', python_version: '3.13', sys_platform: 'win32'
  }
  const packaging = { id: 'pip-vendored-packaging', version: '25.0', sourceSha256: HASH }
  const audits: Record<string, any> = {}
  const closures: Record<string, any> = {}
  for (const [provider, version] of [['akshare', '1.19.1'], ['mootdx', '0.11.7+rt.1'], ['pywencai', '0.13.1']]) {
    const site = 'providers/' + provider + '/site'
    const requirement = 'first[deep]>=1.0; sys_platform == "win32"'
    const requirements = provider === 'pywencai' ? [requirement, 'not-on-win>=1; sys_platform == "darwin"', requirement] : []
    const identities = [{ name: provider, version, requiresDist: requirements, dependencies: provider === 'pywencai' ? ['first'] : [] }]
    if (provider === 'pywencai') identities.push(
      { name: 'first', version: '1.5', requiresDist: ['second>=2; extra == "deep"'], dependencies: ['second'] },
      { name: 'second', version: '2.5', requiresDist: [], dependencies: [] }
    )
    const wheels = identities.map(item => {
      const metadataPath = site + '/' + item.name.replace(/-/g, '_') + '-' + item.version + '.dist-info/METADATA'
      const source = 'Metadata-Version: 2.1\nName: ' + item.name + '\nVersion: ' + item.version + '\nRequires-Python: >=3.13\n' + item.requiresDist.map(r => 'Requires-Dist: ' + r + '\n').join('') + '\n'
      const sha256 = write(metadataPath, source)
      write(metadataPath.replace(/METADATA$/, 'WHEEL'), 'Wheel-Version: 1.0\nTag: py3-none-any\n\n')
      return { distribution: item.name, version: item.version, requiresDist: item.requiresDist, requiresPython: '>=3.13', tags: ['py3-none-any'], dependencies: item.dependencies, metadata: { path: metadataPath, sha256 }, asset: { sha256: HASH } }
    })
    const evaluations = provider === 'pywencai' ? [
      { from: 'pywencai', requiresDistIndex: 0, requirement, to: 'first', extras: ['deep'], active: true },
      { from: 'pywencai', requiresDistIndex: 1, requirement: requirements[1], to: 'not-on-win', extras: [], active: false },
      { from: 'pywencai', requiresDistIndex: 2, requirement, to: 'first', extras: ['deep'], active: true },
      { from: 'first', requiresDistIndex: 0, requirement: identities[1].requiresDist[0], to: 'second', extras: [], active: true }
    ] : []
    const activatedExtras = Object.fromEntries(identities.map(item => [item.name, item.name === 'first' ? ['deep'] : []]))
    const installed = wheels.map(wheel => ({ name: canonical(wheel.distribution), version: wheel.version, metadataPath: wheel.metadata.path, metadataSha256: wheel.metadata.sha256, rawRequiresDist: wheel.requiresDist }))
    const closure = { python: '3.13.16', distributionCount: wheels.length, environment, extras: activatedExtras, installed: installed.map(row => ({ ...row, metadataPath: row.metadataPath.slice(site.length + 1) })), evaluations, packaging, installedMetadataVerified: true,
      activeRequiresDist: evaluations.filter(row => row.active).map(row => ({ from: row.from, requiresDistIndex: row.requiresDistIndex, requirement: row.requirement, dependencyName: row.to })) }
    const closurePath = 'providers/' + provider + '/installed-closure.json'
    const closureSha256 = write(closurePath, JSON.stringify(closure))
    const audit = {
      schemaVersion: 1, kind: FORMAT, provider, target: 'win32-x64', site, roots: [provider + '==' + version],
      generator: { id: 'rt-private-python-prep-closure-v1', scriptSha256: GENERATOR },
      toolchain: { pythonAssetSha256: HASH, executableSha256, pipVersion: '26.2.1', pipMetadataSha256: HASH, packaging },
      markerEnvironment: environment, activatedExtras, installed,
      wheels: wheels.map(wheel => ({ name: canonical(wheel.distribution), version: wheel.version, wheelSha256: wheel.asset.sha256, metadataPath: wheel.metadata.path, metadataSha256: wheel.metadata.sha256, requiresDist: wheel.requiresDist, requiresPython: wheel.requiresPython, tags: wheel.tags })),
      evaluations, resolvedEdges: evaluations.filter(row => row.active).map(row => ({ from: row.from, requiresDistIndex: row.requiresDistIndex, requirement: row.requirement, dependencyName: row.to })),
      installedClosure: { path: closurePath, sha256: closureSha256 }
    }
    const auditPath = 'providers/' + provider + '/dependency-audit.json'
    manifest.providers[provider] = { version, site, wheels, dependencyAudit: { path: auditPath, sha256: write(auditPath, JSON.stringify(audit)), format: FORMAT } }
    audits[provider] = audit; closures[provider] = closure
  }
  function save(provider = 'pywencai') {
    const audit = audits[provider]
    audit.installedClosure.sha256 = write(audit.installedClosure.path, JSON.stringify(closures[provider]))
    manifest.providers[provider].dependencyAudit.sha256 = write(manifest.providers[provider].dependencyAudit.path, JSON.stringify(audit))
  }
  return { root, manifest, audits, closures, write, save, validate: () => api.validateDependencyAudits(root, manifest, GENERATOR) }
}

describe('private runtime dependency evidence bindings', () => {
  const nativePython = process.env.RT_TEST_PRIVATE_PYTHON || 'D:/RT-ResearchFlow-BuildCache/private-runtime-1.7/PBS 运行 windows-x64/python/python.exe'
  const nativeNode = process.env.RT_TEST_PRIVATE_NODE || 'D:/RT-ResearchFlow-BuildCache/private-runtime-1.7/node-windows-x64/node-v22.23.3-win-x64/node.exe'
  it.skipIf(!fs.existsSync(nativePython) || !fs.existsSync(nativeNode))('runs the actual shared dependency core via the product bootstrap private-Node boundary with synthetic receipts', () => {
    const f = fixture()
    const nodeName = process.platform === 'win32' ? 'node/node.exe' : 'node/bin/node'
    const copiedNode = path.join(f.root, nodeName)
    fs.mkdirSync(path.dirname(copiedNode), { recursive: true }); fs.copyFileSync(nativeNode, copiedNode)
    const binary = fs.readFileSync(copiedNode)
    f.manifest.files.push({ path: nodeName, kind: 'file', size: binary.length, sha256: api.hash(binary) })
    const version = spawnSync(nativeNode, ['--version'], { shell: false, encoding: 'utf8', timeout: 10000 })
    expect(version.status).toBe(0)
    f.manifest.node = { version: version.stdout.trim().replace(/^v/, ''), executable: nodeName }
    const core = fs.readFileSync(path.resolve('electron/shared/privatePythonRuntimeManifest.cjs'))
    f.manifest.dependencyAuditValidator = { path: 'private_runtime_manifest.cjs', sha256: f.write('private_runtime_manifest.cjs', core) }
    const context = path.join(path.dirname(f.root), path.basename(f.root) + '-context.json')
    fs.writeFileSync(context, JSON.stringify(f.manifest))
    const bootstrap = path.resolve('resources/python-runtime/bootstrap.py')
    const code = 'import json,pathlib,runpy; n=runpy.run_path(' + JSON.stringify(bootstrap) + ',run_name="test"); root=pathlib.Path(' + JSON.stringify(f.root) + '); m=json.loads(pathlib.Path(' + JSON.stringify(context) + ').read_text(encoding="utf-8")); index=n["check_inventory"](root,m,pathlib.Path("absent")); print(json.dumps(n["check_dependency_audits"](root,m,index,' + JSON.stringify(GENERATOR) + ')))'
    try {
      const result = spawnSync(nativePython, ['-X', 'utf8', '-I', '-S', '-B', '-c', code], { shell: false, encoding: 'utf8', timeout: 20000, maxBuffer: 8192 })
      expect(result.error).toBeUndefined()
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual(f.validate())
    } finally { fs.unlinkSync(context) }
  }, 25000)
  it('accepts full original constraints, multi-hop extras, duplicate indices, inactive absent package and zero dependencies', () => {
    const f = fixture(); expect(f.validate()).toEqual([{ provider: 'akshare', wheels: 1, evaluations: 0 }, { provider: 'mootdx', wheels: 1, evaluations: 0 }, { provider: 'pywencai', wheels: 3, evaluations: 4 }])
    expect(f.manifest.providers.pywencai.wheels[0].requiresDist[0]).toContain('>=1.0;')
    expect(f.audits.pywencai.activatedExtras.first).toEqual(['deep'])
  })
  it('does not depend on JSON object key serialization order', () => {
    // The native closure is intentionally site-relative, unlike the bound audit.
    const f = fixture(); const sorted = (_key: string, value: any) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value
    for (const provider of ['akshare', 'mootdx', 'pywencai']) {
      const audit = f.audits[provider]; audit.installedClosure.sha256 = f.write(audit.installedClosure.path, JSON.stringify(f.closures[provider], sorted))
      f.manifest.providers[provider].dependencyAudit.sha256 = f.write(f.manifest.providers[provider].dependencyAudit.path, JSON.stringify(audit, sorted))
    }
    expect(f.validate()).toHaveLength(3)
  })
  it('projects exact original Requires-Dist into verified canonical edges without mutating inputs or licensing', () => {
    const f = fixture()
    f.manifest.kind = 'test-only-not-a-release'; f.manifest.complete = false
    f.manifest.licenses = [{ review: 'pending', approvalId: 'not-approved' }]
    for (const lock of Object.values(f.manifest.providers) as any[]) for (const wheel of lock.wheels) wheel.dependencies = [...wheel.requiresDist]
    const before = JSON.stringify(f.manifest)
    const projected = api.projectDependencyGraphs(f.root, f.manifest, GENERATOR)
    expect(projected.providers.pywencai.wheels[0].dependencies).toEqual(['first'])
    expect(projected.providers.pywencai.wheels[1].dependencies).toEqual(['second'])
    expect(projected.providers.pywencai.wheels[0].requiresDist).toHaveLength(3)
    expect(projected.complete).toBe(false); expect(projected.licenses).toEqual(f.manifest.licenses)
    expect(JSON.stringify(f.manifest)).toBe(before)
    expect(api.validateDependencyAudits(f.root, projected, GENERATOR)).toHaveLength(3)
  })
  it('retains an already verified formal graph without accepting an arbitrary wrong graph', () => {
    const f = fixture()
    expect(api.projectDependencyGraphs(f.root, f.manifest, GENERATOR)).toEqual(f.manifest)
    f.manifest.providers.pywencai.wheels[0].dependencies = ['unverified']
    expect(() => api.projectDependencyGraphs(f.root, f.manifest, GENERATOR)).toThrow('neither original constraints nor verified graph')
  })
  it('rejects audit byte tampering before projection', () => {
    const f = fixture(), filename = path.join(f.root, f.manifest.providers.pywencai.dependencyAudit.path)
    fs.appendFileSync(filename, ' ')
    expect(() => api.projectDependencyGraphs(f.root, f.manifest, GENERATOR)).toThrow('projection SHA mismatch')
  })
  it('rejects missing extras-activated targets while projecting raw constraints', () => {
    const f = fixture()
    for (const wheel of f.manifest.providers.pywencai.wheels) wheel.dependencies = [...wheel.requiresDist]
    f.audits.pywencai.evaluations[3].to = 'missing-extra-target'
    f.save()
    expect(() => api.projectDependencyGraphs(f.root, f.manifest, GENERATOR)).toThrow('PRIVATE_RUNTIME_INVALID')
  })
  it.each(['../outside.dist-info/METADATA', 'providers/pywencai/site/first-1.5.dist-info/METADATA', 'C:/first.dist-info/METADATA'])('rejects closure paths outside the exact native relative contract: %s', metadataPath => {
    const f = fixture(); f.closures.pywencai.installed[0].metadataPath = metadataPath; f.save()
    expect(f.validate).toThrow('installed closure metadata path invalid')
  })
  it.each(['audit', 'closure', 'metadata', 'wheel-tags'])('rejects changed actual %s bytes', kind => {
    const f = fixture(), lock = f.manifest.providers.pywencai
    const relative = kind === 'audit' ? lock.dependencyAudit.path : kind === 'closure' ? f.audits.pywencai.installedClosure.path : kind === 'metadata' ? lock.wheels[0].metadata.path : lock.wheels[0].metadata.path.replace(/METADATA$/, 'WHEEL')
    fs.appendFileSync(path.join(f.root, relative), 'tampered')
    expect(f.validate).toThrow('PRIVATE_RUNTIME_INVALID')
  })
  it('rejects missing evidence instead of filling an empty audit', () => { const f = fixture(); delete f.manifest.providers.pywencai.dependencyAudit; expect(f.validate).toThrow('reference missing') })
  it('rejects an evidence SHA missing from inventory', () => { const f = fixture(); f.manifest.files = f.manifest.files.filter((row: any) => row.path !== f.audits.pywencai.installedClosure.path); expect(f.validate).toThrow('inventory mismatch') })
  it.each(['requiresDist', 'requiresPython', 'tags', 'version', 'metadataSha256', 'wheelSha256'])('rejects changed audited wheel %s', field => {
    const f = fixture(); const row = f.audits.pywencai.wheels[0]
    row[field] = field === 'requiresDist' ? ['first>=0; sys_platform == "darwin"'] : field === 'tags' ? ['py2-none-any'] : field.endsWith('Sha256') ? GENERATOR : 'wrong'
    f.save(); expect(f.validate).toThrow('wheel/original metadata mismatch')
  })
  it('rejects copied constraints that differ from actual METADATA', () => {
    const f = fixture(); f.manifest.providers.pywencai.wheels[0].requiresDist[0] = 'first>=0'
    expect(f.validate).toThrow('METADATA/original constraints mismatch')
  })
  it.each(['drop', 'duplicate', 'out-of-bounds', 'wrong-literal', 'not-boolean'])('rejects %s evaluation', mutation => {
    const f = fixture(), rows = f.audits.pywencai.evaluations
    if (mutation === 'drop') rows.pop(); else if (mutation === 'duplicate') rows.push({ ...rows[0] })
    else if (mutation === 'out-of-bounds') rows[0].requiresDistIndex = 99
    else if (mutation === 'wrong-literal') rows[0].requirement = 'first>=0'
    else rows[0].active = 1
    f.save(); expect(f.validate).toThrow('dependency evaluation')
  })
  it('rejects active platform-marker dependency on an absent package', () => {
    const f = fixture(); f.audits.pywencai.evaluations[1].active = true; f.save()
    expect(f.validate).toThrow('active dependency absent')
  })
  it('rejects active extra-driven dependency on an absent package', () => {
    const f = fixture(); f.audits.pywencai.evaluations[3].to = 'missing-extra-target'; f.save()
    expect(f.validate).toThrow('active dependency absent')
  })
  it('rejects incorrect or unsorted caller-built dependency graph', () => {
    const f = fixture(); f.manifest.providers.pywencai.wheels[0].dependencies = ['second']
    expect(f.validate).toThrow('graph/extras fixed-point mismatch')
  })
  it('rejects extras that are not the effective propagation fixed point', () => {
    const f = fixture(); f.audits.pywencai.activatedExtras.first = []; f.save()
    expect(f.validate).toThrow('graph/extras fixed-point mismatch')
  })
  it('rejects forged resolved edges separate from the complete evaluation indices', () => {
    const f = fixture(); f.audits.pywencai.resolvedEdges.pop(); f.save()
    expect(f.validate).toThrow('resolved edges differ')
  })
  it('allows a single evaluations format without redundant resolvedEdges', () => {
    const f = fixture(); delete f.audits.pywencai.resolvedEdges; f.save(); expect(f.validate()).toHaveLength(3)
  })
  it.each(['installed-missing', 'installed-extra', 'installed-version', 'installed-raw', 'wheel-duplicate'])('rejects %s audit set', mutation => {
    const f = fixture(), audit = f.audits.pywencai
    if (mutation === 'installed-missing') audit.installed.pop()
    else if (mutation === 'installed-extra') audit.installed.push({ ...audit.installed[0], name: 'extra' })
    else if (mutation === 'installed-version') audit.installed[0].version = '99'
    else if (mutation === 'installed-raw') audit.installed[0].rawRequiresDist = []
    else audit.wheels.push({ ...audit.wheels[0] })
    f.save(); expect(f.validate).toThrow('PRIVATE_RUNTIME_INVALID')
  })
  it('rejects an actual extra installed dist-info directory', () => {
    const f = fixture(); f.write('providers/pywencai/site/extra-1.dist-info/METADATA', 'Name: extra\nVersion: 1\n\n')
    expect(f.validate).toThrow('actual installed distribution set mismatch')
  })
  it('rejects an actual missing installed distribution', () => {
    const f = fixture(); fs.rmSync(path.join(f.root, f.manifest.providers.pywencai.wheels[2].metadata.path))
    expect(f.validate).toThrow()
  })
  it.each(['provider', 'target', 'site', 'roots', 'generator', 'PBS', 'packaging', 'environment'])('rejects cross-boundary %s evidence', field => {
    const f = fixture(), audit = f.audits.pywencai
    if (field === 'provider') audit.provider = 'akshare'
    else if (field === 'target') audit.target = 'darwin-arm64'
    else if (field === 'site') audit.site = 'providers/akshare/site'
    else if (field === 'roots') audit.roots = ['pywencai']
    else if (field === 'generator') audit.generator.scriptSha256 = HASH
    else if (field === 'PBS') audit.toolchain.pythonAssetSha256 = GENERATOR
    else if (field === 'packaging') audit.toolchain.packaging.id = 'system-packaging'
    else audit.markerEnvironment.sys_platform = 'darwin'
    f.save(); expect(f.validate).toThrow('PRIVATE_RUNTIME_INVALID')
  })
  it.each(['environment', 'extras', 'installed', 'evaluations', 'packaging', 'activeRequiresDist', 'installedMetadataVerified'])('reads and rejects conflicting closure %s facts even after rebinding SHA', field => {
    const f = fixture(); f.closures.pywencai[field] = field === 'environment' ? {} : field === 'extras' || field === 'packaging' ? {} : []
    f.save(); expect(f.validate).toThrow('installed closure bytes/facts disagree')
  })
  it('rejects active URL dependencies without invoking pip or networking', () => {
    const f = fixture(), lock = f.manifest.providers.pywencai, audit = f.audits.pywencai
    const requirement = 'first @ https://example.invalid/first.whl'
    const source = fs.readFileSync(path.join(f.root, lock.wheels[0].metadata.path), 'utf8').replace(lock.wheels[0].requiresDist[0], requirement)
    lock.wheels[0].metadata.sha256 = f.write(lock.wheels[0].metadata.path, source)
    lock.wheels[0].requiresDist[0] = requirement
    audit.wheels[0].metadataSha256 = lock.wheels[0].metadata.sha256
    audit.installed[0].metadataSha256 = lock.wheels[0].metadata.sha256
    audit.evaluations[0].requirement = requirement; f.save()
    expect(f.validate).toThrow('URL dependency forbidden')
  })
})
