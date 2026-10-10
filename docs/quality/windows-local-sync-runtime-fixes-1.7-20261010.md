# Windows local checks for unreleased 1.7

Date: 2026-10-10. Scope: isolated local engineering checks, not final release acceptance.

## Actual results

- Electron main, preload and renderer compiled successfully with the existing portable Node 22.23.3 runtime. No dependency declarations were changed.
- Real Windows Electron renderer, preload, IPC and SQLite worked with a disposable D-drive profile. The installed application and its user data were not replaced.
- The Eastmoney concept endpoints returned empty-response transport errors in both Node and Electron. The read-only Sina fallback returned 175 current concept boards; the first board had 97 members.
- The application persisted two boards and 123 member observations through the real IPC route. Cancellation stopped the task and retained saved observations. This is not complete-board coverage or historical strategy data.
- Eleven isolated concept adapter/service tests and four audit-wire regression tests passed. Backend targeted type checking passed.
- The Windows candidate runtime's 21,389-file inventory, policy, dependency audits and current adapters were checked before local bootstrap tests.
- The Python bootstrap incorrectly serialized an absent optional generator pin as null. The JavaScript boundary now maps only that null default to undefined; invalid explicit pins remain rejected.
- The AKShare and mootdx offline guards incorrectly blocked socket.gethostname, a local hostname read needed by platform.uname. Actual network/socket creation, DNS lookup, subprocess and system-command restrictions remain in place.
- The mootdx smoke referenced pytdx although its pinned provider uses tdxpy. Its import now matches the actual provider dependency.
- AKShare, mootdx and pywencai passed their corresponding normal-bootstrap offline checks with the repaired source and existing hash-verified Windows binaries. Local test manifests were explicitly non-release fixtures; the original prepared bootstrap and manifest were restored afterward. These checks are not protected-producer or final-seal evidence.

## Unfinished release requirements

- Fresh source-bound native preparation and formal runtime assembly are still required; prior frozen artifacts cannot authorize changed bootstrap bytes.
- Mac native acceptance and the outstanding Mac notice/distribution obligations are not closed by Windows tests.
- No new NSIS installer was generated, installed or upgrade-tested. No new Mac installer was accepted.
- No brokerage account was accessed and no order was submitted. These results do not prove real-account trading.
- Cleanup of disposable profiles was rejected by the environment safety policy. It was not executed or retried through an alternative deletion mechanism; temporary material remains under D:/RT-ResearchFlow-BuildCache.

The release version remains 1.7.0 within this unreleased iteration. This record must not be used as a final acceptance certificate.


## Full live current-concept sync: 2026-10-10

- Scope: isolated Windows Electron/SQLite, read-only public sources, not the installed profile.
- Result: NOT accepted as a complete sync. Attempted 153 of 175 boards; saved 149; failed 4; retained 8,280 current memberships. The service stopped after consecutive failures.
- The run began with 83 previously cached boards. Cache totals are not proof that this run completed all boards.
- Live source trace reproduced three count/list discrepancies with the production adapter:
  - SINA:gn_sgqgg: reported count 52, first page 53 rows.
  - SINA:gn_jrcg: reported count 250, pages 100 + 100 + 51 rows.
  - SINA:gn_sbzc: reported count 99, first page 100 rows.
- All traced rows passed the observed A-share symbol-shape check. The adapter rejected the page/count mismatch with FACT_INVALID; this is not evidence of a Tushare key configuration failure.
- Existing count checks have NOT been relaxed. A source-pagination/count-discrepancy handling decision is awaiting the user's choice.
- Local diagnostic results were captured under the existing D-drive acceptance directory. They contain public observations only and are not protected release authorization or native release evidence.
- No broker account was connected, no order submitted, and no installed app/profile overwritten.
