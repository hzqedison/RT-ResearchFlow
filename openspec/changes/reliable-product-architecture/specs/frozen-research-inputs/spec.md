## ADDED Requirements

### Requirement: Freeze a common dataset when saving a rolling protocol
New rolling studies SHALL atomically save their protocol and immutable market-input snapshot before any training report. The snapshot SHALL include the entire declared interval's calendar, selected-source signals, raw daily bars, adjustment factors and source fields. All training candidates and test windows SHALL consume slices of this snapshot rather than mutable live caches. Each report SHALL bind the same snapshot reference while retaining its own window-input fingerprint.

#### Scenario: Cache changes between windows
- **WHEN** current prices, adjustment factors, signal membership or source fields change or disappear after protocol creation
- **THEN** the saved study continues from its original snapshot without refresh, fallback or rewritten prior reports; a new protocol is required to capture new facts

### Requirement: Keep integrity, capacities and old studies explicit
Snapshots SHALL have content digests, recorded observation time and bounded storage: at most 5000 signals, 250 selected symbols, 300000 bars, 64 MiB per snapshot, 100 snapshots and 512 MiB aggregate payload. Missing or corrupt snapshots SHALL stop new progress while retaining readable prior results. A failed protocol save SHALL roll back its snapshot. Legacy studies without snapshots SHALL remain readable and SHALL NOT be retroactively frozen or extended.

#### Scenario: An old report has matching parameters but no common snapshot
- **WHEN** such a report is encountered for a new protocol step
- **THEN** it is rejected as a report conflict, never relabelled or rerun with the same identity

### Requirement: Separate reproducibility from historical availability and execution
The UI SHALL display the common snapshot interval, counts and digest. Frozen current local inputs SHALL NOT be described as proving historical point-in-time availability, valid brokerage execution or continuous capital between independent windows. Existing calendar-change rejection, training-only selection, separate selection commit, unknown-save recovery and negative-test inclusion SHALL remain.

#### Scenario: Native publication
- **WHEN** 1.21 or later is published
- **THEN** every native receipt SHALL include localFrozenResearchSnapshotVerified from the actual packaged UI/IPC/storage, cache-deletion, snapshot-loss and restart test; unit checks alone cannot satisfy the gate
