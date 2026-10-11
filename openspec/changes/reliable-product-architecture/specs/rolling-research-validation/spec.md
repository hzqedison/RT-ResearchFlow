## ADDED Requirements

### Requirement: Freeze a rolling research protocol before evaluating test windows
The product SHALL persist the dataset, research budget, dates, candidate holding periods, training selection rule and minimum observations before running any step. Each test window SHALL be non-overlapping and SHALL begin after an embargo at least as long as the largest candidate holding period. Selection SHALL use only training reports, with a committed selection timestamp before test execution. Pre-existing test reports from before selection SHALL be rejected.

#### Scenario: Training quality is insufficient
- **WHEN** no candidate meets the predeclared training observation and drawdown thresholds
- **THEN** the study is blocked without relaxing thresholds or selecting from test outcomes

#### Scenario: Test performance is negative or incomplete
- **WHEN** a test report loses money, exceeds the training risk threshold, or lacks observations
- **THEN** the report remains visible; losses are included in independent-window statistics and missing observations are not zero returns

### Requirement: Persist resumable local steps without claiming continuous capital or broker execution
Each step SHALL execute at most one capital simulation or commit one training selection. Reports and study progress SHALL commit atomically, preserve stable report identities, and survive restart. Pause SHALL stop before the next step rather than interrupt an in-flight SQLite transaction. Transport failure SHALL require explicit saved-state recovery, not automatic retries. Caller validation SHALL precede database access.

#### Scenario: Calendar changes after protocol creation
- **WHEN** the saved interval calendar fingerprint no longer matches
- **THEN** the next step is rejected without rewriting the saved protocol

#### Scenario: Independent budgets and imperfect facts
- **WHEN** summaries are displayed
- **THEN** they state that each window resets its budget, that statistics are not a continuous portfolio or annualized return, and that per-report market snapshots and historical signal timing remain limitations
