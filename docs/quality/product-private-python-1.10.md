# Product-private Python: implementation and evidence

This work is unreleased. The installed Windows product is still 1.9.1.

## Windows

- Production Python now resides under `data/runtime/python` on the product's D drive.
- The extension environment resides under `data/data-source-extensions/environment-product`.
- Only `multi_data_source_config.preference.pythonPath` was changed; provider choices and encrypted credentials were retained.
- Python 3.13.13, local venv, pip, SSL, SQLite and AkShare 1.19.1 import were checked successfully.
- The new application migration unit suite passed three of four cases. Exclusion of shared pip launchers failed.
- A separate reproduction confirmed that Windows namespaced paths cause the relative directory's first component to be empty. Normalize both relative-path operands into the same namespace; the regression now passes while retaining standard-library venv templates.
- The updated local suite passed all sixteen runtime/download/integrity cases, and the main-process type check passed. Real application startup and fresh native installation remain separate release gates.
- The public-history probe was inconclusive because its output decoder failed; do not count its exit code as successful data acceptance.
- Shared C-drive Python and caches have not been removed. Ownership and other consumers must be checked before cleanup.

## Mac

Primary source: https://github.com/astral-sh/python-build-standalone/releases/tag/20261009

- `electron/shared/productPythonDownloads.ts` pins both architectures, exact archive sizes and published SHA-256 digests.
- The arm64 archive was downloaded into the D-drive build cache. Its digest matched the release metadata.
- Archive listing confirmed `python/bin/python3`, standard-library license files, `ensurepip` and a bundled pip wheel.
- Intel metadata was obtained from the same release but the Intel archive has not been downloaded or executed locally.
- Do not relocate framework or Homebrew Python by copying its directory.
- The downloader and the existing extension-install entry point are connected. Size/hash checks, bounded downloads, archive path checks and staged runtime validation are implemented.
- Twelve download-contract/integrity tests and the main-process type check passed locally on Windows. This does not prove native Mac execution.
- A separate dual-architecture native workflow exercises the real download and extension installer with an unavailable system interpreter. Native execution, packaged GUI checks and live data API acceptance remain outstanding until receipts demonstrate otherwise.
- Keep signed application bundles unchanged. Confirm a writable runtime location and upgrade preservation before connecting Mac installation.

## Release gates

Do not publish or replace existing installers until migration exclusions,
failure preservation, download integrity, native startup and actual extension
installation have been accepted on both systems. Existing public 1.9.1 assets
must remain unchanged; the development iteration is 1.10.0.
