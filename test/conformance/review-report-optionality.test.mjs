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
  return ajv.compile({ ...review, $defs: schema.$defs });
}

function compileProcessValidationSchema(languageDirectory) {
  const schema = readJson(`assets/tidas/${languageDirectory}/tidas_processes.json`);
  const dataTypes = readJson(`assets/tidas/${languageDirectory}/tidas_data_types.json`);
  const validation = schema.properties.processDataSet.properties.modellingAndValidation.properties.validation;
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addSchema(dataTypes, 'tidas_data_types.json');
  return ajv.compile({ ...validation, $defs: schema.$defs });
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
  test(`${languageDirectory}/processes: review remains required`, () => {
    const validate = compileProcessValidationSchema(languageDirectory);

    assert.equal(validate({}), false);
    assert.ok(
      validate.errors.some((error) => error.instancePath === '' && error.keyword === 'required' && error.params.missingProperty === 'review'),
      `a missing review must fail the existing parent requirement: ${JSON.stringify(validate.errors, null, 2)}`,
    );
  });

  test(`${languageDirectory}/processes: review accepts one object or a non-empty array without weakening item validation`, () => {
    const validate = compileReviewSchema(languageDirectory, 'processes');
    const firstReview = reviewed('processes');
    const secondReview = {
      ...reviewed('processes'),
      '@type': 'Independent internal review',
    };

    assert.equal(validate(firstReview), true, JSON.stringify(validate.errors, null, 2));
    assert.equal(validate([firstReview]), true, JSON.stringify(validate.errors, null, 2));
    assert.equal(validate([firstReview, secondReview]), true, JSON.stringify(validate.errors, null, 2));

    assert.equal(validate([]), false, 'a present review array must contain at least one review');

    const invalidSecondReview = {
      '@type': 'Independent external review',
    };
    assert.equal(validate([firstReview, invalidSecondReview]), false);
    assert.ok(
      validate.errors.some((error) => error.instancePath === '/1' && error.keyword === 'required'),
      `the invalid review member must retain an indexed error path: ${JSON.stringify(validate.errors, null, 2)}`,
    );

    const incompleteReport = {
      ...secondReview,
      'common:referenceToCompleteReviewReport': {
        '@refObjectId': report['@refObjectId'],
      },
    };
    assert.equal(validate([firstReview, incompleteReport]), false);
    assert.ok(
      validate.errors.some((error) => error.instancePath.startsWith('/1/common:referenceToCompleteReviewReport')),
      `an invalid nested reference must retain its array-member path: ${JSON.stringify(validate.errors, null, 2)}`,
    );
  });
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
