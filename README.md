---
title: TIDAS Specification Repository README
docType: guide
scope: repo
status: active
authoritative: false
owner: tidas-spec
language: en
whenToUse:
  - when onboarding to the public TIDAS specification repository
  - when checking what this repository currently contains and publishes
  - when running or reviewing the governance validation for this repository
whenToUpdate:
  - when migrated specification content, the package, or the release path changes
  - when the contributor entrypoint or validation guide changes
checkPaths:
  - README.md
  - AGENTS.md
  - LICENSE
  - .gitignore
  - .docpact/config.yaml
lastReviewedAt: 2026-09-15
lastReviewedCommit: 1f0e30a65cb6040df8b5c072059a179ece7f577d
lastReviewedNote: "Bootstrap governance review baseline. Contributor entrypoint, source-baseline provenance, wrapper resolution, and validation guide only; no specification asset, package, or release workflow exists."
related:
  - AGENTS.md
  - .docpact/config.yaml
  - LICENSE
---

# TIDAS Specification Repository

`tiangong-lca/tidas-spec` (remote `https://github.com/tiangong-lca/tidas-spec.git`) owns the human-maintained public TIDAS specification: public structure and field semantics, shared public methodology content, and controlled vocabularies. It publishes that content as an asset-only package `@tiangong-lca/tidas-spec` together with a release archive carrying the identical reviewed files.

The stable repository responsibility, non-goals, and invariants are in [`AGENTS.md`](AGENTS.md). This file is the contributor entrypoint: what the repository contains today, where its source baseline comes from, and how its current content is validated.

## Current state

The repository contains repository governance only: `README.md`, `AGENTS.md`, `LICENSE`, `.gitignore`, and `.docpact/config.yaml`. Nothing in it is an approved specification baseline, and no specification asset — schema, language variant, methodology, vocabulary, example, or conformance file — has been migrated.

The root workspace does not yet list this repository in `.gitmodules`, `.workspace-delivery/workspace.toml`, or its Docpact catalog, so tracked delivery here is unsupported until the root registers it. Work chronology, remaining scope, and acceptance state live in the tracked Issue and plan linked under [References](#references), not in this file.

## Intended content and publication

Once the extraction lands, this repository is the single human-maintained source for the migrated specification assets, their language variants, shared methodology content, published examples and conformance material, specification documentation, and the deterministic asset build.

| Path | Content |
| --- | --- |
| `assets/` | Migrated schemas, language variants, shared methodology content, schema lock. |
| `examples/`, `conformance/` | Published examples and conformance material. |
| `docs/` | Specification documentation shipped with the assets. |
| `scripts/` | Asset build, lock, manifest, and integrity verification. |
| `spec-manifest.json` | Generated release manifest binding a version to its exact source commit, file list, and hashes. |

The first package version is planned as `0.1.0`. The package carries no runtime dependency and no install script, and is readable without a Node runtime. Immutability, channel parity, and reference closure are invariants owned by [`AGENTS.md`](AGENTS.md).

## Source baseline and provenance

The W0 source audit selected the extraction baseline and computed a per-file SHA256 inventory. The durable record is the evidence comment on [workspace #1243](https://github.com/tiangong-lca/workspace/issues/1243#issuecomment-5681963488); do not restate the file list here.

- Extraction baseline: `tidas-toolkit` at `9c0d8b1c8ceb1841074f5bc6de5fbb7fcc9318f5` (`main`), which supplies the 18 English schemas, the 18 Chinese schemas, and the `tidas_flows` / `tidas_processes` methodology YAML.
- Consumer comparison baselines are recorded in the same comment. `tidas-sdks` is byte-identical on all 18 schemas; `cli` and `tidas` differ on named files. Those are file-level facts, not semantic dispositions — each actual semantic difference is adjudicated with positive and negative cases before either consumer switches, and this repository does not inherit either variant by default.
- Retained tools inputs — `runtime_rulesets.json`, `runtime_rulesets.schema.json`, and `elementary_flow_taxonomy_extension.v1.json` — stay in `tidas-toolkit` and are explicitly outside the first migration.
- Tools `LICENSE` at the pinned commit has SHA256 `557e792f4b9868b7f25f60fca4e47e8857bbf2b88d0c8f733c2ce3fd0cbcc484` (MIT, TianGong LCA).

Provenance is **not** fully resolved. Third-party classification and vocabulary assets still need per-source confirmation before publication, and each imported artifact needs its own license determination recorded in the release manifest. See [License](#license).

## Repository boundaries

This repository owns the public specification content and its publication artifacts. It does not own product profiles or gate behavior, SDK runtime or generated surfaces, conversion or validation tooling, the documentation site, database or Worker schemas, or workspace integration. [`AGENTS.md`](AGENTS.md) holds the authoritative non-goal list and the routing for each.

A rules- or schema-shaped file in another repository is a candidate for an ownership analysis, not proof of duplication and not a migration decision. A public definition moves here only through an explicit, reviewed disposition that names the owner, the semantic decision, and the supporting positive and negative cases. Until then, its current owner keeps it.

## Validation guide

This section is the repository's validation guide. It covers the commands that exist today.

### Docpact wrapper resolution

This repository has no `scripts/docpact` wrapper and no local git hook. Always run the workspace wrapper, always pass this repository as an explicit absolute `--root`, and run from the repository root so repository-relative inputs and outputs resolve predictably:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

# Registered workspace child: the superproject is discoverable.
workspace_root="$(git rev-parse --show-superproject-working-tree 2>/dev/null || true)"

# Not-yet-registered child or standalone clone: the caller supplies the existing
# workspace checkout, for example export WORKSPACE_ROOT=/absolute/path/to/lca-workspace.
workspace_root="${workspace_root:-${WORKSPACE_ROOT:-}}"

if [ ! -x "$workspace_root/scripts/docpact" ]; then
  echo "No docpact wrapper at \$workspace_root/scripts/docpact. Set WORKSPACE_ROOT to an existing lca-workspace checkout." >&2
  exit 2
fi

"$workspace_root/scripts/docpact" validate-config --root "$repo_root" --strict
```

Do not assume bare `docpact` is installed, do not assume `--root .` means the workspace root, and do not guess a workspace path when neither the superproject nor `WORKSPACE_ROOT` provides one — fail with the message above instead.

### Governance checks

```bash
"$workspace_root/scripts/docpact" validate-config --root "$repo_root" --strict
"$workspace_root/scripts/docpact" list-rules --root "$repo_root" --format json
"$workspace_root/scripts/docpact" coverage --root "$repo_root" --format json
"$workspace_root/scripts/docpact" route --root "$repo_root" --paths AGENTS.md,README.md,.docpact/config.yaml --format json
```

Governed diff lint needs one explicit diff source. Name the files directly while they are untracked, because no diff source sees them yet:

```bash
"$workspace_root/scripts/docpact" lint --root "$repo_root" \
  --files AGENTS.md,README.md,LICENSE,.gitignore,.docpact/config.yaml \
  --format json --output .docpact/runs/lint.json
```

Once the files are committed, `--worktree`, `--staged`, or `--base <sha> --head <sha>` replace `--files`. Stdout is a paged `docpact.lint-report.v1` report; the saved report holds the full diagnostics:

```bash
"$workspace_root/scripts/docpact" diagnostics show \
  --report .docpact/runs/lint.json --id <diagnostic_id> --format json
```

`.docpact/runs/` holds disposable reports and is ignored by Git; it is not governed source.

### Git inspection and diff

`git diff` never reports untracked files. Inspect local state first, so untracked additions are visible instead of silently absent from a diff:

```bash
repo_root="$(git rev-parse --show-toplevel)"

git -C "$repo_root" status --short --untracked-files=all
git -C "$repo_root" ls-files --others --exclude-standard
```

Whitespace and conflict-marker check over tracked content:

```bash
git -C "$repo_root" diff --check
```

`git diff --check` also skips untracked files, so a clean result proves nothing about them. A staged or committed range is reviewable only after staging or committing, neither of which this repository's bootstrap package performs:

```bash
git -C "$repo_root" diff --cached --stat
git -C "$repo_root" diff --stat <base-sha>..HEAD
git -C "$repo_root" diff --check <base-sha>..HEAD
```

The reviewed baseline for the current candidate is the `lastReviewedCommit` in this file's frontmatter. Until the bootstrap files are staged, review means reading the untracked files at their exact paths, and the `git diff` forms above are empty rather than showing those files as added.

Specification package checks — file-set and lock verification, JSON/YAML parsing, relative-reference closure, manifest and archive integrity, offline read without the source repositories, and dual-language constraint comparison — are added here with the build that implements them. Until then they do not exist, and no release claim may cite them.

## Governance

- `AGENTS.md` is the repository contract: stable responsibility, non-goals, execution facts, delivery rules, and invariants.
- `.docpact/config.yaml` is the machine-readable catalog, ownership, coverage, routing, rule, and document-inventory source. Its catalog identity is `tidas-spec` and must match the identity the root uses when it registers this repository.
- Freshness thresholds are not configured. They are added together with the specification documents and their review evidence.

## License

`LICENSE` reproduces, unchanged, the MIT notice from the TIDAS tools source file `tidas-toolkit/LICENSE`, read at the pinned extraction commit `9c0d8b1c8ceb1841074f5bc6de5fbb7fcc9318f5` and confirmed identical to the notice in the local checkout.

The notice covers this repository's current bootstrap content. It does **not** assert that every future imported artifact — schema, methodology, vocabulary, taxonomy extension, or third-party material — automatically carries the same license. Each imported artifact needs its own verified source and license recorded in the release manifest before publication, and a file's presence in the tools repository is not by itself a license determination.

## References

- W0 bootstrap and repository onboarding: [workspace #1243](https://github.com/tiangong-lca/workspace/issues/1243), including the [selected baselines and SHA256 source inventory](https://github.com/tiangong-lca/workspace/issues/1243#issuecomment-5681963488).
- Split-refactor execution plan, work packages, and acceptance IDs: `_docs/plans/2026-09-15-tidas-spec-split-refactor-plan.md` in the workspace root.
