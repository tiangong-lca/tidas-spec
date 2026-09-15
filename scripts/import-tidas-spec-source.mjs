#!/usr/bin/env node
// Re-import the approved specification assets from their pinned source commit.
//
// This is the ONLY script in this repository that reads a source checkout, and
// it reads it through Git plumbing at the exact commit named in
// `source-import.yaml` — never from the working tree, never from whatever the
// checkout currently has checked out. Normal build, test, and package runs do
// not use it and do not need the source repository to exist.
//
//   node scripts/import-tidas-spec-source.mjs --source-repo /path/to/tidas-toolkit
//   node scripts/import-tidas-spec-source.mjs --source-repo <path> --check
//
// `--check` compares the shipped bytes against the pinned commit without writing.
// A source repository whose pinned commit is not present is a hard failure; the
// script does not fall back to a branch, a tag, or a nearby commit.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { IMPORT_MANIFEST_PATH, SpecError, fail, repoRootFromUrl, sha256Hex } from './spec/lib/core.mjs';
import { readImportManifest } from './spec/lib/package-content.mjs';

const HELP = `Usage: node scripts/import-tidas-spec-source.mjs --source-repo <dir> [options]

Options:
  --source-repo <dir>   Existing Git checkout of the source repository
  --check               Compare against the pinned commit; write nothing
  --json                Emit a JSON summary on stdout
  --help                Show this message
`;

function parse(argv) {
  const options = { sourceRepo: null, check: false, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--check') options.check = true;
    else if (token === '--json') options.json = true;
    else if (token === '--source-repo') options.sourceRepo = path.resolve(argv[++index]);
    else fail('ARGS', `unknown argument ${token}\n\n${HELP}`);
  }
  if (!options.help && options.sourceRepo === null) fail('ARGS', `--source-repo is required\n\n${HELP}`);
  return options;
}

// `maxBuffer` is raised well above the default 1 MiB: the largest reviewed
// schema is over 1 MiB, and the default silently truncates (SIGABRT/ENOBUFS)
// instead of failing loudly on the size alone.
function git(sourceRepo, args) {
  const result = spawnSync('git', ['-C', sourceRepo, ...args], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  if (result.error !== undefined) {
    fail('SOURCE_GIT', `git ${args.join(' ')} could not run in ${sourceRepo}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail('SOURCE_GIT', `git ${args.join(' ')} failed in ${sourceRepo}: ${result.stderr.toString('utf8').trim()}`);
  }
  return result.stdout;
}

function main(argv) {
  let options;
  try {
    options = parse(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const repoRoot = repoRootFromUrl(import.meta.url);
  try {
    const manifest = readImportManifest(repoRoot, IMPORT_MANIFEST_PATH);
    const verifyCommit = git(options.sourceRepo, ['rev-parse', '--verify', `${manifest.sourceCommit}^{commit}`]);
    const resolvedCommit = verifyCommit.toString('utf8').trim();
    if (resolvedCommit !== manifest.sourceCommit) {
      fail('SOURCE_COMMIT', `${options.sourceRepo}: ${manifest.sourceCommit} resolves to ${resolvedCommit}`);
    }

    const written = [];
    const unchanged = [];
    const mismatched = [];
    for (const file of manifest.files) {
      const blob = git(options.sourceRepo, ['cat-file', 'blob', `${manifest.sourceCommit}:${file.sourcePath}`]);
      const actual = sha256Hex(blob);
      if (actual !== file.sha256) {
        mismatched.push({ path: file.sourcePath, expected: file.sha256, actual });
        continue;
      }
      const destination = path.join(repoRoot, file.packagePath);
      let existing = null;
      try {
        existing = sha256Hex(readFileSync(destination));
      } catch {
        existing = null;
      }
      if (existing === actual) {
        unchanged.push(file.packagePath);
        continue;
      }
      if (options.check) {
        mismatched.push({ path: file.packagePath, expected: actual, actual: existing ?? 'missing' });
        continue;
      }
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, blob);
      written.push(file.packagePath);
    }

    const summary = {
      mode: options.check ? 'check' : 'import',
      sourceRepoId: manifest.sourceRepoId,
      sourceCommit: manifest.sourceCommit,
      files: manifest.files.length,
      written: written.length,
      unchanged: unchanged.length,
      mismatched,
      excludedSourcePaths: manifest.excludedSourcePaths,
    };
    if (options.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    else {
      process.stdout.write(`${summary.mode}: ${summary.files} file(s) from ${summary.sourceRepoId}@${summary.sourceCommit}\n`);
      process.stdout.write(`  written ${written.length}, unchanged ${unchanged.length}, mismatched ${mismatched.length}\n`);
      for (const item of mismatched) process.stderr.write(`  MISMATCH ${item.path}: expected ${item.expected}, found ${item.actual}\n`);
    }
    return mismatched.length === 0 ? 0 : 1;
  } catch (error) {
    if (error instanceof SpecError) {
      process.stderr.write(`import failed: ${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write(`import failed with an internal error: ${error.stack ?? error}\n`);
    }
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
