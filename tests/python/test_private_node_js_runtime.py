# SPDX-License-Identifier: AGPL-3.0-only
"""Real private Node, offline synthetic JS and unchanged mootdx decoder.

No provider import/network/broker/native compiler. Windows uses the actual
bootstrap job function extracted by AST, with kernel active-count observations.
This suite is semantic/OS evidence only, never provider or release approval.
"""
import argparse
import ast
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "scripts/private-node-js-runtime"
sys.path.insert(0, str(SOURCE))
import rt_private_node_js_runtime as api

NODE = None
OBSERVATIONS = []


def sha(path):
    with Path(path).open("rb") as stream: return hashlib.file_digest(stream, "sha256").hexdigest()


def job_factory(process):
    source = REPO / "resources/python-runtime/bootstrap.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "windows_job")
    namespace = {}; exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
    close = namespace["windows_job"](process)
    cells = dict(zip(close.__code__.co_freevars, (cell.cell_contents for cell in close.__closure__)))
    handle = cells["handle"]
    from ctypes import wintypes as w
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.QueryInformationJobObject.argtypes = (w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD, ctypes.c_void_p)
    kernel.TerminateJobObject.argtypes = (w.HANDLE, w.UINT)
    class Accounting(ctypes.Structure):
        _fields_ = [(name, ctypes.c_int64) for name in ("user", "kernel", "periodUser", "periodKernel")] + [(name, w.DWORD) for name in ("faults", "total", "active", "terminated")]
    def active():
        row = Accounting()
        if not kernel.QueryInformationJobObject(handle, 1, ctypes.byref(row), ctypes.sizeof(row), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return row.active
    record = {"pid": process.pid, "assignedAt": time.time(), "activeAfterAssignment": active(), "bootstrapSourceSha256": sha(source)}
    OBSERVATIONS.append(record)
    def cleanup():
        if not kernel.TerminateJobObject(handle, 70): raise ctypes.WinError(ctypes.get_last_error())
        end = time.monotonic() + 3
        while active():
            if time.monotonic() >= end: raise RuntimeError("actual job remains active")
            time.sleep(.01)
        record.update(activeAfterTermination=active(), emptiedAt=time.time())
        return close()
    return cleanup


class Contracts(unittest.TestCase):
    def setUp(self):
        base = Path("D:/RT-ResearchFlow-BuildCache") if os.name == "nt" else Path(tempfile.gettempdir())
        self.temp = tempfile.TemporaryDirectory(prefix="private-node-js-runtime-test-", dir=base)
        self.cache = Path(self.temp.name)
        worker = SOURCE / "rt_private_node_js_runtime/worker.cjs"
        api.configure(NODE, sha(NODE), worker, sha(worker), self.cache,
                      windows_job_factory=job_factory if os.name == "nt" else None)
        self.contexts = []

    def tearDown(self):
        for context in self.contexts: context.close()
        self.temp.cleanup()

    def context(self):
        context = api.MiniRacer(); self.contexts.append(context); return context

    def test_persistent_context_unicode_and_isolation(self):
        a, b = self.context(), self.context()
        self.assertEqual(a.eval('var counter = 0; counter += 1; counter'), 1)
        self.assertEqual(a.eval('counter += 1; counter'), 2)
        self.assertEqual(b.eval('typeof counter'), 'undefined')
        self.assertEqual(a.eval("'\\u4e2d\\u6587\\ud83d\\ude00'"), '\u4e2d\u6587\U0001f600')
        self.assertEqual(a.eval('typeof require + ":" + typeof process + ":" + typeof fetch'), 'undefined:undefined:undefined')

    def test_eval_undefined_null_and_explicit_unsupported(self):
        c = self.context(); self.assertIs(c.eval('undefined'), api.JSUndefined); self.assertIsNone(c.eval('null'))
        for expression in ('({a:1})', 'Promise.resolve(1)', 'Infinity', '1n'):
            with self.assertRaises(api.JSUnsupportedValue): c.eval(expression)
        for expression in ('Promise.resolve(1)', '({f:()=>1})', '({then:()=>1})'):
            with self.assertRaises(api.JSUnsupportedValue): c.execute(expression)

    def test_call_execute_json_date_and_injection_safe_arguments(self):
        c = self.context(); c.eval('var b = {decode: function(x) { return {text:x, date:new Date("1990-12-19T00:00:00Z"), values:[0,null,true]}; }}')
        payload = '\u4e2d\u6587" ); globalThis.injected = true; //\n\\'
        self.assertEqual(c.call('b.decode', payload), {'text': payload, 'date': '1990-12-19T00:00:00.000Z', 'values': [0, None, True]})
        self.assertEqual(c.eval('typeof injected'), 'undefined')
        self.assertEqual(c.execute('({a:1, missing:undefined, date:new Date("2000-01-01T00:00:00Z")})'), {'a': 1, 'date': '2000-01-01T00:00:00.000Z'})
        self.assertEqual(c.execute('[undefined, NaN, Infinity]'), [None, None, None])
        with self.assertRaises(api.JSUnsupportedValue): c.call('b.decode', 'x', encoder=lambda x: x)
        with self.assertRaises(api.JSUnsupportedValue): c.eval('1', max_memory=1)

    def test_real_mootdx_decoder_eval_then_call(self):
        c = self.context(); c.eval((REPO / 'tests/fixtures/runtime/mootdx-holiday.original.js').read_text(encoding='utf-8'))
        # Header 139/version 0, then matching start/end counters; the former
        # LC/BAAAAAA had start=1,end=0 and genuinely decodes to undefined.
        for encoded, expected in (('LC/AAAAAAA', ['1990-12-19T00:00:00.000Z']), ('LC/BAABAAA', ['1990-12-20T00:00:00.000Z'])):
            self.assertEqual(c.call('d', encoded), expected)

    def test_exceptions_preserve_context_and_exit_does_not_swallow(self):
        c = self.context(); c.eval('var kept = 41')
        with self.assertRaises(api.JSEvalException): c.eval('throw Error("actual JS exception")')
        with self.assertRaises(api.JSEvalException): c.eval('let = ;')
        self.assertEqual(c.eval('kept + 1'), 42)
        with self.assertRaisesRegex(ValueError, 'caller failure'):
            with self.context(): raise ValueError('caller failure')

    def test_timeout_shortest_limit_actual_exit_and_close(self):
        c = self.context(); process = c._process; started = time.monotonic()
        with self.assertRaises(api.JSTimeoutException): c.eval('while(true){}', timeout=1000, timeout_sec=.05)
        self.assertLess(time.monotonic() - started, 4)
        self.assertIsNotNone(process.poll()); self.assertTrue(all(not t.is_alive() for t in c._threads))
        c.close(); c.close()
        with self.assertRaises(api.JSRuntimeError): c.eval('1')
        self.assertEqual(api._seconds(0, None, None), api.DEFAULT_SECONDS)
        for value in (-1, float('nan'), float('inf'), True):
            with self.assertRaises(ValueError): api._seconds(value, None, None)

    def test_configuration_hash_and_unconfigured_fail_closed(self):
        worker = SOURCE / 'rt_private_node_js_runtime/worker.cjs'
        with self.assertRaises(api.JSRuntimeError): api.configure(NODE, '0'*64, worker, sha(worker), self.cache, windows_job_factory=job_factory if os.name == 'nt' else None)
        with self.assertRaises(api.JSRuntimeError): api.configure(NODE, sha(NODE), worker, '0'*64, self.cache, windows_job_factory=job_factory if os.name == 'nt' else None)
        saved = api._configuration
        try:
            api._configuration = None
            with self.assertRaises(api.JSRuntimeError): api.MiniRacer()
        finally: api._configuration = saved

    def test_close_all_operation_boundary_without_context_managers(self):
        a, b = api.MiniRacer(), api.MiniRacer()
        instances = (a, b)
        try:
            self.assertEqual(a.eval('var retained = 7; retained'), 7)
            self.assertEqual(b.eval('var retained = 9; retained'), 9)
            self.assertIsNone(a._process.poll()); self.assertIsNone(b._process.poll())
            with api._registry_lock: self.assertTrue(all(c in api._registry for c in instances))
        finally: api.close_all()  # operation finally, not user with/close or GC
        for c in instances:
            self.assertIsNotNone(c._process.poll())
            self.assertTrue(all(not thread.is_alive() for thread in c._threads))
            with api._registry_lock: self.assertNotIn(c, api._registry)
            with self.assertRaises(api.JSRuntimeError): c.eval('retained')
        observations = len(OBSERVATIONS)
        api.close_all(); api.close_all(); a.close(); b.close()
        self.assertEqual(len(OBSERVATIONS), observations)
        new = self.context(); self.assertEqual(new.eval('40+2'), 42)
        api.close_all(); self.assertIsNotNone(new._process.poll())
        # Actual job closure occurs first. Its diagnostic failure must not stop
        # the second real context's cleanup, independent of registry iteration.
        failed, other = api.MiniRacer(), api.MiniRacer()
        if os.name == 'nt':
            actual_close = failed._closer
            def diagnostic_failure():
                actual_close()
                raise RuntimeError('synthetic diagnostic after actual job cleanup')
            failed._closer = diagnostic_failure
        else:
            actual_close = failed.close
            def diagnostic_failure():
                actual_close()
                raise RuntimeError('synthetic diagnostic after actual group cleanup')
            failed.close = diagnostic_failure
        with self.assertRaisesRegex(api.JSOwnershipError, 'close_all cleanup failures: 1'):
            api.close_all()
        for c in (failed, other):
            self.assertIsNotNone(c._process.poll())
            self.assertTrue(all(not thread.is_alive() for thread in c._threads))
            with api._registry_lock: self.assertNotIn(c, api._registry)
        api.close_all()
        if os.name == 'nt':
            self.assertTrue(all(row['activeAfterTermination'] == 0 for row in OBSERVATIONS))

    def test_deterministic_independent_wheel_and_source_binding(self):
        script = REPO / 'scripts/build-private-node-js-runtime-wheel.py'
        spec = importlib.util.spec_from_file_location('recipe', script); recipe = importlib.util.module_from_spec(spec); spec.loader.exec_module(recipe)
        _, _, binding = recipe.sources(SOURCE)
        a = recipe.build(SOURCE, self.cache / 'private-node-js-runtime-a', binding)
        b = recipe.build(SOURCE, self.cache / 'private-node-js-runtime-b', binding)
        self.assertEqual(a, b)
        with zipfile.ZipFile(self.cache / 'private-node-js-runtime-a' / a['wheel']['filename']) as archive:
            metadata = archive.read(recipe.DIST + '/METADATA').decode('ascii')
            self.assertIn('Name: rt-private-node-js-runtime\nVersion: 1.0.0\n', metadata)
            self.assertNotIn('Requires-Dist:', metadata); self.assertFalse(any('mini_racer' in name for name in archive.namelist()))
            self.assertEqual(archive.read(recipe.DIST + '/licenses/LICENSE'), (REPO / 'LICENSE').read_bytes())
        with self.assertRaises(ValueError): recipe.build(SOURCE, self.cache / 'private-node-js-runtime-bad', '0'*64)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--private-node', type=Path, required=True); parser.add_argument('--evidence-output', type=Path, required=True)
    args = parser.parse_args(); NODE = args.private_node
    if not NODE.is_absolute() or not args.evidence_output.is_absolute(): parser.error('absolute paths required')
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Contracts)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    evidence = {'kind':'rt-private-node-js-runtime-offline-test-evidence-v1','releaseEligible':False,
        'privateNode':{'path':str(NODE),'sha256':sha(NODE)},'python':{'path':sys.executable,'version':sys.version},
        'sourceHashes':{str(path.relative_to(REPO)):sha(path) for path in (SOURCE/'rt_private_node_js_runtime/__init__.py', SOURCE/'rt_private_node_js_runtime/worker.cjs', REPO/'scripts/build-private-node-js-runtime-wheel.py', Path(__file__))},
        'testsRun':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),
        'actualJobObservations':OBSERVATIONS,'scope':'offline synthetic JS plus unchanged mootdx decoder; no provider/broker/native/release approval'}
    args.evidence_output.write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
    sys.exit(0 if result.wasSuccessful() else 1)
