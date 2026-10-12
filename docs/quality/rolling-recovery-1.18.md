# Rolling save recovery correction, 1.18 candidate

The user approved fixing the known recovery-state defect. An unknown save
remains locked after storage or transport errors. Only a trusted NOT_FOUND
response for the pending study ID clears that uncertainty and preparation
reference. A matching stale study display is cleared; form parameters remain.
No study is deleted, no old report is rewritten and no broker order is sent.

The previously failing actual Windows application-directory testcase now
passes. It induces a real SQLite insert failure, removes the isolated trigger,
recovers through the real preload/IPC entry point and observes confirmed
absence. It verifies the form and save action are enabled, the recovery action
is removed, dates and budget are retained, and a retry produces exactly one
persisted protocol with zero of two planned reports completed. No renderer
errors were observed. Windows fixtures now use a fresh application-directory
layout; --user-data-dir alone is not claimed to isolate Windows product data.

Local main/renderer type checks succeeded. The 31-file targeted regression
suite passed all 284 cases. The actual Windows application-directory suite
passed all six cases in 18.2 seconds (rolling recovery plus five cancellation
cases). The chip test-cache omission was separately corrected with explicit
user approval; expected result and signal assertions were not weakened.

Native diagnostic run 38190130632 is successful on the preceding
05abd5a40d7c6141a1ebfcbd12fffac4a0af45cf fixture-only source. That run is not
evidence for this subsequent renderer change, and is not an installer gate.

The new renderer source still requires both full native Mac gates, the native
Windows installer gate and its actual installer lifecycle gate. No 1.18
publication is authorized by the preceding diagnostic-only run. Real Tushare
entitlement and live broker execution remain unverified; no Key is required
for isolated package acceptance. Full OpenSpec scope remains incomplete.
