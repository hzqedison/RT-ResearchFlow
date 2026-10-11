"""Isolated material/security tests. Native acceptance lives in the native job."""
import argparse
from contextlib import redirect_stderr
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/rebuild-lxml-native.py"
spec = importlib.util.spec_from_file_location("rt_rebuild_lxml_native", SCRIPT)
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class RebuildMaterialsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def archive(self, name="root/file.c", kind=tarfile.REGTYPE, link=""):
        path = self.root / "source.tar.gz"
        with tarfile.open(path, "w:gz") as t:
            member = tarfile.TarInfo(name)
            member.type, member.linkname = kind, link
            data = b"original source and copyright\n"
            member.size = len(data) if kind == tarfile.REGTYPE else 0
            t.addfile(member, io.BytesIO(data) if member.size else None)
        return path

    def test_regular_archive_materializes_without_root_directory(self):
        native.extract_tar(self.archive(), self.root / "out")
        self.assertEqual((self.root / "out/file.c").read_bytes(), b"original source and copyright\n")

    def test_tar_traversal_is_rejected(self):
        with self.assertRaises(ValueError):
            native.extract_tar(self.archive("root/../outside"), self.root / "out")
        self.assertFalse((self.root / "outside").exists())

    def test_all_links_are_rejected(self):
        with self.assertRaises(ValueError):
            native.extract_tar(self.archive(kind=tarfile.SYMTYPE, link="../../outside"), self.root / "out")

    def test_windows_devices_and_ads_are_rejected(self):
        for name in ("root/CON.txt", "root/file:stream", "C:/evil", "root/file.", "root/evil\\name"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                native.member_path(name)

    def test_case_collisions_are_rejected(self):
        archive = self.root / "duplicates.tar.gz"
        with tarfile.open(archive, "w:gz") as t:
            for name in ("root/A.c", "root/a.c"):
                m = tarfile.TarInfo(name)
                m.size = 1
                t.addfile(m, io.BytesIO(b"x"))
        with self.assertRaises(ValueError):
            native.extract_tar(archive, self.root / "out")

    def test_zip_traversal_is_rejected(self):
        archive = self.root / "tools.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("../outside", b"x")
        with self.assertRaises(ValueError):
            native.extract_zip(archive, self.root / "out")

    def test_hash_and_size_are_both_enforced(self):
        p = self.root / "input"
        p.write_bytes(b"fixed")
        digest = hashlib.sha256(b"fixed").hexdigest()
        self.assertEqual(native.checked_file(p, digest, 5)["bytes"], 5)
        with self.assertRaises(ValueError):
            native.checked_file(p, digest, 4)
        with self.assertRaises(ValueError):
            native.checked_file(p, "0" * 64)

    def test_fetch_local_archive_checks_and_copies_without_downloading_tools(self):
        tools = self.root / "restored-tools.zip"
        contents = b"fixed restored tools archive bytes"
        tools.write_bytes(contents)
        pin = hashlib.sha256(contents).hexdigest()
        cache = self.root / "cache"
        cache.mkdir()
        args = argparse.Namespace(materials_dir=str(cache / "inputs"), tools_archive=str(tools),
                                  tools_url=None, tools_sha256=pin)
        with patch.object(native, "CACHE", cache), \
                patch.object(native, "fetch_file", return_value={"unitTest": "fixed-source-acquisition"}) as download:
            native.fetch_materials(args)
            self.assertEqual(download.call_count, len(native.SOURCE_PINS) + 2)
            self.assertTrue(all(call.args[1].name != "tools-snapshot.zip" for call in download.call_args_list))
            copied = Path(args.materials_dir) / "tools-snapshot.zip"
            self.assertEqual(copied.read_bytes(), contents)
            evidence = json.loads((copied.parent / "acquisition-evidence.json").read_text(encoding="utf-8"))
            self.assertEqual(evidence["files"][0]["sha256"], pin)
            self.assertEqual(evidence["files"][0]["acquisition"], "sha-checked-local-archive")
            # Existing inputs are never accepted as a cache hit or overwritten.
            calls_before = download.call_count
            with self.assertRaises(FileExistsError):
                native.fetch_materials(args)
            self.assertEqual(download.call_count, calls_before)
            self.assertEqual(copied.read_bytes(), contents)

    def test_fetch_rejects_modified_local_archive_before_source_downloads(self):
        tools = self.root / "modified-tools.zip"
        original = b"fixed tools bytes"
        tools.write_bytes(original + b"modified")
        cache = self.root / "cache"
        cache.mkdir()
        args = argparse.Namespace(materials_dir=str(cache / "inputs"), tools_archive=str(tools),
                                  tools_url=None, tools_sha256=hashlib.sha256(original).hexdigest())
        with patch.object(native, "CACHE", cache), patch.object(native, "fetch_file") as download:
            with self.assertRaisesRegex(ValueError, "Pinned bytes mismatch"):
                native.fetch_materials(args)
            download.assert_not_called()
            self.assertFalse((Path(args.materials_dir) / "tools-snapshot.zip").exists())

    def test_fetch_cli_accepts_either_url_or_local_archive(self):
        common = ["fetch", "--materials-dir", str(self.root / "inputs"), "--tools-sha256", "a" * 64]
        for option, value in (("--tools-url", "https://example.invalid/fixed-tools.zip"),
                              ("--tools-archive", str(self.root / "tools.zip"))):
            with self.subTest(option=option), patch.object(native, "fetch_materials") as acquire:
                self.assertEqual(native.main(common + [option, value]), 0)
                args = acquire.call_args.args[0]
                self.assertEqual(args.tools_url, value if option == "--tools-url" else None)
                self.assertEqual(args.tools_archive, value if option == "--tools-archive" else None)

    def test_fetch_cli_requires_exactly_one_tools_source(self):
        common = ["fetch", "--materials-dir", str(self.root / "inputs"), "--tools-sha256", "a" * 64]
        for extras in ([], ["--tools-url", "https://example.invalid/fixed-tools.zip",
                           "--tools-archive", str(self.root / "tools.zip")]):
            with self.subTest(extras=extras), patch.object(native, "fetch_materials") as acquire, \
                    redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as stopped:
                native.main(common + extras)
            self.assertEqual(stopped.exception.code, 2)
            acquire.assert_not_called()

    def test_launcher_resolves_native_executable_using_child_path(self):
        b = object.__new__(native.Build)
        b.root, b.evidence = self.root, {"commands": []}
        b.env = {"PATH": "controlled-native-tools"}
        (self.root / "logs").mkdir()
        executable = str((self.root / "MSBuild.exe").resolve())
        with patch.object(native.shutil, "which", return_value=executable) as locate, \
                patch.object(native.subprocess, "run") as process:
            process.return_value.returncode = 0
            b.run("native-launch", ["msbuild.exe", "/nr:false"])
            locate.assert_called_once_with("msbuild.exe", path="controlled-native-tools")
            self.assertEqual(process.call_args.args[0], [executable, "/nr:false"])
            self.assertEqual(process.call_args.kwargs["env"], b.env)
            self.assertEqual(b.evidence["commands"][0]["command"][0], executable)

    def test_launcher_has_no_ambient_path_fallback(self):
        b = object.__new__(native.Build)
        b.root, b.evidence, b.env = self.root, {"commands": []}, {"PATH": "isolated"}
        with patch.object(native.shutil, "which", return_value=None), \
                patch.object(native.subprocess, "run") as process:
            with self.assertRaises(FileNotFoundError):
                b.run("missing", ["msbuild.exe"])
            process.assert_not_called()

    @unittest.skipUnless(os.name == "nt", "Windows standard folders and MSBuild environment")
    def test_filetracker_folder_identities_and_owned_temp_survive_sanitizing(self):
        root = Path("D:/RT-ResearchFlow-BuildCache/lx-test")
        with patch.dict(native.os.environ, {"CL": "/untrusted", "STATICBUILD": "true"}):
            environment = native.compiler_base_environment(root)
        self.assertEqual(environment["TEMP"], str((root / "t").resolve()))
        self.assertEqual(environment["TMP"], environment["TEMP"])
        for name in ("PROGRAMDATA", "ALLUSERSPROFILE", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)"):
            self.assertTrue(Path(environment[name]).is_absolute())
            self.assertNotIn("%", environment[name])
        self.assertNotIn("CL", environment)
        self.assertNotIn("STATICBUILD", environment)

    def test_output_cannot_reuse_or_escape_owned_cache(self):
        cache = self.root / "cache"
        cache.mkdir()
        with patch.object(native, "CACHE", cache):
            made = native.new_owned_dir(cache / "new")
            self.assertEqual(made, (cache / "new").resolve())
            with self.assertRaises(FileExistsError):
                native.new_owned_dir(made)
            with self.assertRaises(ValueError):
                native.new_owned_dir(self.root / "elsewhere")
            with self.assertRaises(ValueError):
                native.new_owned_dir(cache)

    def test_six_assets_and_known_original_binary_are_exactly_locked(self):
        self.assertEqual(set(native.SOURCE_PINS), {"lxml", "libiconv", "libxml2", "libxslt", "zlib", "build-recipe"})
        self.assertEqual(len(native.PYD_PINS), 2)
        self.assertEqual(native.MANIFEST_SHA, "0d4154519b7eae84197bb2f92440037715870ceefb6809eb7e7108cc4b24dfa5")
        for name, digest, size, url in native.SOURCE_PINS.values():
            self.assertEqual(len(digest), 64)
            self.assertGreater(size, 0)
            self.assertTrue(url.startswith("https://"))
            self.assertNotIn("latest", url)

    def test_compatible_marker_keeps_original_body_and_logs_patch(self):
        source = self.root / "source"
        path = source / "libiconv/source/lib/iconv.c"
        path.parent.mkdir(parents=True)
        text = "/* original copyright */\n#include <iconv.h>\nint existing(void) {return 1;}\n"
        path.write_text(text, encoding="utf-8")
        b = object.__new__(native.Build)
        b.root, b.evidence = self.root, {}
        b.patch_iconv(source)
        new = path.read_text(encoding="utf-8")
        self.assertIn("int existing(void) {return 1;}", new)
        self.assertIn(native.MARKER, new)
        self.assertIn("__declspec(dllexport)", new)
        self.assertEqual(b.evidence["iconvModification"]["originalSha256"], hashlib.sha256(text.encode()).hexdigest())
        self.assertTrue((self.root / "iconv-compatible-relink.patch").is_file())

    def reconstruction_doc(self, original_wheel):
        b = object.__new__(native.Build)
        b.args = argparse.Namespace(tools_sha256="a" * 64, msvc_version="14.44.35207",
                                    sdk_version="10.0.26100.0", original_wheel=original_wheel)
        return b.reconstruction_doc()

    def test_readme_omits_original_wheel_when_not_supplied(self):
        document = self.reconstruction_doc(None)
        self.assertNotIn("--original-wheel", document)
        self.assertIn("--tools-archive inputs/tools-snapshot.zip", document)
        self.assertIn("--tools-sha256 " + "a" * 64, document)

    def test_readme_includes_original_wheel_when_supplied(self):
        document = self.reconstruction_doc("D:/cache/original-wheel.whl")
        option = "--original-wheel inputs/" + native.WHEEL_NAME
        self.assertEqual(document.count(option), 1)
        self.assertIn(option + " --vc-root", document)

    def test_prepare_never_invokes_native_commands_or_network(self):
        cache = self.root / "cache"
        cache.mkdir()
        args = argparse.Namespace(work=str(cache / "prepare"), mode="prepare", network_enforcement="unit-isolation",
            tools_sha256=None, msvc_version="14.44.35207", sdk_version="10.0.26100.0", original_wheel=None)
        with patch.object(native, "CACHE", cache), patch.object(native.Build, "materials", return_value=self.root), \
                patch.object(native, "stage_sources", return_value=self.root), \
                patch.object(native.Build, "toolchain") as toolchain, \
                patch.object(native.Build, "run") as run, \
                patch.object(native.urllib.request, "urlopen") as network:
            b = native.Build(args)
            b.execute()
            toolchain.assert_not_called()
            run.assert_not_called()
            network.assert_not_called()
            evidence = json.loads((b.root / "build-evidence.json").read_text(encoding="utf-8"))
            self.assertEqual(evidence["status"], "materials-verified-and-safely-extracted")
            self.assertNotIn("releaseEligible", evidence)
            self.assertEqual(evidence["outputs"], {})


if __name__ == "__main__":
    unittest.main()
