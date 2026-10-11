"""Synthetic bytes only: no provider import, sockets, Node or account access."""
import gzip
import importlib.util
from pathlib import Path
import time
import tracemalloc
import unittest
from unittest.mock import patch
import zlib

SPEC = importlib.util.spec_from_file_location(
    "rt_pywencai_bounded_test",
    Path(__file__).resolve().parents[2] / "resources/python-runtime/pywencai_adapter.py",
)
ADAPTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADAPTER)


class Owner:
    def __init__(self, expire_after=None):
        self.checks = 0
        self.expire_after = expire_after

    def check(self):
        self.checks += 1
        if self.expire_after is not None and self.checks > self.expire_after:
            ADAPTER.fail()


class Raw:
    def __init__(self, content, pieces=None):
        self.content = content
        self.pieces = pieces
        self.calls = []

    def stream(self, amount, *, decode_content):
        self.calls.append((amount, decode_content))
        if self.pieces is not None:
            yield from self.pieces
        else:
            for offset in range(0, len(self.content), amount):
                yield self.content[offset:offset + amount]


class Response:
    status_code = 200

    def __init__(self, content, encoding="identity", *, pieces=None, length=None):
        self.raw = Raw(content, pieces)
        self.headers = {"Content-Encoding": encoding}
        if length is not None:
            self.headers["Content-Length"] = length
        self.closed = 0

    def close(self):
        self.closed += 1

    def iter_content(self, **kwargs):
        raise AssertionError("Production reader must not invoke requests decompression")


class BoundedInflateTests(unittest.TestCase):
    def read(self, response, **kwargs):
        return ADAPTER.bounded_response_bytes(response, Owner(), **kwargs)

    def test_identity_wire_stream_disables_library_decoding(self):
        response = Response(b'{"volume":0}', length="12")
        self.assertEqual(self.read(response), b'{"volume":0}')
        self.assertEqual(response.raw.calls, [(ADAPTER.WIRE_CHUNK_BYTES, False)])

    def test_gzip_roundtrip(self):
        body = '{"name":"\u4e2d\u6587","volume":0}'.encode("utf8")
        for encoding in ("gzip", "x-gzip", " GZip "):
            self.assertEqual(self.read(Response(gzip.compress(body), encoding)), body)

    def test_gzip_split_into_single_byte_chunks(self):
        body = b'{"volume":0}'
        compressed = gzip.compress(body)
        self.assertEqual(self.read(Response(compressed, "gzip", pieces=[bytes([x]) for x in compressed])), body)

    def test_concatenated_gzip_members(self):
        body = gzip.compress(b'{"volume":') + gzip.compress(b'0}')
        self.assertEqual(self.read(Response(body, "gzip")), b'{"volume":0}')

    def test_wrapped_and_raw_deflate(self):
        body = b'{"volume":0}'
        compressor = zlib.compressobj(wbits=-zlib.MAX_WBITS)
        raw = compressor.compress(body) + compressor.flush()
        for compressed in (zlib.compress(body), raw):
            self.assertEqual(self.read(Response(compressed, "deflate")), body)
            pieces = [compressed[:1], compressed[1:]]
            self.assertEqual(self.read(Response(compressed, "deflate", pieces=pieces)), body)

    def test_exact_decoded_limit_can_consume_compression_footer(self):
        with patch.object(ADAPTER, "DECODED_BYTES", 64):
            for encoding, compressed in (("gzip", gzip.compress(b'x' * 64)), ("deflate", zlib.compress(b'x' * 64))):
                self.assertEqual(self.read(Response(compressed, encoding)), b'x' * 64)

    def test_one_byte_past_decoded_limit_rejected(self):
        with patch.object(ADAPTER, "DECODED_BYTES", 64):
            for encoding, compressed in (("identity", b'x' * 65), ("gzip", gzip.compress(b'x' * 65)),
                                        ("deflate", zlib.compress(b'x' * 65))):
                with self.assertRaises(ADAPTER.SafeFailure):
                    self.read(Response(compressed, encoding))

    def test_declared_wire_size_rejected_before_read(self):
        response = Response(b'{}', length=str(ADAPTER.WIRE_BYTES + 1))
        with self.assertRaises(ADAPTER.SafeFailure):
            self.read(response)
        self.assertEqual(response.raw.calls, [])

    def test_actual_wire_size_is_counted_without_content_length(self):
        with patch.object(ADAPTER, "WIRE_BYTES", 2):
            with self.assertRaises(ADAPTER.SafeFailure):
                self.read(Response(b'{}x', pieces=[b'{}', b'x']))

    def test_invalid_length_and_mismatched_length_rejected(self):
        for length in ("-1", "two", "2, 2", "9" * 21, 2, "1", "3"):
            with self.assertRaises(ADAPTER.SafeFailure):
                self.read(Response(b'{}', length=length))

    def test_truncation_checksum_trailing_data_and_unknown_encoding_fail(self):
        valid = gzip.compress(b'{}')
        corrupt = valid[:-1] + bytes([valid[-1] ^ 1])
        for response in (Response(valid[:-1], "gzip"), Response(corrupt, "gzip"),
                         Response(valid + b'garbage', "gzip"), Response(b'', "gzip"),
                         Response(zlib.compress(b'{}') + b'x', "deflate"), Response(b'{}', "br"),
                         Response(b'{}', "gzip, deflate")):
            with self.assertRaises((ADAPTER.SafeFailure, zlib.error)):
                self.read(response)

    def test_member_count_is_bounded(self):
        with patch.object(ADAPTER, "COMPRESSION_MEMBERS", 2):
            with self.assertRaises(ADAPTER.SafeFailure):
                self.read(Response(gzip.compress(b'') * 3, "gzip"))

    def test_oversized_or_nonbytes_wire_chunks_rejected(self):
        for pieces in ([b'x' * (ADAPTER.WIRE_CHUNK_BYTES + 1)], [bytearray(b'{}')], ['{}']):
            with self.assertRaises(ADAPTER.SafeFailure):
                self.read(Response(b'', pieces=pieces))

    def test_deadline_checked_inside_inflate_loop(self):
        response = Response(gzip.compress(b'x' * 100), "gzip")
        with self.assertRaises(ADAPTER.SafeFailure):
            ADAPTER.bounded_response_bytes(response, Owner(expire_after=1))

    def test_decoded_test_fixture_cannot_be_used_by_default_or_for_gzip(self):
        class Fixture:
            def iter_content(self, **kwargs):
                yield b'{}'
        with self.assertRaises(ADAPTER.SafeFailure):
            self.read(Fixture())
        self.assertEqual(self.read(Fixture(), decoded_fixture=True), b'{}')
        fixture = Fixture()
        fixture.headers = {"Content-Encoding": "gzip"}
        with self.assertRaises(ADAPTER.SafeFailure):
            self.read(fixture, decoded_fixture=True)

    def test_gzip_bomb_output_is_capped_before_large_python_allocation(self):
        # Construct fixture before measuring. This is not a whole-worker RSS proof.
        compressed = gzip.compress(b'x' * (ADAPTER.DECODED_BYTES * 16))
        tracemalloc.start()
        try:
            with self.assertRaises(ADAPTER.SafeFailure):
                self.read(Response(compressed, "gzip"))
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertLess(peak, ADAPTER.DECODED_BYTES * 8)

    def test_facade_uses_bounded_reader_and_closes_failed_response(self):
        response = Response(gzip.compress(b'{}'), "gzip")

        class Session:
            def __init__(self):
                self.proxies = {}
                self.cookies = {}
                self.closed = 0
                self.calls = []

            def request(self, *args, **kwargs):
                self.calls.append(kwargs)
                return response

            def close(self):
                self.closed += 1

        session = Session()
        owner = ADAPTER.Controller(None, None, None, None, lambda: session)
        headers = {"hexin-v": 'x' * 16, "User-Agent": ADAPTER.USER_AGENT}
        result = owner.facade.post('http://www.iwencai.com' + ADAPTER.PATHS[0],
                                  json={"page": 1, "perpage": 10, "question": "test"}, headers=headers)
        self.assertEqual(result.json(), {})
        self.assertEqual(session.calls[0]['headers']['Accept-Encoding'], 'gzip, deflate, identity')
        self.assertTrue(session.calls[0]['verify'])
        self.assertFalse(session.calls[0]['allow_redirects'])
        self.assertGreaterEqual(response.closed, 1)
        self.assertGreaterEqual(session.closed, 1)
        response.headers['Content-Encoding'] = 'br'
        owner = ADAPTER.Controller(None, None, None, None, lambda: session)
        with self.assertRaisesRegex(ADAPTER.SafeFailure, '^SOURCE_REQUEST_FAILED$'):
            owner.facade.post('http://www.iwencai.com' + ADAPTER.PATHS[0],
                             json={"page": 1, "perpage": 10, "question": "test"}, headers=headers)
        self.assertTrue(owner.failed)


if __name__ == '__main__':
    unittest.main()
