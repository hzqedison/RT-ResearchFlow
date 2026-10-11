import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { windowsRepairCollectorInvocation } from './windowsInstallRepairCollector'
import type { WindowsRepairCollectorInvocation } from './windowsInstallRepairCollector'
import { windowsRepairNativeHostEnvelope } from './windowsInstallRepairNativeBackend'
import type { WindowsRepairConsumerRoots, WindowsRepairNativeLaunchFacts } from './windowsInstallRepairConsumer'
function fail(): never { throw new Error('WINDOWS_REPAIR_NATIVE_LAUNCH_REJECTED') }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

// Captures the REAL direct-parent process via local native handles/CIM. It does
// not trust --parent-installer or caller JSON. No registry/file mutation here.
export async function collectWindowsRepairNativeLaunch(
  roots: WindowsRepairConsumerRoots, hostPath: string, consumerPath: string,
  nonceFromReviewedInstallerChannel: Uint8Array, explicitConsentFromReviewedInstallerChannel: boolean,
  systemRoot: string,
  run?: (spec: WindowsRepairCollectorInvocation) => Promise<Uint8Array>,
): Promise<WindowsRepairNativeLaunchFacts> {
  if (!run) fail()
  const host = readFileSync(hostPath), consumer = readFileSync(consumerPath)
  if (hash(host) !== roots.nativeHostSha256 || hash(consumer) !== roots.consumerSha256) fail()
  const base = windowsRepairCollectorInvocation({ installKey: 'Software\\unused-native-launch',
    uninstallKey: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\unused-native-launch' }, systemRoot)
  const spec = windowsRepairNativeHostEnvelope({ ...base, env: { ...base.env, TEMP: roots.journalRoot, TMP: roots.journalRoot } },
    host, roots.nativeHostSha256, { schemaVersion: 1, operation: 'launch-facts', consumerPid: process.pid })
  const bytes = await run(spec)
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > spec.stdoutCap) fail()
  let row: any
  try { row = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)) } catch { fail() }
  if (!row || !/^[a-f0-9]{64}$/.test(row.directParentImageSha256) || row.directParentRunning !== true ||
      typeof row.directParentRepairIntent !== 'boolean' || !['per-user', 'all-users'].includes(row.selectedScope) ||
      !/^[DK]:\\Program Files\\RT-ResearchFlow$/.test(row.selectedTarget) || !/^S-1-\d+(?:-\d+)+$/.test(row.currentUserSid) ||
      typeof row.elevated !== 'boolean' || !Number.isSafeInteger(row.parentProcessId) || row.parentProcessId !== process.ppid ||
      !/^\d+$/.test(row.parentCreatedTicks)) fail()
  return { consumerSha256: roots.consumerSha256, directParentImageSha256: row.directParentImageSha256,
    directParentRunning: true, directParentRepairIntent: row.directParentRepairIntent,
    selectedScope: row.selectedScope, selectedTarget: row.selectedTarget, currentUserSid: row.currentUserSid, elevated: row.elevated,
    // This flag/nonce may originate only in the reviewed direct installer pipe,
    // not argv, payload accepted=true or a mutable receipt on disk.
    explicitConsentObserved: explicitConsentFromReviewedInstallerChannel,
    nonce: Buffer.from(nonceFromReviewedInstallerChannel) }
}
