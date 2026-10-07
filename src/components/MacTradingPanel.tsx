import { useState } from 'react'
import { safeMacThsDiagnostic, type MacThsConfirmation, type MacThsMode, type MacThsRequest, type MacThsResult } from '../../electron/shared/macThsTypes'
import { AppConfirmDialog } from './shared/AppConfirmDialog'
import './MacTradingPanel.css'

const MESSAGES: Record<string, string> = {
  READY: '同花顺交易表单已识别；这不代表券商权限或成交已验证。',
  MAC_REQUIRED: '此桥接只运行在 Mac 本机。',
  CLIENT_NOT_RUNNING: '请先启动同花顺，并手动打开交易页面。',
  ACCESSIBILITY_REQUIRED: '尚未取得辅助功能权限；点击申请权限后，在系统设置中允许本应用。',
  AUTOMATION_DENIED: '系统未允许控制同花顺/System Events，请检查隐私与安全性中的自动化权限。',
  TRADE_VIEW_REQUIRED: '未识别交易页面，或同花顺有未关闭的确认弹窗。请手动打开交易页面后重试连接检查。',
  MODE_UNVERIFIED: '无法可靠确认当前是模拟还是实盘，已停止操作。请导出此状态，不能盲目绕过。',
  LAYOUT_UNSUPPORTED: '当前同花顺控件布局与参考脚本不一致，需要适配该版本。',
  BROKER_UNVERIFIED: '实盘预览未识别到中信证券标记，没有填写订单。',
  INVALID_ORDER: '参数不合格：仅普通 A 股主板、正数限价，买入数量为 100 的倍数；请填写足够的单笔额度上限。',
  BUSY: '已有本机操作进行中，请等待其结束。',
  JOURNAL_UNAVAILABLE: '本地操作保护记录不可用，已停止交易实验。',
  UNKNOWN_PENDING: '上次模拟操作结果不明，请先到同花顺核对，不要重复下单。',
  DUPLICATE_REQUEST: '已处理过此请求，不会重发。',
  USER_CANCELLED: '你已取消本次操作。',
  READBACK_MISMATCH: '代码、价格或数量回读不一致，没有继续提交。',
  SIMULATION_ACCEPTED: '发现新增模拟委托编号。委托受理不等于已成交，请在同花顺核对。',
  SIMULATION_CANCELLED: '模拟撤单已核对。',
  FORM_READY: '已填写并回读表单，尚未发送订单。',
  VIEW_OPENED: '已打开同花顺对应页面，请在本机查看委托/成交内容；不采集或导出账户表格。',
  TABLE_UNSUPPORTED: '委托表头或编号无法识别，已停止提交/撤单。',
  RECEIPT_UNKNOWN: '操作可能已经送出，但尚未核对到明确回报。已锁住重复提交，请先在同花顺核对。',
  CANCEL_CONTROL_UNSUPPORTED: '当前版本没有识别到单笔撤单控件，不会使用全撤或盲目双击。',
  CONFIRMATION_UNRECOGNIZED: '确认弹窗内容未通过核对；可能已经送出，请先核对，不要重试。',
  SCRIPT_ERROR: '本机脚本未完成；导出状态即可，不需要原始日志。',
  PERMISSION_PROMPTED: '已向系统申请权限。允许后重新检查连接；不需要完全磁盘访问权限。',
  STATE_RESOLVED: '已解除结果不明保护；原请求不会自动重发，也不代表已成交。',
  CONFIRMATION_REQUIRED: '请核对本次操作，只有点击确认才会继续。',
  CONFIRMATION_EXPIRED: '本次确认已过期或参数已改变，没有执行。请重新发起并核对。',
}
export default function MacTradingPanel({ confirmationHost }: { confirmationHost?: HTMLElement | null }) {
  const [mode, setMode] = useState<MacThsMode>('simulation')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [symbol, setSymbol] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('100')
  const [maxNotional, setMaxNotional] = useState('')
  const [contractNo, setContractNo] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MacThsResult | null>(null)
  const [notice, setNotice] = useState('')
  const [confirmation, setConfirmation] = useState<{ request: MacThsRequest; review: MacThsConfirmation } | null>(null)
  async function executeRequest(request: MacThsRequest) {
    setBusy(true)
    setNotice('')
    try {
      const response = await window.api.macThs.execute(request)
      setResult(response)
      if (response.code === 'CONFIRMATION_REQUIRED' && response.confirmation) {
        setConfirmation({ request, review: response.confirmation })
      } else {
        setConfirmation(null)
        if (response.contractNo) setContractNo(response.contractNo)
      }
    } catch {
      setConfirmation(null)
      setNotice('本机桥接调用失败；没有自动重试，请先检查客户端状态。')
    } finally { setBusy(false) }
  }
  async function run(action: MacThsRequest['action']) {
    const order = { requestId: crypto.randomUUID(), mode, side, symbol, price, quantity: Number(quantity), maxNotional }
    await executeRequest({ action, mode, order, requestId: crypto.randomUUID(), contractNo: contractNo.trim() })
  }
  function cancelReview() {
    setConfirmation(null)
    setResult(previous => previous ? { ...previous, code: 'USER_CANCELLED', outcome: 'blocked', confirmation: undefined } : previous)
  }
  function exportResult() {
    const data = safeMacThsDiagnostic(result)
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'RT-ResearchFlow-mac-ths-test-result-v1.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('请选择保存位置。文件只含预览中的状态字段，没有账号、资金、委托编号或订单参数，也不自动上传。')
  }
  return <div className="mt-panel" data-testid="mac-trading-panel">
    <h3>同花顺交易实验版</h3>
    <p>参考开源 Mac AppleScript 方案，不是券商官方 API。请先手动登录同花顺并打开交易页面；本应用不处理登录密码。</p>
    <div className="mt-warning">先测同花顺模拟账户闭环。实盘仅支持表单预览，不发送、不自动确认、不无人值守。所有原数据源继续保留。</div>
    <div className="mt-actions">
      <button type="button" disabled={busy} data-testid="mac-ths-probe" onClick={() => void run('probe')}>检查同花顺连接</button>
      <button type="button" data-testid="mac-ths-authorize" disabled={busy} onClick={() => void run('authorize')}>申请系统控制权限</button>
    </div>
    <div className="mt-form">
      <label>测试模式<select value={mode} disabled={busy} onChange={event => setMode(event.target.value as MacThsMode)}>
        <option value="simulation">同花顺模拟账户</option><option value="livePreview">中信实盘表单预览（不发送）</option>
      </select></label>
      <label>方向<select value={side} disabled={busy} onChange={event => setSide(event.target.value as 'buy' | 'sell')}>
        <option value="buy">买入</option><option value="sell">卖出</option>
      </select></label>
      <label>普通主板代码<input value={symbol} inputMode="numeric" maxLength={6} disabled={busy} onChange={event => setSymbol(event.target.value)} placeholder="自行选择测试标的" /></label>
      <label>限价<input value={price} inputMode="decimal" disabled={busy} onChange={event => setPrice(event.target.value)} placeholder="自行填写限价" /></label>
      <label>数量<input value={quantity} inputMode="numeric" disabled={busy} onChange={event => setQuantity(event.target.value)} /></label>
      <label>本次金额上限<input value={maxNotional} inputMode="decimal" disabled={busy} onChange={event => setMaxNotional(event.target.value)} placeholder="由你明确设置" /></label>
    </div>
    <div className="mt-actions">
      <button type="button" disabled={busy} onClick={() => void run('preview')}>填写表单并回读（不提交）</button>
      <button type="button" data-testid="mac-ths-submit-simulation" disabled={busy || mode !== 'simulation' || result?.unknownPending} onClick={() => void run('submitSimulation')}>提交一笔模拟委托</button>
      <button type="button" disabled={busy} onClick={() => void run('queryOrders')}>在同花顺查看委托</button>
      <button type="button" disabled={busy} onClick={() => void run('queryDeals')}>在同花顺查看成交</button>
    </div>
    <div className="mt-cancel">
      <label>模拟委托编号<input value={contractNo} disabled={busy} onChange={event => setContractNo(event.target.value)} placeholder="仅在本机使用，不导出" /></label>
      <button type="button" disabled={busy || mode !== 'simulation' || !contractNo || result?.unknownPending} onClick={() => void run('cancelSimulation')}>尝试撤销这笔模拟委托</button>
    </div>
    {result?.unknownPending && <button type="button" disabled={busy} onClick={() => void run('resolveUnknown')}>已到同花顺核对结果，解除保护</button>}
    <div className="mt-status" data-testid="mac-ths-status" role="status">{busy ? '正在本机执行，请勿操作同花顺或再次点击…' : result ? MESSAGES[result.code] : '还未运行本机连接测试。'}{notice && <p>{notice}</p>}</div>
    <details open><summary>可分享的去敏测试结果</summary><pre data-testid="mac-ths-diagnostic">{JSON.stringify(safeMacThsDiagnostic(result), null, 2)}</pre></details>
    <button type="button" data-testid="mac-ths-export" disabled={!result || busy} onClick={exportResult}>导出去敏测试结果</button>
    <p className="mt-small">未识别模式、控件或回报时停止，不绕过权限、不申请完全磁盘访问、不自动重试。券商开通/报告要求仍需本人核实。此版不支持科创板、创业板、ETF、转债或资金转账。</p>
    <a href="https://github.com/zetatez/evolving" target="_blank" rel="noopener noreferrer">查看参考开源项目</a>
    <AppConfirmDialog
      open={!!confirmation}
      title={confirmation?.review.title ?? ''}
      message={<span style={{ whiteSpace: 'pre-line' }}>{confirmation?.review.message}</span>}
      tone="warning"
      statusLabel="本次操作需确认"
      confirmLabel={confirmation?.review.confirmLabel}
      busy={busy}
      testId="mac-ths-confirmation"
      portalContainer={confirmationHost}
      onCancel={cancelReview}
      onConfirm={() => {
        if (confirmation) void executeRequest({ ...confirmation.request, confirmationToken: confirmation.review.token })
      }}
    />
  </div>
}
