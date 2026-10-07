import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('installed Mac exposes a real narrow bridge and private diagnostic without placing orders', async () => {
  test.skip(process.platform !== 'darwin' || process.env.CI !== 'true' || !process.env.TRADE_WATCH_PACKAGED_EXECUTABLE,
    'Runs only on isolated native Mac CI with the installed application.')
  test.setTimeout(90000)
  const fixture = mkdtempSync(join(tmpdir(), 'rt-ths-ui-'))
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({ executablePath: process.env.TRADE_WATCH_PACKAGED_EXECUTABLE!,
      args: [`--user-data-dir=${fixture}`], env: environment })
    const page = await application.firstWindow()
    await page.getByTestId('quant-onboarding-open').click()
    await page.getByTestId('quant-onboarding-step-4').click()
    await expect(page.getByTestId('mac-trading-panel')).toBeVisible()
    await expect(page.getByTestId('mac-ths-export')).toBeDisabled()
    await page.getByTestId('mac-ths-probe').click()
    await expect(page.getByTestId('mac-ths-diagnostic')).toContainText('"tested": true')
    const result = JSON.parse(await page.getByTestId('mac-ths-diagnostic').innerText())
    expect(['ACCESSIBILITY_REQUIRED', 'CLIENT_NOT_RUNNING', 'AUTOMATION_DENIED']).toContain(result.code)
    expect(result.canSubmitLiveOrders).toBe(false)
    expect(result.canRunUnattended).toBe(false)
    expect(Object.keys(result)).not.toContain('contractNo')
    await page.getByLabel('测试模式').selectOption('livePreview')
    await expect(page.getByTestId('mac-ths-submit-simulation')).toBeDisabled()
    await expect(page.getByTestId('mac-ths-export')).toBeEnabled()
    await page.screenshot({ path: join('test-results', 'mac-ths-experiment-' + process.arch + '.png') })
  } finally {
    await application?.close().catch(() => {})
    rmSync(fixture, { recursive: true, force: true })
  }
})
