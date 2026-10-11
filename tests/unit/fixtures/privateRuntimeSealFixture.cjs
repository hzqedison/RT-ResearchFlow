'use strict'

// Entirely isolated authority/license/native fixtures. Only the two immutable
// mootdx recipe assets are included unchanged, since production pins forbid
// inventing their hashes. No fixture output is a distributable runtime approval.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const blobOid = value => crypto.createHash('sha1').update(Buffer.from('blob ' + value.length + '\0')).update(value).digest('hex')
function makeFixture(sourceRoot, root, options = {}) {
  const sourceApi = require(path.join(sourceRoot, 'scripts/seal-private-python-runtime.cjs'))
  const { TARGETS, REQUIRED_SOURCE, PREPARATION_SOURCE, preparationBytes, digest, executionAssets, crc32 } = sourceApi
  const repoRoot = path.join(root, 'repo'), preparedRoot = path.join(root, 'prepared'), assetsRoot = path.join(root, 'assets'), outputRoot = path.join(root, 'output')
  fs.mkdirSync(repoRoot); fs.mkdirSync(preparedRoot); fs.mkdirSync(assetsRoot)
  const write = (base, name, bytes) => { const file = path.join(base, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); return file }
  const sourceNames = [...REQUIRED_SOURCE, 'resources/python-runtime/distribution-obligations.policy.json',
    'resources/python-runtime/license-review.md', '.github/workflows/fixture.yml']
  for (const name of REQUIRED_SOURCE.filter(name => name !== 'resources/python-runtime/preparation.policy.json')) write(repoRoot, name, fs.readFileSync(path.join(sourceRoot, name)))
  write(repoRoot, 'resources/python-runtime/license-review.md', 'Synthetic license/authority test records. NOT a redistribution approval.\n')
  write(repoRoot, '.github/workflows/fixture.yml', 'Synthetic producer identity; not an executable release workflow.\n')
  const license = Buffer.from('LicenseRef-Synthetic-Test. NOT a dependency license or redistribution grant.\n'), licenseHash = hash(license)
  const recipe = { path: 'scripts/build-mootdx-compat-wheel.py', sha256: hash(fs.readFileSync(path.join(repoRoot, 'scripts/build-mootdx-compat-wheel.py'))) }
  write(assetsRoot, 'recipes/' + recipe.path, fs.readFileSync(path.join(repoRoot, recipe.path)))
  const { readPinnedWheel } = require('../../fixtures/runtime-wheel-assets.cjs')
  function asset(filename, bytes, prefix = 'https://files.pythonhosted.org/packages/') {
    write(assetsRoot, filename, bytes)
    return { kind: 'download', filename, url: prefix + encodeURIComponent(filename), sha256: hash(bytes), size: bytes.length }
  }
  const upstreamBytes = readPinnedWheel('mootdx-0.11.7-py3-none-any.whl')
  const derivedBytes = readPinnedWheel('mootdx-0.11.7+rt.1-py3-none-any.whl')
  if (hash(upstreamBytes) !== 'eab475f1d08b1c71ea51212c8b1b1038c4739798f7d95ad1a6fb7bb26e348ef2' ||
      hash(derivedBytes) !== '35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77') throw new Error('immutable fixture asset mismatch')
  const upstream = asset('mootdx-0.11.7-py3-none-any.whl', upstreamBytes)
  const derived = asset('mootdx-0.11.7+rt.1-py3-none-any.whl', derivedBytes); derived.kind = 'derived'; delete derived.url
  const wheelAssets = new Map()
  for (const [name, version] of [['akshare', '1.19.1'], ['mini-racer', '0.12.4'], ['pywencai', '0.13.1']]) wheelAssets.set(name,
    asset(name.replace(/-/g, '_') + '-' + version + '-py3-none-any.whl', Buffer.from('synthetic wheel ' + name)))
  const policy = { schemaVersion: 1, kind: 'rt-private-python-preparation-policy', status: 'pending',
    officialSources: ['https://files.pythonhosted.org/packages/', 'https://github.com/astral-sh/python-build-standalone/releases/download/fixture/', 'https://nodejs.org/dist/fixture/'],
    targets: {}, recipePins: [recipe], licenseApprovals: [], licenseRequirements: [] }
  const allApprovals = new Map(), allRequirements = new Map(), manifests = {}, fragmentData = {}, candidateData = {}
  function reviewed(component, version, archive) {
    const id = 'synthetic-' + component + '-' + archive.sha256
    allApprovals.set(id, { id, component, version, artifactSha256: archive.sha256, licenseSha256: licenseHash, spdx: 'LicenseRef-Synthetic-Test',
      decision: 'approved', reviewedBy: 'isolated fixture, not a human approval', reviewReference: 'synthetic fixture only' })
    allRequirements.set(component + ':' + version, { component, version, member: 'LICENSE', sha256: licenseHash, spdx: 'LicenseRef-Synthetic-Test' })
    return [{ approvalId: id, spdx: 'LicenseRef-Synthetic-Test', path: 'licenses/FIXTURE.txt', sha256: licenseHash, review: 'approved' }]
  }
  function executable(platform, arch) {
    const bytes = Buffer.alloc(128)
    if (platform === 'win32') { bytes.writeUInt16LE(0x5a4d, 0); bytes.writeUInt32LE(64, 0x3c); bytes.writeUInt32LE(0x00004550, 64); bytes.writeUInt16LE(0x8664, 68) }
    else { bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4) }
    return bytes
  }
  for (const target of TARGETS) {
    const [platform, arch] = target.split('-'), tree = path.join(preparedRoot, target), files = []
    function file(name, value, mode) {
      const bytes = Buffer.from(value); const filename = write(tree, name, bytes)
      if (mode) fs.chmodSync(filename, mode)
      const row = { path: name, kind: 'file', size: bytes.length, sha256: hash(bytes) }; files.push(row); return row.sha256
    }
    const pythonAsset = asset('fixture-' + target + '-python.tar.gz', Buffer.from('fixture PBS archive ' + target), policy.officialSources[1])
    const fullAsset = asset('fixture-' + target + '-full.tar.zst', Buffer.from('fixture full archive ' + target), policy.officialSources[1])
    const nodeAsset = asset('fixture-' + target + '-node.zip', Buffer.from('fixture Node archive ' + target), policy.officialSources[2])
    const pythonPath = platform === 'win32' ? 'python/python.exe' : 'python/bin/python3.13', nodePath = platform === 'win32' ? 'node/node.exe' : 'node/bin/node'
    const executableHash = file(pythonPath, executable(platform, arch), 0o755); file(nodePath, executable(platform, arch), 0o755)
    file('bootstrap.py', fs.readFileSync(path.join(repoRoot, 'resources/python-runtime/bootstrap.py')))
    const validatorHash = file('private_runtime_manifest.cjs', fs.readFileSync(path.join(repoRoot, 'electron/shared/privatePythonRuntimeManifest.cjs')))
    const miniHash = file('miniracer_unicode_adapter.py', fs.readFileSync(path.join(repoRoot, 'resources/python-runtime/miniracer_unicode_adapter.py')))
    file('providers/pywencai/pywencai_adapter.py', fs.readFileSync(path.join(repoRoot, 'resources/python-runtime/pywencai_adapter.py')))
    file('licenses/FIXTURE.txt', license)
    const provenance = file('python/PYTHON.json', '{"synthetic":true}\n')
    const python = { distribution: 'python-build-standalone', version: '3.13.16', executable: pythonPath, asset: pythonAsset,
      licenseSources: [fullAsset], licenses: reviewed('python-build-standalone', '3.13.16', fullAsset) }
    const node = { version: '22.23.3', executable: nodePath, asset: nodeAsset, licenses: reviewed('node', '22.23.3', nodeAsset) }
    policy.targets[target] = { python: { version: python.version, asset: pythonAsset, licenseSources: [fullAsset] }, node: { version: node.version, asset: nodeAsset } }
    allRequirements.set('python-provenance', { component: 'python-build-standalone', version: python.version, member: 'python/PYTHON.json', sha256: provenance, role: 'provenance' })
    const providers = {}, preparedProviders = {}, resolvedProviders = {}
    const environment = { implementation_name: 'cpython', implementation_version: python.version, os_name: platform === 'win32' ? 'nt' : 'posix',
      platform_machine: platform === 'win32' ? 'AMD64' : arch === 'arm64' ? 'arm64' : 'x86_64', platform_python_implementation: 'CPython',
      platform_release: 'fixture', platform_system: platform === 'win32' ? 'Windows' : 'Darwin', platform_version: 'fixture', python_full_version: python.version,
      python_version: '3.13', sys_platform: platform }
    const packaging = { id: 'pip-vendored-packaging', version: '25.0', sourceSha256: hash('synthetic packaging') }
    for (const [provider, version] of [['akshare', '1.19.1'], ['mootdx', '0.11.7+rt.1'], ['pywencai', '0.13.1']]) {
      const site = 'providers/' + provider + '/site', identities = [{ name: provider, version }]
      if (provider !== 'pywencai') identities.push({ name: 'mini-racer', version: '0.12.4' })
      const wheels = identities.map(({ name, version: wheelVersion }) => {
        const requirements = name === provider && provider !== 'pywencai' ? ['mini-racer==0.12.4'] : []
        const metadataPath = site + '/' + name.replace(/-/g, '_') + '-' + wheelVersion + '.dist-info/METADATA'
        const metadata = file(metadataPath, 'Metadata-Version: 2.1\nName: ' + name + '\nVersion: ' + wheelVersion + '\nRequires-Python: >=3.13\n' + requirements.map(value => 'Requires-Dist: ' + value + '\n').join('') + '\n')
        file(metadataPath.replace(/METADATA$/, 'WHEEL'), 'Wheel-Version: 1.0\nTag: py3-none-any\n\n')
        const archive = name === 'mootdx' ? derived : wheelAssets.get(name)
        return { distribution: name, version: wheelVersion, asset: archive, licenses: reviewed(name, wheelVersion, archive),
          dependencies: requirements.length ? ['mini-racer'] : [], requiresDist: requirements, requiresPython: '>=3.13', tags: ['py3-none-any'], metadata: { path: metadataPath, sha256: metadata },
          ...(name === 'mootdx' ? { derived: { id: 'mootdx-modern-mini-racer-v1', upstreamVersion: '0.11.7', upstreamSha256: upstream.sha256, patchSha256: recipe.sha256, upstreamAsset: upstream, recipe } } : {}) }
      })
      const installed = wheels.map(wheel => ({ name: wheel.distribution, version: wheel.version, metadataPath: wheel.metadata.path, metadataSha256: wheel.metadata.sha256, rawRequiresDist: wheel.requiresDist }))
      const extras = Object.fromEntries(wheels.map(wheel => [wheel.distribution, []]))
      const evaluations = provider !== 'pywencai' ? [{ from: provider, requiresDistIndex: 0, requirement: 'mini-racer==0.12.4', to: 'mini-racer', extras: [], active: true }] : []
      const closure = { python: python.version, distributionCount: wheels.length, installedMetadataVerified: true, environment, extras,
        installed: installed.map(row => ({ ...row, metadataPath: row.metadataPath.slice(site.length + 1) })), evaluations, packaging,
        activeRequiresDist: evaluations.map(value => ({ from: value.from, requiresDistIndex: value.requiresDistIndex, requirement: value.requirement, dependencyName: value.to })) }
      const closurePath = 'providers/' + provider + '/installed-closure.json', closureReference = { path: closurePath, sha256: file(closurePath, JSON.stringify(closure)) }
      const audit = { schemaVersion: 1, kind: 'rt-private-provider-dependency-audit-v1', provider, target, site, roots: [provider + '==' + version],
        generator: { id: 'rt-private-python-prep-closure-v1', scriptSha256: hash(fs.readFileSync(path.join(repoRoot, 'scripts/prepare-private-python-runtime.py'))) },
        toolchain: { pythonAssetSha256: pythonAsset.sha256, executableSha256: executableHash, pipVersion: 'fixture', pipMetadataSha256: hash('fixture pip'), packaging },
        markerEnvironment: environment, activatedExtras: extras, installed, evaluations, installedClosure: closureReference,
        wheels: wheels.map(wheel => ({ name: wheel.distribution, version: wheel.version, wheelSha256: wheel.asset.sha256, metadataPath: wheel.metadata.path,
          metadataSha256: wheel.metadata.sha256, requiresDist: wheel.requiresDist, requiresPython: wheel.requiresPython, tags: wheel.tags })) }
      const auditPath = 'providers/' + provider + '/dependency-audit.json', auditReference = { path: auditPath, sha256: file(auditPath, JSON.stringify(audit)), format: audit.kind }
      providers[provider] = { version, site, wheels, dependencyAudit: auditReference, ...(provider === 'mootdx' ? { compatibility: 'modern-mini-racer' } : {}) }
      preparedProviders[provider] = { version, site, dependencyAudit: auditReference, installedClosure: closureReference }
      resolvedProviders[provider] = { version, site, wheels: wheels.map(wheel => ({ distribution: wheel.distribution, version: wheel.version, asset: wheel.asset,
        dependencies: wheel.requiresDist, tags: wheel.tags, requiresPython: wheel.requiresPython, metadataSha256: wheel.metadata.sha256,
        notices: { [wheel.metadata.path.slice(site.length + 1)]: wheel.metadata.sha256 }, ...(wheel.derived ? { derived: wheel.derived } : {}) })) }
    }
    const sbom = { path: 'sbom.spdx.json', sha256: file('sbom.spdx.json', JSON.stringify({ spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT',
      packages: [{ name: 'python', versionInfo: python.version }, { name: 'node', versionInfo: node.version },
        ...Object.values(providers).flatMap(provider => provider.wheels.map(wheel => ({ name: wheel.distribution, versionInfo: wheel.version })))] })), format: 'SPDX-2.3' }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    manifests[target] = { schemaVersion: 1, kind: 'rt-private-python-runtime', complete: true, platform, arch, python, node,
      ...(platform === 'darwin' ? { minimumMacOS: '12.0' } : {}), bootstrap: 'bootstrap.py', dependencyAuditValidator: { path: 'private_runtime_manifest.cjs', sha256: validatorHash },
      miniRacerAdapter: { path: 'miniracer_unicode_adapter.py', version: '0.12.4', sha256: miniHash, windowsStrategy: 'win32-unicode-resource-prewarm-v1' }, providers, sbom, files }
    candidateData[target] = { schemaVersion: 1, kind: 'rt-private-python-candidate-lock', status: 'candidate', resolutionComplete: true,
      target, python, node, providers: resolvedProviders, releaseEligible: false, pending: [] }
    fragmentData[target] = { schemaVersion: 1, kind: 'rt-private-python-candidate-fragment', status: 'candidate', treeComplete: true, target,
      treeRoot: tree, inventory: files, inventorySha256: hash(preparationBytes(files)), providers: preparedProviders, sbom,
      dependencyAuditValidator: manifests[target].dependencyAuditValidator, nativeEvidence: { scope: 'native imports/private Node; not full production bootstrap' }, releaseEligible: false, pending: options.pending || [] }
  }
  policy.licenseApprovals = [...allApprovals.values()]; policy.licenseRequirements = [...allRequirements.values()]
  const policyBytes = Buffer.from(JSON.stringify(policy)), policyHash = hash(policyBytes)
  write(repoRoot, 'resources/python-runtime/preparation.policy.json', policyBytes)
  const snapshotNames = [...PREPARATION_SOURCE]
  const snapshot = { policySha256: policyHash, files: snapshotNames.map(name => ({ path: name, sha256: hash(fs.readFileSync(path.join(repoRoot, name))) })) }
  const snapshotHash = hash(preparationBytes(snapshot)), sourceCommit = 'a'.repeat(40)
  for (const manifest of Object.values(manifests)) manifest.preparationPolicySha256 = policyHash
  const formalLock = { schemaVersion: 1, status: 'locked', preparationPolicySha256: policyHash, platforms: manifests }
  const lockPath = write(root, 'formal-lock.json', JSON.stringify(formalLock))
  const reviewPath = 'resources/python-runtime/license-review.md', reviewHash = hash(fs.readFileSync(path.join(repoRoot, reviewPath)))
  const rules = { schemaVersion: 1, kind: 'rt-runtime-distribution-obligation-policy-v1', preparationPolicySha256: policyHash,
    assets: TARGETS.flatMap(target => executionAssets(manifests[target]).map(asset => ({ target, ...asset, classification: 'notice-only', obligations: [], reviewRecord: { path: reviewPath, sha256: reviewHash } }))) }
  const rulesBytes = Buffer.from(JSON.stringify(rules)); write(repoRoot, 'resources/python-runtime/distribution-obligations.policy.json', rulesBytes)
  const repo = 'fixture/private-runtime', prefix = '/repos/' + repo, responses = new Map(), trees = new Map([['', []]]), files = []
  const rootTree = 'b'.repeat(40)
  for (const name of sourceNames) {
    const bytes = fs.readFileSync(path.join(repoRoot, name)), blob = blobOid(bytes)
    files.push({ path: name, sha256: hash(bytes), size: bytes.length, mode: '100644', blobOid: blob })
    responses.set(prefix + '/git/blobs/' + blob, { sha: blob, encoding: 'base64', size: bytes.length, content: bytes.toString('base64') })
    const parts = name.split('/'); let parent = ''
    for (const part of parts.slice(0, -1)) { const current = parent ? parent + '/' + part : part
      if (!trees.has(current)) { trees.set(current, []); trees.get(parent).push({ path: part, type: 'tree', mode: '040000', sha: hash(current).slice(0, 40) }) } parent = current }
    trees.get(parent).push({ path: parts.at(-1), type: 'blob', mode: '100644', sha: blob })
  }
  for (const [name, entries] of trees) responses.set(prefix + '/git/trees/' + (name ? hash(name).slice(0, 40) : rootTree), { sha: name ? hash(name).slice(0, 40) : rootTree, tree: entries, truncated: false })
  responses.set(prefix, { id: 42, full_name: repo }); responses.set(prefix + '/git/commits/' + sourceCommit, { sha: sourceCommit, tree: { sha: rootTree } })
  const trust = { repositoryId: 42, repositoryFullName: repo, approvedSourceCommit: sourceCommit, approvedPolicySha256: policyHash,
    approvedSealImplementationSha256: hash(fs.readFileSync(path.join(repoRoot, 'scripts/seal-private-python-runtime.cjs'))), sourceSnapshotSha256: snapshotHash,
    requiredSourceFiles: sourceNames, obligationPolicySha256: hash(rulesBytes), assemblyTarget: process.platform + '-' + process.arch, producers: [] }
  const sourceProof = { kind: 'github-tree-membership-v1', repositoryId: 42, sourceCommit, rootTreeOid: rootTree, policySha256: policyHash,
    sourceSnapshotSha256: snapshotHash, files, producers: [] }
  const obligationsProof = { kind: 'runtime-distribution-obligations-v1', policySha256: policyHash, sourceSnapshotSha256: snapshotHash,
    targets: TARGETS.map(target => ({ target, artifactSetSha256: digest(executionAssets(manifests[target])), inventorySha256: digest(manifests[target].files),
      dependencyAuditSha256: digest(Object.entries(manifests[target].providers).sort().map(([name, provider]) => ({ name, ...provider.dependencyAudit }))), reviews: [] })) }
  const preparations = {}, archives = new Map()
  function zip(members) {
    const local = [], central = []; let offset = 0
    for (const [name, bytes] of Object.entries(members)) {
      const encoded = Buffer.from(name), header = Buffer.alloc(30), entry = Buffer.alloc(46), crc = crc32(bytes)
      header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(encoded.length, 26)
      entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(encoded.length, 28); entry.writeUInt32LE(offset, 42)
      local.push(header, encoded, bytes); central.push(entry, encoded); offset += 30 + encoded.length + bytes.length
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22), count = Object.keys(members).length
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
    return Buffer.concat([...local, directory, end])
  }
  for (const [index, target] of TARGETS.entries()) {
    const candidate = Object.assign(candidateData[target], { sourceSnapshot: snapshot, sourceSha256: snapshotHash, preparationPolicySha256: policyHash })
    const candidateBytes = Buffer.from(JSON.stringify(candidate)), fragment = Object.assign(fragmentData[target],
      { sourceSnapshot: snapshot, sourceSha256: snapshotHash, preparationPolicySha256: policyHash, inputLockSha256: hash(candidateBytes) })
    const fragmentBytes = Buffer.from(JSON.stringify(fragment)), manifest = manifests[target]
    const handoff = { kind: 'rt-private-python-preparation-handoff', status: 'candidate', resolutionComplete: true, treeComplete: true,
      lock: { path: 'candidate-lock.json', sha256: hash(candidateBytes) }, fragment: { path: 'candidate-fragment.json', sha256: hash(fragmentBytes) } }
    const binding = { target, sourceSnapshotSha256: snapshotHash, candidateLockSha256: hash(candidateBytes), fragmentSha256: hash(fragmentBytes), inventorySha256: fragment.inventorySha256,
      formalManifestIdentitySha256: digest({ ...manifest, sourceLockSha256: hash(fs.readFileSync(lockPath)) }),
      pythonAssetSha256: manifest.python.asset.sha256, nodeAssetSha256: manifest.node.asset.sha256, bootstrapSha256: hash(fs.readFileSync(path.join(repoRoot, 'resources/python-runtime/bootstrap.py'))),
      validatorSha256: manifest.dependencyAuditValidator.sha256, miniRacerAdapterSha256: manifest.miniRacerAdapter.sha256,
      pywencaiAdapterSha256: hash(fs.readFileSync(path.join(repoRoot, 'resources/python-runtime/pywencai_adapter.py'))),
      providers: Object.fromEntries(Object.entries(manifest.providers).map(([name, provider]) => [name, { version: provider.version,
        dependencyAuditSha256: provider.dependencyAudit.sha256, wheelsSha256: digest(provider.wheels) }])) }
    const nativeReport = { kind: 'rt-private-python-native-bootstrap-evidence-v1', binding, nativePlatform: manifest.platform, nativeArch: manifest.arch,
      validatorPassed: true, executableModeChecked: true, invocationFlags: ['-X', 'utf8', '-I', '-S', '-B'],
      results: ['akshare', 'mootdx', 'pywencai'].map(provider => ({ provider, workerExitCode: 0, privateNodeExited: true, ownedDescendantsExited: true })), fixtureOnly: true }
    const data = { fragment: fragmentBytes, candidateLock: candidateBytes, handoff: Buffer.from(JSON.stringify(handoff)), nativeReport: Buffer.from(JSON.stringify(nativeReport)) }
    const members = Object.fromEntries(Object.keys(data).map(name => [name, target + '/' + name + '.json']))
    preparations[target] = Object.fromEntries(Object.entries(data).map(([name, bytes]) => [name + 'Path', write(root, 'inputs/' + members[name], bytes)]))
    const archive = zip(Object.fromEntries(Object.entries(data).map(([name, bytes]) => [members[name], bytes]))), artifactId = index + 10
    archives.set(artifactId, archive)
    const workflowPath = '.github/workflows/fixture.yml', workflow = files.find(file => file.path === workflowPath)
    const producer = { target, runId: '123', attempt: 1, workflowPath, workflowBlobOid: workflow.blobOid, workflowSha256: workflow.sha256,
      jobId: index + 1, jobName: target, fragmentArtifactId: artifactId, artifactName: 'fixture-' + target, artifactArchiveSha256: hash(archive), members, allowedEvents: ['workflow_dispatch'] }
    trust.producers.push(producer); sourceProof.producers.push({ ...producer, fragmentSha256: hash(fragmentBytes) })
    responses.set(prefix + '/actions/runs/123/attempts/1', { repository: { id: 42 }, head_repository: { id: 42 }, head_sha: sourceCommit, path: workflowPath, run_attempt: 1, event: 'workflow_dispatch' })
    responses.set(prefix + '/actions/jobs/' + producer.jobId, { id: producer.jobId, run_id: 123, run_attempt: 1, head_sha: sourceCommit, name: target, status: 'completed', conclusion: 'success' })
    responses.set(prefix + '/actions/artifacts/' + artifactId, { id: artifactId, expired: false, workflow_run: { id: 123, head_sha: sourceCommit }, name: producer.artifactName, digest: 'sha256:' + hash(archive) })
  }
  const authority = { async readJson(endpoint) { if (!responses.has(endpoint)) throw new Error('unexpected fixture endpoint'); return structuredClone(responses.get(endpoint)) },
    async readArtifactArchive({ artifactId }) { return archives.get(artifactId) },
    // SYNTHETIC seam: this verifies no real worker or native bootstrap execution.
    async verifyNativeBootstrap({ reportBytes, expectedBinding }) { return { status: 'accepted', reportSha256: hash(reportBytes), bindingSha256: digest(expectedBinding) } } }
  const seal = require(path.join(repoRoot, 'scripts/seal-private-python-runtime.cjs')).sealPrivateRuntime
  return { seal, input: { trustedContext: trust, sourceProof, obligationsProof, repositoryRoot: repoRoot, lockPath, preparedRoot, assetsRoot, outputRoot, preparations },
    authority, manifests, candidateData, fragmentData, responses, prefix, archives, root }
}
module.exports = { makeFixture }
