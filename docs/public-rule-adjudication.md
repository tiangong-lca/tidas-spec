---
title: Public TIDAS Rule Adjudication W8
docType: decision
scope: repo
status: active
authoritative: true
owner: tidas-spec
language: en
whenToUse:
  - when deciding whether a rule belongs to the public TIDAS specification
  - when composing toolkit, CLI, Foundry, Platform, or Skills rule profiles
whenToUpdate:
  - when a baseline rule changes owner or disposition
  - when a product-local rule is proposed for the public index
checkPaths:
  - assets/tidas/rules/**
  - assets/tidas/methodologies/**
  - docs/public-rule-adjudication.md
related:
  - AGENTS.md
  - docs/specification.md
---

# Public TIDAS rule adjudication (W8)

This decision separates the 14-rule mixed catalog observed in
`tidas-toolkit` commit `4ad5967b1174e194f00277dcb27d9962ec3db6cc80` from the
public definition layer. It does not change the toolkit's current execution
behavior. W9 composes public definitions with product profiles; W10 removes
duplicates only after consumers adopt that interface.

Public definitions are F3 contracts. Candidate findings and review evidence
remain flexible review artifacts until their source semantics are sufficient.
The public index deliberately excludes `severity`, phase membership,
`default_blocker`, ruleset/profile membership, and action authorization.

## Baseline dispositions

| Baseline rule ID | Owner | Disposition | Reason |
| --- | --- | --- | --- |
| `tidas.flow.classification.elementary.valid` | tidas-spec | public v1 | Direct methodology rule for controlled IDs and continuous levels. |
| `tidas.flow.evidence.field-bindings.required` | Foundry/toolkit profile | product-local | `EvidenceManifest` is not a public TIDAS entity. |
| `tidas.flow.flow-property.mean-value.positive` | tidas-spec | public v1 | Direct methodology definition and validation cases. |
| `tidas.flow.identity.alias-equivalence.review` | product identity workflow | product-local | `IdentityDecision` and `FlowIdentity` are workflow entities; reuse/review is product policy. |
| `tidas.flow.name.base-name.technical` | tidas-spec | public v1 | Direct public naming rule. |
| `tidas.flow.reference-property-unit.required` | tidas-spec | public v1 | Direct quantitative-reference and flow-property reference rules. |
| `tidas.flow.type.required` | tidas-spec | public v1 | Methodology explicitly marks the field mandatory and enumerates its values. |
| `tidas.process.evidence.field-bindings.required` | Foundry/toolkit profile | product-local | `EvidenceManifest` is not a public TIDAS entity. |
| `tidas.process.exchange.amount.required` | tidas-spec | public v1 | Direct exchange amount rule. |
| `tidas.process.identity.duplicate-fingerprint.block` | product identity workflow | product-local | Fingerprint composition and blocking are product policy over non-TIDAS workflow entities. |
| `tidas.process.name.base-name.align-reference-flow` | tidas-spec | public v1 | Direct public naming rule. |
| `tidas.process.name.qualifiers.structured` | tidas-spec | public v1 recommendation | Direct placement guidance; products choose whether it warns or blocks. |
| `tidas.process.quantitative-reference.required` | toolkit/CLI profile | product-local pending source correction | Its recorded source points to exchange flow references and does not establish the broader claimed quantitative-reference requirement. |
| `tidas.process.version.format` | tidas-spec | public v1 | Direct version format and monotonicity rule. |

Every baseline rule therefore has exactly one disposition: 9 public and 5
product-local. A product-local disposition is explicit ownership, not a claim
that the rule is invalid. Promotion requires a separately reviewed source
binding and positive/negative cases.

## Taxonomy extension

`elementary_flow_taxonomy_extension.v1.json` remains owned by `tidas-toolkit`.
Its base identity and executable checks are pinned there, but W8 found no
reviewed source-rights record or public-specification decision for its ten
extension nodes. It must not enter the public package or public rule index until
source, version, rights, and checking semantics are independently reviewed.

## Consumer boundary

- `tidas-spec` owns only the definitions in `public-rules.v1.json`.
- `tidas-toolkit` owns executable validation, catalog reports, taxonomy
  extensions, and toolkit profiles.
- CLI and products own phase selection, severity, blocking, waivers, UI, and
  operation authorization.
- A failed public definition cannot be rewritten as passed by a product profile;
  a profile may only decide applicability and disposition in its own operation.
