# Candidate qualification

This document defines the two states a specification candidate can be in, how a
candidate moves between them, and what each state is allowed to be used for.

## The two states

| State | Where it is recorded | Source revision | Eligible for downstream W2-W4 consumption |
| --- | --- | --- | --- |
| Draft | receipt: `qualification: "draft"`, `sourceRevision: null` | not claimed | no |
| Qualified | receipt: `qualification: "qualified"` plus the revision | the commit of this repository the candidate was built from, `treeState: "clean"` | yes |

A draft is a complete, buildable, verifiable candidate. It is what every working
build produces, and it is what CI verifies. It claims nothing about which commit
its bytes came from, so nothing binds those bytes to a review.

A qualified candidate claims a source revision, validated against the actual Git
repository at build time. This is the property the W1 acceptance criteria call
for: downstream work packages consume bytes bound to a reviewed commit.

## Why the revision is not in the manifest

A manifest that carried the commit containing it would be a fixed point no commit
can satisfy: the commit depends on the manifest, and the manifest on the commit.
So the manifest is a **pure function of the shipped content** — file list, per-file
byte digests, aggregates, counts — and carries no revision at all. That is what
makes it reproducible from the commit, and therefore what keeps a qualified build
from dirtying the tree it was built from.

The revision lives in the **candidate receipt**,
`build/candidate-archive-binding.json`, which sits outside every artifact it
describes. The receipt carries the two facts content cannot produce:

- the reviewed source revision, validated against the repository;
- the digests of the manifest and archive that were produced, which depend on the
  build toolchain as well as on the content.

```
Git commit ──► repository bytes ──► manifest ──► archive
                                            └──► receipt (outside all three)
```

### Why the receipt is not committed

It is disposable output of the qualifying process. Anyone can regenerate it by
running the qualify step against the reviewed commit, and a checked-in copy would
be one more file whose own provenance needs explaining. A consumer that needs the
binding reads it beside the candidate; nothing about verifying the archive's
*content* requires it.

### Carrying a claim forward is a revalidation

A routine rebuild does not re-qualify, but it also does not simply trust the
receipt it finds. The previous revision is carried forward only when all of these
hold, each checked rather than assumed:

1. the receipt records a qualified revision in the expected shape;
2. the receipt is for this package and version;
3. the receipt's recorded content digest equals the freshly built manifest's, so
   the candidate is the same candidate;
4. the repository still resolves `HEAD` to that revision and the packaged bytes
   still match the blobs at it.

A change to shipped content fails (3); a moved `HEAD` fails (4). Either way the
result is an explicit **draft** with a `qualificationBasis` naming the reason —
`shipped-content-changed-since-qualification`, `head-moved-since-qualification`,
and so on. What must never happen is a stale claim being rebound to new content:
that would launder an unreviewed change into a reviewed identity.

Check (4) is the clean-tree contract, and it applies to the whole working tree,
not only to packaged files. An uncommitted edit — including one to tooling outside
the packaged set — and an untracked file both fail it, because neither is part of
the revision the claim names. Such a change yields a draft with
`repository-no-longer-supports-the-claim:SOURCE_DIRTY`; the claim is recovered by
committing the change and running the qualify step against the new revision.

The receipt records `qualificationBasis` for every build, so the state is always
explained rather than inferred: `draft-build`, `qualified-from-repository`,
`carried-forward-and-revalidated`, or one of the refusal reasons.

## Why the revision cannot be supplied by the caller

`--qualify` takes no revision argument. It reads the repository:

1. the working directory must be a Git working tree;
2. `HEAD` must resolve to a full commit SHA;
3. `git status --porcelain --untracked-files=all` must be empty — a modified
   tracked file *or* an untracked file fails, because either means the build did
   not come from the commit;
4. every packaged file's bytes must equal the blob at that commit — not implied by
   (3), because a clean index can still disagree with what the build read;
5. the specification assets are checked against the reviewed import as well.

A failure at any step produces no candidate. There is no "qualified but dirty"
state: nothing could bind such a candidate to a review.

## Reproducibility and its scope

The manifest is byte-reproducible across machines and runtimes. The archive is
not, unconditionally: its gzip framing comes from the platform zlib, and different
zlib builds produce different bytes for identical input. The **uncompressed tar
payload is identical everywhere** — only the compression differs.

So the claim is stated precisely rather than universally:

- **within one pinned toolchain** — `toolchain.json` names the exact node and
  pnpm, `scripts/ci/require-toolchain.mjs` enforces them, and CI provisions the
  same pnpm — the archive is byte-reproducible, and two clean builds are compared
  byte for byte;
- **across toolchains**, the archive is compared by contents: entry list and every
  entry's digest. That covers every shipped file's content, which is what drift
  means; it does not cover compression framing, which is not content.

The receipt records the producing toolchain (`buildRuntime`: node, zlib, platform,
arch), so the scope of the claim is checkable. Toolchain identity is judged on all
four fields rather than the Node version alone, because the observed variance came
from zlib. `build.mjs --check` asserts byte equality when they all match and
compares archive contents when they do not, reporting which mode it used in both
its text and JSON output. It always checks the recorded archive digest against the
bytes on disk, because hashing a file does not depend on the toolchain that
produced it.

## Producing a qualified candidate

```bash
git -C <repo> status --porcelain --untracked-files=all   # must be empty
node scripts/spec/build.mjs --qualify                    # validate HEAD, then build
node scripts/spec/build.mjs --check                      # committed output matches content
node scripts/spec/verify.mjs --expect-source-commit <sha> # artifacts + revision
pnpm run check                                           # build + verify + tests
```

The sequence is repeatable: qualification is idempotent, and a routine rebuild
without `--qualify` preserves the revision already recorded — but only after
revalidating it against the content and the repository, as described above. It
never preserves a claim the current content does not support.

`--expect-source-commit` is how a consumer or CI asserts *which* revision it
believes it has. Verification reads the receipt and fails on a mismatch; on an
unpacked package with no receipt it fails too, because an assertion with nothing
to check it against is not a check.

## What a verifier can and cannot prove

Verification proves:

- the archive is safe to read, and carries exactly the files the manifest binds
  (`archive/published-file-set`, `archive/asset-bytes`);
- the manifest inside the archive is byte-identical to the candidate's
  (`archive/manifest-identity`);
- the manifest inside the archive describes the archive's own contents,
  recomputed from the extracted bytes alone (`archive/manifest-self-consistency`);
- the unpacked package passes the identity, manifest, and package stages on its
  own (`archive/self-verification`);
- the receipt's recorded digests match the artifacts present, and its revision
  matches the asserted one (`archive/binding`).

It does **not** prove that a human reviewed that commit. A verifier can show that
records agree and that the artifact is internally consistent; it cannot show the
review happened. That is what the review step is for, and it is why the receipt —
not the manifest — is what a supervisor signs off on.

## Current state of this candidate

This worktree is a **draft**. Its changes are uncommitted, so no source revision
can be claimed, and `--qualify` correctly refuses. The supervisor records the
qualified revision after review, using the sequence above.
