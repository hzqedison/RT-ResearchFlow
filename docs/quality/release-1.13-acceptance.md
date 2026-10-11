# Release 1.13.0 acceptance

Status: published. Application source: 83824be618f94ef0725f181130a94e5785cde60f.

- Native build/acceptance run: 38168283671. Windows x64, macOS arm64 and macOS x64 passed.
- Installer lifecycle run: 38168863794, same source and exact accepted Windows installer, passed.
- Publish run: 38169352640, reused accepted bytes without rebuilding, passed.
- Native receipts require real packaged startup, private extension installation, and local OS-encrypted credential persistence evidence.
- Credential test uses a synthetic invalid key and loopback endpoint. Save, normal exit, restart/read, clear, normal exit and another restart were checked. No provider authentication or brokerage action is implied.
- Windows production upgrade in the existing D-drive directory returned exit code 0. Six pre-upgrade database/configuration hashes were preserved before application startup.
- Installed Windows workbench/settings/clean-exit test passed: 1 test, 13.3 seconds. Credential fixtures were NOT run against production data.

## Published installer SHA-256

- Windows x64: 8fe020156b038e1828129a226c7e3352813cb176529a51dc231aef1f9f75e571
- macOS arm64: 72d9f70915d67b493cedbf3868ba0edf8a8c44a9921d207278e60b187cd02d7b
- macOS x64: 6c9cd7c820820816af5d60f1707c7b826cb5c9236deb0fe6810e3e3bca0d9d0a

The GitHub release is public, not a draft or prerelease, and includes 10 installer/checksum/acceptance assets. No live Tushare credential, complete market coverage, real trading, or Apple notarization acceptance is claimed. Historical candidate notes describe intermediate states, not additional shipped versions. The broader project goal remains active.