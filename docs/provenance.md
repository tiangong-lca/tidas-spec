# Provenance and licensing record

This record states what is verified about the shipped specification assets, and
what is not. It exists so that "the package is MIT" is never inferred from the
tools `LICENSE` notice alone.

## Verified facts

**Source.** The original 39-file import was extracted from Git blobs at
`tidas-toolkit` commit `9c0d8b1c8ceb1841074f5bc6de5fbb7fcc9318f5` (`main`),
canonical repository `https://github.com/tiangong-lca/tidas-toolkit`.
Candidate 0.2.3 retains 33 imported files byte-for-byte; five original files
were superseded by the reviewed change in Issue #7, the Process schema receives
repository-authored review-cardinality and conditional-reference corrections
in Issues #24 and #29, and the
Process methodology was superseded by the schema-alignment decision in Issue #22. The package also ships
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

**File-level source boundaries.** At the recorded W1 comparison baseline, the
English and Chinese schema sets were byte-identical to the same files in
`tidas-sdks`; `cli` and `tidas` carried differing variants of named files (11
and 9 respectively). Those counts describe that baseline, not the current
0.2.3 candidate. The Issue #29 Process schema change is repository-authored;
SDK, CLI, and toolkit copies need separate reviewed adoption rather than an
assumed byte-parity claim.

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
their XML namespace constants point at `http://lca.jrc.it/ILCD/...`. In the
release-readiness Issue [#9](https://github.com/tiangong-lca/tidas-spec/issues/9#issuecomment-5741368283),
Biao subsequently confirmed, as the authorized rights-holder representative,
that public redistribution of the **whole shipped package**, including those
ILCD-derived structural conventions, is authorized and does not require another
rights approval. This is the owner's release-authorization disposition. It does
not claim TianGong authorship of ILCD, or independently establish any
third-party license or attribution terms beyond that authorization.

## How the package states this

`package.json` declares `"license": "SEE LICENSE IN LICENSE"` rather than a bare
SPDX identifier such as `MIT`. `LICENSE` carries the verified tools notice; the
two owner statements above establish permission to publicly redistribute the
shipped material without converting every content-origin fact into a TianGong
authorship claim. The verifier fails the `package/license-declaration` check if
the declaration is changed to a blanket identifier. Changing that value would
require a separately reviewed whole-package licensing decision, not a packaging
preference.

## Effect on publication

- The rights owner's public-redistribution decision removes the previously
  recorded rights blocker for the current shipped package. It does not itself
  publish or accept the candidate; npm/GitHub release identity, credentials,
  and channel checks remain separate release gates in Issue #9.
- The candidate remains usable for local and CI validation before publication;
  no consumer adoption is asserted by this record.
- The current schemas deliberately retain 52 Draft 7 `$ref` objects with
  assertion-bearing siblings. A strict Draft 7 reader ignores those siblings,
  while another validator may apply them, so validation results can differ.
  The owner accepted this documented first-release compatibility caveat in
  [Issue #9](https://github.com/tiangong-lca/tidas-spec/issues/9#issuecomment-5741368283)
  based on established use of the schemas as shipped in the first release. The derived manifest
  finding remains visible; no evaluator equivalence is claimed. A future
  semantic correction needs its own reviewed source and consumer-impact work.

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

## EF Process methodology additions (Issue #27)

The Process methodology is already repository-authored. The EF additions are
adapted field guidance based on the source versions listed and attributed in
`metadata.ef_sources`, with section bindings on every added rule. The 2020 Guide
(JRC120340, doi:10.2760/537292, © European Union 2020) expressly permits reuse
under CC BY 4.0. Attribution, the license link and notice of condensation,
reorganization and new examples travel in the YAML asset. This addition does
not relabel that adapted content as solely TianGong-authored MIT material.

The 2022 addendum and June 2020 eILCD paper are cited for factual normative
requirements; their tables, figures and prose are not reproduced. Exact
source-mandated supporting-dataset notices are referenced rather than copied.
This records the sources and adaptation, not JRC endorsement, scientific
certification, completeness of every PEF/OEF sector rule or authorization to
publish a package. See [coverage and limits](ef-process-methodology.md).
