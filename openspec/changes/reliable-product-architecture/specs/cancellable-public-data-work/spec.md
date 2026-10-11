## ADDED Requirements

### Requirement: Own and cancel public history and stock-directory work before process exit
Public historical daily synchronization and public stock-directory entry points SHALL share an application-owned admission barrier and cancellation registry. Application shutdown SHALL close admission, cancel owned requests and await their actual settlement. Aborting a signal SHALL NOT be treated as proof that an implementation ignoring it has completed. This ownership SHALL NOT be described as covering all application tasks.

#### Scenario: Late transport response
- **WHEN** a transport returns after its owner was cancelled
- **THEN** the response is rejected before price or identity writes; cancellation is not recorded as provider failure and does not trigger fallback to another provider

#### Scenario: Saved daily progress
- **WHEN** cancellation interrupts a history batch
- **THEN** successful checkpoints and committed prices remain, the interrupted stock is pending without a fabricated provider error, and job progress remains partial rather than success or zeroed counters

### Requirement: Preserve serialized request ownership during cancellation
Cancelling a queued request SHALL release its caller without allowing subsequent requests to bypass its still-running predecessor. Cooling-period waiting SHALL be cancellable before network admission. In-flight task ownership SHALL remain until the task settles, including a transport that ignores cancellation.

#### Scenario: Packaged application shutdown
- **WHEN** an explicitly isolated packaged application starts manual public history through its actual diagnostic API and quits during a controlled pending request
- **THEN** native acceptance proves request cancellation, normal process exit, retained pending checkpoint and absence of late price writes; Windows data isolation SHALL use the executable-adjacent sandbox data directory, not assume the CLI profile overrides product data paths
