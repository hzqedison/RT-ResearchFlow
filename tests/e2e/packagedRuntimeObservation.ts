import { expect, type ElectronApplication } from '@playwright/test'
export function observePackagedProcess(app: ElectronApplication) {
  let tail = ''
  const retain = (chunk: Buffer) => { tail = (tail + chunk.toString('utf8')).slice(-24000) }
  app.process().stdout?.on('data', retain); app.process().stderr?.on('data', retain)
  return () => {
    const selected = tail.split(/\r?\n/).filter(line => /Startup|AppData|IPC|catchup|Error|Exception|ENOENT|EACCES|FATAL|Unhandled/i.test(line))
    if (selected.length) console.log('ISOLATED_PROCESS_DIAGNOSTICS\n' + selected.join('\n').replace(/sk-[A-Za-z0-9_-]{6,}/g, '[redacted]'))
  }
}
export async function waitForPackagedRuntime(app: ElectronApplication, version: string) {
  let runtime: { packaged: boolean; version: string; dataPath: string } | undefined
  await expect.poll(async () => {
    try { runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), dataPath: app.getPath('userData') })); return runtime.version }
    catch (error) {
      if (app.process().exitCode !== null || !/Execution context was destroyed|Cannot find context/i.test(String(error))) throw error
      // An observation failure is not a restart or permission to proceed with writes.
      return 'observation-pending'
    }
  }, { timeout: 30000 }).toBe(version)
  expect(runtime?.packaged).toBe(true)
  return runtime!
}
