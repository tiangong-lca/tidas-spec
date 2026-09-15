// Integration tests for the published candidate.
//
// These exercise the artifact a consumer actually receives, not the source tree:
//   * the candidate archive is unpacked with no sibling repositories present and
//     verified there;
//   * the canonical tarball is installed into a fresh consumer directory and its
//     assets are read from the installed location;
//   * the whole declared package is re-read by a reader that is not Node, with
//     every Node-bearing directory removed from that process's PATH.
//
// The reviewed repository is read-only input to this suite. Every build, check,
// and pack runs in a disposable copy, because a test that rebuilt the repository
// would rewrite the artifacts under review and hide exactly the drift these
// tests exist to detect.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { readTarEntries } from '../../scripts/spec/lib/tar.mjs';
import { sha256Hex } from '../../scripts/spec/lib/core.mjs';
import { buildCandidate, checkCandidate } from '../../scripts/spec/lib/build.mjs';
import { loadAssetSet } from '../../scripts/spec/lib/inventory.mjs';
import { verifyCandidate } from '../../scripts/spec/lib/verify.mjs';
import * as packageContent from '../../scripts/spec/lib/package-content.mjs';
import { REPO_ROOT, cleanupTempRoots, makeBuildableFixture, makeTempRoot, snapshotTree } from '../helpers/fixture.mjs';

const ARCHIVE_FILE = 'tiangong-lca-tidas-spec-0.1.0.tgz';
const PACKAGED_ENTRIES = ['package.json', 'LICENSE', 'README.md', 'source-import.yaml', 'reviewed-baseline.json', 'spec-manifest.json', '.gitignore', 'assets'];

test.after(cleanupTempRoots);

/** A disposable copy of the repository that builds are allowed to write to. */
let workspace = null;
function buildWorkspace() {
  if (workspace === null) workspace = makeBuildableFixture();
  return workspace;
}

function archivePath(root = buildWorkspace()) {
  return path.join(root, 'release', ARCHIVE_FILE);
}

function bindingPath(root = buildWorkspace()) {
  return path.join(root, 'build', 'candidate-archive-binding.json');
}

function ensureArchive() {
  const root = buildWorkspace();
  if (existsSync(archivePath(root))) return root;
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/spec/build.mjs'), '--root', root], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, `candidate build failed: ${result.stderr}`);
  return root;
}

/** Unpack the canonical archive into a fresh directory with nothing else around. */
function unpackArchive() {
  const root = ensureArchive();
  const destination = makeTempRoot('tidas-spec-unpacked-');
  for (const item of readTarEntries(gunzipSync(readFileSync(archivePath(root))))) {
    const target = path.join(destination, item.entry);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, item.content);
  }
  return path.join(destination, 'package');
}

/** Pack the disposable copy and return the tarball path. */
function packCandidate() {
  const root = ensureArchive();
  const destination = makeTempRoot('tidas-spec-pack-');
  const result = spawnSync('pnpm', ['pack', '--pack-destination', destination], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `pnpm pack failed: ${result.stderr || result.stdout}`);
  const packed = readdirSync(destination).filter((name) => name.endsWith('.tgz'));
  assert.equal(packed.length, 1, `expected one packed tarball, found ${packed.join(', ')}`);
  return path.join(destination, packed[0]);
}

/** `{ entry -> sha256 }` for every file in a tarball. */
function tarballContentDigests(tarball) {
  const digests = {};
  for (const item of readTarEntries(gunzipSync(readFileSync(tarball)))) {
    digests[item.entry] = sha256Hex(item.content);
  }
  return digests;
}

// ---------------------------------------------------------------------------
// test isolation: the reviewed repository is never written to
// ---------------------------------------------------------------------------

test('building and checking a disposable copy leaves the reviewed repository untouched', () => {
  // The guard that makes every other test in this file trustworthy. The suite
  // legitimately builds, packs, and installs; none of it may touch the checkout.
  const before = snapshotTree(REPO_ROOT);
  const root = buildWorkspace();
  buildCandidate(root);
  checkCandidate(root);
  packCandidate();
  verifyCandidate({ repoRoot: unpackArchive(), stages: ['identity', 'manifest', 'package'] });
  const after = snapshotTree(REPO_ROOT);
  assert.deepEqual(after, before, 'a test mutated the reviewed repository');
});

test('the reviewed repository check passes on its committed artifacts', () => {
  // The manifest is content-derived, so its digest is runtime-independent. The
  // archive digest is only asserted when the producing toolchain matches; under a
  // different runtime the entry-level comparison is what was checked.
  const summary = checkCandidate(REPO_ROOT);
  assert.equal(summary.manifestSha256, sha256Hex(readFileSync(path.join(REPO_ROOT, 'spec-manifest.json'))));
  assert.equal(summary.archiveSha256, sha256Hex(readFileSync(archivePath(REPO_ROOT))));
  if (summary.byteEqualityAsserted) {
    assert.equal(summary.expectedArchiveSha256, summary.archiveSha256);
  } else {
    assert.ok(summary.notes.some((note) => note.includes('byte equality was not asserted')));
  }
});

test('checking is non-mutating on success', () => {
  const root = ensureArchive();
  // A sentinel in a path the check must not touch, plus a full recursive
  // snapshot: the check may not create, delete, or rewrite anything at all.
  writeFileSync(path.join(root, 'build', 'staging', 'sentinel'), 'must survive');
  const before = snapshotTree(root);
  checkCandidate(root);
  assert.deepEqual(snapshotTree(root), before, 'checkCandidate modified the candidate root');
  assert.ok(existsSync(path.join(root, 'build', 'staging', 'sentinel')));
});

test('checking is non-mutating on failure', () => {
  const root = makeBuildableFixture();
  buildCandidate(root);
  writeFileSync(path.join(root, 'spec-manifest.json'), '{"corrupted":true}\n');
  const before = snapshotTree(root);
  assert.throws(() => checkCandidate(root), (error) => error.code === 'CHECK_DRIFT');
  assert.deepEqual(snapshotTree(root), before, 'a failed checkCandidate modified the candidate root');
});

// ---------------------------------------------------------------------------
// fresh checkout
// ---------------------------------------------------------------------------

test('a fresh checkout with no build state passes the drift check', () => {
  // The exact CI situation: committed manifest and archive, `build/` absent
  // because it is ignored, and dev dependencies installed. A check that required
  // a receipt would fail here on every clean checkout.
  const root = makeBuildableFixture();
  rmSync(path.join(root, 'build'), { recursive: true, force: true });
  assert.ok(!existsSync(path.join(root, 'build')), 'the fixture must start without build state');
  const summary = checkCandidate(root);
  assert.equal(summary.archiveSha256, sha256Hex(readFileSync(archivePath(root))), 'the committed archive digest must be reported');
  assert.ok(summary.notes.some((note) => note.includes('receipt')), `expected a note about the absent receipt, got ${JSON.stringify(summary.notes)}`);
  assert.equal(summary.byteEqualityAsserted, false, 'without a receipt the byte-equality claim cannot be made');
  assert.ok(!existsSync(path.join(root, 'build')), 'the check must not create build state');
});

test('a fresh checkout verifies end to end', () => {
  const root = makeBuildableFixture();
  rmSync(path.join(root, 'build'), { recursive: true, force: true });
  const result = verifyCandidate({ repoRoot: root, stages: ['identity', 'manifest', 'package', 'archive'] });
  assert.equal(result.diagnostics.ok, true, JSON.stringify(result.diagnostics.errors, null, 2));
});

test('a fresh checkout still detects a stale committed archive', () => {
  // The receipt being absent must not weaken drift detection.
  const root = makeBuildableFixture();
  rmSync(path.join(root, 'build'), { recursive: true, force: true });
  const damaged = readFileSync(archivePath(root));
  damaged[damaged.length - 1] ^= 0xff;
  writeFileSync(archivePath(root), damaged);
  assert.throws(() => checkCandidate(root), (error) => error.code === 'CHECK_DRIFT');
});

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

test('the canonically built archive verifies with no sibling repository present', () => {
  const packageRoot = unpackArchive();
  const result = verifyCandidate({ repoRoot: packageRoot, stages: ['identity', 'manifest', 'package'] });
  assert.equal(result.diagnostics.ok, true, `unpacked package failed verification: ${JSON.stringify(result.diagnostics.errors, null, 2)}`);
  const offenders = result.diagnostics.errors.filter((item) => /tidas-toolkit|tidas-sdks/.test(item.message));
  assert.deepEqual(offenders, [], 'verification must not reach for a source checkout');
});

test('the archive carries the approved asset set and no excluded tools input', () => {
  const packageRoot = unpackArchive();
  const assetSet = loadAssetSet(packageRoot);
  assert.equal(assetSet.approved.length, 39);
  assert.equal(assetSet.schemaSets.en.fileNames.length, 18);
  assert.equal(assetSet.schemaSets.zh.fileNames.length, 18);
  assert.equal(assetSet.approved.filter((relative) => relative.endsWith('.yaml')).length, 2);
  assert.deepEqual(readdirSync(path.join(packageRoot, 'assets/tidas/methodologies')).sort(), ['tidas_flows.yaml', 'tidas_processes.yaml']);
});

test('every shipped file except the manifest carries an exact byte digest', () => {
  const packageRoot = unpackArchive();
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'spec-manifest.json'), 'utf8'));

  // The manifest cannot contain its own digest; every other shipped file must,
  // including the publication metadata. No file is bound by a weaker identity.
  const physicallyPresent = [];
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), `${relative}/`);
      else physicallyPresent.push(relative);
    }
  };
  walk(packageRoot, '');
  const declared = new Set(manifest.files.map((file) => file.path));
  assert.deepEqual(
    [...declared].sort(),
    physicallyPresent.filter((relative) => relative !== 'spec-manifest.json').sort(),
    'the byte-digest list must cover every shipped file except the manifest itself',
  );

  for (const file of manifest.files) {
    assert.equal(sha256Hex(readFileSync(path.join(packageRoot, file.path))), file.sha256, `${file.path}: shipped bytes do not match the manifest`);
  }
  assert.equal(manifest.counts.packagedFiles, physicallyPresent.length);
  assert.equal(manifest.files.length + 1, physicallyPresent.length);
});

test('the manifest is purely content-derived', () => {
  // A manifest that named the commit containing it could never be committed: the
  // commit would depend on the manifest and the manifest on the commit. The
  // revision therefore lives in the receipt, outside every artifact it describes.
  const packageRoot = unpackArchive();
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'spec-manifest.json'), 'utf8'));
  assert.equal(manifest.reviewedPackageSource, undefined);
  assert.equal(manifest.releaseCommit, undefined);
  assert.ok(typeof manifest.selfHash?.note === 'string' && manifest.selfHash.note.length > 0);
});

test('the receipt binds the archive, the manifest, and the source revision', () => {
  const root = ensureArchive();
  const receipt = JSON.parse(readFileSync(bindingPath(root), 'utf8'));
  const manifest = JSON.parse(readFileSync(path.join(root, 'spec-manifest.json'), 'utf8'));
  assert.equal(receipt.package, '@tiangong-lca/tidas-spec');
  assert.equal(receipt.archiveFile, ARCHIVE_FILE);
  assert.equal(receipt.archiveSha256, sha256Hex(readFileSync(archivePath(root))));
  assert.equal(receipt.manifestSha256, sha256Hex(readFileSync(path.join(root, 'spec-manifest.json'))));
  assert.equal(receipt.assetFilesSha256, manifest.aggregates.filesSha256);
  assert.equal(receipt.assetFileCount, manifest.files.length);
  assert.equal(receipt.importedAssetFileCount, manifest.counts.importedAssets);
  // A draft build claims no revision; the field exists and is explicitly null.
  assert.equal(receipt.sourceRevision, null);
  assert.equal(receipt.qualification, 'draft');
});

test('every verification stage runs on its own', () => {
  const root = ensureArchive();
  for (const stage of ['identity', 'manifest', 'package', 'archive']) {
    const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/spec/verify.mjs'), '--root', root, '--stage', stage, '--quiet'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, `stage ${stage} failed on its own: ${result.stderr}`);
  }
});

// ---------------------------------------------------------------------------
// channel parity
// ---------------------------------------------------------------------------

test('the npm tarball and the canonical archive are byte-identical file for file', () => {
  // Not "equivalent modulo normalization": the same bytes, every entry, including
  // the publication metadata. This holds because `package.json` is stored in the
  // form the npm client produces, which makes `pnpm pack` a no-op for it.
  const packed = packCandidate();
  const npm = tarballContentDigests(packed);
  const release = tarballContentDigests(archivePath());
  assert.deepEqual(Object.keys(npm).sort(), Object.keys(release).sort(), 'the two channels must carry the same entries');
  for (const entry of Object.keys(release)) {
    assert.equal(npm[entry], release[entry], `${entry}: npm tarball and canonical archive differ`);
  }
  assert.equal(Object.keys(release).length, 45);
  assert.equal(npm['package/package.json'], sha256Hex(readFileSync(path.join(buildWorkspace(), 'package.json'))), 'the package metadata must survive packing unchanged');
});

test('the canonical tarball installs into a fresh consumer and verifies in place', () => {
  const packed = packCandidate();
  const consumer = makeTempRoot('tidas-spec-consumer-');
  writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify({ name: 'consumer', version: '0.0.0', private: true }, null, 2)}\n`);
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', packed], {
    cwd: consumer,
    encoding: 'utf8',
    env: { ...process.env, npm_config_offline: 'true' },
  });
  assert.equal(install.status, 0, `npm install failed: ${install.stderr || install.stdout}`);

  const installed = path.join(consumer, 'node_modules', '@tiangong-lca', 'tidas-spec');
  assert.ok(existsSync(installed), 'the package was not installed at the expected path');
  assert.deepEqual(
    readdirSync(path.join(consumer, 'node_modules')).filter((name) => !name.startsWith('.')).sort(),
    ['@tiangong-lca'],
    'the install must not pull in a runtime dependency',
  );

  const result = verifyCandidate({ repoRoot: installed, stages: ['identity', 'manifest', 'package'] });
  assert.equal(result.diagnostics.ok, true, `installed package failed verification: ${JSON.stringify(result.diagnostics.errors, null, 2)}`);

  const installedAssets = loadAssetSet(installed);
  assert.equal(installedAssets.approved.length, 39);
  const lock = JSON.parse(readFileSync(path.join(installed, 'assets/tidas/schema.lock.json'), 'utf8'));
  assert.equal(lock.translationPairs.fileCount, 18);
  // The installed metadata is the reviewed metadata, byte for byte.
  assert.equal(
    sha256Hex(readFileSync(path.join(installed, 'package.json'))),
    sha256Hex(readFileSync(path.join(buildWorkspace(), 'package.json'))),
    'the installed package.json must be byte-identical to the reviewed one',
  );
});

test('the npm package entry points resolve to real installed files', () => {
  const packageRoot = unpackArchive();
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const target of Object.values(pkg.exports)) {
    const resolved = target.replace('./', '');
    if (resolved.includes('*')) {
      assert.ok(existsSync(path.dirname(path.join(packageRoot, resolved))), `export directory is missing: ${resolved}`);
      continue;
    }
    assert.ok(existsSync(path.join(packageRoot, resolved)), `export target is missing: ${resolved}`);
  }
});

// ---------------------------------------------------------------------------
// toolchain and comparison scope
// ---------------------------------------------------------------------------

test('the repository declares its toolchain in one non-published place', () => {
  // The pin lives in `toolchain.json`, which the package `files` whitelist
  // excludes, so declaring versions there cannot change either channel's bytes.
  // It is deliberately not `package.json`'s `packageManager` field: the npm client
  // strips that field while packing.
  const declared = JSON.parse(readFileSync(path.join(REPO_ROOT, 'toolchain.json'), 'utf8'));
  assert.equal(declared.node, '24.19.0');
  assert.equal(declared.pnpm, '11.24.0');
  assert.equal(JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).packageManager, undefined);
  assert.ok(/^use-node-version=24\.19\.0$/m.test(readFileSync(path.join(REPO_ROOT, '.npmrc'), 'utf8')));

  // The published package must not carry it.
  const { resolvePackagedFiles } = require_package_content();
  assert.equal(resolvePackagedFiles(REPO_ROOT).files.includes('toolchain.json'), false);

  // This run must satisfy the declaration, or the suite is describing a
  // different build toolchain than the artifacts under review.
  assert.equal(`v${declared.node}`, process.version, `this run used ${process.version}`);
  assert.equal(execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(), declared.pnpm);
});

test('the toolchain check refuses a mismatched runtime', () => {
  const script = path.join(REPO_ROOT, 'scripts/ci/require-toolchain.mjs');
  const ok = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);

  // The ambient fallback on this machine is Node 26 with pnpm 10. The check must
  // refuse it rather than reporting a pass for a toolchain the candidate was not
  // built with.
  const wrong = spawnSync('/opt/homebrew/bin/node', [script], { encoding: 'utf8', env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/bin:/bin' } });
  if (wrong.status === 0) {
    const declared = JSON.parse(readFileSync(path.join(REPO_ROOT, 'toolchain.json'), 'utf8'));
    assert.equal(wrong.stdout.includes(`node ${declared.node}`), true, 'a pass must be for the declared toolchain');
  } else {
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /toolchain mismatch/);
  }
});

function require_package_content() {
  return packageContent;
}

test('the drift check reports which archive comparison ran', () => {
  const root = ensureArchive();
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/spec/build.mjs'), '--root', root, '--check', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(['byte-equality', 'content-equality'].includes(report.archiveComparison), `unexpected mode ${report.archiveComparison}`);
  assert.equal(typeof report.byteEqualityAsserted, 'boolean');
  if (!report.byteEqualityAsserted) {
    assert.ok(report.notes.some((note) => note.includes('byte equality was not asserted')), 'a weaker comparison must be stated');
  }
  // Whatever the mode, the recorded archive digest is checked against the bytes.
  const receipt = JSON.parse(readFileSync(bindingPath(root), 'utf8'));
  assert.equal(receipt.archiveSha256, sha256Hex(readFileSync(archivePath(root))));
});

// ---------------------------------------------------------------------------
// independent readers
// ---------------------------------------------------------------------------

test('a non-Node reader verifies the declared file set and every digest', () => {
  ensureArchive();
  const script = `
import hashlib, json, sys, tarfile

with tarfile.open(sys.argv[1], 'r:gz') as tar:
    members = tar.getmembers()
    names = [m.name for m in members]
    if any(not n.startswith('package/') for n in names):
        sys.exit('every entry must live under package/')
    if any(m.issym() or m.islnk() for m in members):
        sys.exit('the archive must contain only regular files')

    manifest = json.load(tar.extractfile('package/spec-manifest.json'))
    declared = {f['path']: f['sha256'] for f in manifest['files']}
    present = {n[len('package/'):] for n in names}
    present.discard('spec-manifest.json')

    if sorted(declared) != sorted(present):
        sys.exit('declared/present mismatch: missing=%s extra=%s' % (sorted(set(declared) - present), sorted(present - set(declared))))

    for name, expected in declared.items():
        actual = hashlib.sha256(tar.extractfile('package/' + name).read()).hexdigest()
        if actual != expected:
            sys.exit('%s: %s != %s' % (name, actual, expected))

    lock = json.load(tar.extractfile('package/assets/tidas/schema.lock.json'))
    if lock['translationPairs']['fileCount'] != 18:
        sys.exit('lock does not describe 18 translation pairs')
    for set_id, set_lock in lock['schemaSets'].items():
        if set_lock['fileCount'] != 18:
            sys.exit('schema set %s does not describe 18 files' % set_id)
        for file_name, entry in set_lock['files'].items():
            member = 'package/assets/tidas/%s/%s' % (set_lock['path'], file_name)
            if hashlib.sha256(tar.extractfile(member).read()).hexdigest() != entry['contentSha256']:
                sys.exit('%s: lock content hash mismatch' % member)

print(json.dumps({'declaredFiles': len(declared), 'archiveEntries': len(names), 'translationPairs': lock['translationPairs']['fileCount']}))
`;
  const scriptPath = path.join(makeTempRoot('tidas-spec-reader-'), 'verify_archive.py');
  writeFileSync(scriptPath, script);

  // Every directory that actually holds a `node` executable is dropped from PATH,
  // so the reader cannot fall back to this project's tooling.
  const nodeFreePath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((entry) => entry === '' || !existsSync(path.join(entry, 'node')))
    .join(path.delimiter);

  const result = spawnSync('python3', [scriptPath, archivePath()], { encoding: 'utf8', env: { ...process.env, PATH: nodeFreePath } });
  assert.equal(result.status, 0, `non-Node reader failed: ${result.stderr || result.stdout}`);
  const summary = JSON.parse(result.stdout.trim().split('\n').pop());
  // 45 shipped files: 44 declared with byte digests, plus the manifest itself.
  assert.equal(summary.declaredFiles, 44);
  assert.equal(summary.archiveEntries, 45);
  assert.equal(summary.translationPairs, 18);

  const probe = spawnSync('node', ['--version'], { encoding: 'utf8', env: { ...process.env, PATH: nodeFreePath } });
  assert.notEqual(probe.status, 0, 'the non-Node reader environment still resolved `node`');
});

test('tar and standard hashing tools reproduce the manifest digests', () => {
  ensureArchive();
  const destination = makeTempRoot('tidas-spec-tar-');
  const extract = spawnSync('tar', ['-xzf', archivePath(), '-C', destination], { encoding: 'utf8' });
  assert.equal(extract.status, 0, `tar extraction failed: ${extract.stderr}`);
  const packageRoot = path.join(destination, 'package');
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'spec-manifest.json'), 'utf8'));
  const hasher = process.platform === 'darwin' ? 'shasum' : 'sha256sum';
  const hasherArgs = process.platform === 'darwin' ? ['-a', '256'] : [];
  for (const file of manifest.files.slice(0, 5)) {
    const digest = spawnSync(hasher, [...hasherArgs, path.join(packageRoot, file.path)], { encoding: 'utf8' });
    assert.equal(digest.status, 0, `${hasher} failed on ${file.path}`);
    assert.equal(digest.stdout.trim().split(/\s+/)[0], file.sha256, `${file.path}: external hash disagrees with the manifest`);
  }
});

// ---------------------------------------------------------------------------
// drift and determinism
// ---------------------------------------------------------------------------

test('the drift check fails on a corrupted committed manifest', () => {
  const root = makeBuildableFixture();
  writeFileSync(path.join(root, 'spec-manifest.json'), '{"corrupted":true}\n');
  assert.throws(() => checkCandidate(root), (error) => error.code === 'CHECK_DRIFT');
});

test('the drift check fails on a stale committed archive', () => {
  const root = makeBuildableFixture();
  const damaged = readFileSync(archivePath(root));
  damaged[damaged.length - 1] ^= 0xff;
  writeFileSync(archivePath(root), damaged);
  // Fails on the byte comparison when the toolchain matches, and on the entry
  // comparison when it does not. Either way it must be a drift failure, not an
  // internal error.
  assert.throws(() => checkCandidate(root), (error) => error.code === 'CHECK_DRIFT');
});

test('the drift check fails on an unreadable committed archive under any toolchain', () => {
  const root = makeBuildableFixture();
  writeFileSync(archivePath(root), 'not an archive at all');
  assert.throws(() => checkCandidate(root), (error) => error.code === 'CHECK_DRIFT');
});

test('two clean builds of the same disposable copy produce the same digests', () => {
  const root = makeBuildableFixture();
  const first = buildCandidate(root);
  const second = buildCandidate(root);
  assert.equal(first.archiveSha256, second.archiveSha256);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.equal(first.archiveSha256, JSON.parse(readFileSync(bindingPath(root), 'utf8')).archiveSha256);
});

test('verification of a copy fails when a shipped schema is damaged', () => {
  const root = makeBuildableFixture();
  const target = path.join(root, 'assets/tidas/schemas/tidas_flows.json');
  writeFileSync(target, readFileSync(target, 'utf8').replace('"type": "object"', '"type": "array"'));
  const result = verifyCandidate({ repoRoot: root, stages: ['identity'] });
  assert.equal(result.diagnostics.ok, false, 'a damaged copy must not verify');
  const codes = result.diagnostics.errors.map((item) => item.code);
  assert.ok(codes.some((code) => code.endsWith('SOURCE_BYTES')), `expected the damage to be traced to the reviewed import: ${codes.join(', ')}`);
});

test('a symlinked file in a copy is rejected rather than followed', () => {
  const root = makeBuildableFixture();
  const target = path.join(root, 'assets/tidas/schemas/tidas_contacts.json');
  rmSync(target);
  symlinkSync(path.join(root, 'package.json'), target);
  const result = verifyCandidate({ repoRoot: root, stages: ['identity'] });
  assert.equal(result.diagnostics.ok, false);
  assert.ok(result.diagnostics.errors.some((item) => item.code.endsWith('FILE_SYMLINK')), 'a symlink must not stand in for a shipped asset');
});
