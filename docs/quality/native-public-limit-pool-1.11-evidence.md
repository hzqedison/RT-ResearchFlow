# 1.11 candidate: native free limit-up data

Date: 2026-10-12. Local development evidence, NOT a published-release gate.
The public/installed application remains 1.10.0. Candidate version remains
1.11.0, shared with the current-concept work; no extra release increment.

## Implemented end-to-end path

Eastmoney public limit-up endpoint -> bounded native HTTP parser -> persisted
source-date/batch provenance -> isolated public fact cache -> existing
short-term limit-up observation/filter/K-line entry.

- No Python installation, AKShare checkbox, Tushare token or selected daily
  provider is required for this explicit public-source action.
- Source `qdate` must match the requested date; declared count must equal
  returned pool length. Response/error/cancellation handling is bounded.
- Source market identity is validated. Only milli-yuan price is divided by
  1000; yuan-valued amounts and funding remain in source units.
- Saving requires a locally confirmed trading day that has completed close.
  For first use with incomplete daily history, source-dated facts can be
  saved while price checking remains `not-complete`, not silently verified.
  Known contradictory closes still block saving; complete local daily data
  retains the existing 98-percent match requirement.
- Provenance and cache rows commit atomically. Reading verifies batch time,
  count and source-date witness. Legacy rows are never retrospectively relabeled.
- Existing Tushare U/D/failed-board tables are not populated with an incomplete
  limit-up-only universe. Failed fetching/writing preserves old cache.
- Probe/save actions no longer save unrelated pending source preferences.
- UI exposes response-date provenance, missing price verification and coverage
  limits, while retaining old-cache date warnings.

## External protocol evidence

Primary reference: https://github.com/akfamily/akshare/blob/main/akshare/stock_feature/stock_ztb_em.py

Read on 2026-10-12. It supplies endpoint/parameters, field ordering and the
milli-yuan price conversion. Its documented pool scope is not equivalent to
Tushare's entire U/D/failed-board universe. This is a protocol reference,
not a guarantee of ongoing access or free historical completeness.

One direct raw request returned HTTP 200, rc=0, qdate=20261009, tc=69,
pool length=69. This was followed by a separate real request through the new
application service and cache path described below.

## Executed checks

- 181 targeted tests passed in 6 files (3.82 seconds): old normalization,
  old cache preservation, UI filter semantics, new native protocol and
  persistence, and the previous current-concept lookup/wiring tests.
- The new native suite has 17 tests. Coverage includes source-date rejection,
  count mismatch, market conflicts, amount scaling, bounded response,
  cancellation, missing Python/config/history, contradictory closes,
  tampered provenance, and atomic write failure.
- One additional opt-in live test passed (556 milliseconds): actual public
  request -> in-memory SQLite cache -> observation read, 69 records dated
  20261009, source-reported date, incomplete local-price checking.
- This live test used an explicit synthetic calendar fixture and empty daily
  table. It is NOT an exchange-calendar audit or installed-app test. No user
  data, credentials or broker were used. Python calls fail explicitly in its
  test adapter.
- Node/Web TypeScript checks both exited 0 under pinned Node 20.18.0.
- An initial UI regression correctly required preserving the legacy unknown-
  date warning. The warning was restored; no assertion was removed/skipped.
- The old disabled-AKShare prerequisite case was superseded by the new no-
  provider/no-Python success test. Calendar, price and failure preservation
  assertions remain exercised.

Production build completed with exit 0: Electron main (8.85 seconds), preload
(40 milliseconds), renderer (27.34 seconds), research-access bundle (2.13
seconds), and build-size report. Output remains in the existing candidate
workspace. Mixed static/dynamic imports and old Browserslist data produced
non-fatal warnings; no dependency upgrade was performed. This proves bundle
generation, not native installer or GUI acceptance.

## Remaining scope

No claim is made that all short-term strategies now have their needed auction,
down-limit, failed-board, chip, historical concept or Dragon-Tiger facts.
The new path enables the existing public limit-up screener, not lower strategy
scores or live orders. Automatic completed-trading-day selection, interactive
desktop acceptance, Mac native runs and 1.11 installers remain pending.
The first request used one date and is not broad historical/network coverage.
