'use strict'

// Offline, hash-locked assembler. Download/extraction/wheel derivation is a separate
// reviewed preparation step; this command never resolves dependencies or runs pip.
const fs = require('node:fs')
const path = require('node:path')
const { hash, validateLock, validateRuntimeTree, below, validatePreparationPolicy, validateOfficialDownload, derivedWheel, validateDependencyAudits } = require('../electron/shared/privatePythonRuntimeManifest.cjs')

function verifySourceInputs(manifest, assetsRoot, repositoryRoot, policy) {
  for (const runtime of [manifest.python, manifest.node]) {
    validateOfficialDownload(runtime.asset, policy)
    for (const source of runtime.licenseSources || []) validateOfficialDownload(source, policy)
  }
  const assets = [manifest.python.asset, manifest.node.asset,
    ...(manifest.python.licenseSources || []), ...(manifest.node.licenseSources || [])]
  const recipes = []
  for (const provider of Object.values(manifest.providers)) {
    for (const wheel of provider.wheels) {
      derivedWheel(wheel)
      if (wheel.asset.kind === 'download') validateOfficialDownload(wheel.asset, policy)
      if (wheel.derived) validateOfficialDownload(wheel.derived.upstreamAsset, policy)
      assets.push(wheel.asset)
      if (wheel.derived) { assets.push(wheel.derived.upstreamAsset); recipes.push(wheel.derived.recipe) }
    }
  }
  const names = new Map()
  const realAssets = fs.realpathSync(assetsRoot)
  function verifyFile(root, relative, sha256, size) {
    const filename = path.resolve(root, relative)
    if (!below(path.resolve(root), filename) || !fs.lstatSync(filename).isFile() ||
        !below(fs.realpathSync(root), fs.realpathSync(filename)) ||
        (size !== undefined && fs.statSync(filename).size !== size) || hash(fs.readFileSync(filename)) !== sha256) {
      throw new Error('PRIVATE_RUNTIME_INVALID: source asset/recipe mismatch')
    }
  }
  for (const asset of assets) {
    const name = asset.filename.toLowerCase()
    const prior = names.get(name)
    if (prior && (prior.filename !== asset.filename || prior.sha256 !== asset.sha256 || prior.size !== asset.size)) {
      throw new Error('PRIVATE_RUNTIME_INVALID: conflicting asset filename')
    }
    names.set(name, asset)
    verifyFile(realAssets, asset.filename, asset.sha256, asset.size)
  }
  for (const recipe of recipes) {
    if (!policy.recipePins.some(pin => pin.path === recipe.path && pin.sha256 === recipe.sha256)) {
      throw new Error('PRIVATE_RUNTIME_INVALID: recipe not approved by policy')
    }
    verifyFile(repositoryRoot, recipe.path, recipe.sha256)
    verifyFile(realAssets, 'recipes/' + recipe.path, recipe.sha256)
  }
}

const NATIVE_TEST = Symbol('native-test-only')
function nativeTestContext(inputs, context) {
  const invalid = () => { throw new Error('NATIVE_TEST_CONTEXT_INVALID') }
  if (!context || inputs.target !== process.platform + '-' + process.arch ||
      !/^[a-f0-9]{64}$/.test(context.expectedFormalLockSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(context.expectedPolicySha256 || '') ||
      typeof context.temporaryRoot !== 'string' || !path.isAbsolute(inputs.outputRoot)) invalid()
  const temporary = fs.realpathSync(context.temporaryRoot), output = path.resolve(inputs.outputRoot)
  const stat = fs.lstatSync(output)
  if (path.dirname(output) !== temporary || !path.basename(output).startsWith('rt-preseal-') ||
      stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(output) !== output || fs.readdirSync(output).length) invalid()
  return context
}
function assemblyPolicy(lock, policy, policySha256, nativeContext) {
  if (!nativeContext) {
    for (const value of Object.values(lock.platforms)) validatePreparationPolicy(value, policy, policySha256)
    return
  }
  // Native execution is not a redistribution approval. The producer separately
  // binds the raw formal lock and policy to protected source authorization.
  if (policySha256 !== nativeContext.expectedPolicySha256 || policy.schemaVersion !== 1 ||
      policy.kind !== 'rt-private-python-preparation-policy' || !Array.isArray(policy.recipePins) ||
      !Array.isArray(policy.licenseApprovals) || !Array.isArray(policy.licenseRequirements) ||
      Object.values(lock.platforms).some(value => value.preparationPolicySha256 !== policySha256)) {
    throw new Error('NATIVE_TEST_POLICY_BINDING_INVALID')
  }
  // Do not rewrite pending/rejected decisions, remove notices or manufacture
  // approvals. Runtime bytes, dependency audits, original assets and recipes are
  // still validated below; the ordinary assemble path retains all release gates.
}
function assemble(inputs) { return assembleInternal(inputs) }
function assembleNativeTest(inputs, context) {
  nativeTestContext(inputs, context)
  return assembleInternal(inputs, NATIVE_TEST, context)
}

function assembleInternal({ lockPath, preparedRoot, assetsRoot, outputRoot, target }, purpose, nativeContext) {
  const lockBytes = fs.readFileSync(lockPath)
  if (purpose === NATIVE_TEST && hash(lockBytes) !== nativeContext.expectedFormalLockSha256) throw new Error('NATIVE_TEST_LOCK_BINDING_INVALID')
  const lock = validateLock(JSON.parse(lockBytes.toString('utf8')))
  if (!Object.hasOwn(lock.platforms, target)) throw new Error('PRIVATE_RUNTIME_INVALID: unsupported target')
  const source = path.resolve(preparedRoot, target)
  const destination = path.resolve(outputRoot, target)
  if (!below(path.resolve(preparedRoot), source) || !below(path.resolve(outputRoot), destination) ||
      fs.existsSync(destination) || source === destination || below(source, destination) || below(destination, source)) {
    throw new Error('PRIVATE_RUNTIME_INVALID: output must be a new, separate owned directory')
  }
  const manifest = { ...lock.platforms[target], sourceLockSha256: hash(lockBytes) }
  const repositoryRoot = path.resolve(__dirname, '..')
  const policyPath = path.join(repositoryRoot, 'resources/python-runtime/preparation.policy.json')
  if (!fs.existsSync(policyPath)) throw new Error('PRIVATE_RUNTIME_PENDING: preparation policy missing')
  if (!fs.lstatSync(policyPath).isFile() || !below(fs.realpathSync(repositoryRoot), fs.realpathSync(policyPath))) {
    throw new Error('PRIVATE_RUNTIME_INVALID: invalid preparation policy file')
  }
  const policyBytes = fs.readFileSync(policyPath)
  const policy = JSON.parse(policyBytes.toString('utf8'))
  // All targets are sealed against exactly the same manual policy, not just this host.
  assemblyPolicy(lock, policy, hash(policyBytes), purpose === NATIVE_TEST ? nativeContext : undefined)
  const generatorSha256 = hash(fs.readFileSync(path.join(repositoryRoot, 'scripts/prepare-private-python-runtime.py')))
  const projected = require('../electron/shared/privatePythonRuntimeManifest.cjs').projectDependencyGraphs(source, manifest, generatorSha256)
  for (const provider of ['akshare', 'mootdx', 'pywencai']) manifest.providers[provider].wheels = projected.providers[provider].wheels
  validateRuntimeTree(source, manifest, target)
  validateDependencyAudits(source, manifest, generatorSha256)
  const pywencaiAdapterRow = manifest.files.find(row => row.path === 'providers/pywencai/pywencai_adapter.py' && row.kind === 'file')
  const pywencaiAdapterBytes = fs.readFileSync(path.resolve(__dirname, '../resources/python-runtime/pywencai_adapter.py'))
  if (!pywencaiAdapterRow || pywencaiAdapterRow.sha256 !== require('node:crypto').createHash('sha256').update(pywencaiAdapterBytes).digest('hex')) throw new Error('PRIVATE_RUNTIME_INVALID: pywencai adapter differs from current source')
  verifySourceInputs(manifest, assetsRoot, repositoryRoot, policy)
  const auditValidator = fs.readFileSync(path.join(repositoryRoot, 'electron/shared/privatePythonRuntimeManifest.cjs'))
  if (manifest.dependencyAuditValidator.sha256 !== hash(auditValidator)) throw new Error('PRIVATE_RUNTIME_INVALID: dependency audit validator does not match application source')
  const trustedBootstrap = fs.readFileSync(path.join(__dirname, '../resources/python-runtime/bootstrap.py'))
  if (manifest.files.find(f => f.path === 'bootstrap.py')?.sha256 !== hash(trustedBootstrap)) {
    throw new Error('PRIVATE_RUNTIME_INVALID: bootstrap does not match application source')
  }
  const adapter = fs.readFileSync(path.join(__dirname, '../resources/python-runtime/miniracer_unicode_adapter.py'))
  if (manifest.miniRacerAdapter.sha256 !== hash(adapter)) throw new Error('PRIVATE_RUNTIME_INVALID: MiniRacer adapter does not match application source')
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  // Do not overwrite or recursively remove any pre-existing output, even on failure.
  fs.mkdirSync(destination)
  for (const entry of manifest.files.filter(f => f.kind === 'file')) {
    const from = path.join(source, entry.path)
    const to = path.join(destination, entry.path)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
    fs.chmodSync(to, fs.statSync(from).mode & 0o777)
  }
  for (const entry of manifest.files.filter(f => f.kind === 'symlink')) {
    const to = path.join(destination, entry.path)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.symlinkSync(entry.target, to)
  }
  validateRuntimeTree(destination, manifest, target)
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  if (purpose === NATIVE_TEST) fs.writeFileSync(path.join(outputRoot, 'native-test-only.json'),
    JSON.stringify({ kind: 'rt-native-test-only', target, releaseEligible: false,
      finalReleaseAuthorized: false, licenseApprovalGranted: false,
      formalLockSha256: hash(lockBytes), policySha256: hash(policyBytes) }) + '\n', { flag: 'wx' })
  return { target, manifestSha256: hash(fs.readFileSync(path.join(destination, 'manifest.json'))), files: manifest.files.length,
    ...(purpose === NATIVE_TEST ? { purpose: 'native-test-only', releaseEligible: false, licenseApprovalGranted: false } : {}) }
}

function options(args) {
  const result = {}
  const names = { '--lock': 'lockPath', '--prepared': 'preparedRoot', '--assets': 'assetsRoot', '--output': 'outputRoot', '--target': 'target' }
  for (let i = 0; i < args.length; i += 2) {
    if (!names[args[i]] || !args[i + 1] || Object.hasOwn(result, names[args[i]])) throw new Error('PRIVATE_RUNTIME_INVALID: invalid assembler arguments')
    result[names[args[i]]] = args[i + 1]
  }
  if (Object.keys(result).length !== 5) throw new Error('PRIVATE_RUNTIME_PENDING: --lock --prepared --assets --output --target required')
  return result
}
if (require.main === module) {
  try { console.log(JSON.stringify(assemble(options(process.argv.slice(2))))) }
  catch (error) { console.error(error.message.startsWith('PRIVATE_RUNTIME_') ? error.message : 'PRIVATE_RUNTIME_INVALID'); process.exitCode = 1 }
}
module.exports = { assemble, assembleNativeTest, assemblyPolicy, nativeTestContext, options, verifySourceInputs }
