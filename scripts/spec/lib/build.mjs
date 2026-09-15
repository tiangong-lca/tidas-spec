// Candidate build: manifest, canonical archive, and the archive binding record.
//
// Determinism contract:
//   * `spec-manifest.json` is written in the canonical format, with files sorted
//     by path and no timestamps, host names, absolute paths, or run counters.
//   * The archive is assembled from an explicit file list with fixed mode bits,
//     fixed ownership, sorted entry order, and a fixed mtime, so two clean builds
//     produce byte-identical archives rather than merely equivalent ones.
//
// The manifest cannot contain its own hash. Its identity is the `files` block and
// its two aggregates; the archive binding record under `build/` binds those to
// one concrete archive digest. That record is disposable build output, not
// governed source, and is therefore not committed.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ARCHIVE_BINDING_PATH,
  BUILD_ROOT,
  IMPORT_MANIFEST_PATH,
  MANIFEST_PATH,
  PACKAGE_NAME,
  RELEASE_ROOT,
  SPEC_VERSION,
  archiveFileName,
  canonicalJson,
  fail,
  formatJson,
  sha256Hex,
} from './core.mjs';
import { gunzipSync } from 'node:zlib';
import { createDeterministicTarGz, readTarEntries } from './tar.mjs';
import { loadAssetSet } from './inventory.mjs';
import { readImportManifest, resolvePackagedFiles } from './package-content.mjs';
import { buildManifest } from './verify.mjs';
import {
  QUALIFICATION_QUALIFIED,
  bindingSourceRevision,
  draftSourceRevision,
  inspectSourceRevision,
  qualifiedSourceRevision,
  verifyContentMatchesCommit,
} from './qualification.mjs';

/**
 * Write `spec-manifest.json` from the shipped bytes.
 *
 * `dryRun` recomputes without writing, which is how `--check` proves the
 * committed manifest is the one the current content produces.
 */
export function writeManifest(repoRoot, { dryRun = false } = {}) {
  const assetSet = loadAssetSet(repoRoot);
  const importManifest = readImportManifest(repoRoot, IMPORT_MANIFEST_PATH);
  const manifest = buildManifest({ packageRoot: repoRoot, assetSet, importManifest });
  const serialized = formatJson(manifest);
  if (!dryRun) writeFileSync(path.join(repoRoot, MANIFEST_PATH), serialized);
  return { manifest, serialized, sha256: sha256Hex(serialized) };
}

/**
 * Resolve the source revision to record, or fail the qualification attempt.
 *
 * `--qualify` asserts that this build is a qualified candidate. Everything that
 * makes that claim meaningful is checked here rather than written down on trust:
 * the tree must be clean, `HEAD` must resolve, and the packaged bytes must be the
 * bytes at that commit. A dirty tree is refused outright — there is no
 * "qualified but uncommitted" state, because nothing could bind such a candidate
 * to a review.
 *
 * Qualification is resolved *before* anything is written, because a build in a
 * repository writes artifacts that are themselves tracked; re-deriving the
 * revision afterwards would see the build's own output as a dirty tree.
 */
export function resolveSourceRevision(repoRoot, assetSet, { qualify = false } = {}) {
  if (!qualify) return draftSourceRevision();
  const revision = inspectSourceRevision(repoRoot);
  const packaged = resolvePackagedFiles(repoRoot);
  verifyContentMatchesCommit(
    repoRoot,
    revision.commit,
    packaged.files.map((relative) => ({ path: relative, sha256: sha256Hex(readFileSync(path.join(repoRoot, relative))) })),
  );
  // The specification assets are checked again against their reviewed import, so
  // a qualified candidate cannot inherit a stale asset under a clean-looking tree
  // that simply never had the asset edit committed.
  verifyContentMatchesCommit(repoRoot, revision.commit, assetSet.approved.map((relative) => ({ path: relative, sha256: assetSet.sha256.get(relative) })));
  return qualifiedSourceRevision(revision);
}

/**
 * Assemble the canonical archive in memory.
 *
 * No filesystem path is touched. The entry list comes from the package `files`
 * whitelist, every entry is written with fixed metadata by this repository's own
 * ustar writer, and the result is one buffer whose digest is the archive digest.
 * `buildArchive` writes that buffer; `checkCandidate` only digests it.
 */
export function buildArchiveBytes(repoRoot, { manifestText = null } = {}) {
  const assetSet = loadAssetSet(repoRoot);
  const packaged = resolvePackagedFiles(repoRoot);
  const shippedAssets = new Set(assetSet.approved);
  const missingAssets = [...shippedAssets].filter((relative) => !packaged.files.includes(relative));
  if (missingAssets.length > 0) {
    fail('ARCHIVE_INPUT', `the package whitelist would omit shipped specification assets: ${missingAssets.join(', ')}`);
  }

  const sources = packaged.files
    .map((relative) => ({ entry: `package/${relative}`, source: path.join(repoRoot, relative) }))
    .sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0));

  // The manifest entry comes from the caller's expected bytes when one is given,
  // so the expected archive and the expected manifest are always consistent with
  // each other rather than with whatever happens to be on disk.
  const entries = sources.map((item) => ({
    entry: item.entry,
    content: item.entry === `package/${MANIFEST_PATH}` && manifestText !== null
      ? Buffer.from(manifestText, 'utf8')
      : readFileSync(item.source),
  }));
  const archive = createDeterministicTarGz(entries);
  return {
    archive,
    archiveSha256: sha256Hex(archive),
    entries: entries.map((item) => item.entry),
    bytes: archive.length,
  };
}

/**
 * Write the canonical candidate archive.
 *
 * The staging directory is disposable output used for inspection. Because the
 * archive is assembled in memory first, a build that fails after staging writes
 * still cannot leave a partially written archive in `release/`.
 */
export function buildArchive(repoRoot, { stagingRoot = null, archivePath = null } = {}) {
  const built = buildArchiveBytes(repoRoot);
  const staging = stagingRoot ?? path.join(repoRoot, BUILD_ROOT, 'staging');
  const target = archivePath ?? path.join(repoRoot, RELEASE_ROOT, archiveFileName());

  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  mkdirSync(path.dirname(target), { recursive: true });

  for (const entry of built.entries) {
    const destination = path.join(staging, entry);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(path.join(repoRoot, entry.slice('package/'.length))), { mode: 0o644 });
  }

  writeFileSync(target, built.archive);
  return { archivePath: target, archiveSha256: built.archiveSha256, entries: built.entries, staging, bytes: built.bytes };
}

/**
 * Write the candidate receipt.
 *
 * This is the artifact that resolves the self-reference the manifest cannot. The
 * manifest is a pure function of the shipped content, so it cannot name the
 * commit that contains it — that would be a fixed point no commit could satisfy.
 * The receipt lives outside every artifact it describes and carries the two facts
 * content cannot produce:
 *
 *   * the reviewed source revision, validated against the repository at build
 *     time by `--qualify`;
 *   * the exact digest of the manifest and of the archive that were produced,
 *     which depend on the build toolchain as well as on the content.
 *
 * It is disposable build output and is not committed. That is deliberate: it is
 * produced by the same reviewed process that produces the artifacts it describes,
 * and a checked-in copy would be one more file whose own provenance needs
 * explaining. A consumer that needs the binding reads it from wherever the
 * candidate was qualified.
 */
export function writeCandidateReceipt(repoRoot, { manifest, manifestSha256, archivePath, archiveSha256, sourceRevision = null, force = false }) {
  const receiptPath = path.join(repoRoot, ARCHIVE_BINDING_PATH);

  // A rebuild without `--qualify` preserves a previously qualified revision, but
  // **only** while the candidate is provably the same candidate: the recorded
  // revision must come from the same repository state and the shipped content
  // must be the content that revision was qualified against. Carrying the claim
  // onto different content would launder unreviewed changes into a reviewed
  // identity.
  //
  // `--qualify` re-derives the revision from the repository and is the only path
  // that establishes a new claim. Anything that fails the carry-forward check
  // becomes an explicit draft, never a stale `qualified`.
  let revision = sourceRevision ?? draftSourceRevision();
  let carriedForward = null;
  if (sourceRevision === null) {
    const carried = carryForwardRevision(repoRoot, receiptPath, manifest);
    if (carried !== null) {
      revision = carried.revision;
      carriedForward = carried.reason;
    }
  }
  const record = {
    receiptVersion: 1,
    package: PACKAGE_NAME,
    version: manifest.specVersion,
    archiveFile: path.basename(archivePath),
    archiveSha256,
    // The full manifest digest over every shipped file except the manifest.
    assetFilesSha256: manifest.aggregates.filesSha256,
    assetFilesContentSha256: manifest.aggregates.filesContentSha256,
    assetFileCount: manifest.files.length,
    // Kept separate so "the imported tools assets" is never confused with "every
    // file this package ships".
    importedAssetFileCount: manifest.counts.importedAssets,
    packagedFileCount: manifest.counts.packagedFiles,
    manifestSha256,
    sourceRevision: bindingSourceRevision(revision),
    qualification: revision.qualification,
    // Why the receipt says what it says. `draft` after a failed carry-forward is
    // a positive statement — the previous claim was not supported by the current
    // content — rather than a missing one, and it names the reason.
    qualificationBasis: carriedForward ?? (sourceRevision === null ? 'draft-build' : 'qualified-from-repository'),
    // Archive bytes are reproducible within one build toolchain, not across all
    // of them: Node links the platform zlib, and different zlib builds produce
    // different gzip framing for identical input. The uncompressed tar is
    // identical everywhere. Recording the producing toolchain makes the scope of
    // the byte-equality claim checkable instead of assumed.
    buildRuntime: currentToolchain(),
    note: 'Binds one concrete archive and manifest, and records the reviewed source revision. Regenerated for every build; not governed source.',
    verification: 'node scripts/spec/verify.mjs --stage manifest --stage archive --expect-source-commit <sha>',
  };
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  const serialized = formatJson(record);
  if (!force) {
    try {
      if (readFileSync(receiptPath, 'utf8') === serialized) return { receiptPath, record, changed: false };
    } catch {
      // no existing receipt yet
    }
  }
  writeFileSync(receiptPath, serialized);
  return { receiptPath, record, changed: true };
}

/**
 * Compare the committed artifacts against what the current content produces,
 * without writing anything anywhere.
 *
 * This is the drift gate. It reads the candidate root and computes the expected
 * bytes in memory; it creates no file, no directory, and no temporary artifact,
 * so a success and a failure both leave a recursive snapshot of the root
 * unchanged. (An earlier revision staged the archive under `build/` and wrote a
 * throwaway archive into `release/`; both are gone.)
 *
 * The check is complete on a fresh checkout. The only facts it cannot derive from
 * content are the reviewed source revision and the exact artifact digests that
 * were produced, and those live in the candidate receipt — an artifact that is
 * not committed. When the receipt is absent the check says so and continues with
 * the content-derived comparison, rather than demanding that a reviewer
 * reconstruct state the repository deliberately does not carry.
 */
export function checkCandidate(repoRoot, { expectedSourceRevision = null } = {}) {
  const differences = [];
  const notes = [];

  const { manifest, serialized, sha256: manifestSha256 } = writeManifest(repoRoot, { dryRun: true });

  const manifestPath = path.join(repoRoot, MANIFEST_PATH);
  let existingManifestBytes = null;
  try {
    existingManifestBytes = readFileSync(manifestPath);
  } catch {
    differences.push({ artifact: MANIFEST_PATH, problem: 'missing' });
  }
  if (existingManifestBytes !== null) {
    const existing = existingManifestBytes.toString('utf8');
    if (existing !== serialized) {
      let reason = 'content differs from the manifest this content produces';
      try {
        if (existing !== formatJson(JSON.parse(existing))) reason = 'not in the canonical build format';
      } catch {
        reason = 'not valid JSON';
      }
      differences.push({ artifact: MANIFEST_PATH, problem: reason, expected: manifestSha256, actual: sha256Hex(existingManifestBytes) });
    }
  }

  // The archive is built in memory: `buildArchive` with a buffer sink writes
  // nothing, so the expected digest is derived without touching the tree.
  const receipt = readReceipt(repoRoot);
  const archivePath = path.join(repoRoot, RELEASE_ROOT, archiveFileName());
  const expectedArchive = buildArchiveBytes(repoRoot, { manifestText: serialized });
  const expectedArchiveSha256 = expectedArchive.archiveSha256;
  let actualArchiveBytes = null;
  try {
    actualArchiveBytes = readFileSync(archivePath);
  } catch {
    differences.push({ artifact: path.relative(repoRoot, archivePath), problem: 'missing' });
  }

  // Archive *bytes* are reproducible within one build toolchain, because the
  // gzip framing comes from the platform zlib. Where the recorded toolchain
  // differs from this one, the comparison falls back to the archive's contents:
  // entry list and every entry's digest, which are runtime-independent. Drift is
  // still caught in full; only the byte-equality claim is scoped.
  const receiptToolchain = receipt?.buildRuntime ?? null;
  // Byte equality is asserted only when a receipt says the same toolchain
  // produced the committed archive. The gzip framing comes from the zlib build
  // the runtime links, and observed variance came from zlib rather than from the
  // Node version, so identity is judged on the fields that actually determine the
  // bytes: node, zlib, platform, and architecture. Without that claim the bytes
  // can be neither asserted nor refuted, and the entry comparison carries the
  // check — it covers every file's content, which is what drift means. What it
  // does not cover is compression framing, which is not content.
  const sameToolchain = receiptToolchain !== null && toolchainIdentity(receiptToolchain) === toolchainIdentity(currentToolchain());
  if (actualArchiveBytes !== null) {
    if (sameToolchain) {
      const actualArchiveSha256 = sha256Hex(actualArchiveBytes);
      if (actualArchiveSha256 !== expectedArchiveSha256) {
        differences.push({
          artifact: path.relative(repoRoot, archivePath),
          problem: 'content differs from the archive this content produces',
          expected: expectedArchiveSha256,
          actual: actualArchiveSha256,
        });
      }
    } else {
      // An unreadable archive is drift, not an internal error: the fallback must
      // not be weaker than the byte comparison it replaces.
      const actualEntries = describeArchiveEntries(actualArchiveBytes);
      const expectedEntries = describeArchiveEntries(expectedArchive.archive);
      if (actualEntries === null) {
        differences.push({ artifact: path.relative(repoRoot, archivePath), problem: 'not a readable gzip tar archive' });
      } else if (canonicalJson(actualEntries) !== canonicalJson(expectedEntries)) {
        const changed = [...new Set([...Object.keys(actualEntries), ...Object.keys(expectedEntries)])]
          .filter((entry) => actualEntries[entry] !== expectedEntries[entry]);
        differences.push({
          artifact: path.relative(repoRoot, archivePath),
          problem: `archive contents differ from what this content produces (${changed.length} entry/entries)`,
          changed: changed.slice(0, 20),
        });
      }
      const current = currentToolchain();
      notes.push(
        receiptToolchain === null
          ? `archive byte equality was not asserted: no receipt records which toolchain produced the committed archive; its entry list and per-entry digests were compared instead, under node ${current.node} (zlib ${current.zlib}, ${current.platform}/${current.arch})`
          : `archive byte equality was not asserted: the receipt was produced by node ${receiptToolchain.node} (zlib ${receiptToolchain.zlib}, ${receiptToolchain.platform}/${receiptToolchain.arch}) and this is node ${current.node} (zlib ${current.zlib}, ${current.platform}/${current.arch}); the archive's entry list and per-entry digests were compared instead`,
      );
    }
  }

  // The receipt is optional for checking. Its artifact digests are the one thing
  // content cannot reproduce on its own, since they depend on the toolchain.
  if (receipt === null) {
    notes.push('no candidate receipt present; artifact digests were recomputed rather than read back');
  } else {
    if (receipt.manifestSha256 !== undefined && receipt.manifestSha256 !== manifestSha256) {
      differences.push({ artifact: ARCHIVE_BINDING_PATH, problem: 'recorded manifest digest does not match the manifest this content produces', expected: manifestSha256, actual: receipt.manifestSha256 });
    }
    // Hashing bytes on disk does not depend on the toolchain that produced them,
    // so the recorded archive digest is always checkable and always checked.
    if (receipt.archiveSha256 !== undefined && actualArchiveBytes !== null) {
      const committedSha256 = sha256Hex(actualArchiveBytes);
      if (receipt.archiveSha256 !== committedSha256) {
        differences.push({ artifact: ARCHIVE_BINDING_PATH, problem: 'recorded archive digest does not match the committed archive', expected: committedSha256, actual: receipt.archiveSha256 });
      }
    }
  }

  if (differences.length > 0) {
    fail(
      'CHECK_DRIFT',
      `committed build output is not what the current specification content produces (${differences.length} difference(s)); run \`node scripts/spec/build.mjs\` and review the result`,
      { differences },
    );
  }
  return {
    manifestSha256,
    // Both digests, named for what they are: the committed artifact as it exists,
    // and the one this content produces under this toolchain. They are equal when
    // the receipt's toolchain matches the current one.
    archiveSha256: actualArchiveBytes === null ? null : sha256Hex(actualArchiveBytes),
    expectedArchiveSha256,
    byteEqualityAsserted: sameToolchain,
    files: manifest.files.length,
    archive: path.relative(repoRoot, archivePath),
    notes,
  };
}

/**
 * Decide whether a previously qualified revision may be carried onto a rebuild.
 *
 * The claim is preserved only while all of these hold, and each is checked
 * rather than assumed:
 *
 *   1. the receipt records a qualified revision in the expected shape;
 *   2. the receipt is a receipt for *this* package and version;
 *   3. the receipt's recorded content digests match the freshly built manifest,
 *      so the candidate is the same candidate;
 *   4. the repository still resolves `HEAD` to that revision and the shipped
 *      bytes still match the blobs at it, so nothing shipped has changed.
 *
 * Check (4) is about the repository, not only about content: a commit that
 * touches nothing packaged still moves `HEAD`, and a claim recorded for the old
 * revision no longer describes this candidate. A tools-only change therefore also
 * yields a draft, which is recovered by running the qualify step against the new
 * revision. A change to shipped content fails (3); a moved `HEAD` fails (4).
 * Either way the result is an explicit draft, because the bytes are no longer
 * provably the reviewed ones.
 */
function carryForwardRevision(repoRoot, receiptPath, manifest) {
  const draft = (reason) => ({ revision: draftSourceRevision(), reason });
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch {
    // No receipt is the ordinary first-build case: the basis is recorded as a
    // plain draft build rather than as a declined carry-forward.
    return null;
  }
  if (receipt.qualification !== 'qualified') return draft('previous-receipt-not-qualified');
  const source = receipt.sourceRevision;
  if (source === null || typeof source !== 'object') return draft('previous-receipt-has-no-revision');
  if (!/^[0-9a-f]{40}$/.test(source.commit ?? '') || source.treeState !== 'clean') {
    return draft('previous-receipt-revision-malformed');
  }
  if (receipt.package !== PACKAGE_NAME || receipt.version !== manifest.specVersion) {
    return draft('previous-receipt-is-for-a-different-package-or-version');
  }
  if (receipt.assetFilesSha256 !== manifest.aggregates.filesSha256) {
    return draft('shipped-content-changed-since-qualification');
  }

  // The revision must still be the repository's HEAD and must still describe the
  // packaged bytes. This is the same check `--qualify` performs, so carrying a
  // claim forward is a revalidation, not an act of trust.
  let head;
  try {
    head = inspectSourceRevision(repoRoot);
  } catch (error) {
    return draft(`repository-no-longer-supports-the-claim:${error.code ?? 'unknown'}`);
  }
  if (head.commit !== source.commit) return draft('head-moved-since-qualification');
  try {
    verifyContentMatchesCommit(
      repoRoot,
      source.commit,
      manifest.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
    );
  } catch (error) {
    return draft(`packaged-bytes-differ-from-the-qualified-commit:${error.code ?? 'unknown'}`);
  }
  return {
    revision: qualifiedSourceRevision({ commit: source.commit, treeState: source.treeState, repository: source.repository ?? null }),
    reason: 'carried-forward-and-revalidated',
  };
}

/**
 * The source revision a receipt already records, or null when it has none.
 *
 * The receipt stores the revision in its binding form (commit, tree state,
 * repository, and how it was validated). It is mapped back to the revision form
 * the build carries, so the two shapes stay separate: the binding form is what a
 * reviewer reads, the revision form is what the build passes around.
 */
function existingReceiptRevision(receiptPath) {
  let record;
  try {
    record = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch {
    return null;
  }
  const source = record?.sourceRevision;
  if (source === null || typeof source !== 'object') return null;
  if (source.treeState !== 'clean' || !/^[0-9a-f]{40}$/.test(source.commit ?? '')) return null;
  return qualifiedSourceRevision({ commit: source.commit, treeState: source.treeState, repository: source.repository ?? null });
}

/**
 * The fields that determine the archive's bytes.
 *
 * Recorded in full and compared in full: a partial comparison would claim byte
 * equality on the strength of one matching field while another differed, which is
 * exactly the mistake an earlier revision made by comparing only the Node version.
 */
function toolchainIdentity(runtime) {
  return `${runtime.node} ${runtime.zlib} ${runtime.platform} ${runtime.arch}`;
}

/** The running build toolchain, in the shape the receipt records. */
export function currentToolchain() {
  return {
    node: process.version,
    zlib: process.versions.zlib,
    platform: process.platform,
    arch: process.arch,
  };
}

/**
 * `{ entry: sha256 }` for every entry of a gzipped archive, or null when the
 * bytes are not a readable gzip tar.
 *
 * Used when the committed archive was produced by a different toolchain, where
 * byte equality is not assertable but content equality still is. Returning null
 * rather than throwing keeps an unreadable archive a drift finding, which is what
 * it is, instead of an internal error.
 */
function describeArchiveEntries(archiveBytes) {
  try {
    return Object.fromEntries(readTarEntries(gunzipSync(archiveBytes)).map((item) => [item.entry, sha256Hex(item.content)]));
  } catch {
    return null;
  }
}

/** The committed manifest as data, or null when it is absent or unreadable. */
function readCommittedManifest(repoRoot) {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, MANIFEST_PATH), 'utf8'));
  } catch {
    return null;
  }
}

function looksLikeSourceRevision(value) {
  return value !== null && typeof value === 'object' && typeof value.qualification === 'string';
}

/** The candidate receipt as data, or null when it is absent or unreadable. */
export function readReceipt(repoRoot) {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, ARCHIVE_BINDING_PATH), 'utf8'));
  } catch {
    return null;
  }
}

export function buildCandidate(repoRoot, { sourceRevision = null, logger = () => {} } = {}) {
  logger('build: manifest');
  const { manifest, sha256: manifestSha256 } = writeManifest(repoRoot);
  logger('build: archive');
  const archive = buildArchive(repoRoot);
  logger('build: candidate receipt');
  const receipt = writeCandidateReceipt(repoRoot, {
    manifest,
    manifestSha256,
    archivePath: archive.archivePath,
    archiveSha256: archive.archiveSha256,
    sourceRevision,
    force: true,
  });
  return {
    manifest,
    manifestSha256,
    sourceRevision: receipt.record.sourceRevision === null
      ? draftSourceRevision()
      : { ...receipt.record.sourceRevision, qualification: QUALIFICATION_QUALIFIED },
    archivePath: archive.archivePath,
    archiveSha256: archive.archiveSha256,
    receiptPath: receipt.receiptPath,
    receipt: receipt.record,
  };
}
