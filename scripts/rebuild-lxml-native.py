#!/usr/bin/env python3
"""Bounded Windows lxml reconstruction. No application installation or policy edits.

Modes: snapshot-tools (local installed build tools), fetch (explicit locked URLs),
prepare (verified sources only), build (native baseline + compatible iconv relink).
All outputs use a NEW directory below D:/RT-ResearchFlow-BuildCache. Never clean
or reuse an existing output tree. See the generated REBUILD.md for reproduction.
"""
from __future__ import annotations

import argparse
import base64
import csv
import difflib
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile

CACHE = Path("D:/RT-ResearchFlow-BuildCache")
MANIFEST_SHA = "0d4154519b7eae84197bb2f92440037715870ceefb6809eb7e7108cc4b24dfa5"
SOURCE_PINS = {
    "lxml": ("lxml-6.1.3.tar.gz", "45222d94ddd511536f3b2f7d9deae3b2339b4ce0f075f1ca25703b07cad9dd21", 4211198,
             "https://files.pythonhosted.org/packages/23/ad/28ecd7cb894d172f3c9c80a075eeeb2017ac62e3632cee05a5f9493547eb/lxml-6.1.3.tar.gz"),
    "libiconv": ("libiconv-880a1fa8.tar.gz", "89dd45d7f074ddae04dcd25cc4ceace3432c04b72dc36a6508854aac713f3eb6", 5313881,
                 "https://github.com/winlibs/libiconv/archive/880a1fa8b5581e37e136a7b051947d3ea39097b6.tar.gz"),
    "libxml2": ("libxml2-bb846788.tar.gz", "5182396205f97b183d34ab8dadd7693523c7d4e2137394aec02514a5a9a9dcf0", 4225102,
                "https://github.com/winlibs/libxml2/archive/bb84678855e3407fc88180295c992f9c984e28e0.tar.gz"),
    "libxslt": ("libxslt-c0076eaa.tar.gz", "d687aaf48527e042d942dccbc74fbcd150588522305e63d3e91785d9b6590677", 2705214,
                "https://github.com/winlibs/libxslt/archive/c0076eaa6e0d1f99e01107e8db225a308eb1e543.tar.gz"),
    "zlib": ("zlib-0089522e.tar.gz", "e2af9f28fcdf723e464b40af73fdeed07ce3e581a9ea110702c1ba733983f8a0", 1559272,
             "https://github.com/winlibs/zlib/archive/0089522e62e6b5d4950e62bd20f0cb06a9288413.tar.gz"),
    "build-recipe": ("libxml2-win-binaries-4e8ae01f.tar.gz", "cd155987f5269d04acb549d8664b50b1ea0bf3580e1ab709587a03e4bda4396e", 4262,
                     "https://github.com/lxml/libxml2-win-binaries/archive/4e8ae01f61145dc823ce2ae1d79f06241b7b46de.tar.gz"),
}
PBS_NAME = "cpython-3.13.16+20261003-x86_64-pc-windows-msvc-install_only.tar.gz"
PBS_SHA = "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778"
PBS_URL = "https://github.com/astral-sh/python-build-standalone/releases/download/20261003/" + PBS_NAME.replace("+", "%2B")
WHEEL_NAME = "lxml-6.1.3-cp313-cp313-win_amd64.whl"
WHEEL_SHA = "e477aca0bc0d19f3b4ae9e4f2a1cfd687c31bf772d78734910658186b40b2477"
WHEEL_URL = "https://files.pythonhosted.org/packages/c0/28/e46a7702bd95e9043291f7c3539b6184cba66f96cea9936f20939b284eeb/" + WHEEL_NAME
PYD_PINS = {
    "lxml/etree.cp313-win_amd64.pyd": "743cd66d1caee61baae5e19f9bb1bf373edcb778562fa17eea969ad4dc712f7c",
    "lxml/objectify.cp313-win_amd64.pyd": "0589acb808a4cc0b96b12cd30d582969b7ca9b403a2b61c0b79f5886cd6d463e",
}
MARKER = "RT-LXML-ICONV-COMPATIBLE-RELINK-1"
GENERATED_C = ("etree", "objectify", "builder", "_elementpath", "html/diff", "html/_difflib", "sax")


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def checked_file(path, expected, size=None):
    path = Path(path)
    if not re.fullmatch(r"[0-9a-f]{64}", expected or ""):
        raise ValueError("A fixed SHA256 is required")
    actual = sha(path)
    if actual != expected or (size is not None and path.stat().st_size != size):
        raise ValueError(f"Pinned bytes mismatch: {path.name} ({actual})")
    return {"name": path.name, "sha256": actual, "bytes": path.stat().st_size}


def new_owned_dir(path):
    path = Path(path).resolve()
    root = CACHE.resolve()
    if path == root or not path.is_relative_to(root):
        raise ValueError("Outputs must be a new child of D:/RT-ResearchFlow-BuildCache")
    # No exist_ok: never overwrite, delete, or repurpose a previous build.
    path.mkdir(parents=True)
    return path


def member_path(name):
    p = PurePosixPath(name)
    if (not name or p.is_absolute() or "\\" in name or
            any(x in (".", "..") or ":" in x or x.endswith((".", " ")) for x in p.parts)):
        raise ValueError(f"Unsafe archive name: {name}")
    # NT device names and alternate data streams must not reach Windows paths.
    if any(re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", x) for x in p.parts):
        raise ValueError(f"Windows device archive name: {name}")
    return p


def extract_tar(archive, destination, strip_root=True):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as t:
        entries = t.getmembers()
        roots = {member_path(m.name).parts[0] for m in entries}
        if strip_root and len(roots) != 1:
            raise ValueError("Archive must have exactly one source root")
        seen = set()
        for m in entries:
            p = member_path(m.name)
            parts = p.parts[1:] if strip_root else p.parts
            if not parts:
                if not m.isdir():
                    raise ValueError("Archive root is not a directory")
                continue
            if not (m.isfile() or m.isdir()):
                raise ValueError(f"Links and special entries are not executable materials: {m.name}")
            key = "/".join(parts).casefold()
            if key in seen:
                raise ValueError(f"Duplicate/case-colliding archive entry: {m.name}")
            seen.add(key)
            target = destination.joinpath(*parts)
            if m.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as f, t.extractfile(m) as stream:
                    shutil.copyfileobj(stream, f)


def extract_zip(archive, destination):
    destination = Path(destination)
    destination.mkdir(parents=True)
    seen = set()
    with zipfile.ZipFile(archive) as z:
        for m in z.infolist():
            p = member_path(m.filename.rstrip("/"))
            if (m.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Zip symlinks are forbidden")
            key = str(p).casefold()
            if key in seen:
                raise ValueError("Duplicate/case-colliding zip entry")
            seen.add(key)
            target = destination.joinpath(*p.parts)
            if m.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as f, z.open(m) as source:
                    shutil.copyfileobj(source, f)


def snapshot_tools(site, destination):
    """Freeze complete installed pure-Python tools, including vendored licenses."""
    import importlib.metadata as metadata
    site = Path(site).resolve()
    destination = new_owned_dir(destination)
    names = ["setuptools", "packaging"]
    files = set()
    versions = {}
    for name in names:
        dist = metadata.distribution(name) if site == Path(next(iter(metadata.distribution(name).files and [metadata.distribution(name).locate_file("")]))).resolve() else next(
            d for d in metadata.distributions(path=[str(site)]) if d.metadata["Name"].lower() == name)
        versions[name] = dist.version
        for file in dist.files or ():
            p = Path(dist.locate_file(file)).resolve()
            if not p.is_relative_to(site):
                raise ValueError("Build tooling snapshot contains an external file")
            if p.is_file() and p.suffix not in (".pyc", ".pyo"):
                files.add(p)
    if not (site / "setuptools/_vendor/wheel/wheelfile.py").is_file():
        raise ValueError("The snapshot requires setuptools with vendored wheel")
    vendor = list(metadata.distributions(path=[str(site / "setuptools/_vendor")]))
    versions["vendoredWheel"] = next(d.version for d in vendor if d.metadata["Name"].lower() == "wheel")
    note = {"schema": "rt-lxml-installed-build-tool-snapshot-v1", "versions": versions,
            "acquisition": {"type": "already-installed-local-tools", "path": str(site),
                            "originalPublisherWheelProvenance": "not asserted"},
            "files": [{"path": p.relative_to(site).as_posix(), "sha256": sha(p)} for p in sorted(files)]}
    out = destination / "tools-snapshot.zip"
    with zipfile.ZipFile(out, "x", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(files):
            z.write(p, p.relative_to(site).as_posix())
        z.writestr("SNAPSHOT.json", json.dumps(note, indent=2))
    write_json(destination / "tools-snapshot-evidence.json", {**note, "archive": checked_file(out, sha(out))})
    return {"path": str(out), "sha256": sha(out), "versions": versions}


def fetch_file(url, destination, expected, size=None):
    """Only called in explicit acquisition mode, never by build or prepare."""
    if not url.startswith("https://"):
        raise ValueError("Acquisition requires HTTPS")
    with urllib.request.urlopen(url, timeout=90) as response, Path(destination).open("xb") as out:
        if not response.geturl().startswith("https://"):
            raise ValueError("Non-HTTPS redirect")
        shutil.copyfileobj(response, out)
    return checked_file(destination, expected, size)


def fetch_materials(args):
    root = new_owned_dir(args.materials_dir)
    result = {"schema": "rt-lxml-native-acquisition-v1", "files": [], "status": "acquiring"}
    try:
        if args.tools_archive is not None:
            local = Path(args.tools_archive)
            checked_file(local, args.tools_sha256)
            destination = root / "tools-snapshot.zip"
            with local.open("rb") as source, destination.open("xb") as out:
                shutil.copyfileobj(source, out)
            copied = checked_file(destination, args.tools_sha256)
            result["files"].append({**copied, "acquisition": "sha-checked-local-archive",
                                    "sourcePath": str(local.resolve())})
        for name, pin, size, url in SOURCE_PINS.values():
            result["files"].append(fetch_file(url, root / name, pin, size))
        result["files"].append(fetch_file(PBS_URL, root / PBS_NAME, PBS_SHA, 47421192))
        result["files"].append(fetch_file(WHEEL_URL, root / WHEEL_NAME, WHEEL_SHA))
        if args.tools_url is not None:
            result["files"].append(fetch_file(args.tools_url, root / "tools-snapshot.zip", args.tools_sha256))
        result["status"] = "fixed-inputs-acquired-no-build-executed"
    except Exception as exc:
        result.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        write_json(root / "acquisition-evidence.json", result)


def verify_original(wheel):
    checked_file(wheel, WHEEL_SHA)
    with zipfile.ZipFile(wheel) as z:
        hashes = {n: hashlib.sha256(z.read(n)).hexdigest() for n in PYD_PINS}
    if hashes != PYD_PINS:
        raise ValueError("Original wheel PYD pins mismatch")
    return {"wheel": checked_file(wheel, WHEEL_SHA), "members": hashes}


def stage_sources(materials, root):
    source = root / "source"
    source.mkdir(parents=True)
    for ident in ("build-recipe", "libiconv", "libxml2", "libxslt", "zlib", "lxml"):
        target = source if ident == "build-recipe" else source / ident
        extract_tar(materials / SOURCE_PINS[ident][0], target)
    recipe = source / "build.ps1"
    checked_file(recipe, "bca4e9486154340e6ebd285dc4aac12835d212aba7cfb1766f6ef72b0d136e53")
    for stem in GENERATED_C:
        if not (source / "lxml/src/lxml" / (stem + ".c")).is_file():
            raise ValueError(f"Missing generated C: {stem}")
    return source


def compiler_base_environment(root):
    """Keep OS folder identities needed by MSBuild, not ambient build settings."""
    allowed = {
        "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PROGRAMFILES",
        "PROGRAMFILES(X86)", "PROGRAMW6432", "COMMONPROGRAMFILES",
        "COMMONPROGRAMFILES(X86)", "COMMONPROGRAMW6432", "PROGRAMDATA",
        "ALLUSERSPROFILE", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS",
        "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "USERNAME",
    }
    environment = {k.upper(): v for k, v in os.environ.items() if k.upper() in allowed}
    temporary = str((Path(root) / "t").resolve())
    if not temporary.isascii() or " " in temporary:
        raise ValueError("Native build requires an ASCII, space-free cache path")
    # FileTracker expands these folder variables before tracking CL outputs.
    # Missing folder identities can produce invalid roots even after CL succeeds.
    for name in ("PROGRAMDATA", "ALLUSERSPROFILE", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)"):
        value = environment.get(name)
        if not value or "%" in value or not Path(value).is_absolute():
            raise ValueError(f"A concrete standard Windows folder is required: {name}")
    environment.update(PATH=str(Path(environment["SYSTEMROOT"]) / "System32"),
                       TEMP=temporary, TMP=temporary, VSCMD_SKIP_SENDTELEMETRY="1",
                       MSBUILDDISABLENODEREUSE="1", MSBUILDUSESERVER="0")
    return environment


class Build:
    def __init__(self, args):
        self.args = args
        self.root = new_owned_dir(args.work)
        (self.root / "logs").mkdir()
        (self.root / "t").mkdir()
        self.evidence = {"schema": "rt-lxml-native-rebuild-v1", "status": "started",
                         "scope": "isolated-windows-x64-component-only",
                         "productAcceptance": "not performed; independent review required",
                         "releaseDecision": "not granted", "policyModified": False,
                         "commands": [], "outputs": {}, "missingFacts": [],
                         "networkEnforcement": args.network_enforcement,
                         "wrapperSha256": sha(__file__)}
        self.env = dict(os.environ)

    def run(self, label, command, cwd=None, env=None):
        environment = env if env is not None else self.env
        requested = command
        if isinstance(command, (list, tuple)):
            executable = shutil.which(str(command[0]), path=environment.get("PATH", os.defpath))
            if not executable:
                raise FileNotFoundError(f"Executable not found in the controlled PATH: {command[0]}")
            # Windows CreateProcess does not use the supplied child PATH to find
            # a bare executable. Resolve before launch, and record actual bytes.
            command = [str(Path(executable).resolve()), *command[1:]]
        index = len(self.evidence["commands"]) + 1
        log = self.root / "logs" / f"{index:02d}-{label}.log"
        record = {"label": label, "command": command, "requestedCommand": requested, "cwd": str(cwd or self.root),
                  "log": str(log.relative_to(self.root)), "startedUnix": time.time()}
        self.evidence["commands"].append(record)
        print(f"[{index:02d}] {label}", flush=True)
        with log.open("wb") as out:
            p = subprocess.run(command, cwd=cwd or self.root, env=environment,
                               stdout=out, stderr=subprocess.STDOUT, timeout=1800, check=False)
        record.update(returnCode=p.returncode, logSha256=sha(log), completedUnix=time.time())
        if p.returncode:
            tail = log.read_bytes()[-5000:].decode("utf-8", "replace")
            raise RuntimeError(f"{label}: exit {p.returncode}\n{tail}")
        return log

    def materials(self):
        args = self.args
        manifest = Path(args.manifest)
        checked_file(manifest, MANIFEST_SHA)
        data = json.loads(manifest.read_text(encoding="utf-8-sig"))
        if data["sourceLayout"] != {"recipe": ".", "libiconv": "libiconv", "libxml2": "libxml2",
                                    "libxslt": "libxslt", "zlib": "zlib", "lxml": "lxml"}:
            raise ValueError("Source layout does not match reviewed inputs")
        inputs = self.root / "inputs"
        inputs.mkdir()
        shutil.copyfile(manifest, inputs / "source-relink-delta.json")
        self.evidence["inputs"] = {"manifestSha256": MANIFEST_SHA, "sources": []}
        for ident, (name, pin, size, url) in SOURCE_PINS.items():
            asset = Path(args.materials_dir) / name
            item = checked_file(asset, pin, size)
            shutil.copyfile(asset, inputs / name)
            self.evidence["inputs"]["sources"].append({"id": ident, "url": url, **item})
        shutil.copyfile(__file__, self.root / "rebuild-lxml-native.py")
        if args.original_wheel:
            self.evidence["originalBinary"] = verify_original(args.original_wheel)
            shutil.copyfile(args.original_wheel, inputs / WHEEL_NAME)
        else:
            self.evidence["originalBinary"] = {"basis": "reviewed manifest only; not rechecked in this run"}
            self.evidence["missingFacts"].append("Original wheel bytes not supplied for this run")
        return inputs

    def toolchain(self, inputs):
        if sys.platform != "win32":
            raise RuntimeError("Native build requires Windows x64 MSVC, not cross-compilation")
        args = self.args
        checked_file(args.pbs, PBS_SHA, 47421192)
        checked_file(args.tools_archive, args.tools_sha256)
        shutil.copyfile(args.pbs, inputs / PBS_NAME)
        shutil.copyfile(args.tools_archive, inputs / "tools-snapshot.zip")
        extract_tar(inputs / PBS_NAME, self.root / "pbs", strip_root=False)
        self.python = self.root / "pbs/python/python.exe"
        checked_file(self.python, sha(self.python))
        python_base = self.python.parent
        dev = [python_base / "include/Python.h", python_base / "libs/python313.lib",
               python_base / "python313.dll", self.python]
        self.evidence["pythonDevelopmentInputs"] = [checked_file(p, sha(p)) for p in dev]
        extract_zip(inputs / "tools-snapshot.zip", self.root / "tools")
        tool_note = json.loads((self.root / "tools/SNAPSHOT.json").read_text(encoding="utf-8"))
        for item in tool_note["files"]:
            p = member_path(item["path"])
            checked_file((self.root / "tools").joinpath(*p.parts), item["sha256"])
        self.evidence["buildTools"] = {"archiveSha256": args.tools_sha256, "snapshot": tool_note}
        guard = self.root / "offline-guard"
        guard.mkdir()
        (guard / "sitecustomize.py").write_text(
            "import sys\ndef _offline(event, args):\n"
            "    if event in ('socket.connect', 'socket.connect_ex', 'socket.bind', 'socket.getaddrinfo'):\n"
            "        raise RuntimeError('RT lxml build: network forbidden')\n"
            "sys.addaudithook(_offline)\n", encoding="ascii")
        bat = Path(args.vc_root) / "VC/Auxiliary/Build/vcvarsall.bat"
        if not bat.is_file():
            raise RuntimeError("Existing Visual Studio BuildTools installation is required; no installer fallback")
        for value in (args.msvc_version, args.sdk_version):
            if not re.fullmatch(r"\d+(?:\.\d+){2,3}", value):
                raise ValueError("Exact numeric toolchain versions are required")
        base = compiler_base_environment(self.root)
        command = f'cmd.exe /d /s /c ""{bat}" x64 {args.sdk_version} -vcvars_ver={args.msvc_version} >nul && set"'
        log = self.run("msvc-environment", command, env=base)
        captured = {}
        for line in log.read_bytes().decode("utf-8", "replace").splitlines():
            if "=" in line and not line.startswith("="):
                k, v = line.split("=", 1)
                captured[k.upper()] = v
        if captured.get("VSCMD_ARG_TGT_ARCH") != "x64":
            raise RuntimeError("MSVC environment did not select x64")
        if captured.get("VCTOOLSVERSION", "").rstrip("\\/") != args.msvc_version:
            raise RuntimeError("MSVC tools version differs from the lock")
        if captured.get("WINDOWSSDKVERSION", "").rstrip("\\/") != args.sdk_version:
            raise RuntimeError("Windows SDK differs from the lock")
        for key in ("STATICBUILD", "STATIC_DEPS", "WITH_CYTHON", "PYTHONHOME", "PYTHONPATH", "CL", "_CL_", "LINK", "_LINK_"):
            captured.pop(key, None)
        macros = "/DLIBXML_STATIC /DLIBXSLT_STATIC /DLIBEXSLT_STATIC"
        captured.update(PYTHONPATH=os.pathsep.join([str(guard), str(self.root / "tools")]),
                        PYTHONNOUSERSITE="1", PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8",
                        PIP_NO_INDEX="1", PIP_DISABLE_PIP_VERSION_CHECK="1", DISTUTILS_USE_SDK="1",
                        MSSdk="1", CL=macros, _LINK_="/MAP /MAPINFO:EXPORTS /INCREMENTAL:NO",
                        TEMP=base["TEMP"], TMP=base["TMP"], MSBUILDDISABLENODEREUSE="1", MSBUILDUSESERVER="0",
                        XML2_CONFIG="rt-no-config", XSLT_CONFIG="rt-no-config", PKG_CONFIG="rt-no-config")
        captured["PATH"] = str(self.python.parent) + os.pathsep + captured["PATH"]
        self.env = captured
        tools = {}
        for name in ("cl.exe", "link.exe", "lib.exe", "nmake.exe", "msbuild.exe", "cscript.exe", "dumpbin.exe"):
            path = shutil.which(name, path=self.env["PATH"])
            if not path:
                raise RuntimeError(f"Locked native tool unavailable: {name}")
            tools[name] = {"path": path, **checked_file(path, sha(path))}
        self.evidence["nativeToolchain"] = {"msvcVersion": args.msvc_version, "sdkVersion": args.sdk_version,
            "platform": "x64", "toolset": "v143", "crt": "/MD", "acquisition": "preinstalled; never installed by wrapper",
            "tools": tools, "environment": {k: self.env.get(k) for k in (
                "INCLUDE", "LIB", "LIBPATH", "PATH", "CL", "_LINK_", "TEMP", "TMP", "PROGRAMDATA",
                "ALLUSERSPROFILE", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)")}}
        code = "import sys,json,setuptools,wheel,packaging; assert sys.version_info[:3]==(3,13,16); print(json.dumps(dict(python=sys.version, setuptools=setuptools.__version__, wheel=wheel.__version__, packaging=packaging.__version__)))"
        note = self.run("private-python-build-tools", [str(self.python), "-s", "-c", code])
        self.evidence["buildTools"]["executedVersionReport"] = note.read_text(encoding="utf-8").strip()
        write_json(self.root / "toolchain-lock.json", {"python": self.evidence["pythonDevelopmentInputs"],
                   "native": self.evidence["nativeToolchain"], "toolsArchiveSha256": args.tools_sha256,
                   "buildTools": tool_note["versions"]})

    def patch_iconv(self, source):
        path = source / "libiconv/source/lib/iconv.c"
        original = path.read_text(encoding="utf-8")
        anchor = "#include <iconv.h>"
        if original.count(anchor) != 1:
            raise ValueError("The reviewed iconv injection anchor changed")
        replacement = anchor + '\n/* RT derived build: additive ABI-compatible relink probe. */\n' + (
            '__declspec(dllexport) const char * __cdecl rt_lxml_iconv_relink_marker(void)\n'
            '{ return "' + MARKER + '"; }\n')
        modified = original.replace(anchor, replacement)
        patch = self.root / "iconv-compatible-relink.patch"
        patch.write_text("".join(difflib.unified_diff(original.splitlines(True), modified.splitlines(True),
                         "a/libiconv/source/lib/iconv.c", "b/libiconv/source/lib/iconv.c")), encoding="utf-8")
        path.write_text(modified, encoding="utf-8")
        self.evidence["iconvModification"] = {"file": "libiconv/source/lib/iconv.c", "marker": MARKER,
                 "originalSha256": hashlib.sha256(original.encode()).hexdigest(), "modifiedSha256": sha(path),
                 "patchSha256": sha(patch), "type": "additive export; existing conversion implementation unchanged"}

    def native(self, phase, source):
        stage = source.parent / "stage"
        inc, lib = stage / "include", stage / "lib"
        inc.mkdir(parents=True)
        lib.mkdir()
        iconvout = source.parent / "iconv-output"
        (iconvout / "lib").mkdir(parents=True)
        empty = source.parent / "empty-user-props"
        empty.mkdir()
        project = source / "libiconv/MSVC17/libiconv_static/libiconv_static.vcxproj"
        self.run(phase + "-iconv", ["msbuild.exe", str(project), "/t:Build", "/m:1", "/v:normal", "/nr:false",
                 "/p:Configuration=Release", "/p:Platform=x64", "/p:PlatformToolset=v143",
                 "/p:WholeProgramOptimization=false", "/p:RuntimeLibrary=MultiThreadedDLL",
                 f"/p:WindowsTargetPlatformVersion={self.args.sdk_version}",
                 f"/p:OutDir={iconvout.as_posix()}/", f"/p:IntDir={(iconvout / 'obj').as_posix()}/",
                 f"/p:UserRootDir={empty.as_posix()}/", "/p:ImportDirectoryBuildProps=false",
                 "/p:ImportDirectoryBuildTargets=false", f"/bl:{self.root / 'logs' / (phase + '-iconv.binlog')}"])
        shutil.copyfile(iconvout / "lib/libiconv_a.lib", lib / "iconv_a.lib")
        self.run(phase + "-zlib", ["nmake.exe", "/nologo", "-f", "win32/Makefile.msc", "zlib_a.lib"], source / "zlib")
        shutil.copyfile(source / "zlib/zlib_a.lib", lib / "zlib.lib")
        includes = [source / "zlib", source / "libiconv/source/include", source / "libxml2/include", source / "libxslt"]
        include_arg = ";".join(map(str, includes))
        for ident, targets in (("libxml2", ["libxmla"]), ("libxslt", ["libxslta", "libexslta"])):
            cwd = source / ident / "win32"
            cmd = ["cscript.exe", "//NoLogo", "configure.js", "compiler=msvc", "cruntime=/MD",
                   "vcmanifest=yes", "zlib=yes", "iconv=yes", "static=yes", f"lib={lib}", f"include={include_arg}"]
            if ident == "libxslt":
                cmd += ["crypto=no", "modules=no", "python=no"]
            self.run(phase + "-" + ident + "-configure", cmd, cwd)
            self.run(phase + "-" + ident, ["nmake.exe", "/nologo", *targets], cwd)
            names = ["libxml2_a.lib"] if ident == "libxml2" else ["libxslt_a.lib", "libexslt_a.lib"]
            for name in names:
                shutil.copyfile(cwd / "bin.msvc" / name, lib / name)
        shutil.copytree(source / "libxml2/include/libxml", inc / "libxml")
        for name in ("libxslt", "libexslt"):
            shutil.copytree(source / "libxslt" / name, inc / name,
                            ignore=shutil.ignore_patterns("*.c", "*.o", "*.obj", "*.lib", "*.dll"))
        for path in [source / "libiconv/source/include/iconv.h", source / "libiconv/source/include/libcharset.h",
                     source / "zlib/zlib.h", source / "zlib/zconf.h"]:
            if path.is_file():
                shutil.copyfile(path, inc / path.name)
        libraries = {p.name: checked_file(p, sha(p)) for p in lib.iterdir()}
        self.evidence.setdefault("nativeLibraries", {})[phase] = libraries
        return inc, lib

    def wheel(self, phase, source, include, library):
        env = dict(self.env)
        env.update(LXML_STATIC_INCLUDE_DIRS=str(include), LXML_STATIC_LIBRARY_DIRS=str(library),
                   LXML_STATIC_CFLAGS=env["CL"], INCLUDE=str(include) + os.pathsep + env["INCLUDE"],
                   LIBRARY=str(library), LIB=str(library) + os.pathsep + env["LIB"])
        self.run(phase + "-lxml", [str(self.python), "-s", "setup.py", "bdist_wheel",
                 "--build-number", "1rt" + phase, "--static", "--without-cython"], source / "lxml", env)
        candidates = list((source / "lxml/dist").glob("*.whl"))
        if len(candidates) != 1:
            raise RuntimeError("Expected exactly one freshly compiled wheel")
        wheel = candidates[0]
        if wheel.name != f"lxml-6.1.3-1rt{phase}-cp313-cp313-win_amd64.whl":
            raise RuntimeError(f"Unexpected derived wheel identity: {wheel.name}")
        output = self.root / wheel.name
        # Preserve upstream attribution and notices, add provenance, rebuild RECORD.
        with zipfile.ZipFile(wheel) as original:
            entries = {n: original.read(n) for n in original.namelist() if not n.endswith("/RECORD")}
        info = "lxml-6.1.3.dist-info"
        entries[info + "/RT_REBUILD_PROVENANCE.json"] = json.dumps({
            "derivedIdentity": wheel.name, "sourceManifestSha256": MANIFEST_SHA,
            "wrapperSha256": self.evidence["wrapperSha256"], "toolsSha256": self.args.tools_sha256,
            "phase": phase, "originalWheelSha256": WHEEL_SHA,
            "originalWheelByteIdentity": "not claimed", "iconvMarker": MARKER if phase == "relink" else None,
            "componentOnly": True}, indent=2).encode()
        with tarfile.open(self.root / "inputs" / SOURCE_PINS["libiconv"][0]) as t:
            m = next(m for m in t.getmembers() if m.name.endswith("/source/COPYING.LIB"))
            license_bytes = t.extractfile(m).read()
        if hashlib.sha256(license_bytes).hexdigest() != "dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551":
            raise ValueError("libiconv original license hash changed")
        entries[info + "/licenses/RT_LIBICONV_COPYING.LIB"] = license_bytes
        entries[info + "/licenses/RT_SOURCE_NOTICE.txt"] = (
            "Derived RT reconstruction, not the unchanged upstream PyPI wheel.\n"
            "All original notices remain. Complete corresponding sources, additive iconv patch,\n"
            "wrapper, build-tool snapshot and reconstruction instructions are in source-materials.zip.\n"
            "This cache run does not establish final same-place release availability.\n").encode()
        records = io.StringIO(newline="")
        writer = csv.writer(records, lineterminator="\n")
        for name, data in sorted(entries.items()):
            digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
            writer.writerow([name, "sha256=" + digest, len(data)])
        writer.writerow([info + "/RECORD", "", ""])
        entries[info + "/RECORD"] = records.getvalue().encode()
        with zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED) as z:
            for name, data in sorted(entries.items()):
                z.writestr(name, data)
        members = {n: hashlib.sha256(entries[n]).hexdigest() for n in PYD_PINS}
        self.evidence["outputs"][phase] = {"wheel": checked_file(output, sha(output)), "members": members,
                 "identity": "derived wheel build tag; not original wheel", "upstreamNoticesRetained": True}
        maps = [{"path": str(p.relative_to(self.root)), "sha256": sha(p)} for p in source.rglob("*.map")]
        if len(maps) < len(GENERATED_C):
            raise RuntimeError("All seven extension linker maps are required")
        self.evidence["outputs"][phase]["linkerMaps"] = maps
        return output

    def probe(self, phase, wheel):
        dest = self.root / (phase + "-\u4e2d\u6587-\u7f16\u7801\u8def\u5f84")
        extract_zip(wheel, dest)
        code = r'''
import ctypes,json,socket,sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from lxml import etree, objectify
assert etree.LIBXML_COMPILED_VERSION == (2,11,9)
assert etree.LIBXSLT_COMPILED_VERSION == (1,1,45)
assert etree.ICONV_COMPILED_VERSION == (1,17)
text = '\u4e2d\u6587\u6d4b\u8bd5'
parser = etree.XMLParser(no_network=True, resolve_entities=False)
for encoding,value in [('GB18030',text),('windows-1252','caf\u00e9')]:
    data=('<?xml version="1.0" encoding="'+encoding+'"?><r><v>'+value+'</v></r>').encode(encoding)
    tree=etree.fromstring(data,parser)
    assert tree.xpath('string(/r/v)') == value
    assert str(objectify.fromstring(data).v) == value
    style=etree.XML(b'<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="text" encoding="GB18030"/><xsl:template match="/"><xsl:value-of select="r/v"/></xsl:template></xsl:stylesheet>')
    converted=bytes(etree.XSLT(style, access_control=etree.XSLTAccessControl.DENY_ALL)(tree))
    assert converted.decode('gb18030') == value
marker={}
for mod in (etree,objectify):
    dll=ctypes.WinDLL(mod.__file__)
    if sys.argv[2]=='relink':
        f=dll.rt_lxml_iconv_relink_marker; f.restype=ctypes.c_char_p
        assert f().decode() == sys.argv[3]
        marker[mod.__name__]=f().decode()
    else:
        assert not hasattr(dll,'rt_lxml_iconv_relink_marker')
try: socket.getaddrinfo('example.invalid',443)
except RuntimeError: pass
else: raise AssertionError('Offline audit guard missing')
print(json.dumps(dict(phase=sys.argv[2], python=sys.version, libxml2=etree.LIBXML_COMPILED_VERSION, libxslt=etree.LIBXSLT_COMPILED_VERSION, iconv=etree.ICONV_COMPILED_VERSION, encodingCases=['GB18030','windows-1252'], xpath=True, xslt=True, objectify=True, chinesePath=str(Path(etree.__file__)), exportedMarker=marker, pythonNetworkGuard=True)))
'''
        log = self.run(phase + "-offline-probe", [str(self.python), "-s", "-c", code, str(dest), phase, MARKER], dest)
        self.evidence["outputs"][phase]["probe"] = json.loads(log.read_text(encoding="utf-8"))
        for member in PYD_PINS:
            log = self.run(phase + "-" + Path(member).stem + "-imports", ["dumpbin.exe", "/imports", str(dest / member)])
            report = log.read_text(encoding="utf-8", errors="replace")
            if re.search(r"(?im)^\s*(?:lib)?(?:iconv|xml2|xslt|exslt)[\w.-]*\.dll\s*$", report):
                raise RuntimeError("Unexpected external native library DLL import")

    def reconstruction_doc(self):
        args = self.args
        doc = (
            "# Windows lxml derived reconstruction checkpoint\n\n"
            "Component evidence only; no product acceptance or release approval.\n"
            "Original producer byte identity is not claimed. Derived build tags distinguish both wheels.\n\n"
            "## Reconstruct without producer keys\n\n"
            "Install your own x64 VS 2022 v143 toolchain and the exact SDK in toolchain-lock.json.\n"
            "No installer is invoked by this wrapper. Unpack this source bundle, then use Python 3.13+:\n\n"
            "```powershell\npython rebuild-lxml-native.py build --manifest inputs/source-relink-delta.json "
            "--materials-dir inputs --pbs 'inputs/" + PBS_NAME + "' --tools-archive inputs/tools-snapshot.zip "
            "--tools-sha256 " + str(args.tools_sha256) +
            (" --original-wheel inputs/" + WHEEL_NAME if args.original_wheel else "") +
            " --vc-root '<YOUR VS 2022 DIRECTORY>' --msvc-version " + args.msvc_version +
            " --sdk-version " + args.sdk_version + " --work D:/RT-ResearchFlow-BuildCache/my-new-relink\n```\n\n"
            "The same wrapper reconstructs fresh baseline and fresh modified-iconv trees, uses local generated C,\n"
            "checked native commands and --static --without-cython (never --static-deps).\n"
            "The patch adds only an exported marker; offline probes require that export in BOTH etree/objectify.\n"
            "All six original source archives and their notices, installed build-tool sources/licenses, PBS\n"
            "development inputs, explicit output/SDK/user-props/CRT adaptations, logs and link maps are retained.\n"
            "Tool snapshot is locally acquired installed tooling, not an attestation of publisher-wheel bytes.\n"
            "Local build blocks Python sockets and uses inspected local native targets; CI additionally blocks\n"
            "OS outbound networking during build. Do not claim local OS-level network isolation.\n\n"
            "## Recipient application integration\n\n"
            "Recipients may build and debug their own modified combined library for self-use.\n"
            "The wheels are not automatically added to official runtime policy. For a recipient-owned\n"
            "application build, use its documented runtime preparation/resolver to pin the new wheel bytes\n"
            "and reconstruct its runtime manifest. Producer signing keys are not required for this component\n"
            "reconstruction. Exact application-manifest integration and actual same-place source release\n"
            "availability still require the integration owner's evidence; do not disable official integrity checks.\n"
            "LGPL COPYING.LIB remains complete; iconv.exe is not compiled or added to the wheel.\n")
        return doc

    def bundle(self):
        (self.root / "REBUILD.md").write_text(self.reconstruction_doc(), encoding="ascii")
        write_json(self.root / "build-evidence.json", self.evidence)
        included = [p for p in self.root.rglob("*") if p.is_file() and (
            p.is_relative_to(self.root / "inputs") or p.is_relative_to(self.root / "logs") or
            p.name in ("rebuild-lxml-native.py", "REBUILD.md", "toolchain-lock.json", "build-evidence.json", "iconv-compatible-relink.patch") or
            p.suffix == ".map")]
        archive = self.root / "source-materials.zip"
        with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(included):
                z.write(p, p.relative_to(self.root).as_posix())
        products = {"sourceMaterials": checked_file(archive, sha(archive)),
                    "evidence": checked_file(self.root / "build-evidence.json", sha(self.root / "build-evidence.json"))}
        for phase, out in self.evidence["outputs"].items():
            products[phase] = out["wheel"]
        write_json(self.root / "artifact-sha256.json", products)

    def execute(self):
        try:
            materials = self.materials()
            baseline = stage_sources(materials, self.root / "baseline")
            self.evidence["status"] = "materials-verified-and-safely-extracted"
            if self.args.mode == "prepare":
                self.evidence["missingFacts"] += ["Native compilation and modified-libiconv relink not executed",
                                                "Exact executed development toolchain identities not recorded"]
                return
            self.toolchain(materials)
            for phase in ("baseline", "relink"):
                source = baseline if phase == "baseline" else stage_sources(materials, self.root / "relink")
                if phase == "relink":
                    self.patch_iconv(source)
                include, library = self.native(phase, source)
                output = self.wheel(phase, source, include, library)
                self.probe(phase, output)
            old, new = self.evidence["outputs"]["baseline"], self.evidence["outputs"]["relink"]
            if self.evidence["nativeLibraries"]["baseline"]["iconv_a.lib"]["sha256"] == self.evidence["nativeLibraries"]["relink"]["iconv_a.lib"]["sha256"]:
                raise RuntimeError("Modified libiconv archive did not change")
            if any(old["members"][n] == new["members"][n] for n in PYD_PINS):
                raise RuntimeError("Both extensions must change after modified-iconv relink")
            self.evidence["status"] = "native-baseline-and-compatible-relink-probes-passed"
            self.evidence["missingFacts"] += ["Independent Astra acceptance", "Final same-place source/binary release availability",
                                             "Recipient-owned application/runtime manifest reconstruction acceptance",
                                             "Mac native source/relink evidence outside this scope"]
        except Exception as exc:
            self.evidence.update(status="failed", failure=f"{type(exc).__name__}: {exc}")
            self.evidence["missingFacts"].append("Complete native baseline + modified-iconv relink acceptance remains unproven")
            raise
        finally:
            self.bundle()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="mode", required=True)
    snapshot = sub.add_parser("snapshot-tools")
    snapshot.add_argument("--site-packages", required=True)
    snapshot.add_argument("--output", required=True)
    fetch = sub.add_parser("fetch")
    fetch.add_argument("--materials-dir", required=True)
    tools_source = fetch.add_mutually_exclusive_group(required=True)
    tools_source.add_argument("--tools-url")
    tools_source.add_argument("--tools-archive")
    fetch.add_argument("--tools-sha256", required=True)
    for mode in ("prepare", "build"):
        command = sub.add_parser(mode)
        command.add_argument("--manifest", required=True)
        command.add_argument("--materials-dir", required=True)
        command.add_argument("--work", required=True)
        command.add_argument("--original-wheel")
        command.add_argument("--pbs", required=mode == "build")
        command.add_argument("--tools-archive", required=mode == "build")
        command.add_argument("--tools-sha256", required=mode == "build")
        command.add_argument("--vc-root", default="C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools")
        command.add_argument("--msvc-version", default="14.44.35207")
        command.add_argument("--sdk-version", default="10.0.26100.0")
        command.add_argument("--network-enforcement", choices=("python-audit-and-reviewed-native-targets", "disposable-ci-os-outbound-block"),
                             default="python-audit-and-reviewed-native-targets")
    args = p.parse_args(argv)
    if args.mode == "snapshot-tools":
        print(json.dumps(snapshot_tools(args.site_packages, args.output), indent=2))
    elif args.mode == "fetch":
        fetch_materials(args)
    else:
        Build(args).execute()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"lxml native checkpoint failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
