// Disposable fixture builder for conformance and integration tests.
//
// A fixture is a complete, self-contained copy of the repository's shipped
// inputs in a temporary directory. Every mutation the tests make is applied to
// that copy, never to the repository: the point of an adversarial test is to
// prove the verifier rejects a bad candidate, not to damage the real one.

import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const REPO_ROOT = path.resolve(new URL('../..', import.meta.url).pathname);

// `.gitignore` is included because it is load-bearing: the qualification checks
// read the Git state, and `build/` is only disposable output if it is ignored.
const COPIED_ENTRIES = ['package.json', 'LICENSE', 'README.md', 'source-import.yaml', 'reviewed-baseline.json', 'spec-manifest.json', '.gitignore', 'assets'];

const temporaryRoots = [];

export function makeTempRoot(prefix = 'tidas-spec-fixture-') {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

export function cleanupTempRoots() {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Copy the shipped inputs into a fresh temporary directory.
 *
 * The manifest is included because most cases need a tree that starts out
 * consistent; cases that probe a missing or corrupt manifest delete or overwrite
 * it themselves.
 */
export function makeFixtureRoot() {
  const root = makeTempRoot();
  for (const entry of COPIED_ENTRIES) {
    cpSync(path.join(REPO_ROOT, entry), path.join(root, entry), { recursive: true });
  }
  return root;
}

/**
 * Recursive `{ path -> sha256 }` snapshot of a directory.
 *
 * Tests use this to prove that an operation left a tree untouched: they snapshot
 * before and after and compare. Symlinks are recorded as links rather than
 * followed, so a test cannot wander outside the tree it is measuring.
 */
export function snapshotTree(root) {
  const out = {};
  const walk = (absolute, relative) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const entryAbsolute = path.join(absolute, entry.name);
      const entryRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const stats = lstatSync(entryAbsolute);
      if (stats.isSymbolicLink()) {
        out[entryRelative] = `symlink:${readlinkSync(entryAbsolute)}`;
        continue;
      }
      if (stats.isDirectory()) {
        out[entryRelative] = 'directory';
        walk(entryAbsolute, entryRelative);
        continue;
      }
      out[entryRelative] = createHash('sha256').update(readFileSync(entryAbsolute)).digest('hex');
    }
  };
  walk(root, '');
  return out;
}

/**
 * Copy the shipped inputs plus the committed artifacts into a disposable root.
 *
 * Use this for any test that needs to build, check, or pack: the reviewed
 * repository is read-only input, and a test that rebuilds it would rewrite the
 * very artifacts under review and mask drift.
 */
export function makeBuildableFixture() {
  const root = makeTempRoot('tidas-spec-buildable-');
  for (const entry of [...COPIED_ENTRIES, 'release']) {
    try {
      cpSync(path.join(REPO_ROOT, entry), path.join(root, entry), { recursive: true });
    } catch (error) {
      if (entry === 'release') continue;
      throw error;
    }
  }
  mkdirSync(path.join(root, 'build'), { recursive: true });
  try {
    cpSync(path.join(REPO_ROOT, 'build', 'candidate-archive-binding.json'), path.join(root, 'build', 'candidate-archive-binding.json'));
  } catch {
    // A fresh checkout has no receipt; tests that need one build first.
  }
  return root;
}

/**
 * A disposable instance of the toolchain check with a declaration the test owns.
 *
 * `scripts/ci/require-toolchain.mjs` locates its repository root by walking up
 * from its own file to a `package.json` carrying the package name, then reads
 * `toolchain.json` there. Copying that manifest, the check, and the library it
 * imports into a temporary directory, and substituting the declaration, yields a
 * complete, self-contained run of the check whose expected toolchain is entirely
 * under the test's control.
 *
 * That is what makes mismatch coverage hermetic. A test does not need a second
 * Node installation, or any host path, for the declaration to disagree with the
 * running runtime: it writes a declaration that cannot match and runs the check
 * with `process.execPath`. Nothing outside the temporary directory is read, and
 * the reviewed repository's own `toolchain.json` is never touched.
 *
 * The caller supplies the whole declared object, so a case can vary one field
 * and hold the other at the running value to prove which mismatch was detected.
 */
export function makeToolchainFixture(declaration) {
  const root = makeTempRoot('tidas-spec-toolchain-');
  mkdirSync(path.join(root, 'scripts', 'ci'), { recursive: true });
  cpSync(path.join(REPO_ROOT, 'package.json'), path.join(root, 'package.json'));
  cpSync(path.join(REPO_ROOT, 'scripts', 'ci', 'require-toolchain.mjs'), path.join(root, 'scripts', 'ci', 'require-toolchain.mjs'));
  cpSync(path.join(REPO_ROOT, 'scripts', 'spec'), path.join(root, 'scripts', 'spec'), { recursive: true });
  writeFixtureJson(root, 'toolchain.json', declaration);
  return root;
}

export function readFixtureJson(root, relative) {
  return JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
}

export function writeFixtureJson(root, relative, value) {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
}

export function mutateFixtureText(root, relative, mutate) {
  const absolute = path.join(root, relative);
  const before = readFileSync(absolute, 'utf8');
  const after = mutate(before);
  writeFileSync(absolute, after);
  return { before, after };
}

/** Run the verifier in-process and return its diagnostics. */
export async function verifyInProcess(root, stages, options = {}) {
  const { verifyCandidate } = await import('../../scripts/spec/lib/verify.mjs');
  return verifyCandidate({ repoRoot: root, stages, ...options });
}

/**
 * Recompute every derived artifact in a fixture from its current assets.
 *
 * The lock, the manifest, and the reviewed baseline are all functions of the
 * content. A test that mutates content to probe a content check would otherwise
 * fail on stale derived data first and never reach the check it means to
 * exercise. Refreshing them here is what keeps each adversarial case aimed at
 * exactly one condition. Tests that specifically probe one of these artifacts do
 * not call it.
 *
 * The import manifest is deliberately *not* refreshed: it records what the
 * reviewed source contained, so rewriting it is itself the thing under test.
 */
export async function rebuildDerivedArtifacts(root) {
  const { loadAssetSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const { computeSchemaLock } = await import('../../scripts/spec/lib/lock.mjs');
  const { readImportManifest } = await import('../../scripts/spec/lib/package-content.mjs');
  const { buildManifest } = await import('../../scripts/spec/lib/verify.mjs');
  const { writeManifest } = await import('../../scripts/spec/lib/build.mjs');
  const { formatJson, hashCanonicalJson } = await import('../../scripts/spec/lib/core.mjs');

  const assetSet = loadAssetSet(root);
  const lockPath = path.join(root, 'assets/tidas/schema.lock.json');
  const shippedLock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const localizedKeys = new Set(shippedLock.allowedLocalizedKeys);
  const lock = computeSchemaLock({
    schemaRoot: 'assets/tidas',
    schemaSets: { en: assetSet.schemaSets.en, zh: assetSet.schemaSets.zh },
    localizedKeys,
  });
  writeFileSync(lockPath, formatJson(lock));

  const importManifest = readImportManifest(root, 'source-import.yaml');
  const manifest = buildManifest({ packageRoot: root, assetSet, importManifest });
  writeFileSync(path.join(root, 'spec-manifest.json'), formatJson(manifest));

  const baselinePath = path.join(root, 'reviewed-baseline.json');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  baseline.fileCount = importManifest.files.length;
  baseline.sourceFilesSha256 = hashCanonicalJson(Object.fromEntries(importManifest.files.map((file) => [file.sourcePath, file.sha256])));
  baseline.packageFilesSha256 = hashCanonicalJson(Object.fromEntries(importManifest.files.map((file) => file.packagePath).sort().map((relative) => [relative, assetSet.sha256.get(relative)])));
  writeFileSync(baselinePath, formatJson(baseline));

  return writeManifest(root);
}

/**
 * Assert that a check failed with one of the expected codes.
 *
 * A finding is named `<stage>/<check>/<ERROR_CODE>` when it comes from a check,
 * or `<stage>/<name>` for a stage-level error such as a missing archive. Both
 * shapes are matched, so a test can name the condition it cares about without
 * repeating the stage path.
 */
export function expectFailure(diagnostics, expectedCode, assert) {
  const matches = diagnostics.errors.filter((item) => item.code === expectedCode || item.code.endsWith(`/${expectedCode}`));
  if (matches.length === 0) {
    assert.fail(`expected a ${expectedCode} failure, got: ${diagnostics.errors.map((item) => item.code).join(', ') || '(no errors)'}`);
  }
  return matches[0];
}
