// Strict YAML loading for the shipped methodology assets.
//
// The parser is a development-only dependency (see package.json). It is used
// here to fail closed on malformed input instead of accepting a best-effort
// parse: duplicate keys, malformed syntax, and multi-document streams are all
// errors, because each of them silently changes the meaning of the rules the
// file carries.

import { parseAllDocuments } from 'yaml';
import { decodeUtf8, fail } from './core.mjs';

const PARSE_OPTIONS = Object.freeze({
  // Duplicate mapping keys are an error, not a last-one-wins overwrite.
  uniqueKeys: true,
  // Keep merge keys explicit; the shipped methodology files do not use them,
  // and silently expanding them would change what "the source says" means.
  merge: false,
  // Aliases stay bounded; the shipped files define none.
  maxAliasCount: 100,
  strict: true,
});

export function parseYamlDocument(buffer, label) {
  const text = decodeUtf8(buffer, label);
  let documents;
  try {
    documents = parseAllDocuments(text, PARSE_OPTIONS);
  } catch (error) {
    return fail('YAML_PARSE', `${label}: malformed YAML: ${error.message}`);
  }
  const fatal = [];
  for (const document of documents) {
    for (const error of document.errors) fatal.push(error.message);
    for (const warning of document.warnings) fatal.push(`warning treated as error: ${warning.message}`);
  }
  if (fatal.length > 0) {
    return fail('YAML_PARSE', `${label}: malformed YAML: ${fatal.join('; ')}`);
  }
  if (documents.length !== 1) {
    return fail('YAML_DOCUMENT_COUNT', `${label}: expected exactly one YAML document, found ${documents.length}`);
  }
  const document = documents[0];
  if (document.contents === null) {
    return fail('YAML_EMPTY', `${label}: document is empty`);
  }
  let value;
  try {
    value = document.toJS({ maxAliasCount: PARSE_OPTIONS.maxAliasCount });
  } catch (error) {
    return fail('YAML_PARSE', `${label}: cannot build a value from the document: ${error.message}`);
  }
  assertNoNonStringMappingKeys(document, label);
  return value;
}

// `yaml` accepts non-string mapping keys (`1: x`, `true: x`) and coerces them.
// The methodology files are keyed by field names, so a non-string key means the
// file is not the reviewed shape and must not be silently coerced.
function assertNoNonStringMappingKeys(document, label) {
  const visit = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (node.items !== undefined && Array.isArray(node.items)) {
      for (const item of node.items) {
        if (item !== null && typeof item === 'object' && 'key' in item && 'value' in item) {
          if (item.key !== null && item.key !== undefined && item.key.type !== 'PLAIN' && item.key.type !== 'QUOTE_DOUBLE' && item.key.type !== 'QUOTE_SINGLE') {
            fail('YAML_KEY_TYPE', `${label}: non-string mapping key (${item.key.type})`);
          }
          if (item.key !== null && item.key !== undefined && typeof item.key.value !== 'string') {
            fail('YAML_KEY_TYPE', `${label}: non-string mapping key ${JSON.stringify(item.key.value)}`);
          }
        }
        visit(item);
      }
      return;
    }
    if (node.value !== undefined) visit(node.value);
  };
  visit(document.contents);
}
