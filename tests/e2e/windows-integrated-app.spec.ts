import { expect, test, _electron as electron } from '@playwright/test'
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

test('installed Windows beta keeps AI save fixed and blocks the Mac-only trading bridge', async () => {
  test.skip(process.platform !== 'win32' || process.env.CI !== 'true' ||
    process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    process.env.RUNNER_OS !== 'Windows',
  'Packaged execution is restricted to disposable GitHub-hosted Windows runners.')
  test.setTimeout(90_000)
  expect(process.env.RUNNER_TEMP).toBeTruthy()
  expect(process.env.GITHUB_WORKSPACE).toBeTruthy()
  expect(process.env.TRADE_WATCH_PACKAGED_EXECUTABLE).toBeTruthy()
  const runnerTemp = realpathSync.native(process.env.RUNNER_TEMP!)
  const workspace = realpathSync.native(process.env.GITHUB_WORKSPACE!)
  const sourcePackage = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'))
  expect(sourcePackage.name).toBe('rt-research-flow')
  expect(sourcePackage.version).toMatch(/^\d+\.\d+\.\d+$/)
  const packageVersion: string = sourcePackage.version
  expect(process.env.RELEASE_VERSION).toBe(packageVersion)
  const installDirectory = join(runnerTemp, 'rt-release-installed-' + packageVersion)
  const executablePath = resolve(process.env.TRADE_WATCH_PACKAGED_EXECUTABLE!)
  expect(executablePath.toLowerCase()).toBe(join(installDirectory, 'RT-ResearchFlow.exe').toLowerCase())
  const relativeExecutable = relative(runnerTemp, executablePath)
  if (!relativeExecutable || isAbsolute(relativeExecutable) || relativeExecutable.split(sep).includes('..')) {
    throw new Error('Packaged Windows tests require an executable inside the isolated temporary root')
  }
  const archive = join(installDirectory, 'resources', 'app.asar')
  for (const [path, directory] of [[installDirectory, true], [executablePath, false], [archive, false]] as const) {
    const stat = lstatSync(path)
    expect(stat.isSymbolicLink()).toBe(false)
    expect(directory ? stat.isDirectory() : stat.isFile()).toBe(true)
    expect(realpathSync.native(path).toLowerCase()).toBe(resolve(path).toLowerCase())
  }
  // Use the existing packager's ASAR reader, including pnpm's dependency layout.
  const workspaceRequire = createRequire(join(workspace, 'package.json'))
  const builderRequire = createRequire(workspaceRequire.resolve('electron-builder'))
  const packagerRequire = createRequire(builderRequire.resolve('app-builder-lib'))
  const { extractFile } = packagerRequire('@electron/asar') as {
    extractFile(archivePath: string, entry: string): Buffer
  }
  const packaged = JSON.parse(extractFile(archive, 'package.json').toString('utf8'))
  expect(packaged).toMatchObject({ name: 'rt-research-flow', version: packageVersion, main: './out/main/index.js' })
  if (packaged.productName !== undefined) expect(packaged.productName).toBe('RT-ResearchFlow')
  // The preceding smoke and later reinstall intentionally share synthetic install/data.
  // Accept its existing bytes in this fixed hosted installation; never delete or move them.
  const dataRoot = join(installDirectory, 'data')
  for (const [path, directory] of [[dataRoot, true], [join(dataRoot, 'trade-watch.db'), false],
    [join(dataRoot, 'trade-watch.db-wal'), false], [join(dataRoot, 'trade-watch.db-shm'), false],
    [join(dataRoot, 'trade-watch.db-journal'), false]] as const) {
    let stat: ReturnType<typeof lstatSync>
    try { stat = lstatSync(path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    expect(stat.isSymbolicLink()).toBe(false)
    expect(directory ? stat.isDirectory() : stat.isFile()).toBe(true)
    expect(realpathSync.native(path).toLowerCase()).toBe(resolve(path).toLowerCase())
  }
  const fixture = mkdtempSync(join(tmpdir(), 'rt-windows-integrated-'))
  if (dirname(resolve(fixture)) !== resolve(tmpdir())) throw new Error('Unsafe fixture cleanup path')
  const environment = Object.fromEntries(Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'))
  delete environment.ELECTRON_RUN_AS_NODE
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${fixture}`], env: environment,
  })
  try {
    expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(true)
    expect(resolve(await application.evaluate(({ app }) => app.getPath('exe'))).toLowerCase()).toBe(executablePath.toLowerCase())
    expect(resolve(await application.evaluate(({ app }) => app.getPath('userData'))).toLowerCase()).toBe(dataRoot.toLowerCase())
    expect(lstatSync(dataRoot).isSymbolicLink()).toBe(false)
    expect(realpathSync.native(dataRoot).toLowerCase()).toBe(dataRoot.toLowerCase())
    expect(await application.evaluate(({ app }) => app.getVersion())).toBe(packageVersion)
    const page = await application.firstWindow()
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() => window.api.ai.saveConfig({
      providerConfig: { provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', maxTokens: 4096 },
    }))
    const config = await page.evaluate(() => window.api.ai.getConfig())
    expect(config.providerConfigs.deepseek.model).toBe('deepseek-flash')
    expect(config.providerConfigs.deepseek.hasApiKey).toBe(false)
    expect(config.hasApiKey).toBe(false)
    await page.getByTestId('quant-onboarding-open').click()
    await page.getByTestId('quant-onboarding-step-4').click()
    await expect(page.getByTestId('mac-ths-platform-warning')).toContainText('本机执行桥接仅支持 Mac')
    await expect(page.getByTestId('mac-ths-authorize')).toBeDisabled()
    await expect(page.getByTestId('mac-ths-probe')).toBeDisabled()
    const macThsState = await page.evaluate(() => (window as unknown as {
      api: { macThs: { getState(): Promise<unknown> } }
    }).api.macThs.getState())
    expect(macThsState).toMatchObject({ schemaVersion: 1, adapterVersion: '3',
      serviceState: 'UNSUPPORTED_PLATFORM', code: 'MAC_REQUIRED',
      liveEnabled: false, canPrepare: false, canInitialize: false })
    await expect(page.getByTestId('mac-ths-diagnostic')).toContainText('"loaded": true', { timeout: 30_000 })
    const macThsDiagnosticText = await page.getByTestId('mac-ths-diagnostic').innerText()
    const diagnostic = JSON.parse(macThsDiagnosticText)
    expect(diagnostic.adapterVersion).toBe('3')
    expect(diagnostic.tested).toBe(false)
    expect(diagnostic.productState).toMatchObject({ loaded: true, adapterVersion: '3',
      serviceState: 'UNSUPPORTED_PLATFORM', code: 'MAC_REQUIRED', liveEnabled: false })
    expect(macThsDiagnosticText).not.toMatch(/"(?:contractNo|confirmation|token|sessionId|requestId|intentBinding|accountDigest|password|apiKey)"\s*:/)
    await expect(page.getByTestId('mac-ths-export')).toBeEnabled()
    expect(diagnostic.canSubmitLiveOrders).toBe(false)
    expect(diagnostic.canRunUnattended).toBe(false)
    await expect(page.getByTestId('mac-ths-live-risk-ack')).toBeDisabled()
    await expect(page.getByTestId('mac-ths-enable-live')).toBeDisabled()
    await expect(page.getByTestId('mac-ths-submit-live')).toBeDisabled()
    await expect(page.getByTestId('mac-ths-cancel-live')).toBeDisabled()
    await page.screenshot({ path: 'test-results/windows-integrated-app.png' })
    await page.getByRole('button', { name: '关闭量化开通引导' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  } finally {
    await application.close()
    // Delete only the uniquely created CI fixture, never the installation or user data.
    rmSync(fixture, { recursive: true, force: true })
  }
})
