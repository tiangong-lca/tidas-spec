# Provenance and licensing record

This record states what is verified about the shipped specification assets, and
what is not. It exists so that "the package is MIT" is never inferred from the
tools `LICENSE` notice alone.

## Verified facts

**Source.** The original 39-file import was extracted from Git blobs at
`tidas-toolkit` commit `9c0d8b1c8ceb1841074f5bc6de5fbb7fcc9318f5` (`main`),
canonical repository `https://github.com/tiangong-lca/tidas-toolkit`.
Candidate 0.2.0 retains 34 imported files byte-for-byte; five original files
were superseded by the reviewed change in Issue #7, and the package also ships
repository-authored assets. Extraction reads blobs by commit, not a working
tree, so an uncommitted local edit cannot enter the import.
`source-import.yaml` records imported and superseded source paths and digests;
`reviewed-baseline.json` independently anchors the remaining imported
inventory. Verification fails if the records disagree or shipped imported
bytes do not hash to their recorded values.

**Source notice.** `tidas-toolkit/LICENSE` at that commit has SHA256
`557e792f4b9868b7f25f60fca4e47e8857bbf2b88d0c8f733c2ce3fd0cbcc484` and reads
`MIT License`, `Copyright (c) 2026 TianGong LCA`. This repository's `LICENSE`
reproduces that notice unchanged. The digest is recorded in `source-import.yaml`
and in every generated manifest, and is cross-checked against
`reviewed-baseline.json`.

**Exclusions.** `runtime_rulesets.json`, `runtime_rulesets.schema.json`, and
`elementary_flow_taxonomy_extension.v1.json` exist at the source commit and are
deliberately **not** imported. Their exclusion is recorded in
`source-import.yaml` under `excludedSourcePaths`, and verification fails if a
path appears both as shipped and as excluded, or if one of them appears in the
package. Their ownership remains with `tidas-toolkit` until a reviewed
disposition moves them.

**File-level source boundaries.** The English and Chinese schema sets are
byte-identical to the same files in `tidas-sdks` at its recorded baseline. The
`cli` and `tidas` repositories carry differing variants of named files (11 and 9
respectively). Those counts are file-level facts, not semantic dispositions:
this candidate does not inherit either variant, and every actual semantic
difference is adjudicated in a later, separately reviewed step.

## Rights-owner declaration for embedded classifications

Several shipped schemas embed controlled vocabularies as `const` constraints
rather than referencing an external list. The nine groups are listed by basename
below; each basename covers the shipped files in both `schemas/` and
`schemas_zh/`:

| File | `const` entries | Vocabulary |
| --- | --- | --- |
| `tidas_flows_product_category.json` | 13,758 | Product flow classification (agriculture, materials, energy carriers, waste, transport, …) |
| `tidas_processes_category.json` | 2,490 | Process classification |
| `tidas_locations_category.json` | 648 | Geographic regions |
| `tidas_flows_elementary_category.json` | 195 | Elementary flow classification |
| `tidas_lciamethods_category.json` | 156 | LCIA method classification |
| `tidas_contacts_category.json` | 27 | Contact classification |
| `tidas_sources_category.json` | 21 | Source classification |
| `tidas_flowproperties_category.json`, `tidas_unitgroups_category.json` | 12 each | Flow-property and unit-group classification |

On 2026-09-19 Biao, affirming authority to speak for the rights holder,
confirmed that **each of these nine groups** is owned by TianGong, may be
publicly redistributed under MIT, and has no third-party attribution or
additional license obligation. This is a rights-owner declaration, recorded in
the release-readiness Issue [#9](https://github.com/tiangong-lca/tidas-spec/issues/9#issuecomment-5741201156),
not an independently obtained third-party license. It applies to each listed
basename in both language directories, including both basenames in the final
row. The actual source files and
their byte digests remain bound to the pinned `tidas-toolkit` commit by
`source-import.yaml` and `reviewed-baseline.json`; the declaration does not
replace that source evidence.

The schemas also name ILCD as a structural origin (for example "ILCD Perc",
"ILCD GlobalReferenceTypeValues", and "per ILCD" in field descriptions), and
their XML namespace constants point at `http://lca.jrc.it/ILCD/...`. The
rights-owner declaration above addresses the nine embedded classification
groups, **not** an independent license determination for ILCD-derived
structural conventions outside those groups. That distinct attribution and
redistribution question remains open; do not infer it is TianGong-owned or
MIT-licensed from the tools `LICENSE` or from the declaration above.

## How the package states this

`package.json` declares `"license": "SEE LICENSE IN LICENSE"` rather than a bare
SPDX identifier such as `MIT`. The nine-group owner declaration does not yet
resolve the separate ILCD-derived structural-convention question for the whole
package. `LICENSE` carries the verified tools notice; this record distinguishes
the owner declaration from the remaining unresolved scope. The verifier fails
the `package/license-declaration` check if the declaration is changed to a
blanket identifier. Changing that value requires a separately reviewed whole-
package disposition, not a packaging preference.

## Effect on publication

- The nine classification groups now have an explicit owner MIT redistribution
  declaration. The candidate archive is **not yet publishable** as a formal
  release while the separate ILCD-derived structural-convention disposition
  remains open. No manifest field claims whole-package clearance, and the
  tools notice alone never establishes it.
- The candidate remains usable for continued local and CI validation. It is a
  candidate: not published, not accepted, and not adopted by any consumer.
- Resolving the remaining scope requires an explicit source and rights
  disposition for the ILCD-derived structural conventions, recorded on the
  owning Issue. It is not a decision this repository can make by assumption.
- If a determination shows that a vocabulary cannot be redistributed here, the
  options are to keep that vocabulary owned by its current repository and
  reference it, or to obtain explicit permission. Either way the resolve is a
  reviewed content change, not an edit to this record.

## Not covered by this record

- Scientific correctness of any constraint. Byte-for-byte fidelity to the source
  is verified; that is not the same as the constraints being correct.
- Whether the two language variants should remain jointly normative, and how
  translations are generated. The first release keeps the current arrangement and
  verifies structural equivalence only.
- The status of the methodology rules. `tidas_flows.yaml` and
  `tidas_processes.yaml` state their own per-rule requirements, including
  advisory wording. Shipping them does not create a new mandatory product gate,
  and nothing here changes their status.
