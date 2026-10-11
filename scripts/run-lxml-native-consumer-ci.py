"""Assemble fixed native dependency inputs on disposable hosted runners."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.parse
import urllib.request

MAC_INPUTS = [
  {
    "filename": "lxml-6.1.3.tar.gz",
    "sha256": "45222d94ddd511536f3b2f7d9deae3b2339b4ce0f075f1ca25703b07cad9dd21",
    "size": 4211198,
    "url": "https://files.pythonhosted.org/packages/23/ad/28ecd7cb894d172f3c9c80a075eeeb2017ac62e3632cee05a5f9493547eb/lxml-6.1.3.tar.gz"
  },
  {
    "filename": "lxml-6.1.3-cp313-cp313-macosx_10_13_universal2.whl",
    "sha256": "3a48093cdb058a93af842ede9703520e810b05dcd0fc6d7190a06376c3bfb6bd",
    "size": 8590357,
    "target": "darwin-arm64",
    "url": "https://files.pythonhosted.org/packages/52/05/3ef45db776baea068044c799bbba68f3ca00a440c0e930a17c572f3d9639/lxml-6.1.3-cp313-cp313-macosx_10_13_universal2.whl"
  },
  {
    "filename": "lxml-6.1.3-cp313-cp313-macosx_10_13_x86_64.whl",
    "sha256": "887c021d9a977cff89cb273047c1352997b772a8908a25c21836861f69b92be1",
    "size": 4632616,
    "target": "darwin-x64",
    "url": "https://files.pythonhosted.org/packages/8c/a5/eee2fc77eee5ea68e4a4334b1def1781a3beaeefd3d98e81b4a38dc447b7/lxml-6.1.3-cp313-cp313-macosx_10_13_x86_64.whl"
  }
]
OUTPUTS = {
  "win32-x64": {
    "source": "50569086381ddf5bb8ca35ed01bd6c480dad33b0bc18384182d59e51903db60d",
    "wheel": "6d7435ecd2edf1f184dd661b57153412e51b1af8a0ef657cf5f01e60d853b221"
  },
  "darwin-arm64": {
    "source": "05151c1e93f922b8d30dc5d7007ee906437c2b66560f39fdbb6e708b46361b84",
    "wheel": "3be8dfec49d3f81162ba3b63ead0638e2cebe65921de28ea0b58ba587aa19f6d"
  },
  "darwin-x64": {
    "source": "7defad97b795547e04b436553cbfe903cde96c40242523bc5c9f9e3064ea1e25",
    "wheel": "11a9a6fcc74a18e120ef36fcd4d1652c0e7684bb46025616d5af99de8f98cdf8"
  }
}

def download_official(asset, destination):
    url = urllib.parse.urlsplit(asset["url"])
    if (url.scheme != "https" or url.hostname != "files.pythonhosted.org" or
            url.username or url.password or url.port is not None or
            urllib.parse.unquote(url.path.rsplit("/", 1)[-1]) != asset["filename"]):
        raise ValueError("Unexpected official input URL")
    size = asset["size"]
    with urllib.request.urlopen(asset["url"], timeout=60) as response:
        data = response.read(size + 1)
    if len(data) != size or hashlib.sha256(data).hexdigest() != asset["sha256"]:
        raise ValueError("Pinned official input bytes mismatch")
    with destination.open("xb") as output:
        output.write(data)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True, choices=tuple(OUTPUTS))
    parser.add_argument("--proof-dir", required=True)
    parser.add_argument("--artifact-dir")
    parser.add_argument("--mac-native-inputs")
    args = parser.parse_args()
    if (os.environ.get("GITHUB_ACTIONS") != "true" or
            os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"):
        raise ValueError("Disposable hosted runner required")
    repo = Path(os.environ["GITHUB_WORKSPACE"]).resolve(strict=True)
    temporary = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    root = Path(args.proof_dir)
    if (not root.is_absolute() or root.exists() or root.is_symlink() or
            not root.resolve().is_relative_to(temporary)):
        raise ValueError("Fresh runner-owned proof directory required")
    spec = importlib.util.spec_from_file_location("rt_native_prepare_ci",
        repo / "scripts/run-private-runtime-prepare-ci.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    if helper.native_target() != args.target:
        raise ValueError("Native target mismatch")
    root.mkdir()
    home = root / "home"
    home.mkdir()
    policy = json.loads((repo / "resources/python-runtime/preparation.policy.json").read_text(encoding="utf-8"))
    python_asset = policy["targets"][args.target]["python"]["asset"]
    archive = root / "python.tar.gz"
    helper.download_python(python_asset, archive)
    helper.extract_python(archive, root / "toolchain")
    python = root / "toolchain/python" / ("python.exe" if args.target == "win32-x64" else "bin/python3.13")
    command = [str(python), "-X", "utf8", "-B", "-I",
        str(repo / "scripts/consume-hosted-lxml.py"), "--repo", str(repo),
        "--target", args.target, "--out", str(root / "derived"),
        "--expected-source-sha256", OUTPUTS[args.target]["source"],
        "--expected-wheel-sha256", OUTPUTS[args.target]["wheel"]]
    if args.target == "win32-x64":
        if args.mac_native_inputs:
            raise ValueError("Windows does not accept Mac source materials")
        if not args.artifact_dir:
            raise ValueError("Exact hosted artifact input required")
        roots = helper.validated_cache_roots([args.artifact_dir], temporary)
        command.extend(["--artifact-dir", roots[0]])
    else:
        if args.artifact_dir:
            raise ValueError("Mac accepts only fixed official inputs")
        if not args.mac_native_inputs:
            raise ValueError("Complete pinned Mac source materials required")
        native_inputs = helper.validated_cache_roots([args.mac_native_inputs], temporary)[0]
        inputs = root / "official-inputs"
        inputs.mkdir()
        for asset in MAC_INPUTS:
            if "target" not in asset or asset["target"] == args.target:
                download_official(asset, inputs / asset["filename"])
        command.extend(["--official-inputs", str(inputs), "--mac-native-inputs", native_inputs])
    result = subprocess.run(command, cwd=repo, env=helper.child_environment(home), timeout=240)
    if result.returncode:
        raise SystemExit(result.returncode)
    print("stage=native-dependency-assembly-complete nativeCompiled=false releaseEligible=false", flush=True)

if __name__ == "__main__":
    main()
