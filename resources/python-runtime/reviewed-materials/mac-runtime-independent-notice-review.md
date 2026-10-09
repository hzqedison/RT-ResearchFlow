# Independent Mac runtime original-notice review

Reviewer: Astra. Date: 2026-10-10.

## Decision and limits

72 exact notice approval records may be considered for integration; 12 records remain pending. All 42 distinct original notice texts in the 212 fresh-merge requirement paths were read. This is not approval of complete runtime distribution compliance, an installer, a release, or the upstream build process.

The current product policy was not modified or reloaded in this task. Approved records are limited to exact Mac asset/notice/SPDX tuples. Python full-archive hashes bind original provenance only, not a substituted product HEAD or an automatic license approval of full build archives.

## Materials and actual execution

- Six original local archives matched supplied exact size and SHA-256; no archive downloads or compilation.
- Fresh merge ZIP SHA-256: 0894959b1cdb8b4098775869561121e2ef20c63430097ef91b881cae6a35129a.
- Original notice evidence: D:/RT-ResearchFlow-BuildCache/astra-mac-runtime-license-review-20261010/original-notice-evidence.json (SHA-256 6292edb3ea79ad3c6d0d48f34f106c4b597ef115cb8120fe6afd7791ef4fe2c3).
- Collection: exit 0; each Python install archive supplied 43 notice members; each full archive supplied 62 notices plus PYTHON.json; each Node supplied root LICENSE.
- Full local legal-filename census: exit 0; D:\RT-ResearchFlow-BuildCache\astra-mac-runtime-license-review-20261010\notice-census.json (SHA-256 b166a74f889387760be62f066c7b5772741017236a335476d9ed8e294f31fb1a). Python counts match the collected set. Each Node archive has 200 legal members, including 199 additional members beyond root LICENSE.
- No network requests, accounts, orders, product changes, Git, native prepare retries, provider tests or old helper tests were performed in this review.

## Reading method

Original extracted bytes remain unmodified and hash-pinned. Identical bytes shared by both Mac architectures were read once and bound independently to each artifact. For long composites, previously read paragraphs were matched after whitespace/comment-leader normalization only as a reading aid; every novel paragraph was read. Normalized text is never used as a byte pin or substituted for a retained notice. Node LICENSE has 476 paragraph segments, of which 241 matched earlier reviewed paragraphs; all 235 novel paragraphs were read. No Windows approvals or exclusions were copied.

## Exact outstanding boundaries

- RECIPIENT-NOTICES [pending]: Verify installer/final distribution actually includes the complete notices, copyrights, disclaimers, supporting documentation and attribution references. No installer or recipient-facing package was audited here.
- NODE-NESTED-NOTICES [pending]: Each original Node archive contains 200 legal/attribution members; root LICENSE is read, 199 other members per architecture (398 paths, 99 distinct byte hashes) remain individually unreviewed. Exact path/hash/size inventory is notice-census.json. Do not claim root LICENSE covers every npm dependency.
- CERTIFI-MPL [pending]: Original notice identifies modified Mozilla CA data under MPL-2.0. Exact source-form availability, modification trail and delivery of full license terms not established; no online verification performed.
- BDB-APPLICABILITY-SOURCE [pending]: Mac PYTHON.json does not declare BDB links; this is narrower than proving absent code. Oracle source-distribution clause remains unclosed if applicable. No Windows exclusion copied.
- TIX-X11-APPLICABILITY [pending]: No Tix/X11 links are declared in either Mac extension metadata. That alone does not prove whole-artifact absence. Tix referenced Tcl/Tk and HTML Library texts and libX11 TekHVC conditions require an applicability/exclusion determination.
- OPENSSL-LEGACY [pending]: Both original Mac PYTHON.json files associate _ssl/_hashlib with OpenSSL and Apache-2.0 notices. Exact linked-library version is not independently resolved here; keep legacy acknowledgements/naming restrictions pending rather than discarding them.
- ZLIB-NG-METADATA [pending]: Both metadata files reference licenses/LICENSE.zlib-ng.txt, but neither full archive contains this member. Relevant links show system z, not static zlib-ng. This is a metadata/applicability reconciliation gap, not proof a bundled zlib-ng library is missing its license.
- NODE-ARTISTIC-ICU [pending]: Node root notice includes npm Artistic-2.0 standard/modified/source instructions and aggregation terms; ICU GPL build-script exceptions are conditional and confined to named build files. Source and packaging applicability were not verified. Do not label whole Node MIT or GPL.
- APACHE-PYTHON-CHANGES [pending]: Check any distributor changes, Apache NOTICE obligations and Python derivative change summaries against eventual shipped files. Notice approval alone supplies no patent, trademark or legal-compliance certification.

## Per-text review

### 78b12c3a81360b357002334f0e70ea0e92eebf7a9b358805c03c48484945f3bb

Member: python/lib/python3.13/LICENSE.txt

SPDX/exact LicenseRef: LicenseRef-CPython-Install-Notice

Decision: approved

PSF v2, BeOpen, CNRI 1.6.1, CWI history and optional 0BSD documentation code. Retain full agreement and copyrights; document Python changes; do not imply trademark endorsement.

### 4eb1fb1705e2def898e81bcba19c3aac80620d27ba3569d6a6df7b4629d1b5c2

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/AUTHORS.txt

SPDX/exact LicenseRef: LicenseRef-pip-Authors-Attribution

Decision: approved

Attribution list only, not an independent license grant. Retain with the pip MIT license, which explicitly refers to AUTHORS.txt.

### 634300a669d49aeae65b12c6c48c924c51a4cdf3d1ff086dc3456dc8bcaa2104

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/LICENSE.txt

SPDX/exact LicenseRef: MIT

Decision: approved

pip MIT grant; retain copyright, permission and disclaimer with AUTHORS.txt.

### 86eeee87be2a43f3ff1f56496f451f69243926f025fedbb033666c304c4c161b

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/cachecontrol/LICENSE.txt

SPDX/exact LicenseRef: Apache-2.0

Decision: approved

CacheControl Apache-2.0 incorporation notice. Retain this copyright notice and supply full Apache-2.0 terms; NOTICE and changed-file conditions require distribution checks.

### e93716da6b9c0d5a4a1df60fe695b370f0695603d21f6f83f053e42cfc10caf7

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/certifi/LICENSE

SPDX/exact LicenseRef: MPL-2.0

Decision: pending

certifi says its modified Mozilla CA bundle is MPL-2.0. Exact covered source form, modification provenance, full MPL terms and recipient source access have not been established in this bounded review.

### 808e10c8a6ab8deb149ff9b3fb19f447a808094606d712a9ca57fead3552599d

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/distlib/LICENSE.txt

SPDX/exact LicenseRef: Python-2.0

Decision: approved

distlib includes Python historical agreements. Retain full text and relevant copyrights; include change summary when the Python-derived code is modified.

### cb5e8e7e5f4a3988e1063c142c60dc2df75605f4c46515e776e3aca6df976e14

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/distro/LICENSE

SPDX/exact LicenseRef: Apache-2.0

Decision: approved

distro full Apache-2.0 text. Copy license; preserve applicable notices, mark changed files, check NOTICE and patent/trademark limits.

### 1a9a4f0e3d479a27240ddd59a9137a66ab4a0f9dfdc8ca6188cc0bfd85187f04

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/idna/LICENSE.md

SPDX/exact LicenseRef: BSD-3-Clause

Decision: approved

idna BSD-3-Clause: reproduce copyright/conditions/disclaimer for binaries; no endorsement.

### 492dedba85da5872f78e6091bcd1fea474d660d35acb4dee964b8aab3f007427

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/msgpack/COPYING

SPDX/exact LicenseRef: Apache-2.0

Decision: approved

msgpack Apache-2.0 incorporation notice, not the complete license text; supply full Apache-2.0 text with original attribution.

### cad1ef5bd340d73e074ba614d26f7deaca5c7940c3d8c34852e65c4909686c48

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/packaging/LICENSE

SPDX/exact LicenseRef: Apache-2.0 OR BSD-2-Clause

Decision: approved

packaging explicitly permits either license; contribution terms say both. Preserve this selector and both supplied license files; do not rewrite OR as AND for use.

### 0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/packaging/LICENSE.APACHE

SPDX/exact LicenseRef: Apache-2.0

Decision: approved

packaging full Apache-2.0 alternative; normalized paragraphs matched the independently read distro license.

### b70e7e9b742f1cc6f948b34c16aa39ffece94196364bc88ff0d2180f0028fac5

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/packaging/LICENSE.BSD

SPDX/exact LicenseRef: BSD-2-Clause

Decision: approved

packaging BSD alternative requires source/binary notice retention.

### 86da0f01aeae46348a3c3d465195dc1ceccde79f79e87769a64b8da04b2a4741

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/pkg_resources/LICENSE

SPDX/exact LicenseRef: MIT

Decision: approved

pkg_resources permission and warranty terms; preserve file exactly, do not invent a missing copyright attribution.

### 29e0fd62e929850e86eb28c3fdccf0cefdf4fa94879011cffb3d0d4bed6d4db6

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/platformdirs/LICENSE

SPDX/exact LicenseRef: MIT

Decision: approved

platformdirs MIT; preserve original copyright year wording.

### a9d66f1d526df02e29dce73436d34e56e8632f46c275bbdffc70569e882f9f17

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/pygments/LICENSE

SPDX/exact LicenseRef: BSD-2-Clause

Decision: approved

Pygments BSD-2-Clause notice references its AUTHORS; preserve original attribution and verify referenced attribution accompanies the eventual distribution.

### 1b22b049b5267d6dfc23a67bf4a84d8ec04b9fdfb1a51d360e42b4342c8b4154

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/pyproject_hooks/LICENSE

SPDX/exact LicenseRef: MIT

Decision: approved

pyproject_hooks MIT notice.

### 09e8a9bcec8067104652c168685ab0931e7868f9c8284b66f5ae6edae5f1130b

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/requests/LICENSE

SPDX/exact LicenseRef: Apache-2.0

Decision: approved

requests Apache-2.0 full text; normalized paragraphs matched previously read terms.

### f388fd38cad13112c1dc0f669bbe80e7f84541edbafb72f3030d2ca7642c3c9d

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/resolvelib/LICENSE

SPDX/exact LicenseRef: ISC

Decision: approved

resolvelib ISC permission with copyright/permission retention.

### deed7c17a4318158190a3ea239cc879a5a50271cebb98ae7025f48fbe58dca15

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/rich/LICENSE

SPDX/exact LicenseRef: MIT

Decision: approved

rich MIT notice.

### b80816b0d530b8accb4c2211783790984a6e3b61922c2b5ee92f3372ab2742fe

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/tomli/LICENSE

SPDX/exact LicenseRef: MIT

Decision: approved

tomli and tomli_w share identical original notice bytes; retain path bindings separately.

### 33be7b7e8fa4fd19b1760e1a8ed8a668bdab852c91b692dd41424bcb725a9fca

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/truststore/LICENSE

SPDX/exact LicenseRef: MIT

Decision: approved

truststore MIT notice.

### 130e3a64d5fdd5d096a752694634a7d9df284469de86e5732100268041e3d686

Member: python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/urllib3/LICENSE.txt

SPDX/exact LicenseRef: MIT

Decision: approved

urllib3 MIT notice.

### 3bdff06e69991c94664f2ef5c5f8096f60b7dbec071756ea6cc26b445e06ec5b

Member: python/licenses/LICENSE.bdb.txt

SPDX/exact LicenseRef: Sleepycat AND BSD-3-Clause

Decision: pending

Berkeley DB composite includes Oracle clause 3 requiring complete DB/accompanying software source information, plus Berkeley/Harvard/ASM BSD notices. Mac metadata does not list BDB links, but that alone is not an approved exclusion or source-obligation closure.

### 1f38bbc7caacafd65169276d759c0d88c991b753b643ce35d0e45ea1971dd441

Member: python/licenses/LICENSE.bzip2.txt

SPDX/exact LicenseRef: bzip2-1.0.6

Decision: approved

bzip2 retains source notice, marks altered source and forbids misrepresentation/endorsement; metadata explicitly maps _bz2 to static libbz2.a.

### 86e61415828a8b5b06ec8d024e6f086ce155a8b85fd0c419c0ba4dc004e74fdd

Member: python/licenses/LICENSE.cpython.txt

SPDX/exact LicenseRef: LicenseRef-CPython-Full-Composite-Notice

Decision: approved

Historical Python agreements plus incorporated third-party notices: Mersenne Twister, WIDE sockets, async services, cookies, trace, uu, XML-RPC, epoll, kqueue, SipHash, dtoa, expat, cfuhash, libmpdec and W3C tests. Retain complete composite, including documentation and no-publicity conditions. Text calls its incorporated list incomplete; not a proof of exhaustive binary coverage.

### 122f2c27000472a201d337b9b31f7eb2b52d091b02857061a8880371612d9534

Member: python/licenses/LICENSE.expat.txt

SPDX/exact LicenseRef: MIT

Decision: approved

expat MIT notice; _pyexpat metadata statically links expat.

### 29cea33c32bbc9785142386377915612a2fa786482c46843383384aded2e09b1

Member: python/licenses/LICENSE.libedit.txt

SPDX/exact LicenseRef: BSD-3-Clause

Decision: approved

libedit Berkeley BSD-3-Clause; Mac readline metadata links system edit. Retain notice conservatively, not a claim system libraries are bundled.

### deaf3a42effb551a5b140fa9afefed183a27f1341c6d1bf430d106a5e6931fc0

Member: python/licenses/LICENSE.libffi.txt

SPDX/exact LicenseRef: MIT

Decision: approved

libffi MIT; _ctypes metadata statically links ffi.

### 9a4062de0a2c388a98cf35a35d348b62fa97c838a71c3c28ee1a2d7d0a565b02

Member: python/licenses/LICENSE.liblzma.txt

SPDX/exact LicenseRef: 0BSD

Decision: approved

liblzma text is 0BSD, not a blanket public-domain claim. Metadata also declares 0BSD and static lzma.

### 122ee1f7e258f2c3c0e538a75c037684f420454bf3850ddc74ce750bbf5fe86b

Member: python/licenses/LICENSE.libuuid.txt

SPDX/exact LicenseRef: BSD-3-Clause

Decision: approved

libuuid BSD-3-Clause; _uuid metadata statically links uuid.

### 2daec087a88e7c9b8082557cdeebad5bbb8155a4137472f0b22e269cd99d0c1e

Member: python/licenses/LICENSE.libX11.txt

SPDX/exact LicenseRef: LicenseRef-libX11-Composite-Notice

Decision: pending

libX11 includes many MIT/X11/BSD legacy notices and TekHVC identification/use conditions. Mac metadata has no X11 linkage. Applicability exclusion and any TekHVC obligations are not established; do not flatten to MIT.

### 56abe29bb1d9806a9e04fa9f80fed2c0f18027594df3f098148d814aef6bddfa

Member: python/licenses/LICENSE.libXau.txt

SPDX/exact LicenseRef: X11

Decision: approved

libXau Open Group grant includes supporting-documentation notices and advertising/name restriction. Retain notice; metadata nonreference is not blanket exclusion evidence.

### c5ffbfeaa501071ceeb97b7de2c0d703fdaa35de01c0fb6cbac1c28453a3e9fd

Member: python/licenses/LICENSE.libxcb.txt

SPDX/exact LicenseRef: LicenseRef-libxcb-Notice

Decision: approved

MIT-like permission plus explicit author/institution advertising/name restriction; custom identifier preserves that extra condition rather than labelling bare MIT.

### 669512af7219f58be03a398766d7c9da11a3b3df9d3f05cb74c5ceca25c8da3b

Member: python/licenses/LICENSE.mpdecimal.txt

SPDX/exact LicenseRef: BSD-2-Clause

Decision: approved

mpdecimal BSD-2-Clause; static mpdec in _decimal.

### 87a4c4442337b8968ef956031c406b74f9cb7149b7ba87311bdaba534816201c

Member: python/licenses/LICENSE.ncurses.txt

SPDX/exact LicenseRef: X11

Decision: approved

ncurses MIT/X11-like permission including modification distribution and no advertising/name use. Mac metadata marks ncurses/panel system links.

### 9c04cce50c4989d5601dd8b07f6ab922c40388b66ac736c9007cb1ed9d9dd560

Member: python/licenses/LICENSE.openssl-1.1.txt

SPDX/exact LicenseRef: OpenSSL

Decision: pending

Full legacy OpenSSL plus SSLeay notice includes advertising acknowledgements, naming and licence-relicensing restrictions. Mac _ssl/_hashlib metadata lists both legacy and Apache notices without resolving which implementation applies. Retain pending; do not assume old code absent.

### 7d5450cb2d142651b8afa315b5f238efc805dad827d91ba367d8516bc9d49e7a

Member: python/licenses/LICENSE.openssl-3.txt

SPDX/exact LicenseRef: Apache-2.0

Decision: approved

OpenSSL 3 full Apache-2.0 text. Independent text review does not resolve legacy-versus-3 binary applicability.

### 38bef3d28b24f145ea293bd3b6eb4b20396982abc8303128fb493986ea5bc719

Member: python/licenses/LICENSE.sqlite.txt

SPDX/exact LicenseRef: LicenseRef-SQLite-Public-Domain

Decision: approved

Original SQLite dedication permits distribution of deliverable library/documentation and explicitly distinguishes build scripts. Not an assertion that every full-source archive build tool is public domain.

### c0a69a2bfd757361ec7e6143973b103c90409316b49e9c88db26ad6388e79f16

Member: python/licenses/LICENSE.tcl.txt

SPDX/exact LicenseRef: TCL

Decision: approved

Tcl notice requires existing copyrights and verbatim notice, including government-rights paragraphs and changed-term conditions. Metadata maps Tcl/Tk system links plus static stubs.

### 3ac5cdd0bef6c43ce34c6a7ced452081d9e5a0bf94082b9f9147d23ec9e214f5

Member: python/licenses/LICENSE.tix.txt

SPDX/exact LicenseRef: LicenseRef-Tix-Composite-Notice

Decision: pending

Tix requires notice retention and separately refers to docs/license.tcltk and docs/license.html_lib. Those referenced originals and active Mac applicability were not established; no copied Windows exclusion.

### 818922b2620f12801a12bf78e399644a30990e66824abd8ca8ec24d451d6f92c

Member: python/licenses/LICENSE.zlib.txt

SPDX/exact LicenseRef: Zlib

Decision: approved

zlib origin, altered-source marking and source notice preservation. Metadata uses system z; absent zlib-ng notice is an unresolved metadata/notice reconciliation item, not automatically a missing bundled zlib-ng library.

### c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4

Member: node-v22.23.3-darwin-arm64/LICENSE

SPDX/exact LicenseRef: LicenseRef-Nodejs-22.23.3-Composite-Notice

Decision: pending

Node core MIT plus external-component terms: Apache, BSD, ISC, Unicode/ICU, zlib, Blue Oak, npm Artistic 2.0, public-domain alternatives and ICU build-script GPL exceptions. Full root notice read; each archive contains 199 additional npm/other legal members not individually reviewed. Root notice is not a whole-runtime permission grant.


## Integration contract

approval-records.json contains only approved records. pending-review-records.json is a separate review result, not an approval list; do not append it blindly to policy. Both use only the supplied required and optional approval keys. LicenseRef identifiers are local exact-document definitions, not assertions of newly standardized SPDX licenses; their complete original text is in original-notice-evidence.json and raw notice files. proposed-license-requirements.json is an evidence mapping, not a drop-in policy schema: provenance fields and reviewReference belong in the review/handoff, not arbitrary policy fields. Preserve all pending decisions and additional obligations when integrating. Neither all 212 mappings nor a successful structural merge proves the extra npm notices or distribution obligations closed.
