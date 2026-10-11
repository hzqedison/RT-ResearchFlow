'use strict'
const { readValidatedRuntime } = require('../electron/shared/privatePythonRuntimeManifest.cjs')
function validate(root, target) {
  const { manifest, manifestSha256 } = readValidatedRuntime(root, target)
  return { target: manifest.platform + '-' + manifest.arch, manifestSha256, providers: Object.keys(manifest.providers), files: manifest.files.length }
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('PRIVATE_RUNTIME_PENDING: runtime root and target required')
    console.log(JSON.stringify(validate(process.argv[2], process.argv[3])))
  } catch (error) {
    console.error(error.message.startsWith('PRIVATE_RUNTIME_') ? error.message : 'PRIVATE_RUNTIME_INVALID')
    process.exitCode = 1
  }
}
module.exports = { validate }
