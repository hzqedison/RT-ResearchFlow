import { useCallback, useEffect, useRef, useState } from 'react'
import { ledgerAmount, ledgerCents, ledgerMoney, type AppendLedgerEvent, type LedgerAccount, type LedgerEvent, type LedgerSnapshot } from '../../../electron/shared/accountLedger'

const inputClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900'
const buttonClass = 'rounded-md border border-cyan-600 px-3 py-2 text-sm text-cyan-700 disabled:opacity-40 dark:text-cyan-300'
const beijingInput = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16)
const issueLabels = { FEES_UNKNOWN: '费用未核对，现金及成本不能视为完整', OPENING_POSITIONS_INCOMPLETE: '期初持仓范围未完整核对', NEGATIVE_BOOK_CASH: '账面现金为负，需核对期初资金与流水', POSITION_RECONCILIATION_REQUIRED: '持仓或卖出数量需要对账', COST_BASIS_UNKNOWN: '部分成本未知' }
export function AccountLedgerPanel({ onClose }: { onClose: () => void }) {
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]), [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false)
  const [label, setLabel] = useState(''), [cash, setCash] = useState(''), [openingDate, setOpeningDate] = useState(beijingInput().slice(0, 10))
  const [openingRows, setOpeningRows] = useState<Array<{ symbol: string; quantity: string; costBasis: string }>>([])
  const [complete, setComplete] = useState(false), [cashConfirmed, setCashConfirmed] = useState(false)
  const [kind, setKind] = useState<'fill' | 'cash'>('fill'), [reference, setReference] = useState(''), [occurredAt, setOccurredAt] = useState(beijingInput())
  const [symbol, setSymbol] = useState(''), [side, setSide] = useState<'buy' | 'sell'>('buy'), [quantity, setQuantity] = useState(''), [price, setPrice] = useState('')
  const [direction, setDirection] = useState<'in' | 'out'>('in'), [amount, setAmount] = useState('')
  const [fees, setFees] = useState({ commission: '', stampDuty: '', transferFee: '', other: '' }), [feesUnknown, setFeesUnknown] = useState(false)
  const [confirmed, setConfirmed] = useState(false), [correctionOf, setCorrectionOf] = useState<string | null>(null)
  const accountId = useRef(crypto.randomUUID()), eventId = useRef(crypto.randomUUID()), pending = useRef<AppendLedgerEvent | null>(null)
  const pendingCreate = useRef<string | null>(null)
  const load = useCallback(async (selected?: string) => {
    setBusy(true)
    try {
      const list = await window.api.accountLedger.list()
      if (!list.ok) { setError(list.message); return }
      setAccounts(list.data)
      const id = selected ?? list.data[0]?.id
      if (id) { const result = await window.api.accountLedger.get(id); if (result.ok) setSnapshot(result.data); else setError(result.message) }
    } catch { setError('账本读取失败，请检查本地数据库。') } finally { setBusy(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  async function create() {
    setBusy(true); setError('')
    pendingCreate.current = accountId.current
    try {
      const result = await window.api.accountLedger.create({ accountId: accountId.current, label, openingCash: cash,
        openingAt: Date.parse(`${openingDate}T00:00:00+08:00`), openingPositions: openingRows.map(p => ({ symbol: p.symbol.trim().toUpperCase(), quantity: Number(p.quantity), costBasis: p.costBasis.trim() || null })),
        openingPositionsComplete: complete, cashConfirmed: cashConfirmed as true })
      if (!result.ok) { pendingCreate.current = null; setError(result.message); return }
      pendingCreate.current = null
      setSnapshot(result.data); accountId.current = crypto.randomUUID(); setCash(''); setLabel(''); setOpeningRows([]); setCashConfirmed(false)
      const list = await window.api.accountLedger.list(); if (list.ok) setAccounts(list.data)
    } catch { setUncertain(true); setError('开账结果未确认，请先核对刚才保存；同一开账编号不会重复创建。') } finally { setBusy(false) }
  }
  function resetSavedDraft() { eventId.current = crypto.randomUUID(); pending.current = null; setReference(''); setConfirmed(false); setCorrectionOf(null); setUncertain(false) }
  async function save(event: LedgerEvent) {
    if (!snapshot || uncertain) return
    const command = { accountId: snapshot.account.id, eventId: eventId.current, expectedRevision: snapshot.account.revision, event }
    pending.current = command; setBusy(true); setError('')
    try {
      const result = await window.api.accountLedger.append(command)
      if (!result.ok) { setError(result.message); return }
      setSnapshot(result.data); resetSavedDraft()
    } catch { setUncertain(true); setError('保存结果未确认。先核对刚才的保存，不要另建编号重复录入。') } finally { setBusy(false) }
  }
  async function checkPending() {
    if (pendingCreate.current) {
      setBusy(true)
      try {
        const list = await window.api.accountLedger.list()
        if (!list.ok) { setError(list.message); return }
        setAccounts(list.data)
        const found = list.data.find(a => a.id === pendingCreate.current)
        if (found) {
          const state = await window.api.accountLedger.get(found.id)
          if (!state.ok) { setError(state.message); return }
          setSnapshot(state.data); accountId.current = crypto.randomUUID(); setCash(''); setLabel(''); setOpeningRows([]); setCashConfirmed(false)
        }
        pendingCreate.current = null; setUncertain(false)
        setError(found ? '该账户已经保存，未再次写入。' : '当前没有该开账记录，可用原编号再次手动保存；不会自动重试。')
      } catch { setError('核对未完成，继续保留重复写入保护。') } finally { setBusy(false) }
      return
    }
    if (!pending.current) return
    setBusy(true)
    try {
      const result = await window.api.accountLedger.findEvent(pending.current.accountId, pending.current.eventId)
      if (!result.ok) { setError(result.message); return }
      const state = await window.api.accountLedger.get(pending.current.accountId)
      if (!state.ok) { setError(state.message); return }
      setSnapshot(state.data)
      if (result.data) { resetSavedDraft(); setError('该记录已经保存，未再次写入。') }
      else { setUncertain(false); setError('当前没有这条保存记录，可用原编号再次手动保存；不会自动重试。') }
    } catch { setError('核对未完成，继续保留重复写入保护。') } finally { setBusy(false) }
  }
  const disabled = busy || uncertain
  const corrections = snapshot?.records.filter(r => r.event.kind === kind && snapshot.reversedIds.includes(r.id)) ?? []
  const gross = ledgerMoney(price) && /^[1-9]\d{0,9}$/.test(quantity) && Number(quantity) <= 1000000000 ? ledgerAmount(ledgerCents(ledgerMoney(price)!) * BigInt(quantity)) : '待填写'
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-2 sm:p-6">
    <section role="dialog" aria-modal="true" aria-label="账户账本" data-testid="account-ledger-panel" className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-slate-50 text-slate-900 shadow-xl dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800"><div><h2 className="text-lg font-semibold">账户账本</h2><p className="mt-1 text-xs text-slate-500">本机核对记录，不是券商实时账户。账面现金不等于可用或可取资金；成交记录不触发下单。</p></div><button type="button" aria-label="关闭账户账本" disabled={busy} onClick={onClose} className={buttonClass}>关闭</button></header>
      <div className="space-y-5 overflow-y-auto p-5">
        {error && <p role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
        <div className="flex flex-wrap gap-3"><label className="min-w-48 flex-1 text-sm">账户别名<select aria-label="选择账户账本" value={snapshot?.account.id ?? ''} disabled={disabled} onChange={e => { resetSavedDraft(); void load(e.target.value) }} className={inputClass}><option value="">选择本地账户</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label><button type="button" disabled={busy} onClick={() => { void load(snapshot?.account.id) }} className={buttonClass}>刷新账本</button>{uncertain && <button type="button" disabled={busy} onClick={() => { void checkPending() }} className={buttonClass}>核对刚才保存</button>}</div>
        <details open={!accounts.length} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><summary className="cursor-pointer text-sm font-semibold">新建本地账户与期初事实</summary><fieldset disabled={disabled} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">账户别名<input aria-label="新账户别名" value={label} onChange={e => setLabel(e.target.value)} className={inputClass} maxLength={40} placeholder="使用别名，不填真实账号" /></label><label className="text-sm">期初现金（元）<input aria-label="期初现金" value={cash} onChange={e => setCash(e.target.value)} className={inputClass} placeholder="请填写核对后的金额" /></label><label className="text-sm">期初日（北京时间零点）<input aria-label="期初日期" type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} className={inputClass} /></label></div>
          {openingRows.map((row, index) => <div key={index} className="grid gap-2 sm:grid-cols-4">{(['symbol', 'quantity', 'costBasis'] as const).map((key, k) => <input key={key} aria-label={`${['期初证券', '期初数量', '期初成本金额'][k]} ${index + 1}`} value={row[key]} placeholder={['600001.SH', '持股数量', '成本金额，未知留空'][k]} onChange={e => setOpeningRows(old => old.map((p, i) => i === index ? { ...p, [key]: e.target.value } : p))} className={inputClass} />)}<button type="button" onClick={() => setOpeningRows(old => old.filter((_, i) => i !== index))} className={buttonClass}>移除期初行</button></div>)}
          <button type="button" disabled={openingRows.length >= 200} onClick={() => setOpeningRows(old => [...old, { symbol: '', quantity: '', costBasis: '' }])} className={buttonClass}>添加期初持仓</button>
          <label className="block text-sm"><input type="checkbox" checked={complete} onChange={e => setComplete(e.target.checked)} /> 已核对全部期初持仓（确认无持仓也须勾选）</label><label className="block text-sm"><input type="checkbox" checked={cashConfirmed} onChange={e => setCashConfirmed(e.target.checked)} /> 我已核对期初现金；这不是自动读取的券商余额</label>
          <button type="button" disabled={!cashConfirmed || !label.trim() || ledgerMoney(cash) === null} onClick={() => { void create() }} className={buttonClass}>保存期初事实</button>
        </fieldset></details>
        {snapshot && <><div className="grid gap-3 sm:grid-cols-3" data-testid="ledger-summary"><Metric title="账面现金" value={snapshot.cashBalance} /><Metric title="累计成交费用" value={snapshot.feesTotal} /><Metric title="已实现盈亏（移动平均账面口径）" value={snapshot.realizedPnl} /></div><p className="text-xs text-amber-700">券商可用资金、可卖数量及实时市值均未接入，不从本账本推断。{snapshot.issues.map(issue => issueLabels[issue]).join('；')}</p>
          <fieldset disabled={disabled} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex gap-3"><label><input type="radio" name="ledger-kind" checked={kind === 'fill'} onChange={() => { setKind('fill'); setCorrectionOf(null) }} /> 已成交明细</label><label><input type="radio" name="ledger-kind" checked={kind === 'cash'} onChange={() => { setKind('cash'); setCorrectionOf(null) }} /> 资金流水</label></div>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">成交或流水编号<input aria-label="成交或流水编号" value={reference} onChange={e => setReference(e.target.value)} className={inputClass} placeholder="从已核对明细中取得，避免重复" /></label><label className="text-sm">发生时点（北京时间）<input aria-label="记录发生时点" type="datetime-local" value={occurredAt} onChange={e => setOccurredAt(e.target.value)} className={inputClass} /></label></div>
            {kind === 'fill' ? <><div className="grid gap-3 sm:grid-cols-4"><label className="text-sm">证券代码<input aria-label="成交证券代码" value={symbol} onChange={e => setSymbol(e.target.value)} className={inputClass} placeholder="600001.SH" /></label><label className="text-sm">方向<select aria-label="成交方向" value={side} onChange={e => setSide(e.target.value as 'buy' | 'sell')} className={inputClass}><option value="buy">买入成交</option><option value="sell">卖出成交</option></select></label><label className="text-sm">实际成交数量<input aria-label="成交数量" value={quantity} onChange={e => setQuantity(e.target.value)} className={inputClass} /></label><label className="text-sm">该笔成交价<input aria-label="成交价格" value={price} onChange={e => setPrice(e.target.value)} className={inputClass} /></label></div><p className="text-xs text-slate-500">按该笔成交计算金额：{gross} 元。部分成交逐笔记账，不以委托数量代替成交数量。</p>
              <label className="block text-sm"><input type="checkbox" checked={feesUnknown} onChange={e => setFeesUnknown(e.target.checked)} /> 该笔费用尚未确认（保留未知，不填零）</label>{!feesUnknown && <div className="grid gap-3 sm:grid-cols-4">{(['commission', 'stampDuty', 'transferFee', 'other'] as const).map((key, i) => <label key={key} className="text-sm">{['佣金', '印花税', '过户费', '其他费用'][i]}<input aria-label={['佣金', '印花税', '过户费', '其他费用'][i]} value={fees[key]} onChange={e => setFees(old => ({ ...old, [key]: e.target.value }))} className={inputClass} placeholder="核对后填写，确认为零才填 0" /></label>)}</div>}</>
              : <div className="grid gap-3 sm:grid-cols-2"><label>资金方向<select aria-label="资金方向" value={direction} onChange={e => setDirection(e.target.value as 'in' | 'out')} className={inputClass}><option value="in">资金增加</option><option value="out">资金减少</option></select></label><label>已核对金额<input aria-label="资金流水金额" value={amount} onChange={e => setAmount(e.target.value)} className={inputClass} /></label></div>}
            {corrections.length > 0 && <label className="block text-sm">更正已冲销的记录<select aria-label="更正关联" value={correctionOf ?? ''} onChange={e => { const record = corrections.find(r => r.id === e.target.value); setCorrectionOf(record?.id ?? null); if (record && record.event.kind !== 'reversal') setReference(record.event.reference) }} className={inputClass}><option value="">新的独立记录</option>{corrections.map(r => <option key={r.id} value={r.id}>{r.event.kind !== 'reversal' ? r.event.reference : r.id}</option>)}</select></label>}
            <label className="block text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> 我已核对真实成交或资金明细；不是仅提交、未成交或结果未知的委托</label>
            <button type="button" disabled={!confirmed || !reference.trim()} onClick={() => { const common = { reference, occurredAt: Date.parse(`${occurredAt}:00+08:00`), correctionOf, confirmed: true as const }; void save(kind === 'fill' ? { ...common, kind, symbol: symbol.trim().toUpperCase(), side, quantity: Number(quantity), price, fees: feesUnknown ? null : fees } : { ...common, kind, direction, amount }) }} className={buttonClass}>保存核对记录</button>
          </fieldset>
          <section><h3 className="mb-2 text-sm font-semibold">账面持仓数量与成本</h3><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>证券</th><th>账面数量</th><th>开账后净变化</th><th>成本金额</th></tr></thead><tbody>{snapshot.positions.map(p => <tr key={p.symbol} className="border-t border-slate-200 dark:border-slate-800"><td className="py-2">{p.symbol}</td><td>{p.quantity ?? '未知'}</td><td>{p.quantityDelta}</td><td>{p.costBasis ?? '未知'}</td></tr>)}</tbody></table></div></section>
          <section><h3 className="mb-2 text-sm font-semibold">最近记录 · 累计 {snapshot.totalRecords} 条</h3><p className="mb-2 text-xs text-slate-500">展示最近 100 条，全部事实参加核算。更正先显式冲销，再关联原记录重新录入；原记录不会被删除。</p><div className="space-y-2">{snapshot.records.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-3 text-xs dark:border-slate-800"><span>{r.event.kind === 'reversal' ? `冲销：${r.event.reason}` : `${r.event.kind === 'fill' ? `${r.event.symbol} ${r.event.side === 'buy' ? '买入' : '卖出'} ${r.event.quantity}` : `资金${r.event.direction === 'in' ? '增加' : '减少'} ${r.event.amount}`} · ${r.event.reference}`} {snapshot.reversedIds.includes(r.id) ? '（已冲销）' : ''}</span>{r.event.kind !== 'reversal' && !snapshot.reversedIds.includes(r.id) && <button type="button" disabled={disabled} className={buttonClass} onClick={() => { if (window.confirm('仅冲销本地账本记录，不撤销券商成交。原记录保留；是否继续？')) void save({ kind: 'reversal', targetEventId: r.id, reason: '本人核对后更正本地账本', confirmed: true }) }}>冲销本地记录</button>}</div>)}</div></section>
        </>}
      </div>
    </section>
  </div>
}
function Metric({ title, value }: { title: string; value: string | null }) { return <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-xs text-slate-500">{title}</p><p className="mt-2 text-xl font-semibold tabular-nums">{value ?? '未核验'}</p></div> }
