# AI configuration 1.13 candidate evidence

Not published. Local production and public installers remain 1.12.

## Scope

The actual trusted AI IPC save handler now delegates to one transactional partial-update service. Empty or omitted keys preserve existing credentials. Explicit removal affects only the selected provider, its legacy selected-provider copy, and its priority/multi-model selections. Other providers and unsaved UI drafts remain intact.

Credential status distinguishes unconfigured, locally readable, unavailable OS secure storage, and unreadable ciphertext. It never returns plaintext and does not claim remote authorization.

## Observed evidence

- AI storage unit file: 35 passed. Mock OS storage covers unavailable encryption, unreadable ciphertext and local status; real SQLite covers partial updates, validation, transaction rollback, and close/reopen persistence.
- Combined targeted regression: 6 files, 108 passed, 0 failed. Includes those same 35 tests; counts are not additive. It is not a full-suite result and does not include the separate native-protocol file.
- Node and Web TypeScript checks: exit 0 after removing three obsolete imports found by the first check.
- Production main/preload/renderer and research-access builds succeeded. Two local packaging commands failed before a completed package: incorrectly parsed CLI configuration, then an incorrect delivery environment variable selecting the bundled-runtime path. The successful directory package used `RT_EXTENSION_DELIVERY=on-demand` and disabled rebuilding shared dependencies.
- Actual Windows packaged startup/settings/free-strategy UI/normal exit: 1 passed, 9.8 seconds.
- Actual Windows packaged credential UI/save/normal exit/restart/OS decrypt/explicit removal: 1 passed, 16.4 seconds. Uses Electron secure storage, not a mocked OS API. Two earlier selector failures occurred before the credential-save click; selecting the observed URL input resolved them without changing runtime behavior or forcing a click.
- Credential fixture runs only in isolated win-unpacked (or an isolated Mac profile with explicit test authorization). A randomly generated nonfunctional key and loopback base URL are used; the local installed application is forbidden for the Windows credential fixture.

## Remaining gates

- Mac arm64 and x64 actual secure-storage persistence, normal restart and credential-removal checks.
- Native installer lifecycle and same-byte three-platform publication evidence for 1.13.
- Remote provider authentication and entitlements: no usable test key available. No broker account or order is used.
- Full lifecycle coverage in task 4.4, historical upgrades, and the broader trading/account/backtesting scope remain incomplete.

Task 4.1 remains unchecked until its full cross-platform scope is proven.
