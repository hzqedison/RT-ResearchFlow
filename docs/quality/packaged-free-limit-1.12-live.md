# 1.12 packaged public-data acceptance

- Tested the actual packaged Windows application and its preload IPC, not a mock provider.
- Read an actual source-reported public limit-up pool for 20261009 over the network.
- Completed all three built-in free strategy laboratory runs: continuous boards 3 matches, second boards 5 matches, early first boards 7 matches.
- Validated source dates, retained input evidence, and rejected unsupported return backtests.
- The trading-calendar gate used an explicit synthetic fixture in win-unpacked only. This is not proof of a live trading-calendar provider or whole-market completeness.
- No production user data was modified by this fixture test. No broker account was connected and no order was submitted.
- A first installed Windows upgrade attempt returned exit code 2. Retrying with the registered all-users scope and D-drive temporary directory succeeded. The installed program became 1.12.0 and all snapshotted database/configuration/private-Python files retained their hashes.
- The first Mac Intel acceptance attempt failed because the delayed onboarding overlay intercepted a configuration click. The test now closes that overlay through its normal visible control rather than forcing clicks or weakening assertions. Fresh native acceptance must pass before publication.
- No usable Tushare test key was available. The visible binding UI and isolated validation logic are tested, but live Tushare authentication and account-specific entitlements are not claimed.

Run the optional public-data test only against the isolated packaged copy:

```powershell
$env:RT_PUBLIC_LIMIT_POOL_LIVE = '1'
$env:RT_PUBLIC_LIMIT_POOL_DATE = '20261009'
$env:RT_PACKAGED_EXE = '<candidate>/release/win-unpacked/RT-ResearchFlow.exe'
node node_modules/@playwright/test/cli.js test tests/e2e/free-limit-lab-live.spec.ts --workers=1 --retries=0 --reporter=line
```

Public data can change or become unavailable. An empty or unavailable response must not be reported as a successful run or replaced with synthetic market rows.
