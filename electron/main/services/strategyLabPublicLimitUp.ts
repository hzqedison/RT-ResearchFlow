import type Database from 'better-sqlite3'
import type { StrategyLabRuleDraft, StrategyLabStrategyDetail } from './strategyLabService'
import type { StrategyLabRunSummary } from './strategyLabRunService'
import type { StrategyLabMatchRow } from '../database/types'
import { readVerifiedPublicLimitPool } from './verifiedPublicLimitPoolCache'
import { PUBLIC_LIMIT_UP_RULES, PUBLIC_LIMIT_UP_RULE_VERSION, screenPublicLimitUpPool, type PublicLimitUpRuleId } from '../../shared/publicLimitUpRules'
import { isPublicLimitUpRuleId, publicLimitUpRuleDescription } from '../../shared/publicLimitUpStrategy'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createPublicLimitUpDraft(ruleId: PublicLimitUpRuleId): StrategyLabRuleDraft {
  return {
    schemaVersion: 1, source: 'custom',
    stockPool: { sources: [], manualTsCodes: [], excludeST: true, excludeBJ: true },
    publicLimitUpProfile: { ruleId, ruleVersion: PUBLIC_LIMIT_UP_RULE_VERSION },
    scoring: { minScore: 0, weights: {} },
  }
}

// A distinct execution profile, not an empty minute strategy or all-market pool.
export function validatePublicLimitUpDraft(value: unknown, source: string): StrategyLabRuleDraft | null {
  if (!record(value) || !Object.prototype.hasOwnProperty.call(value, 'publicLimitUpProfile')) return null
  const profile = value.publicLimitUpProfile
  const pool = value.stockPool
  const scoring = value.scoring
  if (source !== 'custom' || value.source !== source || value.schemaVersion !== 1 ||
      !record(profile) || !isPublicLimitUpRuleId(profile.ruleId) || profile.ruleVersion !== PUBLIC_LIMIT_UP_RULE_VERSION ||
      value.screenerProfile !== undefined || value.conditionBlocksProfile !== undefined ||
      !record(pool) || !Array.isArray(pool.sources) || pool.sources.length !== 0 ||
      !Array.isArray(pool.manualTsCodes) || pool.manualTsCodes.length !== 0 ||
      typeof pool.excludeST !== 'boolean' || typeof pool.excludeBJ !== 'boolean' ||
      !record(scoring) || scoring.minScore !== 0 || !record(scoring.weights) || Object.keys(scoring.weights).length !== 0) {
    throw new Error('PUBLIC_LIMIT_RULE_INVALID')
  }
  const draft = createPublicLimitUpDraft(profile.ruleId)
  draft.stockPool.excludeST = pool.excludeST
  draft.stockPool.excludeBJ = pool.excludeBJ
  return draft
}

export function ensurePublicLimitUpStrategies(db: Database.Database): void {
  const insert = db.prepare(`INSERT OR IGNORE INTO strategy_lab_strategies
    (strategy_key, name, description, source, status, enabled, is_builtin, version,
     rule_draft_json, run_config_json, actions_json, created_at, updated_at)
    VALUES (?, ?, ?, 'custom', 'ready', 1, 1, 1, ?, ?, ?, ?, ?)`)
  db.transaction(() => {
    for (const ruleId of Object.keys(PUBLIC_LIMIT_UP_RULES) as PublicLimitUpRuleId[]) {
      const now = Date.now()
      insert.run(`builtin-public-limit-${ruleId}`, `免费 · ${PUBLIC_LIMIT_UP_RULES[ruleId].label}`,
        `无需 Tushare Key 或 Python。${publicLimitUpRuleDescription(ruleId)}仅筛选已核验盘后涨停池，不代表全市场、竞价或收益预测。`,
        JSON.stringify(createPublicLimitUpDraft(ruleId)),
        JSON.stringify({ scanMode: 'complete', lookbackDays: 1, dailyPrefilterLimit: 200, autoFetchMinuteLimit: 0, userTier: 'free', dateStart: null, dateEnd: null }),
        JSON.stringify({ aiInsight: true, addToTrendWatchlist: true, monitorChips: false, createBacktest: false }), now, now)
    }
  })()
}

export function runPublicLimitUpStrategy(db: Database.Database, strategy: StrategyLabStrategyDetail, now = Date.now()): {
  matches: Array<Omit<StrategyLabMatchRow, 'id' | 'runId' | 'createdAt' | 'actionJson'> & { actionJson: string }>
  summary: StrategyLabRunSummary
} {
  const draft = validatePublicLimitUpDraft(strategy.ruleDraft, strategy.source)
  if (!draft?.publicLimitUpProfile) throw new Error('PUBLIC_LIMIT_RULE_INVALID')
  const config = strategy.runConfig
  if (config.scanMode !== 'complete' || config.lookbackDays !== 1 || config.autoFetchMinuteLimit !== 0 ||
      (config.dateStart && config.dateEnd && config.dateStart !== config.dateEnd)) throw new Error('PUBLIC_LIMIT_SINGLE_DATE_ONLY')
  const snapshot = readVerifiedPublicLimitPool(db)
  const requestedDate = config.dateEnd || config.dateStart
  if (requestedDate && requestedDate !== snapshot.tradeDate) throw new Error('PUBLIC_LIMIT_DATE_MISMATCH')
  const result = screenPublicLimitUpPool(snapshot, draft.publicLimitUpProfile.ruleId, now)
  if (result.state !== 'ready') throw new Error(`PUBLIC_LIMIT_${result.reason === 'INVALID_RULE' ? 'RULE_INVALID' : result.reason}`)
  const tradeDate = result.tradeDate!
  const day = db.prepare('SELECT is_open AS isOpen FROM trade_cal WHERE cal_date = ?').get(tradeDate) as { isOpen: number } | undefined
  if (day?.isOpen !== 1) throw new Error('PUBLIC_LIMIT_CALENDAR_UNKNOWN')
  const cutoff = Date.parse(`${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}T15:05:00+08:00`)
  if (!Number.isSafeInteger(snapshot.verifiedAt) || snapshot.verifiedAt! < cutoff || snapshot.verifiedAt! > now || now < cutoff) throw new Error('PUBLIC_LIMIT_NOT_AFTER_CLOSE')

  let excludedByScope = 0
  let unknownNames = 0
  let duplicateIdentities = 0
  const identityCounts = new Map<string, number>()
  for (const row of snapshot.rows) identityCounts.set(row.tsCode, (identityCounts.get(row.tsCode) ?? 0) + 1)
  const scopedRows = snapshot.rows.filter(row => {
    if (identityCounts.get(row.tsCode)! > 1) { duplicateIdentities++; return false }
    if (draft.stockPool.excludeBJ && row.tsCode.endsWith('.BJ')) { excludedByScope++; return false }
    if (draft.stockPool.excludeST && !row.name?.trim()) { unknownNames++; return false }
    if (draft.stockPool.excludeST && /^(?:\*)?ST/i.test(row.name!.trim())) { excludedByScope++; return false }
    return true
  })
  const screened = screenPublicLimitUpPool({ ...snapshot, rows: scopedRows }, draft.publicLimitUpProfile.ruleId, now)
  // Empty scope is a successful zero-result scan, not a missing original cache.
  const matches = (scopedRows.length ? screened.matches : []).map(({ row, evidence }) => ({
    strategyId: strategy.id, strategyKey: strategy.strategyKey, source: strategy.source,
    tsCode: row.tsCode, stockName: row.name, tradeDate, score: 100, signalStrength: null,
    matchedFrom: `publicLimitUp.${draft.publicLimitUpProfile!.ruleId}`,
    evidenceJson: JSON.stringify({
      conditionsMet: evidence, close: row.close, pctChg: row.pctChg,
      dataStatus: row.quality === 'available' && snapshot.priceCheck === 'matched-local-closes' ? 'complete' : 'partial',
      ruleProfile: draft.publicLimitUpProfile, ruleDescription: publicLimitUpRuleDescription(draft.publicLimitUpProfile!.ruleId),
      source: snapshot.source, sourceDate: tradeDate, dateBasis: snapshot.dateBasis, observedAt: snapshot.verifiedAt,
      priceCheck: snapshot.priceCheck ?? 'unknown', inputFact: row, strategyVersion: strategy.version,
      scoreMeaning: 'rule-pass-only', limitations: ['limit-up-pool-only', 'not-auction', 'not-chips', 'not-point-in-time-backtest'],
    }),
    actionJson: JSON.stringify({ aiInsight: false, trendWatchlist: false, chipMonitor: false, backtest: false }),
  }))
  return { matches, summary: {
    totalStocks: snapshot.rows.length, matchedCount: matches.length, dateStart: tradeDate, dateEnd: tradeDate,
    source: strategy.source, engine: 'publicLimitUp', coverage: {
      evaluatedStocks: scopedRows.length - screened.insufficientRows,
      insufficientRows: screened.insufficientRows + unknownNames + duplicateIdentities, excludedByScope,
      source: snapshot.source, observedAt: snapshot.verifiedAt, dateBasis: snapshot.dateBasis,
      priceCheck: snapshot.priceCheck ?? 'unknown', wholeMarketCoverage: 'unknown',
      ruleProfile: draft.publicLimitUpProfile, ruleDescription: publicLimitUpRuleDescription(draft.publicLimitUpProfile.ruleId),
      scope: draft.stockPool,
      backtestReadiness: 'unavailable', auctionReadiness: 'unavailable', chipReadiness: 'unavailable',
    },
  } }
}
