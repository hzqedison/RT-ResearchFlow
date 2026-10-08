import { realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute } from 'node:path'

// Test-only configuration. CI runs Electron-as-Node and uses the addon installed
// by electron-builder install-app-deps. Standalone Node isolation can explicitly
// select an addon built for that runtime. Loading it still enforces the real ABI;
// there is no fallback, dependency installation or rebuild here.
const override = process.env.RT_TEST_SQLITE_NATIVE_BINDING
if (override !== undefined && (!isAbsolute(override) || !override.endsWith('.node'))) {
  throw new Error('RT_TEST_SQLITE_NATIVE_BINDING must be an absolute .node file for the executing test runtime')
}
const requireForTests = createRequire(import.meta.url)
export const nativeTestBinding = realpathSync(override
  ?? requireForTests.resolve('better-sqlite3/build/Release/better_sqlite3.node'))
if (!statSync(nativeTestBinding).isFile()) throw new Error('Test SQLite native binding must be a regular file')

// os.tmpdir follows the host's TEMP/TMP/TMPDIR. Resolve macOS temporary-directory
// aliases before creating fixtures, preserving the production canonical-path gate.
export const nativeTestTempRoot = realpathSync.native(tmpdir())
