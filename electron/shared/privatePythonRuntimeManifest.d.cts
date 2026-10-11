import type { DownloadAsset, DerivedAsset, PrivateRuntimeAsset, PrivatePythonRuntimeManifest, PrivatePythonRuntimeLock } from './privatePythonRuntimeTypes'
export const PROVIDERS: readonly ['akshare', 'mootdx', 'pywencai']
export const TARGETS: readonly string[]
export function hash(bytes: string | Uint8Array): string
export function safeRelative(value: string): string
export function below(root: string, target: string): boolean
export function asset(value: unknown, requiredKind: 'download'): DownloadAsset
export function asset(value: unknown, requiredKind: 'derived'): DerivedAsset
export function asset(value: unknown): PrivateRuntimeAsset
export function derivedWheel(value: unknown): void
export function validateOfficialDownload(value: unknown, policy: unknown): DownloadAsset
export function validatePreparationPolicy(manifest: PrivatePythonRuntimeManifest, policy: unknown, policySha256: string): PrivatePythonRuntimeManifest
export function validateManifestShape(value: unknown, target?: string): PrivatePythonRuntimeManifest
export function validateRuntimeTree(root: string, value: unknown, target?: string): PrivatePythonRuntimeManifest
export function validateDependencyAudits(root: string, manifest: PrivatePythonRuntimeManifest, generatorSha256?: string): Array<{ provider: string; wheels: number; evaluations: number }>
export function projectDependencyGraphs<T extends Pick<PrivatePythonRuntimeManifest, 'platform' | 'arch' | 'python' | 'providers' | 'files'>>(root: string, context: T, generatorSha256?: string): T
export function readValidatedRuntime(root: string, target?: string): { manifest: PrivatePythonRuntimeManifest; manifestSha256: string }
export function validateLock(value: unknown): PrivatePythonRuntimeLock
