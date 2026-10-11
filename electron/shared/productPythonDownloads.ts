// First-use downloads only. These archives are not redistributed in installers.
// Pin the release and digest together; never resolve "latest" during installation.
export type MacProductPythonArtifact = Readonly<{
  version: string
  release: string
  name: string
  url: string
  size: number
  sha256: string
}>

const release = '20261009'
const version = '3.13.16'
const prefix = `https://github.com/astral-sh/python-build-standalone/releases/download/${release}/`
const artifacts: Readonly<Record<'arm64' | 'x64', MacProductPythonArtifact>> = {
  arm64: {
    version, release,
    name: 'cpython-3.13.16+20261009-aarch64-apple-darwin-install_only_stripped.tar.gz',
    url: `${prefix}cpython-3.13.16%2B20261009-aarch64-apple-darwin-install_only_stripped.tar.gz`,
    size: 25_257_849,
    sha256: '11785155d0f70e634178219c20925d8f20be00a3da4684fc4f5019dd15602ef7'
  },
  x64: {
    version, release,
    name: 'cpython-3.13.16+20261009-x86_64-apple-darwin-install_only_stripped.tar.gz',
    url: `${prefix}cpython-3.13.16%2B20261009-x86_64-apple-darwin-install_only_stripped.tar.gz`,
    size: 24_975_282,
    sha256: 'bd085c51e960f00ee33b630e2b13ac90fe90cdc3da25a0f0bc0719b1294920bf'
  }
}

export function macProductPythonArtifact(architecture: string): MacProductPythonArtifact {
  if (architecture !== 'arm64' && architecture !== 'x64') throw Error('PRODUCT_PYTHON_ARCHITECTURE_UNSUPPORTED')
  // Return an independent immutable object, so a caller cannot change the
  // digest or URL used by another installation operation.
  return Object.freeze({ ...artifacts[architecture] })
}
