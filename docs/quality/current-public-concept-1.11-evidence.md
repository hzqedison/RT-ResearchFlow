# 1.11 candidate: current public concept consumption

Date: 2026-10-12. Status: local development candidate, NOT published.
The installed and public release remains 1.10.0. Its assets were not changed.
Candidate source remains in the existing D-drive candidate workspace; no new
production installation or additional Python environment was created.

## Implemented path

- Existing free Eastmoney/Sina snapshot cache -> stock membership lookup ->
  restricted preload method -> current-concept query panel in the short-term
  data drawer.
- Six-digit stock identifiers and explicit SH/SZ/BJ suffixes are accepted;
  the lookup does not infer an exchange or take a historical trade date.
- Every displayed membership retains its actual source and observation time.
  Observations older than 24 hours are labeled by observation age, not by
  an invented trading-day freshness rule.
- Missing table, no locally observed membership, invalid cached facts and
  bounded/truncated results remain distinct. No match does not prove that a
  stock has no concepts. Replies never expose the raw stored JSON.
- The lookup performs no writes, network requests, Python startup, token
  access, strategy-source change, historical backfill or broker action.
- Candidate package version is 1.11.0; previously published 1.10.0 stays intact.

## Executed checks

The two files below passed together: 30 tests, 2 files, 0 failed (1.65 seconds).

- `tests/unit/currentPublicConceptLookup.service.test.ts`: 26 checks using
  actual better-sqlite3 in-memory databases, including corrupt JSON, scalar
  members, timestamp contradictions, count mismatches, duplicates, provenance,
  unknown fields, response bounds, no-network/no-write behavior and safe errors.
- `tests/unit/currentPublicConceptLookup.wiring.test.ts`: 4 checks executing
  the actual main-handler callback and preload method extracted with the
  TypeScript parser, plus static rendering of the actual React query panel.
- Node and Web TypeScript project checks both exited 0 with Node 20.18.0.

The SQLite tests ran through installed dependency Electron in run-as-node mode,
using Node 20 spawnSync to wait and capture the exit status. Ordinary Node 20
and the default shell Node were incompatible with the pre-existing native
SQLite ABI; these failed attempts did not rebuild or modify shared dependencies.
One initial wiring assertion used a matcher unsupported by Vitest 2.1.9;
equivalent exact count and argument assertions passed on rerun without skipping.
All temporary paths were scoped to the existing D-drive test-temp directory.

## Not proved by this evidence

- Real network source coverage, every stock's complete current membership,
  historical concept composition, auction facts or free after-close strategy
  readiness.
- Actual Electron IPC transport/caller rejection, interactive click/query races,
  screen layout on Windows/Mac, candidate packaging, native installation or
  upgrade/data retention. Static render and callback tests are not these gates.
- Real OS credential storage, live broker compatibility, account balances,
  live orders, portfolio-capital backtests or incremental automatic updates.

These remain pending. Public 1.10 and user production data were not replaced
by the unaccepted 1.11 candidate.
