# TIDAS specification candidate structure

This document describes the candidate's files, how its identities relate, and
which invariants the verifier enforces. The contributor entrypoint and command
reference are in [`../README.md`](../README.md).

## Version

Version `0.2.2` of `@tiangong-lca/tidas-spec` is formally published. This
checkout prepares an unpublished `0.2.3` candidate; consumers continue to
bind exact reviewed archives and must not infer publication from a version bump.

## Files

| Path | Role |
| --- | --- |
| `assets/tidas/schemas/*.json` | 18 reviewed English JSON Schemas, Draft 7. |
| `assets/tidas/schemas_zh/*.json` | The same 18 schemas in Chinese. Neither set is treated as authoritative over the other; see [Language sets](#language-sets). |
| `assets/tidas/methodologies/tidas_flows.yaml` | Flow methodology rules and guidelines. |
| `assets/tidas/methodologies/tidas_processes.yaml` | Process methodology rules and guidelines. |
| `assets/tidas/rules/public-rules.v1.schema.json` | F3 contract for accepted public rule definitions. |
| `assets/tidas/rules/public-rules.v1.json` | Nine reviewed public definitions with stable ID, applicability, normative level, source references, and positive/negative cases. Product gate policy is excluded. |
| `assets/tidas/schema.lock.json` | The derived schema lock, regenerated explicitly after a reviewed constraint change. |
| `source-import.yaml` | Reviewed import record: source repository, commit, and the SHA256 of every imported file. |
| `reviewed-baseline.json` | Independent review anchor: the digests of the reviewed source inventory and of the reviewed shipped bytes. |
| `package.json` | Publication metadata, stored in the canonical form both channels ship; see [Package.json identity](#packagejson-identity). |
| `spec-manifest.json` | Generated release manifest binding the version to every shipped file except itself. A pure function of the shipped content; it carries no source-revision claim. |
| `release/tiangong-lca-tidas-spec-0.2.3.tgz` | Generated canonical candidate archive. Committed: it is a reviewable future release artifact, not a replacement for published 0.2.2. |
| `build/candidate-archive-binding.json` | Generated **candidate receipt**: the reviewed source revision and the artifact digests, outside every artifact it describes. Disposable; not committed, and not required to verify an archive's content. |
| `scripts/spec/**` | Build and verification implementation. |
| `scripts/import-tidas-spec-source.mjs` | The only script that reads a source checkout, and only at import time. |
| `scripts/spec/update-schema-lock.mjs` | Regenerates the derived lock after a reviewed schema constraint change; verification never regenerates it implicitly. |
| `test/**` | Unit, conformance, and integration tests. |
| `docs/qualification.md` | The draft/qualified boundary and how a source revision is bound. |

## Four identities, kept distinct

A single version bump touches four different things, and conflating any two of
them is how a release ends up claiming something untrue.

1. **Source identity** — where imported bytes came from: `tidas-toolkit` at
   `9c0d8b1c8ceb1841074f5bc6de5fbb7fcc9318f5`, recorded in `source-import.yaml`
   together with the SHA256 of each remaining byte-identical imported file and
   of the tools `LICENSE`. Superseded paths are named separately and their
   current package bytes are attributed to `tidas-spec`, never to that commit.
2. **Package source revision** — the commit of *this* repository the candidate
   was built from. It is a different repository and a different commit from (1),
   and it is recorded in the candidate receipt rather than in the manifest. A
   draft records `null` explicitly rather than guessing.
3. **Content identity** — the SHA256 of each shipped file, and the two
   aggregate digests over them (`filesSha256` over raw bytes,
   `filesContentSha256` over line-ending-normalized bytes).
4. **Artifact identity** — the SHA256 of the candidate archive itself.

Identity (1) is an *input*: the build never reads the source repository, and the
verifier cannot recompute it. What the verifier can do, and does, is refuse to
let one edited file assert it: `source-import.yaml` and `reviewed-baseline.json`
are separate reviewed inputs, so they must agree, and the file digest they imply
must equal the digest of the bytes actually shipped.

## What the manifest binds

The manifest binds every file the package ships with an **exact byte digest** — 46
of the 47 files, in `files`, plus the two aggregate digests over that list. The
one exception is the manifest itself, which cannot contain its own digest and is
bound from outside by the candidate receipt.

`test/conformance/verifier.test.mjs` proves completeness independently: it
enumerates what the package would publish and requires every file to be bound,
with no file bound that is not shipped.

### Language sets

Both language sets ship and both are verified. Whether they remain **jointly
normative**, and how translations are maintained, is an open question: the
execution plan records it as an unresolved item and
[provenance.md](./provenance.md) states it is not adjudicated. A comparison
baseline is not an authority decision, and no approved disposition establishes
one set as authoritative.

The verifier therefore treats the two sets identically:

- **structural equivalence** is enforced in both directions — the 18 pairs must
  be equal after removing only the declared localized keys;
- a reference that crosses between the language sets is an **ordinary
  reference**. It resolves if it resolves, and fails for the same reasons any
  other reference fails: escaping the package, a missing target, a missing
  fragment, a non-schema target. It is not rejected for crossing a boundary, and
  neither direction is privileged;
- the number and direction of cross-language references is reported as an
  observed fact about the reviewed content, so a change in the arrangement is
  visible without the arrangement being imposed.

The reviewed sets happen to keep every reference inside its own language. That is
recorded as what the source does, not enforced as what the source must do.

### Process reference and data-set type

The Process `quantitativeReference` requires a field according to its `@type`:

| `@type` | Required field | Allowed additional text/reference |
| --- | --- | --- |
| `Reference flow(s)` | `referenceToReferenceFlow` | `functionalUnitOrOther` may also describe the function. |
| `Functional unit`, `Other parameter`, `Production period` | `functionalUnitOrOther` | A supplied `referenceToReferenceFlow` retains its `Int6` constraint, but is not required. |

The `functionalUnitOrOther` field keeps its existing language-tagged
`StringMultiLang` shape, including bilingual text. The type discriminator itself
remains required and its four allowed values are unchanged. This permits a
denominator such as “1 t unwashed raw coal” to be represented as `Other
parameter` without inventing a reference exchange. Separately,
`modellingAndValidation.LCIMethodAndAllocation.typeOfDataSet` is optional; if
provided, its existing enum still applies. Omitting it avoids asserting a
unit-process model for a coefficient-only record.

These English and Chinese schema corrections belong to Issue #29 and are
conformance rules, not a conversion or product gate policy. The prior schema
unconditionally required a flow reference and a data-set type, so consumers
with pinned older schema bytes need a separate reviewed adoption of the new
candidate; changing this source alone does not update SDK, CLI, or toolkit
assets.

### Process name fields

Issue #31 retains the four ILCD field keys and adopts the following TIDAS
product-LCA authoring convention. This is guidance about content, not a new
schema enumeration or a consumer runtime gate.

| Field | Content | Boundary |
| --- | --- | --- |
| `baseName` | Product or service identity. | For one reference Flow, exactly match its base name in each corresponding language. Multiple-reference names retain the technology/plant descriptor and identify all reference flows. |
| `treatmentStandardsRoutes` | Evidenced grade, treatment, standard, relevant feedstock origin and technology route. | Numeric grade identifiers such as C30 or S355 remain grades. A shared Flow does not substitute for Process-specific route evidence. |
| `mixAndLocationTypes` | Supply composition scope and delivery node, as independent qualifiers. | Production, market consumption and enterprise procurement scopes are distinct. Specific technology is not a mutually exclusive mix class. |
| `functionalUnitFlowProperties` | Evidenced quantitative specifications affecting function, quality, physical state or substitutability, with units, basis and relevant conditions. | A reference amount, conversion, footprint result or supplier weight is not a product specification. |

A shared Flow can identify a product for different compatible production routes.
Two Processes may therefore keep `Alternating current` as base name while
identifying supported coal and wind routes separately. Equality of base names
does not establish compatibility of the Flow's full qualifiers, properties or
exact version; `Electricity` is not an automatic alias for `Alternating current`.
Do not copy a narrower Process route or supplier scenario into a reusable Flow
merely to distinguish Process records.

A production mix describes output within its documented production scope; a
market consumption mix describes supply consumed in a documented market; an
enterprise procurement mix describes an enterprise's purchases. Enterprise
procurement is an explicit TIDAS extension, not an original ILCD enumeration or
a claim of market representativeness. A mix can use one or several technologies.
Delivery to a user, a Flow name, a loss proxy or a mapping adapter alone proves
no consumption mix. If only the delivery node is known, state only that node.

`To` names arrival at the receiving node before its subsequent processing;
`at` names departure or availability after the represented processing. Thus
`to refinery receiving terminal` and `at refinery gate` distinguish interfaces.
A node or preposition does not establish complete inventory coverage. Included
transport, losses, processing and exclusions still need boundary evidence.
The Flow methodology uses these same mix/node meanings without imposing an
individual Process's technology or scenario on a Flow identity.

Physical supply composition and contractual/attribute accounting stay separate.
A certificate alone establishes neither physical generation technology nor zero
impact. Record the applicable accounting basis in modelling documentation. An
evidenced `30 % recycled material by mass of finished product` describes a
material specification; a 30 % share from one supplier is procurement composition
and belongs with the documented weights, not the fourth name field. Unknown
specifications stay absent; neither `1 kWh` nor `1 kWh = 3.6 MJ` fills the gap.
Equipment capacity, processing duration and loss rate belong in technical or
modelling descriptions unless they define the delivered service specification.

Model names describe the whole represented supply system and delivery interface.
A Model with mixed diesel supplies and transport cannot inherit only a final
refinery route and plant-gate name; its resulting Process keeps the reviewed
whole-Model name. A graph or node label cannot provide missing upstream evidence.
Keep geographic codes, years, site identifiers, full boundaries and quality
caveats in their dedicated metadata. Preserve meaningful name information in
every authored language, or explicitly justify its removal.

The [ILCD Process format](https://eplca.jrc.ec.europa.eu/LCDN/downloads/ILCD_Format_1.1_Documentation/ILCD_ProcessDataSet.html)
provides the four field meanings. [ILCD Handbook Rule 20, section 3.5](https://eplca.jrc.ec.europa.eu/uploads/MANPROJ-PR-ILCD-Handbook-Nomenclature-and-other-conventions-first-edition-ISBN-fin-v1.0-E.pdf)
recommends full-name alignment for single-reference Unit processes, LCI results
and partly terminated systems. TIDAS's narrower field-scoped convention is a
project decision, not a claim that ILCD applies only after publication.
This candidate is unshipped. Exact-reference checks, evidence-binding execution,
SDK nonempty requirements and gate policy remain consumer-owned; editing this
methodology changes no installed SDK/CLI or publication authorization.

### Process review cardinality

The Process `modellingAndValidation.validation.review` property preserves the
existing single-object representation and additionally accepts a non-empty array
of the same `ProcessReview` definition. Every member is therefore subject to the
same `@type`, conditional completed-review evidence, and optional-report-reference
validation. The property remains required by TIDAS; aligning the separate ILCD
`minOccurs=0` optionality question would be a distinct reviewed semantic change.

This shape matches XML-to-JSON behavior without requiring existing singleton
documents to be rewritten. Generated SDK types, Toolkit adoption, CLI package
validation, and workspace integration remain consumer-owned deliveries rather
than consequences implied by this candidate alone.

### EF methodology scope

The Process YAML adds source-bound EF guidance using the existing field rule
structure. Rule applicability distinguishes ordinary TIDAS, full EF datasets,
non-primary supporting datasets and eILCD model exchange. The source registry is
part of the shipped YAML; [the coverage map](ef-process-methodology.md) records
source sections and representation limits. These additions do not change the
nine adjudicated public rules, either schema variant or consumer gate policy.

### Package.json identity

`package.json` is stored in the form the npm client produces when it packs:
`JSON.stringify(document, null, 2)`, with no trailing newline, keys in npm's
canonical order, and no `packageManager` field. The pnpm version is pinned in
`toolchain.json`, which the package `files` whitelist excludes; see
[Toolchain pinning](#toolchain-pinning).

The consequence is that `pnpm pack` is a **no-op** for this file. Both channels
therefore ship byte-identical bytes for every entry, and the integration suite
asserts exactly that against a real `pnpm pack` and a real `npm install` — not
"equivalent modulo normalization".

The verifier enforces the serialization (`package/` → `package/canonical-serialization`),
so a hand-edit that reformats the file fails rather than silently breaking channel
parity.

## Why the manifest cannot hash itself

`spec-manifest.json` cannot contain its own digest, and a field that claimed to
would be either wrong or circular. The resolved structure is:

- the manifest's identity is its `files` list plus `aggregates.filesSha256`
  and `aggregates.filesContentSha256`, all derived from the shipped bytes;
- the receipt carries the digest of one concrete archive **and** repeats the
  manifest's digests and source revision, from outside the archive;
- verification reads both and fails if the archive's contents, the manifest's
  digests, and the receipt's records do not agree.

### Why the revision is not in the manifest

A manifest naming the commit that contains it is a fixed point no commit
satisfies. The manifest is therefore content-only and reproducible from the
commit, which is what keeps a qualified build from dirtying the tree it came from.
The revision lives in the receipt; see [qualification.md](./qualification.md).

The receipt is disposable build output, not governed source. It is ignored by Git
and regenerated on every build, so two builds with different content cannot leave
the older record in place and still pass.

## Verification stages

`node scripts/spec/verify.mjs` runs four stages; `--stage` selects a subset.

### `identity`

- **File set.** The shipped files must be exactly the approved set: no extra
  file anywhere under `assets/`, no missing file, no symlink, no non-regular
  file. 18 schemas per language and 2 methodology files are asserted, not
  inferred.
- **Parsing.** Every JSON file is parsed with a duplicate-key scan (a duplicate
  key is silent data loss under `JSON.parse`); every YAML file must parse as
  exactly one document, with duplicate keys and malformed syntax as errors.
- **Source bytes.** Every remaining imported file's SHA256 must equal the digest
  recorded in `source-import.yaml`. Every other shipped asset must appear in the
  explicit repository-authored allowlist; removing an import entry cannot
  silently reclassify an arbitrary file as owned.
- **Schema dialect and meta-validation.** Every schema must declare the reviewed
  Draft 7 meta-schema, and must actually be a valid Draft 7 schema: each document
  is validated against the meta-schema offline, matching what the pinned source
  tool does before it will lock a schema. Declaring the dialect is not the same as
  conforming to it.
- **Language equivalence.** The 18 pairs must be equal after removing only the
  keys the lock declares as localized (`description`). Nothing is normalized or
  reordered. If a schema ever declares an instance *property* named like a
  localized key, the verifier stops instead of silently widening the allowance.
- **Schema lock.** The lock is recomputed from the shipped bytes with the pinned
  source tool's algorithm and must equal the shipped lock exactly, including the
  aggregate digests. A hand-edited or stale lock fails.
- **Reference closure.** Every `$ref` must resolve inside the package, and must
  resolve to a schema: an object, or a boolean, as Draft 7 permits. A scalar or
  array target is rejected — treating "reached something" as success would accept
  a document that cannot be evaluated. Fragments are URI-decoded exactly once and
  then follow RFC 6901: `~0` and `~1` are the only valid escapes, an invalid `~`
  escape is an error, and a double-encoded fragment does not reach the member a
  single decoding would.
- **Resource scope.** `$id` is resolved, not refused. Every subschema carrying a
  non-fragment `$id` at a schema position is indexed as a schema resource whose
  base resolves against its parent's base (Draft 7 core section 8.2); a reference
  resolves against the base in effect at its own location, and a pointer fragment
  is relative to the resource it is written in rather than to the document root.
  Discovery has two halves that feed each other: static discovery follows schema
  positions from each document root, and a reached subschema — one a real
  reference points into, whatever keyword stores it — is indexed in turn. An
  `$id` inside `examples`, inside an unreached extension member, or beside a
  `$ref` is data, not a declaration. Two declarations of one base are reported.
- **Absolute identifiers are aliases, not requests.** A declared absolute `$id`
  is a resource this package contains, so a reference to it resolves offline with
  no network access. Only a reference to a base no document declares is refused,
  because resolving that would require a fetch. A root `$id` correctly rebases
  the relative references written in that document, and only that document.
  The walk follows Draft 7 subschema positions only — `examples`, `default`,
  `enum`, and `const` hold instance data, and a `$ref`-shaped key inside them is
  data, not a reference.
- **Reachability, not keyword classification.** The reviewed source stores its
  shared types under `$defs`, which Draft 7 does not define. Rather than
  classifying storage keywords, closure starts at each document root and follows
  resolved references: a location is a schema position because a reference
  reached it. `#/$defs/UUID` therefore makes that definition live and its own
  references are followed, while an unreferenced `$defs` member, or a reference
  inside a later-draft keyword such as `dependentSchemas`, contributes nothing.
  A `$ref` object's siblings are reported: annotation-only siblings as one
  summary warning, and constraint-bearing siblings as a recorded source finding
  (see below).
- **Identifier scope.** Same-document `#anchor` identifiers and nested resource
  bases are both resolved; duplicate anchors and duplicated bases are reported
  rather than resolved by first-wins. A declaration reached by both discovery
  halves is one declaration, not a duplicate.
- **Methodology.** Both YAML files must parse to a mapping that still carries
  rule material. The verifier reports the status each rule states in the file; it
  does not promote the methodology into a new universal blocking policy.
- **Public rules.** The versioned index must satisfy its JSON Schema, use unique
  sorted IDs, carry positive and negative cases, and contain no product execution
  policy fields such as severity, phase, blocker defaults, rulesets, or profiles.

### `manifest`

`spec-manifest.json` is recomputed from the shipped bytes and compared
**field for field, with no exemptions**: the file list, the aggregates, the
counts, the source and license record, the excluded paths, and the findings
record must all match exactly, and the manifest must be in the canonical
serialization (two-space indent, LF, one trailing newline).

A manifest carrying a source-revision claim (`reviewedPackageSource` or a
top-level `releaseCommit`) is rejected outright. The manifest is a pure function
of the shipped content and cannot name the commit that contains it; the reviewed
revision is validated during [candidate qualification](./qualification.md) and
recorded in the receipt, outside every artifact it describes.

### `package`

`package.json` must declare the reviewed name and version, must declare no
dependency of any kind, must declare no install or publish lifecycle script, and
must carry a `files` whitelist.

The whitelist is checked from both directions: every approved specification
asset must be published, and nothing outside the approved asset set plus the
expected package metadata may be. A whitelist entry that matches nothing is a
failure, as is an asset the whitelist would silently drop or a file it would add
beyond the reviewed set. `package.json` must also be in the canonical
serialization both channels ship, so a hand-edit that reformats it fails rather
than quietly breaking channel parity.

### `archive`

The archive is read with this project's own ustar parser, which validates entry
names for traversal and refuses non-regular entries before anything touches the
filesystem. It must contain exactly one `package/` directory and no file that no
manifest entry accounts for. An absent receipt never fails this stage; an asserted
source revision with no receipt to check it against does.

Four checks then bind the archive to the candidate, and they are what make a
newly built, internally inconsistent archive fail even when its outer digest is
recomputed and correct:

- **`archive/manifest-identity`** — the manifest *inside* the archive is
  byte-identical to the candidate's manifest;
- **`archive/manifest-self-consistency`** — the manifest inside the archive
  describes the archive's own contents, recomputed from the extracted bytes with
  no reference to the outer tree;
- **`archive/self-verification`** — the unpacked package passes the identity,
  manifest, and package stages on its own;
- **`archive/binding`** — the candidate receipt binds the archive digest to the
  manifest's aggregate digests and records the reviewed source revision. Where a
  revision is asserted with `--expect-source-commit`, the receipt must match it.
  Where no receipt is present — a fresh checkout, or an unpacked package — the
  absence is reported and the archive still verifies on its content.

## Recorded source finding: `$ref` siblings

Draft 7 core section 8.3 says that a `$ref` object's other properties "MUST be
ignored", so the referenced schema is the whole constraint. AJV 8.20.0 applies
them instead, so the two readings produce different instance validity for the
affected objects.

Every `$ref` object the resolver reaches falls into exactly one of four
categories, and the numbers reconcile:

| Category | Meaning | Count |
| --- | --- | --- |
| Assertion-bearing siblings | A sibling is a keyword of the declared dialect that restricts the instance, so ignoring it changes what the file appears to state. | 52 |
| Non-asserting siblings only | Metadata (`description`, `title`, …) or a reserved container (`definitions`, `$defs`). Nothing about validity turns on it. | 552 |
| Unclassified siblings | A sibling keyword the declared dialect does not define. Its semantics are unknown. | 0 |
| No siblings | The `$ref` is the whole object. | 486 |
| **Total reached `$ref` objects** | | **1090** |

The 52 objects are `{const} x48`, `{format} x2`, `{type} x2`. The categories
partition the reached population exactly, so nothing is unaccounted for.

### How a sibling is classified

`classifySiblingKeyword` answers one question: does this sibling *assert*? It is
deliberately separate from the question "may this value be traversed as a schema
at all". `const` and `enum` are both: they are instance data (never descended
into) and assertions (they restrict the instance). Conflating the two questions is
a defect this repository already had — it reported a `const` sibling as mere
annotation and the finding disappeared.

An unrecognised keyword is its own third category, reported as
`ref-sibling-unclassified` with its own count and locations. Under the declared
dialect such a keyword has **no established assertion semantics**: it is not
evidence that the instance is restricted, and it is not evidence that two
evaluators disagree. Saying either would assert more than the source establishes.
It stays visible so a reader can see the extension is there.

The assertion set is the Draft 7 validation vocabulary; the non-assertion set is
metadata plus the two reserved containers. An object is reported as
unclassified only when it has no known assertion, so the categories partition the
objects rather than overlapping: an extension keyword can never inflate the
assertion count.

### Where the finding is recorded

Derived, never hardcoded. `analyseSiblingFindings` walks the shipped documents,
and its result is used twice: the identity stage reports it as one
`identity/reference-closure/ref-sibling-conflict` warning carrying the count,
keyword histogram, and every affected location, and the manifest records the same
structure under `findings.refSiblings`. Because one analysis feeds both, the
number a reviewer reads and the number shipped in the release artifact cannot
diverge. A conformance test independently re-derives the classification from the
documents and compares, so a hardcoded or narrowed count fails.

This is a source-semantics question with no authority available in this
repository. The source bytes are preserved exactly as received, neither reading is
applied, and no evaluator equivalence is claimed. The finding is for the
difference-disposition work package, and it does not block building, verifying, or
reviewing the candidate.

## Determinism

Two clean builds under the same pinned toolchain produce an identical manifest
and a byte-identical archive. That holds because:

- every JSON document is serialized through one canonical formatter;
- CI checks the committed manifest and archive against the current content before
  building, so a stale committed artifact is reported rather than silently
  regenerated, and that check is fully non-mutating: it computes expected bytes in
  memory and leaves the candidate root byte-for-byte unchanged on success and on
  failure alike;
- **verification** never invokes Git. Every verification stage reads shipped bytes
  and recorded digests only, so an unpacked package verifies with no repository
  present;
- **building** does use Git, for qualification rather than for content, and the two
  paths differ in what a dirty tree does. `--qualify` reads `HEAD` and the
  working-tree state to establish a source revision; if the tree is not clean — an
  uncommitted edit and an untracked file both count — it fails before writing any
  output. A routine rebuild instead *revalidates* an existing qualified receipt
  against the repository, and a failed revalidation is not an error: the build
  completes and writes an explicit **draft**, with the receipt recording the
  reason (`head-moved-since-qualification`,
  `repository-no-longer-supports-the-claim:SOURCE_DIRTY`, and so on). A build with
  no qualified claim to carry stays a draft and needs no repository state at all;
- archive entries come from one explicit, sorted list derived from the package
  `files` whitelist, are written by a ustar writer in this repository with fixed
  mode, ownership, and mtime, and are compressed with fixed gzip parameters —
  no host `tar`, whose determinism flags differ between GNU tar and bsdtar;
- no timestamp, hostname, absolute path, or run counter reaches a generated file.

The manifest is byte-reproducible across machines and runtimes. The archive is
byte-reproducible **within one pinned toolchain**: its gzip framing comes from the
platform zlib, so a different zlib build compresses the same tar to different
bytes. The uncompressed tar payload is identical everywhere. Toolchain identity is the full set of fields that determine the bytes — node,
zlib, platform, and architecture — not the Node version alone, because the
observed variance came from zlib. The drift check asserts byte equality when all
of them match the receipt, and compares archive contents — entry list and
per-entry digests, which cover every shipped file — when they do not. It always
reports which comparison ran and which toolchain it used, in both the text and
JSON output. The recorded archive digest is checked against the bytes on disk in
every case, because hashing a file does not depend on the toolchain that produced
it.

### Toolchain pinning

The exact Node and pnpm versions live in `toolchain.json`:

- it is **not published** — the package `files` whitelist excludes it — so
  declaring versions there cannot change either channel's bytes;
- it is **enforced**, not merely documented: `scripts/ci/require-toolchain.mjs`
  compares the running `node` and `pnpm` against it and exits non-zero on a
  mismatch, and `pnpm run check` runs that check first;
- CI reads the same file to provision pnpm, so provisioning and enforcement
  cannot drift apart.

This is deliberately not `package.json`'s `packageManager` field: the npm client
strips that field while packing, which would cost channel byte parity. It is also
not `.npmrc`'s `packageManager` key, which pnpm reads for its own runtime but
Corepack does not.

`engines.node` in `package.json` and `use-node-version` in `.npmrc` state the
Node requirement for consumers and the exact runtime for a build respectively;
`engine-strict=true` makes a mismatch an install failure rather than a warning.

## Archive and npm channel parity

The archive is assembled from the same `files` whitelist npm uses, and
`package.json` is stored in the form the npm client produces, so the two channels
carry **byte-identical** bytes for every entry. The integration suite packs the
package with `pnpm pack`, compares the content digest of every entry including the
publication metadata, then installs the tarball into a fresh consumer directory
with `npm install --ignore-scripts` and verifies it in place. There is no
normalization allowance and no semantic-only exemption.

## Reviewed release notification

Publication is an explicit human-approved step, not a side effect of merging
`main`. The `publish-spec-release.yml` workflow first verifies the exact
qualified source commit, committed archive, and committed manifest against the
reviewed SHA256 values. It creates `v<version>` only when that identity is not
already present; an exact replay verifies the existing release assets and a
different source or digest fails closed.

Once the immutable release exists, the workflow sends a
`tidas_spec_released` repository-dispatch event to the SDK repository. The
payload includes `package`, `version`, `source_commit`, `archive_file`,
`archive_url`, `archive_sha256`, and `manifest_sha256`; selected package
families and reviewed version bumps live under `release_options` so the
`client_payload` has at most ten top-level properties. `event_key` is the stable
`package@version:archive_sha256:manifest_sha256` replay key. A consumer must
accept an exact replay, but reject a stale version or a conflicting identity.

## Test isolation

The integration suite never builds, packs, or installs in the reviewed checkout.
Every build, check, and pack runs in a disposable copy, and a guard test snapshots
the repository recursively before and after the whole suite and fails if a single
byte moved. That guard is what makes the drift check meaningful: a test that
rebuilt the repository would otherwise rewrite the artifacts under review and mask
exactly the drift these tests exist to detect.

## Independent readers

Two checks read the published artifact without this project's code:

- a Python script using only the standard library, run with every Node-bearing
  directory removed from `PATH`, re-derives the declared file set from the
  archive and checks every digest against the manifest inside it, including the
  lock's own content hashes;
- `tar` plus the platform hashing tool reproduce digests for a sample of the
  manifest.

Both are part of the integration suite, so "a consumer without Node can read this
package" is a tested property rather than a claim.

## Unresolved provenance

The tools `LICENSE` notice (MIT, TianGong LCA) is verified against the pinned
commit and recorded. That notice covers the source repository's own licensing.
It does **not** establish the rights status of every third-party classification
or vocabulary embedded in the imported schemas: those origins are not fully
enumerated yet. This candidate therefore cannot claim a complete per-artifact
license determination, and formal publication is blocked until that record
exists. See [provenance.md](./provenance.md).
