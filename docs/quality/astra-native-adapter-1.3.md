# Astra native-adapter slice acceptance: 1.3

Decision: **BLOCKED_NATIVE_ADAPTER_SLICE**. This is not a whole-product or real-Mac/live-trading verdict.

## Frozen input bytes

| File | SHA256 |
| --- | --- |
| `electron/main/services/macThsExecutionAdapter.ts` | `157f8b70174b9b4a50f61cd1d00d2e6c931006e37463c949cab195f734b3415f` |
| `electron/main/services/macThsScripts.ts` | `5185061c3303f3aadb86d48c395cf296e2bdd5761b136ba0612704e505a11796` |
| `electron/shared/macThsNativeProtocol.ts` | `00aa4245cf8216925e86380c6f9b4f6bf321316189883f3aba943a727a2ff414` |
| `tests/unit/macThsExecutionAdapter.test.ts` | `a47e73571bdd201d22b4543158149445b1b6a644baeeb2efb44833c09ffb7dc9` |

Read against architecture sections 5.2/5.3. All four hashes independently matched before execution.

## Independently executed evidence

- Node v20.20.2 / ABI115; existing better-sqlite3 native binding, no installation/rebuild. A test-only constructor wrapper selects that binding; SQLite operations, coordinator and protocol decoder are real.
- Dedicated implementation suite: 38 passed. Additional Astra probes: 6 passed, 3 failed. Combined: 44 passed / 3 failed / 0 skipped; process exit 1.
- Positive control executes the production JXA template against synthetic AX objects INSIDE an owned harmless Node child, decodes its output through the production adapter, verifies the coordinator's actual-close capability, then calls real SQLite store `recordExecutorExit` BEFORE `recordOutcome`. Result: `ACCEPTED_OBSERVED`. A fabricated exit capability is rejected; raw account witness is absent from store inspection.
- Additional passing probes: complete output does not resolve before child close; 4096 bytes accepted and 4097 rejected; stderr overflow stops the owned child without NOT_SUBMITTED evidence; exception after submit touch remains UNKNOWN; account switch before submission prevents the submit click.
- The dedicated suite also exercises nonce/action binding, invalid fields/dates, missing/masked/ambiguous account, missing observed date, native sheet non-interaction, unchanged absolute deadlines, timeout, legacy output rejection and unique new receipt checks.

## Confirmed findings

### F1 / P1: cancel does not prove exclusive selection

`macThsScripts.ts:590,596-609` selects the target and verifies that target is selected, but does not verify that OTHER rows are unselected. With synthetic AX preserving an existing selection, the production template clicks cancel while `OTHER-OLD` and `TARGET-OLD` are both selected, then returns `LIVE_CANCELLED`.

Minimal fix: immediately before the cancel click require exactly one selected row across the relevant observed order table, matching the authorized complete target. Otherwise stop without touching cancel. Do not assume `row.select()` always clears other selections. Add a retained-multi-selection counterexample plus single-selection positive control. This reproduces a template safety failure; actual broker batch-cancellation behavior was NOT tested.

### F2 / P2: contradictory readback can become accepted evidence

`macThsNativeProtocol.ts:168-177` validates readback shape only; `macThsExecutionAdapter.ts:288-314` validates the receipt against the snapshot but omits the submit readback association. An owned harmless child emits a correctly bound nonce/action with readback symbol `600001`, target/snapshot symbol `600000`, and `LIVE_ACCEPTED`. The real adapter returns non-null `ths_ui` accepted evidence.

Minimal fix: enforce action-specific coherence before promoting submit evidence, including recognized readback matching immutable order parameters and coherent date/mode/header/receipt fields. Contradictory or missing required submit facts must remain UNKNOWN. Keep cancellation/read-only observation contracts separate. This is a synthetic protocol-boundary failure, not evidence of a real erroneous order.

### F3 / P2: duplicate JSON member names are accepted

`macThsNativeProtocol.ts:152-154` uses JSON.parse before checking object keys. Duplicate `submitTouched` fields (`false`, then `true`) collapse to the last value and pass strict decoding.

Minimal fix: reject duplicate member names in the bounded JSON envelope, including nested objects, without changing nonce/action or existing whitelist checks. Preserve valid escaped-string handling; do not use a naive regex as a JSON parser.

## Evidence and boundaries

- [Execution output](K:/AI/person/money/.tmp/astra-native13-Mqz2IS/stdout.log)
- [Failure assertions](K:/AI/person/money/.tmp/astra-native13-Mqz2IS/stderr.log)
- [Independent probes](K:/AI/person/money/.tmp/astra-native13-Mqz2IS/native-adapter.probe.test.ts)
- [Synthetic AX surface](K:/AI/person/money/.tmp/astra-native13-Mqz2IS/surface-source.mjs)

All child commands were harmless Node processes and all test data stayed in the owned K-drive temporary directory. No network, real osascript, THS, broker, credentials, installation, production profile, CI, T1/D0 or product source edits. The unrelated service/UI integration was not graded. Real AX selector availability, target Mac behavior and actual trading remain unverified. Return the three bounded findings to the parent for implementation and independent retest; do not replace this failure record with a pass.

## 2026-10-08 final four-file repair recheck: LIMITED_PASS_NATIVE_ADAPTER_SLICE

This section supersedes the old four-file BLOCKED decision only for the frozen bytes below. The original failures and original probe evidence remain above and on disk. No product, core, UI, release, tag, installer, or workflow was changed by this reviewer.

| Relative file | Raw-byte SHA256 |
|---|---|
| `electron/main/services/macThsExecutionAdapter.ts` | `536cf4cfa6bd1fe477a327d617c42666338a1c9ff5199d6dc027b1e874c3c473` |
| `electron/main/services/macThsScripts.ts` | `0bf657bd717a51265819f153f1d4066c9ba1e448f6590b557409fdf3950ee4c2` |
| `electron/shared/macThsNativeProtocol.ts` | `525325d9b44c74ecba2bf8cf9c50359debc382037ccd0b905d1639cdb2eeb4cf` |
| `tests/unit/macThsExecutionAdapter.test.ts` | `2e48b0d2cc2ed128f9ef1ba5ca248a4a95e3618d3e52d0d0b515f576e75d1365` |

### Independently executed evidence

- Runtime: existing Node v20.20.2 / ABI 115, existing real SQLite native binding. All profiles and harmless child processes were confined to K: temporary evidence. No installation, rebuild, network, osascript, THS, account, or production database access.
- First repair run: dedicated implementation suite 64/64 passed; independent probes 15 passed and 2 failed at ACCOUNT_CONTEXT_CONFLICT, before their intended launch assertions. Total 79 passed / 2 failed / 0 skipped. These two probes incorrectly reused an account observation made before confirmation; the actual store correctly required a post-confirmation observation.
- Only those two independent fixtures were corrected to perform another real adapter observation after confirmation. Their assertions were unchanged. Targeted recheck: 2/2 passed / 0 skipped, exit 0. The other 79 passing cases were not rerun. Thus all 81 scoped cases have passing evidence across these runs, NOT a claimed single 81/81 clean run.
- Before test execution, one orchestration attempt failed because the tool JavaScript environment had no btoa. No source/test execution occurred in that attempt; the temporary command encoding was corrected. The old contradictory-readback probe was mechanically adapted to mutate a valid fixture AFTER construction, because the strengthened fixture constructor now rejects the invalid packet itself; the original negative assertion and conflicting wire payload were retained.

### Findings closed for this slice

1. F1, retained multi-selection: the unchanged independent production-JXA counterexample now returns TARGET_UNVERIFIED, submitTouched=false, clicks=[]. A sole fully matching selected target remains a positive control and cancels once. The exclusive selection checks are at macThsScripts.ts:569 and :674; implementation tests also reject unreadable/conflicting selection.
2. F2, contradictory submit readback: an owned harmless child emitting the original conflicting symbol now produces NATIVE_PROTOCOL_INVALID and null evidence. Real SQLite + coordinator + harmless child executing production JXA over synthetic AX + production decoder still reaches ACCEPTED_OBSERVED, with genuine close proof recorded before outcome.
3. F3, duplicate JSON members: the original duplicate submitTouched case is rejected, as are nested and Unicode-escaped decoded-name duplicates. Valid uniquely escaped names still pass. The bounded grammar-aware duplicate walk is at macThsNativeProtocol.ts:149.
4. F4, SQL slow-write deadline: an actual SQLite TEMP trigger delays the launch_pending write beyond the original ticket. Independent observation: exactly one burn, zero actual ChildProcess.spawn calls, executor_state=not_started, executor_instance=null, intent UNKNOWN, old ticket reuse rejected, and ordinary store.shutdown succeeds with database closed.
5. Unknown launch negative control: after one real harmless spawn, an unrelated exception with the SAME error code cannot impersonate the F3 sentinel. The database retains launch_pending/null instance, intent UNKNOWN, and ordinary shutdown rejects EXECUTOR_EXIT_UNPROVEN even after the adapter proves its owned child's actual exit. Final direct closure of this isolated test database was fixture cleanup only, NOT a claim of successful product shutdown/recovery.

### Guard identity and legacy template boundaries

- macThsExecutionAdapter.ts:113-116 uses a synchronous outer pre-spawn closure: it invokes the original F3 beforeSpawn first, then the adapter's absolute-deadline checks. The actual thrown sentinel survives by exact object identity; no catch/repack/replacement is introduced. The independent expired-plan test recorded one original guard call and zero actual spawns.
- This verifies original SENTINEL identity and final synchronous invocation, not a claim that the outer callback function object supplied to super is literally unchanged. The extra deadline check is synchronous; there is no await, SQL, filesystem operation, or deadline renewal between the original guard and actual spawn.
- Legacy AppleScript cancel protection at macThsScripts.ts:164-213 / :374 was reviewed statically, and its two actual generated-template structural cases were executed. It rechecks a unique recognized table and identifier, readable boolean AXSelected for every row, and exactly the authorized selected target immediately before cancel; failures/unknowns refuse. Actual AppleScript parsing, macOS Accessibility behavior, and the real THS layout were NOT executed.
- Existing 4096/4097 limits, true-close waiting, owned-child-only termination, account switch refusal, submitTouched-on-click-error and no confirmation-sheet click controls passed in the bounded suites.

### Evidence and residual limits

- Original blocked run: [stdout](K:/AI/person/money/.tmp/astra-native13-Mqz2IS/stdout.log).
- Repair run with first fixture failures retained: [stdout](K:/AI/person/money/.tmp/astra-native13-retest-QtLzyM/stdout.log), [stderr](K:/AI/person/money/.tmp/astra-native13-retest-QtLzyM/stderr.log), [independent probes](K:/AI/person/money/.tmp/astra-native13-retest-QtLzyM/native-adapter.probe.test.ts).
- Corrected two-case recheck: [stdout](K:/AI/person/money/.tmp/astra-native13-retest-QtLzyM/guard-stdout.log), [stderr](K:/AI/person/money/.tmp/astra-native13-retest-QtLzyM/guard-stderr.log), [guard probes](K:/AI/person/money/.tmp/astra-native13-retest-QtLzyM/guard-recheck.test.ts).
- No unresolved reproduced defect remains in this four-file repair scope. This is not approval of the unfinished private-directory/core or service/UI integration, not full-product release approval, and not native Mac/live-trading certification. No unrelated F3 suite, T1, or D0 was run.
- The already published 1.2 installers were NOT patched by these source repairs. The reported pause-cancelLive warning remains necessary for those old assets; this review neither changes nor lifts it.
