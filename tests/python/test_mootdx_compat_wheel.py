"""Offline recipe acceptance against the real pinned upstream wheel.

Run with --upstream-wheel and --temporary-directory. No packages are installed,
no network requests are made, and no production database is opened.
"""

import argparse
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile


recipe_path = Path(__file__).resolve().parents[2] / "scripts" / "build-mootdx-compat-wheel.py"
spec = importlib.util.spec_from_file_location("mootdx_compat_recipe", recipe_path)
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)


class RecipeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = recipe.read_upstream(cls.upstream_wheel)
        cls.derived = recipe.derive_files(cls.original)

    def test_explicit_identity_and_full_dependencies(self):
        metadata = self.derived[recipe.DERIVED_DIST + "/METADATA"].decode("utf-8")
        self.assertIn("Version: 0.11.7+rt.1\n", metadata)
        self.assertIn("Requires-Dist: mini-racer (==0.12.4)\n", metadata)
        self.assertNotIn("Requires-Dist: py-mini-racer", metadata)
        original_requirements = [line for line in self.original[recipe.UPSTREAM_DIST + "/METADATA"].decode("utf-8").splitlines()
                                 if line.startswith("Requires-Dist:") and "py-mini-racer" not in line]
        self.assertTrue(original_requirements)
        for requirement in original_requirements:
            self.assertIn(requirement + "\n", metadata)

    def test_preserves_license_and_unmodified_resources(self):
        changed = {"mootdx/__init__.py", "mootdx/utils/__init__.py", "mootdx/utils/holiday.py", recipe.UPSTREAM_DIST + "/METADATA", recipe.UPSTREAM_DIST + "/RECORD"}
        for name, data in self.original.items():
            if name not in changed:
                renamed = name.replace(recipe.UPSTREAM_DIST + "/", recipe.DERIVED_DIST + "/", 1)
                self.assertEqual(self.derived[renamed], data, name)

    def test_records_all_derived_bytes(self):
        recipe.verify_record(self.derived, recipe.DERIVED_DIST)
        damaged = dict(self.derived)
        damaged["mootdx/utils/holiday.js"] += b"\n"
        with self.assertRaisesRegex(ValueError, "RECORD mismatch"):
            recipe.verify_record(damaged, recipe.DERIVED_DIST)

    def test_private_cache_and_verified_https(self):
        holiday = self.derived["mootdx/utils/holiday.py"].decode("utf-8")
        self.assertIn("with MiniRacer() as js_code:", holiday)
        self.assertIn("httpx.Client(verify=True, timeout=10.0)", holiday)
        self.assertNotIn("verify=False", holiday)
        cache_source = self.derived["mootdx/utils/__init__.py"].decode("utf-8")
        self.assertIn("RT_MOOTDX_CACHE_ROOT", cache_source)
        self.assertIn("relative.drive", cache_source)
        self.assertIn("'..' in relative.parts", cache_source)
        compile(holiday, "holiday.py", "exec")
        compile(cache_source, "utils.py", "exec")

    def test_provenance_does_not_claim_native_acceptance(self):
        proof = json.loads(self.derived[recipe.DERIVED_DIST + "/RT-COMPATIBILITY.json"])
        self.assertEqual(proof["upstream"]["sha256"], recipe.UPSTREAM_SHA256)
        self.assertEqual(proof["version"], recipe.DERIVED_VERSION)
        self.assertIn("native compatibility requires real target-architecture tests", proof["limits"])

    def test_reproducible_zip_and_record(self):
        first = recipe.wheel_bytes(self.derived)
        second = recipe.wheel_bytes(recipe.derive_files(self.original))
        self.assertEqual(first, second)
        with zipfile.ZipFile(io.BytesIO(first)) as archive:
            self.assertTrue(all(entry.date_time == (1980, 1, 1, 0, 0, 0) for entry in archive.infolist()))
            recipe.verify_record({name: archive.read(name) for name in archive.namelist()}, recipe.DERIVED_DIST)

    def test_wrong_upstream_refused(self):
        with tempfile.TemporaryDirectory(dir=self.temporary_directory) as directory:
            wrong = Path(directory) / "wrong.whl"
            wrong.write_bytes(b"not the pinned upstream release")
            with self.assertRaisesRegex(ValueError, "pinned upstream"):
                recipe.read_upstream(wrong)

    def test_existing_conflicting_output_not_overwritten(self):
        with tempfile.TemporaryDirectory(dir=self.temporary_directory) as directory:
            result = recipe.build(self.upstream_wheel, directory)
            target = Path(result["path"])
            self.assertEqual(result, recipe.build(self.upstream_wheel, directory))
            target.write_bytes(b"existing file must survive")
            with self.assertRaises(FileExistsError):
                recipe.build(self.upstream_wheel, directory)
            self.assertEqual(target.read_bytes(), b"existing file must survive")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream-wheel", required=True)
    parser.add_argument("--temporary-directory", required=True)
    args, unittest_args = parser.parse_known_args()
    RecipeTests.upstream_wheel = args.upstream_wheel
    RecipeTests.temporary_directory = args.temporary_directory
    unittest.main(argv=[__file__] + unittest_args)
