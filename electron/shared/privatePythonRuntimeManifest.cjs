'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const PROVIDERS = ['akshare', 'mootdx', 'pywencai']
const TARGETS = ['win32-x64', 'darwin-arm64', 'darwin-x64']
const MANIFEST = 'manifest.json'
const RECIPES = ['scripts/build-mootdx-compat-wheel.py', 'scripts/build-provider-source-wheels.py', 'scripts/rebuild-lxml-native.py', 'scripts/build-lxml-redistribution-wheel.py', 'scripts/build-lxml-matched-public-source.py']

function fail(reason) { throw new Error('PRIVATE_RUNTIME_INVALID: ' + reason) }
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value) { return typeof value === 'string' && value.trim() === value && value.length > 0 }
function sha(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value) }
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex') }
function canonical(value) { return String(value).toLowerCase().replace(/[-_.]+/g, '-') }
function wheelTarget(filename, target) {
  const tags = filename.slice(0, -4).split('-').slice(-3)
  if (tags.length !== 3) fail('invalid wheel filename')
  const [python, abi, platform] = tags
  const pythonCompatible = python.split('.').some(p => p === 'py3' || p === 'cp313' ||
    (abi === 'abi3' && /^cp3(?:[7-9]|1[0-3])$/.test(p)))
  if (!pythonCompatible) fail('wheel Python ABI mismatch')
  const platformCompatible = platform.split('.').some(p => p === 'any' ||
    (target === 'win32-x64' && p === 'win_amd64') ||
    (target === 'darwin-x64' && compatibleMacTag(p, 'x86_64')) ||
    (target === 'darwin-arm64' && compatibleMacTag(p, 'arm64')))
  if (!platformCompatible || (platform === 'any' && abi !== 'none')) fail('wheel platform mismatch')
}
function compatibleMacTag(tag, arch) {
  const match = tag.match(/^macosx_(\d+)_(\d+)_(x86_64|arm64|universal2)$/)
  return !!match && [arch, 'universal2'].includes(match[3]) &&
    (Number(match[1]) < 12 || (Number(match[1]) === 12 && Number(match[2]) === 0))
}
function binaryArchitecture(bytes, platform, arch) {
  if (platform === 'win32') {
    if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) fail('invalid Windows executable')
    const header = bytes.readUInt32LE(0x3c)
    if (header < 64 || header + 6 > bytes.length || bytes.readUInt32LE(header) !== 0x00004550 ||
        bytes.readUInt16LE(header + 4) !== 0x8664 || arch !== 'x64') fail('Windows executable architecture mismatch')
  } else {
    if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf ||
        bytes.readUInt32LE(4) !== (arch === 'arm64' ? 0x0100000c : 0x01000007)) fail('Mac executable architecture mismatch')
  }
}
function safeRelative(value) {
  if (!text(value) || value.includes('\\') || value.includes('\0') || value.includes(':') ||
      value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) fail('unsafe relative path')
  return value
}
function below(root, target) {
  const relative = path.relative(root, target)
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
function asset(value, requiredKind) {
  if (!record(value) || !['download', 'derived'].includes(value.kind) ||
      (requiredKind && value.kind !== requiredKind) || !text(value.filename) ||
      safeRelative(value.filename).includes('/') || path.basename(value.filename) !== value.filename ||
      !sha(value.sha256) || !Number.isSafeInteger(value.size) || value.size < 1) fail('asset is not pinned')
  if (Object.keys(value).some(key => !['kind', 'filename', 'url', 'sha256', 'size'].includes(key))) fail('unregistered asset input')
  if (value.kind === 'derived') {
    if (Object.hasOwn(value, 'url')) fail('derived asset must not have a URL')
    return value
  }
  if (!text(value.url)) fail('asset URL missing')
  let url
  let basename
  try { url = new URL(value.url); basename = decodeURIComponent(url.pathname.split('/').pop()) }
  catch { fail('asset URL missing') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      basename !== value.filename) fail('asset URL/name mismatch')
  return value
}
function derivedWheel(wheel) {
  if (!record(wheel)) fail('wheel identity missing')
  asset(wheel.asset)
  if (wheel.asset.kind === 'download') {
    if (Object.hasOwn(wheel, 'derived')) fail('download wheel must not have derived identity')
    return
  }
  const value = wheel.derived
  if (!record(value) || !text(value.id) || !text(value.upstreamVersion) ||
      !sha(value.upstreamSha256) || !sha(value.patchSha256) || Object.hasOwn(value, 'patch')) fail('derived wheel identity missing')
  if (Object.keys(value).some(key => !['id', 'upstreamVersion', 'upstreamSha256', 'patchSha256', 'upstreamAsset', 'recipe'].includes(key))) fail('unregistered derived input')
  asset(value.upstreamAsset, 'download')
  if (!record(value.recipe) || Object.keys(value.recipe).some(key => !['path', 'sha256'].includes(key)) ||
      !RECIPES.includes(safeRelative(value.recipe.path)) || !sha(value.recipe.sha256) ||
      value.upstreamSha256 !== value.upstreamAsset.sha256 || value.patchSha256 !== value.recipe.sha256) fail('derived input hash mismatch')
}
function validateOfficialDownload(value, policy) {
  asset(value, 'download')
  if (!record(policy) || !Array.isArray(policy.officialSources) || !policy.officialSources.length) {
    throw new Error('PRIVATE_RUNTIME_PENDING: approved download sources missing')
  }
  const prefixes = policy.officialSources.map(source => {
    let url
    try { if (!text(source)) fail('invalid official source'); url = new URL(source) }
    catch { fail('invalid official source') }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        !url.pathname.endsWith('/') || /%/.test(url.pathname)) fail('invalid official source')
    return url
  })
  const download = new URL(value.url)
  // Compare URL authorities, not string prefixes (userinfo, suffix hosts and ports).
  // A trailing slash enforces a directory boundary instead of /packages-evil.
  if (!prefixes.some(prefix => download.origin === prefix.origin && download.pathname.startsWith(prefix.pathname))) {
    fail('download source not approved by policy')
  }
  return value
}
function validatePolicyRuntimePins(manifest, policy) {
  const target = manifest.platform + '-' + manifest.arch
  const pins = policy.targets?.[target]
  if (!record(pins)) throw new Error('PRIVATE_RUNTIME_PENDING: target runtime pins missing')
  const identity = value => {
    asset(value, 'download')
    return JSON.stringify([value.kind, value.filename, value.url, value.sha256, value.size])
  }
  const sources = values => {
    if (values === undefined) return []
    if (!Array.isArray(values)) fail('invalid pinned license sources')
    const identities = values.map(identity).sort()
    if (new Set(identities).size !== identities.length) fail('duplicate pinned license source')
    return identities
  }
  for (const name of ['python', 'node']) {
    const pin = pins[name], runtime = manifest[name]
    if (!record(pin) || !text(pin.version) || !record(pin.asset)) throw new Error('PRIVATE_RUNTIME_PENDING: target runtime pin missing')
    if (runtime.version !== pin.version || identity(runtime.asset) !== identity(pin.asset) ||
        JSON.stringify(sources(runtime.licenseSources)) !== JSON.stringify(sources(pin.licenseSources))) {
      fail('target runtime asset/license-source pin mismatch')
    }
    validateOfficialDownload(runtime.asset, policy)
    for (const source of runtime.licenseSources || []) validateOfficialDownload(source, policy)
  }
}
function licenses(values, inventory) {
  if (!Array.isArray(values) || values.length === 0) fail('license evidence missing')
  for (const value of values) {
    if (!record(value) || !text(value.approvalId) || !text(value.spdx) || value.review !== 'approved' || !sha(value.sha256)) fail('license not reviewed')
    const entry = inventory.get(safeRelative(value.path))
    if (!entry || entry.kind !== 'file' || entry.sha256 !== value.sha256) fail('license absent from inventory')
  }
}
function validateManifestShape(manifest, target) {
  if (!record(manifest) || manifest.schemaVersion !== 1 || manifest.kind !== 'rt-private-python-runtime' ||
      manifest.complete !== true || !TARGETS.includes(manifest.platform + '-' + manifest.arch) ||
      (target && manifest.platform + '-' + manifest.arch !== target) || !sha(manifest.sourceLockSha256) ||
      !sha(manifest.preparationPolicySha256)) fail('incomplete manifest or wrong target')
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail('file inventory missing')
  if (manifest.platform === 'darwin' && manifest.minimumMacOS !== '12.0') fail('Mac minimum OS must match the declared 12.0 support')
  const inventory = new Map()
  const folded = new Set()
  for (const entry of manifest.files) {
    if (!record(entry)) fail('invalid inventory entry')
    const name = safeRelative(entry.path)
    if (!/^(python\/|node\/|providers\/|licenses\/|bootstrap\.py$|private_runtime_manifest\.cjs$|miniracer_unicode_adapter\.py$|sbom\.spdx\.json$)/.test(name) ||
        /(^|\/)(\.env(?:\..*)?|cookies?\.json|credentials?\.json|accounts?\.json)$/i.test(name) ||
        /\.(db|sqlite|sqlite3)$/i.test(name)) fail('non-runtime file in inventory')
    if (inventory.has(name) || folded.has(name.toLowerCase())) fail('duplicate inventory path')
    folded.add(name.toLowerCase())
    if (entry.kind === 'file') {
      if (!sha(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0) fail('file hash/size missing')
    } else if (entry.kind === 'symlink') {
      if (!text(entry.target) || entry.target.includes('\\') || entry.target.includes('\0') ||
          path.posix.isAbsolute(entry.target) || entry.target.includes(':')) fail('unsafe symlink')
      const destination = path.posix.normalize(path.posix.join(path.posix.dirname(name), entry.target))
      if (destination === '..' || destination.startsWith('../') || destination === '.') fail('escaping symlink')
    } else fail('unsupported file kind')
    inventory.set(name, entry)
  }
  for (const runtime of [manifest.python, manifest.node]) {
    if (!record(runtime) || !text(runtime.version) || !inventory.has(safeRelative(runtime.executable))) fail('executable missing')
    asset(runtime.asset, 'download')
    if (runtime.licenseSources !== undefined) {
      if (!Array.isArray(runtime.licenseSources)) fail('invalid license source list')
      for (const source of runtime.licenseSources) asset(source, 'download')
    }
    licenses(runtime.licenses, inventory)
  }
  if (manifest.python.distribution !== 'python-build-standalone' || !/^3\.13\.\d+$/.test(manifest.python.version) ||
      !manifest.python.executable.startsWith('python/') || manifest.node.version !== '22.23.3' ||
      !manifest.node.executable.startsWith('node/')) fail('runtime identity mismatch')
  if (manifest.bootstrap !== 'bootstrap.py' || inventory.get(manifest.bootstrap)?.kind !== 'file') fail('trusted bootstrap missing')
  const auditValidator = manifest.dependencyAuditValidator
  if (!record(auditValidator) || auditValidator.path !== 'private_runtime_manifest.cjs' || !sha(auditValidator.sha256) ||
      inventory.get(auditValidator.path)?.kind !== 'file' || inventory.get(auditValidator.path)?.sha256 !== auditValidator.sha256) fail('trusted dependency audit validator missing')
  const adapter = manifest.miniRacerAdapter
  if (!record(adapter) || adapter.path !== 'miniracer_unicode_adapter.py' || adapter.version !== '0.12.4' ||
      adapter.windowsStrategy !== 'win32-unicode-resource-prewarm-v1' || !sha(adapter.sha256) ||
      inventory.get(adapter.path)?.kind !== 'file' || inventory.get(adapter.path)?.sha256 !== adapter.sha256) fail('trusted MiniRacer adapter missing')
  if (!record(manifest.providers) || Object.keys(manifest.providers).sort().join(',') !== [...PROVIDERS].sort().join(',')) fail('all providers required')
  for (const provider of PROVIDERS) {
    const value = manifest.providers[provider]
    if (!record(value) || !text(value.version) || value.site !== 'providers/' + provider + '/site' ||
        !Array.isArray(value.wheels) || value.wheels.length === 0) fail('provider lock missing')
    if (!record(value.dependencyAudit) || value.dependencyAudit.format !== 'rt-private-provider-dependency-audit-v1' ||
        value.dependencyAudit.path !== 'providers/' + provider + '/dependency-audit.json' || !sha(value.dependencyAudit.sha256) ||
        inventory.get(value.dependencyAudit.path)?.kind !== 'file' || inventory.get(value.dependencyAudit.path)?.sha256 !== value.dependencyAudit.sha256) fail('dependency audit missing')
    const distributions = new Map()
    for (const wheel of value.wheels) {
      if (!record(wheel) || !text(wheel.distribution) || !text(wheel.version) || !Array.isArray(wheel.dependencies)) fail('wheel identity missing')
      if (!Array.isArray(wheel.requiresDist) || wheel.requiresDist.some(requirement => !text(requirement)) ||
          (wheel.requiresPython !== null && !text(wheel.requiresPython)) || !Array.isArray(wheel.tags) || !wheel.tags.length ||
          wheel.tags.some(tag => !text(tag)) || !record(wheel.metadata) || !sha(wheel.metadata.sha256) ||
          !safeRelative(wheel.metadata.path).startsWith(value.site + '/') ||
          !/\/[^/]+\.dist-info\/METADATA$/.test(wheel.metadata.path) ||
          inventory.get(wheel.metadata.path)?.kind !== 'file' || inventory.get(wheel.metadata.path)?.sha256 !== wheel.metadata.sha256) fail('original wheel metadata missing')
      derivedWheel(wheel)
      if (!wheel.asset.filename.endsWith('.whl')) fail('only locked wheels accepted')
      wheelTarget(wheel.asset.filename, manifest.platform + '-' + manifest.arch)
      const name = canonical(wheel.distribution)
      if (distributions.has(name)) fail('duplicate wheel distribution')
      distributions.set(name, wheel)
      licenses(wheel.licenses, inventory)
    }
    const primary = distributions.get(provider)
    if (!primary || primary.version !== value.version) fail('primary provider/version missing')
    for (const wheel of value.wheels) {
      for (const dependency of wheel.dependencies) {
        if (!text(dependency) || !distributions.has(canonical(dependency))) fail('wheel dependency closure incomplete')
      }
    }
    if (!manifest.files.some(f => f.path.startsWith(value.site + '/'))) fail('provider site empty')
    if (provider === 'akshare' && value.version !== '1.19.1') fail('AKShare pin changed')
    if (provider === 'pywencai' && value.version !== '0.13.1') fail('pywencai pin changed')
    if (provider === 'akshare' || provider === 'mootdx') {
      const racer = distributions.get('mini-racer')
      if (racer?.version !== '0.12.4' ||
          distributions.has('py-mini-racer')) fail('modern MiniRacer compatibility unresolved')
    }
    if (distributions.has('mini-racer') && distributions.get('mini-racer').version !== '0.12.4') fail('MiniRacer adapter version mismatch')
    if (provider === 'mootdx' && (value.compatibility !== 'modern-mini-racer' || !primary.derived ||
        primary.derived.upstreamVersion !== '0.11.7' || value.version !== '0.11.7+rt.1' ||
        primary.derived.upstreamSha256 !== 'eab475f1d08b1c71ea51212c8b1b1038c4739798f7d95ad1a6fb7bb26e348ef2' ||
        primary.asset.sha256 !== '35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77' ||
        primary.asset.size !== 413852)) fail('mootdx derived wheel pending')
  }
  if (!record(manifest.sbom) || manifest.sbom.format !== 'SPDX-2.3' || manifest.sbom.path !== 'sbom.spdx.json' ||
      !sha(manifest.sbom.sha256) || inventory.get(manifest.sbom.path)?.sha256 !== manifest.sbom.sha256) fail('SBOM missing')
  return manifest
}
const AUDIT_FORMAT = 'rt-private-provider-dependency-audit-v1'
const MARKER_KEYS = ['implementation_name', 'implementation_version', 'os_name', 'platform_machine',
  'platform_python_implementation', 'platform_release', 'platform_system', 'platform_version',
  'python_full_version', 'python_version', 'sys_platform']
function canonicalName(value) { return text(value) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) }
function identical(left, right) {
  const ordered = (_key, value) => record(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value
  return JSON.stringify(left, ordered) === JSON.stringify(right, ordered)
}
function sortedNames(value) {
  return Array.isArray(value) && value.every(canonicalName) && identical(value, [...new Set(value)].sort())
}
function metadataHeaders(bytes) {
  const headers = new Map()
  let key = null
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (!line) break
    if (/^[ \t]/.test(line)) {
      if (!key) fail('invalid installed metadata header')
      const values = headers.get(key); values[values.length - 1] += '\n' + line
    } else {
      const separator = line.indexOf(':')
      if (separator < 1) fail('invalid installed metadata header')
      key = line.slice(0, separator).toLowerCase()
      const values = headers.get(key) || []
      values.push(line.slice(separator + 1).replace(/^[ \t]+/, '')); headers.set(key, values)
    }
  }
  return headers
}
function validateDependencyAudits(root, manifest, generatorSha256) {
  if (!record(manifest) || !record(manifest.providers) || !Array.isArray(manifest.files) ||
      !record(manifest.python) || !record(manifest.python.asset) || !sha(manifest.python.asset.sha256) ||
      !/^3\.13\.\d+$/.test(manifest.python.version) || !TARGETS.includes(manifest.platform + '-' + manifest.arch) ||
      (generatorSha256 !== undefined && !sha(generatorSha256))) fail('invalid dependency audit context')
  const realRoot = fs.realpathSync(root)
  const inventory = new Map(manifest.files.map(file => [safeRelative(file.path), file]))
  if (inventory.size !== manifest.files.length) fail('duplicate audit inventory path')
  const executable = inventory.get(manifest.python.executable)
  if (!executable || executable.kind !== 'file' || !sha(executable.sha256)) fail('PBS executable evidence missing')
  function bytes(relative, expectedSha256, cap = 8 * 1024 * 1024) {
    const entry = inventory.get(safeRelative(relative)), filename = path.resolve(root, relative)
    if (!entry || entry.kind !== 'file' || entry.sha256 !== expectedSha256 || !sha(expectedSha256) ||
        !below(realRoot, fs.realpathSync(filename)) || !fs.lstatSync(filename).isFile() ||
        fs.statSync(filename).size !== entry.size || entry.size > cap) fail('dependency evidence inventory mismatch')
    const data = fs.readFileSync(filename)
    if (hash(data) !== expectedSha256) fail('dependency evidence byte mismatch')
    return data
  }
  function json(relative, expectedSha256) { return JSON.parse(bytes(relative, expectedSha256).toString('utf8')) }
  const reports = []
  for (const provider of PROVIDERS) {
    const value = manifest.providers[provider]
    if (!record(value) || value.site !== 'providers/' + provider + '/site' || !Array.isArray(value.wheels) || !value.wheels.length ||
        !record(value.dependencyAudit) || value.dependencyAudit.format !== AUDIT_FORMAT ||
        value.dependencyAudit.path !== 'providers/' + provider + '/dependency-audit.json') fail('dependency audit reference missing')
    const audit = json(value.dependencyAudit.path, value.dependencyAudit.sha256)
    if (!record(audit) || audit.schemaVersion !== 1 || audit.kind !== AUDIT_FORMAT || audit.provider !== provider ||
        audit.target !== manifest.platform + '-' + manifest.arch || audit.site !== value.site ||
        !identical(audit.roots, [provider + '==' + value.version]) || !record(audit.generator) ||
        audit.generator.id !== 'rt-private-python-prep-closure-v1' || !sha(audit.generator.scriptSha256) ||
        (generatorSha256 !== undefined && audit.generator.scriptSha256 !== generatorSha256)) fail('dependency audit identity/generator mismatch')
    const tools = audit.toolchain, environment = audit.markerEnvironment
    if (!record(tools) || tools.pythonAssetSha256 !== manifest.python.asset.sha256 ||
        tools.executableSha256 !== executable.sha256 || !text(tools.pipVersion) || !sha(tools.pipMetadataSha256) ||
        !record(tools.packaging) || tools.packaging.id !== 'pip-vendored-packaging' ||
        !text(tools.packaging.version) || !sha(tools.packaging.sourceSha256)) fail('dependency toolchain identity mismatch')
    const windows = manifest.platform === 'win32'
    const machines = windows ? ['amd64', 'x86_64'] : manifest.arch === 'arm64' ? ['arm64', 'aarch64'] : ['x86_64']
    if (!record(environment) || !identical(Object.keys(environment).sort(), [...MARKER_KEYS].sort()) ||
        Object.values(environment).some(v => !text(v)) || environment.implementation_name !== 'cpython' ||
        environment.platform_python_implementation !== 'CPython' || environment.implementation_version !== manifest.python.version ||
        environment.python_full_version !== manifest.python.version || environment.python_version !== '3.13' ||
        environment.sys_platform !== manifest.platform || environment.os_name !== (windows ? 'nt' : 'posix') ||
        environment.platform_system !== (windows ? 'Windows' : 'Darwin') || !machines.includes(environment.platform_machine.toLowerCase())) fail('dependency marker environment mismatch')
    if (!Array.isArray(audit.wheels) || !Array.isArray(audit.installed) || !Array.isArray(audit.evaluations) || !record(audit.activatedExtras)) fail('dependency audit fields missing')
    const wheels = new Map(), actualMetadata = new Set()
    for (const wheel of value.wheels) {
      const name = canonical(wheel.distribution)
      if (!canonicalName(name) || wheels.has(name) || !record(wheel.metadata) || !sha(wheel.metadata.sha256) ||
          !safeRelative(wheel.metadata.path).startsWith(value.site + '/') || !/\/[^/]+\.dist-info\/METADATA$/.test(wheel.metadata.path) ||
          !Array.isArray(wheel.requiresDist) || wheel.requiresDist.some(v => !text(v)) ||
          (wheel.requiresPython !== null && !text(wheel.requiresPython)) || !Array.isArray(wheel.tags) || !wheel.tags.length ||
          wheel.tags.some(v => !text(v)) || !sortedNames(wheel.dependencies)) fail('original wheel/dependency graph missing')
      const headers = metadataHeaders(bytes(wheel.metadata.path, wheel.metadata.sha256, 1024 * 1024))
      if (!identical(headers.get('name')?.map(canonical), [name]) || !identical(headers.get('version'), [wheel.version]) ||
          !identical(headers.get('requires-dist') || [], wheel.requiresDist) ||
          !identical(headers.get('requires-python') || [], wheel.requiresPython === null ? [] : [wheel.requiresPython])) fail('installed METADATA/original constraints mismatch')
      const wheelPath = wheel.metadata.path.slice(0, -'METADATA'.length) + 'WHEEL'
      const wheelEntry = inventory.get(wheelPath)
      if (!wheelEntry || !identical(metadataHeaders(bytes(wheelPath, wheelEntry.sha256, 1024 * 1024)).get('tag') || [], wheel.tags)) fail('installed WHEEL tags mismatch')
      wheels.set(name, wheel); actualMetadata.add(wheel.metadata.path)
    }
    const siteRoot = path.join(root, value.site)
    const directories = fs.readdirSync(siteRoot, { withFileTypes: true }).filter(entry => /\.dist-info$/i.test(entry.name))
    const installedPaths = directories.map(entry => {
      if (!entry.isDirectory() || entry.isSymbolicLink()) fail('invalid installed distribution directory')
      return value.site + '/' + entry.name + '/METADATA'
    })
    if (!identical([...actualMetadata].sort(), installedPaths.sort())) fail('actual installed distribution set mismatch')
    const auditWheels = new Map(), installed = new Map()
    for (const row of audit.wheels) {
      if (!record(row) || !canonicalName(row.name) || auditWheels.has(row.name)) fail('duplicate/invalid audit wheel')
      auditWheels.set(row.name, row)
    }
    for (const row of audit.installed) {
      if (!record(row) || !canonicalName(row.name) || installed.has(row.name)) fail('duplicate/invalid installed audit distribution')
      installed.set(row.name, row)
    }
    if (!identical([...wheels.keys()].sort(), [...auditWheels.keys()].sort()) || !identical([...wheels.keys()].sort(), [...installed.keys()].sort()) ||
        !identical([...wheels.keys()].sort(), Object.keys(audit.activatedExtras).sort())) fail('dependency audit distribution set mismatch')
    for (const [name, wheel] of wheels) {
      const row = auditWheels.get(name), actual = installed.get(name)
      if (row.version !== wheel.version || row.wheelSha256 !== wheel.asset.sha256 || row.metadataPath !== wheel.metadata.path ||
          row.metadataSha256 !== wheel.metadata.sha256 || !identical(row.requiresDist, wheel.requiresDist) ||
          row.requiresPython !== wheel.requiresPython || !identical(row.tags, wheel.tags) || actual.version !== wheel.version ||
          actual.metadataPath !== wheel.metadata.path || actual.metadataSha256 !== wheel.metadata.sha256 ||
          !identical(actual.rawRequiresDist, wheel.requiresDist) || !sortedNames(audit.activatedExtras[name])) fail('dependency audit wheel/original metadata mismatch')
    }
    const evaluations = new Map(), graph = new Map([...wheels.keys()].map(name => [name, new Set()])), propagated = new Map([...wheels.keys()].map(name => [name, new Set()]))
    const activeEdges = []
    for (const row of audit.evaluations) {
      const wheel = record(row) && wheels.get(row.from)
      if (!wheel || !Number.isSafeInteger(row.requiresDistIndex) || row.requiresDistIndex < 0 || row.requiresDistIndex >= wheel.requiresDist.length ||
          row.requirement !== wheel.requiresDist[row.requiresDistIndex] || !canonicalName(row.to) || !sortedNames(row.extras) || typeof row.active !== 'boolean') fail('invalid dependency evaluation')
      const key = row.from + ':' + row.requiresDistIndex
      if (evaluations.has(key)) fail('duplicate dependency evaluation index')
      evaluations.set(key, row)
      if (row.active) {
        if (!wheels.has(row.to) || row.requirement.includes('@')) fail('active dependency absent/URL dependency forbidden')
        graph.get(row.from).add(row.to)
        for (const extra of row.extras) propagated.get(row.to).add(extra)
        activeEdges.push({ from: row.from, requiresDistIndex: row.requiresDistIndex, requirement: row.requirement, dependencyName: row.to })
      }
    }
    if (evaluations.size !== [...wheels.values()].reduce((n, wheel) => n + wheel.requiresDist.length, 0)) fail('dependency evaluation index missing')
    for (const [name, wheel] of wheels) {
      if (!identical(wheel.dependencies, [...graph.get(name)].sort()) || !identical(audit.activatedExtras[name], [...propagated.get(name)].sort())) fail('dependency graph/extras fixed-point mismatch')
    }
    const byIndex = rows => [...rows].sort((a, b) => a.from.localeCompare(b.from) || a.requiresDistIndex - b.requiresDistIndex)
    if (audit.resolvedEdges !== undefined && (!Array.isArray(audit.resolvedEdges) || !identical(byIndex(audit.resolvedEdges), byIndex(activeEdges)))) fail('resolved edges differ from evaluations')
    const reachable = new Set(), queue = [provider]
    while (queue.length) {
      const name = queue.shift()
      if (reachable.has(name)) continue
      if (!wheels.has(name)) fail('dependency root missing')
      reachable.add(name); queue.push(...graph.get(name))
    }
    if (reachable.size !== wheels.size) fail('unreachable installed distribution')
    const reference = audit.installedClosure
    if (!record(reference) || reference.path !== 'providers/' + provider + '/installed-closure.json' || !sha(reference.sha256)) fail('installed closure reference missing')
    const closure = json(reference.path, reference.sha256)
    const stable = object => Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]]))
    const byName = rows => [...rows].sort((a, b) => a.name.localeCompare(b.name))
    const activeRequirements = rows => [...rows].map(row => ({ from: row.from, requiresDistIndex: row.requiresDistIndex, requirement: row.requirement, dependencyName: row.dependencyName })).sort((a, b) => a.from.localeCompare(b.from) || a.requiresDistIndex - b.requiresDistIndex)
    // Native closure preserves site-relative METADATA paths; the audit explicitly
    // maps them to the already-bound provider site without rewriting receipt bytes.
    const closureInstalled = record(closure) && Array.isArray(closure.installed) ? closure.installed.map(row => {
      if (!record(row) || typeof row.metadataPath !== 'string' || !/^[^/\\:]+\.dist-info\/METADATA$/.test(row.metadataPath)) fail('installed closure metadata path invalid')
      return { ...row, metadataPath: manifest.providers[provider].site + '/' + row.metadataPath }
    }) : []
    if (!record(closure) || closure.installedMetadataVerified !== true || closure.python !== manifest.python.version || closure.distributionCount !== wheels.size ||
        !record(closure.environment) || !identical(stable(closure.environment), stable(environment)) || !record(closure.extras) ||
        !identical(stable(closure.extras), stable(audit.activatedExtras)) || !Array.isArray(closure.installed) ||
        !identical(byName(closureInstalled), byName(audit.installed)) || !Array.isArray(closure.evaluations) ||
        !identical(byIndex(closure.evaluations), byIndex(audit.evaluations)) || !identical(closure.packaging, tools.packaging) ||
        !Array.isArray(closure.activeRequiresDist) || !identical(activeRequirements(closure.activeRequiresDist), activeRequirements(activeEdges))) fail('installed closure bytes/facts disagree')
    reports.push({ provider, wheels: wheels.size, evaluations: evaluations.size })
  }
  return reports
}

function projectDependencyGraphs(root, context, generatorSha256) {
  // Projection never authorizes a license or rewrites native evidence files.
  const projected = JSON.parse(JSON.stringify(context))
  for (const provider of PROVIDERS) {
    const lock = projected.providers && projected.providers[provider]
    const reference = lock && lock.dependencyAudit
    const relative = 'providers/' + provider + '/dependency-audit.json'
    if (!record(reference) || reference.path !== relative || reference.format !== AUDIT_FORMAT) fail('dependency audit projection reference invalid')
    const row = projected.files && projected.files.find(item => item.path === relative && item.kind === 'file')
    const filename = path.join(root, relative)
    const absolute = path.resolve(root)
    if (!row || row.sha256 !== reference.sha256 || fs.lstatSync(filename).isSymbolicLink() ||
        !fs.realpathSync(filename).startsWith(fs.realpathSync(absolute) + path.sep) || fs.statSync(filename).size > 8 * 1024 * 1024) fail('dependency audit projection bytes invalid')
    const raw = fs.readFileSync(filename)
    if (hash(raw) !== reference.sha256 || raw.length !== row.size) fail('dependency audit projection SHA mismatch')
    const audit = JSON.parse(raw.toString('utf8'))
    if (!record(audit) || !Array.isArray(audit.evaluations) || !Array.isArray(lock.wheels)) fail('dependency audit projection missing')
    for (const wheel of lock.wheels) {
      if (!record(wheel)) fail('dependency projection wheel invalid')
      const name = canonical(wheel.distribution)
      if (!canonicalName(name)) fail('dependency projection name invalid')
      if (!Array.isArray(wheel.requiresDist) || !Array.isArray(wheel.dependencies)) fail('dependency projection requires original constraints')
      const graph = [...new Set(audit.evaluations.filter(edge => record(edge) && edge.from === name && edge.active === true).map(edge => edge.to))].sort()
      if (!identical(wheel.dependencies, wheel.requiresDist) && !identical(wheel.dependencies, graph)) fail('dependency projection input is neither original constraints nor verified graph')
      wheel.dependencies = graph
    }
  }
  validateDependencyAudits(root, projected, generatorSha256)
  return projected
}
function validateRuntimeTree(root, manifest, target) {
  validateManifestShape(manifest, target)
  const absolute = path.resolve(root)
  if (fs.lstatSync(absolute).isSymbolicLink() || !fs.statSync(absolute).isDirectory()) fail('runtime root is not an owned directory')
  const realRoot = fs.realpathSync(absolute)
  const inventory = new Map(manifest.files.map(entry => [entry.path, entry]))
  const seen = new Set()
  function walk(directory, relative = '') {
    for (const name of fs.readdirSync(directory)) {
      const item = relative ? relative + '/' + name : name
      if (item === MANIFEST) continue
      const filename = path.join(directory, name)
      const stat = fs.lstatSync(filename)
      if (stat.isDirectory()) {
        if (!['python', 'node', 'providers', 'licenses'].includes(item.split('/')[0])) fail('non-runtime directory')
        walk(filename, item)
        continue
      }
      const entry = inventory.get(item)
      if (!entry) fail('unlisted runtime file')
      if (stat.isSymbolicLink()) {
        if (entry.kind !== 'symlink' || fs.readlinkSync(filename).replace(/\\/g, '/') !== entry.target ||
            !below(realRoot, fs.realpathSync(filename))) fail('symlink mismatch/escape')
      } else if (!stat.isFile() || entry.kind !== 'file' || stat.size !== entry.size ||
          hash(fs.readFileSync(filename)) !== entry.sha256 || !below(realRoot, fs.realpathSync(filename))) fail('runtime file mismatch')
      seen.add(item)
    }
  }
  walk(absolute)
  if (seen.size !== inventory.size) fail('inventory file absent')
  for (const executable of [manifest.python.executable, manifest.node.executable]) {
    const filename = path.join(absolute, executable)
    if (!fs.statSync(filename).isFile() || !below(realRoot, fs.realpathSync(filename))) fail('invalid executable')
    binaryArchitecture(fs.readFileSync(filename), manifest.platform, manifest.arch)
    if (manifest.platform === 'darwin' && (fs.statSync(filename).mode & 0o111) === 0) fail('executable mode missing')
  }
  const sbom = JSON.parse(fs.readFileSync(path.join(absolute, manifest.sbom.path), 'utf8'))
  if (sbom.spdxVersion !== 'SPDX-2.3' || sbom.SPDXID !== 'SPDXRef-DOCUMENT' ||
      !Array.isArray(sbom.packages)) fail('invalid SPDX document')
  const required = [{ name: 'python', version: manifest.python.version }, { name: 'node', version: manifest.node.version }]
  for (const value of Object.values(manifest.providers)) {
    for (const wheel of value.wheels) required.push({ name: wheel.distribution, version: wheel.version })
  }
  for (const item of required) {
    if (!sbom.packages.some(p => canonical(p.name) === canonical(item.name) && p.versionInfo === item.version)) fail('SBOM component missing')
  }
  validateDependencyAudits(absolute, manifest)
  return manifest
}
function readValidatedRuntime(root, target) {
  const filename = path.join(root, MANIFEST)
  if (!fs.existsSync(filename)) throw new Error('PRIVATE_RUNTIME_PENDING')
  if (!fs.lstatSync(filename).isFile() || fs.statSync(filename).size > 8 * 1024 * 1024) fail('invalid manifest file')
  const bytes = fs.readFileSync(filename)
  const manifest = validateRuntimeTree(root, JSON.parse(bytes.toString('utf8')), target)
  return { manifest, manifestSha256: hash(bytes) }
}
function validateLock(lock) {
  if (!record(lock) || lock.schemaVersion !== 1 || lock.status !== 'locked' || !record(lock.platforms) ||
      !sha(lock.preparationPolicySha256) ||
      Object.keys(lock.platforms).sort().join(',') !== [...TARGETS].sort().join(',')) throw new Error('PRIVATE_RUNTIME_PENDING')
  for (const target of TARGETS) {
    if (lock.platforms[target]?.preparationPolicySha256 !== lock.preparationPolicySha256) fail('platform preparation policy mismatch')
    validateManifestShape({ ...lock.platforms[target], sourceLockSha256: '1'.repeat(64) }, target)
  }
  return lock
}
// Manual policy is a build-time authority, never an implicit runtime download or approval.
function validatePreparationPolicy(manifest, policy, policySha256) {
  if (!sha(policySha256) || manifest.preparationPolicySha256 !== policySha256) fail('preparation policy hash mismatch')
  if (!record(policy) || policy.schemaVersion !== 1 || policy.kind !== 'rt-private-python-preparation-policy' ||
      !Array.isArray(policy.recipePins) || !Array.isArray(policy.licenseApprovals) ||
      !Array.isArray(policy.licenseRequirements)) fail('invalid preparation policy')
  // Executable approval is independent of the artifact supplying license text.
  // Keeping an approved full archive never authorizes another install-only build.
  validatePolicyRuntimePins(manifest, policy)
  for (const provider of Object.values(manifest.providers)) {
    for (const wheel of provider.wheels) {
      derivedWheel(wheel)
      if (wheel.asset.kind === 'download') validateOfficialDownload(wheel.asset, policy)
      if (wheel.derived) validateOfficialDownload(wheel.derived.upstreamAsset, policy)
    }
  }
  const approvals = new Map()
  for (const approval of policy.licenseApprovals) {
    if (!record(approval) || !text(approval.id) || approvals.has(approval.id) || !text(approval.component) ||
        !text(approval.version) || !sha(approval.artifactSha256) || !sha(approval.licenseSha256) ||
        !text(approval.spdx) || !['approved', 'pending', 'rejected'].includes(approval.decision) ||
        (approval.decision === 'approved' && (!text(approval.reviewedBy) || !text(approval.reviewReference)))) fail('invalid license approval')
    approvals.set(approval.id, approval)
  }
  const pins = new Map()
  for (const pin of policy.recipePins) {
    if (!record(pin) || !RECIPES.includes(safeRelative(pin.path)) || !sha(pin.sha256) || pins.has(pin.path)) fail('invalid recipe approval')
    pins.set(pin.path, pin.sha256)
  }
  const components = [
    { ...manifest.python, component: 'python-build-standalone' },
    { ...manifest.node, component: 'node' },
    ...Object.values(manifest.providers).flatMap(provider => provider.wheels.map(wheel => ({ ...wheel, component: wheel.distribution })))
  ]
  for (const item of components) {
    if (item.derived && pins.get(item.derived.recipe.path) !== item.derived.recipe.sha256) fail('recipe not approved by policy')
    const artifactHashes = [item.asset.sha256, ...(item.licenseSources || []).map(source => source.sha256)]
    const applicable = approval => canonical(approval.component) === canonical(item.component) &&
      approval.version === item.version && artifactHashes.includes(approval.artifactSha256)
    for (const license of item.licenses) {
      const approval = approvals.get(license.approvalId)
      if (!approval || !applicable(approval) || approval.licenseSha256 !== license.sha256 || approval.spdx !== license.spdx ||
          approval.decision !== 'approved') throw new Error('PRIVATE_RUNTIME_PENDING: license approval unavailable')
    }
    // Include all applicable notices, not only a convenient subset of approved texts.
    for (const approval of approvals.values()) {
      if (applicable(approval) && (approval.decision !== 'approved' ||
          !item.licenses.some(license => license.approvalId === approval.id))) throw new Error('PRIVATE_RUNTIME_PENDING: license evidence incomplete')
    }
    const requirements = policy.licenseRequirements.filter(requirement =>
      canonical(requirement.component) === canonical(item.component) && requirement.version === item.version)
    if (!requirements.length) throw new Error('PRIVATE_RUNTIME_PENDING: component license requirements missing')
    for (const requirement of requirements) {
      if (!sha(requirement.sha256)) throw new Error('PRIVATE_RUNTIME_PENDING: license member hash missing')
      safeRelative(requirement.member)
      if (requirement.role === 'provenance') {
        if (!manifest.files.some(file => file.kind === 'file' && file.sha256 === requirement.sha256)) throw new Error('PRIVATE_RUNTIME_PENDING: provenance missing')
      } else if (!item.licenses.some(license => license.sha256 === requirement.sha256 && license.spdx === requirement.spdx)) {
        throw new Error('PRIVATE_RUNTIME_PENDING: required license text missing')
      }
    }
    if (item.component === 'python-build-standalone' && (!item.licenseSources?.length ||
        !requirements.some(requirement => requirement.role === 'provenance' && requirement.member === 'python/PYTHON.json'))) {
      throw new Error('PRIVATE_RUNTIME_PENDING: PBS full-archive provenance missing')
    }
  }
  return manifest
}
module.exports = { PROVIDERS, TARGETS, hash, safeRelative, below, asset, derivedWheel, validateOfficialDownload, validatePreparationPolicy, validateDependencyAudits, projectDependencyGraphs, validateManifestShape, validateRuntimeTree, readValidatedRuntime, validateLock }
