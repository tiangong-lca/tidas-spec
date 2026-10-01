import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const roots = { contacts: 'contactDataSet', flowproperties: 'flowPropertyDataSet', flows: 'flowDataSet', lciamethods: 'LCIAMethodDataSet', lifecyclemodels: 'lifeCycleModelDataSet', processes: 'processDataSet', sources: 'sourceDataSet', unitgroups: 'unitGroupDataSet' };
const langText = { '@xml:lang': 'en', '#text': 'Source' };
const reference = { '@type': 'source data set', '@refObjectId': '11111111-1111-1111-1111-111111111111', '@version': '01.00.000', '@uri': '../sources/source.xml', 'common:shortDescription': langText };
const clone = (v) => structuredClone(v);
function field(doc, parts) {
  let node = doc;
  for (const part of parts.split('/')) node = node.properties[part];
  return node;
}
function objects(schema) {
  return (schema.anyOf ?? [schema]).map((branch) => branch.type === 'array' ? branch.items : branch).filter((branch) => branch.type === 'object');
}
function compile(lang, schema) {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, inlineRefs: false, code: { optimize: 0 }, logger: false });
  ajv.addSchema(read(`assets/tidas/${lang}/tidas_data_types.json`), 'tidas_data_types.json');
  ajv.addSchema(read(`assets/tidas/${lang}/tidas_locations_category.json`), 'tidas_locations_category.json');
  return ajv.compile(schema);
}
function accepts(validate, input) { assert.equal(validate(input), true, `${JSON.stringify(input)}: ${JSON.stringify(validate.errors)}`); }
function rejects(validate, input) { assert.equal(validate(input), false, `Must reject ${JSON.stringify(input)}`); }

for (const lang of ['schemas', 'schemas_zh']) {
  const docs = Object.fromEntries(Object.keys(roots).map((kind) => [kind, read(`assets/tidas/${lang}/tidas_${kind}.json`)]));
  test(`${lang}: reference flows and named parameters accept repeated values, validate every member and reject empty arrays`, () => {
    const quantitative = compile(lang, field(docs.processes, 'processDataSet/processInformation/quantitativeReference'));
    accepts(quantitative, { '@type': 'Reference flow(s)', referenceToReferenceFlow: ['1', '2'] });
    rejects(quantitative, { '@type': 'Reference flow(s)', referenceToReferenceFlow: ['1', '-2'] });
    rejects(quantitative, { '@type': 'Reference flow(s)', referenceToReferenceFlow: [] });
    accepts(quantitative, { '@type': 'Other parameter', functionalUnitOrOther: langText });
    const params = compile(lang, field(docs.processes, 'processDataSet/processInformation/mathematicalRelations/variableParameter'));
    accepts(params, [{ '@name': 'a', meanValue: '1' }, { '@name': 'b', formula: 'a * 2' }]);
    accepts(params, { '@name': 'a' }); // ILCD does not require a variable meanValue.
    rejects(params, [{ '@name': 'a' }, { meanValue: '2' }]);
    rejects(params, []);
  });

  test(`${lang}: newly repeated enum values validate later entries`, () => {
    const paths = [
      ['processes', 'processDataSet/modellingAndValidation/LCIMethodAndAllocation/LCIMethodApproaches'],
      ['lciamethods', 'LCIAMethodDataSet/LCIAMethodInformation/dataSetInformation/methodology'],
      ['lciamethods', 'LCIAMethodDataSet/LCIAMethodInformation/dataSetInformation/impactCategory'],
      ['lciamethods', 'LCIAMethodDataSet/LCIAMethodInformation/dataSetInformation/areaOfProtection'],
      ['lciamethods', 'LCIAMethodDataSet/modellingAndValidation/LCIAMethodNormalisationAndWeighting/LCIAMethodPrinciple'],
    ];
    for (const [kind, p] of paths) {
      const schema = field(docs[kind], p); const single = schema.anyOf[0];
      const value = single.enum?.[0] ?? 'Example methodology';
      const v = compile(lang, schema); accepts(v, value); accepts(v, [value, value]); rejects(v, []); rejects(v, [value, 123]);
    }
  });

  test(`${lang}: all datasets support named external classification systems without discarding identity`, () => {
    for (const [kind, rootName] of Object.entries(roots)) {
      const info = { contacts: 'contactInformation', flowproperties: 'flowPropertiesInformation', flows: 'flowInformation', lciamethods: 'LCIAMethodInformation', lifecyclemodels: 'lifeCycleModelInformation', processes: 'processInformation', sources: 'sourceInformation', unitgroups: 'unitGroupInformation' }[kind];
      const schema = field(docs[kind], `${rootName}/${info}/dataSetInformation/classificationInformation/common:classification`);
      const array = schema.anyOf.find((b) => b.type === 'array');
      const v = compile(lang, array);
      const a = { '@name': 'External A', '@classes': 'urn:example:classes:a', 'common:class': [{ '@level': '0', '@classId': 'A', '#text': 'Class A' }] };
      const b = { ...clone(a), '@name': 'External B' };
      accepts(v, [a, b]); rejects(v, []); rejects(v, [a, { ...b, '@name': 7 }]);
      rejects(v, [a, { '@name': 'External B', 'common:class': [{ '@level': '0' }] }]);
      assert.equal(schema.anyOf[0].properties['@classes'].type, 'string');
    }
  });

  test(`${lang}: LCIA review uses native scope/method and keeps validated legacy aliases`, () => {
    const schema = field(docs.lciamethods, 'LCIAMethodDataSet/modellingAndValidation/validation/review');
    const v = compile(lang, schema);
    const reviewer = { ...reference, '@type': 'contact data set' };
    const canonical = { '@type': 'Independent external review', scope: { '@name': 'Documentation', method: { '@name': 'Expert judgement' } }, 'common:reviewDetails': langText, 'common:referenceToNameOfReviewerAndInstitution': reviewer };
    accepts(v, canonical); accepts(v, [canonical, clone(canonical)]);
    const legacy = clone(canonical); legacy['common:scope'] = legacy.scope; delete legacy.scope;
    legacy['common:scope']['common:method'] = legacy['common:scope'].method; delete legacy['common:scope'].method;
    accepts(v, legacy);
    rejects(v, { ...canonical, 'common:scope': legacy['common:scope'] });
    const bad = clone(canonical); bad.scope.method['@name'] = 'Made-up review method'; rejects(v, [canonical, bad]);
    rejects(v, []);
  });

  test(`${lang}: LCIA factor source containers have a canonical shape and validated compatibility inputs`, () => {
    const schema = field(docs.lciamethods, 'LCIAMethodDataSet/characterisationFactors/factor');
    for (const factor of objects(schema)) {
      const props = factor.properties;
      const container = compile(lang, props.referencesToDataSource);
      accepts(container, { referenceToDataSource: [reference, reference] }); rejects(container, {});
      rejects(container, { referenceToDataSource: [reference, { '@refObjectId': 'bad' }] });
      const legacy = compile(lang, props.referenceToDataSource);
      accepts(legacy, reference); accepts(legacy, { referenceToDataSource: reference }); rejects(legacy, {});
      const exclusivity = compile(lang, { type: 'object', allOf: factor.allOf });
      rejects(exclusivity, { referenceToDataSource: reference, referencesToDataSource: { referenceToDataSource: reference } });
    }
  });

  test(`${lang}: LCIA location simple content is required and sublocations may repeat`, () => {
    const geo = field(docs.lciamethods, 'LCIAMethodDataSet/LCIAMethodInformation/geography');
    for (const key of ['interventionLocation', 'impactLocation', 'interventionSubLocation']) {
      const v = compile(lang, geo.properties[key]); accepts(v, { '#text': 'GLO' }); rejects(v, { '@latitudeAndLongitude': '0;0' });
    }
    accepts(compile(lang, geo.properties.interventionSubLocation), [{ '#text': 'GLO' }, { '#text': 'DE' }]);
    const v = compile(lang, { type: 'object', allOf: geo.allOf });
    rejects(v, { interventionSubLocation: 'GLO', intervensionSubLocation: 'GLO' });
  });

  test(`${lang}: lifecycle parameter values and identities have the same meaning in both instance branches`, () => {
    const instance = field(docs.lifecyclemodels, 'lifeCycleModelDataSet/lifeCycleModelInformation/technology/processes/processInstance');
    for (const object of objects(instance)) {
      const props = object.properties;
      assert.ok(!object.required.includes('connections'), 'optional connection container stays optional');
      const params = compile(lang, props.parameters);
      accepts(params, { parameter: [{ '@name': 'a', '#text': '1.5' }, { '@name': 'b', '#text': '-2' }] });
      accepts(params, { parameter: { '@name': 'a', parameter: '1.5' } });
      rejects(params, { parameter: { '@name': 'a', '#text': 'not-a-number' } });
      rejects(params, { parameter: { '@name': 'a', parameter: 'not-a-number' } });
      rejects(params, { parameter: { '@name': 'a', '#text': '1', parameter: '2' } });
      rejects(params, { parameter: { '@name': 'a' } });
      rejects(params, { parameter: { '#text': '1' } });
      rejects(compile(lang, props.connections), {});
      accepts(compile(lang, props.scalingFactor), '2');
    }
  });


  test(`${lang}: supply locations and existing LCIA results repeat once without accepting nested arrays`, () => {
    const locations = compile(lang, field(docs.flows, 'flowDataSet/flowInformation/geography/locationOfSupply'));
    accepts(locations, 'GLO'); accepts(locations, ['GLO', 'DE']); rejects(locations, []); rejects(locations, ['GLO', 42]);
    const results = compile(lang, field(docs.processes, 'processDataSet/LCIAResults/LCIAResult'));
    accepts(results, [{ meanAmount: '1' }, { meanAmount: '2' }]);
    rejects(results, [[{ meanAmount: '1' }]]); rejects(results, [{ meanAmount: '1' }, {}]);
  });

  test(`${lang}: units need actual names and quantities without making optional internal IDs mandatory`, () => {
    const units = field(docs.unitgroups, 'unitGroupDataSet/units'); const v = compile(lang, units);
    accepts(v, { unit: { name: 'kg', meanValue: '1' } });
    accepts(v, { unit: [{ name: 'kg', meanValue: '1' }, { name: 'g', meanValue: '0.001' }] });
    rejects(v, {}); rejects(v, { unit: {} }); rejects(v, { unit: [{ name: 'kg', meanValue: '1' }, { name: 'g' }] });
    assert.ok(docs.unitgroups.properties.unitGroupDataSet.required.includes('units'));
  });
}
