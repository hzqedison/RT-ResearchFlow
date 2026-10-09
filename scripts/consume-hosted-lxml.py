"""Offline consumer of fixed hosted/PyPI bytes. No token, HTTP or native C build."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import zipfile

REPO_PINS = {'scripts/build-lxml-redistribution-wheel.py': '17c547bc3216628594508c32926501024afaa2a9de109adbf2a91870d6afc772', 'scripts/build-lxml-matched-public-source.py': 'b0baf7b569e211366211cb1921bc5311ace969f2697b8256feb5f29a1177e4e0', 'tests/python/test_build_lxml_redistribution_wheel.py': 'cb92913dde7fdb01f125e64a9f07383556d75b6833a4d172a858372e41e76189', 'tests/python/test_build_lxml_matched_public_source.py': '3d025bea3c33a6d1a409152edbed5e10360fd4abd44cdce7e78e43dc6b94fa19'}
ARCHIVE_SHA = "fa9cae8101dbb52f09239ac027ffd1ccc4877b173c352aa54bcf94c100cba8a4"
PROFILE = "hosted-run-37896686196"
BASELINE_SHA = "a27904ae1fd3684f8cc8ab4b3c5ab78b1ee3ad4ff8f7301ee24627bca099184c"
SOURCE_SHA = "30ec51604396b8dd20d0ef20d6a5f31b54089cd6969738fffc3efced83bcb02a"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--repo", required=True)
    p.add_argument("--target", required=True, choices=("win32-x64", "darwin-arm64", "darwin-x64"))
    group = p.add_mutually_exclusive_group()
    group.add_argument("--artifact-dir")
    group.add_argument("--artifact-archive")
    p.add_argument("--official-inputs")
    p.add_argument("--out", required=True)
    p.add_argument("--expected-source-sha256")
    p.add_argument("--expected-wheel-sha256")
    a = p.parse_args()
    if bool(a.expected_source_sha256) != bool(a.expected_wheel_sha256):
        p.error("Both final expected SHA pins must be supplied together")
    repo = Path(a.repo)
    for n, digest in REPO_PINS.items():
        path = repo / n
        if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("Checkout source bytes differ from exact handoff: " + n)
    spec = importlib.util.spec_from_file_location("rt_matched_source", repo / "scripts/build-lxml-matched-public-source.py")
    source = importlib.util.module_from_spec(spec); spec.loader.exec_module(source)
    wheel = source.wheel
    if a.target == "win32-x64":
        if not (a.artifact_dir or a.artifact_archive):
            p.error("Windows requires the exact downloaded hosted artifact")
        profile = PROFILE; pin = wheel.input_pin(a.target, profile)
        if a.artifact_archive:
            archive_bytes = wheel.checked(a.artifact_archive, ARCHIVE_SHA)
            import io
            with zipfile.ZipFile(io.BytesIO(archive_bytes)) as z:
                names = [wheel.safe_name(i.filename) for i in z.infolist()]
                if len(names) > 100000 or len(set(n.casefold() for n in names)) != len(names) or any(stat.S_ISLNK(i.external_attr >> 16) for i in z.infolist()):
                    raise ValueError("Unsafe artifact archive")
                baseline = z.read("b/" + pin[0]); materials = z.read("b/source-materials.zip")
            if wheel.sha(baseline) != BASELINE_SHA or len(baseline) != 4580919 or wheel.sha(materials) != SOURCE_SHA or len(materials) != 72781880:
                raise ValueError("Hosted members do not match their fixed pins")
            out = wheel.fresh_output(a.out); inputs = out / "inputs"; inputs.mkdir()
            wheel_path = inputs / pin[0]; source_path = inputs / "source-materials.zip"
            wheel_path.write_bytes(baseline); source_path.write_bytes(materials)
        else:
            wheel_path = Path(a.artifact_dir) / "b" / pin[0]
            source_path = Path(a.artifact_dir) / "b/source-materials.zip"
            if len(wheel.checked(wheel_path, BASELINE_SHA)) != 4580919 or len(wheel.checked(source_path, SOURCE_SHA)) != 72781880:
                raise ValueError("Hosted pinned member size mismatch")
            out = wheel.fresh_output(a.out)
        source_sha = SOURCE_SHA
    else:
        if a.artifact_dir or a.artifact_archive or not a.official_inputs:
            p.error("Mac requires only fixed official PyPI inputs")
        profile = "local-lx3"; pin = wheel.input_pin(a.target)
        wheel_path = Path(a.official_inputs) / pin[0]
        source_path = Path(a.official_inputs) / "lxml-6.1.3.tar.gz"
        source_sha = source.SDIST_SHA
        wheel.checked(wheel_path, pin[1]); wheel.checked(source_path, source_sha)
        out = wheel.fresh_output(a.out)
    s = source.build(source_path, source_sha, a.target, pin[1], out / "source", profile)
    w = wheel.build(wheel_path, pin[1], a.target, out / "source" / s["asset"]["filename"], s["asset"]["sha256"], out / "wheel", profile)
    matched = None
    if a.expected_source_sha256:
        if s["asset"]["sha256"] != a.expected_source_sha256 or w["asset"]["sha256"] != a.expected_wheel_sha256:
            raise ValueError("Final derived bytes differ from fixed output pins; do not stage")
        matched = True
    receipt = {"target": a.target, "source": s, "wheel": w, "fixedFinalPinsMatched": matched,
               "nativeCompiled": False, "networkUsedByConsumer": False}
    (out / "consumer-evidence.json").write_bytes(wheel.encoded(receipt))
    print(json.dumps({"target": a.target, "source": s["asset"], "wheel": w["asset"], "fixedFinalPinsMatched": matched}))


if __name__ == "__main__":
    main()
