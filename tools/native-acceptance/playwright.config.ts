import { defineConfig } from '@playwright/test'
import path from 'node:path'

export default defineConfig({
  testDir: '.',
  testMatch: 'native-upgrade.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  globalTimeout: 660_000,
  forbidOnly: true,
  reporter: [['./evidence.mjs']],
  outputDir: path.join(process.env.NA_CASE_ROOT || process.env.RUNNER_TEMP || '.', 'playwright-private'),
  use: { trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 10000 },
})
