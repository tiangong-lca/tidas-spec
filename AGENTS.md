---
title: tidas-spec Repository Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: tidas-spec
language: en
whenToUse:
  - when changing the public TIDAS specification content, its language variants, or its publication artifacts
  - when routing work from lca-workspace into tidas-spec
  - when deciding whether work belongs in tidas-spec, tidas, tidas-toolkit, tidas-sdks, or lca-workspace
  - when qualifying a specification release or a consumer's adoption of one
whenToUpdate:
  - when the repository's stable responsibility or non-goals change
  - when the repository ownership boundary or publication path changes
  - when branch model, delivery, or root integration facts change
  - when repository documentation governance changes
checkPaths:
  - AGENTS.md
  - README.md
  - LICENSE
  - .gitignore
  - .docpact/config.yaml
lastReviewedAt: 2026-09-18
lastReviewedCommit: ea4a58984c22734f2d54cda6d45b2733d9920ac0
lastReviewedNote: "W8 separates reviewed public rule definitions from product execution policy. Nine definitions enter the F3 public index; five mixed-catalog rules and the unqualified taxonomy extension remain explicitly product-local. Formal publication remains blocked by unresolved per-artifact licensing."
related:
  - README.md
  - .docpact/config.yaml
  - LICENSE
  - docs/specification.md
  - docs/qualification.md
  - docs/provenance.md
  - docs/public-rule-adjudication.md
---

# tidas-spec Repository Contract

`tidas-spec` is the public TIDAS specification repository, published at canonical remote `https://github.com/tiangong-lca/tidas-spec.git`. This contract holds the facts that must stay stable across tooling and sessions: what this repository owns, what it must never absorb, how delivery works, and which invariants are not negotiable.

Read this file first, then the routed governed documents. [`README.md`](README.md) carries the current bootstrap state, contributor orientation, and the validation guide. `.docpact/config.yaml` carries the machine-readable catalog, ownership, coverage, routing, rules, and document inventory.

## Repository responsibility

`tidas-spec` is the single human-maintained source for the public TIDAS specification, and publishes it as an asset-only package with a content-identical release archive.

Stable responsibility:

- public structure and field semantics of the TIDAS specification, published as schema assets;
- independent language variants of those assets, kept equivalent in constraint meaning;
- shared methodology content for the public entities the specification covers;
- controlled public vocabularies and taxonomies, once a reviewed disposition moves them here;
- versioned public rule definitions, source bindings, applicability, normative level, and conformance cases after reviewed adjudication;
- examples, conformance material, and specification documentation that ship with the assets;
- the deterministic asset build: file-set, lock, manifest, and archive integrity verification;
- the versioned publication artifacts and their publication record.

The specification package has no runtime dependency, no install script, and no executable behavior. Consumers read its assets; they do not execute it. The build and verification scripts in this repository are development and CI tooling: they are not shipped in the package, and their `yaml` and `ajv` dependencies are development-only, pinned exactly in `package.json` and locked in `pnpm-lock.yaml`.

## Non-goals

The following are outside this repository. Route them to their owner instead of adding an approximation here:

- **Product profiles and gate behavior.** Whether a rule blocks, warns, or is informational; task-level applicability; and product-specific required-field or UI behavior belong to the consuming product repository. Only the public definition belongs here.
- **Rule execution policy.** Phase membership, severity, blocker defaults, waivers, profile composition, and operation authorization never enter the public rule index.
- **SDK runtime and generated surfaces.** Generated types, validators, factories, error codes, contract APIs, and packaged runtime assets belong to `tidas-sdks`.
- **Tooling and conversion behavior.** Validation, conversion, import, export, reporting, and the tool-side runtime ruleset belong to `tidas-toolkit`.
- **Database and service schemas.** Database structures, migrations, RPC and RLS definitions, Worker request schemas, Edge request schemas, and Foundry task schemas are owned by their own repositories.
- **The documentation site.** Public site runtime, navigation, localization rendering, search, and deployment belong to `tidas`.
- **Workspace integration.** Submodule pointers, cross-repository coordination, integration branches, and the workspace delivery lifecycle belong to `lca-workspace`.

A rules- or schema-shaped file in another repository is a candidate for an ownership analysis, not proof of duplication. Public definitions move into `tidas-spec` only through an explicit, reviewed disposition that names the owner, the semantic decision, and the positive and negative cases. Until that disposition exists, the current owner keeps the definition.

The W8 dispositions are recorded in [`docs/public-rule-adjudication.md`](docs/public-rule-adjudication.md). The corresponding F3 contract is `assets/tidas/rules/public-rules.v1.json`; it must remain free of product execution policy.

`tidas` continues to own its site and presentation surface. Ownership of public specification content transfers only through a reviewed disposition with a named owner, the semantic decision, and supporting positive and negative cases. Specification-asset ownership in this repository is established for the M1 asset set by the tracked W1 disposition; it is not extended to any definition that disposition does not name.

Development checks (`yaml` for YAML parsing, `ajv` for Draft 7 fixture validation) are development-only. They are not part of the package and do not make the package executable.

## Execution facts

- routine branch base: `main`
- routine PR target: `main`
- branch model: `M1` (`main` single trunk, no persistent `dev`)

Branch model, PR target, integration eligibility, and the current trunk commit resolve from the workspace branch policy contract and the delivery profile, not from this file. Read them there at execution time; do not reconstruct them from this contract. If they disagree with this section, stop and repair the contradiction before branching.

## Delivery

Tracked delivery is **controller-first**. Once the root has onboarded this repository, every tracked task uses the workspace delivery controller (`scripts/workspace-ops` from the workspace root) for Project, Issue, PR, durable-comment, and completion-state changes, and follows the continuation the controller returns rather than reconstructing lifecycle transitions from prose.

Tracked delivery here requires this repository to be registered in the root `.gitmodules`, `.workspace-delivery/workspace.toml`, and Docpact catalog. Verify registration in those root inventories at execution time. While it is absent, tracked delivery is unsupported, and an untracked or locally committed change is not tracked delivery.

There is **no bootstrap exception** for later product code. Holding only governance files while the first assets are prepared does not permit code, generated surfaces, product behavior, or runtime logic to land here under a "still early" justification. Anything that is not public specification content or its publication artifacts belongs to another repository at any stage.

A merged PR in this repository proves repository-level delivery only. Workspace delivery additionally requires an eligible commit, the exact root pointer update, and the required integration record.

### Session handoff

When ending a work session, report the phase, the owning repository, the exact changed paths, the current head SHA and reviewable diff range, the commands actually run with their results, any check not run and why, remaining uncertainty, and an explicit statement of what is not yet merged or accepted. Keep durable decisions and blockers in the Issue or PR, not in a local note or chat history.

## Invariants

**Immutability and provenance**

- A published version's content never changes. A correction is a new version; an already-published differing artifact stops publication instead of being overwritten or dropped.
- Migrated assets preserve their source semantics exactly. Sharing, material balance, reference-upgrade, and draft-blocking semantics change only through a separate reviewed decision, never as a side effect of a move.
- Every release binds its version to the exact source commit, the published file list, and per-file hashes. An unverifiable source is not published.
- The npm package and the release archive carry the same reviewed files. Duplicate publication only fills a missing channel; it never republishes different content under an existing version.

**Language variants**

- Language variants are kept equivalent in constraint meaning. A structural difference between variants is recorded and reviewed, not silently normalized to make a check pass. Generating one structural source into multiple languages is a later, separately reviewed change.

**Reference closure and independence**

- Every published local reference resolves inside the package. A release with a broken relative reference or an undeclared external network dependency fails.
- The asset build reads no sibling source checkout. Consumers must be able to unpack and read a release without `tidas-toolkit`, `tidas-sdks`, or `tidas` present.
- Reference discovery walks the schema vocabulary of the document it is reading. A `$ref`-shaped key inside instance data (`examples`, `default`, `enum`, `const`) is data, not a reference, and requiring it to resolve would invent a constraint the specification does not make. A schema that declares an instance property named like an allowed localized key stops the language comparison instead of silently widening its allowance.
- Reference closure follows reachability, not keyword classification: a location is a schema position because a reference reached it. This keeps the source's own `$defs` definitions — a keyword its declared dialect does not define — inside the closure while leaving unreferenced extension data and later-draft keywords outside it.
- Fragments are URI-decoded exactly once and then follow RFC 6901. An invalid escape or a double-encoded fragment is an error, never a lookup that happens to succeed.
- A source constraint that contradicts the declared dialect, such as a `$ref` object carrying assertion-bearing siblings, is reported as a finding with its count, keyword histogram, and every affected location, and is recorded in the manifest. It is neither silently accepted nor silently fatal, and it is never resolved by rewriting the source.
- Sibling keywords are classified into three disjoint groups: known assertions, known non-assertions, and siblings the declared dialect does not define, which are unclassified. Assertion-bearing siblings and unclassified siblings are each surfaced separately, with their own count, keyword histogram, and locations; an unclassified sibling is never reported as a known assertion, and its report claims neither that it restricts the instance nor that any evaluator disagrees about it. Classification is by whether a keyword *asserts*, which is a different question from whether its value may be traversed as schema: `const` and `enum` are instance data, never descended into, and are assertions at the same time because they restrict the instance.
- Draft 7 resource scope is implemented, not refused: document roots and nested non-fragment `$id`s are indexed, and a reference resolves against the base in effect at its own location. A base the package does not contain, or one established twice, is reported rather than guessed at, and nothing is ever fetched.

**Determinism and identity**

- Two clean builds of one version produce an identical manifest and byte-identical archives. No timestamp, host name, absolute path, or run counter reaches a generated file; the archive is written by tooling in this repository rather than by host `tar`.
- CI compares the committed manifest and archive against the current content before building, so stale committed output is reported rather than silently regenerated.
- A candidate is either a **draft**, which claims no source revision and is not eligible for downstream consumption, or **qualified**, which claims a revision validated against the Git repository at build time and recorded in a receipt outside every artifact it describes. A caller-supplied commit SHA is never accepted as a source revision. See [`docs/qualification.md`](docs/qualification.md).
- Every shipped file is bound by an exact byte digest, including the metadata that carries the provenance and the review anchor. The manifest itself is the single exception, because it cannot contain its own digest; it is bound from outside by the receipt.
- The manifest is a pure function of the shipped content and carries no source-revision claim. A manifest naming the commit that contains it is a fixed point no commit satisfies, and a qualified build must be reproducible from the commit without dirtying the tree it came from. The revision belongs to the receipt.
- Archive bytes are reproducible within one pinned toolchain. The gzip framing comes from the platform zlib, so the byte-equality claim is scoped rather than universal, and the receipt records all four deciding fields — node, zlib, platform, arch — so the scope is checkable. Content equality — every entry's digest — holds everywhere, and the recorded archive digest is checked against the bytes on disk in every case.
- The pinned toolchain lives in `toolchain.json`, outside the published package. It is enforced by `scripts/ci/require-toolchain.mjs` rather than merely documented, and CI provisions pnpm from the same file. Do not move the pin into `package.json`: the npm client strips that field while packing. Do not claim a pin that nothing enforces.
- A previously qualified revision is carried onto a rebuild only after revalidation: same package and version, same content digest, `HEAD` still at that revision, packaged bytes still matching it. Otherwise the candidate becomes an explicit draft that names the reason. Reusing a stale claim for changed content is laundering, not preservation.
- Checking is non-mutating. A drift check computes expected bytes in memory and leaves the candidate root byte-for-byte unchanged on success and on failure alike, so a stale committed artifact cannot be silently regenerated by the check that is supposed to detect it.
- Tests never build, pack, or install in the reviewed checkout. Builds run in disposable copies, and a guard proves the repository is unchanged after the suite; otherwise a test would rewrite the artifacts under review.
- Four identities stay distinct and are never presented as one another: the source repository and commit the bytes came from, the commit of this repository the candidate was built from, the per-file and aggregate content digests, and the archive digest.
- The manifest cannot contain its own hash. Its identity is its file list and aggregates; the archive digest is recorded beside it in a disposable build record that repeats the manifest's asset digest. An unresolvable source commit, or a fabricated one, is a failure rather than a claim that reaches a release record.
- The npm package and the release archive are assembled from the same `files` whitelist, so they cannot carry different files. A file that is neither an approved specification asset nor expected package metadata is a failure, not extra published surface.

**Publication**

- Publication is a distinct, reviewed version-preparation step. An ordinary `main` commit never publishes automatically; CI verifies the candidate and never publishes.
- The only publication automation is the manually invoked `.github/workflows/publish-spec-release.yml` workflow. It defaults to `blocked`, requires an explicit `publish` approval, verifies the qualified source commit plus archive and manifest digests, and treats an existing version as immutable: an exact replay is allowed, while any identity conflict fails closed.
- After an immutable release is present, the workflow emits one `tidas_spec_released` repository-dispatch event. Its `event_key` is derived from package, version, archive digest, and manifest digest; consumers must treat that key and the exact source/archive/manifest fields as the release identity and reject stale or conflicting replays.
- This repository holds no runtime dependency and no install script. Adding one requires an explicit reviewed contract change, not an implementation convenience.
- A candidate may be built and verified while per-artifact licensing is unresolved, and it may be used for continued validation. It may not be published as a formal release, and no artifact may be described as fully licensed, until the provenance record resolves each imported artifact's rights.

**Licensing**

- `LICENSE` reproduces the MIT notice of the tools source that supplies the first extracted assets.
- That notice does not establish the license of every imported artifact. Each imported artifact needs its own verified source and license record before publication. Never describe the whole package as MIT-licensed on the strength of the source notice alone.
- [`docs/provenance.md`](docs/provenance.md) is the standing record: verified source facts, the explicitly unresolved third-party classification rights, and the resulting publication block. Resolving an entry there is a reviewed content decision with a named authoritative source, not an edit that makes a blocker disappear.

**Governance self-consistency**

- Update `.docpact/config.yaml` when machine-readable paths, ownership, coverage, routing, rules, or the document inventory change; update this file when the stable responsibility, non-goals, or invariants change; update `README.md` when the current state, contributor entry, or validation guide changes; update `docs/specification.md` when the artifact contract or verification stages change, `docs/qualification.md` when the draft/qualified boundary or the source-binding mechanism changes, and `docs/provenance.md` when a source or licensing fact changes.
- Do not copy the same detailed procedure into several documents.
- This repository has no local Docpact wrapper or git hook. Resolve the workspace wrapper and pass this repository as explicit `--root`; do not assume bare `docpact` is installed or that `--root .` means the workspace root.

## Escalation

Stop before mutation when the owning repository for a definition cannot be established from current contracts, when a source artifact's provenance or license is unverified, when a proposed asset move would change specification semantics, or when a publication would create or overwrite a version whose content cannot be verified against the reviewed candidate. Record the blocker in the tracked record with the evidence and the exact decision needed.
