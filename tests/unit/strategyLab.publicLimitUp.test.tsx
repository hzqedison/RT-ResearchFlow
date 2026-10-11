import Database from 'better-sqlite3'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicLimitPoolObservationSnapshot } from '../../electron/shared/dataSourceTypes'
import { createPublicLimitUpDraft, runPublicLimitUpStrategy, validatePublicLimitUpDraft } from '../../electron/main/services/strategyLabPublicLimitUp'
import { ensureDefaultStrategyLabStrategies, getStrategyLabStrategy, listStrategyLabStrategies, saveStrategyLabStrategy } from '../../electron/main/services/strategyLabService'
import { cancelStrategyLabRun, createBacktestFromStrategyLabRun, getStrategyLabRun, listStrategyLabMatches, runStrategyLabStrategy } from '../../electron/main/services/strategyLabRunService'
import { readVerifiedPublicLimitPool } from '../../electron/main/services/verifiedPublicLimitPoolCache'
import { StrategyRunPlan } from '../../src/components/ShortTermStrategy/StrategyLab/StrategyRunPlan'
import { StrategyResultTable } from '../../src/components/ShortTermStrategy/StrategyLab/StrategyResultTable'
import { PublicLimitUpStrategyEditor } from '../../src/components/ShortTermStrategy/StrategyLab/PublicLimitUpStrategyEditor'

vi.mock('electron', () => ({ app: { getPath: () => 'ISOLATED_UNUSED_DATA_ROOT' } }))
vi.mock('../../electron/main/services/verifiedPublicLimitPoolCache', () => ({ readVerifiedPublicLimitPool: vi.fn() }))

let db: Database.Database
let snapshot: PublicLimitPoolObservationSnapshot
const now = Date.parse('2026-10-09T08:00:00Z')

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.spyOn(Date, 'now').mockReturnValue(now)
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE strategy_lab_strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT, strategy_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      description TEXT, source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', enabled INTEGER NOT NULL DEFAULT 1,
      is_builtin INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, rule_draft_json TEXT NOT NULL,
      run_config_json TEXT NOT NULL, actions_json TEXT NOT NULL, last_run_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE strategy_lab_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, strategy_id INTEGER NOT NULL, strategy_key TEXT NOT NULL, strategy_name TEXT NOT NULL,
      source TEXT NOT NULL, status TEXT NOT NULL, date_start TEXT, date_end TEXT, run_config_json TEXT NOT NULL,
      summary_json TEXT, error_message TEXT, backtest_run_id INTEGER, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER
    );
    CREATE TABLE strategy_lab_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, strategy_id INTEGER NOT NULL, strategy_key TEXT NOT NULL,
      source TEXT NOT NULL, ts_code TEXT NOT NULL, stock_name TEXT, trade_date TEXT NOT NULL, score REAL NOT NULL,
      signal_strength REAL, matched_from TEXT NOT NULL, evidence_json TEXT NOT NULL, action_json TEXT,
      created_at INTEGER NOT NULL, UNIQUE(run_id, ts_code, trade_date)
    );
    CREATE TABLE trade_cal (cal_date TEXT PRIMARY KEY, is_open INTEGER);
    INSERT INTO trade_cal VALUES ('20261008', 1);
  `)
  snapshot = { tradeDate: '20261008', source: 'eastmoney_public', dateBasis: 'source-reported',
    verifiedAt: Date.parse('2026-10-08T08:00:00Z'), priceCheck: 'not-complete', rows: [
      { tsCode: '000001.SZ', name: '虚构首板', close: 11, pctChg: 10, fdAmountYuan: 6_000_000,
        firstTime: '09:40:00', openTimes: 0, limitTimes: 1, quality: 'available' },
      { tsCode: '000002.SZ', name: '虚构二板', close: 11, pctChg: 10, fdAmountYuan: 12_000_000,
        firstTime: '10:10:00', openTimes: 1, limitTimes: 2, quality: 'available' },
    ] }
  vi.mocked(readVerifiedPublicLimitPool).mockImplementation(() => snapshot)
  ensureDefaultStrategyLabStrategies(db)
})
afterEach(() => { db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function strategy(rule = 'earlyFirst') {
  const row = listStrategyLabStrategies(db).find(s => s.strategyKey === `builtin-public-limit-${rule}`)!
  return getStrategyLabStrategy(db, row.id)!
}

describe('free limit-up strategy vertical workflow', () => {
  it('adds three distinct, runnable profiles idempotently without rewriting existing strategies', () => {
    const original = db.prepare('SELECT * FROM strategy_lab_strategies ORDER BY id').all()
    ensureDefaultStrategyLabStrategies(db)
    expect(db.prepare('SELECT * FROM strategy_lab_strategies ORDER BY id').all()).toEqual(original)
    expect(listStrategyLabStrategies(db)).toHaveLength(6)
    expect(strategy().ruleDraft).toEqual(createPublicLimitUpDraft('earlyFirst'))
    expect(strategy().actions.createBacktest).toBe(false)
    expect(strategy().status).toBe('ready')
  })

  it.each([
    ['mixed engine', (d: any) => { d.screenerProfile = { enabled: false } }],
    ['wrong source', (d: any) => { d.source = 'screener' }],
    ['unknown rule', (d: any) => { d.publicLimitUpProfile.ruleId = 'fake' }],
    ['unsupported version', (d: any) => { d.publicLimitUpProfile.ruleVersion = 'future' }],
    ['all-market scope', (d: any) => { d.stockPool.sources = ['allMarket'] }],
    ['unimplemented ranking', (d: any) => { d.scoring.minScore = 70 }],
  ])('rejects %s rather than silently running another engine', (_label, change) => {
    const draft = createPublicLimitUpDraft('earlyFirst'); change(draft)
    expect(() => validatePublicLimitUpDraft(draft, 'custom')).toThrow('PUBLIC_LIMIT_RULE_INVALID')
  })

  it('runs through the existing executor, saves actual matches, and does not create historical or trade signals', async () => {
    const detail = strategy()
    const result = await runStrategyLabStrategy(db, detail.id)
    expect(result.matchedCount).toBe(1)
    const run = getStrategyLabRun(db, result.runId)!
    expect(run.status).toBe('completed')
    expect(JSON.parse(run.summaryJson!)).toMatchObject({ engine: 'publicLimitUp', totalStocks: 2, matchedCount: 1,
      coverage: { wholeMarketCoverage: 'unknown', backtestReadiness: 'unavailable' } })
    const rows = listStrategyLabMatches(db, { runId: run.id })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ tsCode: '000001.SZ', tradeDate: '20261008', signalStrength: null })
    const evidence = JSON.parse(rows[0].evidenceJson)
    expect(evidence).toMatchObject({ source: 'eastmoney_public', sourceDate: '20261008', observedAt: snapshot.verifiedAt,
      priceCheck: 'not-complete', scoreMeaning: 'rule-pass-only', dataStatus: 'partial' })
    expect(evidence.inputFact).toEqual(snapshot.rows[0])
    // No short-term signal or broker tables exist. An accidental write would fail this real SQLite run.
    expect(() => createBacktestFromStrategyLabRun(db, run.id)).toThrow('PUBLIC_LIMIT_BACKTEST_UNAVAILABLE')
    snapshot.rows[0].fdAmountYuan = 1
    expect(JSON.parse(listStrategyLabMatches(db, { runId: run.id })[0].evidenceJson).inputFact.fdAmountYuan).toBe(6_000_000)
  })

  it('saves a user copy as the same free engine without replacing minute templates', () => {
    const builtin = strategy('secondBoard')
    const copy = saveStrategyLabStrategy(db, { name: '我的免费二板', source: 'custom', status: 'ready',
      ruleDraft: builtin.ruleDraft, runConfig: builtin.runConfig, actions: builtin.actions })
    expect(copy.isBuiltin).toBe(false)
    expect(copy.ruleDraft.publicLimitUpProfile?.ruleId).toBe('secondBoard')
    expect(runPublicLimitUpStrategy(db, copy).matches.map(m => m.tsCode)).toEqual(['000002.SZ'])
  })

  it('rejects selected-date mismatch and range scans rather than silently using current facts', () => {
    const detail = strategy()
    detail.runConfig.dateEnd = '20261007'
    expect(() => runPublicLimitUpStrategy(db, detail)).toThrow('PUBLIC_LIMIT_DATE_MISMATCH')
    detail.runConfig.dateStart = '20261001'
    expect(() => runPublicLimitUpStrategy(db, detail)).toThrow('PUBLIC_LIMIT_SINGLE_DATE_ONLY')
  })

  it('rejects unknown calendar, pre-close capture and future capture', () => {
    const detail = strategy()
    db.prepare('UPDATE trade_cal SET is_open = 0').run()
    expect(() => runPublicLimitUpStrategy(db, detail)).toThrow('PUBLIC_LIMIT_CALENDAR_UNKNOWN')
    db.prepare('UPDATE trade_cal SET is_open = 1').run()
    snapshot.verifiedAt = Date.parse('2026-10-08T06:59:00Z')
    expect(() => runPublicLimitUpStrategy(db, detail)).toThrow('PUBLIC_LIMIT_NOT_AFTER_CLOSE')
    snapshot.verifiedAt = now + 1
    expect(() => runPublicLimitUpStrategy(db, detail)).toThrow('PUBLIC_LIMIT_NOT_AFTER_CLOSE')
  })

  it('distinguishes missing rule facts from valid zero matches and preserves zero counts', async () => {
    snapshot.rows[0].fdAmountYuan = null
    const result = await runStrategyLabStrategy(db, strategy().id)
    const summary = JSON.parse(getStrategyLabRun(db, result.runId)!.summaryJson!)
    expect(summary).toMatchObject({ matchedCount: 0, coverage: { insufficientRows: 1, evaluatedStocks: 1 } })
    expect(listStrategyLabMatches(db, { runId: result.runId })).toEqual([])
  })

  it('excludes unknown ST names instead of assuming non-ST, including a fully excluded scope', () => {
    snapshot.rows[0].name = null
    snapshot.rows[1].name = '*ST虚构'
    const result = runPublicLimitUpStrategy(db, strategy())
    expect(result.matches).toEqual([])
    expect(result.summary.coverage).toMatchObject({ insufficientRows: 1, excludedByScope: 1, evaluatedStocks: 0 })
  })

  it('cannot rehabilitate a duplicate identity by excluding its ST row', () => {
    snapshot.rows.push({ ...snapshot.rows[0], name: '*ST虚构' })
    const result = runPublicLimitUpStrategy(db, strategy())
    expect(result.matches).toEqual([])
    expect(result.summary.coverage.insufficientRows).toBe(2)
  })

  it('uses the real native protocol and cache reader before persisting a lab run', async () => {
    const adapter = await import('../../electron/main/services/publicLimitPoolAdapter')
    const cache = await vi.importActual<typeof import('../../electron/main/services/verifiedPublicLimitPoolCache')>('../../electron/main/services/verifiedPublicLimitPoolCache')
    db.exec('CREATE TABLE daily_close_cache(ts_code TEXT, trade_date TEXT, close REAL)')
    const source = adapter.normalizeNativePublicLimitUpPool('20261008', { rc: 0, data: { tc: 1, qdate: 20261008, pool: [
      { c: '000001', m: 0, n: '原生虚构样本', p: 11000, zdp: 10, amount: 50_000_000, ltsz: 100_000_000,
        tshare: 120_000_000, hs: 2, lbc: 1, fbt: 94000, lbt: 94000, fund: 6_000_000, zbc: 0, hybk: '测试', zttj: { days: 1, ct: 1 } },
    ] } })
    vi.spyOn(adapter, 'fetchPublicLimitUpPool').mockResolvedValue(source)
    const saved = await cache.syncVerifiedPublicLimitPool(db, { dailyProviders: [], reportProviders: [], wencaiEnabled: false, pythonPath: '' }, '20261008')
    expect(saved).toMatchObject({ ok: true, rows: 1, dateBasis: 'source-reported', priceCheck: 'not-complete' })
    vi.mocked(readVerifiedPublicLimitPool).mockImplementation(() => cache.readVerifiedPublicLimitPool(db))
    const result = await runStrategyLabStrategy(db, strategy().id)
    expect(result.matchedCount).toBe(1)
    const evidence = JSON.parse(listStrategyLabMatches(db, { runId: result.runId })[0].evidenceJson)
    expect(evidence).toMatchObject({ sourceDate: '20261008', observedAt: now, close: 11, priceCheck: 'not-complete' })
  })

  it('cancel during save progress cannot later complete or write matches', async () => {
    const send = (_channel: string, progress: { stage: string; runId: number }) => {
      if (progress.stage === 'save') cancelStrategyLabRun(db, progress.runId)
    }
    await expect(runStrategyLabStrategy(db, strategy().id, { send, isDestroyed: () => false } as any)).rejects.toThrow('RUN_CANCELLED')
    expect(db.prepare('SELECT status FROM strategy_lab_runs').get()).toEqual({ status: 'cancelled' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM strategy_lab_matches').get()).toEqual({ n: 0 })
  })

  it('rolls back completion and matches together when a database write fails', async () => {
    db.exec("CREATE TRIGGER reject_match BEFORE INSERT ON strategy_lab_matches BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;")
    await expect(runStrategyLabStrategy(db, strategy().id)).rejects.toThrow('fixture write failure')
    expect(db.prepare('SELECT status FROM strategy_lab_runs').get()).toEqual({ status: 'failed' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM strategy_lab_matches').get()).toEqual({ n: 0 })
  })

  it('renders an explicit free editor and run plan without claiming minute or historical coverage', () => {
    const editor = renderToStaticMarkup(<PublicLimitUpStrategyEditor strategy={strategy()} />)
    expect(editor).toContain('public-limit-strategy-editor')
    expect(editor).toContain('无需 Tushare Key')
    expect(editor).not.toContain('分钟条件')
    const plan = renderToStaticMarkup(<StrategyRunPlan activeView="newRule" publicRuleId="earlyFirst" />)
    expect(plan).toContain('运行后确认')
    expect(plan).toContain('收益回测不可用')
    expect(plan).not.toContain('120 缺口')
  })

  it('renders saved free matches as rule-pass evidence, not predicted scores', async () => {
    const result = await runStrategyLabStrategy(db, strategy().id)
    const rows = listStrategyLabMatches(db, { runId: result.runId })
    const html = renderToStaticMarkup(<StrategyResultTable matches={rows} selectedMatchId={null} onSelectMatch={() => {}} onOpenEvidence={() => {}} />)
    expect(html).toContain('免费涨停规则')
    expect(html).toContain('通过')
    expect(html).not.toContain('100.0')
  })
})
