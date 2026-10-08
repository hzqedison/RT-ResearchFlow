# D0: published Windows 1.0 installer diagnostic only

Implementation, not execution authorization or native acceptance. Astra must
review these bytes and authorize the one D0 execution before the main task pushes
`codex/diagnose-windows-installer-1.0` or dispatches this workflow on that branch.
No D1, runner fallback, installer rebuild, upgrade, application test, or retry is
implemented. R0 remains run 37726873605 attempt 1, with its original failure.

## Inputs and invocation

Only the published 1.0.0 x64 EXE, size 166547210, SHA-256
`f5ea701458902dbcdeea08b3aabbcfca23b2c2c6a16ed8b88de1b31811033a4b`
is executable. Its source is `41f8429149f646c7dec7f1610082702e7d9cce48`.
The unchanged downloader returns both pinned versions; D0 necessarily downloads
and verifies that pair, but only selects 1.0. Version 1.1 is never executed.

CI/Actions/github-hosted, native Windows x64, the dedicated branch, and
`GITHUB_RUN_ATTEMPT=1` are mandatory. Per-case exclusive budget and invocation
markers reject a second call even when the first launch fails. A new run ID is
not an authorized extra experiment: Astra controls the D0 experiment budget.

The frozen original Windows script performs the unchanged setup and cleanup.
Its registration/process/empty-target checks, app-specific IPv4/IPv6 rules and
WFP audit policy are retained. The new observer repeats empty-scene guards and
uses exactly Start-Process, `/S`, `/D=<CASE>/install`, Hidden and PassThru. It
does not override cwd, TEMP/TMP, elevation, compatibility or mitigation policy.
The installer wait retains the 120-second budget; short waits permit bounded
read-only process snapshots between checks. Snapshot overhead is declared, not
claimed to have zero observation effect. A blocking OS query can consume some
of that budget; the external observer has its own bounded timeout and cleanup.

No application is manually launched. An installer-started owned product process
is observed and stopped, not treated as an A/B/C/D launch. Nonzero exit, timeout,
success, missing evidence or observer error all end D0. Even exit zero additionally
requires the observed 1.0 registration identity/location before describing that
installation as established; it can never set `upgradeAccepted=true`.

## Freeze and commit binding

`freeze.json` covers this workflow, JS driver, PS observer, both offline test files
and this README. It also pins the raw bytes of the existing parent freeze plus combination
`8fef94360d98b7be394def53a2f455794a8ac12707136a42971c7dbff67a6795`.
Neither freeze includes its own digest. D0's combination is SHA-256 of compact
JSON `{parent,files}` in the stored order. Runtime receipts bind both freeze-file
digests and all 22 payload files to the exact workflow `github.sha`, using original
GitHub commit blobs. The two freeze files are separately checked at that commit.
Parent and D0 source changes are not silently accepted or normalized. Checkout
disables automatic EOL conversion; raw local bytes are checked before native work
and again before calling the observer. Product source SHAs are not harness SHAs.

Generate a reviewed new D0 freeze once using `node diagnostic.mjs freeze`; it
refuses to overwrite a previous freeze. Never regenerate the parent freeze here.
No repository Git commands or network writes are part of this tool.

## Evidence and explicit unavailable fields

The only artifact is `windows-installer-d0.json`. Raw events, module paths,
command lines, exception text and process snapshots stay in memory. Operational
case/ownership and audit-restore files written by the unchanged setup remain
private. New persisted process cleanup records contain PID, start time, path
digest and category only, never raw diagnostic paths or arguments.

- Records include run/case/source/freeze identities, image/build and comparison
  with R0, original EXE pre/post hash and size, launcher SID digest, elevation,
  integrity, observable mitigation flags, path shapes and original argument shape.
- Path writability is tested only in the owned case. TEMP/TMP are not altered or
  probed with extra files. Actual installer cwd is unavailable; both launcher
  location and process-cwd shapes are recorded without pretending either proves it.
- Native process architecture is queried through IsWow64Process2, not inferred
  from the x64 asset name. Missing token/module/process data remains unavailable.
  Mitigation policies are queried only, never set. Policy numbers are Windows
  PROCESS_MITIGATION_POLICY values; unavailable flags are not equivalent to zero.
- Bounded CIM snapshots can miss short-lived children. Child exit codes/times
  not actually observed remain unavailable; absence from a later snapshot is not
  a fabricated exit event. Cleanup rechecks PID, creation time and image digest.
- Application Error/WER events are bounded to the invocation time window and
  associated fault PID plus image path. Creation time is compared when present.
  Missing creation time is explicitly partial attribution. WER entries with no
  fault PID are not attributed using the provider's own PID or a matching name.
  Event publication is observed for at most 60 seconds, not by another install.
- System.dll module paths are observed in the process or attributed event when
  available. Original still-existing files are read after owned processes stop,
  with delete sharing for hashing. Missing modules stay unavailable: no dump,
  debugger, extraction, retention hook or second installation is used. Signature
  status and file stability are recorded separately from hash identity.
- Image/version/build mismatch or unavailable image metadata means new-environment
  diagnostic observation, not strict R0 reproduction. Matching these fields alone
  does not prove all conditions identical or identify a crash cause.
- Native installation outcome and diagnostic/cleanup errors are separate. Cleanup
  cannot overwrite the primary failure. A green workflow would mean diagnostic
  completion only, not product release, upgrade or Mac Keychain acceptance.

## Cleanup and error contract

Protection restoration requires a positive observer receipt: success is true,
remainingOwned is zero, and unknownDescendant is explicitly false. Missing,
malformed, failed or throwing receipts, an active isolation guard or an unexited
query helper retain protection. Cleanup never kills a process by name.
Observed ownership is not a claim that bounded sampling sees every short-lived
descendant. Disposable runner teardown remains the outer containment boundary;
this tool never runs on a developer PC.

Every cleanup attempt is appended with its records and protection state. Later
success never erases previous failures or the original installer crash. A failed
restore reports protection state unknown because it may have partially executed.
Only fixed parent kind/code pairs and downloader upgradeCode values are adapted;
native errno, numeric exit code and signal are allowlisted, never raw messages.

## Development checks

Run both offline.test.mjs and deadline.test.mjs with Node's test runner inside an
isolated source snapshot containing the pinned original parent bytes. The
canonical parent has separate Mac repairs and must not replace this D0 baseline.
The workflow parser test uses existing js-yaml@4.3.0. On this machine, NODE_PATH
can point to its module directory in the K-drive project's pnpm store. Do not
skip the test or install another parser because the snapshot has no node_modules. Tests use memory fixtures and real pure orchestration,
plus PowerShell AST parsing and extracted pure event-correlation functions. They
do not invoke the observer entry point, installer, registry, firewall, audit,
Keychain or network. No temporary files outside the K workspace are created.
Native observation availability, short-process coverage and module disappearance
remain pending Astra's independently controlled D0 execution and review.
