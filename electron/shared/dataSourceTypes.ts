export const DAILY_DATA_PROVIDERS = ['tushare', 'tencent', 'eastmoney', 'sina', 'tdx', 'akshare'] as const
export type DailyDataProvider = typeof DAILY_DATA_PROVIDERS[number]
export type ReportDataProvider = 'eastmoney' | 'akshare'
export type DataProbeProvider = DailyDataProvider | 'eastmoney-reports' | 'akshare-reports' | 'iwencai' | 'akshare-limit-pool'

export interface DataExtensionInstallProgress {
  running: boolean
  phase: 'idle' | 'checking' | 'creating' | 'downloading' | 'verifying' | 'complete' | 'failed'
  provider?: string
  message: string
}

export interface MultiSourcePreference {
  dailyProviders: DailyDataProvider[]
  reportProviders: ReportDataProvider[]
  wencaiEnabled: boolean
  pythonPath: string
}

export interface DataSourcePreference extends MultiSourcePreference {
  tushareEnabled: boolean
  hasTushareToken: boolean
  tushareVerification?: import('../main/services/tushareCredentialVerification').TushareVerification | null
  hasWencaiCookie: boolean
}

export interface SaveDataSourcePreference {
  tushareToken?: string
  tushareEnabled?: boolean
  dailyProviders?: DailyDataProvider[]
  reportProviders?: ReportDataProvider[]
  wencaiEnabled?: boolean
  pythonPath?: string
  wencaiCookie?: string
  clearWencaiCookie?: boolean
}

export interface ResearchReportReference {
  id: string
  stockCode: string
  title: string
  institution: string
  publishedAt: string
  pdfUrl: string | null
  providers: ReportDataProvider[]
}

export interface SourceReadStatus {
  provider: string
  state: 'ready' | 'empty' | 'failed' | 'cached'
  message: string
}

export interface ResearchReportResult {
  reports: ResearchReportReference[]
  statuses: SourceReadStatus[]
  fetchedAt: number
  metadataOnly: true
}

export interface WencaiResult {
  columns: string[]
  rows: Record<string, string | number | null>[]
  fetchedAt: number
  truncated: boolean
}

export interface DataSourceProbeResult {
  ok: boolean
  provider: DataProbeProvider
  message: string
  rows?: number
  latestTradeDate?: string | null
}

export type PublicLimitPoolDateBasis = 'request-only' | 'source-reported' | 'unknown'
export type PublicLimitPoolSource = 'akshare_eastmoney' | 'eastmoney_public'
export type PublicLimitPoolFilterField = 'pctChg' | 'fdAmountYuan' | 'firstTime' | 'openTimes' | 'limitTimes'

export interface PublicLimitPoolMetadata {
  // Stored batch verification time, not proof of source date or freshness.
  verifiedAt?: number | null
  dateBasis?: PublicLimitPoolDateBasis
  rowmissingFields?: Record<string, PublicLimitPoolFilterField[]>
  priceCheck?: 'matched-local-closes' | 'not-complete' | 'unknown'
}

export interface PublicLimitPoolObservationRow {
  tsCode: string
  name: string | null
  close: number
  pctChg: number | null
  fdAmountYuan: number | null
  firstTime: string | null
  openTimes: number | null
  limitTimes: number | null
  quality: 'available' | 'partial'
  missingFields?: PublicLimitPoolFilterField[]
}

export interface PublicLimitPoolObservationSnapshot extends PublicLimitPoolMetadata {
  recommendedTradeDate?: string | null
  tradeDate: string | null
  source: PublicLimitPoolSource
  rows: PublicLimitPoolObservationRow[]
}
