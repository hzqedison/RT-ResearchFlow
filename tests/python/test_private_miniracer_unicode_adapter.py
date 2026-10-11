"""Product adapter contracts with owned Unicode fixtures, not native V8 proof."""

import contextlib
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "resources/python-runtime/miniracer_unicode_adapter.py"
ORIGINAL_DECODER = ROOT / "tests/fixtures/runtime/mootdx-holiday.original.js"
SPEC = importlib.util.spec_from_file_location("private_miniracer_product_adapter", SOURCE)
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)

FAKE_DLL = '''from pathlib import Path
def _open_resource_file(filename, stack):
    return str(Path(__file__).parent / filename)
ORIGINAL_OPEN = _open_resource_file
'''
FAKE_PACKAGE = '''import contextlib
import os
from . import _dll
class MiniRacer:
    initialized = False
    contexts = 0
    closed = 0
    fail_context = 0
    fail_icu = False
    fail_decoder = False
    events = []
    evaluations = []
    def __init__(self):
        MiniRacer.contexts += 1
        self.number = MiniRacer.contexts
    def __enter__(self):
        if not MiniRacer.initialized:
            with contextlib.ExitStack() as stack:
                for name in ("mini_racer.dll", "icudtl.dat", "snapshot_blob.bin"):
                    result = _dll._open_resource_file(name, stack)
                    MiniRacer.events.append((name, result, os.getcwd()))
            MiniRacer.initialized = True
        return self
    def eval(self, expression):
        MiniRacer.evaluations.append((self.number, expression, os.getcwd(), _dll._open_resource_file is _dll.ORIGINAL_OPEN))
        if self.number == MiniRacer.fail_context:
            raise RuntimeError("owned-fixture-context-failure")
        if "Intl.DateTimeFormat" in expression:
            return not MiniRacer.fail_icu
        if expression.startswith("JSON.stringify(d("):
            if MiniRacer.fail_decoder:
                return "[]"
            return '["1990-12-19"]' if "LC/AAAAAAA" in expression else '["1990-12-20"]'
        return "\\u4e2d\\u6587" if expression.startswith("'") else 42
    def __exit__(self, *args):
        MiniRacer.closed += 1
        return False
'''


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


class AdapterContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="rt-miniracer-adapter-contract-")
        self.owned = Path(self.temporary.name).resolve()
        self.root = self.owned / "\u771f\u5b9e Unicode \u8d44\u6e90"
        self.site = self.root / "providers/mootdx/site"
        self.resources = self.site / "py_mini_racer"
        self.resources.mkdir(parents=True)
        self.original_cwd = Path.cwd()
        self.original_path = list(sys.path)
        sys.path.insert(0, str(self.site))
        self.files = []
        self.write("miniracer_unicode_adapter.py", SOURCE.read_bytes())
        self.write("providers/mootdx/site/py_mini_racer/__init__.py", FAKE_PACKAGE.encode("utf-8"))
        self.write("providers/mootdx/site/py_mini_racer/_dll.py", FAKE_DLL.encode("utf-8"))
        self.write("providers/mootdx/site/mini_racer-0.12.4.dist-info/METADATA",
                   b"Metadata-Version: 2.3\nName: mini-racer\nVersion: 0.12.4\n")
        self.write("providers/mootdx/site/mootdx/utils/holiday.js", ORIGINAL_DECODER.read_bytes())
        for resource in ("mini_racer.dll", "icudtl.dat", "snapshot_blob.bin"):
            self.write("providers/mootdx/site/py_mini_racer/" + resource, b"OWNED-FIXTURE-NOT-NATIVE-V8")
        self.manifest = {
            "schemaVersion": 1, "kind": "rt-private-python-runtime", "complete": True,
            "platform": "win32", "miniRacerAdapter": {
                "path": "miniracer_unicode_adapter.py", "version": "0.12.4",
                "sha256": digest(SOURCE.read_bytes()), "windowsStrategy": adapter.STRATEGY,
            },
            "providers": {"mootdx": {"site": "providers/mootdx/site", "wheels": [
                {"distribution": "mini-racer", "version": "0.12.4"}]}},
            "files": self.files,
        }
        self.manifest_path = self.root / "manifest.json"
        self.platform = patch.object(adapter.sys, "platform", "win32")
        self.platform.start()
        self.save()

    def tearDown(self):
        os.chdir(self.original_cwd)
        self.platform.stop()
        sys.path[:] = self.original_path
        for name in list(sys.modules):
            if name == "py_mini_racer" or name.startswith("py_mini_racer."):
                del sys.modules[name]
        # Only this test's own temporary tree is removed, never native parent caches.
        self.temporary.cleanup()

    def write(self, name, raw):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        entry = {"path": name, "kind": "file", "size": len(raw), "sha256": digest(raw)}
        existing = next((item for item in self.files if item["path"] == name), None)
        if existing is None:
            self.files.append(entry)
        else:
            existing.update(entry)

    def save(self):
        raw = json.dumps(self.manifest, ensure_ascii=False).encode("utf-8")
        self.manifest_path.write_bytes(raw)
        return digest(raw)

    def run_adapter(self):
        return adapter.prepare_miniracer(self.manifest_path, "mootdx", self.save())

    def test_unicode_cwd_two_contexts_exact_resource_hook_and_restoration(self):
        result = self.run_adapter()
        module = sys.modules["py_mini_racer"]
        dll = sys.modules["py_mini_racer._dll"]
        self.assertEqual(result["contexts"], 2)
        self.assertTrue(result["unicodeResourceDirectory"])
        self.assertTrue(result["cwdRestored"])
        self.assertTrue(result["functionRestored"])
        self.assertTrue(result["icuVerified"])
        self.assertTrue(result["decoderVerified"])
        self.assertEqual(result["decoderFixtures"], 2)
        self.assertEqual(module.MiniRacer.contexts, 2)
        self.assertEqual(module.MiniRacer.closed, 2)
        self.assertIs(dll._open_resource_file, dll.ORIGINAL_OPEN)
        self.assertEqual(Path.cwd(), self.original_cwd)
        events = module.MiniRacer.events
        self.assertEqual(events[0][1], str(self.resources / "mini_racer.dll"))
        self.assertEqual([event[1] for event in events[1:]], ["icudtl.dat", "snapshot_blob.bin"])
        self.assertTrue(all(Path(event[2]) == self.resources for event in events))
        post_restore = [item for item in module.MiniRacer.evaluations if "Intl.DateTimeFormat" in item[1] or item[1].startswith("JSON.stringify(d(")]
        self.assertEqual(len(post_restore), 3)
        self.assertTrue(all(number == 2 and Path(cwd) == self.original_cwd and restored for number, expression, cwd, restored in post_restore))

    def test_second_context_icu_failure_is_not_unicode_string_success(self):
        original_import = importlib.import_module
        def configured(name):
            module = original_import(name)
            if name == "py_mini_racer":
                module.MiniRacer.fail_icu = True
            return module
        with patch.object(adapter.importlib, "import_module", side_effect=configured):
            with self.assertRaises(RuntimeError):
                self.run_adapter()
        self.assertEqual(Path.cwd(), self.original_cwd)
        dll = sys.modules["py_mini_racer._dll"]
        self.assertIs(dll._open_resource_file, dll.ORIGINAL_OPEN)

    def test_second_context_original_decoder_failure_is_rejected(self):
        original_import = importlib.import_module
        def configured(name):
            module = original_import(name)
            if name == "py_mini_racer":
                module.MiniRacer.fail_decoder = True
            return module
        with patch.object(adapter.importlib, "import_module", side_effect=configured):
            with self.assertRaises(RuntimeError):
                self.run_adapter()
        self.assertEqual(Path.cwd(), self.original_cwd)
        dll = sys.modules["py_mini_racer._dll"]
        self.assertIs(dll._open_resource_file, dll.ORIGINAL_OPEN)

    def test_manifest_hash_is_required(self):
        with self.assertRaises(RuntimeError):
            adapter.prepare_miniracer(self.manifest_path, "mootdx", "0" * 64)

    def test_changed_resource_bytes_fail_before_native_import(self):
        (self.resources / "snapshot_blob.bin").write_bytes(b"changed")
        with patch.object(adapter.importlib, "import_module") as imported:
            with self.assertRaises(RuntimeError):
                self.run_adapter()
            imported.assert_not_called()

    def test_unlisted_resource_is_rejected(self):
        (self.resources / "unexpected.bin").write_bytes(b"unexpected")
        with self.assertRaises(RuntimeError):
            self.run_adapter()

    def test_missing_resource_is_rejected(self):
        (self.resources / "icudtl.dat").unlink()
        with self.assertRaises((RuntimeError, FileNotFoundError)):
            self.run_adapter()

    def test_adapter_source_identity_is_bound(self):
        self.manifest["miniRacerAdapter"]["sha256"] = "0" * 64
        with self.assertRaises(RuntimeError):
            self.run_adapter()

    def test_manifest_version_cannot_silently_upgrade(self):
        self.manifest["providers"]["mootdx"]["wheels"][0]["version"] = "0.12.5"
        with self.assertRaises(RuntimeError):
            self.run_adapter()

    def test_installed_metadata_version_must_match(self):
        self.write("providers/mootdx/site/mini_racer-0.12.4.dist-info/METADATA",
                   b"Metadata-Version: 2.3\nName: mini-racer\nVersion: 0.12.5\n")
        with self.assertRaises(RuntimeError):
            self.run_adapter()

    def test_preexisting_provider_threads_are_rejected_without_patching(self):
        with patch.object(adapter.threading, "active_count", return_value=2), patch.object(adapter.importlib, "import_module") as imported:
            with self.assertRaises(RuntimeError):
                self.run_adapter()
            imported.assert_not_called()
        self.assertEqual(Path.cwd(), self.original_cwd)

    def test_preimported_miniracer_is_rejected(self):
        importlib.import_module("py_mini_racer")
        with self.assertRaises(RuntimeError):
            self.run_adapter()

    def test_first_context_failure_restores_function_and_cwd(self):
        original_import = importlib.import_module

        def configured_import(name):
            module = original_import(name)
            if name == "py_mini_racer":
                module.MiniRacer.fail_context = 1
            return module

        with patch.object(adapter.importlib, "import_module", side_effect=configured_import):
            with self.assertRaisesRegex(RuntimeError, "owned-fixture-context-failure"):
                self.run_adapter()
        dll = sys.modules["py_mini_racer._dll"]
        self.assertIs(dll._open_resource_file, dll.ORIGINAL_OPEN)
        self.assertEqual(Path.cwd(), self.original_cwd)
        self.assertEqual(sys.modules["py_mini_racer"].MiniRacer.closed, 1)

    def test_second_context_failure_does_not_reinstall_the_hook(self):
        original_import = importlib.import_module

        def configured_import(name):
            module = original_import(name)
            if name == "py_mini_racer":
                module.MiniRacer.fail_context = 2
            return module

        with patch.object(adapter.importlib, "import_module", side_effect=configured_import):
            with self.assertRaisesRegex(RuntimeError, "owned-fixture-context-failure"):
                self.run_adapter()
        dll = sys.modules["py_mini_racer._dll"]
        self.assertIs(dll._open_resource_file, dll.ORIGINAL_OPEN)
        self.assertEqual(Path.cwd(), self.original_cwd)
        self.assertEqual(sys.modules["py_mini_racer"].MiniRacer.closed, 2)

    def test_mac_checks_version_and_hashes_without_import_or_hook(self):
        self.manifest["platform"] = "darwin"
        with patch.object(adapter.sys, "platform", "darwin"), patch.object(adapter.importlib, "import_module") as imported:
            result = self.run_adapter()
            imported.assert_not_called()
        self.assertEqual(result["contexts"], 0)
        self.assertFalse(result["hookUsed"])
        self.assertEqual(Path.cwd(), self.original_cwd)

    def test_mac_rejects_wrong_version_without_hooking(self):
        self.manifest["platform"] = "darwin"
        self.manifest["providers"]["mootdx"]["wheels"][0]["version"] = "0.12.5"
        with patch.object(adapter.sys, "platform", "darwin"), patch.object(adapter.importlib, "import_module") as imported:
            with self.assertRaises(RuntimeError):
                self.run_adapter()
            imported.assert_not_called()

    def test_hash_ledger_cannot_escape_the_runtime(self):
        self.files.append({"path": "../outside.bin", "kind": "file", "size": 1, "sha256": "1" * 64})
        with self.assertRaises(RuntimeError):
            self.run_adapter()

    def test_duplicate_resource_entries_are_rejected(self):
        self.files.append(dict(self.files[0]))
        with self.assertRaises(RuntimeError):
            self.run_adapter()

    def test_a_second_provider_site_cannot_be_mixed_in(self):
        other = self.root / "providers/akshare/site"
        other.mkdir(parents=True)
        sys.path.insert(0, str(other))
        with self.assertRaises(RuntimeError):
            self.run_adapter()

    def test_native_evidence_cannot_be_accepted_as_a_release_manifest(self):
        raw = json.dumps({"schemaVersion": 1, "kind": "rt-private-miniracer-native-evidence", "releaseEligible": False}).encode()
        self.manifest_path.write_bytes(raw)
        with self.assertRaises(RuntimeError):
            adapter.prepare_miniracer(self.manifest_path, "mootdx", digest(raw))


if __name__ == "__main__":
    unittest.main(verbosity=2)
