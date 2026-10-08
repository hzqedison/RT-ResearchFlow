import { safeStorage } from 'electron'

/**
 * Encrypts a plaintext API key using Electron's safeStorage (OS-level encryption).
 * Returns null if safeStorage is not available on this platform.
 */
export function encryptApiKey(plaintext: string): Buffer | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.encryptString(plaintext)
}

/**
 * Decrypts an encrypted API key Buffer back to plaintext.
 * Returns null if decryption is unavailable or the buffer is null/empty.
 */
export function decryptApiKey(encrypted: Buffer | null): string | null {
  if (!encrypted || encrypted.length === 0) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}


/** Required-key save paths must fail closed instead of silently saving no credential. */
export function encryptRequiredApiKey(plaintext: string): Buffer {
  const key = plaintext.trim()
  if (!key) throw new Error('API_KEY_REQUIRED: 请输入 API 密钥。')
  try {
    const encrypted = encryptApiKey(key)
    if (!encrypted || encrypted.length === 0) throw new Error('unavailable')
    return encrypted
  } catch {
    throw new Error('API_KEY_STORAGE_UNAVAILABLE: 系统安全密钥存储不可用，API Key 未保存。请检查系统密钥存储或钥匙串权限，重启应用后重试。')
  }
}
