'use strict'

// Ship exact reviewed notice/source bytes beside the runtime. This is delivery
// verification, not license approval, native acceptance or release authority.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ROOT = path.resolve(__dirname, '..')
const SOURCE = 'resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011'
const DESTINATION = 'third-party/python-runtime-mac'
const MANIFEST_SHA256 = 'edfece95f3e668a1f8d6bfafc888f391d174a24b09e9127e209253376e73813d'
const FORMAL_LOCK_SHA256 = 'c20a1a327b91d4022746d2fc18b4a8045c31767134b14fdfae866ba2f06cd6ea'
const PYTHON_ASSETS = {
  arm64: 'd8975d7df4f08f7b1c7aafcdfacbddcec3d366415f2c1a72b2466b6850815933',
  x64: '8e9cb087305bfb8969f68a905f79f41469d4aa5220c1aa71ada7fc9953bdba0f',
}
const REQUIRED = [
  'README.txt',
  ...['LICENSE.bdb.txt', 'LICENSE.libX11.txt', 'LICENSE.libXau.txt', 'LICENSE.libxcb.txt',
    'LICENSE.openssl-1.1.txt', 'LICENSE.openssl-3.txt', 'LICENSE.tix.txt', 'LICENSE.tcl.txt',
    'MPL-2.0.txt', 'OPENSSL-ACKNOWLEDGMENTS.txt'].map(name => 'notices/' + name),
  ...['LICENSE', '__init__.py', '__main__.py', 'cacert.pem', 'core.py', 'py.typed']
    .map(name => 'source/pip-vendored-certifi-2026.6.17/pip/_vendor/certifi/' + name),
  'source/pip-context/pip/_vendor/vendor.txt',
  'source/pip-context/pip-26.2.1.dist-info/METADATA',
  'source/pip-context/pip-26.2.1.dist-info/licenses/LICENSE.txt',
  'source/pip-context/pip-26.2.1.dist-info/licenses/AUTHORS.txt',
].sort()
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function fail(code) { const error = new Error(code); error.code = code; throw error }
function relative(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.split('/').some(part =>
    !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part))) fail('MAC_MATERIAL_PATH_INVALID')
  return name
}
function bytes(root, name, cap = 4 * 1024 * 1024) {
  relative(name)
  if (fs.lstatSync(root).isSymbolicLink()) fail('MAC_MATERIAL_LINK')
  const base = fs.realpathSync(root), filename = path.resolve(base, name)
  if (!filename.startsWith(base + path.sep)) fail('MAC_MATERIAL_PATH_INVALID')
  let current = base
  for (const part of name.split('/')) {
    current = path.join(current, part)
    if (fs.lstatSync(current).isSymbolicLink()) fail('MAC_MATERIAL_LINK')
  }
  const fd = fs.openSync(filename, 'r')
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > cap) fail('MAC_MATERIAL_FILE_INVALID')
    const value = fs.readFileSync(fd)
    if (value.length !== stat.size || value.length > cap) fail('MAC_MATERIAL_FILE_CHANGED')
    return value
  } finally { fs.closeSync(fd) }
}
function planFromManifest(manifest) {
  if (manifest?.kind !== 'mac-final-obligation-material-delivery-manifest-v1' || !Array.isArray(manifest.files)) fail('MAC_MATERIAL_MANIFEST_INVALID')
  const seen = new Set(), files = []
  for (const row of manifest.files) {
    relative(row.path)
    if (!row.path.startsWith(SOURCE + '/') || !Number.isSafeInteger(row.size) || row.size < 0 || row.size > 4 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(row.sha256 || '') || seen.has(row.path.toLowerCase())) fail('MAC_MATERIAL_MANIFEST_INVALID')
    seen.add(row.path.toLowerCase())
    const name = row.path.slice(SOURCE.length + 1)
    if (REQUIRED.includes(name)) files.push({ path: name, size: row.size, sha256: row.sha256 })
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  if (JSON.stringify(files.map(row => row.path).sort()) !== JSON.stringify(REQUIRED)) fail('MAC_MATERIAL_COVERAGE_INCOMPLETE')
  return files
}
function verifyCopiedMaterials(root, files) {
  for (const row of files) {
    const value = bytes(root, row.path)
    if (value.length !== row.size || hash(value) !== row.sha256) fail('MAC_MATERIAL_BYTES_MISMATCH')
  }
}
function loadPlan() {
  const sourceRoot = path.join(ROOT, SOURCE)
  const raw = bytes(sourceRoot, 'delivery-manifest.json')
  if (hash(raw) !== MANIFEST_SHA256) fail('MAC_MATERIAL_MANIFEST_CHANGED')
  const files = planFromManifest(JSON.parse(raw.toString('utf8')))
  verifyCopiedMaterials(sourceRoot, files)
  return { sourceRoot, files }
}
function recipientIndex(files) {
  return 'Third-party notices and corresponding source for RT-ResearchFlow\n\n' +
    'The files listed below are included in this application. No additional download or fee is needed to read them.\n' +
    'Exact pip-vendored certifi 2026.6.17 source: source/pip-vendored-certifi-2026.6.17/pip/_vendor/certifi/\n' +
    'Complete Mozilla Public License 2.0: notices/MPL-2.0.txt\n' +
    'OpenSSL notices and acknowledgments: notices/LICENSE.openssl-1.1.txt, notices/LICENSE.openssl-3.txt, notices/OPENSSL-ACKNOWLEDGMENTS.txt\n' +
    'Original notices are retained without shortening or changing their terms. No endorsement is implied.\n' +
    'This byte-delivery record grants no new license, broker access or trading authority.\n\nIncluded files:\n' +
    files.map(row => row.path).join('\n') + '\n'
}
function packagedLocation(context) {
  const product = context.packager?.appInfo?.productFilename
  const arch = typeof context.arch === 'string' ? context.arch : { 1: 'x64', 3: 'arm64' }[context.arch]
  if (context.electronPlatformName !== 'darwin' || !PYTHON_ASSETS[arch] || typeof product !== 'string' ||
      !product || /[\\/\x00-\x1f]/.test(product) || typeof context.appOutDir !== 'string' || !path.isAbsolute(context.appOutDir)) fail('MAC_MATERIAL_CONTEXT_INVALID')
  const app = path.join(context.appOutDir, product + '.app')
  if (fs.lstatSync(app).isSymbolicLink()) fail('MAC_MATERIAL_LINK')
  const resources = path.join(app, 'Contents', 'Resources')
  // Walk the relative resources chain rather than resolving past an untrusted link.
  const runtime = JSON.parse(bytes(app, 'Contents/Resources/private-python-runtime/manifest.json', 32 * 1024 * 1024))
  if (runtime.platform !== 'darwin' || runtime.arch !== arch || runtime.sourceLockSha256 !== FORMAL_LOCK_SHA256 ||
      runtime.python?.asset?.sha256 !== PYTHON_ASSETS[arch]) fail('MAC_MATERIAL_RUNTIME_BINDING_INVALID')
  const root = path.join(resources, DESTINATION)
  bytes(app, 'Contents/Resources/' + DESTINATION + '/README.txt')
  return { root, arch }
}
function receipt(files, arch) {
  const index = Buffer.from(recipientIndex(files), 'utf8')
  return { kind: 'rt-mac-recipient-material-delivery-v1', target: 'darwin-' + arch,
    sourceManifestSha256: MANIFEST_SHA256, formalLockSha256: FORMAL_LOCK_SHA256,
    pythonAssetSha256: PYTHON_ASSETS[arch], copyVerified: true, releaseEligible: false,
    licenseApprovalGranted: false, files, index: { path: 'START-HERE.txt', size: index.length, sha256: hash(index) } }
}
function checkDelivery(context, write = false) {
  const { files } = loadPlan(), { root, arch } = packagedLocation(context)
  verifyCopiedMaterials(root, files)
  const expected = receipt(files, arch), index = Buffer.from(recipientIndex(files), 'utf8')
  const raw = Buffer.from(JSON.stringify(expected, null, 2) + '\n')
  if (write) {
    fs.writeFileSync(path.join(root, 'START-HERE.txt'), index, { flag: 'wx' })
    fs.writeFileSync(path.join(root, 'DELIVERY.json'), raw, { flag: 'wx' })
  }
  if (!bytes(root, 'START-HERE.txt').equals(index) || !bytes(root, 'DELIVERY.json').equals(raw)) fail('MAC_MATERIAL_DELIVERY_CHANGED')
  return expected
}
function withMacDistributionMaterials(base) {
  const platformExtra = base.mac?.extraResources
  const extras = platformExtra == null ? [] : Array.isArray(platformExtra) ? platformExtra : [platformExtra]
  return { ...base, mac: { ...base.mac, extraResources: [...extras, { from: path.join(ROOT, SOURCE),
    to: DESTINATION, filter: REQUIRED }] },
    async beforePack(context) {
      if (context.electronPlatformName === 'darwin') loadPlan()
      if (base.beforePack) await base.beforePack(context)
    },
    async afterPack(context) {
      if (base.afterPack) await base.afterPack(context)
      if (context.electronPlatformName === 'darwin') checkDelivery(context, true)
    },
    async afterSign(context) {
      if (base.afterSign) await base.afterSign(context)
      if (context.electronPlatformName === 'darwin') checkDelivery(context)
    },
  }
}
module.exports = { withMacDistributionMaterials, loadPlan, planFromManifest, verifyCopiedMaterials,
  recipientIndex, checkDelivery, relative, REQUIRED, SOURCE, DESTINATION, MANIFEST_SHA256, FORMAL_LOCK_SHA256, PYTHON_ASSETS }
