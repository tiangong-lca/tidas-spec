import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import Ajv from 'ajv';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
}

function compileReviewSchema(languageDirectory, datasetType) {
  const dataTypes = readJson(`assets/tidas/${languageDirectory}/tidas_data_types.json`);
  const schema = readJson(`assets/tidas/${languageDirectory}/tidas_${datasetType}.json`);
  const review = datasetType === 'processes'
    ? schema.properties.processDataSet.properties.modellingAndValidation.properties.validation.properties.review
    : datasetType === 'lciamethods'
      ? schema.properties.LCIAMethodDataSet.properties.modellingAndValidation.properties.validation.properties.review
      : schema.properties.lifeCycleModelDataSet.properties.modellingAndValidation.properties.validation.properties.review;
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addSchema(dataTypes, 'tidas_data_types.json');
  return ajv.compile(review);
}

const localizedText = { '@xml:lang': 'en', '#text': 'Reviewed documentation' };
const reviewer = {
  '@type': 'contact data set',
  '@refObjectId': '11111111-1111-1111-1111-111111111111',
  '@version': '01.00.000',
  '@uri': '../contacts/11111111-1111-1111-1111-111111111111.xml',
  'common:shortDescription': localizedText,
};
const report = {
  '@type': 'source data set',
  '@refObjectId': '22222222-2222-2222-2222-222222222222',
  '@version': '01.00.000',
  '@uri': '../sources/22222222-2222-2222-2222-222222222222.xml',
  'common:shortDescription': localizedText,
};

function reviewed(datasetType) {
  return {
    '@type': 'Independent external review',
    'common:scope': {
      '@name': 'Documentation',
      'common:method': {
        '@name': datasetType === 'processes' ? 'Documentation' : 'Expert judgement',
      },
    },
    'common:reviewDetails': localizedText,
    'common:referenceToNameOfReviewerAndInstitution': reviewer,
  };
}

for (const languageDirectory of ['schemas', 'schemas_zh']) {
  for (const datasetType of ['processes', 'lciamethods']) {
    test(`${languageDirectory}/${datasetType}: complete review report is optional but remains validated when supplied`, () => {
      const validate = compileReviewSchema(languageDirectory, datasetType);
      const withoutReport = reviewed(datasetType);
      assert.equal(validate(withoutReport), true, JSON.stringify(validate.errors, null, 2));

      const withValidReport = {
        ...withoutReport,
        'common:referenceToCompleteReviewReport': report,
      };
      assert.equal(validate(withValidReport), true, JSON.stringify(validate.errors, null, 2));

      const withIncompleteReport = {
        ...withoutReport,
        'common:referenceToCompleteReviewReport': {
          '@refObjectId': report['@refObjectId'],
        },
      };
      assert.equal(validate(withIncompleteReport), false, 'an incomplete supplied GlobalReferenceType must still fail');

      const withoutAnotherRequiredField = { ...withoutReport };
      delete withoutAnotherRequiredField['common:reviewDetails'];
      assert.equal(validate(withoutAnotherRequiredField), false, 'the reviewDetails requirement must remain unchanged');
    });
  }
}

for (const languageDirectory of ['schemas', 'schemas_zh']) {
  test(`${languageDirectory}/lifecyclemodels: existing optional review-report behavior remains unchanged`, () => {
    const validate = compileReviewSchema(languageDirectory, 'lifecyclemodels');
    const lifecycleReview = {
      'common:referenceToNameOfReviewerAndInstitution': reviewer,
    };
    assert.equal(validate(lifecycleReview), true, JSON.stringify(validate.errors, null, 2));
    assert.equal(
      validate({
        ...lifecycleReview,
        'common:referenceToCompleteReviewReport': { '@refObjectId': report['@refObjectId'] },
      }),
      false,
      'an incomplete supplied lifecycle-model review report must still fail',
    );
  });
}
