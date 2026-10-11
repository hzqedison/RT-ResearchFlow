# Initialization capabilities 1.14 candidate

Status: candidate, not published. Public release and the production Windows installation remain 1.13.0.

## Implemented path

- Initialization and onboarding use the same basic-use database blocker policy. Provider/module errors retain their original severity and remain visible but do not disable unrelated basic local use.
- Only freshness facts establish local data readiness. Available synchronization jobs may supply actions, not completed facts. Neutral, missing, unknown, waiting, failed and invalid-count facts do not establish readiness.
- Without Tushare, missing stock identity facts lead to the existing free synchronization action. With usable basic facts, optional provider and AI setup does not prevent entering the workbench.
- Tushare, AI, historical daily data and concept steps remain visible, explicitly labeled optional enhancements. Unknown/empty signals do not become a no-opportunity conclusion.
- The guide's active state includes the actual multi-task initialization flow. Database failure still takes priority over basic-use actions.
- Windows CI source checking now fails immediately on nonzero native command exits instead of letting a later successful command mask an earlier test failure.

## Evidence

- Three targeted Vitest files: 33 passed, zero failures after fixing the SSR harness to supply the existing classic JSX React global. The first run had 32 passed and one harness failure; the production renderer uses its unchanged build configuration.
- Pinned Node 20 Node/Web TypeScript checks passed. The first package-level invocation selected global pnpm 11 / Node 24 for nested scripts and failed the existing engine guard; no dependency or global runtime was changed. Direct pinned compiler execution passed.
- Production Electron main/preload/renderer and research-access builds passed. Windows directory packaging passed with on-demand extension delivery and native dependency rebuilding disabled; shared dependencies were not mutated.
- Actual packaged Windows initialization UI: 1 passed, 9.3 seconds, normal exit code 0. Used only isolated fixtures for provider permission and database errors, delayed stock synchronization and local facts; no brokerage actions.
- Actual packaged Windows startup/settings/clean-exit test passed. The first combined UI run failed because the button's accessible name is `打开新用户引导`, not its visible text `新用户引导`; the test now uses the existing stable test ID. No force click or production UI workaround was used.
- The fixture test forbids production Windows installations and requires explicit fixture authorization; Mac execution requires isolated GitHub CI. Test profiles remain under the D-drive acceptance root locally.

## Pending / boundaries

- Native Windows installer and both Mac DMG acceptance for this source still pending; the new actual UI test is wired into all three jobs before installer receipts are generated.
- No live Tushare Key, paid interface permission, complete historical market coverage, auction/chip facts, portfolio accounting or real trading evidence is claimed.
- This is progress on task 4.2, not completion of its entire provider/quality mapping or task 8.2. Historical 1.0-to-1.1 upgrade evidence and full Mac upgrade/data retention scope remain open.
