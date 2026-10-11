"""Fetch pinned public Mac dependency sources; never compile or execute them."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.request


UPSTREAM_COMMIT = "f9e4999ef79e1caa369f84cece0bdaf19a1ef550"
RAW_ROOT = "https://raw.githubusercontent.com/lxml/lxml/" + UPSTREAM_COMMIT + "/"
MATERIALS = (
    ("libiconv-1.18.tar.gz", "https://ftp.gnu.org/pub/gnu/libiconv/libiconv-1.18.tar.gz", "3b08f5f4f9b4eb82f151a7040bfd6fe6c6fb922efe4b1659c66ea933276965e8"),
    ("libxml2-2.14.6.tar.xz", "https://download.gnome.org/sources/libxml2/2.14/libxml2-2.14.6.tar.xz", "7ce458a0affeb83f0b55f1f4f9e0e55735dbfc1a9de124ee86fb4a66b597203a"),
    ("libxslt-1.1.43.tar.xz", "https://download.gnome.org/sources/libxslt/1.1/libxslt-1.1.43.tar.xz", "5a3d6b383ca5afc235b171118e90f5ff6aa27e9fea3303065231a6d403f0183a"),
    ("zlib-1.3.2.tar.gz", "https://zlib.net/zlib-1.3.2.tar.gz", "bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16"),
    ("wheels.yml", RAW_ROOT + ".github/workflows/wheels.yml", "16e5ba2ae3588552205f47bc1f52a5c2e7c0805c9066faa79bdb3cd2f139c302"),
    ("pyproject.toml", RAW_ROOT + "pyproject.toml", "98210cb689d4fbb2d79bc80d72a60746f5488133a34a65a62d5e530b00a18c2c"),
    ("buildlibxml.py", RAW_ROOT + "buildlibxml.py", "be99cde194739f2676e415e7b457d1dc6b94c00c5d86cae60ead44fcf3ea4c00"),
    ("libxslt-1.1.43-backport1.patch", RAW_ROOT + "libxslt-1.1.43-backport1.patch", "b09476968c53fb378d03b2fce2057d239008f016bc28bedf38d7abe5a683a04a"),
)
MAX_FILE_BYTES = 128 * 1024 * 1024


def fetch_material(destination, material, opener=None):
    name, url, expected = material
    if Path(name).name != name or not url.startswith("https://"):
        raise ValueError("Invalid fixed material")
    final = destination / name
    partial = destination / (name + ".partial")
    if final.exists() or partial.exists():
        raise ValueError("Material destination must be fresh")
    request = urllib.request.Request(url, headers={"User-Agent": "RT-ResearchFlow-source-materials/1.7"})
    opener = urllib.request.urlopen if opener is None else opener
    sha = hashlib.sha256()
    size = 0
    deadline = time.monotonic() + 120
    try:
        with opener(request, timeout=40) as response, partial.open("xb") as output:
            if not response.geturl().startswith("https://"):
                raise ValueError("Material redirected outside HTTPS")
            while True:
                if time.monotonic() > deadline:
                    raise TimeoutError("Public material deadline exceeded")
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise ValueError("Public material exceeds size limit")
                sha.update(chunk)
                output.write(chunk)
        if size == 0 or sha.hexdigest() != expected:
            raise ValueError("Public material SHA256 mismatch: " + name)
        partial.replace(final)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    result = {"filename": name, "url": url, "sha256": sha.hexdigest(), "size": size}
    print(json.dumps(result, sort_keys=True), flush=True)
    return result


def collect(destination):
    destination.mkdir(parents=True, exist_ok=False)
    results = [fetch_material(destination, material) for material in MATERIALS]
    receipt = {
        "kind": "rt-lxml-mac-source-materials-v1",
        "upstreamRecipeCommit": UPSTREAM_COMMIT,
        "files": results,
        "sourcesCompiled": False,
        "licenseApprovalGranted": False,
        "releaseEligible": False,
    }
    with (destination / "material-receipt.json").open("x", encoding="utf-8", newline="\n") as output:
        json.dump(receipt, output, ensure_ascii=True, sort_keys=True, indent=2)
        output.write("\n")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
        raise ValueError("Source acquisition requires the hosted build environment")
    temporary = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    output = Path(args.output_dir)
    if not output.is_absolute():
        raise ValueError("Source output must be absolute")
    output = output.resolve()
    if output == temporary:
        raise ValueError("Source output must not replace runner temporary root")
    output.relative_to(temporary)
    receipt = collect(output)
    print(json.dumps({"kind": receipt["kind"], "verifiedFiles": len(receipt["files"]), "releaseEligible": False}), flush=True)


if __name__ == "__main__":
    main()
