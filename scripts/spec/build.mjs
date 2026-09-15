#!/usr/bin/env node
// Build the specification candidate: manifest, archive, archive binding.
//
//   node scripts/spec/build.mjs                    # build from this repository
//   node scripts/spec/build.mjs --release-commit <sha>
//   node scripts/spec/build.mjs --check            # verify without writing
//
// The build reads only this repository's checked-in assets. It never reads
// tidas-toolkit, tidas-sdks, or tidas, and it needs no network access.

import path from 'node:path';
import { buildCandidate, checkCandidate, resolveSourceRevision } from './lib/build.mjs';
import { loadAssetSet } from './lib/inventory.mjs';
import { SpecError, fail, repoRootFromUrl } from './lib/core.mjs';

const HELP = `Usage: node scripts/spec/build.mjs [options]

Options:
  --root <dir>              Repository root (default: this repository)
  --qualify                 Build a qualified candidate: validate that HEAD is
                            the source revision and that the tree is clean and
                            matches the packaged bytes. Without this flag the
                            build produces a draft that claims no revision.
  --check                   Recompute and compare, write nothing
  --json                    Emit a JSON summary on stdout
  --help                    Show this message
`;

function parse(argv) {
  const options = { root: undefined, qualify: false, check: false, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--check') options.check = true;
    else if (token === '--json') options.json = true;
    else if (token === '--root') options.root = path.resolve(argv[++index]);
    else if (token === '--qualify') options.qualify = true;
    else fail('ARGS', `unknown argument ${token}\n\n${HELP}`);
  }
  return options;
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
  const repoRoot = options.root ?? repoRootFromUrl(import.meta.url);

  try {
    // `--qualify` re-reads and re-validates the repository. Without it the build
    // preserves whatever the committed manifest already claims, so a maintainer's
    // routine rebuild cannot silently downgrade a qualified candidate to a draft.
    const sourceRevision = options.qualify ? resolveSourceRevision(repoRoot, loadAssetSet(repoRoot), { qualify: true }) : null;
    if (options.check) {
      const summary = checkCandidate(repoRoot, { sourceRevision });
      const report = {
        mode: 'check',
        manifestSha256: summary.manifestSha256,
        archive: summary.archive,
        archiveSha256: summary.archiveSha256,
        files: summary.files,
        wrote: false,
        // The report must say which comparison actually ran. A byte comparison
        // and a content comparison are different strengths of claim, and a caller
        // that only sees "passed" cannot tell them apart.
        archiveComparison: summary.byteEqualityAsserted ? 'byte-equality' : 'content-equality',
        byteEqualityAsserted: summary.byteEqualityAsserted,
        notes: summary.notes,
      };
      if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else {
        process.stdout.write(`manifest  ${summary.manifestSha256}\n`);
        process.stdout.write(`archive   ${summary.archive}  ${summary.archiveSha256}\n`);
        process.stdout.write(`assets    ${summary.files} files\n`);
        process.stdout.write(`compared  ${report.archiveComparison}\n`);
        for (const note of report.notes) process.stdout.write(`note      ${note}\n`);
        process.stdout.write('committed build output matches the current content; nothing written\n');
      }
      return 0;
    }
    const result = buildCandidate(repoRoot, { sourceRevision });
    const summary = {
      mode: 'build',
      manifestSha256: result.manifestSha256,
      archive: path.relative(repoRoot, result.archivePath),
      archiveSha256: result.archiveSha256,
      assetFilesSha256: result.manifest.aggregates.filesSha256,
      files: result.manifest.files.length,
      qualification: result.sourceRevision.qualification,
      sourceCommit: result.sourceRevision.commit,
    };
    if (options.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    else {
      process.stdout.write(`manifest  ${summary.manifestSha256}\n`);
      process.stdout.write(`archive   ${summary.archive}  ${summary.archiveSha256}\n`);
      process.stdout.write(`assets    ${summary.assetFilesSha256}  (${summary.files} files)\n`);
      process.stdout.write(`state     ${summary.qualification}${summary.sourceCommit === null ? ' (no source revision claimed)' : ` @ ${summary.sourceCommit}`}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof SpecError) {
      process.stderr.write(`build failed: ${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write(`build failed with an internal error: ${error.stack ?? error}\n`);
    }
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
