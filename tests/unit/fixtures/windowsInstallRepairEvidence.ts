import { createHash } from 'node:crypto'
import {
  createWindowsInstallRepairPreflight, WINDOWS_INSTALL_REPAIR_CAPABILITY,
  windowsInstallRepairTypedValuesDigest, windowsInstallRepairRegistryDigest, windowsInstallRepairInventoryDigest,
} from '../../../electron/main/services/windowsInstallRepairPreflight'
import type {
  WindowsInstallRepairPolicy, WindowsInstallRepairSnapshot, WindowsRepairTypedRegistryValue,
} from '../../../electron/main/services/windowsInstallRepairPreflight'

// Complete synthetic evidence. No real approval, data, registry or installation.
export function windowsRepairEvidenceFixture() {
  const H = (s: string) => createHash('sha256').update(s).digest('hex')
  const now = Date.now() - 10, target = 'D:\\Program Files\\RT-ResearchFlow'
  const appId = 'fixture.app', installer = H('installer')
  const installValues: WindowsRepairTypedRegistryValue[] = [{ name: 'InstallLocation', type: 'REG_SZ', data: target }]
  const uninstallValues: WindowsRepairTypedRegistryValue[] = [{ name: 'UninstallString', type: 'REG_SZ', data: '"' + target + '\\Uninstall RT-ResearchFlow.exe"' }]
  const oldInstall: WindowsRepairTypedRegistryValue[] = [{ name: 'InstallLocation', type: 'REG_SZ', data: 'D:\\Program' }]
  const oldUninstall: WindowsRepairTypedRegistryValue[] = [{ name: 'UninstallString', type: 'REG_SZ', data: 'D:\\Program\\bad-uninstaller.exe' }]
  const policy: WindowsInstallRepairPolicy = {
    appId, executableName: 'RT-ResearchFlow.exe', installKey: 'Software\\fixture-app',
    uninstallKey: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\fixture-app',
    existingProductProofSha256: H('existing-product'), dataRoots: ['D:\\FixtureUserData'],
    installer: { path: 'D:\\FixtureDownloads\\setup.exe', sha256: installer, releaseReceiptSha256: H('release-receipt'),
      mainExecutableSha256: H('fixture-exe'), runtimeSealSha256: H('runtime-seal') },
    capability: { protocol: WINDOWS_INSTALL_REPAIR_CAPABILITY, appId, installerSha256: installer, reviewSha256: H('review') },
    capabilityReviewSha256: H('review'), expectedRegistration: { scope: 'all-users', view: '64',
      installValuesSha256: windowsInstallRepairTypedValuesDigest(installValues), uninstallValuesSha256: windowsInstallRepairTypedValuesDigest(uninstallValues) },
  }
  const dir = (path: string) => ({ path, kind: 'directory' as const, fileId: 'fixture-directory:' + path })
  const file = (path: string, sha256: string, size = 100) => ({ path, kind: 'file' as const, fileId: 'fixture-file:' + path, sha256, size })
  const entries = [{ path: 'trade.db', kind: 'file' as const, sha256: H('unchanged-database'), size: 100 }]
  const snapshot: WindowsInstallRepairSnapshot = {
    collectionId: 'synthetic-initial', observedAtMs: now,
    registry: (['per-user', 'all-users'] as const).flatMap(scope => (['32', '64'] as const).map(view => {
      const present = scope === 'all-users' && view === '64', install = present ? oldInstall : null, uninstall = present ? oldUninstall : null
      const ih = windowsInstallRepairTypedValuesDigest(install), uh = windowsInstallRepairTypedValuesDigest(uninstall)
      return { scope, view, installKey: policy.installKey, uninstallKey: policy.uninstallKey,
        state: present ? 'present' as const : 'absent' as const, installKeyState: present ? 'present' as const : 'absent' as const,
        uninstallKeyState: present ? 'present' as const : 'absent' as const, installValues: install, uninstallValues: uninstall,
        installValuesSha256: ih, uninstallValuesSha256: uh, rawValuesSha256: windowsInstallRepairRegistryDigest(ih, uh),
        ...(present ? { installLocation: 'D:\\Program' } : {}) }
    })),
    paths: [dir('D:\\'), dir('D:\\Program Files'), dir(target), file('D:\\Program', H('foreign-1099'), 1099),
      file(target + '\\RT-ResearchFlow.exe', H('existing-exe')), dir('D:\\FixtureUserData'),
      dir('D:\\FixtureBackups'), file('D:\\FixtureBackups\\backup.bin', H('backup')),
      dir('D:\\FixtureDownloads'), file(policy.installer.path, installer)],
    product: { kind: 'owned-payload', root: target, appId, productProofSha256: policy.existingProductProofSha256,
      identityVerified: true, mainExecutableSha256: H('existing-exe') },
    installer: { appId, sha256: installer, releaseReceiptSha256: policy.installer.releaseReceiptSha256,
      runtimeSealSha256: policy.installer.runtimeSealSha256, identityVerified: true, runtimeGateVerified: true },
    data: [{ root: policy.dataRoots[0], complete: true, entries, backup: { path: 'D:\\FixtureBackups\\backup.bin',
      sha256: H('backup'), inventorySha256: windowsInstallRepairInventoryDigest(entries) } }],
    activeWorkers: 0, sqliteState: 'closed-consistent',
  }
  const result = createWindowsInstallRepairPreflight(policy, snapshot, { scope: 'all-users', view: '64' }, now)
  if (result.kind !== 'preflight-candidate') throw new Error('SYNTHETIC_FIXTURE_PREFLIGHT:' + (result.kind === 'blocked' ? result.reason : result.kind))
  const current = structuredClone(snapshot)
  current.collectionId = 'synthetic-fresh'; current.observedAtMs = Date.now()
  return { policy, plan: result.plan, current, registration: { scope: 'all-users' as const, view: '64' as const, installValues, uninstallValues } }
}
