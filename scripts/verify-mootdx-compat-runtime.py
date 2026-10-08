"""Exercise real mootdx/V8 dependencies offline, never a production data source.

Run with -I -S -B. The only mock is a deterministic HTTP transport; libraries,
native V8 execution, the packaged decoder and provider functions are real.
"""

import argparse
import datetime
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import socket
import sys
import tempfile
from unittest.mock import patch


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def deny_network(*args, **kwargs):
    raise RuntimeError("Network access is forbidden in offline dependency acceptance")


def verify(provider_directory, temporary_directory, expected_architecture):
    require(sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode,
            "Invoke this verifier with -I -S -B")
    require(sys.version_info[:2] == (3, 13), "Python 3.13 is required")
    machine = platform.machine().lower()
    architecture = "x64" if machine in ("amd64", "x86_64") else "arm64" if machine in ("arm64", "aarch64") else machine
    require(architecture == expected_architecture, "The runtime architecture does not match the target")
    provider = Path(provider_directory).resolve(strict=True)
    temporary_parent = Path(temporary_directory).resolve(strict=True)
    require(provider.is_dir() and temporary_parent.is_dir(), "Explicit provider and temporary directories are required")
    require(not any("site-packages" in item or "dist-packages" in item for item in sys.path),
            "External site-packages are present before bootstrap")
    sys.path.insert(0, str(provider))

    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.socket.sendto = deny_network
    socket.create_connection = deny_network
    socket.getaddrinfo = deny_network
    require(importlib.metadata.version("mootdx") == "0.11.7+rt.1", "The explicit derived mootdx wheel is missing")
    require(importlib.metadata.version("mini-racer") == "0.12.4", "The pinned modern MiniRacer is missing")
    try:
        importlib.metadata.version("py-mini-racer")
    except importlib.metadata.PackageNotFoundError:
        pass
    else:
        raise RuntimeError("Conflicting legacy py-mini-racer must not be installed")

    with tempfile.TemporaryDirectory(prefix="rt-mootdx-offline-", dir=temporary_parent) as owned:
        owned = Path(owned).resolve()
        # These environment changes affect only this disposable verifier process.
        os.environ["HOME"] = str(owned)
        os.environ["USERPROFILE"] = str(owned)
        os.environ["RT_MOOTDX_CACHE_ROOT"] = str(owned / "provider-cache")
        modules = {}
        for name in ("mootdx", "tdxpy", "numpy", "pandas", "httpx", "tenacity", "py_mini_racer",
                     "typing_extensions", "click", "prettytable", "tqdm", "mootdx.quotes", "mootdx.reader"):
            module = importlib.import_module(name)
            location = Path(module.__file__).resolve(strict=True)
            require(location.is_relative_to(provider), "A provider dependency escaped the isolated directory: " + name)
            modules[name] = module
        require(modules["mootdx"].__version__ == "0.11.7+rt.1", "Python and wheel identities differ")
        holiday = importlib.import_module("mootdx.utils.holiday")
        require(Path(holiday.__file__).resolve().is_relative_to(provider), "Holiday code is not the real provider code")

        mini_racer = modules["py_mini_racer"].MiniRacer
        with mini_racer() as engine:
            require(engine.eval("21 * 2") == 42, "Native V8 execution failed")
            require(engine.eval("'\\u4e2d\\u6587'") == "\u4e2d\u6587", "Native V8 Unicode execution failed")
            engine.eval(holiday.JS_DECODE)
            first = engine.call("d", "LC/AAAAAA")
            second = engine.call("d", "LC/BAABAA")
            require(first == ["1990-12-19T00:00:00.000Z"], "The real packaged calendar decoder returned an unexpected fixture")
            require(second == ["1990-12-20T00:00:00.000Z"], "The real decoder failed the second distinct fixture")

        httpx = modules["httpx"]
        original_client = httpx.Client
        requests = []
        clients = []

        def response(request):
            require(str(request.url) == "https://finance.sina.com.cn/realstock/company/klc_td_sh.txt",
                    "The provider attempted an unexpected offline endpoint")
            requests.append(str(request.url))
            return httpx.Response(200, text='var dat="LC/AAAAAA";')

        def controlled_client(*args, **kwargs):
            require(kwargs.get("verify") is True and kwargs.get("timeout") == 10.0,
                    "The provider did not request bounded, verified HTTPS")
            client = original_client(*args, transport=httpx.MockTransport(response), **kwargs)
            clients.append(client)
            return client

        try:
            with patch.object(holiday.httpx, "Client", controlled_client):
                frame = holiday.holidays()
        finally:
            for client in clients:
                client.close()
        require(requests == ["https://finance.sina.com.cn/realstock/company/klc_td_sh.txt"],
                "The real provider did not execute exactly one controlled request")
        require(frame["date"].tolist() == [datetime.date(1990, 12, 19), datetime.date(1992, 5, 4)],
                "The real provider calendar function did not decode the controlled fixture")
        cache = Path(os.environ["RT_MOOTDX_CACHE_ROOT"]).resolve()
        require(cache.is_relative_to(owned) and (cache / "caches" / "holidays.plk").is_file(),
                "The provider did not keep its actual cache inside the disposable writable root")
        utils = importlib.import_module("mootdx.utils")
        for bad in ("../outside.json", str(owned / "absolute.json")):
            try:
                utils.get_config_path(bad)
            except ValueError:
                pass
            else:
                raise RuntimeError("The provider accepted an escaping cache path")
        data = utils.to_data([{"datetime": "2026-01-05 15:00", "open": 10.0, "high": 11.0,
                               "low": 9.0, "close": 10.5, "vol": 0}])
        require(len(data) == 1 and data.iloc[0]["volume"] == 0 and data.iloc[0]["close"] == 10.5,
                "The real provider/pandas conversion lost legitimate zero volume or price")

        return {
            "schemaVersion": 1,
            "mode": "offline-dependency-acceptance",
            "platform": sys.platform,
            "architecture": architecture,
            "pythonVersion": platform.python_version(),
            "mootdxVersion": importlib.metadata.version("mootdx"),
            "miniRacerVersion": importlib.metadata.version("mini-racer"),
            "decoderSha256": hashlib.sha256(holiday.JS_DECODE.encode("utf-8")).hexdigest(),
            "checks": {"realProviderImports": True, "nativeV8AndUnicode": True,
                       "realDecoderDistinctFixtures": True, "realProviderControlledHTTP": True,
                       "privateCacheAndTraversalRejection": True, "realPandasZeroVolume": True},
            "networkAccess": "denied",
            "providerReachable": None,
            "installedApplicationTested": False,
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider-directory", required=True)
    parser.add_argument("--temporary-directory", required=True)
    parser.add_argument("--expected-architecture", choices=("x64", "arm64"), required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.provider_directory, args.temporary_directory, args.expected_architecture), sort_keys=True))
