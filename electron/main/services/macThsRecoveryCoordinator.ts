import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

/** Opaque, in-process capabilities. Serialized copies never validate. */
export interface LegacyQuiescenceCapability { readonly kind: 'legacy_quiescence' }
export interface ExecutorExitCapability { readonly kind: 'executor_exit' }
interface Instance {
  instanceId: string
  child: ChildProcess
  exit: Promise<void>
  exited: boolean
  code: number | null
  signal: NodeJS.Signals | null
}
interface LegacyProof {
  directory: string; dev: number; ino: number; supervisionSessionId: string
  retiredEntry: string; instances: Array<{ instanceId: string; pid: number; code: number | null; signal: string | null }>
  fenceHash: string; sourceId: string; supervisionHash: string; retirementHash: string
  files: Array<{ name: string; sha256: string }>
}
const legacyProofs = new WeakMap<LegacyQuiescenceCapability, LegacyProof>()
const exitProofs = new WeakMap<ExecutorExitCapability, { instanceId: string; child: ChildProcess }>()
const localVolumes = new Set<string>()
function fail(code: string): never { throw Object.assign(new Error(code), { code }) }
export function canonicalOrderDirectory(directory: string): string {
  if (!isAbsolute(directory) || directory.startsWith('\\\\') || directory.startsWith('//')) fail('INVALID_DIRECTORY')
  const resolved = resolve(directory)
  const real = realpathSync.native(resolved)
  const equal = process.platform === 'win32' ? real.toLowerCase() === resolved.toLowerCase() : real === resolved
  const stat = lstatSync(resolved)
  if (!equal || !stat.isDirectory() || stat.isSymbolicLink()) fail('INVALID_DIRECTORY')
  // Main-process configured volumes only. Cache the OS result for the same device/root;
  // this is not a guarantee against privileged remounts or arbitrary copied profiles.
  const volume = process.platform === 'win32' ? real.slice(0,3) : String(stat.dev)
  const identity = process.platform + ':' + stat.dev + ':' + volume
  if (!localVolumes.has(identity)) {
    if (process.platform === 'win32') {
      if (!/^[a-zA-Z]:[\\/]/.test(real)) fail('INVALID_DIRECTORY')
      const powershell = join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
      const type = execFileSync(powershell, ['-NoProfile','-NonInteractive','-Command',
        "[System.IO.DriveInfo]::new('" + real[0] + ":\\').DriveType.ToString()"], {encoding:'utf8',windowsHide:true}).trim()
      if (!['Fixed','Removable','Ram'].includes(type)) fail('NONLOCAL_ORDER_DIRECTORY')
    } else if (process.platform === 'darwin') {
      const volumes = execFileSync('/bin/df', ['-P', real], {encoding:'utf8'}).trim().split('\n').slice(1)
      if (!volumes.some(line => /^\/dev\/disk\d[^\s]*\s/.test(line))) fail('NONLOCAL_ORDER_DIRECTORY')
    }
    localVolumes.add(identity)
  }
  return real
}
/** No Windows no-op injection: SQLite handles database durability through its VFS.
 * For the extra retirement fence we flush the file; POSIX additionally flushes its directory.
 * Windows namespace/ACL and Mac physical power loss remain separate platform acceptance.
 */
export function flushOrderDirectory(directory: string): void {
  if (process.platform === 'win32') return
  const fd = openSync(directory, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}
export const LEGACY_SUPERVISION_FILE = 'mac-ths-legacy-supervision.v1.json'
export const LEGACY_RETIREMENT_FILE = 'mac-ths-legacy-retirement.v1.json'
const sha = (raw: Buffer | string) => createHash('sha256').update(raw).digest('hex')
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const digest = /^[a-f0-9]{64}$/
function present(path: string): boolean {
  try { lstatSync(path); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
function regularBytes(path: string): Buffer {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('LEGACY_WRITER_UNFENCED')
  return readFileSync(path)
}
function writeExclusive(directory: string, name: string, raw: string): void {
  const fd = openSync(join(directory, name), 'wx', 0o600)
  try { writeFileSync(fd, raw, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
  flushOrderDirectory(directory)
}
function legacyArtifact(name: string): boolean {
  return ['mac-ths-intents.lock','mac-ths-intents.enabled','mac-ths-intents.pending',
    'mac-ths-intents.v1.json','mac-ths-experiment-journal.json'].includes(name) ||
    (name.startsWith('mac-ths-intents.v1.json.') && name.endsWith('.tmp'))
}
interface SourceOwnership {
  format: 'mac-ths-legacy-supervision-v1'; sourceId: string; directory: string
  dev: number; ino: number; supervisionSessionId: string; retiredEntry: string
}
/** Durable observation of an already completed supervised shutdown, NOT takeover of an
 * active/crashed supervisor. Missing/partial seals are never repaired or inferred from PID.
 * Like the order database, these private records are integrity evidence, not signatures
 * against malicious same-user filesystem rewriting. No arbitrary existing source is adopted.
 */
export function readLegacyRetirement(directory: string): Readonly<LegacyProof> {
  try {
    const canonical = canonicalOrderDirectory(directory), stat = lstatSync(canonical)
    const ownerRaw = regularBytes(join(canonical, LEGACY_SUPERVISION_FILE))
    const retiredRaw = regularBytes(join(canonical, LEGACY_RETIREMENT_FILE))
    const owner = JSON.parse(ownerRaw.toString('utf8')) as SourceOwnership
    const retired = JSON.parse(retiredRaw.toString('utf8')) as {
      format: string; supervisionHash: string; instances: LegacyProof['instances']
      fenceHash: string; files: LegacyProof['files']
    }
    if (!owner || Object.keys(owner).sort().join(',') !== 'dev,directory,format,ino,retiredEntry,sourceId,supervisionSessionId' ||
        owner.format !== 'mac-ths-legacy-supervision-v1' || owner.directory !== canonical ||
        owner.dev !== stat.dev || owner.ino !== stat.ino || !uuid.test(owner.sourceId) ||
        !uuid.test(owner.supervisionSessionId) || !/^[a-zA-Z0-9._-]{1,80}$/.test(owner.retiredEntry) ||
        !retired || Object.keys(retired).sort().join(',') !== 'fenceHash,files,format,instances,supervisionHash' ||
        retired.format !== 'mac-ths-legacy-retirement-v1' || retired.supervisionHash !== sha(ownerRaw) ||
        !Array.isArray(retired.instances) || !retired.instances.length || !Array.isArray(retired.files) ||
        !digest.test(retired.fenceHash)) fail('LEGACY_WRITER_UNFENCED')
    const instances = new Set<string>(), names = new Set<string>()
    for (const instance of retired.instances) {
      if (!instance || Object.keys(instance).sort().join(',') !== 'code,instanceId,pid,signal' ||
          !uuid.test(instance.instanceId) || instances.has(instance.instanceId) ||
          !Number.isSafeInteger(instance.pid) || instance.pid <= 0 ||
          !(instance.code === null || Number.isInteger(instance.code)) ||
          !(instance.signal === null || typeof instance.signal === 'string') ||
          (instance.code === null && instance.signal === null)) fail('LEGACY_WRITER_UNFENCED')
      instances.add(instance.instanceId)
    }
    for (const file of retired.files) {
      if (!file || Object.keys(file).sort().join(',') !== 'name,sha256' || typeof file.name !== 'string' ||
          !file.name || file.name === '.' || file.name === '..' || basename(file.name) !== file.name ||
          /[\\/]/.test(file.name) || [LEGACY_SUPERVISION_FILE, LEGACY_RETIREMENT_FILE].includes(file.name) ||
          names.has(file.name) || !digest.test(file.sha256) ||
          sha(regularBytes(join(canonical, file.name))) !== file.sha256) fail('LEGACY_WRITER_UNFENCED')
      names.add(file.name)
    }
    if (!names.has('mac-ths-intents.lock') ||
        sha(regularBytes(join(canonical, 'mac-ths-intents.lock'))) !== retired.fenceHash ||
        readdirSync(canonical).some(name => legacyArtifact(name) && !names.has(name))) fail('LEGACY_WRITER_UNFENCED')
    const proof: LegacyProof = { directory: canonical, dev: stat.dev, ino: stat.ino,
      sourceId: owner.sourceId, supervisionSessionId: owner.supervisionSessionId, retiredEntry: owner.retiredEntry,
      instances: retired.instances, fenceHash: retired.fenceHash, files: retired.files,
      supervisionHash: sha(ownerRaw), retirementHash: sha(retiredRaw) }
    proof.instances.forEach(Object.freeze); proof.files.forEach(Object.freeze)
    Object.freeze(proof.instances); Object.freeze(proof.files)
    return Object.freeze(proof)
  } catch (cause) {
    throw Object.assign(new Error('LEGACY_WRITER_UNFENCED', { cause }), { code: 'LEGACY_WRITER_UNFENCED' })
  }
}
export function verifyLegacyQuiescence(capability: LegacyQuiescenceCapability | undefined, directory: string): Readonly<LegacyProof> {
  const proof = capability && legacyProofs.get(capability)
  if (!proof || proof.directory !== canonicalOrderDirectory(directory)) fail('LEGACY_WRITER_UNFENCED')
  const current = readLegacyRetirement(directory)
  if (current.supervisionHash !== proof.supervisionHash || current.retirementHash !== proof.retirementHash)
    fail('LEGACY_WRITER_UNFENCED')
  return current
}
export function verifyExecutorExit(capability: ExecutorExitCapability, instanceId: string): void {
  const proof = exitProofs.get(capability)
  if (!proof || proof.instanceId !== instanceId || (proof.child.exitCode === null && proof.child.signalCode === null))
    fail('EXECUTOR_EXIT_UNPROVEN')
}
/** Only owns children launched through this concrete entry. Not an observer for arbitrary PIDs
 * or an implementation of the application's still-unwired upgrade/startup coordinator.
 */
export class MacThsRecoveryCoordinator {
  readonly sessionId = randomUUID()
  private retired = false
  private sourceOwnership: { record: SourceOwnership; hash: string } | null = null
  private retirement: Promise<LegacyQuiescenceCapability> | null = null
  private readonly legacy = new Map<string, Instance>()
  private readonly executors = new Map<string, Instance>()
  private readonly directory: string
  constructor(directory: string, private readonly entryName = 'controlled-legacy-fixture') {
    this.directory = canonicalOrderDirectory(directory)
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(entryName)) fail('INVALID_ENTRY')
  }
  /** Reserve a NEW private source before any writer is launched. mkdir is exclusive:
   * existing directories (even empty ones, or another coordinator's sources) cannot
   * acquire supervision. A crashed owner is intentionally not adoptable.
   * Producers here must be trusted, supervised leaf writers, not detached writer trees.
   */
  static createLegacySource(directory: string, entryName = 'controlled-legacy-fixture'): MacThsRecoveryCoordinator {
    if (!isAbsolute(directory) || !/^[a-zA-Z0-9._-]{1,80}$/.test(entryName)) fail('INVALID_DIRECTORY')
    const parent = canonicalOrderDirectory(dirname(resolve(directory)))
    if (present(directory)) {
      if (present(join(directory, LEGACY_RETIREMENT_FILE))) fail('LEGACY_ENTRY_RETIRED')
      fail('LEGACY_WRITER_UNFENCED')
    }
    try { mkdirSync(directory, { mode: 0o700 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('LEGACY_WRITER_UNFENCED'); throw error }
    flushOrderDirectory(parent)
    const coordinator = new MacThsRecoveryCoordinator(directory, entryName)
    const stat = lstatSync(coordinator.directory)
    const record: SourceOwnership = { format: 'mac-ths-legacy-supervision-v1', sourceId: randomUUID(),
      directory: coordinator.directory, dev: stat.dev, ino: stat.ino,
      supervisionSessionId: coordinator.sessionId, retiredEntry: entryName }
    const raw = JSON.stringify(record)
    writeExclusive(coordinator.directory, LEGACY_SUPERVISION_FILE, raw)
    coordinator.sourceOwnership = { record, hash: sha(raw) }
    return coordinator
  }
  /** Reconstruct read-only cold evidence after recovery-process restart. This never
   * grants a launch entry, observes a new unrelated process, or adopts an active source.
   */
  static restoreLegacyQuiescence(directory: string): LegacyQuiescenceCapability {
    const proof = readLegacyRetirement(directory)
    const capability = Object.freeze({ kind: 'legacy_quiescence' as const })
    legacyProofs.set(capability, proof)
    return capability
  }
  private assertSourceOwner(): void {
    const owned = this.sourceOwnership, stat = lstatSync(this.directory)
    if (!owned || owned.record.supervisionSessionId !== this.sessionId ||
        stat.dev !== owned.record.dev || stat.ino !== owned.record.ino ||
        sha(regularBytes(join(this.directory, LEGACY_SUPERVISION_FILE))) !== owned.hash)
      fail('LEGACY_WRITER_UNFENCED')
  }
  private assertLegacyLaunch(): void {
    if (this.retired || present(join(this.directory, LEGACY_RETIREMENT_FILE))) fail('LEGACY_ENTRY_RETIRED')
    this.assertSourceOwner()
  }
  private start(target: Map<string, Instance>, executable: string, args: readonly string[], options: SpawnOptions = {},
    beforeSpawn?: () => void): Instance {
    // Materialize all caller options/arguments BEFORE the last authorization check.
    // No waits, callbacks, filesystem work or persistence may be inserted after it.
    const argv = [...args]
    const spawnOptions = { ...options, cwd: this.directory, windowsHide: true }
    const instanceId = randomUUID()
    beforeSpawn?.()
    const child = spawn(executable, argv, spawnOptions)
    const instance: Instance = { instanceId, child, exited: false, code: null, signal: null, exit: Promise.resolve() }
    instance.exit = new Promise<void>((done, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        instance.exited = true; instance.code = code; instance.signal = signal; done()
      })
    })
    void instance.exit.catch(() => {})
    target.set(instance.instanceId, instance)
    return instance
  }
  launchLegacy(executable: string, args: readonly string[], options: SpawnOptions = {}) {
    this.assertLegacyLaunch()
    const instance = this.start(this.legacy, executable, args, options, () => this.assertLegacyLaunch())
    return { instanceId: instance.instanceId, child: instance.child, exited: instance.exit }
  }
  retireLegacyEntry(): Promise<LegacyQuiescenceCapability> {
    this.retired = true
    this.retirement ??= this.retireOwnedSource()
    return this.retirement
  }
  private async retireOwnedSource(): Promise<LegacyQuiescenceCapability> {
    this.assertSourceOwner()
    if (!this.legacy.size) fail('LEGACY_WRITER_UNFENCED')
    await Promise.all([...this.legacy.values()].map(instance => instance.exit))
    this.assertSourceOwner()
    if ([...this.legacy.values()].some(instance => !instance.exited || !instance.child.pid)) fail('LEGACY_WRITER_UNFENCED')
    const lock = join(this.directory, 'mac-ths-intents.lock')
    if (!present(lock)) writeExclusive(this.directory, 'mac-ths-intents.lock', JSON.stringify({
      format: 'mac-ths-retired-v1', supervisionSessionId: this.sessionId, retiredEntry: this.entryName }))
    // A separate seal persists retirement even when the ordinary original lock is retained.
    // No existing source byte, old lock or failed/partial seal is replaced.
    const files = readdirSync(this.directory).filter(name =>
      ![LEGACY_SUPERVISION_FILE, LEGACY_RETIREMENT_FILE, 'mac-ths-orders.v2.sqlite',
        'mac-ths-orders.v2.sqlite-journal', 'mac-ths-orders.v2.sqlite-wal', 'mac-ths-orders.v2.sqlite-shm',
        'mac-ths-orders.sqlite-enabled'].includes(name) &&
      !lstatSync(join(this.directory, name)).isDirectory()).sort()
      .map(name => ({ name, sha256: sha(regularBytes(join(this.directory, name))) }))
    const raw = JSON.stringify({ format: 'mac-ths-legacy-retirement-v1',
      supervisionHash: this.sourceOwnership!.hash,
      instances: [...this.legacy.values()].map(instance => ({ instanceId: instance.instanceId, pid: instance.child.pid!,
        code: instance.code, signal: instance.signal })),
      fenceHash: sha(regularBytes(lock)), files })
    writeExclusive(this.directory, LEGACY_RETIREMENT_FILE, raw)
    return MacThsRecoveryCoordinator.restoreLegacyQuiescence(this.directory)
  }
  launchExecutor(executable: string, args: readonly string[], options: SpawnOptions = {}, beforeSpawn?: () => void) {
    const instance = this.start(this.executors, executable, args, options, beforeSpawn)
    return { instanceId: instance.instanceId, child: instance.child }
  }
  async waitExecutor(instanceId: string): Promise<ExecutorExitCapability> {
    const instance = this.executors.get(instanceId)
    if (!instance) fail('EXECUTOR_EXIT_UNPROVEN')
    await instance.exit
    const capability = Object.freeze({ kind: 'executor_exit' as const })
    exitProofs.set(capability, { instanceId, child: instance.child })
    return capability
  }
  async stopExecutor(instanceId: string): Promise<ExecutorExitCapability> {
    const instance = this.executors.get(instanceId)
    if (!instance) fail('EXECUTOR_EXIT_UNPROVEN')
    if (!instance.exited && !instance.child.kill()) fail('EXECUTOR_STOP_FAILED')
    return this.waitExecutor(instanceId)
  }
}
