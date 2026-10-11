"""Isolated stdlib tests. Never install packages or touch existing wheelhouses.

Set PROVIDER_SOURCE_SDIST_DIR to the parent's already verified input directory
on other machines; absent inputs are explicitly skipped, never downloaded.
Windows temporary test output is owned under the repository's K: drive.
Run: python -B -m unittest discover -s tests/python -p test_provider_source_wheels.py -v
"""

import base64
import csv
from email.parser import BytesParser
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("provider_source_wheels_recipe", ROOT / "scripts/build-provider-source-wheels.py")
recipe = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = recipe
SPEC.loader.exec_module(recipe)
SOURCE_DIR = Path(os.environ.get("PROVIDER_SOURCE_SDIST_DIR", "D:/RT-ResearchFlow-BuildCache/private-runtime-1.7/sdists"))


def archive_blob(members):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for name, payload, kind in members:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            entry.size = len(payload) if kind == tarfile.REGTYPE else 0
            if kind in {tarfile.SYMTYPE, tarfile.LNKTYPE}:
                entry.linkname = "../../outside"
            archive.addfile(entry, io.BytesIO(payload) if entry.isfile() else None)
    return gzip.compress(buffer.getvalue(), mtime=0)


class ArchiveSafetyTests(unittest.TestCase):
    def test_rejects_all_unsafe_paths(self):
        for name in ("/root/file", "root/../outside", "root/./file", "root//file",
                     "root\\file", "C:/root/file", "root/file:stream", "root/NUL.txt",
                     "root/trailing. ", "other/file", "root/file\nname"):
            with self.subTest(name=name), self.assertRaises(recipe.RecipeError):
                recipe.read_safe_archive(archive_blob([(name, b"x", tarfile.REGTYPE)]), "root")

    def test_rejects_links_and_devices(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE, tarfile.FIFOTYPE):
            with self.subTest(kind=kind), self.assertRaises(recipe.RecipeError):
                recipe.read_safe_archive(archive_blob([("root/member", b"", kind)]), "root")

    def test_rejects_duplicate_case_and_file_directory_collisions(self):
        for second in ("root/file", "root/FILE", "root/file/child"):
            with self.subTest(second=second), self.assertRaises(recipe.RecipeError):
                recipe.read_safe_archive(archive_blob([
                    ("root/file", b"one", tarfile.REGTYPE), (second, b"two", tarfile.REGTYPE),
                ]), "root")

    def test_decompression_and_member_limits(self):
        blob = archive_blob([("root/a", b"a", tarfile.REGTYPE), ("root/b", b"b", tarfile.REGTYPE)])
        with patch.object(recipe, "MAX_EXPANDED_BYTES", 100), self.assertRaises(recipe.RecipeError):
            recipe.read_safe_archive(blob, "root")
        with patch.object(recipe, "MAX_MEMBERS", 1), self.assertRaises(recipe.RecipeError):
            recipe.read_safe_archive(blob, "root")

    def test_invalid_and_empty_archive(self):
        for blob in (b"not gzip", gzip.compress(b"not tar"), archive_blob([])):
            with self.subTest(blob=blob[:12]), self.assertRaises(recipe.RecipeError):
                recipe.read_safe_archive(blob, "root")

    def test_keeps_regular_resource_bytes_without_extracting(self):
        data = b"\x00resource\xff\r\n"
        self.assertEqual(recipe.read_safe_archive(archive_blob([
            ("root", b"", tarfile.DIRTYPE), ("root/package/data.bin", data, tarfile.REGTYPE),
        ]), "root"), {"package/data.bin": data})

    def test_wheel_entries_refuse_overwrite_and_case_collisions(self):
        entries = {}
        recipe.add_entry(entries, "pkg/A.txt", b"one")
        for name in ("pkg/A.txt", "pkg/a.txt", "../outside"):
            with self.subTest(name=name), self.assertRaises(recipe.RecipeError):
                recipe.add_entry(entries, name, b"two")
        self.assertEqual(entries, {"pkg/A.txt": b"one"})


@unittest.skipUnless(all((SOURCE_DIR / source.filename).is_file() for source in recipe.SOURCES),
                     "Pinned parent sdists are absent; no download is allowed")
class PinnedSourceWheelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="provider-wheel-tests-", dir=ROOT)
        cls.base = Path(cls.temporary.name)
        cls.sources = {source.name: recipe.read_source(SOURCE_DIR, source) for source in recipe.SOURCES}
        cls.first = cls.base / "provider-source-wheels-first"
        cls.second = cls.base / "provider-source-wheels-second"
        cls.summary = recipe.build_all(SOURCE_DIR, cls.first)
        recipe.build_all(SOURCE_DIR, cls.second)

    @classmethod
    def tearDownClass(cls):
        for item in cls.summary:
            print(f"AUDIT {item['filename']} bytes={item['bytes']} sha256={item['sha256']}")
        cls.temporary.cleanup()

    def wheel(self, source):
        filename = source.wheel_stem + "-py2.py3-none-any.whl"
        return zipfile.ZipFile(self.first / filename), source.wheel_stem + ".dist-info"

    def test_exact_pinned_archive_sizes_and_hashes(self):
        for source in recipe.SOURCES:
            blob, _ = self.sources[source.name]
            self.assertEqual(len(blob), source.size)
            self.assertEqual(hashlib.sha256(blob).hexdigest(), source.sha256)

    def test_two_builds_identical_including_audit_sidecars(self):
        names = sorted(path.name for path in self.first.iterdir())
        self.assertEqual(names, sorted(path.name for path in self.second.iterdir()))
        self.assertEqual(len(names), 4)
        for name in names:
            self.assertEqual((self.first / name).read_bytes(), (self.second / name).read_bytes())

    def test_tampered_and_truncated_source_rejected_before_output_creation(self):
        inputs = self.base / "tamper-source-root" / "inputs"
        inputs.mkdir(parents=True)
        for source in recipe.SOURCES:
            (inputs / source.filename).write_bytes(self.sources[source.name][0])
        source = recipe.SOURCES[0]
        original = self.sources[source.name][0]
        for index, data in enumerate((bytes([original[0] ^ 1]) + original[1:], original[:-1], original + b"x")):
            (inputs / source.filename).write_bytes(data)
            destination = self.base / f"provider-source-wheels-tamper-{index}"
            with self.assertRaises(recipe.RecipeError) as caught:
                recipe.build_all(inputs, destination)
            self.assertEqual(str(caught.exception), f"Source size/SHA-256 mismatch: {source.filename}")
            self.assertFalse(destination.exists())

    def test_untampered_source_succeeds_with_same_separate_root_layout(self):
        inputs = self.base / "clean-source-root" / "inputs"
        inputs.mkdir(parents=True)
        for source in recipe.SOURCES:
            (inputs / source.filename).write_bytes(self.sources[source.name][0])
        destination = self.base / "provider-source-wheels-clean-copy"
        self.assertEqual(recipe.build_all(inputs, destination), self.summary)
        for item in self.summary:
            self.assertEqual((destination / item["filename"]).read_bytes(),
                             (self.first / item["filename"]).read_bytes())

    def test_all_original_code_and_package_resources_preserved_byte_for_byte(self):
        for source in recipe.SOURCES:
            _, files = self.sources[source.name]
            with self.wheel(source)[0] as wheel:
                for path, data in files.items():
                    if path == source.runtime or source.runtime.endswith("/") and path.startswith(source.runtime):
                        self.assertEqual(wheel.read(path), data)
                self.assertNotIn("setup.py", wheel.namelist())
                self.assertNotIn("test_execjs.py", wheel.namelist())

    def test_full_original_source_archive_inventory_and_metadata_retained(self):
        for source in recipe.SOURCES:
            blob, files = self.sources[source.name]
            wheel, info = self.wheel(source)
            with wheel:
                embedded = wheel.read(f"{info}/audit/{source.filename}")
                self.assertEqual(embedded, blob)
                self.assertEqual(recipe.read_safe_archive(embedded, source.archive_root), files)
                self.assertEqual(wheel.read(f"{info}/audit/upstream-PKG-INFO"), files["PKG-INFO"])
                provenance = json.loads(wheel.read(f"{info}/audit/source-provenance.json"))
                self.assertEqual({item["path"]: (item["bytes"], item["sha256"]) for item in provenance["source_files"]},
                                 {path: (len(data), recipe.sha256(data)) for path, data in files.items()})

    def test_original_standalone_and_embedded_licenses_retained(self):
        for source in recipe.SOURCES:
            wheel, info = self.wheel(source)
            with wheel:
                names = [name for name in wheel.namelist() if name.startswith(f"{info}/licenses/")]
                self.assertEqual(len(names), 1)
                self.assertEqual(wheel.read(names[0]), self.sources[source.name][1][source.license_file])
                self.assertIn(b"Permission is hereby granted", wheel.read(names[0]))

    def test_requires_dist_original_identity_and_eol_description(self):
        for source in recipe.SOURCES:
            wheel, info = self.wheel(source)
            with wheel:
                metadata = BytesParser().parsebytes(wheel.read(f"{info}/METADATA"))
                self.assertEqual(metadata["Name"], source.name)
                self.assertEqual(metadata["Version"], source.version)
                self.assertEqual(metadata.get_all("Requires-Dist", []), list(source.requires))
                self.assertIn("MIT", metadata["License"])
                if source.name == "PyExecJS":
                    self.assertEqual(metadata.get_payload().encode("utf-8"), self.sources[source.name][1]["README.rst"])
                    self.assertIn("no longer maintananced", metadata.get_payload())

    def test_dependency_declaration_disagreement_is_not_silently_dropped(self):
        source = recipe.SOURCES[1]
        files = dict(self.sources[source.name][1])
        files["PyExecJS.egg-info/requires.txt"] = b"six>=2\n"
        with self.assertRaises(recipe.RecipeError):
            recipe.metadata(source, files)
        files = dict(self.sources[source.name][1])
        files["setup.py"] = files["setup.py"].replace(b"six >= 1.10.0", b"six >= 2.0.0")
        with self.assertRaises(recipe.RecipeError):
            recipe.metadata(source, files)

    def test_record_covers_every_zip_entry_with_actual_hash_and_size(self):
        for source in recipe.SOURCES:
            wheel, info = self.wheel(source)
            with wheel:
                record_name = f"{info}/RECORD"
                rows = list(csv.reader(io.StringIO(wheel.read(record_name).decode("utf-8"))))
                self.assertEqual(len(rows), len(wheel.namelist()))
                self.assertEqual({row[0] for row in rows}, set(wheel.namelist()))
                self.assertEqual(rows[-1], [record_name, "", ""])
                for name, digest, size in rows[:-1]:
                    data = wheel.read(name)
                    expected = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode("ascii")
                    self.assertEqual(digest, "sha256=" + expected)
                    self.assertEqual(int(size), len(data))

    def test_zip_timestamps_modes_tags_and_no_compressor_variance(self):
        for source in recipe.SOURCES:
            wheel, info = self.wheel(source)
            with wheel:
                for item in wheel.infolist():
                    self.assertEqual(item.date_time, recipe.FIXED_TIME)
                    self.assertEqual(item.compress_type, zipfile.ZIP_STORED)
                    self.assertEqual(item.external_attr >> 16, 0o100644)
                    self.assertEqual(item.create_system, 3)
                    self.assertEqual(item.extra, b"")
                tags = BytesParser().parsebytes(wheel.read(f"{info}/WHEEL"))
                self.assertEqual(tags.get_all("Tag"), ["py2-none-any", "py3-none-any"])
                self.assertEqual(tags["Root-Is-Purelib"], "true")

    def test_source_and_wheel_provenance_and_unresolved_closure_are_explicit(self):
        for source, summary in zip(recipe.SOURCES, self.summary):
            data = json.loads((self.first / (summary["filename"] + ".provenance.json")).read_bytes())
            self.assertEqual(data["source"]["url"], source.url)
            self.assertEqual(data["source"]["sha256"], source.sha256)
            self.assertEqual(data["wheel"]["sha256"], recipe.sha256((self.first / summary["filename"]).read_bytes()))
            self.assertEqual(data["requires_dist"], list(source.requires))
            self.assertIn("not-resolved", data["dependency_closure"])
            self.assertEqual(data["builder"]["build_dependencies"], [])
            self.assertFalse(data["builder"]["network_used"])
            self.assertFalse(data["builder"]["upstream_setup_executed"])
            self.assertFalse(data["upstream_code_modified"])

    def test_conflicts_existing_cache_and_non_owned_output_refused(self):
        before = {path.name: path.read_bytes() for path in self.first.iterdir()}
        for destination in (self.first, SOURCE_DIR.parent / "provider-source-wheels-forbidden",
                            self.base / "wheelhouse", self.base / "providers" / "provider-source-wheels-forbidden"):
            with self.subTest(destination=destination), self.assertRaises(recipe.RecipeError):
                recipe.build_all(SOURCE_DIR, destination)
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.first.iterdir()})


if __name__ == "__main__":
    unittest.main()
