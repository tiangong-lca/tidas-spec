import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';
import { checkNpmRelease } from '../../scripts/ci/check-npm-release.mjs';

const archive = Buffer.from('exact reviewed tarball');
const digest = createHash('sha256').update(archive).digest('hex');
const metadataUrl = 'https://registry.npmjs.org/%40tiangong-lca%2Ftidas-spec/0.2.0';
const tarballUrl = 'https://registry.npmjs.org/@tiangong-lca/tidas-spec/-/tidas-spec-0.2.0.tgz';

function fakeFetch(metadata, tarball = archive) {
  return async (url) => {
    if (url === metadataUrl) return metadata === null ? new Response(null, { status: 404 }) : Response.json(metadata);
    if (url === tarballUrl) return new Response(tarball);
    throw new Error(`unexpected URL ${url}`);
  };
}

test('missing npm version may be published', async () => {
  assert.deepEqual(await checkNpmRelease('0.2.0', digest, fakeFetch(null)), { state: 'missing' });
});

test('exact npm version is a verified replay', async () => {
  const metadata = { name: '@tiangong-lca/tidas-spec', version: '0.2.0', dist: { tarball: tarballUrl } };
  assert.deepEqual(await checkNpmRelease('0.2.0', digest, fakeFetch(metadata)), { state: 'verified', sha256: digest });
});

test('same version with different archive fails closed', async () => {
  const metadata = { name: '@tiangong-lca/tidas-spec', version: '0.2.0', dist: { tarball: tarballUrl } };
  await assert.rejects(checkNpmRelease('0.2.0', digest, fakeFetch(metadata, Buffer.from('different'))), /digest conflict/u);
});

test('metadata identity, URL, and HTTP errors never mean missing', async () => {
  await assert.rejects(checkNpmRelease('0.2.0', digest, fakeFetch({ name: 'other', version: '0.2.0' })), /identity mismatch/u);
  await assert.rejects(checkNpmRelease('0.2.0', digest, fakeFetch({ name: '@tiangong-lca/tidas-spec', version: '0.2.0', dist: { tarball: 'https://example.com/file.tgz' } })), /outside the public registry/u);
  await assert.rejects(checkNpmRelease('0.2.0', digest, async () => new Response(null, { status: 503 })), /HTTP 503/u);
});

test('workflow verifies both channels before SDK notification', async () => {
  const workflow = YAML.parse(await readFile(new URL('../../.github/workflows/publish-spec-release.yml', import.meta.url), 'utf8'));
  const steps = workflow.jobs.publish.steps;
  const names = steps.map((step) => step.name);
  const credentials = names.indexOf('Verify publication credentials before any release write');
  const npm = names.indexOf('Publish or verify exact npm archive');
  const github = names.indexOf('Create or verify immutable GitHub release');
  const sdk = names.indexOf('Dispatch exact SDK candidate request after both channels match');
  assert.ok(credentials > names.indexOf('Verify the candidate before any release write'));
  assert.ok(credentials < npm && npm < github && github < sdk);
  assert.match(steps[npm].run, /npm publish "release\/\$ARCHIVE_FILE" --access public --ignore-scripts/u);
  assert.match(steps[npm].run, /check-npm-release\.mjs "\$VERSION" "\$ARCHIVE_SHA256"/u);
  assert.match(steps[sdk].run, /tidas-sdks\/dispatches/u);
});
