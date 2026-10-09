"""Collect hosted checkout evidence; never grant independent release approval."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import urllib.request

REPOSITORY = "hzqedison/RT-ResearchFlow"
WORKFLOW_PATH = ".github/workflows/private-runtime-prepare-native.yml"
ROOT_SOURCES = (
    "electron/shared/privatePythonRuntimeManifest.cjs",
    "resources/python-runtime/bootstrap.py",
    "resources/python-runtime/miniracer_unicode_adapter.py",
    "resources/python-runtime/pywencai_adapter.py",
    "scripts/build-mootdx-compat-wheel.py",
    "scripts/build-provider-source-wheels.py",
    "scripts/prepare-private-python-runtime.py",
    "scripts/rebuild-lxml-native.py",
    "scripts/build-lxml-redistribution-wheel.py",
    "scripts/build-lxml-matched-public-source.py",
)
POLICY_PATH = "resources/python-runtime/preparation.policy.json"
PRODUCER_SOURCES = ("scripts/collect-private-runtime-ci-source.py",
                    "scripts/run-private-runtime-prepare-ci.py", WORKFLOW_PATH)
ASSEMBLY_WORKFLOW_PATH = ".github/workflows/lxml-redistribution-native.yml"
PRODUCER_CONTEXTS = {
    (WORKFLOW_PATH, "native-prepare"): PRODUCER_SOURCES,
    (ASSEMBLY_WORKFLOW_PATH, "native-assembly"): (
        "scripts/collect-private-runtime-ci-source.py",
        "scripts/run-lxml-native-consumer-ci.py", ASSEMBLY_WORKFLOW_PATH),
}
CONTEXT_KEYS = ("GITHUB_ACTIONS", "RUNNER_ENVIRONMENT", "GITHUB_WORKSPACE",
                "GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_RUN_ID",
                "GITHUB_RUN_ATTEMPT", "GITHUB_JOB", "GITHUB_WORKFLOW_REF",
                "GITHUB_EVENT_NAME", "RT_TARGET")


class Invalid(ValueError):
    pass


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode("ascii")


def relative(value):
    if not isinstance(value, str) or not value or "\\" in value or ":" in value:
        raise Invalid("Invalid source path")
    parts = PurePosixPath(value).parts
    if (value.startswith("/") or "/".join(parts) != value or
            any(x in (".", "..", ".git") or x.endswith((".", " ")) for x in parts) or
            any(ord(x) < 32 for x in value)):
        raise Invalid("Invalid source path")
    return value


def collect(context, fetch_json):
    if (context.get("GITHUB_ACTIONS") != "true" or
            context.get("RUNNER_ENVIRONMENT") != "github-hosted" or
            context.get("GITHUB_REPOSITORY") != REPOSITORY):
        raise Invalid("Unsupported producer context")
    sha = context.get("GITHUB_SHA", "")
    run_id, attempt = context.get("GITHUB_RUN_ID", ""), context.get("GITHUB_RUN_ATTEMPT", "")
    workflow_ref = context.get("GITHUB_WORKFLOW_REF", "")
    prefix, separator, branch_ref = workflow_ref.partition("@refs/heads/")
    workflow_path = prefix.removeprefix(REPOSITORY + "/") if prefix.startswith(REPOSITORY + "/") else ""
    producer_sources = PRODUCER_CONTEXTS.get((workflow_path, context.get("GITHUB_JOB")))
    if (not re.fullmatch(r"[a-f0-9]{40}", sha) or
            not re.fullmatch(r"[1-9][0-9]{0,19}", run_id) or
            not re.fullmatch(r"[1-9][0-9]{0,9}", attempt) or
            separator != "@refs/heads/" or not branch_ref or producer_sources is None or
            context.get("GITHUB_EVENT_NAME") not in ("push", "workflow_dispatch") or
            context.get("RT_TARGET") not in ("win32-x64", "darwin-arm64", "darwin-x64")):
        raise Invalid("Invalid immutable producer identifiers")
    root = Path(context.get("GITHUB_WORKSPACE", ""))
    if not root.is_absolute() or root.resolve() != root or not root.is_dir():
        raise Invalid("Checkout root must be resolved")
    git = root / ".git"
    if not git.is_dir() or git.is_symlink():
        raise Invalid("Expected controlled checkout metadata directory")
    base = "https://api.github.com/repos/" + REPOSITORY
    run_url = base + "/actions/runs/" + run_id + "/attempts/" + attempt
    run = fetch_json(run_url)
    branch = run.get("head_branch")
    if (run.get("id") != int(run_id) or run.get("run_attempt") != int(attempt) or
            run.get("head_sha") != sha or run.get("path") != workflow_path or
            run.get("repository", {}).get("full_name") != REPOSITORY or
            run.get("head_repository", {}).get("full_name") != REPOSITORY or
            run.get("event") != context["GITHUB_EVENT_NAME"] or
            not isinstance(branch, str) or not branch or
            workflow_ref != REPOSITORY + "/" + workflow_path + "@refs/heads/" + branch):
        raise Invalid("Actual producer run differs from supplied context")
    commit_url = base + "/git/commits/" + sha
    commit = fetch_json(commit_url)
    tree_sha = commit.get("tree", {}).get("sha", "")
    if commit.get("sha") != sha or not re.fullmatch(r"[a-f0-9]{40}", tree_sha):
        raise Invalid("Commit identity differs")
    tree_url = base + "/git/trees/" + tree_sha + "?recursive=1"
    tree = fetch_json(tree_url)
    entries = tree.get("tree")
    if (tree.get("sha") != tree_sha or tree.get("truncated") is not False or
            not isinstance(entries, list) or not 0 < len(entries) <= 20000):
        raise Invalid("Complete immutable tree is required")
    tracked, seen, bytes_checked, hashes = {}, set(), 0, {}
    for entry in entries:
        name = relative(entry.get("path"))
        folded = name.casefold()
        if folded in seen:
            raise Invalid("Source path collision")
        seen.add(folded)
        if entry.get("type") == "tree" and entry.get("mode") == "040000":
            continue
        if entry.get("type") != "blob" or entry.get("mode") not in ("100644", "100755"):
            raise Invalid("Unsupported symlink or submodule source")
        size, blob = entry.get("size"), entry.get("sha", "")
        if type(size) is not int or size < 0 or not re.fullmatch(r"[a-f0-9]{40}", blob):
            raise Invalid("Invalid source blob")
        bytes_checked += size
        if bytes_checked > 512 * 1024**2:
            raise Invalid("Source byte budget exceeded")
        path = root / name
        if path.resolve() != path or path.is_symlink():
            raise Invalid("Checkout path traverses a link")
        state = path.stat()
        if not stat.S_ISREG(state.st_mode) or state.st_size != size:
            raise Invalid("Checkout member size/type differs")
        if os.name != "nt" and bool(state.st_mode & 0o111) != (entry["mode"] == "100755"):
            raise Invalid("Checkout executable mode differs")
        git_hash, raw_hash = hashlib.sha1(), hashlib.sha256()
        git_hash.update(b"blob " + str(size).encode("ascii") + b"\0")
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(131072), b""):
                git_hash.update(chunk)
                raw_hash.update(chunk)
        if git_hash.hexdigest() != blob:
            raise Invalid("Checkout raw bytes differ from immutable blob")
        tracked[name] = blob
        hashes[name] = raw_hash.hexdigest()
    actual = set()
    def scan_error(error):
        raise Invalid("Checkout scan did not complete") from None
    for directory, directories, files in os.walk(root, followlinks=False, onerror=scan_error):
        if Path(directory) == root:
            directories[:] = [name for name in directories if name != ".git"]
        if any((Path(directory) / name).is_symlink() for name in directories):
            raise Invalid("Unexpected directory link")
        for name in files:
            path = Path(directory) / name
            if path.is_symlink() or not path.is_file():
                raise Invalid("Unexpected checkout member")
            actual.add(path.relative_to(root).as_posix())
    if actual != set(tracked):
        raise Invalid("Untracked or missing checkout source")
    required = set(ROOT_SOURCES) | {POLICY_PATH} | set(producer_sources)
    if not required <= hashes.keys():
        raise Invalid("Required consumed and producer source is absent")
    receipt = {"schemaVersion": 1, "kind": "rt-private-runtime-source-receipt-v1",
        "repository": "github.com/" + REPOSITORY, "sourceCommit": sha, "sourceTree": tree_sha,
        "checkoutClean": True, "policySha256": hashes[POLICY_PATH],
        "sourceFiles": [{"path": p, "sha256": hashes[p]} for p in sorted(ROOT_SOURCES)],
        "producer": {"kind": "github-actions", "workflowRef": workflow_ref,
            "runId": run_id, "runAttempt": attempt, "job": context["GITHUB_JOB"], "checkoutEventSha": sha}}
    proof = {"kind": "rt-private-runtime-checkout-byte-evidence-v1", "sourceCommit": sha,
        "sourceTree": tree_sha, "runId": run_id, "attempt": attempt, "target": context["RT_TARGET"],
        "receiptSha256": hashlib.sha256(encoded(receipt)).hexdigest(), "trackedFileCount": len(tracked),
        "trackedBytes": bytes_checked, "wholeCheckoutBytesCompared": True, "untrackedFiles": 0,
        "gitMetadataContentsRead": False, "independentApproval": False, "sourceVerified": False,
        "producerSourceHashes": {p: hashes[p] for p in producer_sources},
        "apiEvidence": {url: hashlib.sha256(encoded(value)).hexdigest()
                        for url, value in ((run_url, run), (commit_url, commit), (tree_url, tree))}}
    return receipt, proof


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Invalid("Source API redirects are refused")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", required=True, type=Path)
    parser.add_argument("--proof", required=True, type=Path)
    parser.add_argument("--check-receipt", action="store_true")
    args = parser.parse_args()
    context = {name: os.environ.get(name, "") for name in CONTEXT_KEYS}
    try:
        temporary = Path(os.environ["RUNNER_TEMP"]).resolve()
        for path in (args.receipt, args.proof):
            if (not path.is_absolute() or path.is_symlink() or path.parent.resolve() != path.parent or
                    not path.is_relative_to(temporary) or not path.parent.is_dir()):
                raise Invalid("Source evidence must use an owned runner temporary root")
        if args.proof.exists() or (args.receipt.exists() and not args.check_receipt):
            raise Invalid("Source evidence output must be fresh")
        # This is an explicitly supplied, repository-scoped workflow credential.
        # It is never forwarded to preparation, output or fetched from user storage.
        token = os.environ.get("SOURCE_VERIFICATION_TOKEN")
        if not token:
            raise Invalid("Missing supplied workflow API credential")
        opener = urllib.request.build_opener(NoRedirect())
        def fetch_json(url):
            request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                "User-Agent": "RT-ResearchFlow-source-proof-v1", "Authorization": "Bearer " + token})
            with opener.open(request, timeout=30) as response:
                data = response.read(8 * 1024**2 + 1)
            if len(data) > 8 * 1024**2:
                raise Invalid("Source API response byte limit")
            return json.loads(data)
        receipt, proof = collect(context, fetch_json)
        raw = encoded(receipt)
        if args.check_receipt:
            if args.receipt.read_bytes() != raw:
                raise Invalid("Source receipt changed during preparation")
        else:
            with args.receipt.open("xb") as out:
                out.write(raw)
        with args.proof.open("xb") as out:
            out.write(encoded(proof))
        print("PRIVATE_RUNTIME_SOURCE_BYTES_MATCHED independentApproval=false")
        return 0
    except (Invalid, OSError, ValueError, TypeError, KeyError, AttributeError):
        print("PRIVATE_RUNTIME_SOURCE_INVALID", file=sys.stderr)
        return 74


if __name__ == "__main__":
    raise SystemExit(main())
