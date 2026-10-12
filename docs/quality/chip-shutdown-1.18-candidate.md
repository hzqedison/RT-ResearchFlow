# Chip monitor cancellation, 1.18 candidate

## Implemented scope

The manually started chip-monitor job now has an application-owned signal,
closed admission during shutdown, bounded idle waiting, cancellable daily
and chip transports, and cancellable inter-batch delays. Both concurrent
requests in a batch settle before the job releases its running guard.
Aborted transports cannot write late prices, chips or monitor results, or
emit a successful completion event. Destroyed windows receive no progress.
The start IPC checks admission before replacing the monitor stock pool.

The chip singleflight cache separates credentials by SHA-256 fingerprint
and cancellation domains by signal identity. Raw tokens are not cache keys.
Same-credential requests in the same scope still share a promise. An owned
request deliberately does not join a legacy request or another owned scope;
cancelling it cannot abort unrelated consumers. No source claims are changed.
This does not add a free replacement for Tushare chip-distribution facts.

## Evidence

- Both main-process and renderer TypeScript checks exited successfully.
- The complete targeted 21-file unit run reports 166 passed and one failed.
- The remaining failure is the new positive chip-monitor test fixture:
  its mocked chip write does not populate its mocked read cache, so it reports
  no usable chips before reaching the signal assertion. This failed initial
  test is not valid pre-change cancellation evidence. It has not been removed,
  skipped or relabelled as passing. Permission to correct the introduced
  fixture omission has been requested; correction remains pending.
- The other seven new monitor cancellation cases passed, covering pending
  daily work, both concurrent chip requests, delay cancellation, closed
  admission, pre-abort, destroyed web contents and the existing running guard.
- Six credential/signal singleflight cases, four bounded-transport cases,
  the start-admission AST contract, two existing monitor cases and seven
  existing structure cases passed. The legacy structure call assertion now
  includes the new optional signal argument without changing result assertions.
- The actual Windows application-directory suite passed five tests in 15.8s:
  public history, private synthetic history, standalone calendar, chip-monitor
  daily cancellation and chip-monitor chip cancellation. The two chip cases
  use the real preload/IPC entry point and isolated SQLite storage. Four sorted
  table fingerprints remain unchanged from the pending-request boundary to
  normal quit, with one aborted request, zero new results, no done event and
  no renderer errors. The completed daily fact in the chip-stage case remains
  committed; cancellation does not erase it.

## Not achieved

The newly added chip cases now have native Mac evidence from run
38189320881 on source 5f78b5cbca95e83020818b36f507ffe00bd258bf. Apple Silicon
passed all five actual application-directory cases in 26.6s; Intel passed
them in 23.6s. Native jobs took 2m36s and 5m11s respectively. The overall run
and both jobs FAILED because the same positive-test fixture omission was
reproduced on each architecture. The 167 unit cases per architecture report
166 passed / 1 failed, not an all-green suite. The diagnostic workflow carries
on only to gather actual application evidence and then explicitly fails.

All twelve downloaded proof/summary JSON files and both job logs were
inspected. Summary architecture, source commit and run ID match; both set
unitContractsPassed=false, releaseEligible=false, installerVerified=false,
realTushareAuthentication=false, brokerOrdersSubmitted=false and published=false.
Both chip-stage pairs preserve the four complete table fingerprints across
quit, observe exactly one aborted request, emit no completion event and keep
zero new chips/results. The committed daily row remains in each chip-stage
case. Both calendar proofs preserve 1,096 rows and the same content hash.
Public/private history proofs preserve their pending/partial or interrupted-day
state without new prices. This is narrow runtime evidence, not a release waiver.

Both full native release gate variants include all new unit cases (including
the currently failing fixture) and both new packaged cases. No known failure
is bypassed for publication. The earlier Mac run 38187750694 remains evidence
for the preceding source, not the newly added chip work.

The separate chip-structure and institution synchronization jobs are not
covered by this owner. Legacy direct chip fetches without a caller signal are
not claimed to be globally owned or drained. Full shutdown task 4.4 remains
incomplete. No real credential entitlement or broker connectivity is verified.
The rolling-report recovery defect is still unresolved; 1.18 remains an
unpublished candidate. Production data, shared Python, installers and real
broker accounts were not modified. No cleanup or production overwrite occurred.
