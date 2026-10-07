import { useState } from 'react'
import { safeMacThsDiagnostic, validateMacThsOrder, type MacThsMode, type MacThsConfirmation,
  type MacThsRequest, type MacThsResult } from '../../electron/shared/macThsTypes'
import { AppConfirmDialog } from './shared/AppConfirmDialog'
import './MacTradingPanel.css'

const MESSAGES: Record<string, string> = {
  READY: '已识别同花顺 A 股交易表单和中信证券标记；这不代表账户权限或实际成交已经验证。',
  MAC_REQUIRED: '此交易模块只在 Mac 本机运行。',
  CLIENT_NOT_RUNNING: '请先启动同花顺，本人登录并打开中信交易页面。',
  ACCESSIBILITY_REQUIRED: '尚未取得辅助功能权限；申请后在系统设置中允许本应用。',
  AUTOMATION_DENIED: '系统未允许控制同花顺/System Events，请检查自动化权限。',
  TRADE_VIEW_REQUIRED: '没有识别交易页面，或同花顺有未处理弹窗。请在同花顺本人确认或取消弹窗后核对。',
  MODE_UNVERIFIED: '无法可靠确认 A 股真实账户模式，已停止操作。',
  LAYOUT_UNSUPPORTED: '当前同花顺表单布局尚未兼容，请导出去敏结果进行适配。',
  BROKER_UNVERIFIED: '未可靠识别当前中信证券账户标记，或操作期间账户发生变化，已停止。',
  INVALID_ORDER: '参数不合格：仅普通 A 股主板、正数限价；买入为 100 股的倍数，委托金额不能超过上限。',
  BUSY: '已有本机操作进行中，请等待，不要切换账户或操作同花顺。',
  JOURNAL_UNAVAILABLE: '本地防重复记录不可用，已停止交易。',
  UNKNOWN_PENDING: '上次真实操作结果尚未核对，不能再提交。请先查看同花顺的委托、成交及确认弹窗。',
  DUPLICATE_REQUEST: '此请求已处理，不会重复发送。',
  USER_CANCELLED: '本次操作已取消，不会自动重试。',
  READBACK_MISMATCH: '代码、价格或数量回读不一致，没有继续提交。',
  FORM_READY: '已填写并回读，未点击买入/卖出提交按钮。',
  VIEW_OPENED: '已打开同花顺对应页面，请本人查看；不采集或导出账户表格。',
  TABLE_UNSUPPORTED: '无法可靠识别委托编号、代码、价格、数量或方向，已停止。',
  RECEIPT_UNKNOWN: '操作可能已经送出，但未得到明确回报。已阻止重复提交，请先在同花顺核对。',
  CANCEL_CONTROL_UNSUPPORTED: '未识别到单笔撤单控件，不使用全撤或盲目双击。',
  CONFIRMATION_UNRECOGNIZED: '确认内容未通过核对，请在同花顺检查，不要重复发送。',
  SCRIPT_ERROR: '本机操作未完成，请反馈去敏状态，不需要原始日志。',
  PERMISSION_PROMPTED: '已申请系统权限。允许后重新检查连接，不需要完全磁盘访问权限。',
  STATE_RESOLVED: '已解除结果不明保护；未自动重发，也不表示成交成功。',
  CONFIRMATION_REQUIRED: '请核对本次操作，取消不会执行。',
  CONFIRMATION_EXPIRED: '确认已过期或参数发生变化，没有执行。',
  LIVE_ENABLED: '本次会话已启用本人确认的中信真实交易；每笔买卖或撤单仍需要系统确认。',
  LIVE_DISABLED: '本次会话真实交易已关闭，仍可查看页面及预览表单。',
  LIVE_NOT_ENABLED: '请先核实账户权限、检查连接并明确启用本次会话的真实交易。',
  LIVE_ACCEPTED: '发现唯一新增、参数匹配的真实委托编号。受理不等于成交，请在同花顺核对。',
  LIVE_CANCELLED: '该委托显示已撤/部分撤单状态；已成交部分不能撤销，请在同花顺核对。',
  NATIVE_CONFIRMATION_REQUIRED: '同花顺已打开原生确认弹窗。请到同花顺本人核对账户和全部参数后确认或取消；本应用不会替你点击，重复请求已锁住。',
  ORDER_CONTROL_DISABLED: '同花顺当前提交或撤单按钮不可用，没有继续操作。',
  SIMULATION_ACCEPTED: '旧模拟请求已受理，不表示已成交。',
  SIMULATION_CANCELLED: '旧模拟请求显示撤单状态。',
}
export default function MacTradingPanel({ confirmationHost }: { confirmationHost?: HTMLElement | null }) {
  const mode: MacThsMode = 'live'
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [symbol, setSymbol] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [maxNotional, setMaxNotional] = useState('')
  const [contractNo, setContractNo] = useState('')
  const [riskAcknowledged, setRiskAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MacThsResult | null>(null)
  const [notice, setNotice] = useState('')
  const [confirmation, setConfirmation] = useState<{ request: MacThsRequest; review: MacThsConfirmation } | null>(null)
  const liveEnabled = result?.canSubmitLiveOrders === true
  const valid = !!validateMacThsOrder({ requestId: '00000000-0000-4000-8000-000000000000',
    mode, side, symbol, price, quantity: Number(quantity), maxNotional })
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
      setNotice('本机调用未完成，没有自动重试。请先到同花顺检查，不能认为订单没有送出。')
    } finally { setBusy(false) }
  }
  async function run(action: MacThsRequest['action']) {
    const order = { requestId: crypto.randomUUID(), mode, side, symbol, price, quantity: Number(quantity), maxNotional }
    await executeRequest({ action, mode, order, requestId: crypto.randomUUID(),
      contractNo: contractNo.trim(), liveRiskAcknowledged: riskAcknowledged })
  }
  function cancelReview() {
    setConfirmation(null)
    void executeRequest({ action: 'dismissConfirmation', mode })
  }
  function exportResult() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(safeMacThsDiagnostic(result), null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'RT-ResearchFlow-mac-ths-test-result-v2.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('文件只包含状态，不含账号、资金、委托编号、订单参数、确认凭据或原始日志，不自动上传。')
  }
  return <div className="mt-panel" data-testid="mac-trading-panel">
    <h3>中信证券真实交易</h3>
    <p>通过本人 Mac 上的同花顺完成普通 A 股限价买卖，与投研功能处于同一个产品、同一个安装包。不是券商官方 API，请本人核实权限并手动登录，不提供交易密码。</p>
    <div className="mt-warning">这是真实账户，不是模拟账户。可能产生真实资金损失；每笔操作需要本人确认，不支持策略自动触发或无人值守。尚未验证你的同花顺版本与账户兼容性，先检查连接及表单回读。</div>
    <div className="mt-actions">
      <button type="button" disabled={busy} data-testid="mac-ths-probe" onClick={() => void run('probe')}>检查同花顺连接</button>
      <button type="button" disabled={busy} data-testid="mac-ths-authorize" onClick={() => void run('authorize')}>申请系统控制权限</button>
    </div>
    <div className="mt-warning">
      <label><input type="checkbox" disabled={busy} data-testid="mac-ths-live-risk-ack"
        checked={riskAcknowledged} onChange={event => {
          setRiskAcknowledged(event.target.checked)
          if (!event.target.checked && liveEnabled) void run('disableLive')
        }} /> 我已核实账户权限，在同花顺选择了正确的中信真实账户，并了解真实资金风险</label>
      <div className="mt-actions">
        <button type="button" data-testid="mac-ths-enable-live" disabled={busy || !riskAcknowledged || liveEnabled || result?.unknownPending}
          onClick={() => void run('authorizeLive')}>启用本次会话真实交易</button>
        <button type="button" data-testid="mac-ths-disable-live" disabled={busy || !liveEnabled}
          onClick={() => void run('disableLive')}>关闭本次会话真实交易</button>
      </div>
      <p className="mt-small">重启后需重新启用。勾选引导进度不会授权交易，实盘系统确认框默认取消。</p>
    </div>
    <div className="mt-form">
      <label>方向<select value={side} disabled={busy} onChange={event => setSide(event.target.value as 'buy' | 'sell')}>
        <option value="buy">买入</option><option value="sell">卖出</option>
      </select></label>
      <label>普通主板代码<input value={symbol} inputMode="numeric" maxLength={6} disabled={busy} onChange={event => setSymbol(event.target.value)} placeholder="由本人选择，不提供推荐" /></label>
      <label>限价<input value={price} inputMode="decimal" disabled={busy} onChange={event => setPrice(event.target.value)} placeholder="本人填写限价" /></label>
      <label>数量<input value={quantity} inputMode="numeric" disabled={busy} onChange={event => setQuantity(event.target.value)} placeholder="本人填写数量" /></label>
      <label>委托金额上限（不含手续费）<input value={maxNotional} inputMode="decimal" disabled={busy} onChange={event => setMaxNotional(event.target.value)} placeholder="由你明确设置" /></label>
    </div>
    <div className="mt-actions">
      <button type="button" disabled={busy || !valid} onClick={() => void run('preview')}>填写表单并回读（不提交）</button>
      <button type="button" data-testid="mac-ths-submit-live" disabled={busy || !riskAcknowledged || !liveEnabled || !valid || result?.unknownPending}
        onClick={() => void run('submitLive')}>提交真实买卖委托（本人确认）</button>
      <button type="button" disabled={busy} onClick={() => void run('queryOrders')}>在同花顺查看委托</button>
      <button type="button" disabled={busy} onClick={() => void run('queryDeals')}>在同花顺查看成交</button>
    </div>
    <div className="mt-cancel">
      <label>真实委托编号<input value={contractNo} disabled={busy} onChange={event => setContractNo(event.target.value)} placeholder="仅在本机使用，不导出" /></label>
      <button type="button" data-testid="mac-ths-cancel-live" disabled={busy || !riskAcknowledged || !liveEnabled || !/^[a-zA-Z0-9-]{1,32}$/.test(contractNo.trim()) || result?.unknownPending}
        onClick={() => void run('cancelLive')}>撤销指定真实委托（本人确认）</button>
    </div>
    {result?.unknownPending && <div className="mt-warning">
      <p>请到同花顺核对委托、成交和仍打开的确认弹窗，确认或取消均由本人完成；未核对前不要重复提交。</p>
      <button type="button" disabled={busy} onClick={() => void run('resolveUnknown')}>已本人核对结果，解除防重复保护</button>
    </div>}
    <div className="mt-status" data-testid="mac-ths-status" role="status">{busy ? '正在本机执行，请勿操作同花顺或再次点击…' : result ? MESSAGES[result.code] : '尚未检查连接，真实交易默认关闭。'}{notice && <p>{notice}</p>}</div>
    <details open><summary>可分享的去敏运行结果</summary><pre data-testid="mac-ths-diagnostic">{JSON.stringify(safeMacThsDiagnostic(result), null, 2)}</pre></details>
    <button type="button" data-testid="mac-ths-export" disabled={!result || busy} onClick={exportResult}>导出去敏运行结果</button>
    <p className="mt-small">未识别中信标记、模式、参数、表头或回报时停止，不绕过系统与券商限制，不自动重试。不支持科创板、创业板、ETF、转债、自动登录或资金转账。历史行情、财务、资讯和 AI 仍使用各自数据源。</p>
    <a href="https://github.com/zetatez/evolving" target="_blank" rel="noopener noreferrer">查看参考开源项目</a>
    <AppConfirmDialog open={!!confirmation} title={confirmation?.review.title ?? ''}
      message={<span style={{ whiteSpace: 'pre-line' }}>{confirmation?.review.message}</span>}
      tone="warning" statusLabel="本人核对后才继续" confirmLabel={confirmation?.review.confirmLabel}
      busy={busy} testId="mac-ths-confirmation" portalContainer={confirmationHost}
      onCancel={cancelReview} onConfirm={() => {
        if (confirmation) void executeRequest({ ...confirmation.request, confirmationToken: confirmation.review.token })
      }} />
  </div>
}
