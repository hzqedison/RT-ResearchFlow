import { useEffect, useRef, useState } from 'react'
import {
  buildQuantDiagnostic,
  normalizeQuantProgress,
  parseQuantProgress,
  QUANT_APPLICATION_REQUEST,
  QUANT_ONBOARDING_STORAGE_KEY,
  quantRuntimeFromPlatform,
  type QuantOnboardingProgress,
} from '../utils/quantTradingOnboarding'
import './QuantTradingOnboarding.css'
import MacTradingPanel from './MacTradingPanel'

const STEPS = ['确认路线', '申请开通', '数据权限', '核验与反馈', '真实交易']

function readProgress() {
  try {
    return parseQuantProgress(localStorage.getItem(QUANT_ONBOARDING_STORAGE_KEY))
  } catch {
    return normalizeQuantProgress(null)
  }
}

export default function QuantTradingOnboarding({ navigationExpanded }: { navigationExpanded: boolean }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [progress, setProgress] = useState<QuantOnboardingProgress>(readProgress)
  const [notice, setNotice] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const runtime = quantRuntimeFromPlatform(typeof navigator === 'undefined' ? '' : navigator.platform)
  const diagnostic = buildQuantDiagnostic(progress, runtime)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    try {
      localStorage.setItem(QUANT_ONBOARDING_STORAGE_KEY, JSON.stringify(normalizeQuantProgress(progress)))
    } catch {
      setNotice('当前环境无法保存引导进度，仍可查看步骤和导出诊断。')
    }
  }, [progress])

  async function copyRequest() {
    try {
      await navigator.clipboard.writeText(QUANT_APPLICATION_REQUEST)
      setNotice('咨询内容已复制，请通过中信或同花顺官方渠道发送。')
    } catch {
      setNotice('未能自动复制，可以直接选中下方咨询内容。')
    }
  }

  function exportDiagnostic() {
    const blob = new Blob([JSON.stringify(diagnostic, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'RT-ResearchFlow-quant-diagnostic-v1.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('请在保存窗口选择位置。文件只含下方预览的字段，不会自动上传。')
  }

  return <>
    <button type="button" className={`qt-entry electron-no-drag app-primary-nav-button group relative flex h-11 shrink-0 items-center rounded-sm border border-transparent text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-1 motion-reduce:transition-none dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-cyan-200 dark:focus:ring-cyan-300 ${navigationExpanded ? 'w-full justify-start gap-3 px-3' : 'w-11 justify-center'}`} data-testid="quant-onboarding-open"
      aria-label="量化开通" title="量化开通" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3" />
      </svg>
      {navigationExpanded && <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">量化开通</span>}
    </button>
    <dialog ref={dialogRef} className="qt-dialog electron-no-drag" aria-labelledby="quant-onboarding-title"
      onCancel={(event) => { event.preventDefault(); setOpen(false) }} onClose={() => setOpen(false)}
      onClick={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <div className="qt-shell">
        <header className="qt-header">
          <div><p className="qt-eyebrow">{runtime === 'macos' ? 'MAC 本机 / 同花顺 / 中信证券' : '本机投研 / AI / 交易兼容说明'}</p><h2 id="quant-onboarding-title">量化交易开通引导</h2></div>
          <button type="button" className="qt-close" aria-label="关闭量化开通引导" onClick={() => setOpen(false)}>关闭</button>
        </header>
        <div className="qt-layout">
          <nav className="qt-steps" aria-label="开通步骤">
            {STEPS.map((title, index) => <button type="button" key={title} aria-current={step === index ? 'step' : undefined}
              data-testid={`quant-onboarding-step-${index}`} onClick={() => { setStep(index); setNotice('') }}>
              <span className="qt-step-number">0{index + 1}</span><span>{title}</span>
            </button>)}
            <p className="qt-rail-note">先开通，再核验。<br />用户登记不等于交易授权。</p>
          </nav>
          <section className="qt-content" aria-label={STEPS[step]}>
            {step === 0 && <>
              <h3>先确认你需要的不是普通交易登录</h3>
              <p>能在同花顺手动买卖，不代表外部程序可以自动下单。需要中信与同花顺明确确认 Mac 本机的接入方式和权限。</p>
              <div className="qt-callout"><strong>这一条路线不会变</strong><p>只使用 Mac 本机，通过同花顺完成交易。不使用 Windows 后台，也不改为其他软件替你下单。</p></div>
              {runtime !== 'macos' && <p className="qt-warning">Windows 等非 Mac 环境已同步投研、AI 和开通引导；当前同花顺交易执行桥接仅适用于 Mac，不能在这里启用真实交易。</p>}
              <p>量化交易已作为同一产品的内置模块，采用 Mac 同花顺桌面桥接。不是券商官方 API；真实交易需在“真实交易”页显式启用，并由本人逐笔系统确认。先核实权限和客户端兼容性，不进行无人值守。</p>
              <button type="button" className="qt-primary" onClick={() => setStep(1)}>查看开通步骤</button>
            </>}
            {step === 1 && <>
              <h3>通过官方渠道申请，不先盲目付费</h3>
              <ol className="qt-checklist">
                <li>向中信实际开户营业部或 95548 核实原账户的程序化交易办理方式。</li>
                <li>向同花顺核实普通 Mac 版的受支持交易接口、账户权限与模拟环境。</li>
                <li>按官方要求办理协议、交易前报告和软件审核；取得确认后再做接入验证。</li>
              </ol>
              <p>资金门槛、费用和具体入口以官方针对该账户的答复为准。Windows 版量化产品的说明不能证明 Mac 可用。</p>
              <div className="qt-links">
                <a href="https://www.cs.ecitic.com/newsite/xxgs/jyyw_21851/" target="_blank" rel="noopener noreferrer">中信官方协议</a>
                <a href="https://download.10jqka.com.cn/free/mac" target="_blank" rel="noopener noreferrer">同花顺 Mac 官网</a>
              </div>
              <div className="qt-request"><pre>{QUANT_APPLICATION_REQUEST}</pre><button type="button" className="qt-secondary" onClick={() => void copyRequest()}>复制咨询内容</button></div>
              <div className="qt-actions">
                <button type="button" className="qt-secondary" data-testid="quant-application-reported"
                  onClick={() => { setProgress((value) => ({ ...value, applicationRequested: true })); setNotice('已登记申请进度，未核验实际账户权限。') }}>
                  {progress.applicationRequested ? '申请已登记' : '我已向官方申请'}
                </button>
                <button type="button" className="qt-secondary" data-testid="quant-official-reply-reported" disabled={!progress.applicationRequested}
                  onClick={() => { setProgress((value) => ({ ...value, officialReplyReceived: true })); setNotice('已登记收到官方回复，仍需核验 Mac 接口和交易权限，不会自动解锁下单。') }}>
                  {progress.officialReplyReceived ? '回复已登记，待核验' : '我已收到官方开通回复'}
                </button>
              </div>
            </>}
            {step === 2 && <>
              <h3>交易权限与数据权限分别核实</h3>
              <p>免费同花顺 Mac 客户端不等于自带完整数据接口。iFinD 支持 Mac 使用 HTTP 取数，但这是数据服务，不是下单接口。</p>
              <div className="qt-callout"><strong>先保留现有数据源</strong><p>拿到合法可用的数据后，按字段、历史范围和更新频率逐项替换。大模型服务密钥也不会被交易账号替代。</p></div>
              <a href="https://quantapi.10jqka.com.cn/gwstatic/static/ds_web/quantapi-web/help-center/faq.html" target="_blank" rel="noopener noreferrer">查看同花顺官方数据权限说明</a>
              <label className="qt-checkbox"><input type="checkbox" data-testid="quant-data-permission-acknowledged"
                checked={progress.dataPermissionAcknowledged} onChange={(event) => setProgress((value) => ({ ...value, dataPermissionAcknowledged: event.target.checked }))} />
                我理解数据权限和交易权限需要分别核实
              </label>
            </>}
            {step === 3 && <>
              <h3>本地运行，只反馈脱敏结果</h3>
              <div className="qt-callout" data-testid="quant-connection-status"><strong>待接口核验，开通登记不等于实盘授权</strong><p>本页只记录开通进度，不是连接检测，也不会解锁下单。请到“真实交易”页检查桌面桥接、明确启用本次会话，并导出去敏运行结果。</p></div>
              <p>对方只需发送导出的诊断文件。它不包含姓名、资金账号、密码、Token、余额、持仓、订单、文件路径或原始日志，也不会自动上传。</p>
              <details className="qt-diagnostic" open><summary>诊断文件预览</summary><pre data-testid="quant-diagnostic-preview">{JSON.stringify(diagnostic, null, 2)}</pre></details>
              <div className="qt-actions">
                <button type="button" className="qt-primary" data-testid="quant-diagnostic-export" onClick={exportDiagnostic}>导出脱敏诊断</button>
                <button type="button" className="qt-secondary" data-testid="quant-trading-disabled" disabled>本页不授权交易</button>
              </div>
              <p className="qt-small">此文件只反映开通登记；实际桥接测试结果请在“真实交易”页导出。开发迭代不需要账户密码或远程控制。</p>
            </>}
            {step === 4 && <MacTradingPanel confirmationHost={dialogRef.current} />}
          </section>
        </div>
        <footer className="qt-footer">
          <p role="status">{notice || '引导进度仅保存在本机。不收集交易凭证，不自动上传。'}</p>
          <button type="button" className="qt-reset" onClick={() => { setProgress(normalizeQuantProgress(null)); setNotice('仅清除了本地引导标记，不改变券商账户权限。') }}>重置引导</button>
        </footer>
      </div>
    </dialog>
  </>
}
