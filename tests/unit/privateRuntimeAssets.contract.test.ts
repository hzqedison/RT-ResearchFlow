import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const shared = require('../../electron/shared/privatePythonRuntimeManifest.cjs')
const assembler = require('../../scripts/bundle-private-python-runtime.cjs')
const ts = require('typescript')
const repository = path.resolve(__dirname, '../..')
const H = 'a'.repeat(64)
const R = 'b'.repeat(64)
const L = 'c'.repeat(64)
const P = 'd'.repeat(64)
const recipePath = 'scripts/build-mootdx-compat-wheel.py'
const roots: string[] = []
function temporary() {
  const parent = process.platform === 'win32' ? 'D:/RT-ResearchFlow-BuildCache' : process.env.RUNNER_TEMP || process.env.TMPDIR || '/tmp'
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'private-assets-contract-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!path.isAbsolute(root) || !path.basename(root).startsWith('private-assets-contract-')) throw new Error('unsafe fixture cleanup')
    fs.rmSync(root, { recursive: true, force: true })
  }
})
function download(filename = 'input.whl', sha256 = H, size = 1) {
  return { kind: 'download', filename, url: 'https://files.pythonhosted.org/packages/' + encodeURIComponent(filename), sha256, size }
}
function derived() {
  return {
    distribution: 'mootdx', version: '0.11.7+rt.1', dependencies: ['mini-racer'], licenses: [],
    asset: { kind: 'derived', filename: 'mootdx-0.11.7+rt.1-py3-none-any.whl', sha256: '35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77', size: 413852 },
    derived: {
      id: 'mootdx-modern-mini-racer-v1', upstreamVersion: '0.11.7',
      upstreamSha256: 'eab475f1d08b1c71ea51212c8b1b1038c4739798f7d95ad1a6fb7bb26e348ef2', patchSha256: R,
      upstreamAsset: download('mootdx-0.11.7-py3-none-any.whl', 'eab475f1d08b1c71ea51212c8b1b1038c4739798f7d95ad1a6fb7bb26e348ef2'),
      recipe: { path: recipePath, sha256: R }
    }
  }
}
function fixture() {
  const license = (id: string) => ({ approvalId: id, spdx: 'NOASSERTION', path: 'licenses/full.txt', sha256: L, review: 'approved' })
  const racer = () => ({ distribution: 'mini-racer', version: '0.12.4', asset: download('mini_racer-0.12.4-py3-none-any.whl'), dependencies: [], licenses: [license('mini')] })
  const mootdx = { ...derived(), licenses: [license('mootdx')] }
  const manifest: any = {
    schemaVersion: 1, kind: 'rt-private-python-runtime', complete: true, platform: 'win32', arch: 'x64',
    sourceLockSha256: H, preparationPolicySha256: P,
    python: { distribution: 'python-build-standalone', version: '3.13.16', executable: 'python/python.exe', asset: download('python.tar.gz'), licenseSources: [download('python-full.tar.zst', R)], licenses: [license('python')] },
    node: { version: '22.23.3', executable: 'node/node.exe', asset: download('node.zip'), licenses: [license('node')] },
    bootstrap: 'bootstrap.py', miniRacerAdapter: { path: 'miniracer_unicode_adapter.py', version: '0.12.4', sha256: H, windowsStrategy: 'win32-unicode-resource-prewarm-v1' },
    providers: {
      akshare: { version: '1.19.1', site: 'providers/akshare/site', wheels: [{ distribution: 'akshare', version: '1.19.1', asset: download('akshare-1.19.1-py3-none-any.whl'), dependencies: ['mini-racer'], licenses: [license('akshare')] }, racer()] },
      mootdx: { version: '0.11.7+rt.1', site: 'providers/mootdx/site', compatibility: 'modern-mini-racer', wheels: [mootdx, racer()] },
      pywencai: { version: '0.13.1', site: 'providers/pywencai/site', wheels: [{ distribution: 'pywencai', version: '0.13.1', asset: download('pywencai-0.13.1-py3-none-any.whl'), dependencies: [], licenses: [license('pywencai')] }] }
    },
    sbom: { path: 'sbom.spdx.json', sha256: H, format: 'SPDX-2.3' },
    files: ['python/python.exe', 'node/node.exe', 'bootstrap.py', 'miniracer_unicode_adapter.py', 'sbom.spdx.json', 'providers/akshare/site/module.py', 'providers/mootdx/site/module.py', 'providers/pywencai/site/module.py'].map(name => ({ path: name, kind: 'file', sha256: H, size: 1 }))
      .concat([{ path: 'licenses/full.txt', kind: 'file', sha256: L, size: 1 }, { path: 'python/PYTHON.json', kind: 'file', sha256: R, size: 1 }])
  }
  const identities = [
    ['python', 'python-build-standalone', '3.13.16', R], ['node', 'node', '22.23.3', H],
    ['mini', 'mini-racer', '0.12.4', H], ['akshare', 'akshare', '1.19.1', H],
    ['mootdx', 'mootdx', '0.11.7+rt.1', mootdx.asset.sha256], ['pywencai', 'pywencai', '0.13.1', H]
  ]
  manifest.dependencyAuditValidator = { path: 'private_runtime_manifest.cjs', sha256: H }
  manifest.files.push({ path: 'private_runtime_manifest.cjs', kind: 'file', sha256: H, size: 1 })
  for (const [provider, item] of Object.entries(manifest.providers) as Array<[string, any]>) {
    item.dependencyAudit = { path: 'providers/' + provider + '/dependency-audit.json', sha256: H, format: 'rt-private-provider-dependency-audit-v1' }
    manifest.files.push({ path: item.dependencyAudit.path, kind: 'file', sha256: H, size: 1 })
    for (const wheel of item.wheels) {
      wheel.requiresDist = [...wheel.dependencies]; wheel.requiresPython = null; wheel.tags = ['py3-none-any']
      wheel.metadata = { path: item.site + '/' + wheel.distribution.replace(/-/g, '_') + '-' + wheel.version + '.dist-info/METADATA', sha256: H }
      manifest.files.push({ path: wheel.metadata.path, kind: 'file', sha256: H, size: 1 })
    }
  }
  const policy: any = {
    schemaVersion: 1, kind: 'rt-private-python-preparation-policy', status: 'pending',
    officialSources: ['https://files.pythonhosted.org/packages/'],
    targets: Object.fromEntries(shared.TARGETS.map((target: string) => [target, {
      python: structuredClone(manifest.python), node: structuredClone(manifest.node)
    }])),
    recipePins: [{ path: recipePath, sha256: R }],
    licenseApprovals: identities.map(([id, component, version, artifactSha256]) => ({ id, component, version, artifactSha256, licenseSha256: L, spdx: 'NOASSERTION', decision: 'approved', reviewedBy: 'synthetic-test-reviewer', reviewReference: 'synthetic-fixture-only' })),
    licenseRequirements: identities.map(([, component, version]) => ({ component, version, member: 'LICENSE', sha256: L, spdx: 'NOASSERTION' })).concat([{ component: 'python-build-standalone', version: '3.13.16', member: 'python/PYTHON.json', sha256: R, role: 'provenance' }] as any)
  }
  return { manifest, policy }
}

describe('mandatory download/derived asset contract', () => {
  it('compiles public APIs and rejects illegal asset combinations at type level', () => {
    const filename = path.join(repository, 'tests/unit/__private_asset_type_contract__.ts')
    const code = `
import type { DownloadAsset, DerivedAsset, PrivateRuntimeWheel, PrivatePythonRuntimeManifest, PrivatePythonRuntimeLock, PrivateRuntimeLicense, PrivateRuntimeRecipe } from '../../electron/shared/privatePythonRuntimeTypes'
import { asset, derivedWheel, validatePreparationPolicy, validateOfficialDownload } from '../../electron/shared/privatePythonRuntimeManifest.cjs'
declare const remote: DownloadAsset
declare const local: DerivedAsset
declare const manifest: PrivatePythonRuntimeManifest
declare const policy: unknown
declare const platforms: PrivatePythonRuntimeLock['platforms']
declare const wheelFields: {distribution: string; version: string; dependencies: string[]; requiresDist: string[]; requiresPython: string|null; tags: string[]; metadata: {path:string;sha256:string}; licenses: PrivateRuntimeLicense[]}
const downloaded: PrivateRuntimeWheel = {...wheelFields, asset: remote}
const checkedDownload: DownloadAsset = asset(remote, 'download')
const checkedDerived: DerivedAsset = asset(local, 'derived')
const official: DownloadAsset = validateOfficialDownload(remote, policy)
derivedWheel(downloaded)
validatePreparationPolicy(manifest, policy, 'sha')
// @ts-expect-error mandatory asset kind
const unlabelled: DownloadAsset = {filename:'a', url:'https://example.com/a', sha256:'sha', size:1}
// @ts-expect-error a derived asset cannot carry even an undefined URL
const withURL: DerivedAsset = {kind:'derived', filename:'a', sha256:'sha', size:1, url:'https://example.com/a'}
// @ts-expect-error a downloaded wheel cannot claim derived provenance
const forgedDownload: PrivateRuntimeWheel = {...wheelFields, asset:remote, derived:{id:'unregistered'}}
// @ts-expect-error a derived wheel requires complete provenance
const unproven: PrivateRuntimeWheel = {...wheelFields, asset:local}
// @ts-expect-error Python interpreter is a download, never a derived wheel
manifest.python.asset = local
// @ts-expect-error license-source archives are downloads only
manifest.python.licenseSources = [local]
// @ts-expect-error recipes are limited to the reviewed repository paths
const unreviewedRecipe: PrivateRuntimeRecipe = {path:'scripts/unreviewed.py', sha256:'sha'}
// @ts-expect-error manual approval id is mandatory
const noApproval: PrivateRuntimeLicense = {spdx:'MIT', path:'licenses/a', sha256:'sha', review:'approved'}
// @ts-expect-error all formal locks bind manual policy bytes
const noPolicy: PrivatePythonRuntimeLock = {schemaVersion:1, status:'locked', platforms}
`
    const options = { strict: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
    const host = ts.createCompilerHost(options)
    const readFile = host.readFile.bind(host), fileExists = host.fileExists.bind(host)
    host.readFile = (name: string) => path.resolve(name) === filename ? code : readFile(name)
    host.fileExists = (name: string) => path.resolve(name) === filename || fileExists(name)
    const program = ts.createProgram([filename], options, host)
    const diagnostics = ts.getPreEmitDiagnostics(program).map((d: any) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    expect(diagnostics).toEqual([])
  })
  it('rejects hidden asset inputs', () => expect(() => shared.asset({ ...download(), extraAsset: download() })).toThrow('unregistered asset input'))
  it('rejects multiple undisclosed derived inputs', () => {
    const wheel = derived(); expect(() => shared.derivedWheel({ ...wheel, derived: { ...wheel.derived, additionalInputs: [download()] } })).toThrow('unregistered derived input')
  })
  it('rejects unregistered recipe inputs', () => {
    const wheel = derived(); expect(() => shared.derivedWheel({ ...wheel, derived: { ...wheel.derived, recipe: { ...wheel.derived.recipe, arguments: ['unreviewed'] } } })).toThrow('input hash mismatch')
  })
  it('rejects malformed wheel identities with a bounded error', () => expect(() => shared.derivedWheel(null)).toThrow('PRIVATE_RUNTIME_INVALID'))
  it('accepts HTTPS downloads with encoded exact filenames', () => expect(shared.asset(download('a+b.whl'))).toBeTruthy())
  it('accepts URL-free derived outputs with exactly pinned input and recipe', () => expect(() => shared.derivedWheel(derived())).not.toThrow())
  it.each([undefined, 'pending', 'local', ''])('rejects asset kind %s', kind => expect(() => shared.asset({ ...download(), kind })).toThrow('PRIVATE_RUNTIME_INVALID'))
  it.each([
    'http://files.pythonhosted.org/packages/input.whl', 'https://user:pass@files.pythonhosted.org/packages/input.whl',
    'https://files.pythonhosted.org/packages/input.whl?q=1', 'https://files.pythonhosted.org/packages/input.whl#part',
    'https://files.pythonhosted.org/packages/other.whl', 'https://files.pythonhosted.org/packages/%ZZ'
  ])('rejects unsafe URL %s', url => expect(() => shared.asset({ ...download(), url })).toThrow('PRIVATE_RUNTIME_INVALID'))
  it.each(['../input.whl', 'C:input.whl', 'a\\input.whl', '/input.whl'])('rejects asset filename %s', filename => expect(() => shared.asset({ ...download(), filename })).toThrow('PRIVATE_RUNTIME_INVALID'))
  it.each([undefined, '', 'https://example.com/output.whl'])('rejects any derived URL property, including %s', url => expect(() => shared.asset({ ...derived().asset, url })).toThrow('PRIVATE_RUNTIME_INVALID'))
  it('forbids derived runtime archives', () => expect(() => shared.asset(derived().asset, 'download')).toThrow())
  it('forbids download wheel derived identity', () => expect(() => shared.derivedWheel({ ...derived(), asset: download() })).toThrow())
  it('forbids unlabelled derived output', () => { const wheel: any = derived(); delete wheel.derived; expect(() => shared.derivedWheel(wheel)).toThrow() })
  it('rejects legacy optional patch', () => expect(() => shared.derivedWheel({ ...derived(), derived: { ...derived().derived, patch: download() } })).toThrow())
  it.each(['upstreamSha256', 'patchSha256'])('rejects divergent %s', field => {
    const wheel: any = derived(); wheel.derived[field] = H; expect(() => shared.derivedWheel(wheel)).toThrow('input hash mismatch')
  })
  it.each(['../scripts/build-mootdx-compat-wheel.py', 'C:/scripts/build-mootdx-compat-wheel.py', 'scripts\\build-mootdx-compat-wheel.py', 'scripts/unapproved.py'])('rejects recipe path %s', name => {
    const wheel = derived(); wheel.derived.recipe.path = name; expect(() => shared.derivedWheel(wheel)).toThrow()
  })
})

describe('formal policy approvals, without restricting candidate preparation', () => {
  it.each(['python', 'node'])('rejects %s execution-asset replacement even with valid license approvals', runtime => {
    const { manifest, policy } = fixture()
    manifest[runtime].asset.sha256 = 'e'.repeat(64)
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('target runtime asset/license-source pin mismatch')
    expect(policy.licenseApprovals.every((approval: any) => approval.decision === 'approved')).toBe(true)
    expect(manifest.python.licenseSources[0].sha256).toBe(R)
  })
  it.each(['python', 'node'])('binds %s runtime version separately from license approvals', runtime => {
    const { manifest, policy } = fixture(); manifest[runtime].version = 'unapproved-version'
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('target runtime asset/license-source pin mismatch')
  })
  it.each(['filename', 'url', 'size'])('binds every execution asset pin: %s', field => {
    const { manifest, policy } = fixture()
    if (field === 'filename') { manifest.python.asset.filename = 'other.tar.gz'; manifest.python.asset.url = download('other.tar.gz').url }
    else if (field === 'url') manifest.python.asset.url = 'https://files.pythonhosted.org/packages/alternate/python.tar.gz'
    else manifest.python.asset.size += 1
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('target runtime asset/license-source pin mismatch')
  })
  it('requires explicit target pins instead of borrowing another architecture', () => {
    const { manifest, policy } = fixture(); delete policy.targets['win32-x64']
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('PRIVATE_RUNTIME_PENDING: target runtime pins missing')
  })
  it('rejects a changed full-license archive despite unchanged approved text', () => {
    const { manifest, policy } = fixture(); manifest.python.licenseSources[0].sha256 = H
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('target runtime asset/license-source pin mismatch')
  })
  it('rejects adding a license source not pinned for this target', () => {
    const { manifest, policy } = fixture(); manifest.node.licenseSources = [download('extra-license.gz')]
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('target runtime asset/license-source pin mismatch')
  })
  it('rejects duplicate pinned license sources', () => {
    const { manifest, policy } = fixture(); manifest.python.licenseSources.push(manifest.python.licenseSources[0])
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('duplicate pinned license source')
  })
  it('accepts independently approved exact evidence even with other policy work pending', () => {
    const { manifest, policy } = fixture(); expect(shared.validateManifestShape(manifest)).toBe(manifest)
    expect(shared.validatePreparationPolicy(manifest, policy, P)).toBe(manifest)
  })
  it.each(['pending', 'rejected'])('blocks a %s approval without changing it', decision => {
    const { manifest, policy } = fixture(); policy.licenseApprovals[0].decision = decision
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('PRIVATE_RUNTIME_PENDING')
    expect(policy.licenseApprovals[0].decision).toBe(decision)
  })
  it.each(['component', 'version', 'artifactSha256', 'licenseSha256', 'spdx'])('binds license approval %s', field => {
    const { manifest, policy } = fixture(); policy.licenseApprovals[0][field] = field.endsWith('Sha256') ? 'e'.repeat(64) : 'wrong'
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('PRIVATE_RUNTIME_PENDING')
  })
  it.each(['reviewedBy', 'reviewReference'])('requires explicit approval %s', field => {
    const { manifest, policy } = fixture(); policy.licenseApprovals[0][field] = ' '
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('PRIVATE_RUNTIME_INVALID')
  })
  it('blocks unknown approval ids and empty policy approval lists', () => {
    const { manifest, policy } = fixture(); policy.licenseApprovals = []
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('PRIVATE_RUNTIME_PENDING')
  })
  it('requires approvalId in complete manifest', () => {
    const { manifest } = fixture(); delete manifest.node.licenses[0].approvalId
    expect(() => shared.validateManifestShape(manifest)).toThrow('license not reviewed')
  })
  it('requires download-only license source archives', () => {
    const { manifest } = fixture(); manifest.python.licenseSources = [derived().asset]
    expect(() => shared.validateManifestShape(manifest)).toThrow()
  })
  it('does not misattribute PBS full license provenance to install_only', () => {
    const { manifest, policy } = fixture(); delete manifest.python.licenseSources
    delete policy.targets['win32-x64'].python.licenseSources
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('PRIVATE_RUNTIME_PENDING')
  })
  it('does not cherry-pick approved notices', () => {
    const { manifest, policy } = fixture(); policy.licenseApprovals.push({ ...policy.licenseApprovals[1], id: 'extra-notice', licenseSha256: R })
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('license evidence incomplete')
  })
  it('does not allow unknown required license hashes to seal', () => {
    const { manifest, policy } = fixture(); policy.licenseRequirements[0].sha256 = null
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('PRIVATE_RUNTIME_PENDING')
  })
  it('requires provenance in the inventory', () => {
    const { manifest, policy } = fixture(); manifest.files = manifest.files.filter((f: any) => f.path !== 'python/PYTHON.json')
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('provenance missing')
  })
  it('binds policy exact bytes, not only a self-asserted status', () => {
    const { manifest, policy } = fixture(); expect(() => shared.validatePreparationPolicy(manifest, policy, H)).toThrow('policy hash mismatch')
  })
  it('requires policy-approved recipe identity', () => {
    const { manifest, policy } = fixture(); policy.recipePins[0].sha256 = H
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('recipe not approved')
  })
  it('rejects candidate locks as complete formal locks', () => expect(() => shared.validateLock({ schemaVersion: 1, status: 'candidate' })).toThrow('PRIVATE_RUNTIME_PENDING'))
  it('requires all three targets to bind the same policy', () => {
    const { manifest } = fixture()
    const platforms: any = Object.fromEntries(shared.TARGETS.map((target: string) => {
      const [platform, arch] = target.split('-'); return [target, { ...manifest, platform, arch, minimumMacOS: '12.0' }]
    }))
    const lock = { schemaVersion: 1, status: 'locked', preparationPolicySha256: P, platforms }
    expect(shared.validateLock(lock)).toBe(lock)
    platforms['darwin-arm64'].preparationPolicySha256 = H
    expect(() => shared.validateLock(lock)).toThrow('platform preparation policy mismatch')
  })
  it('forbids command-line substitution of the manual policy', () => expect(() => assembler.options(['--policy', '/tmp/fake.json'])).toThrow('invalid assembler arguments'))
})

describe('policy URL authority and directory boundaries', () => {
  it.each([
    'https://files.pythonhosted.org/packages/input.whl',
    'https://files.pythonhosted.org:443/packages/input.whl',
    'https://FILES.PYTHONHOSTED.ORG/packages/input.whl'
  ])('accepts the approved effective HTTPS authority: %s', url => {
    expect(shared.validateOfficialDownload({ ...download(), url }, fixture().policy)).toBeTruthy()
  })
  it.each([
    'https://files.pythonhosted.org.attacker.example/packages/input.whl',
    'https://attacker-files.pythonhosted.org/packages/input.whl',
    'https://files.pythonhosted.org:444/packages/input.whl',
    'https://files.pythonhosted.org/packages-evil/input.whl',
    'https://files.pythonhosted.org/other/input.whl',
    'https://files.pythonhosted.org/packages/../other/input.whl'
  ])('rejects a non-approved authority/path: %s', url => {
    expect(() => shared.validateOfficialDownload({ ...download(), url }, fixture().policy)).toThrow('download source not approved')
  })
  it.each(['download-wheel', 'upstream', 'license-source'])('applies the same source whitelist to %s', kind => {
    const { manifest, policy } = fixture()
    const asset = kind === 'download-wheel' ? manifest.providers.pywencai.wheels[0].asset
      : kind === 'upstream' ? manifest.providers.mootdx.wheels[0].derived.upstreamAsset : manifest.python.licenseSources[0]
    asset.url = 'https://files.pythonhosted.org.attacker.example/packages/' + encodeURIComponent(asset.filename)
    if (kind === 'license-source') policy.targets['win32-x64'].python.licenseSources = structuredClone(manifest.python.licenseSources)
    expect(() => shared.validatePreparationPolicy(manifest, policy, P)).toThrow('download source not approved')
  })
  it('fails closed when the manual source whitelist is absent', () => {
    const { policy } = fixture(); delete policy.officialSources
    expect(() => shared.validateOfficialDownload(download(), policy)).toThrow('PRIVATE_RUNTIME_PENDING')
  })
  it.each([
    'http://files.pythonhosted.org/packages/', 'https://user@files.pythonhosted.org/packages/',
    'https://files.pythonhosted.org/packages', 'https://files.pythonhosted.org/packages/?q=1'
  ])('rejects malformed manual source prefixes: %s', source => {
    const { policy } = fixture(); policy.officialSources = [source]
    expect(() => shared.validateOfficialDownload(download(), policy)).toThrow('invalid official source')
  })
})

describe('offline assembler verifies actual output, upstream, recipe and license-source bytes', () => {
  function input() {
    const root = temporary(), assets = path.join(root, 'assets'), repo = path.join(root, 'repo')
    fs.mkdirSync(assets); fs.mkdirSync(repo)
    const bytes = Buffer.from('synthetic audited recipe\n')
    const recipeHash = shared.hash(bytes)
    for (const base of [repo, path.join(assets, 'recipes')]) {
      const filename = path.join(base, recipePath); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes)
    }
    const pinned = (name: string, kind = 'download') => {
      const content = Buffer.from('fixture-' + name); fs.writeFileSync(path.join(assets, name), content)
      return { ...download(name, shared.hash(content), content.length), kind, ...(kind === 'derived' ? { url: undefined } : {}) }
    }
    const wheel: any = derived(); wheel.asset = pinned('derived.whl', 'derived'); delete wheel.asset.url
    wheel.derived.upstreamAsset = pinned('upstream.whl'); wheel.derived.upstreamSha256 = wheel.derived.upstreamAsset.sha256
    wheel.derived.recipe.sha256 = recipeHash; wheel.derived.patchSha256 = recipeHash
    const manifest = { python: { asset: pinned('python.gz'), licenseSources: [pinned('python-full.zst')] }, node: { asset: pinned('node.zip'), licenseSources: [pinned('node-license.gz')] }, providers: { fixture: { wheels: [wheel] } } }
    const policy = { officialSources: ['https://files.pythonhosted.org/packages/'], recipePins: [{ path: recipePath, sha256: recipeHash }] }
    return { root, assets, repo, manifest, policy, wheel }
  }
  it('accepts verified downloaded and derived bytes without running a recipe', () => {
    const f = input(); expect(() => assembler.verifySourceInputs(f.manifest, f.assets, f.repo, f.policy)).not.toThrow()
    expect(fs.existsSync(path.join(f.root, 'executed'))).toBe(false)
  })
  it('rejects unlabelled source assets through the public verification API', () => {
    const f = input(); const asset: any = f.manifest.python.asset; delete asset.kind
    expect(() => assembler.verifySourceInputs(f.manifest, f.assets, f.repo, f.policy)).toThrow('asset is not pinned')
  })
  it('enforces source policy through the actual offline assembler input API', () => {
    const f = input(); f.wheel.derived.upstreamAsset.url = 'https://files.pythonhosted.org:8443/packages/upstream.whl'
    expect(() => assembler.verifySourceInputs(f.manifest, f.assets, f.repo, f.policy)).toThrow('download source not approved')
  })
  it.each(['derived.whl', 'upstream.whl', 'python.gz', 'python-full.zst', 'node.zip', 'node-license.gz'])('rejects modified actual %s', filename => {
    const f = input(); fs.appendFileSync(path.join(f.assets, filename), 'changed')
    expect(() => assembler.verifySourceInputs(f.manifest, f.assets, f.repo, f.policy)).toThrow('source asset/recipe mismatch')
  })
  it.each(['snapshot', 'current'])('rejects modified %s recipe', choice => {
    const f = input(); const base = choice === 'snapshot' ? path.join(f.assets, 'recipes') : f.repo
    fs.appendFileSync(path.join(base, recipePath), 'changed')
    expect(() => assembler.verifySourceInputs(f.manifest, f.assets, f.repo, f.policy)).toThrow('source asset/recipe mismatch')
  })
  it('rejects an unapproved recipe snapshot even with correct bytes', () => {
    const f = input(); f.policy.recipePins = []
    expect(() => assembler.verifySourceInputs(f.manifest, f.assets, f.repo, f.policy)).toThrow('recipe not approved')
  })
  it('rejects conflicting asset filenames without overwriting the first bytes', () => {
    const f = input(); const original = fs.readFileSync(path.join(f.assets, 'python.gz'))
    f.manifest.node.asset = { ...f.manifest.python.asset, sha256: H }
    expect(() => assembler.verifySourceInputs(f.manifest, f.assets, f.repo, f.policy)).toThrow('conflicting asset filename')
    expect(fs.readFileSync(path.join(f.assets, 'python.gz'))).toEqual(original)
  })
  it('reads the fixed policy before creating any output and rejects a changed policy hash', () => {
    const f = input(); const fixtureRoot = path.join(f.root, 'application')
    for (const name of ['scripts/bundle-private-python-runtime.cjs', 'electron/shared/privatePythonRuntimeManifest.cjs']) {
      const destination = path.join(fixtureRoot, name); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(path.join(repository, name), destination)
    }
    const policyPath = path.join(fixtureRoot, 'resources/python-runtime/preparation.policy.json')
    fs.mkdirSync(path.dirname(policyPath), { recursive: true }); fs.writeFileSync(policyPath, JSON.stringify(f.policy))
    const { manifest } = fixture(); const platforms = Object.fromEntries(shared.TARGETS.map((target: string) => {
      const [platform, arch] = target.split('-'); return [target, { ...manifest, platform, arch, minimumMacOS: '12.0' }]
    }))
    const lockPath = path.join(f.root, 'lock.json'); fs.writeFileSync(lockPath, JSON.stringify({ schemaVersion: 1, status: 'locked', preparationPolicySha256: P, platforms }))
    const isolated = require(path.join(fixtureRoot, 'scripts/bundle-private-python-runtime.cjs'))
    const outputRoot = path.join(f.root, 'output')
    expect(() => isolated.assemble({ lockPath, preparedRoot: path.join(f.root, 'prepared'), assetsRoot: f.assets, outputRoot, target: 'win32-x64' })).toThrow('policy hash mismatch')
    expect(fs.existsSync(outputRoot)).toBe(false)
  })
})
