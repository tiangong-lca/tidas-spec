// schema.lock.json verification.
//
// The lock shipped in this package is the pinned source lock, imported
// byte-for-byte. This module does not re-interpret it loosely: it recomputes the
// lock from the shipped schema bytes using the pinned source tool's algorithm
// and requires the two to be deeply equal. Any drift in a schema byte, in the
// localized-key allowance, or in the lock's own aggregate hashes is therefore a
// failure rather than a tolerable difference.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, fail, normalizeLineEndings, sha256Hex } from './core.mjs';

/**
 * Strip ONLY the keys the lock declares as localized. Nothing is normalized,
 * reordered, or coerced: a structural difference between two language variants
 * has to surface rather than be smoothed away.
 *
 * This is the single implementation of that rule. The lock computation and the
 * language-equivalence check both call it, so the digest a lock records and the
 * comparison a verifier performs cannot drift apart.
 */
export function contractNode(value, localizedKeys) {
  if (Array.isArray(value)) return value.map((item) => contractNode(item, localizedKeys));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      if (localizedKeys.has(key)) continue;
      out[key] = contractNode(value[key], localizedKeys);
    }
    return out;
  }
  return value;
}

export function schemaSetLock(packagePathForSet, fileNames, documents, contentHashes, localizedKeys) {
  const files = {};
  for (const name of fileNames) {
    const document = documents.get(name);
    const contentSha256 = contentHashes.get(name);
    if (document === undefined) fail('LOCK_INPUT', `${packagePathForSet}/${name}: schema document was not loaded`);
    if (contentSha256 === undefined) fail('LOCK_INPUT', `${packagePathForSet}/${name}: content hash was not computed`);
    files[name] = {
      contentSha256,
      contractSha256: sha256Hex(canonicalJson(contractNode(document, localizedKeys))),
    };
  }
  const contentMap = {};
  const contractMap = {};
  for (const name of fileNames) {
    contentMap[name] = files[name].contentSha256;
    contractMap[name] = files[name].contractSha256;
  }
  return {
    contentAggregateSha256: sha256Hex(canonicalJson(contentMap)),
    contractAggregateSha256: sha256Hex(canonicalJson(contractMap)),
    fileCount: fileNames.length,
    files,
    path: packagePathForSet,
  };
}

export function computeSchemaLock({ schemaRoot, schemaSets, localizedKeys }) {
  const sets = {};
  const translationFiles = {};
  for (const [setId, set] of Object.entries(schemaSets)) {
    sets[setId] = schemaSetLock(set.path, set.fileNames, set.documents, set.contentHashes, localizedKeys);
  }
  const en = sets.en;
  const zh = sets.zh;
  if (en === undefined || zh === undefined) fail('LOCK_SETS', 'the schema lock requires both an `en` and a `zh` schema set');
  for (const name of Object.keys(en.files).sort()) {
    if (zh.files[name] === undefined) fail('LOCK_SETS', `schema set \`zh\` is missing ${name}`);
    translationFiles[name] = {
      contractSha256: en.files[name].contractSha256,
      enContentSha256: en.files[name].contentSha256,
      zhContentSha256: zh.files[name].contentSha256,
    };
  }
  const pairContracts = {};
  for (const name of Object.keys(translationFiles).sort()) {
    pairContracts[name] = translationFiles[name].contractSha256;
  }
  return {
    allowedLocalizedKeys: [...localizedKeys].sort(),
    generation: { mode: 'deterministic-v1', tool: 'tidas-asset-lock' },
    schemaRoot,
    schemaSets: { en: sets.en, zh: sets.zh },
    translationPairs: {
      contractAggregateSha256: sha256Hex(canonicalJson(pairContracts)),
      fileCount: Object.keys(translationFiles).length,
      files: translationFiles,
    },
    version: 1,
  };
}

export function contentHashOf(buffer) {
  return sha256Hex(normalizeLineEndings(buffer));
}

export function readSchemaLock(repoRoot, relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    return fail('LOCK_PARSE', `${relativePath}: cannot parse schema lock: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('LOCK_SHAPE', `${relativePath}: schema lock must be a JSON object`);
  }
  if (!Array.isArray(parsed.allowedLocalizedKeys) || parsed.allowedLocalizedKeys.some((key) => typeof key !== 'string')) {
    fail('LOCK_SHAPE', `${relativePath}: allowedLocalizedKeys must be an array of strings`);
  }
  if (parsed.version !== 1) fail('LOCK_VERSION', `${relativePath}: unsupported schema lock version ${JSON.stringify(parsed.version)}`);
  return parsed;
}

/**
 * Compare a recomputed lock against the shipped one and report every structural
 * difference. Explicit paths make a stale-lock failure actionable.
 */
export function diffLocks(expected, actual, label = 'schema.lock.json') {
  const differences = [];
  const compare = (a, b, pointer) => {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) {
        differences.push(`${pointer}: expected ${describe(a)}, found ${describe(b)}`);
        return;
      }
      if (a.length !== b.length) differences.push(`${pointer}: length ${a.length} != ${b.length}`);
      for (let index = 0; index < Math.max(a.length, b.length); index += 1) compare(a[index], b[index], `${pointer}/${index}`);
      return;
    }
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        compare(a[key], b[key], `${pointer}/${key}`);
      }
      return;
    }
    if (a !== b) differences.push(`${pointer}: expected ${describe(a)}, found ${describe(b)}`);
  };
  compare(expected, actual, label);
  return differences;
}

function describe(value) {
  if (value === undefined) return 'nothing';
  return JSON.stringify(value);
}
