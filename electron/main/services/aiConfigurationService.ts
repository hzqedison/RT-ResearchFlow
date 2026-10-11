import type { Database } from 'better-sqlite3'
import { getAIConfig, getProviderConfig, setProviderConfig, updateAIConfig, type AIConfigUpdate } from '../database/aiConfigRepository'
import { encryptRequiredApiKey } from '../utils/apiKeyEncryption'

const PROVIDERS = ['claude', 'chatgpt', 'qwen', 'deepseek']
const STRINGS = ['model', 'baseUrl', 'presetPrompt', 'trendForecastPrompt', 'trendForecastMorrowPrompt'] as const
const NUMBERS = ['maxArticlesPerBatch', 'maxContentCharsPerArticle', 'maxForecastsPerStock', 'maxForecastComparison', 'maxSkillChars'] as const
const ARRAYS = ['providerPriority', 'multiModelProviders', 'selectedSkills', 'customSkillPaths'] as const
const FIELDS = new Set<string>([...STRINGS, ...NUMBERS, ...ARRAYS, 'provider', 'apiKey', 'triggerRating', 'maxArticleAgeDays', 'autoCleanupDays', 'skillsForTrend', 'providerConfig'])
const PROVIDER_FIELDS = new Set<string>([...STRINGS, 'provider', 'apiKey', 'clearApiKey', 'maxTokens'])
function invalid(): never {
  throw new Error('AI_CONFIG_INVALID: 配置内容无效，请检查厂商、数字范围或密钥操作。原配置未修改。')
}
function record(value: unknown, allowed: Set<string>): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const data = value as Record<string, unknown>
  if (Object.keys(data).some(key => !allowed.has(key))) invalid()
  return data
}
function text(value: unknown, limit = 100_000): string {
  if (typeof value !== 'string' || value.length > limit) invalid()
  return value
}
function provider(value: unknown): string {
  if (typeof value !== 'string' || !PROVIDERS.includes(value)) invalid()
  return value
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid()
  return value
}
function stringList(value: unknown, providersOnly = false): string[] {
  if (!Array.isArray(value) || value.length > 128) invalid()
  const list = value.map(item => text(item, 4096))
  if (list.some(item => !item.trim() || (providersOnly && !PROVIDERS.includes(item)))) invalid()
  return [...new Set(list)]
}
function storedList(value: string | null | undefined): string[] {
  try { return stringList(JSON.parse(value || '[]'), true) } catch { return [] }
}

/** One transaction, explicit partial updates, and no plaintext fallback. */
export function saveAIConfiguration(db: Database, input: unknown): { ok: true } {
  try {
    return db.transaction(() => {
      const data = record(input, FIELDS)
      const current = getAIConfig(db)
      const update: AIConfigUpdate = {}
      if (data.provider !== undefined) update.provider = provider(data.provider)
      for (const field of STRINGS) {
        if (data[field] === undefined) continue
        if (field === 'model') update.model = text(data[field], 512)
        else if (data[field] === null && field.startsWith('trendForecast')) update[field] = null
        else update[field] = text(data[field]) || null
      }
      if (data.triggerRating !== undefined) {
        if (!['CRITICAL', 'IMPORTANT', 'GENERAL'].includes(String(data.triggerRating))) invalid()
        update.triggerRating = data.triggerRating as AIConfigUpdate['triggerRating']
      }
      for (const field of NUMBERS) {
        if (data[field] === undefined) continue
        const n = integer(data[field])
        update[field] = field === 'maxForecastsPerStock' ? Math.min(100, n)
          : field === 'maxForecastComparison' ? Math.min(10, n)
            : field === 'maxSkillChars' ? Math.min(100_000, Math.max(1000, n)) : n
      }
      for (const field of ['maxArticleAgeDays', 'autoCleanupDays'] as const) {
        if (data[field] !== undefined) update[field] = data[field] === null ? null : integer(data[field])
      }
      for (const field of ARRAYS) {
        if (data[field] !== undefined) update[field] = JSON.stringify(stringList(data[field], field === 'providerPriority' || field === 'multiModelProviders'))
      }
      if (data.skillsForTrend !== undefined) {
        if (typeof data.skillsForTrend !== 'boolean') invalid()
        update.skillsForTrend = data.skillsForTrend ? 1 : 0
      }
      const flatKey = data.apiKey === undefined ? '' : text(data.apiKey, 8192).trim()
      if (flatKey && data.providerConfig !== undefined) invalid()
      if (flatKey) {
        const target = provider(data.provider ?? current.provider)
        const encrypted = encryptRequiredApiKey(flatKey)
        setProviderConfig(db, target, { apiKeyEncrypted: encrypted })
        update.apiKeyEncrypted = encrypted
      }
      if (data.providerConfig !== undefined) {
        const pc = record(data.providerConfig, PROVIDER_FIELDS)
        const target = provider(pc.provider)
        const key = pc.apiKey === undefined ? '' : text(pc.apiKey, 8192).trim()
        if (pc.clearApiKey !== undefined && typeof pc.clearApiKey !== 'boolean') invalid()
        if (pc.clearApiKey && key) invalid()
        const patch: Parameters<typeof setProviderConfig>[2] = {}
        for (const field of STRINGS) {
          if (pc[field] !== undefined) patch[field] = text(pc[field]) || null
        }
        if (pc.maxTokens !== undefined) patch.maxTokens = integer(pc.maxTokens)
        if (key) patch.apiKeyEncrypted = encryptRequiredApiKey(key)
        if (pc.clearApiKey === true) patch.apiKeyEncrypted = null
        setProviderConfig(db, target, patch)
        let priority = storedList(update.providerPriority ?? current.providerPriority)
        if (pc.clearApiKey === true) {
          priority = priority.filter(item => item !== target)
          update.multiModelProviders = JSON.stringify(storedList(update.multiModelProviders ?? current.multiModelProviders).filter(item => item !== target))
          if ((update.provider ?? current.provider) === target) update.apiKeyEncrypted = null
        } else if ((getProviderConfig(db, target)?.apiKeyEncrypted?.length ?? 0) > 0 && !priority.includes(target)) priority.push(target)
        update.providerPriority = JSON.stringify(priority)
      }
      updateAIConfig(db, update)
      return { ok: true as const }
    })()
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('AI_CONFIG_INVALID:') || error.message.startsWith('API_KEY_STORAGE_UNAVAILABLE:'))) throw error
    throw new Error('AI_CONFIG_SAVE_FAILED: 配置保存失败，原配置已保留。请重新打开配置中心后重试。')
  }
}
