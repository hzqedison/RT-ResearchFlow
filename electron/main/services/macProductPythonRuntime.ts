import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { macProductPythonArtifact, type MacProductPythonArtifact } from '../../shared/productPythonDownloads'

type Runner = (executable: string, args: string[], input?: string, timeout?: number, collect?: boolean) => Promise<string>
const execute = promisify(execFile)
const pending = new Map<string, Promise<string>>()

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function verifyMacPythonArchive(path: string, artifact: MacProductPythonArtifact): Promise<void> {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== artifact.size) throw Error('PRODUCT_PYTHON_ARCHIVE_SIZE_MISMATCH')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  if (hash.digest('hex') !== artifact.sha256) throw Error('PRODUCT_PYTHON_ARCHIVE_CHECKSUM_MISMATCH')
}

export function assertMacPythonArchiveEntries(entries: string[], version: string): void {
  if (!entries.length || entries.some(path => !path.startsWith('python/') || path.includes('\\')
    || path.includes('\0') || path.split('/').includes('..'))) throw Error('PRODUCT_PYTHON_UNSAFE_ARCHIVE')
  const minor = version.split('.').slice(0, 2).join('.')
  if (!entries.includes('python/bin/python3') || !entries.includes(`python/lib/python${minor}/LICENSE.txt`)) {
    throw Error('PRODUCT_PYTHON_INCOMPLETE_ARCHIVE')
  }
}

async function download(path: string, artifact: MacProductPythonArtifact, report: (message: string) => void): Promise<void> {
  const temporary = `${path}.download-${randomUUID()}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  const file = await open(temporary, 'wx')
  try {
    // Electron's network stack respects the application's configured proxy.
    const { net } = await import('electron')
    const response = await net.fetch(artifact.url, { signal: controller.signal })
    if (!response.ok || !response.body) throw Error('PRODUCT_PYTHON_DOWNLOAD_FAILED')
    const reader = response.body.getReader()
    let received = 0
    let announced = -1
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        received += chunk.value.byteLength
        if (received > artifact.size) throw Error('PRODUCT_PYTHON_ARCHIVE_SIZE_MISMATCH')
        let offset = 0
        while (offset < chunk.value.byteLength) {
          const written = await file.write(chunk.value, offset, chunk.value.byteLength - offset)
          if (!written.bytesWritten) throw Error('PRODUCT_PYTHON_DOWNLOAD_WRITE_FAILED')
          offset += written.bytesWritten
        }
        const megabytes = Math.floor(received / 1_048_576)
        if (megabytes !== announced) {
          announced = megabytes
          report(`下载专用 Python：${megabytes}/${Math.ceil(artifact.size / 1_048_576)} MB`)
        }
      }
    } finally { await reader.cancel().catch(() => {}) }
    await file.close()
    report('校验专用 Python 下载文件')
    await verifyMacPythonArchive(temporary, artifact)
    await rename(temporary, path)
  } finally {
    clearTimeout(timeout)
    await file.close().catch(() => {})
    // Only this operation's unpublished download file is disposable.
    await rm(temporary, { force: true }).catch(() => {})
  }
}

export async function prepareMacProductPython(userData: string, minimumMinor: number, run: Runner, report: (message: string) => void = () => {}): Promise<string> {
  if (process.platform !== 'darwin') throw Error('PRODUCT_PYTHON_PLATFORM_UNSUPPORTED')
  const root = resolve(userData, 'runtime')
  const active = pending.get(root)
  if (active) return active
  const operation = prepare(root, userData, minimumMinor, run, report)
  pending.set(root, operation)
  try { return await operation } finally { if (pending.get(root) === operation) pending.delete(root) }
}

async function prepare(root: string, userData: string, minimumMinor: number, run: Runner, report: (message: string) => void): Promise<string> {
  const destination = join(root, 'python')
  const executable = join(destination, 'bin', 'python3')
  const probe = 'import sys,json,struct,ssl,sqlite3,venv,ensurepip; print(json.dumps({"base":sys.base_prefix,"version":list(sys.version_info[:2]),"bits":struct.calcsize("P")*8}))'
  async function inspect(python: string, expected: string) {
    const result = JSON.parse(await run(python, ['-I', '-B', '-c', probe], '', 30_000)) as { base?: string; version?: number[]; bits?: number }
    if (typeof result.base !== 'string' || resolve(result.base) !== expected || result.version?.[0] !== 3
      || !Number.isInteger(result.version[1]) || result.version[1] < minimumMinor || result.bits !== 64) {
      throw Error('PRODUCT_PYTHON_NOT_SELF_CONTAINED')
    }
  }
  if (await exists(destination)) { await inspect(executable, destination); return executable }
  const artifact = macProductPythonArtifact(process.arch)
  const cache = resolve(userData, 'data-source-cache', 'python')
  await mkdir(cache, { recursive: true })
  await mkdir(root, { recursive: true })
  const archive = join(cache, artifact.name)
  let valid = false
  if (await exists(archive)) {
    try { await verifyMacPythonArchive(archive, artifact); valid = true } catch { /* Replace only an invalid owned cache, never a runtime. */ }
  }
  if (!valid) await download(archive, artifact, report)
  report('检查专用 Python 归档路径')
  const environment = { ...process.env, TMPDIR: join(userData, 'data-source-cache', 'tmp') }
  await mkdir(environment.TMPDIR, { recursive: true })
  const listing = await execute('/usr/bin/tar', ['-tzf', archive], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: environment })
  assertMacPythonArchiveEntries(listing.stdout.split(/\r?\n/).filter(Boolean), artifact.version)
  const stage = await mkdtemp(join(root, 'python-preparing-'))
  try {
    report('解压专用 Python，不修改系统安装或应用签名')
    await execute('/usr/bin/tar', ['-xzf', archive, '-C', stage], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024, env: environment })
    const unpacked = join(stage, 'python')
    report('验证专用 Python、SSL、SQLite 和环境创建能力')
    await inspect(join(unpacked, 'bin', 'python3'), unpacked)
    // Existing runtimes are never replaced: only the validated new tree is
    // committed. A failed download/extraction keeps the saved selection intact.
    if (await exists(destination)) throw Error('PRODUCT_PYTHON_DESTINATION_CHANGED')
    await rename(unpacked, destination)
    await inspect(executable, destination)
    return executable
  } finally { await rm(stage, { recursive: true, force: true }).catch(() => {}) }
}
