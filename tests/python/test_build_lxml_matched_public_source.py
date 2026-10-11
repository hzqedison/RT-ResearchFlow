import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("public_source", ROOT / "scripts/build-lxml-matched-public-source.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def tar_fixture(extra=None):
    files = {"lxml-6.1.3/src/lxml/etree.c": b"native generated C unchanged\n",
        "lxml-6.1.3/LICENSES.txt": b"original license notice\n",
        "lxml-6.1.3/src/lxml/isoschematron/__init__.py": b"import parses resources",
        "lxml-6.1.3/src/lxml/isoschematron/resources/a.xsl": b"unlicensed XSL",
        "lxml-6.1.3/src/lxml.egg-info/SOURCES.txt": b"src/lxml/etree.c\nsrc/lxml/isoschematron/resources/a.xsl\n"}
    files.update(extra or {})
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz") as archive:
        for name, data in files.items():
            info = tarfile.TarInfo(name); info.size = len(data); archive.addfile(info, io.BytesIO(data))
    return out.getvalue(), files


class PublicSourceTests(unittest.TestCase):
    def test_hosted_source_and_wrapper_are_independently_fixed(self):
        source, wrapper = module.WINDOWS_SOURCE_PROFILES["hosted-run-37896686196"]
        self.assertEqual(source, "30ec51604396b8dd20d0ef20d6a5f31b54089cd6969738fffc3efced83bcb02a")
        self.assertEqual(wrapper, "d7c7ea6e371971a0505718bfd613455ac93878b7e4394fa31390e497ca49fa19")
        self.assertNotEqual(source, module.NATIVE_SOURCE_SHA)
        self.assertNotEqual(wrapper, module.WRAPPER_SHA)

    def test_crossed_hosted_local_source_pins_rejected(self):
        hosted = module.wheel.WINDOWS_PROFILES["hosted-run-37896686196"][1]
        with self.assertRaises(ValueError): module.build("missing", module.NATIVE_SOURCE_SHA, "win32-x64", hosted, "unused", "hosted-run-37896686196")
        with self.assertRaises(ValueError): module.build("missing", module.WINDOWS_SOURCE_PROFILES["hosted-run-37896686196"][0], "win32-x64", module.wheel.PINS["win32-x64"][1], "unused")

    def adapter_fixture(self):
        pins = {"lxml": ("lxml-6.1.3.tar.gz", module.SDIST_SHA, 12, "historical-url"),
            "libxml2": ("libxml2.tar.gz", module.wheel.sha(b"dependency"), 10, "fixed-dependency-url")}
        original = module.wheel.encoded({"sourceAssets": [{"id": name, "fileName": p[0], "sha256": p[1], "bytes": p[2], "url": p[3]} for name, p in pins.items()]})
        wrapper = ("SOURCE_PINS = " + repr(pins) + "\nMANIFEST_SHA = " + repr(module.wheel.sha(original)) + "\ndef main(argv):\n    return argv\n").encode()
        files = {"rebuild-lxml-native.py": wrapper, "history/ORIGINAL-SOURCE-RELINK-DELTA.json": original,
            "inputs/lxml-6.1.3.tar.gz": b"sanitized", "inputs/libxml2.tar.gz": b"dependency"}
        with mock.patch.multiple(module, WRAPPER_SHA=module.wheel.sha(wrapper), ORIGINAL_MANIFEST_SHA=module.wheel.sha(original),
                                 PUBLIC_SDIST_SHA=module.wheel.sha(b"sanitized"), PUBLIC_SDIST_SIZE=9):
            proof = module.public_adapter(files)
        return files, pins, proof

    def adapter_load(self, root, files):
        for name, data in files.items():
            path = Path(root) / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        adapter = {"__file__": str(Path(root) / "rebuild-lxml-native-public.py"), "__name__": "fixture_adapter"}
        exec(files["rebuild-lxml-native-public.py"], adapter)
        return adapter

    def test_adapter_changes_only_exact_lxml_and_manifest_pins(self):
        files, pins, proof = self.adapter_fixture()
        with tempfile.TemporaryDirectory() as root:
            adapter = self.adapter_load(root, files); native = adapter["load"]()
            self.assertEqual(native.SOURCE_PINS["libxml2"], pins["libxml2"])
            self.assertEqual(native.SOURCE_PINS["lxml"], (pins["lxml"][0], module.wheel.sha(b"sanitized"), 9, pins["lxml"][3]))
            self.assertEqual(native.MANIFEST_SHA, proof["manifestSha256"])
            argv = adapter["main"](["prepare", "--work", "owned"])
            self.assertIn("--manifest", argv); self.assertIn("--materials-dir", argv)
            mapped = json.loads(files["inputs/source-relink-delta-public.json"])
            self.assertEqual(mapped["sourceAssets"][1]["sha256"], pins["libxml2"][1])

    def test_adapter_rejects_tampered_tar_dependency_manifest_and_wrapper(self):
        files, _, _ = self.adapter_fixture()
        for name in ("inputs/lxml-6.1.3.tar.gz", "inputs/libxml2.tar.gz", "inputs/source-relink-delta-public.json", "rebuild-lxml-native.py"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as root:
                adapter = self.adapter_load(root, files)
                (Path(root) / name).write_bytes(files[name] + b"tamper")
                with self.assertRaises(ValueError): adapter["load"]()

    def test_adapter_forbids_fetch_and_overriding_bundled_inputs(self):
        files, _, _ = self.adapter_fixture()
        with tempfile.TemporaryDirectory() as root:
            adapter = self.adapter_load(root, files)
            for argv in (["fetch"], ["build", "--manifest=other"], ["prepare", "--materials-dir", "other"], ["build", "--tools-sha256", "0" * 64]):
                with self.subTest(argv=argv), self.assertRaises(ValueError): adapter["main"](argv)

    def test_adapter_generation_rejects_nonfixed_sanitized_tar(self):
        files, _, _ = self.adapter_fixture()
        files["inputs/lxml-6.1.3.tar.gz"] = b"not the fixed public tar"
        with mock.patch.multiple(module, WRAPPER_SHA=module.wheel.sha(files["rebuild-lxml-native.py"]),
                                 ORIGINAL_MANIFEST_SHA=module.wheel.sha(files["history/ORIGINAL-SOURCE-RELINK-DELTA.json"])):
            with self.assertRaises(ValueError): module.public_adapter(files)

    def test_tar_excludes_entire_namespace_preserves_c_and_licenses(self):
        data, old = tar_fixture(); result, proof = module.sanitize_tar(data)
        with tarfile.open(fileobj=io.BytesIO(result), mode="r:gz") as archive:
            self.assertFalse(any(module.wheel.excluded(m.name) for m in archive.getmembers()))
            for name in ("lxml-6.1.3/src/lxml/etree.c", "lxml-6.1.3/LICENSES.txt"):
                self.assertEqual(archive.extractfile(name).read(), old[name])
            self.assertNotIn(b"isoschematron", archive.extractfile("lxml-6.1.3/src/lxml.egg-info/SOURCES.txt").read())
        self.assertEqual(len(proof["removedMembers"]), 2)
        self.assertEqual(len(proof["preservedNativeSources"]), 1)

    def test_tar_repacking_deterministic(self):
        data, _ = tar_fixture()
        self.assertEqual(module.sanitize_tar(data)[0], module.sanitize_tar(data)[0])

    def test_source_zip_replaces_raw_tar_drops_original_wheel(self):
        data, _ = tar_fixture()
        source = module.wheel.zip_bytes({"inputs/lxml-6.1.3.tar.gz": data, "inputs/original.whl": b"original wheel", "native/library.lib": b"static native bytes", "REBUILD.md": b"historical recipe"})
        result, proof = module.sanitize_materials(source); files = module.wheel.zip_files(result)
        self.assertNotEqual(data, files["inputs/lxml-6.1.3.tar.gz"])
        self.assertNotIn("inputs/original.whl", files)
        self.assertEqual(files["native/library.lib"], b"static native bytes")
        self.assertEqual(files["history/ORIGINAL-REBUILD.md"], b"historical recipe")
        self.assertEqual(proof["rewrittenArchives"][0]["originalSha256"], module.wheel.sha(data))

    def test_nested_zip_is_sanitized(self):
        source = module.wheel.zip_bytes({"nested.zip": module.wheel.zip_bytes({"lxml/isoschematron/__init__.py": b"excluded", "license": b"kept"})})
        result, _ = module.sanitize_materials(source)
        nested = module.wheel.zip_files(module.wheel.zip_files(result)["nested.zip"])
        self.assertEqual(nested, {"license": b"kept"})

    def test_unaffected_archive_bytes_remain_identical(self):
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode="w:gz") as archive:
            info = tarfile.TarInfo("native.c"); info.size = 3; archive.addfile(info, io.BytesIO(b"abc"))
        self.assertEqual(module.sanitize_tar(out.getvalue())[0], out.getvalue())

    def test_tar_traversal_rejected(self):
        data, _ = tar_fixture({"../outside": b"bad"})
        with self.assertRaises(ValueError): module.sanitize_tar(data)

    def test_tar_escaping_link_rejected(self):
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode="w") as archive:
            info = tarfile.TarInfo("link"); info.type = tarfile.SYMTYPE; info.linkname = "../../outside"; archive.addfile(info)
        with self.assertRaises(ValueError): module.sanitize_tar(out.getvalue())

    def test_wrong_source_and_original_wheel_pin_rejected(self):
        with self.assertRaises(ValueError): module.build("missing", "a" * 64, "win32-x64", "b" * 64, "unused")
        with self.assertRaises(ValueError): module.build("missing", "a" * 64, "win32-x64", module.wheel.PINS["win32-x64"][1], "unused")


    def mac_fixture(self, root):
        pins = {}
        for name, old in module.MAC_SOURCE_PINS.items():
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode="w:gz") as archive:
                info = tarfile.TarInfo(name + "/COPYING.LIB")
                data = (name + " full license\n").encode()
                info.size = len(data); archive.addfile(info, io.BytesIO(data))
            data = out.getvalue()
            (Path(root) / old[0]).write_bytes(data)
            pins[name] = (old[0], module.wheel.sha(data), old[2], old[3])
        recipes = {}
        for name, old in module.MAC_RECIPE_PINS.items():
            data = ("fixed recipe " + name + "\n").encode()
            (Path(root) / name).write_bytes(data)
            recipes[name] = (module.wheel.sha(data), old[1])
        return pins, recipes

    def test_mac_requires_checked_native_inputs(self):
        with self.assertRaises(ValueError):
            module.mac_materials({"inputs/lxml-6.1.3.tar.gz": b"sanitized"}, None, "darwin-arm64")

    def test_mac_full_sources_notices_and_offline_entry(self):
        with tempfile.TemporaryDirectory() as root:
            pins, recipes = self.mac_fixture(root)
            with mock.patch.multiple(module, MAC_SOURCE_PINS=pins, MAC_RECIPE_PINS=recipes,
                                     PUBLIC_SDIST_SHA=module.wheel.sha(b"sanitized")):
                files = {"inputs/lxml-6.1.3.tar.gz": b"sanitized"}
                proof = module.mac_materials(files, root, "darwin-arm64")
            self.assertEqual(len(proof["sources"]), 4)
            self.assertEqual(len(proof["fullNoticeFiles"]), 4)
            self.assertEqual(files["native-notices/libiconv/libiconv/COPYING.LIB"], b"libiconv full license\n")
            adapter = {"__file__": str(Path(root) / "rebuild-lxml-macos-public.py"), "__name__": "fixture_mac"}
            for name, data in files.items():
                path = Path(root) / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
            exec(files["rebuild-lxml-macos-public.py"], adapter)
            adapter["main"](["--check"])
            with self.assertRaises(ValueError):
                adapter["main"](["--check", "--iconv-source", "missing"])
            with self.assertRaises(ValueError):
                adapter["main"](["--check", "--iconv-source", str(Path(root) / pins["libiconv"][0]),
                                 "--iconv-sha256", "0" * 64, "--iconv-version", "replacement"])
            (Path(root) / "inputs" / pins["libiconv"][0]).write_bytes(b"tamper")
            with self.assertRaises(ValueError): adapter["main"](["--check"])

    def test_mac_changed_source_or_recipe_bytes_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            pins, recipes = self.mac_fixture(root)
            with mock.patch.multiple(module, MAC_SOURCE_PINS=pins, MAC_RECIPE_PINS=recipes,
                                     PUBLIC_SDIST_SHA=module.wheel.sha(b"sanitized")):
                source = Path(root) / pins["libiconv"][0]
                original = source.read_bytes(); source.write_bytes(original + b"tamper")
                with self.assertRaises(ValueError):
                    module.mac_materials({"inputs/lxml-6.1.3.tar.gz": b"sanitized"}, root, "darwin-x64")
                source.write_bytes(original)
                (Path(root) / "buildlibxml.py").write_bytes(b"tamper")
                with self.assertRaises(ValueError):
                    module.mac_materials({"inputs/lxml-6.1.3.tar.gz": b"sanitized"}, root, "darwin-x64")



if __name__ == "__main__":
    unittest.main()
