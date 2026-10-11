"""Read-only native feasibility probe, not a production bootstrap or fix."""

import argparse
import faulthandler
import importlib
import json
import os
from pathlib import Path
import socket
import sys
from unittest.mock import patch


def deny_network(*args, **kwargs):
    raise RuntimeError("Network is forbidden in this isolated native probe")


def probe(provider_directory):
    faulthandler.enable(file=sys.stderr, all_threads=True)
    if sys.platform != "win32" or not sys.flags.isolated or not sys.flags.no_site:
        raise RuntimeError("Use isolated Windows Python with -I -S -B")
    provider = Path(provider_directory).resolve(strict=True)
    if str(provider).isascii():
        raise RuntimeError("This probe must exercise a real non-ASCII resource path")
    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.socket.sendto = deny_network
    socket.create_connection = deny_network
    socket.getaddrinfo = deny_network
    sys.path.insert(0, str(provider))
    dll = importlib.import_module("py_mini_racer._dll")
    mini_racer = importlib.import_module("py_mini_racer").MiniRacer
    resources = Path(dll.__file__).resolve(strict=True).parent
    if not resources.is_relative_to(provider):
        raise RuntimeError("Native dependencies escaped the explicit provider tree")
    original_open = dll._open_resource_file
    original_cwd = Path.cwd()
    observed = []

    def relative_data_resource(filename, exit_stack):
        resolved = Path(original_open(filename, exit_stack)).resolve(strict=True)
        if resolved.parent != resources:
            raise RuntimeError("A native resource escaped its package directory")
        observed.append(filename)
        if filename in ("icudtl.dat", "snapshot_blob.bin"):
            if Path.cwd() != resources:
                raise RuntimeError("Native initialization lost its explicit resource directory")
            return filename
        return str(resolved)

    try:
        os.chdir(resources)
        with patch.object(dll, "_open_resource_file", relative_data_resource):
            print("Probe: initialize real V8 under Unicode directory", file=sys.stderr, flush=True)
            with mini_racer() as engine:
                if engine.eval("21 * 2") != 42 or engine.eval("'\\u4e2d\\u6587'") != "\u4e2d\u6587":
                    raise RuntimeError("Native initialization or Unicode evaluation failed")
    finally:
        os.chdir(original_cwd)

    print("Probe: create a second real context after restoring cwd", file=sys.stderr, flush=True)
    with mini_racer() as engine:
        if engine.eval("6 * 7") != 42:
            raise RuntimeError("Subsequent native contexts cannot run after cwd restoration")
    if Path.cwd() != original_cwd or set(observed) != {"mini_racer.dll", "icudtl.dat", "snapshot_blob.bin"}:
        raise RuntimeError("Native resource or cwd invariants failed")
    return {"mode": "native-resource-path-feasibility-only", "realUnicodeResourceDirectory": True,
            "realV8Contexts": 2, "cwdRestored": True, "dependencyFilesModified": False,
            "pythonSocketGuard": True, "productionBootstrapImplemented": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider-directory", required=True)
    arguments = parser.parse_args()
    print(json.dumps(probe(arguments.provider_directory), sort_keys=True))
