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

The newly added chip cases have not yet run on either native Mac architecture.
The earlier Mac run 38187750694 covers the preceding calendar/public/private
history source, not these chip changes. Both full native release gate variants
now include all new unit cases (including the currently failing fixture) and
both new packaged cases. No known failure is bypassed for publication.

The separate chip-structure and institution synchronization jobs are not
covered by this owner. Legacy direct chip fetches without a caller signal are
not claimed to be globally owned or drained. Full shutdown task 4.4 remains
incomplete. No real credential entitlement or broker connectivity is verified.
The rolling-report recovery defect is still unresolved; 1.18 remains an
unpublished candidate. Production data, shared Python, installers and real
broker accounts were not modified. No cleanup or production overwrite occurred.
