#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Deterministic stdlib-only wheel; no setup.py/pip/network/source execution.

Independent rt-private-node-js-runtime 1.0.0, never a mini-racer distribution.
Stores complete own runtime sources, recipe and repository license unchanged.
Receipt is byte provenance only; it grants no provider/native/license approval.
"""
import argparse
import base64
import csv
import hashlib
import io
import json
from pathlib import Path
import zipfile

STEM = "rt_private_node_js_runtime-1.0.0"
DIST = STEM + ".dist-info"
SOURCE_FILES = ("rt_private_node_js_runtime/__init__.py", "rt_private_node_js_runtime/worker.cjs")


def digest(data): return hashlib.sha256(data).hexdigest()


def sources(directory):
    files = {}
    for name in SOURCE_FILES:
        path = directory / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise ValueError("bounded regular source files required")
        files[name] = path.read_bytes()
    binding = [{"path": name, "size": len(files[name]), "sha256": digest(files[name])} for name in sorted(files)]
    identity = digest(json.dumps(binding, sort_keys=True, separators=(",", ":")).encode("ascii"))
    return files, binding, identity


def build(source_dir, output_dir, expected_source_sha256):
    source_dir, output_dir = Path(source_dir), Path(output_dir)
    if not source_dir.is_absolute() or not output_dir.is_absolute() or output_dir.exists() or output_dir.is_symlink():
        raise ValueError("absolute source and fresh output directories required")
    if not output_dir.parent.is_dir() or not output_dir.name.startswith("private-node-js-runtime-"):
        raise ValueError("existing output parent and private-node-js-runtime-* name required")
    files, binding, identity = sources(source_dir)
    if identity != expected_source_sha256: raise ValueError("source binding mismatch")
    recipe = Path(__file__).read_bytes()
    license_bytes = (Path(__file__).resolve().parent.parent / "LICENSE").read_bytes()
    files[DIST + "/licenses/LICENSE"] = license_bytes
    files[DIST + "/runtime-source/build-private-node-js-runtime-wheel.py"] = recipe
    files[DIST + "/METADATA"] = ("Metadata-Version: 2.4\nName: rt-private-node-js-runtime\nVersion: 1.0.0\n"
        "Summary: Explicitly configured private Node persistent JavaScript backend\nRequires-Python: >=3.13\n"
        "License-Expression: AGPL-3.0-only\nLicense-File: licenses/LICENSE\n\n").encode("ascii")
    files[DIST + "/WHEEL"] = b"Wheel-Version: 1.0\nGenerator: rt-private-node-js-runtime-recipe-1\nRoot-Is-Purelib: true\nTag: py3-none-any\n\n"
    records = io.StringIO(newline=""); writer = csv.writer(records, lineterminator="\n")
    for name, data in sorted(files.items()):
        writer.writerow([name, "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode("ascii"), len(data)])
    writer.writerow([DIST + "/RECORD", "", ""])
    files[DIST + "/RECORD"] = records.getvalue().encode("utf-8")
    output_dir.mkdir()
    filename = STEM + "-py3-none-any.whl"
    with zipfile.ZipFile(output_dir / filename, "x", compression=zipfile.ZIP_STORED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0)); info.create_system = 3
            info.external_attr = 0o100644 << 16; info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, data)
    blob = (output_dir / filename).read_bytes()
    receipt = {"kind": "rt-private-node-js-runtime-wheel-receipt-v1", "releaseEligible": False,
        "distribution": "rt-private-node-js-runtime", "version": "1.0.0", "sourceSha256": identity, "sources": binding,
        "recipeSha256": digest(recipe), "licenseSha256": digest(license_bytes),
        "wheel": {"kind": "derived", "filename": filename, "sha256": digest(blob), "size": len(blob)}}
    (output_dir / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.source_dir, args.output_dir, args.expected_source_sha256)))


if __name__ == "__main__": main()
