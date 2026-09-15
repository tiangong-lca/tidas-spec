#!/usr/bin/env node
// Refuse to build under a toolchain the candidate was not qualified against.
//
// The archive's bytes come from the platform zlib, and the manifest is only
// meaningful for the pnpm version that produced the lockfile, so both versions
// are pinned exactly in `toolchain.json`. That file is excluded by the package
// `files` whitelist, so declaring versions there cannot change either publication
// channel's bytes.
//
// This script checks the *running* tools against that pin, so a clean CI checkout
// cannot silently proceed under whatever versions the runner happened to ship.
// Nothing else enforces the pnpm pin: pnpm does not read `packageManager` from
// `.npmrc`, and `engines.pnpm` is advisory only.
//
//   node scripts/ci/require-toolchain.mjs
//
// Exit 0 when both match; exit 1 with the mismatch named when either does not.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRootFromUrl } from '../spec/lib/core.mjs';

const repoRoot = repoRootFromUrl(import.meta.url);

/**
 * The pinned toolchain, from one non-published source of truth.
 *
 * `toolchain.json` is excluded by the package `files` whitelist, so declaring the
 * versions there cannot change either publication channel's bytes. CI reads the
 * same file, so the provisioning step and this check cannot drift apart.
 */
function readToolchain() {
  const declared = JSON.parse(readFileSync(path.join(repoRoot, 'toolchain.json'), 'utf8'));
  return { node: declared.node, pnpm: declared.pnpm };
}

function pnpmVersion() {
  try {
    return execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim();
  } catch (error) {
    return `<unavailable: ${error.message}>`;
  }
}

const declared = readToolchain();
const expectedNode = declared.node;
const expectedPnpm = declared.pnpm;

const actualNode = process.version.replace(/^v/, '');
const actualPnpm = pnpmVersion();

const problems = [];
if (actualNode !== expectedNode) problems.push(`node ${actualNode} (required ${expectedNode})`);
if (actualPnpm !== expectedPnpm) problems.push(`pnpm ${actualPnpm} (required ${expectedPnpm})`);

if (problems.length > 0) {
  process.stderr.write(`toolchain mismatch: ${problems.join('; ')}\n`);
  process.stderr.write(`Run \`corepack enable && corepack prepare pnpm@${expectedPnpm} --activate\`, then use \`corepack pnpm\` with Node ${expectedNode}.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`toolchain ok: node ${actualNode}, pnpm ${actualPnpm}\n`);
}
