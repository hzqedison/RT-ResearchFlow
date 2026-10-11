import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("restore_lxml_build_tools", Path(__file__).resolve().parents[2] / "scripts" / "restore-lxml-build-tools.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class RestoreBuildToolsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = MODULE.restore_bytes()
        cls.recipe = json.loads((MODULE.BASE / "tools-reconstruction.json").read_bytes())

    def test_actual_frozen_archive_all_members(self):
        self.assertEqual(len(self.raw), 1130006)
        self.assertEqual(MODULE.digest(self.raw), MODULE.ARCHIVE_SHA)
        self.assertEqual(MODULE.validate_archive(self.raw, self.recipe), self.raw)

    def test_mutated_and_truncated_archive_are_rejected(self):
        for raw in (self.raw[:-1], bytes([self.raw[0] ^ 1]) + self.raw[1:]):
            with self.assertRaises(ValueError):
                MODULE.validate_archive(raw, self.recipe)

    def test_member_inventory_cannot_redirect(self):
        recipe = json.loads(json.dumps(self.recipe))
        recipe["members"][0]["path"] = "../outside"
        with self.assertRaises(ValueError):
            MODULE.validate_archive(self.raw, recipe)

    def test_duplicate_json_rejected(self):
        with self.assertRaises(ValueError):
            json.loads('{"members":[],"members":[]}', object_pairs_hook=MODULE.strict_object)

    def test_writes_only_new_destination_with_exact_bytes(self):
        with tempfile.TemporaryDirectory(prefix="rt-lxml-tools-test-") as root:
            output = Path(root).resolve() / "tools-snapshot.zip"
            result = MODULE.restore(output)
            self.assertEqual(output.read_bytes(), self.raw)
            self.assertEqual(result["membersVerified"], 469)
            self.assertTrue(result["buildOnly"])
            with self.assertRaises(ValueError):
                MODULE.restore(output)

    def test_relative_or_wrong_named_output_refused(self):
        for output in ("relative/tools-snapshot.zip", str(Path(tempfile.gettempdir()).resolve() / "other.zip")):
            with self.assertRaises(ValueError):
                MODULE.restore(output)

if __name__ == "__main__":
    unittest.main()
