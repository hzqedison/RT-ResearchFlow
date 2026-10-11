import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

test('actual public package installs AKShare on explicit request and persists an isolated interpreter', async () => {
  test.setTimeout(900_000)
  const executable = process.env.RT_PACKAGED_EXE
  const python = process.env.RT_ONDEMAND_PYTHON
  if (!executable || !python || process.env.RT_ONDEMAND_ALLOW_NETWORK !== '1') {
    throw Error('Explicit real package, existing Python and network-install consent required')
  }
  if (process.platform === 'win32' && !executable.includes('win-unpacked')) throw Error('Use an isolated unpacked copy, not production data')
  const root = resolve(process.env.RT_PACKAGED_TEST_ROOT ?? '.cache/on-demand-extensions')
  mkdirSync(root, { recursive: true })
  const env = { ...process.env, TEMP: root, TMP: root }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.NODE_OPTIONS
  delete env.NODE_PATH
  const app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${join(root, 'profile')}`], env })
  try {
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    const page = await app.firstWindow()
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    const guide = page.getByTestId('cold-start-guide')
    if (await guide.isVisible()) await guide.getByLabel('关闭引导').click()
    const initial = await page.evaluate(() => window.api.datasource.extensionInstallStatus())
    expect(initial.mode).toBe('on-demand')
    await page.evaluate(pythonPath => window.api.datasource.saveConfig({ dailyProviders: ['akshare'], reportProviders: [], wencaiEnabled: false, pythonPath }), python)
    await page.getByTestId('open-config-drawer-btn').click()
    await page.getByTestId('config-tab-datasource').click()
    await page.getByRole('button', { name: '安装所选扩展', exact: true }).click()
    await expect(page.getByTestId('extension-install-progress')).toBeVisible()
    await expect(page.getByTestId('extension-install-progress')).toContainText(/检查|创建|安装|准备|验证|尚未/, { timeout: 30_000 })
    await expect.poll(async () => (await page.evaluate(() => window.api.datasource.extensionInstallStatus())).progress.phase,
      { timeout: 810_000, intervals: [1000, 2000, 5000] }).toMatch(/complete|failed/)
    const final = await page.evaluate(() => window.api.datasource.extensionInstallStatus())
    expect(final.progress.phase).toBe('complete')
    await expect(page.getByRole('button', { name: '安装所选扩展', exact: true })).toBeEnabled({ timeout: 10_000 })
    const config = await page.evaluate(() => window.api.datasource.getConfig())
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    expect(config.pythonPath.startsWith(join(userData, 'data-source-extensions') + (process.platform === 'win32' ? '\\' : '/'))).toBe(true)
    const status = await page.evaluate(() => window.api.datasource.bridgeStatus())
    expect(status.ok).toBe(true)
    if (status.ok) expect((status.data as { packages: Record<string, unknown> }).packages.akshare).toEqual(expect.any(String))
    const noBundledRuntime = await app.evaluate(async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      return !fs.existsSync(path.join(process.resourcesPath, 'private-python-runtime'))
    })
    expect(noBundledRuntime).toBe(true)
  } finally { await app.close() }
})
