interface ReleaseVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

export function parseReleaseVersion(value: string): ReleaseVersion | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value)
  if (!match) return null
  const numbers = match.slice(1, 4).map(Number)
  if (numbers.some(number => !Number.isSafeInteger(number))) return null
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(part => /^0\d+$/.test(part))) return null
  return { major: numbers[0], minor: numbers[1], patch: numbers[2], prerelease }
}

export function compareReleaseVersions(left: string, right: string): number {
  const a = parseReleaseVersion(left)
  const b = parseReleaseVersion(right)
  if (!a || !b) throw new Error('Invalid release version')
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1
    if (x === y) continue
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) return x.length !== y.length ? (x.length > y.length ? 1 : -1) : x > y ? 1 : -1
    if (xn !== yn) return xn ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

export function displayReleaseVersion(value: string): string {
  const parsed = parseReleaseVersion(value)
  if (!parsed) return value
  const base = parsed.patch === 0
    ? `${parsed.major}.${parsed.minor}`
    : `${parsed.major}.${parsed.minor}.${parsed.patch}`
  return parsed.prerelease.length ? `${base}-${parsed.prerelease.join('.')}` : base
}

export function installerFileName(version: string, platform: string, architecture: string): string | null {
  if (!parseReleaseVersion(version) || version.startsWith('v')) return null
  if (platform === 'win32' && architecture === 'x64') return `RT-ResearchFlow-Setup-${version}-x64.exe`
  if (platform === 'darwin' && (architecture === 'arm64' || architecture === 'x64')) {
    return `RT-ResearchFlow-macOS-${version}-${architecture}.dmg`
  }
  return null
}
