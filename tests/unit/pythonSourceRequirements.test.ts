import { describe, expect, it } from 'vitest'
import { minimumDataSourcePythonMinor, supportsDataSourcePython } from '../../electron/shared/pythonSourceRequirements'
import type { MultiSourcePreference } from '../../electron/shared/dataSourceTypes'

const config: MultiSourcePreference = { dailyProviders: ['tdx'], reportProviders: [], pythonPath: '', wencaiEnabled: false }

describe('provider-specific Python version requirements', () => {
  it('preserves the existing 3.10 minimum for non-AKShare extensions', () => {
    expect(minimumDataSourcePythonMinor(config)).toBe(10)
    expect(supportsDataSourcePython('3.10.9', config)).toBe(true)
  })
  it('requires 3.11 for AKShare daily or reports without imposing it on unrelated sources', () => {
    for (const selected of [{ ...config, dailyProviders: ['akshare'] as const }, { ...config, reportProviders: ['akshare'] as const }]) {
      const selection = { dailyProviders: [...selected.dailyProviders], reportProviders: [...selected.reportProviders] }
      expect(minimumDataSourcePythonMinor(selection)).toBe(11)
      expect(supportsDataSourcePython('3.10.9', selection)).toBe(false)
      expect(supportsDataSourcePython('3.11.0', selection)).toBe(true)
      expect(supportsDataSourcePython('3.13.13', selection)).toBe(true)
    }
  })
  it.each(['', 'NaN', '2.7.18', '3.9.18', '4.0.0', '3', '3.11garbage'])('rejects an incompatible or malformed version %s before downloading packages', version => {
    expect(supportsDataSourcePython(version, config)).toBe(false)
  })
})
