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


def build(source, source_sha, target, original_wheel_sha, out):
    if original_wheel_sha != wheel.PINS[target][1]:
        raise ValueError("Public source must match the target's exact original wheel")
    expected = NATIVE_SOURCE_SHA if target == "win32-x64" else SDIST_SHA
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
    files["RT_PUBLIC_SOURCE_MANIFEST.json"] = wheel.encoded(manifest)
    files["PUBLIC-REBUILD.md"] = ("# Matched public lxml source profile\n\n"
        "The entire lxml/isoschematron namespace is excluded, including its Python initializer and XSL resources.\n"
        "All other native source and license file bytes are retained. Original source SHA values are provenance, not published original tar bytes.\n"
        "The sanitized inputs/lxml-6.1.3.tar.gz has its own SHA in RT_PUBLIC_SOURCE_MANIFEST.json.\n"
        "Do not run historical recipes with the old original-sdist SHA against this sanitized tar.\n"
        "For native reconstruction map the sanitized archive SHA explicitly; keep the retained generated C, dependency sources, compiler inputs and static build flags.\n"
        "Native objects in the paired redistribution wheel were not recompiled; byte-identical native rebuilding is not asserted.\n"
        "Mac source matching alone does not establish native relinkability or product/license approval.\n").encode()
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
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.source_sha256, args.target, args.original_wheel_sha256, args.out)["asset"]))


if __name__ == "__main__":
    main()
