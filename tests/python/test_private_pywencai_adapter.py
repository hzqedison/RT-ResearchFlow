"""No-provider-network acceptance using actual PBS/provider/private Node inputs.

Run with -X utf8 -I -S -B and explicit --site/--node. All HTTP transports are
owned fixtures. Candidate evidence is never a release manifest or final lock.
"""
import argparse
import ctypes
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock


parser = argparse.ArgumentParser()
parser.add_argument("--site", required=True)
parser.add_argument("--node", required=True)
args, remaining = parser.parse_known_args()
SITE = Path(args.site).resolve(strict=True)
NODE = Path(args.node).resolve(strict=True)
sys.path.insert(0, str(SITE))
ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "resources/python-runtime/pywencai_adapter.py"
spec = importlib.util.spec_from_file_location("rt_pywencai_adapter_tests", SOURCE)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
import requests
import urllib3


def document(data):
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


def robot():
    content = {"components": [{
        "show_type": "xuangu_tableV1", "cid": "fixture", "puuid": "fixture",
        "data": {"meta": {"extra": {"condition": "fixture", "row_count": 1}}},
        "config": {"other_info": {"footer_info": {"url": "/gateway/urp/v7/landing/getDataList?condition=fixture"}}},
    }]}
    return document({"data": {"answer": [{"txt": [{"content": content}]}]}})


ROW = {"code": "600000", "name": "\u6d66\u53d1\u94f6\u884c"}


class Response:
    def __init__(self, content=None, status=200, chunks=None):
        self.status_code = status
        self.content = robot() if content is None else content
        self.chunks = chunks
        self.closed = False

    def iter_content(self, chunk_size):
        yield from (self.chunks if self.chunks is not None else [self.content])

    def close(self):
        self.closed = True


class Session:
    def __init__(self, fixture):
        self.fixture = fixture
        self.trust_env = True
        self.verify = False
        self.auth = "forbidden-default"
        self.proxies = {"http": "forbidden-default"}
        self.cookies = {"forbidden-default": "forbidden-default"}
        self.closed = False

    def request(self, method, url, **kwargs):
        self.fixture.calls.append((self, method, url, kwargs))
        item = self.fixture.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        if callable(item):
            return item()
        return item

    def close(self):
        self.closed = True


class Fixture:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.sessions = []

    def session(self):
        item = Session(self)
        self.sessions.append(item)
        return item


class AdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node_sha = adapter.file_hash(NODE)
        cls.api = (requests.request, requests.get, requests.post, requests.Session)
        probe = subprocess.run([str(NODE), "--version"], shell=False, capture_output=True, timeout=5,
                               env={k: os.environ[k] for k in ("SystemRoot", "WINDIR") if k in os.environ})
        if probe.returncode != 0 or probe.stdout.strip() != b"v22.23.3":
            raise AssertionError("Private Node version mismatch")

    def setUp(self):
        self.owned = tempfile.TemporaryDirectory(prefix="pywencai-adapter-test-")
        self.cache = Path(self.owned.name).resolve()
        self.environment = mock.patch.dict(os.environ, {"HOME": str(self.cache),
            "NODE_OPTIONS": "--invalid-test-only", "NODE_PATH": "forbidden-test-only",
            "HTTP_PROXY": "http://invalid.test", "HTTPS_PROXY": "http://invalid.test",
            "FAKE_COOKIE_SECRET": "test-only-sentinel", "FAKE_QUERY_SECRET": "test-only-sentinel"})
        self.environment.start()
        self.evidence = {
            "kind": "rt-private-pywencai-native-evidence", "releaseEligible": False,
            "version": "0.13.1", "nodeVersion": "22.23.3", "site": str(SITE),
            "adapterSha256": adapter.file_hash(SOURCE), "sourceHashes": adapter.SOURCE_HASHES,
            "node": {"executable": str(NODE), "sha256": self.node_sha},
            "python": {"version": ".".join(map(str, sys.version_info[:3])),
                       "executable": sys.executable, "sha256": adapter.file_hash(sys.executable)},
        }

    def tearDown(self):
        self.environment.stop()
        self.owned.cleanup()

    def fresh(self, responses=None, real_token=False):
        for name in list(sys.modules):
            if name == "pywencai" or name.startswith("pywencai."):
                del sys.modules[name]
        self.fixture = Fixture(responses or [Response(), Response(document({"answer": {"components": [{"data": {"datas": [ROW]}}]}}))])
        evidence_path = self.cache / "candidate-native-evidence.json"
        evidence_path.write_bytes(document(self.evidence))
        controller = adapter.prepare_native_evidence(evidence_path, adapter.file_hash(evidence_path), _session_factory=self.fixture.session)
        if not real_token:
            controller.token = lambda: "A" * 32
        self.controller = controller
        return controller

    def get(self, **kwargs):
        import pywencai
        return pywencai.get(query="\u4e2d\u6587\u6d4b\u8bd5", **kwargs)

    def assert_safe_failure(self, action):
        with self.assertRaises(adapter.SafeFailure) as caught:
            action()
        self.assertEqual(str(caught.exception), "SOURCE_REQUEST_FAILED")
        self.assertIsNone(caught.exception.__cause__)

    def headers(self):
        return {"hexin-v": "A" * 32, "User-Agent": adapter.USER_AGENT, "cookie": None}

    def request(self, url=None, **kwargs):
        return self.controller.facade.request("POST", url or "http://www.iwencai.com" + adapter.PATHS[0],
                json={"page": 1, "perpage": 10, "question": "fixture"}, headers=self.headers(), **kwargs)

    def test_real_parser_robot_and_landing(self):
        self.fresh()
        frame = self.get(cookie="explicit=fixture")
        self.assertEqual(frame.to_dict("records"), [ROW])
        self.assertEqual(len(self.fixture.calls), 2)
        for session, method, url, kwargs in self.fixture.calls:
            self.assertFalse(session.trust_env)
            self.assertTrue(session.verify)
            self.assertIsNone(session.auth)
            self.assertEqual(session.proxies, {})
            self.assertEqual(session.cookies, {})
            self.assertTrue(session.closed)
            self.assertEqual(method, "POST")
            self.assertTrue(url.startswith("https://www.iwencai.com:443/"))
            self.assertEqual(kwargs["timeout"], (5, 12))
            self.assertTrue(kwargs["verify"])
            self.assertFalse(kwargs["allow_redirects"])
            self.assertTrue(kwargs["stream"])
            self.assertEqual(kwargs["headers"]["cookie"], "explicit=fixture")

    def test_real_parser_find_third_request_location(self):
        self.fresh([Response(), Response(document({"data": {"data": {"datas": [ROW]}}}))])
        frame = self.get(find=["600000"])
        self.assertEqual(frame.to_dict("records"), [ROW])
        self.assertEqual(self.fixture.calls[1][2], "https://www.iwencai.com:443" + adapter.PATHS[2])

    def test_pro_query_exact_allowlist(self):
        self.fresh()
        self.get(pro=True)
        self.assertEqual(self.fixture.calls[1][2], "https://www.iwencai.com:443" + adapter.PATHS[1] + "?iwcpro=1")

    def test_real_pinned_header_js_private_node(self):
        controller = self.fresh(real_token=True)
        token = controller.token()
        self.assertRegex(token, r"^[A-Za-z0-9_-]{16,512}$")
        self.assertEqual(self.fixture.calls, [])
        headers = importlib.import_module("pywencai.headers")
        self.assertEqual(headers.get_token, controller.token)

    def test_no_global_requests_or_subprocess_replacement(self):
        before = subprocess.Popen
        self.fresh()
        self.assertEqual(self.api, (requests.request, requests.get, requests.post, requests.Session))
        self.assertIs(subprocess.Popen, before)
        w = importlib.import_module("pywencai.wencai")
        c = importlib.import_module("pywencai.convert")
        self.assertIs(w.rq, self.controller.facade)
        self.assertIs(c.rq, self.controller.facade)
        self.assertTrue(callable(w.rq.get) and callable(w.rq.post) and callable(w.rq.request))

    def test_dangerous_request_params_rejected_before_token_and_send(self):
        for key in ("verify", "proxies", "auth", "hooks", "headers", "timeout", "allow_redirects", "cert", "stream", "params"):
            with self.subTest(key=key):
                self.fresh()
                self.controller.token = mock.Mock(side_effect=AssertionError("must not execute token"))
                self.assert_safe_failure(lambda: self.get(request_params={key: False}))
                self.assertEqual(self.fixture.calls, [])
                self.controller.token.assert_not_called()

    def test_bounds_rejected_before_send(self):
        for kwargs in ({"page": 2}, {"page": True}, {"perpage": 51}, {"perpage": 0}, {"perpage": True},
                       {"loop": True}, {"retry": 10}, {"user_agent": "custom"}, {"query_type": "fund"},
                       {"cookie": "bad\r\nHost: attacker"}, {"timeout": (1, 1)}):
            with self.subTest(kwargs=kwargs):
                self.fresh()
                self.assert_safe_failure(lambda: self.get(**kwargs))
                self.assertEqual(self.fixture.calls, [])

    def test_query_bounds_before_send(self):
        import pywencai
        for query in ("", " ", "x" * 301, ["fixture"], "x\x00y"):
            with self.subTest(query=query):
                self.fresh()
                pywencai = importlib.import_module("pywencai")
                self.assert_safe_failure(lambda: pywencai.get(query=query))
                self.assertEqual(self.fixture.calls, [])

    def test_other_urls_queries_credentials_ports_rejected_before_send(self):
        urls = ["http://evil.test" + adapter.PATHS[0], "http://www.iwencai.com:80" + adapter.PATHS[0],
                "https://www.iwencai.com:444" + adapter.PATHS[0], "https://user@www.iwencai.com" + adapter.PATHS[0],
                "http://www.iwencai.com/other", "http://www.iwencai.com" + adapter.PATHS[1] + "?iwcpro=2",
                "http://www.iwencai.com" + adapter.PATHS[1] + "?iwcpro=1&x=1", "http://www.iwencai.com" + adapter.PATHS[0] + "#fragment"]
        for url in urls:
            with self.subTest(url=url):
                self.fresh()
                self.assert_safe_failure(lambda: self.request(url))
                self.assertEqual(self.fixture.calls, [])

    def test_direct_dangerous_transport_kwargs_before_send(self):
        for key in ("verify", "proxies", "auth", "hooks", "allow_redirects", "cert"):
            self.fresh()
            self.assert_safe_failure(lambda: self.request(**{key: False}))
            self.assertEqual(self.fixture.calls, [])

    def test_host_header_before_send(self):
        self.fresh()
        self.assert_safe_failure(lambda: self.controller.facade.post("http://www.iwencai.com" + adapter.PATHS[0],
            json={"page": 1, "perpage": 10}, headers={**self.headers(), "Host": "evil.test"}))
        self.assertEqual(self.fixture.calls, [])

    def test_redirects_no_second_request_or_fallback(self):
        for status in (301, 302, 303, 307, 308):
            response = Response(status=status)
            self.fresh([response])
            self.assert_safe_failure(self.get)
            self.assertEqual(len(self.fixture.calls), 1)
            self.assertTrue(response.closed)
            self.assertTrue(self.fixture.sessions[0].closed)

    def test_tls_failure_is_latched_without_ten_retries_or_empty_success(self):
        self.fresh([requests.exceptions.SSLError("fake-cookie-secret fake-query-secret")])
        self.assert_safe_failure(self.get)
        self.assertEqual(len(self.fixture.calls), 1)
        self.assert_safe_failure(self.get)
        self.assertEqual(len(self.fixture.calls), 1)
        self.assertTrue(self.fixture.sessions[0].closed)

    def test_single_execution_replaces_bare_except_retry_loop(self):
        self.fresh()
        w = importlib.import_module("pywencai.wencai")
        do = mock.Mock(side_effect=RuntimeError("fake-secret"))
        self.assert_safe_failure(lambda: w.while_do(do, retry=10))
        do.assert_called_once()

    def test_decoded_gzip_cap_and_resource_close(self):
        response = requests.Response()
        response.status_code = 200
        response.headers["Content-Encoding"] = "gzip"
        response.raw = urllib3.response.HTTPResponse(body=io.BytesIO(gzip.compress(b"x" * 2048)),
            headers={"Content-Encoding": "gzip"}, preload_content=False, decode_content=False)
        self.fresh([response])
        with mock.patch.object(adapter, "DECODED_BYTES", 1024):
            self.assert_safe_failure(self.request)
        self.assertTrue(response.raw.closed)
        self.assertTrue(self.fixture.sessions[0].closed)

    def real_http_session(self, body, status=200, location=None):
        """Real Session.request/send; only the transport is synthetic."""
        class CountedBody(io.BytesIO):
            reads = 0
            def read(self, *args):
                self.reads += 1
                return super().read(*args)
            def read1(self, *args):
                return self.read(*args)
        encoded = gzip.compress(body)
        buffer = CountedBody(encoded)
        headers = {"Content-Encoding": "gzip", "Content-Length": str(len(encoded))}
        if location is not None:
            headers["Location"] = location
        class CountedRaw(urllib3.response.HTTPResponse):
            def stream(self, amt=None, decode_content=None):
                self.stream_calls.append((amt, decode_content))
                yield from super().stream(amt, decode_content=decode_content)
        raw = CountedRaw(body=buffer, headers=headers, preload_content=False,
                         decode_content=False, status=status)
        raw.stream_calls = []
        response = requests.Response()
        response.status_code = status
        response.headers.update(headers)
        response.raw = raw
        class Transport(requests.adapters.BaseAdapter):
            def __init__(self):
                self.calls = []
                self.closed = 0
            def send(self, prepared, **kwargs):
                self.calls.append((prepared, kwargs))
                response.request = prepared
                response.url = prepared.url
                response.connection = self
                return response
            def close(self):
                self.closed += 1
        transport = Transport()
        class RealSession(requests.Session):
            def mount(self, prefix, discarded):
                # Keep actual request/send/redirect machinery, but no sockets.
                discarded.close()
                return super().mount(prefix, transport)
        session = RealSession()
        self.assertIs(RealSession.request, requests.Session.request)
        self.assertIs(RealSession.send, requests.Session.send)
        self.controller.facade.factory = lambda: session
        self.controller.decoded_fixture = False
        return response, raw, buffer, session, transport

    def test_real_session_redirects_never_read_the_body(self):
        for status in (301, 302, 303, 307, 308):
            with self.subTest(status=status):
                self.fresh()
                response, raw, buffer, session, transport = self.real_http_session(
                    b'x' * (adapter.DECODED_BYTES * 2), status, "https://evil.test/never-requested")
                self.assert_safe_failure(self.request)
                self.assertEqual(len(transport.calls), 1)
                self.assertEqual(raw.stream_calls, [])
                self.assertEqual(buffer.reads, 0)
                self.assertIs(response._content, False)
                self.assertTrue(raw.closed)
                self.assertGreaterEqual(transport.closed, 1)

    def test_real_session_gzip_exact_decoded_limit_and_one_byte_over(self):
        exact = document({"padding": "x" * 64})
        over = document({"padding": "x" * 65})
        self.assertEqual(len(over), len(exact) + 1)
        for body, accepted in ((exact, True), (over, False)):
            with self.subTest(accepted=accepted):
                self.fresh()
                response, raw, buffer, session, transport = self.real_http_session(body)
                with mock.patch.object(adapter, "DECODED_BYTES", len(exact)), \
                     mock.patch.object(adapter, "BoundedResponse", wraps=adapter.BoundedResponse) as constructed:
                    if accepted:
                        result = self.request()
                        self.assertEqual(result.text.encode("utf8"), exact)
                        self.assertEqual(result.json(), {"padding": "x" * 64})
                        constructed.assert_called_once_with(exact)
                    else:
                        self.assert_safe_failure(self.request)
                        constructed.assert_not_called()
                self.assertTrue(raw.stream_calls)
                self.assertTrue(all(decoded is False for _, decoded in raw.stream_calls))
                self.assertTrue(raw.closed)
                self.assertGreaterEqual(transport.closed, 1)

    def test_cleanup_errors_latch_failure_without_thread_exception_or_secret(self):
        for response_fails, session_fails, status in ((True, False, 200), (False, True, 200),
                                                     (True, True, 200), (True, True, 500)):
            with self.subTest(response=response_fails, session=session_fails, status=status):
                response = Response(status=status)
                self.fresh([response])
                counts = {"response": 0, "session": 0}
                def close_response():
                    counts["response"] += 1
                    if response_fails:
                        raise RuntimeError("SYNTHETIC_PRIVATE_SENTINEL")
                def create_session():
                    session = self.fixture.session()
                    def close_session():
                        counts["session"] += 1
                        if session_fails:
                            raise RuntimeError("SYNTHETIC_PRIVATE_SENTINEL")
                        session.closed = True
                    session.close = close_session
                    return session
                response.close = close_response
                self.controller.facade.factory = create_session
                uncaught = []
                with mock.patch.object(threading, "excepthook", side_effect=uncaught.append):
                    self.assert_safe_failure(self.request)
                self.assertEqual(uncaught, [])
                self.assertGreaterEqual(counts["response"], 1)
                self.assertGreaterEqual(counts["session"], 1)
                self.assertTrue(self.controller.failed)

    def test_http_status_failure_closes_resources(self):
        for status in (400, 401, 403, 500):
            response = Response(status=status)
            self.fresh([response])
            self.assert_safe_failure(self.request)
            self.assertTrue(response.closed)
            self.assertTrue(self.fixture.sessions[0].closed)

    def test_request_total_deadline_not_just_socket_timeout(self):
        response = Response()
        def slow():
            time.sleep(0.2)
            return response
        controller = self.fresh([slow])
        controller.deadline = time.monotonic() + 0.03
        started = time.monotonic()
        self.assert_safe_failure(self.request)
        self.assertLess(time.monotonic() - started, 0.15)
        self.assertTrue(self.fixture.sessions[0].closed)
        time.sleep(0.22)
        self.assertTrue(response.closed)

    def test_expired_deadline_zero_requests(self):
        controller = self.fresh()
        controller.deadline = time.monotonic() - 1
        self.assert_safe_failure(self.request)
        self.assertEqual(self.fixture.calls, [])

    def test_no_additional_requests_above_two(self):
        self.fresh([Response(), Response()])
        self.request()
        self.request()
        self.assert_safe_failure(self.request)
        self.assertEqual(len(self.fixture.calls), 2)

    def test_response_rows_above_fifty_fail_closed(self):
        self.fresh([Response(), Response(document({"answer": {"components": [{"data": {"datas": [ROW] * 51}}]}}))])
        self.assert_safe_failure(self.get)
        self.assertEqual(len(self.fixture.calls), 2)

    def test_native_evidence_hash_version_and_node_gates(self):
        for field, value in (("version", "0.13.0"), ("nodeVersion", "20.18.0"), ("adapterSha256", "0" * 64), ("releaseEligible", True)):
            with self.subTest(field=field):
                self.evidence[field] = value
                self.assert_safe_failure(self.fresh)
                self.evidence[field] = {"version": "0.13.1", "nodeVersion": "22.23.3", "adapterSha256": adapter.file_hash(SOURCE), "releaseEligible": False}[field]
        self.evidence["node"]["sha256"] = "0" * 64
        self.assert_safe_failure(self.fresh)

    def test_source_binding_not_merely_package_version(self):
        with mock.patch.dict(adapter.SOURCE_HASHES, {"headers.py": "0" * 64}):
            self.assert_safe_failure(self.fresh)

    def test_native_evidence_never_accepted_as_production_manifest(self):
        self.assert_safe_failure(lambda: adapter.install(self.evidence, self.cache, SITE))

    def test_rewrite_only_fixed_trusted_bridge_timeout(self):
        fixed = 'call(request_params={"timeout": (5, 12)})'
        self.assertEqual(adapter.rewrite_trusted_bridge(fixed), 'call(request_params={})')
        other = 'call(request_params={"verify": False})'
        self.assertEqual(adapter.rewrite_trusted_bridge(other), other)

    def node_fixture(self, source, seconds=None, cache=None, deadline=None):
        script = self.cache / "owned-token-fixture.js"
        script.write_text(source, encoding="utf-8")
        with mock.patch.dict(adapter.SOURCE_HASHES, {"hexin-v.bundle.js": adapter.file_hash(script)}):
            until = deadline if deadline is not None else time.monotonic() + (seconds if seconds is not None else 5)
            return adapter.run_token(NODE, self.node_sha, script, cache or self.cache, until)

    def test_token_runner_no_cookie_query_env_or_shell_in_unicode_cwd(self):
        unicode_cache = self.cache / "\u771f\u5b9e Node \u5de5\u4f5c\u76ee\u5f55 \u7a7a\u683c"
        unicode_cache.mkdir()
        proof = self.cache / "real-node-cwd.json"
        source = "if(process.env.NODE_OPTIONS||process.env.NODE_PATH||process.env.FAKE_COOKIE_SECRET||process.env.FAKE_QUERY_SECRET||process.argv.length!==2)process.exit(8); require('fs').writeFileSync(" + json.dumps(str(proof)) + ",JSON.stringify({cwd:process.cwd(),pid:process.pid}));console.log('ABCDEFGHIJKLMNOP_fixture');"
        token = self.node_fixture(source, cache=unicode_cache)
        self.assertEqual(token, "ABCDEFGHIJKLMNOP_fixture")
        actual = json.loads(proof.read_text(encoding="utf-8"))
        self.assertEqual(Path(actual["cwd"]).parent, unicode_cache)
        self.assertIn("\u771f\u5b9e Node \u5de5\u4f5c\u76ee\u5f55 \u7a7a\u683c", actual["cwd"])
        self.assertIs(type(actual["pid"]), int)

    def test_token_output_stderr_caps_and_nonzero_sanitized(self):
        for source in ("process.stdout.write('X'.repeat(20000));", "process.stderr.write('X'.repeat(20000));console.log('ABCDEFGHIJKLMNOP');",
                       "console.error('fake-cookie-secret');process.exit(7);", "console.log('bad cookie=fixture');"):
            with self.subTest(source=source):
                self.assert_safe_failure(lambda: self.node_fixture(source))

    def test_token_deadline_owned_descendants_cleaned_up(self):
        marker = self.cache / "owned-descendant-must-not-survive.txt"
        child_started = self.cache / "owned-child-started.json"
        parent_started = self.cache / "owned-parent-started.json"
        sentinel_started = self.cache / "unrelated-sentinel-started.json"
        nonce = self.cache.name
        child_code = "const fs=require('fs');fs.writeFileSync(" + json.dumps(str(child_started)) + ",JSON.stringify({pid:process.pid,parent:process.ppid,nonce:" + json.dumps(nonce) + "}));setTimeout(()=>fs.writeFileSync(" + json.dumps(str(marker)) + ",'bad'),2500);setInterval(()=>{},10000);"
        source = "const fs=require('fs');const c=require('child_process').spawn(process.execPath,['-e'," + json.dumps(child_code) + "],{stdio:'ignore'});fs.writeFileSync(" + json.dumps(str(parent_started)) + ",JSON.stringify({pid:process.pid,child:c.pid,nonce:" + json.dumps(nonce) + "}));setInterval(()=>{},10000);"
        sentinel_code = "require('fs').writeFileSync(" + json.dumps(str(sentinel_started)) + ",JSON.stringify({pid:process.pid}));setInterval(()=>{},10000);"
        env = {k: os.environ[k] for k in ("SystemRoot", "WINDIR") if k in os.environ}
        options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
        sentinel = subprocess.Popen([str(NODE), "-e", sentinel_code], shell=False, cwd=self.cache,
            env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **options)
        class Deadline:
            value = time.monotonic() + 15
            def __sub__(self, other): return self.value - other
            def __le__(self, other): return self.value <= other
        deadline = Deadline()
        outcome = []
        def owned_runner():
            try:
                with mock.patch.object(adapter, "TOKEN_SECONDS", 15):
                    self.node_fixture(source, deadline=deadline)
                outcome.append(None)
            except BaseException as error:
                outcome.append(error)
        worker = threading.Thread(target=owned_runner, daemon=True)
        worker.start()
        process_handle = None
        kernel = None
        try:
            until = time.monotonic() + 10
            while not all(p.exists() and p.stat().st_size for p in (child_started, parent_started, sentinel_started)):
                if not worker.is_alive() or time.monotonic() >= until:
                    self.fail("Owned child must actually start before testing cleanup")
                time.sleep(0.01)
            child = json.loads(child_started.read_text(encoding="utf-8"))
            parent = json.loads(parent_started.read_text(encoding="utf-8"))
            self.assertEqual(child["nonce"], nonce)
            self.assertEqual(parent["nonce"], nonce)
            self.assertEqual(child["parent"], parent["pid"])
            self.assertEqual(child["pid"], parent["child"])
            self.assertEqual(json.loads(sentinel_started.read_text())["pid"], sentinel.pid)
            self.assertIsNone(sentinel.poll())
            if os.name == "nt":
                from ctypes import wintypes
                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
                kernel.OpenProcess.restype = wintypes.HANDLE
                kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
                kernel.WaitForSingleObject.restype = wintypes.DWORD
                kernel.GetProcessId.argtypes = [wintypes.HANDLE]
                kernel.GetProcessId.restype = wintypes.DWORD
                kernel.CloseHandle.argtypes = [wintypes.HANDLE]
                kernel.CloseHandle.restype = wintypes.BOOL
                process_handle = kernel.OpenProcess(0x00100000 | 0x1000, False, child["pid"])
                self.assertTrue(process_handle)
                self.assertEqual(kernel.GetProcessId(process_handle), child["pid"])
                self.assertEqual(kernel.WaitForSingleObject(process_handle, 0), 258)
            else:
                probe = subprocess.run(['/bin/ps', '-p', str(child['pid']), '-o', 'stat='], capture_output=True, timeout=2)
                self.assertEqual(probe.returncode, 0)
                self.assertTrue(probe.stdout.strip() and not probe.stdout.strip().startswith(b'Z'))
            # Only NOW expire the actual runner deadline: startup is already proven.
            deadline.value = time.monotonic() - 1
            worker.join(timeout=5)
            self.assertFalse(worker.is_alive())
            self.assertEqual(len(outcome), 1)
            self.assertIsInstance(outcome[0], adapter.SafeFailure)
            self.assertEqual(str(outcome[0]), 'SOURCE_REQUEST_FAILED')
            if process_handle:
                self.assertEqual(kernel.WaitForSingleObject(process_handle, 2000), 0)
            else:
                until = time.monotonic() + 2
                while True:
                    probe = subprocess.run(['/bin/ps', '-p', str(child['pid']), '-o', 'stat='], capture_output=True, timeout=2)
                    if probe.returncode != 0 or probe.stdout.strip().startswith(b'Z'):
                        break
                    if time.monotonic() >= until:
                        self.fail('Owned descendant remained alive')
                    time.sleep(0.02)
            self.assertFalse(marker.exists())
            self.assertIsNone(sentinel.poll(), 'Unrelated sentinel must survive owned-tree cleanup')
        finally:
            deadline.value = time.monotonic() - 1
            worker.join(timeout=5)
            if process_handle:
                kernel.CloseHandle(process_handle)
            sentinel.kill()
            sentinel.wait(timeout=5)


if __name__ == "__main__":
    print(json.dumps({"platform": sys.platform, "python": ".".join(map(str, sys.version_info[:3])),
                      "provider": "pywencai", "version": "0.13.1", "privateNode": "22.23.3",
                      "evidenceOnly": True, "providerHTTP": False}, sort_keys=True))
    unittest.main(argv=[sys.argv[0], *remaining])
