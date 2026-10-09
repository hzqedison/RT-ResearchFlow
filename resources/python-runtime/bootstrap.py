"""Trusted offline bootstrap. One process sees exactly one locked provider site."""
import hashlib
import io
import json
import os
import pathlib
import sys


def reject():
    # Never print request bodies, paths, cookies, or dependency exception details.
    sys.stderr.write("PRIVATE_RUNTIME_INVALID\n")
    raise SystemExit(70)


def contained(root, path):
    # PBS may include a non-existent stdlib zip on sys.path. Resolve existing
    # ancestors (including symlinks), but do not require that optional zip.
    target = path.resolve(strict=False)
    return target != root and root in target.parents



MAX_JSON = 8 * 1024 * 1024
AUDIT_DEADLINE_SECONDS = 12
PROVIDERS = ("akshare", "mootdx", "pywencai")
FIXTURE_KIND = "rt-private-python-bootstrap-test-fixture"


def validate_pre_seal_owned_posix_root(value):
    # Only the explicit trusted staging CLI passes this value. Environment
    # variables, request bodies and fixture envelopes cannot activate this mode.
    if type(value) is int:
        root_pid = value
    elif isinstance(value, str) and value.isascii() and value.isdecimal() and not value.startswith("0"):
        root_pid = int(value) if len(value) <= 10 else 0
    else:
        reject()
    if (os.name != "posix" or not 1 < root_pid <= 2147483647
            or os.getpgrp() != root_pid or os.getsid(0) != root_pid
            or os.getpgid(root_pid) != root_pid or os.getsid(root_pid) != root_pid):
        reject()
    return root_pid


def relative(value):
    if (not isinstance(value, str) or not value or "\\" in value or ":" in value
            or "\x00" in value or value.startswith("/")
            or any(part in ("", ".", "..") for part in value.split("/"))):
        reject()
    return value


def check_file(filename, row, limit=None):
    if (filename.is_symlink() or not filename.is_file()
            or (limit is not None and filename.stat().st_size > limit)):
        reject()
    digest = hashlib.sha256()
    with filename.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != row.get("sha256") or filename.stat().st_size != row.get("size"):
        reject()


def check_inventory(root, manifest, manifest_path):
    rows, index = manifest.get("files"), {}
    if not isinstance(rows, list) or not rows:
        reject()
    for row in rows:
        if not isinstance(row, dict):
            reject()
        name = relative(row.get("path"))
        filename = root / name
        if name in index or not contained(root, filename):
            reject()
        if row.get("kind") == "file":
            if type(row.get("size")) is not int or row["size"] < 0:
                reject()
            check_file(filename, row)
        elif row.get("kind") == "symlink":
            if not filename.is_symlink() or os.readlink(filename) != row.get("target"):
                reject()
        else:
            reject()
        index[name] = row
    found = set()
    for base, directories, files in os.walk(root, followlinks=False):
        for name in list(directories):
            filename = pathlib.Path(base) / name
            if filename.is_symlink():
                found.add(filename.relative_to(root).as_posix())
                directories.remove(name)
        for name in files:
            filename = pathlib.Path(base) / name
            if filename != manifest_path:
                found.add(filename.relative_to(root).as_posix())
    if found != set(index):
        reject()
    return index


def windows_job(process):
    import ctypes
    from ctypes import wintypes as w
    class Basic(ctypes.Structure):
        _fields_ = [("a", ctypes.c_int64), ("b", ctypes.c_int64), ("flags", w.DWORD),
                    ("minimum", ctypes.c_size_t), ("maximum", ctypes.c_size_t), ("active", w.DWORD),
                    ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]
    class Counters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ("r", "w", "o", "rb", "wb", "ob")]
    class Limits(ctypes.Structure):
        _fields_ = [("basic", Basic), ("io", Counters), ("process", ctypes.c_size_t),
                    ("job", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = (ctypes.c_void_p, w.LPCWSTR)
    kernel.CreateJobObjectW.restype = w.HANDLE
    kernel.SetInformationJobObject.argtypes = (w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD)
    kernel.AssignProcessToJobObject.argtypes = (w.HANDLE, w.HANDLE)
    kernel.CloseHandle.argtypes = (w.HANDLE,)
    handle, limits = kernel.CreateJobObjectW(None, None), Limits()
    limits.basic.flags = 0x2000  # KILL_ON_JOB_CLOSE, assigned before child receives stdin.
    if not handle:
        raise RuntimeError("PRIVATE_RUNTIME_INVALID")
    if (not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits))
            or not kernel.AssignProcessToJobObject(handle, int(process._handle))):
        kernel.CloseHandle(handle)
        raise RuntimeError("PRIVATE_RUNTIME_INVALID")
    return lambda: kernel.CloseHandle(handle)


AUDIT_NODE_SCRIPT = r'''
const fs=require('node:fs'),path=require('node:path');let chunks=[],size=0;
process.stdin.on('data',chunk=>{size+=chunk.length;if(size>8388608)process.exit(70);chunks.push(chunk)});
process.stdin.on('end',()=>{try{
 const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(process.versions.node!==input.manifest.node.version)throw Error();
 const core=require(path.join(input.root,'private_runtime_manifest.cjs'));
 const reports=core.validateDependencyAudits(input.root,input.manifest,input.generatorSha256);
 process.stdout.write(JSON.stringify({reports}));
}catch(_){process.stderr.write('PRIVATE_RUNTIME_INVALID\\n');process.exitCode=70}});
'''


def check_dependency_audits(root, manifest, index, generator_sha256=None, *, pre_seal_owned_posix_root=None):
    if pre_seal_owned_posix_root is not None:
        pre_seal_owned_posix_root = validate_pre_seal_owned_posix_root(pre_seal_owned_posix_root)
    binding = manifest.get("dependencyAuditValidator", {})
    if binding.get("path") != "private_runtime_manifest.cjs":
        reject()
    row = index.get(binding["path"], {})
    if row.get("kind") != "file" or row.get("sha256") != binding.get("sha256"):
        reject()
    node = manifest.get("node", {})
    executable = root / relative(node.get("executable"))
    if not contained(root, executable) or index.get(node["executable"], {}).get("kind") != "file":
        reject()
    import signal
    import subprocess
    import threading
    import time
    deadline = time.monotonic() + AUDIT_DEADLINE_SECONDS
    working_deadline = deadline - min(2, AUDIT_DEADLINE_SECONDS / 4)
    # Explicit OS plumbing only. No NODE_OPTIONS, NODE_PATH, proxy or credential inheritance.
    environment = {key: os.environ[key] for key in ("SystemRoot", "WINDIR", "TEMP", "TMP") if key in os.environ}
    environment.update({"HOME": str(root), "USERPROFILE": str(root), "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"})
    payload = json.dumps({"root": str(root), "manifest": manifest, "generatorSha256": generator_sha256}, allow_nan=False).encode("utf-8")
    if len(payload) > MAX_JSON:
        reject()
    process = subprocess.Popen([str(executable), "--no-addons", "-e", AUDIT_NODE_SCRIPT], shell=False,
                               cwd=str(root), env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=os.name != "nt" and pre_seal_owned_posix_root is None,
                               creationflags=0x08000000 if os.name == "nt" else 0)
    close_job, workers, outputs = None, [], [bytearray(), bytearray()]
    overflow, io_failed, lock = threading.Event(), threading.Event(), threading.Lock()
    try:
        if os.name == "nt":
            close_job = windows_job(process)
        elif pre_seal_owned_posix_root is not None:
            validate_pre_seal_owned_posix_root(pre_seal_owned_posix_root)
            if (os.getpgid(process.pid) != pre_seal_owned_posix_root
                    or os.getsid(process.pid) != pre_seal_owned_posix_root):
                reject()
        def drain(stream, output):
            try:
                while True:
                    chunk = stream.read(1024)
                    if not chunk:
                        break
                    with lock:
                        if len(outputs[0]) + len(outputs[1]) + len(chunk) > 8192:
                            overflow.set()
                            break
                        output.extend(chunk)
            except BaseException:
                io_failed.set()
            finally:
                try:
                    stream.close()
                except BaseException:
                    io_failed.set()
        def write():
            try:
                process.stdin.write(payload)
                process.stdin.flush()
            except BaseException:
                io_failed.set()
            finally:
                try:
                    process.stdin.close()
                except BaseException:
                    io_failed.set()
        for stream, output in zip((process.stdout, process.stderr), outputs):
            workers.append(threading.Thread(target=drain, args=(stream, output), daemon=True))
        workers.append(threading.Thread(target=write, daemon=True))
        for worker in workers:
            worker.start()
        while process.poll() is None:
            if overflow.is_set() or io_failed.is_set() or time.monotonic() >= working_deadline:
                raise RuntimeError("PRIVATE_RUNTIME_INVALID")
            time.sleep(0.01)
        for worker in workers:
            worker.join(max(0, working_deadline - time.monotonic()))
        if any(worker.is_alive() for worker in workers) or overflow.is_set() or io_failed.is_set() or process.returncode != 0 or outputs[1]:
            raise RuntimeError("PRIVATE_RUNTIME_INVALID")
        reports = json.loads(outputs[0].decode("utf-8"))["reports"]
        if [row.get("provider") for row in reports] != list(PROVIDERS):
            reject()
        return reports
    finally:
        if close_job:
            close_job()
        elif os.name != "nt" and pre_seal_owned_posix_root is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        elif process.poll() is None:
            process.kill()
        process.wait(timeout=max(0, deadline - time.monotonic()))
        for worker in workers:
            worker.join(max(0, deadline - time.monotonic()))
        if any(worker.is_alive() for worker in workers):
            reject()
        # On Job assignment failure no thread has touched a pipe; after successful
        # joins no pipe lock is held. Child is reaped before disposing these objects.
        for stream in (process.stdin, process.stdout, process.stderr):
            try:
                if not stream.closed:
                    stream.close()
            except BaseException:
                io_failed.set()
        if io_failed.is_set():
            raise RuntimeError("PRIVATE_RUNTIME_INVALID")


def isolated_fixture_main(arguments):
    """Explicit local fixture gate. Never accepts a complete or releasable manifest."""
    if (len(arguments) != 3 or sys.version_info[:2] != (3, 13) or not sys.flags.isolated
            or sys.flags.utf8_mode != 1 or not sys.flags.no_site or not sys.flags.dont_write_bytecode):
        reject()
    manifest_path, provider, expected = pathlib.Path(arguments[0]), arguments[1], arguments[2]
    if provider not in PROVIDERS or manifest_path.is_symlink() or manifest_path.stat().st_size > MAX_JSON:
        reject()
    raw = manifest_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        reject()
    manifest = json.loads(raw)
    if (manifest.get("kind") != FIXTURE_KIND or manifest.get("schemaVersion") != 1
            or manifest.get("releaseEligible") is not False or "complete" in manifest):
        reject()
    root_input = pathlib.Path(manifest.get("treeRoot", ""))
    if not root_input.is_absolute() or root_input.is_symlink():
        reject()
    root = root_input.resolve(strict=True)
    source_root = pathlib.Path(__file__).resolve().parents[2]
    source_bindings = (
        (pathlib.Path(__file__), manifest.get("bootstrapSourceSha256")),
        (source_root / "electron/shared/privatePythonRuntimeManifest.cjs", manifest.get("dependencyAuditValidator", {}).get("sha256")),
        (source_root / "resources/python-runtime/miniracer_unicode_adapter.py", manifest.get("miniRacerAdapter", {}).get("sha256")),
        (source_root / "scripts/prepare-private-python-runtime.py", manifest.get("dependencyAuditGeneratorSha256")),
    )
    for filename, expected_sha in source_bindings:
        if filename.is_symlink() or hashlib.sha256(filename.read_bytes()).hexdigest() != expected_sha:
            reject()
    python_root = (root / "python").resolve(strict=True)
    if pathlib.Path(sys.executable).resolve(strict=True) != (root / relative(manifest["python"]["executable"])).resolve(strict=True):
        reject()
    for entry in sys.path:
        if entry and not pathlib.Path(entry).resolve(strict=False).is_relative_to(python_root):
            reject()
    site = root / "providers" / provider / "site"
    if (manifest["providers"][provider]["site"] != "providers/" + provider + "/site"
            or not site.is_dir() or site.is_symlink() or not contained(root, site)):
        reject()
    index = check_inventory(root, manifest, manifest_path)
    reports = check_dependency_audits(root, manifest, index, manifest["dependencyAuditGeneratorSha256"])
    binding = manifest.get("miniRacerAdapter", {})
    if binding.get("path") != "miniracer_unicode_adapter.py" or index.get(binding["path"], {}).get("sha256") != binding.get("sha256"):
        reject()
    cache = pathlib.Path(manifest.get("fixtureCacheRoot", ""))
    if not cache.is_absolute() or ".." in cache.parts or contained(root, cache) or cache == root:
        reject()
    # Each provider uses a distinct caller-owned isolated cache, never the packaged site.
    provider_cache = cache / provider
    provider_cache.mkdir(parents=True, exist_ok=True)
    os.environ["HOME"] = str(provider_cache)
    os.environ["USERPROFILE"] = str(provider_cache)
    if provider == "mootdx":
        os.environ["RT_MOOTDX_CACHE_ROOT"] = str(provider_cache)
    adapter_path = root / binding["path"]
    namespace = {"__name__": "rt_private_miniracer_adapter", "__file__": str(adapter_path)}
    exec(compile(adapter_path.read_bytes(), str(adapter_path), "exec"), namespace)
    sys.path.insert(0, str(site))
    try:
        native = namespace["prepare_site"](provider, site, root, index, manifest["providers"][provider]["wheels"], manifest.get("node"),
                                           windows_job_factory=windows_job if sys.platform == "win32" else None)
        import importlib
        module = importlib.import_module(provider)
        if provider == "mootdx":
            importlib.import_module("mootdx.quotes")
            importlib.import_module("mootdx.reader")
        response = json.dumps({"kind": FIXTURE_KIND, "releaseEligible": False, "provider": provider,
                          "imported": module.__name__, "dependencyAudits": reports, "miniRacer": native,
                          "workerPid": os.getpid()}, ensure_ascii=False, allow_nan=False)
    finally:
        namespace["close_provider_engines"]()
    print(response)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--isolated-test-fixture":
        isolated_fixture_main(sys.argv[2:])
        return
    if sys.version_info[:2] != (3, 13) or not sys.flags.isolated or sys.flags.utf8_mode != 1 or not sys.flags.no_site or not sys.flags.dont_write_bytecode:
        reject()
    owned_posix_root = None
    if len(sys.argv) == 6 and sys.argv[4] == "--pre-seal-owned-posix-root":
        owned_posix_root = validate_pre_seal_owned_posix_root(sys.argv[5])
    elif len(sys.argv) != 4:
        reject()
    manifest_path = pathlib.Path(sys.argv[1])
    provider = sys.argv[2]
    if provider not in ("akshare", "mootdx", "pywencai") or manifest_path.is_symlink():
        reject()
    raw = manifest_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != sys.argv[3]:
        reject()
    manifest = json.loads(raw)
    root = manifest_path.parent.resolve(strict=True)
    if manifest.get("complete") is not True or manifest.get("schemaVersion") != 1 or manifest.get("kind") != "rt-private-python-runtime":
        reject()
    site = root / "providers" / provider / "site"
    if manifest["providers"][provider]["site"] != "providers/" + provider + "/site" or not site.is_dir() or not contained(root, site):
        reject()
    # -I -S removes user/system site initialization. Explicitly retain PBS stdlib only.
    for entry in sys.path:
        if entry and (not contained(root, pathlib.Path(entry)) or not pathlib.Path(entry).resolve(strict=False).is_relative_to((root / "python").resolve(strict=True))):
            reject()
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    sys.dont_write_bytecode = True
    if pathlib.Path(sys.executable).resolve(strict=True) != (root / relative(manifest["python"]["executable"])).resolve(strict=True):
        reject()
    index = check_inventory(root, manifest, manifest_path)
    if owned_posix_root is None:
        check_dependency_audits(root, manifest, index)
    else:
        check_dependency_audits(root, manifest, index, pre_seal_owned_posix_root=owned_posix_root)
    message = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(message) > 1024 * 1024:
        reject()
    envelope = json.loads(message.decode("utf-8"))
    script, request = envelope.get("script"), envelope.get("request")
    if not isinstance(script, str) or len(script) > 65536 or "\x00" in script or not isinstance(request, dict):
        reject()
    operation = request.get("operation")
    operations = {
        "akshare": ("status", "akshare-daily", "akshare-limit-pool", "akshare-reports"),
        "mootdx": ("status", "tdx-daily"),
        "pywencai": ("status", "iwencai"),
    }
    if operation not in operations[provider]:
        reject()
    if provider == "mootdx":
        cache = os.environ.get("RT_MOOTDX_CACHE_ROOT", "")
        if not os.path.isabs(cache) or ".." in pathlib.Path(cache).parts or cache != os.environ.get("HOME"):
            reject()
    adapter = manifest.get("miniRacerAdapter", {})
    if adapter.get("path") != "miniracer_unicode_adapter.py":
        reject()
    adapter_path = root / adapter["path"]
    if adapter_path.is_symlink() or not contained(root, adapter_path):
        reject()
    adapter_source = adapter_path.read_bytes()
    if hashlib.sha256(adapter_source).hexdigest() != adapter.get("sha256"):
        reject()
    namespace = {"__name__": "rt_private_miniracer_adapter", "__file__": str(adapter_path)}
    exec(compile(adapter_source, str(adapter_path), "exec"), namespace)
    # The adapter's own imports run on stdlib-only paths. Its complete inventory
    # and site verification precedes selection of the sole provider import path.
    # Serial initialization happens before any provider import or provider thread.
    previous_stdout = sys.stdout
    pending_stdout = io.StringIO()
    sys.stdout = pending_stdout
    try:
        namespace["prepare_miniracer"](manifest_path, provider, sys.argv[3],
                                        pre_seal_owned_posix_root=owned_posix_root,
                                        windows_job_factory=windows_job if sys.platform == "win32" else None)
        if provider == "pywencai":
            safe_adapter_path = root / "providers/pywencai/pywencai_adapter.py"
            if safe_adapter_path.is_symlink() or not contained(root, safe_adapter_path):
                reject()
            safe_adapter_source = safe_adapter_path.read_bytes()
            safe_adapter_row = next((row for row in manifest["files"] if row["path"] == "providers/pywencai/pywencai_adapter.py"), None)
            safe_adapter_sha256 = safe_adapter_row.get("sha256") if safe_adapter_row else None
            if safe_adapter_row is None or safe_adapter_row.get("kind") != "file" or hashlib.sha256(safe_adapter_source).hexdigest() != safe_adapter_sha256 or safe_adapter_row.get("sha256") != safe_adapter_sha256:
                reject()
            safe_adapter = {"__name__": "rt_private_pywencai_adapter", "__file__": str(safe_adapter_path)}
            exec(compile(safe_adapter_source, str(safe_adapter_path), "exec"), safe_adapter)
            if owned_posix_root is None:
                safe_adapter["install"](manifest, root, site)
            else:
                safe_adapter["install"](manifest, root, site, pre_seal_owned_posix_root=owned_posix_root)
            script = safe_adapter["rewrite_trusted_bridge"](script)
        sys.stdin = io.StringIO(json.dumps(request, ensure_ascii=False, allow_nan=False))
        # This source is supplied only by the main-process bridge, never by an IPC caller.
        try:
            exec(compile(script, "<trusted-data-source-bridge>", "exec"), {"__name__": "__main__"})
        except SystemExit as exit_error:
            if exit_error.code not in (None, 0):
                raise
    finally:
        try:
            namespace["close_provider_engines"]()
        finally:
            sys.stdout = previous_stdout
    # Success is published only after every owned JS context and pipe has exited.
    previous_stdout.write(pending_stdout.getvalue())


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except BaseException:
        reject()
