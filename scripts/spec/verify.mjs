#!/usr/bin/env node
// Specification candidate verifier.
//
//   node scripts/spec/verify.mjs                     # every stage
//   node scripts/spec/verify.mjs --stage identity    # a subset (repeatable)
//   node scripts/spec/verify.mjs --json              # machine-readable report
//
// Exit status: 0 when every requested stage passed, 1 when any check failed,
// 2 when the invocation itself was wrong. The report lists the failing check by
// name and message so a failure is actionable without re-running with a debugger.

import path from 'node:path';
import { ALL_STAGES, verifyCandidate } from './lib/verify.mjs';
import { SpecError, fail, repoRootFromUrl } from './lib/core.mjs';

const HELP = `Usage: node scripts/spec/verify.mjs [options]

Options:
  --root <dir>        Repository or unpacked package root (default: this repository)
  --stage <name>      Verification stage to run; repeatable.
                      One of: ${ALL_STAGES.join(', ')} (default: all)
  --archive <file>    Candidate archive to check in the archive stage
  --expect-source-commit <sha>
                      Require the candidate receipt to record this exact source
                      revision. Omit to check the artifacts without asserting
                      which revision they were built from.
  --json              Emit a JSON report on stdout
  --quiet             Suppress the per-check progress log
  --help              Show this message
`;

function parse(argv) {
  const options = { stages: [], root: null, archive: null, expectSourceCommit: undefined, json: false, quiet: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--json') options.json = true;
    else if (token === '--quiet') options.quiet = true;
    else if (token === '--root') options.root = argv[++index];
    else if (token === '--stage') options.stages.push(argv[++index]);
    else if (token === '--archive') options.archive = argv[++index];
    else if (token === '--expect-source-commit') options.expectSourceCommit = argv[++index];
    else fail('ARGS', `unknown argument ${token}\n\n${HELP}`);
  }
  if (options.root === null) delete options.root;
  for (const stage of options.stages) {
    if (!ALL_STAGES.includes(stage)) fail('ARGS', `unknown stage \`${stage}\`; expected one of ${ALL_STAGES.join(', ')}`);
  }
  if (options.stages.length === 0) options.stages = [...ALL_STAGES];
  if (options.expectSourceCommit !== undefined && !/^[0-9a-f]{40}$/.test(options.expectSourceCommit)) {
    fail('ARGS', `--expect-source-commit must be a full 40-character lowercase commit SHA, found ${JSON.stringify(options.expectSourceCommit)}`);
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

  const repoRoot = options.root === undefined ? repoRootFromUrl(import.meta.url) : path.resolve(options.root);
  const logger = options.quiet || options.json ? () => {} : (message) => process.stderr.write(`${message}\n`);

  let result;
  try {
    result = verifyCandidate({
      repoRoot,
      stages: options.stages,
      archivePath: options.archive === null ? null : path.resolve(options.archive),
      expectedSourceRevision: options.expectSourceCommit === undefined
        ? null
        : { commit: options.expectSourceCommit, treeState: 'clean', qualification: 'qualified', repository: null },
      logger,
    });
  } catch (error) {
    // A SpecError is a specification failure with a code and a message. Anything
    // else is a defect in the verifier itself; it is still reported as a failed
    // verification rather than as an unhandled crash, because a crash exit hides
    // which check was running.
    if (error instanceof SpecError) {
      process.stderr.write(`verification aborted: ${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write(`verification aborted by an internal error: ${error.stack ?? error}\n`);
    }
    return 1;
  }

  const report = {
    schema: 'tidas-spec.verification.v1',
    root: repoRoot,
    stages: options.stages,
    ok: result.diagnostics.ok,
    errorCount: result.diagnostics.errors.length,
    warningCount: result.diagnostics.warnings.length,
    findings: result.diagnostics.items,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const finding of result.diagnostics.items) {
      const mark = finding.severity === 'error' ? 'FAIL' : finding.severity === 'warning' ? 'WARN' : ' ok ';
      process.stderr.write(`[${mark}] ${finding.code}: ${finding.message}\n`);
    }
    process.stderr.write(result.diagnostics.ok ? '\ntidas-spec verification: PASS\n' : `\ntidas-spec verification: FAIL (${result.diagnostics.errors.length} error(s))\n`);
  }
  return result.diagnostics.ok ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
