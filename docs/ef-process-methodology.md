# EF process methodology source coverage

Issue [#27](https://github.com/tiangong-lca/tidas-spec/issues/27) adds EF-specific
guidance to `assets/tidas/methodologies/tidas_processes.yaml`. The existing
field-oriented `<rules>` convention is retained. Each added entry has an `ef.`
identifier, explicit applicability, normative level and source section. These
identifiers locate methodology entries; they are not newly adjudicated entries
in `public-rules.v1.json`, which retains its nine definitions.

## Source baseline and interpretation

- **G:** Fazio et al., *Guide for EF compliant data sets*, version 2.0 (2020),
  JRC120340, [doi:10.2760/537292](https://doi.org/10.2760/537292),
  [official PDF](https://eplca.jrc.ec.europa.eu/permalink/Guide_EF_DATA.pdf).
- **A:** Valente, Kusche and Ardente, *Updates on Guide for EF compliant data
  sets … EF 3.1 reference package*, November 2022,
  [official PDF](https://eplca.jrc.ec.europa.eu/permalink/EF_Data_Guide_EF3.1_addendum.pdf).
- **E:** EF Data Working Group, *Modelling requirements on LCI models under the
  Environmental footprint for interoperable data exchange via the eILCD format*,
  version 2.1, June 2020,
  [official PDF](https://eplca.jrc.ec.europa.eu/permalink/InterfacePaper_Modelling_eILCD.pdf).

The source registry and attribution travel inside the YAML asset. A replaces G
sections 2 and 5.2.15 and updates the supporting-subdataset compliance table.
A labels that last update 5.4.1; the supporting-subprocess content is in G 5.4.2.
The coverage below follows the content rather than propagating that numbering
inconsistency. Superseded source UUIDs struck through in A are not treated as
additional required systems.

This is a structured account of the process-dataset requirements in this
explicit baseline, not an exhaustive transcription of the PEF/OEF method,
PEFCRs/OEFSRs, their sector annexes or future revisions. Applicable method and
category rules, ILCD entry-level requirements, G Annex 1 and the official
reference package remain dependencies. A conflict with a later applicable
source needs an explicit resolution; a consumer must not silently select the
least restrictive rule. Passing schema validation alone does not establish EF
compliance.

## Coverage

IDs below omit the common `ef.` prefix. Field paths are carried by the YAML
hierarchy rather than copied into another rule catalog.

| Source sections | Methodology entries | Coverage / boundary |
| --- | --- | --- |
| G introduction, 1, 5.1 | `scope`, `dataset-type` | Prerequisites, dataset roles and applicability. |
| G 2; A 2 | `reference-package` | Package generation, nomenclature, dependency closure. |
| G 3.1–3.3, 3.5–3.6 | `update-lineage` | A1/A2/B identity, predecessor and version rules, including the incorrect-upload exception. |
| G 3.2–3.6, 7 | `provider-context` | Change logs, node/stock requirements and transition-phase communication are external provider obligations. |
| G 4 | `level1-structure`, `reference-package`, `reference-flow`, exchange rules | Minimum level-1 decomposition and compatible subprocesses. |
| G 5.2 | `identity`, `reference-flow`, `system-diagram`, `method-and-allocation`, `boundary-and-cutoff`, `intended-applications`, `use-advice`, `publication-metadata`, `version`, `revision-date`, review entries | Mandatory general metadata; no universal schema changes. |
| G 5.2.1–5.2.5 | `study-report`, `dataset-type`, `geography`, `reference-year`, `parameter-defaults` | Study/report conditions, location, validity and parameter defaults. |
| G 5.2.6–5.2.9; Annex 1 | `regionalized-elementary-flows`, `elementary-duplicates`, `method-and-allocation`, `reference-flow-content` | Regionalization, duplicate-source comments, allocation and product properties. Annex 1 remains authoritative rather than a copied vocabulary. |
| G 5.2.10–5.2.14 | `cff`, `modelling-constants`, `method-report`, `background-source-references`, `supported-methods` | Modelling and provenance documentation. |
| G 5.2.15 replaced by A 5.2.15 | `compliance-declarations` | Five/six-system set, updated UUIDs and aspect-specific declarations. |
| G 5.2.16; A introduction | `lcia-results` | All 16 categories, serialization, official package and result checks; no CF changes. |
| G 5.2.17 | `dqr` | Four criteria, contribution weighting, individual limits, reporting and documented exceptions. Rating rubrics remain in source Table 2. |
| G 5.3 | `aggregated-included-processes` | Optional links to separately available included datasets. |
| G 5.4.1 | `level1-complementing-processes`, `system-diagram`, `dataset-type` | Central-process metadata and physical model diagram. |
| G 5.4.2; A page 5 | `supporting-identification`, `supporting-use-advice`, `supporting-administration`, `supporting-compliance`, `dataset-type` | Restricted use, inherited ownership/license, special declarations and no separate review/DQR. Exact mandated notices remain referenced to source items 3–4. |
| G 6 | `boundary-and-cutoff`, `cff`, `water-balance`, `electricity`, `offsets-and-time`, `reference-flow`, `lcia-results`, exchange rules | Completeness, boundaries, recycling, energy, water and flow conventions. |
| G 6.1 | `background-selection` | EF/ILCD hierarchy and explicitly historical designated-supplier requirement; current availability is not assumed. |
| G 6.2 | `agriculture-averaging`, `agriculture-allocation`, `agriculture-specific-data`, `agriculture-emissions` | Conditional crop periods, allocation, field inputs and emissions. Later method/category provisions need separate verification. |
| G 6.3 | `carbon-modelling`, `offsets-and-time`, `reference-flow-content` | Fossil/biogenic/land-use distinctions and carbon content. |
| G 8.1–8.3 | `review-team`, `review-report`, `lcia-results`, `dqr` | Team eligibility, one agreed report/DQR, review evidence and LCIA consistency. Source review template remains authoritative. |
| E 2.1 | `eilcd-parameters` | Locality, names, expression limits and safe dependencies. |
| E 2.2–2.4 | `eilcd-model`, `eilcd-connections`, `eilcd-defined-amount`, `eilcd-flow-uniqueness` | Stage conventions, links, reference scaling, parameter-reuse exception and per-side uniqueness. |
| E 2.5 | `eilcd-documentation` | Model/aggregated-process references, metadata and matching LCIA results. |

## Distinctions that consumers must preserve

1. **Flow identity and direction.** G prohibits duplicate product/waste flows on
   each side while permitting documented duplicate elementary flows. E prohibits
   repeats of any flow on each side in its model-exchange scope. Two exchange
   objects with different amounts or locations can still reference the same flow.
   One appearance on each opposite side is not a duplicate on either side.
   Neither source establishes a universal one-country-one-flow rule.
2. **Dataset role.** A non-primary supporting sub-dataset carries restricted-use
   documentation and special declarations. It does not need a separate DQR or
   review. The central dataset carries the full-model documentation. An arbitrary
   incomplete standalone dataset cannot obtain this exception by changing a label.
3. **Representation versus scientific acceptance.** EF uses the three-part
   version convention, whereas ordinary TIDAS still accepts two or three parts.
   The EF requirement for one agreed report does not undo TIDAS multi-review
   support. XML scientific notation is an export requirement, not a new JSON
   numeric datatype. Numeric DQR reporting, source location codes and some
   dataset-type values may require representation work; this PR does not widen
   schemas, replace numbers with qualitative ratings, or silently map geography.
4. **Cross-file obligations.** Model connections, reference/result processes,
   model parameter settings, product flow properties, source datasets and node
   publishing procedures cannot all live in a Process instance. Their requirements
   are recorded at the relevant reference or in `global_rules`; no invented
   Process fields or database writers are introduced.

## Validation and downstream work

The conformance checks validate the new entries' source bindings and field
placement against the existing schemas, including review references through
`$ref`. They do not execute EF scientific checks on datasets. Existing general
rules and schema language variants remain unchanged. Public-rule adjudication,
toolkit execution, consumer operation policy and publication are separate work;
this candidate is not evidence of deployed enforcement or data acceptance.
