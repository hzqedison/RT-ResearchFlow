"""Auditable MiniRacer 0.12.4 prewarm for one isolated provider subprocess.

Only the two V8 data filenames are made relative during the first context.
No dependency files are rewritten; no network, short-path or interpreter fallback.
"""

import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import threading


VERSION = "0.12.4"
STRATEGY = "win32-unicode-resource-prewarm-v1"
ADAPTER_NAME = "miniracer_unicode_adapter.py"
DATA_RESOURCES = frozenset(("icudtl.dat", "snapshot_blob.bin"))
HOLIDAY_DECODER_SHA256 = "747f81200875edb1ee6f79640f87f9e96fd7077b6b9b129beffcba322102a9ae"
HOLIDAY_FIXTURES = (("LC/AAAAAAA", ["1990-12-19"]), ("LC/BAABAAA", ["1990-12-20"]))
ICU_PROBE_JS = r'''(function () {
    var date = new Intl.DateTimeFormat("zh-CN", {timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit"});
    var parts = date.formatToParts(new Date(Date.UTC(2024, 0, 2)));
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    var sort = new Intl.Collator("zh-CN");
    return date.resolvedOptions().locale.toLowerCase().indexOf("zh") === 0 &&
        sort.resolvedOptions().locale.toLowerCase().indexOf("zh") === 0 &&
        values.year === "2024" && values.month === "01" && values.day === "02" &&
        sort.compare("\u963f", "\u4e2d") < 0;
})()'''


def invalid():
    raise RuntimeError("PRIVATE_MINIRACER_ADAPTER_INVALID")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return value.lower().replace("_", "-").replace(".", "-")


def relative_name(value):
    if (not isinstance(value, str) or not value or "\\" in value or "\x00" in value
            or ":" in value or value.startswith("/")
            or any(part in ("", ".", "..") for part in value.split("/"))):
        invalid()
    return value


def inside(root, filename):
    resolved = filename.resolve(strict=True)
    if resolved == root or root not in resolved.parents:
        invalid()
    return resolved


def validate_resources(manifest_path, expected_sha256):
    filename = Path(manifest_path)
    if filename.is_symlink() or not filename.is_file() or filename.stat().st_size > 8 * 1024 * 1024:
        invalid()
    raw = filename.read_bytes()
    if not isinstance(expected_sha256, str) or digest(raw) != expected_sha256:
        invalid()
    manifest = json.loads(raw)
    if (manifest.get("schemaVersion") != 1 or manifest.get("kind") != "rt-private-python-runtime"
            or manifest.get("complete") is not True or manifest.get("platform") != sys.platform):
        invalid()
    root = filename.parent.resolve(strict=True)
    adapter = manifest.get("miniRacerAdapter", {})
    if (adapter.get("path") != ADAPTER_NAME or adapter.get("version") != VERSION
            or adapter.get("windowsStrategy") != STRATEGY
            or adapter.get("sha256") != digest(Path(__file__).read_bytes())):
        invalid()
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        invalid()
    inventory = {}
    folded = set()
    for entry in entries:
        if not isinstance(entry, dict):
            invalid()
        name = relative_name(entry.get("path"))
        if name in inventory or name.casefold() in folded:
            invalid()
        inventory[name] = entry
        folded.add(name.casefold())
        target = root / name
        if entry.get("kind") == "symlink":
            if not target.is_symlink() or os.readlink(target).replace("\\", "/") != entry.get("target"):
                invalid()
            inside(root, target)
        elif entry.get("kind") == "file":
            if (target.is_symlink() or not target.is_file() or target.stat().st_size != entry.get("size")
                    or digest(target.read_bytes()) != entry.get("sha256")):
                invalid()
            inside(root, target)
        else:
            invalid()
    if inventory.get(ADAPTER_NAME, {}).get("sha256") != adapter["sha256"]:
        invalid()
    # Check the complete tree, not only a self-selected subset of native resources.
    seen = set()
    for directory, directories, files in os.walk(root, followlinks=False):
        for name in list(directories):
            item = Path(directory) / name
            if item.is_symlink():
                files.append(name)
                directories.remove(name)
        for name in files:
            item = Path(directory) / name
            relative = item.relative_to(root).as_posix()
            if relative == "manifest.json":
                continue
            if relative not in inventory:
                invalid()
            seen.add(relative)
    if seen != set(inventory):
        invalid()
    return manifest, root, inventory


def prepare_miniracer(manifest_path, provider, expected_manifest_sha256):
    if (provider not in ("akshare", "mootdx", "pywencai") or not sys.flags.isolated
            or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.utf8_mode != 1):
        invalid()
    manifest, root, inventory = validate_resources(manifest_path, expected_manifest_sha256)
    provider_lock = manifest.get("providers", {}).get(provider, {})
    if provider_lock.get("site") != "providers/" + provider + "/site":
        invalid()
    site = inside(root, root / provider_lock["site"])
    if not site.is_dir():
        invalid()
    provider_sites = [Path(item).resolve(strict=False) for item in sys.path
                      if item and (Path(item).resolve(strict=False) == site or "providers" in Path(item).parts)]
    if provider_sites and provider_sites != [site]:
        invalid()
    # No provider path is introduced until the entire ledger/tree and exact site
    # have passed validation. The already-loaded adapter uses stdlib imports only.
    if not provider_sites:
        sys.path.insert(0, str(site))
    return prepare_site(provider, site, root, inventory, provider_lock.get("wheels", []))


def prepare_site(provider, site, root, inventory, wheels):
    """Shared product initialization core; callers must first verify a hash ledger."""
    if not site.is_dir():
        invalid()
    # The bootstrap must have selected exactly one provider, before package import.
    provider_sites = [Path(item).resolve(strict=False) for item in sys.path
                      if item and (Path(item).resolve(strict=False) == site or "providers" in Path(item).parts)]
    if provider_sites != [site]:
        invalid()
    racers = [wheel for wheel in wheels if canonical(wheel.get("distribution", "")) == "mini-racer"]
    if not racers:
        if provider in ("akshare", "mootdx"):
            invalid()
        return {"provider": provider, "version": VERSION, "required": False, "contexts": 0, "hookUsed": False}
    if len(racers) != 1 or racers[0].get("version") != VERSION:
        invalid()
    distribution = importlib.metadata.distribution("mini-racer")
    if distribution.version != VERSION or distribution.locate_file("").resolve(strict=True) != site:
        invalid()
    if sys.platform == "darwin":
        # macOS uses the original initialization flow. Do not import or patch V8 here.
        return {"provider": provider, "version": VERSION, "required": True, "contexts": 0, "hookUsed": False}
    if sys.platform != "win32" or threading.current_thread() is not threading.main_thread() or threading.active_count() != 1:
        invalid()
    if any(name == "py_mini_racer" or name.startswith("py_mini_racer.") for name in sys.modules):
        invalid()
    resources = inside(root, site / "py_mini_racer")
    for basename in ("_dll.py", "__init__.py", "mini_racer.dll", "icudtl.dat", "snapshot_blob.bin"):
        item = resources / basename
        name = item.relative_to(root).as_posix()
        if inventory.get(name, {}).get("kind") != "file" or inside(root, item).parent != resources:
            invalid()
    dll = importlib.import_module("py_mini_racer._dll")
    mini_racer = importlib.import_module("py_mini_racer").MiniRacer
    if Path(dll.__file__).resolve(strict=True) != resources / "_dll.py" or threading.active_count() != 1:
        invalid()
    original_open = dll._open_resource_file
    if not callable(original_open):
        invalid()
    original_cwd = Path.cwd()
    observed = set()
    decoder = None
    if provider == "mootdx":
        decoder_path = inside(root, site / "mootdx/utils/holiday.js")
        decoder_name = decoder_path.relative_to(root).as_posix()
        decoder_entry = inventory.get(decoder_name, {})
        if (decoder_entry.get("kind") != "file" or decoder_entry.get("sha256") != HOLIDAY_DECODER_SHA256
                or digest(decoder_path.read_bytes()) != HOLIDAY_DECODER_SHA256):
            invalid()
        decoder = decoder_path.read_text(encoding="utf-8")

    def unicode_data_resource(filename, exit_stack):
        result = original_open(filename, exit_stack)
        # DLL lookup and every other resource retain the exact original behavior.
        if filename not in DATA_RESOURCES:
            return result
        resolved = Path(result).resolve(strict=True)
        if (Path(filename).name != filename or resolved != resources / filename
                or Path.cwd().resolve(strict=True) != resources):
            invalid()
        name = resolved.relative_to(root).as_posix()
        if digest(resolved.read_bytes()) != inventory[name]["sha256"]:
            invalid()
        observed.add(filename)
        return filename

    try:
        os.chdir(resources)
        dll._open_resource_file = unicode_data_resource
        with mini_racer() as engine:
            if engine.eval("6 * 7") != 42 or engine.eval("'\\u4e2d\\u6587'") != "\u4e2d\u6587":
                invalid()
        if observed != DATA_RESOURCES or dll._open_resource_file is not unicode_data_resource:
            invalid()
    finally:
        # Restore the function even if cwd restoration fails: either failure aborts.
        dll._open_resource_file = original_open
        os.chdir(original_cwd)
    if Path.cwd() != original_cwd or dll._open_resource_file is not original_open:
        invalid()
    with mini_racer() as engine:
        if engine.eval("6 * 7") != 42 or engine.eval("'\\u4e2d\\u6587'") != "\u4e2d\u6587":
            invalid()
        if engine.eval(ICU_PROBE_JS) is not True:
            invalid()
        if decoder is not None:
            engine.eval(decoder)
            for encoded, expected in HOLIDAY_FIXTURES:
                expression = "JSON.stringify(d(" + json.dumps(encoded) + ").map(function (day) { return day.toISOString().slice(0, 10); }))"
                if json.loads(engine.eval(expression)) != expected:
                    invalid()
    if Path.cwd() != original_cwd or dll._open_resource_file is not original_open:
        invalid()
    return {"provider": provider, "version": VERSION, "required": True, "contexts": 2,
            "hookUsed": True, "cwdRestored": True, "functionRestored": True,
            "unicodeResourceDirectory": not str(resources).isascii(), "resourcesVerified": True,
            "icuVerified": True, "decoderVerified": decoder is not None,
            "decoderFixtures": len(HOLIDAY_FIXTURES) if decoder is not None else 0}


def prepare_native_evidence(evidence_path, provider, expected_sha256):
    """Explicit native acceptance input. NEVER an accepted release manifest."""
    if (provider not in ("akshare", "mootdx", "pywencai") or not sys.flags.isolated
            or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.utf8_mode != 1):
        invalid()
    raw = Path(evidence_path).read_bytes()
    if digest(raw) != expected_sha256:
        invalid()
    evidence = json.loads(raw)
    if (evidence.get("kind") != "rt-private-miniracer-native-evidence" or evidence.get("schemaVersion") != 1
            or evidence.get("releaseEligible") is not False or evidence.get("provider") != provider
            or evidence.get("miniRacerVersion") != VERSION
            or evidence.get("adapterSha256") != digest(Path(__file__).read_bytes())):
        invalid()
    python = evidence.get("python", {})
    if (python.get("version") != sys.version.split()[0]
            or not Path(python.get("executable", "")).is_absolute()
            or not Path(python["executable"]).samefile(sys.executable)
            or digest(Path(sys.executable).read_bytes()) != python.get("sha256")):
        invalid()
    site = Path(evidence.get("site", ""))
    if not site.is_absolute() or site.is_symlink() or not site.is_dir():
        invalid()
    site = site.resolve(strict=True)
    inventory = {}
    for entry in evidence.get("files", []):
        name = relative_name(entry.get("path"))
        target = site / name
        if (name in inventory or entry.get("kind") != "file" or target.is_symlink()
                or not target.is_file() or target.stat().st_size != entry.get("size")
                or digest(target.read_bytes()) != entry.get("sha256")):
            invalid()
        inside(site, target)
        inventory[name] = entry
    seen = set()
    for directory, directories, files in os.walk(site, followlinks=False):
        if any((Path(directory) / name).is_symlink() for name in directories):
            invalid()
        for name in files:
            item = Path(directory) / name
            relative = item.relative_to(site).as_posix()
            if relative not in inventory or item.is_symlink():
                invalid()
            seen.add(relative)
    if not inventory or seen != set(inventory):
        invalid()
    sys.path.insert(0, str(site))
    result = prepare_site(provider, site, site, inventory, [{"distribution": "mini-racer", "version": VERSION}])
    result.update({"nativeEvidenceOnly": True, "releaseEligible": False, "python": python["version"], "filesVerified": len(inventory)})
    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--manifest")
    inputs.add_argument("--native-evidence")
    parser.add_argument("--provider", required=True, choices=("akshare", "mootdx", "pywencai"))
    parser.add_argument("--manifest-sha256", required=True)
    args = parser.parse_args()
    try:
        # CLI is for isolated native acceptance; the application calls through its
        # private bootstrap. Never add a system/user site or select an interpreter.
        if args.native_evidence:
            result = prepare_native_evidence(args.native_evidence, args.provider, args.manifest_sha256)
        else:
            result = prepare_miniracer(args.manifest, args.provider, args.manifest_sha256)
        print(json.dumps(result, sort_keys=True))
    except Exception:
        sys.stderr.write("PRIVATE_MINIRACER_ADAPTER_INVALID\n")
        raise SystemExit(70)
