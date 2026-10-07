import { useEffect, useState } from 'react'
import type {
  AppUpdateCheck, AppUpdateInfo, AppUpdateProgress, AppUpdateResult,
} from '../../../electron/shared/appUpdateTypes'

function sizeLabel(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function AppUpdates() {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null)
  const [check, setCheck] = useState<AppUpdateCheck | null>(null)
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null)
  const [includePrereleases, setIncludePrereleases] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const busy = working || progress?.phase === 'downloading' || progress?.phase === 'verifying'

  useEffect(() => {
    let mounted = true
    window.api.appUpdates.info().then(result => {
      if (!mounted) return
      if (!result.ok) { setError(result.message); return }
      setInfo(result.data)
      setProgress(result.data.progress)
      setIncludePrereleases(result.data.includePrereleasesDefault)
    }).catch(() => { if (mounted) setError('无法读取当前版本，请重新打开应用更新页。') })
    const unsubscribe = window.api.appUpdates.onProgress(value => {
      if (mounted) setProgress(value)
    })
    return () => { mounted = false; unsubscribe() }
  }, [])

  async function perform<T>(operation: () => Promise<AppUpdateResult<T>>, complete: (value: T) => void): Promise<void> {
    setWorking(true)
    setError('')
    try {
      const result = await operation()
      if (result.ok) complete(result.data)
      else setError(result.message)
    } catch {
      setError('应用更新请求未完成，请稍后重试。')
    } finally {
      setWorking(false)
    }
  }

  const buttonClass = 'rounded-md border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
  const primaryClass = 'rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div data-testid="app-updates" className="h-full overflow-y-auto bg-slate-50 p-5 dark:bg-gray-950">
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-gray-100">应用更新</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-gray-400">
                一个产品，一套版本。根据当前系统和芯片选择安装包，直接下载，无需解压外层压缩包。
              </p>
            </div>
            <div className="rounded-md bg-blue-50 px-4 py-2 text-blue-800 dark:bg-blue-950 dark:text-blue-100">
              <div className="text-xs">当前版本</div>
              <div data-testid="app-updates-version" className="mt-1 text-xl font-semibold">{info?.displayVersion ?? '读取中'}</div>
            </div>
          </div>
          {info && (
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500 dark:text-gray-400">当前系统 / 芯片</dt><dd className="mt-1 text-slate-800 dark:text-gray-100">{info.platform === 'darwin' ? 'macOS' : info.platform === 'win32' ? 'Windows' : info.platform} / {info.architecture === 'arm64' ? 'Apple Silicon / ARM64' : info.architecture}</dd></div>
              <div><dt className="text-slate-500 dark:text-gray-400">构建版本</dt><dd className="mt-1 text-slate-800 dark:text-gray-100">{info.currentVersion}{!info.packaged && '（开发环境）'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-slate-500 dark:text-gray-400">当前程序目录</dt><dd className="mt-1 break-all text-slate-800 dark:text-gray-100">{info.installDirectory}</dd></div>
              <div className="sm:col-span-2"><dt className="text-slate-500 dark:text-gray-400">安装包下载位置</dt><dd data-testid="app-updates-download-directory" className="mt-1 break-all text-slate-800 dark:text-gray-100">{info.downloadDirectory}</dd></div>
            </dl>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className={primaryClass} disabled={!info || busy} data-testid="app-updates-check" onClick={() => {
              setCheck(null)
              void perform(() => window.api.appUpdates.check(includePrereleases), setCheck)
            }}>检查更新</button>
            <button type="button" className={buttonClass} disabled={!info || busy} onClick={() => void perform(() => window.api.appUpdates.chooseDirectory(), setInfo)}>选择下载位置</button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void perform(() => window.api.openExternal('https://github.com/hzqedison/RT-ResearchFlow/releases'), () => {})}>打开发布页面</button>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-slate-600 dark:text-gray-300">
            <input type="checkbox" checked={includePrereleases} disabled={busy} onChange={event => { setIncludePrereleases(event.target.checked); setCheck(null) }} />
            接收测试版（测试版与正式版使用同一产品，不另装一个应用）
          </label>
          <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-gray-400">
            仅点击检查或下载时访问公开 GitHub 地址，不需要 GitHub Token，不发送券商账户、研究内容或大模型密钥。
            Windows 默认把安装包下载到当前程序安装盘的同级目录，可自行选择其他盘符。
          </p>
        </section>

        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</div>}

        {check && (
          <section data-testid="app-updates-result" aria-live="polite" className="rounded-lg border border-slate-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">{check.message}</h3>
            {check.release && (
              <div className="mt-3 space-y-3">
                <div className="text-sm text-slate-600 dark:text-gray-300">
                  发布版本 {check.release.displayVersion}{check.release.prerelease && ' / 测试版'}
                  {check.release.installerBytes && ` / ${sizeLabel(check.release.installerBytes)}`}
                </div>
                {check.release.installerName && <div className="break-all text-xs text-slate-500 dark:text-gray-400">{check.release.installerName}</div>}
                {check.release.notes && (
                  <details className="rounded-md border border-slate-100 p-3 dark:border-gray-800">
                    <summary className="cursor-pointer text-sm text-slate-700 dark:text-gray-200">查看本次更新说明</summary>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600 dark:text-gray-300">{check.release.notes}</p>
                  </details>
                )}
                {check.state === 'available' && (
                  <button type="button" className={primaryClass} disabled={busy || !info?.packaged || !check.release.checksumAvailable} data-testid="app-updates-download" onClick={() => {
                    const version = check.release?.version
                    if (version) void perform(() => window.api.appUpdates.download(version), () => {})
                  }}>下载并校验安装包</button>
                )}
                {!info?.packaged && check.state === 'available' && <p className="text-xs text-slate-500 dark:text-gray-400">开发环境只显示更新信息，不下载或安装。</p>}
              </div>
            )}
          </section>
        )}

        {progress && progress.phase !== 'idle' && (
          <section aria-live="polite" className="rounded-lg border border-slate-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">{progress.message}</h3>
            {progress.fileName && <p className="mt-2 break-all text-xs text-slate-500 dark:text-gray-400">{progress.fileName}</p>}
            <div className="mt-4 h-2 overflow-hidden rounded bg-slate-100 dark:bg-gray-800" role="progressbar" aria-label="安装包下载进度" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-gray-400">{progress.percent}% / {sizeLabel(progress.receivedBytes)} / {sizeLabel(progress.totalBytes)}</p>
            {(progress.phase === 'downloading' || progress.phase === 'verifying') && (
              <button type="button" className={buttonClass + ' mt-3'} onClick={() => void window.api.appUpdates.cancel().then(result => { if (!result.ok) setError(result.message) }).catch(() => setError('取消请求未完成，请重试。'))}>取消下载</button>
            )}
            {progress.phase === 'ready' && (
              <button type="button" className={primaryClass + ' mt-3'} onClick={() => void perform(() => window.api.appUpdates.showInstaller(), () => {})}>打开已校验安装包的位置</button>
            )}
          </section>
        )}

        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <h3 className="font-semibold">安装与数据保护</h3>
          <p className="mt-2">当前提供完整安装包下载，不是增量更新，也不会自动安装。请先结束交易操作并备份数据，再自行运行安装包。</p>
          <p className="mt-2">Windows 安装时沿用原来的程序目录，不要选源码目录；macOS 替换原应用，不另建版本副本。若提示旧文件卸载失败，请停止安装，不要删除数据目录。</p>
          <p className="mt-2">SHA-256 用于核对下载内容，不等同于代码签名、公证或真实账户交易验证。</p>
        </section>
      </div>
    </div>
  )
}
