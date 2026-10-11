import * as React from 'react'
const { useEffect, useState } = React
import type { DataSourcePreference } from '../../../electron/shared/dataSourceTypes'
import type { TushareVerification } from '../../../electron/main/services/tushareCredentialVerification'

export default function TushareCredentialPanel({ onBound }: { onBound?: () => void }) {
  const [config, setConfig] = useState<DataSourcePreference | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [proof, setProof] = useState<TushareVerification | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void window.api.datasource.getConfig().then(value => {
      if (active) { setConfig(value); setProof(value.tushareVerification ?? null) }
    }).catch(() => { if (active) setError('无法读取绑定状态，请重试。') })
    return () => { active = false }
  }, [])
  async function check(bind: boolean) {
    setBusy(true); setError('')
    try {
      const result = bind
        ? await window.api.datasource.bindTushare(key.trim())
        : await window.api.datasource.validateTushare('')
      setProof(result)
      if (bind && (result.state === 'verified' || result.state === 'permission-limited')) {
        setKey('')
        setConfig(await window.api.datasource.getConfig())
        onBound?.()
      }
    } catch { setError('绑定或验证未完成，请检查系统安全密钥存储和网络后重试；原绑定不会被自动删除。') }
    finally { setBusy(false) }
  }
  const labels = { verified: '交易日历验证通过', 'permission-limited': '接口权限受限',
    'auth-failed': '请求未被接受', 'network-error': '验证未完成', 'invalid-response': '响应不可验证', unbound: '未绑定' }
  return <section id="tushare-key-binding" className="rounded-lg border border-sky-200 bg-sky-50 p-4 space-y-3">
    <h3 className="text-sm font-semibold">Tushare Key 绑定与验证</h3>
    <p className="text-xs text-slate-600">配置中心 → 数据源 → 此处绑定。即使使用免费数据源，此入口也始终保留。此 Key 用于金融数据，不是 DeepSeek 等大模型密钥。</p>
    <label className="block text-xs font-medium" htmlFor="tushare-binding-token">Tushare Pro Token</label>
    <input id="tushare-binding-token" type="password" autoComplete="off" spellCheck={false} value={key}
      disabled={busy} placeholder="粘贴 Tushare 个人账户中的 Token"
      className="w-full rounded border px-3 py-2 text-sm"
      onChange={event => { setKey(event.target.value); setProof(null); setError('') }} />
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy || !key.trim()} className="rounded border bg-white px-3 py-2 text-xs disabled:opacity-50"
        onClick={() => void check(true)}>{busy ? '正在验证…' : '绑定并验证新 Key'}</button>
      <button type="button" disabled={busy || !config?.hasTushareToken || !!key.trim()} className="rounded border bg-white px-3 py-2 text-xs disabled:opacity-50"
        onClick={() => void check(false)}>复查已绑定 Key</button>
      <a href="https://tushare.pro/user/token" target="_blank" rel="noreferrer" className="px-2 py-2 text-xs text-blue-700">前往 Tushare 获取 Token</a>
      <a href="https://tushare.pro/document/1?doc_id=40" target="_blank" rel="noreferrer" className="px-2 py-2 text-xs text-blue-700">官方接口与权限说明</a>
    </div>
    <p role="status" className="text-xs">{key.trim() ? '新 Key 尚未绑定' : config?.hasTushareToken ? '已加密绑定' : '未绑定'} · {proof ? labels[proof.state] : '尚未验证'}
      {proof && <> · {new Date(proof.checkedAt).toLocaleString()} · 检查接口：{proof.checkedApi}</>}</p>
    {proof && <p className="text-xs text-slate-700">{proof.message}</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    <p className="text-xs text-slate-600">绑定仅保存凭证，不自动启用数据源或启动全市场拉取。请在下方勾选 Tushare 后保存。替换失败保留原 Key；普通保存留空也不会清除它。</p>
  </section>
}
