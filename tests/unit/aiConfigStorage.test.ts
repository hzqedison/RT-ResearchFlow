import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { getAIConfig, getConfiguredProviders, getProviderConfig, setProviderConfig } from '../../electron/main/database/aiConfigRepository'
import { encryptRequiredApiKey, inspectApiKeyStatus } from '../../electron/main/utils/apiKeyEncryption'
import { saveAIConfiguration } from '../../electron/main/services/aiConfigurationService'
import { callAIProvider, PROVIDER_MODELS } from '../../electron/main/services/aiProvider'

const mocks = vi.hoisted(() => ({
  available: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  complete: vi.fn(),
}))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mocks.available,
    encryptString: mocks.encrypt,
    decryptString: mocks.decrypt,
  },
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.complete } }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.available.mockReturnValue(true)
  mocks.encrypt.mockReturnValue(Buffer.from('encrypted-test-fixture'))
  mocks.decrypt.mockReturnValue('offline-test-key')
  mocks.complete.mockResolvedValue({
    id: 'offline-fixture',
    choices: [{ message: { content: 'offline result' }, finish_reason: 'stop' }],
  })
})

describe('AI credential storage is fail-closed', () => {
  it('trims a supplied key before OS encryption', () => {
    const encrypted = encryptRequiredApiKey('  offline-test-key  ')
    expect(mocks.encrypt).toHaveBeenCalledWith('offline-test-key')
    expect(encrypted.toString()).toBe('encrypted-test-fixture')
  })

  it('does not silently save a missing key when secure storage is unavailable', () => {
    mocks.available.mockReturnValue(false)
    expect(() => encryptRequiredApiKey('offline-test-key')).toThrow('API_KEY_STORAGE_UNAVAILABLE')
    expect(mocks.encrypt).not.toHaveBeenCalled()
  })

  it('does not expose key material or platform errors when encryption fails', () => {
    mocks.encrypt.mockImplementation(() => { throw new Error('private-platform-detail') })
    expect(() => encryptRequiredApiKey('offline-test-key')).toThrow('API_KEY_STORAGE_UNAVAILABLE')
    try { encryptRequiredApiKey('offline-test-key') } catch (error) {
      expect(String(error)).not.toContain('offline-test-key')
      expect(String(error)).not.toContain('private-platform-detail')
    }
  })

  it('rejects whitespace-only keys without encrypting them', () => {
    expect(() => encryptRequiredApiKey('   ')).toThrow('API_KEY_REQUIRED')
    expect(mocks.encrypt).not.toHaveBeenCalled()
  })
})

describe('provider configuration preserves the existing NOT NULL schema', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`CREATE TABLE provider_configs (
      provider TEXT PRIMARY KEY, apiKeyEncrypted BLOB NOT NULL,
      model TEXT, baseUrl TEXT, maxTokens INTEGER, presetPrompt TEXT,
      trendForecastPrompt TEXT, trendForecastMorrowPrompt TEXT
    )`)
  })
  afterEach(() => db.close())

  it('saves metadata or prompts without requiring credentials for every provider', () => {
    setProviderConfig(db, 'claude', { presetPrompt: 'local prompt' })
    const row = getProviderConfig(db, 'claude')!
    expect(Buffer.isBuffer(row.apiKeyEncrypted)).toBe(true)
    expect(row.apiKeyEncrypted!.length).toBe(0)
    expect(row.presetPrompt).toBe('local prompt')
    expect(getConfiguredProviders(db)).toEqual([])
  })

  it('keeps existing encrypted credentials when only model settings change', () => {
    const encrypted = Buffer.from('encrypted-test-fixture')
    setProviderConfig(db, 'deepseek', { apiKeyEncrypted: encrypted, model: 'deepseek-flash' })
    setProviderConfig(db, 'deepseek', { model: 'deepseek-v4-pro', maxTokens: 4096 })
    expect(getProviderConfig(db, 'deepseek')!.apiKeyEncrypted).toEqual(encrypted)
    expect(getConfiguredProviders(db)).toEqual(['deepseek'])
  })

  it('represents an explicitly cleared key as an unconfigured empty blob', () => {
    setProviderConfig(db, 'deepseek', { apiKeyEncrypted: Buffer.from('encrypted-test-fixture') })
    setProviderConfig(db, 'deepseek', { apiKeyEncrypted: null })
    expect(getProviderConfig(db, 'deepseek')!.apiKeyEncrypted!.length).toBe(0)
    expect(getConfiguredProviders(db)).toEqual([])
  })
})

describe('current official DeepSeek models', () => {
  it('offers current identifiers rather than retired official model names', () => {
    expect(PROVIDER_MODELS.deepseek).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
  })

  it('uses a bounded non-thinking request with no actual network call', async () => {
    await expect(callAIProvider({
      provider: 'deepseek', model: 'deepseek-flash', apiKey: 'offline-test-key',
      prompt: 'offline test', maxTokens: 4096,
    })).resolves.toMatchObject({ text: 'offline result' })
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      model: 'deepseek-flash', max_tokens: 4096, thinking: { type: 'disabled' },
    }), expect.any(Object))
  })
})

describe('transactional partial AI configuration', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`CREATE TABLE provider_configs (
      provider TEXT PRIMARY KEY, apiKeyEncrypted BLOB NOT NULL,
      model TEXT, baseUrl TEXT, maxTokens INTEGER, presetPrompt TEXT,
      trendForecastPrompt TEXT, trendForecastMorrowPrompt TEXT
    ); CREATE TABLE ai_config (
      id INTEGER PRIMARY KEY, provider TEXT, model TEXT, apiKeyEncrypted BLOB,
      baseUrl TEXT, presetPrompt TEXT, triggerRating TEXT,
      maxArticlesPerBatch INTEGER, maxContentCharsPerArticle INTEGER,
      maxArticleAgeDays INTEGER, autoCleanupDays INTEGER,
      trendForecastPrompt TEXT, trendForecastMorrowPrompt TEXT,
      maxForecastsPerStock INTEGER, providerPriority TEXT, multiModelProviders TEXT,
      maxForecastComparison INTEGER, selectedSkills TEXT, customSkillPaths TEXT,
      skillsForTrend INTEGER, maxSkillChars INTEGER
    ); INSERT INTO ai_config(id,provider,providerPriority,multiModelProviders,maxArticlesPerBatch)
      VALUES(1,'deepseek','["deepseek","qwen"]','["deepseek","qwen"]',20);`)
    setProviderConfig(db, 'deepseek', { apiKeyEncrypted: Buffer.from('old-deepseek'), model: 'old-model' })
    setProviderConfig(db, 'qwen', { apiKeyEncrypted: Buffer.from('old-qwen'), model: 'qwen-model' })
    db.prepare('UPDATE ai_config SET apiKeyEncrypted=? WHERE id=1').run(Buffer.from('legacy-deepseek'))
  })
  afterEach(() => db.close())
  it('updates one provider without touching another or global settings', () => {
    saveAIConfiguration(db, { providerConfig: { provider: 'deepseek', model: 'new-model' } })
    expect(getProviderConfig(db, 'deepseek')!.apiKeyEncrypted).toEqual(Buffer.from('old-deepseek'))
    expect(getProviderConfig(db, 'qwen')!.model).toBe('qwen-model')
    expect(getProviderConfig(db, 'qwen')!.apiKeyEncrypted).toEqual(Buffer.from('old-qwen'))
    expect(getAIConfig(db).maxArticlesPerBatch).toBe(20)
  })
  it.each(['', '   '])('preserves the existing credential for blank input %j', apiKey => {
    saveAIConfiguration(db, { providerConfig: { provider: 'deepseek', apiKey } })
    expect(getProviderConfig(db, 'deepseek')!.apiKeyEncrypted).toEqual(Buffer.from('old-deepseek'))
    expect(mocks.encrypt).not.toHaveBeenCalled()
  })
  it('clears only the selected key including legacy and selection-list copies', () => {
    saveAIConfiguration(db, { providerConfig: { provider: 'deepseek', clearApiKey: true } })
    expect(getProviderConfig(db, 'deepseek')!.apiKeyEncrypted).toEqual(Buffer.alloc(0))
    expect(getAIConfig(db).apiKeyEncrypted).toBeNull()
    expect(JSON.parse(getAIConfig(db).providerPriority!)).toEqual(['qwen'])
    expect(JSON.parse(getAIConfig(db).multiModelProviders!)).toEqual(['qwen'])
    expect(getConfiguredProviders(db)).toEqual(['qwen'])
  })
  it('does not clear the active legacy key when another provider is removed', () => {
    saveAIConfiguration(db, { providerConfig: { provider: 'qwen', clearApiKey: true } })
    expect(getAIConfig(db).apiKeyEncrypted).toEqual(Buffer.from('legacy-deepseek'))
  })
  it('preserves a supplied priority order while adding a configured provider', () => {
    saveAIConfiguration(db, { providerPriority: ['qwen'], providerConfig: { provider: 'deepseek', model: 'new-model' } })
    expect(JSON.parse(getAIConfig(db).providerPriority!)).toEqual(['qwen', 'deepseek'])
  })
  it('rolls back global and provider changes on unavailable encryption', () => {
    mocks.available.mockReturnValue(false)
    expect(() => saveAIConfiguration(db, { maxArticlesPerBatch: 50, providerConfig: { provider: 'deepseek', model: 'new-model', apiKey: 'offline-test-key' } })).toThrow('API_KEY_STORAGE_UNAVAILABLE')
    expect(getAIConfig(db).maxArticlesPerBatch).toBe(20)
    expect(getProviderConfig(db, 'deepseek')!.model).toBe('old-model')
  })
  it('rolls back a provider when the later global write fails', () => {
    db.exec("CREATE TRIGGER reject_global BEFORE UPDATE ON ai_config BEGIN SELECT RAISE(ABORT,'private-db-detail'); END;")
    expect(() => saveAIConfiguration(db, { providerConfig: { provider: 'deepseek', model: 'new-model' } })).toThrow('AI_CONFIG_SAVE_FAILED')
    expect(getProviderConfig(db, 'deepseek')!.model).toBe('old-model')
  })
  it.each([
    null, [], { unexpected: 'private-input' }, { providerConfig: { provider: 'unknown' } },
    { maxArticlesPerBatch: NaN }, { maxContentCharsPerArticle: Infinity }, { maxForecastsPerStock: 1.2 },
    { providerConfig: { provider: 'deepseek', maxTokens: -1 } },
    { providerConfig: { provider: 'deepseek', clearApiKey: true, apiKey: 'offline-test-key' } },
    { providerConfig: { provider: 'deepseek', clearApiKey: 'true' } },
    { providerPriority: ['unknown'] }, { selectedSkills: [''] }, { skillsForTrend: 'false' }
  ])('rejects invalid input without any mutation: %j', input => {
    expect(() => saveAIConfiguration(db, input)).toThrow('AI_CONFIG_INVALID')
    expect(getProviderConfig(db, 'deepseek')!.model).toBe('old-model')
    expect(getAIConfig(db).maxArticlesPerBatch).toBe(20)
  })
  it('retains encrypted values and metadata across SQLite close/reopen', () => {
    saveAIConfiguration(db, { providerConfig: { provider: 'deepseek', model: 'new-model', apiKey: 'offline-test-key' } })
    const bytes = db.serialize()
    db.close()
    db = new Database(bytes)
    expect(getProviderConfig(db, 'deepseek')!.model).toBe('new-model')
    expect(inspectApiKeyStatus(getProviderConfig(db, 'deepseek')!.apiKeyEncrypted)).toBe('available')
    expect(getProviderConfig(db, 'deepseek')!.apiKeyEncrypted!.toString()).not.toContain('offline-test-key')
  })
})

describe('local credential state is not remote authorization', () => {
  it('reports unconfigured without querying OS secure storage', () => {
    expect(inspectApiKeyStatus(Buffer.alloc(0))).toBe('unconfigured')
    expect(mocks.available).not.toHaveBeenCalled()
  })
  it('distinguishes an unavailable secure store from an absent key', () => {
    mocks.available.mockReturnValue(false)
    expect(inspectApiKeyStatus(Buffer.from('cipher'))).toBe('storage-unavailable')
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })
  it('reports readable without returning plaintext', () => {
    expect(inspectApiKeyStatus(Buffer.from('cipher'))).toBe('available')
  })
  it('reports unreadable without propagating platform exceptions', () => {
    mocks.decrypt.mockImplementation(() => { throw new Error('private-platform-error') })
    expect(inspectApiKeyStatus(Buffer.from('cipher'))).toBe('unreadable')
  })
})
