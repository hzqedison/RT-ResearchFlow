/** Pure public contracts. Callers must generate a fresh, non-sensitive UUID v4. */
export const SUPPORT_ERROR_CODES = [
  'CONFIG_MISSING', 'CREDENTIAL_STORAGE_UNAVAILABLE', 'PROVIDER_PERMISSION_DENIED',
  'NETWORK_FAILED', 'DATA_MISSING', 'DATA_STALE', 'INVALID_INPUT',
  'DATABASE_UNAVAILABLE', 'CLIENT_UNSUPPORTED', 'TRADE_RESULT_UNKNOWN', 'INTERNAL_ERROR'
] as const

export type SupportErrorCode = typeof SUPPORT_ERROR_CODES[number]
export type SupportModule = typeof SUPPORT_MODULES[number]

export const SUPPORT_PREVIEW_TTL_MS = 5 * 60 * 1000

export interface SupportDiagnosticPreview {
  readonly previewId: string
  readonly expiresAt: number
  readonly package: SupportDiagnosticPackage
  readonly json: string
}

export type SupportFeedbackResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly status: 'expired' | 'busy' | 'invalid' | 'failed'
      readonly error: PublicOperationError
    }

export interface SupportFeedbackSaveOutcome {
  readonly status: 'saved' | 'cancelled'
  readonly message: string
}

export interface PublicOperationError {
  readonly code: SupportErrorCode
  readonly message: string
  readonly action: string
  readonly retryable: boolean
  readonly correlationId: string
}

export type OperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PublicOperationError }

type ErrorDefinition = Readonly<Pick<PublicOperationError, 'message' | 'action' | 'retryable'>>

const definitions: Record<SupportErrorCode, ErrorDefinition> = {
  CONFIG_MISSING: { message: '缺少此操作所需的配置。', action: '打开配置页面，补全所需设置后再操作。', retryable: false },
  CREDENTIAL_STORAGE_UNAVAILABLE: { message: '系统安全凭证存储暂时不可用，密钥未能安全保存。', action: '检查系统凭证存储是否可用，再重新保存密钥。', retryable: false },
  PROVIDER_PERMISSION_DENIED: { message: '提供方尚未授权使用这项能力。', action: '检查提供方的开通与授权要求，或选择支持该能力的数据源。', retryable: false },
  NETWORK_FAILED: { message: '读取请求未能连接到提供方。', action: '检查网络连接后，重试这次读取请求。', retryable: true },
  DATA_MISSING: { message: '缺少此操作所需的数据。', action: '检查数据源是否支持该能力，并补齐所需数据。', retryable: false },
  DATA_STALE: { message: '此操作所需的数据已过期。', action: '更新所需数据，并核对数据的实际截止时间。', retryable: false },
  INVALID_INPUT: { message: '输入内容不符合要求。', action: '使用规定的字段和格式，并确保内容未超过大小限制。', retryable: false },
  DATABASE_UNAVAILABLE: { message: '本地数据库暂时不可用。', action: '检查本地存储空间和访问权限，并按应用恢复指引处理。', retryable: false },
  CLIENT_UNSUPPORTED: { message: '当前客户端不支持此操作。', action: '查看客户端能力说明和配置指引，确认支持范围。', retryable: false },
  TRADE_RESULT_UNKNOWN: { message: '交易提交结果尚未确认。', action: '请查询委托并核对账户记录；核实结果前不要重复提交。', retryable: false },
  INTERNAL_ERROR: { message: '此操作未能完成。', action: '记录关联编号，用于本地排查和反馈。', retryable: false }
}

export const SUPPORT_PLATFORMS = ['win32', 'darwin', 'linux'] as const
export const SUPPORT_ARCHITECTURES = ['x64', 'arm64', 'ia32', 'arm'] as const
export const SUPPORT_MODULES = ['configuration', 'data', 'research', 'strategy', 'trading', 'portfolio', 'runtime', 'update'] as const
export const SUPPORT_PROVIDERS = ['tushare', 'tdx', 'tencent', 'eastmoney', 'iwencai', 'akshare', 'deepseek', 'openai', 'anthropic', 'dashscope', 'ths', 'local'] as const
export const SUPPORT_FEATURES = ['stock-basic', 'daily-bars', 'adjustment-factors', 'trading-calendar', 'auction', 'benchmarks', 'research-index', 'ai-analysis', 'order-submit', 'order-query', 'order-cancel', 'account-query'] as const
export const SUPPORT_CAPABILITY_SUPPORT_STATES = ['supported', 'unsupported', 'requires-setup'] as const
export const SUPPORT_CAPABILITY_AVAILABILITY_STATES = ['ready', 'partial', 'unavailable', 'unknown'] as const

export const SUPPORT_DIAGNOSTIC_LIMITS = Object.freeze({
  errorEvents: 64,
  capabilities: 32,
  versionLength: 40,
  buildIdLength: 40,
  correlationIdLength: 36,
  timestampLength: 24
})

export interface SupportErrorEvent {
  readonly code: SupportErrorCode
  readonly id: string
  readonly timestamp: string
  readonly module: typeof SUPPORT_MODULES[number]
}

export interface SupportCapabilityState {
  readonly provider: typeof SUPPORT_PROVIDERS[number]
  readonly feature: typeof SUPPORT_FEATURES[number]
  readonly support: typeof SUPPORT_CAPABILITY_SUPPORT_STATES[number]
  readonly availability: typeof SUPPORT_CAPABILITY_AVAILABILITY_STATES[number]
  readonly observedAt: string
  readonly asOf: string | null
}

export interface SupportDiagnosticPackage {
  readonly schemaVersion: 1
  readonly app: { readonly version: string; readonly buildId: string }
  readonly platform: typeof SUPPORT_PLATFORMS[number]
  readonly arch: typeof SUPPORT_ARCHITECTURES[number]
  readonly errorEvents: readonly SupportErrorEvent[]
  readonly capabilities: readonly SupportCapabilityState[]
}

export function isValidCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

/** No raw exception argument exists, and messages/actions always come from this module. */
export function createPublicOperationError(
  code: SupportErrorCode,
  correlationId: string
): PublicOperationError {
  if (!isValidCorrelationId(correlationId)) {
    throw new TypeError('A fresh non-sensitive UUID v4 correlation identifier is required.')
  }
  const safeCode = member(SUPPORT_ERROR_CODES, code) ? code : 'INTERNAL_ERROR'
  return Object.freeze({ code: safeCode, ...definitions[safeCode], correlationId })
}

const invalidField = Symbol('invalid-field')

function plainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

/** Never evaluates ordinary property getters, including inherited getters. */
function field(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value : invalidField
  } catch {
    return invalidField
  }
}

function member<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && value.length <= 64 && values.includes(value)
}

function version(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > SUPPORT_DIAGNOSTIC_LIMITS.versionLength) return false
  // Bounded SemVer; prerelease identifiers are numeric or familiar release channels.
  return /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-(?:alpha|beta|rc)(?:\.(?:0|[1-9]\d{0,5}))?)?$/.test(value)
}

function buildId(value: unknown): value is string {
  if (value === 'unknown') return true
  return typeof value === 'string' && value.length <= SUPPORT_DIAGNOSTIC_LIMITS.buildIdLength &&
    /^[0-9a-f]{7,40}$/i.test(value)
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > SUPPORT_DIAGNOSTIC_LIMITS.timestampLength ||
    !/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) return false
  const canonical = value.length === 20 ? value.slice(0, -1) + '.000Z' : value
  return new Date(milliseconds).toISOString() === canonical
}

function boundedArray<T>(input: unknown, limit: number, parse: (item: unknown) => T | null): readonly T[] | null {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return null
    const length = field(input, 'length')
    if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > limit) return null
    const output: T[] = []
    for (let index = 0; index < length; index++) {
      const parsed = parse(field(input, String(index)))
      if (parsed === null) return null
      output.push(parsed)
    }
    return Object.freeze(output)
  } catch {
    return null
  }
}

function errorEvent(input: unknown): SupportErrorEvent | null {
  if (!plainObject(input)) return null
  const code = field(input, 'code')
  const id = field(input, 'id')
  const time = field(input, 'timestamp')
  const module = field(input, 'module')
  if (!member(SUPPORT_ERROR_CODES, code) || !isValidCorrelationId(id) ||
    !timestamp(time) || !member(SUPPORT_MODULES, module)) return null
  return Object.freeze({ code, id, timestamp: time, module })
}

function capability(input: unknown): SupportCapabilityState | null {
  if (!plainObject(input)) return null
  const provider = field(input, 'provider')
  const feature = field(input, 'feature')
  const support = field(input, 'support')
  const availability = field(input, 'availability')
  const observedAt = field(input, 'observedAt')
  const asOf = field(input, 'asOf')
  if (!member(SUPPORT_PROVIDERS, provider) || !member(SUPPORT_FEATURES, feature) ||
    !member(SUPPORT_CAPABILITY_SUPPORT_STATES, support) ||
    !member(SUPPORT_CAPABILITY_AVAILABILITY_STATES, availability) ||
    !timestamp(observedAt) || (asOf !== null && !timestamp(asOf))) return null
  if (support !== 'supported' && (availability === 'ready' || availability === 'partial')) return null
  return Object.freeze({ provider, feature, support, availability, observedAt, asOf })
}

/** Reconstructs allowlisted facts only. Invalid/oversized input returns a static failure. */
export function createSupportDiagnosticPackage(
  input: unknown,
  correlationId: string
): OperationResult<SupportDiagnosticPackage> {
  // Validate the caller contract before accessing any input object.
  const invalid = createPublicOperationError('INVALID_INPUT', correlationId)
  const failure = (): OperationResult<SupportDiagnosticPackage> => Object.freeze({ ok: false, error: invalid })
  if (!plainObject(input)) return failure()
  const app = field(input, 'app')
  if (!plainObject(app)) return failure()
  const appVersion = field(app, 'version')
  const appBuildId = field(app, 'buildId')
  const platform = field(input, 'platform')
  const arch = field(input, 'arch')
  if (!version(appVersion) || !buildId(appBuildId) ||
    !member(SUPPORT_PLATFORMS, platform) || !member(SUPPORT_ARCHITECTURES, arch)) return failure()
  const errorEvents = boundedArray(field(input, 'errorEvents'), SUPPORT_DIAGNOSTIC_LIMITS.errorEvents, errorEvent)
  if (errorEvents === null) return failure()
  const capabilities = boundedArray(field(input, 'capabilities'), SUPPORT_DIAGNOSTIC_LIMITS.capabilities, capability)
  if (capabilities === null) return failure()
  const value: SupportDiagnosticPackage = Object.freeze({
    schemaVersion: 1,
    app: Object.freeze({ version: appVersion, buildId: appBuildId }),
    platform, arch, errorEvents, capabilities
  })
  return Object.freeze({ ok: true, value })
}
