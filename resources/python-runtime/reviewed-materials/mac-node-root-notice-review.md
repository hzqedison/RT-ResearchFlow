# Mac Node root notice: limited engineering review

Reviewer: Astra. Date: 2026-10-10.

## Decision

Approve retention and exact clause identification of the two original Mac Node 22.23.3 root LICENSE records only. This is an independent notice-evidence decision, not a determination of whole-runtime permission, commercial redistribution compliance, release eligibility, or installer compliance. No Windows record was copied.

The parent clarified the applicable licenseApprovals contract: original NOTICE provenance/hash/terms review is separate from a mandatory final distribution-obligations proof. The prior pending decision combined completed root-text review with unresolved whole-runtime obligations. Those obligations remain unresolved; only the root-notice evidence decision changes. This is not a change to the license text, evidence, artifact pins, or a green-build exception.

## Exact evidence

- Component: node; version: 22.23.3.
- Root LICENSE SHA-256: c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4; original size: 145485 bytes.
- darwin-arm64 asset SHA-256: 23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53; original member: node-v22.23.3-darwin-arm64/LICENSE.
- darwin-x64 asset SHA-256: 8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8; original member: node-v22.23.3-darwin-x64/LICENSE.
- Both original local archive size/SHA and original member bytes were independently matched in the completed collection. Evidence: D:/RT-ResearchFlow-BuildCache/astra-mac-runtime-license-review-20261010/original-notice-evidence.json, SHA-256 6292edb3ea79ad3c6d0d48f34f106c4b597ef115cb8120fe6afd7791ef4fe2c3.
- Root text was actually read in the previous bounded review. Its 476 paragraph segments comprised 235 novel paragraphs and 241 paragraphs matched to previously read terms after whitespace/comment-leader normalization for reading only. All novel paragraphs were read. Raw notice bytes were not normalized or rewritten.
- This increment uses cached evidence only; no source reread, download, network request, compilation, product/policy modification, provider rerun or native task.

## Exact LicenseRef meaning

LicenseRef-Nodejs-22.23.3-Composite-Notice denotes the entire original root LICENSE with the exact hash above. It is an evidence-local reference to that complete text, not a new standard SPDX license or a grant that replaces individual component terms. The Node core MIT terms do not label the whole archive MIT.

Identified contents include Node/Joyent MIT; MIT third parties; Apache-2.0 components including SWC, OpenSSL, simdjson and Wasm API terms; V8/other BSD-2-Clause and BSD-3-Clause notices; ISC components; Zlib; Unicode-3.0 and legacy ICU notices; dictionary data terms including IPADIC/ICOT; Blue Oak Model License; npm Artistic License 2.0; public-domain/optional BSD material; and conditional GPL exceptions for named ICU build-script files. Root text also refers to external-library and npm dependency licenses. Preserve the complete original composite, its attributions, disclaimers and references; do not flatten it to MIT, GPL, or a fabricated blanket grant.

## Explicitly pending, outside this approval

- The separate additional Node text-review delivery remains pending. Its census was 398 additional path matches and 99 distinct byte groups; these are not approved by this root-record delta. Source extraction or interim reading alone is not an integrated approval of those groups.
- npm Artistic standard/modified/source-form instructions, aggregation and any source availability obligations require applicable final-package proof.
- ICU build-script exception applicability, dictionary/data notices, component-specific obligations and any source/notice requirements require final-package proof. Do not infer that GPL build-script terms license the whole Node binary or that an exception automatically applies to every redistributed file.
- Final notice completeness, recipient-facing retention, modifications, any additional NOTICE obligations and whole-runtime commercial distribution suitability remain pending under the separate mandatory distribution-obligations gate.
- All unrelated Python/BDB/MPL/Tix/X11/OpenSSL and zlib-ng metadata reconciliation items retain their existing state. No full compliance, release, installer or source-only-commit-as-product-HEAD claim is made.

## Integration

Replace the two existing pending rows by matching their unchanged ids and exact (component,version,artifactSha256,licenseSha256,spdx) tuples. Do not append duplicate tuples. New rows differ only in decision and the specific reviewReference. The immutable 72-approved/12-pending compact snapshot remains available; applying this isolated two-row delta yields 74 approved and 10 pending in that snapshot scope. It grants no additional nested-node approvals and does not waive the final distribution-obligations proof.
