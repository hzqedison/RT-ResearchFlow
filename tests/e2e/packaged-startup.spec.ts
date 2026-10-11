import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

test('actual packaged application displays workbench, settings and exits cleanly', async () => {
  test.setTimeout(90_000)
  const executable = process.env.RT_PACKAGED_EXE
  if (!executable) throw new Error('RT_PACKAGED_EXE must point at the real distribution executable')
  const root = resolve(process.env.RT_PACKAGED_TEST_ROOT ?? '.cache/packaged-startup')
  const profile = join(root, 'profile')
  mkdirSync(profile, { recursive: true })
  const env = { ...process.env, TEMP: root, TMP: root }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.NODE_PATH
  delete env.NODE_OPTIONS
  // Windows deliberately stores data beside the executable. Use win-unpacked for
  // isolated verification; testing the user's installed copy requires explicit consent.
  if (process.platform === 'win32' && !executable.includes('win-unpacked') && process.env.RT_PACKAGED_ALLOW_EXISTING_DATA !== '1') {
    throw new Error('Installed Windows verification must explicitly allow existing application data')
  }
  const app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env, timeout: 30_000 })
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    const runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), dataPath: app.getPath('userData') }))
    expect(runtime.packaged).toBe(true)
    expect(runtime.version).toBe(process.env.RT_PACKAGED_VERSION ?? JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version)
    if (process.platform === 'win32') expect(resolve(runtime.dataPath)).toBe(resolve(dirname(executable), 'data'))
    else expect(resolve(runtime.dataPath)).toBe(profile)
    const guide = page.getByTestId('cold-start-guide')
    await expect(async () => {
      if (await guide.isVisible()) await guide.getByLabel('关闭引导').click({ timeout: 2000 })
      if (!await page.getByText('策略实验室', { exact: true }).first().isVisible()) await page.getByText('短线策略', { exact: true }).first().click({ timeout: 2000 })
      await page.getByText('策略实验室', { exact: true }).first().click({ timeout: 2000 })
      await expect(page.getByTestId('strategy-lab-main')).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 45000 })
    const templates = await page.evaluate(() => window.api.strategyLab.listStrategies())
    expect(templates.ok).toBe(true)
    if (!templates.ok) throw new Error(templates.error)
    expect(templates.strategies.filter(item => item.strategyKey.startsWith('builtin-public-limit-'))).toHaveLength(3)
    await page.getByText('免费 · 早封首板', { exact: true }).first().click()
    await expect(page.getByTestId('public-limit-lab-guide')).toContainText('无需 Tushare Key 或 Python')
    await expect(page.getByTestId('public-limit-run-plan')).toContainText('收益回测不可用')
    // Fresh profiles can finish their initial health check after navigation.
    // Dismiss its guide as a user would; never force a click through the overlay.
    await expect(async () => {
      if (await guide.isVisible()) await guide.getByLabel('关闭引导').click({ timeout: 2000 })
      if (!await page.getByTestId('public-limit-strategy-editor').isVisible()) {
        await page.getByRole('button', { name: '配置', exact: true }).click({ timeout: 2000 })
      }
      await expect(page.getByTestId('public-limit-strategy-editor')).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 45000 })
    await expect(page.getByTestId('public-limit-strategy-editor')).toContainText('免费盘后涨停规则')
    await page.getByRole('button', { name: '关闭配置', exact: true }).click()
    await page.getByTestId('nav-tab-feed').click()
    // Existing profiles can finish initialization after the first window appears.
    // Retry the user navigation, not the application assertions or IPC responses.
    await expect(async () => {
      if (await guide.isVisible()) await guide.getByLabel('关闭引导').click({ timeout: 2000 })
      const diagnostics = page.getByTestId('config-tab-diagnostics')
      if (!await diagnostics.isVisible()) await page.getByTestId('open-config-drawer-btn').click({ timeout: 2000 })
      await diagnostics.click({ timeout: 2000 })
      await expect(page.getByTestId('support-generate-preview')).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 45000 })
    await page.getByRole('button', { name: '数据源', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Tushare Key 绑定与验证' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '行情来源（日线，可多选）' })).toBeVisible()
    const binding = page.locator('#tushare-key-binding')
    await expect(binding.getByRole('button', { name: '绑定并验证新 Key' })).toBeDisabled()
    await binding.getByLabel('Tushare Pro Token', { exact: true }).fill('isolated-ui-fixture-not-a-real-key')
    await expect(binding.getByRole('button', { name: '绑定并验证新 Key' })).toBeEnabled()
    await expect(binding.getByRole('status')).toContainText('新 Key 尚未绑定')
    await binding.getByLabel('Tushare Pro Token', { exact: true }).fill('')
    await page.getByTestId('config-tab-ai-config').click()
    await expect(page.getByText('AI 配置', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
    const processHandle = app.process()
    const closed = app.waitForEvent('close', { timeout: 15_000 })
    await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
    await closed
    await expect.poll(() => processHandle.exitCode, { timeout: 2_000 }).toBe(0)
  } finally {
    await app.close().catch(() => {})
  }
})
