"""Generate native runtime candidates on disposable hosted runners, not releases."""
import argparse
import hashlib
import json
import os
import pathlib
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(131072), b""):
            h.update(chunk)
    return h.hexdigest()


def download_python(asset, destination):
    url = urllib.parse.urlsplit(asset["url"])
    filename = asset["filename"]
    if (url.scheme != "https" or url.hostname != "github.com" or
            url.port is not None or url.username or url.password or
            not url.path.startswith("/astral-sh/python-build-standalone/releases/download/") or
            urllib.parse.unquote(url.path.rsplit("/", 1)[-1]) != filename or
            pathlib.PurePosixPath(filename).name != filename or "\\" in filename):
        raise ValueError("Unexpected PBS source")
    size = asset["size"]
    if not isinstance(size, int) or isinstance(size, bool) or not 0 < size < 200_000_000:
        raise ValueError("Unexpected PBS size")
    total = 0
    with urllib.request.urlopen(asset["url"], timeout=60) as response:
        with destination.open("xb") as out:
            while True:
                chunk = response.read(min(131072, size - total + 1))
                if not chunk:
                    break
                total += len(chunk)
                if total > size:
                    raise ValueError("PBS download exceeded pinned size")
                out.write(chunk)
    if total != size or digest(destination) != asset["sha256"]:
        raise ValueError("PBS download did not match its pinned bytes")


def extract_python(archive, destination):
    destination.mkdir()
    with tarfile.open(archive, "r:gz") as source:
        members = source.getmembers()
        if len(members) > 50000 or sum(x.size for x in members) > 2 * 1024**3:
            raise ValueError("PBS extraction budget exceeded")
        for member in members:
            name = pathlib.PurePosixPath(member.name)
            if (name.is_absolute() or ".." in name.parts or "\\" in member.name or
                    any(":" in part for part in name.parts) or
                    not (member.isfile() or member.isdir() or member.issym() or member.islnk())):
                raise ValueError("Unsafe PBS archive entry")
        source.extractall(destination, members=members, filter="data")


def native_target():
    machine = platform.machine().lower()
    if sys.platform == "win32" and machine in ("amd64", "x86_64"):
        return "win32-x64"
    if sys.platform == "darwin":
        if tuple(map(int, platform.mac_ver()[0].split(".")[:1])) < (12,):
            raise ValueError("Native macOS 12 or newer is required")
        if machine == "arm64":
            return "darwin-arm64"
        if machine == "x86_64":
            return "darwin-x64"
    raise ValueError("Unsupported native host")


def child_environment(home):
    env = {}
    for key, value in os.environ.items():
        upper = key.upper()
        if (upper.startswith(("GITHUB_", "ACTIONS_", "PIP_", "PYTHON", "AWS_", "AZURE_")) or
                any(word in upper for word in ("TOKEN", "PASSWORD", "SECRET", "API_KEY")) or
                upper in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NODE_OPTIONS")):
            continue
        env[key] = value
    env.update(HOME=str(home), USERPROFILE=str(home), TMP=str(home),
               TEMP=str(home), TMPDIR=str(home))
    return env


def resolver_metadata(work, proof):
    """Export a bounded allowlist, never URLs, environment or raw resolver reports."""
    copied = []
    for provider in ("akshare", "mootdx", "pywencai"):
        path = work / "resolve" / (provider + "-normal-resolver.json")
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 10_000_000:
            continue
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
            installs = report.get("install", [])
            if not isinstance(installs, list) or len(installs) > 512:
                continue
            wheels = []
            for item in installs:
                metadata = item.get("metadata", {})
                download = item.get("download_info", {})
                filename = urllib.parse.unquote(urllib.parse.urlsplit(download.get("url", "")).path.rsplit("/", 1)[-1])
                safe = lambda value, limit: value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.+\-]{1," + str(limit) + r"}", value) else "REDACTED"
                sha = download.get("archive_info", {}).get("hashes", {}).get("sha256")
                wheels.append({"distribution": safe(metadata.get("name"), 128),
                    "version": safe(metadata.get("version"), 128), "filename": safe(filename, 240),
                    "sha256": sha if isinstance(sha, str) and re.fullmatch(r"[a-f0-9]{64}", sha) else None})
            name = provider + "-resolver-metadata.json"
            (proof / name).write_text(json.dumps({"provider": provider, "wheelCount": len(wheels),
                "wheels": wheels}, indent=2) + "\n", encoding="utf-8")
            copied.append(name)
        except (ValueError, TypeError, AttributeError, OSError):
            # Incomplete failure reports must not hide the original preparation exit.
            continue
    diagnostic = work / "resolve" / "failure-diagnostic.json"
    if diagnostic.is_file() and not diagnostic.is_symlink() and diagnostic.stat().st_size <= 8192:
        try:
            value = json.loads(diagnostic.read_text(encoding="utf-8"))
            source = value.get("source", {})
            stages = ("create-provider-site", "build-constraints", "normal-pip-resolve",
                      "parse-resolver-report", "freeze-resolved-wheels", "validate-closure",
                      "validate-native-wheel", "commit-provider-evidence")
            functions = ("resolve", "resolution_constraints", "run", "freeze_report_item",
                         "validate_closure", "wheel_native_evidence", "checked_native", "macho_slices",
                         "relative", "verified_asset", "file_digest", "exclusive_bytes", "official")
            if (value.get("kind") == "rt-private-runtime-failure-diagnostic-v1" and
                    value.get("provider") in ("akshare", "mootdx", "pywencai") and
                    value.get("target") in ("win32-x64", "darwin-arm64", "darwin-x64") and
                    value.get("stage") in stages and
                    value.get("errorType") in ("Invalid", "Pending", "SubprocessError", "OSError",
                                               "ValueError", "KeyError", "TypeError", "UnexpectedError") and
                    isinstance(source.get("line"), int) and not isinstance(source.get("line"), bool) and
                    0 <= source["line"] <= 100000 and
                    isinstance(source.get("function"), str) and
                    re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", source["function"])):
                safe = {"schemaVersion": 1, "kind": value["kind"], "status": "failed", "phase": "resolve",
                        "target": value["target"], "provider": value["provider"], "stage": value["stage"],
                        "errorType": value["errorType"], "source": {"file": "scripts/prepare-private-python-runtime.py",
                        "function": source["function"] if source["function"] in functions else "UNKNOWN",
                        "line": source["line"]}}
                name = "failure-diagnostic.json"
                (proof / name).write_text(json.dumps(safe, indent=2) + "\n", encoding="utf-8")
                copied.append(name)
        except (ValueError, TypeError, AttributeError, KeyError, OSError):
            pass
    return copied


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True,
                        choices=("win32-x64", "darwin-arm64", "darwin-x64"))
    parser.add_argument("--proof-dir", required=True)
    args = parser.parse_args()
    if (os.environ.get("GITHUB_ACTIONS") != "true" or
            os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"):
        raise SystemExit("This entry point is for disposable hosted CI only")
    if native_target() != args.target:
        raise SystemExit("Cross-architecture preparation is refused")
    repo = pathlib.Path(os.environ["GITHUB_WORKSPACE"]).resolve()
    temporary = pathlib.Path(os.environ["RUNNER_TEMP"]).resolve()
    proof = pathlib.Path(args.proof_dir)
    if (not proof.is_absolute() or proof.exists() or proof.is_symlink() or
            not proof.resolve().is_relative_to(temporary)):
        raise SystemExit("Proof output must be a fresh directory under RUNNER_TEMP")
    proof.mkdir()
    policy_path = repo / "resources/python-runtime/preparation.policy.json"
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    asset = policy["targets"][args.target]["python"]["asset"]
    lab = pathlib.Path(tempfile.mkdtemp(prefix="RT runtime \u8fd0\u884c ", dir=temporary))
    home = lab / "home"
    home.mkdir()
    env = child_environment(home)
    archive = lab / "python.tar.gz"
    print("stage=verified-pbs-download target=" + args.target, flush=True)
    download_python(asset, archive)
    extracted = lab / "toolchain"
    extract_python(archive, extracted)
    python = extracted / "python" / ("python.exe" if args.target == "win32-x64"
                                     else "bin/python3.13")
    probe = subprocess.run(
        [str(python), "-X", "utf8", "-B", "-I", "-c",
         "import json,platform,sys;print(json.dumps({'python':platform.python_version(),"
         "'platform':sys.platform,'machine':platform.machine(),'utf8':sys.flags.utf8_mode}))"],
        check=True, capture_output=True, encoding="utf-8", timeout=30, env=env)
    version = json.loads(probe.stdout)
    if version["python"] != "3.13.16" or version["utf8"] != 1:
        raise ValueError("Actual private interpreter did not match the reviewed runtime")
    ops = lab / "operations.json"
    ops.write_text(json.dumps({"schemaVersion": 1,
        "kind": "rt-private-runtime-operation-input-v1", "cacheRoots": [],
        "seedReports": {}, "sourceReceipt": None}), encoding="utf-8")
    work = lab / "prepare"
    handoff = lab / "handoff.json"
    log = proof / "prepare.log"
    command = [str(python), "-u", "-X", "utf8", "-B", "-I",
               str(repo / "scripts/prepare-private-python-runtime.py"), "prepare",
               "--policy", str(policy_path), "--target", args.target,
               "--operation-input", str(ops), "--work-root", str(work),
               "--out", str(handoff)]
    print("stage=native-full-resolve-materialize target=" + args.target, flush=True)
    with log.open("wb") as out:
        try:
            result = subprocess.run(command, cwd=repo, env=env, stdout=out,
                                    stderr=subprocess.STDOUT, timeout=1500)
        except subprocess.TimeoutExpired:
            out.write(b"\nPRIVATE_RUNTIME_PREPARATION_TIMEOUT\n")
            result = subprocess.CompletedProcess(command, 124)
    with log.open("rb") as stream:
        stream.seek(max(0, log.stat().st_size - 32768))
        print(stream.read().decode("utf-8", errors="replace"), flush=True)
    if result.returncode == 0 and not handoff.is_file():
        raise ValueError("Successful preparation did not produce a handoff")
    if result.returncode == 0:
        shutil.copyfile(handoff, proof / "handoff.json")
    # Only metadata is exported. No unapproved runtime, wheel, or vendor payload.
    copied = resolver_metadata(work, proof)
    for directory in (work, work / "resolve", work / "materialize"):
        for name in ("candidate-lock.json", "candidate-fragment.json", "native-evidence.json"):
            path = directory / name
            if path.is_file():
                exported = proof / (directory.name + "-" + name)
                shutil.copyfile(path, exported)
                copied.append(exported.name)
    source_paths = (
        "scripts/prepare-private-python-runtime.py", "resources/python-runtime/preparation.policy.json",
        "electron/shared/privatePythonRuntimeManifest.cjs", "resources/python-runtime/bootstrap.py",
        "resources/python-runtime/miniracer_unicode_adapter.py",
        "resources/python-runtime/pywencai_adapter.py", "scripts/build-mootdx-compat-wheel.py",
        "scripts/build-provider-source-wheels.py", "scripts/run-private-runtime-prepare-ci.py")
    summary = {"kind": "rt-private-runtime-native-preparation-candidate-v1",
        "target": args.target, "sourceCommit": os.environ.get("GITHUB_SHA"),
        "runId": os.environ.get("GITHUB_RUN_ID"), "attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "actualInterpreter": version, "pythonAsset": asset,
        "sourceHashes": {p: digest(repo / p) for p in source_paths},
        "prepareExit": result.returncode, "metadataFiles": copied,
        "releaseEligible": False, "formalBundle": False, "installedApplication": False,
        "formalBootstrapTested": False,
        "minimumMacOSLiveVerified": False, "operatingSystemNetworkSandboxVerified": False,
        "sourceAttestation": False, "providerRequestAPIsInvoked": False}
    (proof / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    sums = [digest(path) + "  " + path.name for path in sorted(proof.iterdir()) if path.is_file()]
    (proof / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", encoding="utf-8")
    print("stage=candidate-evidence-complete releaseEligible=false", flush=True)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
