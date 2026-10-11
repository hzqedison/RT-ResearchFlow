import { useEffect, useState } from 'react'
import type { StrategyLabStrategyDetail } from '../../../../electron/main/services/strategyLabService'
import { PUBLIC_LIMIT_UP_RULES, type PublicLimitUpRuleId } from '../../../../electron/shared/publicLimitUpRules'
import { publicLimitUpRuleDescription } from '../../../../electron/shared/publicLimitUpStrategy'

interface Props {
  strategy: StrategyLabStrategyDetail
  onSaved?: (strategy: StrategyLabStrategyDetail, runAfterSave: boolean) => void | Promise<void>
  onClose?: () => void
  onDirtyChange?: (dirty: boolean) => void
}

export function PublicLimitUpStrategyEditor({ strategy, onSaved, onClose, onDirtyChange }: Props): JSX.Element {
  const [name, setName] = useState(strategy.isBuiltin ? `${strategy.name} 副本` : strategy.name)
  const [ruleId, setRuleId] = useState<PublicLimitUpRuleId>(strategy.ruleDraft.publicLimitUpProfile!.ruleId)
  const [date, setDate] = useState(strategy.runConfig.dateEnd ?? strategy.runConfig.dateStart ?? '')
  const [excludeST, setExcludeST] = useState(strategy.ruleDraft.stockPool.excludeST)
  const [excludeBJ, setExcludeBJ] = useState(strategy.ruleDraft.stockPool.excludeBJ)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<number | undefined>(strategy.isBuiltin ? undefined : strategy.id)
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  const change = (update: () => void) => { update(); setDirty(true); setMessage('') }
  const valid = name.trim().length > 0 && (!date || /^\d{8}$/.test(date))
  const save = async (runAfterSave: boolean) => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const res = await window.api.strategyLab.saveStrategy({
        id: editingId, name: name.trim(), description: publicLimitUpRuleDescription(ruleId), source: 'custom',
        status: runAfterSave ? 'ready' : 'draft', enabled: true,
        ruleDraft: { schemaVersion: 1, source: 'custom', stockPool: { sources: [], manualTsCodes: [], excludeST, excludeBJ },
          publicLimitUpProfile: { ...strategy.ruleDraft.publicLimitUpProfile!, ruleId }, scoring: { minScore: 0, weights: {} } },
        runConfig: { ...strategy.runConfig, scanMode: 'complete', lookbackDays: 1, autoFetchMinuteLimit: 0, dateStart: date || null, dateEnd: date || null },
        actions: { aiInsight: true, addToTrendWatchlist: true, monitorChips: false, createBacktest: false },
      })
      if (!res.ok) { setMessage(res.error); return }
      setEditingId(res.strategy.id)
      setDirty(false)
      setMessage('免费策略已保存。')
      await onSaved?.(res.strategy, runAfterSave)
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败，请重试。') }
    finally { setSaving(false) }
  }
  return <section data-testid="public-limit-strategy-editor" className="space-y-5 p-5 text-sm text-slate-700 dark:text-slate-200">
    <div className="rounded-md border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-900 dark:bg-cyan-950/30">
      <h3 className="font-semibold">免费盘后涨停规则</h3>
      <p className="mt-2 leading-6">先在配置中心 → 数据源同步免费涨停池，再运行这里的模板。无需 Tushare Key、Python 或分钟数据；仅处理一个已核验缓存日期。</p>
      <p className="mt-2 leading-6">保存命中条件和来源，可查看运行记录及走势图。不会生成竞价、筹码、全市场排名或历史收益回测，也不会提交交易。</p>
    </div>
    <label className="block">策略名称<input className="mt-1 h-11 w-full rounded border bg-transparent px-3" value={name} onChange={e => change(() => setName(e.target.value))} /></label>
    <label className="block">规则模板<select className="mt-1 h-11 w-full rounded border bg-white px-3 dark:bg-slate-900" value={ruleId} onChange={e => change(() => setRuleId(e.target.value as PublicLimitUpRuleId))}>
      {(Object.keys(PUBLIC_LIMIT_UP_RULES) as PublicLimitUpRuleId[]).map(id => <option key={id} value={id}>{PUBLIC_LIMIT_UP_RULES[id].label}</option>)}
    </select></label>
    <p className="rounded border p-3 leading-6">{publicLimitUpRuleDescription(ruleId)}命中表示这些条件通过，不是收益概率或买卖建议。</p>
    <label className="block">缓存交易日（留空使用当前缓存）<input inputMode="numeric" placeholder="YYYYMMDD" className="mt-1 h-11 w-full rounded border bg-transparent px-3" value={date} onChange={e => change(() => setDate(e.target.value.replace(/\D/g, '').slice(0, 8)))} /></label>
    <div className="flex flex-wrap gap-5">
      <label><input type="checkbox" checked={excludeST} onChange={e => change(() => setExcludeST(e.target.checked))} /> 排除 ST（名称缺失也不入选）</label>
      <label><input type="checkbox" checked={excludeBJ} onChange={e => change(() => setExcludeBJ(e.target.checked))} /> 排除北交所</label>
    </div>
    {message && <p role="status">{message}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      {onClose && <button className="min-h-11 rounded border px-4" onClick={onClose}>关闭配置</button>}
      <button className="min-h-11 rounded border px-4 disabled:opacity-40" disabled={!valid || saving} onClick={() => void save(false)}>保存草稿</button>
      <button className="min-h-11 rounded bg-teal-700 px-4 text-white disabled:opacity-40" disabled={!valid || saving} onClick={() => void save(true)}>{saving ? '保存中...' : '保存并运行'}</button>
    </div>
  </section>
}
