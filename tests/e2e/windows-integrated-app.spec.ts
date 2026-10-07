import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

test('installed Windows beta keeps AI save fixed and blocks the Mac-only trading bridge', async () => {
  test.skip(process.platform !== 'win32' || process.env.CI !== 'true' || !process.env.TRADE_WATCH_PACKAGED_EXECUTABLE,
    'Runs only against an isolated installed Windows CI application.')
  test.setTimeout(90_000)
  const fixture = mkdtempSync(join(tmpdir(), 'rt-windows-integrated-'))
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const application = await electron.launch({
    executablePath: process.env.TRADE_WATCH_PACKAGED_EXECUTABLE!,
    args: [`--user-data-dir=${fixture}`], env: environment,
  })
  try {
    const packageVersion = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version
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
    await expect(page.getByTestId('mac-ths-platform-warning')).toContainText('不能启用真实交易')
    await expect(page.getByTestId('mac-ths-authorize')).toBeDisabled()
    await page.getByTestId('mac-ths-probe').click()
    await expect(page.getByTestId('mac-ths-diagnostic')).toContainText('MAC_REQUIRED', { timeout: 30_000 })
    const diagnostic = JSON.parse(await page.getByTestId('mac-ths-diagnostic').innerText())
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
    if (dirname(resolve(fixture)) !== resolve(tmpdir())) throw new Error('Unsafe fixture cleanup path')
    rmSync(fixture, { recursive: true, force: true })
  }
})
