# Published native upgrade acceptance

This is an independent Node 20 / Playwright 1.58.2 harness. It does not build,
publish, alter, re-sign, or replace the two released product versions. Product
dependencies and the release workflow are not used for dependency installation.

Only disposable GitHub-hosted native Windows x64, macOS arm64, and macOS x64
runners are accepted. Do not spoof the environment to execute on a workstation.
The dedicated branch is `codex/acceptance-1.0-to-1.1`. A branch push can discover
this workflow without first installing it on the default branch; manual dispatch
has GitHub's normal default-branch workflow availability requirement.

## Entry points

The workflow calls `evidence.mjs prepare`, `init <windows|macOS> <x64|arm64>`,
`fetch`, the one Playwright test, `cleanup`, `publish`, then `collect <directory>`.
`init` exports the case and public-evidence directories through `GITHUB_ENV`.
The existing downloader receipt is retained privately as `download-receipt.json`;
its installer paths remain relative to `RUNNER_TEMP`. No alternate downloader,
URL overrides, or unsigned receipt is accepted.

`fixtures/version-contract.json` freezes package-name and data-path rules,
source/settings/AI IPC expectations, read-only SQL, and lifecycle timeouts.
Windows runtime AppUserModelID is a verified source fact, not a guessed registry
GUID or a fabricated Electron getter. The actual uninstall key is discovered
after the old install and compared after upgrade. macOS bundle ID and executable
architecture are inspected on each whole-bundle installation.

## Stages and safety gates

- Before A: prove a public unauthenticated endpoint is reachable; create the
  loopback observer; apply OS containment; on macOS create a genuine empty
  temporary default Keychain without prefilled items or trust/ACL changes.
- A / 1.0: prove Node, Electron net, and child-process loopback success plus
  non-loopback rejection. Create settings, one disabled source through IPC,
  onboarding through the UI, origin localStorage, a marker and a sentinel.
  Only macOS saves the generated K0 credential through the real application IPC.
- B / 1.0: an independent process reads all persisted fixtures and decrypts K0.
- Upgrade: Windows runs the new NSIS installer in the same path without removing
  the old installation. macOS replaces the entire app bundle at the same path,
  retaining profile and Keychain. Installer hashes are checked again.
- C / 1.1: read the old data and decrypt K0. macOS saves K1, proves it replaces K0,
  then performs a metadata-only update and proves ciphertext remains unchanged.
- D / 1.1: another independent process reads everything and decrypts K1.
- Every phase normally exits with code zero; remaining descendants fail the
  lifecycle gate. The installed Electron and its own SQLite module perform an
  additional post-exit read. Database, existing WAL and SHM are scanned in memory
  for UTF-8 / UTF-16LE plaintext keys while running and after exit.

The migration contract currently accepts identical version sets only, describing
upgrade data preservation rather than proving a database migration. Added or
changed migrations require Astra to freeze the target and recovery-point contract
before another run. macOS sessionData is currently permitted only in the owned
profile; unexpected paths are BLOCKED, never added to an allowlist at runtime.

## Evidence and limitations

Only four sanitized JSON basenames may be staged and uploaded:
`input-manifest.json`, `acceptance-result.json`, `network-isolation.json`, and
`installer-events.json`. Failed runs may contain partial facts; they cannot pass
collection. A sanitization failure emits only a minimal failure summary. No
profile, Keychain, database, key, raw process log, trace, screenshot, or dump is
uploaded. Test keys and the Keychain password are scanned before staging.

Each phase requires explicit OS denial evidence, not a timeout alone. Windows
requires owned PID/target WFP 5157 audit records; macOS requires permission-denied
results from the inherited sandbox. Unsupported runner controls, sandbox syntax,
or Keychain interaction are BLOCKED_ENVIRONMENT, never skipped or mocked.
The network evidence covers startup transport self-checks and cumulative
loopback observation only. The 12 successful-run controls represent A/B/C/D's
three transport probes, not a count of background connection attempts. The one
final loopback record counts requests since the observer started (including
self-checks); its phase names the collection endpoint, not the requests' phase.
Complete background OS-denial counts are not collected, and are not reported
as zero. The evidence's scope/verification fields preserve these limits.
The temporary Keychain proves only that isolated real backend, not every existing
login Keychain's policy. No genuine account or provider is used.

`node --test offline.test.mjs` exercises safety helpers and actual harness methods
with in-memory I/O and typed-control doubles, without installation, browsers,
network requests, registry access, or Keychain operations. These development
regressions use the repository's already-installed TypeScript compiler to load
the real harness in memory; no dependency or lockfile changes are required, and
the standalone native CI does not require this development-only compiler.
The UI double enforces button/checkbox operation types and registration order;
it is not a browser or native UI acceptance result. Native execution and
final release acceptance remain Astra's responsibility. A machine PASS is not
the final signoff.
