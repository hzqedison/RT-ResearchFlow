import type { MultiSourcePreference } from './dataSourceTypes'

type SourceSelection = Pick<MultiSourcePreference, 'dailyProviders' | 'reportProviders'>

export function minimumDataSourcePythonMinor(config: SourceSelection): 10 | 11 {
  return config.dailyProviders.includes('akshare') || config.reportProviders.includes('akshare') ? 11 : 10
}

export function supportsDataSourcePython(version: string, config: SourceSelection): boolean {
  const parts = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(version.trim())
  return parts !== null && Number(parts[1]) === 3 && Number(parts[2]) >= minimumDataSourcePythonMinor(config)
}
