"""Build-only archive preservation contracts; no product runtime executed."""
import hashlib
import importlib.util
import json
import pathlib
import tarfile
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[2] / "scripts/run-private-runtime-prepare-ci.py"
SPEC = importlib.util.spec_from_file_location("rt_candidate_archive", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CandidateArchiveTests(unittest.TestCase):
    def fixture(self, parent):
        lab = parent / "original"
        lab.mkdir()
        (lab / "prepare").mkdir()
        (lab / "prepare/fact.json").write_text('{"fixture":true}', encoding="ascii")
        for name in ("handoff.json", "source-receipt.json", "python.tar.gz"):
            (lab / name).write_bytes(b"isolated unapproved fixture")
        (lab / "home").mkdir()
        (lab / "home/never-export").write_bytes(b"not build material")
        proof = parent / "proof"
        proof.mkdir()
        return lab, proof

    def test_exact_inputs_and_scope_survive_archive(self):
        with tempfile.TemporaryDirectory() as root:
            lab, proof = self.fixture(pathlib.Path(root))
            result = MODULE.retain_native_candidate(lab, proof)
            archive = proof / result["filename"]
            self.assertEqual(result["sha256"], hashlib.sha256(archive.read_bytes()).hexdigest())
            self.assertEqual(result["size"], archive.stat().st_size)
            self.assertFalse(result["releaseEligible"])
            self.assertFalse(result["formalBundle"])
            self.assertFalse(result["relocalizationApproved"])
            self.assertEqual(result["originalRoot"], str(lab))
            with tarfile.open(archive, "r:gz") as source:
                names = source.getnames()
                self.assertIn("prepare/fact.json", names)
                self.assertEqual(source.extractfile("handoff.json").read(), b"isolated unapproved fixture")
                self.assertFalse(any(name == "home" or name.startswith("home/") for name in names))

    def test_missing_inputs_refuse_before_archive(self):
        with tempfile.TemporaryDirectory() as root:
            lab, proof = self.fixture(pathlib.Path(root))
            (lab / "source-receipt.json").unlink()
            with self.assertRaises(ValueError):
                MODULE.retain_native_candidate(lab, proof)
            self.assertFalse((proof / "native-preparation-candidate.tar.gz").exists())

    def test_existing_archive_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as root:
            lab, proof = self.fixture(pathlib.Path(root))
            archive = proof / "native-preparation-candidate.tar.gz"
            archive.write_bytes(b"foreign-existing")
            with self.assertRaises(FileExistsError):
                MODULE.retain_native_candidate(lab, proof)
            self.assertEqual(archive.read_bytes(), b"foreign-existing")


if __name__ == "__main__":
    unittest.main()
