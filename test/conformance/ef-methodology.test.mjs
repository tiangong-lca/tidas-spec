import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = fileURLToPath(new URL('../..', import.meta.url));
const methodology = YAML.parse(readFileSync(path.join(root, 'assets/tidas/methodologies/tidas_processes.yaml'), 'utf8'));
const entries = [];
function collect(value, location = []) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === '<rules>') {
      for (const rule of child) if (rule.id?.startsWith('ef.')) entries.push({ location, rule });
    } else collect(child, [...location, key]);
  }
}
collect(methodology);

test('EF methodology entries retain explicit source, applicability and normative status', () => {
  assert.ok(entries.length > 0);
  const ids = new Set();
  const sources = methodology.metadata.ef_sources;
  for (const { rule } of entries) {
    assert.ok(!ids.has(rule.id), `duplicate methodology ID: ${rule.id}`);
    ids.add(rule.id);
    assert.ok(rule.applicability?.trim(), `${rule.id}: applicability required`);
    assert.ok(rule.requirement?.trim(), `${rule.id}: requirement required`);
    assert.ok(['shall', 'should', 'may', 'informative'].includes(rule.normative_level));
    assert.ok(rule.source_refs?.length, `${rule.id}: source binding required`);
    for (const ref of rule.source_refs) {
      assert.ok(sources[ref.source]?.url, `${rule.id}: unresolved source ${ref.source}`);
      assert.ok(ref.section?.trim(), `${rule.id}: source section required`);
    }
    for (const key of ['severity', 'default_blocker', 'phase', 'authorization']) {
      assert.ok(!(key in rule), `${rule.id}: product policy ${key} is not methodology`);
    }
  }
  // Permissions and model-specific requirements must remain separate entries,
  // not one universal prohibition applied to all EF and non-EF process data.
  const byId = new Map(entries.map(({ rule }) => [rule.id, rule]));
  const permission = byId.get('ef.elementary-duplicates');
  const modelRule = byId.get('ef.eilcd-flow-uniqueness');
  assert.equal(permission.normative_level, 'may');
  assert.equal(modelRule.normative_level, 'shall');
  assert.notEqual(permission.applicability, modelRule.applicability);
  assert.equal(permission.source_refs[0].source, 'ef-data-guide-2.0');
  assert.equal(modelRule.source_refs[0].source, 'ef-eilcd-modelling-2.1');
  assert.notEqual(byId.get('ef.supporting-compliance').applicability,
    byId.get('ef.compliance-declarations').applicability);
});

const cache = new Map();
function readSchema(file) {
  if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(file, 'utf8')));
  return cache.get(file);
}
function* expand(node, file, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  yield { node, file };
  if (node.$ref) {
    const [relative, fragment = ''] = node.$ref.split('#');
    const targetFile = relative ? path.resolve(path.dirname(file), relative) : file;
    let target = readSchema(targetFile);
    if (fragment) {
      assert.ok(fragment.startsWith('/'), 'this schema-path check supports JSON Pointer fragments');
      for (const token of decodeURIComponent(fragment).slice(1).split('/')) {
        target = target[token.replace(/~1/g, '/').replace(/~0/g, '~')];
      }
    }
    yield* expand(target, targetFile, seen);
  }
  if (node.items) yield* expand(node.items, file, seen);
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    for (const branch of node[key] ?? []) yield* expand(branch, file, seen);
  }
}

test('new EF field guidance maps to real Process properties in both schema variants', () => {
  for (const language of ['schemas', 'schemas_zh']) {
    const file = path.join(root, 'assets/tidas', language, 'tidas_processes.json');
    for (const { location, rule } of entries) {
      if (location[0] === 'global_rules') continue;
      let candidates = [{ node: readSchema(file), file }];
      for (const name of location) {
        const next = [];
        for (const candidate of candidates) {
          for (const variant of expand(candidate.node, candidate.file)) {
            if (variant.node.properties?.[name]) {
              next.push({ node: variant.node.properties[name], file: variant.file });
            }
          }
        }
        assert.ok(next.length, `${language}: ${rule.id} has no schema property ${location.join('.')} at ${name}`);
        candidates = next;
      }
    }
  }
});
