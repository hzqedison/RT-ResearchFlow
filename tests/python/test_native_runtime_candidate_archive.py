"""Build-only archive preservation contracts; no product runtime executed."""
import hashlib
import importlib.util
import json
import os
import pathlib
import stat
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
        tree = lab / "prepare/materialize/tree"
        tree.mkdir(parents=True)
        (tree / "bin").mkdir()
        (tree / "bin/runtime").write_bytes(b"synthetic native runtime")
        (tree / "bin/runtime").chmod(0o755)
        for name in ("prepare/candidate-lock.json", "prepare/candidate-fragment.json"):
            (lab / name).write_bytes(b'{"fixture":"original candidate bytes"}\n')
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
                self.assertIn("prepare/materialize/tree/bin/runtime", names)
                for name in ("prepare/candidate-lock.json", "prepare/candidate-fragment.json",
                             "handoff.json", "source-receipt.json", "python.tar.gz"):
                    self.assertEqual(source.extractfile(name).read(), (lab / name).read_bytes())
                self.assertEqual(source.extractfile("handoff.json").read(), b"isolated unapproved fixture")
                self.assertFalse(any(name == "home" or name.startswith("home/") for name in names))
            self.assertFalse(result["formalApproval"])
            self.assertFalse(result["rawInputAssets"])
            self.assertFalse(result["privateNativeBuildMaterials"])
            self.assertFalse(result["assetsRootIncluded"])
            self.assertTrue(result["cleanAssetsRequired"])

    def test_missing_inputs_refuse_before_archive(self):
        for missing in ("prepare/candidate-lock.json", "prepare/candidate-fragment.json",
                        "prepare/materialize/tree", "handoff.json", "source-receipt.json"):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as root:
                lab, proof = self.fixture(pathlib.Path(root))
                if (lab / missing).is_dir():
                    (lab / missing).rename(lab / "not-the-required-tree")
                else:
                    (lab / missing).unlink()
                with self.assertRaises(ValueError):
                    MODULE.retain_native_candidate(lab, proof)
                self.assertFalse((proof / "native-preparation-candidate.tar.gz").exists())

    def test_raw_assets_and_private_build_materials_are_not_archived(self):
        with tempfile.TemporaryDirectory() as root:
            lab, proof = self.fixture(pathlib.Path(root))
            excluded = ("prepare/resolve/assets/original.whl",
                        "prepare/resolve/assets/original.whl.proof",
                        "prepare/materialize/assets/source-materials.zip",
                        "prepare/materialize/assets/original.tar.gz",
                        "prepare/resolve/native-build/raw/lib.dll",
                        "prepare/materialize/native-build/raw/lib.dylib",
                        "prepare/private-native-build/raw.a",
                        "prepare/resolve/operation-private.json",
                        "prepare/materialize/operation-private.json",
                        "prepare/resolve/provider-normal-resolver.json",
                        "prepare/unreviewed-extra.json")
            for name in excluded:
                location = lab / name
                location.parent.mkdir(parents=True, exist_ok=True)
                location.write_bytes(b"PRIVATE-RAW-INPUT-DO-NOT-EXPORT")
            result = MODULE.retain_native_candidate(lab, proof)
            with tarfile.open(proof / result["filename"], "r:gz") as archive:
                names = archive.getnames()
                self.assertTrue(set(excluded).isdisjoint(names))
                for member in archive.getmembers():
                    self.assertFalse(member.name.startswith(("prepare/resolve/assets", "prepare/materialize/assets")))
                    if member.isfile():
                        self.assertNotIn(b"PRIVATE-RAW-INPUT-DO-NOT-EXPORT", archive.extractfile(member).read())

    def test_tree_names_bytes_and_modes_are_not_extension_filtered(self):
        with tempfile.TemporaryDirectory() as root:
            lab, proof = self.fixture(pathlib.Path(root))
            for relative in ("assets/notice.whl.proof", "native-build/NOTICE.json", "source-materials.zip"):
                name = lab / "prepare/materialize/tree" / relative
                name.parent.mkdir(parents=True, exist_ok=True)
                name.write_bytes(b"legitimate prepared tree member")
            result = MODULE.retain_native_candidate(lab, proof)
            with tarfile.open(proof / result["filename"], "r:gz") as archive:
                tree = lab / "prepare/materialize/tree"
                for original in (tree, tree / "bin", tree / "bin/runtime",
                                 tree / "assets/notice.whl.proof", tree / "native-build/NOTICE.json",
                                 tree / "source-materials.zip"):
                    member = archive.getmember(original.relative_to(lab).as_posix())
                    self.assertEqual(member.mode, stat.S_IMODE(original.stat().st_mode))
                    if original.is_file():
                        self.assertEqual(archive.extractfile(member).read(), original.read_bytes())

    def test_optional_evidence_is_exact_and_absence_is_allowed(self):
        for include in (False, True):
            with self.subTest(include=include), tempfile.TemporaryDirectory() as root:
                lab, proof = self.fixture(pathlib.Path(root))
                (lab / "python.tar.gz").unlink()
                names = ("prepare/materialize/inventory.json", "prepare/materialize/native-evidence.json",
                         "prepare/resolve/operation-public.json", "prepare/materialize/operation-public.json",
                         "operations.json")
                if include:
                    for name in names:
                        location = lab / name
                        location.parent.mkdir(parents=True, exist_ok=True)
                        location.write_bytes(b'{ "original": "not reserialized" }\n')
                result = MODULE.retain_native_candidate(lab, proof)
                with tarfile.open(proof / result["filename"], "r:gz") as archive:
                    self.assertNotIn("python.tar.gz", archive.getnames())
                    for name in names:
                        if include:
                            self.assertEqual(archive.extractfile(name).read(), (lab / name).read_bytes())
                        else:
                            self.assertNotIn(name, archive.getnames())

    def test_internal_symlink_text_is_preserved_without_dereference(self):
        with tempfile.TemporaryDirectory() as root:
            lab, proof = self.fixture(pathlib.Path(root))
            link = lab / "prepare/materialize/tree/bin/runtime-link"
            try:
                link.symlink_to("runtime")
            except OSError as error:
                self.skipTest("Host cannot create a test symlink: " + str(error.errno))
            result = MODULE.retain_native_candidate(lab, proof)
            with tarfile.open(proof / result["filename"], "r:gz") as archive:
                member = archive.getmember("prepare/materialize/tree/bin/runtime-link")
                self.assertTrue(member.issym())
                self.assertEqual(member.linkname, "runtime")

    def test_escaping_tree_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            lab, proof = self.fixture(pathlib.Path(root))
            try:
                (lab / "prepare/materialize/tree/raw-link").symlink_to(pathlib.Path("../../../source-receipt.json"))
            except OSError as error:
                self.skipTest("Host cannot create a test symlink: " + str(error.errno))
            with self.assertRaises(ValueError):
                MODULE.retain_native_candidate(lab, proof)

    def test_internal_hardlink_stays_inside_retained_archive(self):
        with tempfile.TemporaryDirectory() as root:
            lab, proof = self.fixture(pathlib.Path(root))
            original = lab / "prepare/materialize/tree/bin/runtime"
            linked = original.with_name("runtime-copy")
            os.link(original, linked)
            result = MODULE.retain_native_candidate(lab, proof)
            with tarfile.open(proof / result["filename"], "r:gz") as archive:
                member = archive.getmember(linked.relative_to(lab).as_posix())
                self.assertTrue(member.islnk())
                self.assertEqual(member.linkname, original.relative_to(lab).as_posix())
                self.assertEqual(archive.extractfile(member).read(), original.read_bytes())

    def test_existing_archive_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as root:
            lab, proof = self.fixture(pathlib.Path(root))
            archive = proof / "native-preparation-candidate.tar.gz"
            archive.write_bytes(b"foreign-existing")
            with self.assertRaises(FileExistsError):
                MODULE.retain_native_candidate(lab, proof)
            self.assertEqual(archive.read_bytes(), b"foreign-existing")


class CandidateCacheRootTests(unittest.TestCase):
    def test_exact_runner_input_directory_is_accepted(self):
        with tempfile.TemporaryDirectory() as root:
            temporary = pathlib.Path(root).resolve()
            cache = temporary / "verified-native-inputs"
            cache.mkdir()
            self.assertEqual(MODULE.validated_cache_roots([str(cache)], temporary), [str(cache)])

    def test_relative_outside_and_runner_root_are_rejected(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            temporary = pathlib.Path(root).resolve()
            for candidate in ("relative-inputs", str(temporary), str(pathlib.Path(outside).resolve())):
                with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                    MODULE.validated_cache_roots([candidate], temporary)

    def test_missing_and_duplicate_inputs_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            temporary = pathlib.Path(root).resolve()
            cache = temporary / "verified-native-inputs"
            cache.mkdir()
            with self.assertRaises(FileNotFoundError):
                MODULE.validated_cache_roots([str(temporary / "missing")], temporary)
            with self.assertRaises(ValueError):
                MODULE.validated_cache_roots([str(cache), str(cache)], temporary)


if __name__ == "__main__":
    unittest.main()
