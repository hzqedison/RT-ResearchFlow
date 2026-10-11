"""Synthetic bootstrap boundary tests. No licensing, release or provider HTTP proof."""
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

REPO = Path(__file__).resolve().parents[2]
BOOTSTRAP = REPO / "resources/python-runtime/bootstrap.py"
NS = runpy.run_path(str(BOOTSTRAP), run_name="rt_bootstrap_boundary_test")
SUPERVISION_FILE = REPO / "tests/python/private_bootstrap_supervision.py"
SUPERVISION = runpy.run_path(str(SUPERVISION_FILE), run_name="rt_test_supervision")
BASE = Path("D:/RT-ResearchFlow-BuildCache") if os.name == "nt" else Path(os.environ.get("RUNNER_TEMP", tempfile.gettempdir()))
NODE = Path(os.environ.get("RT_TEST_PRIVATE_NODE", "D:/RT-ResearchFlow-BuildCache/private-runtime-1.7/node-windows-x64/node-v22.23.3-win-x64/node.exe"))


class InventoryTests(unittest.TestCase):
    def setUp(self):
        BASE.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="bootstrap-dependency-test-", dir=str(BASE))
        self.root = Path(self.temp.name).resolve()
        self.manifest = {"files": []}

    def tearDown(self):
        self.temp.cleanup()

    def write(self, relative, content):
        filename = self.root / relative
        filename.parent.mkdir(parents=True, exist_ok=True)
        raw = content.encode("utf-8")
        filename.write_bytes(raw)
        self.manifest["files"].append({"path": relative, "kind": "file", "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
        return filename

    def validate(self):
        return NS["check_inventory"](self.root, self.manifest, self.root / "manifest.json")

    def test_complete_inventory(self):
        self.write("providers/mootdx/site/allowed.py", "SAFE = True\n")
        self.assertEqual(set(self.validate()), {"providers/mootdx/site/allowed.py"})

    def test_unregistered_stdlib_shadow_sentinels_never_execute(self):
        for name in ("threading", "importlib", "subprocess", "json"):
            with self.subTest(name=name):
                root = self.root / name
                root.mkdir()
                (root / "registered.txt").write_text("ok", encoding="utf-8")
                site = root / "providers/mootdx/site"
                site.mkdir(parents=True)
                sentinel = root / "EXECUTED"
                (site / (name + ".py")).write_text("from pathlib import Path\nPath(" + repr(str(sentinel)) + ").write_text('BAD')\n", encoding="utf-8")
                manifest = {"files": [{"path": "registered.txt", "kind": "file", "size": 2, "sha256": hashlib.sha256(b"ok").hexdigest()}]}
                # Real isolated interpreter. Provider paths never enter sys.path.
                code = "import runpy,pathlib,json; n=runpy.run_path(" + repr(str(BOOTSTRAP)) + ",run_name='test'); n['check_inventory'](pathlib.Path(" + repr(str(root)) + "),json.loads(" + repr(json.dumps(manifest)) + "),pathlib.Path('absent'))"
                result = subprocess.run([sys.executable, "-X", "utf8", "-I", "-S", "-B", "-c", code], shell=False, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 70)
                self.assertEqual(result.stderr.replace(b"\r\n", b"\n"), b"PRIVATE_RUNTIME_INVALID\n")
                self.assertFalse(sentinel.exists())

    def test_byte_mutation(self):
        self.write("registered", "original").write_text("mutation", encoding="utf-8")
        with self.assertRaises(SystemExit):
            self.validate()

    def test_missing_file(self):
        self.write("registered", "original").unlink()
        with self.assertRaises(SystemExit):
            self.validate()

    def test_duplicate_entry(self):
        self.write("registered", "original")
        self.manifest["files"].append(dict(self.manifest["files"][0]))
        with self.assertRaises(SystemExit):
            self.validate()

    def test_invalid_relative_names(self):
        for name in ("../escape", "a//b", "./a", "a/../b", "C:/x", "\\x", "/x", "a\x00b", ""):
            with self.subTest(name=name), self.assertRaises(SystemExit):
                NS["relative"](name)

    def test_boolean_size(self):
        self.write("registered", "x")
        self.manifest["files"][0]["size"] = True
        with self.assertRaises(SystemExit):
            self.validate()

    def test_fixture_never_accepts_complete_or_releasable_or_formal_kind(self):
        for change in ({"complete": True}, {"complete": False}, {"releaseEligible": True}, {"kind": "rt-private-python-runtime"}):
            with self.subTest(change=change):
                data = {"schemaVersion": 1, "kind": NS["FIXTURE_KIND"], "releaseEligible": False, **change}
                raw = json.dumps(data).encode("utf-8")
                filename = self.root / "fixture.json"
                filename.write_bytes(raw)
                flags = type("Flags", (), {"isolated": 1, "utf8_mode": 1, "no_site": 1, "dont_write_bytecode": 1})()
                with mock.patch.object(sys, "flags", flags), mock.patch.object(sys, "version_info", (3, 13)):
                    with self.assertRaises(SystemExit):
                        NS["isolated_fixture_main"]([str(filename), "mootdx", hashlib.sha256(raw).hexdigest()])


class ThreadFailureTests(unittest.TestCase):
    def invoke_fault(self, fault, job_failure=False):
        root = BASE / "unused-bootstrap-fault-fixture"
        seen = {"cleanup": False, "killed": False, "waited": False}
        class Stream(io.BytesIO):
            def __init__(self, data=b"", label=""):
                super().__init__(data)
                self.label, self.reads = label, 0
            def read(self, size=-1):
                self.reads += 1
                if (self.label == "stderr" and fault == "stderr-read") or (self.label == "stdout" and fault == "stdout-after-json" and self.reads > 1):
                    raise OSError("SECRET_IO_FAILURE")
                return super().read(size)
            def close(self):
                super().close()
                if self.label == "stdin" and fault == "writer-close":
                    raise OSError("SECRET_CLOSE_FAILURE")
        class Process:
            pid = 0  # No real PID is operated on: all ownership operations below are mocked.
            returncode = None if job_failure else 0
            stdin = Stream(label="stdin")
            stdout = Stream(json.dumps({"reports": [{"provider": p} for p in NS["PROVIDERS"]]}).encode(), "stdout")
            stderr = Stream(label="stderr")
            def poll(self):
                return self.returncode
            def kill(self):
                seen["killed"] = True
                self.returncode = 0
            def wait(self, timeout=None):
                seen["waited"] = True
                return self.returncode
        process = Process()
        def cleanup():
            seen["cleanup"] = True
        def job(_):
            if job_failure:
                raise RuntimeError("PRIVATE_RUNTIME_INVALID")
            return cleanup
        globals_ = NS["check_dependency_audits"].__globals__
        before = list(sys.path)
        manifest = {"dependencyAuditValidator": {"path": "private_runtime_manifest.cjs", "sha256": "a" * 64},
                    "node": {"executable": "node/node.exe", "version": "22.23.3"}}
        index = {"private_runtime_manifest.cjs": {"kind": "file", "sha256": "a" * 64}, "node/node.exe": {"kind": "file"}}
        with mock.patch.object(subprocess, "Popen", return_value=process), mock.patch.dict(globals_, {"windows_job": job}), mock.patch.object(os, "killpg", side_effect=lambda *_: cleanup(), create=True):
            with self.assertRaisesRegex(RuntimeError, "^PRIVATE_RUNTIME_INVALID$"):
                NS["check_dependency_audits"](root, manifest, index)
        self.assertEqual(sys.path, before, "failed IO must not inject any provider")
        self.assertTrue(seen["waited"])
        self.assertTrue(all(stream.closed for stream in (process.stdin, process.stdout, process.stderr)))
        if not job_failure:
            self.assertTrue(seen["cleanup"])
        elif os.name == "nt":
            self.assertTrue(seen["killed"])

    def test_stderr_read_failure_with_valid_stdout_and_exit_zero(self):
        self.invoke_fault("stderr-read")

    def test_stdout_failure_after_complete_json(self):
        self.invoke_fault("stdout-after-json")

    def test_writer_close_failure(self):
        self.invoke_fault("writer-close")

    def test_job_failure_disposes_untouched_pipes(self):
        if os.name != "nt":
            self.skipTest("Windows Job failure boundary")
        self.invoke_fault("none", job_failure=True)


@unittest.skipUnless(NODE.is_file(), "actual private Node asset absent; native boundary NOT proved")
class NativeNodeBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        BASE.mkdir(parents=True, exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(prefix="bootstrap-node-test-", dir=str(BASE))
        # Deliberately real Unicode and spaces, never short-path fallback.
        cls.root = Path(cls.temp.name) / "runtime \u8fd0\u884c test"
        cls.root.mkdir()
        cls.executable = cls.root / ("node.exe" if os.name == "nt" else "node")
        shutil.copy2(NODE, cls.executable)
        cls.version = subprocess.check_output([str(cls.executable), "--version"], timeout=10).decode("ascii").strip().lstrip("v")

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def invoke(self, body):
        source = ("exports.validateDependencyAudits=(root,manifest)=>{" + body + "};").encode("utf-8")
        (self.root / "private_runtime_manifest.cjs").write_bytes(source)
        sha = hashlib.sha256(source).hexdigest()
        manifest = {"dependencyAuditValidator": {"path": "private_runtime_manifest.cjs", "sha256": sha},
                    "node": {"version": self.version, "executable": self.executable.name}}
        # Synthetic trusted validator tests IO/ownership only, NOT PEP508 or product auditing.
        index = {"private_runtime_manifest.cjs": {"kind": "file", "sha256": sha}, self.executable.name: {"kind": "file"}}
        return NS["check_dependency_audits"](self.root, manifest, index)

    def test_actual_private_node_cwd_and_no_ambient_preload(self):
        with mock.patch.dict(os.environ, {"NODE_OPTIONS": "--require=SECRET_MUST_NOT_BE_LOADED", "NODE_PATH": "SECRET", "HTTP_PROXY": "SECRET", "COOKIE": "SECRET"}):
            result = self.invoke("if(process.cwd()!==root||process.env.NODE_OPTIONS||process.env.NODE_PATH||process.env.HTTP_PROXY||process.env.COOKIE)throw Error();return ['akshare','mootdx','pywencai'].map(provider=>({provider}));")
            self.assertEqual([item["provider"] for item in result], list(NS["PROVIDERS"]))

    def test_nonzero_errors_never_expose_child_secrets(self):
        with self.assertRaisesRegex(RuntimeError, "^PRIVATE_RUNTIME_INVALID$"):
            self.invoke("throw Error('SECRET_COOKIE');")

    def test_stdout_cap(self):
        with self.assertRaisesRegex(RuntimeError, "^PRIVATE_RUNTIME_INVALID$"):
            self.invoke("process.stdout.write('x'.repeat(16384));return [];")

    def test_stderr_cap(self):
        with self.assertRaisesRegex(RuntimeError, "^PRIVATE_RUNTIME_INVALID$"):
            self.invoke("process.stderr.write('SECRET'.repeat(3000));return [];")

    def test_deadline_kills_confirmed_descendant_but_not_unrelated_sentinel(self):
        ready = self.root / "descendant-ready.json"
        ready.unlink(missing_ok=True)
        child_code = "require('node:fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,cwd:process.cwd()}));setInterval(()=>{},1000)"
        body = "const fs=require('node:fs'), cp=require('node:child_process');cp.spawn(process.execPath,['-e'," + json.dumps(child_code) + "," + json.dumps(str(ready)) + "],{stdio:'ignore',shell:false});let end=Date.now()+1000;while(!fs.existsSync(" + json.dumps(str(ready)) + ")){if(Date.now()>end)throw Error('NO_CHILD');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10)};while(true)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);"
        unrelated = subprocess.Popen([str(NODE), "-e", "setInterval(()=>{},1000)"], shell=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            with mock.patch.dict(NS["check_dependency_audits"].__globals__, {"AUDIT_DEADLINE_SECONDS": 2}):
                with self.assertRaisesRegex(RuntimeError, "^PRIVATE_RUNTIME_INVALID$"):
                    self.invoke(body)
            self.assertTrue(ready.is_file(), "descendant start must be positively observed before timeout")
            identity = json.loads(ready.read_text(encoding="utf-8"))
            self.assertEqual(Path(identity["cwd"]), self.root)
            self.assertIsNone(unrelated.poll(), "unrelated sentinel must remain alive")
            pid = identity["pid"]
            if os.name == "nt":
                import ctypes
                from ctypes import wintypes
                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
                kernel.OpenProcess.restype = wintypes.HANDLE
                kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
                kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
                handle = kernel.OpenProcess(0x100000, False, pid)
                if handle:
                    try:
                        self.assertEqual(kernel.WaitForSingleObject(handle, 3000), 0)
                    finally:
                        kernel.CloseHandle(handle)
            else:
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    try:
                        os.kill(pid, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(0.05)
                else:
                    self.fail("owned descendant still alive")
        finally:
            unrelated.terminate()
            unrelated.wait(timeout=5)


@unittest.skipUnless(os.environ.get('RT_TEST_PRIVATE_RUNTIME_CONTEXT'), 'fresh complete candidate context absent; provider smoke NOT proved')
class CompleteCandidateSmokeTests(unittest.TestCase):
    def smoke(self, provider):
        # The caller supplies a fresh candidate context, not a sealed/releasable manifest.
        context_path = Path(os.environ['RT_TEST_PRIVATE_RUNTIME_CONTEXT'])
        self.assertLessEqual(context_path.stat().st_size, 8 * 1024 * 1024)
        context = json.loads(context_path.read_text(encoding='utf-8'))
        self.assertNotIn('complete', context)
        self.assertEqual(context.get('kind'), NS['FIXTURE_KIND'])
        self.assertIs(context.get('releaseEligible'), False)
        tree = Path(context['treeRoot']).resolve(strict=True)
        python = tree / context['python']['executable']
        node = str(tree / context['node']['executable'])
        with tempfile.TemporaryDirectory(prefix='bootstrap-owned-smoke-', dir=str(BASE)) as directory:
            owned = Path(directory).resolve(strict=True)
            self.assertFalse(owned.is_symlink())
            cache = owned / 'cache'
            cache.mkdir()
            context['fixtureCacheRoot'] = str(cache)
            descriptor = owned / 'fixture.json'
            raw = json.dumps(context, ensure_ascii=False, allow_nan=False).encode('utf-8')
            descriptor.write_bytes(raw)
            sha = hashlib.sha256(raw).hexdigest()
            # Start gate ensures parent owns the whole job/group before bootstrap work.
            # Python audit hooks deny socket/DNS and all provider subprocess launches.
            # This is Python-level denial, not an OS firewall/native-network proof.
            launcher = '''import sys,runpy,pathlib,subprocess
if sys.stdin.buffer.read(1)!=b'B': raise SystemExit(70)
bootstrap,descriptor,provider,sha,node,supervision,ownership,nonce=sys.argv[1:]
n=runpy.run_path(bootstrap,run_name='owned_candidate_launcher')
h=runpy.run_path(supervision,run_name='owned_node_registration')
h['install_tracking'](node,ownership,nonce)
used=[]
def deny(event,args):
 if event.startswith('socket.'): raise OSError('TEST_NETWORK_DENIED')
 if event=='subprocess.Popen':
  expected=[node,'--no-addons','-e',n['AUDIT_NODE_SCRIPT']]
  exact=args[1]==expected or (sys.platform=='win32' and args[1]==subprocess.list2cmdline(expected))
  executable=args[0]==node or (sys.platform=='win32' and args[0] is None)
  if used or not executable or not exact: raise RuntimeError('TEST_SUBPROCESS_DENIED')
  used.append(True)
sys.addaudithook(deny)
sys.argv=[bootstrap,'--isolated-test-fixture',descriptor,provider,sha]
try: n['main']()
except BaseException as error:
 import traceback
 frames=[pathlib.Path(frame.filename).name+':'+str(frame.lineno) for frame in traceback.extract_tb(error.__traceback__)]
 sys.stderr.write('PRIVATE_RUNTIME_INVALID error-type='+type(error).__name__[:48]+' bootstrap-lines='+','.join(frames)+'\\n')
 raise SystemExit(70)
'''
            environment = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR') if key in os.environ}
            environment.update({'TEMP': str(owned), 'TMP': str(owned), 'HOME': str(cache), 'USERPROFILE': str(cache),
                                'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'})
            ownership = owned / 'node-ownership.json'
            process = subprocess.Popen([str(python), '-X', 'utf8', '-I', '-S', '-B', '-c', launcher,
                                        str(BOOTSTRAP), str(descriptor), provider, sha, node,
                                        str(SUPERVISION_FILE), str(ownership), owned.name],
                                       shell=False, cwd=str(owned), env=environment, stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=os.name != 'nt',
                                       creationflags=0x08000000 if os.name == 'nt' else 0)
            close_job, outputs, readers = None, [bytearray(), bytearray()], []
            registration = SUPERVISION['Registration'](ownership, owned.name, process.pid)
            failed, lock = threading.Event(), threading.Lock()
            def read(stream, output):
                try:
                    while True:
                        chunk = stream.read(1024)
                        if not chunk: break
                        with lock:
                            if len(outputs[0]) + len(outputs[1]) + len(chunk) > 32768:
                                failed.set(); break
                            output.extend(chunk)
                except BaseException:
                    failed.set()
                finally:
                    try: stream.close()
                    except BaseException: failed.set()
            deadline = time.monotonic() + 90
            try:
                if os.name == 'nt': close_job = NS['windows_job'](process)
                for stream, output in zip((process.stdout, process.stderr), outputs):
                    reader = threading.Thread(target=read, args=(stream, output), daemon=True)
                    readers.append(reader); reader.start()
                process.stdin.write(b'B'); process.stdin.close()
                while process.poll() is None:
                    registration.poll()
                    self.assertFalse(failed.is_set(), 'candidate output IO failed')
                    self.assertLess(time.monotonic(), deadline - 5, 'candidate deadline expired')
                    time.sleep(0.01)
                for reader in readers: reader.join(max(0, deadline - 5 - time.monotonic()))
                self.assertFalse(any(reader.is_alive() for reader in readers))
                self.assertFalse(failed.is_set())
                self.assertEqual(process.returncode, 0, outputs[1].decode('utf-8', errors='replace'))
                self.assertEqual(outputs[1], b'')
                report = json.loads(outputs[0].decode('utf-8'))
                self.assertEqual(report['provider'], provider)
                self.assertEqual(report['imported'], provider)
                self.assertIs(report['releaseEligible'], False)
                self.assertEqual(report['workerPid'], process.pid)
                self.assertIsNotNone(registration.witness, 'actual inner Node must be registered')
                self.assertTrue(registration.witness.exited(), 'inner Node must have exited before success')
                print(json.dumps({'provider': provider, 'workerPid': process.pid,
                                  'workerExit': process.returncode, 'nodePid': registration.witness.pid,
                                  'nodeExited': True, 'miniRacer': report['miniRacer'],
                                  'releaseEligible': False}, ensure_ascii=False), flush=True)
            finally:
                if close_job: close_job()
                elif os.name != 'nt':
                    import signal
                    try: os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                elif process.poll() is None: process.kill()
                registration.cleanup(deadline)
                process.wait(timeout=max(0, deadline - time.monotonic()))
                for reader in readers: reader.join(max(0, deadline - time.monotonic()))
                self.assertFalse(any(reader.is_alive() for reader in readers))
                for stream in (process.stdin, process.stdout, process.stderr):
                    if not stream.closed: stream.close()
                self.assertIsNotNone(process.poll(), 'whole worker must have exited')

    def test_akshare_full_bootstrap_worker(self): self.smoke('akshare')
    def test_mootdx_full_bootstrap_worker(self): self.smoke('mootdx')
    def test_pywencai_import_bootstrap_worker_not_http_facade(self): self.smoke('pywencai')


if __name__ == "__main__":
    unittest.main()
