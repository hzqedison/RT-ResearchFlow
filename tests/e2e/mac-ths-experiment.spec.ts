import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import type { MacThsProductState } from '../../electron/shared/macThsTypes'

async function openPanel(application: ElectronApplication) {
  const page = await application.firstWindow()
  try {
    await page.getByTestId('quant-onboarding-open').click()
  } catch (error) {
    let diagnosticTimer: ReturnType<typeof setTimeout> | undefined
    try {
      const windows = application.windows()
      const metadata = windows.map((window, index) => {
        const url = window.url()
        return { index, selected: window === page, closed: window.isClosed(),
          urlType: url.startsWith('file:') ? 'file' : url.startsWith('app:') ? 'app' : 'other' }
      })
      console.error('[Mac installed startup] Missing onboarding entry', {
        windowCount: windows.length, windows: metadata,
      })
      // Emit classifications only; never URLs, titles, page content, or exception details.
      await Promise.race([
        Promise.all(windows.map(async (window, index) => {
          try {
            const detail = await window.evaluate(() => ({
              readyState: document.readyState,
              titleMatches: document.title === 'RT-ResearchFlow',
              hasStartupDiagnostic: ['应用启动失败', '本地数据目录初始化失败'].some(title =>
                document.title === title || document.querySelector('h1')?.textContent?.trim() === title),
              fatalKind: (() => {
                const title = document.querySelector('#fatal-title')?.textContent?.trim()
                return title === '应用启动失败' ? 'BOOTSTRAP_FAILED' :
                  title === '本地数据目录初始化失败' ? 'APP_DATA_FAILED' : 'NONE'
              })(),
              fatalError: (() => {
                const details = document.querySelector('pre.details')?.textContent ?? ''
                const errorClass = /\bSqliteError\b/.test(details) ? 'SqliteError' :
                  /\bTypeError\b/.test(details) ? 'TypeError' :
                  /\bReferenceError\b/.test(details) ? 'ReferenceError' :
                  /\bRangeError\b/.test(details) ? 'RangeError' :
                  /\bError\b/.test(details) ? 'Error' : 'UNKNOWN'
                const category = /no such table/i.test(details) ? 'MISSING_TABLE' :
                  /no such column/i.test(details) ? 'MISSING_COLUMN' :
                  /UNIQUE constraint failed/i.test(details) ? 'UNIQUE_CONSTRAINT' :
                  /NOT NULL constraint failed/i.test(details) ? 'NOT_NULL_CONSTRAINT' :
                  /database is locked/i.test(details) ? 'DATABASE_LOCKED' :
                  /Cannot find module|MODULE_NOT_FOUND/i.test(details) ? 'MODULE_NOT_FOUND' :
                  /ERR_DLOPEN_FAILED/i.test(details) ? 'ERR_DLOPEN_FAILED' :
                  /SQLITE_CANTOPEN/i.test(details) ? 'SQLITE_CANTOPEN' :
                  /EACCES/i.test(details) ? 'EACCES' :
                  /EBUSY/i.test(details) ? 'EBUSY' : 'UNCLASSIFIED'
                const duplicateHandler = /Attempted to register a second handler for/i.test(details)
                const channelMatch = details.match(/Attempted to register a second handler for ['"`]?([A-Za-z][A-Za-z0-9:_-]{0,79})/i)
                const allowedChannels = ['renderer:ready', 'window:minimize', 'window:toggleMaximize',
                  'window:close', 'window:isMaximized', 'app:relaunch']
                const duplicateChannel = duplicateHandler
                  ? allowedChannels.includes(channelMatch?.[1] ?? '') ? channelMatch![1] : 'OTHER'
                  : null
                const bundleFrames = [...details.matchAll(/out\/main\/index\.js:(\d+):(\d+)/g)]
                  .slice(0, 3).map(match => ({ line: Number(match[1]), column: Number(match[2]) }))
                return { errorClass, category, duplicateHandler, duplicateChannel, bundleFrames }
              })(),
              entryCount: document.querySelectorAll('[data-testid="quant-onboarding-open"]').length,
            }))
            console.error('[Mac installed startup] Window detail', { index, ...detail })
          } catch {
            console.error('[Mac installed startup] Window detail unavailable', { index })
          }
        })),
        new Promise<void>(resolve => {
          diagnosticTimer = setTimeout(() => {
            console.error('[Mac installed startup] Window detail collection timed out')
            resolve()
          }, 1000)
        }),
      ])
    } catch {
      console.error('[Mac installed startup] Window diagnostics unavailable')
    } finally {
      if (diagnosticTimer !== undefined) clearTimeout(diagnosticTimer)
    }
    throw error
  }
  await page.getByTestId('quant-onboarding-step-4').click()
  await expect(page.getByTestId('mac-trading-panel')).toBeVisible()
  await expect(page.getByTestId('mac-ths-diagnostic')).toContainText('"loaded": true')
  return page
}
async function readState(page: Page) {
  return page.evaluate(() => (window as unknown as {
    api: { macThs: { getState(): Promise<MacThsProductState> } }
  }).api.macThs.getState())
}
async function diagnostic(page: Page, privatePaths: string[]) {
  const text = await page.getByTestId('mac-ths-diagnostic').innerText()
  const value = JSON.parse(text)
  expect(value.adapterVersion).toBe('3')
  expect(value.productState.adapterVersion).toBe('3')
  expect(value.productState.loaded).toBe(true)
  expect(value.canSubmitLiveOrders).toBe(false)
  expect(value.canRunUnattended).toBe(false)
  expect(Object.keys(value)).not.toContain('contractNo')
  expect(text).not.toMatch(/"(?:contractNo|confirmation|token|sessionId|requestId|intentBinding|accountDigest|accountContext|password|apiKey)"\s*:/)
  for (const path of privatePaths) expect(text).not.toContain(path)
  return value
}
function requireAbsent(path: string) {
  try { lstatSync(path) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  throw new Error('Refusing an existing default userData; no unknown directory will be removed')
}

test('installed Mac exposes a real narrow bridge and private diagnostic without placing orders', async () => {
  test.skip(process.platform !== 'darwin' || process.env.CI !== 'true' ||
    process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    process.env.RUNNER_OS !== 'macOS',
  'Packaged execution is restricted to disposable GitHub-hosted Mac runners.')
  test.setTimeout(90000)

  // Match the existing release workflow's installed artifact, not an arbitrary local .app.
  expect(process.env.RUNNER_TEMP).toBeTruthy()
  expect(process.env.GITHUB_WORKSPACE).toBeTruthy()
  expect(process.env.TRADE_WATCH_PACKAGED_EXECUTABLE).toBeTruthy()
  const runnerTemp = realpathSync.native(process.env.RUNNER_TEMP!)
  const bundle = join(runnerTemp, 'rt-release-installed', 'RT-ResearchFlow.app')
  const executable = join(bundle, 'Contents', 'MacOS', 'RT-ResearchFlow')
  expect(resolve(process.env.TRADE_WATCH_PACKAGED_EXECUTABLE!)).toBe(executable)
  expect(realpathSync.native(executable)).toBe(executable)
  expect(lstatSync(executable).isFile()).toBe(true)
  expect(lstatSync(executable).isSymbolicLink()).toBe(false)
  const archive = join(bundle, 'Contents', 'Resources', 'app.asar')
  expect(realpathSync.native(archive)).toBe(archive)
  expect(lstatSync(archive).isFile()).toBe(true)
  expect(lstatSync(archive).isSymbolicLink()).toBe(false)
  const workspace = realpathSync.native(process.env.GITHUB_WORKSPACE!)
  // Resolve the existing packager's ASAR reader through its own dependency chain (also pnpm).
  const workspaceRequire = createRequire(join(workspace, 'package.json'))
  const builderRequire = createRequire(workspaceRequire.resolve('electron-builder'))
  const packagerRequire = createRequire(builderRequire.resolve('app-builder-lib'))
  const { extractFile } = packagerRequire('@electron/asar') as {
    extractFile(archivePath: string, entry: string): Buffer
  }
  const packaged = JSON.parse(extractFile(archive, 'package.json').toString('utf8'))
  const source = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'))
  expect(source.name).toBe('rt-research-flow')
  expect(packaged.name).toBe(source.name)
  expect(packaged.version).toBe(source.version)
  expect(packaged.main).toBe('./out/main/index.js')
  if (packaged.productName !== undefined) expect(packaged.productName).toBe('RT-ResearchFlow')
  // Electron prefers package productName over name. Frozen main does not override app.name;
  // packaged Mac configureApplicationDataPaths preserves this app-specific default.
  const applicationName: string = packaged.productName ?? packaged.name
  const home = realpathSync.native(userInfo().homedir)
  expect(homedir()).toBe(home)
  const appData = join(home, 'Library', 'Application Support')
  expect(realpathSync.native(appData)).toBe(appData)
  expect(lstatSync(appData).isDirectory()).toBe(true)
  expect(lstatSync(appData).isSymbolicLink()).toBe(false)
  const defaultDirectory = join(appData, applicationName)
  requireAbsent(defaultDirectory)
  const parentMode = lstatSync(appData).mode
  const fixture = realpathSync.native(mkdtempSync(join(runnerTemp, 'rt-ths-nondefault-')))
  const privatePaths = [home, fixture, defaultDirectory]
  console.info('Mac installed fixtures retained:', { fixture, defaultDirectory, applicationName })
  const environment = Object.fromEntries(Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'))
  delete environment.ELECTRON_RUN_AS_NODE
  let application: ElectronApplication | undefined
  try {
    // Negative control: an isolated profile must not acquire default-directory authority.
    application = await electron.launch({ executablePath: executable,
      args: [`--user-data-dir=${fixture}`], env: environment })
    expect(await application.evaluate(({ app }) => ({ packaged: app.isPackaged, name: app.getName(),
      userData: app.getPath('userData'), appData: app.getPath('appData') }))).toEqual({
      packaged: true, name: applicationName, userData: fixture, appData,
    })
    let page = await openPanel(application)
    expect(await readState(page)).toMatchObject({
      adapterVersion: '3', serviceState: 'BLOCKED_STORAGE', code: 'STORAGE_UNAVAILABLE',
      recoveryReason: 'STORAGE_IO', liveEnabled: false, canInitialize: false, canPrepare: false,
    })
    let report = await diagnostic(page, privatePaths)
    expect(report.tested).toBe(false)
    expect(report.productState.code).toBe('STORAGE_UNAVAILABLE')
    await expect(page.getByTestId('mac-ths-probe')).toBeDisabled()
    await expect(page.getByTestId('mac-ths-authorize')).toBeDisabled()
    await page.getByTestId('mac-ths-live-risk-ack').check()
    await expect(page.getByTestId('mac-ths-enable-live')).toBeDisabled()
    await expect(page.getByTestId('mac-ths-submit-live')).toBeDisabled()
    await expect(page.getByTestId('mac-ths-cancel-live')).toBeDisabled()
    await expect(page.getByTestId('mac-ths-export')).toBeEnabled()
    expect(existsSync(join(fixture, 'mac-ths-orders.v2.sqlite'))).toBe(false)
    await application.close()
    application = undefined

    // Positive control: only this hosted runner's verified, absent default is eligible.
    // Never delete a pre-existing profile or use an alternate directory to evade old journals.
    requireAbsent(defaultDirectory)
    application = await electron.launch({ executablePath: executable, args: [], env: environment })
    expect(await application.evaluate(({ app }) => ({ packaged: app.isPackaged, name: app.getName(),
      userData: app.getPath('userData'), appData: app.getPath('appData') }))).toEqual({
      packaged: true, name: applicationName, userData: defaultDirectory, appData,
    })
    page = await openPanel(application)
    const directoryStat = lstatSync(defaultDirectory)
    expect(directoryStat.isDirectory()).toBe(true)
    expect(directoryStat.isSymbolicLink()).toBe(false)
    expect(realpathSync.native(defaultDirectory)).toBe(defaultDirectory)
    expect(directoryStat.uid).toBe(process.getuid!())
    expect(process.geteuid!()).toBe(process.getuid!())
    expect(directoryStat.mode & 0o7777).toBe(0o700)
    expect(lstatSync(appData).mode).toBe(parentMode)
    expect(await readState(page)).toMatchObject({
      schemaVersion: 1, adapterVersion: '3', serviceState: 'NOT_INITIALIZED', code: 'NOT_INITIALIZED',
      canInitialize: true, canPrepare: false, liveEnabled: false, unknownPending: false, coverage: null, intents: [],
    })
    const database = join(defaultDirectory, 'mac-ths-orders.v2.sqlite')
    expect(existsSync(database)).toBe(false)
    report = await diagnostic(page, privatePaths)
    expect(report.tested).toBe(false)
    expect(report.productState.code).toBe('NOT_INITIALIZED')
    await expect(page.getByTestId('mac-ths-export')).toBeEnabled()
    await expect(page.getByTestId('mac-ths-probe')).toBeDisabled()
    await expect(page.getByTestId('mac-ths-authorize')).toBeDisabled()
    await page.getByTestId('mac-ths-live-risk-ack').check()
    await expect(page.getByTestId('mac-ths-enable-live')).toBeDisabled()

    // Test-side Electron dialog driver only: exact initialization prompt, first cancel then
    // approve, at most two calls. Production service/storage are unchanged; no OS permission
    // prompt or THS action is allowed. This does not claim native dialog rendering acceptance.
    await application.evaluate(({ dialog }) => {
      const holder = globalThis as unknown as { __rtThsInitDialog?: {
        calls: number; replies: number[]; restore(): void
      } }
      if (holder.__rtThsInitDialog) throw new Error('Unexpected existing dialog driver')
      const original = dialog.showMessageBox
      const control = { calls: 0, replies: [0, 1], restore: () => { dialog.showMessageBox = original } }
      holder.__rtThsInitDialog = control
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = args[1] as { title?: string; message?: string; type?: string;
          buttons?: string[]; defaultId?: number; cancelId?: number }
        if (args.length !== 2 || !options || options.title !== '初始化本机委托记录' ||
          options.message !== '这不是清空或重试订单。' || options.type !== 'warning' ||
          JSON.stringify(options.buttons) !== JSON.stringify(['取消', '初始化']) ||
          options.defaultId !== 0 || options.cancelId !== 0 || control.replies.length === 0)
          throw new Error('Unexpected native dialog; no permission or order confirmation is allowed')
        control.calls++
        return { response: control.replies.shift()!, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    })
    const review = page.getByTestId('mac-ths-confirmation')
    for (const [index, expected] of (['NOT_INITIALIZED', 'READY_DISABLED'] as const).entries()) {
      await page.getByTestId('mac-ths-recover').click()
      await expect(review).toBeVisible()
      await expect(review).toContainText('初始化')
      await review.getByRole('button', { name: '核对无误，继续原生确认', exact: true }).click()
      await expect(review).not.toBeVisible()
      await expect.poll(() => application!.evaluate(() =>
        (globalThis as unknown as { __rtThsInitDialog?: { calls: number } }).__rtThsInitDialog?.calls
      )).toBe(index + 1)
      // A cancelled initialization remains NOT_INITIALIZED in the authoritative projection.
      await expect.poll(async () => (await readState(page)).code).toBe(
        expected === 'NOT_INITIALIZED' ? 'NOT_INITIALIZED' : 'INITIALIZED')
      expect((await readState(page)).serviceState).toBe(expected)
      expect(existsSync(database)).toBe(expected === 'READY_DISABLED')
    }
    expect(await application.evaluate(() => {
      const control = (globalThis as unknown as { __rtThsInitDialog?: { calls: number; replies: number[] } }).__rtThsInitDialog
      return control ? { calls: control.calls, remaining: control.replies.length } : null
    })).toEqual({ calls: 2, remaining: 0 })
    expect(readFileSync(database).subarray(0, 16).toString('binary')).toBe('SQLite format 3\0')
    expect(await readState(page)).toMatchObject({
      serviceState: 'READY_DISABLED', code: 'INITIALIZED', liveEnabled: false, canPrepare: true,
      canInitialize: false, coverage: { kind: 'fresh', earlierIds: 'unavailable' }, intents: [],
    })

    // Keep the original authorization-cancel coverage, without approving a permission request.
    await page.getByTestId('mac-ths-authorize').click()
    await expect(review).toBeVisible()
    await expect(review).toContainText('申请辅助功能权限')
    await review.getByRole('button', { name: '取消', exact: true }).click()
    await expect(review).not.toBeVisible()
    await expect(page.getByTestId('mac-ths-diagnostic')).toContainText('USER_CANCELLED')
    report = await diagnostic(page, privatePaths)
    expect(report.tested).toBe(true)
    expect(report.action).toBe('dismissConfirmation')
    expect(report.code).toBe('USER_CANCELLED')
    expect(report.productState.serviceState).toBe('READY_DISABLED')
    await expect(page.getByTestId('mac-ths-diagnostic')).not.toContainText('confirmation')
    await expect(page.getByRole('heading', { name: '中信证券真实交易' })).toBeVisible()
    await page.getByTestId('mac-ths-live-risk-ack').uncheck()
    await expect(page.getByTestId('mac-ths-enable-live')).toBeDisabled()
    await page.getByTestId('mac-ths-live-risk-ack').check()
    await expect(page.getByTestId('mac-ths-enable-live')).toBeEnabled()
    await expect(page.getByTestId('mac-ths-submit-live')).toBeDisabled()
    await expect(page.getByTestId('mac-ths-cancel-live')).toBeDisabled()
    await expect(page.getByTestId('mac-ths-export')).toBeEnabled()
    await page.screenshot({ path: join('test-results', 'mac-ths-experiment-' + process.arch + '.png') })
  } finally {
    if (application) {
      try {
        await application.evaluate(() => {
          const holder = globalThis as unknown as { __rtThsInitDialog?: { restore(): void } }
          holder.__rtThsInitDialog?.restore()
          delete holder.__rtThsInitDialog
        })
      } finally { await application.close() }
    }
    // Preserve both owned fixtures on the disposable runner, especially on failure.
    // No recursive deletion, unknown-profile cleanup, or modification of an existing default.
  }
})
