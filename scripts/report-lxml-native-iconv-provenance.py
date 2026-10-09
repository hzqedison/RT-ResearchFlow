"""Read-only native Mac iconv evidence for the exact consumed lxml wheel.

No compilation, network, provider execution, non-inclusion finding or license
approval. Source inputs are never changed; only runner-owned reports/scratch
copies are written. Symbol absence is not non-inclusion evidence. Runtime
dladdr receives targets read from each module's actual dyld binding slots.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import selectors
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
import zipfile


FLAGS = ["-X", "utf8", "-I", "-S", "-B"]
MEMBERS = ["lxml/" + name + ".cpython-313-darwin.so" for name in
           ("builder", "sax", "_elementpath", "objectify", "etree", "html/_difflib", "html/diff")]
# Final consumer-derived bytes from successful native assembly 37917355513.
FROZEN = {
    "darwin-arm64": {
        "wheel": "3be8dfec49d3f81162ba3b63ead0638e2cebe65921de28ea0b58ba587aa19f6d",
        "filename": "lxml-6.1.3+rt.redistribution.1-1rtredistribution-cp313-cp313-macosx_10_13_universal2.whl",
        "size": 8532649,
        "members": [
            (287536, "8cf8988b7fb4f711297bb1df2f6223cf3d964d233470947045fd146e35b50baa"),
            (408360, "f89ee8c2fa0a0ee551ebc1f46544146a2b01cf354ac716efda266227cdc04d30"),
            (458192, "7f48c24595a0128ec1bf698b1837a67066dcfc06f3e455ef5725d2c432637fd4"),
            (5261584, "2274be3aa348e35ad54811381598d81667af7585b6e96e3ae0a6c90d63001abb"),
            (9589736, "72586d22e6f24f79757cf657b04575e671f76e98d91fb624e3595c2b6e3ca63a"),
            (1083136, "fd84f302da16f5d1426fd83a86bada4b781ab7d43cc152625fa83cf7a51e3b74"),
            (704360, "450c1554ad8d7b2af1a5cc8162b3a2292641a18c2fdde4f09fad5efc43d5a1c2"),
        ],
    },
    "darwin-x64": {
        "wheel": "11a9a6fcc74a18e120ef36fcd4d1652c0e7684bb46025616d5af99de8f98cdf8",
        "filename": "lxml-6.1.3+rt.redistribution.1-1rtredistribution-cp313-cp313-macosx_10_13_x86_64.whl",
        "size": 4580111,
        "members": [
            (115520, "4c16d46dbb17029b2229b203c34729aa818b7d5641705364ac6c519aaa00c41e"),
            (173272, "693b2e2cdee59f844c3dd2b18fc115193be3bda711b0afb9aaafce0a811e4e0f"),
            (206856, "3533ae5c99f86a5896b3a14795b79fed6b9ef713b6a8176ee3635cabe847d737"),
            (2613384, "0749a26f5ce39c61a0cf3ab15a9e58ca5c64e79beb6ec69fbeaa8904f64e9e00"),
            (4796392, "5ada4dfcb1b76a1acc45cced5dcce931a143005d23745ece656559820d3ad395"),
            (523456, "8c7783a60ceafa9588589a47466c13282574f2cfed99775301f7875327a97f5c"),
            (330696, "ecf424b98d6252ccbadc97e478ef7d88164f0eb13e314e5a667391294cacca71"),
        ],
    },
}
ICONV = re.compile(r"iconv|libcharset|locale_charset", re.I)
LIMITS = {"totalSeconds": 180, "commandSeconds": 15, "runtimeSeconds": 30,
          "stdoutBytes": 2097152, "stderrBytes": 65536, "totalRawBytes": 25165824}


def require(value, reason):
    if not value:
        raise ValueError(reason)


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


def sha_file(path, cap=67108864):
    require(path.is_file() and path.stat().st_size <= cap, "INPUT_SIZE_OR_TYPE")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1048576), b""):
            digest.update(block)
    return digest.hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def read_json(path):
    require(path.is_file() and 0 < path.stat().st_size <= 262144, "JSON_BOUND")
    return json.loads(path.read_bytes(), object_pairs_hook=unique_object)


def contract_from_consumer(data):
    target = data.get("target")
    require(target in FROZEN, "CONSUMER_TARGET")
    expected = FROZEN[target]
    wheel = data["wheel"]
    asset = wheel["asset"]
    require(wheel["kind"] == "rt-lxml-redistribution-wheel-v1" and asset["kind"] == "derived", "CONSUMER_KIND")
    require(asset["filename"] == expected["filename"] and asset["sha256"] == expected["wheel"] and
            type(asset["size"]) is int and asset["size"] == expected["size"], "FROZEN_WHEEL_PIN")
    pins = wheel["nativeMemberPins"]
    require(isinstance(pins, list) and len(pins) == 7, "SEVEN_NATIVE_PINS_REQUIRED")
    indexed = {}
    for row in pins:
        require(row["path"] in MEMBERS and row["path"] not in indexed, "NATIVE_MEMBER_PATH")
        size, digest = expected["members"][MEMBERS.index(row["path"])]
        require(type(row["size"]) is int and row["size"] == size and row["sha256"] == digest, "FROZEN_NATIVE_PIN")
        indexed[row["path"]] = {"path": row["path"], "size": size, "sha256": digest}
    return target, dict(asset), [indexed[name] for name in MEMBERS]


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proof-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    for flag in ("--proof-dir", "--output-dir"):
        if sum(word == flag or word.startswith(flag + "=") for word in argv) > 1:
            parser.error("duplicate argument")
    args = parser.parse_args(argv)
    if not args.proof_dir.is_absolute() or not args.output_dir.is_absolute():
        parser.error("absolute paths required")
    return args


def child_environment(home):
    return {"PATH": "/usr/bin:/bin", "HOME": str(home), "TMPDIR": str(home),
            "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "PYTHONUTF8": "1",
            "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": ""}


def run_command(argv, label, output, env, deadline, budget, seconds=15):
    require(time.monotonic() < deadline and budget[0] < LIMITS["totalRawBytes"], "REPORT_BUDGET_EXHAUSTED")
    start = time.monotonic()
    row = {"argv": argv, "startedAt": stamp(), "stdoutFile": label + ".stdout.txt",
           "stderrFile": label + ".stderr.txt"}
    data = {"stdout": bytearray(), "stderr": bytearray()}
    received = {"stdout": 0, "stderr": 0}
    with subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, shell=False, close_fds=True, start_new_session=True) as process:
        row["pid"] = process.pid
        end = min(deadline, start + seconds)
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, "stdout")
            selector.register(process.stderr, selectors.EVENT_READ, "stderr")
            cancelled = None
            while selector.get_map():
                if cancelled is None and time.monotonic() >= end:
                    cancelled = "TIMEOUT"
                if cancelled:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    if time.monotonic() >= end + 2:
                        break
                for key, _ in selector.select(0.05):
                    block = os.read(key.fd, 65536)
                    if not block:
                        selector.unregister(key.fileobj)
                        continue
                    channel = key.data
                    received[channel] += len(block)
                    cap = LIMITS[channel + "Bytes"]
                    allowed = max(0, min(cap - len(data[channel]), LIMITS["totalRawBytes"] - budget[0]))
                    retained = block[:allowed]
                    data[channel].extend(retained)
                    budget[0] += len(retained)
                    if len(retained) != len(block) and cancelled is None:
                        cancelled = "OUTPUT_CAP"
                        end = time.monotonic()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                cancelled = cancelled or "TIMEOUT"
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=2)
        row.update(exitCode=process.returncode, exitObservedAt=stamp(), elapsedMs=round((time.monotonic() - start) * 1000),
                   interruption=cancelled)
    for channel in ("stdout", "stderr"):
        raw = bytes(data[channel])
        (output / row[channel + "File"]).write_bytes(raw)
        row[channel + "BytesReceived"] = received[channel]
        row[channel + "CapturedSha256"] = hashlib.sha256(raw).hexdigest()
        row[channel + "Truncated"] = received[channel] != len(raw)
    row["iconvLines"] = [{"line": number, "text": line[:2048]} for number, line in
                         enumerate(data["stdout"].decode("utf-8", "replace").splitlines(), 1) if ICONV.search(line)][:1024]
    return row, bytes(data["stdout"])


def successful(row):
    return row["exitCode"] == 0 and row["interruption"] is None and not row["stdoutTruncated"] and not row["stderrTruncated"]


def macho_slices(data):
    """Only the thin-64 / fat-32 formats actually present in these frozen pins."""
    require(len(data) >= 32, "MACHO_HEADER_BOUND")
    if data[:4] == b"\xca\xfe\xba\xbe":
        count = struct.unpack_from(">I", data, 4)[0]
        require(0 < count <= 8 and 8 + 20 * count <= len(data), "FAT_HEADER_BOUND")
        slices = [struct.unpack_from(">IIIII", data, 8 + 20 * index)[2:4] for index in range(count)]
    else:
        slices = [(0, len(data))]
    result = []
    for base, size in slices:
        require(size >= 32 and 0 <= base <= len(data) - size, "MACHO_SLICE_BOUND")
        require(data[base:base + 4] == b"\xcf\xfa\xed\xfe", "UNSUPPORTED_MACHO_FORMAT")
        cpu = struct.unpack_from("<I", data, base + 4)[0]
        require(cpu in (0x1000007, 0x100000C), "UNSUPPORTED_MACHO_CPU")
        result.append(("x86_64" if cpu == 0x1000007 else "arm64", base, size))
    require(len({row[0] for row in result}) == len(result), "DUPLICATE_MACHO_ARCH")
    return result


def analyse_slice(data, arch, base, size):
    def fields(fmt, offset):
        width = struct.calcsize(fmt)
        require(0 <= offset <= size - width, "MACHO_FIELD_BOUND")
        return struct.unpack_from(fmt, data, base + offset)

    def text(offset, limit):
        require(0 <= offset < limit <= size, "MACHO_STRING_BOUND")
        end = data.find(b"\0", base + offset, base + min(limit, offset + 4096))
        require(end >= 0, "MACHO_STRING_TERMINATOR")
        return data[base + offset:end].decode("utf-8", "replace")

    header = fields("<IiiIIIII", 0)
    require(header[4] <= 256 and 32 + header[5] <= size, "MACHO_COMMAND_BOUND")
    cursor = 32
    segments, sections, libraries = [], [], []
    symtab = indirect = dyld = None
    for _ in range(header[4]):
        cmd, length = fields("<II", cursor)
        require(length >= 8 and cursor + length <= 32 + header[5], "MACHO_COMMAND_SIZE")
        if cmd == 0x19:
            values = fields("<II16sQQQQiiII", cursor)
            require(length >= 72 + values[9] * 80 and values[9] <= 256, "MACHO_SECTION_BOUND")
            segment = {"name": values[2].split(b"\0")[0].decode("ascii"), "vmAddress": values[3],
                       "vmSize": values[4], "fileOffset": values[5], "fileSize": values[6], "initialProtection": values[8]}
            segments.append(segment)
            for index in range(values[9]):
                section = fields("<16s16sQQIIIIIIII", cursor + 72 + index * 80)
                require(segment["vmAddress"] <= section[2] and section[2] + section[3] <= segment["vmAddress"] + segment["vmSize"], "SECTION_VM_BOUND")
                sections.append({"name": section[0].split(b"\0")[0].decode("ascii"), "segment": segment["name"],
                                 "vmAddress": section[2], "size": section[3], "flags": section[8], "indirectStart": section[9]})
        elif cmd in (0xC, 0x80000018, 0x8000001F, 0x20, 0x80000023):
            values = fields("<IIIIII", cursor)
            require(24 <= values[2] < length, "DYLIB_NAME_BOUND")
            libraries.append({"ordinal": len(libraries) + 1, "name": text(cursor + values[2], cursor + length),
                              "currentVersionRaw": values[4], "compatibilityVersionRaw": values[5]})
        elif cmd == 2:
            symtab = fields("<IIIIII", cursor)[2:]
        elif cmd == 11:
            indirect = fields("<20I", cursor)[14:16]
        elif cmd in (0x22, 0x80000022):
            dyld = fields("<12I", cursor)
        cursor += length
    require(cursor == 32 + header[5], "MACHO_COMMAND_EXTENT")
    text_segment = next(row for row in segments if row["name"] == "__TEXT")
    require(text_segment["fileOffset"] == 0, "MACHO_HEADER_VM_MAPPING")
    require(symtab is not None and indirect is not None, "MACHO_SYMBOL_TABLE_REQUIRED")
    symoff, count, stroff, strsize = symtab
    require(count <= 200000 and symoff + 16 * count <= size and stroff + strsize <= size, "SYMBOL_TABLE_BOUND")
    symbols = []
    for index in range(count):
        name_offset, kind, section_index, desc, value = fields("<IBBHQ", symoff + 16 * index)
        require(name_offset < strsize, "SYMBOL_STRING_BOUND")
        name = text(stroff + name_offset, stroff + strsize)
        symbol = {"index": index, "symbol": name, "nType": kind, "nDesc": desc, "preferredValue": value,
                  "kind": "undefined" if kind & 0xE == 0 and value == 0 else "defined",
                  "section": sections[section_index - 1] if 0 < section_index <= len(sections) else None}
        symbols.append(symbol)
    indirect_offset, indirect_count = indirect
    require(indirect_count <= 200000 and indirect_offset + indirect_count * 4 <= size, "INDIRECT_TABLE_BOUND")
    pointer_slots = {}
    for section in sections:
        if section["flags"] & 255 not in (6, 7, 16):
            continue
        require(section["size"] % 8 == 0 and section["indirectStart"] + section["size"] // 8 <= indirect_count, "POINTER_SECTION_BOUND")
        for index in range(section["size"] // 8):
            symbol_index = fields("<I", indirect_offset + (section["indirectStart"] + index) * 4)[0]
            if symbol_index & 0xC0000000:
                continue
            require(symbol_index < len(symbols), "INDIRECT_SYMBOL_INDEX")
            pointer_slots[section["vmAddress"] + index * 8] = (section, symbols[symbol_index])
    matches = [row for row in symbols if not row["nType"] & 0xE0 and ICONV.search(row["symbol"])]
    for symbol in matches:
        section = symbol["section"]
        if (symbol["kind"] == "defined" and symbol["symbol"].lstrip("_") == "libiconv_version" and
                section and section["segment"].startswith("__DATA")):
            segment = next(row for row in segments if row["name"] == section["segment"])
            displacement = symbol["preferredValue"] - segment["vmAddress"]
            if 0 <= displacement <= segment["fileSize"] - 4:
                offset = segment["fileOffset"] + displacement
                symbol.update(observedDefinitionDataInteger=fields("<I", offset)[0],
                              observedDefinitionDataHex=hex(fields("<I", offset)[0]),
                              definitionDataSliceFileOffset=offset,
                              versionSource="frozen-member-slice named data definition; static bytes, not runtime load")
    result = {"arch": arch, "sliceOffset": base, "sliceSize": size,
              "sliceSha256": hashlib.sha256(data[base:base + size]).hexdigest(), "preferredHeaderVmAddress": text_segment["vmAddress"],
              "readableSegments": [row for row in segments if row["initialProtection"] & 1],
              "libraries": libraries, "iconvSymbols": matches, "bindings": [], "gaps": [],
              "runtimeScope": "static-only unless this architecture is the actual runtime host"}
    if dyld is None:
        result["gaps"].append("DYLD_BIND_STREAM_UNAVAILABLE")
        return result
    for stream, offset, length in (("bind", dyld[4], dyld[5]), ("weak", dyld[6], dyld[7]), ("lazy", dyld[8], dyld[9])):
        require(offset + length <= size and length <= 2097152, "BIND_STREAM_BOUND")
        payload = data[base + offset:base + offset + length]
        try:
            result["bindings"].extend(parse_bind_stream(payload, stream, segments, libraries, pointer_slots))
        except ValueError as error:
            result["gaps"].append("%s:%s" % (stream, error))
    return result


def parse_bind_stream(payload, stream, segments, libraries, pointer_slots):
    cursor = 0
    result = []
    state = {"ordinal": None if stream == "weak" else 0, "symbol": None, "type": 1, "segment": None, "offset": 0, "addend": 0}

    def leb(signed=False):
        nonlocal cursor
        value = shift = 0
        for _ in range(10):
            require(cursor < len(payload), "BIND_LEB_BOUND")
            byte = payload[cursor]; cursor += 1
            value |= (byte & 127) << shift; shift += 7
            if not byte & 128:
                if signed and byte & 64:
                    value -= 1 << shift
                require(-(1 << 63) <= value < (1 << 64), "BIND_LEB_OVERFLOW")
                return value
        raise ValueError("BIND_LEB_OVERFLOW")

    def emit():
        require(state["segment"] is not None and state["segment"] < len(segments) and state["symbol"] is not None, "BIND_STATE")
        segment = segments[state["segment"]]
        require(0 <= state["offset"] <= segment["vmSize"] - 8, "BIND_SLOT_VM_BOUND")
        if not ICONV.search(state["symbol"]):
            return
        address = segment["vmAddress"] + state["offset"]
        ordinal = state["ordinal"]
        library = libraries[ordinal - 1] if ordinal is not None and 0 < ordinal <= len(libraries) else None
        pointer = pointer_slots.get(address)
        require(state["type"] == 1 and pointer is not None and pointer[1]["symbol"] == state["symbol"], "ICONV_POINTER_SLOT_REQUIRED")
        result.append({"symbol": state["symbol"], "preferredSlotVmAddress": address,
                       "section": pointer[0]["segment"] + "," + pointer[0]["name"], "libraryOrdinal": ordinal,
                       "library": library, "indirectSymbolNDesc": pointer[1]["nDesc"], "addend": state["addend"],
                       "bindingMetadataSource": "LC_DYLD_INFO_ONLY:" + stream})

    operations = 0
    while cursor < len(payload):
        byte = payload[cursor]; cursor += 1; opcode, immediate = byte & 240, byte & 15
        operations += 1; require(operations <= 200000, "BIND_OPERATION_BOUND")
        if opcode == 0:
            if stream != "lazy":
                break
            state = {"ordinal": 0, "symbol": None, "type": 1, "segment": None, "offset": 0, "addend": 0}
        elif opcode == 0x10: state["ordinal"] = immediate
        elif opcode == 0x20: state["ordinal"] = leb()
        elif opcode == 0x30: state["ordinal"] = immediate - 16 if immediate else 0
        elif opcode == 0x40:
            end = payload.find(b"\0", cursor, min(len(payload), cursor + 4096))
            require(end >= 0, "BIND_SYMBOL_BOUND")
            state["symbol"] = payload[cursor:end].decode("utf-8", "replace"); cursor = end + 1
        elif opcode == 0x50: state["type"] = immediate
        elif opcode == 0x60: state["addend"] = leb(True)
        elif opcode == 0x70: state["segment"] = immediate; state["offset"] = leb()
        # dyld uses uint64_t offsets; real frozen streams encode backwards
        # movement as unsigned additions that wrap, not signed LEB values.
        elif opcode == 0x80: state["offset"] = (state["offset"] + leb()) & 0xFFFFFFFFFFFFFFFF
        elif opcode in (0x90, 0xA0, 0xB0):
            emit()
            state["offset"] = (state["offset"] + 8 + (leb() if opcode == 0xA0 else immediate * 8 if opcode == 0xB0 else 0)) & 0xFFFFFFFFFFFFFFFF
        elif opcode == 0xC0:
            count, skip = leb(), leb(); require(count <= 200000 - operations, "BIND_REPEAT_BOUND")
            operations += count
            for _ in range(count): emit(); state["offset"] = (state["offset"] + 8 + skip) & 0xFFFFFFFFFFFFFFFF
        else: raise ValueError("UNSUPPORTED_BIND_OPCODE_%02X" % opcode)
    return result


RUNTIME_PROBE = r'''
import ctypes, hashlib, importlib, json, os, pathlib, platform, sys
root=pathlib.Path(sys.argv[1]); pins=json.loads(pathlib.Path(sys.argv[2]).read_bytes())
assert sys.platform=='darwin' and sys.version_info[:2]==(3,13)
assert sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and sys.flags.utf8_mode==1
sys.path.insert(0,str(root))
class DlInfo(ctypes.Structure):
    _fields_=[('filename',ctypes.c_char_p),('base',ctypes.c_void_p),
              ('symbol',ctypes.c_char_p),('symbolAddress',ctypes.c_void_p)]
system=ctypes.CDLL('/usr/lib/libSystem.B.dylib')
system.dladdr.argtypes=[ctypes.c_void_p,ctypes.POINTER(DlInfo)]; system.dladdr.restype=ctypes.c_int
def decode(value): return value.decode('utf-8','replace') if value else None
modules=[]; loaded={}
for pin in pins:
    name=pin['path'].split('.cpython-',1)[0].replace('/','.')
    expected=(root/pin['path']).resolve()
    row={'module':name,'member':pin['path'],'bindings':[],'versionDefinitions':[]}
    try:
        module=importlib.import_module(name); actual=pathlib.Path(module.__file__).resolve()
        assert actual==expected and actual.stat().st_size==pin['size']
        assert hashlib.sha256(actual.read_bytes()).hexdigest()==pin['sha256']
        row['actualImportedFile']=str(actual); row['actualSha256']=pin['sha256']
        loaded[pin['path']]=actual
    except Exception as error:
        row['error']={'type':type(error).__name__,'message':str(error)[:1024]}
    modules.append(row)
images=[]; image_error=None; count=None
image_headers={}
try:
    dyld=ctypes.CDLL(None)
    dyld._dyld_image_count.argtypes=[]; dyld._dyld_image_count.restype=ctypes.c_uint32
    dyld._dyld_get_image_name.argtypes=[ctypes.c_uint32]; dyld._dyld_get_image_name.restype=ctypes.c_char_p
    dyld._dyld_get_image_header.argtypes=[ctypes.c_uint32]; dyld._dyld_get_image_header.restype=ctypes.c_void_p
    dyld._dyld_get_image_vmaddr_slide.argtypes=[ctypes.c_uint32]; dyld._dyld_get_image_vmaddr_slide.restype=ctypes.c_int64
    count=dyld._dyld_image_count(); assert count<=1024
    for index in range(count):
        name=decode(dyld._dyld_get_image_name(index))
        if name and ('iconv' in name.lower() or str(root) in name): images.append({'index':index,'name':name})
        if name and str(root) in name:
            image_headers[str(pathlib.Path(name).resolve())]=(dyld._dyld_get_image_header(index),dyld._dyld_get_image_vmaddr_slide(index))
except Exception as error: image_error={'type':type(error).__name__,'message':str(error)[:1024]}
conversion=None; conversion_error=None
try:
    from lxml import etree
    xml=b"<?xml version='1.0' encoding='SHIFT_JIS'?><r>\x82\xa0</r>"
    element=etree.fromstring(xml,parser=etree.XMLParser(no_network=True,resolve_entities=False))
    from lxml import objectify
    objectified=objectify.fromstring(xml,parser=etree.XMLParser(no_network=True,resolve_entities=False))
    conversion={'encoding':'SHIFT_JIS','textCodepoints':[ord(c) for c in element.text],
                'objectifyTextCodepoints':[ord(c) for c in str(objectified)],
                'libxmlVersion':list(etree.LIBXML_VERSION),'libxsltVersion':list(etree.LIBXSLT_VERSION)}
except Exception as error: conversion_error={'type':type(error).__name__,'message':str(error)[:1024]}
for pin,row in zip(pins,modules):
    if row.get('error'): continue
    try:
        header,slide=image_headers[str(loaded[pin['path']])]; analysis=pin['runtimeSlice']
        assert analysis['arch']==platform.machine() and header==slide+analysis['preferredHeaderVmAddress']
        row.update(actualImageHeader=hex(header),actualImageSlide=slide,runtimeArch=platform.machine())
        def in_readable(address,width):
            return any(slide+s['vmAddress']<=address and address+width<=slide+s['vmAddress']+s['vmSize'] for s in analysis['readableSegments'])
        for binding in analysis['bindings']:
            address=slide+binding['preferredSlotVmAddress']; assert in_readable(address,8)
            target=ctypes.c_void_p.from_address(address).value
            item={**binding,'actualSlotAddress':hex(address),'actualSlotTarget':hex(target) if target else None,
                  'attributionStatus':'pending'}
            if target:
                info=DlInfo(); result=system.dladdr(target,ctypes.byref(info)); item['dladdrReturn']=result
                if result:
                    image=decode(info.filename); symbol=decode(info.symbol)
                    item.update(actualTargetImage=image,actualTargetImageBase=hex(info.base) if info.base else None,
                                actualTargetSymbol=symbol,actualTargetSymbolAddress=hex(info.symbolAddress) if info.symbolAddress else None)
                    library=binding['library']
                    if library and library['name']==image and symbol and 'iconv' in symbol.lower():
                        item['attributionStatus']='ordinal-and-actual-target-image-observed'
                    if binding['symbol'].lstrip('_')=='libiconv_version' and symbol and symbol.lstrip('_')=='libiconv_version':
                        value=ctypes.c_int.from_address(target).value
                        item.update(observedVersionInteger=value,observedVersionHex=hex(value),versionSource='actual-module-binding-slot-target-data')
            row['bindings'].append(item)
        for definition in analysis['iconvSymbols']:
            section=definition['section']
            if definition['kind']=='defined' and section:
                address=slide+definition['preferredValue']; assert in_readable(address,1)
                info=DlInfo(); result=system.dladdr(address,ctypes.byref(info))
                row.setdefault('actualInternalDefinitions',[]).append({'symbol':definition['symbol'],
                    'actualAddress':hex(address),'dladdrReturn':result,
                    'actualImage':decode(info.filename) if result else None,
                    'actualNearestSymbol':decode(info.symbol) if result else None,
                    'source':'defined symbol in actually loaded frozen module; not imported system lookup'})
            if definition['kind']=='defined' and definition['symbol'].lstrip('_')=='libiconv_version' and section and section['segment'].startswith('__DATA'):
                address=slide+definition['preferredValue']; assert in_readable(address,4)
                value=ctypes.c_int.from_address(address).value
                row['versionDefinitions'].append({'symbol':definition['symbol'],'actualAddress':hex(address),
                       'observedVersionInteger':value,'observedVersionHex':hex(value),'source':'named-data-definition-in-actually-loaded-pinned-member'})
    except Exception as error:
        row['bindingError']={'type':type(error).__name__,'message':str(error)[:1024]}
print(json.dumps({'kind':'rt-lxml-iconv-live-address-evidence-v1','pid':os.getpid(),
      'platform':sys.platform,'arch':platform.machine(),'pythonExecutable':sys.executable,'pythonVersion':sys.version,
      'modules':modules,'dyldImageCount':count,'selectedLoadedImages':images,'dyldImageError':image_error,
      'localConversion':conversion,'localConversionError':conversion_error,
      'bindingScope':'dladdr on target pointers read from actual module slots identified by frozen Mach-O dyld binding streams; current host architecture only'},allow_nan=False))
'''


def extract_pinned_wheel(wheel, destination, pins):
    with zipfile.ZipFile(wheel) as archive:
        infos = archive.infolist()
        require(len(infos) <= 2048 and len({info.filename for info in infos}) == len(infos), "ZIP_INVENTORY_BOUND")
        require(sum(info.file_size for info in infos) <= 134217728, "ZIP_EXPANSION_BOUND")
        native = {info.filename for info in infos if info.filename.endswith((".so", ".dylib", ".bundle", ".pyd"))}
        require(native == set(MEMBERS), "NATIVE_INVENTORY_MISMATCH")
        for info in infos:
            name = PurePosixPath(info.filename)
            require(not name.is_absolute() and ".." not in name.parts and "\\" not in info.filename and
                    not any("\x00" in part or ":" in part for part in name.parts) and
                    not stat.S_ISLNK(info.external_attr >> 16), "UNSAFE_ZIP_MEMBER")
            require(info.file_size <= 33554432 and not info.flag_bits & 1, "ZIP_MEMBER_BOUND")
            if info.is_dir():
                continue
            target = destination.joinpath(*name.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, target.open("xb") as output:
                data = source.read(info.file_size + 1)
                require(len(data) == info.file_size, "ZIP_MEMBER_SIZE")
                output.write(data)
        for pin in pins:
            file = destination / pin["path"]
            require(file.stat().st_size == pin["size"] and sha_file(file) == pin["sha256"], "NATIVE_BYTE_MISMATCH")


def collect(args, report):
    require(sys.platform == "darwin", "NATIVE_MAC_REQUIRED")
    arch = platform.machine()
    require(arch in ("arm64", "x86_64"), "NATIVE_ARCH_REQUIRED")
    target = "darwin-arm64" if arch == "arm64" else "darwin-x64"
    proof = args.proof_dir.resolve(strict=True)
    consumer_file = proof / "derived/consumer-evidence.json"
    data = read_json(consumer_file)
    consumed_target, asset, pins = contract_from_consumer(data)
    require(consumed_target == target, "ACTUAL_TARGET_MISMATCH")
    repack_file = proof / "derived/wheel/repack-evidence.json"
    repack = read_json(repack_file)
    require(contract_from_consumer({"target": target, "wheel": repack}) == (target, asset, pins), "REPACK_CONSUMER_MISMATCH")
    wheel = proof / "derived/wheel" / asset["filename"]
    require(wheel.stat().st_size == asset["size"] and sha_file(wheel) == asset["sha256"], "WHEEL_BYTE_MISMATCH")
    repo = Path(__file__).resolve().parent.parent
    policy_file = repo / "resources/python-runtime/preparation.policy.json"
    python_asset = read_json(policy_file)["targets"][target]["python"]["asset"]
    archive = proof / "python.tar.gz"
    require(type(python_asset["size"]) is int and archive.stat().st_size == python_asset["size"] and
            sha_file(archive) == python_asset["sha256"], "PRIVATE_PBS_ARCHIVE_MISMATCH")
    python = (proof / "toolchain/python/bin/python3.13").resolve(strict=True)
    require(Path(sys.executable).resolve(strict=True) == python and sys.version_info[:2] == (3, 13), "EXACT_CONSUMER_PBS_REQUIRED")
    require(sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and sys.flags.utf8_mode == 1, "ISOLATION_REQUIRED")
    report.update(target=target, platform=sys.platform, arch=arch, osVersion=platform.mac_ver()[0],
                  consumerEvidenceSha256=sha_file(consumer_file), repackEvidenceSha256=sha_file(repack_file),
                  wheel=asset, nativeMemberPins=pins, privatePython={"executable": str(python), "sha256": sha_file(python),
                  "version": sys.version, "archiveSha256": python_asset["sha256"], "policySha256": sha_file(policy_file)})
    deadline = time.monotonic() + LIMITS["totalSeconds"]
    budget = [0]
    env = child_environment(args.output_dir)
    tools = {name: "/usr/bin/" + name for name in ("nm", "otool", "dyld_info", "dyldinfo")
             if os.path.isfile("/usr/bin/" + name) and os.access("/usr/bin/" + name, os.X_OK)}
    report["tools"] = dict(tools)
    if "dyld_info" not in tools and "dyldinfo" not in tools and os.access("/usr/bin/xcrun", os.X_OK):
        row, raw = run_command(["/usr/bin/xcrun", "--find", "dyld_info"], "discover-dyld-info", args.output_dir, env, deadline, budget)
        report["discovery"] = row
        found = raw.decode("utf-8", "replace").strip()
        if (successful(row) and found.startswith(("/Applications/", "/Library/Developer/", "/usr/")) and
                Path(found).name == "dyld_info" and "\n" not in found and os.path.isfile(found) and os.access(found, os.X_OK)):
            tools["dyld_info"] = found
            report["tools"] = dict(tools)
    for required in ("nm", "otool"):
        if required not in tools:
            report["gaps"].append("SYSTEM_TOOL_UNAVAILABLE:" + required)
    if "dyld_info" not in tools and "dyldinfo" not in tools:
        report["gaps"].append("DYLD_IMPORT_BIND_TOOL_UNAVAILABLE")
    report["members"] = []
    with tempfile.TemporaryDirectory(prefix="lxml-iconv-readonly-", dir=proof.parent) as directory:
        scratch = Path(directory)
        extract_pinned_wheel(wheel, scratch, pins)
        manifest = scratch / "native-pins.json"
        runtime_pins = []
        for index, pin in enumerate(pins):
            member = {"pin": pin, "slices": [], "commands": []}
            report["members"].append(member)
            file = str(scratch / pin["path"])
            native_bytes = Path(file).read_bytes()
            slices = macho_slices(native_bytes)
            expected_arches = {"arm64", "x86_64"} if target == "darwin-arm64" else {"x86_64"}
            require({item[0] for item in slices} == expected_arches, "EXACT_SLICE_INVENTORY")
            for slice_arch, base, size in slices:
                analysis = analyse_slice(native_bytes, slice_arch, base, size)
                analysis["runtimeScope"] = "current-host actual load requested" if slice_arch == arch else "static-only; not runtime-loaded"
                member["slices"].append(analysis)
                report["gaps"].extend("STATIC_BINDING_GAP:%s:%s:%s" % (pin["path"], slice_arch, gap) for gap in analysis["gaps"])
                if any(symbol["kind"] == "defined" for symbol in analysis["iconvSymbols"]):
                    report["gaps"].append("INTERNAL_ICONV_DEFINITION_REQUIRES_SOURCE_REVIEW:%s:%s" % (pin["path"], slice_arch))
                if any(binding["library"] is None for binding in analysis["bindings"]):
                    report["gaps"].append("STATIC_BINDING_ORDINAL_UNATTRIBUTED:%s:%s" % (pin["path"], slice_arch))
                if slice_arch == arch:
                    runtime_pins.append(dict(pin, runtimeSlice=analysis))
                commands = []
                if "nm" in tools:
                    commands.extend([(tools["nm"], "nm-m", ["-arch", slice_arch, "-m", file]),
                                     (tools["nm"], "nm-u", ["-arch", slice_arch, "-u", file])])
                if "otool" in tools:
                    commands.append((tools["otool"], "otool-libraries", ["-arch", slice_arch, "-L", file]))
                if "dyld_info" in tools:
                    commands.extend([(tools["dyld_info"], "dyld-imports", ["-arch", slice_arch, "-imports", file]),
                                     (tools["dyld_info"], "dyld-fixups", ["-arch", slice_arch, "-fixups", file])])
                elif "dyldinfo" in tools:
                    commands.append((tools["dyldinfo"], "dyld-bind", ["-arch", slice_arch, "-bind", "-lazy_bind", "-weak_bind", file]))
                for tool, name, arguments in commands:
                    row, _ = run_command([tool] + arguments, "%02d-%s-%s" % (index, slice_arch, name), args.output_dir, env, deadline, budget)
                    row["arch"] = slice_arch
                    member["commands"].append(row)
                    if not successful(row):
                        report["gaps"].append("INCOMPLETE_COMMAND:%s:%s:%s" % (pin["path"], slice_arch, name))
            require(time.monotonic() < deadline, "TOTAL_DEADLINE")
        require(len(runtime_pins) == len(pins), "RUNTIME_SLICE_INVENTORY")
        manifest.write_text(json.dumps(runtime_pins), encoding="utf-8")
        row, raw = run_command([str(python)] + FLAGS + ["-c", RUNTIME_PROBE, str(scratch), str(manifest)],
                               "private-pbs-runtime", args.output_dir, env, deadline, budget, LIMITS["runtimeSeconds"])
        report["runtimeCommand"] = row
        if successful(row):
            live = json.loads(raw, object_pairs_hook=unique_object)
            require(live["platform"] == "darwin" and live["arch"] == arch and live["pid"] == row["pid"], "ACTUAL_RUNTIME_IDENTITY")
            require(Path(live["pythonExecutable"]).resolve(strict=True) == python, "ACTUAL_RUNTIME_PBS")
            report["runtime"] = live
            require([module["member"] for module in live["modules"]] == [pin["path"] for pin in pins], "ACTUAL_RUNTIME_MEMBER_INVENTORY")
            if any(module.get("error") or module.get("bindingError") for module in live["modules"]) or live["dyldImageError"] or live["localConversionError"]:
                report["gaps"].append("RUNTIME_OBSERVATION_INCOMPLETE")
            if any(binding["attributionStatus"] == "pending" for module in live["modules"] for binding in module["bindings"]):
                report["gaps"].append("ACTUAL_MODULE_BINDING_TARGET_UNATTRIBUTED")
            report["attributionReview"] = "pending independent review; observed targets do not exclude unnamed internal implementations"
        else:
            report["gaps"].append("RUNTIME_COMMAND_INCOMPLETE")
    report["status"] = "partial" if report["gaps"] else "complete"


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    require(args.proof_dir.is_dir() and not args.output_dir.exists() and not args.output_dir.is_symlink(), "FRESH_REPORT_DIRECTORY_REQUIRED")
    require(args.output_dir.parent.resolve(strict=True) == args.proof_dir.resolve(strict=True).parent and
            args.output_dir != args.proof_dir, "RUNNER_TEMP_SIBLING_REQUIRED")
    args.output_dir.mkdir()
    report = {"kind": "rt-lxml-native-iconv-provenance-v1", "status": "collecting", "startedAt": stamp(),
              "releaseEligible": False, "licenseApproval": "not granted by this reporter", "gaps": [],
              "reporterSha256": sha_file(Path(__file__)), "limits": LIMITS,
              "limitations": ["No non-inclusion finding is made, including for stripped or unavailable symbols.",
                               "GNU-named definitions/version symbols and system image paths require independent source/notice review.",
                               "Runtime addresses come only from actual module binding slots; other architecture slices are static evidence only.",
                               "No absence of GNU-named symbols excludes internal or static implementations; attribution review remains pending."]}
    exit_code = 0
    try:
        collect(args, report)
        if report["status"] != "complete":
            exit_code = 2
    except Exception as error:
        report.update(status="failed", error={"type": type(error).__name__, "message": str(error)[:2048]})
        exit_code = 2
    report["finishedAt"] = stamp()
    path = args.output_dir / "iconv-provenance.json"
    path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"kind": report["kind"], "status": report["status"], "report": str(path),
                      "releaseEligible": False, "gapCount": len(report["gaps"])}))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
