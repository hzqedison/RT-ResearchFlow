import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync } from 'node:fs'
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
    expect(runtime.version).toBe(process.env.RT_PACKAGED_VERSION ?? '1.9.0')
    if (process.platform === 'win32') expect(resolve(runtime.dataPath)).toBe(resolve(dirname(executable), 'data'))
    else expect(resolve(runtime.dataPath)).toBe(profile)
    const guide = page.getByTestId('cold-start-guide')
    if (await guide.isVisible()) await guide.getByLabel('关闭引导').click()
    await page.getByTestId('open-config-drawer-btn').click()
    await page.getByTestId('config-tab-diagnostics').click()
    await expect(page.getByTestId('support-generate-preview')).toBeVisible()
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
