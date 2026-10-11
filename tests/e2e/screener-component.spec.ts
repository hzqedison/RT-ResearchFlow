import { test, expect, _electron, type ElectronApplication } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Standalone component host: never imports the production Electron main/preload.
test('isolated PersonalScreener: basic-data retry and honest empty results', async () => {
  test.setTimeout(90_000)
  const project = path.resolve(__dirname, '../..')
  const ownedRoot = 'D:/RT-ResearchFlow-BuildCache'
  await mkdir(ownedRoot, { recursive: true })
  const host = await mkdtemp(path.join(ownedRoot, 'screener-component-'))
  let electron: ElectronApplication | undefined
  let server: { close(): Promise<void> } | undefined
  const errors: string[] = []
  const blocked: string[] = []
  try {
    // Keep Vite's native ESM loader outside Playwright's CJS transformation.
    const viteUrl = pathToFileURL(path.join(path.dirname(require.resolve('vite/package.json')), 'dist/node/index.js')).href
    const { createServer } = await new Function('url', 'return import(url)')(viteUrl)
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:">
      <script>
        window.__fixture = { phase: 'not-ready', syncOK: false, getCalls: 0, runCalls: 0, rankCalls: 0, syncCalls: [] };
        const result = () => window.__fixture.phase === 'not-ready'
          ? { ok: false, code: 'STOCK_BASIC_NOT_READY', error: 'STOCK_BASIC_NOT_READY' }
          : { ok: true, snapshot: { tradeDate: '20261009', calculatedAt: '2026-10-09T08:00:00Z', isCached: false,
              mode: 'eod', totalScanned: window.__fixture.phase === 'zero-scan' ? 0 : 37, stocks: [] } };
        window.api = { shortTerm: {
          screener: {
            get: async () => { window.__fixture.getCalls++; return result(); },
            run: async () => { window.__fixture.runCalls++; return result(); },
            getRankConfig: async () => { window.__fixture.rankCalls++; return { ok: false }; }
          },
          syncDataNow: async (kind) => { window.__fixture.syncCalls.push(kind); return { ok: window.__fixture.syncOK }; }
        } };
      </script></head><body><div id="root" style="height:100vh"></div>
      <script type="module" src="/@id/__x00__screener-host"></script></body></html>`
    const vite = await createServer({
      configFile: false,
      root: project,
      cacheDir: path.join(host, 'vite-cache'),
      esbuild: { jsx: 'automatic' },
      resolve: { alias: { '@renderer': path.join(project, 'src') } },
      optimizeDeps: { entries: [], noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'zustand', 'lightweight-charts'] },
      server: { host: '127.0.0.1', port: 0, hmr: false, fs: { strict: true, allow: [project] } },
      plugins: [{
        name: 'isolated-screener-host',
        resolveId(id: string) { if (id === '\0screener-host') return id },
        load(id: string) {
          if (id === '\0screener-host') return `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { PersonalScreener } from '/src/components/ShortTermStrategy/PersonalScreener.tsx';
            import '/src/index.css';
            createRoot(document.getElementById('root')).render(React.createElement(PersonalScreener));`
        },
        configureServer(s: any) {
          s.middlewares.use((req: any, res: any, next: () => void) => {
            if (req.url !== '/') return next()
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(html)
          })
        },
      }],
    })
    server = vite
    await vite.listen()
    const address = vite.httpServer.address()
    const origin = `http://127.0.0.1:${address.port}`
    const main = path.join(host, 'main.cjs')
    await writeFile(main, `
      const { app, BrowserWindow, session } = require('electron');
      app.setPath('userData', ${JSON.stringify(path.join(host, 'profile'))});
      app.setPath('sessionData', ${JSON.stringify(path.join(host, 'session'))});
      app.commandLine.appendSwitch('disable-background-networking');
      app.whenReady().then(() => {
        global.__blocked = [];
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
          const allowed = details.url.startsWith(${JSON.stringify(origin + '/')}) || details.url === 'about:blank';
          if (!allowed) global.__blocked.push(details.url);
          callback({ cancel: !allowed });
        });
        const win = new BrowserWindow({ width: 1300, height: 900, show: false,
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.loadURL('about:blank');
      });
      app.on('window-all-closed', () => app.quit());
    `, 'utf8')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    electron = await _electron.launch({ args: [main], env, timeout: 25_000 })
    const page = await electron.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error' || /Maximum update depth/i.test(message.text())) errors.push(message.text())
    })
    await page.goto(origin)
    const sync = page.getByTestId('screener-sync-stock-basic')
    await expect(sync).toBeVisible()
    await expect(sync).toBeEnabled()
    await expect.poll(() => page.evaluate(() => (window as any).__fixture.getCalls)).toBe(1)

    await sync.click()
    await expect(page.getByText('股票基础资料同步未完成，请检查网络或稍后重试。公开源同步无需 Tushare Token。', { exact: true })).toBeVisible()
    await expect(sync).toBeVisible()
    await expect(sync).toBeEnabled()
    expect(await page.evaluate(() => (window as any).__fixture.getCalls)).toBe(1)
    expect(await page.evaluate(() => (window as any).__fixture.syncCalls)).toEqual(['stockBasic'])

    await page.evaluate(() => Object.assign((window as any).__fixture, { syncOK: true, phase: 'zero-scan' }))
    await sync.click()
    await expect(page.getByText('本次没有完成有效扫描，暂时不能判断是否有选股机会', { exact: true })).toBeVisible()
    await expect(page.getByText('请检查股票基础资料与逐股历史日线覆盖后重新运行；空列表不代表没有机会。', { exact: true })).toBeVisible()
    await expect(sync).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__fixture.getCalls)).toBe(2)
    expect(await page.evaluate(() => (window as any).__fixture.syncCalls)).toEqual(['stockBasic', 'stockBasic'])

    // Refresh the same mounted real component with a positive scan/zero-signal reply.
    await page.evaluate(() => { (window as any).__fixture.phase = 'positive-scan' })
    // Use the component's actual refresh button, not a direct state injection.
    const refresh = page.getByRole('button').filter({ hasText: /重新|刷新|运行选股/ })
    await expect(refresh).toHaveCount(1)
    await refresh.click()
    await expect(page.getByText('本次实际扫描范围内没有匹配的策略信号', { exact: true })).toBeVisible()
    await expect(page.getByText('已扫描 37 只股票；结论仅适用于本次数据与策略条件，不代表全市场没有机会。', { exact: true })).toBeVisible()
    await expect(page.getByText('本次没有完成有效扫描，暂时不能判断是否有选股机会', { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__fixture.runCalls)).toBe(1)
    // Several rendering frames expose asynchronous update-depth failures too.
    await page.evaluate(() => new Promise<void>(resolve => {
      let remaining = 12
      const frame = () => --remaining ? requestAnimationFrame(frame) : resolve()
      requestAnimationFrame(frame)
    }))
    blocked.push(...await electron.evaluate(() => (globalThis as any).__blocked))
    expect(blocked, 'No attempted external requests').toEqual([])
    expect(errors, 'No pageerror, console error or Maximum update depth').toEqual([])
  } finally {
    try { await electron?.close() } finally {
      try { await server?.close() } finally {
        // Only remove this invocation's mkdtemp-owned directory on D:.
        if (path.dirname(path.resolve(host)) !== path.resolve(ownedRoot)) throw new Error('Unsafe cleanup path')
        await rm(host, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
      }
    }
  }
})
