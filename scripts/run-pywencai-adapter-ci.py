"""Disposable native candidate tests, not an application/runtime release gate."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
import zipfile

PBS = "https://github.com/astral-sh/python-build-standalone/releases/download/20261003/"
NODE = "https://nodejs.org/dist/v22.23.3/"
TARGETS = {
    "win32-x64": (
        ("cpython-3.13.16+20261003-x86_64-pc-windows-msvc-install_only.tar.gz", 47421192,
         "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778"),
        ("node-v22.23.3-win-x64.zip", 35574076,
         "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71")),
    "darwin-arm64": (
        ("cpython-3.13.16+20261003-aarch64-apple-darwin-install_only.tar.gz", 25365830,
         "d8975d7df4f08f7b1c7aafcdfacbddcec3d366415f2c1a72b2466b6850815933"),
        ("node-v22.23.3-darwin-arm64.tar.gz", 49963763,
         "23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53")),
    "darwin-x64": (
        ("cpython-3.13.16+20261003-x86_64-apple-darwin-install_only.tar.gz", 25067280,
         "8e9cb087305bfb8969f68a905f79f41469d4aa5220c1aa71ada7fc9953bdba0f"),
        ("node-v22.23.3-darwin-x64.tar.gz", 51142049,
         "8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8")),
}
SDISTS = (
    ("jsonpath-0.82.2.tar.gz", 10353,
     "d87ef2bcbcded68ee96bc34c1809b69457ecec9b0c4dd471658a12bd391002d1",
     "https://files.pythonhosted.org/packages/cf/a1/693351acd0a9edca4de9153372a65e75398898ea7f8a5c722ab00f464929/jsonpath-0.82.2.tar.gz"),
    ("PyExecJS-1.5.1.tar.gz", 13344,
     "34cc1d070976918183ff7bdc0ad71f8157a891c92708c00c5fbbff7a769f505c",
     "https://files.pythonhosted.org/packages/ba/8e/aedef81641c8dca6fd0fb7294de5bed9c45f3397d67fddf755c1042c2642/PyExecJS-1.5.1.tar.gz"),
)
PROVIDER = (
    "pywencai-0.13.1-py3-none-any.whl", 911600,
    "6786a014baed92cef25d855f8f175c5265868552dfacd7e37c098f92e4e038ff",
    "https://files.pythonhosted.org/packages/c7/71/6fa9606a3c042e59f8020914e59d4d4919100e0cd53697d7e2a677f70835/pywencai-0.13.1-py3-none-any.whl",
)
RECIPE_SHA = "3d53de6ca20346ef6b284976d7ebd95c6a29ff9f6fe37b6b995127571ca801da"
EXECJS_SHA = "de51fa4692182d14c6005396e2dafa45368090dc64526e7fea9fde7a856fce28"
JSONPATH_SHA = "f0cef8d52734c71e1c06a2da87940a72c8840d7f3e64cbb123b6b3b29f0db117"


def digest(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1048576), b""):
            result.update(block)
    return result.hexdigest()


def download(asset, directory):
    name, size, sha, url = asset
    if not re.fullmatch(r"[a-f0-9]{64}", sha) or type(size) is not int or size < 1:
        raise ValueError("Invalid fixed asset pin")
    destination = directory / name
    count = 0
    with urllib.request.urlopen(url, timeout=40) as response, destination.open("xb") as handle:
        for block in iter(lambda: response.read(1048576), b""):
            count += len(block)
            if count > size:
                raise ValueError("Asset exceeded pinned bytes")
            handle.write(block)
    if count != size or digest(destination) != sha:
        raise ValueError("Asset differs from exact public pin")
    return destination


def extract(archive, destination):
    destination.mkdir()
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as handle:
            for member in handle.infolist():
                if (member.filename.startswith(("/", "\\")) or "\\" in member.filename or
                    ":" in member.filename or ".." in member.filename.split("/") or
                    (member.external_attr >> 16) & 0o170000 == 0o120000):
                    raise ValueError("Unsafe fixed ZIP member")
                if not (destination / member.filename).resolve().is_relative_to(destination.resolve()):
                    raise ValueError("ZIP member leaves owned root")
            handle.extractall(destination)
    else:
        with tarfile.open(archive, "r:gz") as handle:
            members = handle.getmembers()
            if len(members) > 50000 or sum(max(0, item.size) for item in members) > 2 * 1024 ** 3:
                raise ValueError("Fixed archive exceeds extraction budget")
            for member in members:
                if "\\" in member.name or ":" in member.name or ".." in member.name.split("/"):
                    raise ValueError("Unsafe fixed TAR member")
            handle.extractall(destination, members=members, filter="data")


SOCKET_GUARD = """
import runpy,socket,sys
def denied(*args,**kwargs):
    raise RuntimeError('Python socket APIs disabled for candidate tests')
for name in ('getaddrinfo','gethostbyname','gethostbyname_ex','gethostbyaddr','create_connection'):
    setattr(socket,name,denied)
for name in ('connect','connect_ex','sendto','sendmsg'):
    if hasattr(socket.socket,name):setattr(socket.socket,name,denied)
sys.argv=sys.argv[1:]
runpy.run_path(sys.argv[0],run_name='__main__')
"""


def run(command, cwd, env, evidence, name, timeout=180):
    result = subprocess.run([str(item) for item in command], cwd=cwd, env=env,
                            capture_output=True, text=True, encoding="utf8", errors="strict", timeout=timeout)
    (evidence / (name + ".stdout.log")).write_text(result.stdout, encoding="utf8")
    (evidence / (name + ".stderr.log")).write_text(result.stderr, encoding="utf8")
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise RuntimeError("Native candidate command failed: " + name)
    return result


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
        raise ValueError("Only a disposable GitHub-hosted runner may prepare this candidate")
    target = os.environ["RT_EXPECTED_TARGET"]
    if target not in TARGETS or target.split("-")[0] != sys.platform:
        raise ValueError("Unexpected native host")
    commit = os.environ.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Actual checkout source identity is missing")
    root = Path(__file__).resolve().parents[1]
    recipe = root / "scripts/build-provider-source-wheels.py"
    if digest(recipe) != RECIPE_SHA:
        raise ValueError("Reviewed recipe changed")
    lab = Path(tempfile.mkdtemp(prefix="RT pywencai \u8fd0\u884c ", dir=os.environ["RUNNER_TEMP"])).resolve()
    evidence = lab / "evidence"
    evidence.mkdir()
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf8") as handle:
        handle.write("RT_PYWENCAI_EVIDENCE=" + str(evidence) + "\n")
    assets = lab / "assets"
    assets.mkdir()
    pbs, node = TARGETS[target]
    pbs_archive = download((*pbs, PBS + urllib.parse.quote(pbs[0], safe="")), assets)
    node_archive = download((*node, NODE + node[0]), assets)
    extract(pbs_archive, lab / "pbs")
    extract(node_archive, lab / "node")
    python = lab / "pbs/python" / ("python.exe" if sys.platform == "win32" else "bin/python3.13")
    node_root = lab / "node" / node[0].removesuffix(".zip").removesuffix(".tar.gz")
    node_executable = node_root / ("node.exe" if sys.platform == "win32" else "bin/node")
    scratch = lab / "scratch"
    scratch.mkdir()
    env = {key: value for key, value in os.environ.items() if not key.startswith(("GITHUB_", "ACTIONS_", "PIP_", "PYTHON"))
           and key.upper() not in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NODE_OPTIONS", "NODE_PATH")}
    env.update({"HOME": str(scratch), "USERPROFILE": str(scratch), "TEMP": str(scratch), "TMP": str(scratch), "TMPDIR": str(scratch)})
    identity = run([python, "-B", "-I", "-S", "-X", "utf8", "-c",
                    "import json,platform,sys;print(json.dumps({'version':platform.python_version(),'platform':sys.platform,'machine':platform.machine()}))"],
                   root, env, evidence, "python-identity")
    actual = json.loads(identity.stdout)
    machines = {"win32-x64": {"amd64", "x86_64"}, "darwin-arm64": {"arm64", "aarch64"}, "darwin-x64": {"x86_64"}}
    if actual["version"] != "3.13.16" or actual["platform"] != sys.platform or actual["machine"].lower() not in machines[target]:
        raise ValueError("Pinned Python version/architecture mismatch")
    if run([node_executable, "--version"], root, env, evidence, "node-identity").stdout.strip() != "v22.23.3":
        raise ValueError("Pinned Node version mismatch")
    # The audited recipe forbids outputs below the source cache parent.
    # Keep inputs in a distinct cache subtree; never weaken that guard.
    sdists = lab / "source-cache/sdists"
    sdists.mkdir(parents=True)
    for item in SDISTS:
        download(item, sdists)
    wheels = lab / "provider-source-wheels-ci"
    run([python, "-B", "-I", "-S", "-X", "utf8", recipe, "--sdist-dir", sdists, "--output-dir", wheels],
        root, env, evidence, "audited-source-wheels")
    execjs = wheels / "pyexecjs-1.5.1-py2.py3-none-any.whl"
    jsonpath = wheels / "jsonpath-0.82.2-py2.py3-none-any.whl"
    if digest(execjs) != EXECJS_SHA or digest(jsonpath) != JSONPATH_SHA:
        raise ValueError("Audited derived wheel differs")
    provider = download(PROVIDER, assets)
    site = lab / "provider-site"
    report = evidence / "pip-resolution.json"
    run([python, "-B", "-I", "-X", "utf8", "-m", "pip", "--isolated", "install", "--disable-pip-version-check",
         "--no-input", "--no-cache-dir", "--only-binary=:all:", "--index-url", "https://pypi.org/simple/",
         "--target", site, "--report", report, provider, execjs, jsonpath, "numpy==2.5.3", "requests==2.34.2", "urllib3==2.7.0"],
        root, env, evidence, "full-provider-install", timeout=480)
    counts = []
    for name, filename, expected, extras in (
        ("bounded-inflate", "test_pywencai_bounded_inflate.py", 17, []),
        ("native-adapter", "test_private_pywencai_adapter.py", 30, ["--site", site, "--node", node_executable]),
    ):
        test = root / "tests/python" / filename
        result = run([python, "-B", "-I", "-S", "-X", "utf8", "-c", SOCKET_GUARD, test, *extras, "-v"],
                     root, env, evidence, name)
        matches = re.findall(r"Ran (\d+) tests? in", result.stderr)
        if matches != [str(expected)] or not re.search(r"(?m)^OK\s*$", result.stderr) or "skipped=" in result.stderr:
            raise ValueError("Unexpected or skipped candidate test count")
        counts.append({"suite": name, "tests": expected, "exitCode": result.returncode})
    sources = {name: digest(root / name) for name in (
        "scripts/run-pywencai-adapter-ci.py", "scripts/build-provider-source-wheels.py",
        "resources/python-runtime/pywencai_adapter.py", "tests/python/test_pywencai_bounded_inflate.py",
        "tests/python/test_private_pywencai_adapter.py")}
    result = {"schemaVersion": 1, "kind": "rt-private-pywencai-candidate-ci", "releaseEligible": False,
              "sourceCommit": commit, "runId": os.environ.get("GITHUB_RUN_ID"), "runAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
              "target": target, "actualPython": actual, "pythonExecutableSha256": digest(python),
              "nodeVersion": "22.23.3", "nodeExecutableSha256": digest(node_executable), "sourceHashes": sources,
              "assetPins": [list(pbs), list(node), list(PROVIDER[:3])], "tests": counts,
              "providerRequests": False, "pythonSocketAPIsBlocked": True, "nodeOSNetworkSandboxVerified": False,
              "minimumMacOSVerified": False, "totalWorkerRSSBounded": False,
              "installedApplicationTested": False, "runtimeLicenseApproval": False, "formalBundleTested": False}
    (evidence / "candidate-evidence.json").write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf8")
    files = sorted(item for item in evidence.iterdir() if item.is_file())
    (evidence / "SHA256SUMS").write_text("".join(digest(item) + "  " + item.name + "\n" for item in files), encoding="utf8")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
