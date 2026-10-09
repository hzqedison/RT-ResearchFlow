"""Auditable, child-local adapter for the unmodified pywencai 0.13.1 wheel.

Production is entered ONLY by the verified private bootstrap. Native evidence
is deliberately a different, non-release format. No global requests/subprocess
patch, system Node discovery, provider retry, redirect or runtime installation.
"""

import ctypes
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import queue
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
import zlib


VERSION = "0.13.1"
NODE_VERSION = "22.23.3"
ADAPTER_PATH = "providers/pywencai/pywencai_adapter.py"
SOURCE_HASHES = {
    "__init__.py": "211a7899ee7ada276a694f220b78b2b80c1ab6523995e747fa8ddf06e54972eb",
    "wencai.py": "4d39b6bff9b0fc17ec410531f10e66480239fd8169a78b9f20abec6ef6730f8a",
    "headers.py": "8bec64aac0826501e9c78fd1714316c84441e3faad15371aa6006d79c757b802",
    "convert.py": "6f273ee2d2db12534d99eb8a119f36134a0ffd371e4f2e0c3ccfd6c0627c5c54",
    "hexin-v.bundle.js": "1faba661364bf54cd91190bfde202152f8e7648e3acf9b2cac12939b44c3a1c4",
}
PATHS = (
    "/customized/chart/get-robot-data",
    "/gateway/urp/v7/landing/getDataList",
    "/unifiedwap/unified-wap/v2/stock-pick/find",
)
URL_MAP = {}
for _path in PATHS:
    for _prefix in ("http://www.iwencai.com", "https://www.iwencai.com", "https://www.iwencai.com:443"):
        URL_MAP[_prefix + _path] = "https://www.iwencai.com:443" + _path
        if _path == PATHS[1]:
            URL_MAP[_prefix + _path + "?iwcpro=1"] = "https://www.iwencai.com:443" + _path + "?iwcpro=1"
CONNECT_READ_TIMEOUT = (5, 12)
TOTAL_SECONDS = 22
TOKEN_SECONDS = 5
DECODED_BYTES = 2 * 1024 * 1024
WIRE_BYTES = 2 * 1024 * 1024
WIRE_CHUNK_BYTES = 32768
COMPRESSION_MEMBERS = 64
STDOUT_BYTES = 4096
STDERR_BYTES = 8192
BODY_BYTES = 65536
USER_AGENT = "RT-ResearchFlow/1.7 private-provider"


class SafeFailure(Exception):
    def __init__(self):
        super().__init__("SOURCE_REQUEST_FAILED")


def fail():
    raise SafeFailure() from None


def file_hash(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def contained(root, relative):
    if not isinstance(relative, str) or not relative or "\\" in relative or ":" in relative:
        fail()
    parts = relative.split("/")
    if any(part in ("", ".", "..") for part in parts) or relative.startswith("/"):
        fail()
    path = (root / relative).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        fail()
    return path


def checked_file(root, relative, inventory, expected=None):
    path = contained(root, relative)
    row = inventory.get(relative)
    if not isinstance(row, dict) or row.get("kind") != "file" or type(row.get("size")) is not int:
        fail()
    sha = row.get("sha256")
    if not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{64}", sha):
        fail()
    if path.stat().st_size != row["size"] or (expected is not None and sha != expected) or file_hash(path) != sha:
        fail()
    return path, sha


def verify_site(site):
    site = Path(site).resolve(strict=True)
    dist = importlib.metadata.distribution("pywencai")
    if dist.version != VERSION or Path(dist.locate_file("")).resolve() != site:
        fail()
    package = site / "pywencai"
    for name, sha in SOURCE_HASHES.items():
        path = (package / name).resolve(strict=True)
        if not path.is_relative_to(site) or not path.is_file() or file_hash(path) != sha:
            fail()
    return package


def require_child():
    if not (sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and sys.flags.utf8_mode):
        fail()
    if threading.current_thread() is not threading.main_thread():
        fail()


def validate_pre_seal_owned_posix_root(value):
    # A bootstrap keyword hook, never an environment or provider API option.
    if (os.name != "posix" or type(value) is not int or not 1 < value <= 2147483647
            or os.getpgrp() != value or os.getsid(0) != value
            or os.getpgid(value) != value or os.getsid(value) != value):
        fail()
    return value


class WindowsJob:
    """An owned suspended Node process is assigned before its first instruction."""

    def __init__(self, process):
        from ctypes import wintypes as w

        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        k.CreateJobObjectW.restype = w.HANDLE
        k.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        k.SetInformationJobObject.restype = w.BOOL
        k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        k.AssignProcessToJobObject.restype = w.BOOL
        k.CloseHandle.argtypes = [w.HANDLE]
        k.CloseHandle.restype = w.BOOL
        k.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
        k.CreateToolhelp32Snapshot.restype = w.HANDLE
        k.OpenThread.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        k.OpenThread.restype = w.HANDLE
        k.ResumeThread.argtypes = [w.HANDLE]
        k.ResumeThread.restype = w.DWORD

        class Basic(ctypes.Structure):
            _fields_ = [("time1", ctypes.c_longlong), ("time2", ctypes.c_longlong),
                        ("flags", w.DWORD), ("min_ws", ctypes.c_size_t), ("max_ws", ctypes.c_size_t),
                        ("active", w.DWORD), ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("schedule", w.DWORD)]

        class Io(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ("r", "w", "o", "rb", "wb", "ob")]

        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", Io), ("process_mem", ctypes.c_size_t),
                        ("job_mem", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]

        class ThreadEntry(ctypes.Structure):
            _fields_ = [("size", w.DWORD), ("usage", w.DWORD), ("id", w.DWORD), ("owner", w.DWORD),
                        ("base", w.LONG), ("delta", w.LONG), ("flags", w.DWORD)]

        k.Thread32First.argtypes = [w.HANDLE, ctypes.POINTER(ThreadEntry)]
        k.Thread32First.restype = w.BOOL
        k.Thread32Next.argtypes = [w.HANDLE, ctypes.POINTER(ThreadEntry)]
        k.Thread32Next.restype = w.BOOL
        self.kernel = k
        self.handle = k.CreateJobObjectW(None, None)
        if not self.handle:
            fail()
        try:
            limits = Extended()
            limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not k.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                fail()
            if not k.AssignProcessToJobObject(self.handle, w.HANDLE(int(process._handle))):
                fail()
            snapshot = k.CreateToolhelp32Snapshot(4, 0)  # TH32CS_SNAPTHREAD
            if snapshot == ctypes.c_void_p(-1).value:
                fail()
            try:
                entry = ThreadEntry()
                entry.size = ctypes.sizeof(entry)
                found = False
                available = k.Thread32First(snapshot, ctypes.byref(entry))
                while available:
                    if entry.owner == process.pid:
                        thread = k.OpenThread(2, False, entry.id)  # THREAD_SUSPEND_RESUME
                        if not thread:
                            fail()
                        try:
                            if k.ResumeThread(thread) == 0xFFFFFFFF:
                                fail()
                            found = True
                        finally:
                            k.CloseHandle(thread)
                        break
                    available = k.Thread32Next(snapshot, ctypes.byref(entry))
                if not found:
                    fail()
            finally:
                k.CloseHandle(snapshot)
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def run_token(node, node_sha, script, cache, deadline, *, pre_seal_owned_posix_root=None):
    if pre_seal_owned_posix_root is not None:
        validate_pre_seal_owned_posix_root(pre_seal_owned_posix_root)
    if not node.is_absolute() or not script.is_absolute() or file_hash(node) != node_sha:
        fail()
    if file_hash(script) != SOURCE_HASHES["hexin-v.bundle.js"]:
        fail()
    remaining = min(TOKEN_SECONDS, deadline - time.monotonic())
    if remaining <= 0:
        fail()
    process = None
    job = None
    streams = []
    with tempfile.TemporaryDirectory(prefix="pywencai-node-", dir=cache) as cwd:
        env = {key: os.environ[key] for key in ("SystemRoot", "WINDIR") if key in os.environ}
        env.update({"PATH": str(node.parent), "HOME": cwd, "USERPROFILE": cwd,
                    "TEMP": cwd, "TMP": cwd, "TMPDIR": cwd, "NODE_OPTIONS": "", "NODE_PATH": ""})
        options = ({"creationflags": 0x08000000 | 0x00000004} if os.name == "nt"
                   else {"start_new_session": pre_seal_owned_posix_root is None})
        exceeded = threading.Event()
        buffers = [bytearray(), bytearray()]
        def drain(handle, target, cap):
            try:
                while True:
                    block = os.read(handle.fileno(), 1024)
                    if not block:
                        return
                    if len(target) + len(block) > cap:
                        exceeded.set()
                        return
                    target.extend(block)
            except Exception:
                exceeded.set()
        try:
            process = subprocess.Popen([str(node), "--", str(script)], shell=False, cwd=cwd, env=env,
                                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       close_fds=True, **options)
            if os.name == "nt":
                job = WindowsJob(process)
            elif pre_seal_owned_posix_root is not None:
                validate_pre_seal_owned_posix_root(pre_seal_owned_posix_root)
                if (os.getpgid(process.pid) != pre_seal_owned_posix_root
                        or os.getsid(process.pid) != pre_seal_owned_posix_root):
                    fail()
            for handle, target, cap in ((process.stdout, buffers[0], STDOUT_BYTES), (process.stderr, buffers[1], STDERR_BYTES)):
                thread = threading.Thread(target=drain, args=(handle, target, cap), daemon=True)
                streams.append(thread)
                thread.start()
            until = time.monotonic() + remaining
            while process.poll() is None:
                if exceeded.is_set() or time.monotonic() >= until or time.monotonic() >= deadline:
                    fail()
                time.sleep(0.01)
            # Close the owned tree even on success, before waiting for pipe EOF.
            if job:
                job.close()
            elif os.name != "nt" and pre_seal_owned_posix_root is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            for thread in streams:
                thread.join(max(0, until - time.monotonic()))
            if process.returncode != 0 or exceeded.is_set() or any(t.is_alive() for t in streams):
                fail()
            raw = bytes(buffers[0])
            if not re.fullmatch(rb"[A-Za-z0-9_-]{16,512}(?:\r?\n)?", raw):
                fail()
            return raw.rstrip(b"\r\n").decode("ascii")
        except BaseException:
            fail()
        finally:
            if job:
                job.close()
            if process is not None:
                if os.name != "nt" and pre_seal_owned_posix_root is None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=2)
                for handle in (process.stdout, process.stderr):
                    if handle:
                        handle.close()
                for thread in streams:
                    thread.join(timeout=1)


class BoundedResponse:
    def __init__(self, content):
        self.text = content.decode("utf-8")

    def json(self):
        return json.loads(self.text)


def bounded_response_bytes(response, owner, *, decoded_fixture=False):
    """Bound wire reads and each inflate output before allocating the body.

    This bounds this reader's buffers, not total worker RSS or JSON objects.
    The decoded-fixture branch exists only for explicit candidate test seams.
    Production never asks requests/urllib3 to perform content decompression.
    """
    headers = getattr(response, "headers", {})
    encoding = headers.get("Content-Encoding", "identity")
    if not isinstance(encoding, str):
        fail()
    encoding = encoding.strip().lower()
    if encoding not in ("", "identity", "gzip", "x-gzip", "deflate"):
        fail()
    length = headers.get("Content-Length")
    if length is not None:
        if not isinstance(length, str) or not re.fullmatch(r"[0-9]{1,20}", length):
            fail()
        length = int(length)
        if length > WIRE_BYTES:
            fail()
    raw = getattr(response, "raw", None)
    stream = getattr(raw, "stream", None)
    if callable(stream):
        chunks = stream(WIRE_CHUNK_BYTES, decode_content=False)
    elif decoded_fixture and encoding in ("", "identity"):
        # Never enabled by install(), and cannot test compressed wire limits.
        chunks = response.iter_content(chunk_size=WIRE_CHUNK_BYTES)
    else:
        fail()
    content = bytearray()
    wire = 0
    decoder = None
    prefix = b""
    members = 0
    compressed = encoding in ("gzip", "x-gzip", "deflate")
    for chunk in chunks:
        owner.check()
        if not isinstance(chunk, bytes) or len(chunk) > WIRE_CHUNK_BYTES:
            fail()
        wire += len(chunk)
        if wire > WIRE_BYTES:
            fail()
        if not chunk:
            continue
        if not compressed:
            if len(content) + len(chunk) > DECODED_BYTES:
                fail()
            content.extend(chunk)
            continue
        pending = chunk
        if encoding == "deflate" and decoder is None:
            pending = prefix + pending
            if len(pending) < 2:
                prefix = pending
                continue
            prefix = b""
            cmf, flg = pending[:2]
            wrapped = cmf & 15 == 8 and cmf >> 4 <= 7 and ((cmf << 8) | flg) % 31 == 0
            decoder = zlib.decompressobj(zlib.MAX_WBITS if wrapped else -zlib.MAX_WBITS)
        while pending:
            owner.check()
            if decoder is None or decoder.eof:
                if encoding == "deflate":
                    fail()  # No silently ignored bytes after a deflate stream.
                members += 1
                if members > COMPRESSION_MEMBERS:
                    fail()
                decoder = zlib.decompressobj(zlib.MAX_WBITS | 16)
            # Unlike iter_content(), max_length limits the inflater's allocation.
            limit = DECODED_BYTES - len(content)
            block = decoder.decompress(pending, limit + 1)
            if len(block) > limit:
                fail()
            content.extend(block)
            tail = decoder.unused_data if decoder.eof else decoder.unconsumed_tail
            if tail == pending and not block:
                fail()
            pending = tail
    owner.check()
    if length is not None and wire != length:
        fail()
    if compressed and (decoder is None or not decoder.eof or prefix):
        fail()
    # No unbounded decoder.flush() call: eof proves the footer was consumed.
    return bytes(content)


def no_redirect_response_handling(*args, **kwargs):
    # Requests otherwise reads redirect bodies even with allow_redirects=False.
    return iter(())


def protected_close(resource):
    if resource is None:
        return True
    try:
        resource.close()
        return True
    except BaseException:
        # Do not retain or emit exception text containing request information.
        return False


class RequestFacade:
    def __init__(self, controller, factory):
        self.controller = controller
        self.factory = factory

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def request(self, method, url, **kwargs):
        owner = self.controller
        owner.check()
        session = None
        response_box = []
        try:
            if method not in ("POST", "GET") or not isinstance(url, str) or url not in URL_MAP:
                fail()
            allowed = {"json", "data", "headers", "timeout"}
            if set(kwargs) - allowed or ("json" in kwargs and "data" in kwargs):
                fail()
            # The ONLY source-level timeout is get_page's pinned (5,10).
            # Caller request_params are independently rejected before headers/token.
            if "timeout" in kwargs and (kwargs["timeout"] != (5, 10) or PATHS[0] in url):
                fail()
            payload = kwargs.get("json", kwargs.get("data"))
            if not isinstance(payload, dict):
                fail()
            if type(payload.get("page")) is not int or payload["page"] != 1:
                fail()
            perpage = payload.get("perpage")
            if isinstance(perpage, str) and perpage == "10" and PATHS[0] in url:
                perpage = 10
            if type(perpage) is not int or not 1 <= perpage <= 50:
                fail()
            for key in ("question", "query"):
                value = payload.get(key)
                if value is not None and (not isinstance(value, str) or not value.strip() or len(value) > 300 or "\x00" in value):
                    fail()
            if len(json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")) > BODY_BYTES:
                fail()
            headers = kwargs.get("headers", {})
            if not isinstance(headers, dict) or set(headers) - {"hexin-v", "User-Agent", "cookie"}:
                fail()
            if headers.get("cookie") != owner.cookie or headers.get("User-Agent") != USER_AGENT:
                fail()
            if not isinstance(headers.get("hexin-v"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,512}", headers["hexin-v"]):
                fail()
            if owner.requests >= 2:
                fail()
            owner.requests += 1
            owner.check()
            session = self.factory()
            session.trust_env = False
            session.verify = True
            session.auth = None
            session.proxies.clear()
            session.cookies.clear()
            # This Session belongs exclusively to this request in the private
            # worker. Do not monkey-patch any shared requests class or module.
            session.resolve_redirects = no_redirect_response_handling
            if hasattr(session, "mount"):
                import requests
                session.mount("https://", requests.adapters.HTTPAdapter(max_retries=0))
            completion = queue.Queue(maxsize=1)
            def receive():
                response = None
                result = None
                ok = False
                try:
                    request_headers = {k: v for k, v in headers.items() if v is not None}
                    request_headers["Accept-Encoding"] = "gzip, deflate, identity"
                    response = session.request(method, URL_MAP[url], headers=request_headers,
                                               **{k: v for k, v in kwargs.items() if k in ("json", "data")},
                                               verify=True, timeout=CONNECT_READ_TIMEOUT, allow_redirects=False, stream=True,
                                               proxies={}, auth=None)
                    response_box.append(response)
                    if not 200 <= response.status_code < 300:
                        fail()
                    content = bounded_response_bytes(response, owner, decoded_fixture=owner.decoded_fixture)
                    owner.check()
                    result = BoundedResponse(content)
                    ok = True
                except BaseException:
                    pass
                finally:
                    response_closed = protected_close(response)
                    session_closed = protected_close(session)
                    cleanup_ok = response_closed and session_closed
                    if not cleanup_ok:
                        owner.failed = True
                    # Publish once, only after both cleanup attempts complete.
                    try:
                        completion.put_nowait((ok and cleanup_ok, result if ok and cleanup_ok else None))
                    except queue.Full:
                        owner.failed = True
            worker = threading.Thread(target=receive, daemon=True)
            worker.start()
            try:
                ok, result = completion.get(timeout=max(0, owner.deadline - time.monotonic()))
            except queue.Empty:
                fail()
            owner.check()
            if not ok:
                fail()
            return result
        except BaseException:
            owner.failed = True
            fail()
        finally:
            cleanup_ok = True
            for response in response_box:
                cleanup_ok = protected_close(response) and cleanup_ok
            cleanup_ok = protected_close(session) and cleanup_ok
            if not cleanup_ok:
                owner.failed = True
                fail()


class Controller:
    def __init__(self, node, node_sha, package, cache, factory, *, _decoded_fixture=False, pre_seal_owned_posix_root=None):
        if pre_seal_owned_posix_root is not None:
            validate_pre_seal_owned_posix_root(pre_seal_owned_posix_root)
        self.pre_seal_owned_posix_root = pre_seal_owned_posix_root
        self.node, self.node_sha, self.package, self.cache = node, node_sha, package, cache
        self.failed = False
        self.deadline = time.monotonic() + TOTAL_SECONDS
        self.requests = 0
        self.cookie = None
        self.active = False
        self.decoded_fixture = _decoded_fixture is True
        self.facade = RequestFacade(self, factory)

    def check(self):
        if self.pre_seal_owned_posix_root is not None:
            validate_pre_seal_owned_posix_root(self.pre_seal_owned_posix_root)
        if self.failed or time.monotonic() >= self.deadline:
            self.failed = True
            fail()

    def token(self):
        self.check()
        try:
            if self.pre_seal_owned_posix_root is not None:
                return run_token(self.node, self.node_sha, self.package / "hexin-v.bundle.js", self.cache, self.deadline,
                                 pre_seal_owned_posix_root=self.pre_seal_owned_posix_root)
            return run_token(self.node, self.node_sha, self.package / "hexin-v.bundle.js", self.cache, self.deadline)
        except BaseException:
            self.failed = True
            fail()

    def headers(self, cookie=None, user_agent=None):
        self.check()
        if cookie is not None and cookie != self.cookie or user_agent not in (None, USER_AGENT):
            self.failed = True
            fail()
        return {"hexin-v": self.token(), "User-Agent": USER_AGENT, "cookie": self.cookie}

    def validate_kwargs(self, kwargs):
        self.check()
        params = kwargs.get("request_params", {})
        if type(params) is not dict or params:
            fail()
        if kwargs.get("loop", False) is not False or kwargs.get("page", 1) != 1 or type(kwargs.get("page", 1)) is not int:
            fail()
        perpage = kwargs.get("perpage", 50)
        if type(perpage) is not int or not 1 <= perpage <= 50:
            fail()
        if "timeout" in kwargs or kwargs.get("retry", 1) != 1 or type(kwargs.get("retry", 1)) is not int:
            fail()
        if kwargs.get("user_agent") not in (None, USER_AGENT) or kwargs.get("query_type", "stock") != "stock":
            fail()
        if type(kwargs.get("pro", False)) is not bool:
            fail()
        cookie = kwargs.get("cookie")
        if cookie is not None and (not isinstance(cookie, str) or len(cookie) > 8192 or any(ord(c) < 32 or ord(c) > 126 for c in cookie)):
            fail()
        query = kwargs.get("query")
        if query is not None and (not isinstance(query, str) or not query.strip() or len(query) > 300 or "\x00" in query):
            fail()
        if kwargs.get("sleep", 0) not in (0, 1) or kwargs.get("log", False) is not False:
            fail()

    def once(self, do, retry=1, sleep=0, log=False):
        self.check()
        try:
            result = do()
            self.check()
            return result
        except BaseException:
            self.failed = True
            fail()

    def attach(self):
        # All imports are of the verified isolated provider, never a shared site.
        package = importlib.import_module("pywencai")
        wencai = importlib.import_module("pywencai.wencai")
        convert = importlib.import_module("pywencai.convert")
        headers = importlib.import_module("pywencai.headers")
        for module in (package, wencai, convert, headers):
            if not Path(module.__file__).resolve().is_relative_to(self.package):
                fail()
        self.original_get = wencai.get
        self.original_robot = wencai.get_robot_data
        self.original_page = wencai.get_page
        wencai.rq = convert.rq = self.facade
        headers.get_token = self.token
        headers.headers = wencai.headers = convert.headers = self.headers
        wencai.while_do = self.once
        def guarded(original):
            def call(*args, **kwargs):
                try:
                    self.validate_kwargs(kwargs)
                    result = original(*args, **kwargs)
                    self.check()
                    return result
                except BaseException:
                    self.failed = True
                    fail()
            return call
        wencai.get_robot_data = guarded(self.original_robot)
        wencai.get_page = guarded(self.original_page)
        def get(loop=False, **kwargs):
            if self.active or self.failed:
                self.failed = True
                fail()
            self.active = True
            self.deadline = time.monotonic() + TOTAL_SECONDS
            try:
                self.validate_kwargs({**kwargs, "loop": loop})
                if not isinstance(kwargs.get("query"), str):
                    fail()
                self.cookie = kwargs.get("cookie")
                kwargs.update({"perpage": kwargs.get("perpage", 50), "page": 1, "retry": 1, "sleep": 0, "log": False})
                result = self.original_get(loop=False, **kwargs)
                self.check()
                if hasattr(result, "shape") and result.shape[0] > 50:
                    fail()
                return result
            except BaseException:
                self.failed = True
                fail()
        package.get = wencai.get = get
        return self


def controlled_cache():
    value = os.environ.get("HOME", "")
    cache = Path(value)
    if not value or not cache.is_absolute() or ".." in cache.parts:
        fail()
    cache = cache.resolve(strict=True)
    if not cache.is_dir():
        fail()
    return cache


def install(manifest, root, site, *, pre_seal_owned_posix_root=None):
    """Called after bootstrap's full resource/manifest verification."""
    try:
        require_child()
        if pre_seal_owned_posix_root is not None:
            validate_pre_seal_owned_posix_root(pre_seal_owned_posix_root)
        root, site = Path(root).resolve(strict=True), Path(site).resolve(strict=True)
        if manifest.get("kind") != "rt-private-python-runtime" or manifest.get("complete") is not True:
            fail()
        provider = manifest["providers"]["pywencai"]
        node_spec = manifest["node"]
        if provider["version"] != VERSION or provider["site"] != "providers/pywencai/site" or node_spec["version"] != NODE_VERSION:
            fail()
        if site != (root / provider["site"]).resolve() or not site.is_relative_to(root):
            fail()
        if sum(w["distribution"].lower().replace("_", "-") == "pywencai" and w["version"] == VERSION for w in provider["wheels"]) != 1:
            fail()
        inventory = {row["path"]: row for row in manifest["files"]}
        adapter, _ = checked_file(root, ADAPTER_PATH, inventory, file_hash(__file__))
        if adapter != Path(__file__).resolve():
            fail()
        for name, sha in SOURCE_HASHES.items():
            checked_file(root, provider["site"] + "/pywencai/" + name, inventory, sha)
        node, node_sha = checked_file(root, node_spec["executable"], inventory)
        if not node.is_relative_to(root / "node") or (os.name != "nt" and not os.access(node, os.X_OK)):
            fail()
        package = verify_site(site)
        import requests
        return Controller(node, node_sha, package, controlled_cache(), requests.Session,
                          pre_seal_owned_posix_root=pre_seal_owned_posix_root).attach()
    except BaseException:
        fail()


def prepare_native_evidence(evidence_path, expected_sha256, *, _session_factory=None):
    """Candidate-only acceptance seam; never accepted by production bootstrap.

    Evidence binds the actual PBS executable, private Node and all pinned
    pywencai sources/JS. It makes no claim about a complete dependency lock.
    _session_factory is exclusively an in-process, no-network test seam.
    """
    try:
        require_child()
        evidence_path = Path(evidence_path).resolve(strict=True)
        if evidence_path.stat().st_size > 1024 * 1024 or file_hash(evidence_path) != expected_sha256:
            fail()
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        if evidence.get("kind") != "rt-private-pywencai-native-evidence" or evidence.get("releaseEligible") is not False:
            fail()
        if evidence.get("version") != VERSION or evidence.get("nodeVersion") != NODE_VERSION or evidence.get("adapterSha256") != file_hash(__file__):
            fail()
        if evidence["python"]["version"] != ".".join(map(str, sys.version_info[:3])):
            fail()
        if not Path(evidence["python"]["executable"]).samefile(sys.executable) or file_hash(sys.executable) != evidence["python"]["sha256"]:
            fail()
        site = Path(evidence["site"])
        node = Path(evidence["node"]["executable"])
        if not site.is_absolute() or not node.is_absolute() or file_hash(node) != evidence["node"]["sha256"]:
            fail()
        if evidence["sourceHashes"] != SOURCE_HASHES:
            fail()
        site = site.resolve(strict=True)
        if any("providers" in Path(p).parts and Path(p).resolve() != site for p in sys.path if p):
            fail()
        if str(site) not in sys.path:
            sys.path.insert(0, str(site))
        package = verify_site(site)
        import requests
        return Controller(node.resolve(strict=True), evidence["node"]["sha256"], package,
                          controlled_cache(), _session_factory or requests.Session,
                          _decoded_fixture=_session_factory is not None).attach()
    except BaseException:
        fail()


def rewrite_trusted_bridge(script):
    """Remove ONLY the old bridge's fixed timeout; facade owns all timeouts.

    This is not caller request_params normalization. No request/user data is
    examined or changed, and the pinned third-party source is never edited.
    """
    return script.replace('request_params={"timeout": (5, 12)}', 'request_params={}')
