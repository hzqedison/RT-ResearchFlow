"""Offline, deterministic repack; no native rebuild or license approval."""
import argparse
import base64
import csv
from email.parser import BytesParser
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

VERSION = "6.1.3+rt.redistribution.1"
BUILD = "1rtredistribution"
EXCLUDED = "lxml/isoschematron/**"
PINS = {
    "win32-x64": ("lxml-6.1.3-1rtbaseline-cp313-cp313-win_amd64.whl", "8c50ef43d7d3e4c66078e700aef7cfeacdbe9e7635ce9897da375252f9ec5157", "win_amd64"),
    "darwin-arm64": ("lxml-6.1.3-cp313-cp313-macosx_10_13_universal2.whl", "3a48093cdb058a93af842ede9703520e810b05dcd0fc6d7190a06376c3bfb6bd", "macosx_10_13_universal2"),
    "darwin-x64": ("lxml-6.1.3-cp313-cp313-macosx_10_13_x86_64.whl", "887c021d9a977cff89cb273047c1352997b772a8908a25c21836861f69b92be1", "macosx_10_13_x86_64"),
}
WINDOWS_PROFILES = {
    "local-lx3": PINS["win32-x64"],
    "hosted-run-37896686196": ("lxml-6.1.3-1rtbaseline-cp313-cp313-win_amd64.whl", "a27904ae1fd3684f8cc8ab4b3c5ab78b1ee3ad4ff8f7301ee24627bca099184c", "win_amd64"),
}


def input_pin(target, windows_profile="local-lx3"):
    if target == "win32-x64":
        if windows_profile not in WINDOWS_PROFILES:
            raise ValueError("Unknown fixed Windows input profile")
        return WINDOWS_PROFILES[windows_profile]
    if windows_profile != "local-lx3":
        raise ValueError("Windows profile cannot select a Mac input")
    return PINS[target]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode()


def safe_name(name):
    if not isinstance(name, str) or not name or "\\" in name or ":" in name or "\x00" in name:
        raise ValueError("Unsafe archive name")
    path = PurePosixPath(name)
    if path.is_absolute() or any(p in {"", ".", ".."} for p in name.rstrip("/").split("/")):
        raise ValueError("Archive traversal")
    return name.rstrip("/")


def excluded(name):
    parts = name.lower().replace("\\", "/").split("/")
    return any(parts[i:i + 2] == ["lxml", "isoschematron"] for i in range(len(parts) - 1))


def checked(path, expected):
    if not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise ValueError("Exact SHA-256 required")
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Regular pinned input required")
    data = path.read_bytes()
    if sha(data) != expected:
        raise ValueError("Input bytes differ from pin")
    return data


def zip_files(data):
    result, seen = {}, set()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        if len(infos) > 100000 or sum(i.file_size for i in infos) > 2_000_000_000:
            raise ValueError("Archive exceeds budget")
        for item in infos:
            name = safe_name(item.filename)
            if name.casefold() in seen or stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError("Duplicate/case-colliding/linked archive member")
            seen.add(name.casefold())
            if not item.is_dir():
                result[name] = archive.read(item)
    return result


def zip_bytes(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            safe_name(name)
            item = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            item.create_system = 3
            item.external_attr = 0o100644 << 16
            item.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(item, data, compresslevel=9)
    return output.getvalue()


def record_bytes(files, record):
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    for name, data in sorted(files.items()):
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        writer.writerow([name, "sha256=" + digest, str(len(data))])
    writer.writerow([record, "", ""])
    return out.getvalue().encode()


def verify_record(files):
    records = [n for n in files if n.endswith(".dist-info/RECORD")]
    if len(records) != 1 or any(n.endswith(("/RECORD.jws", "/RECORD.p7s")) for n in files):
        raise ValueError("One unsigned RECORD required")
    record = records[0]
    rows = list(csv.reader(io.StringIO(files[record].decode("utf-8"))))
    seen = set()
    for row in rows:
        if len(row) != 3 or row[0] in seen or row[0] not in files:
            raise ValueError("Invalid RECORD membership")
        name, digest, size = row
        seen.add(name)
        if name == record:
            if digest or size:
                raise ValueError("RECORD self digest must be blank")
        else:
            expected = base64.urlsafe_b64encode(hashlib.sha256(files[name]).digest()).rstrip(b"=").decode()
            if digest != "sha256=" + expected or size != str(len(files[name])):
                raise ValueError("RECORD pin mismatch")
    if seen != set(files):
        raise ValueError("Unrecorded wheel member")
    return record


def repack_bytes(data, target, source_pin):
    files = zip_files(data)
    old_record = verify_record(files)
    old_info = old_record.rsplit("/", 1)[0]
    metadata = files[old_info + "/METADATA"].replace(b"\r\n", b"\n")
    message = BytesParser().parsebytes(metadata)
    if message["Name"].lower() != "lxml" or message["Version"] != "6.1.3":
        raise ValueError("Unexpected upstream identity")
    header = files[old_info + "/WHEEL"].replace(b"\r\n", b"\n")
    tags = BytesParser().parsebytes(header).get_all("Tag", [])
    expected_tag = "cp313-cp313-" + PINS[target][2]
    if tags != [expected_tag]:
        raise ValueError("Wrong pinned native target/ABI")
    if source_pin.get("target") != target or source_pin.get("originalWheelSha256") != sha(data):
        raise ValueError("Public source is not paired to this wheel")
    new_info = "lxml-" + VERSION + ".dist-info"
    output, removed, preserved = {}, [], []
    for name, contents in files.items():
        if excluded(name):
            removed.append({"path": name, "sha256": sha(contents), "size": len(contents)})
            continue
        if name == old_record:
            continue
        destination = new_info + name[len(old_info):] if name.startswith(old_info + "/") else name
        output[destination] = contents
        if name not in {old_info + "/METADATA", old_info + "/WHEEL"}:
            preserved.append({"upstreamPath": name, "path": destination, "sha256": sha(contents), "size": len(contents)})
    if not removed:
        raise ValueError("Expected optional namespace was not present")
    metadata, count = re.subn(br"(?m)^Version: 6\.1\.3$", b"Version: " + VERSION.encode(), metadata)
    if count != 1:
        raise ValueError("Ambiguous version header")
    head, separator, body = metadata.partition(b"\n\n")
    output[new_info + "/METADATA"] = head + b"\nX-RT-Derived-Identity: rt-lxml-redistribution-v1\nX-RT-Excluded-Namespace: lxml.isoschematron\n" + (b"\n" + body if separator else b"\n")
    lines = [line for line in header.decode().splitlines() if line and not line.startswith(("Build:", "Generator:"))]
    output[new_info + "/WHEEL"] = ("\n".join(lines + ["Build: " + BUILD, "Generator: rt-lxml-redistribution-repack/1 (native not rebuilt)"]) + "\n").encode()
    native = [p for p in preserved if p["path"].endswith((".pyd", ".so", ".dylib"))]
    if not native:
        raise ValueError("Native payload missing")
    provenance = {"kind": "rt-lxml-redistribution-wheel-v1", "target": target, "upstreamVersion": "6.1.3", "distributionVersion": VERSION,
        "nativeRuntimeVersion": "6.1.3", "originalWheelSha256": sha(data), "publicSource": source_pin,
        "excludedNamespace": EXCLUDED, "isoSchematronProvided": False, "nativeRecompiled": False,
        "removedMembers": removed, "preservedMembers": preserved, "nativeMemberPins": native,
        "licenseApproval": "not granted by this tool", "providerImpact": "must be established by actual isolated tests"}
    output[new_info + "/RT_REDISTRIBUTION.json"] = encoded(provenance)
    record = new_info + "/RECORD"
    output[record] = record_bytes(output, record)
    return zip_bytes(output), provenance


def fresh_output(path):
    path = Path(path)
    if path.exists() or path.is_symlink():
        raise ValueError("Output directory must be fresh")
    path.mkdir(parents=True)
    return path


def build(wheel, wheel_sha, target, public_source, source_sha, out, windows_profile="local-lx3"):
    name, pin, tag = input_pin(target, windows_profile)
    if Path(wheel).name != name or wheel_sha != pin:
        raise ValueError("Only this target's exact pinned upstream wheel is accepted")
    data = checked(wheel, wheel_sha)
    source_data = checked(public_source, source_sha)
    source_files = zip_files(source_data)
    manifest = json.loads(source_files["RT_PUBLIC_SOURCE_MANIFEST.json"])
    if manifest.get("kind") != "rt-lxml-matched-public-source-v1" or manifest.get("isoSchematronProvided") is not False:
        raise ValueError("Explicit matched public source required")
    if target == "win32-x64" and manifest.get("windowsInputProfile", "local-lx3") != windows_profile:
        raise ValueError("Public source belongs to another Windows input profile")
    source_pin = {"filename": Path(public_source).name, "sha256": source_sha, "size": len(source_data),
        "target": manifest["target"], "originalWheelSha256": manifest["originalWheelSha256"]}
    result, proof = repack_bytes(data, target, source_pin)
    output = fresh_output(out)
    filename = "lxml-" + VERSION + "-" + BUILD + "-cp313-cp313-" + tag + ".whl"
    with (output / filename).open("xb") as stream:
        stream.write(result)
    receipt = {"asset": {"kind": "derived", "filename": filename, "sha256": sha(result), "size": len(result)}, **proof}
    with (output / "repack-evidence.json").open("xb") as stream:
        stream.write(encoded(receipt))
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, choices=tuple(PINS))
    parser.add_argument("--wheel", required=True)
    parser.add_argument("--wheel-sha256", required=True)
    parser.add_argument("--public-source", required=True)
    parser.add_argument("--public-source-sha256", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--windows-profile", choices=tuple(WINDOWS_PROFILES), default="local-lx3")
    args = parser.parse_args()
    print(json.dumps(build(args.wheel, args.wheel_sha256, args.target, args.public_source, args.public_source_sha256, args.out, args.windows_profile)["asset"]))


if __name__ == "__main__":
    main()
