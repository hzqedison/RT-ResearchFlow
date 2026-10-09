"""Bounded isolated candidate API checks; not native/runtime acceptance."""

import copy
import contextlib
import ast
import base64
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import struct
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("private_runtime_preparation", ROOT / "scripts/prepare-private-python-runtime.py")
prep = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prep)
POLICY, POLICY_SHA = prep.load_policy(prep.POLICY_PATH)
SDISTS = Path(os.environ.get("RT_PREP_TEST_SDISTS", "D:/RT-ResearchFlow-BuildCache/private-runtime-1.7/sdists"))
SOURCE_WHEELS = [wheel for wheel in POLICY["derivedWheels"] if wheel["derived"]["recipe"]["path"] == "scripts/build-provider-source-wheels.py"]
PBS = Path(os.environ.get("RT_PREP_TEST_PYTHON", "D:/RT-ResearchFlow-BuildCache/private-runtime-1.7/PBS 运行 windows-x64/python/python.exe" if os.name == "nt" else sys.executable))


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="private-prep-tests-", dir=ROOT)
        self.base = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)

    def download(self, filename="source.whl", data=b"source"):
        return {"kind": "download", "filename": filename, "url": "https://files.pythonhosted.org/packages/test/" + filename,
                "sha256": prep.digest(data), "size": len(data)}

    def fixture_wheel(self, name, dependencies=(), tags=("py3-none-any",), requires_python=">=3.13", version="1", extra_files=None):
        info = name + "-" + version + ".dist-info"
        metadata = "Metadata-Version: 2.4\nName: " + name + "\nVersion: " + version + "\nRequires-Python: " + requires_python + "\n"
        metadata += "".join("Requires-Dist: " + value + "\n" for value in dependencies)
        files = {info + "/METADATA": (metadata + "\n").encode(),
                 info + "/WHEEL": ("Wheel-Version: 1.0\n" + "".join("Tag: " + value + "\n" for value in tags)).encode(),
                 info + "/licenses/LICENSE": b"original license", info + "/NOTICE": b"original notice"}
        files.update(extra_files or {})
        record = io.StringIO()
        writer = csv.writer(record, lineterminator="\n")
        for filename, data in files.items():
            writer.writerow([filename, "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode(), len(data)])
        writer.writerow([info + "/RECORD", "", ""])
        files[info + "/RECORD"] = record.getvalue().encode()
        path = self.base / (name + "-" + version + "-py3-none-any.whl")
        with zipfile.ZipFile(path, "w") as archive:
            for filename, data in files.items():
                archive.writestr(filename, data)
        return {"asset": self.download(path.name, path.read_bytes()), "licenses": [], **prep.read_wheel(path)}

    def candidate_fixture(self, overrides=None):
        policy = copy.deepcopy(POLICY)
        policy["minimumFreeBytes"] = 0
        native = {}
        for component in ("python", "node"):
            value = self.download(component + ".zip", component.encode())
            (self.base / value["filename"]).write_bytes(component.encode())
            native[component] = {"version": POLICY["targets"]["win32-x64"][component]["version"], "asset": value}
        full = self.download("full.tar.zst", b"full")
        (self.base / full["filename"]).write_bytes(b"full")
        native["python"]["licenseSources"] = [full]
        policy["targets"]["win32-x64"] = native
        policy["providerVersions"] = {name: "1" for name in prep.PROVIDERS}
        decoder = self.download("decoder.whl", b"decoder")
        (self.base / decoder["filename"]).write_bytes(b"decoder")
        policy["toolchain"]["win32-x64"]["licenseDecoder"]["asset"] = decoder
        sha = prep.digest(prep.encoded(policy))
        snapshot = prep.source_snapshot(sha)
        candidate = prep.candidate_base("rt-private-python-candidate-lock", sha, "win32-x64")
        candidate.update(status="candidate", resolutionComplete=True, sourceCommit=policy["sourceCommit"],
                         sourceSnapshot=snapshot, sourceSha256=prep.digest(prep.encoded(snapshot)), **copy.deepcopy(native))
        candidate["providers"] = {}
        for name in prep.PROVIDERS:
            options = (overrides or {}).get(name, {})
            wheel = self.fixture_wheel(name, **options)
            candidate["providers"][name] = {"version": "1", "site": "providers/" + name + "/site", "wheels": [wheel]}
        return policy, sha, candidate

    def test_original_candidate_rechecks_every_wheel_fact(self):
        policy, sha, candidate = self.candidate_fixture()
        self.assertIs(prep.verify_candidate(candidate, policy, sha, self.base), candidate)
        for field, value in (("notices", {}), ("tags", ["cp313-cp313-macosx_12_0_arm64"]),
                             ("requiresPython", ">=99"), ("metadataSha256", "0" * 64)):
            bad = copy.deepcopy(candidate)
            bad["providers"]["akshare"]["wheels"][0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(prep.Invalid, "original wheel"):
                prep.verify_candidate(bad, policy, sha, self.base)
        bad = copy.deepcopy(candidate)
        bad["providers"]["akshare"]["wheels"][0]["notices"].pop("akshare-1.dist-info/NOTICE")
        with self.assertRaises(prep.Invalid):
            prep.verify_candidate(bad, policy, sha, self.base)

    def test_repeated_filename_cannot_hide_different_provider_facts(self):
        policy, sha, candidate = self.candidate_fixture()
        shared = copy.deepcopy(candidate["providers"]["akshare"]["wheels"][0])
        candidate["providers"]["pywencai"]["wheels"].append(shared)
        prep.verify_candidate(candidate, policy, sha, self.base)
        shared["notices"] = {}
        with self.assertRaisesRegex(prep.Invalid, "original wheel"):
            prep.verify_candidate(candidate, policy, sha, self.base)

    def test_native_versions_license_sources_and_root_versions_bind_policy(self):
        policy, sha, candidate = self.candidate_fixture()
        mutations = [lambda c: c["python"].update(version="99"), lambda c: c["node"].update(version="99"),
                     lambda c: c["python"].update(licenseSources=[]),
                     lambda c: c["providers"]["akshare"].update(version="99")]
        for mutate in mutations:
            bad = copy.deepcopy(candidate)
            mutate(bad)
            with self.subTest(mutation=mutate), self.assertRaises(prep.Invalid):
                prep.verify_candidate(bad, policy, sha, self.base)
        candidate["providers"]["akshare"]["wheels"] = [self.fixture_wheel("akshare", version="2")]
        with self.assertRaisesRegex(prep.Invalid, "root wheel version"):
            prep.verify_candidate(candidate, policy, sha, self.base)

    @unittest.skipUnless(PBS.is_file(), "Existing native PBS not available")
    def test_all_three_raw_closures_preflight_before_any_install(self):
        policy, sha, candidate = self.candidate_fixture()
        result = prep.preflight_closures(candidate, PBS, self.base)
        self.assertEqual(set(result), set(prep.PROVIDERS))
        self.assertTrue(all(item["distributionCount"] == 1 for item in result.values()))

    @unittest.skipUnless(PBS.is_file(), "Existing native PBS not available")
    def test_bad_final_closure_never_calls_first_pip_or_http(self):
        cases = [("direct-url", {"dependencies": ["child @ https://example.invalid/child.whl"]}, None),
                 ("missing-extra", {"dependencies": ["child[feature]==1"]}, ("child", ["missing; extra == 'feature'"])),
                 ("wrong-version", {"dependencies": ["child>=2"]}, ("child", [])),
                 ("python", {"requires_python": ">=99"}, None),
                 ("tag", {"tags": ("cp313-cp313-macosx_12_0_arm64" if os.name == "nt" else "cp313-cp313-win_amd64",)}, None)]
        for label, options, child in cases:
            policy, sha, candidate = self.candidate_fixture({"pywencai": options})
            if child:
                candidate["providers"]["pywencai"]["wheels"].append(self.fixture_wheel(child[0], child[1]))
            path = self.base / (label + ".json")
            path.write_bytes(prep.encoded(candidate))
            with self.subTest(case=label), patch.object(prep, "native_target", return_value="win32-x64"), \
                    patch.object(prep, "native_tools", return_value=(PBS, {})), \
                    patch.object(prep, "run", wraps=prep.run) as spy, \
                    patch.object(prep.urllib.request, "urlopen", side_effect=AssertionError("HTTP forbidden")), \
                    patch.object(prep, "safe_extract", side_effect=AssertionError("preflight must precede tree extraction")):
                with self.assertRaises(prep.Invalid):
                    prep.materialize(policy, sha, path, self.base, self.base / (label + "-work"))
                self.assertEqual(len(spy.call_args_list), 3)
                self.assertTrue(all("install" not in call.args[0] for call in spy.call_args_list))

    def test_bounded_process_combines_stdout_stderr_budget(self):
        with self.assertRaisesRegex(prep.Invalid, "output byte limit"):
            prep.bounded_process([sys.executable, "-B", "-I", "-c", "import sys;sys.stdout.write('x'*700);sys.stdout.flush();sys.stderr.write('y'*700);sys.stderr.flush()"],
                                 self.base, timeout=10, max_output_bytes=1000)

    def assert_process_exited(self, pid):
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes
            api = ctypes.WinDLL("kernel32", use_last_error=True)
            api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            api.OpenProcess.restype = wintypes.HANDLE
            api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
            api.CloseHandle.argtypes = [wintypes.HANDLE]
            handle = api.OpenProcess(0x100000, False, pid)
            if handle:
                try:
                    self.assertEqual(api.WaitForSingleObject(handle, 5000), 0)
                finally:
                    api.CloseHandle(handle)
        else:
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)

    def owned_descendant_code(self, path, overflow=False):
        return ("import subprocess,sys,pathlib,time;child=subprocess.Popen([sys.executable,'-B','-I','-c','import time;time.sleep(60)'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);"
                "pathlib.Path(" + repr(str(path)) + ").write_text(str(child.pid));" +
                ("sys.stdout.write('x'*1000000);sys.stdout.flush();time.sleep(60)" if overflow else "time.sleep(60)"))

    def test_total_deadline_kills_owned_grandchild(self):
        pid_file = self.base / "timeout-child.pid"
        with self.assertRaisesRegex(prep.Invalid, "total deadline"):
            prep.bounded_process([sys.executable, "-B", "-I", "-c", self.owned_descendant_code(pid_file)], self.base, timeout=2)
        self.assertTrue(pid_file.is_file())
        self.assert_process_exited(int(pid_file.read_text()))

    def test_output_overflow_kills_owned_grandchild(self):
        pid_file = self.base / "overflow-child.pid"
        with self.assertRaisesRegex(prep.Invalid, "output byte limit"):
            prep.bounded_process([sys.executable, "-B", "-I", "-c", self.owned_descendant_code(pid_file, True)], self.base, timeout=10, max_output_bytes=1024)
        self.assertTrue(pid_file.is_file())
        self.assert_process_exited(int(pid_file.read_text()))

    def test_python_smoke_guard_denies_dns_udp_and_tcp_without_network(self):
        code = prep.SMOKE_NETWORK_GUARD + "\nchecks=[lambda:socket.getaddrinfo('example.invalid',443),lambda:socket.gethostbyname('example.invalid'),lambda:socket.socket(socket.AF_INET,socket.SOCK_DGRAM).sendto(b'x',('127.0.0.1',9)),lambda:socket.socket().connect(('127.0.0.1',9))]\nfor check in checks:\n try:check()\n except RuntimeError:pass\n else:raise AssertionError('unguarded socket API')\nprint('four Python socket guards passed')"
        result = prep.bounded_process([sys.executable, "-B", "-I", "-c", code], self.base, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.assertIn("four Python socket guards passed", result.stdout)

    def test_asset_kind_is_mandatory(self):
        value = self.download()
        del value["kind"]
        with self.assertRaises(prep.Invalid):
            prep.asset(value)

    def test_derived_asset_has_no_url_and_cannot_be_native_input(self):
        value = self.download()
        value["kind"] = "derived"
        with self.assertRaises(prep.Invalid):
            prep.asset(value)
        del value["url"]
        prep.asset(value)
        with self.assertRaises(prep.Invalid):
            prep.asset(value, True)

    def test_download_urls_reject_credentials_query_fragment_nonhttps_and_mismatch(self):
        for url in ("http://files.pythonhosted.org/source.whl", "https://user:secret@files.pythonhosted.org/source.whl",
                    "https://files.pythonhosted.org/source.whl?query=x", "https://files.pythonhosted.org/source.whl#hash",
                    "https://files.pythonhosted.org/other.whl", "https://files.pythonhosted.org:123/source.whl"):
            value = self.download()
            value["url"] = url
            with self.subTest(url=url), self.assertRaises(prep.Invalid):
                prep.asset(value)

    def test_url_decoded_filename_and_policy_official_source(self):
        value = self.download("a+b.whl")
        value["url"] = value["url"].replace("a+b", "a%2Bb")
        prep.official(value, POLICY)
        value["url"] = "https://example.org/a%2Bb.whl"
        with self.assertRaises(prep.Invalid):
            prep.official(value, POLICY)

    def test_unsafe_paths(self):
        for value in ("../file", "/file", "C:/file", "scripts\\file.py", "scripts//file", "scripts/./file"):
            with self.subTest(value=value), self.assertRaises(prep.Invalid):
                prep.relative(value)

    def test_derived_source_and_recipe_equalities(self):
        wheel = copy.deepcopy(POLICY["derivedWheels"][0])
        prep.wheel_contract(wheel, POLICY)
        for field in ("upstreamSha256", "patchSha256"):
            bad = copy.deepcopy(wheel)
            bad["derived"][field] = "0" * 64
            with self.subTest(field=field), self.assertRaises(prep.Invalid):
                prep.wheel_contract(bad, POLICY)

    def test_recipe_escape_legacy_patch_and_download_derived_rejected(self):
        wheel = copy.deepcopy(POLICY["derivedWheels"][0])
        for path in ("../scripts/build.py", "/scripts/build.py", "scripts\\build-provider-source-wheels.py", "scripts/unknown.py"):
            bad = copy.deepcopy(wheel)
            bad["derived"]["recipe"]["path"] = path
            with self.subTest(path=path), self.assertRaises(prep.Invalid):
                prep.wheel_contract(bad, POLICY)
        wheel["derived"]["patch"] = self.download()
        with self.assertRaises(prep.Invalid):
            prep.wheel_contract(wheel, POLICY)
        wheel["asset"] = self.download()
        with self.assertRaises(prep.Invalid):
            prep.wheel_contract(wheel, POLICY)

    def test_verified_asset_and_conflicting_filename_bytes(self):
        value = self.download()
        (self.base / value["filename"]).write_bytes(b"source")
        prep.verified_asset(self.base, value)
        (self.base / value["filename"]).write_bytes(b"Source")
        with self.assertRaises(prep.Invalid):
            prep.verified_asset(self.base, value)

    def test_exclusive_bytes_never_overwrite_conflicts(self):
        destination = self.base / "output"
        prep.exclusive_bytes(destination, b"one")
        prep.exclusive_bytes(destination, b"one")
        with self.assertRaises(prep.Invalid):
            prep.exclusive_bytes(destination, b"two")
        self.assertEqual(destination.read_bytes(), b"one")

    def test_actual_recipe_snapshot_and_conflicting_snapshot(self):
        pin = POLICY["recipePins"][0]
        snapshot = prep.recipe_snapshot(self.base, pin, POLICY)
        self.assertEqual(prep.file_digest(snapshot), pin["sha256"])
        snapshot.write_bytes(b"tampered")
        with self.assertRaises(prep.Invalid):
            prep.recipe_snapshot(self.base, pin, POLICY)

    def test_license_approval_matches_every_binding_not_just_mit(self):
        policy = copy.deepcopy(POLICY)
        record = {"id": "test-only-review", "component": "test", "version": "1", "artifactSha256": "a" * 64,
                  "licenseSha256": "b" * 64, "spdx": "MIT", "decision": "approved",
                  "reviewedBy": "isolated-fixture", "reviewReference": "test-only"}
        policy["licenseApprovals"] = [record]
        args = ("test", "1", "a" * 64, "b" * 64, "MIT")
        self.assertEqual(prep.license_decision(policy, *args), record["id"])
        for index in range(len(args)):
            bad = list(args)
            bad[index] = "different"
            self.assertIsNone(prep.license_decision(policy, *bad))
        for decision in ("pending", "rejected"):
            record["decision"] = decision
            self.assertIsNone(prep.license_decision(policy, *args))

    def test_approved_policy_requires_real_review_fields(self):
        policy = copy.deepcopy(POLICY)
        policy["licenseApprovals"] = [{"id": "test", "component": "test", "version": "1", "artifactSha256": "a" * 64,
                                       "licenseSha256": "b" * 64, "spdx": "MIT", "decision": "approved"}]
        path = self.base / "policy.json"
        path.write_bytes(prep.encoded(policy))
        with self.assertRaises(prep.Invalid):
            prep.load_policy(path)

    def test_policy_preserves_explicit_19_identities_and_no_automatic_approvals(self):
        licenses = [item for item in POLICY["licenseRequirements"] if item["member"].startswith("python/licenses/")]
        self.assertEqual(len(licenses), 19)
        self.assertEqual(len({item["member"] for item in licenses}), 19)
        self.assertIn("python/licenses/LICENSE.bdb.txt", {item["member"] for item in licenses})
        self.assertIn("python/licenses/LICENSE.openssl-3.txt", {item["member"] for item in licenses})
        self.assertIn("python/PYTHON.json", {item["member"] for item in POLICY["licenseRequirements"]})
        self.assertEqual(len(POLICY["licenseApprovals"]), 176)
        self.assertTrue(POLICY["networkResolution"])
        self.assertEqual(POLICY["toolchain"]["win32-x64"]["pipVersion"], "26.2.1")
        self.assertTrue(all(item["sha256"] for item in licenses))

    def test_pending_resolve_never_downloads_creates_work_or_edits_policy(self):
        before = prep.POLICY_PATH.read_bytes()
        work = self.base / "fresh-work"
        pending_policy = copy.deepcopy(POLICY)
        pending_policy["toolchain"] = None
        with patch.object(prep, "fetch", side_effect=AssertionError("network forbidden")):
            report = prep.resolve(pending_policy, POLICY_SHA, "win32-x64", work)
        self.assertEqual(report["kind"], "rt-private-python-candidate-lock")
        self.assertEqual(report["status"], "pending")
        self.assertFalse(report["releaseEligible"])
        self.assertTrue(report["pending"])
        self.assertFalse(work.exists())
        self.assertEqual(prep.POLICY_PATH.read_bytes(), before)

    def test_pending_materialize_binds_policy_and_input_hash_without_fake_tree(self):
        policy = copy.deepcopy(POLICY)
        policy["toolchain"].pop("darwin-arm64")
        candidate = prep.resolve(policy, POLICY_SHA, "darwin-arm64", self.base / "unused")
        path = self.base / "candidate.json"
        raw = prep.encoded(candidate)
        path.write_bytes(raw)
        report = prep.materialize(policy, POLICY_SHA, path, self.base, self.base / "unused")
        self.assertEqual(report["inputLockSha256"], prep.digest(raw))
        self.assertEqual(report["kind"], "rt-private-python-candidate-fragment")
        self.assertEqual(report["status"], "pending")
        self.assertNotIn("complete", report)
        candidate["preparationPolicySha256"] = "0" * 64
        path.write_bytes(prep.encoded(candidate))
        with self.assertRaises(prep.Invalid):
            prep.materialize(policy, POLICY_SHA, path, self.base, self.base / "unused")

    def test_normal_offline_pip_command_keeps_dependencies_and_hash_gate(self):
        args = prep.pip_command("python", "assets", "providers/test", "requirements.txt", True)
        for required in ("--no-index", "--require-hashes", "--only-binary=:all:", "--ignore-installed", "--target", "-I"):
            self.assertIn(required, args)
        self.assertNotIn("--no-deps", args)
        self.assertNotIn("--system-site-packages", args)

    def test_environment_home_temp_and_caches_are_owned(self):
        work = prep.fresh_work(self.base / "work", {"minimumFreeBytes": 0})
        with patch.dict(os.environ, {"PYTHONPATH": "untrusted", "PIP_EXTRA_INDEX_URL": "https://user:secret@host"}):
            env = prep.controlled_environment(work)
        self.assertNotIn("PYTHONPATH", env)
        self.assertNotIn("PIP_EXTRA_INDEX_URL", env)
        for key in ("HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR", "XDG_CACHE_HOME", "PIP_CACHE_DIR"):
            self.assertIn(work, Path(env[key]).parents)
        with self.assertRaises(prep.Invalid):
            prep.fresh_work(work, {"minimumFreeBytes": 0})

    def test_disk_budget_blocks_before_creating_work(self):
        with patch.object(prep.shutil, "disk_usage", return_value=type("Disk", (), {"free": 1})()):
            with self.assertRaises(prep.Invalid):
                prep.fresh_work(self.base / "no-space", {"minimumFreeBytes": 2})
        self.assertFalse((self.base / "no-space").exists())

    def test_safe_extract_rejects_traversal_and_preserves_regular_bytes(self):
        archive = self.base / "input.tar.gz"
        def write(name):
            with tarfile.open(archive, "w:gz") as handle:
                member = tarfile.TarInfo(name)
                member.size = 7
                handle.addfile(member, io.BytesIO(b"payload"))
        write("python/../outside")
        with self.assertRaises(prep.Invalid):
            prep.safe_extract(archive, self.base / "bad", "python")
        self.assertFalse((self.base / "bad").exists())
        write("python/lib/resource.bin")
        prep.safe_extract(archive, self.base / "good", "python")
        self.assertEqual((self.base / "good/lib/resource.bin").read_bytes(), b"payload")

    def test_unreviewed_symlinks_and_zstd_do_not_use_extractall_fallback(self):
        archive = self.base / "link.tar.gz"
        with tarfile.open(archive, "w:gz") as handle:
            member = tarfile.TarInfo("python/link")
            member.type = tarfile.SYMTYPE
            member.linkname = "../outside"
            handle.addfile(member)
        with self.assertRaises(prep.Pending):
            prep.safe_extract(archive, self.base / "links", "python")
        with self.assertRaises(prep.Pending):
            prep.safe_extract(self.base / "not-present.tar.zst", self.base / "codec", "python")

    def test_inventory_hashes_actual_tree_files(self):
        directory = self.base / "tree"
        directory.mkdir()
        (directory / "file").write_bytes(b"contents")
        self.assertEqual(prep.inventory(directory), [{"path": "file", "kind": "file", "size": 8, "sha256": prep.digest(b"contents")}])

    def test_seal_missing_targets_pending_and_never_locked(self):
        fragment = prep.candidate_base("rt-private-python-candidate-fragment", POLICY_SHA, "win32-x64")
        fragment["sourceCommit"] = "a" * 40
        path = self.base / "fragment.json"
        path.write_bytes(prep.encoded(fragment))
        report = prep.seal(POLICY, POLICY_SHA, [path])
        self.assertEqual(report["status"], "pending")
        self.assertFalse(report["releaseEligible"])
        self.assertNotIn("platforms", report)

    def test_seal_rejects_different_sources_policies_and_fake_manifests(self):
        for field, value in (("sourceCommit", "b" * 40), ("preparationPolicySha256", "c" * 64), ("kind", "rt-private-python-runtime")):
            paths = []
            for index, target in enumerate(prep.TARGETS):
                fragment = prep.candidate_base("rt-private-python-candidate-fragment", POLICY_SHA, target)
                fragment["sourceCommit"] = "a" * 40
                if index == 1:
                    fragment[field] = value
                path = self.base / f"{field}-{index}.json"
                path.write_bytes(prep.encoded(fragment))
                paths.append(path)
            with self.subTest(field=field), self.assertRaises(prep.Invalid):
                prep.seal(POLICY, POLICY_SHA, paths)

    def test_rejected_or_unknown_license_blocks_three_platform_seal(self):
        paths = []
        for index, target in enumerate(prep.TARGETS):
            fragment = prep.candidate_base("rt-private-python-candidate-fragment", POLICY_SHA, target)
            fragment.update(sourceCommit="a" * 40, treeComplete=True, nativeEvidence={"sha256": "d" * 64},
                            licenseRequirements=[{"component": "test", "version": "1", "artifactSha256": "a" * 64,
                                                  "licenseSha256": "b" * 64, "spdx": "MIT", "approvalId": "fake"}])
            path = self.base / f"license-{index}.json"
            path.write_bytes(prep.encoded(fragment))
            paths.append(path)
        report = prep.seal(POLICY, POLICY_SHA, paths)
        self.assertTrue(any("License approval" in reason for reason in report["pending"]))
        self.assertEqual(report["status"], "pending")

    def test_cli_pending_report_and_existing_output_not_overwritten(self):
        out = self.base / "report.json"
        policy = copy.deepcopy(POLICY)
        policy["toolchain"].pop("darwin-arm64")
        policy_path = self.base / "pending-policy.json"
        policy_path.write_bytes(prep.encoded(policy))
        args = ["resolve", "--policy", str(policy_path), "--target", "darwin-arm64",
                "--work-root", str(self.base / "unused"), "--out", str(out)]
        self.assertEqual(prep.main(args), 2)
        before = out.read_bytes()
        self.assertEqual(prep.main(args), 1)
        self.assertEqual(out.read_bytes(), before)

    @unittest.skipUnless(all((SDISTS / wheel["derived"]["upstreamAsset"]["filename"]).is_file() for wheel in SOURCE_WHEELS),
                         "Parent sdists absent; never download fixtures")
    def test_actual_approved_recipes_reproduce_each_wheel_from_only_its_single_source(self):
        for index, wheel in enumerate(SOURCE_WHEELS):
            assets = self.base / f"assets-{index}"
            assets.mkdir()
            source = wheel["derived"]["upstreamAsset"]
            shutil = prep.shutil
            shutil.copyfile(SDISTS / source["filename"], assets / source["filename"])
            work = self.base / f"work-{index}"
            work.mkdir()
            receipt = prep.reproduce(wheel, assets, work, POLICY)
            self.assertEqual(receipt["wheelSha256"], wheel["asset"]["sha256"])
            self.assertEqual(receipt["upstreamSha256"], source["sha256"])
            self.assertEqual(receipt["recipeSha256"], wheel["derived"]["recipe"]["sha256"])
            self.assertEqual(receipt["extraUpstreamInputs"], [])
            self.assertTrue(receipt["executed"])
            actual = prep.read_wheel(assets / wheel["asset"]["filename"])
            self.assertEqual(actual["dependencies"], wheel["dependencies"])
            self.assertTrue(actual["notices"])
            snapshot = assets / "recipes" / wheel["derived"]["recipe"]["path"]
            self.assertEqual(prep.file_digest(snapshot), receipt["recipeSha256"])

    def test_license_pending_does_not_block_windows_candidate_input_readiness(self):
        self.assertEqual(prep.pending_inputs(POLICY, "win32-x64"), [])
        self.assertEqual(len(POLICY["licenseApprovals"]), 176)
        self.assertTrue(prep.candidate_pending(POLICY))

    def test_official_complete_mootdx_derived_pin_and_single_upstream(self):
        wheel = next(wheel for wheel in POLICY["derivedWheels"] if wheel["distribution"] == "mootdx")
        prep.wheel_contract(wheel, POLICY)
        self.assertEqual(wheel["derived"]["upstreamAsset"]["size"], 108803)
        self.assertEqual(wheel["asset"]["sha256"], "35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77")
        self.assertIn("mini-racer (==0.12.4)", wheel["dependencies"])

    def test_acquire_reuses_verified_readonly_cache_but_never_conflicting_bytes(self):
        cached = self.base / "cache"
        cached.mkdir()
        output = self.base / "assets"
        output.mkdir()
        value = self.download()
        (cached / value["filename"]).write_bytes(b"source")
        policy = dict(POLICY, cacheRoots=[str(cached)])
        with patch.object(prep, "fetch", side_effect=AssertionError("cache hit must not fetch")):
            prep.acquire(value, output, policy, {"cacheRoots": [str(cached)]})
        self.assertEqual((cached / value["filename"]).read_bytes(), b"source")
        (output / value["filename"]).write_bytes(b"broken")
        with self.assertRaises(prep.Invalid):
            prep.acquire(value, output, policy, {"cacheRoots": [str(cached)]})

    def test_product_extraction_selection_keeps_licenses_but_excludes_tool_modules(self):
        archive = self.base / "selection.tar.gz"
        with tarfile.open(archive, "w:gz") as handle:
            for name in ("python/python.exe", "python/LICENSE.txt", "python/Lib/site-packages/pip/__init__.py"):
                member = tarfile.TarInfo(name)
                member.size = 1
                handle.addfile(member, io.BytesIO(b"x"))
        destination = self.base / "selected"
        prep.safe_extract(archive, destination, "python", lambda name: "site-packages/pip/" not in name)
        self.assertTrue((destination / "LICENSE.txt").exists())
        self.assertFalse((destination / "Lib/site-packages/pip/__init__.py").exists())

    @unittest.skipUnless(PBS.is_file(), "Existing native PBS not available")
    def test_actual_pbs_closure_checks_markers_extras_and_reachable_set(self):
        def wheel(name, dependencies=()):
            return {"distribution": name, "version": "1", "dependencies": list(dependencies), "tags": ["py3-none-any"], "requiresPython": ">=3.13"}
        wheels = [wheel("root", [f'child[feature]>=1; sys_platform == "{sys.platform}"', f'not-installed; sys_platform != "{sys.platform}"']),
                  wheel("child", ['leaf==1; extra == "feature"']), wheel("leaf")]
        report = prep.validate_closure(PBS, wheels, ["root==1"], self.base)
        self.assertEqual(report["python"], "3.13.16")
        self.assertEqual(report["distributionCount"], 3)
        self.assertEqual(report["extras"]["child"], ["feature"])
        self.assertEqual(len(report["activeRequiresDist"]), 2)
        with self.assertRaises(prep.Invalid):
            prep.validate_closure(PBS, wheels + [wheel("unreachable")], ["root==1"], self.base)

    @unittest.skipUnless(PBS.is_file(), "Existing native PBS not available")
    def test_actual_pbs_closure_rejects_wrong_versions_and_missing_active_extra(self):
        root = {"distribution": "root", "version": "1", "dependencies": ["child[feature]>=2"], "tags": ["py3-none-any"]}
        child = {"distribution": "child", "version": "1", "dependencies": ['missing; extra == "feature"'], "tags": ["py3-none-any"]}
        with self.assertRaises(prep.Invalid):
            prep.validate_closure(PBS, [root, child], ["root==1"], self.base)
        root["dependencies"] = ["child[feature]>=1"]
        with self.assertRaises(prep.Invalid):
            prep.validate_closure(PBS, [root, child], ["root==1"], self.base)
        log = (self.base / "subprocesses.jsonl").read_text(encoding="utf-8")
        self.assertIn("unsatisfied dependency", log)

    @unittest.skipUnless(PBS.is_file(), "Existing native PBS not available")
    def test_installed_metadata_set_and_sha_are_actually_checked(self):
        site = self.base / "site"
        info = site / "root-1.dist-info"
        info.mkdir(parents=True)
        raw = b"Metadata-Version: 2.1\nName: root\nVersion: 1\n\n"
        (info / "METADATA").write_bytes(raw)
        expected = [{"distribution": "root", "version": "1", "dependencies": [], "tags": ["py3-none-any"], "metadataSha256": prep.digest(raw)}]
        report = prep.validate_closure(PBS, expected, ["root==1"], self.base, site)
        self.assertTrue(report["installedMetadataVerified"])
        (info / "METADATA").write_bytes(raw.replace(b"Version: 1", b"Version: 2"))
        with self.assertRaises(prep.Invalid):
            prep.validate_closure(PBS, expected, ["root==1"], self.base, site)

    def test_declared_nonstandard_license_filename_is_preserved(self):
        info = "fixture-1.dist-info"
        files = {info + "/METADATA": b"Metadata-Version: 2.4\nName: fixture\nVersion: 1\nLicense-File: dragon4_LICENSE.txt\n\n",
                 info + "/WHEEL": b"Wheel-Version: 1.0\nTag: py3-none-any\n",
                 info + "/licenses/dragon4_LICENSE.txt": b"original notice"}
        record = io.StringIO()
        writer = csv.writer(record, lineterminator="\n")
        for name, data in files.items():
            checksum = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
            writer.writerow([name, "sha256=" + checksum, len(data)])
        writer.writerow([info + "/RECORD", "", ""])
        files[info + "/RECORD"] = record.getvalue().encode()
        path = self.base / "fixture.whl"
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in files.items():
                archive.writestr(name, data)
        actual = prep.read_wheel(path)
        self.assertIn(info + "/licenses/dragon4_LICENSE.txt", actual["notices"])


    def test_authors_attribution_without_license_file_is_indexed_not_autoapproved(self):
        members = {"fixture-1.dist-info/" + name: b"Original attribution " + name.encode()
                   for name in ("AUTHORS", "AUTHORS.rst", "AUTHORS.txt", "AUTHORS.md")}
        members["fixture/notAUTHORS.txt"] = b"not an attribution basename"
        wheel = self.fixture_wheel("fixture", extra_files=members)
        with zipfile.ZipFile(self.base / wheel["asset"]["filename"]) as archive:
            self.assertNotIn(b"License-File:", archive.read("fixture-1.dist-info/METADATA"))
            for name, original in members.items():
                self.assertEqual(archive.read(name), original)
                if name.endswith("notAUTHORS.txt"):
                    self.assertNotIn(name, wheel["notices"])
                    continue
                self.assertEqual(wheel["notices"][name], prep.digest(original))
                item = prep.license_item(POLICY, "fixture", "1", wheel["asset"]["sha256"], name, prep.digest(original))
                self.assertEqual(item["review"], "pending")
                self.assertIsNone(item["approvalId"])

    def test_actual_html5lib_authors_matches_only_existing_reviewed_digest(self):
        default = "D:/RT-ResearchFlow-BuildCache/股票日线 prep-utf8-1791505394-resolve/assets/html5lib-1.1-py2.py3-none-any.whl"
        path = Path(os.environ.get("RT_PREP_HTML5LIB_WHEEL", default))
        if not path.is_file():
            self.skipTest("Existing original html5lib wheel required; no fixture download")
        record = next(row for row in POLICY["licenseApprovals"] if row["id"] == "astra-20261009-html5lib-1.1-1")
        self.assertEqual(prep.file_digest(path), record["artifactSha256"])
        wheel = prep.read_wheel(path)
        member = "html5lib-1.1.dist-info/AUTHORS.rst"
        with zipfile.ZipFile(path) as archive:
            original = archive.read(member)
            self.assertEqual(len(original), 983)
            self.assertNotIn(b"License-File:", archive.read("html5lib-1.1.dist-info/METADATA"))
        self.assertEqual(wheel["notices"][member], record["licenseSha256"])
        approved = prep.license_item(POLICY, "html5lib", "1.1", record["artifactSha256"], member, prep.digest(original))
        self.assertEqual(approved["approvalId"], record["id"])
        for component, version, artifact_sha, member_sha in (
                ("other", "1.1", record["artifactSha256"], record["licenseSha256"]),
                ("html5lib", "1.2", record["artifactSha256"], record["licenseSha256"]),
                ("html5lib", "1.1", "0" * 64, record["licenseSha256"]),
                ("html5lib", "1.1", record["artifactSha256"], prep.digest(original + b"tampered"))):
            with self.subTest(component=component, version=version, artifact=artifact_sha, member=member_sha):
                item = prep.license_item(POLICY, component, version, artifact_sha, member, member_sha)
                self.assertEqual(item["review"], "pending")
                self.assertIsNone(item["approvalId"])


class PortableNativePreparationTests(unittest.TestCase):
    setUp = PreparationTests.setUp
    download = PreparationTests.download
    fixture_wheel = PreparationTests.fixture_wheel

    def preparation_phases(self, target):
        snapshot = prep.source_snapshot(POLICY_SHA)
        lock = {**prep.candidate_base("rt-private-python-candidate-lock", POLICY_SHA, target),
                "status": "candidate", "sourceSnapshot": snapshot, "sourceSha256": prep.digest(prep.encoded(snapshot))}
        calls = []
        def resolve(policy, policy_sha, actual_target, work, operations):
            self.assertEqual(policy, POLICY)
            self.assertEqual(policy_sha, POLICY_SHA)
            self.assertEqual(actual_target, target)
            self.assertFalse(work.exists())
            calls.append(("resolve", work, operations))
            work.mkdir()
            (work / "assets").mkdir()
            return lock
        def materialize(policy, policy_sha, candidate, assets, work, operations):
            self.assertEqual(json.loads(candidate.read_bytes()), lock)
            self.assertEqual(assets, calls[0][1] / "assets")
            self.assertFalse(work.exists())
            calls.append(("materialize", work, operations))
            return {**prep.candidate_base("rt-private-python-candidate-fragment", policy_sha, target),
                    "status": "candidate", "treeComplete": True, "treeRoot": str(work / "tree"),
                    "inputLockSha256": prep.file_digest(candidate), "sourceSnapshot": snapshot,
                    "sourceSha256": lock["sourceSha256"], "sourceCommit": None,
                    "sourceEvidence": {"sourceVerified": False}, "providers": {},
                    "nativeEvidence": {"target": target}, "pending": ["actual licensing/source gates remain pending"],
                    "licenseRequirements": [{"component": "fixture", "version": "1", "artifactSha256": "a" * 64,
                                             "licenseSha256": "b" * 64, "approvalId": None}] * 2}
        return resolve, materialize, calls

    def test_prepare_three_native_routes_share_policy_and_real_phase_inputs(self):
        # Phase routing only: these mocks are NOT native Mac execution evidence.
        for target in prep.TARGETS:
            resolve, materialize, calls = self.preparation_phases(target)
            with self.subTest(target=target), patch.object(prep, "native_target", return_value=target), \
                    patch.object(prep, "resolve", side_effect=resolve), patch.object(prep, "materialize", side_effect=materialize):
                handoff = prep.prepare(POLICY, POLICY_SHA, target, self.base / target)
            self.assertEqual([row[0] for row in calls], ["resolve", "materialize"])
            for field in ("lock", "fragment"):
                self.assertEqual(prep.file_digest(handoff[field]["path"]), handoff[field]["sha256"])
            self.assertEqual(handoff["preparationPolicySha256"], POLICY_SHA)
            self.assertEqual(handoff["licenseSummary"]["pendingUsageCount"], 2)
            self.assertEqual(handoff["licenseSummary"]["pendingUniqueDigestCount"], 1)
            self.assertFalse(handoff["sourceEvidence"]["sourceVerified"])
            self.assertFalse(handoff["releaseEligible"])
            self.assertEqual(handoff["pending"], ["actual licensing/source gates remain pending"])

    def test_prepare_wrong_host_rejects_before_work_or_download(self):
        work = self.base / "wrong-native"
        with patch.object(prep, "native_target", return_value="win32-x64"), \
                patch.object(prep, "resolve", side_effect=AssertionError("no download")), self.assertRaises(prep.Invalid):
            prep.prepare(POLICY, POLICY_SHA, "darwin-arm64", work)
        self.assertFalse(work.exists())

    def test_prepare_failed_materialize_keeps_lock_without_success_fragment(self):
        resolve, materialize, calls = self.preparation_phases("darwin-arm64")
        work = self.base / "failed-phase"
        with patch.object(prep, "native_target", return_value="darwin-arm64"), \
                patch.object(prep, "resolve", side_effect=resolve), \
                patch.object(prep, "materialize", side_effect=prep.Invalid("actual phase failed")), self.assertRaises(prep.Invalid):
            prep.prepare(POLICY, POLICY_SHA, "darwin-arm64", work)
        self.assertTrue((work / "candidate-lock.json").is_file())
        self.assertFalse((work / "candidate-fragment.json").exists())

    def test_prepare_cli_reuses_operation_input_without_policy_mutation(self):
        target = "darwin-x64"
        resolve, materialize, calls = self.preparation_phases(target)
        operations = self.base / "operations.json"
        operations.write_bytes(prep.encoded({"schemaVersion": 1, "kind": "rt-private-runtime-operation-input-v1",
                                            "cacheRoots": [], "seedReports": {}, "sourceReceipt": None}))
        out = self.base / "handoff.json"
        with patch.object(prep, "native_target", return_value=target), patch.object(prep, "resolve", side_effect=resolve), \
                patch.object(prep, "materialize", side_effect=materialize):
            code = prep.main(["prepare", "--policy", str(prep.POLICY_PATH), "--target", target,
                              "--operation-input", str(operations), "--work-root", str(self.base / "cli-native"), "--out", str(out)])
        self.assertEqual(code, 0)
        self.assertEqual([row[2] for row in calls], [str(operations)] * 2)
        self.assertEqual(json.loads(out.read_bytes())["preparationPolicySha256"], POLICY_SHA)

    def test_all_python_isolated_command_literals_explicitly_enable_utf8(self):
        module = ast.parse((ROOT / "scripts/prepare-private-python-runtime.py").read_bytes())
        found = 0
        for node in ast.walk(module):
            if not isinstance(node, ast.List) or not node.elts:
                continue
            literals = [item.value if isinstance(item, ast.Constant) else None for item in node.elts]
            if "-I" not in literals and "-B" not in literals:
                continue
            found += 1
            self.assertTrue(any(literals[i:i + 2] == ["-X", "utf8"] for i in range(len(literals) - 1)),
                            f"Python child at source line {node.lineno} lacks explicit -X utf8")
        self.assertGreaterEqual(found, 6)

    @unittest.skipUnless(PBS.is_file(), "Existing native PBS required")
    def test_actual_isolated_child_ignores_utf8_environment_but_honors_explicit_flag(self):
        work = prep.fresh_work(self.base / "编码工作目录", {"minimumFreeBytes": 0})
        command = prep.pip_command(PBS, work, work / "日线股票", work / "依赖清单.txt", True)
        prefix = command[:command.index("-m")]
        code = "import json,sys;print(json.dumps({'mode':sys.flags.utf8_mode,'stdout':sys.stdout.encoding,'stderr':sys.stderr.encoding,'text':'股票日线'},ensure_ascii=False))"
        with patch.dict(os.environ, {"PYTHONUTF8": "0", "PYTHONIOENCODING": "cp1252"}):
            actual = json.loads(prep.run(prefix + ["-c", code], work, 30))
        self.assertEqual(actual["mode"], 1)
        self.assertEqual(actual["stdout"].lower().replace("_", "-"), "utf-8")
        self.assertEqual(actual["stderr"].lower().replace("_", "-"), "utf-8")
        self.assertEqual(actual["text"], "股票日线")

    @unittest.skipUnless(PBS.is_file(), "Existing native PBS required")
    def test_actual_normal_offline_pip_complete_closure_in_chinese_directories(self):
        root = self.base / "股票历史日线"
        root.mkdir()
        work = prep.fresh_work(root / "构建工作目录", {"minimumFreeBytes": 0})
        assets = root / "审计轮包"
        assets.mkdir()
        wheels = [self.fixture_wheel("unicoderoot", ["unicodechild==1"]), self.fixture_wheel("unicodechild")]
        for wheel in wheels:
            prep.shutil.copyfile(self.base / wheel["asset"]["filename"], assets / wheel["asset"]["filename"])
        requirements = work / "完整依赖清单.txt"
        requirements.write_bytes(("\n".join(w["distribution"] + "==1 --hash=sha256:" + w["asset"]["sha256"] for w in wheels) + "\n").encode())
        site = root / "私有依赖目录"
        command = prep.pip_command(PBS, assets, site, requirements, True)
        self.assertIn("--require-hashes", command)
        self.assertIn("--no-index", command)
        self.assertNotIn("--no-deps", command)
        with patch.dict(os.environ, {"PYTHONUTF8": "0", "PYTHONIOENCODING": "cp1252"}), \
                patch.object(prep.urllib.request, "urlopen", side_effect=AssertionError("offline test cannot request HTTP")):
            try:
                prep.run(command, work, 60)
            except prep.Invalid:
                last = json.loads((work / "subprocesses.jsonl").read_text(encoding="utf-8").splitlines()[-1])
                self.fail("Owned offline wheel fixture failed: " + last["stderr"][:1500])
            closure = prep.validate_closure(PBS, wheels, ["unicoderoot==1"], work, site)
        self.assertEqual(closure["distributionCount"], 2)
        self.assertTrue(closure["installedMetadataVerified"])
    # Use real binary structures, never a replacement for native OS execution.
    @staticmethod
    def thin(cpu=0x0100000c, minimum=(11, 0, 0), command=0x32, platform=1):
        packed = (minimum[0] << 16) | (minimum[1] << 8) | minimum[2]
        payload = (struct.pack("<6I", command, 24, platform, packed, packed, 0)
                   if command == 0x32 else struct.pack("<4I", command, 16, packed, packed))
        return struct.pack("<8I", 0xfeedfacf, cpu, 0, 2, 1, len(payload), 0, 0) + payload

    @staticmethod
    def fat(parts, wide=False):
        width = 32 if wide else 20
        offset = 8 + width * len(parts)
        table = []
        contents = []
        for cpu, data in parts:
            table.append(struct.pack(">IIQQII", cpu, 0, offset, len(data), 0, 0) if wide
                         else struct.pack(">IIIII", cpu, 0, offset, len(data), 0))
            contents.append(data)
            offset += len(data)
        return struct.pack(">II", 0xcafebabf if wide else 0xcafebabe, len(parts)) + b"".join(table + contents)

    @staticmethod
    def static_ar(data):
        header = ("object.o/".ljust(16) + "0".ljust(12) + "0".ljust(6) + "0".ljust(6)
                  + "100644".ljust(8) + str(len(data)).ljust(10) + "`\n").encode()
        return b"!<arch>\n" + header + data + (b"\n" if len(data) % 2 else b"")

    def test_common_policy_has_no_host_paths_and_three_ready_toolchains(self):
        for key in ("cacheRoots", "resolutionSeeds", "licenseMemberCacheRoot"):
            self.assertNotIn(key, POLICY)
        raw = prep.POLICY_PATH.read_bytes()
        self.assertNotIn(b"\r", raw)
        self.assertNotIn(b"D:/", raw)
        self.assertIsNone(POLICY["sourceCommit"])
        for target in prep.TARGETS:
            self.assertEqual(prep.pending_inputs(POLICY, target), [])
            self.assertEqual(POLICY["toolchain"][target]["licenseDecoder"]["version"], "0.25.0")
            self.assertTrue(POLICY["nativeLicenseInputs"][target]["pythonFull"]["members"])
            self.assertEqual(len(POLICY["targets"][target]["python"]["licenseSources"]), 1)

    def test_macho_thin_arm_and_intel_actual_headers(self):
        prep.checked_native(self.thin(), "darwin-arm64")
        prep.checked_native(self.thin(0x01000007, (10, 15, 0), 0x24), "darwin-x64")

    def test_macho_rejects_wrong_cpu_and_unknown_minimum(self):
        with self.assertRaises(prep.Invalid):
            prep.checked_native(self.thin(), "darwin-x64")
        no_commands = struct.pack("<8I", 0xfeedfacf, 0x0100000c, 0, 2, 0, 0, 0, 0)
        with self.assertRaises(prep.Invalid):
            prep.checked_native(no_commands, "darwin-arm64")

    def test_macho_minimum_exact_boundary(self):
        prep.checked_native(self.thin(minimum=(12, 0, 0)), "darwin-arm64")
        for minimum in ((12, 0, 1), (12, 1, 0), (13, 0, 0)):
            with self.subTest(minimum=minimum), self.assertRaises(prep.Invalid):
                prep.checked_native(self.thin(minimum=minimum), "darwin-arm64")

    def test_macho_rejects_non_macos_platform(self):
        for platform in (2, 6, 7):
            with self.subTest(platform=platform), self.assertRaises(prep.Invalid):
                prep.checked_native(self.thin(platform=platform), "darwin-arm64")

    def test_fat_32_and_64_validate_every_slice(self):
        parts = [(0x0100000c, self.thin()), (0x01000007, self.thin(0x01000007))]
        for wide in (False, True):
            prep.checked_native(self.fat(parts, wide), "darwin-arm64")
            prep.checked_native(self.fat(parts, wide), "darwin-x64")

    def test_fat_hidden_high_minimum_and_cpu_mismatch(self):
        parts = [(0x0100000c, self.thin()), (0x01000007, self.thin(0x01000007, (13, 0, 0)))]
        with self.assertRaises(prep.Invalid):
            prep.checked_native(self.fat(parts), "darwin-arm64")
        with self.assertRaises(prep.Invalid):
            prep.checked_native(self.fat([(0x01000007, self.thin())]), "darwin-x64")

    def test_fat_overlap_rejected(self):
        data = bytearray(self.fat([(0x0100000c, self.thin()), (0x01000007, self.thin(0x01000007))]))
        data[36:40] = data[16:20]
        with self.assertRaises(prep.Invalid):
            prep.checked_native(bytes(data), "darwin-arm64")

    def test_static_ar_native_members_are_checked(self):
        prep.checked_native(self.static_ar(self.thin()), "darwin-arm64")
        with self.assertRaises(prep.Invalid):
            prep.checked_native(self.static_ar(self.thin(minimum=(14, 0, 0))), "darwin-arm64")

    def test_entire_tree_hidden_native_file_gate(self):
        root = self.base / "hidden-tree"
        root.mkdir()
        (root / "not-an-executable.txt").write_bytes(self.thin(minimum=(13, 0, 0)))
        with self.assertRaises(prep.Invalid):
            prep.mac_tree_evidence(root, "darwin-arm64")
        (root / "not-an-executable.txt").write_bytes(self.thin())
        self.assertTrue(prep.mac_tree_evidence(root, "darwin-arm64"))

    def test_entire_wheel_hidden_native_resource_is_checked(self):
        path = self.base / "native-resource.whl"
        for binary, target, accepted in ((self.thin(), "darwin-arm64", True),
                                         (self.thin(minimum=(13, 0, 0)), "darwin-arm64", False),
                                         (self.thin(), "darwin-x64", False)):
            with zipfile.ZipFile(path, "w") as handle:
                handle.writestr("assets/innocent.bin", binary)
            wheel = {"distribution": "fixture", "version": "1", "asset": self.download(path.name, path.read_bytes())}
            if accepted:
                self.assertTrue(prep.wheel_native_evidence([wheel], self.base, target))
            else:
                with self.assertRaises(prep.Invalid):
                    prep.wheel_native_evidence([wheel], self.base, target)

    def test_fixed_consumed_sources_include_security_adapter_and_copy_bytes(self):
        names = ["scripts/prepare-private-python-runtime.py", "scripts/build-provider-source-wheels.py",
                 "scripts/build-mootdx-compat-wheel.py", "resources/python-runtime/bootstrap.py",
                 "resources/python-runtime/miniracer_unicode_adapter.py", "resources/python-runtime/pywencai_adapter.py",
                 "electron/shared/privatePythonRuntimeManifest.cjs"]
        checkout = self.base / "checkout"
        for index, name in enumerate(names):
            path = checkout / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(f"actual source {index}\n".encode())
        with patch.object(prep, "ROOT", checkout):
            snapshot = prep.source_snapshot(POLICY_SHA)
            self.assertEqual([item["path"] for item in snapshot["files"]], sorted(names))
            candidate = {"sourceSnapshot": snapshot}
            destination = self.base / "tree/providers/pywencai/pywencai_adapter.py"
            prep.bound_source_copy(candidate, "resources/python-runtime/pywencai_adapter.py", destination)
            self.assertEqual(destination.read_bytes(), b"actual source 5\n")
            (checkout / "resources/python-runtime/pywencai_adapter.py").write_bytes(b"changed\n")
            with self.assertRaises(prep.Invalid):
                prep.bound_source_copy(candidate, "resources/python-runtime/pywencai_adapter.py", self.base / "different-copy")

    def link_entries(self, target="binary", extra=()):
        return [("python/bin/binary", "file", 1, 0o755, None, None),
                ("python/bin/python", "symlink", 0, 0o777, None, target)] + list(extra)

    def test_internal_link_plan_and_chain(self):
        extra = [("python/bin/alias", "symlink", 0, 0o777, None, "python")]
        self.assertTrue(prep.link_plan(self.link_entries(extra=extra), "python", allow_links=True))

    def test_links_absolute_escape_and_dangling_rejected(self):
        for target in ("/tmp/bin", "../../outside", "missing", "C:/file", "..\\file"):
            with self.subTest(target=target), self.assertRaises((prep.Invalid, prep.Pending)):
                prep.link_plan(self.link_entries(target), "python", allow_links=True)

    def test_link_cycle_and_write_below_link_rejected(self):
        for entries in (self.link_entries("alias", [("python/bin/alias", "symlink", 0, 0o777, None, "python")]),
                        self.link_entries(extra=[("python/bin/python/child", "file", 1, 0o644, None, None)])):
            with self.assertRaises(prep.Invalid):
                prep.link_plan(entries, "python", allow_links=True)

    def test_selected_link_cannot_reference_removed_file(self):
        with self.assertRaises(prep.Invalid):
            prep.link_plan(self.link_entries(), "python", selected=lambda name: not name.endswith("binary"), allow_links=True)

    def test_operations_missing_receipt_never_claim_verified_source(self):
        receipt = prep.source_receipt(None, prep.source_snapshot(POLICY_SHA))
        self.assertFalse(receipt["sourceVerified"])
        self.assertIsNone(receipt["sourceCommit"])

    def test_operation_input_rejects_authorization_overrides(self):
        base = {"schemaVersion": 1, "kind": "rt-private-runtime-operation-input-v1",
                "cacheRoots": [], "seedReports": {}, "sourceReceipt": None}
        for extra in ({"policySha256": "0" * 64}, {"licenseApprovals": []},
                      {"metadataProvenance": []}, {"approvedSources": ["any"]}):
            path = self.base / (next(iter(extra)) + ".json")
            path.write_bytes(prep.encoded(dict(base, **extra)))
            with self.assertRaises(prep.Invalid):
                prep.load_operations(path, POLICY_SHA, "win32-x64", self.base / "work")

    def test_operation_input_rejects_relative_cache_and_unknown_seed(self):
        for cache, seeds in ((["relative"], {}), ([], {"unknown": str(self.base / "report")})):
            path = self.base / "operations.json"
            path.write_bytes(prep.encoded({"schemaVersion": 1, "kind": "rt-private-runtime-operation-input-v1",
                                         "cacheRoots": cache, "seedReports": seeds, "sourceReceipt": None}))
            with self.assertRaises(prep.Invalid):
                prep.load_operations(path, POLICY_SHA, "win32-x64", self.base / "work")

    def source_receipt_fixture(self):
        snapshot = prep.source_snapshot(POLICY_SHA)
        value = {"schemaVersion": 1, "kind": "rt-private-runtime-source-receipt-v1",
                 "repository": "github.com/test/repository", "sourceCommit": "a" * 40,
                 "sourceTree": "b" * 40, "checkoutClean": True, "policySha256": POLICY_SHA,
                 "sourceFiles": copy.deepcopy(snapshot["files"]), "producer": {"kind": "local-checkout"}}
        return snapshot, value

    def test_external_source_receipt_is_binding_not_a_verification_claim(self):
        snapshot, value = self.source_receipt_fixture()
        path = self.base / "source.json"
        path.write_bytes(prep.encoded(value))
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}):
            receipt = prep.source_receipt(path, snapshot)
        self.assertEqual(receipt["sourceCommit"], "a" * 40)
        self.assertFalse(receipt["sourceVerified"])

    def test_external_source_receipt_rejects_policy_file_hash_and_missing_source(self):
        snapshot, value = self.source_receipt_fixture()
        cases = [dict(value, policySha256="0" * 64), dict(value, sourceFiles=value["sourceFiles"][:-1])]
        wrong = copy.deepcopy(value)
        wrong["sourceFiles"][0]["sha256"] = "0" * 64
        cases.append(wrong)
        for index, case in enumerate(cases):
            path = self.base / f"source-invalid-{index}.json"
            path.write_bytes(prep.encoded(case))
            with self.subTest(index=index), patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}), self.assertRaises(prep.Invalid):
                prep.source_receipt(path, snapshot)

    def test_ci_context_does_not_accept_local_producer_or_wrong_commit(self):
        snapshot, value = self.source_receipt_fixture()
        path = self.base / "source-ci.json"
        path.write_bytes(prep.encoded(value))
        environment = {"GITHUB_ACTIONS": "true", "GITHUB_SHA": "c" * 40,
                       "GITHUB_REPOSITORY": "test/repository", "GITHUB_WORKFLOW_REF": "test/workflow",
                       "GITHUB_RUN_ID": "1", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "test"}
        with patch.dict(os.environ, environment), self.assertRaises(prep.Invalid):
            prep.source_receipt(path, snapshot)

    def test_ci_matching_context_still_does_not_prove_commit_membership(self):
        snapshot, value = self.source_receipt_fixture()
        value["producer"] = {"kind": "github-actions", "workflowRef": "test/workflow", "runId": "1",
                             "runAttempt": "1", "job": "test", "checkoutEventSha": "a" * 40}
        path = self.base / "matching-ci-source.json"
        path.write_bytes(prep.encoded(value))
        environment = {"GITHUB_ACTIONS": "true", "GITHUB_SHA": "a" * 40, "GITHUB_REPOSITORY": "test/repository",
                       "GITHUB_WORKFLOW_REF": "test/workflow", "GITHUB_RUN_ID": "1", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "test"}
        with patch.dict(os.environ, environment):
            receipt = prep.source_receipt(path, snapshot)
        self.assertTrue(receipt["ciContextMatched"])
        self.assertFalse(receipt["sourceVerified"])
        value["sourceCommit"] = "c" * 40
        path.write_bytes(prep.encoded(value))
        with patch.dict(os.environ, environment), self.assertRaises(prep.Invalid):
            prep.source_receipt(path, snapshot)

    def test_operation_overlap_cannot_turn_fresh_work_into_a_cache(self):
        value = {"schemaVersion": 1, "kind": "rt-private-runtime-operation-input-v1",
                 "cacheRoots": [str(self.base)], "seedReports": {}, "sourceReceipt": None}
        path = self.base / "overlap.json"
        path.write_bytes(prep.encoded(value))
        with self.assertRaises(prep.Invalid):
            prep.load_operations(path, POLICY_SHA, "win32-x64", self.base / "fresh")

    def test_actual_official_mac_archive_link_plans(self):
        assets = Path(os.environ.get("RT_PREP_MAC_ASSETS", "D:/RT-ResearchFlow-BuildCache/franklin-mac-inputs-20261009-p2-48590894/assets"))
        if not assets.is_dir():
            self.skipTest("Official Mac archive cache absent; no fixture download")
        for target in ("darwin-arm64", "darwin-x64"):
            archive = prep.verified_asset(assets, POLICY["targets"][target]["python"]["asset"])
            with tarfile.open(archive, "r:gz") as handle:
                entries = [(item.name, "file" if item.isfile() else "dir" if item.isdir() else "symlink" if item.issym() else "unsupported",
                            item.size, item.mode, item, item.linkname if item.issym() else None) for item in handle]
                plan = prep.link_plan(entries, "python", allow_links=True)
                self.assertEqual(sum(entry[0] == "symlink" for entry in plan.values()), 9)

    @unittest.skipUnless(PBS.is_file(), "Existing native PBS required")
    def test_actual_closure_duplicates_inactive_indices_and_final_extras(self):
        wheels = [{"distribution": "root", "version": "1", "tags": ["py3-none-any"],
                   "dependencies": ["child[Feature_Name]==1", "child[Feature_Name]==1", 'absent; python_version < "2"']},
                  {"distribution": "child", "version": "1", "tags": ["py3-none-any"],
                   "dependencies": ['leaf; extra == "feature-name"']},
                  {"distribution": "leaf", "version": "1", "tags": ["py3-none-any"], "dependencies": []}]
        report = prep.validate_closure(PBS, wheels, ["root==1"], self.base)
        self.assertEqual(report["extras"]["child"], ["feature-name"])
        self.assertEqual(len(report["evaluations"]), 4)
        self.assertEqual(len(report["activeRequiresDist"]), 3)
        inactive = [item for item in report["evaluations"] if not item["active"]]
        self.assertEqual(inactive[0]["requiresDistIndex"], 2)
        self.assertEqual(report["packaging"]["id"], "pip-vendored-packaging")

    def test_other_native_host_rejected_before_download(self):
        other = "darwin-arm64" if os.name == "nt" else "win32-x64"
        with patch.object(prep, "fetch", side_effect=AssertionError("must reject before network")):
            with self.assertRaises(prep.Invalid):
                prep.resolve(POLICY, POLICY_SHA, other, self.base / "wrong-host")

    def test_macos_twelve_minimum_is_explicit_before_native_work(self):
        for version in ("12.0", "12.0.1", "13.7.4", "15.0"):
            self.assertIsNone(prep.require_supported_mac_version(version))
        for version in ("", "11.7.10", "unknown", "12"):
            with self.subTest(version=version), self.assertRaises(prep.Invalid):
                prep.require_supported_mac_version(version)

    def test_materialize_rejects_wrong_native_host_before_asset_verification(self):
        lock = self.base / "mac-candidate.json"
        lock.write_bytes(prep.encoded({"status": "candidate", "target": "darwin-arm64"}))
        with patch.object(prep, "native_target", return_value="win32-x64"), \
                patch.object(prep, "verify_candidate", side_effect=AssertionError("must not inspect Mac assets")), \
                self.assertRaises(prep.Invalid):
            prep.materialize(POLICY, POLICY_SHA, lock, self.base, self.base / "wrong-mac-work")
        self.assertFalse((self.base / "wrong-mac-work").exists())

    def test_prepare_help_exposes_portable_operation_input(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(SystemExit) as result:
            prep.main(["prepare", "--help"])
        self.assertEqual(result.exception.code, 0)
        self.assertIn("--operation-input", output.getvalue())

    def test_h67_approvals_and_h6_metadata_roles_are_exact_not_blanket_grants(self):
        batch = [row for row in POLICY["licenseApprovals"] if row["id"].startswith("astra-20261009-h-")]
        self.assertEqual([row["id"] for row in batch],
                         [f"astra-20261009-h-{index:03d}" for index in range(1, 68)])
        keys = {(row["component"], row["version"], row["artifactSha256"], row["licenseSha256"]) for row in batch}
        self.assertEqual(len(keys), 67)
        self.assertEqual(sum(row["component"] == "python-build-standalone" for row in batch), 33)
        self.assertEqual(sum(row["component"] == "numpy" for row in batch), 16)
        for row in batch:
            args = (row["component"], row["version"], row["artifactSha256"], row["licenseSha256"], row["spdx"])
            self.assertEqual(prep.license_decision(POLICY, *args), row["id"])
            self.assertIsNone(prep.license_decision(POLICY, args[0], args[1], "0" * 64, args[3], args[4]))
        self.assertEqual(len(POLICY["metadataProvenance"]), 15)
        added_paths = {
            "providers/mootdx/site/certifi-2026.7.22.dist-info/METADATA",
            "providers/mootdx/site/tqdm-4.70.1.dist-info/METADATA",
            "providers/mootdx/site/tzdata-2026.5.dist-info/METADATA",
            "providers/pywencai/site/certifi-2026.7.22.dist-info/METADATA",
            "providers/pywencai/site/tzdata-2026.5.dist-info/METADATA",
        }
        self.assertEqual({row["path"] for row in POLICY["metadataProvenance"] if row["path"] in added_paths}, added_paths)
        for row in POLICY["metadataProvenance"]:
            if row["path"] in added_paths:
                original = next(item for item in POLICY["metadataProvenance"]
                                if item["component"] == row["component"]
                                and item["path"].startswith("providers/akshare/site/"))
                for field in ("version", "artifactSha256", "metadataSha256", "role", "decision"):
                    self.assertEqual(row[field], original[field])
        for row in POLICY["metadataProvenance"]:
            args = (row["component"], row["version"], row["artifactSha256"], row["path"], row["metadataSha256"])
            self.assertEqual(prep.metadata_role(POLICY, *args), row)
            self.assertIsNone(prep.metadata_role(POLICY, args[0], args[1] + "-wrong", args[2], args[3], args[4]))
            self.assertIsNone(prep.metadata_role(POLICY, args[0], args[1], "0" * 64, args[3], args[4]))
            self.assertIsNone(prep.metadata_role(POLICY, args[0], args[1], args[2], "other/" + args[3], args[4]))
            self.assertIsNone(prep.metadata_role(POLICY, args[0], args[1], args[2], args[3], "0" * 64))
        self.assertIsNone(prep.metadata_role(POLICY, "mootdx", "0.11.7+rt.1", "0" * 64,
                                             "providers/mootdx/site/mootdx-0.11.7+rt.1.dist-info/METADATA", "1" * 64))


if __name__ == "__main__":
    unittest.main()
