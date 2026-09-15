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
lastReviewedAt: 2026-09-15
lastReviewedCommit: 1f0e30a65cb6040df8b5c072059a179ece7f577d
lastReviewedNote: "W0 bootstrap contract: stable responsibility, non-goals, M1 branch model, controller-first tracked delivery, unchanged specification ownership for tidas, and no bootstrap exception for later product code. No specification asset, package, release workflow, or test exists yet."
related:
  - README.md
  - .docpact/config.yaml
  - LICENSE
---

# tidas-spec Repository Contract

`tidas-spec` is the public TIDAS specification repository, published at canonical remote `https://github.com/tiangong-lca/tidas-spec.git`. This contract holds the facts that must stay stable across tooling and sessions: what this repository owns, what it must never absorb, how delivery works, and which invariants are not negotiable.

Read this file first, then the routed governed documents. [`README.md`](README.md) carries the current bootstrap state, contributor orientation, and the validation guide. `.docpact/config.yaml` carries the machine-readable catalog, ownership, coverage, routing, rules, and document inventory.

## Repository responsibility

`tidas-spec` becomes the single human-maintained source for the public TIDAS specification, and publishes it as an asset-only package with a content-identical release archive.

Stable responsibility:

- public structure and field semantics of the TIDAS specification, published as schema assets;
- independent language variants of those assets, kept equivalent in constraint meaning;
- shared methodology content for the public entities the specification covers;
- controlled public vocabularies and taxonomies, once a reviewed disposition moves them here;
- examples, conformance material, and specification documentation that ship with the assets;
- the deterministic asset build: file-set, lock, manifest, and archive integrity verification;
- the versioned publication artifacts and their publication record.

The specification package has no runtime dependency, no install script, and no executable behavior. Consumers read its assets; they do not execute it.

## Non-goals

The following are outside this repository. Route them to their owner instead of adding an approximation here:

- **Product profiles and gate behavior.** Whether a rule blocks, warns, or is informational; task-level applicability; and product-specific required-field or UI behavior belong to the consuming product repository. Only the public definition belongs here.
- **SDK runtime and generated surfaces.** Generated types, validators, factories, error codes, contract APIs, and packaged runtime assets belong to `tidas-sdks`.
- **Tooling and conversion behavior.** Validation, conversion, import, export, reporting, and the tool-side runtime ruleset belong to `tidas-toolkit`.
- **Database and service schemas.** Database structures, migrations, RPC and RLS definitions, Worker request schemas, Edge request schemas, and Foundry task schemas are owned by their own repositories.
- **The documentation site.** Public site runtime, navigation, localization rendering, search, and deployment belong to `tidas`.
- **Workspace integration.** Submodule pointers, cross-repository coordination, integration branches, and the workspace delivery lifecycle belong to `lca-workspace`.

A rules- or schema-shaped file in another repository is a candidate for an ownership analysis, not proof of duplication. Public definitions move into `tidas-spec` only through an explicit, reviewed disposition that names the owner, the semantic decision, and the positive and negative cases. Until that disposition exists, the current owner keeps the definition.

`tidas` continues to own the public specification content and its existing schema surface until a reviewed change transfers that ownership. This contract does not transfer content, and no consumer may treat it as a transfer.

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

**Publication**

- Publication is a distinct, reviewed version-preparation step. An ordinary `main` commit never publishes automatically.
- This repository holds no runtime dependency and no install script. Adding one requires an explicit reviewed contract change, not an implementation convenience.

**Licensing**

- `LICENSE` reproduces the MIT notice of the tools source that supplies the first extracted assets.
- That notice does not establish the license of every future imported artifact. Each imported artifact needs its own verified source and license record before publication. Never describe the whole package as MIT-licensed on the strength of the source notice alone.

**Governance self-consistency**

- Update `.docpact/config.yaml` when machine-readable paths, ownership, coverage, routing, rules, or the document inventory change; update this file when the stable responsibility, non-goals, or invariants change; update `README.md` when the current state, contributor entry, or validation guide changes.
- Do not copy the same detailed procedure into several documents.
- This repository has no local Docpact wrapper or git hook. Resolve the workspace wrapper and pass this repository as explicit `--root`; do not assume bare `docpact` is installed or that `--root .` means the workspace root.

## Escalation

Stop before mutation when the owning repository for a definition cannot be established from current contracts, when a source artifact's provenance or license is unverified, when a proposed asset move would change specification semantics, or when a publication would create or overwrite a version whose content cannot be verified against the reviewed candidate. Record the blocker in the tracked record with the evidence and the exact decision needed.
