import { useEffect, useRef, useState } from 'react'
import type { SupportDiagnosticPreview } from '../../../electron/shared/supportDiagnostics'

export function SupportFeedbackPanel() {
  const [preview, setPreview] = useState<SupportDiagnosticPreview | null>(null)
  const [expired, setExpired] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'save' | 'copy' | null>(null)
  const busyRef = useRef(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!preview) return
    const remaining = preview.expiresAt - Date.now()
    if (remaining <= 0) { setExpired(true); return }
    const timer = window.setTimeout(() => setExpired(true), remaining)
    return () => window.clearTimeout(timer)
  }, [preview])

  async function generate() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy('preview')
    setPreview(null)
    setExpired(false)
    setMessage('')
    setError('')
    try {
      const result = await window.api.supportDiagnostics.generatePreview()
      if (result.ok) setPreview(result.value)
      else setError(result.error.message + ' ' + result.error.action + ' 问题编号：' + result.error.correlationId)
    } catch {
      setError('反馈预览暂时无法生成，请稍后重试。')
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  async function save() {
    if (busyRef.current || !preview || expired) return
    if (Date.now() >= preview.expiresAt) { setExpired(true); return }
    busyRef.current = true
    setBusy('save')
    setMessage('')
    setError('')
    try {
      const result = await window.api.supportDiagnostics.savePreview(preview.previewId)
      if (result.ok) setMessage(result.value.message)
      else if (result.status === 'expired') setExpired(true)
      else setError(result.error.message + ' ' + result.error.action + ' 问题编号：' + result.error.correlationId)
    } catch {
      setError('反馈文件未能保存，请重新生成预览后再试。')
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  async function copyId(id: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy('copy')
    setMessage('')
    setError('')
    try {
      await navigator.clipboard.writeText(id)
      setMessage('编号已复制。')
    } catch {
      setError('未能复制编号，可以选中编号后手动复制。')
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  const buttonClass = 'rounded border border-blue-200 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-900/60 dark:text-blue-300 dark:hover:bg-blue-950/40'

  return (
    <section data-testid="support-feedback-panel" className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900" aria-busy={busy !== null}>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">问题反馈</h3>
      <p className="mt-2 text-xs leading-5 text-gray-600 dark:text-gray-300">
        反馈文件只包含应用版本、构建标识、系统与芯片类型，以及最近最多 64 项标准问题编号、分类和时间。
        不包含密钥、账户、资金、持仓、原始错误、配置内容或本机路径；不会自动上传。
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        先查看内容，再选择保存位置。当前没有可信能力状态记录，相关列表为空；构建标识 unknown 表示尚未嵌入构建标识。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" data-testid="support-generate-preview" className={buttonClass} disabled={busy !== null} onClick={() => void generate()}>
          {busy === 'preview' ? '生成中…' : '生成反馈预览'}
        </button>
        <button type="button" data-testid="support-save-file" className={buttonClass} disabled={busy !== null || !preview || expired} onClick={() => void save()}>
          {busy === 'save' ? '保存中…' : '保存反馈文件'}
        </button>
      </div>
      {preview && (
        <div className="mt-3 space-y-2 text-xs text-gray-600 dark:text-gray-300">
          <div>应用版本：{preview.package.app.version} · 构建标识：{preview.package.app.buildId}</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all select-text">反馈编号：{preview.previewId}</span>
            <button type="button" disabled={busy !== null} className={buttonClass} onClick={() => void copyId(preview.previewId)}>复制反馈编号</button>
          </div>
          <div>预览有效至：{new Date(preview.expiresAt).toLocaleString('zh-CN', { hour12: false })}</div>
          {preview.package.errorEvents.length === 0 && <div>当前没有已记录的标准问题事件；这不代表所有功能均已检查通过。</div>}
          {preview.package.errorEvents.map(event => (
            <div key={event.id} className="flex flex-wrap items-center gap-2 rounded border border-gray-200 p-2 dark:border-gray-700">
              <span className="break-all select-text">问题编号：{event.id}</span>
              <span>{event.code} · {event.module} · {event.timestamp}</span>
              <button type="button" disabled={busy !== null} className={buttonClass} onClick={() => void copyId(event.id)}>复制问题编号</button>
            </div>
          ))}
          <details open>
            <summary className="cursor-pointer">反馈文件内容预览</summary>
            <pre data-testid="support-json-preview" className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded border border-gray-200 bg-gray-50 p-3 text-[11px] dark:border-gray-700 dark:bg-gray-950">{preview.json}</pre>
          </details>
        </div>
      )}
      {expired && <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-300">此预览已过期，请重新点击“生成反馈预览”。</p>}
      {message && <p role="status" className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">{message}</p>}
      {error && <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">{error}</p>}
    </section>
  )
}
