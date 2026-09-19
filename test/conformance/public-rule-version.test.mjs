import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

function readJson(relative) {
  return JSON.parse(readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8'));
}

test('Process version public rule agrees with the authoritative Version schema', () => {
  const index = readJson('assets/tidas/rules/public-rules.v1.json');
  const dataTypes = readJson('assets/tidas/schemas/tidas_data_types.json');
  const methodology = YAML.parse(readFileSync(new URL('../../assets/tidas/methodologies/tidas_processes.yaml', import.meta.url), 'utf8'));
  const version = new RegExp(dataTypes.$defs.Version.pattern);
  const rule = index.rules.find((item) => item.id === 'tidas.process.version.format');
  const source = methodology.processDataSet.administrativeInformation.publicationAndOwnership['common:dataSetVersion']['<rules>'][0];

  assert.equal(index.rules_version, '2026.09.20');
  assert.ok(rule, 'public Process version rule must exist');
  assert.match(rule.statement, /NN\.NN.*NN\.NN\.NNN/);
  assert.equal(source.format, 'NN.NN or NN.NN.NNN');
  for (const example of source.examples) assert.equal(version.test(example), true, `${example} source example must satisfy Version`);
  for (const valid of ['01.02', '01.02.003']) {
    assert.equal(version.test(valid), true, `${valid} must satisfy Version`);
    assert.ok(rule.cases.positive.some((example) => example.includes(valid)), `${valid} must have a positive case`);
  }
  for (const invalid of ['1.1', '01.02.03']) {
    assert.equal(version.test(invalid), false, `${invalid} must fail Version`);
    assert.ok(rule.cases.negative.some((example) => example.includes(invalid)), `${invalid} must have a negative case`);
  }
});
