'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const https = require('node:https')
const { createHash, randomUUID } = require('node:crypto')

const REPOSITORY = 'hzqedison/RT-ResearchFlow'
const VERSIONS = ['1.0.0', '1.1.0']
const PLATFORMS = { windows: ['x64'], macOS: ['arm64', 'x64'] }
const DOWNLOAD_HOSTS = new Set([
  'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com',
])
const DOWNLOAD_TIMEOUT_MS = 300_000
const MAX_REDIRECTS = 5
const MANIFEST = path.resolve(__dirname, '../../tests/fixtures/releases/native-upgrade-1.0-1.1.json')

function fail(code) {
  return Object.assign(new Error(code), { upgradeCode: code })
}

function sameKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function parseArguments(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]
    if (!['--platform', '--arch'].includes(option) || values[option] !== undefined
        || typeof argv[index + 1] !== 'string') throw fail('INVALID_ARGUMENTS')
    values[option] = argv[index + 1]
  }
  const platform = values['--platform']
  const arch = values['--arch']
  if (!Object.hasOwn(PLATFORMS, platform) || !PLATFORMS[platform].includes(arch)) {
    throw fail('UNSUPPORTED_PLATFORM_ARCH')
  }
  return { platform, arch }
}

function validateManifest(manifest) {
  if (!sameKeys(manifest, ['schemaVersion', 'repository', 'releases'])
      || manifest.schemaVersion !== 1 || manifest.repository !== REPOSITORY
      || !Array.isArray(manifest.releases) || manifest.releases.length !== VERSIONS.length) {
    throw fail('INVALID_MANIFEST')
  }
  for (const [index, release] of manifest.releases.entries()) {
    if (!sameKeys(release, ['version', 'tag', 'sourceSha', 'assets'])
        || release.version !== VERSIONS[index] || release.tag !== 'v' + VERSIONS[index]
        || !/^[a-f0-9]{40}$/.test(release.sourceSha)
        || !sameKeys(release.assets, Object.keys(PLATFORMS))) throw fail('INVALID_MANIFEST')
    for (const [platform, architectures] of Object.entries(PLATFORMS)) {
      if (!sameKeys(release.assets[platform], architectures)) throw fail('INVALID_MANIFEST')
      for (const arch of architectures) {
        const asset = release.assets[platform][arch]
        const expectedName = platform === 'windows'
          ? `RT-ResearchFlow-Setup-${release.version}-x64.exe`
          : `RT-ResearchFlow-macOS-${release.version}-${arch}.dmg`
        if (!sameKeys(asset, ['basename', 'sha256', 'size']) || asset.basename !== expectedName
            || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size)
            || asset.size < 1 || asset.size > 512 * 1024 * 1024) throw fail('INVALID_MANIFEST')
      }
    }
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

async function createOutputDirectory() {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
      || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') throw fail('HOSTED_CI_REQUIRED')
  const configuredRoot = process.env.RUNNER_TEMP
  if (!configuredRoot || !path.isAbsolute(configuredRoot)
      || path.resolve(configuredRoot) === path.parse(configuredRoot).root) {
    throw fail('INVALID_RUNNER_TEMP')
  }
  const rootInfo = await fs.lstat(configuredRoot)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw fail('INVALID_RUNNER_TEMP')
  const root = await fs.realpath(configuredRoot)
  const directory = await fs.mkdtemp(path.join(root, 'rt-native-upgrade-'))
  const identity = await fs.lstat(directory, { bigint: true })
  if (!identity.isDirectory() || identity.isSymbolicLink()
      || path.dirname(await fs.realpath(directory)) !== root
      || (await fs.readdir(directory)).length !== 0) throw fail('UNSAFE_OUTPUT_DIRECTORY')
  return { root, directory, identity }
}

async function assertOwnedDirectory(output) {
  const current = await fs.lstat(output.directory, { bigint: true })
  if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, output.identity)
      || await fs.realpath(output.directory) !== output.directory) throw fail('OUTPUT_DIRECTORY_CHANGED')
}

function checkedUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
      || (url.port && url.port !== '443') || !DOWNLOAD_HOSTS.has(url.hostname)) {
    throw fail('UNTRUSTED_DOWNLOAD_URL')
  }
  return url
}

async function openResponse(url, signal) {
  let current = checkedUrl(url)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    signal.throwIfAborted()
    const response = await new Promise((resolve, reject) => {
      const request = https.get(current, {
        signal, rejectUnauthorized: true, minVersion: 'TLSv1.2',
        headers: { 'User-Agent': 'RT-ResearchFlow-native-upgrade-ci', 'Accept-Encoding': 'identity' },
      }, resolve)
      request.on('error', reject)
    })
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location
      response.destroy()
      if (!location) throw fail('INVALID_REDIRECT')
      current = checkedUrl(new URL(location, current).toString())
      continue
    }
    if (response.statusCode !== 200) {
      response.destroy()
      throw fail('DOWNLOAD_HTTP_ERROR')
    }
    return response
  }
  throw fail('TOO_MANY_REDIRECTS')
}

async function removeOwnedPartial(file, identity) {
  if (!identity) return
  let current
  try { current = await fs.lstat(file, { bigint: true }) } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, identity)) {
    throw fail('PARTIAL_FILE_CHANGED')
  }
  await fs.unlink(file)
}

async function downloadInstaller(release, asset, output) {
  await assertOwnedDirectory(output)
  const partial = path.join(output.directory, `.${asset.basename}.${randomUUID()}.partial`)
  const destination = path.join(output.directory, asset.basename)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  let file
  let identity
  let response
  try {
    file = await fs.open(partial, 'wx', 0o600)
    identity = await file.stat({ bigint: true })
    response = await openResponse(
      `https://github.com/${REPOSITORY}/releases/download/${release.tag}/${asset.basename}`,
      controller.signal,
    )
    const length = response.headers['content-length']
    if ((length !== undefined && length !== String(asset.size))
        || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
      throw fail('DOWNLOAD_SIZE_MISMATCH')
    }
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of response) {
      controller.signal.throwIfAborted()
      size += chunk.length
      if (size > asset.size) throw fail('DOWNLOAD_SIZE_MISMATCH')
      hash.update(chunk)
      let offset = 0
      while (offset < chunk.length) {
        const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset)
        if (bytesWritten < 1) throw fail('DOWNLOAD_WRITE_FAILED')
        offset += bytesWritten
      }
    }
    if (size !== asset.size) throw fail('DOWNLOAD_SIZE_MISMATCH')
    if (hash.digest('hex') !== asset.sha256) throw fail('DOWNLOAD_HASH_MISMATCH')
    await file.sync()
    await file.close()
    file = undefined
    controller.signal.throwIfAborted()
    await assertOwnedDirectory(output)
    const current = await fs.lstat(partial, { bigint: true })
    if (!current.isFile() || !sameIdentity(current, identity) || current.size !== BigInt(asset.size)) {
      throw fail('PARTIAL_FILE_CHANGED')
    }
    // A same-directory hard link publishes atomically without replacing an existing file.
    // Never fall back to rename/copy, which could overwrite an unknown destination.
    try { await fs.link(partial, destination) } catch (error) {
      throw fail(error.code === 'EEXIST' ? 'DESTINATION_EXISTS' : 'ATOMIC_FINALIZE_FAILED')
    }
    const published = await fs.lstat(destination, { bigint: true })
    if (!published.isFile() || !sameIdentity(published, identity)) throw fail('FINAL_FILE_CHANGED')
    await removeOwnedPartial(partial, identity)
    return {
      version: release.version, basename: asset.basename, sha256: asset.sha256, size: asset.size,
      path: path.relative(output.root, destination).split(path.sep).join('/'),
    }
  } catch (error) {
    if (error.upgradeCode) throw error
    throw fail(controller.signal.aborted ? 'DOWNLOAD_TIMEOUT' : 'DOWNLOAD_FAILED')
  } finally {
    clearTimeout(timer)
    response?.destroy()
    await file?.close().catch(() => {})
    // Preserve the original error (especially hash failure), and never remove foreign files.
    await removeOwnedPartial(partial, identity).catch(() => {})
  }
}

async function main(argv = process.argv.slice(2)) {
  const { platform, arch } = parseArguments(argv)
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
      || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') throw fail('HOSTED_CI_REQUIRED')
  const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'))
  validateManifest(manifest)
  const output = await createOutputDirectory()
  const installers = []
  for (const release of manifest.releases) {
    installers.push(await downloadInstaller(release, release.assets[platform][arch], output))
  }
  return { installers }
}

module.exports = { main }

if (require.main === module) {
  main().then(receipt => {
    process.stdout.write(JSON.stringify(receipt) + '\n')
  }).catch(error => {
    // Do not print URLs, headers, raw errors, environment variables or credentials.
    process.stderr.write('fetch-upgrade-installers: ' + (error.upgradeCode || 'FETCH_FAILED') + '\n')
    process.exitCode = 1
  })
}
