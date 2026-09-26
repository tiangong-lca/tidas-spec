// Adversarial conformance tests for the specification verifier.
//
// Every case constructs a candidate that is wrong in one specific way and
// asserts the verifier rejects it for that reason. Each group is paired with a
// positive control, so a verifier that simply rejected everything would fail
// here too.
//
// Two fixture rules keep each case aimed at one condition:
//   * `mutatedFixture` recomputes the derived artifacts (lock, manifest) after
//     the mutation, so the case reaches the content check it targets instead of
//     tripping over stale derived data first.
//   * Cases that are explicitly about a derived artifact mutate it and do not
//     rebuild, because the derived artifact is the subject.
//
// Nothing here writes to the repository: every mutation happens in a temporary
// copy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { verifyCandidate } from '../../scripts/spec/lib/verify.mjs';
import { canonicalJson, formatJson, sha256Hex } from '../../scripts/spec/lib/core.mjs';
import {
  REPO_ROOT,
  cleanupTempRoots,
  expectFailure,
  makeFixtureRoot,
  mutateFixtureText,
  readFixtureJson,
  rebuildDerivedArtifacts,
  verifyInProcess,
  writeFixtureJson,
} from '../helpers/fixture.mjs';

const IDENTITY = ['identity', 'manifest', 'package'];
const MANIFEST_ONLY = ['manifest'];
const LOCK_PATH = 'assets/tidas/schema.lock.json';
const MANIFEST_PATH = 'spec-manifest.json';
const BINDING_PATH = 'build/candidate-archive-binding.json';
const IMPORT_MANIFEST = 'source-import.yaml';
const EN_FLOWS = 'assets/tidas/schemas/tidas_flows.json';
const ZH_FLOWS = 'assets/tidas/schemas_zh/tidas_flows.json';
const EN_CONTACTS = 'assets/tidas/schemas/tidas_contacts.json';
const ZH_CONTACTS = 'assets/tidas/schemas_zh/tidas_contacts.json';
const EN_CATEGORY = 'assets/tidas/schemas/tidas_flows_elementary_category.json';
const PUBLIC_RULES = 'assets/tidas/rules/public-rules.v1.json';



test.after(cleanupTempRoots);

/**
 * Build a fixture, apply a mutation, and refresh derived artifacts.
 *
 * Some mutations (a deleted file, malformed JSON) make the tree unbuildable by
 * design; the rebuild is therefore best-effort. The case under test is the
 * verifier's rejection, not the fixture builder's success.
 */
async function mutatedFixture(mutate) {
  const root = makeFixtureRoot();
  await mutate(root);
  try {
    await rebuildDerivedArtifacts(root);
  } catch {
    // The mutation made the tree unbuildable, which is itself a valid state for
    // an adversarial case; the verifier must still reject it.
  }
  return root;
}

function codesOf(diagnostics) {
  return diagnostics.errors.map((item) => item.code);
}

function assertAnyCode(diagnostics, fragments, message) {
  const codes = codesOf(diagnostics);
  assert.ok(codes.some((code) => fragments.some((fragment) => code.includes(fragment))), `${message}; got ${codes.join(', ') || '(no errors)'}`);
}

// ---------------------------------------------------------------------------
// positive controls
// ---------------------------------------------------------------------------

test('positive control: the unmodified fixture verifies', async () => {
  const root = makeFixtureRoot();
  const result = await verifyInProcess(root, IDENTITY);
  assert.equal(result.diagnostics.ok, true, `unexpected failures: ${JSON.stringify(result.diagnostics.errors, null, 2)}`);
});

test('positive control: the real repository verifies end to end', async () => {
  const result = verifyCandidate({ repoRoot: REPO_ROOT, stages: IDENTITY });
  assert.equal(result.diagnostics.ok, true, `repository verification failed: ${JSON.stringify(result.diagnostics.errors, null, 2)}`);
});

test('positive control: reformatting a schema is rejected even when every derived artifact is rebuilt', async () => {
  // Whitespace changes preserve meaning, so the lock and manifest can be
  // regenerated consistently. The import manifest is what pins the shipped bytes
  // to the reviewed source bytes, and that is what must fail.
  const root = await mutatedFixture((target) => {
    mutateFixtureText(target, EN_FLOWS, (text) => text.replace(/\n {2}/, '\n    '));
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'SOURCE_BYTES', assert);
});

// ---------------------------------------------------------------------------
// file set
// ---------------------------------------------------------------------------

test('rejects an extra file in the schema directory', async () => {
  const root = await mutatedFixture((target) => {
    writeFileSync(path.join(target, 'assets/tidas/schemas/tidas_extra.json'), formatJson({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' }));
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'ASSET_UNEXPECTED', assert);
});

test('rejects a hidden file under the asset root', async () => {
  const root = await mutatedFixture((target) => {
    writeFileSync(path.join(target, 'assets/tidas/.DS_Store'), 'not part of the reviewed set');
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'ASSET_UNEXPECTED', assert);
});

test('rejects a missing schema file', async () => {
  const root = await mutatedFixture((target) => {
    rmSync(path.join(target, EN_FLOWS));
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'ASSET_MISSING', assert);
});

test('rejects a missing methodology file', async () => {
  const root = await mutatedFixture((target) => {
    rmSync(path.join(target, 'assets/tidas/methodologies/tidas_flows.yaml'));
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'ASSET_MISSING', assert);
});

test('rejects a public rule without a negative case', async () => {
  const root = await mutatedFixture((target) => {
    const index = readFixtureJson(target, PUBLIC_RULES);
    index.rules[0].cases.negative = [];
    writeFixtureJson(target, PUBLIC_RULES, index);
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'PUBLIC_RULE_SCHEMA', assert);
});

test('rejects product execution policy in the public rule index', async () => {
  const root = await mutatedFixture((target) => {
    const index = readFixtureJson(target, PUBLIC_RULES);
    index.rules[0].severity = 'blocker';
    writeFixtureJson(target, PUBLIC_RULES, index);
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'PUBLIC_RULE_SCHEMA', assert);
});

test('rejects a public rule whose methodology source does not resolve', async () => {
  const root = await mutatedFixture((target) => {
    const index = readFixtureJson(target, PUBLIC_RULES);
    index.rules[0].source_refs[0].path = 'flowDataSet.missing.<rules>';
    writeFixtureJson(target, PUBLIC_RULES, index);
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'PUBLIC_RULE_SOURCE', assert);
});

test('rejects a schema file smuggled in through a symlink', async () => {
  const root = makeFixtureRoot();
  const target = path.join(root, EN_CONTACTS);
  rmSync(target);
  // A symlink would let the shipped tree depend on a file outside the package.
  writeFileSync(path.join(root, 'outside.json'), readFileSync(path.join(root, ZH_CONTACTS)));
  symlinkSync(path.join(root, 'outside.json'), target);
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'FILE_SYMLINK', assert);
});

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

test('rejects malformed JSON in a schema', async () => {
  const root = await mutatedFixture((target) => {
    mutateFixtureText(target, EN_CONTACTS, (text) => `${text.slice(0, 40)}{ this is not json`);
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'JSON_PARSE', assert);
});

test('rejects a duplicate JSON object key', async () => {
  const root = await mutatedFixture((target) => {
    // JSON.parse silently keeps the last duplicate; the verifier must not.
    mutateFixtureText(target, EN_CONTACTS, (text) => text.replace('"$schema":', '"$schema": "http://json-schema.org/draft-07/schema#",\n  "$schema":'));
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'JSON_DUPLICATE_KEY', assert);
});

test('rejects a UTF-8 BOM in a shipped file', async () => {
  const root = await mutatedFixture((target) => {
    const file = path.join(target, EN_CONTACTS);
    writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(file)]));
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'UTF8_BOM', assert);
});

test('rejects malformed YAML in a methodology file', async () => {
  const root = await mutatedFixture((target) => {
    mutateFixtureText(target, 'assets/tidas/methodologies/tidas_flows.yaml', (text) => `${text}\n  bad-indent: [unclosed\n`);
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'YAML_PARSE', assert);
});

test('rejects duplicate keys in a methodology file', async () => {
  const root = await mutatedFixture((target) => {
    mutateFixtureText(target, 'assets/tidas/methodologies/tidas_flows.yaml', (text) => text.replace('metadata:\n', 'metadata:\n  version: "9.9.9"\n'));
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'YAML_PARSE', assert);
});

test('rejects a multi-document YAML methodology file', async () => {
  const root = await mutatedFixture((target) => {
    mutateFixtureText(target, 'assets/tidas/methodologies/tidas_flows.yaml', (text) => `${text}\n---\nsecond: document\n`);
  });
  const result = await verifyInProcess(root, IDENTITY);
  assertAnyCode(result.diagnostics, ['YAML_DOCUMENT_COUNT', 'YAML_PARSE'], 'expected a multi-document failure');
});

test('rejects an empty methodology document', async () => {
  const root = await mutatedFixture((target) => {
    writeFileSync(path.join(target, 'assets/tidas/methodologies/tidas_flows.yaml'), '# only a comment\n');
  });
  const result = await verifyInProcess(root, IDENTITY);
  assertAnyCode(result.diagnostics, ['YAML_DOCUMENT_COUNT', 'YAML_EMPTY', 'YAML_SHAPE'], 'expected an empty-document failure');
});

test('rejects a methodology file whose rule material was removed', async () => {
  const root = await mutatedFixture(async (target) => {
    const { parseYamlDocument } = await import('../../scripts/spec/lib/yaml.mjs');
    const { stringify } = await import('yaml');
    const original = parseYamlDocument(readFileSync(path.join(target, 'assets/tidas/methodologies/tidas_flows.yaml')), 'fixture');
    // A mapping with no rule nodes still parses; it must not pass as the
    // reviewed methodology.
    writeFileSync(
      path.join(target, 'assets/tidas/methodologies/tidas_flows.yaml'),
      stringify({ metadata: original.metadata, global_rules: {}, flowDataSet: {} }),
    );
  });
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'YAML_SHAPE', assert);
});

test('preserves the methodology status stated in the file rather than restating it', async () => {
  // The file states each rule's own status. The verifier reports what the file
  // says; it does not promote the material into a new universal blocking policy.
  const root = makeFixtureRoot();
  const result = await verifyInProcess(root, ['identity']);
  const methodology = result.state.assetSet.yaml.get('assets/tidas/methodologies/tidas_flows.yaml');
  assert.ok(methodology.global_rules.multi_language_support['<rules>'].length > 0);
  const zhRule = methodology.global_rules.multi_language_support['<rules>'].find((rule) => rule.language === 'zh');
  assert.match(zhRule.requirement, /建议/, 'the Chinese rule keeps its original advisory wording');
});

// ---------------------------------------------------------------------------
// references
// ---------------------------------------------------------------------------

function replaceFirstRef(root, relative, from, to) {
  mutateFixtureText(root, relative, (text) => {
    const pattern = new RegExp(`"\\$ref":\\s*"${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
    if (!pattern.test(text)) throw new Error(`fixture does not contain the reference ${from} in ${relative}`);
    return text.replace(pattern, `"$ref": "${to}"`);
  });
}

/** Apply the same reference rewrite to both language variants. */
async function fixtureWithRef(relativePair, from, to) {
  return mutatedFixture((target) => {
    for (const relative of relativePair) replaceFirstRef(target, relative, from, to);
  });
}

test('rejects a reference that escapes the package root', async () => {
  const root = await fixtureWithRef([EN_FLOWS, ZH_FLOWS], './tidas_flows_elementary_category.json', '../../../../outside.json');
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_ESCAPE', assert);
});

test('rejects a reference that escapes the schema sets into package metadata', async () => {
  // The reference stays inside the package directory but leaves the schema set,
  // so it must not resolve even though the target file exists and is shipped.
  const root = await fixtureWithRef([EN_FLOWS, ZH_FLOWS], './tidas_flows_elementary_category.json', '../schema.lock.json');
  const result = await verifyInProcess(root, ['identity']);
  const codes = result.diagnostics.errors.map((item) => item.code);
  assert.ok(
    codes.some((code) => code.endsWith('REF_OUTSIDE_SCHEMA_SETS') || code.endsWith('REF_MISSING_TARGET')),
    `expected a boundary failure for a reference into package metadata, got ${codes.join(', ')}`,
  );
});

test('rejects an absolute-path reference', async () => {
  const root = await fixtureWithRef([EN_FLOWS, ZH_FLOWS], './tidas_flows_elementary_category.json', '/etc/passwd');
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_ABSOLUTE', assert);
});

test('rejects a network reference', async () => {
  const root = await fixtureWithRef([EN_FLOWS, ZH_FLOWS], './tidas_flows_elementary_category.json', 'https://example.invalid/schema.json');
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_NETWORK', assert);
});

test('rejects a non-HTTP external scheme reference', async () => {
  const root = await fixtureWithRef([EN_FLOWS, ZH_FLOWS], './tidas_flows_elementary_category.json', 'file:///etc/passwd');
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_EXTERNAL_SCHEME', assert);
});

test('rejects a reference to a missing file', async () => {
  const root = await fixtureWithRef([EN_FLOWS, ZH_FLOWS], './tidas_flows_elementary_category.json', './tidas_flows_missing_category.json');
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_MISSING_TARGET', assert);
});

test('rejects a reference to a missing cross-file fragment', async () => {
  const root = await fixtureWithRef([EN_FLOWS, ZH_FLOWS], 'tidas_data_types.json#/$defs/UUID', 'tidas_data_types.json#/$defs/NoSuchType');
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_MISSING_FRAGMENT', assert);
});

test('rejects a same-document reference to a missing definition', async () => {
  const root = await mutatedFixture((target) => {
    for (const relative of ['assets/tidas/schemas/tidas_data_types.json', 'assets/tidas/schemas_zh/tidas_data_types.json']) {
      replaceFirstRef(target, relative, '#/$defs/Languages', '#/$defs/NoSuchLocalDefinition');
    }
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_MISSING_FRAGMENT', assert);
});

test('rejects a reference to an undefined anchor', async () => {
  const root = await fixtureWithRef([EN_FLOWS, ZH_FLOWS], './tidas_flows_elementary_category.json', './tidas_flows_elementary_category.json#no-such-anchor');
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_MISSING_FRAGMENT', assert);
});

test('accepts a reference through a real $id anchor declared at a schema position', async () => {
  // The anchor lives under `properties`, a schema position Draft 7 defines, so
  // the declaration is discoverable statically.
  const root = await mutatedFixture((target) => {
    for (const relative of [EN_CATEGORY, 'assets/tidas/schemas_zh/tidas_flows_elementary_category.json']) {
      const document = readFixtureJson(target, relative);
      document.properties = { ...(document.properties ?? {}), anchored: { $id: '#anchored-def', type: 'string' } };
      writeFixtureJson(target, relative, document);
    }
    replaceFirstRef(target, EN_FLOWS, './tidas_flows_elementary_category.json', './tidas_flows_elementary_category.json#anchored-def');
    replaceFirstRef(target, ZH_FLOWS, './tidas_flows_elementary_category.json', './tidas_flows_elementary_category.json#anchored-def');
  });
  const result = await verifyInProcess(root, ['identity']);
  const referenceFailures = result.diagnostics.errors.filter((item) => item.code.includes('reference-closure'));
  assert.deepEqual(referenceFailures, [], `a defined anchor must resolve: ${JSON.stringify(referenceFailures)}`);
});

test('rejects a reference to an anchor declared only in an unreached extension member', async () => {
  // The same anchor under `$defs` is data until a reference reaches it, so a
  // direct `#anchor` reference to the document does not resolve.
  const root = await mutatedFixture((target) => {
    for (const relative of [EN_CATEGORY, 'assets/tidas/schemas_zh/tidas_flows_elementary_category.json']) {
      const document = readFixtureJson(target, relative);
      document.$defs = { ...(document.$defs ?? {}), Anchored: { $id: '#anchored-def', type: 'string' } };
      writeFixtureJson(target, relative, document);
    }
    replaceFirstRef(target, EN_FLOWS, './tidas_flows_elementary_category.json', './tidas_flows_elementary_category.json#anchored-def');
    replaceFirstRef(target, ZH_FLOWS, './tidas_flows_elementary_category.json', './tidas_flows_elementary_category.json#anchored-def');
  });
  const result = await verifyInProcess(root, ['identity']);
  assertAnyCode(result.diagnostics, ['REF_MISSING_FRAGMENT'], 'an anchor declared only in unreached extension data must not resolve');
});

test('does not treat a $ref-shaped key in example data as a reference', async () => {
  // The source schemas document example payloads. A `$ref` key inside instance
  // data is data: flagging it would invent a reference the specification does
  // not make.
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.examples = [{ $ref: 'https://example.invalid/not-a-schema.json', note: 'instance data' }];
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  const referenceFailures = result.diagnostics.errors.filter((item) => item.code.includes('reference-closure'));
  assert.deepEqual(referenceFailures, [], `example data must not be walked as schema: ${JSON.stringify(referenceFailures)}`);
});

test('does not treat a $ref-shaped key in an enum or default as a schema', async () => {
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.properties['@xmlns'] = { type: 'string', enum: [{ $ref: 'https://example.invalid/nope.json' }], default: { $ref: 'not-a-file.json' } };
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  const referenceFailures = result.diagnostics.errors.filter((item) => item.code.includes('reference-closure'));
  assert.deepEqual(referenceFailures, [], `enum/default must not be walked as schema: ${JSON.stringify(referenceFailures)}`);
});

test('still resolves a reference that appears inside a nested subschema keyword', async () => {
  // The negative cases above prove the walker skips data; this proves it does
  // not skip real subschema positions while doing so.
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.allOf = [{ properties: { extra: { $ref: './tidas_data_types.json#/$defs/NoSuchType' } } }];
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_MISSING_FRAGMENT', assert);
});

test('resolves a reference inside items, additionalProperties, and not', async () => {
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.properties.extra = {
      type: 'array',
      items: [{ $ref: './tidas_data_types.json#/$defs/NoSuchItem' }],
      additionalProperties: { $ref: './tidas_data_types.json#/$defs/NoSuchAdditional' },
      not: { $ref: './tidas_data_types.json#/$defs/NoSuchNot' },
    };
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_MISSING_FRAGMENT', assert);
  const messages = result.diagnostics.errors.filter((item) => item.code.endsWith('REF_MISSING_FRAGMENT')).map((item) => item.message);
  assert.equal(messages.length, 3, `every subschema position must be walked: ${JSON.stringify(messages)}`);
});

// ---------------------------------------------------------------------------
// language equivalence
// ---------------------------------------------------------------------------

test('rejects a Chinese schema whose constraints differ', async () => {
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, ZH_CONTACTS);
    document.required = [...document.required, 'not-a-real-field'];
    writeFixtureJson(target, ZH_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'LANGUAGE_CONTRACT', assert);
});

test('rejects a language variant that is missing an entire property', async () => {
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, ZH_FLOWS);
    const firstKey = Object.keys(document.properties.flowDataSet.properties)[0];
    delete document.properties.flowDataSet.properties[firstKey];
    writeFixtureJson(target, ZH_FLOWS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'LANGUAGE_CONTRACT', assert);
});

test('rejects a language variant whose enum value differs', async () => {
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, 'assets/tidas/schemas_zh/tidas_data_types.json');
    document.$defs.Languages.enum = [...document.$defs.Languages.enum, 'xx-not-a-language'];
    writeFixtureJson(target, 'assets/tidas/schemas_zh/tidas_data_types.json', document);
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'LANGUAGE_CONTRACT', assert);
});

test('rejects a schema that declares an instance property named like a localized key', async () => {
  // Removing `description` wherever it appears is what the pinned source lock
  // does, and it is only safe while `description` is never an instance property.
  // If one appears, the comparison would silently stop covering a real
  // constraint, so the verifier has to refuse rather than keep passing.
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.properties.description = { type: 'string', minLength: 512 };
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'LOCALIZED_KEY_SHADOWING', assert);
});

test('accepts a Chinese schema that differs only in description text', async () => {
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, ZH_CONTACTS);
    document.description = '仅描述文本不同';
    writeFixtureJson(target, ZH_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  const languageFailures = result.diagnostics.errors.filter((item) => item.code.includes('language-equivalence'));
  assert.deepEqual(languageFailures, [], `description-only differences are allowed: ${JSON.stringify(languageFailures)}`);
});

test('a localized-only difference changes the content hash but not the shared contract hash', async () => {
  // This is the invariant behind "the lock represents the schema subset": the two
  // language variants carry different content hashes and one shared contract
  // hash. If a localization edit moved the contract hash, the variants would no
  // longer be equivalent and the lock would have to record a real difference.
  //
  // The assertion is structural, not end-to-end: the lock is a shipped file, so
  // editing it also invalidates the candidate against the reviewed import — which
  // is correct, and is covered by the source-bytes tests.
  const root = makeFixtureRoot();
  const { loadAssetSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const { computeSchemaLock } = await import('../../scripts/spec/lib/lock.mjs');

  const before = readFixtureJson(root, LOCK_PATH);
  const beforePair = before.translationPairs.files['tidas_contacts.json'];

  const document = readFixtureJson(root, ZH_CONTACTS);
  document.description = '本地化描述已更新';
  writeFixtureJson(root, ZH_CONTACTS, document);

  const assetSet = loadAssetSet(root);
  const recomputed = computeSchemaLock({
    schemaRoot: 'assets/tidas',
    schemaSets: { en: assetSet.schemaSets.en, zh: assetSet.schemaSets.zh },
    localizedKeys: new Set(before.allowedLocalizedKeys),
  });

  const en = recomputed.schemaSets.en.files['tidas_contacts.json'];
  const zh = recomputed.schemaSets.zh.files['tidas_contacts.json'];
  const pair = recomputed.translationPairs.files['tidas_contacts.json'];
  assert.notEqual(zh.contentSha256, beforePair.zhContentSha256, 'the edited variant content hash must move');
  assert.equal(en.contentSha256, beforePair.enContentSha256, 'the untouched variant content hash must not move');
  assert.equal(zh.contractSha256, pair.contractSha256, 'both variants share one contract hash');
  assert.equal(en.contractSha256, beforePair.contractSha256, 'a localized edit must not move the shared contract hash');
});

// ---------------------------------------------------------------------------
// lock
// ---------------------------------------------------------------------------

test('rejects a stale lock whose recorded hash no longer matches the bytes', async () => {
  const root = makeFixtureRoot();
  const lock = readFixtureJson(root, LOCK_PATH);
  lock.schemaSets.en.files['tidas_flows.json'].contentSha256 = 'a'.repeat(64);
  writeFixtureJson(root, LOCK_PATH, lock);
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'LOCK_STALE', assert);
});

test('rejects a lock that widens the allowed localized keys', async () => {
  const root = makeFixtureRoot();
  const lock = readFixtureJson(root, LOCK_PATH);
  lock.allowedLocalizedKeys = ['description', 'title', 'examples'];
  writeFixtureJson(root, LOCK_PATH, lock);
  const result = await verifyInProcess(root, ['identity']);
  assertAnyCode(result.diagnostics, ['LOCK_ALLOWANCE', 'LOCK_STALE'], 'expected the widened allowance to be rejected');
});

test('rejects a lock whose aggregate digest was edited', async () => {
  const root = makeFixtureRoot();
  const lock = readFixtureJson(root, LOCK_PATH);
  lock.schemaSets.zh.contentAggregateSha256 = 'b'.repeat(64);
  writeFixtureJson(root, LOCK_PATH, lock);
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'LOCK_STALE', assert);
});

test('rejects a lock that drops a file entry', async () => {
  const root = makeFixtureRoot();
  const lock = readFixtureJson(root, LOCK_PATH);
  delete lock.schemaSets.zh.files['tidas_flows.json'];
  writeFixtureJson(root, LOCK_PATH, lock);
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'LOCK_STALE', assert);
});

test('rejects a lock with an unsupported version', async () => {
  const root = makeFixtureRoot();
  const lock = readFixtureJson(root, LOCK_PATH);
  lock.version = 2;
  writeFixtureJson(root, LOCK_PATH, lock);
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'LOCK_VERSION', assert);
});

test('rejects a lock that is not valid JSON', async () => {
  const root = makeFixtureRoot();
  writeFileSync(path.join(root, LOCK_PATH), '{ "allowedLocalizedKeys": [');
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'JSON_PARSE', assert);
});

test('rejects a lock that is valid JSON but the wrong shape', async () => {
  const root = makeFixtureRoot();
  writeFixtureJson(root, LOCK_PATH, { version: 1, allowedLocalizedKeys: 'description' });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'LOCK_SHAPE', assert);
});

// ---------------------------------------------------------------------------
// import identity
// ---------------------------------------------------------------------------

test('rejects an import manifest that claims a different source commit', async () => {
  const root = await mutatedFixture((target) => {
    mutateFixtureText(target, IMPORT_MANIFEST, (text) => text.replace(/^sourceCommit: .*$/m, 'sourceCommit: 0000000000000000000000000000000000000000'));
  });
  const result = await verifyInProcess(root, ['identity', 'manifest']);
  // Rebuilding the manifest carries the false claim with it, so the manifest
  // alone cannot catch it. The reviewed baseline is a separate reviewed input,
  // and it is what makes the fabricated identity fail.
  assertAnyCode(result.diagnostics, ['SOURCE_IDENTITY', 'MANIFEST_STALE'], 'expected the false source identity to be rejected');
});

test('rejects an import manifest whose source commit is not a full SHA', async () => {
  const root = makeFixtureRoot();
  mutateFixtureText(root, IMPORT_MANIFEST, (text) => text.replace(/^sourceCommit: .*$/m, 'sourceCommit: 9c0d8b1'));
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'IMPORT_MANIFEST_SHAPE', assert);
});

test('rejects an import manifest with a duplicated package path', async () => {
  const root = makeFixtureRoot();
  mutateFixtureText(root, IMPORT_MANIFEST, (text) => text.replace(
    '  - sourcePath: assets/tidas/schemas/tidas_contacts.json',
    '  - sourcePath: assets/tidas/schemas/tidas_flows.json\n    packagePath: assets/tidas/schemas/tidas_contacts.json\n    sha256: f16868bcdb99b4785b03a9b36dfe103d8f3ec61a463be9274d22884e6b7d8bda\n  - sourcePath: assets/tidas/schemas/tidas_contacts.json',
  ));
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'IMPORT_MANIFEST_SHAPE', assert);
});

test('rejects an import manifest entry with a non-hex digest', async () => {
  const root = makeFixtureRoot();
  mutateFixtureText(root, IMPORT_MANIFEST, (text) => text.replace('    sha256: f16868bc', '    sha256: NOTAHASH'));
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'IMPORT_MANIFEST_SHAPE', assert);
});

test('rejects an import manifest that drops a required field', async () => {
  const root = makeFixtureRoot();
  mutateFixtureText(root, IMPORT_MANIFEST, (text) => text.replace(/^sourceLicenseNotice: .*$/m, ''));
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'IMPORT_MANIFEST_SHAPE', assert);
});

test('rejects an import manifest that declares a file the package does not ship', async () => {
  const root = await mutatedFixture((target) => {
    mutateFixtureText(target, IMPORT_MANIFEST, (text) => `${text}  - sourcePath: assets/tidas/schemas/tidas_ghost.json\n    packagePath: assets/tidas/schemas/tidas_ghost.json\n    sha256: ${'b'.repeat(64)}\n`);
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'SOURCE_BYTES', assert);
});

test('rejects an import manifest that lists a shipped file as excluded', async () => {
  const root = makeFixtureRoot();
  mutateFixtureText(root, IMPORT_MANIFEST, (text) => text.replace(
    'excludedSourcePaths:\n',
    'excludedSourcePaths:\n  - assets/tidas/schemas/tidas_flows.json\n',
  ));
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'IMPORT_MANIFEST_SHAPE', assert);
});

test('rejects silently reclassifying an imported asset as repository-authored', async () => {
  const root = await mutatedFixture((target) => {
    mutateFixtureText(target, IMPORT_MANIFEST, (text) => text.replace(
      '  - sourcePath: assets/tidas/schemas/tidas_contacts.json\n    packagePath: assets/tidas/schemas/tidas_contacts.json\n    sha256: f16868bcdb99b4785b03a9b36dfe103d8f3ec61a463be9274d22884e6b7d8bda\n',
      '',
    ));
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'SOURCE_BYTES', assert);
});

// ---------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------

test('rejects a corrupt manifest', async () => {
  const root = makeFixtureRoot();
  writeFileSync(path.join(root, MANIFEST_PATH), '{ "manifestVersion": 1, ');
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_PARSE', assert);
});

test('rejects a manifest whose recorded asset hash was edited', async () => {
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  manifest.files[0].sha256 = 'c'.repeat(64);
  writeFixtureJson(root, MANIFEST_PATH, manifest);
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_STALE', assert);
});

test('rejects a manifest whose aggregate digest was edited', async () => {
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  manifest.aggregates.filesSha256 = 'd'.repeat(64);
  writeFixtureJson(root, MANIFEST_PATH, manifest);
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_STALE', assert);
});

test('rejects a manifest that drops a shipped file', async () => {
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  manifest.files = manifest.files.filter((file) => !file.path.endsWith('tidas_flows.json'));
  writeFixtureJson(root, MANIFEST_PATH, manifest);
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_STALE', assert);
});

test('rejects a manifest that invents a shipped file', async () => {
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  manifest.files.push({ path: 'assets/tidas/schemas/tidas_invented.json', sha256: 'e'.repeat(64), contentSha256: 'e'.repeat(64), sourcePath: 'x', sourceSha256: 'e'.repeat(64) });
  writeFixtureJson(root, MANIFEST_PATH, manifest);
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_STALE', assert);
});

test('rejects a manifest carrying a competing top-level source-commit field', async () => {
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  manifest.releaseCommit = 'e'.repeat(40);
  writeFixtureJson(root, MANIFEST_PATH, manifest);
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_IDENTITY', assert);
});

test('rejects a manifest that is valid JSON but not in the canonical build format', async () => {
  const root = makeFixtureRoot();
  writeFileSync(path.join(root, MANIFEST_PATH), JSON.stringify(readFixtureJson(root, MANIFEST_PATH)));
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_FORMAT', assert);
});

test('rejects a missing manifest', async () => {
  const root = makeFixtureRoot();
  rmSync(path.join(root, MANIFEST_PATH));
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_MISSING', assert);
});

test('rejects a manifest that misstates the reviewed source identity', async () => {
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  manifest.source.commit = 'f'.repeat(40);
  writeFixtureJson(root, MANIFEST_PATH, manifest);
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_STALE', assert);
});

test('rejects a manifest that loses the source license record', async () => {
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  manifest.source.license.notice = 'MIT';
  writeFixtureJson(root, MANIFEST_PATH, manifest);
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_STALE', assert);
});

test('the manifest records the imported source identity and no revision claim', async () => {
  // Two different origins, and neither is the package's own revision: the source
  // record names the tools commit the assets came from, and the reviewed package
  // revision lives in the receipt rather than in any artifact it describes.
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  assert.equal(manifest.source.commit, '9c0d8b1c8ceb1841074f5bc6de5fbb7fcc9318f5');
  assert.equal(manifest.source.repositoryId, 'tidas-toolkit');
  assert.equal(manifest.source.ownedMetadataOrigin, 'tidas-spec');
  assert.ok(!('reviewedPackageSource' in manifest), 'the manifest must carry no revision claim');
  assert.ok(!('releaseCommit' in manifest), 'there must be no competing top-level source-commit field');
});

test('the receipt records the reviewed source revision, not the manifest', async () => {
  const { root, built } = await archiveFixture();
  const receipt = readFixtureJson(root, BINDING_PATH);
  assert.equal(receipt.qualification, 'draft');
  assert.equal(receipt.sourceRevision, null);
  assert.equal(receipt.manifestSha256, sha256Hex(readFileSync(path.join(root, MANIFEST_PATH))));
  assert.equal(receipt.archiveSha256, sha256Hex(readFileSync(built.archivePath)));
});

test('a manifest carrying any source-revision claim is rejected', async () => {
  // The manifest is a pure function of the shipped content. A revision claim
  // inside it could never be committed — the commit would depend on the manifest
  // and the manifest on the commit — so the claim lives in the receipt instead.
  for (const claim of [
    { reviewedPackageSource: { commit: 'a'.repeat(40), treeState: 'clean', qualification: 'qualified' } },
    { reviewedPackageSource: { commit: null, qualification: 'draft' } },
    { releaseCommit: 'a'.repeat(40), reviewedPackageSource: undefined },
  ]) {
    const root = makeFixtureRoot();
    const manifest = readFixtureJson(root, MANIFEST_PATH);
    for (const [key, value] of Object.entries(claim)) {
      if (value === undefined) delete manifest[key];
      else manifest[key] = value;
    }
    writeFixtureJson(root, MANIFEST_PATH, manifest);
    const result = await verifyInProcess(root, MANIFEST_ONLY);
    expectFailure(result.diagnostics, 'MANIFEST_IDENTITY', assert);
  }
});

test('a manifest whose file digest changed is still caught', async () => {
  // Editing any recorded digest must fail, whatever the candidate's state.
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  manifest.files[0].sha256 = 'f'.repeat(64);
  writeFixtureJson(root, MANIFEST_PATH, manifest);
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_STALE', assert);
});

// ---------------------------------------------------------------------------
// package identity
// ---------------------------------------------------------------------------

test('rejects a package name that does not match the reviewed package', async () => {
  const root = makeFixtureRoot();
  const pkg = readFixtureJson(root, 'package.json');
  pkg.name = '@example/not-tidas-spec';
  writeFixtureJson(root, 'package.json', pkg);
  const result = await verifyInProcess(root, ['package']);
  expectFailure(result.diagnostics, 'PACKAGE_NAME', assert);
});

test('rejects a package version that does not match the candidate version', async () => {
  const root = makeFixtureRoot();
  const pkg = readFixtureJson(root, 'package.json');
  pkg.version = '9.9.9';
  writeFixtureJson(root, 'package.json', pkg);
  const result = await verifyInProcess(root, ['package']);
  expectFailure(result.diagnostics, 'PACKAGE_VERSION', assert);
});

test('rejects a package that claims a blanket license', async () => {
  // The tools notice is verified, but per-artifact licensing of the embedded
  // classifications is not resolved. A bare SPDX identifier would assert that the
  // whole package carries that license, which the provenance record does not
  // establish, so it must fail rather than ship.
  const root = makeFixtureRoot();
  const pkg = readFixtureJson(root, 'package.json');
  pkg.license = 'MIT';
  writeFixtureJson(root, 'package.json', pkg);
  const result = await verifyInProcess(root, ['package']);
  expectFailure(result.diagnostics, 'PACKAGE_LICENSE_CLAIM', assert);
});

test('rejects a runtime dependency', async () => {
  const root = makeFixtureRoot();
  const pkg = readFixtureJson(root, 'package.json');
  pkg.dependencies = { 'left-pad': '1.3.0' };
  writeFixtureJson(root, 'package.json', pkg);
  const result = await verifyInProcess(root, ['package']);
  expectFailure(result.diagnostics, 'PACKAGE_RUNTIME_DEPENDENCY', assert);
});

test('rejects an optional runtime dependency', async () => {
  const root = makeFixtureRoot();
  const pkg = readFixtureJson(root, 'package.json');
  pkg.optionalDependencies = { sharp: '0.33.0' };
  writeFixtureJson(root, 'package.json', pkg);
  const result = await verifyInProcess(root, ['package']);
  expectFailure(result.diagnostics, 'PACKAGE_RUNTIME_DEPENDENCY', assert);
});

for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']) {
  test(`rejects a \`${hook}\` lifecycle script`, async () => {
    const root = makeFixtureRoot();
    const pkg = readFixtureJson(root, 'package.json');
    pkg.scripts[hook] = 'node ./scripts/something.mjs';
    writeFixtureJson(root, 'package.json', pkg);
    const result = await verifyInProcess(root, ['package']);
    expectFailure(result.diagnostics, 'PACKAGE_INSTALL_HOOK', assert);
  });
}

test('rejects a files whitelist that would hide a shipped asset', async () => {
  const root = makeFixtureRoot();
  const pkg = readFixtureJson(root, 'package.json');
  pkg.files = ['LICENSE', 'README.md', 'spec-manifest.json'];
  writeFixtureJson(root, 'package.json', pkg);
  const result = await verifyInProcess(root, ['package']);
  expectFailure(result.diagnostics, 'PACKAGE_WHITELIST', assert);
});

test('rejects a files whitelist whose entry matches nothing', async () => {
  const root = makeFixtureRoot();
  const pkg = readFixtureJson(root, 'package.json');
  pkg.files = [...pkg.files, 'assets/tidas/schemas/tidas_nonexistent.json'];
  writeFixtureJson(root, 'package.json', pkg);
  const result = await verifyInProcess(root, ['package']);
  expectFailure(result.diagnostics, 'PACKAGE_WHITELIST', assert);
});

test('rejects a package that would publish a file outside the reviewed set', async () => {
  const root = makeFixtureRoot();
  writeFileSync(path.join(root, 'NOTES.md'), 'scratch notes that must not be published');
  const pkg = readFixtureJson(root, 'package.json');
  pkg.files = [...pkg.files, 'NOTES.md'];
  writeFixtureJson(root, 'package.json', pkg);
  const result = await verifyInProcess(root, ['package']);
  expectFailure(result.diagnostics, 'PACKAGE_EXTRA_FILE', assert);
});

test('rejects a package that would drop its provenance metadata', async () => {
  const root = makeFixtureRoot();
  rmSync(path.join(root, 'reviewed-baseline.json'));
  const pkg = readFixtureJson(root, 'package.json');
  pkg.files = pkg.files.filter((entry) => entry !== 'reviewed-baseline.json');
  writeFixtureJson(root, 'package.json', pkg);
  const result = await verifyInProcess(root, ['package']);
  expectFailure(result.diagnostics, 'PACKAGE_METADATA_MISSING', assert);
});

test('rejects a package with no files whitelist at all', async () => {
  const root = makeFixtureRoot();
  const pkg = readFixtureJson(root, 'package.json');
  delete pkg.files;
  writeFixtureJson(root, 'package.json', pkg);
  const result = await verifyInProcess(root, ['package']);
  expectFailure(result.diagnostics, 'PACKAGE_WHITELIST', assert);
});

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

async function archiveFixture() {
  const root = makeFixtureRoot();
  const { buildCandidate } = await import('../../scripts/spec/lib/build.mjs');
  const built = buildCandidate(root);
  return { root, built };
}

test('rejects a missing archive', async () => {
  const root = makeFixtureRoot();
  const result = await verifyInProcess(root, ['archive'], { archivePath: path.join(root, 'release', 'absent.tgz') });
  expectFailure(result.diagnostics, 'archive/missing', assert);
});

test('rejects an archive whose declared asset bytes were replaced', async () => {
  const { root, built } = await archiveFixture();
  const { createDeterministicTarGz } = await import('../../scripts/spec/lib/tar.mjs');
  const { loadAssetSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const assetSet = loadAssetSet(root);
  const entries = [
    { entry: 'package/package.json', content: readFileSync(path.join(root, 'package.json')) },
    { entry: 'package/README.md', content: readFileSync(path.join(root, 'README.md')) },
    { entry: 'package/LICENSE', content: readFileSync(path.join(root, 'LICENSE')) },
    { entry: 'package/source-import.yaml', content: readFileSync(path.join(root, IMPORT_MANIFEST)) },
    { entry: 'package/spec-manifest.json', content: readFileSync(path.join(root, MANIFEST_PATH)) },
  ];
  for (const relative of assetSet.approved) {
    const content = relative === EN_CONTACTS ? Buffer.from('{"$schema":"http://json-schema.org/draft-07/schema#"}\n') : readFileSync(path.join(root, relative));
    entries.push({ entry: `package/${relative}`, content });
  }
  writeFileSync(built.archivePath, createDeterministicTarGz(entries));
  const result = await verifyInProcess(root, ['manifest', 'archive'], { archivePath: built.archivePath });
  assertAnyCode(result.diagnostics, ['ARCHIVE_ASSET_MISMATCH', 'ARCHIVE_BINDING_DIGEST', 'ARCHIVE_SELF_VERIFY'], 'expected the replaced asset to be rejected');
});

test('rejects an archive whose binding digest no longer matches', async () => {
  const { root, built } = await archiveFixture();
  const binding = readFixtureJson(root, BINDING_PATH);
  assert.equal(binding.archiveSha256, built.archiveSha256);
  binding.archiveSha256 = '0'.repeat(64);
  writeFixtureJson(root, BINDING_PATH, binding);
  const result = await verifyInProcess(root, ['manifest', 'archive'], { archivePath: built.archivePath });
  expectFailure(result.diagnostics, 'ARCHIVE_BINDING_DIGEST', assert);
});

test('rejects an archive whose binding points at a different asset digest', async () => {
  const { root, built } = await archiveFixture();
  const binding = readFixtureJson(root, BINDING_PATH);
  binding.assetFilesSha256 = '1'.repeat(64);
  writeFixtureJson(root, BINDING_PATH, binding);
  const result = await verifyInProcess(root, ['manifest', 'archive'], { archivePath: built.archivePath });
  expectFailure(result.diagnostics, 'ARCHIVE_BINDING_DIGEST', assert);
});

test('rejects an archive whose binding claims a different identity', async () => {
  const { root, built } = await archiveFixture();
  const binding = readFixtureJson(root, BINDING_PATH);
  binding.package = '@example/not-tidas-spec';
  writeFixtureJson(root, BINDING_PATH, binding);
  const result = await verifyInProcess(root, ['manifest', 'archive'], { archivePath: built.archivePath });
  expectFailure(result.diagnostics, 'ARCHIVE_BINDING_IDENTITY', assert);
});

test('an absent receipt is reported, and the archive still verifies on its content', async () => {
  // The receipt is disposable. Its absence cannot be a failure, because a fresh
  // checkout never has one; what it carries is the source revision and the
  // toolchain-dependent digests, and those are reported as unchecked.
  const { root, built } = await archiveFixture();
  rmSync(path.join(root, BINDING_PATH));
  const result = await verifyInProcess(root, ['manifest', 'archive'], { archivePath: built.archivePath });
  assert.equal(result.diagnostics.ok, true, `an absent receipt must not fail the archive: ${JSON.stringify(result.diagnostics.errors)}`);
  assert.ok(
    result.diagnostics.warnings.some((item) => item.code.includes('binding/absent')),
    `expected the absent receipt to be reported, got ${JSON.stringify(result.diagnostics.warnings)}`,
  );
});

test('an asserted source revision with no receipt to check it against is rejected', async () => {
  const { root, built } = await archiveFixture();
  rmSync(path.join(root, BINDING_PATH));
  const result = await verifyInProcess(root, ['manifest', 'archive'], {
    archivePath: built.archivePath,
    expectedSourceRevision: { commit: 'a'.repeat(40), treeState: 'clean', qualification: 'qualified', repository: null },
  });
  expectFailure(result.diagnostics, 'ARCHIVE_BINDING_MISSING', assert);
});

test('rejects an archive carrying an extra file the approved set does not contain', async () => {
  const { root, built } = await archiveFixture();
  const { createDeterministicTarGz } = await import('../../scripts/spec/lib/tar.mjs');
  const { loadAssetSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const assetSet = loadAssetSet(root);
  const entries = [
    { entry: 'package/package.json', content: readFileSync(path.join(root, 'package.json')) },
    { entry: 'package/README.md', content: readFileSync(path.join(root, 'README.md')) },
    { entry: 'package/LICENSE', content: readFileSync(path.join(root, 'LICENSE')) },
    { entry: 'package/source-import.yaml', content: readFileSync(path.join(root, IMPORT_MANIFEST)) },
    { entry: 'package/spec-manifest.json', content: readFileSync(path.join(root, MANIFEST_PATH)) },
  ];
  for (const relative of assetSet.approved) entries.push({ entry: `package/${relative}`, content: readFileSync(path.join(root, relative)) });
  entries.push({ entry: 'package/assets/tidas/schemas/tidas_smuggled.json', content: Buffer.from('{"type":"object"}\n') });
  writeFileSync(built.archivePath, createDeterministicTarGz(entries));
  const result = await verifyInProcess(root, ['manifest', 'archive'], { archivePath: built.archivePath });
  assertAnyCode(result.diagnostics, ['ASSET_UNEXPECTED', 'ARCHIVE_ASSET_MISMATCH', 'ARCHIVE_BINDING_DIGEST'], 'expected the extra file to be rejected');
});

test('rejects an archive that does not unpack into a single package directory', async () => {
  const { root } = await archiveFixture();
  const { createDeterministicTarGz } = await import('../../scripts/spec/lib/tar.mjs');
  const archivePath = path.join(root, 'release', 'flat.tgz');
  writeFileSync(archivePath, createDeterministicTarGz([{ entry: 'assets/tidas/schema.lock.json', content: readFileSync(path.join(root, LOCK_PATH)) }]));
  const result = await verifyInProcess(root, ['archive'], { archivePath });
  expectFailure(result.diagnostics, 'ARCHIVE_LAYOUT', assert);
});

test('rejects an archive that is not a readable tar.gz', async () => {
  const { root } = await archiveFixture();
  const archivePath = path.join(root, 'release', 'corrupt.tgz');
  writeFileSync(archivePath, 'this is not an archive');
  const result = await verifyInProcess(root, ['archive'], { archivePath });
  assertAnyCode(result.diagnostics, ['ARCHIVE_READ', 'ARCHIVE_EXTRACT'], 'expected an unreadable-archive failure');
});

test('rejects an archive whose inner package disagrees with the manifest', async () => {
  // The archive must be self-consistent after unpacking: a package.json with a
  // different version inside the archive is a package-identity conflict.
  const { root, built } = await archiveFixture();
  const { createDeterministicTarGz } = await import('../../scripts/spec/lib/tar.mjs');
  const { loadAssetSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const assetSet = loadAssetSet(root);
  const pkg = readFixtureJson(root, 'package.json');
  pkg.version = '2.0.0';
  const entries = [
    { entry: 'package/package.json', content: Buffer.from(formatJson(pkg)) },
    { entry: 'package/README.md', content: readFileSync(path.join(root, 'README.md')) },
    { entry: 'package/LICENSE', content: readFileSync(path.join(root, 'LICENSE')) },
    { entry: 'package/source-import.yaml', content: readFileSync(path.join(root, IMPORT_MANIFEST)) },
    { entry: 'package/spec-manifest.json', content: readFileSync(path.join(root, MANIFEST_PATH)) },
  ];
  for (const relative of assetSet.approved) entries.push({ entry: `package/${relative}`, content: readFileSync(path.join(root, relative)) });
  writeFileSync(built.archivePath, createDeterministicTarGz(entries));
  const result = await verifyInProcess(root, ['manifest', 'archive'], { archivePath: built.archivePath });
  assertAnyCode(result.diagnostics, ['ARCHIVE_SELF_VERIFY', 'ARCHIVE_BINDING_DIGEST'], 'expected the conflicting package identity to be rejected');
});

// ---------------------------------------------------------------------------
// archive-internal manifest (the P1 integrity case)
// ---------------------------------------------------------------------------

/**
 * Rebuild an archive with one entry replaced, then recompute the outer digests.
 *
 * Recomputing the outer digests is the point: the case must fail because the
 * archive is internally inconsistent, not because a stale digest was noticed.
 */
async function archiveWithReplacedEntry(root, built, replacedEntry, content) {
  const { createDeterministicTarGz } = await import('../../scripts/spec/lib/tar.mjs');
  const { loadAssetSet: loadSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const { sha256Hex: sha } = await import('../../scripts/spec/lib/core.mjs');
  const assetSet = loadSet(root);
  const entries = [];
  const add = (entry, body) => entries.push({ entry, content: entry === replacedEntry ? content : body });
  add('package/spec-manifest.json', readFileSync(path.join(root, MANIFEST_PATH)));
  add('package/package.json', readFileSync(path.join(root, 'package.json')));
  add('package/README.md', readFileSync(path.join(root, 'README.md')));
  add('package/LICENSE', readFileSync(path.join(root, 'LICENSE')));
  add('package/source-import.yaml', readFileSync(path.join(root, IMPORT_MANIFEST)));
  add('package/reviewed-baseline.json', readFileSync(path.join(root, 'reviewed-baseline.json')));
  for (const relative of assetSet.approved) add(`package/${relative}`, readFileSync(path.join(root, relative)));
  const archive = createDeterministicTarGz(entries);
  writeFileSync(built.archivePath, archive);

  const bindingPath = path.join(root, BINDING_PATH);
  const binding = JSON.parse(readFileSync(bindingPath, 'utf8'));
  binding.archiveSha256 = sha(archive);
  writeFixtureJson(root, BINDING_PATH, binding);
  return { archiveSha256: sha(archive) };
}

test('rejects an archive whose internal manifest was replaced, even with fresh outer digests', async () => {
  // The exact case an earlier revision accepted: outer manifest valid, asset
  // bytes genuine, only the manifest *inside* the archive replaced, outer
  // digests recomputed so nothing is stale.
  const root = makeFixtureRoot();
  const { buildCandidate } = await import('../../scripts/spec/lib/build.mjs');
  const built = buildCandidate(root);
  await archiveWithReplacedEntry(root, built, 'package/spec-manifest.json', Buffer.from('{"corrupted":true}\n'));
  const result = await verifyInProcess(root, ['identity', 'manifest', 'package', 'archive']);
  assert.equal(result.diagnostics.ok, false, 'an internally inconsistent archive must not be accepted');
  assertAnyCode(result.diagnostics, ['MANIFEST_FORMAT', 'ARCHIVE_MANIFEST_MISMATCH', 'ARCHIVE_SELF_VERIFY', 'ARCHIVE_MANIFEST_INCONSISTENT'], 'expected the replaced internal manifest to be rejected');
});

test('rejects an archive whose internal manifest is missing', async () => {
  const root = makeFixtureRoot();
  const { buildCandidate } = await import('../../scripts/spec/lib/build.mjs');
  const { createDeterministicTarGz } = await import('../../scripts/spec/lib/tar.mjs');
  const { loadAssetSet: loadSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const { sha256Hex: sha } = await import('../../scripts/spec/lib/core.mjs');
  const built = buildCandidate(root);
  const assetSet = loadSet(root);
  const entries = [];
  for (const relative of ['package/package.json', 'package/README.md', 'package/LICENSE', 'package/source-import.yaml', 'package/reviewed-baseline.json']) {
    entries.push({ entry: relative, content: readFileSync(path.join(root, relative.replace('package/', ''))) });
  }
  for (const relative of assetSet.approved) entries.push({ entry: `package/${relative}`, content: readFileSync(path.join(root, relative)) });
  const archive = createDeterministicTarGz(entries);
  writeFileSync(built.archivePath, archive);
  const binding = readFixtureJson(root, BINDING_PATH);
  binding.archiveSha256 = sha(archive);
  writeFixtureJson(root, BINDING_PATH, binding);

  const result = await verifyInProcess(root, ['identity', 'manifest', 'package', 'archive']);
  assert.equal(result.diagnostics.ok, false);
  assertAnyCode(result.diagnostics, ['ARCHIVE_MANIFEST_MISSING', 'ARCHIVE_SELF_VERIFY', 'ARCHIVE_FILE_MISSING'], 'expected the missing internal manifest to be rejected');
});

test('rejects an archive whose internal manifest describes different bytes', async () => {
  // The internal manifest stays well-formed and canonical, but one recorded
  // digest no longer describes the file next to it.
  const root = makeFixtureRoot();
  const { buildCandidate } = await import('../../scripts/spec/lib/build.mjs');
  const built = buildCandidate(root);
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  manifest.files[0].sha256 = 'a'.repeat(64);
  await archiveWithReplacedEntry(root, built, 'package/spec-manifest.json', Buffer.from(formatJson(manifest)));
  const result = await verifyInProcess(root, ['identity', 'manifest', 'package', 'archive']);
  assert.equal(result.diagnostics.ok, false);
  assertAnyCode(result.diagnostics, ['ARCHIVE_MANIFEST_INCONSISTENT', 'ARCHIVE_MANIFEST_MISMATCH', 'ARCHIVE_SELF_VERIFY'], 'expected the inconsistent internal manifest to be rejected');
});

test('rejects an archive carrying an undeclared extra validation file', async () => {
  const root = makeFixtureRoot();
  const { buildCandidate } = await import('../../scripts/spec/lib/build.mjs');
  const { createDeterministicTarGz } = await import('../../scripts/spec/lib/tar.mjs');
  const { loadAssetSet: loadSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const { sha256Hex: sha } = await import('../../scripts/spec/lib/core.mjs');
  const built = buildCandidate(root);
  const assetSet = loadSet(root);
  const entries = [];
  for (const relative of ['package/package.json', 'package/README.md', 'package/LICENSE', 'package/source-import.yaml', 'package/reviewed-baseline.json', 'package/spec-manifest.json']) {
    entries.push({ entry: relative, content: readFileSync(path.join(root, relative.replace('package/', ''))) });
  }
  for (const relative of assetSet.approved) entries.push({ entry: `package/${relative}`, content: readFileSync(path.join(root, relative)) });
  entries.push({ entry: 'package/NOTES.md', content: Buffer.from('an undeclared published file\n') });
  const archive = createDeterministicTarGz(entries);
  writeFileSync(built.archivePath, archive);
  const binding = readFixtureJson(root, BINDING_PATH);
  binding.archiveSha256 = sha(archive);
  writeFixtureJson(root, BINDING_PATH, binding);

  const result = await verifyInProcess(root, ['identity', 'manifest', 'package', 'archive']);
  assert.equal(result.diagnostics.ok, false);
  assertAnyCode(result.diagnostics, ['ARCHIVE_FILE_EXTRA', 'ASSET_UNEXPECTED', 'ARCHIVE_SELF_VERIFY'], 'expected the undeclared file to be rejected');
});

test('rejects an archive carrying a git-ignored extra file', async () => {
  // A file matched by `.gitignore` is invisible to `git status` and to every
  // `git diff`-based review. It must still be caught here: the archive checks
  // enumerate what is on disk, not what Git would report.
  const root = makeFixtureRoot();
  const { buildCandidate } = await import('../../scripts/spec/lib/build.mjs');
  const { createDeterministicTarGz } = await import('../../scripts/spec/lib/tar.mjs');
  const { loadAssetSet: loadSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const { sha256Hex: sha } = await import('../../scripts/spec/lib/core.mjs');
  const built = buildCandidate(root);
  const assetSet = loadSet(root);
  const entries = [];
  for (const relative of ['package/package.json', 'package/README.md', 'package/LICENSE', 'package/source-import.yaml', 'package/reviewed-baseline.json', 'package/spec-manifest.json']) {
    entries.push({ entry: relative, content: readFileSync(path.join(root, relative.replace('package/', ''))) });
  }
  for (const relative of assetSet.approved) entries.push({ entry: `package/${relative}`, content: readFileSync(path.join(root, relative)) });
  entries.push({ entry: 'package/build/scratch-analysis.json', content: Buffer.from('{"ignored":true}\n') });
  const archive = createDeterministicTarGz(entries);
  writeFileSync(built.archivePath, archive);
  const binding = readFixtureJson(root, BINDING_PATH);
  binding.archiveSha256 = sha(archive);
  writeFixtureJson(root, BINDING_PATH, binding);

  const result = await verifyInProcess(root, ['identity', 'manifest', 'package', 'archive']);
  assert.equal(result.diagnostics.ok, false, 'a git-ignored file inside the archive must still be rejected');
  assertAnyCode(result.diagnostics, ['ARCHIVE_FILE_EXTRA', 'ARCHIVE_MANIFEST_INCONSISTENT', 'ARCHIVE_SELF_VERIFY'], 'expected the ignored extra file to be rejected');
});

test('rejects a manifest carrying an undeclared extra metadata field', async () => {
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  manifest.provenanceWaiver = 'not a reviewed field';
  writeFixtureJson(root, MANIFEST_PATH, manifest);
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_STALE', assert);
});

test('rejects an archive whose published metadata was modified', async () => {
  // Metadata is not decorative: `source-import.yaml` carries the reviewed source
  // and `reviewed-baseline.json` the review anchor. Both are now bound.
  const root = makeFixtureRoot();
  const { buildCandidate } = await import('../../scripts/spec/lib/build.mjs');
  const built = buildCandidate(root);
  mutateFixtureText(root, 'reviewed-baseline.json', (text) => text.replace('"fileCount": 32', '"fileCount": 31'));
  const result = await verifyInProcess(root, ['identity', 'manifest', 'package', 'archive']);
  assert.equal(result.diagnostics.ok, false);
  assertAnyCode(result.diagnostics, ['SOURCE_IDENTITY', 'MANIFEST_STALE', 'ARCHIVE_MANIFEST_MISMATCH', 'ARCHIVE_SELF_VERIFY'], 'expected the modified review anchor to be rejected');
});

// ---------------------------------------------------------------------------
// full manifest completeness
// ---------------------------------------------------------------------------

test('the manifest binds every physically shipped file', async () => {
  // Independent of the manifest's own list: enumerate what the package would
  // publish, and require each file to be bound either by a byte digest in
  // `files` or by one of the two identity records that replace it.
  const root = makeFixtureRoot();
  const { resolvePackagedFiles } = await import('../../scripts/spec/lib/package-content.mjs');
  const packaged = resolvePackagedFiles(root);
  const manifest = readFixtureJson(root, MANIFEST_PATH);

  const boundByDigest = new Set(manifest.files.map((file) => file.path));
  // The manifest is the single file bound outside the byte list, because it
  // cannot contain its own digest; the receipt binds it from outside.
  const boundByIdentity = new Set([MANIFEST_PATH]);
  const unbound = packaged.files.filter((relative) => !boundByDigest.has(relative) && !boundByIdentity.has(relative));
  assert.deepEqual(unbound, [], 'every packaged file must be bound: by an exact byte digest, or as the manifest itself');

  const invented = [...boundByDigest].filter((relative) => !packaged.files.includes(relative));
  assert.deepEqual(invented, [], 'the manifest must not bind files the package does not ship');

  assert.equal(manifest.files.length + boundByIdentity.size, packaged.files.length, 'the byte list plus the manifest must cover the package exactly');
  assert.equal(manifest.counts.packagedFiles, packaged.files.length);
});

test('the manifest distinguishes imported assets from package metadata', async () => {
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  const imported = manifest.files.filter((file) => file.origin === 'tidas-toolkit');
  const owned = manifest.files.filter((file) => file.origin === 'tidas-spec');
  assert.equal(imported.length, 32);
  assert.equal(owned.length, manifest.files.length - 32);
  for (const file of imported) {
    assert.ok(file.source !== null, `${file.path}: an imported asset must record its source path and digest`);
    assert.equal(file.source.sha256, file.sha256);
  }
  for (const file of owned) {
    assert.equal(file.source, null, `${file.path}: package metadata must not claim a tools source`);
  }
  assert.equal(manifest.source.ownedMetadataOrigin, 'tidas-spec');
});

test('rejects a manifest that omits a shipped metadata file', async () => {
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  manifest.files = manifest.files.filter((file) => file.path !== 'README.md');
  writeFixtureJson(root, MANIFEST_PATH, manifest);
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_STALE', assert);
});

test('rejects a manifest whose package.json byte digest was edited', async () => {
  // The publication metadata is bound by an exact byte digest like every other
  // shipped file. There is no weaker identity for it: the two channels ship the
  // same bytes, so any difference is a real difference.
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  const entry = manifest.files.find((file) => file.path === 'package.json');
  assert.ok(entry, 'package.json must carry a byte digest in the manifest');
  entry.sha256 = 'b'.repeat(64);
  writeFixtureJson(root, MANIFEST_PATH, manifest);
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_STALE', assert);
});

test('rejects a manifest carrying any packageJson identity block', async () => {
  // The block existed only to excuse a channel byte difference. With the
  // channels byte-identical it is dead surface, and an unexpected extra field
  // must fail rather than be ignored.
  const root = makeFixtureRoot();
  const manifest = readFixtureJson(root, MANIFEST_PATH);
  manifest.packageJson = { path: 'package.json', sha256: 'b'.repeat(64), semanticSha256: 'c'.repeat(64) };
  writeFixtureJson(root, MANIFEST_PATH, manifest);
  const result = await verifyInProcess(root, MANIFEST_ONLY);
  expectFailure(result.diagnostics, 'MANIFEST_STALE', assert);
});

// ---------------------------------------------------------------------------
// reference correctness at the verifier level
// ---------------------------------------------------------------------------

test('rejects a reference with an invalid JSON pointer escape', async () => {
  const root = await mutatedFixture((target) => {
    for (const relative of [EN_FLOWS, ZH_FLOWS]) {
      replaceFirstRef(target, relative, './tidas_flows_elementary_category.json', '#/~2');
    }
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_POINTER_ESCAPE', assert);
});

test('rejects a double-decoded percent fragment', async () => {
  // `%252F` decodes once to `%2F`; a second decode would wrongly reach `/`.
  const root = await mutatedFixture((target) => {
    for (const relative of [EN_FLOWS, ZH_FLOWS]) {
      replaceFirstRef(target, relative, './tidas_flows_elementary_category.json', '#/%252F');
    }
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_MISSING_FRAGMENT', assert);
});

test('an unreferenced $defs entry does not create a reference', async () => {
  // The unreachable definition holds a network reference. It must not be walked,
  // because nothing in the document points at it.
  const root = await mutatedFixture((target) => {
    for (const relative of [EN_CONTACTS, ZH_CONTACTS]) {
      const document = readFixtureJson(target, relative);
      document.$defs = { Unreached: { $ref: 'https://example.invalid/never-resolved.json' } };
      writeFixtureJson(target, relative, document);
    }
  });
  const result = await verifyInProcess(root, ['identity']);
  const referenceFailures = result.diagnostics.errors.filter((item) => item.code.includes('reference-closure'));
  assert.deepEqual(referenceFailures, [], `an unreferenced definition must not create a reference: ${JSON.stringify(referenceFailures)}`);
});

test('a reachable $defs entry with a broken reference is still caught', async () => {
  // The same location, this time reached by a real reference.
  const root = await mutatedFixture((target) => {
    for (const relative of [EN_CONTACTS, ZH_CONTACTS]) {
      const document = readFixtureJson(target, relative);
      document.$defs = { Reached: { $ref: '#/$defs/Absent' } };
      document.properties.extra = { $ref: '#/$defs/Reached' };
      writeFixtureJson(target, relative, document);
    }
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_MISSING_FRAGMENT', assert);
});

test('rejects a later-draft keyword whose reference cannot resolve, only when reached', async () => {
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.dependentSchemas = { a: { $ref: 'https://example.invalid/dep.json' } };
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  const networkFailures = result.diagnostics.errors.filter((item) => item.code.endsWith('REF_NETWORK'));
  assert.deepEqual(networkFailures, [], 'a Draft 2019 keyword is not a Draft 7 schema position');
});

test('accepts an absolute $id as a local alias with no network access', async () => {
  // A declared absolute identifier is a resource this package contains, so a
  // reference to it resolves offline. The alias is declared on a nested
  // subschema, which is the realistic shape: a root `$id` would additionally
  // rebase every relative reference in the document, which is correct Draft 7
  // behaviour but would confound this case.
  // Each language declares its own alias. Two documents declaring one absolute
  // base would be a genuine ambiguity, which the verifier reports separately.
  const root = await mutatedFixture((target) => {
    for (const [relative, alias] of [
      [EN_CONTACTS, 'https://example.invalid/alias/en-contacts.json'],
      [ZH_CONTACTS, 'https://example.invalid/alias/zh-contacts.json'],
    ]) {
      const document = readFixtureJson(target, relative);
      document.definitions = {
        ...(document.definitions ?? {}),
        Aliased: { $id: alias, definitions: { Marker: { type: 'string' } } },
      };
      document.properties.marker = { $ref: `${alias}#/definitions/Marker` };
      writeFixtureJson(target, relative, document);
    }
  });
  const result = await verifyInProcess(root, ['identity']);
  const referenceFailures = result.diagnostics.errors.filter((item) => item.code.includes('reference-closure'));
  assert.deepEqual(referenceFailures, [], `a declared absolute alias must resolve locally: ${JSON.stringify(referenceFailures)}`);
});

test('a root $id rebases that document without affecting its siblings', async () => {
  // Correct Draft 7: the root `$id` changes the base for references written in
  // that document. It does not reach into other documents.
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.$id = 'https://example.invalid/contacts.json';
    document.properties.marker = { $ref: 'https://example.invalid/contacts.json#/properties/contactDataSet' };
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  const ownDocument = result.diagnostics.errors.filter((item) => item.message.includes(`${EN_CONTACTS}: reference`));
  // The document's own relative references now resolve against the new base, so
  // they no longer name package files — a real consequence, reported, not hidden.
  assert.ok(ownDocument.length > 0, 'a root $id must be honoured as the base for that document');
  const elsewhere = result.diagnostics.errors.filter((item) => item.message.includes(`${ZH_CONTACTS}: reference`));
  assert.deepEqual(elsewhere, [], 'a root $id in one document must not affect another');
});

test('rejects a reference to an absolute resource the package does not declare', async () => {
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.properties.marker = { $ref: 'https://example.invalid/undeclared.json#/definitions/X' };
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_NETWORK', assert);
});

test('rejects a reference to a scalar or array target', async () => {
  for (const [label, value] of [['scalar', 7], ['array', []]]) {
    const root = await mutatedFixture((target) => {
      const document = readFixtureJson(target, EN_CONTACTS);
      document.$defs = { NotASchema: value };
      document.properties.marker = { $ref: '#/$defs/NotASchema' };
      writeFixtureJson(target, EN_CONTACTS, document);
    });
    const result = await verifyInProcess(root, ['identity']);
    expectFailure(result.diagnostics, 'REF_NON_SCHEMA_TARGET', assert);
    assert.ok(label.length > 0);
  }
});

test('does not treat an $id inside instance data as a declaration', async () => {
  // An earlier revision indexed these and reported a resource conflict for what
  // is just two data values.
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.examples = [{ $id: 'same.json' }, { $id: 'same.json' }];
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  const structureFailures = result.diagnostics.errors.filter((item) => item.code.includes('REF_RESOURCE_CONFLICT'));
  assert.deepEqual(structureFailures, [], `instance data must not declare resources: ${JSON.stringify(structureFailures)}`);
});

test('accepts a locally resolvable nested $id and resolves references through it', async () => {
  // The concrete case the previous revision refused outright: a nested resource
  // the package itself contains.
  const root = await mutatedFixture((target) => {
    for (const relative of [EN_CONTACTS, ZH_CONTACTS]) {
      const document = readFixtureJson(target, relative);
      document.definitions = {
        ...(document.definitions ?? {}),
        Local: { $id: 'local-types.json', definitions: { Marker: { type: 'string' } } },
      };
      document.properties.marker = { $ref: 'local-types.json#/definitions/Marker' };
      writeFixtureJson(target, relative, document);
    }
  });
  const result = await verifyInProcess(root, ['identity']);
  const referenceFailures = result.diagnostics.errors.filter((item) => item.code.includes('reference-closure'));
  assert.deepEqual(referenceFailures, [], `a locally resolvable nested resource must resolve: ${JSON.stringify(referenceFailures)}`);
});

// ---------------------------------------------------------------------------
// source finding: `$ref` siblings that assert
// ---------------------------------------------------------------------------

test('the real source finding is derived, not hardcoded', async () => {
  // Independently walk the shipped documents and compare with what the verifier
  // reports. Nothing here reads the verifier's own summary, so a hardcoded count
  // or an accidental narrowing of the classification would fail this test.
  const { loadAssetSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const { analyseSiblingFindings } = await import('../../scripts/spec/lib/verify.mjs');
  const assetSet = loadAssetSet(REPO_ROOT);
  const assertionKeywords = new Set([
    'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum',
    'maxLength', 'minLength', 'pattern',
    'items', 'additionalItems', 'maxItems', 'minItems', 'uniqueItems', 'contains',
    'maxProperties', 'minProperties', 'required', 'properties', 'patternProperties',
    'additionalProperties', 'dependencies', 'propertyNames',
    'enum', 'const', 'type', 'format',
    'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  ]);

  // Classification is checked over the positions the resolver actually reaches —
  // the same population the verifier summarises. Collecting those positions uses
  // the resolver's own traversal, so this test is about the *classification*, not
  // about re-implementing reachability.
  const { buildCatalog, collectReferences } = await import('../../scripts/spec/lib/refs.mjs');
  const documents = new Map();
  for (const [relative, document] of assetSet.json) {
    if (relative.includes('/schemas')) documents.set(relative, document);
  }
  const catalog = buildCatalog(documents);
  const reached = collectReferences(catalog);

  const byKeyword = new Map();
  const locations = [];
  let nonAsserting = 0;
  let withoutSiblings = 0;
  const descend = (pointer) => {
    const [file, fragment] = pointer.split('#');
    let current = catalog.byPath.get(file).document;
    for (const rawToken of fragment.slice(1).split('/')) {
      const token = rawToken.replace(/~1/g, '/').replace(/~0/g, '~');
      current = Array.isArray(current) ? current[Number(token)] : current[token];
    }
    return current;
  };

  for (const [identity, entry] of reached) {
    const node = descend(identity);
    if (node === null || typeof node !== 'object') continue;
    const siblings = Object.keys(node).filter((key) => key !== '$ref');
    if (siblings.length === 0) {
      withoutSiblings += 1;
      continue;
    }
    const asserting = siblings.filter((key) => assertionKeywords.has(key));
    if (asserting.length > 0) {
      for (const key of asserting) byKeyword.set(key, (byKeyword.get(key) ?? 0) + 1);
      locations.push({ pointer: identity, siblings: asserting });
    } else {
      nonAsserting += 1;
    }
  }
  const reachedCount = reached.size;

  const findings = analyseSiblingFindings(assetSet);
  assert.equal(findings.references, locations.length, 'the reported count must equal an independent walk');
  assert.equal(findings.locations.length, locations.length, 'every affected object must carry a location');
  assert.ok(findings.references > 0, 'the reviewed source does contain assertion-bearing `$ref` siblings');

  const reported = Object.fromEntries(findings.keywords.map((entry) => [entry.keyword, entry.count]));
  assert.deepEqual(reported, Object.fromEntries(byKeyword), 'keyword counts must match an independent walk');
  assert.equal(findings.nonAssertingReferences, nonAsserting, 'non-asserting objects must be counted separately');
  assert.equal(findings.referencesWithoutSiblings, withoutSiblings, 'objects with no siblings are their own category');
  assert.equal(findings.totalReferences, reachedCount, 'the total must be the reached `$ref` population');
  assert.equal(
    findings.references + findings.nonAssertingReferences + findings.referencesWithoutSiblings,
    findings.totalReferences,
    'the three categories must partition the reached `$ref` objects exactly',
  );

  // The keywords the earlier revision lost. Asserting their presence here means a
  // regression to "annotation-only" fails rather than silently reporting zero.
  for (const keyword of ['const', 'format', 'type']) {
    assert.ok((reported[keyword] ?? 0) > 0, `${keyword} must be reported as an assertion`);
  }
});

test('the manifest records the source finding derived from the shipped documents', async () => {
  const root = makeFixtureRoot();
  const { writeManifest } = await import('../../scripts/spec/lib/build.mjs');
  writeManifest(root);
  const manifest = JSON.parse(readFileSync(path.join(root, MANIFEST_PATH), 'utf8'));
  const recorded = manifest.findings?.refSiblings;
  assert.ok(recorded, 'the manifest must record the source finding');
  assert.ok(recorded.references > 0);
  assert.ok(recorded.patterns.length > 0, 'the finding must name the keyword patterns');
  assert.equal(recorded.locations.length, recorded.references, 'every affected object must be located');
  assert.ok(recorded.locations.every((entry) => typeof entry.pointer === 'string' && entry.pointer.includes('#')));

  // And it is the same analysis the identity stage reports.
  const { analyseSiblingFindings } = await import('../../scripts/spec/lib/verify.mjs');
  const { loadAssetSet } = await import('../../scripts/spec/lib/inventory.mjs');
  assert.deepEqual(recorded, analyseSiblingFindings(loadAssetSet(root)));
});

test('a constraint-bearing sibling added to a shipped schema is reported, not absorbed', async () => {
  // The regression this whole classification exists to prevent: a `const` sibling
  // being summarised as harmless annotation and the finding disappearing.
  const root = await mutatedFixture((target) => {
    for (const relative of [EN_CONTACTS, ZH_CONTACTS]) {
      const document = readFixtureJson(target, relative);
      const firstProperty = Object.keys(document.properties)[0];
      document.properties[firstProperty] = { $ref: 'tidas_data_types.json#/$defs/String', const: 'must-be-this' };
      writeFixtureJson(target, relative, document);
    }
  });
  const result = await verifyInProcess(root, ['identity']);
  const conflict = result.diagnostics.warnings.find((item) => item.code.includes('ref-sibling-conflict'));
  assert.ok(conflict, `expected the added constraint to be reported, got ${JSON.stringify(result.diagnostics.warnings.map((item) => item.code))}`);
  assert.ok(conflict.detail.keywords.some((entry) => entry.keyword === 'const'));

  // The finding itself is a warning, not a failure: it describes what the source
  // says. Editing a shipped schema does fail independently, because the bytes no
  // longer match the reviewed import — which is the correct, separate signal.
  assert.equal(result.diagnostics.errors.filter((item) => item.code.includes('ref-sibling')).length, 0);
  expectFailure(result.diagnostics, 'SOURCE_BYTES', assert);
});

test('a mixed annotation and constraint sibling is counted as a constraint', async () => {
  const root = await mutatedFixture((target) => {
    for (const relative of [EN_CONTACTS, ZH_CONTACTS]) {
      const document = readFixtureJson(target, relative);
      const firstProperty = Object.keys(document.properties)[0];
      document.properties[firstProperty] = { $ref: 'tidas_data_types.json#/$defs/String', description: 'documented', minLength: 3 };
      writeFixtureJson(target, relative, document);
    }
  });
  const result = await verifyInProcess(root, ['identity']);
  const { analyseSiblingFindings } = await import('../../scripts/spec/lib/verify.mjs');
  const { loadAssetSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const findings = analyseSiblingFindings(loadAssetSet(root));
  assert.ok(findings.locations.some((entry) => entry.assertionSiblings.includes('minLength')), 'the constraint sibling must be listed');
  assert.ok(
    findings.locations.every((entry) => !entry.assertionSiblings.includes('description')),
    'the annotation sibling must not be listed as an assertion',
  );
  void result;
});

test('an unknown sibling keyword is unclassified, not counted as an assertion', async () => {
  const root = await mutatedFixture((target) => {
    for (const relative of [EN_CONTACTS, ZH_CONTACTS]) {
      const document = readFixtureJson(target, relative);
      const firstProperty = Object.keys(document.properties)[0];
      document.properties[firstProperty] = { $ref: 'tidas_data_types.json#/$defs/String', 'x-vendor-rule': 'unknown semantics' };
      writeFixtureJson(target, relative, document);
    }
  });
  const { analyseSiblingFindings } = await import('../../scripts/spec/lib/verify.mjs');
  const { loadAssetSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const assetSet = loadAssetSet(root);
  const findings = analyseSiblingFindings(assetSet);

  // The extension stays visible, and it is not evidence of an assertion. The
  // mutation replaces one property per file, so the known-assertion total may
  // move; what must hold is that the extension is never counted as one.
  assert.equal(findings.unclassifiedReferences, 2, 'both language variants declare the extension');
  assert.ok(
    findings.locations.every((entry) => !entry.assertionSiblings.includes('x-vendor-rule')),
    'an unknown keyword must never be counted as an assertion',
  );
  assert.equal(
    findings.references + findings.nonAssertingReferences + findings.unclassifiedReferences + findings.referencesWithoutSiblings,
    findings.totalReferences,
    'the categories still partition the reached references',
  );

  const result = await verifyInProcess(root, ['identity']);
  const unclassified = result.diagnostics.warnings.find((item) => item.code.includes('ref-sibling-unclassified'));
  assert.ok(unclassified, `expected the extension to be reported, got ${JSON.stringify(result.diagnostics.warnings.map((item) => item.code))}`);
  assert.match(unclassified.message, /dialect does not define/, 'the message must say the dialect does not define the keyword');
  assert.match(unclassified.message, /unclassified/, 'the message must label it unclassified');
  assert.ok(
    !/claims? they restrict the instance[^.]*\. unclear/.test(unclassified.message) && /nothing here claims they restrict the instance/.test(unclassified.message),
    'the message must explicitly disclaim an assertion claim',
  );
  assert.match(unclassified.message, /nothing claims any evaluator disagrees/, 'no evaluator disagreement may be claimed');
});

test('an unclassified sibling beside a known assertion is surfaced, not merged into the count', async () => {
  const root = await mutatedFixture((target) => {
    for (const relative of [EN_CONTACTS, ZH_CONTACTS]) {
      const document = readFixtureJson(target, relative);
      const firstProperty = Object.keys(document.properties)[0];
      document.properties[firstProperty] = { $ref: 'tidas_data_types.json#/$defs/String', const: 'known', 'x-vendor-rule': 'unknown' };
      writeFixtureJson(target, relative, document);
    }
  });
  const { analyseSiblingFindings } = await import('../../scripts/spec/lib/verify.mjs');
  const { loadAssetSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const findings = analyseSiblingFindings(loadAssetSet(root));
  const added = findings.locations.filter((entry) => entry.assertionSiblings.includes('const') && entry.siblings.includes('x-vendor-rule'));
  assert.equal(added.length, 2, 'the object is a known-assertion finding');
  assert.deepEqual(added[0].assertionSiblings, ['const'], 'only the known assertion is counted');
});

test('the four sibling categories partition the reached references exactly', async () => {
  const { analyseSiblingFindings } = await import('../../scripts/spec/lib/verify.mjs');
  const { loadAssetSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const findings = analyseSiblingFindings(loadAssetSet(REPO_ROOT));
  assert.equal(
    findings.references + findings.nonAssertingReferences + findings.unclassifiedReferences + findings.referencesWithoutSiblings,
    findings.totalReferences,
    'every reached `$ref` object belongs to exactly one category',
  );
  assert.equal(findings.unclassifiedReferences, 0, 'the reviewed source declares no extension siblings');
});

// ---------------------------------------------------------------------------
// language sets: no invented hierarchy
// ---------------------------------------------------------------------------

test('a valid cross-language reference is not rejected for crossing a language boundary', async () => {
  // The earlier revision forbade English -> Chinese on the premise that English
  // is authoritative. No approved disposition establishes that, so a
  // cross-language reference must resolve like any other.
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.properties.marker = { $ref: './tidas_contacts_category.json#/$defs/Contact' };
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  const referenceFailures = result.diagnostics.errors.filter((item) => item.code.includes('reference-closure'));
  assert.deepEqual(referenceFailures, [], `a resolvable reference must not be rejected: ${JSON.stringify(referenceFailures)}`);
});

test('a cross-language reference is resolved in both directions', async () => {
  // English -> Chinese and Chinese -> English are treated identically.
  const root = await mutatedFixture((target) => {
    const english = readFixtureJson(target, EN_CONTACTS);
    english.definitions = { ...(english.definitions ?? {}), Shared: { type: 'string' } };
    english.properties.marker = { $ref: '#/definitions/Shared' };
    writeFixtureJson(target, EN_CONTACTS, english);

    const chinese = readFixtureJson(target, ZH_CONTACTS);
    chinese.definitions = { ...(chinese.definitions ?? {}), Shared: { type: 'string' } };
    chinese.properties.marker = { $ref: '#/definitions/Shared' };
    writeFixtureJson(target, ZH_CONTACTS, chinese);
  });
  const result = await verifyInProcess(root, ['identity']);
  const referenceFailures = result.diagnostics.errors.filter((item) => item.code.includes('reference-closure'));
  assert.deepEqual(referenceFailures, [], `references must resolve in either language: ${JSON.stringify(referenceFailures)}`);
});

test('the cross-language arrangement is reported as a fact, not enforced', async () => {
  const { loadAssetSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const { verifyCandidate: verify } = await import('../../scripts/spec/lib/verify.mjs');
  const result = verify({ repoRoot: REPO_ROOT, stages: ['identity'] });
  assert.equal(result.diagnostics.ok, true);
  // The reviewed source keeps every reference inside its own language. That is
  // reported when it happens, and its absence is not a failure.
  const report = result.diagnostics.items.find((item) => item.code.includes('identity/reference-closure') && item.detail?.crossLanguageReferences !== undefined);
  assert.ok(report, 'the closure check must report the cross-language count');
  assert.equal(report.detail.crossLanguageReferences.length, 0, 'the reviewed source has no cross-language references');
  void loadAssetSet;
});

test('an unresolvable cross-language reference still fails', async () => {
  // Removing the hierarchy must not weaken closure: a reference that cannot
  // resolve fails for the same ordinary reasons.
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.properties.marker = { $ref: '../schemas_zh/tidas_nonexistent.json#/$defs/X' };
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  assertAnyCode(result.diagnostics, ['REF_MISSING_TARGET'], 'a missing cross-language target must still fail');
});

test('an escaping cross-language reference still fails', async () => {
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.properties.marker = { $ref: '../../../../outside.json' };
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_ESCAPE', assert);
});

test('a non-schema cross-language target still fails', async () => {
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.properties.marker = { $ref: 'tidas_data_types.json#/$defs/Languages/enum/0' };
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'REF_NON_SCHEMA_TARGET', assert);
});

// ---------------------------------------------------------------------------
// Draft 7 meta-validation
// ---------------------------------------------------------------------------

test('meta-validation accepts every shipped schema', async () => {
  const { loadAssetSet: loadSet } = await import('../../scripts/spec/lib/inventory.mjs');
  const { metaValidateAll } = await import('../../scripts/spec/lib/meta-schema.mjs');
  const assetSet = loadSet(REPO_ROOT);
  const documents = [];
  for (const set of Object.values(assetSet.schemaSets)) {
    for (const name of set.fileNames) documents.push([name, set.documents.get(name)]);
  }
  const summary = metaValidateAll(documents);
  assert.equal(summary.validated, 36);
});

for (const [label, invalid] of [
  ['negative minLength', { type: 'string', minLength: -1 }],
  ['unknown type name', { type: 'not-a-real-type' }],
  ['exclusiveMinimum without minimum semantics', { minimum: 'five' }],
  ['required that is not an array', { type: 'object', required: 'name' }],
  ['properties that is not an object', { type: 'object', properties: [] }],
  ['enum that is empty', { enum: [] }],
]) {
  test(`meta-validation rejects ${label}`, async () => {
    const { metaValidate } = await import('../../scripts/spec/lib/meta-schema.mjs');
    const result = metaValidate({ $schema: 'http://json-schema.org/draft-07/schema#', ...invalid });
    assert.equal(result.valid, false, `${label} must be rejected by the Draft 7 meta-schema`);
    assert.ok(result.errors.length > 0);
  });
}

test('the verifier rejects a schema that declares Draft 7 but is not a valid Draft 7 schema', async () => {
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_CONTACTS);
    document.properties['@xmlns'] = { type: 'string', minLength: -1 };
    writeFixtureJson(target, EN_CONTACTS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'SCHEMA_META_INVALID', assert);
});

test('the verifier rejects a schema with an unknown type name', async () => {
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_FLOWS);
    document.type = 'objectish';
    writeFixtureJson(target, EN_FLOWS, document);
  });
  const result = await verifyInProcess(root, ['identity']);
  expectFailure(result.diagnostics, 'SCHEMA_META_INVALID', assert);
});

test('meta-validation runs offline and does not require reference resolution', async () => {
  // Meta-validation must not need the document's own references to resolve: that
  // is the separate closure check. A schema full of unresolved references is
  // still meta-valid.
  const { metaValidate } = await import('../../scripts/spec/lib/meta-schema.mjs');
  const result = metaValidate({
    $schema: 'http://json-schema.org/draft-07/schema#',
    properties: { a: { $ref: 'https://example.invalid/never-resolved.json' }, b: { $ref: './not-shipped.json#/$defs/X' } },
  });
  assert.equal(result.valid, true, `an unresolved reference is not a meta-schema violation: ${JSON.stringify(result.errors)}`);
});

// ---------------------------------------------------------------------------
// determinism and cross-checking
// ---------------------------------------------------------------------------

test('two clean builds of the same fixture produce identical manifests and archives', async () => {
  const root = makeFixtureRoot();
  const { buildCandidate } = await import('../../scripts/spec/lib/build.mjs');
  const first = buildCandidate(root);
  const second = buildCandidate(root);
  assert.equal(first.archiveSha256, second.archiveSha256, 'archive digests must match across builds');
  assert.equal(first.manifestSha256, second.manifestSha256, 'manifest digests must match across builds');
  assert.equal(canonicalJson(first.manifest), canonicalJson(second.manifest), 'manifests must be identical');
});

test('a build in a different directory produces the same archive digest', async () => {
  // Determinism must not depend on the absolute path of the build root, which is
  // what makes the release archive reproducible on another machine.
  const first = makeFixtureRoot();
  const second = makeFixtureRoot();
  const { buildCandidate } = await import('../../scripts/spec/lib/build.mjs');
  assert.equal(buildCandidate(first).archiveSha256, buildCandidate(second).archiveSha256);
});

test('archive entries are written in sorted order with fixed metadata', async () => {
  const root = makeFixtureRoot();
  const { buildArchive, writeManifest } = await import('../../scripts/spec/lib/build.mjs');
  writeManifest(root);
  const archive = buildArchive(root);
  assert.deepEqual(archive.entries, [...archive.entries].sort(), 'archive entries must be written in sorted order');
  assert.ok(archive.entries.includes('package/assets/tidas/schema.lock.json'), 'the lock must be present in the archive');
  assert.ok(archive.entries.includes('package/spec-manifest.json'), 'the manifest must be present in the archive');
});

test('a manifest regenerated over a mutated tree does not hide the mutation', async () => {
  // The strongest case: the attacker controls the manifest and the lock, but not
  // the reviewed import manifest. The mutation must still be caught.
  const root = await mutatedFixture((target) => {
    const document = readFixtureJson(target, EN_FLOWS);
    document.title = 'mutated';
    writeFixtureJson(target, EN_FLOWS, document);
  });
  const { buildCandidate } = await import('../../scripts/spec/lib/build.mjs');
  buildCandidate(root);
  const result = await verifyInProcess(root, IDENTITY);
  expectFailure(result.diagnostics, 'SOURCE_BYTES', assert);
});

test('the verifier does not read outside the root it is given', async () => {
  // A fixture with no sibling repositories present must verify on its own. This
  // is the "no tools/SDK/site checkout" requirement, expressed as a test.
  const root = makeFixtureRoot();
  const result = await verifyInProcess(root, IDENTITY);
  assert.equal(result.diagnostics.ok, true);
  assert.ok(!result.diagnostics.errors.some((item) => item.message.includes('tidas-toolkit')), 'verification must not reference a source checkout');
});
