import { expect, test, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve, join, sep } from 'node:path'

const configuredExecutable = process.env.TRADE_WATCH_PACKAGED_EXECUTABLE

test('installed Windows application starts with sandboxed preload and readable SQLite data', async () => {
  test.skip(!configuredExecutable, 'TRADE_WATCH_PACKAGED_EXECUTABLE is required for packaged smoke testing')
  const executablePath = resolve(configuredExecutable!)
  if (process.platform === 'win32') {
    const relativeExecutable = relative(resolve(process.env.RUNNER_TEMP || tmpdir()), executablePath)
    if (!relativeExecutable || isAbsolute(relativeExecutable) || relativeExecutable.split(sep).includes('..')) {
      throw new Error('Packaged Windows tests require an executable inside the isolated temporary root')
    }
  }
  expect(existsSync(executablePath), `Packaged executable does not exist: ${executablePath}`).toBe(true)

  const userDataDir = mkdtempSync(join(tmpdir(), 'trade-watch-packaged-smoke-'))
  if (dirname(resolve(userDataDir)) !== resolve(tmpdir())) throw new Error('Unsafe fixture cleanup path')
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...launchEnv } = process.env
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...launchEnv, NODE_ENV: 'test' },
  })

  try {
    const expectedDataRoot = process.platform === 'win32' ? join(dirname(executablePath), 'data') : userDataDir
    expect(resolve(await app.evaluate(({ app: running }) => running.getPath('userData')))).toBe(resolve(expectedDataRoot))
    const window = await app.firstWindow()
    await expect(window.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    await expect(window.getByTestId('decision-center-page')).toBeVisible()

    const sources = await window.evaluate(() => window.api.sources.list())
    expect(Array.isArray(sources)).toBe(true)
    expect(sources.length).toBeGreaterThan(0)

    const preferences = await app.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.webContents.getLastWebPreferences()
    ))
    expect(preferences?.sandbox).toBe(true)
    expect(preferences?.contextIsolation).toBe(true)
    expect(preferences?.nodeIntegration).toBe(false)
  } finally {
    await app.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }
})
