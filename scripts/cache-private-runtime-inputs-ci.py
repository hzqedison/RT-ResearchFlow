"""Prepare non-authorizing runtime input caches on disposable native runners."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys

def load_module(name, source):
    spec = importlib.util.spec_from_file_location(name, source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True, choices=("win32-x64", "darwin-arm64", "darwin-x64"))
    parser.add_argument("--derived-dir", required=True)
    parser.add_argument("--original-cache")
    parser.add_argument("--work-root", required=True)
    args = parser.parse_args()
    if (os.environ.get("GITHUB_ACTIONS") != "true" or
            os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"):
        raise ValueError("Disposable hosted runner required")
    repo = Path(os.environ["GITHUB_WORKSPACE"]).resolve(strict=True)
    temporary = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    root = Path(args.work_root)
    if (not root.is_absolute() or root.exists() or root.is_symlink() or
            not root.resolve().is_relative_to(temporary)):
        raise ValueError("Fresh runner-owned work root required")
    helper = load_module("rt_prepare_ci", repo / "scripts/run-private-runtime-prepare-ci.py")
    if helper.native_target() != args.target:
        raise ValueError("Native target mismatch")
    helper.validated_cache_roots([args.derived_dir], temporary)
    if args.target == "win32-x64":
        if not args.original_cache:
            raise ValueError("Exact hosted original inputs required")
        helper.validated_cache_roots([args.original_cache], temporary)
    elif args.original_cache:
        raise ValueError("Mac accepts only pinned official original inputs")
    root.mkdir()
    source_exit = helper.verify_checkout(repo, root / "source-receipt.json", root / "source-proof.json")
    if source_exit:
        raise SystemExit(source_exit)
    downloader = load_module("rt_native_consumer_ci", repo / "scripts/run-lxml-native-consumer-ci.py")
    official = root / "official-inputs"
    official.mkdir()
    for asset in downloader.MAC_INPUTS:
        if "target" not in asset or asset["target"] == args.target:
            downloader.download_official(asset, official / asset["filename"])
    prepare = load_module("rt_prepare_runtime", repo / "scripts/prepare-private-python-runtime.py")
    policy, policy_sha = prepare.load_policy(repo / "resources/python-runtime/preparation.policy.json")
    original = Path(args.original_cache) if args.original_cache else official
    operations = prepare.cache_lxml_redistribution_inputs(
        policy, Path(args.derived_dir), original, root / "private-cache",
        official_inputs=official, target=args.target)
    # This schema contains cache paths only. The main producer collects its own
    # fresh source receipt; this helper does not grant execution or licensing.
    (root / "operations.json").write_text(json.dumps(operations, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"target": args.target, "policySha256": policy_sha,
        "cacheRoots": operations["cacheRoots"], "independentApproval": False,
        "formalBundle": False}), flush=True)

if __name__ == "__main__":
    main()
