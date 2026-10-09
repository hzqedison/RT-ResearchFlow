"""Pinned offline AKShare Node-backend derivative; no setup.py or network.
Original source, data and license retained; only audited engine imports,
unused eval completion, version and engine Requires-Dist are changed.
No upstream MiniRacer full-API or product-installation approval is asserted.
"""
import argparse
import ast
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

UPSTREAM_VERSION = "1.19.1"
DERIVED_VERSION = "1.19.1+rt.node.1"
UPSTREAM_SHA256 = "8ab82d4a468d2c384df02de470df3a44e8b899fd8cfe116bceff52dd7b804df9"
UPSTREAM_DIST = "akshare-1.19.1.dist-info"
DERIVED_DIST = "akshare-1.19.1+rt.node.1.dist-info"
WHEEL_NAME = "akshare-1.19.1+rt.node.1-py3-none-any.whl"
AUDITED_SOURCES = {
  "akshare/air/air_zhenqi.py": "ca8d186d3fd0a3e81bbaadeeb8f4f5d84eb8378571cca624a93d5e75761fd21c",
  "akshare/bond/bond_issue_cninfo.py": "b4fa19845fbfb085fdced08a0742b4f99e0a77d6fedfcf5b3f7fc27452bb59bd",
  "akshare/bond/bond_zh_cov.py": "50eb660ca3d4136f739d7badcd9d44b1c85a9aa42c2658cd261fd4ce31726d39",
  "akshare/bond/bond_zh_sina.py": "4c43432a908963b0e161aa55894eb3c6f2b8261101fb3eead6f0216636c6d534",
  "akshare/fund/fund_em.py": "83ecb3e3677752af75a271636ef85d643ee2945581fa62649e061fded27ffc23",
  "akshare/fund/fund_etf_sina.py": "796a35b1fec179533dffc4a4b9a7b94c5564d8e02aa2e7504fcead1d4735c97b",
  "akshare/fund/fund_report_cninfo.py": "cc52df04e98e856cca74246347c5823f1b6f18cd2f9f7a0b7376b880812344b0",
  "akshare/futures/futures_zh_sina.py": "9aee5f73cc9367a4574a6ebfde0eab9e6ca1cf65d62ad79042281e0271228211",
  "akshare/index/index_stock_hk.py": "468c46b7ccc7d244138a777e31166ecf3f57adb7ba2d88260069662b3733c5d6",
  "akshare/index/index_stock_us_sina.py": "2313a4e06e3da1ab2fec47c441e9cbf7e18bb9e97252eb3a73824fc9195a3b36",
  "akshare/index/index_stock_zh.py": "fc217076e71ce6a4a70f8344de0f4c0332b4b4cfa77a71e2ca3bc8a428e39d0a",
  "akshare/movie/artist_yien.py": "8582d26f57bd128c1e9b6be3db8f312a5a2a47290805b21bdd974db6d9b0d821",
  "akshare/movie/movie_yien.py": "9f7357b4b2c36c5b1adc15422c5aa521d89c31557e5c2407a92e3634454d8f35",
  "akshare/movie/video_yien.py": "d89b32293c223f8453b83373411e9df55f5fccc9c1c87d804c917376d3f25d24",
  "akshare/stock/stock_allotment_cninfo.py": "3958d5756a765d544d6c9bd582d8155680663c1260041e11c8822003ff501ccf",
  "akshare/stock/stock_cg_equity_mortgage.py": "3ee8b969628a3f01ae2a317f18da5e8c3cec30634faf189a26f88bcf7c767bd2",
  "akshare/stock/stock_cg_guarantee.py": "b6ceea710861c8dd4f1c1ed0e1794c9f7f0785f56fb9b3af932f5165f9943fde",
  "akshare/stock/stock_cg_lawsuit.py": "15d7e286db94eaa1237416f4bedcb3402e9c8a7d4248e37eb7f37add219a6b4b",
  "akshare/stock/stock_dividend_cninfo.py": "a3d548dd1296cb5c565ae9ad1a2f60a49209bcf49f3153193425cce6ad8b2914",
  "akshare/stock/stock_hk_sina.py": "e0849732de634a290ba3fe2fcebfe3b31397c6aa82b5bda76def5faa64ce4982",
  "akshare/stock/stock_hold_control_cninfo.py": "eb84df55056982079f5873397ef9839cb4af972497921fbb32952a543f40ebc5",
  "akshare/stock/stock_hold_num_cninfo.py": "5af00bc2da639de3f705b68e7710f617ee97a6511326b953886fcca7f92e1687",
  "akshare/stock/stock_industry_cninfo.py": "66d75768694b6f343627dfa52a62e1efd1e0cafd6fff7e7a2f3013d95613bed9",
  "akshare/stock/stock_industry_pe_cninfo.py": "d0e8e3b05186f74cc9459101a9a0ac8ca4a948082ba773e95f332da26fe597fb",
  "akshare/stock/stock_ipo_summary_cninfo.py": "31afb9e06b0e3a1456c6294b1fe4269b45556e925019fd9758a689f0d0528006",
  "akshare/stock/stock_new_cninfo.py": "10eb99a300cb412487c8f0305dcb8f5db424aa16f3da744166c33ba3665620b1",
  "akshare/stock/stock_profile_cninfo.py": "520507dc62b9d97976e6cdd62179459954e52b30dde901a24d38e3d25f862ac9",
  "akshare/stock/stock_rank_forecast.py": "e54d1f6b8b7386a2abc3990345a8540854ab6eb131fda46d96a66ada6a5e25a5",
  "akshare/stock/stock_share_changes_cninfo.py": "b22cb83e266062e3509f98d4520d86ec2c99ff2bee5cd8b73155031617b99e96",
  "akshare/stock/stock_us_sina.py": "22a86355fc98aaa218abef1430b85d4fa355b88ba1c6f89d98cf1b1df42f9a0c",
  "akshare/stock/stock_zh_a_sina.py": "aa60721af3f7bdec29e1e5f59ff6770b54fc919fc6867706d16d36b3a7ee07a2",
  "akshare/stock/stock_zh_b_sina.py": "bec6413dd3b37af91f56d83afc5c299f98285c673165d0c171b8bd49dcfcdb0c",
  "akshare/stock_feature/stock_a_pe_and_pb.py": "5f564ed3dfe1d5b2383b575a57d37355194a9ac039e712c98b831a072403fb40",
  "akshare/stock_feature/stock_board_concept_ths.py": "4ac27f90f6ece2ff5381edb918b7b72c0fa678df9cfc4fe70061c5dc77e2d086",
  "akshare/stock_feature/stock_board_industry_ths.py": "736d893fd3091a770b6aabc19a40311d4cf71ca34c08a7f9f11ba0f67daf9405",
  "akshare/stock_feature/stock_cyq_em.py": "7c2a65241da09580e69fb0e16a189514ffa49cf41039cfa15ce4903fa1f08713",
  "akshare/stock_feature/stock_fund_flow.py": "d9c658a6c47186f06f1094e127e5aa75284d23cd57a82ca4e9b6d2ccd368a0f0",
  "akshare/stock_feature/stock_technology_ths.py": "a5f2120d732661cb1e3ca4c6916880d95c66a2cf1a263f6488a1ae08366b826a",
  "akshare/tool/trade_date_hist.py": "a3dd36d501dd38456e723ca7165d232c48b53c4325371bc32a732c152c117ea8",
  "akshare/utils/multi_decrypt.py": "db892927eb8701961b0b4d1a578254f0a44cf29b2e94ca4e500d6b5574e7cca9"
}

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
        raise ValueError("The input is not the pinned upstream AKShare wheel")
    files = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for entry in archive.infolist():
            name = entry.filename
            parts = PurePosixPath(name).parts
            mode = entry.external_attr >> 16
            if (name in files or name.startswith("/") or "\\" in name or ":" in name
                    or ".." in parts or stat.S_ISLNK(mode) or entry.is_dir()
                    or not (name.startswith("akshare/") or name.startswith(UPSTREAM_DIST + "/"))):
                raise ValueError("Unexpected upstream wheel entry: " + name)
            files[name] = archive.read(entry)
    verify_record(files, UPSTREAM_DIST)
    return files



def replacement_spans(raw, filename):
    tree = ast.parse(raw, filename=filename)
    lines = raw.splitlines(keepends=True)
    starts = [0]
    for line in lines:
        starts.append(starts[-1] + len(line))
    def span(node):
        return starts[node.lineno - 1] + node.col_offset, starts[node.end_lineno - 1] + node.end_col_offset
    parents = {id(child): node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
    contexts = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            func = node.value.func
            if ((isinstance(func, ast.Attribute) and func.attr == "MiniRacer")
                    or (isinstance(func, ast.Name) and func.id == "MiniRacer")):
                contexts.update(item.id for item in node.targets if isinstance(item, ast.Name))
    edits, imports, unused = [], 0, 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            racer = [item for item in node.names if item.name == "py_mini_racer"]
            if racer:
                if len(node.names) != 1:
                    raise ValueError("Unexpected mixed engine import")
                replacement = "import rt_private_node_js_runtime as " + (racer[0].asname or "py_mini_racer")
                edits.append((*span(node), replacement.encode("ascii")))
                imports += 1
        elif isinstance(node, ast.ImportFrom) and node.module == "py_mini_racer":
            if len(node.names) != 1 or node.names[0].name != "MiniRacer":
                raise ValueError("Unexpected engine API import")
            replacement = "from rt_private_node_js_runtime import MiniRacer"
            if node.names[0].asname:
                replacement += " as " + node.names[0].asname
            edits.append((*span(node), replacement.encode("ascii")))
            imports += 1
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "eval" and isinstance(node.func.value, ast.Name)
                and node.func.value.id in contexts and isinstance(parents.get(id(node)), ast.Expr)):
            if len(node.args) != 1 or node.keywords:
                raise ValueError("Unexpected unused eval signature")
            start, end = span(node.args[0])
            edits.append((start, end, b"(" + raw[start:end] + b') + "\\n;void 0;"'))
            unused += 1
    for start, end, replacement in sorted(edits, reverse=True):
        raw = raw[:start] + replacement + raw[end:]
    compile(raw, filename, "exec")
    return raw, imports, unused


def derive_files(upstream):
    files = {name.replace(UPSTREAM_DIST + "/", DERIVED_DIST + "/", 1): data
             for name, data in upstream.items() if name != UPSTREAM_DIST + "/RECORD"}
    info = DERIVED_DIST + "/METADATA"
    original = files[info]
    text = original.decode("utf-8")
    old_requires = ['Requires-Dist: mini-racer>=0.12.4; platform_system != "Linux"\n',
                    'Requires-Dist: py-mini-racer>=0.6.0; platform_system == "Linux"\n']
    if text.count("Version: 1.19.1\n") != 1 or any(text.count(row) != 1 for row in old_requires):
        raise ValueError("Pinned metadata precondition mismatch")
    text = text.replace("Version: 1.19.1\n", "Version: " + DERIVED_VERSION + "\n", 1)
    text = text.replace(old_requires[0], "Requires-Dist: rt-private-node-js-runtime==1.0.0\n", 1)
    text = text.replace(old_requires[1], "", 1)
    files[info] = text.encode("utf-8")
    version_name = "akshare/_version.py"
    version_raw = files[version_name].decode("utf-8")
    version_tree = ast.parse(version_raw)
    candidates = [node for node in ast.walk(version_tree) if isinstance(node, ast.Constant) and node.value == UPSTREAM_VERSION]
    if len(candidates) != 1:
        raise ValueError("Pinned module version precondition mismatch")
    version_lines = version_raw.splitlines(keepends=True)
    node = candidates[0]
    line = version_lines[node.lineno - 1]
    version_lines[node.lineno - 1] = line[:node.col_offset] + repr(DERIVED_VERSION) + line[node.end_col_offset:]
    files[version_name] = "".join(version_lines).encode("utf-8")
    changed = []
    import_count = unused_count = 0
    for filename, expected in sorted(AUDITED_SOURCES.items()):
        raw = upstream[filename]
        if digest(raw) != expected:
            raise ValueError("Audited upstream source mismatch")
        files[filename], imports, unused = replacement_spans(raw, filename)
        import_count += imports
        unused_count += unused
        changed.append({"path": filename, "upstreamSha256": expected,
                        "derivedSha256": digest(files[filename]), "unusedEvalCompletions": unused})
    if import_count != 40 or unused_count != 81:
        raise ValueError("Audited engine patch cardinality mismatch")
    provenance = {"schemaVersion": 1, "name": "akshare", "version": DERIVED_VERSION,
                  "upstreamVersion": UPSTREAM_VERSION, "upstreamSha256": UPSTREAM_SHA256,
                  "replacementDependency": {"name": "rt-private-node-js-runtime", "version": "1.0.0"},
                  "changes": changed, "usedEvalCompletionsUnchanged": 3,
                  "upstreamLicenseSha256": digest(upstream[UPSTREAM_DIST + "/licenses/LICENSE"]),
                  "releaseEligible": False,
                  "limits": ["No full upstream MiniRacer API compatibility claim",
                             "Provider entrypoints require offline installed regression",
                             "Target native bootstrap and final installation remain separate"]}
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
    return {"path": str(target), "name": "akshare", "version": DERIVED_VERSION, "sha256": digest(raw), "bytes": len(raw)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream-wheel", required=True)
    parser.add_argument("--output-directory", required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.upstream_wheel, args.output_directory), sort_keys=True))


if __name__ == "__main__":
    main()
