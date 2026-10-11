## ADDED Requirements

### Requirement: Stop owned Tushare history without fabricating data or provider failures
Application-owned historical daily tasks SHALL reject new admission during shutdown, cancel their calendar, daily and daily-basic requests, cancel retry/date delays, and remain tracked until actual settlement. Explicit local cancellation SHALL NOT be classified as provider timeout, permission denial, a failed trade date or an internal support failure. Already committed dates SHALL remain; incomplete date data SHALL not be committed after cancellation.

#### Scenario: Turnover or daily response arrives late
- **WHEN** cancellation occurs during daily retrieval, turnover backfill or basic-data merging
- **THEN** late facts are rejected before writes, no subsequent trade date is requested and the interrupted date is not marked successful or failed

#### Scenario: Shared calendar waiter cancels
- **WHEN** a caller joins an unrelated existing calendar request and then cancels
- **THEN** that waiter is released without cancelling the unrelated owner; a cancelled owned calendar response does not write or silently invoke official fallback

### Requirement: Verify packaged cancellation without claiming real Tushare access
Native acceptance SHALL use a known synthetic credential and controlled transport, prove actual request cancellation and process exit, restore the original sandbox configuration and keep the interrupted date unchanged. Windows acceptance SHALL use a per-test executable-adjacent data directory to exclude unrelated startup resume tasks. Proof SHALL NOT be reported as real Key authentication or complete application shutdown coverage.

#### Scenario: Release evidence
- **WHEN** version 1.18 or later is published
- **THEN** each native platform must have `localSyntheticTushareWorkShutdownVerified` in its immutable acceptance receipt in addition to existing gates
