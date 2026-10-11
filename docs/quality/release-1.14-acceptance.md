# Release 1.14.0 acceptance

Status: published, not a draft or prerelease. Application source: `714c13d291be913afa9215c4b575b9983b44a17b`.

- Native Windows x64, macOS arm64 and macOS x64 build/install/acceptance: run `38170966070`, passed.
- Each native job includes actual packaged initialization UI checks, startup/settings/exit, PDF/canvas/SQLite compatibility, private extension installation, and OS-encrypted credential persistence. Credential and health fixtures are synthetic; provider authentication and brokerage actions are not covered.
- Windows installation/reinstallation/uninstallation and data preservation: run `38171438331`, exact accepted installer and source, passed. This does not prove every historical cross-version migration or Mac upgrade.
- Publication: run `38172239804`, reused accepted bytes without rebuilding, passed. Ten public assets and their server digests were returned by the GitHub Release API.
- Local production Windows 1.13-to-1.14 upgrade in the same D-drive installation returned exit code 0, with six database/configuration hashes preserved before startup. Actual installed startup/settings/normal-exit test: one passed, 13.0 seconds. No credential or health fixtures were applied to production.
- Targeted unit regression: 33 passed. Pinned Node 20 Node/Web type checks and production builds passed. Harness/selector and local invocation failures are retained in `initialization-capabilities-1.14-candidate.md`.

## Installer SHA-256

- Windows x64: `54c7c4819a73584f578a3215eda10a697065da447c671eb22b5afe81e8a33cde`
- macOS arm64: `f4a55c005a9c6e86c33c29bd379849c660c00d6971c8658f3680cc8b9fb4061d`
- macOS x64: `86796a5763a4e0a76da251f8c3ddf3b7076307143bb9e25e3d580b24b5913491`

The broader goal remains active. Full capability/quality mapping, complete free short-term dependencies, task shutdown, historical upgrade coverage, account facts, constrained portfolio backtesting and real-client execution evidence remain unfinished. No live Tushare authentication, complete market data coverage, real trading, or Apple notarization is claimed.
