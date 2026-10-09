import copy
import hashlib
import importlib.util
import json
import os
import re
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

def parametrize(fields, cases):
    """Standard-library parameter expansion; no test dependency enters the runtime."""
    def decorate(function):
        function.parameter_cases = [(value,) if len(fields.split(",")) == 1 else value for value in cases]
        return function
    return decorate


REPOSITORY = "hzqedison/RT-ResearchFlow"
WORKFLOW_PATH = ".github/workflows/private-runtime-prepare-native.yml"
WORKFLOW_REF = (
    REPOSITORY
    + "/"
    + WORKFLOW_PATH
    + "@refs/heads/codex/verify-1.7"
)
COMMIT_SHA = "1" * 40
TREE_SHA = "2" * 40
RUN_ID = 4815162342
RUN_ATTEMPT = 3
EVENT = "push"
TARGET = "win32-x64"


def _load_collector():
    repository_root = Path(__file__).resolve().parents[2]
    script_path = repository_root / "scripts" / "collect-private-runtime-ci-source.py"
    spec = importlib.util.spec_from_file_location(
        "private_runtime_ci_source_collector", script_path
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load collector at {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _git_blob_sha1(content):
    header = b"blob " + str(len(content)).encode("ascii") + b"\0"
    return hashlib.sha1(header + content).hexdigest()


class Fixture:
    def __init__(self, tmp_path):
        self.root = Path(tmp_path) / "checkout"
        self.root.mkdir(parents=True)
        self.context = {
            "GITHUB_ACTIONS": "true",
            "RUNNER_ENVIRONMENT": "github-hosted",
            "GITHUB_WORKSPACE": str(self.root),
            "GITHUB_REPOSITORY": REPOSITORY,
            "GITHUB_SHA": COMMIT_SHA,
            "GITHUB_RUN_ID": str(RUN_ID),
            "GITHUB_RUN_ATTEMPT": str(RUN_ATTEMPT),
            "GITHUB_JOB": "native-prepare",
            "GITHUB_WORKFLOW_REF": WORKFLOW_REF,
            "GITHUB_EVENT_NAME": EVENT,
            "RT_TARGET": TARGET,
        }
        self.run = {
            "id": RUN_ID,
            "run_attempt": RUN_ATTEMPT,
            "head_sha": COMMIT_SHA,
            "head_branch": "codex/verify-1.7",
            "path": WORKFLOW_PATH,
            "repository": {"full_name": REPOSITORY},
            "head_repository": {"full_name": REPOSITORY},
            "event": EVENT,
        }
        self.commit = {"sha": COMMIT_SHA, "tree": {"sha": TREE_SHA}}
        self.files = {}
        self.requests = []

    def add_file(self, path, content):
        path = path.replace("\\", "/")
        destination = self.root.joinpath(*path.split("/"))
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        self.files[path] = content

    def make_tree(self, overrides=None, extra=None, truncated=False, sha=TREE_SHA):
        overrides = overrides or {}
        entries = []
        for path, content in self.files.items():
            entry = {
                "path": path,
                "mode": "100644",
                "type": "blob",
                "sha": _git_blob_sha1(content),
                "size": len(content),
            }
            entry.update(overrides.get(path, {}))
            entries.append(entry)
        entries.extend(extra or [])
        self.tree = {"sha": sha, "truncated": truncated, "tree": entries}

    def fetcher(self):
        responses = {
            "run": copy.deepcopy(self.run),
            "commit": copy.deepcopy(self.commit),
            "tree": copy.deepcopy(self.tree),
        }

        def fetch_json(url):
            self.requests.append(url)
            base = "https://api.github.com/repos/" + REPOSITORY
            if url.startswith(base + "/actions/runs/"):
                return copy.deepcopy(responses["run"])
            if url.startswith(base + "/git/commits/"):
                return copy.deepcopy(responses["commit"])
            if url.startswith(base + "/git/trees/"):
                return copy.deepcopy(responses["tree"])
            raise AssertionError(f"Unexpected API request in isolated fixture: {url}")

        return fetch_json


def _fixture(tmp_path, module):
    fixture = Fixture(tmp_path)
    (fixture.root / ".git").mkdir()
    for path in module.ROOT_SOURCES:
        fixture.add_file(path, ("fixture source: " + path + "\n").encode("utf-8"))
    fixture.add_file(module.POLICY_PATH, b'{"policy":"fixture"}\n')
    for path in module.PRODUCER_SOURCES:
        fixture.add_file(path, ("# fixture producer: " + path + "\n").encode("utf-8"))
    fixture.make_tree()
    return fixture


def _all_mappings(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _all_mappings(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            yield from _all_mappings(child)


def _payloads(receipt, proof):
    return list(_all_mappings({"receipt": receipt, "proof": proof}))


def _source_records(receipt, proof):
    for mapping in _payloads(receipt, proof):
        records = mapping.get("sourceFiles")
        if isinstance(records, list):
            return records
    raise AssertionError("Neither receipt nor proof contains sourceFiles")


def _is_clean(receipt, proof):
    return any(mapping.get("clean") is True for mapping in _payloads(receipt, proof))


def _assert_invalid(module, fixture, context=None):
    try:
        module.collect(context or fixture.context, fixture.fetcher())
    except module.Invalid:
        return
    raise AssertionError("Invalid checkout evidence was accepted")


def test_genuine_fixture_collects_seven_sorted_sources_and_clean_proof(tmp_path):
    module = _load_collector()
    fixture = _fixture(tmp_path / "tree-case", module)

    receipt, proof = module.collect(fixture.context, fixture.fetcher())

    assert receipt["checkoutClean"] is True
    assert proof["wholeCheckoutBytesCompared"] is True
    assert proof["independentApproval"] is False
    assert proof["sourceVerified"] is False
    assert len(fixture.requests) == 3
    assert fixture.requests == [
        "https://api.github.com/repos/" + REPOSITORY + "/actions/runs/"
        + str(RUN_ID) + "/attempts/" + str(RUN_ATTEMPT),
        "https://api.github.com/repos/" + REPOSITORY + "/git/commits/" + COMMIT_SHA,
        "https://api.github.com/repos/" + REPOSITORY + "/git/trees/"
        + TREE_SHA + "?recursive=1",
    ]
    records = _source_records(receipt, proof)
    expected_paths = sorted(module.ROOT_SOURCES)
    assert [record["path"] for record in records] == expected_paths
    assert len(records) == 7
    for record in records:
        content = fixture.files[record["path"]]
        assert record["sha256"] == hashlib.sha256(content).hexdigest()
        assert re.fullmatch(r"[0-9a-f]{64}", record["sha256"])

    for path in expected_paths:
        entry = next(item for item in fixture.tree["tree"] if item["path"] == path)
        assert entry["sha"] == _git_blob_sha1(fixture.files[path])


@parametrize(
    "field,value",
    [
        ("GITHUB_RUN_ID", "4815162343"),
        ("GITHUB_RUN_ATTEMPT", "4"),
        ("GITHUB_SHA", "3" * 40),
        ("GITHUB_WORKFLOW_REF", REPOSITORY + "/other.yml@refs/heads/codex/verify-1.7"),
        ("GITHUB_EVENT_NAME", "pull_request"),
        ("GITHUB_REPOSITORY", "someone-else/RT-ResearchFlow"),
    ],
)
def test_rejects_mismatched_context_and_run_provenance(tmp_path, field, value):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    context = dict(fixture.context)
    context[field] = value
    _assert_invalid(module, fixture, context)


@parametrize(
    "run_field,value",
    [
        ("id", RUN_ID + 1),
        ("run_attempt", RUN_ATTEMPT + 1),
        ("head_sha", "3" * 40),
        ("path", "other.yml"),
        ("event", "pull_request"),
    ],
)
def test_rejects_mismatched_github_run_response(tmp_path, run_field, value):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    fixture.run[run_field] = value
    _assert_invalid(module, fixture)


@parametrize("repository_field", ["repository", "head_repository"])
def test_rejects_foreign_repository_in_run_response(tmp_path, repository_field):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    fixture.run[repository_field] = {"full_name": "attacker/RT-ResearchFlow"}
    _assert_invalid(module, fixture)


def test_rejects_commit_or_tree_identity_mismatch(tmp_path):
    module = _load_collector()
    fixture = _fixture(tmp_path / "commit-case", module)
    fixture.commit["sha"] = "3" * 40
    _assert_invalid(module, fixture)

    fixture = _fixture(tmp_path / "tree-case", module)
    fixture.make_tree(sha="4" * 40)
    _assert_invalid(module, fixture)


def test_rejects_truncated_recursive_tree(tmp_path):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    fixture.make_tree(truncated=True)
    _assert_invalid(module, fixture)


@parametrize("mutation", ["bytes", "size"])
def test_rejects_changed_tracked_source_bytes_or_size(tmp_path, mutation):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    path = module.ROOT_SOURCES[0]
    if mutation == "bytes":
        destination = fixture.root.joinpath(*path.split("/"))
        destination.write_bytes(b"changed after the API snapshot\n")
    else:
        fixture.tree["tree"][0]["size"] += 1
    _assert_invalid(module, fixture)


def test_rejects_untracked_workspace_file(tmp_path):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    (fixture.root / "untracked.txt").write_text("not in the run tree", encoding="utf-8")
    _assert_invalid(module, fixture)


@parametrize(
    "entry",
    [
        {"mode": "120000", "type": "blob"},
        {"mode": "160000", "type": "commit"},
    ],
)
def test_rejects_source_symlink_or_submodule_mode(tmp_path, entry):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    source = module.ROOT_SOURCES[0]
    fixture.make_tree(overrides={source: entry})
    _assert_invalid(module, fixture)


@parametrize("unsafe_path", ["../escape", "/absolute", "a//b", "a/./b"])
def test_rejects_unsafe_tree_paths(tmp_path, unsafe_path):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    fixture.make_tree(
        extra=[
            {
                "path": unsafe_path,
                "mode": "100644",
                "type": "blob",
                "sha": "5" * 40,
                "size": 1,
            }
        ]
    )
    _assert_invalid(module, fixture)


def test_rejects_case_colliding_tree_paths(tmp_path):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    source = module.ROOT_SOURCES[0]
    fixture.make_tree(
        extra=[
            {
                "path": source.swapcase(),
                "mode": "100644",
                "type": "blob",
                "sha": "6" * 40,
                "size": 1,
            }
        ]
    )
    _assert_invalid(module, fixture)


def test_git_metadata_directory_is_controlled_and_its_contents_are_not_read(tmp_path):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    git_dir = fixture.root / ".git"
    secret = git_dir / "config"
    secret.write_bytes(b"credential-helper=must-not-be-read\n")

    receipt, proof = module.collect(fixture.context, fixture.fetcher())

    assert receipt["checkoutClean"] is True
    assert proof["gitMetadataContentsRead"] is False
    assert len(_source_records(receipt, proof)) == 7


def test_synthetic_contract_proof_is_not_native_or_producer_approval(tmp_path):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)

    receipt, proof = module.collect(fixture.context, fixture.fetcher())

    rendered = json.dumps({"receipt": receipt, "proof": proof}, sort_keys=True).lower()
    assert proof["independentApproval"] is False
    assert proof["sourceVerified"] is False
    assert not any(
        marker in rendered
        for marker in ("native approval", "producer approval", "approved by producer")
    )


def test_rejects_unrelated_branch_with_same_workflow_path(tmp_path):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    fixture.context["GITHUB_WORKFLOW_REF"] = REPOSITORY + "/" + WORKFLOW_PATH + "@refs/heads/foreign"
    _assert_invalid(module, fixture)


def test_rejects_api_branch_that_differs_from_actual_context(tmp_path):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    fixture.run["head_branch"] = "foreign"
    _assert_invalid(module, fixture)


def test_scan_errors_cannot_silently_hide_untracked_files(tmp_path):
    module = _load_collector()
    fixture = _fixture(tmp_path, module)
    def incomplete_walk(*args, **kwargs):
        callback = kwargs.get("onerror")
        assert callback is not None
        callback(PermissionError("CANARY_MUST_NOT_BE_EXPORTED"))
        return iter(())
    with patch.object(module.os, "walk", side_effect=incomplete_walk):
        _assert_invalid(module, fixture)


class SourceCollectorContracts(unittest.TestCase):
    pass


def _make_method(function, values):
    def method(self):
        if os.name == "nt" and os.environ.get("GITHUB_ACTIONS") != "true":
            directory = "D:/RT-ResearchFlow-BuildCache"
        else:
            directory = os.environ.get("RUNNER_TEMP")
        with tempfile.TemporaryDirectory(prefix="ci-source-contract-", dir=directory) as temporary:
            function(Path(temporary), *values)
    return method


for _name, _function in list(globals().items()):
    if _name.startswith("test_") and callable(_function):
        for _index, _values in enumerate(getattr(_function, "parameter_cases", [()])):
            setattr(SourceCollectorContracts, _name + "_%02d" % _index, _make_method(_function, _values))


if __name__ == "__main__":
    unittest.main()
