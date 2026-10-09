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
    "source": "bb11d4eac221254d7ab23d40775b58e5e5861f2c6bef951ef6db5a5691b045e0",
    "wheel": "445653b6f07f2cab913065e5ebc946e69f485839e038d4056b27c403fc1da1c7"
  },
  "darwin-arm64": {
    "source": "2901bf8751ae2a25ac483f6233040e931cd8d7f7fda8321a1fd7ee1faf3eef98",
    "wheel": "15c6b6ae73b7a1624293c8498bc3e6df813e21301eba649a97f10e7072e6aa15"
  },
  "darwin-x64": {
    "source": "3b590453ff2b63388e2ced2f20d7affc79626b13d3d19a7281f0cedc4155ac58",
    "wheel": "0dab34eae6ec3423c326f1fe5c90f01c9ddc172f1380f03ba963e150ace73278"
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
        if not args.artifact_dir:
            raise ValueError("Exact hosted artifact input required")
        roots = helper.validated_cache_roots([args.artifact_dir], temporary)
        command.extend(["--artifact-dir", roots[0]])
    else:
        if args.artifact_dir:
            raise ValueError("Mac accepts only fixed official inputs")
        inputs = root / "official-inputs"
        inputs.mkdir()
        for asset in MAC_INPUTS:
            if "target" not in asset or asset["target"] == args.target:
                download_official(asset, inputs / asset["filename"])
        command.extend(["--official-inputs", str(inputs)])
    result = subprocess.run(command, cwd=repo, env=helper.child_environment(home), timeout=240)
    if result.returncode:
        raise SystemExit(result.returncode)
    print("stage=native-dependency-assembly-complete nativeCompiled=false releaseEligible=false", flush=True)

if __name__ == "__main__":
    main()
