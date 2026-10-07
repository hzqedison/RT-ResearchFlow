import { expect, test, _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('installed Mac app loads SQLite, edits settings, reopens from the Dock, and quits', async () => {
  test.skip(process.platform !== 'darwin' || !process.env.TRADE_WATCH_PACKAGED_EXECUTABLE,
    'Requires a macOS package installed from the generated DMG.')
  test.setTimeout(120_000)
  const executablePath = resolve(process.env.TRADE_WATCH_PACKAGED_EXECUTABLE!)
  expect(existsSync(executablePath)).toBe(true)
  const userDataDir = mkdtempSync(join(tmpdir(), 'rt-macos-smoke-'))
  const launchEnv = { ...process.env }
  delete launchEnv.ELECTRON_RUN_AS_NODE
  const application = await electron.launch({ executablePath,
    args: [`--user-data-dir=${userDataDir}`], env: launchEnv })
  const errors: string[] = []
  application.process().stderr?.on('data', (chunk) => errors.push(String(chunk)))
  try {
    const window = await application.firstWindow()
    await expect(window.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    await expect(window.getByTestId('decision-center-page')).toBeVisible()
    const sources = await window.evaluate(() => window.api.sources.list())
    expect(sources.length).toBeGreaterThan(0)
    const preferences = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((win) => win.isVisible())!.webContents.getLastWebPreferences())
    expect(preferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false })
    expect(await application.evaluate(({ Menu }) => Menu.getApplicationMenu() !== null)).toBe(true)

    await window.getByTestId('open-config-drawer-btn').click()
    await expect(window.getByText('系统通知', { exact: true })).toBeVisible()
    const original = await window.evaluate(() => window.api.settings.get())
    const priority = original.decision_notify_min_priority === 5 ? 4 : 5
    await window.evaluate((value) => window.api.settings.update({ decision_notify_min_priority: value }), priority)

    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((win) => win.isVisible())!.close())
    expect(await application.evaluate(({ app }) => app.isReady())).toBe(true)
    const reopenedWindow = application.waitForEvent('window')
    await application.evaluate(({ app }) => { app.emit('activate') })
    const reopened = await reopenedWindow
    await expect(reopened.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    expect((await reopened.evaluate(() => window.api.settings.get())).decision_notify_min_priority).toBe(priority)
    await reopened.evaluate((value) => window.api.settings.update({ decision_notify_min_priority: value }),
      original.decision_notify_min_priority)
    await reopened.screenshot({ path: 'test-results/macos-reopened.png' })
  } catch (error) {
    const failedWindow = application.windows().find((page) => !page.isClosed())
    if (failedWindow) {
      await failedWindow.screenshot({ path: 'test-results/macos-failed.png' }).catch(() => {})
    }
    throw error
  } finally {
    try {
      await application.close()
    } finally {
      mkdirSync('test-results', { recursive: true })
      writeFileSync('test-results/macos-stderr.log', errors.join('\n'), 'utf8')
      rmSync(userDataDir, { recursive: true, force: true })
    }
  }
  expect(errors.join('\n')).not.toMatch(/Object has been destroyed|Could not locate the bindings file/)
})
