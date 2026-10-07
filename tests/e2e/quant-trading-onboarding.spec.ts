import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QUANT_ONBOARDING_STORAGE_KEY } from '../../src/utils/quantTradingOnboarding'

type QuantDownloadResult = { state: string; filename: string; isLocalBlob: boolean }
type QuantDownloadGlobal = typeof globalThis & { quantDiagnosticDownload: QuantDownloadResult }

test('installed Mac guide persists progress, stays blocked, and exports only safe diagnostics', async () => {
  test.skip(process.platform !== 'darwin' || process.env.CI !== 'true' || !process.env.TRADE_WATCH_PACKAGED_EXECUTABLE,
    'This installed-app test runs only on an isolated Mac CI runner.')
  test.setTimeout(90_000)
  const fixture = mkdtempSync(join(tmpdir(), 'rt-quant-onboarding-'))
  const launchEnv = { ...process.env }
  delete launchEnv.ELECTRON_RUN_AS_NODE
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({ executablePath: process.env.TRADE_WATCH_PACKAGED_EXECUTABLE!,
      args: [`--user-data-dir=${fixture}`], env: launchEnv })
    const page = await application.firstWindow()
    await page.getByTestId('quant-onboarding-open').click()
    await expect(page.getByRole('heading', { name: '量化交易开通引导' })).toBeVisible()
    await page.getByTestId('quant-onboarding-step-1').click()
    await expect(page.getByTestId('quant-official-reply-reported')).toBeDisabled()
    await page.getByTestId('quant-application-reported').click()
    await page.getByTestId('quant-official-reply-reported').click()
    await page.getByTestId('quant-onboarding-step-2').click()
    await page.getByTestId('quant-data-permission-acknowledged').check()
    await page.getByTestId('quant-onboarding-step-3').click()
    await expect(page.getByTestId('quant-trading-disabled')).toBeDisabled()
    await expect(page.getByTestId('quant-connection-status')).toContainText('待接口核验')

    await page.evaluate((key) => {
      const saved = JSON.parse(localStorage.getItem(key) || '{}')
      localStorage.setItem(key, JSON.stringify({ ...saved, account: 'SENSITIVE_ACCOUNT', password: 'SENSITIVE_PASSWORD',
        token: 'SENSITIVE_TOKEN', balance: 'SENSITIVE_BALANCE', rawLog: 'SENSITIVE_RAW_LOG', canSubmitOrders: true }))
    }, QUANT_ONBOARDING_STORAGE_KEY)
    await page.reload()
    await page.getByTestId('quant-onboarding-open').click()
    await page.getByTestId('quant-onboarding-step-3').click()
    await expect(page.getByTestId('quant-trading-disabled')).toBeDisabled()
    const diagnosticPath = join(fixture, 'diagnostic.json')
    // Electron uses its native save dialog, not Chromium's page download event.
    // Observe the real download and choose a path only inside this CI fixture.
    await application.evaluate(({ BrowserWindow }, savePath) => {
      const host = globalThis as QuantDownloadGlobal
      host.quantDiagnosticDownload = { state: 'waiting', filename: '', isLocalBlob: false }
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())
      if (!window) throw new Error('Installed application window is missing')
      window.webContents.session.once('will-download', (event, item, initiator) => {
        const result = host.quantDiagnosticDownload
        result.isLocalBlob = item.getURL().startsWith('blob:')
        if (initiator !== window.webContents || !result.isLocalBlob) {
          result.state = 'unexpected-download'
          event.preventDefault()
          return
        }
        result.filename = item.getFilename()
        item.setSavePath(savePath)
        item.once('done', (_event, state) => { result.state = state })
      })
    }, diagnosticPath)
    await page.getByTestId('quant-diagnostic-export').click()
    await expect.poll(() => application!.evaluate(() =>
      (globalThis as QuantDownloadGlobal).quantDiagnosticDownload.state), { timeout: 30_000 }).toBe('completed')
    const download = await application.evaluate(() => (globalThis as QuantDownloadGlobal).quantDiagnosticDownload)
    expect(download.filename).toBe('RT-ResearchFlow-quant-diagnostic-v1.json')
    expect(download.isLocalBlob).toBe(true)
    const raw = readFileSync(diagnosticPath, 'utf8')
    const diagnostic = JSON.parse(raw)
    expect(raw).not.toContain('SENSITIVE_')
    expect(diagnostic.runtime).toBe('macos')
    expect(diagnostic.progress).toEqual({ applicationRequested: true, officialReplyReceived: true, dataPermissionAcknowledged: true })
    expect(diagnostic.verification.canSubmitOrders).toBe(false)
    expect(diagnostic.blockers).toContain('MAC_THS_CONNECTOR_UNAVAILABLE')
    mkdirSync('test-results', { recursive: true })
    await page.screenshot({ path: 'test-results/macos-quant-onboarding.png' })
    await page.getByRole('button', { name: '关闭量化开通引导' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  } finally {
    try { await application?.close() } finally { rmSync(fixture, { recursive: true, force: true }) }
  }
})
