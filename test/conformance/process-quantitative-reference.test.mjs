import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
}

function compileProcessField(languageDirectory, field) {
  const schema = readJson(`assets/tidas/${languageDirectory}/tidas_processes.json`);
  const dataTypes = readJson(`assets/tidas/${languageDirectory}/tidas_data_types.json`);
  const processInformation = schema.properties.processDataSet.properties.processInformation;
  const target = field === 'quantitativeReference'
    ? processInformation.properties.quantitativeReference
    : schema.properties.processDataSet.properties.modellingAndValidation.properties.LCIMethodAndAllocation;
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addSchema(dataTypes, 'tidas_data_types.json');
  return ajv.compile(target);
}

const bilingualDenominator = [
  { '@xml:lang': 'en', '#text': '1 t unwashed raw coal' },
  { '@xml:lang': 'zh', '#text': '1 吨未经洗选的原煤' },
];

for (const languageDirectory of ['schemas', 'schemas_zh']) {
  test(`${languageDirectory}: Process quantitative reference requires the field matching its type`, () => {
    const validate = compileProcessField(languageDirectory, 'quantitativeReference');
    const positive = [
      // Existing reference-flow representation remains valid, including optional
      // descriptive functional-unit text alongside the exchange reference.
      { '@type': 'Reference flow(s)', referenceToReferenceFlow: '0' },
      { '@type': 'Reference flow(s)', referenceToReferenceFlow: '123', functionalUnitOrOther: bilingualDenominator },
      { '@type': 'Functional unit', functionalUnitOrOther: bilingualDenominator },
      { '@type': 'Other parameter', functionalUnitOrOther: bilingualDenominator },
      { '@type': 'Production period', functionalUnitOrOther: bilingualDenominator },
      // The schema does not invent a prohibition on a supplied flow reference.
      { '@type': 'Other parameter', referenceToReferenceFlow: '7', functionalUnitOrOther: bilingualDenominator },
    ];
    for (const fixture of positive) {
      assert.equal(validate(fixture), true, `${JSON.stringify(fixture)}: ${JSON.stringify(validate.errors)}`);
    }

    const negative = [
      [{ '@type': 'Reference flow(s)' }, 'referenceToReferenceFlow'],
      [{ '@type': 'Functional unit' }, 'functionalUnitOrOther'],
      [{ '@type': 'Other parameter' }, 'functionalUnitOrOther'],
      [{ '@type': 'Production period' }, 'functionalUnitOrOther'],
      [{ '@type': 'Other parameter', referenceToReferenceFlow: '7' }, 'functionalUnitOrOther'],
    ];
    for (const [fixture, missingProperty] of negative) {
      assert.equal(validate(fixture), false, `${JSON.stringify(fixture)} must fail`);
      assert.ok(
        validate.errors.some((error) => error.keyword === 'required' && error.params.missingProperty === missingProperty),
        `${JSON.stringify(fixture)} must require ${missingProperty}: ${JSON.stringify(validate.errors)}`,
      );
    }

    assert.equal(validate({ referenceToReferenceFlow: '7' }), false, '@type remains mandatory');
    assert.deepEqual(
      validate.errors.filter((error) => error.keyword === 'required').map((error) => error.params.missingProperty),
      ['@type'],
      'an absent discriminator must not report spurious conditional fields',
    );
    assert.equal(validate({ '@type': 'Unspecified', functionalUnitOrOther: bilingualDenominator }), false, 'unknown types remain invalid');
    assert.equal(validate({ '@type': 'Reference flow(s)', referenceToReferenceFlow: '-1' }), false, 'a supplied flow reference keeps its Int6 constraint');
    assert.equal(validate({ '@type': 'Other parameter', functionalUnitOrOther: '1 t coal' }), false, 'text still needs its language-tagged shape');
  });

  test(`${languageDirectory}: Process data-set type is optional but validated when supplied`, () => {
    const validate = compileProcessField(languageDirectory, 'LCIMethodAndAllocation');
    assert.equal(validate({}), true, JSON.stringify(validate.errors));
    assert.equal(validate({ typeOfDataSet: 'Unit process, single operation' }), true, JSON.stringify(validate.errors));
    assert.equal(validate({ typeOfDataSet: 'Not a data-set type' }), false, 'a supplied type must still use the public enum');
  });
}
