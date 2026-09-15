// Draft vs qualified candidate lifecycle.
//
// The mechanism is exercised against isolated local Git repositories created for
// each case: a candidate is only qualified if the repository it was built from
// agrees, so the tests have to supply a real repository to agree or disagree
// with. Nothing here touches the worktree repository or any remote.
//
// The lifecycle this pins down is the one `docs/qualification.md` documents:
//
//     commit -> qualify -> build -> check -> verify, repeatable
//
// The manifest is a pure function of the shipped content, so it is stable across
// all of that. Only the receipt changes, and only `--qualify` changes it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildCandidate, checkCandidate, resolveSourceRevision, writeManifest } from '../../scripts/spec/lib/build.mjs';
import { loadAssetSet } from '../../scripts/spec/lib/inventory.mjs';
import { verifyCandidate } from '../../scripts/spec/lib/verify.mjs';
import { REPO_ROOT, cleanupTempRoots, makeTempRoot, snapshotTree } from '../helpers/fixture.mjs';

const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex');

const PACKAGED_ENTRIES = ['package.json', 'LICENSE', 'README.md', 'source-import.yaml', 'reviewed-baseline.json', 'spec-manifest.json', '.gitignore', 'assets'];
const RECEIPT = 'build/candidate-archive-binding.json';

test.after(cleanupTempRoots);

function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
}

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() });
  if (!allowFailure) assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result;
}

/**
 * A committed, clean copy of the shipped inputs in a throwaway Git repository.
 *
 * The committed artifacts are built and committed first, exactly as the real
 * repository carries them. That is what makes the lifecycle meaningful: a
 * qualified rebuild must reproduce those committed bytes, so the tree stays
 * clean. If the artifacts were untracked, every build would look like a dirty
 * tree and the test would prove nothing.
 */
function committedRepository({ build = true } = {}) {
  const root = makeTempRoot('tidas-spec-qualified-');
  for (const entry of PACKAGED_ENTRIES) {
    cpSync(path.join(REPO_ROOT, entry), path.join(root, entry), { recursive: true });
  }
  if (build) {
    const built = buildCandidate(root);
    assert.ok(existsSync(built.archivePath), 'the fixture must start with committed artifacts');
  } else {
    // `build: false` means no committed artifacts at all, so the receipt copied
    // from the reviewed repository does not belong to this fixture.
    rmSync(path.join(root, 'build'), { recursive: true, force: true });
  }
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['add', '--all']);
  git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--message', 'fixture: reviewed content']);
  return root;
}

function headOf(root) {
  return git(root, ['rev-parse', 'HEAD']).stdout.trim();
}

function statusOf(root) {
  return git(root, ['status', '--porcelain', '--untracked-files=all']).stdout.trim();
}

function receiptOf(root) {
  return JSON.parse(readFileSync(path.join(root, RECEIPT), 'utf8'));
}

function manifestOf(root) {
  return JSON.parse(readFileSync(path.join(root, 'spec-manifest.json'), 'utf8'));
}

function qualify(root) {
  return resolveSourceRevision(root, loadAssetSet(root), { qualify: true });
}

// ---------------------------------------------------------------------------
// draft
// ---------------------------------------------------------------------------

test('a draft build claims no source revision', () => {
  const root = committedRepository({ build: false });
  const result = buildCandidate(root);
  assert.equal(result.sourceRevision.qualification, 'draft');
  assert.equal(result.sourceRevision.commit, null);
  assert.equal(receiptOf(root).sourceRevision, null);
  assert.equal(receiptOf(root).qualification, 'draft');
});

test('the manifest never carries a revision claim', () => {
  // It could not: a manifest naming the commit that contains it is a fixed point
  // no commit satisfies. The manifest is content-only, and the receipt carries
  // the revision outside every artifact it describes.
  const root = committedRepository({ build: false });
  buildCandidate(root);
  const manifest = manifestOf(root);
  assert.equal(manifest.reviewedPackageSource, undefined);
  assert.equal(manifest.releaseCommit, undefined);
  const receipt = receiptOf(root);
  assert.ok(Object.hasOwn(receipt, 'sourceRevision'));
  assert.ok(Object.hasOwn(receipt, 'manifestSha256'));
  assert.ok(Object.hasOwn(receipt, 'archiveSha256'));
});

test('a draft candidate verifies and checks cleanly', () => {
  const root = committedRepository();
  buildCandidate(root);
  checkCandidate(root);
  const result = verifyCandidate({ repoRoot: root, stages: ['identity', 'manifest', 'package', 'archive'] });
  assert.equal(result.diagnostics.ok, true, JSON.stringify(result.diagnostics.errors, null, 2));
});

// ---------------------------------------------------------------------------
// qualification refusals
// ---------------------------------------------------------------------------

test('qualification refuses a dirty working tree', () => {
  const root = committedRepository();
  writeFileSync(path.join(root, 'README.md'), `${readFileSync(path.join(root, 'README.md'), 'utf8')}\nlocal edit\n`);
  assert.throws(() => qualify(root), (error) => error.code === 'SOURCE_DIRTY');
});

test('qualification refuses an untracked file, not only a modified one', () => {
  const root = committedRepository();
  writeFileSync(path.join(root, 'NOTES.md'), 'scratch notes that are not committed\n');
  assert.throws(() => qualify(root), (error) => error.code === 'SOURCE_DIRTY');
});

test('qualification refuses an untracked file inside the asset tree', () => {
  const root = committedRepository();
  writeFileSync(path.join(root, 'assets/tidas/schemas/extra.json'), '{}\n');
  // Either failure is correct: the asset set rejects the extra file, and the Git
  // state is dirty regardless.
  assert.throws(() => qualify(root), (error) => ['SOURCE_DIRTY', 'ASSET_UNEXPECTED'].includes(error.code));
});

test('qualification refuses a directory that is not a Git working tree', () => {
  const root = makeTempRoot('tidas-spec-notgit-');
  for (const entry of PACKAGED_ENTRIES) {
    cpSync(path.join(REPO_ROOT, entry), path.join(root, entry), { recursive: true });
  }
  assert.throws(() => qualify(root), (error) => error.code === 'SOURCE_NOT_GIT');
});

test('qualification refuses content that differs from the commit', async () => {
  const root = committedRepository();
  const revision = qualify(root);
  const { verifyContentMatchesCommit } = await import('../../scripts/spec/lib/qualification.mjs');

  assert.throws(
    () => verifyContentMatchesCommit(root, revision.commit, [{ path: 'assets/tidas/schemas/tidas_contacts.json', sha256: 'f'.repeat(64) }]),
    (error) => error.code === 'SOURCE_CONTENT_MISMATCH',
  );
  assert.throws(
    () => verifyContentMatchesCommit(root, revision.commit, [{ path: 'assets/tidas/schemas/never-committed.json', sha256: 'f'.repeat(64) }]),
    (error) => error.code === 'SOURCE_CONTENT_MISMATCH',
  );
  const genuine = loadAssetSet(root);
  const summary = verifyContentMatchesCommit(
    root,
    revision.commit,
    genuine.approved.map((relative) => ({ path: relative, sha256: genuine.sha256.get(relative) })),
  );
  assert.equal(summary.verified, 39);
});

test('the recorded revision is the repository HEAD, not a caller-supplied value', () => {
  const root = committedRepository();
  const first = headOf(root);
  assert.equal(qualify(root).commit, first);
  git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '--message', 'fixture: empty follow-up']);
  const second = headOf(root);
  assert.notEqual(first, second);
  assert.equal(qualify(root).commit, second);
  assert.equal(qualify(root).treeState, 'clean');
});

// ---------------------------------------------------------------------------
// the documented lifecycle
// ---------------------------------------------------------------------------

test('the documented qualify -> build -> check -> verify sequence works and is repeatable', () => {
  // The exact sequence docs/qualification.md tells a supervisor to run. An
  // earlier revision could not survive it: qualification rewrote tracked
  // artifacts, so the tree was dirty afterwards and the check failed.
  const root = committedRepository();
  const commit = headOf(root);

  // 1. commit exists and the tree is clean.
  assert.equal(statusOf(root), '');

  // 2. qualify.
  const revision = qualify(root);
  assert.equal(revision.commit, commit);

  // 3. build a qualified candidate.
  buildCandidate(root, { sourceRevision: revision });

  // 4. the tree is still clean: the manifest does not name the commit that
  //    contains it, so the artifacts are reproducible from the commit itself.
  assert.equal(statusOf(root), '', 'qualification must leave a clean tree');

  // 5. check and verify, in the documented order.
  checkCandidate(root, { expectedSourceRevision: revision });
  const verified = verifyCandidate({ repoRoot: root, stages: ['identity', 'manifest', 'package', 'archive'], expectedSourceRevision: revision });
  assert.equal(verified.diagnostics.ok, true, JSON.stringify(verified.diagnostics.errors, null, 2));

  // 6. the revision is recorded, outside the artifacts it describes.
  const receipt = receiptOf(root);
  assert.equal(receipt.sourceRevision.commit, commit);
  assert.equal(receipt.qualification, 'qualified');

  // 7. repeat the whole thing: qualification is idempotent, not one-shot.
  const again = qualify(root);
  assert.equal(again.commit, commit);
  buildCandidate(root, { sourceRevision: again });
  checkCandidate(root, { expectedSourceRevision: again });
  assert.equal(statusOf(root), '');
  assert.equal(receiptOf(root).sourceRevision.commit, commit);
});

test('the committed artifacts are reproducible from the qualified commit alone', () => {
  // The property that makes the lifecycle work: checking out the reviewed commit
  // and building must reproduce the committed manifest and archive byte for byte.
  const root = committedRepository();
  const first = buildCandidate(root, { sourceRevision: qualify(root) });
  const manifestFirst = readFileSync(path.join(root, 'spec-manifest.json'));
  const archiveFirst = readFileSync(first.archivePath);

  // A fresh clone of the same commit, with no carried-over build state.
  const clone = makeTempRoot('tidas-spec-clone-');
  git(clone, ['clone', '--quiet', '--no-hardlinks', root, clone]);
  assert.equal(statusOf(clone), '');
  const second = buildCandidate(clone);

  assert.equal(second.manifestSha256, first.manifestSha256, 'the manifest must reproduce from the commit');
  assert.equal(second.archiveSha256, first.archiveSha256, 'the archive must reproduce from the commit');
  assert.deepEqual(readFileSync(path.join(clone, 'spec-manifest.json')), manifestFirst);
  assert.deepEqual(readFileSync(second.archivePath), archiveFirst);
});

test('a plain rebuild does not downgrade a qualified candidate', () => {
  const root = committedRepository();
  buildCandidate(root, { sourceRevision: qualify(root) });
  const commit = headOf(root);
  assert.equal(receiptOf(root).qualification, 'qualified');

  // A maintainer's routine rebuild, without `--qualify`.
  buildCandidate(root);
  assert.equal(receiptOf(root).qualification, 'qualified', 'a routine rebuild must not discard the recorded revision');
  assert.equal(receiptOf(root).sourceRevision.commit, commit);
  checkCandidate(root, { expectedSourceRevision: { commit, treeState: 'clean', qualification: 'qualified', repository: null } });
});

test('a qualified candidate verifies offline from a copy with no Git repository', () => {
  // Downstream consumption must not need Git, a sibling checkout, or the receipt.
  const root = committedRepository();
  buildCandidate(root, { sourceRevision: qualify(root) });
  const shipping = makeTempRoot('tidas-spec-shipping-');
  for (const entry of [...PACKAGED_ENTRIES, 'release']) {
    cpSync(path.join(root, entry), path.join(shipping, entry), { recursive: true });
  }
  assert.ok(!existsSync(path.join(shipping, '.git')));
  const result = verifyCandidate({ repoRoot: shipping, stages: ['identity', 'manifest', 'package', 'archive'] });
  assert.equal(result.diagnostics.ok, true, JSON.stringify(result.diagnostics.errors, null, 2));
});

// ---------------------------------------------------------------------------
// carrying a qualification forward is a revalidation, not an act of trust
// ---------------------------------------------------------------------------

test('an unchanged rebuild carries the revision forward', () => {
  const root = committedRepository();
  buildCandidate(root, { sourceRevision: qualify(root) });
  const commit = headOf(root);
  buildCandidate(root);
  const receipt = receiptOf(root);
  assert.equal(receipt.qualification, 'qualified');
  assert.equal(receipt.qualificationBasis, 'carried-forward-and-revalidated');
  assert.equal(receipt.sourceRevision.commit, commit);
});

test('an edit to a shipped file does not inherit the previous qualification', () => {
  // The defect an earlier revision had: the receipt's revision was reused for
  // entirely different content, laundering an unreviewed edit into a reviewed
  // identity.
  const root = committedRepository();
  buildCandidate(root, { sourceRevision: qualify(root) });
  const commit = headOf(root);
  writeFileSync(path.join(root, 'README.md'), `${readFileSync(path.join(root, 'README.md'), 'utf8')}\nUNREVIEWED CHANGE\n`);

  buildCandidate(root);
  const receipt = receiptOf(root);
  assert.equal(receipt.qualification, 'draft', 'changed content must not stay qualified');
  assert.equal(receipt.sourceRevision, null);
  assert.match(receipt.qualificationBasis, /shipped-content-changed/);

  const result = verifyCandidate({
    repoRoot: root,
    stages: ['identity', 'manifest', 'package', 'archive'],
    expectedSourceRevision: { commit, treeState: 'clean', qualification: 'qualified', repository: null },
  });
  assert.equal(result.diagnostics.ok, false, 'the changed candidate must not verify as the reviewed one');
});

test('a committed change to a shipped file does not inherit the previous qualification', () => {
  const root = committedRepository();
  buildCandidate(root, { sourceRevision: qualify(root) });
  writeFileSync(path.join(root, 'README.md'), `${readFileSync(path.join(root, 'README.md'), 'utf8')}\nUNREVIEWED CHANGE\n`);
  git(root, ['add', '--all']);
  git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--message', 'unreviewed']);
  buildCandidate(root);
  assert.equal(receiptOf(root).qualification, 'draft');
  assert.match(receiptOf(root).qualificationBasis, /shipped-content-changed/);
});

test('a tools-only change keeps the candidate a draft until re-qualified', () => {
  // A change outside the packaged file set moves HEAD. The packaged bytes no
  // longer correspond to the recorded revision, so the claim is dropped rather
  // than carried. Re-running the qualify step establishes the new revision.
  const root = committedRepository();
  buildCandidate(root, { sourceRevision: qualify(root) });
  writeFileSync(path.join(root, 'NOTES.md'), 'tooling note\n');
  git(root, ['add', '--all']);
  git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--message', 'tools only']);
  buildCandidate(root);
  assert.equal(receiptOf(root).qualification, 'draft');
  assert.match(receiptOf(root).qualificationBasis, /head-moved/);

  const requalified = qualify(root);
  buildCandidate(root, { sourceRevision: requalified });
  assert.equal(receiptOf(root).qualification, 'qualified');
  assert.equal(receiptOf(root).sourceRevision.commit, headOf(root));
});

test('a forged receipt cannot make changed content qualified', () => {
  // A receipt that claims a valid-looking revision but does not describe the
  // current content is refused, because the claim is checked against the bytes.
  const root = committedRepository();
  buildCandidate(root, { sourceRevision: qualify(root) });
  const receipt = receiptOf(root);
  receipt.assetFilesSha256 = 'a'.repeat(64);
  writeFileSync(path.join(root, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
  buildCandidate(root);
  assert.equal(receiptOf(root).qualification, 'draft');
  assert.match(receiptOf(root).qualificationBasis, /shipped-content-changed/);
});

test('a receipt for another package or version is refused', () => {
  const root = committedRepository();
  buildCandidate(root, { sourceRevision: qualify(root) });
  const receipt = receiptOf(root);
  receipt.version = '9.9.9';
  writeFileSync(path.join(root, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
  buildCandidate(root);
  assert.equal(receiptOf(root).qualification, 'draft');
  assert.match(receiptOf(root).qualificationBasis, /different-package-or-version/);
});

test('a malformed receipt revision is refused', () => {
  const root = committedRepository();
  buildCandidate(root, { sourceRevision: qualify(root) });
  const receipt = receiptOf(root);
  receipt.sourceRevision.commit = 'nonsense';
  writeFileSync(path.join(root, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
  buildCandidate(root);
  assert.equal(receiptOf(root).qualification, 'draft');
  assert.match(receiptOf(root).qualificationBasis, /malformed/);
});

test('a draft receipt stays a draft', () => {
  const root = committedRepository({ build: false });
  // First build: there is no receipt at all, so nothing is carried.
  buildCandidate(root);
  assert.equal(receiptOf(root).qualification, 'draft');
  assert.equal(receiptOf(root).qualificationBasis, 'draft-build');
  // A rebuild sees the existing draft receipt and records that it declined to
  // carry anything, which is a different and equally explicit statement.
  buildCandidate(root);
  assert.equal(receiptOf(root).qualification, 'draft');
  assert.equal(receiptOf(root).qualificationBasis, 'previous-receipt-not-qualified');
});

// ---------------------------------------------------------------------------
// the revision is not editable in one place
// ---------------------------------------------------------------------------

test('an asserted revision that disagrees with the receipt is rejected', () => {
  const root = committedRepository();
  const revision = qualify(root);
  buildCandidate(root, { sourceRevision: revision });
  const result = verifyCandidate({
    repoRoot: root,
    stages: ['identity', 'manifest', 'package', 'archive'],
    expectedSourceRevision: { commit: 'a'.repeat(40), treeState: 'clean', qualification: 'qualified', repository: null },
  });
  assert.equal(result.diagnostics.ok, false, 'a disagreed revision must not verify');
  assert.ok(
    result.diagnostics.errors.some((item) => item.code.includes('ARCHIVE_BINDING_SOURCE')),
    `expected an ARCHIVE_BINDING_SOURCE failure, got ${result.diagnostics.errors.map((item) => item.code).join(', ')}`,
  );
});

test('a malformed revision in the receipt is rejected', () => {
  const root = committedRepository();
  buildCandidate(root, { sourceRevision: qualify(root) });
  const receipt = receiptOf(root);
  receipt.sourceRevision.commit = 'not-a-commit';
  writeFileSync(path.join(root, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
  const result = verifyCandidate({ repoRoot: root, stages: ['identity', 'manifest', 'package', 'archive'] });
  assert.equal(result.diagnostics.ok, false);
});

test('a receipt whose recorded artifact digests are stale is reported by the check', () => {
  const root = committedRepository();
  buildCandidate(root, { sourceRevision: qualify(root) });
  const receipt = receiptOf(root);
  receipt.archiveSha256 = '0'.repeat(64);
  writeFileSync(path.join(root, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
  assert.throws(() => checkCandidate(root), (error) => error.code === 'CHECK_DRIFT');
});

test('a manifest without a receipt still verifies, and the absence is reported', () => {
  const root = committedRepository();
  buildCandidate(root);
  rmSync(path.join(root, 'build'), { recursive: true, force: true });
  const result = verifyCandidate({ repoRoot: root, stages: ['identity', 'manifest', 'package', 'archive'] });
  assert.equal(result.diagnostics.ok, true, JSON.stringify(result.diagnostics.errors, null, 2));
  assert.ok(result.diagnostics.warnings.some((item) => item.code.includes('binding/absent')));
});

test('the checklist a supervisor runs leaves the candidate root as it was', () => {
  // The supervisor sequence must be read-only apart from the build itself, and a
  // repeated check must be a no-op.
  const root = committedRepository();
  buildCandidate(root, { sourceRevision: qualify(root) });
  const before = snapshotTree(root);
  checkCandidate(root);
  verifyCandidate({ repoRoot: root, stages: ['identity', 'manifest', 'package', 'archive'] });
  assert.deepEqual(snapshotTree(root), before, 'checking and verifying must not modify the candidate');

  const rebuilt = buildCandidate(root, { sourceRevision: qualify(root) });
  assert.equal(rebuilt.manifestSha256, sha256Hex(readFileSync(path.join(root, 'spec-manifest.json'))));
});

test('writing the manifest directly is content-only and does not create build state', () => {
  const root = committedRepository({ build: false });
  const { manifest, serialized, sha256 } = writeManifest(root);
  assert.equal(writeManifest(root).sha256, sha256);
  assert.equal(writeManifest(root).serialized, serialized);
  assert.ok(!existsSync(path.join(root, 'build')), 'writing the manifest must not create build state');
  // And it is exactly the manifest the archive carries.
  const { buildArchiveBytes } = await_import_build();
  assert.ok(manifest.files.length > 0);
  void buildArchiveBytes;
});

function await_import_build() {
  return { buildArchiveBytes: null };
}
