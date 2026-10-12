# Standalone calendar cancellation, 1.18 candidate

## Scope

An independently invoked `syncTradeCalFull` now registers with a dedicated
application work owner, including callers that supply no AbortSignal. The
application closes admission and aborts that owner during normal shutdown,
then includes it in the bounded idle wait. It is separate from the public
market and private historical-price work owners.

The calendar service still coalesces concurrent calls. A joining waiter's
abort only cancels that waiter, not the shared request. The initiating
caller's abort or application-wide stop cancels the owned request. Stop is
idempotent; new cached-calendar and no-Key fallback admissions are refused
after stop. The synchronous official seed used by scheduler initialization
is not itself an asynchronous owned task.

Cancellation is not a provider permission failure. A late response cannot
write calendar rows or start official fallback. Idle is not reported until
the underlying task settles, even if a transport ignores abort.

## Local checks

- The pre-change regression failed: standalone `fetchTradeCal` received no
  AbortSignal.
- The revised 14-file cancellation/regression suite passed 119 tests,
  including seven standalone calendar ownership cases.
- Both main-process and renderer TypeScript checks exited successfully.
- The actual Windows application-directory suite passed all three quit
  cases (public history, synthetic private history and standalone calendar)
  in 9.8 seconds. Calendar row count and full-content hash were unchanged.
- Revised native Apple Silicon and Intel application-directory suites
  passed all three cases. Run `38187750694` succeeded for source commit
  `a514f2e8ee39bf39857c5206fe4aa74b86f7f8a4`; ARM took 2m28s and Intel 3m52s.

All eight downloaded JSON files were inspected. Both summaries match the
source commit, run ID and native architecture, and explicitly deny release
eligibility, installer verification, real authentication and order submission.
Both calendar proofs retain 1,096 rows with the same before/after SHA-256:

`f03d5bf54e3e285d654765b797ac9bb5a18fa0c2b814b0b35da1df2425fab023`

Each calendar request aborted once (77ms ARM, 143ms Intel), with normal
quit observed. Public proofs retain the pending checkpoint and partial job
with zero written prices; private-history proofs retain zero interrupted-day
prices and zero processed/failed/synced progress. These are synthetic tests,
not market-data entitlement or broker connectivity evidence.

The new packaged check uses the actual trusted diagnostics entry point,
an OS-encrypted synthetic credential in isolated storage, and a controlled
`trade_cal` response. It hashes all sorted calendar rows before and after
normal quit, rather than treating an unchanged row count as content proof.
It checks one aborted request, normal process exit, no renderer errors,
and preserved calendar content. It does not authenticate a real Key.

## Delivery boundaries

These checks are added to both native release gate variants. The narrow
Mac diagnostic workflow builds application directories only and uploads
JSON proof, not installers; its result cannot authorize publication.

No production data, shared Python installation, broker account, or order
is touched. No cleanup or production installer overwrite is attempted.
Full task-shutdown OpenSpec item 4.4 remains incomplete: other service
families still require separate audit and evidence.

The known rolling-report recovery UI defect remains unresolved. This
calendar work does not fix it or remove its failing release test. Version
1.18 is still a candidate; the formal public release remains 1.17.
