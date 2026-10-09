#!/usr/bin/env python3
"""Restore reviewed build-only tools without pip, network, or publisher claims."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import zipfile

BASE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "lxml-build-tools"
ARCHIVE_SHA = "7b63f9d52edbedcaef3e59692588a4ddb9a7279a5917f231ee4cc0bc076d2d9e"
ARCHIVE_SIZE = 1130006
RECIPE_SHA = "15cdb8bf809b3a267f080e26c391842dac401f6649efe626f01134aa2d7b6dc0"
CHUNKS = (
    ("tools-snapshot.zip.b64.01", 400000, "72d3349fdc6fe418d1e47cf4692cc7d1107c71e2676163b737f9572a5dd6f1b1"),
    ("tools-snapshot.zip.b64.02", 400000, "bf597d141a472f2d3ba16ef96a171a6ea9f778886d5463d685edd22558c9f90d"),
    ("tools-snapshot.zip.b64.03", 400000, "c265798ea8265af5e82c92baefc8e967c20c478c65337738ffb396947316d704"),
    ("tools-snapshot.zip.b64.04", 306676, "3ad248aa0ca750e06e85a7fd9f55d93c7ed2b98b1e87076cbc0306d08808750b"),
)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def safe_input(base, name, maximum):
    root = Path(base)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("TOOLS_INPUT_ROOT")
    target = root / name
    info = target.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > maximum:
        raise ValueError("TOOLS_INPUT_FILE")
    raw = target.read_bytes()
    if len(raw) != info.st_size:
        raise ValueError("TOOLS_INPUT_CHANGED")
    return raw

def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("TOOLS_DUPLICATE_KEY")
        result[key] = value
    return result

def validate_archive(raw, recipe):
    if len(raw) != ARCHIVE_SIZE or digest(raw) != ARCHIVE_SHA:
        raise ValueError("TOOLS_ARCHIVE_BYTES")
    if recipe.get("schema") != "rt-tools-offline-exact-reconstruction-v1" or \
            recipe.get("archiveSha256") != ARCHIVE_SHA or recipe.get("archiveBytes") != ARCHIVE_SIZE:
        raise ValueError("TOOLS_RECIPE_BINDING")
    members = recipe.get("members")
    if not isinstance(members, list) or len(members) != 469:
        raise ValueError("TOOLS_MEMBER_INVENTORY")
    expected = {}
    for member in members:
        name = member["path"]
        parts = PurePosixPath(name).parts
        if not name or "\\" in name or PurePosixPath(name).is_absolute() or \
                any(part in ("", ".", "..") or ":" in part for part in parts) or name in expected:
            raise ValueError("TOOLS_MEMBER_PATH")
        expected[name] = member
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        if len(infos) != len(expected) or len({row.filename for row in infos}) != len(infos):
            raise ValueError("TOOLS_ZIP_INVENTORY")
        total = 0
        for row in infos:
            member = expected.get(row.filename)
            if member is None or row.is_dir() or stat.S_ISLNK(row.external_attr >> 16) or \
                    row.file_size != member["bytes"] or row.file_size > 4 * 1024 * 1024:
                raise ValueError("TOOLS_ZIP_MEMBER")
            total += row.file_size
            if total > 3940339:
                raise ValueError("TOOLS_ZIP_TOTAL")
            if digest(archive.read(row)) != member["sha256"]:
                raise ValueError("TOOLS_MEMBER_BYTES")
        if total != 3940339:
            raise ValueError("TOOLS_ZIP_TOTAL")
    return raw

def restore_bytes(base=BASE):
    encoded = []
    for name, size, expected in CHUNKS:
        raw = safe_input(base, name, size)
        if len(raw) != size or digest(raw) != expected:
            raise ValueError("TOOLS_CHUNK_BYTES")
        encoded.append(raw)
    raw = base64.b64decode(b"".join(encoded), validate=True)
    recipe_bytes = safe_input(base, "tools-reconstruction.json", 100000)
    if digest(recipe_bytes) != RECIPE_SHA:
        raise ValueError("TOOLS_RECIPE_BYTES")
    recipe = json.loads(recipe_bytes.decode("utf-8"), object_pairs_hook=strict_object)
    return validate_archive(raw, recipe)

def restore(output, base=BASE):
    target = Path(output)
    if not target.is_absolute() or target.name != "tools-snapshot.zip" or target.exists() or target.is_symlink():
        raise ValueError("TOOLS_OUTPUT")
    parent = target.parent
    if not parent.is_dir() or parent.is_symlink() or parent.resolve() != parent:
        raise ValueError("TOOLS_OUTPUT_PARENT")
    # Build inputs belong outside the source checkout. Never overwrite source,
    # an existing archive or product data while reconstructing this build tool.
    source = Path(__file__).resolve().parent.parent
    if target.is_relative_to(source):
        raise ValueError("TOOLS_OUTPUT_SOURCE")
    raw = restore_bytes(base)
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        # Retain partial owned evidence rather than silently deleting/retrying.
        raise
    return {"kind": "rt-lxml-reviewed-build-tools-restored-v1", "bytes": len(raw),
            "sha256": digest(raw), "membersVerified": 469, "buildOnly": True,
            "originalPublisherWheelProvenance": "not asserted"}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(restore(args.output)))

if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile):
        print("LXML_BUILD_TOOLS_RESTORE_FAILED", file=sys.stderr)
        sys.exit(1)
