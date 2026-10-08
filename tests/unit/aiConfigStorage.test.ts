import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { getConfiguredProviders, getProviderConfig, setProviderConfig } from '../../electron/main/database/aiConfigRepository'
import { encryptRequiredApiKey } from '../../electron/main/utils/apiKeyEncryption'
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
