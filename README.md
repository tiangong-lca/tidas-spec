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
  - when running, reviewing, or reproducing the specification build and verification
whenToUpdate:
  - when migrated specification content, the package, or the release path changes
  - when the contributor entrypoint, command set, or validation guide changes
checkPaths:
  - README.md
  - AGENTS.md
  - LICENSE
  - .gitignore
  - .docpact/config.yaml
  - package.json
  - source-import.yaml
  - reviewed-baseline.json
  - spec-manifest.json
  - scripts/**
  - .github/workflows/**
  - docs/qualification.md
lastReviewedAt: 2026-09-21
lastReviewedCommit: d4cb089c753ffd20b173db2e56fb553a364f48f4
lastReviewedNote: "Reviewed for tidas-spec #24: Process review now accepts one object or a non-empty array without weakening per-item constraints; published 0.2.1 stays immutable and the checkout prepares 0.2.2."
related:
  - AGENTS.md
  - .docpact/config.yaml
  - docs/specification.md
  - docs/qualification.md
  - docs/provenance.md
  - docs/public-rule-adjudication.md
---

# TIDAS Specification Repository

`tiangong-lca/tidas-spec` (remote `https://github.com/tiangong-lca/tidas-spec.git`) owns the human-maintained public TIDAS specification: public structure and field semantics, shared public methodology content, and controlled vocabularies. It publishes that content as an asset-only package `@tiangong-lca/tidas-spec` together with a release archive carrying the identical reviewed files.

The stable repository responsibility, non-goals, and invariants are in [`AGENTS.md`](AGENTS.md). This file is the contributor entrypoint: what the repository contains today, where its source baseline comes from, and how its content is built and verified.

## Current state

Version `0.2.1` is formally published on npm and GitHub Releases. The checkout now prepares an unpublished `0.2.2` candidate with Process multi-review compatibility; ordinary `main` changes do not publish it. Workspace consumers must pin an exact reviewed archive rather than infer publication from the repository version.

| Path | Content |
| --- | --- |
| `assets/tidas/schemas/`, `assets/tidas/schemas_zh/` | 18 reviewed JSON Schemas (Draft 7) in each language. |
| `assets/tidas/methodologies/` | `tidas_flows.yaml` and `tidas_processes.yaml`. |
| `assets/tidas/rules/` | Versioned public rule schema and index: nine reviewed definitions with source bindings, applicability, normative level, and positive/negative cases. |
| `assets/tidas/schema.lock.json` | The pinned source schema lock, imported byte-for-byte. |
| `source-import.yaml` | Reviewed import record: source repository, commit, per-file SHA256, exclusions. |
| `reviewed-baseline.json` | Independent review anchor for the source inventory and the shipped bytes. |
| `spec-manifest.json` | Generated release manifest binding every shipped file by exact byte digest, plus the derived source findings. A pure function of the shipped content. |
| `release/` | Generated canonical candidate archive. |
| `scripts/` | Import, build, and verification implementation. |
| `test/` | Unit, conformance, and integration suites. |
| `docs/` | Candidate structure, qualification, and provenance records. |
| `toolchain.json` | The exact node and pnpm versions a build and verification use. Not published; enforced by `scripts/ci/require-toolchain.mjs`. |

The root workspace registers this repository in `.gitmodules`, `.workspace-delivery/workspace.toml`, and its Docpact catalog. Tracked delivery runs through the workspace delivery controller; work chronology, remaining scope, and acceptance state live in the tracked Issue and plan linked under [References](#references), not in this file.

### Publication rights and compatibility caveat

The tools `LICENSE` notice (MIT, TianGong LCA) is verified and reproduced. The rights owner declared that each of the nine embedded classification vocabulary groups is TianGong-owned and may be publicly redistributed under MIT without third-party attribution or additional terms, and separately authorized public redistribution of the whole shipped package, including ILCD-derived structural conventions. The exact scope and limits of those declarations are in [`docs/provenance.md`](docs/provenance.md); they do not assert TianGong authorship of ILCD or independently prove a third-party license. `package.json` retains `SEE LICENSE IN LICENSE` rather than making a blanket MIT claim. Formal publication is still a separate guarded action, not something an ordinary `main` commit triggers.

The unchanged Draft 7 schemas contain 52 `$ref` objects with assertion-bearing siblings (`const` 48, `format` 2, `type` 2). Draft 7 ignores these sibling constraints; other validators may apply them, so results can differ across validators. Existing workflows have used these schemas, and the first release deliberately preserves their bytes rather than silently changing semantics. The manifest retains the derived finding; this package does not claim that all validators agree. See [`docs/specification.md`](docs/specification.md) for the technical record.

### Reviewed publication workflow

Formal publication is deliberately separate from ordinary `main` verification. The manually invoked `.github/workflows/publish-spec-release.yml` workflow defaults to `blocked`. The `preflight` choice verifies the exact candidate, GitHub OIDC availability, and SDK-dispatch credential without writing to npm, GitHub Releases, or SDK; only explicit `publish` approval can run those steps. The workflow checks out the exact qualified source commit and verifies the committed archive and manifest against the supplied SHA256 values before any publication write. Publication then publishes or verifies the exact archive in the public npm registry, creates or verifies the immutable `v<version>` GitHub Release with the same archive bytes, and only then notifies SDK. Re-running the same identity fills a missing channel or verifies both existing assets; a different archive digest for an existing npm version or GitHub Release fails closed.

The workflow uses npm Trusted Publishing through GitHub Actions OIDC, matching the CLI and TypeScript SDK release convention; it does not use `NPM_TOKEN`. It requires the dispatch ref's `GITHUB_SHA` to equal the qualified source commit so the npm provenance names the reviewed revision. On npm, configure the `@tiangong-lca/tidas-spec` package's Trusted Publisher for GitHub organization `tiangong-lca`, repository `tidas-spec`, workflow filename `publish-spec-release.yml`, no environment name, and direct `npm publish` permission. npm requires the package to exist before this connection can be configured, so the first package registration is a separate maintainer-controlled bootstrap; it is not performed by this workflow. The workflow still requires `TIDAS_SDK_AUTOMATION_TOKEN` with permission to dispatch events to `tiangong-lca/tidas-sdks`; the built-in GitHub Actions token writes this repository's Release. OIDC availability and the SDK credential are checked before any publication write. If a publication attempt stops after npm succeeds, rerun the same version/source/archive/manifest identity after resolving the failure; never overwrite or silently bump that version. npm registry metadata and tarball bytes are downloaded and checked against the reviewed archive SHA256 before GitHub Release or SDK dispatch.

Only after the release identity is present does the workflow dispatch `tidas_spec_released` to `tidas-sdks`. The payload carries the package, version, source commit, archive URL and filename, archive SHA256, manifest SHA256, and an `event_key` derived from the release identity. Selected package families and reviewed version bumps are grouped under `release_options` so the event stays within GitHub's ten-property `client_payload` limit. Consumers must reject stale or conflicting events rather than rewriting a published version.

## Source baseline

The original 39-file import was extracted from Git blobs at `tidas-toolkit` commit `9c0d8b1c8ceb1841074f5bc6de5fbb7fcc9318f5` (`main`). Candidate 0.2.2 retains 33 of those files byte-for-byte. The Process and LCIA Method schemas in both languages, together with their derived schema lock, supersede the imported copies after the reviewed optional-review-report decision in tidas-spec #7; tidas-spec #24 further corrects Process review cardinality so one object and a non-empty array share the same item constraints. The Process methodology's version wording is separately superseded by tidas-spec #22 to match the unchanged `Version` schema. These are identified as repository-authored assets rather than falsely attributed to the toolkit commit. The two public-rule assets are also authored and reviewed here. `source-import.yaml` records both the remaining import and superseded source paths, while `reviewed-baseline.json` anchors the remaining imported bytes.

Three files present at that commit are deliberately **not** imported: `runtime_rulesets.json`, `runtime_rulesets.schema.json`, and `elementary_flow_taxonomy_extension.v1.json`. They remain owned by `tidas-toolkit` and their exclusion is recorded and enforced.

W8 adjudicates the 14 rules in the excluded mixed runtime catalog without importing it wholesale. Nine source-supported definitions are represented in `assets/tidas/rules/public-rules.v1.json`; five rules over product workflow entities or insufficient source bindings remain explicitly product-local. Phase, severity, blocker defaults, profiles, and operation authorization remain outside this repository. See [`docs/public-rule-adjudication.md`](docs/public-rule-adjudication.md).

`tidas-sdks` is byte-identical on all 18 schemas. The `cli` and `tidas` repositories carry differing variants of named files. Those are file-level facts, not semantic dispositions: this repository inherits neither variant by default, and each actual semantic difference is adjudicated separately with positive and negative cases before either consumer switches.

## Build and verification

Requires Node 24 and pnpm 11.24.0 (matching the workspace SDK convention). The published package itself has no runtime dependency and no install script; the toolchain below is development-only.

```bash
pnpm install --frozen-lockfile     # development dependencies only
pnpm run check                     # build, verify, and run every test suite
```

`pnpm run check` is the whole gate: it builds the candidate, runs the four verification stages, then runs the unit, conformance, and integration suites. Individual steps:

```bash
node scripts/spec/build.mjs                        # draft candidate: manifest + archive + receipt
node scripts/spec/update-schema-lock.mjs           # after an approved schema constraint change
node scripts/spec/build.mjs --check                # committed output vs current content (writes nothing)
node scripts/spec/build.mjs --qualify              # qualified candidate: validate HEAD, then build
node scripts/spec/verify.mjs                       # all four stages
node scripts/spec/verify.mjs --stage identity      # file set, bytes, language, lock, references
node scripts/spec/verify.mjs --expect-source-commit <sha>   # also assert the reviewed revision
node scripts/spec/verify.mjs --json                # machine-readable report
node --test 'test/unit/**/*.test.mjs'
node --test 'test/conformance/**/*.test.mjs'
node --test 'test/integration/**/*.test.mjs'
```

A plain build is a **draft**: complete and verifiable, but claiming no source
revision, so it is not eligible for downstream consumption. `--qualify` produces
a **qualified** candidate by validating that `HEAD` is the source revision, that
the tree is clean, and that the packaged bytes match that commit. The two states
and the post-review sequence are defined in [`docs/qualification.md`](docs/qualification.md).

Re-importing from the pinned source commit — the only command that reads a source checkout, and never part of a normal build:

```bash
node scripts/import-tidas-spec-source.mjs --source-repo /path/to/tidas-toolkit --check
```

`docs/specification.md` describes every stage, what the manifest binds, how the
two language sets are treated, and why the manifest cannot hash itself.

Verifying an unpacked copy — the check a consumer can reproduce — uses the three stages that apply to a package directory:

```bash
tar -xzf release/tiangong-lca-tidas-spec-0.2.2.tgz -C /tmp/tidas-spec-check
node scripts/spec/verify.mjs --root /tmp/tidas-spec-check/package \
  --stage identity --stage manifest --stage package
```

### Reproducibility contract

Two clean builds under the pinned toolchain produce an identical manifest and a byte-identical archive. The archive is written by a ustar writer in this repository — not by host `tar`, whose flags and defaults differ between GNU tar and bsdtar — with fixed mode, ownership, sorted entry order, and a fixed timestamp.

The manifest is byte-reproducible across machines and runtimes. The archive's gzip framing comes from the platform zlib, so byte equality is guaranteed **within one pinned toolchain**; the uncompressed tar payload is identical everywhere. `--check` compares all four toolchain fields recorded in the receipt — node, zlib, platform, arch — and asserts byte equality when they match and full content equality when they do not, always reporting which mode ran and always checking the recorded archive digest against the bytes on disk.

The exact toolchain lives in `toolchain.json` — outside the package, so declaring versions cannot affect its bytes — and `pnpm run check` refuses to run under any other node or pnpm.

The npm package and the release archive are assembled from the same `files` whitelist and `package.json` is stored in the form the npm client produces, so the two channels are byte-identical file for file. The integration suite packs the package and compares every entry's digest to prove it.

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

Governed diff lint needs one explicit diff source:

```bash
"$workspace_root/scripts/docpact" lint --root "$repo_root" \
  --base <sha> --head <sha> --format json --output .docpact/runs/lint.json

"$workspace_root/scripts/docpact" diagnostics show \
  --report .docpact/runs/lint.json --id <diagnostic_id> --format json
```

`.docpact/runs/` holds disposable reports and is ignored by Git; it is not governed source.

### Specification checks

`pnpm run check` is the required entrypoint; the table names what each stage proves so a reviewer can check the claim rather than the command.

| Check | Proves |
| --- | --- |
| `node scripts/spec/verify.mjs --stage identity` | The shipped files are exactly the approved set; every file parses; the bytes match the reviewed import; the 18 language pairs are constraint-equivalent under the lock's allowance; the lock is exactly the one the bytes produce; every `$ref` resolves inside the package. |
| `node scripts/spec/verify.mjs --stage manifest` | `spec-manifest.json` is the manifest the current bytes produce, binds every shipped file by exact byte digest, is in the canonical serialization, and carries a validated source and license identity. |
| `node scripts/spec/verify.mjs --stage package` | The package declares the reviewed name and version, no dependency of any kind, no install or publish hook, a `files` whitelist that publishes every approved asset and nothing else, and `package.json` in the canonical serialization both channels ship. |
| `node scripts/spec/verify.mjs --stage archive` | The archive is safe to read, carries exactly the declared file set with no undeclared extra, contains a manifest byte-identical to the candidate's that also describes the archive's own contents, verifies as a package after unpacking with no sibling checkout, and is bound to the manifest and its source revision by an external record. Applies where the archive is present; an unpacked copy is checked with `--stage identity --stage manifest --stage package`, because an archive does not contain itself. |
| `node --test 'test/conformance/**/*.test.mjs'` | The verifier rejects each specific defect — extra or missing file, mutated bytes, stale or widened lock, malformed JSON/YAML, duplicate keys, invalid Draft 7 constraints, malformed pointer escapes, double-decoded fragments, escaping/network/broken references, unreachable versus reachable definitions, differing language constraints, an incomplete or corrupt manifest, an archive whose internal manifest was replaced with outer digests recomputed, and conflicting identity — and does not treat example data as schema. |
| `node --test 'test/integration/**/*.test.mjs'` | The packed npm package and the release archive carry identical content, the packed tarball installs into a fresh consumer with no runtime dependency and verifies in place, a Python reader with Node removed from `PATH` re-derives the declared set and every digest, the drift check fails on stale committed output, the qualification mechanism behaves on isolated local Git repositories, and the release notification identity is deterministic and conflict-safe. |

### Git inspection and diff

`git diff` never reports untracked files. Inspect local state first, so untracked additions are visible instead of silently absent from a diff:

```bash
repo_root="$(git rev-parse --show-toplevel)"

git -C "$repo_root" status --short --untracked-files=all
git -C "$repo_root" ls-files --others --exclude-standard
git -C "$repo_root" diff --check
git -C "$repo_root" diff --stat <base-sha>..HEAD
git -C "$repo_root" diff --check <base-sha>..HEAD
```

The reviewed baseline for the current candidate is the `lastReviewedCommit` in this file's frontmatter.

## Governance

- `AGENTS.md` is the repository contract: stable responsibility, non-goals, execution facts, delivery rules, and invariants.
- `.docpact/config.yaml` is the machine-readable catalog, ownership, coverage, routing, rule, and document-inventory source. Its catalog identity is `tidas-spec` and must match the identity the root uses when it registers this repository.
- `docs/specification.md` describes the candidate's structure and verification stages.
- `docs/provenance.md` records verified source facts and the unresolved licensing question.
- Freshness thresholds are not configured. They are added together with specification documents and their review evidence.

## License

`LICENSE` reproduces, unchanged, the MIT notice from `tidas-toolkit/LICENSE`, read at the pinned extraction commit `9c0d8b1c8ceb1841074f5bc6de5fbb7fcc9318f5` (SHA256 `557e792f4b9868b7f25f60fca4e47e8857bbf2b88d0c8f733c2ce3fd0cbcc484`).

That notice covers the tools source. It does **not** assert that every imported artifact — schema, methodology, vocabulary, or third-party classification — carries the same license, and a file's presence in the tools repository is not by itself a license determination. The current per-artifact status, including what remains unresolved and why it blocks publication, is in [`docs/provenance.md`](docs/provenance.md).

## References

- W0 bootstrap and repository onboarding: [workspace #1243](https://github.com/tiangong-lca/workspace/issues/1243), including the selected baselines and SHA256 source inventory.
- W1 candidate implementation: [tidas-spec #1](https://github.com/tiangong-lca/tidas-spec/issues/1).
- Split-refactor execution plan, work packages, and acceptance IDs: `_docs/plans/2026-09-15-tidas-spec-split-refactor-plan.md` in the workspace root.
