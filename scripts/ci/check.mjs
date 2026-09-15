#!/usr/bin/env node
// The repository's single local and CI check.
//
//   pnpm run check
//
// It runs, in order:
//   1. the candidate build, so the manifest and archive are current;
//   2. full candidate verification, including the archive stages;
//   3. the unit, conformance, and integration test suites.
//
// Steps 1 and 2 read only this repository's checked-in assets. Nothing here
// publishes, uploads, or contacts a registry.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRootFromUrl } from '../spec/lib/core.mjs';

const repoRoot = repoRootFromUrl(import.meta.url);

const steps = [
  // The toolchain the candidate was qualified against, checked before anything
  // else runs. A mismatch means the results below describe a different build
  // toolchain than the one the artifacts were produced by.
  { name: 'require pinned toolchain', command: process.execPath, args: [path.join(repoRoot, 'scripts/ci/require-toolchain.mjs')] },
  // Drift check first: the committed manifest and archive must be what the
  // current content produces. Without this, the build step below would silently
  // regenerate stale committed output and the run would pass on freshly computed
  // artifacts rather than on the reviewed ones.
  { name: 'check committed build output', command: process.execPath, args: [path.join(repoRoot, 'scripts/spec/build.mjs'), '--check'] },
  { name: 'build candidate', command: process.execPath, args: [path.join(repoRoot, 'scripts/spec/build.mjs')] },
  { name: 'verify candidate', command: process.execPath, args: [path.join(repoRoot, 'scripts/spec/verify.mjs')] },
  { name: 'unit tests', command: process.execPath, args: ['--test', 'test/unit/**/*.test.mjs'] },
  { name: 'conformance tests', command: process.execPath, args: ['--test', 'test/conformance/**/*.test.mjs'] },
  { name: 'integration tests', command: process.execPath, args: ['--test', 'test/integration/**/*.test.mjs'] },
];

const results = [];
for (const step of steps) {
  process.stdout.write(`\n=== ${step.name} ===\n`);
  const result = spawnSync(step.command, step.args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error !== undefined) {
    process.stderr.write(`${step.name} could not run: ${result.error.message}\n`);
    results.push({ name: step.name, status: 127 });
    continue;
  }
  results.push({ name: step.name, status: result.status ?? 1 });
  if (result.status !== 0) {
    process.stderr.write(`\n${step.name} failed with status ${result.status}; stopping.\n`);
    break;
  }
}

process.stdout.write('\n=== summary ===\n');
for (const result of results) {
  process.stdout.write(`${result.status === 0 ? 'PASS' : 'FAIL'}  ${result.name}\n`);
}
const failed = results.filter((result) => result.status !== 0);
if (failed.length > 0) {
  process.stdout.write(`\ncheck FAILED (${failed.length} step(s))\n`);
  process.exitCode = 1;
} else {
  const binding = path.join(repoRoot, 'build/candidate-archive-binding.json');
  if (existsSync(binding)) {
    const record = JSON.parse(readFileSync(binding, 'utf8'));
    process.stdout.write(`\narchive  ${record.archiveFile}\nsha256   ${record.archiveSha256}\nassets   ${record.assetFilesSha256} (${record.assetFileCount} files)\n`);
    process.stdout.write(`imported ${record.importedAssetFileCount} tools asset(s); packaged ${record.packagedFileCount} file(s)\n`);
    process.stdout.write(`source   ${record.sourceRevision === null ? 'draft (no source revision claimed)' : `qualified @ ${record.sourceRevision.commit}`}\n`);
    if (record.buildRuntime !== undefined) {
      process.stdout.write(`built by node ${record.buildRuntime.node} (zlib ${record.buildRuntime.zlib})\n`);
    }
  }
  process.stdout.write('\ncheck PASSED\n');
}
