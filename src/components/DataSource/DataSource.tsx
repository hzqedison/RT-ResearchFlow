import { useEffect, useState } from 'react'
import type {
  DailyDataProvider, DataProbeProvider, DataSourcePreference, ReportDataProvider,
  ResearchReportResult, WencaiResult,
} from '../../../electron/shared/dataSourceTypes'

const dailySources: Array<{ id: DailyDataProvider; label: string; description: string }> = [
  { id: 'tushare', label: 'Tushare Pro', description: '保留专业日线与原有增值接口；需要本人 Token 和对应积分权限。' },
  { id: 'tencent', label: '腾讯财经', description: '免 Key 公开日线，最多480个已收盘交易日；名称可从腾讯公开行情补充。' },
  { id: 'eastmoney', label: '东方财富', description: '免 Key 个股日线，复用现有行情缓存；公开接口可能限流。' },
  { id: 'sina', label: '新浪财经', description: '保留原有免费日线来源，作为可选回退，不替代所有专业接口。' },
  { id: 'tdx', label: '通达信 / mootdx（实验）', description: '需要本地 Python 扩展；公共行情服务器可能返回空，必须取得有效K线才算检测成功。' },
  { id: 'akshare', label: 'AKShare', description: '本地开源 Python 接口库；本版接入东财日线和研报索引，不是独立数据授权。' },
]

export function DataSource() {
  const [config, setConfig] = useState<DataSourcePreference | null>(null)
  const [daily, setDaily] = useState<DailyDataProvider[]>([])
  const [reports, setReports] = useState<ReportDataProvider[]>([])
  const [wencai, setWencai] = useState(false)
  const [pythonPath, setPythonPath] = useState('')
  const [token, setToken] = useState('')
  const [cookie, setCookie] = useState('')
  const [stockCode, setStockCode] = useState('000001')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [probeMessages, setProbeMessages] = useState<Record<string, string>>({})
  const [reportResult, setReportResult] = useState<ResearchReportResult | null>(null)
  const [wencaiResult, setWencaiResult] = useState<WencaiResult | null>(null)

  useEffect(() => {
    let active = true
    window.api.datasource.getConfig().then((value: DataSourcePreference) => {
      if (!active) return
      setConfig(value)
      setDaily(value.dailyProviders)
      setReports(value.reportProviders)
      setWencai(value.wencaiEnabled)
      setPythonPath(value.pythonPath)
    }).catch(() => { if (active) setError('配置读取失败，请先重启应用；不要重复填写密钥。') })
    return () => { active = false }
  }, [])

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label)
    setError('')
    setMessage('')
    try { await action() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成，请稍后再试。') }
    finally { setBusy('') }
  }

  async function save() {
    await window.api.datasource.saveConfig({
      dailyProviders: daily, reportProviders: reports, wencaiEnabled: wencai, pythonPath,
      tushareEnabled: daily.includes('tushare'),
      tushareToken: token.trim() || undefined,
      wencaiCookie: cookie.trim() || undefined,
    })
    const saved: DataSourcePreference = await window.api.datasource.getConfig()
    setConfig(saved)
    setToken('')
    setCookie('')
    setMessage('配置已保存；留空密钥输入框不会删除已保存的密钥。')
  }

  function toggleDaily(id: DailyDataProvider) {
    setDaily(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  }

  function moveProvider(index: number, direction: -1 | 1) {
    setDaily(current => {
      const next = [...current]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function probe(provider: DataProbeProvider) {
    await run('检测连接', async () => {
      await save()
      const result = await window.api.datasource.probe(provider, stockCode)
      setProbeMessages(current => ({ ...current, [provider]: (result.ok ? '已取得样本：' : '未完成：') + result.message }))
    })
  }

  const disabled = !!busy || !config
  const inputClass = 'w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-900'
  const buttonClass = 'text-xs px-3 py-2 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800'
  const needsPython = daily.includes('tdx') || daily.includes('akshare') || reports.includes('akshare') || wencai

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-4xl space-y-6">
      <header>
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">数据源配置</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          多选互补，不再只依赖 Tushare。日线按所选顺序回退；研报聚合去重；问财独立查询。所有操作只取数据，不提交交易。
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
          本版多选覆盖个股日线、AI二轮缺失行情补齐、研报索引和问财选股。全市场证券池、板块、分钟线、筹码等原有模块仍沿用各自接口，不能视为已全部替换。
        </p>
      </header>

      <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-5 space-y-4">
        <h3 className="font-medium text-sm">行情来源（日线，可多选）</h3>
        {dailySources.map(source => (
          <div key={source.id} className="border-b border-gray-100 dark:border-gray-800 pb-3">
            <div className="flex items-start justify-between gap-4">
              <label className="flex items-start gap-3 flex-1 cursor-pointer">
                <input type="checkbox" checked={daily.includes(source.id)} disabled={disabled}
                  onChange={() => toggleDaily(source.id)} className="mt-1" />
                <span><span className="block text-sm font-medium">{source.label}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{source.description}</span></span>
              </label>
              <button className={buttonClass} disabled={disabled || !daily.includes(source.id)} onClick={() => void probe(source.id)}>检测</button>
            </div>
            {probeMessages[source.id] && <p className="text-xs text-gray-600 dark:text-gray-300 mt-2">{probeMessages[source.id]}</p>}
          </div>
        ))}
        <div className="text-xs space-y-2">
          <p className="text-gray-500">请求优先级（失败才尝试下一个，不混入复权价）：</p>
          {daily.length === 0 && <p className="text-amber-700">尚未选择日线来源，已有缓存仍保留。</p>}
          {daily.map((provider, index) => <div className="flex items-center gap-2" key={provider}>
            <span className="flex-1">{index + 1}. {dailySources.find(item => item.id === provider)?.label}</span>
            <button className={buttonClass} disabled={disabled || index === 0} onClick={() => moveProvider(index, -1)}>上移</button>
            <button className={buttonClass} disabled={disabled || index === daily.length - 1} onClick={() => moveProvider(index, 1)}>下移</button>
          </div>)}
        </div>
        <label className="block text-xs font-medium">Tushare Token {config?.hasTushareToken && <span className="text-green-700">（已加密保存）</span>}</label>
        <div className="flex gap-2">
          <input type="password" autoComplete="off" className={inputClass} value={token}
            onChange={event => setToken(event.target.value)} placeholder="留空保留已有 Token；腾讯、东财不需要此项" disabled={disabled} />
          <button className={buttonClass} disabled={disabled || !token.trim()} onClick={() => void run('验证 Token', async () => {
            const result = await window.api.datasource.validateTushare(token.trim())
            if (!result.valid) throw new Error(result.message)
            setMessage(result.message)
          })}>验证</button>
        </div>
      </section>

      <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-5 space-y-4">
        <h3 className="font-medium text-sm">研报来源（可多选）</h3>
        {(['eastmoney', 'akshare'] as const).map(provider => (
          <div key={provider}>
            <div className="flex items-center justify-between gap-3">
              <label className="flex gap-3 items-center text-sm">
                <input type="checkbox" checked={reports.includes(provider)} disabled={disabled}
                  onChange={() => setReports(current => current.includes(provider) ? current.filter(value => value !== provider) : [...current, provider])} />
                {provider === 'eastmoney' ? '东方财富研报中心（免 Key）' : 'AKShare 个股研报（需要本地扩展）'}
              </label>
              <button className={buttonClass} disabled={disabled || !reports.includes(provider)} onClick={() => void probe(provider === 'eastmoney' ? 'eastmoney-reports' : 'akshare-reports')}>检测</button>
            </div>
            {probeMessages[provider + '-reports'] && <p className="text-xs mt-2">{probeMessages[provider + '-reports']}</p>}
          </div>
        ))}
        <p className="text-xs text-gray-500">这两种接入可能来自同一个东财上游，会按原文链接去重。本版提供索引和原文入口，不冒充已阅读PDF全文。</p>
      </section>

      <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-5 space-y-4">
        <label className="flex gap-3 items-center text-sm font-medium">
          <input type="checkbox" checked={wencai} disabled={disabled} onChange={event => setWencai(event.target.checked)} />
          i问财选股（实验，不是研报库）
        </label>
        <p className="text-xs text-gray-500">pywencai 接口目前需要本人的登录 Cookie 和本地 Node.js 16+。仅本机加密保存；低频、单页最多50条，不绕过验证码或付费权限。</p>
        <label className="block text-xs">登录 Cookie {config?.hasWencaiCookie && <span className="text-green-700">（已加密保存）</span>}</label>
        <input type="password" autoComplete="off" className={inputClass} value={cookie} disabled={disabled || !wencai}
          onChange={event => setCookie(event.target.value)} placeholder="只在自己的电脑填写，留空保留已有值；不要发给他人" />
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} disabled={disabled} onClick={() => void window.api.datasource.openSourceLink('https://www.iwencai.com/')}>打开问财网站</button>
          <button className={buttonClass} disabled={disabled || !wencai} onClick={() => void probe('iwencai')}>检测问财</button>
          <button className={buttonClass} disabled={disabled || !config?.hasWencaiCookie} onClick={() => void run('清除 Cookie', async () => {
            await window.api.datasource.saveConfig({ clearWencaiCookie: true })
            setCookie('')
            setConfig(current => current ? { ...current, hasWencaiCookie: false } : current)
            setMessage('本机保存的问财 Cookie 已清除。')
          })}>清除已保存 Cookie</button>
        </div>
        {probeMessages.iwencai && <p className="text-xs">{probeMessages.iwencai}</p>}
      </section>

      {needsPython && <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-medium">可选本地扩展</h3>
        <p className="text-xs text-gray-500">需要 Python 3.10+。点击安装才会下载所选开源依赖，最长10分钟；虚拟环境、下载缓存和临时文件均放在应用的数据目录，Windows安装版随你的安装目录走，不默认装到系统 Python。</p>
        <input className={inputClass} value={pythonPath} disabled={disabled} onChange={event => setPythonPath(event.target.value)}
          placeholder="留空自动寻找 Python；也可选择本机解释器的绝对路径" />
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} disabled={disabled} onClick={() => void run('选择 Python', async () => {
            const path = await window.api.datasource.choosePython()
            if (path) setPythonPath(path)
          })}>选择解释器</button>
          <button className={buttonClass} disabled={disabled} onClick={() => void run('检查扩展', async () => {
            await save()
            const result = await window.api.datasource.bridgeStatus()
            if (!result.ok) throw new Error(result.message)
            setMessage('本地扩展：' + JSON.stringify(result.data))
          })}>检查依赖</button>
          <button className={buttonClass} disabled={disabled} onClick={() => void run('安装扩展', async () => {
            await save()
            const result = await window.api.datasource.installExtensions()
            if (!result.ok) throw new Error(result.message)
            setPythonPath(result.pythonPath)
            setMessage(result.message)
          })}>安装所选扩展</button>
          <button className={buttonClass} disabled={disabled} onClick={() => void window.api.datasource.openSourceLink('https://www.python.org/downloads/')}>Python 官网</button>
          {wencai && <button className={buttonClass} disabled={disabled} onClick={() => void window.api.datasource.openSourceLink('https://nodejs.org/en/download')}>Node.js 官网</button>}
        </div>
      </section>}

      <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-medium">取数体验</h3>
        <p className="text-xs text-gray-500">连接检测会拉取并缓存公开样本，不能证明所有股票、所有字段或实时接口都可用。</p>
        <div className="flex flex-wrap gap-2">
          <input aria-label="测试股票代码" className={inputClass + ' max-w-40'} value={stockCode} maxLength={6}
            disabled={disabled} onChange={event => setStockCode(event.target.value.replace(/\D/g, ''))} />
          <button className={buttonClass} disabled={disabled || daily.length === 0} onClick={() => void run('读取日线', async () => {
            await save()
            const result = await window.api.datasource.refreshStock(stockCode)
            if (!result.ok) throw new Error('行情未完成取数，请检测所选来源的连接。')
            setMessage(result.message)
          })}>按优先级读取日线</button>
          <button className={buttonClass} disabled={disabled || reports.length === 0} onClick={() => void run('查询研报', async () => {
            await save()
            const result = await window.api.datasource.reports(stockCode)
            if (!result.ok) throw new Error(result.message)
            setReportResult(result)
          })}>查询研报</button>
        </div>
        {reportResult && <div className="space-y-2 text-xs">
          {reportResult.statuses.map(status => <p key={status.provider}>{status.provider}：{status.message}</p>)}
          {reportResult.reports.length === 0 && <p>没有取得研报索引。</p>}
          {reportResult.reports.map(report => <div key={report.id} className="border-t border-gray-100 dark:border-gray-800 pt-2">
            <p className="font-medium">{report.title}</p>
            <p className="text-gray-500 mt-1">{report.publishedAt} · {report.institution || '机构未提供'} · {report.providers.join(' / ')}</p>
            {report.pdfUrl && <button className="text-blue-600 mt-1" onClick={() => void window.api.datasource.openSourceLink(report.pdfUrl!)}>打开原文 PDF</button>}
          </div>)}
        </div>}
        {wencai && <div className="space-y-2">
          <textarea className={inputClass} value={query} maxLength={300} disabled={disabled} rows={2}
            onChange={event => setQuery(event.target.value)} placeholder="输入问财选股条件，例如：沪深A股，市值大于100亿" />
          <button className={buttonClass} disabled={disabled || !query.trim()} onClick={() => void run('查询问财', async () => {
            await save()
            const result = await window.api.datasource.wencai(query)
            if (!result.ok) throw new Error(result.message)
            setWencaiResult(result)
          })}>查询条件（不下单）</button>
          {wencaiResult && <div className="overflow-x-auto text-xs">
            <p className="text-gray-500 mb-2">查询时点：{new Date(wencaiResult.fetchedAt).toLocaleString()}，最多50条、12列；不是全量选股结果或交易指令。</p>
            <table className="w-full text-left"><thead><tr>{wencaiResult.columns.map(column => <th key={column} className="p-2 whitespace-nowrap">{column}</th>)}</tr></thead>
              <tbody>{wencaiResult.rows.map((row, index) => <tr key={index}>{wencaiResult.columns.map(column => <td key={column} className="p-2 border-t border-gray-100 dark:border-gray-800 whitespace-nowrap">{row[column] ?? '--'}</td>)}</tr>)}</tbody>
            </table>
          </div>}
        </div>}
      </section>

      <footer className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 py-4 space-y-2">
        <button className="text-sm px-5 py-2 bg-blue-600 text-white rounded disabled:opacity-40" disabled={disabled}
          onClick={() => void run('保存配置', save)}>{busy || '保存全部数据源配置'}</button>
        {message && <p role="status" className="text-xs text-green-700 dark:text-green-400 break-all">{message}</p>}
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400 break-all">{error}</p>}
        <p className="text-xs text-gray-500">开源接口库不授予数据使用权，遵守来源平台的登录、频率、版权及使用条款。行情来源与券商交易权限、AI模型密钥互不替代。</p>
      </footer>
    </div>
  )
}
