# 1.11 credential binding and free rule screening evidence

## User-facing changes

- Configuration > Data sources opens with an always-visible Tushare binding card.
- New credential binding validates first; rejected requests retain the original encrypted credential.
- Permission-limited responses are explicitly distinct from verified calendar access.
- Saved credentials can be rechecked without returning plaintext to the renderer.
- Validation evidence is stored against the exact encrypted credential; replacing a key invalidates previous evidence.
- Binding does not enable a provider, rewrite provider choices, or start market-wide downloads.
- The native free limit-up pool suggests the latest closed date only when a complete local calendar confirms it. User-entered dates are never overwritten.
- Three deterministic rule screens explain their evidence: early first board, second board, continuous boards. Missing facts are excluded rather than treated as zero.

## Completed local checks

Node and renderer TypeScript checks passed. Six targeted unit suites passed, 113 tests total:

- Tushare credential verification: 20, including bounded HTTPS requests, documented code 2002, fact validation, redaction, real SQLite evidence invalidation, actual trusted-handler evaluation, and rendered entry controls.
- Calendar recommendation and free rule filtering: 22.
- Native free limit-up protocol/cache: 17.
- Verified pool cache compatibility: 24.
- Current public concept lookup: 26 service and 4 wiring tests.

The native endpoint separately returned 69 real records for 20261009 in the opt-in live test documented in native-public-limit-pool-1.11-evidence.md. This is not live Tushare verification.

## Required native release gates

Windows and both native Mac architectures must pass the new targeted suites, actual installer startup/settings/exit, SQLite/PDF/canvas loading, and private on-demand extension installation. Packaged settings acceptance asserts that binding and daily-provider controls are visible and password input enables binding without submitting a synthetic key. Windows lifecycle acceptance uses the exact installer bytes and verifies D-drive defaults, same-directory upgrade and data-preserving uninstall.

At the time of this source record, native 1.11 acceptance and publication are pending. The release publisher must verify all native receipts and server-side SHA256 digests and must not rebuild or overwrite assets.

## Limitations

No valid user Tushare token was used in these isolated tests. Permission or authentication success must not be claimed from mocked responses. Calendar verification does not grant auction, minute, chip or other premium endpoint permissions. No trading account was connected and no order was submitted. Current concept observations are not historical membership. The free limit-up pool is not a complete market-wide limit-up/down/failed-board dataset.

Official API schema and permission-code reference: https://tushare.pro/document/1?doc_id=40 (checked 2026-10-12). Token entry: https://tushare.pro/user/token.
