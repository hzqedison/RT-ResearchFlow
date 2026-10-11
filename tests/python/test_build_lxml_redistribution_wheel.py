import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("redistribution", ROOT / "scripts/build-lxml-redistribution-wheel.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(target="win32-x64"):
    info = "lxml-6.1.3.dist-info/"
    suffix = ".pyd" if target == "win32-x64" else ".so"
    files = {"lxml/__init__.py": b"__version__ = '6.1.3'\n", "lxml/etree" + suffix: b"unchanged native bytes",
        "lxml/.libs/libnative.dylib": b"unchanged dylib", "lxml/isoschematron/__init__.py": b"parses XSL at import",
        "lxml/isoschematron/resources/xsl/iso_dsdl_include.xsl": b"unlicensed include",
        "lxml/isoschematron/resources/xsl/iso_abstract_expand.xsl": b"unlicensed expand",
        "lxml/isoschematron/resources/xsl/other.xsl": b"entire namespace",
        info + "METADATA": b"Metadata-Version: 2.4\nName: lxml\nVersion: 6.1.3\nRequires-Python: >=3.8\n\nOriginal description\n",
        info + "WHEEL": ("Wheel-Version: 1.0\nRoot-Is-Purelib: false\nTag: cp313-cp313-" + module.PINS[target][2] + "\n").encode(),
        info + "licenses/LICENSE.txt": b"original license\n", info + "licenses/LICENSES.txt": b"original aggregate notice\n"}
    record = info + "RECORD"
    files[record] = module.record_bytes(files, record)
    return module.zip_bytes(files)


def source_pin(data, target="win32-x64"):
    return {"target": target, "originalWheelSha256": module.sha(data), "sha256": "a" * 64, "filename": "public.zip", "size": 1}


class RedistributionTests(unittest.TestCase):
    def test_hosted_profile_is_explicit_and_separate_from_local_and_mac(self):
        self.assertEqual(module.input_pin("win32-x64"), module.PINS["win32-x64"])
        hosted = module.input_pin("win32-x64", "hosted-run-37896686196")
        self.assertEqual(hosted[1], "a27904ae1fd3684f8cc8ab4b3c5ab78b1ee3ad4ff8f7301ee24627bca099184c")
        self.assertNotEqual(hosted[1], module.PINS["win32-x64"][1])
        with self.assertRaises(ValueError): module.input_pin("darwin-arm64", "hosted-run-37896686196")
        with self.assertRaises(ValueError): module.input_pin("win32-x64", "unknown")

    def test_crossed_hosted_local_wheel_pins_rejected_before_reading(self):
        name, local, _ = module.PINS["win32-x64"]
        hosted = module.WINDOWS_PROFILES["hosted-run-37896686196"][1]
        with self.assertRaises(ValueError): module.build(name, local, "win32-x64", "missing", "0" * 64, "unused", "hosted-run-37896686196")
        with self.assertRaises(ValueError): module.build(name, hosted, "win32-x64", "missing", "0" * 64, "unused")

    def test_entire_namespace_and_initialiser_removed(self):
        data = fixture(); result, proof = module.repack_bytes(data, "win32-x64", source_pin(data))
        self.assertFalse(any(module.excluded(n) for n in module.zip_files(result)))
        self.assertEqual(len(proof["removedMembers"]), 4)
        self.assertFalse(proof["isoSchematronProvided"])

    def test_all_other_payload_and_notices_preserved(self):
        data = fixture(); result, proof = module.repack_bytes(data, "win32-x64", source_pin(data))
        old, new = module.zip_files(data), module.zip_files(result)
        for pin in proof["preservedMembers"]:
            self.assertEqual(old[pin["upstreamPath"]], new[pin["path"]])
        self.assertEqual(len(proof["nativeMemberPins"]), 2)

    def test_metadata_identity_and_record(self):
        data = fixture(); result, _ = module.repack_bytes(data, "win32-x64", source_pin(data))
        files = module.zip_files(result); record = module.verify_record(files); info = record.rsplit("/", 1)[0]
        self.assertIn(module.VERSION, info)
        self.assertIn(("Version: " + module.VERSION).encode(), files[info + "/METADATA"])
        self.assertIn(b"X-RT-Excluded-Namespace: lxml.isoschematron", files[info + "/METADATA"])
        self.assertIn(("Build: " + module.BUILD).encode(), files[info + "/WHEEL"])

    def test_deterministic(self):
        data = fixture()
        self.assertEqual(module.repack_bytes(data, "win32-x64", source_pin(data))[0], module.repack_bytes(data, "win32-x64", source_pin(data))[0])

    def test_both_mac_tags_preserved(self):
        for target in ("darwin-arm64", "darwin-x64"):
            data = fixture(target); result, proof = module.repack_bytes(data, target, source_pin(data, target))
            module.verify_record(module.zip_files(result)); self.assertFalse(proof["nativeRecompiled"])

    def test_wrong_target_rejected(self):
        data = fixture()
        with self.assertRaises(ValueError): module.repack_bytes(data, "darwin-x64", source_pin(data, "darwin-x64"))

    def test_source_pair_mismatch_rejected(self):
        data = fixture(); pin = source_pin(data); pin["originalWheelSha256"] = "b" * 64
        with self.assertRaises(ValueError): module.repack_bytes(data, "win32-x64", pin)

    def test_record_tampering_rejected(self):
        files = module.zip_files(fixture()); files["lxml/etree.pyd"] += b"changed"
        with self.assertRaises(ValueError): module.verify_record(files)

    def test_traversal_and_case_collision_rejected(self):
        with self.assertRaises(ValueError): module.zip_files(module.zip_bytes({"A": b"1", "a": b"2"}))
        for name in ("../secret", "/absolute", "C:/outside", "a\\b"):
            with self.assertRaises(ValueError): module.safe_name(name)

    def test_changed_pinned_file_and_existing_output_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "input"; path.write_bytes(b"changed")
            with self.assertRaises(ValueError): module.checked(path, module.sha(b"original"))
            with self.assertRaises(ValueError): module.fresh_output(temp)


if __name__ == "__main__":
    unittest.main()
