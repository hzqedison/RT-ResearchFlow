import { createHash, generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectWindowsRepairNativeLaunch } from '../../electron/main/services/windowsInstallRepairNativeLaunch'
import type { WindowsRepairConsumerRoots } from '../../electron/main/services/windowsInstallRepairConsumer'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const hostPath = resolve(__dirname, '../../resources/windows-install-repair-native-host.ps1')
const consumerPath = resolve(__dirname, '../../electron/main/services/windowsInstallRepairConsumer.ts')
function roots(): WindowsRepairConsumerRoots {
  return { producerKey: generateKeyPairSync('ed25519').publicKey, consumerSha256: hash(readFileSync(consumerPath)), nativeHostSha256: hash(readFileSync(hostPath)),
    producerSha256: 'a'.repeat(64), installerSha256: 'b'.repeat(64), planSha256: 'c'.repeat(64), appId: 'fixture.native', target: 'D:\\Program Files\\RT-ResearchFlow',
    scope: 'all-users', view: '64', initiatingUserSid: 'S-1-5-21-123-456-789-1001', intentNonceSha256: 'd'.repeat(64),
    payloadRoot: 'D:\\FixturePayload', journalRoot: 'D:\\FixtureJournal', programFiles: [] }
}
function facts() { return { directParentImageSha256: 'b'.repeat(64), directParentRunning: true, directParentRepairIntent: true,
  selectedScope: 'all-users', selectedTarget: 'D:\\Program Files\\RT-ResearchFlow', currentUserSid: 'S-1-5-21-123-456-789-1001', elevated: true,
  parentProcessId: process.ppid, parentCreatedTicks: '123456' } }
describe('native launch collector protocol, synthetic responses; not genuine ancestry proof', () => {
  it('binds the actual consumer PID and compiled source bytes before a native child', async () => {
    const r = roots()
    const result = await collectWindowsRepairNativeLaunch(r, hostPath, consumerPath, Buffer.alloc(32), false, 'C:\\Windows', async spec => {
      expect(spec.shell).toBe(false)
      const envelope = JSON.parse(Buffer.from(spec.input).toString('utf8'))
      expect(JSON.parse(envelope.payload)).toEqual({ schemaVersion: 1, operation: 'launch-facts', consumerPid: process.pid })
      expect(hash(Buffer.from(envelope.source, 'base64'))).toBe(r.nativeHostSha256)
      return Buffer.from(JSON.stringify(facts()))
    })
    expect(result.explicitConsentObserved).toBe(false)
  })
  it.each(['pid', 'scope', 'target', 'sid', 'elevation', 'hash', 'created'])('refuses malformed %s facts', async kind => {
    const row = facts()
    if (kind === 'pid') row.parentProcessId++
    if (kind === 'scope') row.selectedScope = 'unknown'
    if (kind === 'target') row.selectedTarget = 'D:\\Program'
    if (kind === 'sid') row.currentUserSid = 'request-sid'
    if (kind === 'elevation') (row as any).elevated = 1
    if (kind === 'hash') row.directParentImageSha256 = ''
    if (kind === 'created') row.parentCreatedTicks = 'unknown'
    await expect(collectWindowsRepairNativeLaunch(roots(), hostPath, consumerPath, Buffer.alloc(32), false, 'C:\\Windows',
      async () => Buffer.from(JSON.stringify(row)))).rejects.toThrow('NATIVE_LAUNCH_REJECTED')
  })
  it('rejects a host or consumer replacement before launching', async () => {
    const r = roots(); r.nativeHostSha256 = 'e'.repeat(64); let called = false
    await expect(collectWindowsRepairNativeLaunch(r, hostPath, consumerPath, Buffer.alloc(32), false, 'C:\\Windows',
      async () => { called = true; return Buffer.alloc(0) })).rejects.toThrow()
    expect(called).toBe(false)
  })
  it('does not silently use a root-only runner for native work', async () => {
    await expect(collectWindowsRepairNativeLaunch(roots(), hostPath, consumerPath, Buffer.alloc(32), false, 'C:\\Windows')).rejects.toThrow('NATIVE_LAUNCH_REJECTED')
  })
})
