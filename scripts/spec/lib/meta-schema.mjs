// Offline Draft 7 meta-validation for the shipped schemas.
//
// The pinned source tool validates every schema against the Draft 7 meta-schema
// before it will compute a lock (`jsonschema::draft7::meta::validate`). Matching
// the `$schema` string is not the same check: it says nothing about whether the
// document is a well-formed schema. This module restores the real check.
//
// Strictly offline:
//   * `validateSchema` is used rather than `compile`, because meta-validation
//     must not need to resolve the document's own `$ref`s. Reference closure is
//     the separate check in `refs.mjs`.
//   * no `loadSchema` is configured, so Ajv has no way to fetch anything. A
//     reference it cannot resolve offline fails the compile path; the
//     meta-schema path never asks.
//
// `strict: false` is deliberate: the reviewed documents use `$defs` under a
// Draft 7 declaration, which Ajv's strict mode reports as an unknown keyword.
// Reported constraints are what matter here, not keyword-vocabulary preferences.

import Ajv from 'ajv';
import { fail } from './core.mjs';

export const DRAFT7_URI = 'http://json-schema.org/draft-07/schema#';

function createValidator() {
  return new Ajv({
    strict: false,
    // Do not register compiled schemas as the documents are validated; this is a
    // pure meta-schema check, not a compilation.
    addUsedSchema: false,
    // No `loadSchema`: offline by construction.
  });
}

/**
 * Validate each document against the Draft 7 meta-schema.
 *
 * `documents` maps a label (used verbatim in the failure message) to the parsed
 * document. Returns a summary; raises on the first invalid document with its
 * constraint errors, because an invalid schema is a source-content problem that
 * has to be reported, not a difference the verifier may absorb.
 */
export function metaValidateAll(documents) {
  const ajv = createValidator();
  const failures = [];
  for (const [label, document] of documents) {
    if (!ajv.validateSchema(document)) {
      failures.push({
        label,
        errors: (ajv.errors ?? []).map((error) => ({
          instancePath: error.instancePath,
          schemaPath: error.schemaPath,
          message: error.message,
        })),
      });
    }
  }
  if (failures.length > 0) {
    fail(
      'SCHEMA_META_INVALID',
      `${failures.length} schema document(s) are not valid Draft 7 schemas: ${JSON.stringify(failures.slice(0, 10), null, 2)}`,
      { failures },
    );
  }
  return { validated: documents.length };
}

/** Whether one document is a valid Draft 7 schema; used by tests and tooling. */
export function metaValidate(document) {
  const ajv = createValidator();
  const valid = ajv.validateSchema(document);
  return { valid, errors: (ajv.errors ?? []).map((error) => `${error.instancePath} ${error.message}`) };
}
