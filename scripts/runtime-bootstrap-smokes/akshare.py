"""Pinned offline import, local dataframe and provider API readiness smoke."""
import json
import os
import sys


def check_staging_group():
    if len(sys.argv) == 6 and sys.argv[4] == "--pre-seal-owned-posix-root":
        value = sys.argv[5]
        if not value.isascii() or not value.isdecimal() or value.startswith("0") or len(value) > 10:
            raise RuntimeError("OWNED_GROUP_INVALID")
        root = int(value)
        if (os.name != "posix" or not 1 < root <= 2147483647 or os.getpgrp() != root
                or os.getsid(0) != root or os.getpgid(root) != root or os.getsid(root) != root):
            raise RuntimeError("OWNED_GROUP_INVALID")


check_staging_group()


def offline(event, _args):
    if event.startswith("socket.") or event in ("subprocess.Popen", "os.system", "os.posix_spawn"):
        raise RuntimeError("OFFLINE_SMOKE_ONLY")


sys.addaudithook(offline)
import akshare
import pandas as pd

frame = pd.DataFrame({"code": ["600000", "000001"], "close": [10.0, 12.0]})
ready = all(callable(getattr(akshare, name, None)) for name in ("stock_zh_a_hist", "stock_zt_pool_em"))
if len(frame) != 2 or frame["close"].sum() != 22 or not ready:
    raise RuntimeError("OFFLINE_SMOKE_FAILED")
print(json.dumps({"kind": "rt-private-runtime-offline-smoke-v1", "provider": "akshare",
                  "workerPid": os.getpid(), "status": "passed", "dataframeRows": len(frame),
                  "providerApiReady": ready, "ownedProcesses": []}, allow_nan=False))
