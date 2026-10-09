"""Bounded, no-network unit tests; these never constitute release evidence."""
import argparse
import ast
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import signal
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts/report-private-runtime-native-bootstrap.py"
spec = importlib.util.spec_from_file_location("native_bootstrap_reporter_tests", SOURCE)
reporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reporter)
PRIVATE_NODE = None


def load_source(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bootstrap = load_source("preseal_bootstrap_unit_tests", ROOT / "resources/python-runtime/bootstrap.py")
adapter = load_source("preseal_adapter_unit_tests", ROOT / "resources/python-runtime/pywencai_adapter.py")


class NativeReporterTests(unittest.TestCase):
    def test_owned_root_boundaries_and_no_environment_authority(self):
        with mock.patch.dict(os.environ, {"RT_PRE_SEAL_OWNED_POSIX_ROOT": "101"}), \
                mock.patch.object(os, "name", "posix"), \
                mock.patch.object(os, "getpgrp", create=True, return_value=101), \
                mock.patch.object(os, "getsid", create=True, return_value=101), \
                mock.patch.object(os, "getpgid", create=True, return_value=101), \
                mock.patch.object(os, "getpid", return_value=101):
            self.assertEqual(reporter.validate_pre_seal_owned_posix_root("101", leader=True), 101)
            self.assertEqual(bootstrap.validate_pre_seal_owned_posix_root("101"), 101)
            self.assertEqual(adapter.validate_pre_seal_owned_posix_root(101), 101)
            for value in (None, True, 0, 1, -1, "01", "", "abc", "2147483648"):
                with self.subTest(value=value):
                    with self.assertRaises(reporter.Invalid):
                        reporter.validate_pre_seal_owned_posix_root(value)
                    with self.assertRaises((SystemExit, adapter.SafeFailure)):
                        bootstrap.validate_pre_seal_owned_posix_root(value)
            with mock.patch.object(reporter, "native_target", return_value=("darwin-arm64", "darwin", "arm64")):
                with self.assertRaises(reporter.Pending):
                    reporter.ownership_preflight()
                self.assertEqual(reporter.ownership_preflight("101")["ownedPosixRoot"], 101)
            with mock.patch.object(os, "getpgid", return_value=102):
                with self.assertRaises(reporter.Invalid):
                    reporter.validate_pre_seal_owned_posix_root(101)
                with self.assertRaises(SystemExit):
                    bootstrap.validate_pre_seal_owned_posix_root(101)
                with self.assertRaises(adapter.SafeFailure):
                    adapter.validate_pre_seal_owned_posix_root(101)
            with mock.patch.object(os, "getpid", return_value=102):
                with self.assertRaises(reporter.Invalid):
                    reporter.validate_pre_seal_owned_posix_root(101, leader=True)

    def test_sourcebound_node_session_switches_and_explicit_bootstrap_flag(self):
        bootstrap_tree = ast.parse((ROOT / "resources/python-runtime/bootstrap.py").read_text(encoding="utf-8"))
        adapter_tree = ast.parse((ROOT / "resources/python-runtime/pywencai_adapter.py").read_text(encoding="utf-8"))
        audit = next(n for n in bootstrap_tree.body if isinstance(n, ast.FunctionDef) and n.name == "check_dependency_audits")
        token = next(n for n in adapter_tree.body if isinstance(n, ast.FunctionDef) and n.name == "run_token")
        audit_calls = [n for n in ast.walk(audit) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "Popen"]
        self.assertEqual(len(audit_calls), 1)
        session = next(k.value for k in audit_calls[0].keywords if k.arg == "start_new_session")
        self.assertIn("pre_seal_owned_posix_root is None", ast.unparse(session))
        dictionaries = [n for n in ast.walk(token) if isinstance(n, ast.Dict)]
        self.assertTrue(any(any(isinstance(k, ast.Constant) and k.value == "start_new_session"
                                and ast.unparse(v) == "pre_seal_owned_posix_root is None" for k, v in zip(n.keys, n.values))
                            for n in dictionaries))
        self.assertIn("--pre-seal-owned-posix-root", ast.unparse(bootstrap_tree))
        # Every existing group-kill path must be restricted to the default mode.
        for tree in (audit, token):
            def walk(node, conditions=()):
                if isinstance(node, ast.If):
                    for child in node.body:
                        walk(child, (*conditions, ast.unparse(node.test)))
                    for child in node.orelse:
                        walk(child, conditions)
                    return
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "killpg":
                    self.assertTrue(any("pre_seal_owned_posix_root is None" in c for c in conditions))
                for child in ast.iter_child_nodes(node):
                    walk(child, conditions)
            walk(tree)

    def test_inherited_local_cleanup_never_kills_outer_group(self):
        process = mock.Mock()
        process.pid = 102
        process.poll.return_value = None
        process.wait.return_value = -9
        process.returncode = -9
        with mock.patch.object(reporter, "validate_pre_seal_owned_posix_root", return_value=101), \
                mock.patch.object(os, "getpgid", create=True, return_value=101), \
                mock.patch.object(os, "getsid", create=True, return_value=101), \
                mock.patch.object(os, "killpg", create=True) as kill_group:
            owner = reporter.InheritedPosixOwnership(process, 101)
            self.assertTrue(owner.cleanup(time.monotonic() + 1))
            process.kill.assert_called_once()
            process.wait.assert_called_once()
            kill_group.assert_not_called()

    @unittest.skipUnless(sys.platform == "darwin", "Requires native Mac and explicit private Node")
    def test_native_node_alive_when_root_dies_outer_known_group_cleanup(self):
        if PRIVATE_NODE is None:
            self.skipTest("Supply --private-node <absolute pinned native Node>; no release claim otherwise")
        import select
        node = Path(PRIVATE_NODE).resolve(strict=True)
        self.assertTrue(Path(PRIVATE_NODE).is_absolute())
        script = ("import importlib.util,json,os,subprocess,sys,time; "
                  "s=importlib.util.spec_from_file_location('reporter'," + repr(str(SOURCE)) + "); "
                  "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
                  "root=m.validate_pre_seal_owned_posix_root(str(os.getpid()),leader=True); "
                  "p=subprocess.Popen([" + repr(str(node)) + ",'-e','setInterval(()=>{},1000)'],"
                  "start_new_session=False,env={},stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); "
                  "assert os.getpgid(p.pid)==root and os.getsid(p.pid)==root; "
                  "print(json.dumps({'root':root,'node':p.pid}),flush=True); time.sleep(20)")
        outer = subprocess.Popen([sys.executable, *reporter.FLAGS, "-c", script], start_new_session=True,
                                 env={}, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        watcher = select.kqueue()
        try:
            self.assertTrue(select.select([outer.stdout], [], [], 5)[0])
            identity = json.loads(outer.stdout.readline(4096))
            root, node_pid = identity["root"], identity["node"]
            self.assertEqual(root, outer.pid)
            self.assertGreater(node_pid, 1)
            event = select.kevent(node_pid, filter=select.KQ_FILTER_PROC,
                                 flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE, fflags=select.KQ_NOTE_EXIT)
            watcher.control([event], 0, 0)
            # Simulate the outer deadline: root exits first, Node is still alive.
            outer.terminate()
            outer.wait(timeout=2)
            os.kill(node_pid, 0)
            self.assertFalse(watcher.control(None, 1, 0))
            # Do not query the dead root to decide whether the known group exists.
            os.killpg(root, signal.SIGKILL)
            events = watcher.control(None, 1, 5)
            self.assertTrue(any(e.ident == node_pid and e.fflags & select.KQ_NOTE_EXIT for e in events))
        finally:
            try:
                os.killpg(outer.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            outer.wait(timeout=2)
            watcher.close()
            outer.stdout.close()
            outer.stderr.close()

    def test_parser_bounds_duplicates_constants_depth(self):
        for raw in (b"", b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}', b'{"a":1.0}',
                    b'\xff', b"[" * 25 + b"0" + b"]" * 25):
            with self.subTest(raw=raw), self.assertRaises(reporter.Invalid):
                reporter.parse(raw)
        with self.assertRaises(reporter.Invalid):
            reporter.parse(b'{"a":1}', cap=2)

    def test_canonical_matches_producer_ascii_shapes(self):
        self.assertEqual(reporter.canonical({"z": [{"b": True, "a": 2}], "a": "x"}),
                         b'{"a":"x","z":[{"a":2,"b":true}]}')

    def test_contract_rejects_fixture_and_relative_path_before_launch(self):
        with tempfile.TemporaryDirectory(dir=ROOT / ".cache") as cache:
            path = Path(cache) / "contract.json"
            for document in ({"schemaVersion": 1, "kind": "rt-private-python-bootstrap-test-fixture"},
                             {"schemaVersion": 1, "kind": reporter.CONTRACT_KIND, "releaseEligible": True}):
                path.write_text(json.dumps(document), encoding="utf-8")
                with mock.patch.object(reporter.subprocess, "Popen") as launch:
                    with self.assertRaises(reporter.Invalid):
                        reporter.validate_contract(str(path))
                    launch.assert_not_called()
        with self.assertRaises(reporter.Invalid):
            reporter.absolute("relative.json")

    def test_environment_no_secrets_or_extra_path(self):
        with mock.patch.dict(os.environ, {"SECRET": "not-forwarded", "HTTP_PROXY": "not-forwarded", "PATH": "not-forwarded"}, clear=True):
            cache = Path("K:/worker") if os.name == "nt" else Path("/worker")
            node = cache / "private-node" / "node"
            env = reporter.environment(cache, node, "mootdx")
        self.assertNotIn("SECRET", env)
        self.assertNotIn("HTTP_PROXY", env)
        self.assertEqual(env["PATH"], str(node.parent))
        self.assertEqual(env["RT_MOOTDX_CACHE_ROOT"], str(cache))

    def invocation(self, cache, script):
        return {"executable": sys.executable, "args": reporter.FLAGS + ["-c", script],
                "cwd": cache, "env": reporter.environment(Path(cache), Path(sys.executable)), "input": ""}

    def test_mac_preflight_is_pending_without_launch(self):
        for arch in ("x64", "arm64"):
            with mock.patch.object(reporter, "native_target", return_value=("darwin-" + arch, "darwin", arch)), \
                    mock.patch.object(reporter.subprocess, "Popen") as launch:
                with self.assertRaisesRegex(reporter.Pending, "NATIVE_POSIX_OWNERSHIP_PENDING"):
                    reporter.report({}, [])
                launch.assert_not_called()

    def test_posix_helpers_never_construct_positive_exit_evidence(self):
        with mock.patch.object(reporter.os, "name", "posix"), \
                mock.patch.object(reporter.subprocess, "Popen") as launch:
            with self.assertRaises(reporter.Pending):
                reporter.run_owned({})
            with self.assertRaises(reporter.Pending):
                reporter.collect_result("akshare", b"", b"", {}, True)
            launch.assert_not_called()

    def test_positive_report_requires_preflight_before_launch(self):
        with mock.patch.object(reporter, "ownership_preflight", side_effect=reporter.Invalid), \
                mock.patch.object(reporter.subprocess, "Popen") as launch:
            with self.assertRaises(reporter.Invalid):
                reporter.report({}, [])
            launch.assert_not_called()

    @unittest.skipUnless(os.name == "nt", "Windows Job evidence only; POSIX is pending")
    def test_actual_kernel_job_preflight_and_inherited_worker(self):
        script = ("import importlib.util; "
                  "s=importlib.util.spec_from_file_location('reporter'," + repr(str(SOURCE)) + "); "
                  "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
                  "print(m.canonical(m.ownership_preflight()).decode())")
        with tempfile.TemporaryDirectory(dir=ROOT / ".cache") as cache:
            output, errors, worker, empty = reporter.run_owned(self.invocation(cache, script), seconds=5)
        preflight = json.loads(output)
        self.assertEqual(errors, b"")
        self.assertEqual(worker["exitCode"], 0)
        self.assertTrue(empty)
        self.assertEqual(preflight["reporterPid"], worker["pid"])
        self.assertEqual(preflight["ownershipMode"], "windows-job")
        self.assertTrue(preflight["reporterJobMembershipObserved"])
        self.assertTrue(preflight["killOnJobCloseObserved"])
        self.assertNotEqual(preflight["observedJobLimitFlags"] & 0x2000, 0)
        script = ("import importlib.util; "
                  "s=importlib.util.spec_from_file_location('reporter'," + repr(str(SOURCE)) + "); "
                  "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
                  "import tempfile,sys; "
                  "c=tempfile.TemporaryDirectory(dir=" + repr(str(ROOT / ".cache")) + "); "
                  "i={'executable':sys.executable,'args':m.FLAGS+['-c','print(1)'],"
                  "'cwd':c.name,'env':m.environment(m.Path(c.name),m.Path(sys.executable)),'input':''}; "
                  "o,e,w,x=m.run_owned(i,seconds=3,require_inherited_job=True); "
                  "print(w['inheritedJobMembershipObserved']); c.cleanup()")
        with tempfile.TemporaryDirectory(dir=ROOT / ".cache") as cache:
            output, errors, worker, empty = reporter.run_owned(self.invocation(cache, script), seconds=5)
        self.assertEqual((output.strip(), errors, worker["exitCode"], empty), (b"True", b"", 0, True))

    @unittest.skipUnless(os.name == "nt", "Windows Job evidence only; POSIX is pending")
    def test_real_worker_exit_nonzero_and_output(self):
        with tempfile.TemporaryDirectory(dir=ROOT / ".cache") as cache:
            output, errors, worker, empty = reporter.run_owned(self.invocation(cache, "import os; print(os.getpid())"), seconds=5)
            self.assertEqual(int(output), worker["pid"])
            self.assertEqual(errors, b"")
            self.assertTrue(worker["exitObserved"] and empty)
            self.assertEqual(worker["exitCode"], 0)
            _, _, worker, empty = reporter.run_owned(self.invocation(cache, "raise SystemExit(7)"), seconds=5)
            self.assertEqual(worker["exitCode"], 7)
            self.assertTrue(empty)

    @unittest.skipUnless(os.name == "nt", "Windows Job evidence only; POSIX is pending")
    def test_worker_deadline_and_byte_cap(self):
        with tempfile.TemporaryDirectory(dir=ROOT / ".cache") as cache:
            with self.assertRaises(reporter.Invalid):
                reporter.run_owned(self.invocation(cache, "import time; time.sleep(10)"), seconds=0.5)
            with self.assertRaises(reporter.Invalid):
                reporter.run_owned(self.invocation(cache, "import os; os.write(1, b'x'*8192)"), seconds=5, cap=1024)

    @unittest.skipUnless(os.name == "nt", "Windows Job evidence only; POSIX is pending")
    def test_real_descendant_is_owned_and_terminated(self):
        script = ("import os, subprocess, sys; "
                  "p=subprocess.Popen([sys.executable,'-I','-S','-B','-c','import time; time.sleep(10)']); "
                  "print(p.pid, flush=True)")
        with tempfile.TemporaryDirectory(dir=ROOT / ".cache") as cache:
            output, _, worker, empty = reporter.run_owned(self.invocation(cache, script), seconds=5)
            self.assertNotEqual(int(output), worker["pid"])
            self.assertTrue(empty)

    @unittest.skipUnless(os.name == "nt", "Windows Job evidence only; POSIX is pending")
    def test_missing_or_synthetic_token_evidence_rejected(self):
        worker = {"pid": 42, "role": "worker", "startedAt": "2026-10-09T00:00:00+00:00",
                  "exitedAt": "2026-10-09T00:00:02+00:00", "exitObserved": True, "exitCode": 0}
        smoke = {"kind": reporter.SMOKE_KIND, "provider": "pywencai", "workerPid": 42,
                 "status": "passed", "dataframeRows": 2, "providerApiReady": True, "ownedProcesses": []}
        with self.assertRaises(reporter.Invalid):
            reporter.collect_result("pywencai", json.dumps(smoke).encode(), b"", worker, True)
        for errors, empty in ((b"diagnostic", True), (b"", False)):
            with self.assertRaises(reporter.Invalid):
                reporter.collect_result("pywencai", json.dumps(smoke).encode(), errors, worker, empty)

    @unittest.skipUnless(os.name == "nt", "Mac CLI deliberately returns pending before contract access")
    def test_cli_missing_contract_has_no_success_report(self):
        with tempfile.TemporaryDirectory(dir=ROOT / ".cache") as cache:
            child = subprocess.run([sys.executable, *reporter.FLAGS, str(SOURCE),
                                    "--pre-seal-bootstrap-contract", str(Path(cache) / "missing.json")],
                                   cwd=cache, env=reporter.environment(Path(cache), Path(sys.executable)),
                                   capture_output=True, timeout=5)
        self.assertEqual(child.returncode, 70)
        self.assertEqual(child.stdout, b"")
        self.assertEqual(child.stderr.replace(b"\r\n", b"\n"), b"NATIVE_BOOTSTRAP_EVIDENCE_INVALID\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--private-node")
    arguments, remaining = parser.parse_known_args()
    PRIVATE_NODE = arguments.private_node
    unittest.main(argv=[sys.argv[0], *remaining])
