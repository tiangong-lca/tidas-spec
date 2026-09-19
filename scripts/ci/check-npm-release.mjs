#!/usr/bin/env node

import { createHash } from 'node:crypto';

const PACKAGE = '@tiangong-lca/tidas-spec';
const REGISTRY = 'https://registry.npmjs.org';
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export async function checkNpmRelease(version, expectedSha256, fetcher = fetch) {
  if (!VERSION.test(version)) throw new Error('invalid version');
  if (!SHA256.test(expectedSha256)) throw new Error('invalid archive SHA-256');
  const metadataUrl = `${REGISTRY}/${encodeURIComponent(PACKAGE)}/${encodeURIComponent(version)}`;
  const metadataResponse = await fetcher(metadataUrl, { redirect: 'error' });
  if (metadataResponse.status === 404) return { state: 'missing' };
  if (!metadataResponse.ok) throw new Error(`npm metadata request failed: HTTP ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  if (metadata.name !== PACKAGE || metadata.version !== version) throw new Error('npm package identity mismatch');
  const tarballUrl = metadata.dist?.tarball;
  if (typeof tarballUrl !== 'string') throw new Error('npm tarball URL missing');
  const parsed = new URL(tarballUrl);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'registry.npmjs.org') {
    throw new Error('npm tarball URL is outside the public registry');
  }
  const tarballResponse = await fetcher(tarballUrl, { redirect: 'error' });
  if (!tarballResponse.ok) throw new Error(`npm tarball request failed: HTTP ${tarballResponse.status}`);
  const bytes = Buffer.from(await tarballResponse.arrayBuffer());
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) throw new Error(`npm archive digest conflict: ${actualSha256}`);
  return { state: 'verified', sha256: actualSha256 };
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  try {
    const result = await checkNpmRelease(process.argv[2], process.argv[3]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.state === 'missing') process.exitCode = 3;
  } catch (error) {
    process.stderr.write(`[check-npm-release] ${error.message}\n`);
    process.exitCode = 1;
  }
}
