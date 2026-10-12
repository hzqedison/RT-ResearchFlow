import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

test('observe real released Eastmoney transport without replacing fetch or asserting availability', async () => {
  test.setTimeout(120_000)
  if (process.env.RT_RELEASED_PUBLIC_TRANSPORT_DIAGNOSTIC !== '1') throw new Error('EXPLICIT_PUBLIC_TRANSPORT_DIAGNOSTIC_REQUIRED')
  const root = resolve(process.env.RT_PACKAGED_TEST_ROOT ?? '')
  const executable = resolve(process.env.RT_PACKAGED_EXE ?? '')
  const version = process.env.RT_PACKAGED_VERSION
  if (!process.env.RT_PACKAGED_TEST_ROOT || !process.env.RT_PACKAGED_EXE || !version) throw new Error('OWNED_PACKAGED_CONTEXT_REQUIRED')
  if (process.platform === 'win32' && !executable.replaceAll('\\', '/').includes('/release/win-unpacked/')) throw new Error('PRODUCTION_APPLICATION_FORBIDDEN')
  if (process.platform === 'darwin') {
    const runner = resolve(process.env.RUNNER_TEMP ?? '')
    if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP ||
        !root.startsWith(runner + sep) || !executable.startsWith(runner + sep)) throw new Error('OWNED_NATIVE_CI_REQUIRED')
  }
  mkdirSync(root, { recursive: true })
  const profile = mkdtempSync(join(root, 'transport-profile-'))
  const env = { ...process.env, TEMP: root, TMP: root }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'NODE_PATH']) delete env[key]
  const application = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env })
  let normalExit = false
  const observerKey = '__rtReleasedPublicTransportObserver'
  try {
    const page = await application.firstWindow()
    await expect(page.getByTestId('nav-tab-feed')).toBeVisible({ timeout: 30_000 })
    await expect(async () => {
      const runtime = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), userData: app.getPath('userData') }))
      expect(runtime.packaged).toBe(true)
      expect(runtime.version).toBe(version)
      expect(resolve(runtime.userData)).toBe(process.platform === 'win32' ? join(dirname(executable), 'data') : profile)
    }).toPass({ timeout: 30_000 })
    expect((await page.evaluate(() => window.api.datasource.getConfig())).hasTushareToken).toBe(false)
    await application.evaluate((_, key) => {
      const load = (process as unknown as { mainModule: { require: (id: string) => any } }).mainModule.require.bind((process as any).mainModule)
      const dc = load('node:diagnostics_channel')
      const host = 'push2his.eastmoney.com'
      const startedAt = Date.now()
      const originalFetch = globalThis.fetch
      const events: Array<Record<string, unknown>> = []
      const ids = new WeakMap<object, number>()
      let nextId = 0
      const subscriptions: Array<{ channel: any; listener: (message: any) => void }> = []
      const allowedCodes = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT',
        'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
        'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_SSL_WRONG_VERSION_NUMBER'])
      function matches(request: any) {
        const url = new URL(request.path, String(request.origin))
        return url.hostname === host && url.pathname === '/api/qt/stock/kline/get' && url.searchParams.get('secid') === '1.600519'
      }
      function errorCode(error: any) {
        return allowedCodes.has(error?.code) ? error.code : allowedCodes.has(error?.cause?.code) ? error.cause.code : 'OTHER'
      }
      for (const name of ['undici:request:create', 'undici:client:sendHeaders', 'undici:request:headers',
        'undici:request:trailers', 'undici:request:error']) {
        const channel = dc.channel(name)
        const listener = (message: any) => {
          try {
            if (events.length >= 64 || !matches(message.request)) return
            let id = ids.get(message.request)
            if (id === undefined) { id = ++nextId; ids.set(message.request, id) }
            const event: Record<string, unknown> = { kind: name.split(':').slice(1).join(':'), requestId: id, elapsedMs: Date.now() - startedAt }
            if (name === 'undici:request:headers' && Number.isInteger(message.response?.statusCode)) event.status = message.response.statusCode
            if (name === 'undici:request:error') event.code = errorCode(message.error)
            events.push(event)
          } catch { /* Subscribers must not affect the request. */ }
        }
        channel.subscribe(listener)
        subscriptions.push({ channel, listener })
      }
      ;(globalThis as any)[key] = {
        stop: () => {
          for (const { channel, listener } of subscriptions) channel.unsubscribe(listener)
          return { events, fetchUnchanged: originalFetch === globalThis.fetch, subscriptionsRemoved: subscriptions.length, runtimeUndici: process.versions.undici }
        },
      }
    }, observerKey)
    const result = await page.evaluate(() => window.api.datasource.probe('eastmoney', '600519'))
    const observation = await application.evaluate((_, key) => {
      const observer = (globalThis as any)[key]
      if (!observer) throw new Error('OBSERVER_MISSING')
      const result = observer.stop()
      delete (globalThis as any)[key]
      return result
    }, observerKey)
    expect(observation.fetchUnchanged).toBe(true)
    expect(observation.subscriptionsRemoved).toBe(5)
    expect(observation.events.length).toBeGreaterThan(0)
    const child = application.process()
    const closed = application.waitForEvent('close', { timeout: 15_000 })
    await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
    await closed
    await expect.poll(() => child.exitCode, { timeout: 5_000 }).toBe(0)
    normalExit = true
    const headers = observation.events.filter((event: any) => event.kind === 'request:headers')
    const receipt = {
      kind: 'released-public-transport-diagnostic', version, platform: process.platform, arch: process.arch,
      publicProvider: 'eastmoney', sampledStock: '600519', providerAvailableThisAttempt: result.ok === true,
      rows: Number.isFinite(result.rows) ? result.rows : null, latestTradeDate: result.latestTradeDate ?? null,
      observation, outcome: result.ok ? 'PUBLIC_DATA_RETURNED_THIS_ATTEMPT' : headers.length ? 'HTTP_OBSERVED_BUT_PROVIDER_FAILED' : 'NO_HTTP_RESPONSE_OBSERVED',
      diagnosisOnly: true, marketRowsMocked: false, normalExit, productionUserDataTouched: false, brokerOrdersSubmitted: false,
    }
    writeFileSync(join(root, 'released-public-transport-diagnostic.json'), JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify(receipt))
  } finally {
    if (!normalExit) {
      await application.evaluate((_, key) => {
        const observer = (globalThis as any)[key]
        if (observer) { observer.stop(); delete (globalThis as any)[key] }
      }, observerKey).catch(() => {})
      await application.close().catch(() => {})
    }
  }
})
