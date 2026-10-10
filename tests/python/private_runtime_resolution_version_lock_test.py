"""Offline fixture-only tests for reviewed resolver version locks."""

import base64
from contextlib import ExitStack
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock
import zipfile


SOURCE = Path(__file__).resolve().parents[2] / "scripts/prepare-private-python-runtime.py"
RUNTIME = types.ModuleType("private_runtime_version_lock_under_test")
RUNTIME.__file__ = str(SOURCE)
exec(compile(SOURCE.read_bytes(), str(SOURCE), "exec"), RUNTIME.__dict__)
TEMP_PARENT = Path("D:/RT-ResearchFlow-BuildCache/local-windows-1.7-acceptance")
TARGETS = ("win32-x64", "darwin-arm64", "darwin-x64")


def fixture_policy():
    return {
        "resolverCompatibilityPins": {target: {} for target in TARGETS},
        "reviewedResolutionVersions": {
            "kind": "rt-reviewed-resolver-version-lock-v1",
            "schemaVersion": 1,
            "sourceFormalLockSha256": "a" * 64,
            "sourcePreparationRunId": 17,
            "targets": {
                target: {
                    "numpy": "2.5.3", "soupsieve": "2.10",
                    "executing": "2.2.1", "pycparser": "3.1",
                    "debugpy": "1.8.8", "rt-node": "1.0+rt.1",
                }
                for target in TARGETS
            },
        },
    }


class ReviewedResolutionVersionLockTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.work = Path(self.stack.enter_context(tempfile.TemporaryDirectory(
            prefix="version-lock-test-", dir=TEMP_PARENT)))
        self.policy = fixture_policy()
        self.derived = self.stack.enter_context(mock.patch.object(
            RUNTIME, "derived_wheels", return_value=[]))
        self.verified = self.stack.enter_context(mock.patch.object(
            RUNTIME, "verified_asset",
            side_effect=lambda assets, asset: self.work / asset["filename"]))
        for owner, name in (
            (RUNTIME.urllib.request, "urlopen"),
            (RUNTIME.urllib.request, "urlretrieve"),
            (RUNTIME.subprocess, "run"),
            (RUNTIME.subprocess, "Popen"),
        ):
            self.stack.enter_context(mock.patch.object(
                owner, name, side_effect=AssertionError("External IO is forbidden")))

    def versions(self, target=None):
        return RUNTIME.reviewed_resolution_versions(self.policy, target)

    def reject_lock(self, key, values):
        for value in values:
            with self.subTest(key=key, value=value):
                policy = fixture_policy()
                policy["reviewedResolutionVersions"][key] = value
                with self.assertRaises(RUNTIME.Invalid):
                    RUNTIME.reviewed_resolution_versions(policy)

    def constraints(self, target="win32-x64", provider="akshare", seed=None):
        operations = None
        if seed is not None:
            seed_path = self.work / "seed.json"
            seed_path.write_text(json.dumps({"install": [
                {"metadata": {"name": name, "version": version}}
                for name, version in seed.items()
            ]}), encoding="ascii")
            operations = {"seedReports": {provider: str(seed_path)}}
        path, provenance = RUNTIME.resolution_constraints(
            self.policy, provider, self.work, self.work, target, operations)
        return path.read_text(encoding="ascii").splitlines(), provenance

    def validate(self, wheels, target="win32-x64", provider="akshare"):
        return RUNTIME.validate_resolver_pins(self.policy, target, provider, wheels)

    def wheel(self, name="numpy", version="2.5.3", filename=None):
        filename = filename or (name.replace("-", "_") + "-fixture.whl")
        path = self.work / filename
        info = "fixture-1.dist-info"
        payload = {
            info + "/METADATA": (
                "Metadata-Version: 2.1\nName: " + name +
                "\nVersion: " + version + "\n\n"
            ).encode("ascii"),
            info + "/WHEEL": b"Wheel-Version: 1.0\nTag: py3-none-any\n\n",
        }
        rows = []
        for member, data in payload.items():
            checksum = base64.urlsafe_b64encode(
                hashlib.sha256(data).digest()).rstrip(b"=").decode("ascii")
            rows.append(member + ",sha256=" + checksum + "," + str(len(data)))
        rows.append(info + "/RECORD,,")
        payload[info + "/RECORD"] = ("\n".join(rows) + "\n").encode("ascii")
        with zipfile.ZipFile(path, "w") as archive:
            for member, data in payload.items():
                archive.writestr(member, data)
        result = RUNTIME.read_wheel(path)
        result["asset"] = {
            "kind": "derived", "filename": filename,
            "size": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        return result

    def compatibility(self, target, name, provider):
        wheel = self.wheel(name, self.versions(target)[name])
        pin = {key: copy.deepcopy(wheel[key])
               for key in ("version", "asset", "metadataSha256")}
        self.policy["resolverCompatibilityPins"][target] = {provider: {name: pin}}
        return wheel

    def test_legacy_optional_field(self):
        self.policy.pop("reviewedResolutionVersions")
        self.assertEqual(self.versions(), {})
        for target in TARGETS:
            self.assertEqual(self.versions(target), {})
        self.validate([])
        self.validate([{"distribution": "legacy-unlocked", "version": "9"}])

    def test_complete_three_target_selection(self):
        for index, target in enumerate(TARGETS):
            self.policy["reviewedResolutionVersions"]["targets"][target]["rt-node"] = str(index + 1)
        self.assertEqual(self.versions(), self.policy["reviewedResolutionVersions"]["targets"])
        for index, target in enumerate(TARGETS):
            self.assertEqual(self.versions(target)["rt-node"], str(index + 1))

    def test_invalid_target_even_without_lock(self):
        for legacy in (False, True):
            if legacy:
                self.policy.pop("reviewedResolutionVersions")
            for target in ("linux-x64", "", 1):
                with self.subTest(legacy=legacy, target=target):
                    with self.assertRaises(RUNTIME.Invalid):
                        self.versions(target)

    def test_lock_type_kind_and_schema(self):
        for value in (None, [], "lock"):
            with self.subTest(value=value):
                self.policy["reviewedResolutionVersions"] = value
                with self.assertRaises(RUNTIME.Invalid):
                    self.versions()
        self.reject_lock("kind", ["unknown", "", None])
        self.reject_lock("schemaVersion", [True, False, 0, 2, 1.0, "1", None])

    def test_missing_required_lock_fields(self):
        for key in fixture_policy()["reviewedResolutionVersions"]:
            with self.subTest(key=key):
                policy = fixture_policy()
                del policy["reviewedResolutionVersions"][key]
                with self.assertRaises(RUNTIME.Invalid):
                    RUNTIME.reviewed_resolution_versions(policy)

    def test_unknown_lock_field(self):
        self.policy["reviewedResolutionVersions"]["unexpected"] = 1
        with self.assertRaises(RUNTIME.Invalid):
            self.versions()

    def test_exact_target_keys(self):
        original = fixture_policy()["reviewedResolutionVersions"]["targets"]
        cases = [None, [], {}, {**original, "linux-x64": {"numpy": "2.5.3"}}]
        cases.extend({key: value for key, value in original.items() if key != target}
                     for target in TARGETS)
        self.reject_lock("targets", cases)

    def test_empty_oversized_and_nondict_maps(self):
        for value in ({}, [], None, {"package-" + str(i): "1" for i in range(201)}):
            with self.subTest(value_type=type(value).__name__):
                self.policy = fixture_policy()
                self.policy["reviewedResolutionVersions"]["targets"]["darwin-x64"] = value
                with self.assertRaises(RUNTIME.Invalid):
                    self.versions("win32-x64")

    def test_two_hundred_entries_allowed(self):
        self.policy["reviewedResolutionVersions"]["targets"]["win32-x64"] = {
            "package-" + str(i): "1" for i in range(200)}
        self.assertEqual(len(self.versions("win32-x64")), 200)

    def test_noncanonical_names_and_name_injection(self):
        for name in ("NumPy", "rt_node", "rt.node", "-numpy", "", 1,
                     "numpy\nother", "numpy @ file:///evil", "numpy;extra", "../numpy"):
            with self.subTest(name=name):
                self.policy = fixture_policy()
                self.policy["reviewedResolutionVersions"]["targets"]["win32-x64"] = {name: "1"}
                with self.assertRaises(RUNTIME.Invalid):
                    self.versions()

    def test_version_injection_and_wrong_types(self):
        for version in ("", " 1", "1\nother==2", "1;extra", "1 @ file:///evil",
                        "1/2", "1_2", "-1", 1, None, True):
            with self.subTest(version=version):
                self.policy = fixture_policy()
                self.policy["reviewedResolutionVersions"]["targets"]["win32-x64"]["numpy"] = version
                with self.assertRaises(RUNTIME.Invalid):
                    self.versions()

    def test_allowed_version_characters(self):
        self.policy["reviewedResolutionVersions"]["targets"]["win32-x64"]["numpy"] = "1!2.5rc1+rt-1"
        self.assertEqual(self.versions("win32-x64")["numpy"], "1!2.5rc1+rt-1")

    def test_source_sha_validation(self):
        self.reject_lock("sourceFormalLockSha256", ["A" * 64, "a" * 63, "a" * 65,
                         "g" * 64, "a" * 64 + "\n", None, 123])

    def test_source_run_id_validation(self):
        self.reject_lock("sourcePreparationRunId", [True, False, 0, -1, 1.0, "17", None])

    def test_compatibility_version_conflict_and_missing_name(self):
        self.compatibility("darwin-arm64", "debugpy", "pywencai")
        versions = self.policy["reviewedResolutionVersions"]["targets"]["darwin-arm64"]
        versions["debugpy"] = "1.8.9"
        with self.assertRaises(RUNTIME.Invalid):
            self.versions("win32-x64")
        del versions["debugpy"]
        with self.assertRaises(RUNTIME.Invalid):
            self.versions()

    def test_resolved_metadata_matching_version(self):
        self.validate([self.wheel()])

    def test_metadata_version_drift_despite_locked_filename(self):
        wheel = self.wheel(version="2.5.4", filename="numpy-2.5.3-py3-none-any.whl")
        with self.assertRaises(RUNTIME.Invalid):
            self.validate([wheel])

    def test_unlocked_new_dependency(self):
        with self.assertRaises(RUNTIME.Invalid):
            self.validate([self.wheel("new-dependency", "1")])

    def test_canonical_distribution_and_duplicate_alias(self):
        wheel = self.wheel("RT_Node", "1.0+rt.1")
        self.validate([wheel])
        duplicate = self.wheel("rt.node", "1.0+rt.1", "duplicate.whl")
        with self.assertRaises(RUNTIME.Invalid):
            self.validate([wheel, duplicate])

    def test_duplicate_distribution(self):
        wheel = self.wheel()
        with self.assertRaises(RUNTIME.Invalid):
            self.validate([wheel, copy.deepcopy(wheel)])

    def test_empty_resolution_rejected(self):
        with self.assertRaises(RUNTIME.Invalid):
            self.validate([])

    def test_reviewed_versions_override_old_seed(self):
        lines, provenance = self.constraints(seed={
            "NumPy": "2.4.0", "soupsieve": "2.9", "executing": "2.2.0"})
        for name, version in (("numpy", "2.5.3"), ("soupsieve", "2.10"), ("executing", "2.2.1")):
            self.assertIn(name + "==" + version, lines)
            self.assertEqual(sum(line.startswith(name + "==") for line in lines), 1)
        self.assertIsNotNone(provenance)
        self.assertRegex(provenance["sha256"], r"^[a-f0-9]{64}$")

    def test_legacy_seed_flow_and_stale_engines_removed(self):
        self.policy.pop("reviewedResolutionVersions")
        lines, provenance = self.constraints(seed={
            "NumPy": "2.4.0", "mini_racer": "0.12", "py-mini-racer": "0.6"})
        self.assertEqual(lines, ["numpy==2.4.0"])
        self.assertIsNotNone(provenance)

    def test_mac_compatibility_constraints_preserved(self):
        for target in ("darwin-arm64", "darwin-x64"):
            with self.subTest(target=target):
                self.compatibility(target, "debugpy", "pywencai")
                work = self.work / target
                work.mkdir()
                path, seed = RUNTIME.resolution_constraints(
                    self.policy, "pywencai", self.work, work, target)
                self.assertIn("debugpy==1.8.8", path.read_text(encoding="ascii").splitlines())
                self.assertIsNone(seed)

    def test_derived_uri_precedes_lock_and_seed_without_duplicate(self):
        selected = {"distribution": "RT_Node", "asset": {"filename": "local-node.whl"}}
        self.derived.return_value = [selected]
        lines, _ = self.constraints(seed={"rt.node": "0.9"})
        self.assertEqual(lines[0], "RT_Node @ " + (self.work / "local-node.whl").as_uri())
        self.assertFalse(any(line.startswith("rt-node==") for line in lines))
        self.verified.assert_called_once_with(self.work, selected["asset"])

    def test_derived_engine_uri_survives_stale_seed_removal(self):
        self.derived.return_value = [{
            "distribution": "mini-racer", "asset": {"filename": "engine.whl"}}]
        lines, _ = self.constraints(seed={"mini-racer": "0.12", "py-mini-racer": "0.6"})
        self.assertIn("mini-racer @ " + (self.work / "engine.whl").as_uri(), lines)
        self.assertFalse(any(line.startswith(("mini-racer==", "py-mini-racer==")) for line in lines))

    def test_compatibility_exact_asset_and_metadata_sha_remain_required(self):
        for target in ("darwin-arm64", "darwin-x64"):
            with self.subTest(target=target):
                wheel = self.compatibility(target, "debugpy", "pywencai")
                self.validate([wheel], target, "pywencai")
                for key in ("asset", "metadataSha256"):
                    altered = copy.deepcopy(wheel)
                    if key == "asset":
                        altered[key]["sha256"] = "b" * 64
                    else:
                        altered[key] = "b" * 64
                    with self.subTest(key=key):
                        with self.assertRaises(RUNTIME.Invalid):
                            self.validate([altered], target, "pywencai")
                with self.assertRaises(RUNTIME.Invalid):
                    self.validate([self.wheel(filename=target + "-numpy.whl")], target, "pywencai")

    def test_derived_exact_identity_remains_required(self):
        selected = self.wheel("rt-node", "1.0+rt.1")
        selected["derived"] = {"id": "fixture-derived"}
        selected["nativeBuildInputs"] = {"fixture": "reviewed"}
        self.derived.return_value = [selected]
        self.validate([copy.deepcopy(selected)])
        for key in ("asset", "derived", "nativeBuildInputs"):
            with self.subTest(key=key):
                altered = copy.deepcopy(selected)
                altered[key] = {"unexpected": "changed"}
                with self.assertRaises(RUNTIME.Invalid):
                    self.validate([altered])

    def test_load_policy_invokes_version_lock_validation(self):
        policy = fixture_policy()
        policy.update({
            "schemaVersion": 1, "kind": "rt-private-python-preparation-policy",
            "licenseApprovals": [], "metadataProvenance": [], "recipePins": [],
            "officialSources": ["https://files.pythonhosted.org/", "https://github.com/"],
            "licenseSupplements": copy.deepcopy(RUNTIME.REVIEWED_LICENSE_SUPPLEMENTS),
            "distributionUseScope": copy.deepcopy(RUNTIME.REVIEWED_DISTRIBUTION_SCOPE),
            "lxmlWindowsSourceMaterials": copy.deepcopy(RUNTIME.REVIEWED_LXML_WINDOWS_SOURCES),
            "targets": {target: {} for target in TARGETS},
        })
        pycparser = {
            "version": "3.1",
            "metadataSha256": "f4a14c8bb8bcb1139830e9722da8725fc36c8e22ee0d13e5d094b5b354f80a9d",
            "asset": {
                "kind": "download", "filename": "pycparser-3.1-py3-none-any.whl",
                "url": "https://files.pythonhosted.org/packages/99/ce/b3ae9ee0324d991c860187be2a6ee436d27a3d02397eaddbb101ec901f3d/pycparser-3.1-py3-none-any.whl",
                "size": 48709,
                "sha256": "f09d358c840bd147b79e55f2bc494f18ea869dc897f5852a8f5766b74f787882",
            },
        }
        debugpy = {
            "version": "1.8.8", "metadataSha256": RUNTIME.MAC_DEBUGPY_METADATA_SHA,
            "asset": {
                "kind": "download", "filename": "debugpy-1.8.8-py2.py3-none-any.whl",
                "url": "https://files.pythonhosted.org/fixture/debugpy-1.8.8-py2.py3-none-any.whl",
                "size": 1, "sha256": RUNTIME.MAC_DEBUGPY_COMPAT_SHA,
            },
        }
        for target in TARGETS:
            pins = {"akshare": {"pycparser": copy.deepcopy(pycparser)}}
            if target.startswith("darwin"):
                pins["pywencai"] = {"debugpy": copy.deepcopy(debugpy)}
            policy["resolverCompatibilityPins"][target] = pins
        path = self.work / "fixture-policy.json"
        raw = json.dumps(policy).encode("ascii")
        path.write_bytes(raw)
        with mock.patch.object(RUNTIME, "reviewed_resolution_versions",
                               wraps=RUNTIME.reviewed_resolution_versions) as checked:
            loaded, sha = RUNTIME.load_policy(path)
            self.assertEqual(loaded, policy)
            self.assertEqual(sha, hashlib.sha256(raw).hexdigest())
            checked.assert_called_once_with(policy)
        policy["reviewedResolutionVersions"]["schemaVersion"] = True
        path.write_text(json.dumps(policy), encoding="ascii")
        with self.assertRaises(RUNTIME.Invalid):
            RUNTIME.load_policy(path)


if __name__ == "__main__":
    unittest.main()
