import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const root = resolve(__dirname, '../..')
const harness = require(resolve(root, 'scripts/run-windows-install-repair-fixtures.cjs'))
const consumer = readFileSync(resolve(root, 'resources/windows-install-repair-consumer.nsh'), 'utf8')
describe('nine-installer fixture runner boundary; no installer execution here', () => {
  it('requires nine distinct concrete native cases, not unit counts', () => {
    expect(harness.CASES).toHaveLength(9); expect(new Set(harness.CASES).size).toBe(9)
    expect(harness.CASES).toContain('second-key-failure-recover')
    expect(harness.CASES).toContain('crash-and-concurrent-change-refuse')
  })
  it.each([{}, { GITHUB_ACTIONS: 'true' }, { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted', RUNNER_TEMP: 'D:\\Fixture' },
    { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_TEMP: 'C:\\Fixture' }])('refuses a local or uncontrolled host before reading any installer %j', env => {
    expect(() => harness.prepare('never-read-this-input.json', 'a'.repeat(64), env)).toThrow('disposable-host-required')
  })
  it('keeps production registration off and demands independently reviewed artifacts', () => {
    expect(consumer).toContain('!ifndef RT_REPAIR_ISOLATED_FIXTURE_BUILD')
    expect(consumer).toContain('!error "Fixture dispatch must not use the production app identity"')
    expect(consumer).toContain('!ifndef RT_REPAIR_REVIEWED_CONSUMER_FILE')
    expect(consumer).toContain('!ifndef RT_REPAIR_REVIEWED_NODE_FILE')
    expect(consumer).toContain('!ifndef RT_REPAIR_REVIEW_SHA256')
  })
  it('stops normal install after an actual consumer result and has no destructive legacy fallback', () => {
    expect(consumer).toContain('ExecWait')
    expect(consumer).toContain('StrCmp $R2 "0" rt_reviewed_repair_completed rt_reviewed_repair_rejected')
    expect(consumer).toMatch(/SetErrorLevel 0\s*#[^\n]*\n\s*#[^\n]*\n\s*Quit/)
    expect(consumer).toContain('SetErrorLevel 23')
    expect(consumer).not.toMatch(/\b(?:WriteReg|DeleteReg|RMDir|Delete|uninstallOldVersion)\b/)
  })
})
