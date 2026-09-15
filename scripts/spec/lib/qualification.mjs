// Draft vs qualified candidate boundary.
//
// The problem this solves: the reviewed source revision is the commit of this
// repository a candidate was built from, and a verifier cannot derive that value
// from the content — the same bytes can be committed under many commits.
// Accepting whatever string a caller supplies would turn an arbitrary SHA into a
// "reviewed source".
//
// The revision is therefore carried by the candidate receipt, which lives outside
// every artifact it describes. The *manifest* is a pure function of the shipped
// content and carries no revision at all: a manifest naming the commit that
// contains it is a fixed point no commit can satisfy, so keeping it content-only
// is what lets a qualified build reproduce the committed artifacts and leave the
// tree clean.
//
// The two states are explicit:
//
//   draft      no source revision is claimed. Buildable, testable, reviewable.
//              Not eligible for downstream W2-W4 consumption, because nothing
//              binds the bytes to a reviewed commit.
//   qualified  a source revision is claimed, and it was validated at build time
//              against the actual Git repository the build ran from: the commit
//              exists there, that commit is `HEAD`, the working tree was clean,
//              and the packaged bytes match the blobs at it.
//
// The residual trust is stated rather than hidden: a verifier can prove the
// receipt agrees with the repository and with the artifacts, but it cannot prove
// the reviewer actually reviewed that commit. That is what the review itself is
// for, and it is why the receipt is the artifact a supervisor signs off on.
//
// The chain runs one way only — commit -> manifest bytes -> archive bytes ->
// receipt — and no step hashes its own container.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fail } from './core.mjs';

export const QUALIFICATION_DRAFT = 'draft';
export const QUALIFICATION_QUALIFIED = 'qualified';
export const TREE_STATE_CLEAN = 'clean';

function git(repoRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined) {
    if (allowFailure) return null;
    fail('SOURCE_GIT', `git ${args.join(' ')} could not run in ${repoRoot}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (allowFailure) return null;
    fail('SOURCE_GIT', `git ${args.join(' ')} failed in ${repoRoot}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/**
 * Inspect the Git state of the repository a qualified build would bind to.
 *
 * Returns the commit, the tree state, and the repository's own name. Raises when
 * the tree is not clean or `HEAD` cannot be resolved, because a qualified
 * candidate must be built from a committed, reviewable revision — that is the
 * whole difference between the two states.
 */
export function inspectSourceRevision(repoRoot) {
  const inside = git(repoRoot, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (inside === null || inside.trim() !== 'true') {
    fail('SOURCE_NOT_GIT', `${repoRoot}: a qualified candidate must be built inside a Git working tree so its source revision can be validated`);
  }
  const commit = git(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    fail('SOURCE_COMMIT', `${repoRoot}: HEAD resolved to ${JSON.stringify(commit)}, which is not a full commit SHA`);
  }

  // `--untracked-files=no` would hide the very thing that makes a build
  // unreproducible from the commit: content that is present but not committed.
  const status = git(repoRoot, ['status', '--porcelain', '--untracked-files=all']);
  const dirty = status.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  if (dirty.length > 0) {
    fail(
      'SOURCE_DIRTY',
      `${repoRoot}: the working tree is not clean relative to ${commit} (${dirty.length} path(s), e.g. ${dirty.slice(0, 5).join(', ')}); a qualified candidate must be built from a committed revision, so this candidate can only be a draft`,
      { commit, dirty: dirty.slice(0, 50) },
    );
  }

  const repository = git(repoRoot, ['config', '--get', 'remote.origin.url'], { allowFailure: true });
  return {
    commit,
    treeState: TREE_STATE_CLEAN,
    repository: repository === null ? null : repository.trim(),
  };
}

/**
 * Confirm that the bytes being packaged are the bytes at `commit`.
 *
 * A clean tree already implies this for tracked files, but "clean" is about what
 * Git sees; this checks the content the build actually read, so a filter,
 * a `.gitattributes` transformation, or a stale index cannot slip a difference
 * through.
 */
export function verifyContentMatchesCommit(repoRoot, commit, files) {
  const mismatches = [];
  for (const file of files) {
    const blob = spawnSync('git', ['-C', repoRoot, 'cat-file', 'blob', `${commit}:${file.path}`], {
      encoding: 'buffer',
      maxBuffer: 256 * 1024 * 1024,
    });
    if (blob.status !== 0) {
      mismatches.push({ path: file.path, reason: 'not present at the qualified commit' });
      continue;
    }
    const digest = createHash('sha256').update(blob.stdout).digest('hex');
    if (digest !== file.sha256) {
      mismatches.push({ path: file.path, reason: `content at ${commit} is ${digest}, packaged bytes are ${file.sha256}` });
    }
  }
  if (mismatches.length > 0) {
    fail(
      'SOURCE_CONTENT_MISMATCH',
      `the packaged content is not the content at ${commit}: ${mismatches.slice(0, 20).map((item) => `${item.path} (${item.reason})`).join('; ')}`,
      { commit, mismatches },
    );
  }
  return { verified: files.length, commit };
}

/**
 * The source-revision block for a draft candidate, in the form the build passes
 * around. `bindingSourceRevision` converts it to the shape the receipt records.
 */
export function draftSourceRevision() {
  return {
    commit: null,
    treeState: null,
    qualification: QUALIFICATION_DRAFT,
    note: 'Draft candidate: no package source revision is claimed, so the packaged bytes are not bound to a reviewed commit. Usable for validation; not eligible for downstream consumption until qualification. See docs/qualification.md.',
  };
}

/** The source-revision block for a qualified candidate; see above. */
export function qualifiedSourceRevision(revision) {
  return {
    commit: revision.commit,
    treeState: revision.treeState,
    qualification: QUALIFICATION_QUALIFIED,
    repository: revision.repository,
    note: 'Qualified candidate: the source revision was validated against the Git repository at build time and is recorded in the candidate receipt, outside every artifact it describes. See docs/qualification.md.',
  };
}

/** The binding-record block that restates the source revision outside the archive. */
export function bindingSourceRevision(sourceRevision) {
  if (sourceRevision.qualification !== QUALIFICATION_QUALIFIED) return null;
  return {
    commit: sourceRevision.commit,
    treeState: sourceRevision.treeState,
    repository: sourceRevision.repository ?? null,
    validatedAgainst: 'git-repository-at-build-time',
  };
}
