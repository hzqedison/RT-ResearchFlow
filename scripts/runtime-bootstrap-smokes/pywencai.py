"""Observe the real private Node used by the bootstrap-installed token adapter.

Tracking is confined to this dedicated smoke, preserving Popen's class API and
forwarding its actual arguments unchanged. No token or query is emitted.
"""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time


def offline(event, _args):
    if event.startswith("socket.") or event in ("os.system", "os.posix_spawn"):
        raise RuntimeError("OFFLINE_SMOKE_ONLY")


sys.addaudithook(offline)
import pywencai
import pywencai.headers as headers
import pandas as pd

controller = getattr(headers.get_token, "__self__", None)
if (controller is None or controller.token.__func__.__globals__.get("ADAPTER_PATH")
        != "providers/pywencai/pywencai_adapter.py"):
    raise RuntimeError("PRIVATE_ADAPTER_REQUIRED")
owned_root = getattr(controller, "pre_seal_owned_posix_root", None)
if len(sys.argv) == 6 and sys.argv[4] == "--pre-seal-owned-posix-root":
    value = sys.argv[5]
    if (not value.isascii() or not value.isdecimal() or value.startswith("0") or len(value) > 10
            or owned_root != int(value)):
        raise RuntimeError("OWNED_GROUP_INVALID")
if owned_root is not None:
    controller.token.__func__.__globals__["validate_pre_seal_owned_posix_root"](owned_root)
original = subprocess.Popen
observations = []
children = []


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


class ObservedPopen(original):
    def __init__(self, *args, **kwargs):
        command = args[0] if args else kwargs.get("args")
        if (command != [str(controller.node), "--", str(controller.package / "hexin-v.bundle.js")]
                or kwargs.get("shell") is not False or not Path(command[0]).is_absolute()):
            raise RuntimeError("PRIVATE_NODE_COMMAND_REQUIRED")
        started = stamp()
        super().__init__(*args, **kwargs)
        children.append(self)
        self.record = {"pid": self.pid, "role": "private-node", "startedAt": started}
        observations.append(self.record)
        expected_group = self.pid if owned_root is None else owned_root
        if os.name != "nt" and (os.getpgid(self.pid) != expected_group or os.getsid(self.pid) != expected_group):
            self.kill()
            self.wait(timeout=2)
            raise RuntimeError("PRIVATE_NODE_GROUP_REQUIRED")
        if owned_root is not None:
            self.record.update(ownedPosixRoot=owned_root, inheritedGroupMembershipObserved=True)

    def observe(self, code):
        if code is not None and "exitedAt" not in self.record:
            self.record.update(exitedAt=stamp(), exitObserved=True, exitCode=code)
        return code

    def poll(self):
        return self.observe(super().poll())

    def wait(self, *args, **kwargs):
        return self.observe(super().wait(*args, **kwargs))


try:
    subprocess.Popen = ObservedPopen
    token = headers.get_token()
finally:
    subprocess.Popen = original
if not isinstance(token, str) or re.fullmatch(r"[A-Za-z0-9_-]{16,512}", token) is None or len(children) != 1:
    raise RuntimeError("PRIVATE_NODE_TOKEN_FAILED")
child = children[0]
code = child.wait(timeout=2)
if code != 0:
    raise RuntimeError("PRIVATE_NODE_TOKEN_FAILED")
if os.name != "nt" and owned_root is None:
    deadline = time.monotonic() + 2
    while True:
        try:
            os.killpg(child.pid, 0)
        except ProcessLookupError:
            child.record["ownedGroupEmpty"] = True
            break
        if time.monotonic() >= deadline:
            raise RuntimeError("PRIVATE_NODE_GROUP_NOT_EMPTY")
        time.sleep(0.01)
if owned_root is not None:
    controller.token.__func__.__globals__["validate_pre_seal_owned_posix_root"](owned_root)
frame = pd.DataFrame({"code": ["600000", "000001"], "close": [10.0, 12.0]})
ready = callable(pywencai.get) and callable(headers.get_token)
if len(frame) != 2 or frame["close"].sum() != 22 or not ready:
    raise RuntimeError("OFFLINE_SMOKE_FAILED")
print(json.dumps({"kind": "rt-private-runtime-offline-smoke-v1", "provider": "pywencai",
                  "workerPid": os.getpid(), "status": "passed", "dataframeRows": len(frame),
                  "providerApiReady": ready, "ownedProcesses": observations,
                  "privateNodeCheck": {"kind": "pywencai-token-computation-v1", "status": "passed",
                                       "pid": child.pid, "exitCode": code}}, allow_nan=False))
