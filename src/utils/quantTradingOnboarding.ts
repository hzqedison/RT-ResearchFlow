export const QUANT_ONBOARDING_STORAGE_KEY = 'rt-researchflow.quant-onboarding.v1'

export type QuantRuntime = 'macos' | 'other'

export interface QuantOnboardingProgress {
  applicationRequested: boolean
  officialReplyReceived: boolean
  dataPermissionAcknowledged: boolean
}

export function normalizeQuantProgress(value: unknown): QuantOnboardingProgress {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const applicationRequested = input.applicationRequested === true
  return {
    applicationRequested,
    officialReplyReceived: applicationRequested && input.officialReplyReceived === true,
    dataPermissionAcknowledged: input.dataPermissionAcknowledged === true,
  }
}

export function parseQuantProgress(saved: string | null): QuantOnboardingProgress {
  if (!saved || saved.length > 4096) return normalizeQuantProgress(null)
  try {
    return normalizeQuantProgress(JSON.parse(saved))
  } catch {
    return normalizeQuantProgress(null)
  }
}

export function quantRuntimeFromPlatform(platform: string): QuantRuntime {
  return /^Mac/i.test(platform) ? 'macos' : 'other'
}

export function buildQuantDiagnostic(value: unknown, runtime: QuantRuntime) {
  const progress = normalizeQuantProgress(value)
  const blockers: string[] = []
  if (runtime !== 'macos') blockers.push('MAC_REQUIRED')
  if (!progress.applicationRequested) blockers.push('APPLICATION_NOT_REPORTED')
  if (!progress.officialReplyReceived) blockers.push('OFFICIAL_REPLY_NOT_REPORTED')
  if (!progress.dataPermissionAcknowledged) blockers.push('DATA_PERMISSION_NOT_ACKNOWLEDGED')
  blockers.push('LIVE_SESSION_NOT_VERIFIED', 'BROKER_PERMISSION_NOT_VERIFIED')

  // User-reported progress never grants trading authority. This progress report does not reflect the separately authorized live session.
  // Construct an allowlisted report instead of redacting arbitrary account data or logs.
  return {
    schemaVersion: 1,
    component: 'quant-trading-onboarding',
    guideVersion: 2,
    route: 'macos-ths-citics-local',
    runtime: runtime === 'macos' ? 'macos' : 'other',
    progress,
    verification: {
      brokerPermission: 'not_verified',
      macConnector: 'experimental_ui_bridge',
      canSubmitOrders: false as const,
    },
    blockers,
  }
}

export const QUANT_APPLICATION_REQUEST = [
  '我已有个人中信证券账户，使用同花顺 Mac 版。',
  '计划在 Mac 本机使用自编投研软件，通过同花顺完成本人逐笔确认的实盘交易，不使用 Windows 执行端或无人值守交易。',
  '请确认：现账户能否办理程序化交易、同花顺 Mac 是否有受支持的自动交易接口、需开通哪些权限，以及申请入口、协议报告、模拟环境、软件审核和费用要求。',
  '请提供适用于 Mac 的正式说明；Windows 版 QMT、SuperMind 或 iFinD 数据接口不能替代本需求的交易接口。',
].join('\n')

