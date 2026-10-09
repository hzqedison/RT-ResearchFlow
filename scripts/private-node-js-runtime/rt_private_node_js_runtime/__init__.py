# SPDX-License-Identifier: AGPL-3.0-only
"""Independent private-Node JS backend. Trusted JS only: Node vm is NOT an OS sandbox.

Windows factory receives a suspended Popen and must assign a KILL_ON_JOB_CLOSE
job before returning its close callback (the existing bootstrap interface), or
an object with close(). That caller-supplied authority owns whole-job cleanup.
This module reaps the actual child and drains/joins its pipes; it does not infer
unknown descendant observations from a root exit. POSIX inherited mode leaves
whole-session supervision to the outer owner and never kills that parent group.
"""
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import re
import signal
import subprocess
import threading
import time

__version__ = "1.0.0"
DEFAULT_SECONDS = 5.0
MAX_FRAME = 1024 * 1024
_configuration = None
_registry = set()
_registry_lock = threading.RLock()
_cleanup_lock = threading.Lock()
_registry_generation = 0
_registry_draining = False


class JSRuntimeError(RuntimeError): pass
class JSEvalException(JSRuntimeError): pass
class JSTimeoutException(JSRuntimeError): pass
class JSUnsupportedValue(JSRuntimeError): pass
class JSOwnershipError(JSRuntimeError): pass


def close_all():
    """Explicit provider-operation finally hook; never depends on GC/finalizers.

    Close every registered context even when one cleanup fails. Concurrent
    construction during this boundary fails closed rather than escaping its
    snapshot. A failed cleanup is surfaced after all other cleanups complete.
    """
    global _registry_generation, _registry_draining
    with _cleanup_lock:
        with _registry_lock:
            _registry_generation += 1
            _registry_draining = True
            contexts = tuple(_registry)
        errors = []
        try:
            for context in contexts:
                try: context.close()
                except BaseException as error: errors.append(error)
        finally:
            with _registry_lock: _registry_draining = False
        if errors:
            raise JSOwnershipError("close_all cleanup failures: %d" % len(errors)) from errors[0]


class _Undefined:
    def __repr__(self): return "JSUndefined"


JSUndefined = _Undefined()


def _file(path, digest, limit):
    path = Path(path)
    if (not path.is_absolute() or path.is_symlink() or not path.is_file() or
            not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) or
            path.stat().st_size > limit):
        raise JSRuntimeError("private file binding invalid")
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != digest: raise JSRuntimeError("private file SHA mismatch")
    return path.resolve(strict=True)


def _root(pid):
    if (os.name != "posix" or type(pid) is not int or not 1 < pid <= 2147483647 or
            os.getpgrp() != pid or os.getsid(0) != pid or
            os.getpgid(pid) != pid or os.getsid(pid) != pid):
        raise JSOwnershipError("explicit inherited POSIX owner mismatch")


def configure(node_path, node_sha256, worker_path, worker_sha256, cache_root, *,
              pre_seal_owned_posix_root=None, windows_job_factory=None):
    global _configuration
    node = _file(node_path, node_sha256, 256 * 1024 * 1024)
    worker = _file(worker_path, worker_sha256, MAX_FRAME)
    cache = Path(cache_root)
    if not cache.is_absolute() or cache.is_symlink() or not cache.is_dir():
        raise JSRuntimeError("owned cache directory required")
    if pre_seal_owned_posix_root is not None: _root(pre_seal_owned_posix_root)
    if os.name == "nt" and (pre_seal_owned_posix_root is not None or not callable(windows_job_factory)):
        raise JSOwnershipError("Windows assigned-job factory required")
    if os.name == "posix" and (windows_job_factory is not None or not os.access(node, os.X_OK)):
        raise JSOwnershipError("POSIX executable/ownership configuration invalid")
    _configuration = (node, node_sha256, worker, worker_sha256, cache.resolve(strict=True),
                      pre_seal_owned_posix_root, windows_job_factory)


def _seconds(timeout, timeout_sec, max_memory):
    if max_memory is not None: raise JSUnsupportedValue("max_memory is not supported")
    limits = [DEFAULT_SECONDS]
    for value, scale in ((timeout, .001), (timeout_sec, 1.0)):
        if value is None: continue
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            raise ValueError("finite nonnegative timeout required")
        if value: limits.append(value * scale)
    return min(limits)


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result: raise JSRuntimeError("duplicate protocol key")
        result[key] = value
    return result


class MiniRacer:
    def __init__(self):
        with _registry_lock:
            if _registry_draining: raise JSOwnershipError("provider operation cleanup in progress")
            generation = _registry_generation
        if _configuration is None: raise JSRuntimeError("private runtime not configured")
        self._config = _configuration
        node, node_sha, worker, worker_sha, cache, root, factory = self._config
        _file(node, node_sha, 256 * 1024 * 1024); _file(worker, worker_sha, MAX_FRAME)
        if root is not None: _root(root)
        self._lock = threading.RLock(); self._closed = False
        self._queue = queue.Queue(maxsize=4); self._threads = []; self._closer = None; self._serial = 0
        env = {"PATH": "", "NODE_PATH": "", "NODE_OPTIONS": "", "HOME": str(cache),
               "USERPROFILE": str(cache), "TMPDIR": str(cache), "TEMP": str(cache), "TMP": str(cache), "TZ": "UTC"}
        if os.name == "nt":
            directory = ctypes.create_unicode_buffer(32768)
            if not ctypes.windll.kernel32.GetWindowsDirectoryW(directory, len(directory)):
                raise JSOwnershipError("Windows directory unavailable")
            env["SystemRoot"] = directory.value
        self._process = subprocess.Popen([str(node), "--max-old-space-size=128", str(worker)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=cache, env=env, shell=False, close_fds=True, bufsize=0,
            creationflags=4 if os.name == "nt" else 0,
            start_new_session=os.name == "posix" and root is None)
        try:
            if os.name == "nt":
                job = factory(self._process)
                self._closer = job if callable(job) else getattr(job, "close", None)
                if not callable(self._closer): raise JSOwnershipError("job close callback missing")
                resume = ctypes.WinDLL("ntdll").NtResumeProcess
                resume.argtypes = [ctypes.c_void_p]; resume.restype = ctypes.c_long
                if resume(int(self._process._handle)) != 0: raise JSOwnershipError("suspended child resume failed")
            else:
                owner = self._process.pid if root is None else root
                if os.getpgid(self._process.pid) != owner or os.getsid(self._process.pid) != owner:
                    raise JSOwnershipError("actual Node group/session mismatch")
            for channel in ("stdout", "stderr"):
                thread = threading.Thread(target=self._pump, args=(channel,), daemon=True)
                self._threads.append(thread); thread.start()
            ready = self._receive(time.monotonic() + DEFAULT_SECONDS)
            if ready != {"ready": True, "pid": self._process.pid, "nodeVersion": "22.23.3"}:
                raise JSRuntimeError("private Node identity/protocol mismatch")
            with _registry_lock:
                if _registry_draining or generation != _registry_generation:
                    raise JSOwnershipError("provider operation ended during JS startup")
                _registry.add(self)  # only assigned, running, identity-checked instances
        except BaseException:
            self.close(); raise

    def _publish(self, value):
        try: self._queue.put_nowait(value)
        except queue.Full:
            # Reader backpressure cannot turn into an unbounded memory queue.
            self._protocol_failed = True

    def _pump(self, channel):
        stream = getattr(self._process, channel); pending = bytearray(); total = 0
        try:
            while True:
                chunk = stream.read(4096)
                if not chunk: break
                if channel == "stderr":
                    total += len(chunk)
                    if total > 65536: raise JSRuntimeError("stderr bound exceeded")
                    continue
                pending.extend(chunk)
                while b"\n" in pending:
                    line, _, pending = pending.partition(b"\n")
                    if len(line) > MAX_FRAME: raise JSRuntimeError("response bound exceeded")
                    self._publish(json.loads(line.decode("utf-8"), object_pairs_hook=_unique))
                if len(pending) > MAX_FRAME: raise JSRuntimeError("response bound exceeded")
        except BaseException:
            self._publish(JSRuntimeError("private worker pipe/protocol failure"))
        finally:
            if channel == "stdout": self._publish(JSRuntimeError("private worker exited"))

    def _receive(self, deadline):
        if getattr(self, "_protocol_failed", False): raise JSRuntimeError("protocol queue bound exceeded")
        try: result = self._queue.get(timeout=max(0, deadline - time.monotonic()))
        except queue.Empty: raise JSTimeoutException("private JS deadline exceeded") from None
        if isinstance(result, Exception): raise result
        return result

    def _request(self, operation, code, args, timeout, timeout_sec, max_memory):
        seconds = _seconds(timeout, timeout_sec, max_memory)
        if not isinstance(code, str) or not code or "\x00" in code:
            raise ValueError("nonempty JavaScript string required")
        with self._lock:
            if self._closed: raise JSRuntimeError("JS context is closed")
            root = self._config[5]
            if root is not None:
                _root(root)
                if os.getpgid(self._process.pid) != root or os.getsid(self._process.pid) != root:
                    raise JSOwnershipError("actual Node escaped inherited group")
            self._serial += 1
            payload = (json.dumps({"id": self._serial, "op": operation, "code": code, "args": args,
                        "timeout": max(1, math.ceil(seconds * 1000))}, ensure_ascii=True, allow_nan=False) + "\n").encode("ascii")
            if len(payload) > MAX_FRAME: raise JSUnsupportedValue("request bound exceeded")
            deadline = time.monotonic() + seconds
            written = queue.Queue(maxsize=1)
            def write():
                try:
                    view = memoryview(payload)
                    while view:
                        count = self._process.stdin.write(view)
                        if not count: raise JSRuntimeError("private worker input closed")
                        view = view[count:]
                    written.put(None)
                except BaseException: written.put(JSRuntimeError("private worker write failure"))
            writer = threading.Thread(target=write, daemon=True); self._threads.append(writer); writer.start()
            try:
                try: error = written.get(timeout=max(0, deadline - time.monotonic()))
                except queue.Empty: raise JSTimeoutException("private worker write deadline exceeded") from None
                if error: raise error
                response = self._receive(deadline)
                if type(response) is not dict or response.get("id") != self._serial:
                    raise JSRuntimeError("response identity mismatch")
                if response.get("error"):
                    kind = response.get("kind")
                    if kind == "timeout": raise JSTimeoutException("JavaScript execution timed out")
                    if kind == "unsupported": raise JSUnsupportedValue(response["error"])
                    raise JSEvalException(response["error"])
                tag = response.get("type")
                if tag == "undefined": return JSUndefined
                if tag == "json": return json.loads(response["value"])
                if tag in ("null", "boolean", "number", "string"): return response["value"]
                raise JSRuntimeError("unsupported protocol value")
            except (JSEvalException, JSUnsupportedValue): raise
            except BaseException:
                self.close(); raise
            finally:
                writer.join(timeout=1)
                if not writer.is_alive(): self._threads.remove(writer)

    def eval(self, code, timeout=None, timeout_sec=None, max_memory=None):
        return self._request("eval", code, [], timeout, timeout_sec, max_memory)

    def execute(self, expr, timeout=None, timeout_sec=None, max_memory=None):
        return self._request("execute", expr, [], timeout, timeout_sec, max_memory)

    def call(self, expr, *args, encoder=None, timeout=None, timeout_sec=None, max_memory=None):
        if encoder not in (None, json.JSONEncoder): raise JSUnsupportedValue("custom encoder is not supported")
        return self._request("call", expr, args, timeout, timeout_sec, max_memory)

    def close(self):
        with self._lock:
            if self._closed: return
            self._closed = True; errors = []
            with _registry_lock: _registry.discard(self)
            try:
                if self._closer:
                    result = self._closer()
                    if result is not None and not result: raise JSOwnershipError("job close failed")
                elif os.name == "posix" and self._config[5] is None:
                    for sig in (signal.SIGTERM, signal.SIGKILL):
                        try: os.killpg(self._process.pid, sig)
                        except ProcessLookupError: pass
                        if sig == signal.SIGTERM: time.sleep(.05)
                elif self._process.poll() is None:
                    self._process.kill()  # suspended/unassigned or inherited direct child only
            except BaseException as error: errors.append(error)
            try: self._process.wait(timeout=3)
            except BaseException as error:
                errors.append(error)
                self._process.kill(); self._process.wait(timeout=1)
            for stream in (self._process.stdin, self._process.stdout, self._process.stderr):
                if stream: stream.close()
            for thread in self._threads:
                thread.join(timeout=1)
                if thread.is_alive(): errors.append(JSOwnershipError("owned pipe thread not reaped"))
            if os.name == "posix" and self._config[5] is None:
                end = time.monotonic() + 1
                while True:
                    try: os.killpg(self._process.pid, 0)
                    except ProcessLookupError: break
                    if time.monotonic() >= end:
                        errors.append(JSOwnershipError("owned group still exists")); break
                    time.sleep(.02)
            if errors: raise JSOwnershipError("owned JS cleanup incomplete") from errors[0]

    def __enter__(self):
        if self._closed: raise JSRuntimeError("JS context is closed")
        return self

    def __exit__(self, *_): self.close(); return False
