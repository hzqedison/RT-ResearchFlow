import { expect, test, _electron as electron } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { waitForPackagedRuntime } from './packagedRuntimeObservation'

test('native 1.22 to 1.23 retains saved preferences and owned data files', async () => {
  test.setTimeout(120_000)
  const phase = process.env.RT_UPGRADE_PHASE
  const executable = process.env.RT_PACKAGED_EXE, rootInput = process.env.RT_UPGRADE_ROOT, profileInput = process.env.RT_UPGRADE_PROFILE
  const version = phase === 'seed' ? '1.22.0' : phase === 'verify' ? '1.23.0' : undefined
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RT_NATIVE_UPGRADE_ALLOWED !== '1' ||
      !executable || !rootInput || !profileInput || !version || ![executable, rootInput, profileInput].every(isAbsolute))
    throw new Error('EXPLICIT_OWNED_NATIVE_UPGRADE_REQUIRED')
  const root = resolve(rootInput), profile = resolve(profileInput), proof = join(root, 'proof')
  const inside = (path: string) => {
    const actual = resolve(path), prefix = root + sep
    return process.platform === 'win32' ? actual.toLowerCase().startsWith(prefix.toLowerCase()) : actual.startsWith(prefix)
  }
  if (!inside(executable) || !inside(profile)) throw new Error('UPGRADE_PATH_OUTSIDE_OWNED_ROOT')
  mkdirSync(proof, { recursive: true })
  const environment = { ...process.env, TEMP: root, TMP: root }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'NODE_PATH']) delete environment[key]
  const application = await electron.launch({ executablePath: executable, args: ['--user-data-dir=' + profile], env: environment })
  const child = application.process(), errors: string[] = []
  let normalExit = false
  const names = ['runtime/python/retention-fixture.txt', 'data-source-extensions/fixture/retention-fixture.txt',
    'data-source-cache/pip/retention-fixture.txt', 'preferences-fixture.json']
  const content = Buffer.from('isolated upgrade fixture; no credentials or account data\n', 'utf8')
  const hash = createHash('sha256').update(content).digest('hex')
  try {
    const page = await application.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    const runtime = await waitForPackagedRuntime(application, version)
    expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(true)
    const data = resolve(runtime.dataPath), expected = process.platform === 'win32' ? resolve(dirname(executable), 'data') : profile
    expect(process.platform === 'win32' ? data.toLowerCase() : data).toBe(process.platform === 'win32' ? expected.toLowerCase() : expected)
    expect(inside(data)).toBe(true)
    if (phase === 'seed') {
      await page.evaluate(() => window.api.datasource.saveConfig({
        dailyProviders: ['sina', 'tencent'], reportProviders: ['eastmoney'], wencaiEnabled: false,
      }))
      for (const name of names) {
        const file = join(data, name)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, content, { flag: 'wx' })
      }
    }
    const config = await page.evaluate(() => window.api.datasource.getConfig())
    expect(config.dailyProviders).toEqual(['sina', 'tencent'])
    expect(config.reportProviders).toEqual(['eastmoney'])
    expect(config.wencaiEnabled).toBe(false)
    expect(config.hasTushareToken).toBe(false)
    expect(config.hasWencaiCookie).toBe(false)
    for (const name of names) expect(createHash('sha256').update(readFileSync(join(data, name))).digest('hex')).toBe(hash)
    if (phase === 'verify') {
      const baseline = JSON.parse(readFileSync(join(proof, 'native-upgrade-seed.json'), 'utf8'))
      expect(baseline).toMatchObject({ phase: 'seed', version: '1.22.0', platform: process.platform, arch: process.arch, normalExit: true, sentinelHash: hash })
    }
    const closing = application.waitForEvent('close', { timeout: 15_000 })
    await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
    await closing
    await expect.poll(() => child.exitCode, { timeout: 5_000 }).toBe(0)
    normalExit = true
    expect(errors).toEqual([])
    const receipt = { kind: 'native-cross-version-upgrade-acceptance', phase, version,
      fromVersion: '1.22.0', toVersion: '1.23.0', platform: process.platform, arch: process.arch,
      toSourceCommit: process.env.RT_UPGRADE_SOURCE_COMMIT, nativeBuildRun: process.env.RT_UPGRADE_BUILD_RUN,
      actualSavedPreferenceRead: true, preferenceOrderRetained: true, sentinelFiles: names.length, sentinelHash: hash,
      sameApplicationPath: true, sameDataPath: true, rendererErrors: 0, normalExit, syntheticNonFinancialPreferences: true,
      productRebuilt: false, personalOldDatabasesVerified: false, realCredentialMigrationVerified: false,
      productionUserDataTouched: false, brokerOrdersSubmitted: false }
    writeFileSync(join(proof, 'native-upgrade-' + phase + '.json'), JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify(receipt))
  } finally { if (!normalExit) await application.close().catch(() => {}) }
})
