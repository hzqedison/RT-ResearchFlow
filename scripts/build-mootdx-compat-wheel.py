"""Build an explicit, reproducible mootdx compatibility wheel, without network I/O.

The upstream wheel is never modified. This derived distribution is NOT evidence
of provider reachability or native compatibility; those require installed tests.
"""

import argparse
import base64
import csv
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile
import zipfile


UPSTREAM_VERSION = "0.11.7"
DERIVED_VERSION = "0.11.7+rt.node.1"
NODE_BACKEND_VERSION = "1.0.0"
UPSTREAM_SHA256 = "eab475f1d08b1c71ea51212c8b1b1038c4739798f7d95ad1a6fb7bb26e348ef2"
UPSTREAM_URL = (
    "https://files.pythonhosted.org/packages/bd/7c/"
    "dff7de8e9d29d49a22ffcb03f765cf829be5097019a760319d908009da54/"
    "mootdx-0.11.7-py3-none-any.whl"
)
UPSTREAM_DIST = "mootdx-0.11.7.dist-info"
DERIVED_DIST = "mootdx-0.11.7+rt.node.1.dist-info"
WHEEL_NAME = "mootdx-0.11.7+rt.node.1-py3-none-any.whl"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def record_digest(data):
    return "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode("ascii").rstrip("=")


def verify_record(files, dist):
    record_name = dist + "/RECORD"
    if record_name not in files:
        raise ValueError("Wheel RECORD is missing")
    seen = set()
    for row in csv.reader(io.StringIO(files[record_name].decode("utf-8"))):
        if len(row) != 3 or row[0] in seen or row[0] not in files:
            raise ValueError("Invalid, duplicate or unknown RECORD entry")
        name, checksum, size = row
        seen.add(name)
        if name == record_name:
            if checksum or size:
                raise ValueError("RECORD must not hash itself")
        elif checksum != record_digest(files[name]) or size != str(len(files[name])):
            raise ValueError("Wheel RECORD mismatch: " + name)
    if seen != set(files):
        raise ValueError("Wheel RECORD does not cover every file")


def read_upstream(path):
    raw = Path(path).read_bytes()
    if digest(raw) != UPSTREAM_SHA256:
        raise ValueError("The input is not the pinned upstream mootdx wheel")
    files = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for entry in archive.infolist():
            name = entry.filename
            parts = PurePosixPath(name).parts
            mode = entry.external_attr >> 16
            if (name in files or name.startswith("/") or "\\" in name or ":" in name
                    or ".." in parts or stat.S_ISLNK(mode) or entry.is_dir()
                    or not (name.startswith("mootdx/") or name.startswith(UPSTREAM_DIST + "/"))):
                raise ValueError("Unexpected upstream wheel entry: " + name)
            files[name] = archive.read(entry)
    verify_record(files, UPSTREAM_DIST)
    return files


def replace_once(value, old, new, label):
    if value.count(old) != 1:
        raise ValueError("The pinned patch precondition failed: " + label)
    return value.replace(old, new, 1)


def derive_files(upstream):
    files = {
        name.replace(UPSTREAM_DIST + "/", DERIVED_DIST + "/", 1): data
        for name, data in upstream.items()
        if name != UPSTREAM_DIST + "/RECORD"
    }
    metadata_name = DERIVED_DIST + "/METADATA"
    metadata = files[metadata_name].decode("utf-8")
    metadata = replace_once(metadata, "Version: 0.11.7\n", "Version: " + DERIVED_VERSION + "\n", "version")
    metadata = replace_once(
        metadata,
        "Requires-Dist: py-mini-racer (>=0.6.0,<0.7.0)\n",
        "Requires-Dist: rt-private-node-js-runtime (==" + NODE_BACKEND_VERSION + ")\n",
        "V8 dependency",
    )
    files[metadata_name] = metadata.encode("utf-8")

    init_name = "mootdx/__init__.py"
    init = replace_once(files[init_name].decode("utf-8"),
                        "__version__ = '0.11.7'", "__version__ = '" + DERIVED_VERSION + "'", "module version")
    files[init_name] = init.encode("utf-8")

    holiday_name = "mootdx/utils/holiday.py"
    holiday = files[holiday_name].decode("utf-8")
    holiday = replace_once(holiday, "from py_mini_racer import py_mini_racer", "from rt_private_node_js_runtime import MiniRacer", "modern V8 import")
    holiday = replace_once(holiday, "httpx.Client(verify=False)", "httpx.Client(verify=True, timeout=10.0)", "verified HTTPS")
    holiday = replace_once(holiday, "        js_code = py_mini_racer.MiniRacer()\n        js_code.eval(JS_DECODE)",
                           "        with MiniRacer() as js_code:\n            js_code.eval(JS_DECODE + '\\n;void 0;')", "V8 lifetime")
    holiday = replace_once(holiday, "        dict_list = js_code.call(", "            dict_list = js_code.call(", "V8 call")
    lines = holiday.splitlines(keepends=True)
    warning_count = error_count = 0
    for index, line in enumerate(lines):
        if line.startswith("        logging.warning("):
            lines[index] = "        logging.warning('rt-private-node-js-runtime==1.0.0 is missing from the provider runtime')\n"
            warning_count += 1
        elif line.startswith("        raise MootdxModuleNotFoundError("):
            lines[index] = "        raise MootdxModuleNotFoundError('The required private Node provider runtime is unavailable')\n"
            error_count += 1
    if warning_count != 1 or error_count != 1:
        raise ValueError("The pinned V8 error-message precondition failed")
    holiday = "".join(lines)
    compile(holiday, holiday_name, "exec")
    files[holiday_name] = holiday.encode("utf-8")

    utils_name = "mootdx/utils/__init__.py"
    utils = files[utils_name].decode("utf-8")
    utils = replace_once(utils, "import hashlib\n", "import hashlib\nimport os\n", "cache environment import")
    utils = replace_once(
        utils, "    filename = Path.home() / '.mootdx' / config\n",
        "    cache_root = os.environ.get('RT_MOOTDX_CACHE_ROOT')\n"
        "    root = Path(cache_root) if cache_root else Path.home() / '.mootdx'\n"
        "    relative = Path(config)\n"
        "    if not root.is_absolute() or relative.is_absolute() or relative.drive or '..' in relative.parts:\n"
        "        raise ValueError('mootdx cache paths must stay under an absolute cache root')\n"
        "    filename = root / relative\n",
        "private writable cache root",
    )
    compile(utils, utils_name, "exec")
    files[utils_name] = utils.encode("utf-8")

    provenance = {
        "schemaVersion": 1,
        "name": "mootdx",
        "version": DERIVED_VERSION,
        "upstream": {"version": UPSTREAM_VERSION, "url": UPSTREAM_URL, "sha256": UPSTREAM_SHA256},
        "replacementDependency": {"name": "rt-private-node-js-runtime", "version": NODE_BACKEND_VERSION},
        "changes": ["explicit derived distribution identity", "explicit private Node API and closed contexts",
                    "verified bounded holiday HTTPS", "explicit private cache root with traversal rejection"],
        "upstreamLicenseSha256": digest(upstream[UPSTREAM_DIST + "/LICENSE"]),
        "limits": ["native compatibility requires real target-architecture tests",
                   "offline tests do not prove data-source reachability",
                   "upstream notices and metadata description are retained unchanged"],
    }
    files[DERIVED_DIST + "/RT-COMPATIBILITY.json"] = (json.dumps(provenance, sort_keys=True, indent=2) + "\n").encode("utf-8")
    record_name = DERIVED_DIST + "/RECORD"
    record = io.StringIO(newline="")
    writer = csv.writer(record, lineterminator="\n")
    for name in sorted(files):
        writer.writerow([name, record_digest(files[name]), len(files[name])])
    writer.writerow([record_name, "", ""])
    files[record_name] = record.getvalue().encode("utf-8")
    verify_record(files, DERIVED_DIST)
    return files


def wheel_bytes(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name in sorted(files):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(entry, files[name])
    return output.getvalue()


def build(upstream_path, output_directory):
    raw = wheel_bytes(derive_files(read_upstream(upstream_path)))
    output_directory = Path(output_directory).resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    target = output_directory / WHEEL_NAME
    if target.exists():
        if target.read_bytes() != raw:
            raise FileExistsError("Refusing to replace a conflicting derived wheel")
    else:
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=output_directory, prefix=WHEEL_NAME + ".", suffix=".partial", delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(raw)
            os.replace(temporary, target)
        finally:
            if temporary is not None and temporary.exists() and temporary.resolve().parent == output_directory:
                temporary.unlink()
    return {"path": str(target), "name": "mootdx", "version": DERIVED_VERSION, "sha256": digest(raw), "bytes": len(raw)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream-wheel", required=True)
    parser.add_argument("--output-directory", required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.upstream_wheel, args.output_directory), sort_keys=True))


if __name__ == "__main__":
    main()
