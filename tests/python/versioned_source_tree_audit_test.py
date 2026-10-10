"""Synthetic archives test the audit's rejection boundaries, not release eligibility."""
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("rt_source_tree_audit", ROOT / "scripts/audit-versioned-source-tree.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="rt-source-audit-")
        self.root = Path(self.temp.name)
        self.archive = self.root / "fixture.tar.gz"
        self.tree = {"kind": "rt-official-git-source-tree-binding-v1", "treeComplete": True,
                     "sourceCommit": "a" * 40, "files": []}

    def tearDown(self):
        self.temp.cleanup()

    def make(self, rows, names=None):
        self.tree["files"] = [{"path": name, "mode": "100644", "blobOid": audit.blob_oid(raw)} for name, raw in rows]
        with tarfile.open(self.archive, "w:gz") as tar:
            for index, (name, raw) in enumerate(rows):
                member = tarfile.TarInfo("fixture/" + (names[index] if names else name))
                member.size = len(raw)
                tar.addfile(member, io.BytesIO(raw))

    def test_complete_bound_archive_is_scanned_without_execution(self):
        self.make([("macosx/color.c", b"/* TekHVC XcmsColor */\n"), ("license.terms", b"notice")])
        result = audit.audit_archive(self.archive, self.tree)
        self.assertTrue(result["allGitBlobsCovered"])
        self.assertFalse(result["sourceCodeExecuted"])
        self.assertFalse(result["licenseApprovalGranted"])
        self.assertEqual({row["pattern"] for row in result["patternMatches"]}, {"TekHVC", "Xcms"})

    def test_changed_blob_rejected(self):
        self.make([("file.c", b"source")])
        self.tree["files"][0]["blobOid"] = "0" * 40
        with self.assertRaisesRegex(audit.Invalid, "BLOB_MISMATCH"):
            audit.audit_archive(self.archive, self.tree)

    def test_untrusted_archive_path_rejected(self):
        self.make([("file.c", b"source")], ["../outside"])
        with self.assertRaisesRegex(audit.Invalid, "PATH_INVALID"):
            audit.audit_archive(self.archive, self.tree)

    def test_duplicate_archive_member_rejected(self):
        self.make([("file.c", b"source"), ("other.c", b"other")], ["file.c", "file.c"])
        with self.assertRaisesRegex(audit.Invalid, "MEMBERSHIP_INVALID"):
            audit.audit_archive(self.archive, self.tree)

    def test_export_omission_is_reported_not_falsely_marked_complete(self):
        self.make([("file.c", b"source")])
        self.tree["files"].append({"path": "omitted.c", "mode": "100644", "blobOid": "0" * 40})
        result = audit.audit_archive(self.archive, self.tree)
        self.assertFalse(result["allGitBlobsCovered"])
        self.assertFalse(result["allListedCodeBlobsCovered"])
        self.assertEqual(result["missingCodeBlobs"], ["omitted.c"])

    def test_symlink_is_never_extracted_or_executed(self):
        raw = b"../target"
        self.tree["files"] = [{"path": "alias", "mode": "120000", "blobOid": audit.blob_oid(raw)}]
        with tarfile.open(self.archive, "w:gz") as tar:
            member = tarfile.TarInfo("fixture/alias")
            member.type = tarfile.SYMTYPE
            member.linkname = raw.decode()
            tar.addfile(member)
        result = audit.audit_archive(self.archive, self.tree)
        self.assertEqual(result["verifiedBlobCount"], 1)
        self.assertFalse((self.root / "alias").exists())


if __name__ == "__main__":
    unittest.main()
