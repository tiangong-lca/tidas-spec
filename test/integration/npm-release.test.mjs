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
  const workflowSource = await readFile(new URL('../../.github/workflows/publish-spec-release.yml', import.meta.url), 'utf8');
  const workflow = YAML.parse(workflowSource);
  const steps = workflow.jobs.publish.steps;
  const names = steps.map((step) => step.name);
  const credentials = names.indexOf('Verify publication identity and SDK credential before any release write');
  const npm = names.indexOf('Publish or verify exact npm archive');
  const github = names.indexOf('Create or verify immutable GitHub release');
  const sdk = names.indexOf('Dispatch exact SDK candidate request after both channels match');
  assert.equal(workflow.permissions['id-token'], 'write');
  assert.equal(workflow.permissions.contents, 'write');
  assert.equal(workflow.jobs.publish['runs-on'], 'ubuntu-24.04');
  assert.doesNotMatch(workflowSource, /NPM_TOKEN|NODE_AUTH_TOKEN|secrets\.NPM_TOKEN/u);
  assert.doesNotMatch(steps.find((step) => step.name === 'Set up Node.js').with['registry-url'] ?? '', /npmjs/u);
  assert.ok(credentials > names.indexOf('Verify the candidate before any release write'));
  assert.ok(credentials < npm && npm < github && github < sdk);
  assert.match(steps[credentials].run, /ACTIONS_ID_TOKEN_REQUEST_URL/u);
  assert.match(steps[credentials].run, /ACTIONS_ID_TOKEN_REQUEST_TOKEN/u);
  assert.match(steps[credentials].run, /TIDAS_SDK_AUTOMATION_TOKEN is not configured/u);
  assert.match(steps.find((step) => step.name === 'Verify the candidate before any release write').run, /GITHUB_SHA.*SOURCE_COMMIT/u);
  assert.match(steps[npm].run, /npm publish "\.\/release\/\$ARCHIVE_FILE" --access public --provenance --ignore-scripts --registry https:\/\/registry\.npmjs\.org\//u);
  assert.match(steps[npm].run, /check-npm-release\.mjs "\$VERSION" "\$ARCHIVE_SHA256"/u);
  assert.match(steps[sdk].run, /tidas-sdks\/dispatches/u);
});

test('workflow preflight checks identity and credentials without release writes', async () => {
  const workflowSource = await readFile(new URL('../../.github/workflows/publish-spec-release.yml', import.meta.url), 'utf8');
  const workflow = YAML.parse(workflowSource);
  const steps = workflow.jobs.publish.steps;
  const choices = workflow.on.workflow_dispatch.inputs.publish_approval.options;
  assert.deepEqual(choices, ['blocked', 'preflight', 'publish']);
  assert.equal(workflow.on.workflow_dispatch.inputs.publish_approval.default, 'blocked');
  assert.match(steps[0].run, /preflight/u);
  const credentialIndex = steps.findIndex((step) => step.name === 'Verify publication identity and SDK credential before any release write');
  assert.ok(credentialIndex > 0);
  for (const step of steps.slice(credentialIndex + 1)) {
    assert.equal(step.if, "inputs.publish_approval == 'publish'", `${step.name} must be skipped in preflight`);
  }
});
