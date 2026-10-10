"""Native, offline evidence collector. Only the protected producer grants authority.

Windows workers inherit the supervisor's outer Job and are assigned a nested
Job before receiving their pinned scripts. Positive evidence requires observed
outer KILL_ON_JOB_CLOSE membership. POSIX staging additionally requires the
literal source-bound root CLI, inherited groups throughout the audited chain,
an observed quiescent group, and final cleanup by the outside supervisor.
"""
import argparse
import ctypes
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import signal
import stat
import subprocess
import sys
import threading
import time

PROVIDERS = ("akshare", "mootdx", "pywencai")
FLAGS = ["-X", "utf8", "-I", "-S", "-B"]
CONTRACT_KIND = "rt-private-python-pre-seal-bootstrap-contract-v1"
REPORT_KIND = "rt-private-python-native-bootstrap-evidence-v1"
SMOKE_KIND = "rt-private-runtime-offline-smoke-v1"
MAX_JSON = 8 * 1024 * 1024
OUTPUT_CAP = 65536
WORKER_SECONDS = 70
ROOT = Path(__file__).resolve().parents[1]


class Invalid(Exception):
    """Intentionally contains no paths, request data or dependency diagnostics."""


class Pending(Exception):
    """A supported target lacks the required process-tree ownership protocol."""


def require(condition):
    if not condition:
        raise Invalid("NATIVE_BOOTSTRAP_EVIDENCE_INVALID")


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def parse(raw, cap=MAX_JSON):
    require(isinstance(raw, bytes) and 0 < len(raw) <= cap)
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result)
            result[key] = value
        return result
    def constant(_):
        raise Invalid("NATIVE_BOOTSTRAP_EVIDENCE_INVALID")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
        pending = [(value, 0)]
        count = 0
        while pending:
            item, depth = pending.pop()
            count += 1
            require(depth <= 20 and count <= 250000)
            if isinstance(item, dict):
                pending.extend((v, depth + 1) for v in item.values())
            elif isinstance(item, list):
                pending.extend((v, depth + 1) for v in item)
            elif isinstance(item, float):
                require(False)  # The producer contract contains no floating-point values.
        return value
    except (ValueError, UnicodeError, RecursionError):
        raise Invalid("NATIVE_BOOTSTRAP_EVIDENCE_INVALID") from None


def absolute(value):
    require(isinstance(value, str) and 0 < len(value) <= 4096 and "\0" not in value)
    path = Path(value)
    require(path.is_absolute() and ".." not in path.parts)
    for part in (path, *path.parents):
        require(not part.is_symlink() and not part.is_junction())
    require(path.resolve(strict=True) == path)
    return path


def relative(value):
    require(isinstance(value, str) and len(value) <= 1024 and value
            and not any(c in value for c in "\\:\0")
            and all(p not in ("", ".", "..") for p in value.split("/")))
    return value


def read(path, cap=MAX_JSON):
    path = absolute(str(path))
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= cap)
        raw = stream.read(cap + 1)
        after = os.fstat(stream.fileno())
        require(len(raw) == before.st_size and len(raw) <= cap
                and (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns))
        return raw


def digest_valid(value):
    require(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None)


def native_target():
    machine = platform.machine().lower()
    arch = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(machine)
    target = sys.platform + "-" + str(arch)
    require(target in ("win32-x64", "darwin-x64", "darwin-arm64"))
    return target, sys.platform, arch


def windows_job_membership(handle):
    from ctypes import wintypes as w
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.IsProcessInJob.argtypes = [w.HANDLE, w.HANDLE, ctypes.POINTER(w.BOOL)]
    kernel.IsProcessInJob.restype = w.BOOL
    member = w.BOOL()
    require(kernel.IsProcessInJob(w.HANDLE(handle), None, ctypes.byref(member)))
    return bool(member.value)


def validate_pre_seal_owned_posix_root(value, *, leader=False):
    if type(value) is int:
        root = value
    elif isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,9}", value):
        root = int(value)
    else:
        require(False)
    require(os.name == "posix" and 1 < root <= 2147483647
            and os.getpgrp() == root and os.getsid(0) == root
            and os.getpgid(root) == root and os.getsid(root) == root
            and (not leader or os.getpid() == root))
    return root


def ownership_preflight(pre_seal_owned_posix_root=None):
    target, native_platform, native_arch = native_target()
    if native_platform != "win32":
        if pre_seal_owned_posix_root is None:
            raise Pending("NATIVE_POSIX_OWNERSHIP_PENDING")
        root = validate_pre_seal_owned_posix_root(pre_seal_owned_posix_root, leader=True)
        return {"kind": "rt-private-runtime-ownership-preflight-v1", "target": target,
                "nativePlatform": native_platform, "nativeArch": native_arch, "reporterPid": os.getpid(),
                "ownershipMode": "posix-owned-session", "ownedPosixRoot": root,
                "sourceBoundInvocation": ["--pre-seal-owned-posix-root", str(root)],
                "leaderIdentityObserved": True, "directWorkerMode": "inherit-outer-session",
                "workerVerification": "direct-child-reap-and-observed-quiescent-group",
                "outerGroupCleanupRequired": True, "sandbox": False}
    require(pre_seal_owned_posix_root is None)
    require(os.name == "nt")
    from ctypes import wintypes as w
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.argtypes = []
    kernel.GetCurrentProcess.restype = w.HANDLE
    require(windows_job_membership(kernel.GetCurrentProcess()))
    class Basic(ctypes.Structure):
        _fields_ = [("a", ctypes.c_int64), ("b", ctypes.c_int64), ("flags", w.DWORD),
                    ("min", ctypes.c_size_t), ("max", ctypes.c_size_t), ("active", w.DWORD),
                    ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]
    class Limits(ctypes.Structure):
        _fields_ = [("basic", Basic), ("io", ctypes.c_uint64 * 6), ("memory", ctypes.c_size_t * 4)]
    kernel.QueryInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD, ctypes.c_void_p]
    kernel.QueryInformationJobObject.restype = w.BOOL
    limits = Limits()
    require(kernel.QueryInformationJobObject(None, 9, ctypes.byref(limits), ctypes.sizeof(limits), None))
    require(limits.basic.flags & 0x2000 != 0)
    return {"kind": "rt-private-runtime-ownership-preflight-v1", "target": target,
            "nativePlatform": native_platform, "nativeArch": native_arch, "reporterPid": os.getpid(),
            "ownershipMode": "windows-job", "reporterJobMembershipObserved": True,
            "killOnJobCloseObserved": bool(limits.basic.flags & 0x2000), "observedJobLimitFlags": limits.basic.flags,
            "directWorkerMode": "inherit-outer-job", "workerVerification": "nested-job-active-process-count-zero"}


def environment(cache, node, provider=None):
    result = {key: os.environ[key] for key in ("SystemRoot", "WINDIR", "COMSPEC") if key in os.environ}
    tmp = str(cache / "tmp")
    result.update(PATH=str(node.parent), HOME=str(cache), USERPROFILE=str(cache), LANG="C.UTF-8",
                  LC_ALL="C.UTF-8", PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", XDG_CACHE_HOME=str(cache),
                  TMPDIR=tmp, TEMP=tmp, TMP=tmp, NODE_OPTIONS="", NODE_PATH="", PYTHONPATH="")
    if provider == "mootdx":
        result["RT_MOOTDX_CACHE_ROOT"] = str(cache)
    return result


def validate_contract(filename):
    contract = parse(read(absolute(filename)))
    require(isinstance(contract, dict) and contract.get("schemaVersion") == 1
            and contract.get("kind") == CONTRACT_KIND and contract.get("releaseEligible") is False)
    target, _, _ = native_target()
    require(contract.get("target") == target and contract.get("invocationFlags") == FLAGS
            and contract.get("reportKind") == REPORT_KIND
            and contract.get("reportObservationMethod") == "owned-process-exit-v1")
    require(contract.get("ownershipContract") == {
        "windows": "Assign a KILL_ON_JOB_CLOSE job before giving each worker stdin",
        "posix": "Own and clean each worker process group on success, failure, deadline and reporter cancellation",
        "evidence": "Record observed worker and private Node PIDs/exits; do not construct successful synthetic observations"})
    reporter = contract.get("reporter")
    require(isinstance(reporter, dict) and reporter.get("path") == "scripts/report-private-runtime-native-bootstrap.py")
    digest_valid(reporter.get("sha256"))
    require(sha(read(ROOT / reporter["path"], 131072)) == reporter["sha256"])
    identity = contract.get("producer")
    require(isinstance(identity, dict) and set(identity) == {"runId", "attempt", "jobId", "sourceCommit"})
    require(all(type(identity[k]) is int and 0 < identity[k] <= 9007199254740991 for k in ("runId", "attempt", "jobId")))
    require(isinstance(identity["sourceCommit"], str) and re.fullmatch(r"[a-f0-9]{40}", identity["sourceCommit"]) is not None)
    root = absolute(contract.get("runtimeRoot"))
    require(root.name == target)
    manifest_path = absolute(contract.get("manifestPath"))
    require(manifest_path == root / "manifest.json")
    digest_valid(contract.get("manifestSha256"))
    raw = read(manifest_path)
    require(sha(raw) == contract["manifestSha256"])
    manifest = parse(raw)
    require(manifest.get("schemaVersion") == 1 and manifest.get("kind") == "rt-private-python-runtime"
            and manifest.get("complete") is True and manifest.get("platform") + "-" + manifest.get("arch") == target
            and manifest.get("bootstrap") == "bootstrap.py")
    binding = contract.get("expectedBinding")
    require(isinstance(binding, dict))
    expected = {"target": target, "formalManifestIdentitySha256": sha(canonical(manifest)),
                "pythonAssetSha256": manifest["python"]["asset"]["sha256"],
                "nodeAssetSha256": manifest["node"]["asset"]["sha256"],
                "validatorSha256": manifest["dependencyAuditValidator"]["sha256"],
                "providers": {name: {"version": manifest["providers"][name]["version"],
                                     "dependencyAuditSha256": manifest["providers"][name]["dependencyAudit"]["sha256"],
                                     "wheelsSha256": sha(canonical(manifest["providers"][name]["wheels"]))} for name in PROVIDERS}}
    require(set(binding) == set(expected) | {"sourceSnapshotSha256", "candidateLockSha256", "fragmentSha256",
                                            "inventorySha256", "bootstrapSha256", "miniRacerAdapterSha256", "pywencaiAdapterSha256"})
    for key, value in expected.items():
        require(binding[key] == value)
    for key, value in binding.items():
        if key not in ("target", "providers"):
            digest_valid(value)
    index = {}
    rows = manifest.get("files")
    require(isinstance(rows, list) and 0 < len(rows) <= 150000)
    for row in rows:
        require(isinstance(row, dict))
        name = relative(row.get("path"))
        require(name not in index)
        index[name] = row
    python = root / relative(manifest["python"]["executable"])
    node = root / relative(manifest["node"]["executable"])
    require(absolute(contract.get("pythonExecutable")) == python and Path(sys.executable).resolve() == python
            and python.is_relative_to(root / "python") and node.is_relative_to(root / "node"))
    sources = {"bootstrap.py": binding["bootstrapSha256"],
               "miniracer_unicode_adapter.py": binding["miniRacerAdapterSha256"],
               "providers/pywencai/pywencai_adapter.py": binding["pywencaiAdapterSha256"],
               "private_runtime_manifest.cjs": binding["validatorSha256"]}
    pins = []
    for name in dict.fromkeys([manifest["python"]["executable"], manifest["node"]["executable"], *sources]):
        row = index.get(name)
        require(isinstance(row, dict) and row.get("kind") == "file" and type(row.get("size")) is int)
        digest_valid(row.get("sha256"))
        require(name not in sources or row["sha256"] == sources[name])
        data = read(root / name, 128 * 1024 * 1024)
        require(len(data) == row["size"] and sha(data) == row["sha256"])
        pins.append((root / name, row["sha256"]))
    require(all(os.access(p, os.X_OK) for p in (python, node)))
    reporter_cache = absolute(contract.get("reporterCwd"))
    require(reporter_cache == root.parent / "reporter-cache" and Path.cwd().resolve() == reporter_cache
            and contract.get("reporterEnvironment") == environment(reporter_cache, node))
    invocations = contract.get("invocations")
    require(isinstance(invocations, list) and len(invocations) == 3)
    for provider, invocation in zip(PROVIDERS, invocations):
        require(isinstance(invocation, dict) and set(invocation) == {"provider", "executable", "args", "input", "cwd", "env", "smokeSource"})
        require(invocation["provider"] == provider and invocation["executable"] == str(python)
                and invocation["args"] == FLAGS + [str(root / "bootstrap.py"), str(manifest_path), provider, contract["manifestSha256"]])
        cache = absolute(invocation["cwd"])
        require(cache == root.parent / "worker-cache" / provider and cache.is_dir()
                and absolute(str(cache / "tmp")).is_dir() and invocation["env"] == environment(cache, node, provider))
        pin = invocation["smokeSource"]
        require(isinstance(pin, dict) and set(pin) == {"path", "sha256"}
                and pin["path"] == "scripts/runtime-bootstrap-smokes/" + provider + ".py")
        digest_valid(pin["sha256"])
        data = read(ROOT / pin["path"], 65536)
        require(sha(data) == pin["sha256"])
        require(isinstance(invocation["input"], str))
        envelope = parse(invocation["input"].encode("utf-8"), 131072)
        require(envelope == {"script": data.decode("utf-8"), "request": {"operation": "status"}} and "\0" not in envelope["script"])
        pins.append((ROOT / pin["path"], pin["sha256"]))
    pins.extend([(manifest_path, contract["manifestSha256"]), (ROOT / reporter["path"], reporter["sha256"])])
    return contract, pins


class Ownership:
    """Retain a real Job handle until ActiveProcesses reaches zero."""
    def __init__(self, process):
        self.process, self.handle = process, None
        require(os.name == "nt")
        from ctypes import wintypes as w
        k = self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        for name, args, result in (
            ("CreateJobObjectW", [ctypes.c_void_p, w.LPCWSTR], w.HANDLE),
            ("SetInformationJobObject", [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD], w.BOOL),
            ("QueryInformationJobObject", [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD, ctypes.c_void_p], w.BOOL),
            ("AssignProcessToJobObject", [w.HANDLE, w.HANDLE], w.BOOL),
            ("TerminateJobObject", [w.HANDLE, w.UINT], w.BOOL),
            ("CloseHandle", [w.HANDLE], w.BOOL),
            ("CreateToolhelp32Snapshot", [w.DWORD, w.DWORD], w.HANDLE),
            ("OpenThread", [w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
            ("ResumeThread", [w.HANDLE], w.DWORD)):
            fn = getattr(k, name)
            fn.argtypes, fn.restype = args, result
        class Basic(ctypes.Structure):
            _fields_ = [("a", ctypes.c_int64), ("b", ctypes.c_int64), ("flags", w.DWORD),
                        ("min", ctypes.c_size_t), ("max", ctypes.c_size_t), ("active", w.DWORD),
                        ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]
        class Limits(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", ctypes.c_uint64 * 6), ("memory", ctypes.c_size_t * 4)]
        class Entry(ctypes.Structure):
            _fields_ = [("size", w.DWORD), ("usage", w.DWORD), ("id", w.DWORD), ("owner", w.DWORD),
                        ("base", w.LONG), ("delta", w.LONG), ("flags", w.DWORD)]
        k.Thread32First.argtypes = k.Thread32Next.argtypes = [w.HANDLE, ctypes.POINTER(Entry)]
        k.Thread32First.restype = k.Thread32Next.restype = w.BOOL
        self.handle = k.CreateJobObjectW(None, None)
        require(bool(self.handle))
        try:
            limits = Limits()
            limits.basic.flags = 0x2000
            require(k.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
            require(k.AssignProcessToJobObject(self.handle, w.HANDLE(int(process._handle))))
            snapshot = k.CreateToolhelp32Snapshot(4, 0)
            require(snapshot not in (None, ctypes.c_void_p(-1).value))
            try:
                entry = Entry()
                entry.size = ctypes.sizeof(entry)
                found = k.Thread32First(snapshot, ctypes.byref(entry))
                while found and entry.owner != process.pid:
                    found = k.Thread32Next(snapshot, ctypes.byref(entry))
                require(found)
                handle = k.OpenThread(2, False, entry.id)
                require(bool(handle))
                try:
                    require(k.ResumeThread(handle) == 1)
                finally:
                    k.CloseHandle(handle)
            finally:
                k.CloseHandle(snapshot)
        except BaseException:
            k.CloseHandle(self.handle)
            self.handle = None
            raise

    def empty(self):
        if self.handle:
            class Accounting(ctypes.Structure):
                _fields_ = [("times", ctypes.c_int64 * 4), ("faults", ctypes.c_uint32),
                            ("total", ctypes.c_uint32), ("active", ctypes.c_uint32), ("terminated", ctypes.c_uint32)]
            counters = Accounting()
            require(self.kernel.QueryInformationJobObject(self.handle, 1, ctypes.byref(counters), ctypes.sizeof(counters), None))
            return counters.active == 0
        require(False)

    def cleanup(self, deadline):
        require(bool(self.handle))
        require(self.kernel.TerminateJobObject(self.handle, 70))
        self.process.wait(timeout=max(0.01, deadline - time.monotonic()))
        while not self.empty():
            require(time.monotonic() < deadline)
            time.sleep(0.01)
        return True

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class InheritedPosixOwnership:
    """Local cleanup owns only the direct child; the outside owner owns the group."""
    def __init__(self, process, root):
        self.process, self.root = process, validate_pre_seal_owned_posix_root(root)
        require(os.getpgid(process.pid) == self.root and os.getsid(process.pid) == self.root)

    def cleanup(self, deadline):
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=max(0.01, deadline - time.monotonic()))
        validate_pre_seal_owned_posix_root(self.root)
        return self.process.returncode is not None

    def close(self):
        pass


def run_owned(invocation, seconds=WORKER_SECONDS, cap=OUTPUT_CAP, require_inherited_job=False, pre_seal_owned_posix_root=None):
    if os.name != "nt":
        if pre_seal_owned_posix_root is None:
            raise Pending("NATIVE_POSIX_OWNERSHIP_PENDING")
        pre_seal_owned_posix_root = validate_pre_seal_owned_posix_root(pre_seal_owned_posix_root)
    else:
        require(pre_seal_owned_posix_root is None)
    require(0 < seconds <= WORKER_SECONDS and 0 < cap <= OUTPUT_CAP)
    deadline = time.monotonic() + seconds
    # No BREAKAWAY_FROM_JOB and no new session. Outer Job covers even the
    # suspended startup interval before the reporter creates its nested Job.
    options = {"creationflags": 0x08000000 | 4} if os.name == "nt" else {"start_new_session": False}
    started = stamp()
    process = subprocess.Popen([invocation["executable"], *invocation["args"]], cwd=invocation["cwd"],
                               env=invocation["env"], shell=False, close_fds=True, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, **options)
    ownership, threads = None, []
    buffers, failed = [bytearray(), bytearray()], threading.Event()
    def drain(stream, buffer):
        try:
            while True:
                block = os.read(stream.fileno(), 1024)
                if not block:
                    break
                if len(buffer) + len(block) > cap:
                    failed.set()
                    break
                buffer.extend(block)
        except BaseException:
            failed.set()
    def feed():
        try:
            process.stdin.write(invocation["input"].encode("utf-8"))
            process.stdin.close()
        except BaseException:
            failed.set()
    try:
        if os.name == "nt":
            inherited = windows_job_membership(int(process._handle))
            require(not require_inherited_job or inherited)
            ownership = Ownership(process)
        else:
            require(not require_inherited_job)
            ownership = InheritedPosixOwnership(process, pre_seal_owned_posix_root)
        for stream, buffer in zip((process.stdout, process.stderr), buffers):
            threads.append(threading.Thread(target=drain, args=(stream, buffer), daemon=True))
        threads.append(threading.Thread(target=feed, daemon=True))
        for thread in threads:
            thread.start()
        while process.poll() is None:
            require(not failed.is_set() and time.monotonic() < deadline)
            time.sleep(0.01)
        exited = stamp()
        code = process.wait(timeout=max(0.01, deadline - time.monotonic()))
        empty = ownership.cleanup(min(deadline + 2, time.monotonic() + 2))
        for thread in threads:
            thread.join(max(0, deadline - time.monotonic()))
        require(not failed.is_set() and not any(t.is_alive() for t in threads))
        observation = {"pid": process.pid, "role": "worker", "startedAt": started,
                       "exitedAt": exited, "exitObserved": code is not None, "exitCode": code}
        if os.name == "nt":
            observation["inheritedJobMembershipObserved"] = inherited
        else:
            observation.update(ownedPosixRoot=pre_seal_owned_posix_root, inheritedGroupMembershipObserved=True)
        return bytes(buffers[0]), bytes(buffers[1]), observation, empty
    finally:
        try:
            if ownership:
                ownership.cleanup(time.monotonic() + 2)
            else:
                # Assignment failure: worker stayed suspended; no input was sent.
                process.kill()
                process.wait(timeout=2)
        finally:
            if ownership:
                ownership.close()
            for thread in threads:
                thread.join(timeout=0.2)
            for stream in (process.stdin, process.stdout, process.stderr):
                if not any(t.is_alive() for t in threads):
                    stream.close()


def collect_result(provider, stdout, stderr, worker, empty, pre_seal_owned_posix_root=None):
    if os.name != "nt":
        if pre_seal_owned_posix_root is None:
            raise Pending("NATIVE_POSIX_OWNERSHIP_PENDING")
        validate_pre_seal_owned_posix_root(pre_seal_owned_posix_root)
        require(worker.get("ownedPosixRoot") == pre_seal_owned_posix_root
                and worker.get("inheritedGroupMembershipObserved") is True)
    require(worker["exitObserved"] is True and worker["exitCode"] == 0 and not stderr and empty is True)
    smoke = parse(stdout, OUTPUT_CAP)
    require(isinstance(smoke, dict) and smoke.get("kind") == SMOKE_KIND and smoke.get("provider") == provider
            and smoke.get("workerPid") == worker["pid"] and smoke.get("status") == "passed"
            and smoke.get("dataframeRows") == 2 and smoke.get("providerApiReady") is True)
    processes = smoke.get("ownedProcesses")
    require(isinstance(processes, list) and len(processes) <= 4)
    seen = {worker["pid"]}
    for child in processes:
        require(isinstance(child, dict) and child.get("role") == "private-node"
                and type(child.get("pid")) is int and child["pid"] > 0 and child["pid"] not in seen
                and child.get("exitObserved") is True and type(child.get("exitCode")) is int and child["exitCode"] == 0)
        seen.add(child["pid"])
        start = datetime.datetime.fromisoformat(child["startedAt"])
        end = datetime.datetime.fromisoformat(child["exitedAt"])
        require(start.tzinfo is not None and end.tzinfo is not None and start <= end
                and datetime.datetime.fromisoformat(worker["startedAt"]) <= start
                and end <= datetime.datetime.fromisoformat(worker["exitedAt"]))
        require(os.name == "nt" or (child.get("ownedPosixRoot") == pre_seal_owned_posix_root
                                    and child.get("inheritedGroupMembershipObserved") is True))
    row = {"provider": provider, "workerPid": worker["pid"], "workerExitObserved": worker["exitObserved"],
           "workerExitCode": worker["exitCode"], "privateNodeExited": all(c["exitObserved"] for c in processes),
           "ownedDescendantsExited": os.name == "nt" and empty,
           "ownedProcesses": [worker, *processes]}
    if provider == "pywencai":
        check = smoke.get("privateNodeCheck")
        require(len(processes) == 1 and isinstance(check, dict) and check == {
            "kind": "pywencai-token-computation-v1", "status": "passed", "pid": processes[0]["pid"], "exitCode": processes[0]["exitCode"]})
        row["privateNodeCheck"] = check
    else:
        require(not processes and "privateNodeCheck" not in smoke)
    return row


def observe_quiescent_posix_group(contract, root):
    """Bounded OS PID snapshot plus kernel group/session queries, not root exit.

This is not a sandbox against arbitrary setsid/fork escapes. Only the pinned
pre-seal control chain may execute; the outside supervisor still cleans the
known group after reporter exit, without depending on a live root PID.
"""
    validate_pre_seal_owned_posix_root(root, leader=True)
    invocation = {"executable": "/bin/ps", "args": ["-A", "-o", "pid="], "input": "",
                  "cwd": contract["reporterCwd"], "env": contract["reporterEnvironment"]}
    output, errors, observer, reaped = run_owned(invocation, seconds=5, pre_seal_owned_posix_root=root)
    require(not errors and reaped and observer["exitCode"] == 0)
    members = []
    lines = output.decode("ascii").splitlines()
    require(0 < len(lines) <= 32768)
    for line in lines:
        value = line.strip()
        require(re.fullmatch(r"[1-9][0-9]{0,9}", value) is not None)
        pid = int(value)
        require(pid <= 2147483647)
        try:
            if os.getpgid(pid) == root:
                require(os.getsid(pid) == root)
                members.append(pid)
        except ProcessLookupError:
            pass  # This listed process has actually disappeared; permission errors fail.
    validate_pre_seal_owned_posix_root(root, leader=True)
    require(members == [root])
    observer["role"] = "owned-descendant"
    return {"kind": "rt-private-runtime-posix-quiescent-group-v1", "rootPid": root,
            "observedAt": stamp(), "memberPids": members, "observer": observer,
            "outerFinalGroupEmptyConfirmationRequired": True}


def observe_crypto_scope(contract, module=None):
    """Observed loaded-library identity; never a license compatibility decision."""
    if module is None:
        import _ssl as module
    root = absolute(contract.get("runtimeRoot"))
    manifest = parse(read(absolute(contract.get("manifestPath"))))
    filename_value = getattr(module, "__file__", None)
    loading_mode = "extension-file"
    if filename_value is None:
        from importlib.machinery import BuiltinImporter
        specification = getattr(module, "__spec__", None)
        require(getattr(module, "__name__", None) == "_ssl"
                and "_ssl" in sys.builtin_module_names
                and specification is not None and specification.name == "_ssl"
                and specification.origin == "built-in" and specification.loader is BuiltinImporter)
        filename_value = sys.executable
        loading_mode = "builtin"
        require(filename_value == str(root / relative(manifest["python"]["executable"])))
    filename = absolute(str(filename_value))
    require(filename.is_relative_to(root / "python"))
    name = relative(filename.relative_to(root).as_posix())
    rows = manifest.get("files")
    require(isinstance(rows, list))
    matches = [row for row in rows if isinstance(row, dict) and row.get("path") == name]
    require(len(matches) == 1 and matches[0].get("kind") == "file")
    pin = matches[0]
    digest_valid(pin.get("sha256"))
    raw = read(filename, 128 * 1024 * 1024)
    require(type(pin.get("size")) is int and len(raw) == pin["size"] and sha(raw) == pin["sha256"])
    version = module.OPENSSL_VERSION
    info = module.OPENSSL_VERSION_INFO
    require(isinstance(version, str) and 0 < len(version) <= 128
            and re.fullmatch(r"(?:OpenSSL|LibreSSL) [0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9 .()-]*", version) is not None
            and isinstance(info, tuple) and len(info) == 5
            and all(type(value) is int and 0 <= value <= 4294967295 for value in info))
    return {"kind": "rt-loaded-crypto-runtime-scope-v1", "modulePath": name,
            "moduleSha256": pin["sha256"], "moduleSize": pin["size"],
            "libraryVersion": version, "libraryVersionInfo": list(info),
            "loadingMode": loading_mode,
            "observation": ("loaded-builtin-with-python-executable-byte-binding" if loading_mode == "builtin"
                            else "loaded-module-with-manifest-byte-binding"),
            "licenseApprovalGranted": False, "releaseEligible": False}


def report(contract, pins, pre_seal_owned_posix_root=None):
    preflight = ownership_preflight(pre_seal_owned_posix_root)
    owned_root = preflight.get("ownedPosixRoot")
    crypto_scope = observe_crypto_scope(contract)
    results = []
    for invocation in contract["invocations"]:
        for filename, expected in pins:
            require(sha(read(filename, 128 * 1024 * 1024)) == expected)
        actual = dict(invocation)
        if owned_root is not None:
            actual["args"] = [*invocation["args"], "--pre-seal-owned-posix-root", str(owned_root)]
        output, errors, worker, empty = run_owned(actual, require_inherited_job=os.name == "nt",
                                                  pre_seal_owned_posix_root=owned_root)
        results.append(collect_result(invocation["provider"], output, errors, worker, empty, owned_root))
    if owned_root is not None:
        quiescence = observe_quiescent_posix_group(contract, owned_root)
        preflight["groupQuiescenceObservation"] = quiescence
        for row in results:
            row["ownedDescendantsExited"] = quiescence["memberPids"] == [owned_root]
    for filename, expected in pins:
        require(sha(read(filename, 128 * 1024 * 1024)) == expected)
    _, native_platform, native_arch = native_target()
    return {"kind": REPORT_KIND, "releaseEligible": False, "binding": contract["expectedBinding"], "producer": contract["producer"],
            "reporter": contract["reporter"], "nativePlatform": native_platform, "nativeArch": native_arch,
            "validatorPassed": len(results) == 3, "executableModeChecked": True, "invocationFlags": FLAGS,
            "observationMethod": "owned-process-exit-v1", "results": results,
            "ownershipPreflight": preflight, "cryptoRuntimeScope": crypto_scope,
            "ownershipCoverage": {"worker": "kernel-job-active-count" if owned_root is None else "direct-child-reap-and-group-quiescence",
                                  "tokenNode": "worker-job-and-Popen-exit" if owned_root is None else "actual-Popen-exit-and-inherited-group-observation",
                                  "dependencyAuditNode": "no individual PID observation; pinned-bootstrap-reap-and-owned-group-check",
                                  "reporterCancellation": "requires-producer-outer-supervisor"}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pre-seal-bootstrap-contract", required=True)
    parser.add_argument("--pre-seal-owned-posix-root")
    arguments = parser.parse_args()
    require(sys.version_info[:2] == (3, 13) and sys.flags.isolated and sys.flags.no_site
            and sys.flags.dont_write_bytecode and sys.flags.utf8_mode == 1)
    def cancelled(_signal, _frame):
        raise Invalid("NATIVE_BOOTSTRAP_EVIDENCE_INVALID")
    for number in (signal.SIGINT, signal.SIGTERM):
        signal.signal(number, cancelled)
    ownership_preflight(arguments.pre_seal_owned_posix_root)
    contract, pins = validate_contract(arguments.pre_seal_bootstrap_contract)
    encoded = canonical(report(contract, pins, arguments.pre_seal_owned_posix_root))
    require(len(encoded) <= 1024 * 1024)
    sys.stdout.buffer.write(encoded + b"\n")


if __name__ == "__main__":
    try:
        main()
    except Pending:
        target, _, _ = native_target()
        sys.stdout.buffer.write(canonical({"kind": "rt-private-python-native-bootstrap-pending-v1",
                                          "status": "pending", "releaseEligible": False, "target": target,
                                          "reason": "NATIVE_POSIX_OWNERSHIP_PENDING"}) + b"\n")
        raise SystemExit(2) from None
    except BaseException:
        sys.stderr.write("NATIVE_BOOTSTRAP_EVIDENCE_INVALID\n")
        raise SystemExit(70) from None
