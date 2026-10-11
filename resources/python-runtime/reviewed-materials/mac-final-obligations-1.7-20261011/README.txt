Mac Python distribution materials for unreleased RT-ResearchFlow 1.7.0
==================================================================

This directory is a redistribution-material candidate, not release approval
or proof of inclusion in an installed application. Deliver this entire
directory with the runtime and expose this README to recipients.

CERTIFICATE SOURCE
Pip 26.2.1's ensurepip wheel contains vendored certifi 2026.6.17.
The complete observed certifi source is supplied here, without charge:
  source/pip-vendored-certifi-2026.6.17/pip/_vendor/certifi/
It includes LICENSE, __init__.py, __main__.py, core.py, cacert.pem and py.typed.
The certificate data is covered by MPL 2.0. See notices/MPL-2.0.txt and the
original LICENSE. Recipient rights under MPL are not restricted by the
application's license. The original vendored code and PEM have not been
modified by this material collection. Existing pip namespace adaptations
are retained exactly; this is not an upstream unmodified certifi sdist.
Pip metadata, license, authors and vendor version list are in source/pip-context/.
The separately retained certifi 2026.7.22 source is NOT this vendor copy.

THIRD-PARTY NOTICES
All retained originals in notices/ are verbatim; do not abbreviate the X11
composite notice or discard either OpenSSL license.
OpenSSL acknowledgments are in notices/OPENSSL-ACKNOWLEDGMENTS.txt.
Also show the relevant acknowledgments in advertising that mentions OpenSSL
features/use. Do not use upstream names to endorse or name this product.
Preserve X11 notice restrictions concerning advertising/endorsement names.

SCOPE AND CONDITIONAL GAPS
BDB: _dbm's nine dbm imports resolve by library ordinal to macOS libSystem.
No bundled Oracle DB library was observed in these original runtime inputs.
The BDB notice is preserved conservatively; it is not a completed source
offer for Oracle DB. If such code is added, obtain the exact DB and
accompanying software source required by the original terms.
Tix: no component path, Tix symbol or Tcl package-index registration was
observed in these runtime originals. LICENSE.tix.txt refers to
docs/license.tcltk and docs/license.html_lib; neither exists in the
retained full archives. LICENSE.tcl.txt is supplied as an original Tcl
notice, not falsely labeled as either missing Tix-specific document.
If Tix is included in the delivered product, obtain both exact subordinate
notices or document the applicable source-level scope before release.
Tk contains X-style defined symbols despite no external libX11 load.
No X11 code-absence claim is made; the complete X11/Xau/xcb notices are kept.

PROVENANCE
Evidence binds original input bytes to structural formal-lock SHA256
c20a1a327b91d4022746d2fc18b4a8045c31767134b14fdfae866ba2f06cd6ea
and prepare run 38031520327, source b91f91ce65fe8bc20e150b770128b62a5fccb98d.
The older original notice review used prepare run 37960129695;
it is not relabeled as a new seal. Current receipt sourceVerified and
nativeBootstrapVerified are false. No human/legal approval is claimed.
See evidence/ and ../mac-final-obligations-review-1.7-20261011.json
(the review JSON is stored next to this directory, not inside evidence/).
