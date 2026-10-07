export type AppUpdatePhase = 'idle' | 'downloading' | 'verifying' | 'ready' | 'cancelled' | 'error'

export interface AppUpdateProgress {
  phase: AppUpdatePhase
  receivedBytes: number
  totalBytes: number
  percent: number
  fileName: string | null
  message: string
}

export interface AppUpdateInfo {
  currentVersion: string
  displayVersion: string
  platform: string
  architecture: string
  packaged: boolean
  installDirectory: string
  downloadDirectory: string
  includePrereleasesDefault: boolean
  progress: AppUpdateProgress
}

export interface AppUpdateRelease {
  version: string
  displayVersion: string
  releaseUrl: string
  publishedAt: string | null
  prerelease: boolean
  notes: string
  installerName: string | null
  installerBytes: number | null
  checksumAvailable: boolean
}

export interface AppUpdateCheck {
  state: 'available' | 'current' | 'not-published' | 'asset-missing' | 'unsupported'
  checkedAt: number
  message: string
  release: AppUpdateRelease | null
}

export type AppUpdateResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }

export interface AppUpdateDownload {
  fileName: string
  directory: string
  sha256: string
  reused: boolean
}
