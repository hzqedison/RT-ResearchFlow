"""Synthetic module fixtures exercise the real scope collector, not native acceptance."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from importlib.machinery import BuiltinImporter

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("rt_crypto_reporter_test", REPO / "scripts/report-private-runtime-native-bootstrap.py")
reporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reporter)


class CryptoScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="rt-crypto-scope-")
        self.root = Path(self.temp.name).resolve()
        self.module_path = self.root / "python/DLLs/_ssl.pyd"
        self.module_path.parent.mkdir(parents=True)
        raw = b"synthetic-ssl-module-fixture-not-a-native-binary"
        self.module_path.write_bytes(raw)
        self.manifest = self.root / "manifest.json"
        self.manifest.write_text(json.dumps({"files": [{"path": "python/DLLs/_ssl.pyd", "kind": "file", "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}]}), encoding="utf-8")
        self.contract = {"runtimeRoot": str(self.root), "manifestPath": str(self.manifest)}
        self.module = SimpleNamespace(__file__=str(self.module_path), OPENSSL_VERSION="OpenSSL 3.5.4 synthetic-fixture", OPENSSL_VERSION_INFO=(3, 5, 4, 0, 0))

    def tearDown(self):
        self.temp.cleanup()

    def test_bound_scope_has_no_license_or_release_grant(self):
        value = reporter.observe_crypto_scope(self.contract, self.module)
        self.assertEqual(value["modulePath"], "python/DLLs/_ssl.pyd")
        self.assertEqual(value["libraryVersionInfo"], [3, 5, 4, 0, 0])
        self.assertFalse(value["licenseApprovalGranted"])
        self.assertFalse(value["releaseEligible"])
        self.assertNotIn(str(self.root), json.dumps(value))

    def test_changed_native_bytes_rejected(self):
        self.module_path.write_bytes(b"changed-fixture")
        with self.assertRaises(reporter.Invalid):
            reporter.observe_crypto_scope(self.contract, self.module)

    def test_unlisted_module_rejected(self):
        self.manifest.write_text(json.dumps({"files": []}), encoding="utf-8")
        with self.assertRaises(reporter.Invalid):
            reporter.observe_crypto_scope(self.contract, self.module)

    def test_module_outside_python_subtree_rejected(self):
        outside = self.root / "_ssl.pyd"
        outside.write_bytes(b"outside")
        self.module.__file__ = str(outside)
        with self.assertRaises(reporter.Invalid):
            reporter.observe_crypto_scope(self.contract, self.module)

    def test_duplicate_inventory_module_rejected(self):
        value = json.loads(self.manifest.read_text(encoding="utf-8"))
        value["files"].append(value["files"][0])
        self.manifest.write_text(json.dumps(value), encoding="utf-8")
        with self.assertRaises(reporter.Invalid):
            reporter.observe_crypto_scope(self.contract, self.module)

    def test_version_fields_cannot_embed_paths_or_multiline_data(self):
        for value in ("OpenSSL 3.5.4\ncredential", "unregistered-library", "OpenSSL 3.5.4 C:/private", "OpenSSL " + "x" * 129):
            with self.subTest(value=value):
                self.module.OPENSSL_VERSION = value
                with self.assertRaises(reporter.Invalid):
                    reporter.observe_crypto_scope(self.contract, self.module)

    def test_builtin_ssl_binds_actual_interpreter_carrier(self):
        carrier = self.root / "python/python"
        raw = b"synthetic-interpreter-fixture"
        carrier.write_bytes(raw)
        manifest = json.loads(self.manifest.read_text(encoding="utf-8"))
        manifest["python"] = {"executable": "python/python"}
        manifest["files"].append({"path": "python/python", "kind": "file", "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
        self.manifest.write_text(json.dumps(manifest), encoding="utf-8")
        del self.module.__file__
        self.module.__name__ = "_ssl"
        self.module.__spec__ = SimpleNamespace(name="_ssl", origin="built-in", loader=BuiltinImporter)
        with patch.object(reporter.sys, "executable", str(carrier)), patch.object(reporter.sys, "builtin_module_names", ("_ssl",)):
            value = reporter.observe_crypto_scope(self.contract, self.module)
        self.assertEqual(value["modulePath"], "python/python")
        self.assertEqual(value["loadingMode"], "builtin")
        self.assertFalse(value["licenseApprovalGranted"])

    def test_missing_file_without_builtin_identity_is_rejected(self):
        del self.module.__file__
        with self.assertRaises(reporter.Invalid):
            reporter.observe_crypto_scope(self.contract, self.module)

    def test_boolean_version_component_rejected(self):
        self.module.OPENSSL_VERSION_INFO = (True, 5, 4, 0, 0)
        with self.assertRaises(reporter.Invalid):
            reporter.observe_crypto_scope(self.contract, self.module)


if __name__ == "__main__":
    unittest.main()
