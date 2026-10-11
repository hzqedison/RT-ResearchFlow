"""Read-only, bounded Git-blob audit of a version-pinned source tar archive."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tarfile

MAX_ARCHIVE = 96 * 1024 * 1024
MAX_TREE = 2 * 1024 * 1024
MAX_MEMBER = 8 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_MEMBERS = 20000
PATTERNS = {"TekColor": re.compile(rb"TekColor", re.I),
            "TekHVC": re.compile(rb"TekHVC", re.I),
            "Xcms": re.compile(rb"\bXcms[A-Za-z0-9_]*\b", re.I)}


class Invalid(ValueError):
    pass


def require(value, code):
    if not value:
        raise Invalid(code)


def relative(value):
    require(isinstance(value, str) and value and "\\" not in value
            and all(part not in ("", ".", "..") and ":" not in part
                    and not any(ord(char) < 32 for char in part)
                    for part in value.split("/")), "SOURCE_PATH_INVALID")
    return value


def blob_oid(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


def validate_tree(tree):
    require(isinstance(tree, dict) and tree.get("kind") == "rt-official-git-source-tree-binding-v1"
            and tree.get("treeComplete") is True
            and re.fullmatch(r"[a-f0-9]{40}", tree.get("sourceCommit", "")) is not None,
            "SOURCE_TREE_IDENTITY_INVALID")
    rows = tree.get("files")
    require(isinstance(rows, list) and 0 < len(rows) <= MAX_MEMBERS, "SOURCE_TREE_COVERAGE_INVALID")
    expected = {}
    for row in rows:
        require(isinstance(row, dict), "SOURCE_TREE_ROW_INVALID")
        name = relative(row.get("path"))
        require(name not in expected and row.get("mode") in ("100644", "100755", "120000")
                and re.fullmatch(r"[a-f0-9]{40}", row.get("blobOid", "")) is not None,
                "SOURCE_TREE_ROW_INVALID")
        expected[name] = row
    return expected


def audit_archive(filename, tree):
    expected = validate_tree(tree)
    source = Path(filename)
    require(source.is_file() and not source.is_symlink() and source.stat().st_size <= MAX_ARCHIVE,
            "SOURCE_ARCHIVE_INVALID")
    archive_hash = hashlib.sha256()
    with source.open("rb") as raw:
        for chunk in iter(lambda: raw.read(1024 * 1024), b""):
            archive_hash.update(chunk)
    seen, verified, matches = set(), [], []
    total = count = 0
    root = None
    with tarfile.open(source, "r|gz") as archive:
        for member in archive:
            count += 1
            require(count <= MAX_MEMBERS, "SOURCE_ARCHIVE_MEMBER_LIMIT")
            name = member.name.rstrip("/")
            relative(name)
            first, separator, child = name.partition("/")
            if root is None:
                root = first
            require(first == root, "SOURCE_ARCHIVE_MULTIPLE_ROOTS")
            if not separator:
                require(member.isdir(), "SOURCE_ARCHIVE_ROOT_INVALID")
                continue
            relative(child)
            if member.isdir():
                continue
            require(child not in seen and child in expected, "SOURCE_ARCHIVE_MEMBERSHIP_INVALID")
            seen.add(child)
            row = expected[child]
            if member.issym():
                require(row["mode"] == "120000", "SOURCE_ARCHIVE_KIND_MISMATCH")
                raw = member.linkname.encode("utf-8")
            else:
                require(member.isfile() and row["mode"] != "120000"
                        and 0 <= member.size <= MAX_MEMBER, "SOURCE_ARCHIVE_KIND_MISMATCH")
                stream = archive.extractfile(member)
                require(stream is not None, "SOURCE_ARCHIVE_MEMBER_MISSING")
                raw = stream.read(MAX_MEMBER + 1)
                require(len(raw) == member.size, "SOURCE_ARCHIVE_MEMBER_SIZE")
            total += len(raw)
            require(total <= MAX_TOTAL and blob_oid(raw) == row["blobOid"], "SOURCE_ARCHIVE_BLOB_MISMATCH")
            digest = hashlib.sha256(raw).hexdigest()
            verified.append({"path": child, "blobOid": row["blobOid"], "sha256": digest, "size": len(raw)})
            for pattern, matcher in PATTERNS.items():
                hits = list(matcher.finditer(raw))
                if hits:
                    require(len(matches) < 1000, "SOURCE_PATTERN_RESULT_LIMIT")
                    matches.append({"path": child, "pattern": pattern, "count": len(hits), "blobOid": row["blobOid"],
                                    "sha256": digest, "lineNumbers": [raw.count(b"\n", 0, hit.start()) + 1 for hit in hits[:32]]})
    missing = sorted(set(expected) - seen)
    missing_code = [name for name in missing if name.endswith((".c", ".h", ".m", ".mm", ".cc", ".cpp", ".tcl"))]
    return {"kind": "rt-bounded-git-source-archive-audit-v1", "sourceCommit": tree["sourceCommit"],
            "archiveSha256": archive_hash.hexdigest(), "archiveSize": source.stat().st_size,
            "expectedBlobCount": len(expected), "verifiedBlobCount": len(verified), "archiveMemberCount": count,
            "expandedBytes": total, "allArchiveBlobsMatched": True, "missingGitBlobs": missing,
            "missingCodeBlobs": missing_code, "allGitBlobsCovered": not missing,
            "allListedCodeBlobsCovered": not missing_code, "patternMatches": matches, "verifiedFiles": verified,
            "extractionExecuted": False, "sourceCodeExecuted": False, "licenseApprovalGranted": False,
            "installerAccepted": False, "releaseEligible": False}


def unique_object(rows):
    value = {}
    for key, item in rows:
        require(key not in value, "SOURCE_TREE_DUPLICATE_KEY")
        value[key] = item
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True)
    parser.add_argument("--tree", required=True)
    args = parser.parse_args()
    path = Path(args.tree)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX_TREE, "SOURCE_TREE_FILE_INVALID")
    tree = json.loads(path.read_bytes(), object_pairs_hook=unique_object)
    print(json.dumps(audit_archive(args.archive, tree), sort_keys=True))


if __name__ == "__main__":
    main()
