'use strict'
const path = require('node:path')
const { createRequire } = require('node:module')

function withPackagedPdfRuntime(base) {
  const pdfRequire = createRequire(require.resolve('pdf-parse'))
  const canvasRoot = path.dirname(pdfRequire.resolve('@napi-rs/canvas/package.json'))
  const canvasRequire = createRequire(path.join(canvasRoot, 'package.json'))
  const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : ''
  const nativeName = `@napi-rs/canvas-${process.platform}-${process.arch}${suffix}`
  const nativeRoot = path.dirname(canvasRequire.resolve(`${nativeName}/package.json`))
  // Explicit file sets avoid the pnpm dependency collector omitting transitive
  // native/optional dependencies. Only the matching native architecture is copied.
  return {
    ...base,
    files: [...(base.files || []),
      { from: canvasRoot, to: 'node_modules/@napi-rs/canvas', filter: ['**/*'] },
      { from: nativeRoot, to: `node_modules/${nativeName}`, filter: ['**/*'] },
    ],
    asarUnpack: [...(Array.isArray(base.asarUnpack) ? base.asarUnpack : base.asarUnpack ? [base.asarUnpack] : []),
      'node_modules/@napi-rs/**/*.node',
    ],
    async beforePack(context) {
      const arch = typeof context.arch === 'string' ? context.arch : ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][context.arch]
      if (context.electronPlatformName !== process.platform || arch !== process.arch) {
        throw new Error('PDF_NATIVE_TARGET_MISMATCH: build each architecture on its matching native runner')
      }
      // Fail before packaging if the real native binding cannot initialize.
      if (typeof canvasRequire(canvasRoot).DOMMatrix !== 'function') throw new Error('PDF_NATIVE_CANVAS_UNAVAILABLE')
      if (base.beforePack) await base.beforePack(context)
    },
  }
}
module.exports = { withPackagedPdfRuntime }
