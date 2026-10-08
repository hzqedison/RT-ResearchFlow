import { app, net } from 'electron'
import Store from 'electron-store'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { link, lstat, mkdir, open, statfs, unlink } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join } from 'node:path'
import {
  compareReleaseVersions, displayReleaseVersion, installerFileName, parseReleaseVersion,
} from '../../shared/appReleasePolicy'
import type {
  AppUpdateCheck, AppUpdateDownload, AppUpdateInfo, AppUpdateProgress, AppUpdateRelease,
} from '../../shared/appUpdateTypes'

const REPOSITORY = 'hzqedison/RT-ResearchFlow'
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`
const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024
const DOWNLOAD_HOSTS = new Set([
  'api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com',
])

interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
  digest: string | null
}
interface ReleaseRecord {
  tag_name: string
  prerelease: boolean
  published_at: string | null
  body: string
  assets: ReleaseAsset[]
}
interface DownloadCandidate {
  version: string
  asset: ReleaseAsset
  sha256: string
}

export class AppUpdateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'AppUpdateError'
  }
}

let preferences: Store<{ downloadDirectory: string }> | null = null
let candidate: DownloadCandidate | null = null
let checking = false
let activeDownload: AbortController | null = null
let verifiedFile: string | null = null
let progress: AppUpdateProgress = {
  phase: 'idle', receivedBytes: 0, totalBytes: 0, percent: 0, fileName: null,
  message: '点击检查更新后才会访问 GitHub，不上传研究数据、账户信息或 API Key。',
}

function getPreferences(): Store<{ downloadDirectory: string }> {
  if (!preferences) {
    const downloadDirectory = process.platform === 'win32'
      ? join(dirname(dirname(app.getPath('exe'))), 'RT-ResearchFlow-Downloads')
      : join(app.getPath('downloads'), 'RT-ResearchFlow-Downloads')
    preferences = new Store({
      name: 'app-update-preferences',
      defaults: { downloadDirectory },
    })
  }
  return preferences
}

export function getAppUpdateInfo(): AppUpdateInfo {
  const currentVersion = app.getVersion()
  return {
    currentVersion,
    displayVersion: displayReleaseVersion(currentVersion),
    platform: process.platform,
    architecture: process.arch,
    packaged: app.isPackaged,
    installDirectory: dirname(app.getPath('exe')),
    downloadDirectory: getPreferences().get('downloadDirectory'),
    includePrereleasesDefault: currentVersion.includes('-'),
    progress: { ...progress },
  }
}

export function setAppUpdateDirectory(directory: string): AppUpdateInfo {
  if (activeDownload) throw new AppUpdateError('BUSY', '下载进行中，请先取消下载再更换位置。')
  if (!isAbsolute(directory)) throw new AppUpdateError('INVALID_DIRECTORY', '请选择完整的本地下载目录。')
  getPreferences().set('downloadDirectory', directory)
  return getAppUpdateInfo()
}

function allowedNetworkUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !DOWNLOAD_HOSTS.has(url.hostname)) {
    throw new AppUpdateError('UNTRUSTED_URL', '更新地址不属于允许的 GitHub 下载域名，已停止请求。')
  }
  return url
}

async function fetchGitHub(value: string, signal: AbortSignal): Promise<Awaited<ReturnType<typeof net.fetch>>> {
  let url = allowedNetworkUrl(value)
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await net.fetch(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      signal,
      bypassCustomProtocolHandlers: true,
      headers: { 'User-Agent': 'RT-ResearchFlow-Updater', Accept: url.hostname === 'api.github.com' ? 'application/vnd.github+json' : '*/*' },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new AppUpdateError('REDIRECT_FAILED', 'GitHub 下载重定向缺少目标地址。')
      url = allowedNetworkUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 403 || response.status === 429) {
        throw new AppUpdateError('RATE_LIMITED', 'GitHub 请求受到限流，请稍后重试；不需要填写大模型 Key。')
      }
      throw new AppUpdateError('HTTP_ERROR', `GitHub 返回 HTTP ${response.status}，请检查网络后重试。`)
    }
    return response
  }
  throw new AppUpdateError('REDIRECT_FAILED', 'GitHub 重定向次数过多，已停止下载。')
}

async function responseText(response: Awaited<ReturnType<typeof net.fetch>>, maximum: number): Promise<string> {
  if (!response.body) throw new AppUpdateError('EMPTY_RESPONSE', 'GitHub 返回了空内容。')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > maximum) throw new AppUpdateError('RESPONSE_TOO_LARGE', '更新信息超过允许大小，已停止处理。')
      chunks.push(Buffer.from(next.value))
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await reader.cancel().catch(() => {})
  }
}

function releaseAsset(value: unknown): ReleaseAsset | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.name !== 'string' || typeof raw.browser_download_url !== 'string'
    || typeof raw.size !== 'number' || !Number.isSafeInteger(raw.size) || raw.size < 1) return null
  return {
    name: raw.name, size: raw.size, browser_download_url: raw.browser_download_url,
    digest: typeof raw.digest === 'string' ? raw.digest : null,
  }
}

function releaseRecord(value: unknown): ReleaseRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.draft !== false || typeof raw.tag_name !== 'string' || !parseReleaseVersion(raw.tag_name)
    || typeof raw.prerelease !== 'boolean' || !Array.isArray(raw.assets)) return null
  return {
    tag_name: raw.tag_name,
    prerelease: raw.prerelease || Boolean(parseReleaseVersion(raw.tag_name)?.prerelease.length),
    published_at: typeof raw.published_at === 'string' ? raw.published_at : null,
    body: typeof raw.body === 'string' ? raw.body.slice(0, 20_000) : '',
    assets: raw.assets.slice(0, 128).map(releaseAsset).filter((asset): asset is ReleaseAsset => asset !== null),
  }
}

function validateAssetUrl(release: ReleaseRecord, asset: ReleaseAsset): string {
  const expected = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(asset.name)}`
  if (asset.browser_download_url !== expected) {
    throw new AppUpdateError('UNTRUSTED_ASSET', '安装包地址与指定仓库、版本或文件名不一致。')
  }
  return expected
}

async function installerChecksum(release: ReleaseRecord, asset: ReleaseAsset, signal: AbortSignal): Promise<string> {
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest ?? '')
  if (digest) return digest[1].toLowerCase()
  const manifest = release.assets.find(item => item.name === 'SHA256SUMS.txt')
  if (!manifest || manifest.size > 64 * 1024) {
    throw new AppUpdateError('CHECKSUM_MISSING', '此版本缺少有效的 SHA-256 校验信息，不提供应用内下载。')
  }
  const text = await responseText(await fetchGitHub(validateAssetUrl(release, manifest), signal), 64 * 1024)
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (match?.[2] === asset.name) return match[1].toLowerCase()
  }
  throw new AppUpdateError('CHECKSUM_MISSING', '校验文件没有当前安装包的 SHA-256，已停止下载。')
}

export async function checkAppRelease(includePrereleases: boolean): Promise<AppUpdateCheck> {
  if (checking || activeDownload) throw new AppUpdateError('BUSY', '已有更新任务进行中，请稍后重试。')
  checking = true
  candidate = null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const releases: ReleaseRecord[] = []
    for (let page = 1; page <= 3; page++) {
      const response = await fetchGitHub(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=30&page=${page}`, controller.signal)
      const raw: unknown = JSON.parse(await responseText(response, 2 * 1024 * 1024))
      if (!Array.isArray(raw)) throw new AppUpdateError('INVALID_RESPONSE', 'GitHub 更新信息格式不正确。')
      releases.push(...raw.map(releaseRecord).filter((release): release is ReleaseRecord => release !== null))
      if (raw.length < 30) break
    }
    const latest = releases.filter(release => includePrereleases || !release.prerelease)
      .sort((left, right) => compareReleaseVersions(right.tag_name, left.tag_name))[0]
    const checkedAt = Date.now()
    if (!latest) return {
      state: 'not-published', checkedAt, release: null,
      message: includePrereleases ? '仓库尚未发布可识别版本的安装包。' : '仓库尚未发布正式安装包；测试用户可勾选接收测试版。',
    }
    const version = latest.tag_name.replace(/^v/, '')
    const name = installerFileName(version, process.platform, process.arch)
    const asset = name ? latest.assets.find(item => item.name === name) : null
    const release: AppUpdateRelease = {
      version, displayVersion: displayReleaseVersion(version),
      releaseUrl: `${RELEASES_URL}/tag/${encodeURIComponent(latest.tag_name)}`,
      publishedAt: latest.published_at, prerelease: latest.prerelease, notes: latest.body,
      installerName: asset?.name ?? null, installerBytes: asset?.size ?? null,
      checksumAvailable: false,
    }
    if (compareReleaseVersions(version, app.getVersion()) < 0) return {
      state: 'not-published', checkedAt, release,
      message: `当前应用 ${displayReleaseVersion(app.getVersion())} 比已发布版本更新，当前版本的安装包尚未发布；不会降级。`,
    }
    if (compareReleaseVersions(version, app.getVersion()) === 0) return {
      state: 'current', checkedAt, release, message: '当前版本与所选发布渠道的最新版本一致。',
    }
    if (!name) return { state: 'unsupported', checkedAt, release, message: '此系统或芯片暂时没有对应的安装包，请查看发布页面。' }
    if (!asset || asset.size > MAX_INSTALLER_BYTES) return {
      state: 'asset-missing', checkedAt, release, message: '发现新版，但对应系统的有效安装包尚未上传完成。',
    }
    validateAssetUrl(latest, asset)
    const sha256 = await installerChecksum(latest, asset, controller.signal)
    release.checksumAvailable = true
    candidate = { version, asset, sha256 }
    return {
      state: 'available', checkedAt, release,
      message: `发现 ${release.displayVersion}。下载后会校验完整安装包，不会自动退出、安装或操作交易账户。`,
    }
  } catch (error) {
    if (controller.signal.aborted) throw new AppUpdateError('TIMEOUT', '检查更新超时，请检查 GitHub 网络连接后重试。')
    throw error
  } finally {
    clearTimeout(timer)
    checking = false
  }
}

export function cancelAppUpdateDownload(): void {
  activeDownload?.abort()
}

async function hashExistingFile(path: string, size: number): Promise<string | null> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.size !== size) return null
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex')
  } catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return null
    throw error
  }
}

export function getVerifiedAppInstaller(): string | null {
  return verifiedFile
}

export async function downloadAppInstaller(
  version: string,
  notify: (value: AppUpdateProgress) => void,
): Promise<AppUpdateDownload> {
  if (!app.isPackaged) throw new AppUpdateError('DEVELOPMENT_MODE', '开发环境不下载安装包，请在已安装的正式或测试应用中使用。')
  if (activeDownload || checking) throw new AppUpdateError('BUSY', '已有更新任务进行中。')
  if (!candidate || candidate.version !== version) throw new AppUpdateError('CHECK_REQUIRED', '请先检查更新，再下载本次检测到的版本。')
  const selected = { ...candidate }
  const directory = getPreferences().get('downloadDirectory')
  let finalName = selected.asset.name
  let finalPath = join(directory, finalName)
  const chooseFreshDestination = (): void => {
    const extension = extname(selected.asset.name)
    const stem = selected.asset.name.slice(0, selected.asset.name.length - extension.length)
    finalName = `${stem}-${randomUUID()}${extension}`
    finalPath = join(directory, finalName)
  }
  const temporaryPath = join(directory, `.${selected.asset.name}.${randomUUID()}.part`)
  const controller = new AbortController()
  activeDownload = controller
  verifiedFile = null
  let receivedBytes = 0
  let timedOut = false
  let handle: Awaited<ReturnType<typeof open>> | null = null
  let temporaryIdentity: { dev: bigint; ino: bigint } | null = null
  let lastNotification = 0
  const emit = (phase: AppUpdateProgress['phase'], message: string): void => {
    progress = {
      phase, receivedBytes, totalBytes: selected.asset.size,
      percent: Math.min(100, Math.floor(receivedBytes * 100 / selected.asset.size)),
      fileName: finalName, message,
    }
    try { notify({ ...progress }) } catch { /* A closed renderer does not invalidate the file operation. */ }
  }
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, 15 * 60_000)
  try {
    emit('downloading', '正在准备下载位置。')
    await mkdir(directory, { recursive: true })
    const existingHash = await hashExistingFile(finalPath, selected.asset.size)
    if (controller.signal.aborted) throw new AppUpdateError('CANCELLED', '下载已取消。')
    if (existingHash === selected.sha256) {
      receivedBytes = selected.asset.size
      verifiedFile = finalPath
      emit('ready', '已有安装包通过 SHA-256 校验，无需重复下载。')
      return { fileName: finalName, directory, sha256: selected.sha256, reused: true }
    }
    try {
      await lstat(finalPath)
      // Older interrupted copies and unrelated same-name files have unknown ownership.
      // Preserve them and choose a new name rather than making retries permanently fail.
      chooseFreshDestination()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const space = await statfs(directory)
    if (space.bavail * space.bsize < selected.asset.size * 2 + 64 * 1024 * 1024) {
      throw new AppUpdateError('DISK_SPACE', '下载盘剩余空间不足，请选择其他盘符。校验与保存需要预留约两倍安装包大小。')
    }
    const response = await fetchGitHub(selected.asset.browser_download_url, controller.signal)
    if (!response.body) throw new AppUpdateError('EMPTY_RESPONSE', 'GitHub 没有返回安装包内容。')
    handle = await open(temporaryPath, 'wx', 0o600)
    const created = await handle.stat({ bigint: true })
    temporaryIdentity = { dev: created.dev, ino: created.ino }
    const reader = response.body.getReader()
    const hash = createHash('sha256')
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        if (controller.signal.aborted) throw new AppUpdateError('CANCELLED', '下载已取消。')
        receivedBytes += next.value.byteLength
        if (receivedBytes > selected.asset.size) throw new AppUpdateError('SIZE_MISMATCH', '安装包超过发布的文件大小，已停止保存。')
        hash.update(next.value)
        let offset = 0
        while (offset < next.value.byteLength) {
          const written = await handle.write(next.value, offset, next.value.byteLength - offset)
          if (!written.bytesWritten) throw new AppUpdateError('WRITE_FAILED', '安装包写入失败，请检查下载盘。')
          offset += written.bytesWritten
        }
        if (Date.now() - lastNotification >= 200) {
          lastNotification = Date.now()
          emit('downloading', '正在从 GitHub 下载完整安装包。')
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    emit('verifying', '正在校验文件大小与 SHA-256。')
    if (receivedBytes !== selected.asset.size || hash.digest('hex') !== selected.sha256) {
      throw new AppUpdateError('CHECKSUM_MISMATCH', '安装包校验不通过，临时文件会删除；请重试下载。')
    }
    await handle.sync()
    await handle.close()
    handle = null
    if (controller.signal.aborted) throw new AppUpdateError('CANCELLED', '下载已取消。')
    const temporaryInfo = await lstat(temporaryPath, { bigint: true })
    if (!temporaryIdentity || !temporaryInfo.isFile()
      || temporaryInfo.dev !== temporaryIdentity.dev || temporaryInfo.ino !== temporaryIdentity.ino) {
      throw new AppUpdateError('FILE_CHANGED', '临时文件已被其他操作替换，已停止保存；请重试。')
    }
    let published = false
    let reused = false
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (controller.signal.aborted) throw new AppUpdateError('CANCELLED', '下载已取消。')
      try {
        // Same-directory hard linking publishes the complete file atomically and
        // refuses existing targets on Windows and macOS. Never fall back to a
        // partial final copy or a rename that can overwrite an unknown target.
        await link(temporaryPath, finalPath)
        published = true
        break
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EEXIST') {
          if (await hashExistingFile(finalPath, selected.asset.size) === selected.sha256) {
            published = true
            reused = true
            break
          }
          chooseFreshDestination()
          continue
        }
        if (['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV', 'ENOSYS'].includes(code ?? '')) {
          throw new AppUpdateError('ATOMIC_SAVE_UNAVAILABLE', '此下载目录不支持安全保存安装包，请选择本地 NTFS 或 APFS 下载目录后重试。')
        }
        throw error
      }
    }
    if (!published) throw new AppUpdateError('FILE_EXISTS', '下载文件名连续发生冲突，请重试或更换下载目录；原文件未覆盖。')
    if (controller.signal.aborted) throw new AppUpdateError('CANCELLED', '下载已取消。')
    // Confirm the actual published bytes as well as the streamed checksum.
    // A failed or cancelled publication is never exposed as a verified installer.
    if (await hashExistingFile(finalPath, selected.asset.size) !== selected.sha256) {
      throw new AppUpdateError('CHECKSUM_MISMATCH', '保存后的安装包校验不通过，请重试；不会信任或覆盖该文件。')
    }
    if (controller.signal.aborted) throw new AppUpdateError('CANCELLED', '下载已取消。')
    verifiedFile = finalPath
    emit('ready', '完整安装包已下载并通过校验。请先备份数据、结束交易操作，再自行运行安装包。')
    return { fileName: finalName, directory, sha256: selected.sha256, reused }
  } catch (error) {
    const failure = controller.signal.aborted
      ? new AppUpdateError(timedOut ? 'TIMEOUT' : 'CANCELLED', timedOut ? '下载超时，请检查网络或重试。' : '下载已取消。')
      : error instanceof AppUpdateError ? error
      : new AppUpdateError('DOWNLOAD_FAILED', '下载或保存失败，请检查网络、目录权限和磁盘空间。')
    emit(failure.code === 'CANCELLED' ? 'cancelled' : 'error', failure.message)
    throw failure
  } finally {
    clearTimeout(timer)
    await handle?.close().catch(() => {})
    if (temporaryIdentity) {
      // 'wx' may fail because a file already exists. Never delete that file,
      // nor a different file subsequently moved over our owned temporary path.
      try {
        const remaining = await lstat(temporaryPath, { bigint: true })
        if (remaining.isFile() && remaining.dev === temporaryIdentity.dev && remaining.ino === temporaryIdentity.ino) {
          await unlink(temporaryPath)
        }
      } catch { /* Cleanup is best effort; unverified temporary files are never trusted. */ }
    }
    activeDownload = null
  }
}
