import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchPayload, sameIdentity, validateIdentity } from '../../scripts/ci/release-contract.mjs';

const base = {
  version: '0.2.0',
  sourceCommit: '41e078b63336a31cd8c4bcab748afeb09c19c1e7',
  archiveFile: 'tiangong-lca-tidas-spec-0.2.0.tgz',
  archiveSha256: '638d4d72c16fab8314ee2a4805c14a0d396c331e17780a0a7f09c7b6772b9d75',
  manifestSha256: 'fe82b77411e2a134469b206367556a52bf6be80419fcbc0749a2439dc785631b',
  archiveUrl: 'https://github.com/tiangong-lca/tidas-spec/releases/download/v0.2.0/tiangong-lca-tidas-spec-0.2.0.tgz',
};

test('release identity rejects incomplete or mutable inputs', () => {
  assert.throws(() => validateIdentity({ ...base, archiveSha256: '0'.repeat(63) }), /archiveSha256/u);
  assert.throws(() => validateIdentity({ ...base, archiveUrl: 'https://example.invalid/spec.tgz' }), /archiveUrl/u);
  assert.throws(() => validateIdentity({ ...base, archiveFile: '../spec.tgz' }), /archiveFile/u);
  assert.throws(() => dispatchPayload({ ...base, packages: ['rust'] }), /packages/u);
  assert.throws(() => dispatchPayload({ ...base, pythonBump: 'none' }), /pythonBump/u);
});

test('release notification has a stable idempotency key and exact digests', () => {
  const first = dispatchPayload({ ...base, packages: ['typescript'], typescriptBump: 'minor', reason: 'schema-only' });
  const second = dispatchPayload({ ...base, packages: ['typescript'], typescriptBump: 'minor', reason: 'replay' });
  assert.deepEqual(first.client_payload, { ...second.client_payload, reason: 'schema-only' });
  assert.equal(first.event_type, 'tidas_spec_released');
  assert.match(first.client_payload.event_key, /@0\.2\.0:638d4d72.*:fe82b774/u);
  assert.equal(first.client_payload.archive_sha256, base.archiveSha256);
  assert.equal(first.client_payload.manifest_sha256, base.manifestSha256);
});

test('conflicting content is never the same release identity', () => {
  const identity = validateIdentity(base);
  assert.equal(sameIdentity(identity, validateIdentity(base)), true);
  assert.equal(sameIdentity(identity, validateIdentity({ ...base, manifestSha256: 'f'.repeat(64) })), false);
});
