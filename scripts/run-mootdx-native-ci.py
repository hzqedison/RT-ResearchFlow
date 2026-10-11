"""CI-only PBS/native feasibility; never a release manifest or installed test."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile


PBS_PREFIX = "https://github.com/astral-sh/python-build-standalone/releases/download/20261003/"
PBS_ASSETS = {
    "windows-x64": {
        "name": "cpython-3.13.16+20261003-x86_64-pc-windows-msvc-install_only.tar.gz",
        "bytes": 47421192,
        "sha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
        "executable": "python/python.exe",
    },
    "macos-arm64": {
        "name": "cpython-3.13.16+20261003-aarch64-apple-darwin-install_only.tar.gz",
        "bytes": 25365830,
        "sha256": "d8975d7df4f08f7b1c7aafcdfacbddcec3d366415f2c1a72b2466b6850815933",
        "executable": "python/bin/python3.13",
    },
    "macos-x64": {
        "name": "cpython-3.13.16+20261003-x86_64-apple-darwin-install_only.tar.gz",
        "bytes": 25067280,
        "sha256": "8e9cb087305bfb8969f68a905f79f41469d4aa5220c1aa71ada7fc9953bdba0f",
        "executable": "python/bin/python3.13",
    },
}
NUMPY_ASSETS = {
    "macos-arm64": {
        "name": "numpy-2.5.3-cp313-cp313-macosx_11_0_arm64.whl",
        "url": "https://files.pythonhosted.org/packages/2f/06/9dc9e48b5e5e941c8b10350c5ff2d721da42a20517d911d15544246775ff/numpy-2.5.3-cp313-cp313-macosx_11_0_arm64.whl",
        "bytes": 12003676,
        "sha256": "92f30e89b8ee0ecf363033576c422b2f58fed6a80bed0aa48dff6d14c654663e",
    },
    "macos-x64": {
        "name": "numpy-2.5.3-cp313-cp313-macosx_10_13_x86_64.whl",
        "url": "https://files.pythonhosted.org/packages/79/e5/8fb89cd46d14e35699d13bf943a5f5f441ecee8667120a1f6105ab89e349/numpy-2.5.3-cp313-cp313-macosx_10_13_x86_64.whl",
        "bytes": 16991061,
        "sha256": "66a78fe4556c60aceda5916f9eacd638b18e9e681016ec302dcb4682d6d4d034",
    },
}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def download(asset, target):
    with urllib.request.urlopen(asset["url"], timeout=30) as response:
        raw = response.read(asset["bytes"] + 1)
    if len(raw) != asset["bytes"] or digest(raw) != asset["sha256"]:
        raise RuntimeError("Pinned native asset size/SHA-256 mismatch: " + asset["name"])
    target.write_bytes(raw)


def main():
    workspace = Path.cwd().resolve(strict=True)
    temporary = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    platform = os.environ["RT_EXPECTED_PLATFORM"]
    architecture = os.environ["RT_EXPECTED_ARCH"]
    key = platform + "-" + architecture
    pbs = dict(PBS_ASSETS[key])
    pbs["url"] = PBS_PREFIX + pbs["name"].replace("+", "%2B")
    lab = temporary / ("RT runtime \u8fd0\u884c " + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"])
    if lab.exists():
        raise RuntimeError("Refusing to mix an existing native feasibility directory")
    lab.mkdir()
    evidence = lab / "evidence"
    evidence.mkdir()
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as stream:
        stream.write("RT_MOOTDX_LAB=" + str(lab) + "\n")
    archive_path = lab / pbs["name"]
    download(pbs, archive_path)
    pbs_root = lab / "pbs"
    pbs_root.mkdir()
    with tarfile.open(archive_path, "r:gz") as archive:
        archive.extractall(pbs_root, filter="data")
    python = (pbs_root / pbs["executable"]).resolve(strict=True)
    if not python.is_file() or not python.is_relative_to(pbs_root):
        raise RuntimeError("The selected PBS interpreter escaped its archive root")

    def execute(arguments, no_site=False, capture=False, timeout=600):
        flags = ["-X", "utf8", "-I", "-B"]
        if no_site:
            flags.append("-S")
        result = subprocess.run([str(python), *flags, *arguments], cwd=workspace,
                                check=False, capture_output=capture, text=True,
                                encoding="utf-8", timeout=timeout)
        if capture:
            print(result.stdout, flush=True)
            if result.stderr:
                print(result.stderr, file=sys.stderr, flush=True)
        result.check_returncode()
        return result

    actual_python = json.loads(execute(["-c", "import json,sys; print(json.dumps({'version':sys.version.split()[0], 'executable':sys.executable}))"],
                                      no_site=True, capture=True, timeout=30).stdout)
    if actual_python["version"] != "3.13.16" or not Path(actual_python["executable"]).samefile(python):
        raise RuntimeError("The actual interpreter is not the pinned PBS 3.13.16")
    upstream = {
        "name": "mootdx-0.11.7-py3-none-any.whl", "bytes": 108803,
        "sha256": "eab475f1d08b1c71ea51212c8b1b1038c4739798f7d95ad1a6fb7bb26e348ef2",
        "url": "https://files.pythonhosted.org/packages/bd/7c/dff7de8e9d29d49a22ffcb03f765cf829be5097019a760319d908009da54/mootdx-0.11.7-py3-none-any.whl",
    }
    wheel = lab / upstream["name"]
    download(upstream, wheel)
    execute(["tests/python/test_mootdx_compat_wheel.py", "--upstream-wheel", str(wheel),
             "--temporary-directory", str(lab)], no_site=True, timeout=60)
    built = execute(["scripts/build-mootdx-compat-wheel.py", "--upstream-wheel", str(wheel),
                     "--output-directory", str(lab / "wheelhouse")], no_site=True, capture=True, timeout=60)
    recipe = json.loads(built.stdout)
    if recipe["sha256"] != "35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77":
        raise RuntimeError("The derived wheel is not the reviewed compatibility recipe")
    requirements = [recipe["path"]]
    numpy = NUMPY_ASSETS.get(key)
    if numpy:
        numpy_wheel = lab / numpy["name"]
        download(numpy, numpy_wheel)
        requirements.append(str(numpy_wheel))
    provider = lab / "providers" / "mootdx"
    pip_report = lab / "pip-resolution.json"
    execute(["-m", "pip", "--isolated", "--disable-pip-version-check", "install", "--no-cache-dir",
             "--ignore-installed", "--only-binary=:all:", "--constraint",
             str(workspace / "tests/fixtures/runtime/mootdx-compat-constraints.txt"),
             "--target", str(provider), "--report", str(pip_report), *requirements])
    files = []
    for directory, directories, names in os.walk(provider, followlinks=False):
        if any((Path(directory) / name).is_symlink() for name in directories):
            raise RuntimeError("A native feasibility provider contains an unreviewed directory link")
        for name in names:
            path = Path(directory) / name
            if path.is_symlink() or not path.is_file():
                raise RuntimeError("A native feasibility provider contains an unreviewed file link")
            raw = path.read_bytes()
            files.append({"path": path.relative_to(provider).as_posix(), "kind": "file",
                          "size": len(raw), "sha256": digest(raw)})
    adapter_path = workspace / "resources/python-runtime/miniracer_unicode_adapter.py"
    adapter_sha = digest(adapter_path.read_bytes())
    ledger = {"schemaVersion": 1, "kind": "rt-private-miniracer-native-evidence",
              "releaseEligible": False, "provider": "mootdx", "miniRacerVersion": "0.12.4",
              "adapterSha256": adapter_sha, "python": {"version": actual_python["version"],
              "executable": str(python), "sha256": digest(python.read_bytes())},
              "site": str(provider.resolve(strict=True)), "files": sorted(files, key=lambda item: item["path"])}
    # Absolute runner paths stay in the disposable lab, not in the public artifact.
    ledger_raw = (json.dumps(ledger, sort_keys=True, indent=2) + "\n").encode("utf-8")
    ledger_path = lab / "native-evidence.json"
    ledger_path.write_bytes(ledger_raw)
    accepted = execute(["scripts/verify-mootdx-compat-runtime.py", "--provider-directory", str(provider),
                        "--temporary-directory", str(lab), "--expected-architecture", architecture,
                        "--native-evidence", str(ledger_path), "--native-evidence-sha256", digest(ledger_raw)],
                       no_site=True, capture=True, timeout=180)
    native = json.loads(accepted.stdout)
    if (native["providerReachable"] is not None or native["installedApplicationTested"]
            or native["nativeAdapter"].get("releaseEligible") is not False
            or native["pythonVersion"] != "3.13.16"):
        raise RuntimeError("Native feasibility must not claim release/source/installed-app acceptance")
    dependencies = []
    for item in json.loads(pip_report.read_text(encoding="utf-8"))["install"]:
        downloaded = item["download_info"]
        checksum = downloaded.get("archive_info", {}).get("hashes", {}).get("sha256", "")
        if len(checksum) != 64 or any(character not in "0123456789abcdef" for character in checksum):
            raise RuntimeError("A resolved dependency has no valid SHA-256")
        origin = downloaded["url"]
        name = item["metadata"]["name"].lower()
        version = item["metadata"]["version"]
        if origin.startswith("file:"):
            if name == "mootdx" and checksum == recipe["sha256"] and version == "0.11.7+rt.1":
                origin = "local-derived-wheel:" + Path(recipe["path"]).name
            elif numpy and name == "numpy" and version == "2.5.3" and checksum == numpy["sha256"]:
                origin = numpy["url"]
            else:
                raise RuntimeError("Unexpected local dependency in native feasibility resolution")
        elif not origin.startswith("https://files.pythonhosted.org/"):
            raise RuntimeError("Unexpected dependency origin")
        dependencies.append({"name": item["metadata"]["name"], "version": version,
                             "url": origin, "sha256": checksum})
    proof = {"schemaVersion": 1, "sourceSha": os.environ["GITHUB_SHA"], "releaseEligible": False,
             "runId": os.environ["GITHUB_RUN_ID"], "runAttempt": os.environ["GITHUB_RUN_ATTEMPT"],
             "targetPlatform": platform, "nativeAcceptance": native, "pbsAsset": pbs,
             "productionAdapterSha256": adapter_sha, "providerFilesVerified": len(files),
             "selectedNumpyAsset": numpy,
             "derivedWheel": {key: value for key, value in recipe.items() if key != "path"},
             "dependencies": sorted(dependencies, key=lambda item: item["name"].lower()),
             "limits": ["setup-python only prepares the job; native tests use pinned PBS 3.13.16",
                        "this is not a release manifest, full bundle, installer or installed application",
                        "a newer macOS runner does not prove execution on macOS 12",
                        "per-platform complete hash locks, licenses, SBOM and signing remain required",
                        "Python socket guards are not an operating-system network sandbox"]}
    (evidence / "native-acceptance.json").write_text(json.dumps(proof, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    shutil.copyfile(recipe["path"], evidence / Path(recipe["path"]).name)
    with zipfile.ZipFile(wheel) as archive:
        (evidence / "MOOTDX-UPSTREAM-LICENSE.txt").write_bytes(archive.read("mootdx-0.11.7.dist-info/LICENSE"))
    sums = "".join(digest(path.read_bytes()) + "  " + path.name + "\n" for path in sorted(evidence.iterdir()))
    (evidence / "SHA256SUMS.txt").write_text(sums, encoding="ascii")


if __name__ == "__main__":
    main()
