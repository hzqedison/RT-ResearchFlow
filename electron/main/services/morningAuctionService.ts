/**
 * FR-125: 短线策略 - 晨间集合竞价快照计算引擎（真实接口版本）
 *
 * 数据来源：
 *  - limit_list_daily（前一交易日）：前一日涨停股分 4 池（首板/二板/炸板/断板）
 *  - Tushare stk_auction（369，当日）：集合竞价成交数据（接口支持历史查询，传 trade_date 参数即可）
 *  - kpl_concept_members：题材归属（板态分类用）
 *  - weakToStrong 5 形态：基于 limit_list_daily 字段（firstTime/lastTime/openTimes/limitTimes/limit）判断，
 *    仅在 auctionMap 有该股竞价数据（09:25 当日已拉取）时生成候选
 *
 * 缺口保留：缺失事实不以零值候选代替，前日结构与观察资格通过 readiness 单独表达。
 */

import { getDb } from '../database/db'
import { getLimitListByDate } from '../database/limitListDailyRepository'
import { getNextTradeDay } from '../database/tradeCalRepository'
import { getConceptsByStockRouted } from './conceptRouter'
import { insertConceptMembersIfAbsent } from '../database/kplConceptMembersRepository'
import { getConceptSource } from '../database/settingsRepository'
import { getDataSourceConfig } from '../database/dataSourceRepository'
import { decryptApiKey } from '../utils/apiKeyEncryption'
import { fetchStkAuction, fetchDailyForCandidates, fetchKplConceptConsByStock } from './tushareService'
import { getRtKCache, getLimitPct } from './sharedRtKCache'
import { queryDailyClose, queryDailyCloseExact, upsertDailyClose } from '../database/dailyCloseCacheRepository'
import { queryByDate as queryStkAuctionByDate, upsertStkAuctionCache } from '../database/stkAuctionCacheRepository'
import { getKplListByDate } from '../database/kplConceptDailyRepository'
import {
  getLatestVerifiedObservationDateBefore,
  listSectorFlowObservations,
} from '../database/sectorFlowObservationRepository'
import type {
  LimitListDailyRow,
  StkAuctionRow,
  MorningAuctionMarketThemeSummary,
  MorningAuctionThemeAttribution,
} from '../database/types'
import { emitDecisionSignals, type DecisionSignalInput } from './decisionSignalService'
import {
  buildMorningAuctionThemeAttributions,
  splitMorningAuctionThemeNames,
  type MorningAuctionDirectThemeFact,
} from './morningAuctionThemeAttributionModel'
import { buildMorningAuctionMarketThemes } from './morningAuctionMarketThemeModel'
import {
  MorningAuctionPriceHistoryCoordinator,
  buildMorningAuctionPriceHistoryCoverage,
  loadMorningAuctionPriceHistoryEntries,
  type MorningAuctionPriceHistoryCoverage,
  type MorningAuctionPriceHistoryEntry,
} from './morningAuctionPriceHistoryCoordinator'
import { getBeijingYmd, getBeijingEpochForYmd } from './marketSettlementPolicy'
import { readKnownCalendar } from './dataReadinessService'
import {
  AUCTION_REQUEST_MS, AUCTION_RETRY_COOLDOWN_MS, MAX_ENTRY_DATES, MAX_AUCTION_COOLDOWNS,
  resolveEntryDate, entryFingerprint, validAuctionFact, validPreviousLimit,
  mergeAuctionFacts, describeEntry, signalObservation, cutoffObservation, entryFailureCode,
  type EntryDateContext, type EntryReadiness, type EntryAttempt,
} from './morningAuctionEntryPolicy'
import {
  applyMorningAuctionCloseProjection,
  isCurrentMorningAuctionTradeDate,
  type MorningAuctionCloseFact,
} from './morningAuctionPriceProjection'

export interface MorningAuctionStock {
  /** Tushare 风格代码: 000001.SZ / 600519.SH / 300750.SZ */
  tsCode: string
  /** 6 位纯数字代码: 000001 / 600519，前端 navigateToStock 使用 */
  stockCode: string
  stockName: string
  stockNameKnown?: boolean
  /** 竞价开盘价（元） */
  auctionPrice: number
  /** 前收盘价（元） */
  prevClose: number
  /** 较前收盘涨跌幅（百分比） */
  pctChg: number
  /** 集合竞价成交金额（万元） */
  auctionAmount: number
  /** 集合竞价换手率（%），来自 369 stk_auction turnover_rate 字段 */
  auctionTurnover: number
  /** 集合竞价成交量比（vs 前 5 日均量），可空 */
  volumeRatio: number | null
  /** 当前交易日为实时价；历史交易日为目标日收盘价；数据不可用时为 null。 */
  currentPrice: number | null
  /** 当前交易日为实时涨跌幅；历史交易日为目标日收盘涨跌幅；数据不可用时为 null。 */
  currentPctChg: number | null
  /** 当前交易日累计成交额（元）；历史日线缓存没有精确成交额时为 null。 */
  currentAmount: number | null
  /** 近 3 个交易日累计涨跌幅（%）；样本不足或读取失败时为 null */
  pctChg3d: number | null
  /** 近 5 个交易日累计涨跌幅（%）；样本不足或读取失败时为 null */
  pctChg5d: number | null
  /** 历史涨跌事实的覆盖状态与稳定缺失原因。 */
  priceHistory?: Omit<MorningAuctionPriceHistoryEntry, 'p3d' | 'p5d'>
  /** 题材列表（按热度降序），异步填充；未就绪时为空数组 */
  conceptNames: string[]
  /** 早盘题材归因。直接原因、竞价共振和静态关联保持分层，不把普通成分关系冒充主炒题材。 */
  themeAttribution?: MorningAuctionThemeAttribution | null
}

/** 弱转强候选股（含前一日形态元信息） */
export interface WeakToStrongStock extends MorningAuctionStock {
  /** 前一日形态描述（烂板炸板次数 / 尾盘偷袭板时间 / 断板连板数 等） */
  prevDayMeta: string
  /** 信号强度评分（0-100，越高越强） */
  signalStrength: number
}

/** 板态分类候选股 */
export interface BoardCategoryStock extends MorningAuctionStock {
  /** 昨日连板数 */
  limitTimes: number
  /** 题材热度（kpl_concept_daily.hot_num） */
  hotNum: number
}

export interface MorningAuctionSnapshot {
  /** 数据交易日 YYYYMMDD */
  tradeDate: string
  /** 快照生成时间戳 (ms) */
  generatedAt: number
  /** 是否为 mock 数据（前端显示提示横幅） */
  isMock: boolean
  /** 竞价三一信号：按昨日运行阶段分 4 个板块池，各池按「竞价金额×竞价换手率」乘积降序 */
  threeOne: {
    firstBoard: MorningAuctionStock[]   // 首板池（昨日 limit_times=1 且 limit='U'）
    secondBoard: MorningAuctionStock[]  // 二板池（昨日 limit_times>=2 且 limit='U'）
    brokenBoard: MorningAuctionStock[]  // 炸板池（昨日 open_times>=1 且 limit='U'）
    brokenConsec: MorningAuctionStock[] // 断板池（昨日 limit!='U' 且 limit_times>=2）
    allMarket: MorningAuctionStock[]    // 全市场池（竹价涨幅≥3%、金额≥5百万、换手率≥0.15%、流通市値≥30亿）
  }
  /** 弱转强 5 形态 */
  weakToStrong: {
    badBoard: WeakToStrongStock[] // 烂板弱转强
    tailAttack: WeakToStrongStock[] // 尾盘偷袭板弱转强
    brokenBoard: WeakToStrongStock[] // 断板弱转强
    afternoonReseal: WeakToStrongStock[] // 午后回封板弱转强
    reversal: WeakToStrongStock[] // 反包弱转强
  }
  /** 板态分类 */
  boardCategory: {
    first: BoardCategoryStock[] // 首板
    second: BoardCategoryStock[] // 二板
    third: BoardCategoryStock[] // 三板
    n: BoardCategoryStock[] // N 板（≥4 板）
  }
  /** 当前竞价候选反向聚合的市场主线及上一交易日真实板块资金双确认。 */
  marketThemes?: MorningAuctionMarketThemeSummary
  /** 当前候选去重后的 3 日/5 日涨跌覆盖摘要。 */
  priceHistoryCoverage?: MorningAuctionPriceHistoryCoverage
  /** Observed facts and dependency gaps, not a full-market completeness certificate. */
  readiness?: EntryReadiness
}

export interface MorningAuctionTradeDateStatus {
  reasonCode?: string
  isTradeDay: boolean
  previousTradeDate: string | null
  nextTradeDate: string | null
  recommendedTradeDate: string | null
}

export function resolveMorningAuctionTradeDateStatus(tradeDate: string): MorningAuctionTradeDateStatus {
  const db = getDb()
  const context = resolveEntryDate(readKnownCalendar(db), tradeDate, Date.now())
  return {
    isTradeDay: context.status === 'open',
    previousTradeDate: context.previousTradeDate,
    nextTradeDate: context.status === 'open' || context.status === 'closed' ? getNextTradeDay(db, tradeDate) : null,
    recommendedTradeDate: context.status === 'closed' ? context.previousTradeDate : null,
    reasonCode: context.reasonCode,
  }
}

function createEmptyMorningAuctionSnapshot(tradeDate: string): MorningAuctionSnapshot {
  return {
    tradeDate,
    generatedAt: Date.now(),
    isMock: false,
    threeOne: { firstBoard: [], secondBoard: [], brokenBoard: [], brokenConsec: [], allMarket: [] },
    weakToStrong: { badBoard: [], tailAttack: [], brokenBoard: [], afternoonReseal: [], reversal: [] },
    boardCategory: { first: [], second: [], third: [], n: [] },
    marketThemes: buildMorningAuctionMarketThemes([], [], null),
    priceHistoryCoverage: {
      requestedCount: 0,
      covered3dCount: 0,
      covered5dCount: 0,
      readyCount: 0,
      partialCount: 0,
      insufficientCount: 0,
      unavailableCount: 0,
      failedCount: 0,
      updatedAt: Date.now(),
    },
  }
}

/**
 * 计算弱转强信号强度（0-100）：
 *   竞价涨幅（0-40）+ 竞价金额（0-30，按 300万封顶）+ 换手率（0-30，按 0.3% 封顶）
 */
function calcSignalStrength(
  pctChg: number,
  auctionAmount: number, // 万元
  auctionTurnover: number // %
): number {
  const pctScore = Math.min(Math.max(pctChg, 0) / 10 * 40, 40)      // 0%→0, 10%→40
  const amtScore = Math.min(auctionAmount / 300 * 30, 30)            // 0→0, 300万→30
  const trnScore = Math.min(auctionTurnover / 0.3 * 30, 30)          // 0→0, 0.3%→30
  return Math.round(pctScore + amtScore + trnScore)
}

/** 尝试从 prevRow 构建弱转强候选，不符合竞价门槛则返回 null */
function tryBuildWeakToStrong(
  row: LimitListDailyRow,
  auctionEntry: { price: number | null; preClose: number | null; turnoverRate: number | null; volumeRatio: number | null; amount: number | null } | undefined,
  minPctChg: number,  // 竞价最低涨幅门槛（%）
  prevDayMeta: string
): WeakToStrongStock | null {
  if (!auctionEntry) return null
  const base = buildAuctionStock(row, auctionEntry)
  if (base.pctChg < minPctChg) return null
  return {
    ...base,
    prevDayMeta,
    signalStrength: calcSignalStrength(base.pctChg, base.auctionAmount, base.auctionTurnover)
  }
}

/**
 * 将 Tushare first_time/last_time 字段解析为分钟数，用于数值比较。
 * 兼容格式：'92503'(Hmmss 5位) / '092503'(HHmmss 6位) / '9:25:03' / '09:25:03'
 * 空字符串或无法解析返回 -1。
 */
function parseTimeToMinutes(t: string): number {
  if (!t) return -1
  if (t.includes(':')) {
    const parts = t.split(':')
    const h = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10)
    if (isNaN(h) || isNaN(m)) return -1
    return h * 60 + m
  }
  // 纯数字：5 位 Hmmss 或 6 位 HHmmss
  if (t.length === 5) {
    return parseInt(t[0], 10) * 60 + parseInt(t.slice(1, 3), 10)
  }
  if (t.length === 6) {
    return parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(2, 4), 10)
  }
  return -1
}

/** 将 Tushare 时间字段格式化为 HH:mm 供显示（兼容多种输入格式） */
function formatTimeField(t: string): string {
  if (!t) return ''
  if (t.includes(':')) return t.slice(0, 5)          // '09:25:03' → '09:25'
  if (t.length === 5) return `0${t[0]}:${t.slice(1, 3)}`  // '92503' → '09:25'
  if (t.length === 6) return `${t.slice(0, 2)}:${t.slice(2, 4)}` // '092503' → '09:25'
  return t
}

function getAuctionLimitPct(stock: MorningAuctionStock): number {
  const code = stock.stockCode || stock.tsCode.split('.')[0]
  const name = stock.stockName.toUpperCase()
  if (name.includes('ST')) return 5
  if (stock.tsCode.endsWith('.BJ') || code.startsWith('8') || code.startsWith('4')) return 30
  if (code.startsWith('300') || code.startsWith('301') || code.startsWith('688') || code.startsWith('689')) return 20
  return 10
}

function isAuctionOneWordBoard(stock: MorningAuctionStock): boolean {
  if (stock.auctionPrice <= 0 || stock.prevClose <= 0) return false
  return stock.pctChg >= getAuctionLimitPct(stock) - 0.3
}

/** 判断当前北京时间是否在集合竞价窗口（09:25-09:29，工作日） */
/** 构建一条 MorningAuctionStock（竞价数据缺失时价格相关字段置 0） */
function buildAuctionStock(
  row: LimitListDailyRow,
  auction: { price: number | null; preClose: number | null; turnoverRate: number | null; volumeRatio: number | null; amount: number | null; floatShare?: number | null } | undefined
): MorningAuctionStock {
  const auctionPrice = auction?.price ?? 0
  const prevClose = auction?.preClose ?? row.close ?? 0
  const pctChg =
    prevClose > 0 && auctionPrice > 0
      ? Number(((auctionPrice - prevClose) / prevClose * 100).toFixed(2))
      : 0
  return {
    tsCode: row.tsCode,
    stockCode: row.tsCode.split('.')[0],
    stockName: row.name || row.tsCode,
    stockNameKnown: Boolean(row.name),
    auctionPrice,
    prevClose,
    pctChg,
    // amount 单位为元，转为万元；无竞价数据时为 0
    auctionAmount: auction?.amount != null ? Number((auction.amount / 10000).toFixed(2)) : 0,
    auctionTurnover: auction?.turnoverRate ?? 0,
    volumeRatio: auction?.volumeRatio ?? null,
    currentPrice: null,
    currentPctChg: null,
    currentAmount: null,
    pctChg3d: null,
    pctChg5d: null,
    conceptNames: []
  }
}

/** 构建真实晨间竞价快照 */
async function buildRealMorningAuctionSnapshot(input: EntryInputs): Promise<MorningAuctionSnapshot> {
  const db = getDb()
  const { tradeDate } = input.context
  const prevRows = input.limits.filter(row => validPreviousLimit(row, input.context.previousTradeDate))
  const auctionMap = new Map(input.auction.filter(row => validAuctionFact(row, tradeDate)).map(row => [row.tsCode, row]))
  const conceptSource = input.source
  const localConcepts = (code: string) => {
    try { return getConceptsByStockRouted(db, code, conceptSource, tradeDate) } catch { return [] }
  }

  // 批量查询 DB 中已有的题材信息，减少重复 IO
  const dbConceptMap = new Map<string, { names: string[]; hotNum: number | null }>()
  for (const row of prevRows) {
    const concepts = localConcepts(row.tsCode)
    if (concepts.length > 0) {
      // 按名称去重（THS 模式下同名概念可能对应多个 conceptCode，避免重复显示）
      const uniqueNames = [...new Set(concepts.map(c => c.conceptName).filter(n => n !== '无题材' && n !== ''))]
      dbConceptMap.set(row.tsCode, { names: uniqueNames.length > 0 ? uniqueNames : concepts.map(c => c.conceptName), hotNum: null })
    }
  }

  // 按昨日数据分 4 池（各池按竞价金额 × 竞价换手率乘积降序——双第一逻辑）
  const firstBoard: MorningAuctionStock[] = []   // 首板：limit='U', openTimes=0, limitTimes=1
  const secondBoard: MorningAuctionStock[] = []  // 二板：limit='U', openTimes=0, limitTimes>=2
  const brokenBoard: MorningAuctionStock[] = []  // 炸板后封回：limit='U', openTimes>=1
  const brokenConsec: MorningAuctionStock[] = [] // 断板：limit!='U', limitTimes>=2


  for (const row of prevRows) {
    if (!auctionMap.has(row.tsCode)) continue
    const limitTimes = row.limitTimes ?? 0
    const openTimes = row.openTimes ?? 0
    const limit = row.limit
    const stock = buildAuctionStock(row, auctionMap.get(row.tsCode))

    stock.conceptNames = dbConceptMap.get(row.tsCode)?.names ?? []

    // 今日竞价价格已触及跌停（含 0.3% 容差）→ 无可操作性，不进任何池
    // 仅当 auctionMap 有该股数据时才检测，避免 pctChg=0 误杀无竞价记录股
    if (auctionMap.has(row.tsCode)) {
      const downLimit = getLimitPct(row.tsCode, row.name ?? null)
      if (stock.pctChg <= -(downLimit - 0.3)) continue
    }

    if (limit === 'U') {
      if (openTimes >= 1) {
        brokenBoard.push(stock)       // 炸板后最终封回
      } else if (limitTimes >= 2) {
        secondBoard.push(stock)       // 二板及以上干净封板
      } else {
        firstBoard.push(stock)        // 首板干净一字
      }
    } else if (limitTimes >= 2) {
      brokenConsec.push(stock)        // 昨日断板（历史连板 >=2 但昨日未封板）
    }
  }

  const sortByProduct = (arr: MorningAuctionStock[]) =>
    arr.sort((a, b) => b.auctionAmount * b.auctionTurnover - a.auctionAmount * a.auctionTurnover)

  // ── 全市场池：遍历 auctionMap 全量，筛选竞价异动股 ──
  // 筛选条件：竞价涨幅≥3%、竞价金额≥500万元、竞价换手率≥0.15%、流通市值≥30亿
  // 注意：不排除已在其他池中的股票——allMarket 视角纯粹基于今日竞价数据，与昨日连板状态无关

  // Missing optional names never trigger another remote request or block facts.
  const rtKCache = getRtKCache()
  const names = (sql: string): Array<{ ts_code: string; name: string; stockCode: string; stockName: string }> => {
    try { return db.prepare(sql).all() as ReturnType<typeof names> } catch { return [] }
  }
  const histNameMap = new Map(names('SELECT DISTINCT ts_code, name FROM limit_list_daily WHERE name IS NOT NULL').map(row => [row.ts_code, row.name]))
  const kplNameMap = new Map(names('SELECT DISTINCT ts_code, name FROM kpl_concept_members WHERE name IS NOT NULL').map(row => [row.ts_code, row.name]))
  const stockInfoMap = new Map(names('SELECT stockCode, stockName FROM stock_info WHERE stockName IS NOT NULL').map(row => [row.stockCode, row.stockName]))
  const allMarket: MorningAuctionStock[] = []
  for (const [tsCode, entry] of auctionMap.entries()) {
    const { price, preClose, amount, turnoverRate, floatShare } = entry
    if (!price || !preClose || price <= 0 || preClose <= 0) continue
    const pctChg = (price - preClose) / preClose * 100
    if (pctChg < 3) continue
    if (!amount || amount < 5_000_000) continue           // 竞价金额 < 500万元
    if (!turnoverRate || turnoverRate < 0.15) continue    // 竞价换手率 < 0.15%
    // 流通市值 = floatShare(万股) × 10000 × price(元) / 1e8(亿) = floatShare × price / 10000
    if (!floatShare || floatShare * price / 10000 < 30) continue  // 流通市值 < 30亿
    // 构建 MorningAuctionStock（无 LimitListDailyRow，独立构建）
    const rtEntry = rtKCache?.get(tsCode)
    const nameFromRt = rtEntry?.name ?? null
    const nameFromHist = histNameMap.get(tsCode) ?? null
    const nameFromKpl = kplNameMap.get(tsCode) ?? null
    const stockCode6 = tsCode.split('.')[0]
    const nameFromStockInfo = stockInfoMap.get(stockCode6) ?? null
    // 名称优先级：rt_k 缓存 → limit_list_daily 历史 → kpl_concept_members → stock_info → 空字符串
    const resolvedName = nameFromRt ?? nameFromHist ?? nameFromKpl ?? nameFromStockInfo ?? ''
    const stock: MorningAuctionStock = {
      tsCode,
      stockCode: stockCode6,
      stockName: resolvedName || tsCode,
      stockNameKnown: Boolean(resolvedName),
      auctionPrice: price,
      prevClose: preClose,
      pctChg: Number(pctChg.toFixed(2)),
      auctionAmount: Number((amount / 10000).toFixed(2)),
      auctionTurnover: turnoverRate,
      volumeRatio: entry.volumeRatio ?? null,
      currentPrice: rtEntry?.price ?? null,
      currentPctChg: rtEntry?.change ?? null,
      currentAmount: rtEntry?.amount ?? null,
      pctChg3d: null,
      pctChg5d: null,
      conceptNames: (() => {
        const cached = dbConceptMap.get(tsCode)
        if (cached) return cached.names
        // allMarket 池可能包含昨日未涨停的股票，dbConceptMap 中无记录，需单独查路由层
        const cs = localConcepts(tsCode)
        return [...new Set(cs.map(c => c.conceptName).filter(n => n !== '无题材' && n !== ''))]
      })(),
    }
    allMarket.push(stock)
  }

  // 板态分类（按昨日 limitTimes 分 4 档，补充 kpl_concept_members 题材信息）
  const bcFirst: BoardCategoryStock[] = []
  const bcSecond: BoardCategoryStock[] = []
  const bcThird: BoardCategoryStock[] = []
  const bcN: BoardCategoryStock[] = []

  for (const row of prevRows.filter(r => r.limit === 'U' && auctionMap.has(r.tsCode))) {
    const limitTimes = row.limitTimes ?? 1
    const conceptEntry = dbConceptMap.get(row.tsCode)
    const hotNum = conceptEntry?.hotNum ?? 0
    const stock: BoardCategoryStock = {
      ...buildAuctionStock(row, auctionMap.get(row.tsCode)),
      limitTimes,
      conceptNames: conceptEntry?.names ?? [],
      hotNum
    }
    if (limitTimes >= 4) bcN.push(stock)
    else if (limitTimes === 3) bcThird.push(stock)
    else if (limitTimes === 2) bcSecond.push(stock)
    else bcFirst.push(stock)
  }

  // 弱转强 5 形态：基于昨日 limit_list_daily 字段判断，仅有竞价数据的股票才生成候选
  const wkBadBoard: WeakToStrongStock[] = []
  const wkTailAttack: WeakToStrongStock[] = []
  const wkBrokenBoard: WeakToStrongStock[] = []
  const wkAfternoonReseal: WeakToStrongStock[] = []
  const wkReversal: WeakToStrongStock[] = []

  for (const row of prevRows) {
    const openTimes = row.openTimes ?? 0
    const limitTimes = row.limitTimes ?? 0
    const limit = row.limit
    const firstTime = row.firstTime ?? ''
    const lastTime = row.lastTime ?? ''
    const auctionEntry = auctionMap.get(row.tsCode)

    // ① 烂板弱转强：昨日涨停但开板 >= 3 次，竞价高开 >= 1%
    if (limit === 'U' && openTimes >= 3) {
      const s = tryBuildWeakToStrong(row, auctionEntry, 1,
        `昨日开板 ${openTimes} 次后封回，主力昨日卸压重吸筹`)
      if (s) wkBadBoard.push(s)
    }

    // ② 尾盘偷袭板：昨日涨停首封时间 >= 14:30，竞价高开 >= 1%
    if (limit === 'U' && parseTimeToMinutes(firstTime) >= 14 * 60 + 30) {
      const s = tryBuildWeakToStrong(row, auctionEntry, 1,
        `昨日 ${formatTimeField(firstTime)} 尾盘封板，主力全天压盘吸筹`)
      if (s) wkTailAttack.push(s)
    }

    // ③ 断板弱转强：昨日历史连板 >= 2 但当日未涨停，竞价高开 >= 1%
    if (limit !== 'U' && limit !== 'D' && limitTimes >= 2) {
      const s = tryBuildWeakToStrong(row, auctionEntry, 1,
        `历史 ${limitTimes} 连板昨日断板，今日竞价重新发力`)
      if (s) wkBrokenBoard.push(s)
    }

    // ④ 午后回封：昨日早盘封板（firstTime < 12:00）+ 中途炸板 + 午后再封（lastTime > 13:00），竞价高开 >= 1%
    const ftMin = parseTimeToMinutes(firstTime)
    const ltMin = parseTimeToMinutes(lastTime)
    if (
      limit === 'U' &&
      openTimes >= 1 &&
      ftMin > 0 &&
      ftMin < 12 * 60 &&
      ltMin > 13 * 60
    ) {
      const s = tryBuildWeakToStrong(row, auctionEntry, 1,
        `早盘 ${formatTimeField(firstTime)} 封板，午盘炸开后 ${formatTimeField(lastTime)} 回封`)
      if (s) wkAfternoonReseal.push(s)
    }

    // ⑤ 反包弱转强：昨日跌停（limit='D'），竞价高开 >= 3%
    if (limit === 'D') {
      const s = tryBuildWeakToStrong(row, auctionEntry, 3,
        `昨日跌停，今日竞价强势反包`)
      if (s) wkReversal.push(s)
    }
  }

  // 各形态按信号强度降序
  const sortByStrength = (arr: WeakToStrongStock[]) =>
    arr.sort((a, b) => b.signalStrength - a.signalStrength)

  return {
    tradeDate,
    generatedAt: Date.now(),
    isMock: false,
    threeOne: {
      firstBoard: sortByProduct(firstBoard),
      secondBoard: sortByProduct(secondBoard),
      brokenBoard: sortByProduct(brokenBoard),
      brokenConsec: sortByProduct(brokenConsec),
      allMarket: sortByProduct(allMarket),
    },
    weakToStrong: {
      badBoard: sortByStrength(wkBadBoard),
      tailAttack: sortByStrength(wkTailAttack),
      brokenBoard: sortByStrength(wkBrokenBoard),
      afternoonReseal: sortByStrength(wkAfternoonReseal),
      reversal: sortByStrength(wkReversal)
    },
    boardCategory: {
      first: bcFirst.sort((a, b) => b.hotNum - a.hotNum),
      second: bcSecond.sort((a, b) => b.hotNum - a.hotNum),
      third: bcThird.sort((a, b) => b.hotNum - a.hotNum),
      n: bcN.sort((a, b) => b.limitTimes - a.limitTimes || b.hotNum - a.hotNum)
    }
  }
}

/** 内存缓存：避免前端每次切换 Tab 都重新计算 */
interface EntryInputs {
  context: EntryDateContext
  source: ReturnType<typeof getConceptSource>
  auction: StkAuctionRow[]
  limits: LimitListDailyRow[]
  fingerprint: string
}
interface EntryCache {
  snapshot: MorningAuctionSnapshot
  fingerprint: string
  generation: number
  lastAttempt: EntryAttempt | null
  publishedFingerprint?: string
}
interface EntryFlight {
  force: boolean
  generation: number
  startedToday: string
  promise: Promise<MorningAuctionSnapshot>
}
const entryCache = new Map<string, EntryCache>()
const entryFlights = new Map<string, EntryFlight>()
// Never evict an unexpired request gate when snapshot dates rotate.
const auctionRequestGates = new Map<string, { attempt: EntryAttempt; pending: boolean; startedMonotonicMs: number }>()
let activeGeneration = 0

// ===== 题材列异步填充 =====
let _conceptCache: { key: string; data: Map<string, string[]> } | null = null
let _conceptFetchInFlight = false

/** 将缓存好的题材数据 apply 到快照中所有 conceptNames 为空的股票 */
function applyConceptToSnap(snap: MorningAuctionSnapshot, data: Map<string, string[]>): void {
  const pools: MorningAuctionStock[][] = [
    snap.threeOne.firstBoard, snap.threeOne.secondBoard,
    snap.threeOne.brokenBoard, snap.threeOne.brokenConsec,
    snap.threeOne.allMarket,
    snap.weakToStrong.badBoard, snap.weakToStrong.tailAttack,
    snap.weakToStrong.brokenBoard, snap.weakToStrong.afternoonReseal,
    snap.weakToStrong.reversal,
    snap.boardCategory.first, snap.boardCategory.second,
    snap.boardCategory.third, snap.boardCategory.n
  ]
  for (const pool of pools) {
    for (const s of pool) {
      if (s.conceptNames.length === 0 && data.has(s.tsCode)) {
        s.conceptNames = data.get(s.tsCode) ?? []
      }
    }
  }
}

/**
 * 异步补查题材数据（fire-and-forget）。
 * 对 DB 无题材记录的股票，批量调 fetchKplConceptConsByStock 补查并写入 DB，
 * 最终 in-place 更新 cachedSnapshot 中对应字段，前端二次 get() 即可拿到数据。
 */
async function mergeConceptData(snap: MorningAuctionSnapshot, tradeDate: string): Promise<void> {
  const source = snap.readiness?.source
  const owns = () => entryCache.get(tradeDate)?.snapshot === snap
    && entryCache.get(tradeDate)?.generation === activeGeneration && getConceptSource() === source
  if (!owns() || source !== 'kpl' || tradeDate !== getBeijingYmd()) return
  const key = JSON.stringify([tradeDate, source, [...new Set(getSnapshotPools(snap).flat().map(stock => stock.tsCode))].sort()])
  // 缓存命中直接 apply
  if (_conceptCache && _conceptCache.key === key) {
    applyConceptToSnap(snap, _conceptCache.data)
    applyThemeAttributionToSnapshot(snap)
    return
  }
  if (_conceptFetchInFlight) return
  _conceptFetchInFlight = true
  try {
    const db = getDb()
    const cfg = getDataSourceConfig(db)
    if (!cfg.tushareEnabled || !cfg.tushareTokenEncrypted) return
    const token = decryptApiKey(cfg.tushareTokenEncrypted)
    if (!token) return

    // 收集全部 conceptName===null 的股票（去重）
    const allPools: MorningAuctionStock[][] = [
      snap.threeOne.firstBoard, snap.threeOne.secondBoard,
      snap.threeOne.brokenBoard, snap.threeOne.brokenConsec,
      snap.threeOne.allMarket,
      snap.weakToStrong.badBoard, snap.weakToStrong.tailAttack,
      snap.weakToStrong.brokenBoard, snap.weakToStrong.afternoonReseal,
      snap.weakToStrong.reversal,
      snap.boardCategory.first, snap.boardCategory.second,
      snap.boardCategory.third, snap.boardCategory.n
    ]
    const missingCodes = [...new Set(allPools.flat().filter(s => s.conceptNames.length === 0).map(s => s.tsCode))]
    if (missingCodes.length === 0) return

    // 分批并发（每批 5 只）补查 Tushare kpl_concept_cons，结果写入 DB
    const resultMap = new Map<string, string[]>()
    const BATCH = 5
    for (let i = 0; i < missingCodes.length; i += BATCH) {
      if (!owns()) return
      const batch = missingCodes.slice(i, i + BATCH)
      await Promise.all(batch.map(async (tsCode) => {
        try {
          const rows = await fetchKplConceptConsByStock(token, tsCode)
          if (!owns()) return
          if (rows.length > 0) {
            insertConceptMembersIfAbsent(db, rows)
            // 按 hotNum 降序存全部题材名，并去重（API 可能返回同名重复行）
            const sorted = rows.slice().sort((a, b) => (b.hotNum ?? 0) - (a.hotNum ?? 0))
            resultMap.set(tsCode, [...new Set(sorted.map(r => r.name ?? '').filter(s => s !== ''))])
          } else {
            resultMap.set(tsCode, [])
          }
        } catch {
          resultMap.set(tsCode, [])
        }
      }))
    }

    if (!owns()) return
    _conceptCache = { key, data: resultMap }
    applyConceptToSnap(snap, resultMap)
    applyThemeAttributionToSnapshot(snap)
  } catch (err) {
    console.error('[mergeConceptData] failed, conceptNames will remain empty:', err)
  } finally {
    _conceptFetchInFlight = false
  }
}

// ===== FR-134/266: N 日涨跌风险列与增量完整性 =====
const priceHistoryCoordinator = new MorningAuctionPriceHistoryCoordinator(async (tradeDate, tsCodes) => {
  const db = getDb()
  let token: string | null = null
  try {
    const config = getDataSourceConfig(db)
    token = config.tushareEnabled && config.tushareTokenEncrypted
      ? decryptApiKey(config.tushareTokenEncrypted)
      : null
  } catch {
    token = null
  }
  return loadMorningAuctionPriceHistoryEntries(tradeDate, tsCodes, {
    queryLocal: (codes, startDate) => queryDailyClose(db, codes, startDate),
    fetchRemote: token
      ? async (tsCode, startDate, endDate) => {
          const rows = await fetchDailyForCandidates(token, [tsCode], startDate, endDate)
          if (rows.length > 0) upsertDailyClose(db, rows)
          return rows
        }
      : undefined,
  })
})

function applyHistoryToSnap(
  snap: MorningAuctionSnapshot,
  data: Map<string, MorningAuctionPriceHistoryEntry>,
): void {
  for (const pool of getSnapshotPools(snap)) {
    for (const stock of pool) {
      const entry = data.get(stock.tsCode)
      if (!entry) continue
      stock.pctChg3d = entry.p3d
      stock.pctChg5d = entry.p5d
      stock.priceHistory = {
        state: entry.state,
        availableDays: entry.availableDays,
        reason: entry.reason,
        remoteAttempted: entry.remoteAttempted,
      }
    }
  }
}

async function mergePriceHistory(
  snap: MorningAuctionSnapshot,
  tradeDate: string,
  options: { retryUnresolved?: boolean; localOnly?: boolean } = {},
): Promise<void> {
  const tsCodes = [...new Set(getSnapshotPools(snap).flat().map(stock => stock.tsCode))]
  if (tsCodes.length === 0) {
    snap.priceHistoryCoverage = priceHistoryCoordinator.getCoverage(tradeDate, [])
    return
  }
  if (options.localOnly) {
    const entries = await loadMorningAuctionPriceHistoryEntries(tradeDate, tsCodes, {
      queryLocal: (codes, startDate) => queryDailyClose(getDb(), codes, startDate),
    })
    applyHistoryToSnap(snap, entries)
    snap.priceHistoryCoverage = buildMorningAuctionPriceHistoryCoverage(tsCodes, entries)
    return
  }
  const entries = await priceHistoryCoordinator.ensure(tradeDate, tsCodes, options)
  applyHistoryToSnap(snap, entries)
  snap.priceHistoryCoverage = priceHistoryCoordinator.getCoverage(tradeDate, tsCodes)
}

/**
 * 把目标交易日收盘事实投影到全部竞价候选。daily_close_cache覆盖全市场，
 * limit_list_daily只作为旧缓存缺失时的保真兜底。
 */
function mergeTradeDateClose(
  snap: MorningAuctionSnapshot,
  tradeDate: string,
  options: { replaceExisting: boolean },
): void {
  const db = getDb()
  const stocks = getSnapshotPools(snap).flat()
  const tsCodes = [...new Set(stocks.map(stock => stock.tsCode))]
  if (tsCodes.length === 0) return
  const closeMap = new Map<string, MorningAuctionCloseFact>()
  for (const r of getLimitListByDate(db, tradeDate)) {
    closeMap.set(r.tsCode, { close: r.close, pctChg: r.pctChg })
  }
  for (const [tsCode, rows] of queryDailyCloseExact(db, tsCodes, tradeDate)) {
    const row = rows[0]
    if (!row) continue
    closeMap.set(tsCode, { close: row.close, pctChg: row.pctChg })
  }
  applyMorningAuctionCloseProjection(stocks, closeMap, options)
}

/**
 * 从 sharedRtKCache 将当前实时价格 merge 到快照中的每条股票。
 * 缓存为 null（尚未拉取或盘前）时静默跳过，currentPrice 保持 null。
 */
function mergeCurrentPrices(snap: MorningAuctionSnapshot): void {
  const cache = getRtKCache()
  if (!cache) return

  const fillStock = (s: MorningAuctionStock): void => {
    const entry = cache.get(s.tsCode)
    if (entry) {
      s.currentPrice = entry.price
      s.currentPctChg = entry.change
      s.currentAmount = entry.amount
    }
  }

  const pools: MorningAuctionStock[][] = [
    snap.threeOne.firstBoard,
    snap.threeOne.secondBoard,
    snap.threeOne.brokenBoard,
    snap.threeOne.brokenConsec,
    snap.threeOne.allMarket,
    snap.weakToStrong.badBoard,
    snap.weakToStrong.tailAttack,
    snap.weakToStrong.brokenBoard,
    snap.weakToStrong.afternoonReseal,
    snap.weakToStrong.reversal,
    snap.boardCategory.first,
    snap.boardCategory.second,
    snap.boardCategory.third,
    snap.boardCategory.n
  ]
  for (const pool of pools) {
    for (const s of pool) fillStock(s)
  }
}

function getSnapshotPools(snap: MorningAuctionSnapshot): MorningAuctionStock[][] {
  return [
    snap.threeOne.firstBoard,
    snap.threeOne.secondBoard,
    snap.threeOne.brokenBoard,
    snap.threeOne.brokenConsec,
    snap.threeOne.allMarket,
    snap.weakToStrong.badBoard,
    snap.weakToStrong.tailAttack,
    snap.weakToStrong.brokenBoard,
    snap.weakToStrong.afternoonReseal,
    snap.weakToStrong.reversal,
    snap.boardCategory.first,
    snap.boardCategory.second,
    snap.boardCategory.third,
    snap.boardCategory.n,
  ]
}

function applyThemeAttributionToSnapshot(snap: MorningAuctionSnapshot): void {
  const uniqueStocks = [...new Map(
    getSnapshotPools(snap).flat().map((stock) => [stock.tsCode, stock]),
  ).values()]

  const db = getDb()
  const previousTradeDate = snap.readiness?.previousTradeDate ?? null
  const directFacts = new Map<string, MorningAuctionDirectThemeFact>()
  if (previousTradeDate) {
    for (const row of getKplListByDate(db, previousTradeDate)) {
      const themes = splitMorningAuctionThemeNames(row.theme)
      if (themes.length === 0 && !row.luDesc) continue
      directFacts.set(row.tsCode, {
        tradeDate: row.tradeDate,
        themes,
        reason: row.luDesc,
      })
    }
  }

  const attributionByCode = buildMorningAuctionThemeAttributions(
    uniqueStocks.map((stock) => ({
      tsCode: stock.tsCode,
      stockName: stock.stockName,
      conceptNames: stock.conceptNames,
      pctChg: stock.pctChg,
      auctionAmount: stock.auctionAmount,
    })),
    directFacts,
  )
  for (const pool of getSnapshotPools(snap)) {
    for (const stock of pool) {
      stock.themeAttribution = attributionByCode.get(stock.tsCode) ?? null
    }
  }

  const flowTradeDate = getLatestVerifiedObservationDateBefore(db, snap.tradeDate)
  const flowItems = flowTradeDate
    ? listSectorFlowObservations(db, flowTradeDate, 'eastmoney').filter((item) => item.mainNetInflow != null)
    : []
  snap.marketThemes = buildMorningAuctionMarketThemes(
    uniqueStocks.map((stock) => ({
      tsCode: stock.tsCode,
      stockName: stock.stockName,
      pctChg: stock.pctChg,
      auctionAmount: stock.auctionAmount,
      attribution: stock.themeAttribution ?? null,
    })),
    flowItems,
    flowTradeDate,
  )
}

function readEntryInputs(tradeDate: string): EntryInputs {
  const db = getDb()
  const context = resolveEntryDate(readKnownCalendar(db), tradeDate, Date.now())
  const source = getConceptSource()
  // Facts first: an unknown predecessor never prevents this exact-date read.
  const auction = context.status === 'open' ? queryStkAuctionByDate(db, tradeDate) : []
  const limits = context.status === 'open' && context.previousTradeDate ? getLimitListByDate(db, context.previousTradeDate) : []
  return { context, source, auction, limits, fingerprint: entryFingerprint(context, source, auction, limits) }
}

// Match the builder's previous-day structural inputs, BEFORE auction thresholds.
// A stale row excluded by a price threshold is still a dependency of a "no match" result.
function isPreviousPoolInput(row: LimitListDailyRow, group: string, name: string): boolean {
  const times = row.limitTimes ?? 0
  const opens = row.openTimes ?? 0
  const up = row.limit === 'U'
  if (group === 'threeOne') {
    if (name === 'firstBoard') return up && opens < 1 && times < 2
    if (name === 'secondBoard') return up && opens < 1 && times >= 2
    if (name === 'brokenBoard') return up && opens >= 1
    if (name === 'brokenConsec') return !up && times >= 2
  }
  if (group === 'boardCategory') {
    if (name === 'first') return up && times < 4 && times !== 2 && times !== 3
    if (name === 'second') return up && times === 2
    if (name === 'third') return up && times === 3
    if (name === 'n') return up && times >= 4
  }
  if (group === 'weakToStrong') {
    if (name === 'badBoard') return up && opens >= 3
    if (name === 'tailAttack') return up && parseTimeToMinutes(row.firstTime ?? '') >= 14 * 60 + 30
    if (name === 'brokenBoard') return !up && row.limit !== 'D' && times >= 2
    if (name === 'afternoonReseal') {
      const first = parseTimeToMinutes(row.firstTime ?? '')
      return up && opens >= 1 && first > 0 && first < 12 * 60 && parseTimeToMinutes(row.lastTime ?? '') > 13 * 60
    }
    if (name === 'reversal') return row.limit === 'D'
  }
  return true // Unknown future pool: conservatively retain all previous-day dependencies.
}

function attachReadiness(snap: MorningAuctionSnapshot, input: EntryInputs, attempt: EntryAttempt | null): void {
  const now = Date.now()
  const meta = describeEntry(input.context, input.source, input.fingerprint, input.auction, input.limits, now, attempt)
  const auctionMap = new Map(input.auction.filter(row => validAuctionFact(row, snap.tradeDate)).map(row => [row.tsCode, row]))
  const previous = input.limits.filter(row => validPreviousLimit(row, input.context.previousTradeDate))
  const provisional = input.context.tradeDate === input.context.today && now < getBeijingEpochForYmd(snap.tradeDate, 9, 30)
  for (const [group, pools] of Object.entries({ threeOne: snap.threeOne, weakToStrong: snap.weakToStrong, boardCategory: snap.boardCategory })) {
    for (const [name, stocks] of Object.entries(pools)) {
      const independent = group === 'threeOne' && name === 'allMarket'
      const dependencies = independent ? input.auction
        : previous.filter(row => isPreviousPoolInput(row, group, name)).map(row => auctionMap.get(row.tsCode))
      const incompleteObservation = dependencies.some(row => !row || cutoffObservation(row, snap.tradeDate, now) === null)
      const reason = input.context.status !== 'open' ? input.context.reasonCode
        : !independent && !input.context.previousTradeDate ? 'PREVIOUS_TRADE_DATE_UNKNOWN'
          : !independent && meta.previousLimit.validRows === 0 ? 'PREVIOUS_LIMIT_MISSING_OR_INVALID'
            : !meta.auction.validRows ? 'AUCTION_MISSING_OR_INVALID'
              : independent && !meta.auction.allMarketInputRows ? 'AUCTION_FIELDS_MISSING' : null
      const partial = provisional || incompleteObservation
        || (independent ? meta.auction.invalidRows > 0 || meta.auction.allMarketInputRows < meta.auction.validRows
          : meta.previousLimit.state === 'partial')
      meta.pools[group + '.' + name] = { state: reason ? 'blocked' : partial ? 'partial' : stocks.length ? 'ready' : 'no_match',
        reasonCode: reason ?? (incompleteObservation ? 'AUCTION_OBSERVATION_INCOMPLETE'
          : partial ? 'PARTIAL_OR_PROVISIONAL_INPUT' : stocks.length ? 'COMPUTED_FROM_OBSERVED_FACTS' : 'NO_MATCH'),
        candidates: stocks.length }
    }
  }
  snap.readiness = meta
}

function blockedEntry(input: EntryInputs, reason: string, retryable = false): MorningAuctionSnapshot {
  const snap = createEmptyMorningAuctionSnapshot(input.context.tradeDate)
  attachReadiness(snap, input, null)
  snap.readiness!.phase = 'blocked'
  snap.readiness!.reasonCode = reason
  snap.readiness!.retryable = retryable
  for (const pool of Object.values(snap.readiness!.pools)) Object.assign(pool, { state: 'blocked', reasonCode: reason })
  return snap
}

async function acquireAuction(input: EntryInputs, attempt: EntryAttempt): Promise<EntryAttempt> {
  const startedAt = attempt.startedAt
  const controller = new AbortController()
  const deadlineMs = startedAt + AUCTION_REQUEST_MS
  const timer = setTimeout(() => controller.abort(), AUCTION_REQUEST_MS)
  try {
    const db = getDb()
    const cfg = getDataSourceConfig(db)
    const token = cfg.tushareEnabled && cfg.tushareTokenEncrypted ? decryptApiKey(cfg.tushareTokenEncrypted) : null
    if (!token) return attempt
    const remote = await fetchStkAuction(token, input.context.tradeDate, undefined, {
      deadlineMs, signal: controller.signal, maxPages: 4, maxAttempts: 1, retryDelayMs: 0,
    })
    if (controller.signal.aborted || Date.now() >= deadlineMs) throw new Error('TUSHARE_REQUEST_TIMEOUT')
    const current = readEntryInputs(input.context.tradeDate)
    if (current.context.status !== 'open') throw new Error('CALENDAR_UNAVAILABLE')
    if (!remote.length) {
      attempt.outcome = 'empty'
      attempt.reasonCode = 'UPSTREAM_EMPTY'
      return attempt
    }
    const merged = mergeAuctionFacts(current.auction, remote, input.context.tradeDate, startedAt)
    try { upsertStkAuctionCache(db, merged.rows) } catch { throw new Error('PERSIST_FAILED') }
    attempt.outcome = merged.partial ? 'partial' : 'success'
    attempt.reasonCode = merged.partial ? 'PARTIAL_OBSERVATION_RETAINED_FACTS' : 'OBSERVED_ROWS_PERSISTED'
  } catch (error) {
    attempt.outcome = 'failed'
    attempt.reasonCode = Date.now() >= deadlineMs ? 'TUSHARE_REQUEST_TIMEOUT' : entryFailureCode(error)
  } finally {
    clearTimeout(timer)
    attempt.endedAt = Date.now()
  }
  return attempt
}

async function executeEntry(tradeDate: string, flight: EntryFlight): Promise<MorningAuctionSnapshot> {
  let input = readEntryInputs(tradeDate)
  if (input.context.status !== 'open') return blockedEntry(input, input.context.reasonCode)
  const prior = entryCache.get(tradeDate)
  const now = Date.now()
  // Audit timestamps stay on the wall clock; admission and capacity expiry use elapsed time only.
  const monotonicNow = performance.now()
  // Only completed, expired gates can free capacity. In-flight ownership is not a cache entry.
  for (const [date, gate] of auctionRequestGates) {
    if (!gate.pending && monotonicNow - gate.startedMonotonicMs >= AUCTION_RETRY_COOLDOWN_MS) auctionRequestGates.delete(date)
  }
  const gate = auctionRequestGates.get(tradeDate)
  let attempt = gate?.attempt ?? prior?.lastAttempt ?? null
  const state = describeEntry(input.context, input.source, input.fingerprint, input.auction, input.limits, now, attempt)
  const allowed = tradeDate < input.context.today || now >= getBeijingEpochForYmd(tradeDate, 9, 28)
  const changed = prior && prior.fingerprint !== input.fingerprint
  const needsObservation = !state.auction.validRows
    || (tradeDate === input.context.today && state.phase === 'due_unconfirmed')
  if (allowed && !gate && (flight.force || (!changed && needsObservation))) {
    attempt = { targetTradeDate: tradeDate, startedAt: now, endedAt: now, source: 'tushare',
      outcome: 'blocked', reasonCode: 'AUCTION_REQUEST_CAPACITY' }
    if (auctionRequestGates.size < MAX_AUCTION_COOLDOWNS) {
      attempt.reasonCode = 'NOT_CONFIGURED'
      const admitted = { attempt, pending: true, startedMonotonicMs: performance.now() }
      // Reserve synchronously, before the first transport await.
      auctionRequestGates.set(tradeDate, admitted)
      try { attempt = await acquireAuction(input, attempt) } finally { admitted.pending = false }
    }
  }

  // At most two builds, the second local-only; never chase a writer indefinitely.
  for (let pass = 0; pass < 2; pass++) {
    input = readEntryInputs(tradeDate)
    if (input.context.status !== 'open') return blockedEntry(input, input.context.reasonCode)
    const cached = entryCache.get(tradeDate)
    const reusable = cached?.fingerprint === input.fingerprint
    const snap = reusable ? structuredClone(cached.snapshot) : await buildRealMorningAuctionSnapshot(input)
    attachReadiness(snap, input, attempt)
    if (!reusable) await mergePriceHistory(snap, tradeDate, { localOnly: Boolean(prior) || pass > 0 })
    try { applyThemeAttributionToSnapshot(snap) } catch { /* Optional attribution cannot erase valid auction facts. */ }
    const latest = readEntryInputs(tradeDate)
    if (latest.fingerprint !== input.fingerprint) {
      if (pass === 0) continue
      return blockedEntry(latest, 'DATA_CHANGED_RETRY', true)
    }
    const current = isCurrentMorningAuctionTradeDate(tradeDate, getBeijingYmd())
    mergeTradeDateClose(snap, tradeDate, { replaceExisting: !current })
    if (current) mergeCurrentPrices(snap)
    attachReadiness(snap, input, attempt)
    // A late request can return its own facts, never overwrite a newer active generation.
    if (flight.generation === activeGeneration && getConceptSource() === input.source) {
      const entry: EntryCache = { snapshot: snap, fingerprint: input.fingerprint, generation: flight.generation,
        lastAttempt: attempt, publishedFingerprint: cached?.publishedFingerprint }
      entryCache.delete(tradeDate)
      entryCache.set(tradeDate, entry)
      while (entryCache.size > MAX_ENTRY_DATES) entryCache.delete(entryCache.keys().next().value!)
      if (tradeDate === flight.startedToday && tradeDate === getBeijingYmd()
        && Date.now() >= getBeijingEpochForYmd(tradeDate, 9, 28)) {
        const eligible = new Map(input.auction.map(row => [row.tsCode, signalObservation(row, tradeDate, Date.now())] as const)
          .filter((pair): pair is readonly [string, number] => pair[1] !== null))
        // Persistent lookup and emit are synchronous: no publisher can interleave here.
        emitMorningAuctionDecisionSignals(snap, eligible, entry.publishedFingerprint !== input.fingerprint)
        entry.publishedFingerprint = input.fingerprint
      }
      void mergeConceptData(snap, tradeDate)
    }
    return structuredClone(snap)
  }
  return blockedEntry(input, 'DATA_CHANGED_RETRY', true)
}

function enterMorningAuction(tradeDate: string, force: boolean): Promise<MorningAuctionSnapshot> {
  const running = entryFlights.get(tradeDate)
  if (running) { running.force ||= force; return running.promise.then(snap => structuredClone(snap)) }
  if (entryFlights.size >= MAX_ENTRY_DATES) return Promise.resolve(blockedEntry(readEntryInputs(tradeDate), 'ENTRY_BUSY', true))
  const flight: EntryFlight = { force, generation: ++activeGeneration, startedToday: getBeijingYmd(),
    promise: Promise.resolve(createEmptyMorningAuctionSnapshot(tradeDate)) }
  entryFlights.set(tradeDate, flight)
  flight.promise = Promise.resolve().then(() => executeEntry(tradeDate, flight)).finally(() => {
    if (entryFlights.get(tradeDate) === flight) entryFlights.delete(tradeDate)
  })
  return flight.promise.then(snap => structuredClone(snap))
}

export function getOrCreateMorningAuctionSnapshot(tradeDate: string): Promise<MorningAuctionSnapshot> {
  return enterMorningAuction(tradeDate, false)
}

export function getCachedMorningAuctionSnapshot(tradeDate: string): MorningAuctionSnapshot | null {
  const entry = entryCache.get(tradeDate)
  if (!entry) return null
  const input = readEntryInputs(tradeDate)
  if (input.context.status !== 'open' || input.fingerprint !== entry.fingerprint) return null
  const snap = structuredClone(entry.snapshot)
  attachReadiness(snap, input, entry.lastAttempt)
  return snap
}

export function refreshMorningAuctionSnapshot(tradeDate: string): Promise<MorningAuctionSnapshot> {
  return enterMorningAuction(tradeDate, true)
}

function emitMorningAuctionDecisionSignals(snap: MorningAuctionSnapshot, eligible: Map<string, number>, newObservation: boolean): void {
  if (!eligible.size) return
  try {
    if (newObservation) dismissOneWordMorningAuctionSignals(snap, eligible)
    const existing = getDb().prepare('SELECT 1 FROM decision_signals WHERE dedup_key = ?')

    const candidates = snap.threeOne.allMarket
      .filter((stock) => eligible.has(stock.tsCode) && !isAuctionOneWordBoard(stock))
      .slice(0, 12)
    if (candidates.length === 0) return
    const signals: DecisionSignalInput[] = candidates
      .filter((s) => s.pctChg >= 3 && s.auctionAmount >= 500
        && !existing.get(`short_term:morningAuction.allMarket:${snap.tradeDate}:${s.tsCode}`))
      .map((s, idx) => ({
        signalTime: eligible.get(s.tsCode),
        sourceModule: 'short_term',
        strategyKey: 'morningAuction.allMarket',
        tsCode: s.tsCode,
        stockName: s.stockName,
        signalType: 'OPPORTUNITY',
        direction: 'BULLISH',
        priority: idx < 3 || s.pctChg >= 6 ? 4 : 3,
        score: Math.min(100, s.pctChg * 8 + s.auctionTurnover * 20),
        confidence: 65,
        title: `${s.stockName} 集合竞价异动`,
        summary: `竞价涨幅 ${s.pctChg.toFixed(2)}%, 竞价金额 ${s.auctionAmount.toFixed(0)} 万元, 换手率 ${s.auctionTurnover.toFixed(2)}%。`,
        reason: {
          auctionPrice: s.auctionPrice,
          pctChg: s.pctChg,
          auctionAmount: s.auctionAmount,
          auctionTurnover: s.auctionTurnover,
          conceptNames: s.conceptNames,
        },
        sourceRef: { tradeDate: snap.tradeDate, pool: 'allMarket', observedAt: eligible.get(s.tsCode), phase: snap.readiness?.phase },
        dedupKey: `short_term:morningAuction.allMarket:${snap.tradeDate}:${s.tsCode}`,
      }))
    if (signals.length) emitDecisionSignals(getDb(), signals)
  } catch (err) {
    console.warn('[morningAuction] emit decision signals failed:', err)
  }
}

function dismissOneWordMorningAuctionSignals(snap: MorningAuctionSnapshot, eligible: Map<string, number>): void {
  const dedupKeys = snap.threeOne.allMarket
    .filter(stock => eligible.has(stock.tsCode) && isAuctionOneWordBoard(stock))
    .map((stock) => `short_term:morningAuction.allMarket:${snap.tradeDate}:${stock.tsCode}`)
  if (dedupKeys.length === 0) return

  const placeholders = dedupKeys.map(() => '?').join(',')
  getDb().prepare(`
    UPDATE decision_signals
    SET status = 'DISMISSED', updated_at = ?
    WHERE dedup_key IN (${placeholders})
      AND status IN ('NEW', 'READ', 'WATCHING')
  `).run(Date.now(), ...dedupKeys)
}
