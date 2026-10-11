import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

test('packaged AI partial saves retain drafts and OS-encrypted keys survive restart', async () => {
  test.setTimeout(120_000)
  const executable = process.env.RT_PACKAGED_EXE
  if (!executable || process.env.RT_AI_CREDENTIAL_FIXTURE_ALLOWED !== '1') throw new Error('EXPLICIT_ISOLATED_CREDENTIAL_FIXTURE_REQUIRED')
  if (process.platform === 'win32' && !executable.replaceAll('\\', '/').includes('/release/win-unpacked/')) throw new Error('PRODUCTION_WINDOWS_CREDENTIAL_FIXTURE_FORBIDDEN')
  const root = resolve(process.env.RT_PACKAGED_TEST_ROOT ?? '.cache/packaged-ai-credentials')
  const profile = join(root, 'profile')
  mkdirSync(profile, { recursive: true })
  const env = { ...process.env, TEMP: root, TMP: root }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.NODE_PATH
  delete env.NODE_OPTIONS
  let app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env })
  const fixtureKey = `offline-fixture-${randomUUID()}`
  const draftKey = `unsaved-fixture-${randomUUID()}`
  try {
    async function openConfiguration() {
      const page = await app.firstWindow()
      await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
      const guide = page.getByTestId('cold-start-guide')
      await expect(async () => {
        if (await guide.isVisible()) await guide.getByLabel('关闭引导').click({ timeout: 2000 })
        if (!await page.getByTestId('config-tab-ai-config').isVisible()) await page.getByTestId('open-config-drawer-btn').click({ timeout: 2000 })
        await page.getByTestId('config-tab-ai-config').click({ timeout: 2000 })
        await expect(page.getByTestId('ai-provider-row-deepseek')).toBeVisible({ timeout: 2000 })
      }).toPass({ timeout: 45_000 })
      return page
    }
    async function quitNormally() {
      const handle = app.process()
      const closed = app.waitForEvent('close', { timeout: 15_000 })
      await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
      await closed
      await expect.poll(() => handle.exitCode).toBe(0)
    }
    let page = await openConfiguration()
    const runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion() }))
    expect(runtime).toEqual({ packaged: true, version: process.env.RT_PACKAGED_VERSION ?? '1.13.0' })
    const deepseek = page.getByTestId('ai-provider-row-deepseek')
    const qwen = page.getByTestId('ai-provider-row-qwen')
    await qwen.locator('input[type="password"]').fill(draftKey)
    await deepseek.locator('input[type="password"]').fill(fixtureKey)
    // Any accidental background AI request remains on loopback, never a vendor.
    await deepseek.locator('input[type="url"]').fill('http://127.0.0.1:9')
    await deepseek.getByRole('button', { name: '保存', exact: true }).click()
    await expect(deepseek).toContainText('本机可读取')
    await expect(qwen.locator('input[type="password"]')).toHaveValue(draftKey)
    const read = () => page.evaluate(() => window.api.ai.getConfig())
    let configuration = await read()
    expect(configuration.providerConfigs.deepseek.credentialStatus).toBe('available')
    expect(JSON.stringify(configuration)).not.toContain(fixtureKey)
    const saveGlobal = page.getByRole('button', { name: /^(保存全局设置|已保存 ✓)$/ })
    await saveGlobal.click()
    await expect(saveGlobal).toBeEnabled()
    await expect(qwen.locator('input[type="password"]')).toHaveValue(draftKey)
    await quitNormally()
    app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env })
    page = await openConfiguration()
    configuration = await read()
    expect(configuration.providerConfigs.deepseek.credentialStatus).toBe('available')
    expect(configuration.providerConfigs.deepseek.baseUrl).toBe('http://127.0.0.1:9')
    expect(JSON.stringify(configuration)).not.toContain(fixtureKey)
    const row = page.getByTestId('ai-provider-row-deepseek')
    await row.getByLabel('移除本机密钥').check()
    await row.getByRole('button', { name: '保存', exact: true }).click()
    await expect(row).toContainText('未配置')
    configuration = await read()
    expect(configuration.providerConfigs.deepseek.hasApiKey).toBe(false)
    expect(configuration.providerConfigs.deepseek.credentialStatus).toBe('unconfigured')
    await quitNormally()
  } finally { await app.close().catch(() => {}) }
})
