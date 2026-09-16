#!/usr/bin/env node

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const PACKAGE = '@tiangong-lca/tidas-spec';

function fail(message) {
  throw new Error(`[release-contract] ${message}`);
}

function requiredString(value, name, pattern = null) {
  if (typeof value !== 'string' || value.length === 0) fail(`${name} is required`);
  if (pattern && !pattern.test(value)) fail(`${name} has an invalid format`);
  return value;
}

export function validateIdentity(input) {
  const version = requiredString(input.version, 'version', VERSION);
  const sourceCommit = requiredString(input.sourceCommit, 'sourceCommit', COMMIT);
  const archiveSha256 = requiredString(input.archiveSha256, 'archiveSha256', SHA256);
  const manifestSha256 = requiredString(input.manifestSha256, 'manifestSha256', SHA256);
  const archiveFile = requiredString(input.archiveFile, 'archiveFile');
  if (archiveFile !== `${PACKAGE.replaceAll('@', '').replaceAll('/', '-')}-${version}.tgz`) {
    fail(`archiveFile must be the canonical package archive for ${version}`);
  }
  if (archiveFile.includes('/') || archiveFile.includes('\\') || archiveFile.includes('..')) fail('archiveFile must be a basename');
  const archiveUrl = requiredString(input.archiveUrl, 'archiveUrl');
  if (!archiveUrl.startsWith(`https://github.com/tiangong-lca/tidas-spec/releases/download/v${version}/`)) {
    fail('archiveUrl must point to the immutable GitHub release asset for version');
  }
  if (!archiveUrl.endsWith(`/${archiveFile}`)) fail('archiveUrl must name archiveFile');
  return {
    package: PACKAGE,
    version,
    tag: `v${version}`,
    sourceCommit,
    archiveFile,
    archiveSha256,
    manifestSha256,
    archiveUrl,
  };
}

export function dispatchPayload(input) {
  const identity = validateIdentity(input);
  const packages = input.packages ?? ['typescript', 'python'];
  if (!Array.isArray(packages) || packages.length === 0 || packages.some((name) => !['typescript', 'python'].includes(name))) {
    fail('packages must contain only typescript and/or python');
  }
  const typescriptBump = input.typescriptBump ?? 'patch';
  const pythonBump = input.pythonBump ?? 'patch';
  for (const [name, bump] of [['typescriptBump', typescriptBump], ['pythonBump', pythonBump]]) {
    if (!['patch', 'minor', 'major'].includes(bump)) fail(`${name} must be patch, minor, or major`);
  }
  const eventKey = `${identity.package}@${identity.version}:${identity.archiveSha256}:${identity.manifestSha256}`;
  return {
    event_type: 'tidas_spec_released',
    client_payload: {
      event_key: eventKey,
      package: identity.package,
      version: identity.version,
      source_commit: identity.sourceCommit,
      archive_file: identity.archiveFile,
      archive_url: identity.archiveUrl,
      archive_sha256: identity.archiveSha256,
      manifest_sha256: identity.manifestSha256,
      packages,
      typescript_bump: typescriptBump,
      python_bump: pythonBump,
      reason: input.reason ?? `published ${identity.package}@${identity.version}`,
    },
  };
}

export function sameIdentity(left, right) {
  return left.package === right.package
    && left.version === right.version
    && left.sourceCommit === right.sourceCommit
    && left.archiveSha256 === right.archiveSha256
    && left.manifestSha256 === right.manifestSha256;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  try {
    const input = JSON.parse(process.argv[2] ?? '{}');
    process.stdout.write(`${JSON.stringify(dispatchPayload(input), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
