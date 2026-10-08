import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

test('isolated runtime links failure to safe feedback and preserves configuration across graceful shutdown', async () => {
  test.setTimeout(90_000)
  const root = resolve('.cache', 'runtime-reliability')
  mkdirSync(root, { recursive: true })
  const fixture = mkdtempSync(join(root, 'run-'))
  if (dirname(resolve(fixture)) !== root) throw new Error('Unsafe isolated fixture cleanup path')
  const profile = join(fixture, 'profile')
  const exported = join(fixture, 'feedback.json')
  mkdirSync(profile)
  const version = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version as string
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'rt-reliability-fixture', version, main: 'bootstrap.cjs' }))
  writeFileSync(join(fixture, 'bootstrap.cjs'), `
const { app, net, session, dialog } = require('electron');
const deny = async () => { throw new Error('OFFLINE_TEST_FIXTURE'); };
globalThis.fetch = deny;
net.fetch = deny;
app.setPath('userData', ${JSON.stringify(profile)});
app.on('browser-window-created', (_event, window) => { window.show = () => {}; });
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
});
dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(exported)} });
require(${JSON.stringify(resolve('out/main/index.js'))});
`)
  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', TEMP: fixture, TMP: fixture }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_RENDERER_URL
  let application: ElectronApplication | null = null
  const launch = () => electron.launch({ args: [fixture, `--user-data-dir=${profile}`], env: environment })
  const quit = async (running: ElectronApplication) => {
    const closed = running.waitForEvent('close', { timeout: 12_000 })
    const runningProcess = running.process()
    await running.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
    await closed
    await expect.poll(() => runningProcess.exitCode, { timeout: 1_000 }).toBe(0)
  }
  try {
    application = await launch()
    let page = await application.firstWindow()
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    const dataPath = await application.evaluate(({ app }) => app.getPath('userData'))
    expect(resolve(dataPath).startsWith(resolve(fixture) + '\\') || resolve(dataPath).startsWith(resolve(fixture) + '/')).toBe(true)
    await page.evaluate(() => window.api.ai.saveConfig({
      providerConfig: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', maxTokens: 4096 },
    }))
    const failed = await page.evaluate(() => window.api.diagnostics.runCheck('syncConceptMembers'))
    expect(failed).toMatchObject({ ok: false, error: 'TUSHARE_DISABLED' })
    if (failed.ok || !('correlationId' in failed) || typeof failed.correlationId !== 'string') {
      throw new Error('Diagnostic failure did not expose a correlation identifier')
    }
    const correlationId = failed.correlationId
    expect(correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(failed.message).toContain(correlationId)

    const guide = page.getByTestId('cold-start-guide')
    if (await guide.isVisible()) await guide.getByLabel('关闭引导').click()
    await page.getByTestId('open-config-drawer-btn').click()
    await page.getByTestId('config-tab-diagnostics').click()
    await page.getByTestId('support-generate-preview').click()
    const previewText = await page.getByTestId('support-json-preview').innerText()
    const preview = JSON.parse(previewText)
    expect(preview.app.version).toBe(version)
    expect(preview.errorEvents).toContainEqual(expect.objectContaining({ id: correlationId, code: 'CONFIG_MISSING', module: 'data' }))
    expect(previewText).not.toContain(profile)
    expect(previewText).not.toContain('api.deepseek.com')
    expect(previewText).not.toContain('providerConfig')
    await page.getByTestId('support-save-file').click()
    await expect(page.getByTestId('support-feedback-panel')).toContainText('内容与本次预览完全一致')
    expect(readFileSync(exported, 'utf8')).toBe(previewText)
    await quit(application)
    application = null

    application = await launch()
    page = await application.firstWindow()
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    const configuration = await page.evaluate(() => window.api.ai.getConfig())
    expect(configuration.providerConfigs.deepseek.model).toBe('deepseek-chat')
    expect(configuration.providerConfigs.deepseek.hasApiKey).toBe(false)
    const fresh = await page.evaluate(() => window.api.supportDiagnostics.generatePreview())
    expect(fresh.ok).toBe(true)
    if (fresh.ok) expect(fresh.value.package.errorEvents.some(event => event.id === correlationId)).toBe(false)
    await quit(application)
    application = null
  } finally {
    if (application) await application.close().catch(() => {})
    rmSync(fixture, { recursive: true, force: true })
  }
})
