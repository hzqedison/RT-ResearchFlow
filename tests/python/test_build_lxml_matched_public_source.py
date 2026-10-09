import importlib.util
import io
from pathlib import Path
import tarfile
import unittest

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


if __name__ == "__main__":
    unittest.main()
