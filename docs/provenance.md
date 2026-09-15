# Provenance and licensing record

This record states what is verified about the shipped specification assets, and
what is not. It exists so that "the package is MIT" is never inferred from the
tools `LICENSE` notice alone.

## Verified facts

**Source.** All 39 shipped files were extracted from Git blobs at
`tidas-toolkit` commit `9c0d8b1c8ceb1841074f5bc6de5fbb7fcc9318f5` (`main`),
canonical repository `https://github.com/tiangong-lca/tidas-toolkit`. The
extraction reads blobs by commit, not a working tree, so an uncommitted local
edit cannot enter the import. `source-import.yaml` records the source path and
SHA256 of every file; `reviewed-baseline.json` records an independently reviewed
digest of that inventory, and verification fails if the two disagree or if the
shipped bytes do not hash to the recorded values.

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

## Unresolved

**Per-artifact licensing of embedded classifications.** Several shipped schemas
embed controlled vocabularies as `const` constraints rather than referencing an
external list. The largest are:

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

The schemas name ILCD as their structural origin (for example "ILCD Perc",
"ILCD GlobalReferenceTypeValues", "per ILCD" in field descriptions), and the
source XML namespace constants point at `http://lca.jrc.it/ILCD/...`. The
repository carries **no** attribution file, license header, or provenance note
for these vocabularies, and the tools `LICENSE` is the repository's own MIT
notice, not a statement about them.

**What is therefore not established:** whether the classification content, the
ILCD-derived structural conventions, or any embedded third-party values may be
redistributed under MIT, or under what terms. Enumerating each classification's
actual origin and rights status is unfinished work.

## How the package states this

`package.json` declares `"license": "SEE LICENSE IN LICENSE"` rather than a bare
SPDX identifier such as `MIT`. A bare identifier is a claim about the whole
package, and the per-artifact determination above does not exist yet. `LICENSE`
carries the verified tools notice, and this record carries the unresolved
question; the verifier fails the `package/license-declaration` check if the
declaration is changed to a blanket identifier. Changing that value is the last
step of resolving provenance, not a packaging preference.

## Effect on publication

- The candidate archive is **not publishable** as a formal release while
  per-artifact licensing is unresolved. No manifest field claims otherwise, and
  no document in this repository describes the whole package as MIT-licensed on
  the strength of the tools notice.
- The candidate remains usable for continued local and CI validation. It is a
  candidate: not published, not accepted, and not adopted by any consumer.
- Resolving this requires a per-artifact license determination with a named
  authoritative source for each classification vocabulary, and a decision
  recorded on the owning Issue. It is not a decision this repository can make by
  assumption.
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
