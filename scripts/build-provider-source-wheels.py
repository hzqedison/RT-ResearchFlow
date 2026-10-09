#!/usr/bin/env python3
"""Offline, reviewed sdist-to-wheel recipe, NOT a provider release builder.

Requires Python 3.10+ standard library only. No setup.py, imports of upstream
code, subprocesses, pip, build backends, dependency resolution or network I/O.
The two hashes below are the only accepted sources. This is an explicitly
reviewed legacy-layout conversion, not a general replacement for PEP 517.

Example (parent directory must already exist; output directory must be NEW):
  python -B scripts/build-provider-source-wheels.py --sdist-dir D:/.../sdists \
    --output-dir K:/.../provider-source-wheels-audit-001

Output is confined to a fresh provider-source-wheels-* directory. Source code
bytes and the complete original archive are retained. Wheel bytes depend on
the pinned archives and this recipe's LF-normalized bytes, not clock, paths,
permissions, zlib, platform or interpreter metadata. Actual builder identity
is recorded separately. Runtime compatibility and the six dependency closure
are separate release gates; nothing here installs or claims to validate them.

Format references:
https://packaging.python.org/en/latest/specifications/binary-distribution-format/
https://packaging.python.org/en/latest/specifications/core-metadata/
"""

import argparse
import ast
import base64
import csv
from dataclasses import dataclass
from email.parser import BytesParser
from email.policy import compat32
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import tarfile
import unicodedata
import zipfile


RECIPE_VERSION = "1"
MAX_ARCHIVE_BYTES = 1_000_000
MAX_EXPANDED_BYTES = 32_000_000
MAX_MEMBERS = 1024
FIXED_TIME = (1980, 1, 1, 0, 0, 0)


class RecipeError(ValueError):
    """Refuse unreviewed inputs or unsafe/overwriting output."""


@dataclass(frozen=True)
class Source:
    name: str
    version: str
    filename: str
    size: int
    sha256: str
    url: str
    runtime: str
    requires: tuple[str, ...]
    license_file: str

    @property
    def archive_root(self):
        return f"{self.name}-{self.version}"

    @property
    def wheel_stem(self):
        return f"{self.name.lower()}-{self.version}"


SOURCES = (
    Source("jsonpath", "0.82.2", "jsonpath-0.82.2.tar.gz", 10353,
           "d87ef2bcbcded68ee96bc34c1809b69457ecec9b0c4dd471658a12bd391002d1",
           "https://files.pythonhosted.org/packages/cf/a1/693351acd0a9edca4de9153372a65e75398898ea7f8a5c722ab00f464929/jsonpath-0.82.2.tar.gz",
           "jsonpath.py", (), "jsonpath.py"),
    Source("PyExecJS", "1.5.1", "PyExecJS-1.5.1.tar.gz", 13344,
           "34cc1d070976918183ff7bdc0ad71f8157a891c92708c00c5fbbff7a769f505c",
           "https://files.pythonhosted.org/packages/ba/8e/aedef81641c8dca6fd0fb7294de5bed9c45f3397d67fddf755c1042c2642/PyExecJS-1.5.1.tar.gz",
           "execjs/", ("six>=1.10.0",), "LICENSE"),
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode("ascii")


def checked_path(name):
    """Portable archive/wheel paths; never reinterpret them as OS paths."""
    if not name or "\\" in name or name.startswith("/"):
        raise RecipeError("Unsafe archive path")
    parts = name.split("/")
    reserved = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)),
                *(f"lpt{i}" for i in range(1, 10))}
    for part in parts:
        if (not part or part in {".", ".."} or part.endswith((".", " "))
                or any(ord(char) < 32 or char in ':<>"|?*' for char in part)
                or part.split(".")[0].casefold() in reserved
                or unicodedata.normalize("NFC", part) != part):
            raise RecipeError("Unsafe or nonportable archive path")
    return "/".join(parts)


def read_safe_archive(blob, expected_root):
    """Validate all members in memory; no extract/extractall or source execution."""
    if len(blob) > MAX_ARCHIVE_BYTES:
        raise RecipeError("Source archive exceeds size limit")
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(blob)) as stream:
            expanded = stream.read(MAX_EXPANDED_BYTES + 1)
        if len(expanded) > MAX_EXPANDED_BYTES:
            raise RecipeError("Expanded archive exceeds size limit")
        files = {}
        seen = {}
        total = 0
        with tarfile.open(fileobj=io.BytesIO(expanded), mode="r:") as archive:
            for index, member in enumerate(archive):
                if index >= MAX_MEMBERS:
                    raise RecipeError("Too many archive members")
                if not (member.isfile() or member.isdir()) or member.issparse():
                    raise RecipeError("Archive links, special and sparse members are forbidden")
                name = checked_path(member.name.rstrip("/") if member.isdir() else member.name)
                if name != expected_root and not name.startswith(expected_root + "/"):
                    raise RecipeError("Unexpected archive root")
                key = name.casefold()
                if key in seen:
                    raise RecipeError("Duplicate or case-colliding archive member")
                seen[key] = (name, member.isdir())
                if member.isfile():
                    total += member.size
                    if member.size < 0 or total > MAX_EXPANDED_BYTES:
                        raise RecipeError("Archive payload exceeds size limit")
                    stream = archive.extractfile(member)
                    if stream is None:
                        raise RecipeError("Missing archive payload")
                    payload = stream.read(member.size + 1)
                    if len(payload) != member.size:
                        raise RecipeError("Truncated archive payload")
                    relative = name[len(expected_root) + 1:]
                    if not relative:
                        raise RecipeError("Archive root cannot be a file")
                    files[relative] = payload
        for key in seen:
            parts = key.split("/")
            for length in range(1, len(parts)):
                ancestor = seen.get("/".join(parts[:length]))
                if ancestor and not ancestor[1]:
                    raise RecipeError("File/directory archive collision")
        if not files:
            raise RecipeError("Empty source archive")
        return files
    except (OSError, EOFError, tarfile.TarError) as error:
        raise RecipeError("Invalid source archive") from error


def read_source(directory, source):
    path = directory / source.filename
    if path.is_symlink() or not path.is_file():
        raise RecipeError("Source must be an existing regular file")
    with path.open("rb") as stream:
        blob = stream.read(source.size + 1)
    if len(blob) != source.size or sha256(blob) != source.sha256:
        raise RecipeError(f"Source size/SHA-256 mismatch: {source.filename}")
    return blob, read_safe_archive(blob, source.archive_root)


def reviewed_requires(source, files):
    """Check literal setup declarations without importing or executing setup.py."""
    try:
        tree = ast.parse(files["setup.py"].decode("utf-8"))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Name) and node.func.id == "setup"]
        if len(calls) != 1:
            raise RecipeError("Unexpected setup declaration")
        keywords = {item.arg: item.value for item in calls[0].keywords}
        declarations = ast.literal_eval(keywords["install_requires"]) if "install_requires" in keywords else []
        requires = tuple(re.sub(r"\s+", "", value) for value in declarations)
        if requires != source.requires:
            raise RecipeError("Unreviewed dependency declaration")
        if source.name == "PyExecJS":
            egg_requires = files["PyExecJS.egg-info/requires.txt"].decode("ascii").splitlines()
            if tuple(egg_requires) != source.requires:
                raise RecipeError("Dependency declarations disagree")
        elif ast.literal_eval(keywords["py_modules"]) != ["jsonpath"]:
            raise RecipeError("Unreviewed module layout")
        return requires
    except (KeyError, SyntaxError, UnicodeError, TypeError, ValueError) as error:
        raise RecipeError("Unreviewed source declarations") from error


def metadata(source, files):
    original = BytesParser(policy=compat32).parsebytes(files["PKG-INFO"])
    if original.get_all("Name") != [source.name] or original.get_all("Version") != [source.version]:
        raise RecipeError("Original package identity/version does not match pin")
    requires = reviewed_requires(source, files)
    existing = original.get_all("Requires-Dist", [])
    if existing and tuple(re.sub(r"\s+", "", value) for value in existing) != requires:
        raise RecipeError("Original dependency metadata disagrees")
    headers = ["Metadata-Version: 2.1"]
    for name, value in original.raw_items():
        if name.lower() in {"metadata-version", "description", "description-content-type", "requires-dist"}:
            continue
        value = " ".join(line.strip() for line in value.splitlines())
        headers.append(f"{name}: {value}")
    headers.append("Description-Content-Type: text/x-rst")
    headers.extend(f"Requires-Dist: {value}" for value in requires)
    if source.name == "PyExecJS":
        description = files["README.rst"]
        if b"PyExecJS (EOL)" not in description or b"no longer maintananced" not in description:
            raise RecipeError("Original end-of-life notice is missing")
    else:
        description = original.get_payload().encode("utf-8")
    return ("\n".join(headers) + "\n\n").encode("utf-8") + description


def add_entry(entries, name, payload):
    checked_path(name)
    if any(existing.casefold() == name.casefold() for existing in entries):
        raise RecipeError("Wheel entry collision")
    entries[name] = payload


def source_manifest(source, files, recipe_hash):
    return {
        "schema_version": 1, "purpose": "development-source-wheel-preparation-only",
        "recipe": {"version": RECIPE_VERSION, "lf_normalized_sha256": recipe_hash,
                   "method": "reviewed-legacy-layout-to-wheel-1.0; no source execution"},
        "source": {"name": source.name, "version": source.version, "url": source.url,
                   "filename": source.filename, "bytes": source.size, "sha256": source.sha256},
        "source_files": [{"path": path, "bytes": len(data), "sha256": sha256(data),
                          "runtime_wheel_path": path if path == source.runtime or path.startswith(source.runtime) and source.runtime.endswith("/") else None}
                         for path, data in sorted(files.items())],
        "requires_dist": list(source.requires),
        "dependency_closure": "not-resolved; runtime dependencies must be separately pinned and audited",
        "license_source": source.license_file,
        "license_retention": "complete original file, including embedded notice where applicable",
        "metadata_changes": ["metadata version 2.1", "description in message body from upstream",
                             "actual setup/egg-info Requires-Dist restored", "description content type text/x-rst"],
        "upstream_code_modified": False,
        "runtime_compatibility": "not tested; tags follow upstream pure Python 2/3 declarations",
        "determinism": {"zip_method": "stored", "timestamp": list(FIXED_TIME),
                        "mode": "regular file 0644", "record": "sorted SHA-256, URL-safe unpadded base64, LF CSV"},
    }


def wheel_bytes(source, blob, files, recipe_hash):
    entries = {}
    info = source.wheel_stem + ".dist-info"
    runtime_files = {path: data for path, data in files.items()
                     if path == source.runtime or source.runtime.endswith("/") and path.startswith(source.runtime)}
    if not runtime_files or source.runtime.endswith("/") and source.runtime + "__init__.py" not in runtime_files:
        raise RecipeError("Reviewed runtime package is missing")
    for path, data in sorted(runtime_files.items()):
        add_entry(entries, path, data)
    license_data = files[source.license_file]
    if b"Permission is hereby granted" not in license_data or b"Copyright" not in license_data:
        raise RecipeError("Original license notice is missing")
    license_name = "embedded-license-jsonpath.py.txt" if source.name == "jsonpath" else "LICENSE"
    add_entry(entries, f"{info}/licenses/{license_name}", license_data)
    # The intact source archive retains ALL files, licenses, resources, original
    # metadata and source archive headers. Never install upstream setup.py/tests.
    add_entry(entries, f"{info}/audit/{source.filename}", blob)
    add_entry(entries, f"{info}/audit/upstream-PKG-INFO", files["PKG-INFO"])
    for path, data in sorted(files.items()):
        if path.upper().startswith(("README", "CHANGELOG")):
            add_entry(entries, f"{info}/audit/documents/{path}", data)
    manifest = source_manifest(source, files, recipe_hash)
    add_entry(entries, f"{info}/audit/source-provenance.json", json_bytes(manifest))
    add_entry(entries, f"{info}/METADATA", metadata(source, files))
    add_entry(entries, f"{info}/WHEEL", (
        f"Wheel-Version: 1.0\nGenerator: rt-researchflow-reviewed-source-recipe {RECIPE_VERSION}\n"
        "Root-Is-Purelib: true\nTag: py2-none-any\nTag: py3-none-any\n").encode("ascii"))
    record_name = f"{info}/RECORD"
    record = io.StringIO(newline="")
    writer = csv.writer(record, lineterminator="\n")
    for path, data in sorted(entries.items()):
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode("ascii")
        writer.writerow((path, "sha256=" + digest, str(len(data))))
    writer.writerow((record_name, "", ""))
    add_entry(entries, record_name, record.getvalue().encode("utf-8"))
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", compression=zipfile.ZIP_STORED, allowZip64=False) as archive:
        for path in sorted(entries, key=lambda name: (name.startswith(info + "/"), name)):
            entry = zipfile.ZipInfo(path, FIXED_TIME)
            entry.create_system = 3
            entry.create_version = 20
            entry.extract_version = 20
            entry.external_attr = (0o100644 << 16)
            entry.compress_type = zipfile.ZIP_STORED
            archive.writestr(entry, entries[path])
    return result.getvalue(), manifest


def builder_identity():
    recipe = Path(__file__).read_bytes()
    modules = (ast, csv, gzip, hashlib, json, tarfile, zipfile)
    return {
        "python_version": sys.version, "implementation": sys.implementation.name,
        "executable_sha256": sha256(Path(sys.executable).read_bytes()),
        "recipe_raw_sha256": sha256(recipe),
        "recipe_lf_normalized_sha256": sha256(recipe.replace(b"\r\n", b"\n")),
        "stdlib_modules": {module.__name__: sha256(Path(module.__file__).read_bytes()) for module in modules},
        "build_dependencies": [], "network_used": False, "upstream_setup_executed": False,
    }


def checked_output(source_dir, output_dir):
    # Only owned, fresh audit outputs; never turn an existing wheelhouse into a target.
    if output_dir.exists() or output_dir.is_symlink():
        raise RecipeError("Output directory already exists; nothing will be overwritten")
    if not output_dir.name.startswith("provider-source-wheels-"):
        raise RecipeError("Output must be a new provider-source-wheels-* directory")
    if not output_dir.parent.is_dir() or output_dir.parent.resolve() != output_dir.parent.absolute():
        raise RecipeError("Output parent must exist and must not resolve through a link")
    output = output_dir.absolute()
    forbidden = source_dir.resolve().parent
    if output == forbidden or forbidden in output.parents:
        raise RecipeError("Output cannot be inside the existing source cache")
    if {part.casefold() for part in output.parts} & {"providers", "wheelhouse", "sdists"}:
        raise RecipeError("Output cannot target provider, wheelhouse or sdist trees")
    if os.name == "nt" and output.drive.casefold() not in {"d:", "k:"}:
        raise RecipeError("Windows preparation outputs must use owned D:/K: temporary locations")
    return output


def build_all(source_dir, output_dir):
    source_dir, output_dir = Path(source_dir), Path(output_dir)
    output = checked_output(source_dir, output_dir)
    identity = builder_identity()
    artifacts = {}
    summaries = []
    for source in SOURCES:
        blob, files = read_source(source_dir, source)
        wheel, provenance = wheel_bytes(source, blob, files, identity["recipe_lf_normalized_sha256"])
        filename = source.wheel_stem + "-py2.py3-none-any.whl"
        provenance = dict(provenance, wheel={"filename": filename, "sha256": sha256(wheel), "bytes": len(wheel)},
                          builder=identity)
        artifacts[filename] = wheel
        artifacts[filename + ".provenance.json"] = json_bytes(provenance)
        summaries.append(provenance["wheel"])
    # Validate the entire batch first. Exclusive directory + exclusive file
    # creation refuses collisions, including a concurrent second invocation.
    output.mkdir(mode=0o700)
    for name, data in sorted(artifacts.items()):
        with (output / name).open("xb") as stream:
            stream.write(data)
    return summaries


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sdist-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = build_all(args.sdist_dir, args.output_dir)
    except (RecipeError, OSError, KeyError) as error:
        print(f"Source wheel preparation refused: {error}", file=sys.stderr)
        return 2
    print(json_bytes({"purpose": "development only; dependency closure and runtime/release validation pending",
                      "wheels": result}).decode("ascii"), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
