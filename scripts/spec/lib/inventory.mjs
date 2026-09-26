// Exact specification file set and per-file identity.
//
// The approved set is not "whatever happens to be in assets/". It is the fixed
// imported W1 baseline plus the explicitly reviewed, repository-authored public
// rule assets. An extra file in the tree, a missing file, or an unexpected
// directory is a failure.

import path from 'node:path';
import {
  ASSET_ROOT,
  EXPECTED_METHODOLOGY_COUNT,
  EXPECTED_SCHEMA_COUNT_PER_LANGUAGE,
  LANGUAGE_SCHEMA_DIRS,
  METHODOLOGY_DIR,
  SpecError,
  decodeUtf8,
  fail,
  listFilesRecursive,
  readBytes,
  readJsonStrict,
  sha256Hex,
} from './core.mjs';
import { parseYamlDocument } from './yaml.mjs';
import { contentHashOf } from './lock.mjs';

/** Package-relative paths of every shipped specification asset. */
export function approvedAssetPaths() {
  const paths = [`${ASSET_ROOT}/schema.lock.json`];
  for (const dir of Object.values(LANGUAGE_SCHEMA_DIRS)) {
    for (const name of schemaFileNames()) paths.push(`${ASSET_ROOT}/${dir}/${name}`);
  }
  for (const name of methodologyFileNames()) paths.push(`${ASSET_ROOT}/${METHODOLOGY_DIR}/${name}`);
  for (const name of publicRuleFileNames()) paths.push(`${ASSET_ROOT}/rules/${name}`);
  return paths.sort();
}

const PUBLIC_RULE_FILE_NAMES = ['public-rules.v1.json', 'public-rules.v1.schema.json'];

// Assets deliberately maintained by tidas-spec rather than attributed byte for
// byte to the W1 toolkit import. Keeping this list explicit prevents removing a
// source-import entry from silently reclassifying an arbitrary asset as owned.
const REPOSITORY_AUTHORED_ASSET_PATHS = [
  `${ASSET_ROOT}/methodologies/tidas_flows.yaml`,
  `${ASSET_ROOT}/methodologies/tidas_processes.yaml`,
  `${ASSET_ROOT}/rules/public-rules.v1.json`,
  `${ASSET_ROOT}/rules/public-rules.v1.schema.json`,
  `${ASSET_ROOT}/schema.lock.json`,
  `${ASSET_ROOT}/schemas/tidas_lciamethods.json`,
  `${ASSET_ROOT}/schemas/tidas_processes.json`,
  `${ASSET_ROOT}/schemas_zh/tidas_lciamethods.json`,
  `${ASSET_ROOT}/schemas_zh/tidas_processes.json`,
].sort();

export function repositoryAuthoredAssetPaths() {
  return [...REPOSITORY_AUTHORED_ASSET_PATHS];
}

const SCHEMA_FILE_NAMES = [
  'tidas_contacts.json',
  'tidas_contacts_category.json',
  'tidas_data_types.json',
  'tidas_flowproperties.json',
  'tidas_flowproperties_category.json',
  'tidas_flows.json',
  'tidas_flows_elementary_category.json',
  'tidas_flows_product_category.json',
  'tidas_lciamethods.json',
  'tidas_lciamethods_category.json',
  'tidas_lifecyclemodels.json',
  'tidas_locations_category.json',
  'tidas_processes.json',
  'tidas_processes_category.json',
  'tidas_sources.json',
  'tidas_sources_category.json',
  'tidas_unitgroups.json',
  'tidas_unitgroups_category.json',
];

const METHODOLOGY_FILE_NAMES = ['tidas_flows.yaml', 'tidas_processes.yaml'];

export function schemaFileNames() {
  if (SCHEMA_FILE_NAMES.length !== EXPECTED_SCHEMA_COUNT_PER_LANGUAGE) {
    fail('INVENTORY_INTERNAL', `schema name list has ${SCHEMA_FILE_NAMES.length} entries but the approved baseline is ${EXPECTED_SCHEMA_COUNT_PER_LANGUAGE}`);
  }
  return [...SCHEMA_FILE_NAMES];
}

export function methodologyFileNames() {
  if (METHODOLOGY_FILE_NAMES.length !== EXPECTED_METHODOLOGY_COUNT) {
    fail('INVENTORY_INTERNAL', `methodology name list has ${METHODOLOGY_FILE_NAMES.length} entries but the approved baseline is ${EXPECTED_METHODOLOGY_COUNT}`);
  }
  return [...METHODOLOGY_FILE_NAMES];
}

export function publicRuleFileNames() {
  return [...PUBLIC_RULE_FILE_NAMES];
}

/**
 * Read every approved asset from a repository root, verifying:
 *   * no unexpected file exists anywhere under the asset root,
 *   * every expected file exists and is a regular file,
 *   * each JSON file parses with no duplicate keys,
 *   * each YAML file parses as exactly one document with no duplicate keys.
 *
 * Returns buffers, text, parsed documents, content hashes, and the file list.
 */
export function loadAssetSet(repoRoot) {
  const assetRootAbsolute = path.join(repoRoot, ASSET_ROOT);
  const present = listFilesRecursive(assetRootAbsolute).map((relative) => `${ASSET_ROOT}/${relative}`).sort();
  const approved = approvedAssetPaths();
  const approvedSet = new Set(approved);
  const presentSet = new Set(present);

  const unexpected = present.filter((file) => !approvedSet.has(file));
  const missing = approved.filter((file) => !presentSet.has(file));
  if (missing.length > 0) {
    fail('ASSET_MISSING', `approved specification files are missing: ${missing.join(', ')}`, { missing });
  }
  if (unexpected.length > 0) {
    fail('ASSET_UNEXPECTED', `unexpected files in the specification asset tree: ${unexpected.join(', ')}`, { unexpected });
  }

  const buffers = new Map();
  const text = new Map();
  const json = new Map();
  const yaml = new Map();
  const sha256 = new Map();
  const contentSha256 = new Map();

  for (const relative of approved) {
    const buffer = readBytes(path.join(repoRoot, relative), relative);
    buffers.set(relative, buffer);
    sha256.set(relative, sha256Hex(buffer));
    contentSha256.set(relative, contentHashOf(buffer));
    const isYaml = relative.endsWith('.yaml') || relative.endsWith('.yml');
    if (isYaml) {
      yaml.set(relative, parseYamlDocument(buffer, relative));
      text.set(relative, decodeUtf8(buffer, relative));
    } else {
      json.set(relative, readJsonStrict(buffer, relative));
      text.set(relative, decodeUtf8(buffer, relative));
    }
  }

  const schemaSets = {};
  for (const [setId, dir] of Object.entries(LANGUAGE_SCHEMA_DIRS)) {
    // Keyed by schema file name, which is how the lock addresses them; the
    // package-relative path is derived from the set's own directory.
    const documents = new Map();
    const hashes = new Map();
    const fileNames = schemaFileNames();
    for (const name of fileNames) {
      const relative = `${ASSET_ROOT}/${dir}/${name}`;
      documents.set(name, json.get(relative));
      hashes.set(name, contentSha256.get(relative));
    }
    schemaSets[setId] = { path: dir, directory: `${ASSET_ROOT}/${dir}`, fileNames, documents, contentHashes: hashes };
  }

  const localizedKeys = new Set(['description']);

  return {
    approved,
    buffers,
    text,
    json,
    yaml,
    sha256,
    contentSha256,
    schemaSets,
    localizedKeys,
    assetRoot: ASSET_ROOT,
  };
}

/**
 * Byte-level comparison against the reviewed import manifest.
 *
 * This is what makes "the shipped bytes are the reviewed bytes" checkable
 * without the source repository present: the manifest carries the source hash of
 * every file, and the shipped file must hash to exactly that.
 */
export function verifyAssetBytesMatchImportManifest(assetSet, importManifest) {
  const mismatches = [];
  const declared = new Map(importManifest.files.map((file) => [file.packagePath, file]));
  const authored = new Set(repositoryAuthoredAssetPaths());
  for (const relative of assetSet.approved) {
    if (!declared.has(relative) && !authored.has(relative)) {
      mismatches.push({ path: relative, reason: 'neither declared as an imported file nor approved as a repository-authored asset' });
    }
    if (declared.has(relative) && authored.has(relative)) {
      mismatches.push({ path: relative, reason: 'declared as both imported and repository-authored' });
    }
  }
  for (const relative of declared.keys()) {
    const entry = declared.get(relative);
    if (entry === undefined) {
      mismatches.push({ path: relative, reason: 'not declared in source-import.yaml' });
      continue;
    }
    const actual = assetSet.sha256.get(relative);
    if (actual !== entry.sha256) {
      mismatches.push({ path: relative, expected: entry.sha256, actual, reason: 'byte content differs from the reviewed import' });
    }
  }
  for (const relative of declared.keys()) {
    if (!assetSet.approved.includes(relative)) {
      mismatches.push({ path: relative, reason: 'declared in source-import.yaml but not shipped' });
    }
  }
  return mismatches;
}
