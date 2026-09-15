// Unit tests for the build primitives.
//
// These cover the pieces whose correctness the higher-level checks depend on:
// canonical serialization (the basis of every digest), the ustar reader/writer,
// JSON pointer handling, the duplicate-key scanner, and the package whitelist
// glob. A regression in any of them would show up as a confusing failure
// somewhere else, so they are pinned directly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { canonicalJson, formatJson, hashCanonicalJson, assertNoDuplicateJsonKeys, sha256Hex, SpecError } from '../../scripts/spec/lib/core.mjs';
import { readTarEntries, createDeterministicTarGz } from '../../scripts/spec/lib/tar.mjs';
import { anchorsFor, buildCatalog, checkClosure, classifySiblingKeyword, collectReferences, decodeFragmentOnce, decodeJsonPointerToken, escapePointerToken, INSTANCE_DATA_KEYWORDS, pointerExists, prepareCatalog, resolveReference, resourceIndexOf } from '../../scripts/spec/lib/refs.mjs';
import { globToRegExp } from '../../scripts/spec/lib/package-content.mjs';
import { contractNode, diffLocks } from '../../scripts/spec/lib/lock.mjs';

function expectSpecError(fn, code) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof SpecError, `expected a SpecError, got ${error}`);
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`expected a ${code} SpecError`);
}

// ---------------------------------------------------------------------------
// canonical JSON
// ---------------------------------------------------------------------------

test('canonical JSON sorts object keys at every depth', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test('canonical JSON preserves array order', () => {
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
});

test('canonical JSON distinguishes key order only in that it normalizes it', () => {
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.equal(hashCanonicalJson({ a: 1, b: 2 }), hashCanonicalJson({ b: 2, a: 1 }));
});

test('canonical JSON escapes strings the same way JSON does', () => {
  assert.equal(canonicalJson('a"b\n'), JSON.stringify('a"b\n'));
  assert.equal(canonicalJson('中文'), '"中文"');
});

test('canonical JSON refuses values it cannot represent deterministically', () => {
  expectSpecError(() => canonicalJson(Number.NaN), 'CANONICAL_NUMBER');
  expectSpecError(() => canonicalJson(Number.POSITIVE_INFINITY), 'CANONICAL_NUMBER');
  expectSpecError(() => canonicalJson(-0), 'CANONICAL_NUMBER');
  expectSpecError(() => canonicalJson({ a: undefined }), 'CANONICAL_UNDEFINED');
  expectSpecError(() => canonicalJson(() => {}), 'CANONICAL_TYPE');
});

test('canonical JSON handles nested null and booleans', () => {
  assert.equal(canonicalJson({ z: null, y: false, x: true }), '{"x":true,"y":false,"z":null}');
});

test('formatJson is the canonical build format', () => {
  assert.equal(formatJson({ b: 1, a: [1, 2] }), '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}\n');
  assert.ok(formatJson({ a: 1 }).endsWith('\n'));
  assert.equal(formatJson({ a: 1 }), '{\n  "a": 1\n}\n');
});

test('sha256Hex hashes bytes and strings identically for UTF-8 input', () => {
  assert.equal(sha256Hex('abc'), sha256Hex(Buffer.from('abc', 'utf8')));
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

// ---------------------------------------------------------------------------
// duplicate key scanner
// ---------------------------------------------------------------------------

test('duplicate-key scanner accepts well-formed JSON', () => {
  assertNoDuplicateJsonKeys('{"a":1,"b":{"a":2},"c":[{"a":3},{"a":4}]}', 'test');
});

test('duplicate-key scanner rejects a duplicate at the top level', () => {
  expectSpecError(() => assertNoDuplicateJsonKeys('{"a":1,"a":2}', 'test'), 'JSON_DUPLICATE_KEY');
});

test('duplicate-key scanner rejects a duplicate in a nested object', () => {
  expectSpecError(() => assertNoDuplicateJsonKeys('{"x":{"a":1,"a":2}}', 'test'), 'JSON_DUPLICATE_KEY');
});

test('duplicate-key scanner accepts the same key in sibling objects', () => {
  assertNoDuplicateJsonKeys('{"x":{"a":1},"y":{"a":2}}', 'test');
});

test('duplicate-key scanner does not confuse string content with keys', () => {
  assertNoDuplicateJsonKeys('{"a":"{\\"a\\":1,\\"a\\":2}"}', 'test');
});

test('duplicate-key scanner rejects an unterminated string', () => {
  expectSpecError(() => assertNoDuplicateJsonKeys('{"a":"unterminated}', 'test'), 'JSON_PARSE');
});

// ---------------------------------------------------------------------------
// JSON pointers
// ---------------------------------------------------------------------------

test('pointerExists resolves objects, arrays, and escapes', () => {
  const document = { 'a/b': [{ '~key': true }], 'with space': true };
  assert.equal(pointerExists(document, '/a~1b/0/~0key', 'test', 'ref'), true);
  assert.equal(pointerExists(document, '/with%20space', 'test', 'ref'), false);
  assert.equal(pointerExists(document, '/with space', 'test', 'ref'), true);
  assert.equal(pointerExists(document, '/a~1b/1', 'test', 'ref'), false);
  assert.equal(pointerExists(document, '/missing', 'test', 'ref'), false);
  assert.equal(pointerExists(document, '', 'test', 'ref'), true);
});

test('pointerExists refuses array indices with leading zeros or signs', () => {
  const document = { items: ['a', 'b'] };
  assert.equal(pointerExists(document, '/items/01', 'test', 'ref'), false);
  assert.equal(pointerExists(document, '/items/1', 'test', 'ref'), true);
  assert.equal(pointerExists(document, '/items/-', 'test', 'ref'), false);
});

test('pointerExists descends only into own properties', () => {
  assert.equal(pointerExists({}, '/toString', 'test', 'ref'), false);
});

// ---------------------------------------------------------------------------
// JSON Pointer decoding (RFC 6901)
// ---------------------------------------------------------------------------

test('pointer decoding applies RFC 6901 tilde rules', () => {
  assert.equal(decodeJsonPointerToken('a~1b', 'test', 'ref'), 'a/b');
  assert.equal(decodeJsonPointerToken('a~0b', 'test', 'ref'), 'a~b');
  // `~01` is `~0` followed by `1`, so it decodes to `~1`, not to `/`.
  assert.equal(decodeJsonPointerToken('a~01b', 'test', 'ref'), 'a~1b');
  assert.equal(decodeJsonPointerToken('plain', 'test', 'ref'), 'plain');
  assert.equal(decodeJsonPointerToken('', 'test', 'ref'), '');
});

test('pointer decoding rejects malformed tilde escapes', () => {
  // RFC 6901 allows only `~0` and `~1`; `~2` must not become a lookup for a
  // member literally named `~2`.
  expectSpecError(() => decodeJsonPointerToken('~2', 'test', '#/~2'), 'REF_POINTER_ESCAPE');
  expectSpecError(() => decodeJsonPointerToken('a~', 'test', '#/a~'), 'REF_POINTER_ESCAPE');
  expectSpecError(() => decodeJsonPointerToken('~x', 'test', '#/~x'), 'REF_POINTER_ESCAPE');
});

test('pointer decoding does not percent-decode', () => {
  // Percent-decoding is the URI layer and happens exactly once, in the resolver.
  assert.equal(decodeJsonPointerToken('%2F', 'test', 'ref'), '%2F');
  assert.equal(decodeJsonPointerToken('%252F', 'test', 'ref'), '%252F');
});

test('escapePointerToken round-trips through decodeJsonPointerToken', () => {
  for (const token of ['a/b', 'a~b', '~1', 'a~1b', 'plain', '中文']) {
    assert.equal(decodeJsonPointerToken(escapePointerToken(token), 'test', 'ref'), token);
  }
});

test('decodeFragmentOnce applies exactly one URI decoding layer', () => {
  assert.equal(decodeFragmentOnce('%2F', 'test', '#/%2F'), '/');
  assert.equal(decodeFragmentOnce('%252F', 'test', '#/%252F'), '%2F');
  assert.equal(decodeFragmentOnce('%E4%B8%AD', 'test', 'ref'), '中');
  expectSpecError(() => decodeFragmentOnce('%zz', 'test', 'ref'), 'REF_FRAGMENT_ENCODING');
});

// ---------------------------------------------------------------------------
// reference resolution
// ---------------------------------------------------------------------------

function catalogFor(documents) {
  return buildCatalog(new Map(Object.entries(documents)));
}

test('resolveReference resolves a relative sibling file', () => {
  const catalog = catalogFor({ 'assets/tidas/schemas/a.json': {}, 'assets/tidas/schemas/b.json': {} });
  assert.deepEqual(resolveReference('./b.json', 'assets/tidas/schemas/a.json', catalog), { packagePath: 'assets/tidas/schemas/b.json', pointer: '' });
});

test('resolveReference applies one URI decoding layer, then RFC 6901 escapes', () => {
  // Three distinct member names that are easy to confuse with each other, plus a
  // pointer that must only ever address one of them.
  const catalog = catalogFor({
    'assets/tidas/schemas/a.json': { $defs: { X: {} }, '/': 'slash', '%2F': 'percent-two-f', '~2': 'tilde-two' },
  });
  const at = (reference) => resolveReference(reference, 'assets/tidas/schemas/a.json', catalog).pointer;

  assert.equal(at('#/$defs/X'), '/$defs/X');
  // A member named `/` is escaped as `~1`, or percent-encoded once as `%2F`.
  assert.equal(at('#/~1'), '/~1');
  // A member named `%2F` needs the percent sign escaped too: `%252F` decodes once
  // to `%2F`, which is then one pointer token.
  // The resolved pointer is the URI-decoded fragment with its RFC 6901 escapes
  // intact, so this one is the single token `%2F`.
  assert.equal(at('#/%252F'), '/%2F');
  // `%2F` decodes once to `/`, so this fragment is the two-token pointer `//`
  // and addresses member `""` twice -- not the member named `%2F`, and not the
  // member named `/`. Double-decoding would wrongly reach the former.
  expectSpecError(() => at('#/%2F'), 'REF_MISSING_FRAGMENT');
  // A member named `~2` is reached through `~0` followed by `2`.
  assert.equal(at('#/~02'), '/~02');
  // `~2` is not a valid escape, so it must not become a lookup for that member.
  expectSpecError(() => at('#/~2'), 'REF_POINTER_ESCAPE');
});

test('resolveReference reaches a Unicode member through a percent-encoded fragment', () => {
  const catalog = catalogFor({ 'assets/tidas/schemas/a.json': { '中文': { type: 'string' } } });
  assert.deepEqual(resolveReference('#/%E4%B8%AD%E6%96%87', 'assets/tidas/schemas/a.json', catalog), { packagePath: 'assets/tidas/schemas/a.json', pointer: '/中文' });
});

test('resolveReference refuses to escape the package root', () => {
  const catalog = catalogFor({ 'assets/tidas/schemas/a.json': {} });
  expectSpecError(() => resolveReference('../../../../etc/passwd', 'assets/tidas/schemas/a.json', catalog), 'REF_ESCAPE');
});

test('resolveReference refuses a sibling-directory escape that lands inside the package', () => {
  const catalog = catalogFor({ 'assets/tidas/schemas/a.json': {} });
  const error = expectSpecError(() => resolveReference('../../etc/passwd', 'assets/tidas/schemas/a.json', catalog), 'REF_OUTSIDE_SCHEMA_SETS');
  assert.match(error.message, /assets\/etc\/passwd/);
});

test('resolveReference refuses a reference that resolves to a non-schema package file', () => {
  const catalog = catalogFor({ 'assets/tidas/schemas/a.json': {} });
  expectSpecError(() => resolveReference('../schema.lock.json', 'assets/tidas/schemas/a.json', catalog), 'REF_OUTSIDE_SCHEMA_SETS');
});

test('resolveReference refuses a network reference', () => {
  const catalog = catalogFor({ 'assets/tidas/schemas/a.json': {} });
  expectSpecError(() => resolveReference('https://example.invalid/x.json', 'assets/tidas/schemas/a.json', catalog), 'REF_NETWORK');
  expectSpecError(() => resolveReference('//example.invalid/x.json', 'assets/tidas/schemas/a.json', catalog), 'REF_NETWORK');
});

test('resolveReference refuses an external scheme and an absolute path', () => {
  const catalog = catalogFor({ 'assets/tidas/schemas/a.json': {} });
  expectSpecError(() => resolveReference('file:///etc/passwd', 'assets/tidas/schemas/a.json', catalog), 'REF_EXTERNAL_SCHEME');
  expectSpecError(() => resolveReference('/etc/passwd', 'assets/tidas/schemas/a.json', catalog), 'REF_ABSOLUTE');
});

test('resolveReference resolves a defined anchor and rejects an undefined one', () => {
  // The anchor sits in a `properties` member: a schema position reached from the
  // document root, so it is declared as far as discovery is concerned.
  const catalog = catalogFor({ 'assets/tidas/schemas/a.json': { properties: { X: { $id: '#anchor-x', type: 'string' } } } });
  assert.deepEqual(resolveReference('#anchor-x', 'assets/tidas/schemas/a.json', catalog), { packagePath: 'assets/tidas/schemas/a.json', pointer: '/properties/X' });
  expectSpecError(() => resolveReference('#anchor-y', 'assets/tidas/schemas/a.json', catalog), 'REF_MISSING_FRAGMENT');
});

test('an anchor in a $defs member is declared only once a reference reaches it', () => {
  // `$defs` is not a Draft 7 schema position, so an unreferenced member is data
  // and its `$id` is not a declaration. A reference into it makes it a schema
  // position, and the anchor declared there becomes resolvable.
  const unreached = catalogFor({ 'assets/tidas/schemas/a.json': { $defs: { X: { $id: '#anchor-x', type: 'string' } } } });
  expectSpecError(() => resolveReference('#anchor-x', 'assets/tidas/schemas/a.json', unreached), 'REF_MISSING_FRAGMENT');

  const reached = catalogFor({
    'assets/tidas/schemas/a.json': { $defs: { X: { $id: '#anchor-x', type: 'string' } }, properties: { p: { $ref: '#/$defs/X' } } },
  });
  assert.deepEqual(resolveReference('#anchor-x', 'assets/tidas/schemas/a.json', reached), { packagePath: 'assets/tidas/schemas/a.json', pointer: '/$defs/X' });
});

test('resolveReference rejects a missing pointer fragment', () => {
  const catalog = catalogFor({ 'assets/tidas/schemas/a.json': { $defs: {} } });
  expectSpecError(() => resolveReference('#/$defs/Absent', 'assets/tidas/schemas/a.json', catalog), 'REF_MISSING_FRAGMENT');
});

// ---------------------------------------------------------------------------
// closure: reachability, not keyword classification
// ---------------------------------------------------------------------------

function closureErrors(documents) {
  const catalog = catalogFor(documents);
  const found = [];
  checkClosure(catalog, (entry) => found.push(`${entry.kind}:${entry.code}`));
  void 0;
  return { found, catalog };
}

test('closure reaches $defs entries through a real reference and follows their own refs', () => {
  // The reviewed source stores definitions under `$defs`, a keyword Draft 7 does
  // not define. A referenced member is a live schema position, so its own
  // reference must be followed.
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': { $defs: { X: { $ref: '#/$defs/Absent' } }, $ref: '#/$defs/X' },
  });
  // The `$ref` at the document root carries a `$defs` container sibling, which is
  // reported as informational applicability, not as a conflict.
  assert.ok(found.includes('reference:REF_MISSING_FRAGMENT'), `the transitive reference must be followed and must fail; got ${found.join(', ')}`);
  assert.ok(!found.some((entry) => entry.includes('conflict')), `a definitions container is not a conflicting sibling; got ${found.join(', ')}`);
});

test('closure ignores an unreferenced member of an extension keyword', () => {
  // Nothing reaches this member, so its reference is not part of the closure.
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': { type: 'object', $defs: { Unused: { $ref: 'https://invalid.example/x' } } },
  });
  assert.deepEqual(found, [], 'an unreferenced extension member must not create a reference');
});

test('closure ignores later-draft keywords that are not reached by a reference', () => {
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': {
      type: 'object',
      dependentSchemas: { a: { $ref: 'https://invalid.example/dep' } },
      unevaluatedProperties: { $ref: 'https://invalid.example/uneval' },
      prefixItems: [{ $ref: 'https://invalid.example/prefix' }],
    },
  });
  assert.deepEqual(found, [], 'keywords outside the declared dialect are not schema positions on their own authority');
});

test('the anchor index records a duplicate anchor instead of picking one', () => {
  const catalog = catalogFor({
    'assets/tidas/schemas/a.json': { properties: { A: { $id: '#dup' }, B: { $id: '#dup' } } },
  });
  const { duplicates, anchors } = anchorsFor(catalog, 'assets/tidas/schemas/a.json');
  assert.equal(anchors.get('dup'), '/properties/A');
  // Each duplicate carries its own location, because a duplicate across two files
  // is as much a conflict as one within a single file.
  assert.deepEqual(duplicates.get('dup'), [
    { packagePath: 'assets/tidas/schemas/a.json', pointer: '/properties/A' },
    { packagePath: 'assets/tidas/schemas/a.json', pointer: '/properties/B' },
  ]);
});

test('re-registering the same anchor declaration is idempotent', () => {
  // Static discovery and reference-reachability discovery both arrive at a
  // declaration. That is one declaration, not a duplicate.
  const catalog = catalogFor({
    'assets/tidas/schemas/a.json': { $defs: { X: { $id: '#once', type: 'string' } }, properties: { p: { $ref: '#/$defs/X' } } },
  });
  const { duplicates, anchors } = anchorsFor(catalog, 'assets/tidas/schemas/a.json');
  assert.equal(anchors.get('once'), '/$defs/X');
  assert.deepEqual([...duplicates.keys()], [], 'a declaration reached twice is still one declaration');
});

test('an $id inside instance data is not a resource or anchor declaration', () => {
  // `examples` carries instance data. Two identical-looking `$id`s there are just
  // two data values, not a conflicting declaration.
  const catalog = catalogFor({
    'assets/tidas/schemas/a.json': { type: 'object', examples: [{ $id: 'same.json' }, { $id: 'same.json' }] },
  });
  const { resources, conflicts } = resourceIndexOf(catalog);
  assert.deepEqual(conflicts, []);
  assert.equal(resources.size, 1, 'only the retrieval URI is a resource');
});

test('closure reports a local cycle without looping forever', () => {
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': { $defs: { A: { $ref: '#/$defs/B' }, B: { $ref: '#/$defs/A' } }, $ref: '#/$defs/A' },
  });
  assert.deepEqual(found.filter((entry) => entry.startsWith('reference:')), [], 'a local cycle resolves and must terminate');
});

test('closure reports an unresolvable scalar target', () => {
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': { $defs: { X: { const: 1 } }, $ref: '#/$defs/X' },
  });
  assert.deepEqual(found.filter((entry) => entry.startsWith('reference:')), [], 'a scalar target resolves; only its references matter');
});

test('sibling keywords are classified as assertions, non-assertions, or unknown', () => {
  // The classification answers "does this sibling change which instances are
  // valid", which is a different question from "may this value be traversed".
  assert.equal(classifySiblingKeyword('const'), 'assertion');
  assert.equal(classifySiblingKeyword('enum'), 'assertion');
  assert.equal(classifySiblingKeyword('type'), 'assertion');
  assert.equal(classifySiblingKeyword('format'), 'assertion');
  assert.equal(classifySiblingKeyword('maxLength'), 'assertion');
  assert.equal(classifySiblingKeyword('pattern'), 'assertion');
  assert.equal(classifySiblingKeyword('required'), 'assertion');
  assert.equal(classifySiblingKeyword('not'), 'assertion');

  assert.equal(classifySiblingKeyword('description'), 'non-assertion');
  assert.equal(classifySiblingKeyword('title'), 'non-assertion');
  assert.equal(classifySiblingKeyword('examples'), 'non-assertion');
  assert.equal(classifySiblingKeyword('definitions'), 'non-assertion');
  assert.equal(classifySiblingKeyword('$defs'), 'non-assertion');

  // Unrecognised keywords are their own category. They are not evidence of an
  // assertion, and they are not evidence of agreement either.
  assert.equal(classifySiblingKeyword('x-custom-rule'), 'unknown');
});

test('const and enum are assertions even though they are never traversed', () => {
  // The two questions that an earlier revision conflated. Instance data need not
  // be descended into to restrict the instance.
  for (const keyword of ['const', 'enum']) {
    assert.equal(INSTANCE_DATA_KEYWORDS.has(keyword), true, `${keyword} is instance data`);
    assert.equal(classifySiblingKeyword(keyword), 'assertion', `${keyword} is also an assertion`);
  }
});

test('closure separates constraint-bearing siblings from non-asserting ones', () => {
  const constraint = closureErrors({
    'assets/tidas/schemas/a.json': { definitions: { X: { type: 'string' } }, $ref: '#/definitions/X', const: '0' },
  });
  assert.ok(constraint.found.some((entry) => entry.includes('ref-sibling-conflict')), `expected a conflict, got ${constraint.found.join(', ')}`);
  assert.deepEqual(constraint.found.filter((entry) => entry.includes('ref-applicability')), [], 'a constraint-bearing object is not an annotation-only object');

  const harmless = closureErrors({
    'assets/tidas/schemas/a.json': { definitions: { X: { type: 'string' } }, $ref: '#/definitions/X', description: 'documented in place' },
  });
  assert.ok(harmless.found.some((entry) => entry.includes('ref-applicability')), `expected applicability, got ${harmless.found.join(', ')}`);
  assert.deepEqual(harmless.found.filter((entry) => entry.includes('ref-sibling-conflict')), [], 'an annotation asserts nothing');

  const mixed = closureErrors({
    'assets/tidas/schemas/a.json': { definitions: { X: { type: 'string' } }, $ref: '#/definitions/X', description: 'd', const: '0' },
  });
  assert.ok(mixed.found.some((entry) => entry.includes('ref-sibling-conflict')), `expected a conflict, got ${mixed.found.join(', ')}`);
  assert.deepEqual(mixed.found.filter((entry) => entry.includes('ref-applicability')), [], 'a mixed object must not be counted as annotation-only');
});

test('closure reports each assertion keyword of a mixed sibling set', () => {
  const { catalog } = closureErrors({
    'assets/tidas/schemas/a.json': { definitions: { X: {} }, $ref: '#/definitions/X', type: 'string', format: 'email', maxLength: 5, description: 'd' },
  });
  const found = [];
  checkClosure(catalog, (entry) => { if (entry.code === 'ref-sibling-conflict') found.push(entry); });
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].detail.siblings.slice().sort(), ['format', 'maxLength', 'type']);
});

test('an unknown sibling keyword is reported as unclassified, not as an assertion', () => {
  // The dialect does not define this keyword, so its semantics are unknown. It is
  // reported so it stays visible, and it is explicitly *not* counted as a
  // constraint or as a cause of evaluator disagreement.
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': { definitions: { X: {} }, $ref: '#/definitions/X', 'x-custom-rule': true },
  });
  assert.ok(found.some((entry) => entry.includes('ref-sibling-unclassified')), `an unknown keyword must stay visible, got ${found.join(', ')}`);
  assert.deepEqual(found.filter((entry) => entry.includes('ref-sibling-conflict')), [], 'an unknown keyword is not an established assertion');
  assert.deepEqual(found.filter((entry) => entry.includes('ref-applicability')), [], 'it is not a known annotation either');
});

test('an unknown sibling beside a known assertion is surfaced with it, not counted as one', () => {
  const { catalog } = closureErrors({
    'assets/tidas/schemas/a.json': { definitions: { X: {} }, $ref: '#/definitions/X', const: '0', 'x-custom-rule': true },
  });
  const conflicts = [];
  checkClosure(catalog, (entry) => { if (entry.code === 'ref-sibling-conflict') conflicts.push(entry); });
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].detail.siblings, ['const'], 'only the known assertion is counted as one');
  assert.deepEqual(conflicts[0].detail.unclassifiedSiblings, ['x-custom-rule'], 'the extension keyword stays visible alongside it');
});

test('closure ignores fake refs inside sibling instance data', () => {
  // The `examples` payload carries a `$ref`-shaped key. It is data, and the
  // sibling it sits in asserts nothing, so the object is annotation-only.
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': {
      definitions: { X: {} },
      $ref: '#/definitions/X',
      examples: [{ $ref: 'https://invalid.example/x' }],
      default: { $ref: 'nope.json' },
    },
  });
  assert.ok(found.some((entry) => entry.includes('ref-applicability')), `expected applicability, got ${found.join(', ')}`);
  assert.deepEqual(found.filter((entry) => entry.includes('ref-sibling-conflict')), [], 'instance data asserts nothing');
  assert.deepEqual(found.filter((entry) => entry.startsWith('reference:')), [], 'instance data is not traversed');
});

test('closure reports a $ref object whose sibling is itself a subschema', () => {
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': { definitions: { X: { type: 'string' } }, $ref: '#/definitions/X', allOf: [{ type: 'string' }] },
  });
  assert.ok(found.some((entry) => entry.includes('ref-sibling-conflict')), `expected a sibling conflict, got ${found.join(', ')}`);
});

test('closure accepts annotation-only siblings of $ref', () => {
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': { definitions: { X: { type: 'string' } }, $ref: '#/definitions/X', description: 'documented in place' },
  });
  assert.ok(found.every((entry) => !entry.includes('conflict')), `annotation siblings change nothing under Draft 7; got ${found.join(', ')}`);
});

test('closure reports a $ref object in the frame itself, with its subschema siblings', () => {
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': { $ref: '#/definitions/X', properties: { a: { type: 'string' } } },
  });
  assert.ok(found.some((entry) => entry.includes('ref-sibling-conflict')), `expected a sibling conflict, got ${found.join(', ')}`);
});

test('closure resolves references through a locally available nested $id', () => {
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': {
      definitions: { N: { $id: 'nested.json', definitions: { V: { type: 'string' } } } },
      properties: { p: { $ref: 'nested.json#/definitions/V' } },
    },
  });
  assert.deepEqual(found.filter((entry) => entry.includes('reference')), [], `a locally resolvable resource must resolve: ${found.join(', ')}`);
});

test('a declared absolute $id is a local alias, not a network request', () => {
  // Offline does not mean "every absolute identifier is forbidden". A resource
  // the package itself declares is resolvable without fetching anything.
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': {
      $id: 'https://example.invalid/schemas/a.json',
      definitions: { V: { type: 'string' } },
      properties: { p: { $ref: 'https://example.invalid/schemas/a.json#/definitions/V' } },
    },
  });
  assert.deepEqual(found.filter((entry) => entry.startsWith('reference:')), [], `a declared alias must resolve locally: ${found.join(', ')}`);
});

test('closure reports an absolute reference to a resource nothing declares', () => {
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': { properties: { p: { $ref: 'https://example.invalid/undeclared.json' } } },
  });
  assert.ok(found.some((entry) => entry.includes('REF_NETWORK')), `expected a network refusal, got ${found.join(', ')}`);
});

test('closure rejects a reference to a scalar or array target but accepts boolean schemas', () => {
  const scalar = closureErrors({ 'assets/tidas/schemas/a.json': { $ref: '#/$defs/x', $defs: { x: 7 } } });
  assert.ok(scalar.found.some((entry) => entry.includes('REF_NON_SCHEMA_TARGET')), `expected a non-schema rejection, got ${scalar.found.join(', ')}`);

  const array = closureErrors({ 'assets/tidas/schemas/a.json': { $ref: '#/$defs/x', $defs: { x: [] } } });
  assert.ok(array.found.some((entry) => entry.includes('REF_NON_SCHEMA_TARGET')), `expected a non-schema rejection, got ${array.found.join(', ')}`);

  // Draft 7 permits a boolean schema, so `true` is a legitimate target.
  const boolean = closureErrors({ 'assets/tidas/schemas/a.json': { $ref: '#/$defs/x', $defs: { x: true } } });
  assert.deepEqual(boolean.found.filter((entry) => entry.startsWith('reference:')), [], `a boolean schema must be accepted: ${boolean.found.join(', ')}`);
});

test('closure reports a resource base established twice', () => {
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': { definitions: { A: { $id: 'dup.json' }, B: { $id: 'dup.json' } } },
  });
  assert.ok(found.some((entry) => entry.includes('REF_RESOURCE_CONFLICT')), `expected a resource-conflict report, got ${found.join(', ')}`);
});

test('closure reports a reference to an id nothing declares', () => {
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': { properties: { p: { $ref: 'nobody-declares-this.json#/x' } } },
  });
  assert.ok(found.some((entry) => entry.includes('REF_MISSING_TARGET')), `expected a missing-target report, got ${found.join(', ')}`);
});

test('closure does not invent references inside instance data', () => {
  const { found } = closureErrors({
    'assets/tidas/schemas/a.json': {
      properties: { a: { type: 'string' } },
      examples: [{ $ref: 'https://invalid.example/x' }],
      default: { $ref: 'https://invalid.example/y' },
      enum: [{ $ref: 'https://invalid.example/z' }],
    },
  });
  assert.deepEqual(found, []);
});

test('collectReferences follows reachable references only', () => {
  const catalog = catalogFor({
    'assets/tidas/schemas/a.json': { $defs: { Used: { $ref: '#/$defs/Leaf' }, Leaf: { type: 'string' }, Unused: { $ref: '#/$defs/Absent' } }, $ref: '#/$defs/Used' },
  });
  const references = collectReferences(catalog);
  const list = [...references.values()].map((entry) => entry.reference).sort();
  assert.deepEqual(list, ['#/$defs/Leaf', '#/$defs/Used']);
});

// ---------------------------------------------------------------------------
// glob whitelist matching
// ---------------------------------------------------------------------------

test('glob patterns match the package whitelist shapes', () => {
  assert.equal(globToRegExp('assets/').test('assets/tidas/schema.lock.json'), true);
  assert.equal(globToRegExp('assets/**').test('assets/a/b.json'), true);
  assert.equal(globToRegExp('assets/tidas/schemas/*.json').test('assets/tidas/schemas/a.json'), true);
  assert.equal(globToRegExp('assets/tidas/schemas/*.json').test('assets/tidas/schemas_zh/a.json'), false);
  assert.equal(globToRegExp('assets/tidas/schemas/*.json').test('assets/tidas/schemas/nested/a.json'), false);
  assert.equal(globToRegExp('spec-manifest.json').test('spec-manifest.json'), true);
  assert.equal(globToRegExp('spec-manifest.json').test('other-manifest.json'), false);
});

test('glob metacharacters in a literal pattern are escaped', () => {
  assert.equal(globToRegExp('a.b').test('axb'), false);
  assert.equal(globToRegExp('a+b').test('a+b'), true);
});

// ---------------------------------------------------------------------------
// contract view
// ---------------------------------------------------------------------------

test('contractNode strips only the declared localized keys', () => {
  // `contractNode` removes the localization allowance wherever it appears, which
  // is what the pinned source lock does. The verifier separately refuses a schema
  // that declares an instance *property* under such a name, because there the
  // removal would drop a real constraint instead of a translation; that guard is
  // covered by the conformance suite.
  const localized = new Set(['description']);
  const document = { description: 'localized', title: 'stable', properties: { child: { type: 'string' } } };
  assert.deepEqual(contractNode(document, localized), { title: 'stable', properties: { child: { type: 'string' } } });
});

test('contractNode strips at every depth', () => {
  const localized = new Set(['description']);
  const document = { a: { description: 'x', b: [{ description: 'y', c: 1 }] } };
  assert.deepEqual(contractNode(document, localized), { a: { b: [{ c: 1 }] } });
});

test('contractNode keeps an empty object rather than dropping it', () => {
  const localized = new Set(['description']);
  assert.deepEqual(contractNode({ description: 'x' }, localized), {});
  assert.deepEqual(contractNode([{ description: 'x' }], localized), [{}]);
});

// ---------------------------------------------------------------------------
// lock comparison
// ---------------------------------------------------------------------------

test('diffLocks reports no differences for equal values', () => {
  assert.deepEqual(diffLocks({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }), []);
});

test('diffLocks reports structural differences with their path', () => {
  const differences = diffLocks({ a: { b: 1 } }, { a: { b: 2 } });
  assert.equal(differences.length, 1);
  assert.match(differences[0], /\/a\/b/);
});

test('diffLocks reports missing and extra keys by path', () => {
  assert.match(diffLocks({ a: 1 }, {}).join(' '), /\/a/);
  assert.match(diffLocks({}, { a: 1 }).join(' '), /\/a/);
});

test('diffLocks reports array length changes and element differences', () => {
  assert.match(diffLocks({ a: [1] }, { a: [1, 2] }).join(' '), /length/);
  assert.match(diffLocks({ a: [1] }, { a: [2] }).join(' '), /\/a\/0/);
});

// ---------------------------------------------------------------------------
// deterministic tar
// ---------------------------------------------------------------------------

test('tar round-trips entry names and content', () => {
  const entries = [
    { entry: 'package/a.txt', content: Buffer.from('hello') },
    { entry: 'package/dir/b.bin', content: Buffer.from([0, 1, 2, 255]) },
  ];
  const archive = createDeterministicTarGz(entries);
  const read = readTarEntries(gunzipSync(archive));
  assert.deepEqual(read.map((item) => item.entry), ['package/a.txt', 'package/dir/b.bin']);
  assert.equal(read[0].content.toString('utf8'), 'hello');
  assert.deepEqual([...read[1].content], [0, 1, 2, 255]);
});

test('tar output is byte-identical across runs', () => {
  const entries = [{ entry: 'package/a.txt', content: Buffer.from('hello') }];
  assert.equal(createDeterministicTarGz(entries).toString('hex'), createDeterministicTarGz(entries).toString('hex'));
});

test('tar output is independent of input entry order', () => {
  const a = createDeterministicTarGz([{ entry: 'package/b', content: Buffer.from('2') }, { entry: 'package/a', content: Buffer.from('1') }]);
  const b = createDeterministicTarGz([{ entry: 'package/a', content: Buffer.from('1') }, { entry: 'package/b', content: Buffer.from('2') }]);
  assert.equal(a.toString('hex'), b.toString('hex'));
});

test('tar writer pads entries to the block size', () => {
  const archive = createDeterministicTarGz([{ entry: 'package/a', content: Buffer.alloc(513, 1) }]);
  const header = archive.subarray(0, 0); // gzip, so just check the reader round-trips
  void header;
  assert.equal(readTarEntries(gunzipSync(archive))[0].content.length, 513);
});

test('tar writer refuses paths that escape the archive', () => {
  expectSpecError(() => createDeterministicTarGz([{ entry: '../escape.txt', content: Buffer.from('x') }]), 'TAR_NAME');
  expectSpecError(() => createDeterministicTarGz([{ entry: '/absolute.txt', content: Buffer.from('x') }]), 'TAR_NAME');
});

test('tar reader refuses a non-regular entry', () => {
  const archive = gunzipSync(createDeterministicTarGz([{ entry: 'package/a', content: Buffer.from('x') }]));
  // Flip the typeflag to a symbolic link and repair the checksum.
  archive[156] = '2'.charCodeAt(0);
  archive.fill(0x20, 148, 156);
  let checksum = 0;
  for (const byte of archive.subarray(0, 512)) checksum += byte;
  archive.write(checksum.toString(8).padStart(6, '0'), 148, 'ascii');
  archive[154] = 0;
  archive[155] = 0x20;
  expectSpecError(() => readTarEntries(archive), 'TAR_ENTRY_TYPE');
});

test('tar reader refuses a traversal entry', () => {
  const tar = Buffer.alloc(512 * 3, 0);
  Buffer.from('../escape.txt').copy(tar, 0);
  tar.write('0000644', 100, 'ascii');
  tar.write('0000000', 108, 'ascii');
  tar.write('0000000', 116, 'ascii');
  tar.write('00000000000', 124, 'ascii');
  tar.write('00000000000', 136, 'ascii');
  tar.fill(0x20, 148, 156);
  tar[156] = '0'.charCodeAt(0);
  tar.write('ustar', 257, 'ascii');
  let checksum = 0;
  for (const byte of tar.subarray(0, 512)) checksum += byte;
  tar.write(checksum.toString(8).padStart(6, '0'), 148, 'ascii');
  tar[154] = 0;
  tar[155] = 0x20;
  expectSpecError(() => readTarEntries(tar), 'TAR_PATH');
});
