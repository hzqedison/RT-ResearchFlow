# Published native upgrade acceptance

This is an independent Node 20 / Playwright 1.58.2 harness. It does not build,
publish, alter, re-sign, or replace the two released product versions. Product
dependencies and the release workflow are not used for dependency installation.

Only disposable GitHub-hosted native Windows x64, macOS arm64, and macOS x64
runners are accepted. Do not spoof the environment to execute on a workstation.
The dedicated branch is `codex/acceptance-1.0-to-1.1`. A branch push can discover
this workflow without first installing it on the default branch; manual dispatch
has GitHub's normal default-branch workflow availability requirement.

The current workflow runs ONLY macOS arm64 and macOS x64. Windows is deliberately
absent because the fixed 1.0 installer failure requires Astra's separate D0
diagnostic design and implementation. A successful Mac job or collection is not
Windows acceptance or all-platform acceptance. Do not re-add Windows to this
matrix or rerun its failed installer without a newly reviewed execution plan.

## Entry points

The workflow calls `evidence.mjs prepare`, `init <windows|macOS> <x64|arm64>`,
`verify`, `fetch`, `run` (the bounded Playwright process wrapper), `cleanup`,
`publish`, then `collect-mac <directory>`.
The Mac-only collector requires both architectures and the unchanged full native
evidence gates; it rejects Windows artifacts and explicitly reports Windows as
not executed. The original `collect <directory>` remains a strict three-platform
collector; two successful Mac cases can never satisfy it.
`init` exports the case and public-evidence directories through `GITHUB_ENV`.
The existing downloader receipt is retained privately as `download-receipt.json`;
its installer paths remain relative to `RUNNER_TEMP`. No alternate downloader,
URL overrides, or unsigned receipt is accepted.

## Frozen source bytes and commit identity

`fixtures/harness-freeze.json` lists exactly the 16 acceptance payload files,
their byte lengths and SHA-256 hashes. Its combination is SHA-256 of the compact
JSON array of `{path,size,sha256}` entries in fixed path order. The freeze file
itself is deliberately excluded. It contains no own commit ID or own digest.
After changing any payload file, regenerate it with the local `freeze` operation
only as an explicit new freeze, then let Astra review the resulting bytes.

The harness source identity is the workflow's exact `github.sha`, not either
product commit. Prepare and each native job read the 16 original blobs and the
freeze file from GitHub's read-only contents API at that exact SHA, validate Git
blob integrity, and compare raw bytes with both checkout and freeze. The runtime
receipt records that SHA, the independent freeze-file SHA-256 and combination.
This permits payload and freeze in one commit without circular self-hashing.
There is no dependency on a predicted future commit hash. Publishing this branch
must preserve the reviewed bytes; changing line endings requires a new freeze.

Checkout disables `core.autocrlf` and selects LF via Git environment configuration
before checkout. It does not rewrite working-tree files afterward. Missing files,
CRLF conversion, other byte drift or an unavailable fixed-commit blob block before
dependency installation, installer download or application execution. The wrapper
and harness also recheck local frozen bytes and the case-bound verified receipt
before execution. No checkout mismatch is repaired silently by the verifier.

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

Init now writes private progress, not a public NOT_EXECUTED placeholder. Reporter
hooks, the guarded test entry and the outer runner capture discovery/worker,
module-load, constructor, execute, setup/install/launch and archival failures.
Stage checkpoints and cleanup attempts are separate from acceptance assertions.
The first failure remains primary when cleanup, reporting or archiving also fail.
Only allowlisted error classes, errno/signal, integer exit codes, fixed explanatory
text and locations within the frozen source list can leave the process. Messages,
stacks, IPC arguments, attachments and raw runner output are never forwarded.
If no terminal test result was recorded, publication reports that observed lack
of terminal evidence as BLOCKED; it does not infer that no installer ever ran.
Failed early runs may legitimately publish only their actual failure record.

### Partial facts and the Mac launch boundary (F4/F5)

Validated input, returned setup policy, returned installer result, every assertion,
and each started phase are scanned and written immediately. Evidence and private
run state use exclusive same-directory temporary files, flush, then atomic rename.
They are also checkpointed before cleanup is awaited. An interrupted worker no
longer needs to reach final archival to preserve facts already observed. Cleanup
and outer-runner failures append diagnostics; they do not replace the primary
failure or assign their exit code to the application. Unfinished phases remain
`exited: false`, without an invented application exit code or network PASS.

Before the single existing Mac launch, read-only inspection records wrapper,
shell, sandbox-exec and original executable roles, existence, execution access,
mode bits, file SHA-256 and the bounded codesign verification result. Partial
inspection results are checkpointed individually. Paths, argv, environment,
codesign output and stderr are never included. A scoped ChildProcess spawn
observer delegates the original options unchanged and observes only the exact
owned wrapper; it does not launch a second process or retry. Actual spawn/error/
exit events retain only role, observed PID, time, recognized errno/syscall and
observed exit code or signal. The prototype hook is restored when launch settles;
listeners on that one child can still persist its later exit.

`spawn-requested` alone proves no PID. `spawn-observed` proves only that the
wrapper process was spawned, not that sandbox-exec or the product binary was
reached. `debugConnection: connected` requires Playwright launch to return;
`identityVerified` requires the installed executable/identity assertions. The
intermediate shell-to-sandbox-to-binary exec boundary is not directly observed
when debugging never connects. File access and codesign facts are not evidence
of that transition, Gatekeeper approval, or a root cause for EPERM. Unknown
values remain null/not-observed. No quarantine, signing, sandbox or Keychain
policy is changed by these diagnostics.

`probeComplete` describes the twelve actual A/B/C/D transport controls only.
Setup policy installation is not successful inheritance or network-denial proof.
An early launch failure leaves controls absent/incomplete and cannot pass either
collector. The Mac-only matrix and original strict three-platform collector are
unchanged. Run 37729682202 remains failed; these tool changes need a new byte
freeze and Astra review before any native execution.

Run 37726873605 attempt 1 remains failed. The old Windows 1.0 installer exit
`0xC0000005` in System.dll has no confirmed root cause or proven invocation bug.
This change preserves the existing NSIS invocation and event evidence, protection,
and installer bytes, but excludes Windows from the active workflow matrix.
Further controlled diagnostics require Astra's
design; neither retry nor a rebuilt baseline is an acceptance substitute.

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
