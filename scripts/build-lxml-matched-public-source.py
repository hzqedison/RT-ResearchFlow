"""Sanitize reviewed source bytes without publishing the optional ISO namespace."""
import argparse
import gzip
import importlib.util
import io
import json
from pathlib import Path
import posixpath
import tarfile

_spec = importlib.util.spec_from_file_location("rt_lxml_repack", Path(__file__).with_name("build-lxml-redistribution-wheel.py"))
wheel = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wheel)
SDIST_SHA = "45222d94ddd511536f3b2f7d9deae3b2339b4ce0f075f1ca25703b07cad9dd21"
NATIVE_SOURCE_SHA = "a79a7fd955b2d4316a52194c9ece0bbf5e7a1865d3effd6c320f8788d54359e3"
WRAPPER_SHA = "31899bc364d565a44dec562cdfa4c17bd7c68c9f5c9cf4af6fdd19f7bc6a35f8"
ORIGINAL_MANIFEST_SHA = "0d4154519b7eae84197bb2f92440037715870ceefb6809eb7e7108cc4b24dfa5"
PUBLIC_SDIST_SHA = "ddcc1bdb604d9ac23896aa6c999cb10d8b8342725c969c8a4399d92fab90b298"
PUBLIC_SDIST_SIZE = 4148428
WINDOWS_SOURCE_PROFILES = {
    "local-lx3": (NATIVE_SOURCE_SHA, WRAPPER_SHA),
    "hosted-run-37896686196": ("30ec51604396b8dd20d0ef20d6a5f31b54089cd6969738fffc3efced83bcb02a", "d7c7ea6e371971a0505718bfd613455ac93878b7e4394fa31390e497ca49fa19"),
}


def public_adapter(files, wrapper_sha=None):
    """Adapt two exact pins; never rewrite or relax the frozen build recipe."""
    wrapper_sha = WRAPPER_SHA if wrapper_sha is None else wrapper_sha
    if wheel.sha(files["rebuild-lxml-native.py"]) != wrapper_sha:
        raise ValueError("Unexpected frozen reconstruction wrapper")
    original = files["history/ORIGINAL-SOURCE-RELINK-DELTA.json"]
    if wheel.sha(original) != ORIGINAL_MANIFEST_SHA:
        raise ValueError("Unexpected reviewed source manifest")
    tar = files["inputs/lxml-6.1.3.tar.gz"]
    if wheel.sha(tar) != PUBLIC_SDIST_SHA or len(tar) != PUBLIC_SDIST_SIZE:
        raise ValueError("Unexpected sanitized lxml tar")
    manifest = json.loads(original)
    pins = {a["id"]: (a["fileName"], a["sha256"], a["bytes"], a["url"]) for a in manifest["sourceAssets"]}
    asset = next(a for a in manifest["sourceAssets"] if a["id"] == "lxml")
    asset["sha256"], asset["bytes"] = PUBLIC_SDIST_SHA, PUBLIC_SDIST_SIZE
    # URL/path/download flags remain historical provenance, not a download route.
    mapped = wheel.encoded(manifest)
    input_pins = {n: (wheel.sha(d), len(d)) for n, d in sorted(files.items()) if n.startswith("inputs/")}
    input_pins["inputs/source-relink-delta-public.json"] = (wheel.sha(mapped), len(mapped))
    adapter = '''"""Offline exact-pin adapter for the retained, immutable Windows wrapper."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
WRAPPER_SHA = @WRAPPER@
MANIFEST_SHA = @MANIFEST@
OLD_PINS = @PINS@
INPUT_PINS = @INPUTS@
PUBLIC_TAR = (@TAR_SHA@, @TAR_SIZE@)


def checked(relative, expected, size=None):
    path = ROOT / relative
    if path.is_symlink() or not path.is_file():
        raise ValueError("Missing/nonregular pinned input: " + relative)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected or (size is not None and len(data) != size):
        raise ValueError("Pinned input mismatch: " + relative)
    return path


def load():
    path = checked("rebuild-lxml-native.py", WRAPPER_SHA)
    for name, (digest, size) in INPUT_PINS.items():
        checked(name, digest, size)
    spec = importlib.util.spec_from_file_location("rt_lxml_public_native", path)
    native = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = native
    spec.loader.exec_module(native)
    if native.SOURCE_PINS != OLD_PINS or native.MANIFEST_SHA != @OLD_MANIFEST@:
        raise ValueError("Frozen wrapper pin contract changed")
    old = native.SOURCE_PINS["lxml"]
    native.SOURCE_PINS = dict(native.SOURCE_PINS)
    native.SOURCE_PINS["lxml"] = (old[0], PUBLIC_TAR[0], PUBLIC_TAR[1], old[3])
    native.MANIFEST_SHA = MANIFEST_SHA
    return native


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] not in ("check", "prepare", "build"):
        raise ValueError("Only offline check, prepare and build are supported; fetch is forbidden")
    fixed = ("--manifest", "--materials-dir", "--pbs", "--tools-archive", "--tools-sha256")
    if any(arg.split("=", 1)[0] in fixed for arg in argv[1:]):
        raise ValueError("Bundled input pins/paths cannot be overridden")
    native = load()
    if argv == ["check"]:
        print(json.dumps({"wrapperSha256": WRAPPER_SHA, "manifestSha256": MANIFEST_SHA,
            "sourcePins": native.SOURCE_PINS, "checkedInputs": len(INPUT_PINS), "nativeBuildExecuted": False}, sort_keys=True))
        return
    if argv[0] == "check":
        raise ValueError("check takes no arguments")
    argv += ["--manifest", str(ROOT / "inputs/source-relink-delta-public.json"),
             "--materials-dir", str(ROOT / "inputs")]
    if argv[0] == "build":
        argv += ["--pbs", str(ROOT / "inputs" / native.PBS_NAME),
                 "--tools-archive", str(ROOT / "inputs/tools-snapshot.zip"),
                 "--tools-sha256", INPUT_PINS["inputs/tools-snapshot.zip"][0]]
    return native.main(argv)


if __name__ == "__main__":
    main()
'''
    replacements = {"@WRAPPER@": repr(wrapper_sha), "@MANIFEST@": repr(wheel.sha(mapped)),
        "@PINS@": repr(pins), "@INPUTS@": repr(input_pins), "@TAR_SHA@": repr(PUBLIC_SDIST_SHA),
        "@TAR_SIZE@": repr(PUBLIC_SDIST_SIZE), "@OLD_MANIFEST@": repr(ORIGINAL_MANIFEST_SHA)}
    for token, value in replacements.items():
        adapter = adapter.replace(token, value)
    files["inputs/source-relink-delta-public.json"] = mapped
    files["rebuild-lxml-native-public.py"] = adapter.encode("ascii")
    return {"wrapperSha256": wrapper_sha, "adapterSha256": wheel.sha(files["rebuild-lxml-native-public.py"]),
        "manifestSha256": wheel.sha(mapped), "sanitizedTarSha256": PUBLIC_SDIST_SHA,
        "changedPins": ["lxml source SHA/size", "manifest SHA"], "fetchAllowed": False}


def sanitize_tar(data):
    removed, retained, entries = [], [], []
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
        members = archive.getmembers()
        if len(members) > 100000 or sum(m.size for m in members) > 2_000_000_000:
            raise ValueError("Source tar exceeds budget")
        seen = set()
        for member in members:
            name = wheel.safe_name(member.name)
            if name.casefold() in seen or not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise ValueError("Unsafe/duplicate tar member")
            seen.add(name.casefold())
            if member.issym() or member.islnk():
                destination = posixpath.normpath(posixpath.join(posixpath.dirname(name), member.linkname)) if member.issym() else member.linkname
                wheel.safe_name(destination)
                if wheel.excluded(destination):
                    raise ValueError("Tar link references excluded namespace")
            entries.append((member, name))
        changed = any(wheel.excluded(name) for _, name in entries)
        if not changed:
            return data, {"removedMembers": [], "preservedNativeSources": []}
        output = io.BytesIO()
        with gzip.GzipFile(fileobj=output, mode="wb", filename="", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as result:
                for member, name in sorted(entries, key=lambda x: x[1]):
                    if wheel.excluded(name):
                        removed.append(name)
                        continue
                    contents = archive.extractfile(member).read() if member.isfile() else b""
                    if name.endswith("/SOURCES.txt"):
                        contents = b"".join(line for line in contents.splitlines(keepends=True) if not wheel.excluded(line.decode("utf-8").strip()))
                    elif member.isfile() and name.endswith((".c", ".h", ".cpp", ".hpp", ".pxd", ".pyx", ".pxi", ".lib", ".obj", ".def", ".vcxproj", ".props", ".sln")):
                        retained.append({"path": name, "sha256": wheel.sha(contents), "size": len(contents)})
                    info = tarfile.TarInfo(name)
                    info.type, info.mode, info.linkname = member.type, member.mode, member.linkname
                    info.uid = info.gid = info.mtime = 0
                    info.size = len(contents) if member.isfile() else 0
                    result.addfile(info, io.BytesIO(contents) if member.isfile() else None)
    return output.getvalue(), {"removedMembers": removed, "preservedNativeSources": retained}


def sanitize_materials(data):
    files = wheel.zip_files(data)
    result, removed, rewritten = {}, [], []
    for name, contents in sorted(files.items()):
        if wheel.excluded(name) or name.lower().endswith(".whl"):
            removed.append({"path": name, "sha256": wheel.sha(contents), "size": len(contents)})
            continue
        destination = name
        if name == "REBUILD.md":
            destination = "history/ORIGINAL-REBUILD.md"
        elif name == "inputs/source-relink-delta.json":
            destination = "history/ORIGINAL-SOURCE-RELINK-DELTA.json"
        if name.lower().endswith((".tar.gz", ".tgz", ".tar")):
            original = contents
            contents, proof = sanitize_tar(contents)
            if proof["removedMembers"]:
                rewritten.append({"path": name, "originalSha256": wheel.sha(original), "sha256": wheel.sha(contents), "size": len(contents), **proof})
        elif name.lower().endswith(".zip"):
            nested, proof = sanitize_materials(contents)
            if proof["removedMembers"] or proof["rewrittenArchives"]:
                rewritten.append({"path": name, "originalSha256": wheel.sha(contents), "sha256": wheel.sha(nested), "size": len(nested), "nestedChanges": proof})
                contents = nested
        if destination in result:
            raise ValueError("Public-source destination collision")
        result[destination] = contents
    return wheel.zip_bytes(result), {"removedMembers": removed, "rewrittenArchives": rewritten}


def build(source, source_sha, target, original_wheel_sha, out, windows_profile="local-lx3"):
    if original_wheel_sha != wheel.input_pin(target, windows_profile)[1]:
        raise ValueError("Public source must match the target's exact original wheel")
    expected = WINDOWS_SOURCE_PROFILES[windows_profile][0] if target == "win32-x64" else SDIST_SHA
    if source_sha != expected:
        raise ValueError("Wrong reviewed source input")
    original = wheel.checked(source, source_sha)
    if target == "win32-x64":
        sanitized, proof = sanitize_materials(original)
        files = wheel.zip_files(sanitized)
        rewritten = proof["rewrittenArchives"]
    else:
        sanitized, tar_proof = sanitize_tar(original)
        rewritten = [{"path": "inputs/lxml-6.1.3.tar.gz", "originalSha256": source_sha, "sha256": wheel.sha(sanitized), "size": len(sanitized), **tar_proof}]
        proof = {"removedMembers": [], "rewrittenArchives": rewritten}
        files = {"inputs/lxml-6.1.3.tar.gz": sanitized}
    lxml_inputs = [x for x in rewritten if x["path"].endswith("lxml-6.1.3.tar.gz")]
    if len(lxml_inputs) != 1 or lxml_inputs[0]["originalSha256"] != SDIST_SHA or not lxml_inputs[0]["removedMembers"]:
        raise ValueError("Original lxml tar was not fully sanitized")
    manifest = {"kind": "rt-lxml-matched-public-source-v1", "target": target,
        "upstreamVersion": "6.1.3", "matchedDistributionVersion": wheel.VERSION,
        "originalWheelSha256": original_wheel_sha, "originalArchive": {"filename": Path(source).name, "sha256": source_sha, "size": len(original)},
        "originalLxmlSdistSha256": SDIST_SHA, "originalLxmlSdistRedistributed": False,
        "excludedNamespace": wheel.EXCLUDED, "isoSchematronProvided": False, "nativeRecompiled": False,
        "changes": proof, "licenseApproval": "not granted by this tool",
        "historicalRecipes": "original pins/docs are historical; sanitized source has a new SHA and needs explicitly mapped native build inputs"}
    rebuild_doc = ""
    if target == "win32-x64":
        manifest["windowsInputProfile"] = windows_profile
        manifest["publicNativeAdapter"] = public_adapter(files, WINDOWS_SOURCE_PROFILES[windows_profile][1])
        rebuild_doc = ("\n## Windows offline reconstruction (derived, not original-wheel reproduction)\n\n"
            "Extract this ZIP to a fresh short ASCII D: cache directory, for example D:/RT-ResearchFlow-BuildCache/lxpub. "
            "Use existing MSVC 14.44.35207 and SDK 10.0.26100.0; missing tools must fail, not install.\n"
            "The fixed adapter verifies the immutable original wrapper, every bundled input, and the public manifest. "
            "Only lxml's SHA/size and the wrapper manifest SHA change. All five dependency/recipe pins, bundled PBS/tools, "
            "static flags and generated-C --without-cython path remain intact. No --static-deps or fetch is allowed. "
            "The old URL/path/download fields are retained historical provenance, not a URL for the sanitized tar.\n\n"
            "```powershell\n"
            "cd D:/RT-ResearchFlow-BuildCache/lxpub\n"
            "python -B rebuild-lxml-native-public.py check\n"
            "python -B rebuild-lxml-native-public.py prepare --work D:/RT-ResearchFlow-BuildCache/lxp-prep\n"
            "python -B rebuild-lxml-native-public.py build --work D:/RT-ResearchFlow-BuildCache/lxp-build --network-enforcement python-audit-and-reviewed-native-targets\n"
            "```\n\n"
            "Work directories must not already exist. Input paths and hashes are injected by the adapter and cannot be overridden. "
            "Optionally pass the existing --vc-root to build for an alternate installed Visual Studio root. "
            "No original wheel is required/provided. The build produces a new derived baseline and experimental relink outputs, "
            "not reproduction of the original PyPI wheel or a product default. Python network guards and reviewed targets "
            "are not an OS-wide network block. Consult actual output evidence for command/toolchain hashes.\n")
    files["RT_PUBLIC_SOURCE_MANIFEST.json"] = wheel.encoded(manifest)
    files["PUBLIC-REBUILD.md"] = ("# Matched public lxml source profile\n\n"
        "The entire lxml/isoschematron namespace is excluded, including its Python initializer and XSL resources.\n"
        "All other native source and license file bytes are retained. Original source SHA values are provenance, not published original tar bytes.\n"
        "The sanitized inputs/lxml-6.1.3.tar.gz has its own SHA in RT_PUBLIC_SOURCE_MANIFEST.json.\n"
        "Do not run historical recipes with the old original-sdist SHA against this sanitized tar.\n"
        "For Windows use the exact-pin public adapter below, not the historical wrapper directly. Mac packages contain matched lxml source only; the Windows adapter is not a Mac native build recipe.\n"
        "Native objects in the paired redistribution wheel were not recompiled; byte-identical native rebuilding is not asserted.\n"
        "Mac source matching alone does not establish native relinkability or product/license approval.\n" + rebuild_doc).encode()
    for filename in ("build-lxml-redistribution-wheel.py", "build-lxml-matched-public-source.py"):
        files["redistribution-tools/" + filename] = Path(__file__).with_name(filename).read_bytes()
    result = wheel.zip_bytes(files)
    output = wheel.fresh_output(out)
    filename = "lxml-" + wheel.VERSION + "-" + target + "-public-sources.zip"
    with (output / filename).open("xb") as stream:
        stream.write(result)
    receipt = {"asset": {"kind": "derived", "filename": filename, "sha256": wheel.sha(result), "size": len(result)}, **manifest}
    with (output / "public-source-evidence.json").open("xb") as stream:
        stream.write(wheel.encoded(receipt))
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, choices=tuple(wheel.PINS))
    parser.add_argument("--source", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--original-wheel-sha256", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--windows-profile", choices=tuple(wheel.WINDOWS_PROFILES), default="local-lx3")
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.source_sha256, args.target, args.original_wheel_sha256, args.out, args.windows_profile)["asset"]))


if __name__ == "__main__":
    main()
