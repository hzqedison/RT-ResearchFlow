#!/usr/bin/env python3
"""Private PBS preparation, candidate API v1; never a production installer.

Policy is a read-only human input. Missing reviewed pins/licenses produce
PRIVATE_RUNTIME_PENDING, never invented URLs, approvals or a locked manifest.
Only hash-approved recipes may execute; retained native inputs are not rebuilt. Preparation and
final assembler/bootstrap acceptance are deliberately different gates.

Candidate kinds in this file are NOT the official runtime manifest schema.
Resolution and installation run in freshly extracted, pinned native PBS tools.
License/source-commit pending items do not block candidate preparation. They
still block formal seal. No cached provider site or old report is a final lock.
seal currently validates candidate prerequisites then remains pending until
the separately owned formal-schema/bootstrap integration is handed over.

No git, production DB/account/configuration reads, installers or package locks.
Requires Python 3.10+; real preparation must run on the matching native PBS.
"""

import argparse
import base64
import csv
from datetime import datetime, timezone
from email.parser import BytesParser
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import posixpath
import re
import shutil
import stat
import struct
import subprocess
import sys
import sysconfig
import tarfile
import threading
import time
import urllib.parse
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / "resources/python-runtime/preparation.policy.json"
TARGETS = ("win32-x64", "darwin-arm64", "darwin-x64")
PROVIDERS = ("akshare", "mootdx", "pywencai")
RECIPES = {"scripts/build-provider-source-wheels.py", "scripts/build-mootdx-compat-wheel.py", "scripts/build-akshare-node-wheel.py", "scripts/build-private-node-js-runtime-wheel.py",
           "scripts/rebuild-lxml-native.py", "scripts/build-lxml-redistribution-wheel.py",
           "scripts/build-lxml-matched-public-source.py"}
SHA = re.compile(r"^[a-f0-9]{64}$")
MAX_ASSET = 1_500_000_000
MAX_EXPANSION = 3_000_000_000
MAC_DEBUGPY_COMPAT_SHA = "ec684553aba5b4066d4de510859922419febc710df7bba04fe9e7ef3de15d34f"
MAC_DEBUGPY_METADATA_SHA = "331e35d868b289efd107aa991640ee2753465e95c8655e0bb5a68c7962e32034"


class Invalid(ValueError):
    pass


class Pending(ValueError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    hasher = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode("ascii")


def text(value):
    return isinstance(value, str) and bool(value.strip())


def relative(value):
    if (not text(value) or "\\" in value or value.startswith("/")
            or any(part in {"", ".", ".."} or ":" in part or part.endswith((".", " "))
                   or any(ord(char) < 32 for char in part) for part in value.split("/"))):
        raise Invalid("Unsafe relative path")
    return value


def asset(value, download_only=False):
    if not isinstance(value, dict) or value.get("kind") not in {"download", "derived"}:
        raise Invalid("Asset kind must be explicit")
    if download_only and value["kind"] != "download":
        raise Invalid("This input must be a download asset")
    fields = {"kind", "filename", "sha256", "size"}
    if value["kind"] == "download":
        fields.add("url")
    if set(value) != fields:
        raise Invalid("Unexpected/missing asset fields; derived assets cannot have URLs")
    relative(value["filename"])
    if "/" in value["filename"] or not SHA.fullmatch(str(value["sha256"])):
        raise Invalid("Invalid asset filename/SHA-256")
    if type(value["size"]) is not int or not 0 < value["size"] <= MAX_ASSET:
        raise Invalid("Invalid asset size")
    if value["kind"] == "download":
        parsed = urllib.parse.urlsplit(value["url"])
        url_name = urllib.parse.unquote(parsed.path.rsplit("/", 1)[-1])
        reviewed_alias = any(value == {key: content for key, content in item.items() if key != "id"}
                             for item in globals().get("REVIEWED_LXML_WINDOWS_SOURCES", ()))
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
                or parsed.password is not None or parsed.query or parsed.fragment
                or parsed.port not in {None, 443}
                or (url_name != value["filename"] and not reviewed_alias)):
            raise Invalid("Unsafe/mismatched download URL")
    return value


def official(value, policy):
    asset(value, True)
    parsed = urllib.parse.urlsplit(value["url"])
    prefixes = policy.get("officialSources", [])
    if not any(value["url"].startswith(prefix) for prefix in prefixes):
        raise Invalid("Download source is not allowed by policy")
    decoded = urllib.parse.unquote(parsed.path)
    if any(part in {".", ".."} for part in decoded.split("/")):
        raise Invalid("Download URL escapes its official prefix")
    return value


REVIEWED_LICENSE_SUPPLEMENTS = {
    "tix": {
        "asset": {"kind": "download", "filename": "tix-8.4.3.6.tar.gz", "size": 1836451,
                  "sha256": "f7b21d115867a41ae5fd7c635a4c234d3ca25126c3661eb36028c6e25601f85e",
                  "url": "https://github.com/python/cpython-source-deps/archive/tix-8.4.3.6.tar.gz"},
        "archivePrefix": "cpython-source-deps-tix-8.4.3.6",
        "members": [
            {"sourceMember": "cpython-source-deps-tix-8.4.3.6/docs/license.html_lib",
             "target": "licenses/tix-8.4.3.6/docs/license.html_lib",
             "sha256": "9149f81c6efd1c3cef68742b67dc6f1b6211f32f425f3b6d24cf5279668cfd27"},
            {"sourceMember": "cpython-source-deps-tix-8.4.3.6/docs/license.tcltk",
             "target": "licenses/tix-8.4.3.6/docs/license.tcltk",
             "sha256": "def74f610b8682dd12a772954ee8ad07d304cdf106abb6e030f71ee489419d1a"},
            {"sourceMember": "cpython-source-deps-tix-8.4.3.6/license.terms",
             "target": "licenses/tix-8.4.3.6/license.terms",
             "sha256": "91ff35309038fcfab853c8634b7b743a179c211d8ff3cb174b579c8af3c3072d"}]},
    "libzmq": {
        "asset": {"kind": "download", "filename": "zeromq-4.3.5.tar.gz", "size": 2530237,
                  "sha256": "6653ef5910f17954861fe72332e68b03ca6e4d9c7160eb3a8de5a5a913bfab43",
                  "url": "https://github.com/zeromq/libzmq/releases/download/v4.3.5/zeromq-4.3.5.tar.gz"},
        "target": "licenses/sources/zeromq-4.3.5.tar.gz"},
    "notice": {"target": "licenses/third-party/runtime-NOTICES.txt"}}

REVIEWED_DISTRIBUTION_SCOPE = {
    "kind": "rt-private-runtime-limited-purpose-review-v1",
    "purpose": "noncommercial-open-source-learning-and-testing",
    "commercialUse": "not-reviewed-or-promised",
    "wholeProductLicense": "unchanged",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-applicability-t-20261009"}

REVIEWED_LXML_WINDOWS_SOURCES = [
    {"id": "lxml", "kind": "download", "filename": "lxml-6.1.3.tar.gz", "size": 4211198,
     "sha256": "45222d94ddd511536f3b2f7d9deae3b2339b4ce0f075f1ca25703b07cad9dd21",
     "url": "https://files.pythonhosted.org/packages/23/ad/28ecd7cb894d172f3c9c80a075eeeb2017ac62e3632cee05a5f9493547eb/lxml-6.1.3.tar.gz"},
    {"id": "libiconv", "kind": "download", "filename": "libiconv-880a1fa8.tar.gz", "size": 5313881,
     "sha256": "89dd45d7f074ddae04dcd25cc4ceace3432c04b72dc36a6508854aac713f3eb6",
     "url": "https://github.com/winlibs/libiconv/archive/880a1fa8b5581e37e136a7b051947d3ea39097b6.tar.gz"},
    {"id": "libxml2", "kind": "download", "filename": "libxml2-bb846788.tar.gz", "size": 4225102,
     "sha256": "5182396205f97b183d34ab8dadd7693523c7d4e2137394aec02514a5a9a9dcf0",
     "url": "https://github.com/winlibs/libxml2/archive/bb84678855e3407fc88180295c992f9c984e28e0.tar.gz"},
    {"id": "libxslt", "kind": "download", "filename": "libxslt-c0076eaa.tar.gz", "size": 2705214,
     "sha256": "d687aaf48527e042d942dccbc74fbcd150588522305e63d3e91785d9b6590677",
     "url": "https://github.com/winlibs/libxslt/archive/c0076eaa6e0d1f99e01107e8db225a308eb1e543.tar.gz"},
    {"id": "zlib", "kind": "download", "filename": "zlib-0089522e.tar.gz", "size": 1559272,
     "sha256": "e2af9f28fcdf723e464b40af73fdeed07ce3e581a9ea110702c1ba733983f8a0",
     "url": "https://github.com/winlibs/zlib/archive/0089522e62e6b5d4950e62bd20f0cb06a9288413.tar.gz"},
    {"id": "build-recipe", "kind": "download", "filename": "libxml2-win-binaries-4e8ae01f.tar.gz", "size": 4262,
     "sha256": "cd155987f5269d04acb549d8664b50b1ea0bf3580e1ab709587a03e4bda4396e",
     "url": "https://github.com/lxml/libxml2-win-binaries/archive/4e8ae01f61145dc823ce2ae1d79f06241b7b46de.tar.gz"}]

LIMITED_PURPOSE_WHEELS = {
    "mootdx": ("0.11.7+rt.node.1", "96217b04c7a0a9b9d1e350997de0922f0f8b9cb1f0b8a7c34a99540b32670109",
               {"AUTHORS.rst": "6e7b7bde9bf124e306122b8aabe46eb81e12a37ea74777d708b79c958aab051c",
                "LICENSE": "ee03a051e103766e566b0a3ac0532daa665bb063cf8f30de46fd7c7ac9d00ec6",
                "METADATA": "3c34b74003b3dc9dbb6c2b4bff58e3f4232187c9e2980f0646c5354eb2cd9e0e"}),
    "tdxpy": ("0.2.7", "5514d35608fac2c7b2acf693de6f41ba7ccda58207b65a3f374c89887560737c",
              {"LICENSE": "fd2d2d610584198f900995e2d3ce121a2fd50c61416a74bb3de40cc88dffa2dd",
               "METADATA": "e2763ae0262af4f042ea0e817f9c4252cd291caa589d0586b818e002f0ca8100"})}

BDB_CODE_PATH = re.compile(r"(?:^|/)(?:_?bsddb3?|berkeleydb|libdb(?:[-_.][0-9]+)?)(?:[./]|$)|(?:^|/)(?:libdb|db[0-9]*)[^/]*\.(?:dll|so(?:\.[0-9]+)*|dylib|a|lib)$", re.I)
TIX_COMPONENT_NAME = re.compile(r"(?:lib)?tix(?:[0-9][0-9._-]*)?", re.I)
TIX_NATIVE_OR_SCRIPT = re.compile(r"(?:lib)?tix(?:[0-9][0-9._-]*)?\.(?:dll|so(?:\.[0-9]+)*|dylib|a|lib|tcl|py)$", re.I)


def tix_component_path(path):
    parts = path.split("/")
    return any(TIX_COMPONENT_NAME.fullmatch(part) for part in parts[:-1]) or bool(TIX_NATIVE_OR_SCRIPT.fullmatch(parts[-1]))


def bdb_build_reference(metadata):
    """Only linked core/extensions, not historical license or stdlib-test names."""
    build = metadata.get("build_info")
    core = build.get("core") if isinstance(build, dict) else None
    extensions = build.get("extensions") if isinstance(build, dict) else None
    loading = metadata.get("python_extension_module_loading")
    if (not isinstance(core, dict) or not {"links", "objs", "shared_lib"} <= core.keys()
            or not isinstance(core["links"], list) or not isinstance(core["objs"], list)
            or not isinstance(extensions, dict) or not isinstance(loading, (dict, list))):
        return None  # Incomplete build facts cannot prove target absence.
    linked = {"core": core, "extensions": extensions, "extensionLoading": loading}
    raw = json.dumps(linked, sort_keys=True)
    return bool(re.search(r"(?i)(?:^|[^a-z0-9])(?:_?bsddb3?|berkeley[._-]?db|libdb(?:[._-]?[0-9]+)?|db(?:[._-]?[0-9]+)?)(?=$|[^a-z0-9])", raw))


def reviewed_license_supplements(policy):
    value = policy.get("licenseSupplements")
    if value != REVIEWED_LICENSE_SUPPLEMENTS:
        raise Invalid("Exact reviewed Tix/libzmq/NOTICE supplement pins are required")
    for name in ("tix", "libzmq"):
        official(value[name]["asset"], policy)
    return value


def load_policy(path):
    raw = Path(path).read_bytes()
    policy = json.loads(raw)
    if policy.get("schemaVersion") != 1 or policy.get("kind") != "rt-private-python-preparation-policy":
        raise Invalid("Unknown preparation policy")
    approvals = policy.get("licenseApprovals")
    if not isinstance(approvals, list):
        raise Invalid("Missing license approval records")
    ids = set()
    for record in approvals:
        required = {"id", "component", "version", "artifactSha256", "licenseSha256", "spdx", "decision"}
        if (not isinstance(record, dict) or not required <= record.keys()
                or record.keys() - required - {"reviewedBy", "reviewReference"}
                or any(not text(record.get(key)) for key in ("id", "component", "version", "spdx"))
                or record["id"] in ids or not SHA.fullmatch(str(record["artifactSha256"]))
                or not SHA.fullmatch(str(record["licenseSha256"]))
                or record["decision"] not in {"approved", "pending", "rejected"}):
            raise Invalid("Invalid/duplicate license approval")
        if record["decision"] == "approved" and not all(text(record.get(key)) for key in ("reviewedBy", "reviewReference")):
            raise Invalid("Approved license requires reviewer and reference")
        ids.add(record["id"])
    provenance = policy.get("metadataProvenance")
    if not isinstance(provenance, list):
        raise Invalid("Missing exact metadata provenance records")
    seen_provenance = set()
    fields = {"component", "version", "artifactSha256", "metadataSha256", "path", "role", "decision"}
    for record in provenance:
        if (not isinstance(record, dict) or set(record) != fields
                or not all(text(record[key]) for key in ("component", "version"))
                or not SHA.fullmatch(str(record["artifactSha256"]))
                or not SHA.fullmatch(str(record["metadataSha256"]))
                or relative(record["path"]) != record["path"]
                or not record["path"].endswith(".dist-info/METADATA")
                or record["role"] != "provenance-and-license-reference"
                or record["decision"] != "not-an-independent-license-grant"):
            raise Invalid("Invalid exact metadata provenance record")
        key = (record["component"], record["version"], record["artifactSha256"],
               record["metadataSha256"], record["path"])
        if key in seen_provenance:
            raise Invalid("Duplicate exact metadata provenance record")
        seen_provenance.add(key)
    reviewed_license_supplements(policy)
    if policy.get("distributionUseScope") != REVIEWED_DISTRIBUTION_SCOPE:
        raise Invalid("Exact limited-purpose distribution scope is required")
    if policy.get("lxmlWindowsSourceMaterials") != REVIEWED_LXML_WINDOWS_SOURCES:
        raise Invalid("Exact reviewed Windows lxml source archive pins are required")
    for item in REVIEWED_LXML_WINDOWS_SOURCES:
        official({key: value for key, value in item.items() if key != "id"}, policy)
    recipes = policy.get("recipePins", [])
    if len({item.get("path") for item in recipes}) != len(recipes):
        raise Invalid("Duplicate recipe pin")
    for item in recipes:
        if set(item) != {"path", "sha256"} or item["path"] not in RECIPES or not SHA.fullmatch(str(item["sha256"])):
            raise Invalid("Unapproved recipe pin")
    pins = policy.get("resolverCompatibilityPins")
    if not isinstance(pins, dict) or set(pins) != {"darwin-arm64", "darwin-x64"}:
        raise Invalid("Both Mac native compatibility pins are required")
    for target in ("darwin-arm64", "darwin-x64"):
        providers = pins[target]
        if not isinstance(providers, dict) or set(providers) != {"pywencai"}:
            raise Invalid("Unknown Mac compatibility provider pin")
        distributions = providers["pywencai"]
        if not isinstance(distributions, dict) or set(distributions) != {"debugpy"}:
            raise Invalid("Unknown Mac compatibility distribution pin")
        pin = distributions["debugpy"]
        if (not isinstance(pin, dict) or set(pin) != {"version", "asset", "metadataSha256"}
                or pin["version"] != "1.8.8" or pin["metadataSha256"] != MAC_DEBUGPY_METADATA_SHA
                or not isinstance(pin["asset"], dict)
                or pin["asset"].get("filename") != "debugpy-1.8.8-py2.py3-none-any.whl"
                or pin["asset"].get("sha256") != MAC_DEBUGPY_COMPAT_SHA):
            raise Invalid("Mac debugpy original wheel compatibility evidence differs")
        official(pin["asset"], policy)
    for target in policy.get("targets", {}):
        derived_wheels(policy, target)
    return policy, digest(raw)


def wheel_contract(wheel, policy):
    asset(wheel["asset"])
    if wheel["asset"]["kind"] == "download":
        if "derived" in wheel:
            raise Invalid("Download wheel cannot have derived provenance")
        official(wheel["asset"], policy)
        return wheel
    derived = wheel.get("derived")
    required = {"id", "upstreamVersion", "upstreamSha256", "patchSha256", "upstreamAsset", "recipe"}
    if not isinstance(derived, dict) or set(derived) != required or not all(text(derived[key]) for key in ("id", "upstreamVersion")):
        raise Invalid("Incomplete derived wheel; legacy patch field is not accepted")
    official(derived["upstreamAsset"], policy)
    recipe = derived["recipe"]
    if (not isinstance(recipe, dict) or set(recipe) != {"path", "sha256"}
            or recipe["path"] not in RECIPES or recipe not in policy.get("recipePins", [])
            or derived["upstreamSha256"] != derived["upstreamAsset"]["sha256"]
            or derived["patchSha256"] != recipe["sha256"]):
        raise Invalid("Derived source/recipe pins disagree")
    relative(recipe["path"])
    native_build_assets(wheel)
    if (wheel.get("nativeBuildInputs") or {}).get("kind") == "rt-lxml-redistribution-inputs-v1":
        source_recipe = wheel["nativeBuildInputs"]["sourceRecipe"]
        if source_recipe not in policy.get("recipePins", []) or source_recipe["path"] != "scripts/build-lxml-matched-public-source.py":
            raise Invalid("Public source recipe is not independently pinned")
    return wheel


def native_build_assets(wheel, target=None):
    """Retained, policy-pinned inputs; this is not a license/build approval."""
    inputs = wheel.get("nativeBuildInputs")
    if inputs is None:
        return []
    if not isinstance(inputs, dict):
        raise Invalid("Native input provenance must be an object")
    if inputs.get("kind") == "rt-lxml-redistribution-inputs-v1":
        if (inputs.get("target") not in TARGETS or (target is not None and inputs["target"] != target)
                or inputs.get("selectedAssetSha256") != wheel["asset"]["sha256"]
                or inputs.get("nativeRecompiled") is not False
                or inputs.get("originalSdistRedistributed") is not False
                or inputs.get("excludedNamespace") != "lxml/isoschematron/**"
                or wheel["derived"]["recipe"]["path"] != "scripts/build-lxml-redistribution-wheel.py"
                or not isinstance(inputs.get("sourceRecipe"), dict)
                or not isinstance(inputs.get("nativeMemberPins"), list) or not inputs["nativeMemberPins"]
                or not isinstance(inputs.get("noticePins"), list) or not inputs["noticePins"]):
            raise Invalid("Incomplete matched redistribution input provenance")
        values = [inputs["publicSourceAsset"], inputs["originalWheelAsset"], inputs["originalSourceAsset"]]
        names = set()
        for value in values:
            asset(value)
            if value["filename"] in names:
                raise Invalid("Conflicting redistribution input names")
            names.add(value["filename"])
        if (inputs["publicSourceAsset"]["kind"] != "derived"
                or not inputs["publicSourceAsset"]["filename"].endswith(".zip")
                or inputs["originalWheelAsset"]["kind"] != "derived"
                or not inputs["originalWheelAsset"]["filename"].endswith(".whl.proof")):
            raise Invalid("Public source or private original-wheel proof is invalid")
        for key in ("nativeMemberPins", "noticePins"):
            seen = set()
            for pin in inputs[key]:
                if (relative(pin["path"]) != pin["path"] or pin["path"] in seen
                        or not SHA.fullmatch(str(pin.get("sha256")))
                        or type(pin.get("size")) is not int or pin["size"] < 0):
                    raise Invalid("Invalid redistribution member pin")
                seen.add(pin["path"])
                if key == "noticePins" and wheel["notices"].get(pin["path"]) != pin["sha256"]:
                    raise Invalid("Redistribution notice pin mismatch")
        return values
    if (not isinstance(inputs, dict)
            or inputs.get("kind") != "rt-lxml-retained-native-build-inputs-v1"
            or inputs.get("target") not in TARGETS
            or (target is not None and inputs["target"] != target)
            or inputs.get("mode") != "retained-native-build-not-byte-identical-reproduction"
            or inputs.get("defaultProductAssetSha256") != wheel["asset"]["sha256"]
            or inputs.get("currentRecipeSha256") != wheel["derived"]["recipe"]["sha256"]
            or inputs.get("relinkDefaultProductInput") is not False
            or not all(text(inputs.get(key)) for key in
                       ("selectedVariant", "targetLabel", "currentRecipeRole",
                        "originalWheelReproduction", "policyDecision", "sourceMaterialsRetention"))
            or not all(SHA.fullmatch(str(inputs.get(key))) for key in
                       ("selectionSha256", "manifestSha256", "binaryProducerWrapperSha256"))):
        raise Invalid("Incomplete or conflicting retained native provenance")
    values = inputs.get("assets")
    if not isinstance(values, list) or not values:
        raise Invalid("Retained native materials are required")
    names = set()
    for value in values:
        asset(value)
        if value["kind"] != "derived" or value["filename"] in names or value["filename"].endswith(".whl"):
            raise Invalid("Native ancillary input must be unique and not pip-discoverable")
        names.add(value["filename"])
    for key in ("sourceMaterialsAsset", "relinkProofAsset"):
        if inputs.get(key) not in values:
            raise Invalid("Complete source materials and proof must be retained inputs")
    if (not inputs["sourceMaterialsAsset"]["filename"].endswith(".zip")
            or not inputs["relinkProofAsset"]["filename"].endswith(".whl.proof")
            or not isinstance(inputs.get("relinkOriginalWheelFilename"), str)
            or inputs["relinkOriginalWheelFilename"] + ".proof" != inputs["relinkProofAsset"]["filename"]
            or not {"source-materials-summary.json", "REBUILD.md"} <= names):
        raise Invalid("Full source archive, summary, rebuild instructions and proof are required")
    for key in ("nativeMemberPins", "noticePins"):
        pins = inputs.get(key)
        if not isinstance(pins, list) or not pins:
            raise Invalid("Retained native members and notices require exact pins")
        seen = set()
        for pin in pins:
            if (not isinstance(pin, dict) or not isinstance(pin.get("path"), str)
                    or relative(pin["path"]) != pin["path"] or pin["path"] in seen
                    or not SHA.fullmatch(str(pin.get("sha256")))
                    or type(pin.get("size")) is not int or pin["size"] < 0):
                raise Invalid("Invalid retained native member pin")
            seen.add(pin["path"])
            if key == "noticePins" and wheel.get("notices", {}).get(pin["path"]) != pin["sha256"]:
                raise Invalid("Retained notice pin differs from selected wheel")
    return values


def derived_wheels(policy, target):
    """Global source recipes plus this target's independently pinned native inputs."""
    if target not in TARGETS or target not in policy.get("targets", {}):
        raise Invalid("Unsupported native target")
    scoped = policy["targets"][target].get("derivedWheels", [])
    global_wheels = policy.get("derivedWheels", [])
    if not isinstance(scoped, list) or not isinstance(global_wheels, list):
        raise Invalid("Derived wheel selections must be lists")
    result, names, filenames = [], set(), set()
    for wheel in global_wheels + scoped:
        wheel_contract(wheel, policy)
        if wheel["asset"]["kind"] != "derived":
            raise Invalid("Derived selection cannot contain a download wheel")
        name = re.sub(r"[-_.]+", "-", wheel["distribution"]).lower()
        if name in names or wheel["asset"]["filename"] in filenames:
            raise Invalid("Duplicate target derived distribution or asset")
        if wheel in scoped:
            if not native_build_assets(wheel, target):
                raise Invalid("Target derived wheel requires native input provenance")
        elif wheel.get("nativeBuildInputs") is not None:
            raise Invalid("Native derived selection must be target-scoped")
        names.add(name)
        filenames.add(wheel["asset"]["filename"])
        result.append(wheel)
    return result


def redistribution_receipt(wheel, assets, work, policy, execute=False):
    """Offline repack only; historical C/native build inputs are never executed."""
    inputs = wheel["nativeBuildInputs"]
    values = native_build_assets(wheel, inputs["target"])
    approved = next((item for item in derived_wheels(policy, inputs["target"])
                     if item["asset"] == wheel["asset"]), None)
    if approved != wheel:
        raise Invalid("Redistribution wheel differs from this target's policy")
    for value in values:
        verified_asset(assets, value)
    original = verified_asset(assets, inputs["originalWheelAsset"])
    source = verified_asset(assets, inputs["publicSourceAsset"])
    with zipfile.ZipFile(source) as archive:
        manifest = json.loads(archive.read("RT_PUBLIC_SOURCE_MANIFEST.json"))
        if (manifest.get("kind") != "rt-lxml-matched-public-source-v1"
                or manifest.get("target") != inputs["target"]
                or manifest.get("matchedDistributionVersion") != wheel["version"]
                or manifest.get("originalWheelSha256") != inputs["originalWheelAsset"]["sha256"]
                or manifest.get("originalArchive", {}).get("sha256") != inputs["originalSourceAsset"]["sha256"]
                or manifest.get("originalLxmlSdistSha256") != wheel["derived"]["upstreamSha256"]
                or manifest.get("originalLxmlSdistRedistributed") is not False
                or manifest.get("isoSchematronProvided") is not False
                or manifest.get("nativeRecompiled") is not False
                or manifest.get("windowsInputProfile", "local-lx3") != inputs.get("windowsInputProfile", "local-lx3")):
            raise Invalid("Public source does not match the selected target/input")
    snapshot = recipe_snapshot(assets, wheel["derived"]["recipe"], policy)
    recipe_snapshot(assets, inputs["sourceRecipe"], policy)
    if execute:
        name = "rt_reviewed_repack_" + wheel["derived"]["recipe"]["sha256"]
        spec = importlib.util.spec_from_file_location(name, snapshot)
        module = importlib.util.module_from_spec(spec)
        previous = sys.dont_write_bytecode
        try:
            sys.dont_write_bytecode = True
            spec.loader.exec_module(module)
            expected = (module.input_pin(inputs["target"], inputs.get("windowsInputProfile", "local-lx3"))
                        if hasattr(module, "input_pin") else module.PINS[inputs["target"]])
            if expected[:2] != (inputs["originalWheelFilename"], inputs["originalWheelAsset"]["sha256"]):
                raise Invalid("Repack recipe does not bind the selected original artifact")
            source_pin = {"filename": source.name, "sha256": inputs["publicSourceAsset"]["sha256"],
                          "size": inputs["publicSourceAsset"]["size"], "target": inputs["target"],
                          "originalWheelSha256": inputs["originalWheelAsset"]["sha256"]}
            data, _ = module.repack_bytes(original.read_bytes(), inputs["target"], source_pin)
        finally:
            sys.dont_write_bytecode = previous
        if digest(data) != wheel["asset"]["sha256"] or len(data) != wheel["asset"]["size"]:
            raise Invalid("Actual deterministic repack differs from the selected wheel")
        exclusive_bytes(Path(assets) / wheel["asset"]["filename"], data)
    path = verified_asset(assets, wheel["asset"])
    actual = read_wheel(path)
    if any(wheel.get(key) != fact for key, fact in actual.items()):
        raise Invalid("Redistribution wheel metadata/notices differ")
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if any("isoschematron" in name.lower().split("/") for name in names):
            raise Invalid("Excluded optional namespace is present")
        native = {name for name in names if name.endswith((".pyd", ".dll", ".so", ".dylib"))}
        if native != {pin["path"] for pin in inputs["nativeMemberPins"]}:
            raise Invalid("Redistribution native member set differs")
        for pin in inputs["nativeMemberPins"] + inputs["noticePins"]:
            data = archive.read(pin["path"])
            if len(data) != pin["size"] or digest(data) != pin["sha256"]:
                raise Invalid("Redistribution member bytes differ")
        proof = json.loads(archive.read("lxml-" + wheel["version"] + ".dist-info/RT_REDISTRIBUTION.json"))
        if (proof.get("target") != inputs["target"] or proof.get("nativeRecompiled") is not False
                or proof.get("originalWheelSha256") != inputs["originalWheelAsset"]["sha256"]
                or proof.get("publicSource", {}).get("sha256") != inputs["publicSourceAsset"]["sha256"]):
            raise Invalid("Wheel public-source provenance differs")
    return {"kind": "rt-private-wheel-reproduction", "wheelSha256": wheel["asset"]["sha256"],
            "wheelSize": wheel["asset"]["size"], "upstreamSha256": wheel["derived"]["upstreamSha256"],
            "recipeSha256": wheel["derived"]["recipe"]["sha256"], "executed": execute,
            "executedThisOperation": False, "repackExecutedThisOperation": execute,
            "nativeBuildExecutedThisOperation": False, "nativeBuildInputs": inputs,
            "extraUpstreamInputs": values, "releaseApproval": False}


def retained_native_receipt(wheel, assets, policy):
    """Verify retained native bytes without importing a recipe or claiming a build."""
    if wheel["nativeBuildInputs"]["kind"] == "rt-lxml-redistribution-inputs-v1":
        return redistribution_receipt(wheel, assets, None, policy)
    values = native_build_assets(wheel)
    if not values:
        raise Invalid("Retained native input provenance missing")
    approved = next((item for item in derived_wheels(policy, wheel["nativeBuildInputs"]["target"])
                     if item["asset"] == wheel["asset"]), None)
    if approved != wheel:
        raise Invalid("Retained native wheel differs from target policy")
    path = verified_asset(assets, wheel["asset"])
    actual = read_wheel(path)
    if any(wheel.get(key) != fact for key, fact in actual.items()):
        raise Invalid("Retained wheel metadata/notices differ from policy")
    for value in values:
        verified_asset(assets, value)
    inputs = wheel["nativeBuildInputs"]
    with zipfile.ZipFile(path) as archive:
        native_names = {name for name in archive.namelist()
                        if name.lower().endswith((".pyd", ".dll", ".so", ".dylib"))}
        if native_names != {pin["path"] for pin in inputs["nativeMemberPins"]}:
            raise Invalid("Retained native member set differs from policy")
        for pin in inputs["nativeMemberPins"] + inputs["noticePins"]:
            data = archive.read(pin["path"])
            if len(data) != pin["size"] or digest(data) != pin["sha256"]:
                raise Invalid("Retained native member/notice bytes differ")
    # The proof is evidence only, never a second installable wheel in --find-links.
    read_wheel(verified_asset(assets, inputs["relinkProofAsset"]))
    return {"kind": "rt-private-wheel-reproduction",
            "upstreamSha256": wheel["derived"]["upstreamSha256"],
            "recipeSha256": wheel["derived"]["recipe"]["sha256"],
            "wheelSha256": wheel["asset"]["sha256"], "wheelSize": wheel["asset"]["size"],
            "executed": False, "executedThisOperation": False,
            "mode": inputs["mode"], "nativeBuildInputs": inputs,
            "inputOrigin": {"selectionSha256": inputs["selectionSha256"],
                            "binaryProducerWrapperSha256": inputs["binaryProducerWrapperSha256"],
                            "currentRecipeRole": inputs["currentRecipeRole"]},
            "extraUpstreamInputs": values, "releaseApproval": False}


def verified_asset(root, value):
    asset(value)
    root = Path(root).resolve()
    path = root / value["filename"]
    if (path.is_symlink() or not path.is_file() or path.resolve().parent != root
            or path.stat().st_size != value["size"] or file_digest(path) != value["sha256"]):
        raise Invalid("Asset bytes/size/SHA-256 mismatch")
    return path


def exclusive_bytes(path, data):
    path = Path(path)
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != data:
            raise Invalid("Refusing conflicting output")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.parent.resolve() != path.parent.absolute():
        raise Invalid("Output parent cannot traverse links")
    with path.open("xb") as handle:
        handle.write(data)


def owned_path(path):
    path = Path(path).absolute()
    runner_temp = os.environ.get("RUNNER_TEMP")
    ci_root = Path(runner_temp).resolve() if runner_temp and os.environ.get("GITHUB_ACTIONS") == "true" else None
    in_ci_temp = ci_root is not None and path.is_relative_to(ci_root)
    if os.name == "nt" and path.drive.casefold() not in {"d:", "k:"} and not in_ci_temp:
        raise Invalid("Windows work/output must use an explicit D:/K: root")
    forbidden = {"program files", "program files (x86)", "windows", "applications", "system"}
    if not in_ci_temp:
        forbidden.add("appdata")
    if any(part.casefold() in forbidden for part in path.parts):
        raise Invalid("Production/system work root is forbidden")
    if path.parent.resolve() != path.parent:
        raise Invalid("Work/output parent must be fully resolved, without links")
    return path


def fresh_work(path, policy):
    path = owned_path(path)
    if path.exists() or path.is_symlink() or not path.parent.is_dir():
        raise Invalid("Work root must be fresh with an existing parent")
    required = policy.get("minimumFreeBytes", 4 * 1024 ** 3)
    if type(required) is not int or required < 0 or shutil.disk_usage(path.parent).free < required:
        raise Invalid("Insufficient work-root disk space")
    path.mkdir(mode=0o700)
    for name in ("home", "temp", "pip-cache", "toolchain", "assets"):
        (path / name).mkdir()
    return path


def controlled_environment(work):
    keep = ("SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "PATH", "LANG", "LC_ALL")
    env = {key: os.environ[key] for key in keep if key in os.environ}
    env.update(HOME=str(work / "home"), USERPROFILE=str(work / "home"),
               TMP=str(work / "temp"), TEMP=str(work / "temp"), TMPDIR=str(work / "temp"),
               XDG_CACHE_HOME=str(work / "pip-cache"), PIP_CACHE_DIR=str(work / "pip-cache"),
               PIP_CONFIG_FILE=os.devnull, PIP_DISABLE_PIP_VERSION_CHECK="1", PYTHONNOUSERSITE="1")
    return env


class WindowsJob:
    """Own every descendant before the gated launcher starts its command."""
    def __init__(self):
        import ctypes
        from ctypes import wintypes
        class Basic(ctypes.Structure):
            _fields_ = [("processTime", ctypes.c_longlong), ("jobTime", ctypes.c_longlong),
                        ("flags", wintypes.DWORD), ("minWorkingSet", ctypes.c_size_t),
                        ("maxWorkingSet", ctypes.c_size_t), ("activeProcesses", wintypes.DWORD),
                        ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ("readOps", "writeOps", "otherOps", "readBytes", "writeBytes", "otherBytes")]
        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", IO), ("processMemory", ctypes.c_size_t),
                        ("jobMemory", ctypes.c_size_t), ("peakProcess", ctypes.c_size_t), ("peakJob", ctypes.c_size_t)]
        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        self.api.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.api.CreateJobObjectW.restype = wintypes.HANDLE
        self.api.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.api.SetInformationJobObject.restype = wintypes.BOOL
        self.api.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.api.AssignProcessToJobObject.restype = wintypes.BOOL
        self.api.CloseHandle.argtypes = [wintypes.HANDLE]
        self.api.CloseHandle.restype = wintypes.BOOL
        self.handle = self.api.CreateJobObjectW(None, None)
        if not self.handle:
            raise Invalid("Cannot create owned subprocess job")
        limits = Extended()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
        if not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.close()
            raise Invalid("Cannot configure owned subprocess job")

    def attach(self, process):
        if not self.api.AssignProcessToJobObject(self.handle, int(process._handle)):
            raise Invalid("Cannot attach gated launcher to owned subprocess job")

    def close(self):
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None


def bounded_process(command, work, timeout=600, env=None, max_output_bytes=4 * 1024 * 1024):
    """Combined stdout/stderr cap and one deadline, including inherited pipes.

    This owns process lifetime, not OS network isolation. Windows commands start
    only after their stdin-gated launcher has joined the kill-on-close job.
    """
    if timeout <= 0 or type(max_output_bytes) is not int or max_output_bytes <= 0:
        raise Invalid("Invalid subprocess resource limit")
    deadline = time.monotonic() + timeout
    job, process = None, None
    buffers = [bytearray(), bytearray()]
    lock, overflow = threading.Lock(), threading.Event()
    readers = []
    failure = None
    try:
        actual_command = list(map(str, command))
        if os.name == "nt":
            job = WindowsJob()
            launcher = "import subprocess,sys; gate=sys.stdin.buffer.read(1); sys.exit(subprocess.call(sys.argv[1:],stdin=subprocess.DEVNULL) if gate==b'G' else 125)"
            actual_command = [sys.executable,"-X", "utf8",  "-X", "utf8", "-B", "-I", "-c", launcher, *actual_command]
        process = subprocess.Popen(actual_command, cwd=work, env=env or controlled_environment(work),
                                   stdin=subprocess.PIPE if job else subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=os.name != "nt")
        if job:
            job.attach(process)
            process.stdin.write(b"G")
            process.stdin.close()
        def drain(stream, index):
            try:
                while True:
                    chunk = stream.read1(65536)
                    if not chunk:
                        break
                    with lock:
                        remaining = max_output_bytes - sum(map(len, buffers))
                        buffers[index].extend(chunk[:remaining])
                        if len(chunk) > remaining:
                            overflow.set()
                            break
            finally:
                stream.close()
        for index, stream in enumerate((process.stdout, process.stderr)):
            reader = threading.Thread(target=drain, args=(stream, index), daemon=True)
            readers.append(reader)
            reader.start()
        while True:
            if overflow.is_set():
                failure = "Owned subprocess exceeded output byte limit"
                break
            if process.poll() is not None and not any(reader.is_alive() for reader in readers):
                break
            if time.monotonic() >= deadline:
                failure = "Owned subprocess exceeded total deadline"
                break
            overflow.wait(min(0.01, max(0, deadline - time.monotonic())))
    finally:
        if job:
            job.close()
        elif process is not None:
            import signal
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if process is not None:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)
        for reader in readers:
            reader.join(timeout=10)
        if any(reader.is_alive() for reader in readers):
            raise Invalid("Owned subprocess output cleanup failed")
    if failure:
        raise Invalid(failure)
    return subprocess.CompletedProcess(command, process.returncode,
                                       buffers[0].decode("utf-8", errors="replace"),
                                       buffers[1].decode("utf-8", errors="replace"))


def run(command, work, timeout=600):
    result = bounded_process(command, work, timeout)
    logged_command = list(map(str, command))
    if "-c" in logged_command:
        index = logged_command.index("-c") + 1
        logged_command[index] = "inline-code-sha256:" + digest(logged_command[index].encode())
    with (Path(work) / "subprocesses.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "command": logged_command,
                                 "exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr}, ensure_ascii=True) + "\n")
    if result.returncode:
        # Do not leak environment, URLs with credentials, home paths or arbitrary stderr.
        raise Invalid("Bounded preparation subprocess failed")
    return result.stdout


def native_target():
    system = {"Windows": "win32", "Darwin": "darwin"}.get(platform.system())
    arch = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(platform.machine().lower())
    if system is None or arch is None:
        raise Invalid("Unsupported native PBS host")
    if system == "darwin":
        require_supported_mac_version(platform.mac_ver()[0])
        import ctypes
        libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
        translated, size = ctypes.c_int(0), ctypes.c_size_t(ctypes.sizeof(ctypes.c_int))
        libc.sysctlbyname.argtypes = [ctypes.c_char_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_size_t]
        if libc.sysctlbyname(b"sysctl.proc_translated", ctypes.byref(translated), ctypes.byref(size), None, 0) == 0 and translated.value:
            raise Invalid("Rosetta is not native target execution")
    return f"{system}-{arch}"


def require_supported_mac_version(version):
    if not re.fullmatch(r"\d+\.\d+(?:\.\d+)?", version or ""):
        raise Invalid("Native macOS version is unavailable")
    if tuple(map(int, version.split(".")[:2])) < (12, 0):
        raise Invalid("Native Mac preparation requires macOS 12 or newer")


def fetch(value, destination, policy):
    """Only resolve invokes network; materialize never does. Inputs are pinned first."""
    official(value, policy)
    if policy.get("networkResolution") is not True:
        raise Pending("Network resolution is not authorized by the reviewed policy")
    destination = Path(destination)
    if destination.exists():
        return verified_asset(destination.parent, value)
    request = urllib.request.Request(value["url"], headers={"User-Agent": "RT-ResearchFlow-private-runtime-preparation/1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        final = urllib.parse.urlsplit(response.geturl())
        if final.scheme != "https" or final.hostname not in {"github.com", "codeload.github.com", "release-assets.githubusercontent.com", "nodejs.org", "files.pythonhosted.org"}:
            raise Invalid("Unapproved download redirect")
        data = response.read(value["size"] + 1)
    if len(data) != value["size"] or digest(data) != value["sha256"]:
        raise Invalid("Downloaded source differs from reviewed pin")
    exclusive_bytes(destination, data)
    return destination


def recipe_snapshot(assets, recipe, policy):
    if recipe not in policy.get("recipePins", []) or recipe["path"] not in RECIPES:
        raise Invalid("Recipe not approved in policy")
    source = ROOT / relative(recipe["path"])
    if source.is_symlink() or file_digest(source) != recipe["sha256"]:
        raise Invalid("Current reviewed recipe bytes differ from policy")
    snapshot = Path(assets) / "recipes" / recipe["path"]
    exclusive_bytes(snapshot, source.read_bytes())
    if file_digest(snapshot) != recipe["sha256"]:
        raise Invalid("Recipe snapshot mismatch")
    return snapshot


def reproduce(wheel, assets, work, policy):
    """Execute the actual approved recipe, with exactly ONE upstream per wheel."""
    wheel_contract(wheel, policy)
    if wheel["asset"]["kind"] != "derived":
        raise Invalid("Reproduction requires a derived wheel")
    provenance = wheel["derived"]
    source = verified_asset(assets, provenance["upstreamAsset"])
    snapshot = recipe_snapshot(assets, provenance["recipe"], policy)
    if (wheel.get("nativeBuildInputs") or {}).get("kind") == "rt-lxml-redistribution-inputs-v1":
        return redistribution_receipt(wheel, assets, work, policy, execute=True)
    if wheel.get("nativeBuildInputs") is not None:
        return retained_native_receipt(wheel, assets, policy)
    name = "rt_reviewed_recipe_" + provenance["recipe"]["sha256"]
    spec = importlib.util.spec_from_file_location(name, snapshot)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    previous = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
        if provenance["recipe"]["path"] == "scripts/build-provider-source-wheels.py":
            specs = [item for item in module.SOURCES if item.filename == provenance["upstreamAsset"]["filename"]]
            if len(specs) != 1 or specs[0].name != wheel["distribution"] or specs[0].version != wheel["version"]:
                raise Invalid("Source recipe identity does not match derived wheel")
            blob, files = module.read_source(Path(assets), specs[0])
            normalized_recipe_sha = digest(snapshot.read_bytes().replace(b"\r\n", b"\n"))
            data, _ = module.wheel_bytes(specs[0], blob, files, normalized_recipe_sha)
        elif provenance["recipe"]["path"] == "scripts/build-private-node-js-runtime-wheel.py":
            if wheel["distribution"] != "rt-private-node-js-runtime" or wheel["version"] != "1.0.0":
                raise Invalid("Private Node backend derived identity mismatch")
            expected = policy["privateNodeBackendSource"]
            if provenance["upstreamAsset"] != expected["asset"]:
                raise Invalid("Private Node source archive differs from the reviewed source pin")
            extracted = Path(work) / ("node-source-" + provenance["upstreamSha256"])
            members = {entry["path"] for entry in expected["files"]}
            safe_extract(source, extracted, expected["archivePrefix"], members)
            for entry in expected["files"]:
                path = extracted / relative(entry["path"])
                actual_source = ROOT / relative(entry["path"])
                if (path.is_symlink() or not path.is_file() or path.stat().st_size != entry["size"]
                        or file_digest(path) != entry["sha256"] or actual_source.is_symlink()
                        or not actual_source.is_file() or file_digest(actual_source) != entry["sha256"]):
                    raise Invalid("Archived backend source differs from actual consumed repository bytes")
            # The unchanged recipe reads its adjacent repository LICENSE.
            exclusive_bytes(snapshot.parent.parent / "LICENSE", (extracted / "LICENSE").read_bytes())
            output = Path(work) / ("private-node-js-runtime-" + provenance["upstreamSha256"])
            result = module.build(extracted / "scripts/private-node-js-runtime", output, expected["sourceBindingSha256"])
            if result["recipeSha256"] != provenance["recipe"]["sha256"]:
                raise Invalid("Private Node recipe receipt differs from executed recipe")
            data = (output / result["wheel"]["filename"]).read_bytes()
        else:
            expected_name = {"scripts/build-mootdx-compat-wheel.py": "mootdx",
                             "scripts/build-akshare-node-wheel.py": "akshare"}.get(provenance["recipe"]["path"])
            if wheel["distribution"] != expected_name or wheel["version"] != module.DERIVED_VERSION:
                raise Invalid("Provider derived identity mismatch")
            output = Path(work) / ("derived-" + provenance["id"])
            relative(output.name)
            if output.exists():
                raise Invalid("Derived scratch output must be fresh")
            result = module.build(source, output)
            data = Path(result["path"]).read_bytes()
    finally:
        sys.dont_write_bytecode = previous
        sys.modules.pop(name, None)
    if len(data) != wheel["asset"]["size"] or digest(data) != wheel["asset"]["sha256"]:
        raise Invalid("Recipe reproduction does not match expected wheel")
    exclusive_bytes(Path(assets) / wheel["asset"]["filename"], data)
    return {"kind": "rt-private-wheel-reproduction", "upstreamSha256": provenance["upstreamAsset"]["sha256"],
            "recipeSha256": provenance["recipe"]["sha256"], "wheelSha256": digest(data),
            "wheelSize": len(data), "executed": True, "extraUpstreamInputs": []}


def read_wheel(path):
    files = {}
    with zipfile.ZipFile(path) as archive:
        total = 0
        for item in archive.infolist():
            name = relative(item.filename.rstrip("/") if item.is_dir() else item.filename)
            if item.is_dir():
                continue
            if stat.S_ISLNK(item.external_attr >> 16) or name.casefold() in {key.casefold() for key in files}:
                raise Invalid("Unsafe/duplicate wheel member")
            total += item.file_size
            if total > MAX_EXPANSION:
                raise Invalid("Wheel expanded size exceeds budget")
            files[name] = archive.read(item)
    metadata_names = [name for name in files if name.count("/") == 1 and name.endswith(".dist-info/METADATA")]
    if len(metadata_names) != 1:
        raise Invalid("Wheel must have one original METADATA")
    info = metadata_names[0].rsplit("/", 1)[0]
    record = info + "/RECORD"
    if record not in files:
        raise Invalid("Wheel lacks RECORD")
    seen = set()
    for row in csv.reader(io.StringIO(files[record].decode("utf-8"))):
        if len(row) != 3 or row[0] in seen or row[0] not in files:
            raise Invalid("Invalid wheel RECORD")
        name, checksum, size = row
        seen.add(name)
        if name == record:
            if checksum or size:
                raise Invalid("RECORD cannot hash itself")
        else:
            expected = base64.urlsafe_b64encode(hashlib.sha256(files[name]).digest()).rstrip(b"=").decode("ascii")
            if checksum != "sha256=" + expected or size != str(len(files[name])):
                raise Invalid("Wheel RECORD payload mismatch")
    if seen != set(files):
        raise Invalid("Wheel RECORD is incomplete")
    metadata = BytesParser().parsebytes(files[metadata_names[0]])
    wheel_metadata = BytesParser().parsebytes(files[info + "/WHEEL"])
    notices = {name: digest(data) for name, data in files.items()
               if name.startswith(info + "/licenses/")
               or re.search(r"(?:^|/)(?:LICENSE|LICENCE|COPYING|NOTICE|AUTHORS)(?:[./_-]|$)", name, re.I)
               or name.rsplit("/", 1)[-1].casefold() == "thirdpartynotices.txt"}
    # AUTHORS is attribution evidence, not a license grant. Approval still
    # requires the exact component/version/artifact/member digest review key.
    # Preserve the entire original description too (including noncommercial notices).
    notices[metadata_names[0]] = digest(files[metadata_names[0]])
    for declared in metadata.get_all("License-File", []):
        declared = relative(declared)
        matches = [name for name in (info + "/" + declared, info + "/licenses/" + declared) if name in files]
        if not matches:
            raise Invalid("Declared License-File is absent from wheel")
        for name in matches:
            notices[name] = digest(files[name])
    return {"distribution": metadata["Name"], "version": metadata["Version"],
            "dependencies": metadata.get_all("Requires-Dist", []), "tags": wheel_metadata.get_all("Tag", []),
            "requiresPython": metadata.get("Requires-Python"), "metadataSha256": digest(files[metadata_names[0]]),
            "notices": notices}


def license_decision(policy, component, version, artifact_sha, license_sha, spdx):
    matches = [record for record in policy["licenseApprovals"]
               if (record["component"], record["version"], record["artifactSha256"], record["licenseSha256"], record["spdx"])
               == (component, version, artifact_sha, license_sha, spdx)]
    if len(matches) != 1 or matches[0]["decision"] != "approved":
        return None
    record = matches[0]
    if not all(text(record.get(key)) for key in ("reviewedBy", "reviewReference")):
        return None
    return record["id"]


def metadata_role(policy, component, version, artifact_sha, path, sha):
    """Only an individually reviewed METADATA path/asset/digest has this role."""
    matches = [record for record in policy["metadataProvenance"]
               if (record["component"], record["version"], record["artifactSha256"],
                   record["path"], record["metadataSha256"]) ==
               (component, version, artifact_sha, path, sha)]
    return matches[0] if len(matches) == 1 else None


def link_plan(entries, expected_prefix, selected=None, allow_links=False):
    """Validate the whole archive before writing, including excluded entries."""
    planned, seen, total = {}, set(), 0
    for name, kind, size, mode, item, link in entries:
        name = relative(name.rstrip("/"))
        if name == expected_prefix:
            if kind != "directory":
                raise Invalid("Archive root must be a directory")
            continue
        if not name.startswith(expected_prefix + "/"):
            raise Invalid("Unexpected archive prefix")
        name = name[len(expected_prefix) + 1:]
        if name.casefold() in seen:
            raise Invalid("Archive member collision")
        seen.add(name.casefold())
        total += size
        if total > MAX_EXPANSION or len(seen) > 200000:
            raise Invalid("Archive expansion budget exceeded")
        if kind == "symlink":
            if not allow_links:
                raise Pending("Archive symlink layout requires explicit controlled-link extraction")
            if not text(link) or "\\" in link or link.startswith("/") or ":" in link or any(ord(c) < 32 for c in link):
                raise Invalid("Unsafe archive link target")
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), link))
            relative(resolved)
        else:
            resolved = None
        planned[name] = (kind, size, mode, item, link, resolved)
    for name in planned:
        parent = posixpath.dirname(name)
        while parent:
            if parent in planned and planned[parent][0] != "directory":
                raise Invalid("Archive writes below a non-directory/link")
            parent = posixpath.dirname(parent)
    retained = {name for name in planned if selected is None or (selected(name) if callable(selected) else name in selected)}
    for name, entry in planned.items():
        if entry[0] != "symlink":
            continue
        current, visited = name, set()
        while planned[current][0] == "symlink":
            if current in visited:
                raise Invalid("Archive link cycle")
            visited.add(current)
            current = planned[current][5]
            if current not in planned:
                raise Invalid("Archive link target is missing")
        if name in retained and not visited | {current} <= retained:
            raise Invalid("Archive link target excluded by selection")
    return {name: planned[name] for name in sorted(retained)}


def safe_extract(archive_path, destination, expected_prefix, selected=None, allow_links=False):
    """No extractall; regular files first, validated internal links last."""
    destination = Path(destination)
    if destination.exists():
        raise Invalid("Extraction target must be fresh")
    entries = []
    if str(archive_path).endswith(".zip"):
        archive = zipfile.ZipFile(archive_path)
        for item in archive.infolist():
            mode = item.external_attr >> 16
            kind = "symlink" if stat.S_ISLNK(mode) else "directory" if item.is_dir() else "file"
            entries.append((item.filename, kind, item.file_size, mode, item,
                            archive.read(item).decode("utf-8") if kind == "symlink" else None))
        reader = archive.open
    elif str(archive_path).endswith((".tar.gz", ".tgz")):
        archive = tarfile.open(archive_path, "r:gz")
        for item in archive:
            if not (item.isfile() or item.isdir() or item.issym()) or item.issparse():
                archive.close()
                raise Invalid("Unsafe archive member")
            kind = "symlink" if item.issym() else "directory" if item.isdir() else "file"
            entries.append((item.name, kind, item.size, item.mode, item, item.linkname if item.issym() else None))
        reader = archive.extractfile
    else:
        raise Pending("Archive codec requires a separately pinned toolchain")
    try:
        planned = link_plan(entries, expected_prefix, selected, allow_links)
        destination.mkdir()
        for name, (kind, size, mode, item, link, resolved) in sorted(planned.items(), key=lambda entry: (entry[1][0] != "directory", entry[0])):
            target = destination / name
            if kind == "symlink":
                continue
            if kind == "directory":
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.parent.resolve() != target.parent.absolute():
                raise Invalid("Archive member escapes extraction root")
            with reader(item) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output, 1024 * 1024)
            if target.stat().st_size != size:
                raise Invalid("Truncated archive member")
            target.chmod(0o755 if mode & 0o111 else 0o644)
        for name, entry in planned.items():
            if entry[0] == "symlink":
                target = destination / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(entry[4])
        inventory(destination)  # Resolve chains and prove every created link stays internal.
    finally:
        archive.close()


def inventory(root):
    root = Path(root).resolve()
    result = []
    for base, directories, files in os.walk(root, followlinks=False):
        for name in sorted(directories + files):
            path = Path(base) / name
            relative_name = path.relative_to(root).as_posix()
            if path.is_symlink():
                target = path.resolve()
                if root not in target.parents or not target.exists():
                    raise Invalid("Tree link escapes or is broken")
                result.append({"path": relative_name, "kind": "symlink", "target": os.readlink(path)})
            elif path.is_file():
                result.append({"path": relative_name, "kind": "file", "size": path.stat().st_size, "sha256": file_digest(path)})
    return sorted(result, key=lambda entry: entry["path"])


def pip_command(python, assets, site, requirements, offline):
    result = [str(python), "-X", "utf8", "-B", "-I", "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
              "--ignore-installed", "--no-compile", "--only-binary=:all:", "--target", str(site),
              "--find-links", str(assets)]
    if offline:
        result += ["--no-index", "--require-hashes", "-r", str(requirements)]
    else:
        result += ["--index-url", "https://pypi.org/simple", "--dry-run", "--report", str(requirements)]
    return result


def pending_inputs(policy, target):
    pending = []
    if target not in TARGETS or target not in policy.get("targets", {}):
        raise Invalid("Unsupported native target")
    config = policy["targets"][target]
    for component in ("python", "node"):
        official(config[component]["asset"], policy)
    derived_wheels(policy, target)
    identities = {(wheel.get("distribution"), wheel.get("version")) for wheel in policy.get("derivedWheels", [])}
    if identities != {("jsonpath", "0.82.2"), ("PyExecJS", "1.5.1"), ("mootdx", "0.11.7+rt.node.1"),
                      ("akshare", "1.19.1+rt.node.1"), ("rt-private-node-js-runtime", "1.0.0")}:
        pending.append("Exactly five reviewed derived wheels and complete source pins are required")
    if target not in (policy.get("toolchain") or {}):
        pending.append("Exact PBS pip/toolchain inputs are not locked")
    elif target.startswith("darwin"):
        official(policy["toolchain"][target]["licenseDecoder"]["asset"], policy)
        if not config["python"].get("licenseSources"):
            raise Invalid("Mac full license sources must be explicitly pinned")
    return sorted(set(pending))


def candidate_base(kind, policy_sha, target=None):
    result = {"schemaVersion": 1, "kind": kind, "status": "pending", "releaseEligible": False,
              "preparationPolicySha256": policy_sha, "pending": []}
    if target:
        result["target"] = target
    return result


def operation_location(value, directory=False):
    if not text(value) or not Path(value).is_absolute():
        raise Invalid("Operation paths must be explicit absolute locations")
    path = owned_path(value)
    if path.is_symlink() or (not path.is_dir() if directory else not path.is_file()):
        raise Invalid("Operation input location is missing or linked")
    return path


def load_operations(path, policy_sha, target, work_root):
    default = {"schemaVersion": 1, "kind": "rt-private-runtime-operation-input-v1", "cacheRoots": [], "seedReports": {}, "sourceReceipt": None}
    if path is None:
        raw, value = encoded(default), default
    else:
        source = operation_location(str(path))
        if source.stat().st_size > 131072:
            raise Invalid("Operation input exceeds size budget")
        raw = source.read_bytes()
        value = json.loads(raw)
    optional = {"reviewedMaterialsRoot", "reviewedMaterialsArchive"}
    if (not isinstance(value, dict) or set(value) - optional != set(default) or value["schemaVersion"] != 1 or value["kind"] != default["kind"]
            or not isinstance(value["cacheRoots"], list) or not isinstance(value["seedReports"], dict)
            or set(value["seedReports"]) - set(PROVIDERS)):
        raise Invalid("Unknown operation input; authorization overrides are forbidden")
    caches = [str(operation_location(item, True)) for item in value["cacheRoots"]]
    if len(caches) != len(set(caches)):
        raise Invalid("Duplicate operation cache root")
    seeds = {name: str(operation_location(item)) for name, item in value["seedReports"].items()}
    receipt = str(operation_location(value["sourceReceipt"])) if value["sourceReceipt"] is not None else None
    material_root = str(operation_location(value["reviewedMaterialsRoot"], True)) if value.get("reviewedMaterialsRoot") is not None else None
    material_archive = str(operation_location(value["reviewedMaterialsArchive"])) if value.get("reviewedMaterialsArchive") is not None else None
    work = owned_path(work_root)
    if material_root is not None and (Path(material_root).is_relative_to(work) or work.is_relative_to(Path(material_root))):
        raise Invalid("Reviewed materials and fresh output must not overlap")
    if material_archive is not None and Path(material_archive).is_relative_to(work):
        raise Invalid("Reviewed material ZIP cannot live in mutable fresh output")
    if any(Path(root).is_relative_to(work) or work.is_relative_to(Path(root)) for root in caches):
        raise Invalid("Fresh output and readonly cache roots must not overlap")
    return {"schemaVersion": 1, "kind": "rt-private-runtime-operation-receipt-v1", "operationId": work.name,
            "target": target, "platform": sys.platform, "machine": platform.machine(), "pythonABI": sysconfig.get_config_var("SOABI"),
            "policySha256": policy_sha, "inputSha256": digest(raw), "cacheRoots": caches, "seedReports": seeds,
            "sourceReceipt": receipt, "reviewedMaterialsRoot": material_root, "reviewedMaterialsArchive": material_archive, "workRoot": str(work), "tempRoot": str(work / "temp"), "outputRoot": str(work),
            "startedAt": datetime.now(timezone.utc).isoformat()}


def source_receipt(path, snapshot):
    if path is None:
        return {"sourceCommit": None, "sourceVerified": False, "checkoutClean": None, "receiptSha256": None,
                "scope": "actual local consumed bytes only; checkout commit/dirty state not verified"}
    source = operation_location(str(path))
    if source.stat().st_size > 131072:
        raise Invalid("Source receipt exceeds size budget")
    raw = source.read_bytes()
    value = json.loads(raw)
    fields = {"schemaVersion", "kind", "repository", "sourceCommit", "sourceTree", "checkoutClean", "policySha256", "sourceFiles", "producer"}
    if (not isinstance(value, dict) or set(value) != fields or value["schemaVersion"] != 1
            or value["kind"] != "rt-private-runtime-source-receipt-v1"
            or not re.fullmatch(r"github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", str(value["repository"]))
            or not re.fullmatch(r"[a-f0-9]{40}", str(value["sourceCommit"]))
            or not re.fullmatch(r"[a-f0-9]{40}", str(value["sourceTree"]))
            or type(value["checkoutClean"]) is not bool or value["policySha256"] != snapshot["policySha256"]
            or not isinstance(value["sourceFiles"], list)):
        raise Invalid("Invalid external checkout source receipt")
    expected = sorted(snapshot["files"], key=lambda item: item["path"])
    if value["sourceFiles"] != expected:
        raise Invalid("Checkout receipt file set/raw bytes differ from actual consumed source")
    producer = value["producer"]
    if not isinstance(producer, dict) or producer.get("kind") not in {"local-checkout", "github-actions"}:
        raise Invalid("Unknown checkout receipt producer")
    context_matched = False
    if os.environ.get("GITHUB_ACTIONS") == "true" and producer["kind"] != "github-actions":
        raise Invalid("CI cannot substitute a local checkout producer")
    if producer["kind"] == "github-actions":
        required = {"kind", "workflowRef", "runId", "runAttempt", "job", "checkoutEventSha"}
        if set(producer) != required or os.environ.get("GITHUB_ACTIONS") != "true":
            raise Invalid("CI checkout receipt requires matching CI context")
        bindings = {"workflowRef": "GITHUB_WORKFLOW_REF", "runId": "GITHUB_RUN_ID", "runAttempt": "GITHUB_RUN_ATTEMPT", "job": "GITHUB_JOB", "checkoutEventSha": "GITHUB_SHA"}
        if (any(not text(producer[key]) or producer[key] != os.environ.get(env) for key, env in bindings.items())
                or value["sourceCommit"] != os.environ.get("GITHUB_SHA")
                or value["repository"] != "github.com/" + os.environ.get("GITHUB_REPOSITORY", "")):
            raise Invalid("Checkout receipt commit/producer differs from CI context")
        context_matched = True
    elif set(producer) != {"kind"}:
        raise Invalid("Unknown local checkout producer fields")
    return {"sourceCommit": value["sourceCommit"], "sourceTree": value["sourceTree"], "checkoutClean": value["checkoutClean"],
            "receiptSha256": digest(raw), "receipt": value, "ciContextMatched": context_matched, "sourceVerified": False,
            "scope": "source bytes/context matched; commit membership requires immutable producer/checkout verification before seal"}


def finish_operation(operations, work, toolchain, source, seeds):
    receipt = {**operations, "sourceReceiptSha256": source["receiptSha256"], "toolchain": toolchain, "consumedSeeds": seeds,
               "completedAt": datetime.now(timezone.utc).isoformat(), "status": "candidate-operation-completed"}
    exclusive_bytes(work / "operation-private.json", encoded(receipt))
    public = {key: item for key, item in receipt.items() if key not in {"cacheRoots", "seedReports", "sourceReceipt", "workRoot", "tempRoot", "outputRoot"}}
    public.update(kind="rt-private-runtime-operation-public-receipt-v1", cacheRoots=["READONLY_CACHE_" + str(i) for i in range(len(receipt["cacheRoots"]))],
                  seedReports={key: "SEED_REPORT_" + key for key in receipt["seedReports"]}, sourceReceipt="SOURCE_RECEIPT" if receipt["sourceReceipt"] else None,
                  workRoot="WORK_ROOT", tempRoot="WORK_ROOT/temp", outputRoot="WORK_ROOT", privateReceiptSha256=file_digest(work / "operation-private.json"))
    exclusive_bytes(work / "operation-public.json", encoded(public))
    return {"private": {"path": str(work / "operation-private.json"), "sha256": file_digest(work / "operation-private.json")},
            "public": {"path": str(work / "operation-public.json"), "sha256": file_digest(work / "operation-public.json")}}


def bound_source_copy(candidate, source_name, destination):
    source_name = relative(source_name)
    source = ROOT / source_name
    expected = next(item["sha256"] for item in candidate["sourceSnapshot"]["files"] if item["path"] == source_name)
    raw = source.read_bytes()
    if source.is_symlink() or not source.resolve().is_relative_to(ROOT.resolve()) or digest(raw) != expected:
        raise Invalid("Consumed source changed during preparation")
    exclusive_bytes(destination, raw)


def provider_failure_diagnostic(work, target, provider, stage, error):
    """Leave a bounded failure marker without serializing exception data or paths."""
    source = {"file": "scripts/prepare-private-python-runtime.py", "function": "resolve", "line": 0}
    frame = error.__traceback__
    while frame is not None:
        code = frame.tb_frame.f_code
        if Path(code.co_filename).resolve() == Path(__file__).resolve():
            source = {"file": source["file"], "function": code.co_name, "line": frame.tb_lineno}
        frame = frame.tb_next
    if isinstance(error, Invalid):
        error_type = "Invalid"
    elif isinstance(error, Pending):
        error_type = "Pending"
    elif isinstance(error, subprocess.SubprocessError):
        error_type = "SubprocessError"
    elif isinstance(error, OSError):
        error_type = "OSError"
    elif isinstance(error, ValueError):
        error_type = "ValueError"
    elif isinstance(error, KeyError):
        error_type = "KeyError"
    elif isinstance(error, TypeError):
        error_type = "TypeError"
    else:
        error_type = "UnexpectedError"
    report = {"schemaVersion": 1, "kind": "rt-private-runtime-failure-diagnostic-v1", "status": "failed",
              "phase": "resolve", "target": target, "provider": provider, "stage": stage,
              "errorType": error_type, "source": source}
    try:
        exclusive_bytes(work / "failure-diagnostic.json", encoded(report))
    except (Invalid, OSError):
        # A full disk or conflicting evidence must not replace the original failure.
        pass


def resolve(policy, policy_sha, target, work_root, operation_input=None):
    result = candidate_base("rt-private-python-candidate-lock", policy_sha, target)
    result["pending"] = pending_inputs(policy, target)
    if result["pending"]:
        return result
    operations = load_operations(operation_input, policy_sha, target, work_root)
    if native_target() != target:
        raise Invalid("Resolution must run on the matching native PBS target")
    if policy.get("networkResolution") is not True:
        raise Pending("Reviewed policy has not enabled network resolution")
    work = fresh_work(work_root, policy)
    assets = work / "assets"
    config = policy["targets"][target]
    snapshot = source_snapshot(policy_sha)
    for component in ("python", "node"):
        acquire(config[component]["asset"], assets, policy, operations)
        for value in config[component].get("licenseSources", []):
            acquire(value, assets, policy, operations)
    supplements = reviewed_license_supplements(policy)
    for name in ("tix", "libzmq"):
        acquire(supplements[name]["asset"], assets, policy, operations)
    if target == "win32-x64":
        for item in policy["lxmlWindowsSourceMaterials"]:
            acquire({key: value for key, value in item.items() if key != "id"}, assets, policy, operations)
    selected = derived_wheels(policy, target)
    for wheel in selected:
        acquire(wheel["derived"]["upstreamAsset"], assets, policy, operations)
        if wheel.get("nativeBuildInputs") is not None:
            for value in [wheel["asset"]] + native_build_assets(wheel, target):
                acquire(value, assets, policy, operations)
    acquire(policy["toolchain"][target]["licenseDecoder"]["asset"], assets, policy, operations)
    tools, tool_receipt = native_tools(config, policy, target, assets, work)
    receipts = [reproduce(wheel, assets, work, policy) for wheel in selected]
    providers, resolver_evidence = {}, {}
    sites = work / "resolver-sites"
    sites.mkdir()
    for provider in PROVIDERS:
        stage = "create-provider-site"
        try:
            site = sites / provider
            site.mkdir()
            stage = "build-constraints"
            constraints, seed = resolution_constraints(policy, provider, assets, work, target, operations)
            report_path = work / (provider + "-normal-resolver.json")
            command = pip_command(tools, assets, site, report_path, False)
            command += ["--constraint", str(constraints), provider + "==" + policy["providerVersions"][provider]]
            if target.startswith("darwin"):
                command += ["--platform", "macosx_12_0_" + ("arm64" if target.endswith("arm64") else "x86_64"),
                            "--python-version", "3.13", "--implementation", "cp", "--abi", "cp313"]
            stage = "normal-pip-resolve"
            run(command, work)
            stage = "parse-resolver-report"
            pip_report = json.loads(report_path.read_bytes())
            if pip_report.get("environment", {}).get("python_full_version") != "3.13.16":
                raise Invalid("Resolver report did not come from native PBS 3.13.16")
            stage = "freeze-resolved-wheels"
            wheels = [freeze_report_item(item, assets, policy, operations, target) for item in pip_report["install"]]
            validate_resolver_pins(policy, target, provider, wheels)
            stage = "validate-closure"
            closure = validate_closure(tools, wheels, [provider + "==" + policy["providerVersions"][provider]], work)
            stage = "validate-native-wheel"
            native_wheels = wheel_native_evidence(wheels, assets, target)
            stage = "commit-provider-evidence"
            providers[provider] = {"version": policy["providerVersions"][provider], "site": "providers/" + provider + "/site",
                                   "wheels": sorted(wheels, key=lambda wheel: wheel["distribution"].lower()),
                                   "closure": closure}
            resolver_evidence[provider] = {"reportSha256": file_digest(report_path), "seed": seed,
                                           "normalResolverExecuted": True, "wheelCount": len(wheels), "nativeWheels": native_wheels}
            print("resolved " + provider + ": " + str(len(wheels)) + " actual wheels", flush=True)
        except Exception as error:
            provider_failure_diagnostic(work, target, provider, stage, error)
            raise
    source_evidence = source_receipt(operations.get("sourceReceipt"), snapshot)
    operation_receipts = finish_operation(operations, work, tool_receipt, source_evidence, {name: value["seed"] for name, value in resolver_evidence.items()})
    result.update(status="candidate", resolutionComplete=True, sourceCommit=source_evidence.get("sourceCommit"),
                  sourceEvidence=source_evidence, operationEvidence=operations,
                  operationInputSha256=operations["inputSha256"],
                  operationReceipts=operation_receipts,
                  sourceSnapshot=snapshot, sourceSha256=digest(encoded(snapshot)), python=config["python"], node=config["node"],
                   providers=providers, licenseSupplements=supplements,
                   lxmlWindowsSourceMaterials=policy["lxmlWindowsSourceMaterials"] if target == "win32-x64" else [],
                   assetsRoot=str(assets),
                   toolchain=tool_receipt, reproductions=receipts,
                  resolverEvidence=resolver_evidence, pending=candidate_pending(policy, source_evidence))
    return result


def verify_candidate(candidate, policy, policy_sha, assets, operations=None):
    if (candidate.get("kind") != "rt-private-python-candidate-lock" or candidate.get("schemaVersion") != 1
            or candidate.get("status") != "candidate" or candidate.get("releaseEligible") is not False
            or candidate.get("preparationPolicySha256") != policy_sha or candidate.get("resolutionComplete") is not True):
        raise Pending("Materialization requires a completed candidate lock bound to this policy")
    target = candidate.get("target")
    if target not in TARGETS or (policy.get("sourceCommit") is not None and candidate.get("sourceCommit") != policy["sourceCommit"]):
        raise Invalid("Candidate target/source commit missing")
    snapshot = source_snapshot(policy_sha)
    if candidate.get("sourceSnapshot") != snapshot or candidate.get("sourceSha256") != digest(encoded(snapshot)):
        raise Invalid("Candidate source snapshot changed; resolve again")
    if "sourceEvidence" in candidate:
        current_source = source_receipt((operations or {}).get("sourceReceipt"), snapshot)
        if candidate["sourceEvidence"] != current_source or candidate.get("sourceCommit") != current_source.get("sourceCommit"):
            raise Invalid("Candidate checkout receipt/source commit differs")
    elif candidate.get("sourceCommit") is not None:
        raise Invalid("Source commit lacks external checkout evidence")
    if set(candidate.get("providers", {})) != set(PROVIDERS):
        raise Invalid("Candidate must contain three independent provider closures")
    if candidate.get("licenseSupplements") != policy.get("licenseSupplements"):
        raise Invalid("Candidate license supplements differ from reviewed policy")
    if candidate.get("lxmlWindowsSourceMaterials") != (policy["lxmlWindowsSourceMaterials"] if target == "win32-x64" else []):
        raise Invalid("Candidate Windows lxml source materials differ from reviewed policy")
    values = []
    for component in ("python", "node"):
        value = candidate[component]["asset"]
        official(value, policy)
        if candidate[component] != policy["targets"][target][component]:
            raise Invalid("Native version/assets/license sources differ from policy")
        values += [value] + candidate[component].get("licenseSources", [])
        for source in candidate[component].get("licenseSources", []):
            official(source, policy)
    for name in ("tix", "libzmq"):
        value = candidate["licenseSupplements"][name]["asset"]
        official(value, policy)
        values.append(value)
    for item in candidate["lxmlWindowsSourceMaterials"]:
        value = {key: content for key, content in item.items() if key != "id"}
        official(value, policy)
        values.append(value)
    for name, provider in candidate["providers"].items():
        if (provider["site"] != "providers/" + name + "/site" or not provider.get("wheels")
                or provider.get("version") != policy["providerVersions"][name]):
            raise Invalid("Provider site must be separate and explicitly populated")
        seen = set()
        root_found = False
        for wheel in provider["wheels"]:
            wheel_contract(wheel, policy)
            actual = read_wheel(verified_asset(assets, wheel["asset"]))
            if any(wheel.get(key) != fact for key, fact in actual.items()):
                raise Invalid("Every original wheel metadata/notice fact must match candidate")
            normalized = re.sub(r"[-_.]+", "-", wheel["distribution"]).lower()
            if normalized == name:
                if wheel["version"] != policy["providerVersions"][name]:
                    raise Invalid("Provider root wheel version differs from policy")
                root_found = True
            if normalized in seen:
                raise Invalid("Duplicate provider distribution")
            seen.add(normalized)
            if wheel["asset"]["kind"] == "derived":
                approved = next((item for item in derived_wheels(policy, target) if item["asset"] == wheel["asset"]), None)
                if approved is None or any(wheel.get(key) != approved.get(key) for key in ("distribution", "version", "asset", "derived", "dependencies", "nativeBuildInputs")):
                    raise Invalid("Derived wheel differs from approved policy entry")
                values.append(wheel["derived"]["upstreamAsset"])
                values += native_build_assets(wheel, target)
                if wheel.get("nativeBuildInputs") is not None:
                    retained_native_receipt(wheel, assets, policy)
            values.append(wheel["asset"])
        validate_resolver_pins(policy, target, name, provider["wheels"])
        if not root_found:
            raise Invalid("Provider root wheel is absent")
    names = {}
    for value in values:
        asset(value)
        if value["filename"] in names and value != names[value["filename"]]:
            raise Invalid("Conflicting asset filenames")
        names[value["filename"]] = value
        verified_asset(assets, value)
    return candidate


def preflight_closures(candidate, tools, work):
    """ALL raw-wheel closures must pass before ANY provider pip install."""
    return {name: validate_closure(tools, candidate["providers"][name]["wheels"],
                                  [name + "==" + candidate["providers"][name]["version"]], work)
            for name in PROVIDERS}



def retain_reviewed_materials(policy, operations, tree, candidate):
    """Pinned public source/notices only; never import or publish raw input archives."""
    contract = policy.get("reviewedLicenseMaterials")
    if not isinstance(contract, dict):
        raise Invalid("Reviewed material input is not pinned")
    root_value = operations.get("reviewedMaterialsRoot")
    archive_value = operations.get("reviewedMaterialsArchive")
    if root_value is None or archive_value is None:
        raise Invalid("Pinned reviewed material ZIP and readonly extracted root are required")
    materials_root = operation_location(root_value, True)
    archive_path = operation_location(archive_value)
    pin = contract["artifact"]
    if archive_path.stat().st_size != pin["size"] or file_digest(archive_path) != pin["zipSha256"]:
        raise Invalid("Reviewed public material artifact ZIP differs from exact pin")
    helper_path = ROOT / relative(contract["helper"]["path"])
    manifest_path = ROOT / relative(contract["manifest"]["path"])
    if (helper_path.is_symlink() or file_digest(helper_path) != contract["helper"]["sha256"]
            or manifest_path.is_symlink() or file_digest(manifest_path) != contract["manifest"]["sha256"]):
        raise Invalid("Reviewed material source bytes changed")
    spec = importlib.util.spec_from_file_location("rt_reviewed_license_materials", helper_path)
    module = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
        description = module.manifest()
        members = {"materials/" + entry["id"]: entry for entry in description["materials"]}
        if len(members) != 44:
            raise Invalid("Exact reviewed material count differs")
        seen = set()
        with zipfile.ZipFile(archive_path) as archive:
            for item in archive.infolist():
                name = relative(item.filename)
                if item.is_dir() or stat.S_ISLNK(item.external_attr >> 16) or name in seen:
                    raise Invalid("Unexpected or duplicate material artifact member")
                seen.add(name)
                entry = members.get(name)
                if entry is None:
                    if name != "material-receipt.json" or item.file_size > 131072:
                        raise Invalid("Unregistered material artifact member")
                    archived_receipt = archive.read(item)
                    if archived_receipt != (materials_root / name).read_bytes():
                        raise Invalid("Material collection receipt changed after download")
                    receipt = json.loads(archived_receipt)
                    if (receipt.get("kind") != "astra-reviewed-public-material-collection-v1"
                            or receipt.get("manifestSha256") != contract["manifest"]["sha256"]
                            or receipt.get("rawBinaryInputArchivesIncluded") is not False
                            or receipt.get("sourcesExecuted") is not False
                            or receipt.get("releaseEligible") is not False):
                        raise Invalid("Unexpected material collection receipt")
                else:
                    if item.file_size != entry["size"] or digest(archive.read(item)) != entry["sha256"]:
                        raise Invalid("Material ZIP member differs from approved digest")
                    module.checked_material(materials_root, entry)
        if seen != set(members) | {"material-receipt.json"}:
            raise Invalid("Material artifact is incomplete")
        selected = {wheel["asset"]["sha256"] for provider in candidate["providers"].values()
                    for wheel in provider["wheels"]}
        retained = module.retain_materials(materials_root, tree, candidate["target"], selected)
    finally:
        sys.dont_write_bytecode = previous
    return {**retained, "artifact": pin, "artifactZipSha256Verified": True,
            "collectionReceiptSha256": digest(archived_receipt),
            "rawInputAssetsIncluded": False, "formalApprovalAutomaticallyApplied": False}


def materialize(policy, policy_sha, candidate_path, assets, work_root, operation_input=None):
    raw = Path(candidate_path).read_bytes()
    candidate = json.loads(raw)
    result = candidate_base("rt-private-python-candidate-fragment", policy_sha, candidate.get("target"))
    result.update(sourceCommit=candidate.get("sourceCommit"), inputLockSha256=digest(raw))
    if candidate.get("status") == "pending":
        if candidate.get("kind") != "rt-private-python-candidate-lock" or candidate.get("preparationPolicySha256") != policy_sha:
            raise Invalid("Pending input is not bound to this preparation policy")
        result["pending"] = candidate.get("pending") or ["Candidate resolution is not complete"]
        return result
    if native_target() != candidate.get("target"):
        raise Invalid("Materialization must run on its matching native target")
    operations = load_operations(operation_input, policy_sha, candidate["target"], work_root)
    verify_candidate(candidate, policy, policy_sha, assets, operations)
    work = fresh_work(work_root, policy)
    local_assets = work / "assets"
    inputs = [candidate[component]["asset"] for component in ("python", "node")]
    for component in ("python", "node"):
        inputs += candidate[component].get("licenseSources", [])
    for name in ("tix", "libzmq"):
        inputs.append(candidate["licenseSupplements"][name]["asset"])
    for item in candidate["lxmlWindowsSourceMaterials"]:
        inputs.append({key: content for key, content in item.items() if key != "id"})
    inputs.append(policy["toolchain"][candidate["target"]]["licenseDecoder"]["asset"])
    for provider in candidate["providers"].values():
        for wheel in provider["wheels"]:
            inputs.append(wheel["asset"])
            if "derived" in wheel:
                inputs.append(wheel["derived"]["upstreamAsset"])
                inputs += native_build_assets(wheel, candidate["target"])
    for value in inputs:
        source = verified_asset(assets, value)
        copy_asset(source, local_assets / value["filename"], value)
    tools, tool_receipt = native_tools(candidate, policy, candidate["target"], local_assets, work)
    preflight_closures(candidate, tools, work)
    for provider in candidate["providers"].values():
        wheel_native_evidence(provider["wheels"], local_assets, candidate["target"])
    reproduction = []
    unique = {}
    for provider in candidate["providers"].values():
        for wheel in provider["wheels"]:
            unique[wheel["asset"]["filename"]] = wheel
    for wheel in unique.values():
        if wheel["asset"]["kind"] == "derived":
            reproduction.append(reproduce(wheel, local_assets, work, policy))
        path = verified_asset(local_assets, wheel["asset"])
        actual = read_wheel(path)
        if any(wheel.get(key) != fact for key, fact in actual.items()):
            raise Invalid("Actual wheel METADATA differs from candidate")
    tree = work / "tree"
    tree.mkdir()
    python_asset = verified_asset(local_assets, candidate["python"]["asset"])
    # Build tools remain in the separately inventoried toolchain, not the product tree.
    def product_python_member(name):
        normalized = name.lower()
        return not re.search(r"(?:^|/)site-packages/(?:pip(?:/|-)|setuptools(?:/|-)|wheel(?:/|-)|pkg_resources/|_distutils_hack/)", normalized) and not normalized.startswith("lib/ensurepip/")
    safe_extract(python_asset, tree / "python", "python", product_python_member, allow_links=candidate["target"].startswith("darwin"))
    node_asset = verified_asset(local_assets, candidate["node"]["asset"])
    node_prefix = candidate["node"]["asset"]["filename"].removesuffix(".zip").removesuffix(".tar.gz")
    safe_extract(node_asset, tree / "node", node_prefix, {"node.exe", "LICENSE"} if candidate["target"] == "win32-x64" else {"bin/node", "LICENSE"},
                 allow_links=candidate["target"].startswith("darwin"))
    (tree / "providers").mkdir()
    evidence, licenses, metadata_provenance = {}, [], []
    for provider, provider_lock in candidate["providers"].items():
        site = tree / provider_lock["site"]
        if site.exists():
            raise Invalid("Provider installation must target an entirely fresh site")
        site.mkdir(parents=True)
        requirement_path = work / (provider + "-requirements.lock.txt")
        requirements = "\n".join(wheel["distribution"] + "==" + wheel["version"] + " --hash=sha256:" + wheel["asset"]["sha256"]
                                 for wheel in provider_lock["wheels"]) + "\n"
        exclusive_bytes(requirement_path, requirements.encode("ascii"))
        run(pip_command(tools, local_assets, site, requirement_path, True), work)
        closure = validate_closure(tools, provider_lock["wheels"], [provider + "==" + provider_lock["version"]], work, site)
        audit_reference, closure_reference = write_dependency_audit(tree, provider, provider_lock, candidate["target"], tool_receipt, closure)
        evidence[provider] = {"offlineInstallExecuted": True, "requirementsSha256": file_digest(requirement_path),
                              "installedClosure": closure, "installedClosureEvidence": closure_reference,
                              "dependencyAudit": audit_reference}
        print("installed " + provider + ": " + str(len(provider_lock["wheels"])) + " verified distributions", flush=True)
    # Retain exact public source/notice materials before license decisions, SBOM and inventory.
    reviewed_materials = retain_reviewed_materials(policy, operations, tree, candidate)
    for provider, provider_lock in candidate["providers"].items():
        site = tree / provider_lock["site"]
        audit_reference = evidence[provider]["dependencyAudit"]
        for wheel in provider_lock["wheels"]:
            for member, expected_sha in wheel["notices"].items():
                path = site / relative(member)
                if not path.is_file() or file_digest(path) != expected_sha:
                    raise Invalid("Installed wheel license/notice differs from original wheel")
                installed_path = provider_lock["site"] + "/" + member
                role = metadata_role(policy, wheel["distribution"], wheel["version"],
                                     wheel["asset"]["sha256"], installed_path, expected_sha)
                if role:
                    metadata_provenance.append({**role, "installedMetadataVerified": True,
                                                "dependencyAudit": audit_reference})
                else:
                    licenses.append(license_item(policy, wheel["distribution"], wheel["version"],
                                                 wheel["asset"]["sha256"], installed_path, expected_sha))
    bound_source_copy(candidate, "resources/python-runtime/pywencai_adapter.py", tree / "providers/pywencai/pywencai_adapter.py")
    licenses += retain_native_licenses(tree, work, policy, candidate, local_assets, tools)
    supplement_licenses, supplement_evidence = retain_license_supplements(tree, work, policy, candidate, local_assets)
    licenses += supplement_licenses
    limited_purpose = retain_limited_purpose_sources(tree, policy, candidate, local_assets)
    lxml_sources = retain_lxml_windows_sources(tree, candidate, local_assets)
    for source_name, name in (("resources/python-runtime/bootstrap.py", "bootstrap.py"),
                              ("resources/python-runtime/miniracer_unicode_adapter.py", "miniracer_unicode_adapter.py"),
                              ("electron/shared/privatePythonRuntimeManifest.cjs", "private_runtime_manifest.cjs")):
        bound_source_copy(candidate, source_name, tree / name)
    macho = mac_tree_evidence(tree, candidate["target"])
    native = basic_native_evidence(tree, tools, work, candidate["target"], candidate)
    sbom = candidate_sbom(candidate, licenses)
    exclusive_bytes(tree / "sbom.spdx.json", encoded(sbom))
    applicability = target_license_applicability(tree, policy, candidate, supplement_evidence, limited_purpose, lxml_sources)
    ledger = inventory(tree)
    for row in licenses:
        disposition = license_applicability_disposition(row, policy, candidate["target"],
                                                         candidate["python"]["asset"]["sha256"], applicability, ledger)
        if not row["approvalId"] and disposition:
            row["review"] = disposition
    exclusive_bytes(work / "inventory.json", encoded(ledger))
    exclusive_bytes(work / "native-evidence.json", encoded({"imports": native, "providers": evidence, "macho": macho}))
    operation_receipts = finish_operation(operations, work, tool_receipt, candidate["sourceEvidence"], {})
    result.update(status="candidate", reproductions=reproduction, treeComplete=True, treeRoot=str(tree),
                  sourceSha256=candidate["sourceSha256"], sourceSnapshot=candidate["sourceSnapshot"],
                  sourceEvidence=candidate["sourceEvidence"], operationEvidence=operations, operationInputSha256=operations["inputSha256"],
                  operationReceipts=operation_receipts,
                  dependencyAuditValidator={"path": "private_runtime_manifest.cjs", "sha256": file_digest(tree / "private_runtime_manifest.cjs")},
                  toolchain=tool_receipt, inventory=ledger, inventorySha256=digest(encoded(ledger)),
                  providers={name: {"version": lock["version"], "site": lock["site"], "dependencyAudit": evidence[name]["dependencyAudit"],
                                    "installedClosure": evidence[name]["installedClosureEvidence"]} for name, lock in candidate["providers"].items()},
                   sbom={"path": "sbom.spdx.json", "sha256": file_digest(tree / "sbom.spdx.json"), "format": "SPDX-2.3"},
                    reviewedMaterialsEvidence=reviewed_materials,
                    licenseSupplementEvidence=supplement_evidence,
                    licenseApplicabilityEvidence=applicability,
                    lxmlWindowsSourceEvidence=lxml_sources,
                    licenseRequirements=licenses, metadataProvenance=metadata_provenance,
                   nativeEvidence={"target": candidate["target"], "sha256": file_digest(work / "native-evidence.json"),
                                                               "path": str(work / "native-evidence.json"), "scope": "native imports/private Node; not full production bootstrap"})
    result["pending"] = candidate_pending(policy, candidate["sourceEvidence"]) + ["Full manifest production bootstrap/Unicode adapter acceptance remains a separate gate"]
    return result


def candidate_pending(policy, source=None):
    result = list(policy.get("pending", []))
    if not (source or {}).get("sourceCommit"):
        result.append("sourceCommit is pending; sourceSha256 binds actual preparation/application bytes")
    result.append("Per-artifact applicable license approvals are pending; candidate is not release eligible")
    if (source or {}).get("sourceCommit") and (source or {}).get("sourceVerified") is not True:
        result.append("Immutable checkout/source verification remains a separate seal gate")
    return sorted(set(result))


def source_snapshot(policy_sha):
    paths = ["scripts/prepare-private-python-runtime.py", "scripts/build-provider-source-wheels.py", "scripts/build-mootdx-compat-wheel.py",
             "resources/python-runtime/bootstrap.py", "resources/python-runtime/miniracer_unicode_adapter.py", "electron/shared/privatePythonRuntimeManifest.cjs",
             "resources/python-runtime/pywencai_adapter.py", "scripts/rebuild-lxml-native.py",
             "scripts/build-lxml-redistribution-wheel.py", "scripts/build-lxml-matched-public-source.py",
             "scripts/build-akshare-node-wheel.py", "scripts/build-private-node-js-runtime-wheel.py",
             "scripts/private-node-js-runtime/rt_private_node_js_runtime/__init__.py",
             "scripts/private-node-js-runtime/rt_private_node_js_runtime/worker.cjs", "LICENSE",
             "resources/python-runtime/reviewed-materials/fetch-runtime-license-materials-ci.py",
             "resources/python-runtime/reviewed-materials/runtime-license-materials.json"]
    for path in paths:
        source = ROOT / relative(path)
        if source.is_symlink() or not source.resolve().is_relative_to(ROOT.resolve()):
            raise Invalid("Consumed repository source escapes checkout")
    return {"policySha256": policy_sha, "files": [{"path": path, "sha256": file_digest(ROOT / path)} for path in sorted(paths)]}


def copy_asset(source, destination, value):
    if destination.exists():
        verified_asset(destination.parent, value)
        return destination
    with Path(source).open("rb") as source_stream, destination.open("xb") as output:
        shutil.copyfileobj(source_stream, output, 1024 * 1024)
    return verified_asset(destination.parent, value)


def acquire(value, assets, policy, operations=None):
    asset(value)
    if value["kind"] == "download":
        official(value, policy)
    destination = assets / value["filename"]
    if destination.exists():
        return verified_asset(assets, value)
    for cache_root in (operations or {}).get("cacheRoots", []):
        root = Path(cache_root)
        if (root / value["filename"]).exists():
            source = verified_asset(root, value)
            return copy_asset(source, destination, value)
    if value["kind"] == "derived":
        raise Pending("Pinned retained native input is absent from the supplied cache")
    return fetch(value, destination, policy)


def python_executable(root, target):
    return Path(root) / ("python.exe" if target == "win32-x64" else "bin/python3.13")


def node_executable(root, target):
    return Path(root) / ("node.exe" if target == "win32-x64" else "bin/node")


THIN_MAGICS = {b"\xcf\xfa\xed\xfe": ("<", True), b"\xfe\xed\xfa\xcf": (">", True),
               b"\xce\xfa\xed\xfe": ("<", False), b"\xfe\xed\xfa\xce": (">", False)}
FAT_MAGICS = {b"\xca\xfe\xba\xbe": (">", False), b"\xbe\xba\xfe\xca": ("<", False),
              b"\xca\xfe\xba\xbf": (">", True), b"\xbf\xba\xfe\xca": ("<", True)}
CPU_NAMES = {0x01000007: "x64", 0x0100000c: "arm64"}


def native_header(data):
    return data[:4] in THIN_MAGICS or data[:4] in FAT_MAGICS or data[:8] == b"!<arch>\n"


def macho_slices(data, depth=0):
    """Parse actual thin/fat Mach-O and static-ar members, not wheel filenames."""
    if depth > 4:
        raise Invalid("Nested native archive limit")
    magic = data[:4]
    if magic in THIN_MAGICS:
        endian, wide = THIN_MAGICS[magic]
        header_size = 32 if wide else 28
        if len(data) < header_size:
            raise Invalid("Truncated Mach-O header")
        header = struct.unpack_from(endian + ("8I" if wide else "7I"), data)
        cpu, count, size = header[1], header[4], header[5]
        if cpu not in CPU_NAMES or count > 100000 or header_size + size > len(data):
            raise Invalid("Invalid Mach-O architecture/load commands")
        position, versions = header_size, []
        for _ in range(count):
            if position + 8 > header_size + size:
                raise Invalid("Truncated Mach-O load command")
            command, length = struct.unpack_from(endian + "2I", data, position)
            if length < 8 or length % 4 or position + length > header_size + size:
                raise Invalid("Invalid Mach-O load command length")
            if command == 0x32:  # LC_BUILD_VERSION: platform must be macOS.
                if length < 24:
                    raise Invalid("Truncated LC_BUILD_VERSION")
                apple_platform, minimum, sdk, tools = struct.unpack_from(endian + "4I", data, position + 8)
                if apple_platform != 1 or 24 + 8 * tools > length:
                    raise Invalid("Non-macOS or invalid LC_BUILD_VERSION")
                versions.append(minimum)
            elif command == 0x24:  # LC_VERSION_MIN_MACOSX, not sdk.
                if length != 16:
                    raise Invalid("Invalid LC_VERSION_MIN_MACOSX")
                versions.append(struct.unpack_from(endian + "I", data, position + 8)[0])
            elif command in {0x25, 0x2f, 0x30}:
                raise Invalid("Non-macOS minimum version command")
            position += length
        if position != header_size + size or not versions:
            raise Invalid("Mach-O minimum macOS is not established")
        if any(value == 0 or value > (12 << 16) for value in versions):
            raise Invalid("Mach-O requires macOS newer than 12.0 or unspecified")
        return [{"architecture": CPU_NAMES[cpu], "minimumMacOS": ["%d.%d.%d" % (v >> 16, (v >> 8) & 255, v & 255) for v in versions]}]
    if magic in FAT_MAGICS:
        endian, wide = FAT_MAGICS[magic]
        if len(data) < 8:
            raise Invalid("Truncated fat Mach-O header")
        count = struct.unpack_from(endian + "I", data, 4)[0]
        width = 32 if wide else 20
        if not 0 < count <= 32 or 8 + width * count > len(data):
            raise Invalid("Invalid fat Mach-O slice count")
        intervals, result = [], []
        for index in range(count):
            fields = struct.unpack_from(endian + ("IIQQII" if wide else "5I"), data, 8 + index * width)
            cpu, offset, size, alignment = fields[0], fields[2], fields[3], fields[4]
            if (cpu not in CPU_NAMES or alignment > 31 or offset % (1 << alignment) or not size
                    or offset < 8 + width * count or offset + size > len(data)
                    or any(offset < end and offset + size > start for start, end in intervals)):
                raise Invalid("Invalid/overlapping fat Mach-O slice")
            intervals.append((offset, offset + size))
            slices = macho_slices(data[offset:offset + size], depth + 1)
            if not slices or any(part["architecture"] != CPU_NAMES[cpu] for part in slices):
                raise Invalid("Fat slice CPU header disagrees with payload")
            result.extend(slices)
        return result
    if data[:8] == b"!<arch>\n":
        position, result, members = 8, [], 0
        while position < len(data):
            if position + 60 > len(data) or data[position + 58:position + 60] != b"`\n":
                raise Invalid("Truncated native static archive")
            header = data[position:position + 60]
            try:
                size = int(header[48:58].strip())
            except ValueError as error:
                raise Invalid("Invalid native archive member size") from error
            start, end = position + 60, position + 60 + size
            if size < 0 or end + (size & 1) > len(data):
                raise Invalid("Truncated native archive member")
            name = header[:16].rstrip()
            if name.startswith(b"#1/"):
                try:
                    name_size = int(name[3:])
                except ValueError as error:
                    raise Invalid("Invalid BSD archive extended name") from error
                if not 0 <= name_size <= size:
                    raise Invalid("Invalid BSD archive name size")
                start += name_size
            payload = data[start:end]
            if native_header(payload):
                result.extend(macho_slices(payload, depth + 1))
            members += 1
            if members > 200000:
                raise Invalid("Native archive member limit")
            position = end + (size & 1)
        return result
    raise Invalid("Unsupported native binary payload")


def checked_native(data, target):
    slices = macho_slices(data)
    expected = target.split("-", 1)[1]
    architectures = {part["architecture"] for part in slices}
    # Universal binaries are allowed, but every slice was validated above.
    if slices and (expected not in architectures or (data[:4] not in FAT_MAGICS and architectures != {expected})):
        raise Invalid("Native binary architecture differs from target")
    return slices


def mac_tree_evidence(root, target):
    if not target.startswith("darwin"):
        return {"target": target, "applicable": False}
    binaries = []
    for entry in inventory(root):
        if entry["kind"] != "file":
            continue
        path = Path(root) / entry["path"]
        with path.open("rb") as handle:
            header = handle.read(8)
        if native_header(header):
            binaries.append({"path": entry["path"], "sha256": entry["sha256"], "size": entry["size"],
                             "slices": checked_native(path.read_bytes(), target)})
    if not any(binary["slices"] for binary in binaries):
        raise Invalid("No actual Mach-O binaries found in native Mac tree")
    return {"target": target, "maximumMinimumMacOS": "12.0.0", "binaries": binaries}


def wheel_native_evidence(wheels, assets, target):
    if not target.startswith("darwin"):
        return []
    result, seen = [], set()
    for wheel in wheels:
        value = wheel["asset"]
        if value["sha256"] in seen:
            continue
        seen.add(value["sha256"])
        with zipfile.ZipFile(verified_asset(assets, value)) as archive:
            for item in archive.infolist():
                if item.is_dir():
                    continue
                with archive.open(item) as handle:
                    header = handle.read(8)
                if native_header(header):
                    data = archive.read(item)
                    result.append({"wheelSha256": value["sha256"], "member": relative(item.filename),
                                   "sha256": digest(data), "slices": checked_native(data, target)})
    return result


def write_dependency_audit(tree, provider, lock, target, toolchain, closure):
    if not closure.get("installedMetadataVerified") or closure["packaging"] != toolchain["packaging"]:
        raise Invalid("Dependency audit requires actual installed metadata/tool identity")
    base = "providers/" + provider
    closure_path = base + "/installed-closure.json"
    exclusive_bytes(Path(tree) / closure_path, encoded(closure))
    closure_reference = {"path": closure_path, "sha256": file_digest(Path(tree) / closure_path)}
    installed = [{**item, "metadataPath": lock["site"] + "/" + relative(item["metadataPath"])} for item in closure["installed"]]
    wheels = []
    for wheel in lock["wheels"]:
        metadata = [path for path in wheel["notices"] if path.count("/") == 1 and path.endswith(".dist-info/METADATA")]
        if len(metadata) != 1:
            raise Invalid("Original wheel metadata path is not unique")
        name = re.sub(r"[-_.]+", "-", wheel["distribution"]).lower()
        wheels.append({"name": name, "version": wheel["version"], "wheelSha256": wheel["asset"]["sha256"],
                       "metadataPath": lock["site"] + "/" + metadata[0], "metadataSha256": wheel["metadataSha256"],
                       "requiresDist": wheel["dependencies"], "requiresPython": wheel["requiresPython"], "tags": wheel["tags"]})
    if ({(item["name"], item["version"], item["metadataPath"], item["metadataSha256"]) for item in installed}
            != {(item["name"], item["version"], item["metadataPath"], item["metadataSha256"]) for item in wheels}):
        raise Invalid("Audit installed/wheel identity sets differ")
    audit = {"schemaVersion": 1, "kind": "rt-private-provider-dependency-audit-v1", "provider": provider,
             "target": target, "site": lock["site"], "roots": [provider + "==" + lock["version"]],
             "generator": {"id": "rt-private-python-prep-closure-v1", "scriptSha256": file_digest(Path(__file__))},
             "toolchain": {"pythonAssetSha256": toolchain["pythonAssetSha256"], "executableSha256": toolchain["executableSha256"],
                           "pipVersion": toolchain["pip"], "pipMetadataSha256": toolchain["pipMetadataSha256"], "packaging": toolchain["packaging"]},
             "markerEnvironment": closure["environment"], "activatedExtras": closure["extras"], "installed": installed,
             "wheels": sorted(wheels, key=lambda item: item["name"]), "evaluations": closure["evaluations"],
             "resolvedEdges": closure["activeRequiresDist"], "installedClosure": closure_reference}
    audit_path = base + "/dependency-audit.json"
    exclusive_bytes(Path(tree) / audit_path, encoded(audit))
    return {"path": audit_path, "sha256": file_digest(Path(tree) / audit_path), "format": audit["kind"]}, closure_reference


FULL_LICENSE_HELPER = r'''
import base64,json,pathlib,re,sys,tarfile
sys.path.insert(0,sys.argv[1]);import zstandard
result={};total=count=0
with pathlib.Path(sys.argv[2]).open('rb') as source,zstandard.ZstdDecompressor().stream_reader(source) as reader,tarfile.open(fileobj=reader,mode='r|') as archive:
 for member in archive:
  count+=1;total+=member.size
  if count>200000 or total>3000000000:raise ValueError('full source expansion budget')
  selected=member.name=='python/PYTHON.json' or member.name.startswith('python/licenses/') or (member.name.startswith('python/install/') and re.search(r'(?:^|/)(?:LICENSE|LICENCE|COPYING|NOTICE|AUTHORS)(?:[./_-]|$)',member.name,re.I))
  if not selected or member.isdir():continue
  if not member.isfile() or member.issparse() or member.name in result:raise ValueError('unsafe full license member')
  raw=archive.extractfile(member).read(4000001)
  if len(raw)!=member.size or len(raw)>4000000:raise ValueError('license member size budget')
  result[member.name]=base64.b64encode(raw).decode('ascii')
print(json.dumps(result,sort_keys=True))
'''


def prepare_license_decoder(policy, target, assets, tools, work):
    config = policy["toolchain"][target]["licenseDecoder"]
    value = config["asset"]
    official(value, policy)
    wheel = {"asset": value, **read_wheel(verified_asset(assets, value))}
    if wheel["distribution"] != config["distribution"] or wheel["version"] != config["version"]:
        raise Invalid("Pinned license decoder identity differs")
    roots = [wheel["distribution"] + "==" + wheel["version"]]
    validate_closure(tools, [wheel], roots, work)
    wheel_native_evidence([wheel], assets, target)
    site = work / "toolchain/license-decoder"
    site.mkdir()
    requirements = work / "license-decoder-requirements.txt"
    exclusive_bytes(requirements, (roots[0] + " --hash=sha256:" + value["sha256"] + "\n").encode("ascii"))
    run(pip_command(tools, assets, site, requirements, True), work)
    closure = validate_closure(tools, [wheel], roots, work, site)
    exclusive_bytes(work / "license-decoder-evidence.json", encoded({"asset": value, "originalWheel": wheel, "installedClosure": closure,
                                                                    "inventorySha256": digest(encoded(inventory(site)))}))
    return site


def license_references(value):
    result = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "license_path" and isinstance(child, str):
                result.add("python/" + relative(child))
            elif key == "license_paths" and isinstance(child, list):
                result.update("python/" + relative(item) for item in child if isinstance(item, str))
            result.update(license_references(child))
    elif isinstance(value, list):
        for child in value:
            result.update(license_references(child))
    return sorted(result)


def retain_full_licenses(tree, work, policy, candidate, assets, tools):
    target = candidate["target"]
    expected = policy["nativeLicenseInputs"][target]
    source_asset = candidate["python"]["licenseSources"][0]
    full = verified_asset(assets, source_asset)
    decoder = prepare_license_decoder(policy, target, assets, tools, work)
    decoded = json.loads(run([str(tools), "-X", "utf8", "-B", "-I", "-c", FULL_LICENSE_HELPER, str(decoder), str(full)], work))
    pins = expected["pythonFull"]["members"]
    if set(decoded) != {item["path"] for item in pins}:
        raise Invalid("Full source license/member set differs from original archive pins")
    result, members = [], []
    raw_members = {}
    for item in pins:
        name = relative(item["path"])
        raw = base64.b64decode(decoded[name], validate=True)
        if len(raw) != item["size"] or digest(raw) != item["sha256"]:
            raise Invalid("Original full source member differs from size/SHA-256 pin")
        path = "licenses/python-full/" + name
        exclusive_bytes(tree / path, raw)
        raw_members[name] = raw
        members.append({"member": name, "path": path, "sha256": digest(raw), "size": len(raw),
                        "sourceAssetSha256": source_asset["sha256"], "method": "direct read from exact full archive with pinned owned decoder"})
        if name != "python/PYTHON.json":
            result.append(license_item(policy, "python-build-standalone", candidate["python"]["version"], candidate["python"]["asset"]["sha256"], path, digest(raw)))
    metadata = json.loads(raw_members["python/PYTHON.json"])
    triple = {"win32-x64": "x86_64-pc-windows-msvc", "darwin-arm64": "aarch64-apple-darwin", "darwin-x64": "x86_64-apple-darwin"}[target]
    if metadata["target_triple"] != triple or metadata["python_version"] != candidate["python"]["version"]:
        raise Invalid("Full license metadata target/version differs from runtime")
    references = license_references(metadata)
    missing = [name for name in references if name not in raw_members]
    # Missing upstream notice references are explicit compliance gaps, never invented
    # bytes or approvals. Candidate work continues; formal seal remains blocked.
    exclusive_bytes(tree / "licenses/python-full/member-provenance.json", encoded({"sourceAsset": source_asset, "members": members,
                                                                                   "declaredLicenseReferences": references, "missingLicenseReferences": missing}))
    node_license = tree / "node/LICENSE"
    node_pin = expected["node"]
    if node_license.stat().st_size != node_pin["size"] or file_digest(node_license) != node_pin["sha256"]:
        raise Invalid("Original Mac Node LICENSE size/SHA-256 differs")
    result.append(license_item(policy, "node", candidate["node"]["version"], candidate["node"]["asset"]["sha256"], "node/LICENSE", node_pin["sha256"]))
    return result


def native_tools(config, policy, target, assets, work):
    expected = policy["toolchain"][target]
    python_dir = work / "toolchain/python"
    safe_extract(verified_asset(assets, config["python"]["asset"]), python_dir, "python", allow_links=target.startswith("darwin"))
    native = mac_tree_evidence(python_dir, target)
    python = python_executable(python_dir, target)
    information = json.loads(run([str(python), "-X", "utf8", "-B", "-I", "-c",
        "import hashlib,json,pathlib,pip,sys,platform; import pip._vendor.packaging as packaging; p=next(pathlib.Path(pip.__file__).parent.parent.glob('pip-*.dist-info/METADATA')); "
        "print(json.dumps({'python':platform.python_version(),'utf8Mode':sys.flags.utf8_mode,'stdoutEncoding':sys.stdout.encoding,'implementation':platform.python_implementation(),'machine':platform.machine(),'sysPlatform':sys.platform,'pip':pip.__version__,'pipMetadataSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'executableSha256':hashlib.sha256(pathlib.Path(sys.executable).read_bytes()).hexdigest(),'packaging':{'id':'pip-vendored-packaging','version':packaging.__version__,'sourceSha256':hashlib.sha256(pathlib.Path(packaging.__file__).read_bytes()).hexdigest()}}))"], work))
    actual_arch = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(information["machine"].lower())
    if information["utf8Mode"] != 1 or information["stdoutEncoding"].lower().replace("_", "-") != "utf-8":
        raise Invalid("Pinned PBS child must explicitly enable UTF-8 mode")
    if (information["python"] != config["python"]["version"] or information["implementation"] != "CPython"
            or information["sysPlatform"] + "-" + str(actual_arch) != target
            or information["pip"] != expected["pipVersion"] or information["pipMetadataSha256"] != expected["pipMetadataSha256"]):
        raise Invalid("Fresh pinned PBS toolchain identity differs from policy")
    return python, {"pythonAssetSha256": config["python"]["asset"]["sha256"], **information,
                    "toolchainInventorySha256": digest(encoded(inventory(python_dir))), "macho": native,
                    "location": "separate toolchain; excluded from product tree"}


def resolution_constraints(policy, provider, assets, work, target="win32-x64", operations=None):
    versions, seed = {}, None
    seed_path = (operations or {}).get("seedReports", {}).get(provider)
    if seed_path:
        raw = Path(seed_path).read_bytes()
        old_report = json.loads(raw)
        for item in old_report.get("install", []):
            metadata = item["metadata"]
            name = re.sub(r"[-_.]+", "-", metadata["name"]).lower()
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name) or not re.fullmatch(r"[A-Za-z0-9.+!-]+", metadata["version"]):
                raise Invalid("Unsafe seed requirement")
            versions[name] = metadata["version"]
        seed = {"sha256": digest(raw), "purpose": "version constraints only; NOT a final lock or resolver evidence"}
    # Stale seed engine entries are constraints only, never retained provider roots.
    versions.pop("mini-racer", None)
    versions.pop("py-mini-racer", None)
    for name, pin in policy["resolverCompatibilityPins"].get(target, {}).get(provider, {}).items():
        versions[name] = pin["version"]
    lines = []
    for wheel in derived_wheels(policy, target):
        key = re.sub(r"[-_.]+", "-", wheel["distribution"]).lower()
        versions.pop(key, None)
        lines.append(wheel["distribution"] + " @ " + verified_asset(assets, wheel["asset"]).as_uri())
    lines += [name + "==" + version for name, version in sorted(versions.items())]
    path = work / (provider + "-constraints.txt")
    exclusive_bytes(path, ("\n".join(lines) + "\n").encode("ascii"))
    return path, seed


def validate_resolver_pins(policy, target, provider, wheels):
    for selected in derived_wheels(policy, target):
        matches = [wheel for wheel in wheels if re.sub(r"[-_.]+", "-", wheel["distribution"]).lower()
                   == re.sub(r"[-_.]+", "-", selected["distribution"]).lower()]
        if matches and (len(matches) != 1 or any(matches[0].get(key) != selected.get(key)
                                               for key in ("asset", "derived", "version", "nativeBuildInputs"))):
            raise Invalid("Resolver bypassed exact target derived wheel inputs")
    for name, pin in policy["resolverCompatibilityPins"].get(target, {}).get(provider, {}).items():
        found = [wheel for wheel in wheels if re.sub(r"[-_.]+", "-", wheel["distribution"]).lower() == name]
        if (len(found) != 1 or found[0]["version"] != pin["version"]
                or found[0]["asset"] != pin["asset"]
                or found[0]["metadataSha256"] != pin["metadataSha256"]):
            raise Invalid("Normal resolver did not select the exact reviewed Mac compatibility wheel")


def freeze_report_item(item, assets, policy, operations=None, target="win32-x64"):
    url = item["download_info"]["url"]
    sha = item["download_info"]["archive_info"]["hashes"]["sha256"]
    parsed = urllib.parse.urlsplit(url)
    filename = urllib.parse.unquote(parsed.path.rsplit("/", 1)[-1])
    if not filename.endswith(".whl"):
        raise Invalid("Implicit sdist builds are forbidden")
    approved = next((wheel for wheel in derived_wheels(policy, target) if wheel["asset"]["filename"] == filename), None)
    if parsed.scheme == "file":
        if not approved or sha != approved["asset"]["sha256"] or Path(urllib.request.url2pathname(parsed.path)).resolve() != (assets / filename).resolve():
            raise Invalid("Resolver selected an unreviewed local wheel")
        value = dict(approved["asset"])
        wheel = json.loads(json.dumps(approved))
    else:
        selected_names = {re.sub(r"[-_.]+", "-", wheel["distribution"]).lower()
                          for wheel in derived_wheels(policy, target)}
        if re.sub(r"[-_.]+", "-", item["metadata"]["name"]).lower() in selected_names:
            raise Invalid("Resolver bypassed the selected derived wheel with a download")
        # Candidate discovery can determine size; validate official origin and the
        # resolver's source digest BEFORE recording this newly frozen download pin.
        preliminary = {"kind": "download", "filename": filename, "url": url, "sha256": sha, "size": 1}
        official(preliminary, policy)
        cached = next((Path(root) / filename for root in (operations or {}).get("cacheRoots", []) if (Path(root) / filename).is_file()), None)
        if cached:
            data = cached.read_bytes()
        else:
            with urllib.request.urlopen(url, timeout=60) as response:
                if not response.geturl().startswith("https://files.pythonhosted.org/packages/"):
                    raise Invalid("Wheel discovery redirected outside official package assets")
                data = response.read(MAX_ASSET + 1)
        if not 0 < len(data) <= MAX_ASSET or digest(data) != sha:
            raise Invalid("Actual resolver wheel bytes do not match report digest")
        value = {**preliminary, "size": len(data)}
        exclusive_bytes(assets / filename, data)
        wheel = {"asset": value, "licenses": []}
    actual = read_wheel(verified_asset(assets, value))
    metadata = item["metadata"]
    if actual["distribution"].lower() != metadata["name"].lower() or actual["version"] != metadata["version"] or actual["dependencies"] != metadata.get("requires_dist", []):
        raise Invalid("Actual METADATA differs from this normal resolver report")
    if approved is not None:
        # Legacy global source recipes pin bytes/core identity, not every parsed
        # field. Populate omitted facts only after asset SHA and RECORD checks.
        # Target-native selections and every explicitly pinned fact stay strict.
        legacy_generic = (approved in policy.get("derivedWheels", [])
                          and approved.get("nativeBuildInputs") is None
                          and approved["derived"]["recipe"]["path"] in {
                              "scripts/build-provider-source-wheels.py",
                              "scripts/build-mootdx-compat-wheel.py"})
        if (any(key not in approved for key in ("distribution", "version", "dependencies"))
                or any((not legacy_generic or key in approved) and approved.get(key) != fact
                       for key, fact in actual.items())):
            raise Invalid("Target derived wheel actual metadata/notices differ from policy")
    wheel.update(actual)
    wheel_contract(wheel, policy)
    return wheel


CLOSURE_HELPER = r'''
import hashlib,json,pathlib,sys
import pip._vendor.packaging as packaging
from email.parser import BytesParser
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.markers import default_environment
from pip._vendor.packaging.utils import canonicalize_name
from pip._vendor.packaging.tags import sys_tags,parse_tag
from pip._vendor.packaging.specifiers import SpecifierSet
request=json.loads(pathlib.Path(sys.argv[1]).read_bytes())
expected={canonicalize_name(w['distribution']):w for w in request['wheels']}
if len(expected)!=len(request['wheels']):raise ValueError('duplicate distribution')
if request.get('site'):
 actual={}
 for info in pathlib.Path(request['site']).glob('*.dist-info'):
  raw=(info/'METADATA').read_bytes();m=BytesParser().parsebytes(raw); key=canonicalize_name(m['Name'])
  if key in actual:raise ValueError('duplicate installed distribution')
  actual[key]={'version':m['Version'],'dependencies':m.get_all('Requires-Dist',[]),'metadataSha256':hashlib.sha256(raw).hexdigest(),'metadataPath':info.name+'/METADATA'}
 if set(actual)!=set(expected):raise ValueError('installed set differs')
 for key,value in actual.items():
  if any(value[field]!=expected[key][field] for field in ('version','dependencies','metadataSha256')):raise ValueError('installed METADATA differs')
env=default_environment(); compatible=set(sys_tags())
for wheel in expected.values():
 if not any(parse_tag(tag)&compatible for tag in wheel['tags']):raise ValueError('incompatible wheel tag')
 if wheel.get('requiresPython') and not SpecifierSet(wheel['requiresPython']).contains(env['python_full_version'],prereleases=True):raise ValueError('Requires-Python unsatisfied')
extras={};queue=[];reachable=set();edges=[]
def require(raw):
 r=Requirement(raw);key=canonicalize_name(r.name)
 if r.url:raise ValueError('unlocked metadata URL dependency')
 if key not in expected or not r.specifier.contains(expected[key]['version'],prereleases=True):raise ValueError('unsatisfied dependency '+raw)
 before=extras.get(key);current=(before or set())|{canonicalize_name(x) for x in r.extras}
 if before is None or before!=current:extras[key]=current;queue.append(key)
 reachable.add(key)
for root in request['roots']:require(root)
iterations=0
while queue:
 key=queue.pop(0);iterations+=1
 if iterations>10000:raise ValueError('dependency graph limit')
 for raw in expected[key]['dependencies']:
  r=Requirement(raw)
  if r.marker and not any(r.marker.evaluate(dict(env,extra=extra)) for extra in {''}|extras[key]):continue
  require(raw)
if reachable!=set(expected):raise ValueError('extraneous distributions outside root/marker/extra closure')
evaluations=[]
for key,wheel in sorted(expected.items()):
 for index,raw in enumerate(wheel['dependencies']):
  r=Requirement(raw);active=not r.marker or any(r.marker.evaluate(dict(env,extra=extra)) for extra in {''}|extras[key])
  evaluation={'from':key,'requiresDistIndex':index,'requirement':raw,'to':canonicalize_name(r.name),'extras':sorted(canonicalize_name(x) for x in r.extras),'active':bool(active)}
  evaluations.append(evaluation)
  if active:edges.append({'from':key,'requiresDistIndex':index,'requirement':raw,'dependencyName':canonicalize_name(r.name)})
installed=[{'name':k,'version':v['version'],'metadataPath':v['metadataPath'],'metadataSha256':v['metadataSha256'],'rawRequiresDist':v['dependencies']} for k,v in sorted(actual.items())] if request.get('site') else []
print(json.dumps({'python':env['python_full_version'],'environment':env,'distributionCount':len(expected),'extras':{k:sorted(v) for k,v in extras.items()},'activeRequiresDist':edges,'evaluations':evaluations,'installed':installed,'packaging':{'id':'pip-vendored-packaging','version':packaging.__version__,'sourceSha256':hashlib.sha256(pathlib.Path(packaging.__file__).read_bytes()).hexdigest()},'installedMetadataVerified':bool(request.get('site'))},sort_keys=True))
'''


def validate_closure(python, wheels, roots, work, site=None):
    filename = "closure-" + digest(encoded({"roots": roots, "site": str(site), "wheels": wheels}))[:16] + ".json"
    request = work / filename
    exclusive_bytes(request, encoded({"wheels": wheels, "roots": roots, "site": str(site) if site else None}))
    return json.loads(run([str(python), "-X", "utf8", "-B", "-I", "-c", CLOSURE_HELPER, str(request)], work))


def license_item(policy, component, version, artifact_sha, path, sha):
    matches = [record for record in policy["licenseApprovals"] if (record["component"], record["version"], record["artifactSha256"], record["licenseSha256"])
               == (component, version, artifact_sha, sha)]
    spdx = matches[0]["spdx"] if len(matches) == 1 else "NOASSERTION"
    approval = license_decision(policy, component, version, artifact_sha, sha, spdx)
    return {"component": component, "version": version, "artifactSha256": artifact_sha, "licenseSha256": sha,
            "spdx": spdx, "path": path, "approvalId": approval, "review": "approved" if approval else "pending"}


def retain_native_licenses(tree, work, policy, candidate, assets, tools=None):
    result = []
    python_sha = candidate["python"]["asset"]["sha256"]
    # Original install-only license and vendor notices are never replaced by
    # external full-archive materials, even when the text appears more permissive.
    tool_python = work / "toolchain/python"
    for entry in inventory(tool_python):
        path = entry["path"]
        if entry["kind"] == "file" and re.search(r"(?:^|/)(?:LICENSE|LICENCE|COPYING|NOTICE|AUTHORS)(?:[./_-]|$)", path, re.I):
            target = "licenses/python-install-only/" + path
            exclusive_bytes(tree / target, (tool_python / path).read_bytes())
            result.append(license_item(policy, "python-build-standalone", "3.13.16", python_sha, target, entry["sha256"]))
    source_assets = candidate["python"].get("licenseSources", [])
    members = [item for item in policy["licenseRequirements"] if item["component"] == "python-build-standalone" and item["member"].startswith("python/")]
    if len(source_assets) != 1:
        raise Invalid("Full PBS license-source asset must be explicitly pinned")
    full = verified_asset(assets, source_assets[0])
    return result + retain_full_licenses(tree, work, policy, candidate, assets, tools)


def retain_license_supplements(tree, work, policy, candidate, assets):
    """Retain reviewed original source bytes; an index never grants distribution rights."""
    supplements = candidate["licenseSupplements"]
    tix = supplements["tix"]
    archive = verified_asset(assets, tix["asset"])
    prefix = tix["archivePrefix"] + "/"
    selected = set()
    for pin in tix["members"]:
        if not pin["sourceMember"].startswith(prefix):
            raise Invalid("Tix source member escapes reviewed archive prefix")
        selected.add(relative(pin["sourceMember"][len(prefix):]))
    extracted = work / "tix-originals"
    safe_extract(archive, extracted, tix["archivePrefix"], selected, allow_links=True)
    tix_rows = []
    for pin in tix["members"]:
        source = extracted / relative(pin["sourceMember"][len(prefix):])
        if source.is_symlink() or not source.is_file() or file_digest(source) != pin["sha256"]:
            raise Invalid("Tix original member differs from reviewed SHA-256")
        raw = source.read_bytes()
        target = relative(pin["target"])
        exclusive_bytes(tree / target, raw)
        tix_rows.append({"sourceMember": pin["sourceMember"], "path": target,
                         "sha256": pin["sha256"], "size": len(raw)})
    libzmq = supplements["libzmq"]
    source = verified_asset(assets, libzmq["asset"])
    libzmq_path = relative(libzmq["target"])
    (tree / libzmq_path).parent.mkdir(parents=True, exist_ok=True)
    copy_asset(source, tree / libzmq_path, libzmq["asset"])
    debugpy = [wheel for wheel in candidate["providers"]["pywencai"]["wheels"]
               if re.sub(r"[-_.]+", "-", wheel["distribution"]).lower() == "debugpy"]
    if len(debugpy) != 1:
        raise Invalid("Readable source notice requires exactly one installed debugpy wheel")
    wheel = debugpy[0]
    debugpy_member = "debugpy/ThirdPartyNotices.txt"
    debugpy_sha = wheel["notices"].get(debugpy_member)
    debugpy_path = "providers/pywencai/site/" + debugpy_member
    if (not isinstance(debugpy_sha, str) or not SHA.fullmatch(debugpy_sha)
            or not (tree / debugpy_path).is_file() or file_digest(tree / debugpy_path) != debugpy_sha):
        raise Invalid("Installed debugpy third-party notice is not original wheel evidence")
    notice_path = relative(supplements["notice"]["target"])
    lines = [
        "RT-ResearchFlow private runtime third-party source and notice index",
        "Candidate evidence only; this index is not a license grant or release approval.",
        "",
        "Tix original notices (not replacements for upstream terms):",
        *[row["path"] + "  SHA-256 " + row["sha256"] for row in tix_rows],
        "",
        "I.2 libzmq reviewed upstream source archive:",
        libzmq_path + "  SHA-256 " + libzmq["asset"]["sha256"],
        "Upstream: " + libzmq["asset"]["url"],
        "Correspondence to bundled binaries and LGPL source/relink conditions remain separate seal gates.",
        "",
        "I.3 xlrd attribution:",
        "This product includes software developed by",
        "David Giffin <david@giffin.org>.",
        "The original xlrd license remains in the installed provider site.",
        "",
        "N.3 debugpy " + wheel["version"] + " third-party notice:",
        debugpy_path + "  SHA-256 " + debugpy_sha,
        "The original includes PyDev.Debugger and other vendor terms; this index does not replace it.",
        "PyDev.Debugger source/build-material availability and distributor obligations remain pending.",
        "No Microsoft postal source offer is made by this application.",
        "",
        "R.4 CPython preparation change summary:",
        "The original PBS interpreter bytes are copied without patching the interpreter binary.",
        "Preparation excludes pip/setuptools/wheel/pkg_resources/ensurepip build tools from the product tree,",
        "and adds separate bootstrap/adapters and independently installed provider sites.",
        "Original PBS license materials remain under licenses/python-full and licenses/python-install-only.",
        "This summary does not close CRT, vendor, source, or redistribution-rights review."]
    notice_bytes = ("\n".join(lines) + "\n").encode("utf-8")
    exclusive_bytes(tree / notice_path, notice_bytes)
    provenance = {"kind": "rt-private-runtime-license-supplement-evidence-v1",
                  "tix": {"sourceAsset": tix["asset"], "members": tix_rows},
                  "libzmq": {"sourceAsset": libzmq["asset"], "path": libzmq_path,
                             "sha256": libzmq["asset"]["sha256"]},
                  "notice": {"path": notice_path, "sha256": digest(notice_bytes),
                             "scope": "readable-index-not-independent-license-grant"},
                  "debugpy": {"version": wheel["version"], "artifactSha256": wheel["asset"]["sha256"],
                              "path": debugpy_path, "sha256": debugpy_sha, "approval": "pending-additional-obligations"}}
    evidence_path = "licenses/supplement-provenance.json"
    exclusive_bytes(tree / evidence_path, encoded(provenance))
    return [], {"path": evidence_path, "sha256": file_digest(tree / evidence_path),
                           "tixOriginalCount": len(tix_rows), "libzmqSourceSha256": libzmq["asset"]["sha256"],
                           "readableNoticeSha256": digest(notice_bytes)}


def retain_limited_purpose_sources(tree, policy, candidate, assets):
    """Keep source/recipe and upstream expressions; scope is not a new license grant."""
    if policy["distributionUseScope"] != REVIEWED_DISTRIBUTION_SCOPE:
        raise Invalid("Distribution use scope changed during materialization")
    wheels = {wheel["distribution"]: wheel for wheel in candidate["providers"]["mootdx"]["wheels"]
              if wheel["distribution"] in LIMITED_PURPOSE_WHEELS}
    if set(wheels) != set(LIMITED_PURPOSE_WHEELS):
        raise Invalid("Reviewed mootdx/tdxpy distribution pair is incomplete")
    originals = {}
    for component, (version, artifact_sha, members) in LIMITED_PURPOSE_WHEELS.items():
        wheel = wheels[component]
        if wheel["version"] != version or wheel["asset"]["sha256"] != artifact_sha:
            raise Invalid("Limited-purpose wheel differs from reviewed artifact")
        verified = {}
        for member, sha in members.items():
            path = "providers/mootdx/site/" + component + "-" + version + ".dist-info/" + member
            if wheel["notices"].get(component + "-" + version + ".dist-info/" + member) != sha or file_digest(tree / path) != sha:
                raise Invalid("Original limited-purpose author/license/description differs")
            verified[member] = {"path": path, "sha256": sha}
        description = (tree / verified["METADATA"]["path"]).read_text(encoding="utf-8")
        if "MIT license" not in description or "本项目只作学习交流, 不得用于任何商业目的" not in description:
            raise Invalid("Original limited-purpose description is missing")
        originals[component] = {"version": version, "artifactSha256": artifact_sha, "originals": verified,
                                "scope": "limited-purpose-review-not-commercial-authorization"}
    mootdx = wheels["mootdx"]
    derived = mootdx.get("derived")
    if not isinstance(derived, dict) or derived["upstreamAsset"]["sha256"] != "eab475f1d08b1c71ea51212c8b1b1038c4739798f7d95ad1a6fb7bb26e348ef2":
        raise Invalid("Derived mootdx upstream source identity differs")
    upstream = derived["upstreamAsset"]
    upstream_path = "licenses/sources/mootdx-0.11.7-py3-none-any.whl"
    copy_asset(verified_asset(assets, upstream), tree / upstream_path, upstream)
    recipe_path = "licenses/sources/build-mootdx-compat-wheel.py"
    bound_source_copy(candidate, derived["recipe"]["path"], tree / recipe_path)
    if file_digest(tree / recipe_path) != derived["recipe"]["sha256"]:
        raise Invalid("Derived mootdx source recipe differs from reviewed recipe")
    originals["mootdx"]["derivedSource"] = {"upstreamPath": upstream_path, "upstreamSha256": upstream["sha256"],
                                              "recipePath": recipe_path, "recipeSha256": derived["recipe"]["sha256"],
                                              "installedChangeRecord": "providers/mootdx/site/mootdx-0.11.7+rt.node.1.dist-info/RT-COMPATIBILITY.json"}
    change = tree / originals["mootdx"]["derivedSource"]["installedChangeRecord"]
    if not change.is_file():
        raise Invalid("Derived mootdx modification record is missing")
    originals["mootdx"]["derivedSource"]["changeRecordSha256"] = file_digest(change)
    return originals


def retain_lxml_redistribution_sources(tree, candidate, assets):
    selected, materials = {}, []
    for provider in candidate.get("providers", {}).values():
        for wheel in provider["wheels"]:
            inputs = wheel.get("nativeBuildInputs") or {}
            if inputs.get("kind") == "rt-lxml-redistribution-inputs-v1":
                native_build_assets(wheel, candidate["target"])
                selected[wheel["asset"]["sha256"]] = inputs
    for sha, inputs in sorted(selected.items()):
        value = inputs["publicSourceAsset"]
        target = "licenses/sources/lxml-redistribution/" + value["filename"]
        destination = tree / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        copy_asset(verified_asset(assets, value), destination, value)
        materials.append({"path": target, "asset": value, "selectedWheelSha256": sha})
    # No original tar, original wheel/proof, or unsanitized full materials enters tree.
    evidence = {"kind": "rt-lxml-matched-public-source-retention-v1", "target": candidate["target"],
                "selectedArtifactSha256": sorted(selected), "retainedMaterials": materials,
                "nativeBuildInputs": selected, "executedThisOperation": False,
                "originalSdistRedistributed": False, "releaseApproval": False,
                "status": "matched-sanitized-sources-retained-license-review-pending"}
    path = "licenses/sources/lxml-redistribution/provenance.json"
    exclusive_bytes(tree / path, encoded(evidence))
    return {**evidence, "path": path, "sha256": file_digest(tree / path), "sourceCount": len(materials)}


def retain_lxml_windows_sources(tree, candidate, assets):
    if any((wheel.get("nativeBuildInputs") or {}).get("kind") == "rt-lxml-redistribution-inputs-v1"
           for provider in candidate.get("providers", {}).values() for wheel in provider["wheels"]):
        return retain_lxml_redistribution_sources(tree, candidate, assets)
    if candidate["target"] != "win32-x64":
        if candidate["lxmlWindowsSourceMaterials"]:
            raise Invalid("Windows-only lxml sources cannot be applied to Mac")
        return {"status": "not-applicable-to-mac"}
    if candidate["lxmlWindowsSourceMaterials"] != REVIEWED_LXML_WINDOWS_SOURCES:
        raise Invalid("Windows lxml source pins changed during materialization")
    members = []
    for item in candidate["lxmlWindowsSourceMaterials"]:
        if item["id"] == "lxml":
            continue  # Original unlicensed sdist is a private build input, never public.
        value = {key: content for key, content in item.items() if key != "id"}
        target = "licenses/sources/lxml-windows/" + item["filename"]
        destination = tree / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        copy_asset(verified_asset(assets, value), destination, value)
        members.append({"id": item["id"], "path": target, "sha256": item["sha256"], "size": item["size"],
                        "url": item["url"]})
    native_inputs = {}
    retained = []
    for provider in candidate.get("providers", {}).values():
        for wheel in provider["wheels"]:
            if wheel.get("nativeBuildInputs") is not None:
                native_build_assets(wheel, candidate["target"])
                native_inputs[wheel["asset"]["sha256"]] = wheel["nativeBuildInputs"]
    for selected_sha, inputs in sorted(native_inputs.items()):
        for value in inputs["assets"]:
            target = "licenses/sources/lxml-windows/" + selected_sha + "/" + value["filename"]
            destination = tree / target
            destination.parent.mkdir(parents=True, exist_ok=True)
            copy_asset(verified_asset(assets, value), destination, value)
            retained.append({"path": target, "asset": value, "selectedWheelSha256": selected_sha})
    evidence = {"kind": "rt-lxml-windows-corresponding-source-inputs-v1", "members": members,
                "reviewReference": "resources/python-runtime/license-review.md#astra-lxml-relink-u-20261009",
                "status": "source-archives-retained-rebuild-relink-not-executed", "releaseApproval": False,
                "retainedNativeInputs": native_inputs, "retainedMaterials": retained,
                "executedThisOperation": False}
    path = "licenses/sources/lxml-windows/provenance.json"
    exclusive_bytes(tree / path, encoded(evidence))
    return {"path": path, "sha256": file_digest(tree / path), "sourceCount": len(members), "status": evidence["status"],
            "selectedArtifactSha256": sorted(native_inputs), "retainedMaterials": retained,
            "executedThisOperation": False, "releaseApproval": False}


def target_license_applicability(tree, policy, candidate, supplement_evidence, limited_purpose, lxml_sources=None):
    """Bind review applicability to actual product files, not historical notice names."""
    baseline = inventory(tree)
    paths = {item["path"]: item for item in baseline if item["kind"] == "file"}
    metadata_path = "licenses/python-full/python/PYTHON.json"
    metadata = json.loads((tree / metadata_path).read_bytes())
    pinned = next(item for item in policy["nativeLicenseInputs"][candidate["target"]]["pythonFull"]["members"]
                  if item["path"] == "python/PYTHON.json")
    if paths[metadata_path]["sha256"] != pinned["sha256"]:
        raise Invalid("Final PYTHON.json differs from reviewed full archive")
    product_paths = [path for path in paths if path.startswith(("python/", "providers/"))]
    bdb_files = [path for path in product_paths if BDB_CODE_PATH.search(path)]
    bdb_build = bdb_build_reference(metadata)
    bdb_absent = not bdb_files and bdb_build is False
    tix_files = [path for path in product_paths if tix_component_path(path)]
    tix_originals = policy["licenseSupplements"]["tix"]["members"]
    if supplement_evidence["tixOriginalCount"] != 3 or any(paths[pin["target"]]["sha256"] != pin["sha256"] for pin in tix_originals):
        raise Invalid("Final Tix original notice set differs from reviewed source")
    if candidate["target"] == "win32-x64" and "python/tcl/tix8.4.3/tix84.dll" not in tix_files:
        raise Invalid("Windows Tix applicability differs from reviewed shipped DLL")
    lxml = [wheel for provider in candidate["providers"].values() for wheel in provider["wheels"]
            if wheel["distribution"] == "lxml"]
    lxml_shas = sorted({wheel["asset"]["sha256"] for wheel in lxml})
    if candidate["target"] == "win32-x64":
        reviewed = sorted({wheel["asset"]["sha256"] for wheel in derived_wheels(policy, candidate["target"])
                           if wheel.get("nativeBuildInputs") is not None and wheel["distribution"] == "lxml"})
        if (reviewed and lxml_shas == reviewed
                and (lxml_sources or {}).get("selectedArtifactSha256") == reviewed
                and (lxml_sources or {}).get("originalSdistRedistributed") is False
                and (lxml_sources or {}).get("retainedMaterials")):
            lxml_status = "windows-selected-native-materials-retained-license-review-pending"
        elif (not reviewed and lxml_shas == ["e477aca0bc0d19f3b4ae9e4f2a1cfd687c31bf772d78734910658186b40b2477"]
              and (lxml_sources or {}).get("sourceCount") == 6):
            lxml_status = "windows-corresponding-sources-retained-relink-pending"
        else:
            lxml_status = "unreviewed-windows-artifact-or-source-set"
    else:
        lxml_status = "independent-mac-review-not-inferred-from-windows"
    report = {"kind": "rt-private-runtime-license-applicability-v1", "target": candidate["target"],
              "reviewReference": REVIEWED_DISTRIBUTION_SCOPE["reviewReference"],
              "preReportInventorySha256": digest(encoded(baseline)),
              "bdb": {"status": "archived-notice-only-not-applicable-to-target-code" if bdb_absent else "target-code-or-build-reference-present-review-pending",
                      "pythonMetadataPath": metadata_path, "pythonMetadataSha256": pinned["sha256"],
                      "implementationPaths": bdb_files, "buildReferencePresent": bdb_build,
                      "debuggerBdbPyIsNotBerkeleyDb": True},
              "tix": {"status": "present-original-terms-retained" if tix_files else "target-code-absent-original-terms-retained",
                      "implementationPaths": tix_files, "originals": [{"path": pin["target"], "sha256": pin["sha256"]} for pin in tix_originals]},
              "lxml": {"status": lxml_status, "artifactSha256": lxml_shas,
                       "windowsReviewNotTransferredToMac": True, "sourceEvidence": lxml_sources,
                       "rebuildRelinkExecuted": False, "executedThisOperation": False},
              "limitedPurpose": {"scope": REVIEWED_DISTRIBUTION_SCOPE, "components": limited_purpose,
                                 "commercialUseAuthorized": False, "wholeProductNoncommercial": False},
              "releaseEligible": False}
    path = "licenses/applicability.json"
    exclusive_bytes(tree / path, encoded(report))
    return {"path": path, "sha256": file_digest(tree / path), "bdbStatus": report["bdb"]["status"],
            "bdbBuildReferencePresent": bdb_build,
            "tixStatus": report["tix"]["status"], "lxmlStatus": lxml_status,
            "scope": REVIEWED_DISTRIBUTION_SCOPE["purpose"]}


def license_applicability_disposition(row, policy, target, python_asset_sha, evidence, ledger):
    """Close only exact retained-notice/applicability rows; never manufacture an approval ID."""
    paths = {item["path"]: item for item in ledger if item["kind"] == "file"}
    marker = paths.get(evidence.get("path"))
    if not marker or marker["sha256"] != evidence.get("sha256"):
        return None
    if row["approvalId"] is not None or paths.get(row["path"], {}).get("sha256") != row["licenseSha256"]:
        return None
    if row["component"] == "python-build-standalone" and row["artifactSha256"] == python_asset_sha:
        if row["path"].endswith("/LICENSE.bdb.txt") and evidence.get("bdbStatus") == "archived-notice-only-not-applicable-to-target-code":
            product = (path for path in paths if path.startswith(("python/", "providers/")))
            if evidence.get("bdbBuildReferencePresent") is False and not any(BDB_CODE_PATH.search(path) for path in product):
                return "not-applicable-to-target-code"
        if row["path"].endswith("/LICENSE.tix.txt") and evidence.get("tixStatus") in {"present-original-terms-retained", "target-code-absent-original-terms-retained"}:
            pins = policy["licenseSupplements"]["tix"]["members"]
            if all(paths.get(pin["target"], {}).get("sha256") == pin["sha256"] for pin in pins):
                product_tix = any(tix_component_path(path) for path in paths if path.startswith(("python/", "providers/")))
                if product_tix == (evidence["tixStatus"] == "present-original-terms-retained") and (target != "win32-x64" or "python/tcl/tix8.4.3/tix84.dll" in paths):
                    return "original-terms-retained" if evidence["tixStatus"] == "present-original-terms-retained" else "not-applicable-to-target-code"
    if row["component"] in LIMITED_PURPOSE_WHEELS and evidence.get("scope") == REVIEWED_DISTRIBUTION_SCOPE["purpose"]:
        version, artifact, members = LIMITED_PURPOSE_WHEELS[row["component"]]
        prefix = "providers/mootdx/site/" + row["component"] + "-" + version + ".dist-info/"
        if row["version"] == version and row["artifactSha256"] == artifact and all(
                paths.get(prefix + name, {}).get("sha256") == sha for name, sha in members.items()):
            if any(row["path"] == prefix + name and row["licenseSha256"] == sha for name, sha in members.items()):
                return "limited-purpose-originals-retained-not-commercial-approval"
    return None


SMOKE_NETWORK_GUARD = r'''
import socket,sys
def denied(*args,**kwargs):raise RuntimeError('Python socket API disabled during candidate smoke')
for name in ('getaddrinfo','gethostbyname','gethostbyname_ex','gethostbyaddr','create_connection'):
 setattr(socket,name,denied)
for name in ('connect','connect_ex','sendto','sendmsg'):
 if hasattr(socket.socket,name):setattr(socket.socket,name,denied)
def socket_audit(event,args):
 if event in ('socket.getaddrinfo','socket.gethostbyname','socket.gethostbyaddr','socket.connect','socket.sendto'):denied()
sys.addaudithook(socket_audit)
'''


def basic_native_evidence(tree, tools, work, target="win32-x64", candidate=None):
    code = SMOKE_NETWORK_GUARD + r'''
import importlib,json,pathlib,socket,subprocess,sys
tree=pathlib.Path(sys.argv[1])
provider=sys.argv[2];site=tree/'providers'/provider/'site'
sys.path[:]=[str(site)]+[p for p in sys.path if 'site-packages' not in p.lower()]
binding=json.loads(pathlib.Path(sys.argv[3]).read_bytes())
adapter_path=tree/'miniracer_unicode_adapter.py'
adapter={'__name__':'rt_native_provider_adapter','__file__':str(adapter_path)}
exec(compile(adapter_path.read_bytes(),str(adapter_path),'exec'),adapter)
bootstrap_path=tree/'bootstrap.py'
bootstrap={'__name__':'rt_native_bootstrap_core','__file__':str(bootstrap_path)}
exec(compile(bootstrap_path.read_bytes(),str(bootstrap_path),'exec'),bootstrap)
result={'provider':provider,'pythonSocketGuarded':True,'networkSandboxVerified':False,
        'networkIsolationScope':'Python socket APIs only; native code and Node are not OS-network-sandboxed',
        'requestScope':'imports and local evaluation only; no provider request API invoked',
        'formalBootstrapTested':False}
try:
 if provider in ('akshare','mootdx'):
  result['privateNodeBackend']=adapter['prepare_site'](
   provider,site,tree,{row['path']:row for row in binding['files']},binding['wheels'],binding['node'],
   windows_job_factory=bootstrap['windows_job'] if sys.platform=='win32' else None)
 module=importlib.import_module(provider);result['imported']=True
 if provider=='akshare':
  import jsonpath
  result['zeroVolumePreserved']=jsonpath.jsonpath({'volume':0},'$.volume')==[0]
  if not result['zeroVolumePreserved']:raise ValueError('zero volume lost')
 if provider=='pywencai':
  import execjs
  runtime=execjs.get('Node');result['privateNodeEval']=runtime.eval('40+2')
  if result['privateNodeEval']!=42:raise ValueError('Node smoke failed')
finally:
 adapter['close_provider_engines']()
result['ownedProviderEnginesClosed']=True
print(json.dumps(result))
'''
    if candidate is None:
        raise Invalid("Native provider smoke requires its actual candidate bindings")
    ledger = inventory(tree)
    node_binding = {**candidate["node"], "executable": "node/node.exe" if target == "win32-x64" else "node/bin/node"}
    original_path = os.environ.get("PATH", "")
    result = {}
    for provider in PROVIDERS:
        env = controlled_environment(work)
        node = node_executable(tree / "node", target)
        env["PATH"] = str(node.parent) + os.pathsep + (str(Path(env.get("SystemRoot", "C:/Windows")) / "System32") if target == "win32-x64" else "/usr/bin:/bin")
        binding_path = work / (provider + "-engine-input.json")
        exclusive_bytes(binding_path, encoded({"files": ledger, "node": node_binding,
                                             "wheels": candidate["providers"][provider]["wheels"]}))
        command = [str(python_executable(tree / "python", target)), "-X", "utf8", "-B", "-I", "-S", "-c",
                   code, str(tree), provider, str(binding_path)]
        completed = bounded_process(command, work, timeout=120, env=env)
        exclusive_bytes(work / (provider + "-import-evidence.json"), encoded({"exit": completed.returncode, "stdout": completed.stdout, "stderr": completed.stderr}))
        if completed.returncode:
            raise Invalid("Fresh product Python offline provider import/private Node smoke failed")
        result[provider] = json.loads(completed.stdout)
    if os.environ.get("PATH", "") != original_path:
        raise Invalid("Preparation mutated parent PATH")
    result["nodeVersion"] = run([str(node_executable(tree / "node", target)), "--version"], work, 30).strip()
    if result["nodeVersion"] != "v22.23.3":
        raise Invalid("Private Node version differs from policy")
    return result


def candidate_sbom(candidate, licenses):
    packages = []
    for provider, lock in candidate["providers"].items():
        for wheel in lock["wheels"]:
            packages.append({"SPDXID": "SPDXRef-" + digest((provider + wheel["distribution"]).encode())[:16],
                             "name": wheel["distribution"], "versionInfo": wheel["version"],
                             "downloadLocation": wheel["asset"].get("url", "NOASSERTION"),
                             "checksums": [{"algorithm": "SHA256", "checksumValue": wheel["asset"]["sha256"]}],
                             "filesAnalyzed": False, "licenseConcluded": "NOASSERTION", "licenseDeclared": "NOASSERTION",
                             "copyrightText": "NOASSERTION"})
    for component in ("python", "node"):
        value = candidate[component]
        packages.append({"SPDXID": "SPDXRef-" + component, "name": component, "versionInfo": value["version"],
                         "downloadLocation": value["asset"]["url"], "filesAnalyzed": False,
                         "checksums": [{"algorithm": "SHA256", "checksumValue": value["asset"]["sha256"]}],
                         "licenseConcluded": "NOASSERTION", "licenseDeclared": "NOASSERTION", "copyrightText": "NOASSERTION"})
    for name, version in (("tix", "8.4.3.6"), ("libzmq", "4.3.5")):
        supplement = candidate.get("licenseSupplements", {}).get(name)
        if supplement:
            value = supplement["asset"]
            packages.append({"SPDXID": "SPDXRef-source-" + name, "name": name + " reviewed source archive",
                             "versionInfo": version, "downloadLocation": value["url"], "filesAnalyzed": False,
                             "checksums": [{"algorithm": "SHA256", "checksumValue": value["sha256"]}],
                              "licenseConcluded": "NOASSERTION", "licenseDeclared": "NOASSERTION", "copyrightText": "NOASSERTION"})
    for item in candidate.get("lxmlWindowsSourceMaterials", []):
        if item["id"] == "lxml":
            continue
        packages.append({"SPDXID": "SPDXRef-source-lxml-" + item["id"], "name": "lxml Windows source input " + item["id"],
                         "versionInfo": "NOASSERTION", "downloadLocation": item["url"], "filesAnalyzed": False,
                         "checksums": [{"algorithm": "SHA256", "checksumValue": item["sha256"]}],
                         "licenseConcluded": "NOASSERTION", "licenseDeclared": "NOASSERTION", "copyrightText": "NOASSERTION"})
    native_inputs = {}
    for provider in candidate["providers"].values():
        for wheel in provider["wheels"]:
            values = native_build_assets(wheel, candidate["target"])
            if (wheel.get("nativeBuildInputs") or {}).get("kind") == "rt-lxml-redistribution-inputs-v1":
                values = [wheel["nativeBuildInputs"]["publicSourceAsset"]]
            for value in values:
                native_inputs[value["sha256"]] = value
    for sha, value in sorted(native_inputs.items()):
        packages.append({"SPDXID": "SPDXRef-native-input-" + sha, "name": value["filename"],
                         "versionInfo": "NOASSERTION", "downloadLocation": "NOASSERTION", "filesAnalyzed": False,
                         "checksums": [{"algorithm": "SHA256", "checksumValue": sha}],
                         "licenseConcluded": "NOASSERTION", "licenseDeclared": "NOASSERTION", "copyrightText": "NOASSERTION"})
    return {"spdxVersion": "SPDX-2.3", "dataLicense": "CC0-1.0", "SPDXID": "SPDXRef-DOCUMENT",
            "name": "RT private Python candidate (not release eligible)",
            "documentNamespace": "https://spdx.org/spdxdocs/rt-candidate-" + candidate["sourceSha256"],
            "creationInfo": {"created": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "creators": ["Tool: RT-ResearchFlow-private-runtime-preparation"]},
            "packages": packages, "comment": "License/vendor obligations remain pending; native smoke is not full product bootstrap acceptance."}


def seal(policy, policy_sha, fragment_paths):
    result = candidate_base("rt-private-python-seal-report", policy_sha)
    fragments = [json.loads(Path(path).read_bytes()) for path in fragment_paths]
    targets = [fragment.get("target") for fragment in fragments]
    if len(targets) != 3 or set(targets) != set(TARGETS):
        result["pending"].append("All three distinct native candidate fragments are required")
    source_commits = {fragment.get("sourceCommit") for fragment in fragments}
    if len(source_commits) != 1 or not re.fullmatch(r"[a-f0-9]{40}", str(next(iter(source_commits), None))):
        raise Invalid("Fragments must share one reviewed source commit")
    for fragment in fragments:
        if fragment.get("kind") != "rt-private-python-candidate-fragment" or fragment.get("preparationPolicySha256") != policy_sha:
            raise Invalid("Fragment kind/policy binding differs")
        for item in fragment.get("metadataProvenance", []):
            role = metadata_role(policy, item["component"], item["version"], item["artifactSha256"],
                                 item["path"], item["metadataSha256"])
            if role is None or any(item.get(key) != value for key, value in role.items()) or item.get("installedMetadataVerified") is not True:
                raise Invalid("Metadata provenance is not the exact reviewed installed record")
        if fragment.get("pending") or fragment.get("treeComplete") is not True or not fragment.get("nativeEvidence"):
            result["pending"].append("Native tree and evidence are incomplete: " + str(fragment.get("target")))
        requirements = fragment.get("licenseRequirements")
        if not requirements:
            result["pending"].append("Applicable license/notice inventory is missing")
        for item in requirements or []:
            approval = license_decision(policy, item["component"], item["version"], item["artifactSha256"], item["licenseSha256"], item["spdx"])
            applicability = fragment.get("licenseApplicabilityEvidence") or {}
            disposition = license_applicability_disposition(item, policy, fragment.get("target"),
                (fragment.get("toolchain") or {}).get("pythonAssetSha256"), applicability, fragment.get("inventory") or [])
            if not ((approval and approval == item.get("approvalId")) or
                    (not approval and item.get("approvalId") is None and disposition and item.get("review") == disposition)):
                result["pending"].append("License approval is pending or rejected: " + item["component"])
    result["pending"].append("Formal schema/assembler and full manifest bootstrap integration must be handed over before seal")
    result["pending"] = sorted(set(result["pending"]))
    return result


def prepare(policy, policy_sha, target, work_root, operation_input=None):
    """One native entry point; real resolver then fresh offline materialization.

    The same raw public policy is used on every host. Local caches and checkout
    receipts remain separately bound operational inputs, never source approval.
    A failed phase leaves its actual evidence, not a fabricated complete report.
    """
    result = candidate_base("rt-private-python-preparation-handoff", policy_sha, target)
    result["pending"] = pending_inputs(policy, target)
    if result["pending"]:
        return result
    if native_target() != target:
        raise Invalid("Preparation must run on its matching native host")
    load_operations(operation_input, policy_sha, target, work_root)
    work = fresh_work(work_root, policy)
    lock = resolve(policy, policy_sha, target, work / "resolve", operation_input)
    lock_path = work / "candidate-lock.json"
    exclusive_bytes(lock_path, encoded(lock))
    result["lock"] = {"path": str(lock_path), "sha256": file_digest(lock_path)}
    if lock["status"] != "candidate":
        result["pending"] = lock["pending"]
        return result
    fragment = materialize(policy, policy_sha, lock_path, work / "resolve/assets",
                           work / "materialize", operation_input)
    if (fragment["status"] != "candidate" or fragment.get("treeComplete") is not True
            or fragment["inputLockSha256"] != result["lock"]["sha256"]
            or fragment["preparationPolicySha256"] != policy_sha
            or lock["sourceSnapshot"] != fragment["sourceSnapshot"]
            or lock["sourceSnapshot"] != source_snapshot(policy_sha)
            or lock["sourceSha256"] != fragment["sourceSha256"]):
        raise Invalid("Preparation phases do not bind the same actual policy/source/lock")
    fragment_path = work / "candidate-fragment.json"
    exclusive_bytes(fragment_path, encoded(fragment))
    licenses = fragment["licenseRequirements"]
    def pending_license(row):
        return row.get("review", "approved" if row.get("approvalId") else "pending") == "pending"
    unique_pending = {(row["component"], row["version"], row["artifactSha256"], row["licenseSha256"])
                      for row in licenses if pending_license(row)}
    result.update(status="candidate", resolutionComplete=True, treeComplete=True,
                  fragment={"path": str(fragment_path), "sha256": file_digest(fragment_path)},
                  treeRoot=fragment["treeRoot"], sourceSha256=fragment["sourceSha256"],
                  sourceEvidence=fragment["sourceEvidence"],
                  sourceCommit=fragment.get("sourceCommit"), providers=fragment["providers"],
                    licenseSummary={"usageCount": len(licenses), "pendingUsageCount": sum(pending_license(row) for row in licenses),
                                   "pendingUniqueDigestCount": len(unique_pending),
                                   "metadataProvenanceUsageCount": len(fragment.get("metadataProvenance", [])),
                                   "matchedApprovalIds": sorted({row["approvalId"] for row in licenses if row.get("approvalId")})},
                  nativeEvidence=fragment["nativeEvidence"], pending=fragment["pending"],
                  scope="actual native resolve/offline materialize; not formal bootstrap, license approval or release seal")
    return result


def matching_native_build_history(policy, target, original_sha):
    """Do not transfer local/native build provenance to a different cloud artifact."""
    for item in policy["targets"][target].get("derivedWheels", []):
        if item["distribution"] != "lxml":
            continue
        history = item.get("nativeBuildInputs") or {}
        if history.get("defaultProductAssetSha256") == original_sha:
            return history
        if (history.get("kind") == "rt-lxml-redistribution-inputs-v1"
                and history.get("originalWheelAsset", {}).get("sha256") == original_sha):
            return history.get("historicalNativeBuildInputs")
    return None

def redistribution_asset_directory(root, target, role):
    root = Path(root)
    if (root / "assets").is_dir():
        return root / "assets"
    if (root / target / role).is_dir():
        return root / target / role
    return root / role


def redistribution_official_directory(root, original_cache, official_inputs=None):
    if official_inputs is not None:
        return Path(official_inputs)
    root = Path(root)
    if (root / "official-inputs").is_dir():
        return root / "official-inputs"
    if (root / "inputs").is_dir():
        return root / "inputs"
    return Path(original_cache)


def redistribution_consumer_handoff(contract, asset_root, original_cache, official_inputs=None, target=None):
    """Consume independently pinned consumer JSON; local paths/verified flags confer no authority."""
    selected = (target,) if target is not None else TARGETS
    if target is not None and target not in TARGETS:
        raise Invalid("Unknown redistribution target")
    outputs = contract.get("derivedOutputs", [])
    if (len(outputs) != len(TARGETS) * 2
            or {(item.get("target"), item.get("role")) for item in outputs}
                != {(name, role) for name in TARGETS for role in ("source", "wheel")}):
        raise Invalid("Exact three-target consumer output pins are required")
    pins = contract.get("checkoutFilePins", [])
    for pin in pins:
        path = ROOT / relative(pin["path"])
        if (path.is_symlink() or not path.is_file() or path.stat().st_size != pin["size"]
                or file_digest(path) != pin["sha256"]):
            raise Invalid("Consumer checkout source bytes differ")
    mapped = {"kind": "rt-lxml-redistribution-handoff-v1", "ISO_SchematronProvided": False,
              "noOriginalWheelReproductionClaim": True, "sourceFilePins": pins,
              "outputs": {}, "inputs": {}}
    official_dir = redistribution_official_directory(asset_root, original_cache, official_inputs)
    for name in selected:
        pair = {item["role"]: {key: item[key] for key in ("kind", "filename", "size", "sha256")}
                for item in outputs if item["target"] == name}
        source = verified_asset(redistribution_asset_directory(asset_root, name, "source"), pair["source"])
        wheel = verified_asset(redistribution_asset_directory(asset_root, name, "wheel"), pair["wheel"])
        with zipfile.ZipFile(source) as archive:
            source_manifest = json.loads(archive.read("RT_PUBLIC_SOURCE_MANIFEST.json"))
        with zipfile.ZipFile(wheel) as archive:
            facts = read_wheel(wheel)
            proof = json.loads(archive.read("lxml-" + facts["version"] + ".dist-info/RT_REDISTRIBUTION.json"))
        if (source_manifest.get("kind") != "rt-lxml-matched-public-source-v1"
                or source_manifest.get("target") != name
                or source_manifest.get("isoSchematronProvided") is not False
                or source_manifest.get("nativeRecompiled") is not False
                or source_manifest.get("originalLxmlSdistRedistributed") is not False
                or proof.get("kind") != "rt-lxml-redistribution-wheel-v1"
                or proof.get("target") != name or proof.get("isoSchematronProvided") is not False
                or proof.get("nativeRecompiled") is not False
                or proof.get("publicSource") != {**{key: pair["source"][key] for key in ("filename", "sha256", "size")},
                    "target": name, "originalWheelSha256": source_manifest.get("originalWheelSha256")}
                or proof.get("distributionVersion") != facts["version"]
                or source_manifest.get("matchedDistributionVersion") != facts["version"]
                or proof.get("originalWheelSha256") != source_manifest.get("originalWheelSha256")
                or proof.get("excludedNamespace") != "lxml/isoschematron/**"
                or source_manifest.get("excludedNamespace") != proof["excludedNamespace"]):
            raise Invalid("Consumer matched public source/wheel identity differs")
        for key, value in (("distributionVersion", facts["version"]),
                           ("nativeRuntimeVersion", proof["nativeRuntimeVersion"]),
                           ("excludedNamespace", proof["excludedNamespace"])):
            if key in mapped and mapped[key] != value:
                raise Invalid("Consumer target identities conflict")
            mapped[key] = value
        if name == "win32-x64":
            cloud = contract["cloudInput"]
            members = cloud["downloadedMembers"]
            originals = [(member, value) for member, value in members.items() if member.endswith(".whl")]
            if len(originals) != 1:
                raise Invalid("Exactly one hosted baseline wheel is required")
            member, pin = originals[0]
            if relative(member) != member or not member.startswith("b/") or "/" in member[2:]:
                raise Invalid("Hosted baseline member path differs")
            filename = member[2:]
            original = {"kind": "derived", "filename": filename, **pin}
            verified_asset(Path(original_cache), original)
            archive_pin = source_manifest["originalArchive"]
            if members.get("b/" + archive_pin["filename"]) != {key: archive_pin[key] for key in ("sha256", "size")}:
                raise Invalid("Hosted source archive differs from consumer pin")
            verified_asset(Path(original_cache), {"kind": "derived", **archive_pin})
            origin = {key: cloud[key] for key in ("repository", "runId", "jobId", "artifactId",
                        "artifactHeadSha", "artifactName", "archiveSha256", "archiveSize")}
        else:
            originals = [item for item in contract["officialMacInputs"] if item.get("target") == name]
            if len(originals) != 1:
                raise Invalid("Exactly one official original target wheel is required")
            original = {"kind": "download", **{key: originals[0][key] for key in ("filename", "sha256", "size", "url")}}
            verified_asset(official_dir, original)
            filename = original["filename"]
            origin = {"kind": "official-pypi", "url": original["url"]}
        if original["sha256"] != source_manifest["originalWheelSha256"]:
            raise Invalid("Consumer original wheel differs from public-source binding")
        mapped["inputs"][name] = {"filename": filename, "sha256": original["sha256"], "origin": origin}
        mapped["outputs"][name] = {**pair, "nativeMemberPins": proof["nativeMemberPins"]}
    return mapped


def map_lxml_redistribution_policy(policy, handoff, asset_root, original_cache, official_inputs=None, target=None):
    """Map independently supplied exact Hubble pins; never invent license approvals."""
    selected = (target,) if target is not None else TARGETS
    if "derivedOutputs" in handoff:
        handoff = redistribution_consumer_handoff(handoff, asset_root, original_cache, official_inputs, target)
    if (handoff.get("kind") != "rt-lxml-redistribution-handoff-v1"
            or handoff.get("ISO_SchematronProvided") is not False
            or handoff.get("noOriginalWheelReproductionClaim") is not True
            or set(handoff.get("outputs", {})) != set(selected)):
        raise Invalid("Incomplete exact redistribution handoff")
    result = json.loads(json.dumps(policy))
    pins = {}
    for record in handoff["sourceFilePins"]:
        if record["path"] in RECIPES:
            pin = {"path": record["path"], "sha256": record["sha256"]}
            if file_digest(ROOT / relative(record["path"])) != pin["sha256"]:
                raise Invalid("Handoff recipe source bytes changed")
            pins[pin["path"]] = pin
    for path in ("scripts/build-lxml-redistribution-wheel.py", "scripts/build-lxml-matched-public-source.py"):
        if path not in pins:
            raise Invalid("Both exact redistribution recipes are required")
    result["recipePins"] = [pin for pin in result["recipePins"] if pin["path"] not in pins] + list(pins.values())
    upstream = next({key: value for key, value in item.items() if key != "id"}
                    for item in policy["lxmlWindowsSourceMaterials"] if item["id"] == "lxml")
    for target in selected:
        output = handoff["outputs"][target]
        wheel_path = verified_asset(redistribution_asset_directory(asset_root, target, "wheel"), output["wheel"])
        source_path = verified_asset(redistribution_asset_directory(asset_root, target, "source"), output["source"])
        actual = read_wheel(wheel_path)
        if actual["distribution"].lower() != "lxml" or actual["version"] != handoff["distributionVersion"]:
            raise Invalid("Handoff selected distribution differs from actual wheel")
        with zipfile.ZipFile(source_path) as archive:
            source_manifest = json.loads(archive.read("RT_PUBLIC_SOURCE_MANIFEST.json"))
        original_record = handoff["inputs"][target]
        original_path = (Path(original_cache) if target == "win32-x64" else redistribution_official_directory(asset_root, original_cache, official_inputs)) / original_record["filename"]
        if (original_path.is_symlink() or file_digest(original_path) != original_record["sha256"]
                or source_manifest.get("originalWheelSha256") != original_record["sha256"]
                or source_manifest.get("target") != target
                or source_manifest.get("originalLxmlSdistRedistributed") is not False):
            raise Invalid("Original/matched public source identity differs")
        original = {"kind": "derived", "filename": original_record["filename"] + ".proof",
                    "size": original_path.stat().st_size, "sha256": original_record["sha256"]}
        original_source = source_manifest["originalArchive"]
        if target == "win32-x64":
            original_source = {"kind": "derived", **original_source}
            verified_asset(Path(original_cache), original_source)
        else:
            if original_source["sha256"] != upstream["sha256"] or original_source["size"] != upstream["size"]:
                raise Invalid("Mac original source identity differs")
            original_source = upstream
        previous = matching_native_build_history(policy, target, original_record["sha256"])
        with zipfile.ZipFile(wheel_path) as archive:
            notices = [{"path": name, "sha256": sha, "size": len(archive.read(name))}
                       for name, sha in actual["notices"].items()]
        wheel = {**actual, "licenses": [], "asset": output["wheel"],
                 "derived": {"id": "rt-lxml-redistribution-v1-" + target,
                             "upstreamVersion": handoff["nativeRuntimeVersion"],
                             "upstreamSha256": upstream["sha256"], "upstreamAsset": upstream,
                             "patchSha256": pins["scripts/build-lxml-redistribution-wheel.py"]["sha256"],
                             "recipe": pins["scripts/build-lxml-redistribution-wheel.py"]},
                 "nativeBuildInputs": {"kind": "rt-lxml-redistribution-inputs-v1", "target": target,
                    "selectedAssetSha256": output["wheel"]["sha256"], "publicSourceAsset": output["source"],
                    "originalWheelAsset": original, "originalWheelFilename": original_record["filename"],
                    "originalWheelOrigin": original_record["origin"], "originalSourceAsset": original_source,
                    "sourceRecipe": pins["scripts/build-lxml-matched-public-source.py"],
                    "nativeMemberPins": output["nativeMemberPins"], "noticePins": notices,
                    "nativeRuntimeVersion": handoff["nativeRuntimeVersion"], "nativeRecompiled": False,
                    "windowsInputProfile": source_manifest.get("windowsInputProfile", "local-lx3"),
                    "originalSdistRedistributed": False, "excludedNamespace": handoff["excludedNamespace"],
                    "historicalNativeBuildInputs": previous,
                    "historicalRecipesExecutableThisOperation": False}}
        wheel_contract(wheel, result)
        result["targets"][target]["derivedWheels"] = [
            item for item in result["targets"][target].get("derivedWheels", []) if item["distribution"] != "lxml"] + [wheel]
        for index, notice in enumerate(notices):
            if notice["path"].endswith(".dist-info/METADATA"):
                for provider in PROVIDERS:
                    record = {"component": "lxml", "version": actual["version"],
                              "artifactSha256": wheel["asset"]["sha256"], "metadataSha256": notice["sha256"],
                              "path": "providers/" + provider + "/site/" + notice["path"],
                              "role": "provenance-and-license-reference", "decision": "not-an-independent-license-grant"}
                    if record not in result["metadataProvenance"]:
                        result["metadataProvenance"].append(record)
            else:
                key = ("lxml", actual["version"], wheel["asset"]["sha256"], notice["sha256"])
                if not any((row["component"], row["version"], row["artifactSha256"], row["licenseSha256"]) == key
                           for row in result["licenseApprovals"]):
                    result["licenseApprovals"].append({"id": "lxml-redistribution-" + target + "-" + str(index),
                        "component": key[0], "version": key[1], "artifactSha256": key[2], "licenseSha256": key[3],
                        "spdx": "NOASSERTION", "decision": "pending"})
    return result


def cache_lxml_redistribution_inputs(policy, asset_root, original_cache, output, official_inputs=None, target=None):
    """Fresh caller-owned private cache; original unlicensed bytes never enter product."""
    output = owned_path(output)
    if output.exists() or output.is_symlink():
        raise Invalid("Redistribution input cache must be fresh")
    inputs = {}
    official_dir = redistribution_official_directory(asset_root, original_cache, official_inputs)
    for target in ((target,) if target is not None else TARGETS):
        wheel = next(item for item in derived_wheels(policy, target) if item["distribution"] == "lxml")
        native = wheel["nativeBuildInputs"]
        entries = [(wheel["asset"], redistribution_asset_directory(asset_root, target, "wheel") / wheel["asset"]["filename"]),
                   (native["publicSourceAsset"], redistribution_asset_directory(asset_root, target, "source") / native["publicSourceAsset"]["filename"]),
                   (native["originalWheelAsset"], (Path(original_cache) if target == "win32-x64" else official_dir) / native["originalWheelFilename"]),
                   (native["originalSourceAsset"], (Path(original_cache) if target == "win32-x64" else official_dir) / native["originalSourceAsset"]["filename"]),
                   (wheel["derived"]["upstreamAsset"], official_dir / wheel["derived"]["upstreamAsset"]["filename"])]
        for value, source in entries:
            asset(value)
            if (source.is_symlink() or not source.is_file()
                    or source.stat().st_size != value["size"] or file_digest(source) != value["sha256"]):
                raise Invalid("Actual redistribution input bytes differ")
            if value["filename"] in inputs and inputs[value["filename"]][0] != value:
                raise Invalid("Redistribution input filenames conflict")
            inputs[value["filename"]] = (value, source)
    output.mkdir(parents=True)
    for value, source in inputs.values():
        copy_asset(source, output / value["filename"], value)
    return {"schemaVersion": 1, "kind": "rt-private-runtime-operation-input-v1",
            "cacheRoots": [str(output)], "seedReports": {}, "sourceReceipt": None}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    operation_parser = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
    operation_parser.add_argument("--operation-input")
    if sum(item.split("=", 1)[0] == "--operation-input" for item in argv) > 1:
        operation_parser.error("Duplicate operation input")
    operation_args, argv = operation_parser.parse_known_args(argv)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation-input", help="Non-authorizing read-only cache/seed/checkout receipt JSON; resolve/materialize/prepare only")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("resolve", "materialize", "prepare", "seal"):
        command = commands.add_parser(name)
        command.add_argument("--policy", type=Path, required=True)
        command.add_argument("--out", type=Path, required=True)
        if name != "seal":
            command.add_argument("--operation-input", help="Non-authorizing local cache/seed/source input; accepted before or after the subcommand")
            command.add_argument("--work-root", type=Path, required=True)
        if name in ("resolve", "prepare"):
            command.add_argument("--target", choices=TARGETS, required=True)
        elif name == "materialize":
            command.add_argument("--candidate-lock", type=Path, required=True)
            command.add_argument("--assets", type=Path, required=True)
        else:
            command.add_argument("--fragments", type=Path, nargs="+", required=True)
    mapping = commands.add_parser("map-lxml-redistribution")
    mapping.add_argument("--policy", type=Path, required=True)
    mapping.add_argument("--handoff", type=Path, required=True)
    mapping.add_argument("--handoff-sha256", required=True)
    mapping.add_argument("--asset-root", type=Path, required=True)
    mapping.add_argument("--original-cache", type=Path, required=True)
    mapping.add_argument("--official-inputs", type=Path)
    mapping.add_argument("--target", choices=TARGETS)
    mapping.add_argument("--out", type=Path, required=True)
    mapping.add_argument("--input-cache", type=Path)
    mapping.add_argument("--operation-out", type=Path)
    args = parser.parse_args(argv)
    args.operation_input = operation_args.operation_input
    try:
        if args.command == "seal" and args.operation_input is not None:
            raise Invalid("Seal cannot consume operation input")
        policy, policy_sha = load_policy(args.policy)
        out = owned_path(args.out)
        if out.exists() or out.is_symlink() or not out.parent.is_dir():
            raise Invalid("Report output must be fresh, with an existing owned parent")
        if args.command == "map-lxml-redistribution":
            raw_handoff = args.handoff.read_bytes()
            if not SHA.fullmatch(args.handoff_sha256) or digest(raw_handoff) != args.handoff_sha256:
                raise Invalid("Independent redistribution handoff digest mismatch")
            report = map_lxml_redistribution_policy(policy, json.loads(raw_handoff),
                                                     args.asset_root, args.original_cache, args.official_inputs, args.target)
            if bool(args.input_cache) != bool(args.operation_out):
                raise Invalid("Input cache and operation output must be provided together")
            if args.input_cache:
                operation_out = owned_path(args.operation_out)
                if operation_out.exists() or operation_out.is_symlink() or not operation_out.parent.is_dir():
                    raise Invalid("Operation output must be fresh")
                operations = cache_lxml_redistribution_inputs(report, args.asset_root, args.original_cache, args.input_cache, args.official_inputs, args.target)
                exclusive_bytes(operation_out, encoded(operations))
        elif args.command == "resolve":
            report = resolve(policy, policy_sha, args.target, args.work_root, args.operation_input)
        elif args.command == "materialize":
            report = materialize(policy, policy_sha, args.candidate_lock, args.assets, args.work_root, args.operation_input)
        elif args.command == "prepare":
            report = prepare(policy, policy_sha, args.target, args.work_root, args.operation_input)
        else:
            if args.policy.resolve() != POLICY_PATH.resolve():
                raise Invalid("Seal must use the fixed repository preparation policy")
            report = seal(policy, policy_sha, args.fragments)
        with out.open("xb") as handle:
            handle.write(encoded(report))
        if args.command == "map-lxml-redistribution":
            print("PRIVATE_RUNTIME_POLICY_MAPPED_LICENSE_APPROVAL_UNCHANGED")
            return 0
        print("PRIVATE_RUNTIME_PENDING" if report["status"] == "pending" else "PRIVATE_RUNTIME_CANDIDATE")
        return 2 if report["status"] == "pending" else 0
    except Pending:
        print("PRIVATE_RUNTIME_PENDING", file=sys.stderr)
        return 2
    except (Invalid, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print("PRIVATE_RUNTIME_INVALID", file=sys.stderr)
        # Static source locations only: exception messages may contain private inputs.
        locations = []
        trace = error.__traceback__
        while trace is not None:
            if trace.tb_frame.f_code.co_filename == __file__:
                locations.append(trace.tb_lineno)
            trace = trace.tb_next
        error_type = type(error).__name__
        if not error_type.isascii() or not error_type.isidentifier() or len(error_type) > 64:
            error_type = "Invalid"
        print(json.dumps({"kind": "rt-private-runtime-safe-failure-v1",
                          "command": args.command, "errorType": error_type,
                          "sourceLines": locations[-16:]}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
