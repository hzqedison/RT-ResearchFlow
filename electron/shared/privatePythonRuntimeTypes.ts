export type PrivatePythonProvider = 'akshare' | 'mootdx' | 'pywencai'
export type PrivatePythonPlatform = 'win32' | 'darwin'
export type PrivatePythonArch = 'x64' | 'arm64'

export interface DownloadAsset {
  kind: 'download'
  filename: string
  url: string
  sha256: string
  size: number
}

export interface DerivedAsset {
  kind: 'derived'
  filename: string
  sha256: string
  size: number
  url?: never
}

export type PrivateRuntimeAsset = DownloadAsset | DerivedAsset

export interface PrivateRuntimeLicense {
  approvalId: string
  spdx: string
  path: string
  sha256: string
  review: 'approved'
}

export type PrivateRuntimeFile =
  | { path: string; kind: 'file'; sha256: string; size: number }
  | { path: string; kind: 'symlink'; target: string }

export interface PrivateRuntimeRecipe {
  path: 'scripts/build-mootdx-compat-wheel.py' | 'scripts/build-provider-source-wheels.py'
  sha256: string
}

export interface PrivateRuntimeDerivation {
  id: string
  upstreamVersion: string
  upstreamSha256: string
  patchSha256: string
  upstreamAsset: DownloadAsset
  recipe: PrivateRuntimeRecipe
  patch?: never
}

export interface PrivateRuntimeLicenseApproval {
  id: string
  component: string
  version: string
  artifactSha256: string
  licenseSha256: string
  spdx: string
  decision: 'approved' | 'pending' | 'rejected'
  reviewedBy?: string
  reviewReference?: string
}

export interface PrivateRuntimePreparationPolicy {
  schemaVersion: 1
  kind: 'rt-private-python-preparation-policy'
  officialSources: string[]
  targets: Record<'win32-x64' | 'darwin-arm64' | 'darwin-x64', {
    python: { version: string; asset: DownloadAsset; licenseSources?: DownloadAsset[] }
    node: { version: string; asset: DownloadAsset; licenseSources?: DownloadAsset[] }
  }>
  recipePins: PrivateRuntimeRecipe[]
  licenseApprovals: PrivateRuntimeLicenseApproval[]
  licenseRequirements: Array<{
    component: string
    version: string
    member: string
    sha256: string | null
    spdx?: string
    role?: 'provenance'
  }>
}

interface PrivateRuntimeWheelIdentity {
  distribution: string
  version: string
  dependencies: string[]
  requiresDist: string[]
  requiresPython: string | null
  tags: string[]
  metadata: { path: string; sha256: string }
  licenses: PrivateRuntimeLicense[]
}

export type PrivateRuntimeWheel = PrivateRuntimeWheelIdentity & (
  | { asset: DownloadAsset; derived?: never }
  | { asset: DerivedAsset; derived: PrivateRuntimeDerivation }
)

export interface PrivateRuntimeProviderLock {
  version: string
  site: string
  wheels: PrivateRuntimeWheel[]
  dependencyAudit: {
    path: string
    sha256: string
    format: 'rt-private-provider-dependency-audit-v1'
  }
  compatibility?: 'modern-mini-racer'
}

export interface PrivatePythonRuntimeManifest {
  schemaVersion: 1
  kind: 'rt-private-python-runtime'
  complete: true
  platform: PrivatePythonPlatform
  arch: PrivatePythonArch
  sourceLockSha256: string
  preparationPolicySha256: string
  python: {
    distribution: 'python-build-standalone'
    version: string
    executable: string
    asset: DownloadAsset
    licenseSources?: DownloadAsset[]
    licenses: PrivateRuntimeLicense[]
  }
  node: {
    version: string
    executable: string
    asset: DownloadAsset
    licenseSources?: DownloadAsset[]
    licenses: PrivateRuntimeLicense[]
  }
  bootstrap: 'bootstrap.py'
  dependencyAuditValidator: { path: 'private_runtime_manifest.cjs'; sha256: string }
  miniRacerAdapter: {
    path: 'miniracer_unicode_adapter.py'
    version: '0.12.4'
    sha256: string
    windowsStrategy: 'win32-unicode-resource-prewarm-v1'
  }
  minimumMacOS?: '12.0'
  providers: Record<PrivatePythonProvider, PrivateRuntimeProviderLock>
  sbom: { path: string; sha256: string; format: 'SPDX-2.3' }
  files: PrivateRuntimeFile[]
}

export interface PrivatePythonRuntimeLock {
  schemaVersion: 1
  status: 'locked'
  preparationPolicySha256: string
  platforms: Record<'win32-x64' | 'darwin-arm64' | 'darwin-x64', Omit<PrivatePythonRuntimeManifest, 'sourceLockSha256'>>
}
