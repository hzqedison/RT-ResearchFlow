# 1.12 free strategy laboratory candidate evidence

## Implemented vertical workflow

The existing strategy laboratory now includes three ready-to-run free limit-up presets, explicit free-profile validation and user-copy editing. It consumes the verified native Eastmoney cache and persists ordinary laboratory runs and matches through the existing repository. The input fact, rule version, source-reported date, observed time and price-crosscheck status are retained with each match. Generic minute strategy editing cannot silently convert these profiles.

Missing calendar/date/provenance/after-close evidence blocks execution. Duplicate identities and missing required facts cannot qualify by treating missing fields as zero. ST exclusion also excludes unknown names. Zero matches remain zero. The rule-pass display is not a return forecast, rank, auction fact or chip inference.

Public runs do not write historical backtest signals or broker orders. Both the UI and backend refuse return backtests for these single-date public snapshots. Historical point-in-time capture, full short-term strategy substitution and real trading remain incomplete.

## Local evidence

- Six targeted unit files: 90 passed, zero failed. Includes 19 new free-profile cases, existing laboratory/template cases, native protocol, verified cache and pure rules.
- One new integration case uses the actual native normalizer, actual SQLite cache writer and reader, and actual laboratory executor/repository. Only the provider response is synthetic; no public network or user configuration is used.
- Cancellation at save progress leaves the run cancelled and writes no matches. An injected SQLite insert failure rolls back completion/matches and leaves a failed run. The existing completion and signal writes are now grouped in one transaction.
- Node and Web TypeScript checks both passed.
- Production main/preload/renderer and research-access builds passed; the actual Windows on-demand distribution directory was packaged successfully.
- Actual packaged Windows application acceptance: 1 passed, 10.8 seconds. Checks version 1.12.0, all three free templates through actual IPC, free laboratory guide/run plan, the actual free configuration editor, Tushare entry, AI settings, page-error absence and normal exit code zero. No mocked IPC or broker operation.
- The initial packaged test invocation preceded completion of the packaging process and lacked an executable path; it failed at setup, before application launch. The original packaging process was allowed to finish, then the same test passed against its resulting executable. No application assertion was skipped.
- Native build/lifecycle workflows now receive an explicit version parameter. YAML parsing and portable Mac/Windows source-version guards passed. The reusable publisher preserves the existing 1.11 publisher and refuses mismatched acceptance receipts or overwritten assets.

## Pending gates

This is candidate evidence, not a public release certificate. Native Mac arm64/x64 application acceptance, actual Windows NSIS installation, lifecycle receipt and same-byte publication must pass before 1.12 is offered as a tested public installer. The existing installed local application remains 1.11 until an accepted installer is available.

The user has no available Tushare test key. Live Tushare authentication, real OS Keychain credential restart, Apple notarization, real broker execution and broad legacy upgrades are not certified by this work.
