// The specification verifier.
//
// One implementation, used by the repository check, by CI, and by the
// conformance tests. It is deliberately not a snapshot comparison: every check
// recomputes the property it asserts from the shipped bytes, so a mutation is
// caught by re-derivation rather than by a recorded expectation going stale.
//
// Stages are named so a caller can run the subset that applies to its context:
//   identity  — file set, bytes, language equivalence, lock, reference closure
//   manifest  — the full spec manifest agrees with the identity
//   package   — package.json declares no runtime dependency or install script
//   archive   — an archive matches the declared asset set and reads offline
//

import { existsSync } from 'node:fs';
import { mkdirSync, readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import Ajv from 'ajv';
import {
  ARCHIVE_BINDING_PATH,
  ASSET_ROOT,
  Diagnostics,
  EXPECTED_METHODOLOGY_COUNT,
  EXPECTED_SCHEMA_COUNT_PER_LANGUAGE,
  IMPORT_MANIFEST_PATH,
  LICENSE_DECLARATION,
  MANIFEST_PATH,
  MANIFEST_VERSION,
  PACKAGE_JSON_PATH,
  PACKAGE_METADATA_ORIGIN,
  PACKAGE_NAME,
  RELEASE_ROOT,
  REVIEWED_BASELINE_PATH,
  SPEC_VERSION,
  archiveFileName,
  canonicalJson,
  fail,
  formatJson,
  hashCanonicalJson,
  listFilesRecursive,
  normalizeLineEndings,
  readJsonStrict,
  sha256Hex,
} from './core.mjs';
import { computeSchemaLock, contractNode, diffLocks, readSchemaLock } from './lock.mjs';
import { readTarEntries } from './tar.mjs';
import { DRAFT7_URI, metaValidateAll } from './meta-schema.mjs';
import { QUALIFICATION_DRAFT, QUALIFICATION_QUALIFIED } from './qualification.mjs';
import { approvedAssetPaths, loadAssetSet, verifyAssetBytesMatchImportManifest } from './inventory.mjs';
import { anchorsFor, buildCatalog, checkClosure, collectReferences, resolveReference } from './refs.mjs';
import { globToRegExp, readImportManifest, resolvePackagedFiles, resolvePackageContent } from './package-content.mjs';

export const ALL_STAGES = Object.freeze(['identity', 'manifest', 'package', 'archive']);

export function verifyCandidate(options) {
  const {
    repoRoot,
    stages = ALL_STAGES,
    archivePath = null,
    expectedSourceRevision = null,
    tempParent = tmpdir(),
    logger = () => {},
  } = options;
  const diagnostics = new Diagnostics();
  const state = {};

  for (const stage of stages) {
    logger(`stage: ${stage}`);
    if (stage === 'identity') verifyIdentity(repoRoot, diagnostics, state);
    else if (stage === 'manifest') verifyManifest(repoRoot, diagnostics, state, { expectedSourceRevision });
    else if (stage === 'package') verifyPackage(repoRoot, diagnostics, state);
    else if (stage === 'archive') verifyArchive(repoRoot, diagnostics, state, { archivePath, tempParent, logger, expectedSourceRevision });
    else fail('STAGE_UNKNOWN', `unknown verification stage \`${stage}\``);
  }

  return { diagnostics, state };
}

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

function verifyIdentity(repoRoot, diagnostics, state) {
  const assetSet = run(diagnostics, 'identity/file-set-and-parsing', () => loadAssetSet(repoRoot));
  if (assetSet === undefined) return;
  state.assetSet = assetSet;

  run(diagnostics, 'identity/approved-counts', () => {
    const en = assetSet.schemaSets.en.fileNames.length;
    const zh = assetSet.schemaSets.zh.fileNames.length;
    if (en !== EXPECTED_SCHEMA_COUNT_PER_LANGUAGE || zh !== EXPECTED_SCHEMA_COUNT_PER_LANGUAGE) {
      fail('ASSET_COUNT', `expected ${EXPECTED_SCHEMA_COUNT_PER_LANGUAGE} schemas per language, found en=${en}, zh=${zh}`);
    }
    const methodologies = assetSet.approved.filter((relative) => relative.endsWith('.yaml'));
    if (methodologies.length !== EXPECTED_METHODOLOGY_COUNT) {
      fail('ASSET_COUNT', `expected ${EXPECTED_METHODOLOGY_COUNT} methodology files, found ${methodologies.length}`);
    }
    return { schemasPerLanguage: en, methodologies: methodologies.length, total: assetSet.approved.length };
  });

  const importManifest = run(diagnostics, 'identity/import-manifest', () => readImportManifest(repoRoot, IMPORT_MANIFEST_PATH));
  if (importManifest !== undefined) {
    state.importManifest = importManifest;
    run(diagnostics, 'identity/source-identity', () => checkImportManifestIdentity(importManifest));
    run(diagnostics, 'identity/reviewed-baseline', () => checkReviewedBaseline(repoRoot, importManifest, assetSet));
    run(diagnostics, 'identity/source-bytes', () => {
      const mismatches = verifyAssetBytesMatchImportManifest(assetSet, importManifest);
      if (mismatches.length > 0) fail('SOURCE_BYTES', `shipped assets differ from the reviewed import: ${JSON.stringify(mismatches, null, 2)}`, { mismatches });
      return { files: assetSet.approved.length };
    });
  }

  run(diagnostics, 'identity/schema-vocabulary', () => checkSchemaDeclarations(assetSet));

  run(diagnostics, 'identity/language-equivalence', () => checkLanguageEquivalence(assetSet));

  run(diagnostics, 'identity/schema-lock', () => checkSchemaLock(repoRoot, assetSet));

  run(diagnostics, 'identity/reference-closure', () => verifyReferenceClosure(assetSet, diagnostics));

  run(diagnostics, 'identity/methodology', () => checkMethodology(assetSet));

  run(diagnostics, 'identity/public-rules', () => checkPublicRules(assetSet));
}

function checkPublicRules(assetSet) {
  const schema = assetSet.json.get(`${ASSET_ROOT}/rules/public-rules.v1.schema.json`);
  const index = assetSet.json.get(`${ASSET_ROOT}/rules/public-rules.v1.json`);
  const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
  if (!validate(index)) fail('PUBLIC_RULE_SCHEMA', `public rule index is invalid: ${JSON.stringify(validate.errors, null, 2)}`, { errors: validate.errors });
  const ids = index.rules.map((rule) => rule.id);
  const duplicates = ids.filter((id, offset) => ids.indexOf(id) !== offset);
  if (duplicates.length > 0) fail('PUBLIC_RULE_DUPLICATE', `public rule ids are not unique: ${[...new Set(duplicates)].join(', ')}`);
  if (ids.join('\n') !== [...ids].sort().join('\n')) fail('PUBLIC_RULE_ORDER', 'public rules must be sorted by stable id');
  const forbidden = ['severity', 'phase', 'phases', 'default_blocker', 'ruleset', 'rulesets', 'profile', 'profiles'];
  const leaked = index.rules.flatMap((rule) => forbidden.filter((field) => field in rule).map((field) => `${rule.id}.${field}`));
  if (leaked.length > 0) fail('PUBLIC_RULE_POLICY_LEAK', `product execution policy leaked into the public index: ${leaked.join(', ')}`);
  for (const rule of index.rules) {
    if (!rule.id.startsWith(`tidas.${rule.dataset_type}.`)) fail('PUBLIC_RULE_DATASET', `${rule.id} does not match dataset_type ${rule.dataset_type}`);
    for (const source of rule.source_refs) {
      const methodology = assetSet.yaml.get(`${ASSET_ROOT}/methodologies/${source.asset}`);
      const resolved = source.path.split('.').reduce((node, segment) => node?.[segment], methodology);
      if (!Array.isArray(resolved) || resolved.length === 0) {
        fail('PUBLIC_RULE_SOURCE', `${rule.id} source does not resolve to a non-empty methodology rule array: ${source.asset}#${source.path}`);
      }
    }
  }
  return { version: index.rules_version, rules: ids.length };
}

function checkSchemaDeclarations(assetSet) {
  // Draft 7 is the declaration the source makes; the verifier must not quietly
  // accept a document that declares something else, and must not change the
  // declared dialect to make a check easier.
  const draft7 = DRAFT7_URI;
  const offenders = [];
  for (const set of Object.values(assetSet.schemaSets)) {
    for (const name of set.fileNames) {
      const relative = `${set.directory}/${name}`;
      const document = set.documents.get(name);
      if (document === null || typeof document !== 'object' || Array.isArray(document)) {
        offenders.push({ path: relative, reason: 'schema document is not a JSON object' });
        continue;
      }
      if (document.$schema !== draft7) {
        offenders.push({ path: relative, reason: `declares $schema ${JSON.stringify(document.$schema)} instead of ${draft7}` });
      }
    }
  }
  if (offenders.length > 0) fail('SCHEMA_DIALECT', `schema dialect declarations are not the reviewed Draft 7 declaration: ${JSON.stringify(offenders)}`, { offenders });

  // Declaring Draft 7 is not the same as being a valid Draft 7 schema. The pinned
  // source tool meta-validates every schema before it will lock one; this is that
  // check, run offline.
  const documents = [];
  for (const set of Object.values(assetSet.schemaSets)) {
    for (const name of set.fileNames) documents.push([`${set.directory}/${name}`, set.documents.get(name)]);
  }
  const meta = metaValidateAll(documents);
  return { checked: offenders.length === 0 ? meta.validated : 0, metaValidated: meta.validated };
}

function checkLanguageEquivalence(assetSet) {
  const localizedKeys = assetSet.localizedKeys;
  const failures = [];
  const names = assetSet.schemaSets.en.fileNames;

  // The pinned source lock removes the localized keys at every depth, exactly as
  // `contractNode` does. That is only safe while no schema declares an *instance
  // property* under one of those names: a property called `description` would be
  // instance data, not a localized annotation, and stripping it would hide a real
  // constraint difference instead of a translation. The reviewed set declares no
  // such property; if one appears, this check stops the comparison from silently
  // becoming weaker.
  const shadowed = [];
  for (const set of Object.values(assetSet.schemaSets)) {
    for (const name of set.fileNames) {
      for (const pointer of findDeclaredProperties(set.documents.get(name), localizedKeys)) {
        shadowed.push(`${set.directory}/${name}${pointer}`);
      }
    }
  }
  if (shadowed.length > 0) {
    fail(
      'LOCALIZED_KEY_SHADOWING',
      `a schema declares an instance property whose name is also an allowed localized key (${[...localizedKeys].join(', ')}); stripping it would hide a constraint difference: ${shadowed.join(', ')}`,
      { shadowed },
    );
  }

  for (const name of names) {
    const enPath = `${ASSET_ROOT}/schemas/${name}`;
    const zhPath = `${ASSET_ROOT}/schemas_zh/${name}`;
    const en = contractNode(assetSet.json.get(enPath), localizedKeys);
    const zh = contractNode(assetSet.json.get(zhPath), localizedKeys);
    const enCanonical = canonicalJson(en);
    const zhCanonical = canonicalJson(zh);
    if (enCanonical !== zhCanonical) {
      failures.push({ name, en: enPath, zh: zhPath, firstDifference: firstDifference(en, zh) });
    }
  }
  if (failures.length > 0) {
    fail(
      'LANGUAGE_CONTRACT',
      `English and Chinese schemas differ after removing only the allowed localized keys (${[...localizedKeys].join(', ')}): ${JSON.stringify(failures, null, 2)}`,
      { failures },
    );
  }
  return { pairs: names.length, allowedLocalizedKeys: [...localizedKeys].sort() };
}

/**
 * JSON pointers of every `properties` entry named like an allowed localized key.
 *
 * The collector is threaded explicitly rather than defaulted, so a caller cannot
 * accidentally share one result array between two walks.
 */
function findDeclaredProperties(node, localizedKeys) {
  const found = [];
  collectDeclaredProperties(node, localizedKeys, '', found);
  return found;
}

function collectDeclaredProperties(node, localizedKeys, pointer, found) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectDeclaredProperties(item, localizedKeys, `${pointer}/${index}`, found));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const propertyName of Object.keys(value)) {
        if (localizedKeys.has(propertyName)) found.push(`${pointer}/properties/${propertyName}`);
      }
    }
    collectDeclaredProperties(value, localizedKeys, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, found);
  }
}

function firstDifference(en, zh, pointer = '') {
  const enIsObject = en !== null && typeof en === 'object';
  const zhIsObject = zh !== null && typeof zh === 'object';
  if (!enIsObject || !zhIsObject) {
    return canonicalJson(en) === canonicalJson(zh) ? null : { pointer, en, zh };
  }
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zh).sort();
  if (JSON.stringify(enKeys) !== JSON.stringify(zhKeys)) {
    return { pointer, enKeys, zhKeys };
  }
  for (const key of enKeys) {
    const nested = firstDifference(en[key], zh[key], `${pointer}/${key}`);
    if (nested !== null) return nested;
  }
  return null;
}

function checkSchemaLock(repoRoot, assetSet) {
  const shipped = readSchemaLock(repoRoot, `${ASSET_ROOT}/schema.lock.json`);
  const localizedKeys = new Set(shipped.allowedLocalizedKeys);
  // The lock's own allowance must match what the equivalence check used; a lock
  // that permits more than the reviewed set would let a real difference through.
  for (const key of assetSet.localizedKeys) {
    if (!localizedKeys.has(key)) fail('LOCK_ALLOWANCE', `the lock does not declare the reviewed localized key \`${key}\``);
  }
  for (const key of localizedKeys) {
    if (!assetSet.localizedKeys.has(key)) fail('LOCK_ALLOWANCE', `the lock declares localized key \`${key}\`, which this verifier does not implement`);
  }
  const recomputed = computeSchemaLock({
    schemaRoot: ASSET_ROOT,
    schemaSets: {
      en: assetSet.schemaSets.en,
      zh: assetSet.schemaSets.zh,
    },
    localizedKeys,
  });
  const differences = diffLocks(recomputed, shipped, `${ASSET_ROOT}/schema.lock.json`);
  if (differences.length > 0) {
    fail(
      'LOCK_STALE',
      `${ASSET_ROOT}/schema.lock.json does not match the shipped schema bytes (${differences.length} difference(s)); the lock must be regenerated from the reviewed source, never hand-edited`,
      { differences: differences.slice(0, 40) },
    );
  }
  return { files: recomputed.translationPairs.fileCount, differences: 0 };
}

/**
 * Reference closure.
 *
 * The catalog holds only the schema sets. A reference must not resolve into
 * package metadata that merely happens to be a shipped file, so the boundary is
 * stated rather than inferred.
 *
 * The two language sets are treated identically. Whether they remain jointly
 * normative, and how translations are maintained, is an open question in the
 * execution plan and in docs/provenance.md; nothing here decides it. An earlier
 * revision enforced an English-normative/Chinese-translation hierarchy, which no
 * approved disposition establishes — a comparison baseline is not an authority
 * decision. A cross-language reference is therefore an ordinary reference: it
 * resolves if it resolves, and fails for the same reasons any other reference
 * fails. The reviewed sets happen to keep every reference inside its own
 * language, and that self-contained arrangement is reported as a fact rather than
 * imposed as a rule.
 */
function verifyReferenceClosure(assetSet, diagnostics) {
  const documents = new Map();
  for (const [relative, value] of assetSet.json) {
    if (relative.startsWith(`${ASSET_ROOT}/schemas/`) || relative.startsWith(`${ASSET_ROOT}/schemas_zh/`)) {
      documents.set(relative, value);
    }
  }
  const catalog = buildCatalog(documents);

  let failures = 0;
  const annotationsOnly = [];
  const siblingConflicts = [];
  const unclassifiedSiblings = [];
  const report = (entry) => {
    if (entry.kind === 'structure' && entry.code === 'ref-sibling-unclassified') {
      unclassifiedSiblings.push(entry);
      return;
    }
    if (entry.kind === 'structure' && entry.code === 'ref-applicability') {
      // Annotation-only siblings of `$ref` change nothing under Draft 7: the
      // reference replaces the object either way. They are worth one summary
      // line, not one finding per occurrence, because the reviewed set uses the
      // pattern deliberately to document a referenced type in place.
      annotationsOnly.push(entry);
      return;
    }
    if (entry.kind === 'structure' && entry.code === 'ref-sibling-conflict') {
      siblingConflicts.push(entry);
      return;
    }
    failures += 1;
    // One finding per problem, under the problem's own code, so a reviewer sees
    // the reason without drilling into a summary blob.
    diagnostics.error(`identity/reference-closure/${entry.code}`, entry.message, entry.detail);
  };
  const closure = checkClosure(catalog, report);

  // Duplicate anchors would make `#name` resolve by first-wins, which is a
  // silently wrong target rather than a missing one.
  for (const packagePath of catalog.byPath.keys()) {
    const { duplicates } = anchorsFor(catalog, packagePath);
    for (const [name, entries] of duplicates) {
      failures += 1;
      const locations = entries.map((entry) => `\`${entry.packagePath}#${entry.pointer}\``);
      diagnostics.error(
        'identity/reference-closure/REF_ANCHOR_DUPLICATE',
        `the anchor \`#${name}\` is declared at ${locations.join(' and ')}; a reference to it would silently pick one of them`,
        { name, locations: entries },
      );
    }
  }

  // Cross-language references are ordinary references: they resolve or they fail
  // on their own merits. The direction and count are reported as an observed fact
  // about the reviewed content, because a future change to that arrangement is
  // worth seeing — but no hierarchy is imposed, and no reference is rejected for
  // crossing a language boundary.
  const references = collectReferences(catalog);
  const crossLanguage = [];
  for (const [identity, entry] of references) {
    const target = safeResolve(entry.reference, entry.from, catalog);
    if (target === null) continue;
    const fromEnglish = entry.from.startsWith(`${ASSET_ROOT}/schemas/`);
    const fromChinese = entry.from.startsWith(`${ASSET_ROOT}/schemas_zh/`);
    const toEnglish = target.packagePath.startsWith(`${ASSET_ROOT}/schemas/`);
    const toChinese = target.packagePath.startsWith(`${ASSET_ROOT}/schemas_zh/`);
    if ((fromEnglish && toChinese) || (fromChinese && toEnglish)) {
      crossLanguage.push({ from: identity, reference: entry.reference, target: target.packagePath });
    }
  }

  // The source finding, assembled from what the walk actually saw rather than
  // from a hardcoded expectation. Counts, keyword patterns and locations all come
  // out of the documents, so a change to the source changes this record. The same
  // analysis is what the manifest records, so report and artifact cannot diverge.
  const sourceFinding = analyseSiblingFindings(assetSet);

  if (sourceFinding.references > 0) {
    diagnostics.warn(
      'identity/reference-closure/ref-sibling-conflict',
      `${sourceFinding.references} \`$ref\` object(s) carry assertion-bearing siblings ${sourceFinding.patterns.map((pattern) => `{${pattern.siblings.join('+')}} x${pattern.count}`).join(', ')}. Draft 7 core section 8.3 says a \`$ref\` object's other properties are ignored, so a reader that follows that rule sees a weaker constraint than the file appears to state. This is a source-semantics question with no authority in this repository: the bytes are unchanged, neither reading is applied, and the finding is recorded in the manifest for disposition.`,
      {
        count: sourceFinding.references,
        patterns: sourceFinding.patterns,
        keywords: sourceFinding.keywords,
        locations: sourceFinding.locations,
      },
    );
  }

  if (unclassifiedSiblings.length > 0) {
    const keywords = new Map();
    for (const entry of unclassifiedSiblings) {
      for (const keyword of entry.detail.siblings) keywords.set(keyword, (keywords.get(keyword) ?? 0) + 1);
    }
    diagnostics.warn(
      'identity/reference-closure/ref-sibling-unclassified',
      `${unclassifiedSiblings.length} \`$ref\` object(s) carry sibling keyword(s) the declared dialect does not define: ${[...keywords].map(([keyword, count]) => `\`${keyword}\` x${count}`).join(', ')}. These are unclassified extension members, not assertions: nothing here claims they restrict the instance, and nothing claims any evaluator disagrees about them. They are reported so the extension stays visible.`,
      {
        count: unclassifiedSiblings.length,
        keywords: [...keywords].map(([keyword, count]) => ({ keyword, count })),
        locations: unclassifiedSiblings.map((entry) => entry.detail.pointer),
      },
    );
  }

  if (annotationsOnly.length > 0) {
    const example = annotationsOnly[0];
    diagnostics.warn(
      'identity/reference-closure/ref-applicability',
      `${annotationsOnly.length} \`$ref\` object(s) carry only non-asserting siblings, which Draft 7 does not apply; for example ${example.detail.pointer} has sibling(s) ${example.detail.siblings.map((key) => `\`${key}\``).join(', ')}`,
      { count: annotationsOnly.length, example: example.detail },
    );
  }

  if (crossLanguage.length > 0) {
    // Symmetric by construction: it counts references in either direction.
    diagnostics.warn(
      'identity/reference-closure/cross-language',
      `${crossLanguage.length} reference(s) cross between the language sets (${crossLanguage.map((item) => `${item.from} -> ${item.target}`).join('; ')}). Both sets are shipped and neither is treated as authoritative over the other; this is reported so a change in the arrangement is visible.`,
      { count: crossLanguage.length, references: crossLanguage },
    );
  }

  return {
    references: references.size,
    liveSchemaPositions: closure.livePositions,
    annotationOnlySiblings: annotationsOnly.length,
    sourceFinding,
    crossLanguageReferences: crossLanguage,
    unclassifiedSiblingReferences: unclassifiedSiblings.length,
    failures,
  };
}

/**
 * Analyse the schema documents for `$ref`-sibling findings.
 *
 * One implementation, used by the identity stage and by the manifest builder, so
 * the count a reviewer reads in the report and the count recorded in the release
 * artifact cannot diverge. The result is memoised on the asset set because both
 * callers analyse exactly the same documents.
 */
export function analyseSiblingFindings(assetSet) {
  if (assetSet.siblingFindings !== undefined) return assetSet.siblingFindings;
  const documents = new Map();
  for (const [relative, value] of assetSet.json) {
    if (relative.startsWith(`${ASSET_ROOT}/schemas/`) || relative.startsWith(`${ASSET_ROOT}/schemas_zh/`)) {
      documents.set(relative, value);
    }
  }
  const catalog = buildCatalog(documents);
  const conflicts = [];
  let nonAsserting = 0;
  let unclassified = 0;
  checkClosure(catalog, (entry) => {
    if (entry.kind !== 'structure') return;
    if (entry.code === 'ref-sibling-conflict') conflicts.push(entry);
    else if (entry.code === 'ref-applicability') nonAsserting += 1;
    else if (entry.code === 'ref-sibling-unclassified') unclassified += 1;
  });
  // Every reached `$ref` object falls into exactly one of four categories, so a
  // reader can reconcile the numbers rather than wonder what is missing: it
  // asserts through a sibling, it carries only non-asserting siblings, it carries
  // an unclassified extension sibling, or it has no siblings at all.
  // `collectReferences` is the population those four partition.
  const total = collectReferences(catalog).size;
  const finding = {
    ...summariseSiblingFinding(conflicts),
    nonAssertingReferences: nonAsserting,
    unclassifiedReferences: unclassified,
    referencesWithoutSiblings: total - conflicts.length - nonAsserting - unclassified,
    totalReferences: total,
  };
  assetSet.siblingFindings = finding;
  return finding;
}

/**
 * Summarise the assertion-bearing sibling finding.
 *
 * Everything here is derived from the events the walk emitted: the number of
 * affected objects, a histogram of keyword patterns, the individual keywords, and
 * every location. Nothing is hardcoded, so the record cannot drift away from the
 * documents it describes.
 */
export function summariseSiblingFinding(events) {
  const byPattern = new Map();
  const byKeyword = new Map();
  const locations = [];
  for (const entry of events) {
    const siblings = entry.detail.siblings.slice().sort();
    const key = siblings.join('+');
    byPattern.set(key, (byPattern.get(key) ?? 0) + 1);
    for (const keyword of siblings) byKeyword.set(keyword, (byKeyword.get(keyword) ?? 0) + 1);
    locations.push({
      path: entry.detail.pointer.split('#')[0],
      pointer: entry.detail.pointer,
      reference: entry.detail.reference,
      siblings: entry.detail.allSiblings ?? siblings,
      assertionSiblings: siblings,
    });
  }
  return {
    references: events.length,
    patterns: [...byPattern].sort((a, b) => b[1] - a[1]).map(([siblings, count]) => ({ siblings: siblings.split('+'), count })),
    keywords: [...byKeyword].sort((a, b) => b[1] - a[1]).map(([keyword, count]) => ({ keyword, count })),
    locations: locations.sort((a, b) => (a.pointer < b.pointer ? -1 : a.pointer > b.pointer ? 1 : 0)),
  };
}

function safeResolve(reference, from, catalog) {
  try {
    return resolveReference(reference, from, catalog);
  } catch {
    return null;
  }
}

function checkMethodology(assetSet) {
  const report = {};
  for (const relative of assetSet.approved) {
    if (!relative.endsWith('.yaml')) continue;
    const document = assetSet.yaml.get(relative);
    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      fail('YAML_SHAPE', `${relative}: the methodology document must be a mapping`);
    }
    // The methodology states the status of each rule in the file itself. The
    // verifier preserves that status; it does not promote the file into a new
    // universal blocking policy and does not rewrite the stated status.
    const ruleNodes = countRuleNodes(document);
    report[relative] = { ruleNodes, topLevelKeys: Object.keys(document).sort() };
    if (ruleNodes === 0) fail('YAML_SHAPE', `${relative}: no rule nodes were found; the reviewed methodology carries rule material`);
  }
  return report;
}

function countRuleNodes(node, seen = new WeakSet()) {
  if (node === null || typeof node !== 'object' || seen.has(node)) return 0;
  seen.add(node);
  if (Array.isArray(node)) return node.reduce((total, item) => total + countRuleNodes(item, seen), 0);
  let total = 0;
  for (const [key, value] of Object.entries(node)) {
    if (key === '<rules>') total += Array.isArray(value) ? value.length : 1;
    total += countRuleNodes(value, seen);
  }
  return total;
}

// ---------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------

/**
 * Build the full specification manifest.
 *
 * Contract: the manifest binds **every file the package ships**, except itself.
 * That is the whole point of "the full manifest represents all shipped spec
 * content" — a manifest that lists only the imported assets leaves the metadata
 * that carries the version, the provenance and the review anchor unbound, so a
 * release could ship a different `source-import.yaml` or `reviewed-baseline.json`
 * than the one that was reviewed.
 *
 * The schema lock keeps its own, narrower role: it represents the schema subset
 * and is verified against the schema bytes by `checkSchemaLock`, not by this
 * manifest.
 *
 * Provenance stays honest per file. An imported asset points at the tools source
 * path and digest it came from; package metadata is owned by this repository and
 * is marked as such rather than being attributed to the source commit.
 *
 * The manifest cannot contain its own digest. Its identity is the `files` list
 * plus the two aggregate digests over it; one concrete archive is bound to that
 * identity by the external archive-binding record.
 */
export function buildManifest({ packageRoot, assetSet, importManifest, version = SPEC_VERSION }) {
  const packaged = resolvePackagedFiles(packageRoot);
  const declaredAssets = new Map(importManifest.files.map((entry) => [entry.packagePath, entry]));

  // The manifest is the only shipped file outside the byte-digest list, because
  // it cannot contain its own digest. Every other shipped file — `package.json`
  // included — carries an exact byte digest.
  const manifestEntries = packaged.files.filter((relative) => relative !== MANIFEST_PATH);

  // The manifest's own membership is a property of the `files` whitelist, not of
  // whether the file happens to exist yet: `--check` recomputes the manifest
  // before one is written, and requiring the artifact to exist in order to
  // describe itself would make that impossible. Presence is enforced separately,
  // by verification and by the drift check.
  if (!isDeclaredForPackaging(packaged, MANIFEST_PATH)) {
    fail('MANIFEST_SELF', `${MANIFEST_PATH} is not declared for packaging; the manifest must account for every shipped file`);
  }

  const files = manifestEntries.map((relative) => {
    const bytes = readFileSync(path.join(packageRoot, relative));
    const sha256 = sha256Hex(bytes);
    const contentSha256 = sha256Hex(normalizeLineEndings(bytes));
    const declared = declaredAssets.get(relative);
    if (declared !== undefined) {
      // The builder records both digests and does not judge them: whether the
      // shipped bytes match the reviewed import is a check with its own name and
      // message (`identity/source-bytes`), and folding it in here would republish
      // one failure under two codes and make the builder throw instead of report.
      return {
        path: relative,
        sha256,
        contentSha256,
        origin: importManifest.sourceRepoId,
        source: { path: declared.sourcePath, sha256: declared.sha256 },
      };
    }
    return {
      path: relative,
      sha256,
      contentSha256,
      origin: PACKAGE_METADATA_ORIGIN,
      source: null,
    };
  });

  const shippedAssets = new Set(assetSet.approved);
  const boundPaths = new Set(files.map((file) => file.path));
  const unbound = [...shippedAssets].filter((relative) => !boundPaths.has(relative));
  if (unbound.length > 0) {
    fail('MANIFEST_INCOMPLETE', `the manifest would not bind shipped specification assets: ${unbound.join(', ')}`);
  }

  const aggregate = hashCanonicalJson(Object.fromEntries(files.map((file) => [file.path, file.sha256])));
  const contentAggregate = hashCanonicalJson(Object.fromEntries(files.map((file) => [file.path, file.contentSha256])));
  const assetPaths = new Set(assetSet.approved);

  return {
    manifestVersion: MANIFEST_VERSION,
    package: { name: PACKAGE_NAME, version },
    specVersion: version,
    source: {
      repository: importManifest.sourceRepoCanonicalUrl,
      repositoryId: importManifest.sourceRepoId,
      commit: importManifest.sourceCommit,
      commitRef: importManifest.sourceCommitRef,
      license: { path: importManifest.sourceLicensePath, sha256: importManifest.sourceLicenseSha256, notice: importManifest.sourceLicenseNotice },
      excludedPaths: [...importManifest.excludedSourcePaths],
      // The imported tools assets and this repository's own metadata are two
      // different origins; the manifest never merges them into one claim.
      ownedMetadataOrigin: PACKAGE_METADATA_ORIGIN,
    },
    counts: {
      schemasPerLanguage: assetSet.schemaSets.en.fileNames.length,
      languages: Object.keys(assetSet.schemaSets).sort(),
      methodologies: files.filter((file) => file.path.startsWith(`${assetSet.assetRoot}/methodologies/`)).length,
      importedAssets: files.filter((file) => declaredAssets.has(file.path)).length,
      authoredAssets: files.filter((file) => assetPaths.has(file.path) && !declaredAssets.has(file.path)).length,
      packageMetadata: files.filter((file) => !assetPaths.has(file.path)).length,
      // `files.length` excludes the manifest itself; the package ships one more
      // file than this list contains.
      files: files.length,
      packagedFiles: files.length + 1,
    },
    assetRoot: assetSet.assetRoot,
    lock: `${assetSet.assetRoot}/schema.lock.json`,
    // The source finding travels with the release. It is derived from the shipped
    // documents, not asserted here, and it is recorded so a consumer of this
    // archive can see it without re-running the analysis. This repository does not
    // decide which reading is correct; that is a later disposition with consumer
    // evidence.
    findings: {
      refSiblings: analyseSiblingFindings(assetSet),
    },
    // Every shipped file carries an exact byte digest, `package.json` included.
    // The canonical archive and the npm tarball are the same artifact, so no file
    // needs a weaker identity for one channel than the other.
    files,
    aggregates: { filesSha256: aggregate, filesContentSha256: contentAggregate },
    selfHash: {
      note: 'The manifest cannot contain its own digest. Its identity is the `files`/`aggregates` block above, bound externally by the archive digest record produced alongside the candidate archive; see docs/specification.md.',
    },
  };
}

/** Whether the package's `files` whitelist declares a path, present or not. */
function isDeclaredForPackaging(packaged, relative) {
  if (packaged.files.includes(relative)) return true;
  const patterns = packaged.content?.patterns;
  if (patterns === null || patterns === undefined) return false;
  return patterns.some((pattern) => pattern === relative || globToRegExp(pattern).test(relative));
}


/**
 * The manifest as it exists on disk.
 *
 * Each verification stage must be runnable on its own — a reviewer checking an
 * archive should not have to re-derive it first — so a stage that needs the
 * declared asset list reads the committed manifest rather than requiring an
 * earlier stage to have built it in memory.
 */
function loadDeclaredManifest(repoRoot) {
  let text;
  try {
    text = readFileSync(path.join(repoRoot, MANIFEST_PATH), 'utf8');
  } catch (error) {
    return fail('MANIFEST_MISSING', `${MANIFEST_PATH}: cannot read: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return fail('MANIFEST_PARSE', `${MANIFEST_PATH}: malformed JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.files)) {
    fail('MANIFEST_SHAPE', `${MANIFEST_PATH}: expected an object with a \`files\` array`);
  }
  return parsed;
}

/**
 * Structural validation of the reviewed source identity.
 *
 * The verifier cannot re-derive these values — they describe an external
 * repository it deliberately does not read — but it can refuse to treat a
 * malformed or hand-typed value as an identity. A commit that is not a full
 * lowercase SHA, a missing digest, or a placeholder string is a failure here
 * rather than a claim that reaches a release record.
 */
function checkImportManifestIdentity(importManifest) {
  if (!/^[0-9a-f]{40}$/.test(importManifest.sourceCommit)) {
    fail('IMPORT_MANIFEST_SHAPE', `${IMPORT_MANIFEST_PATH}: sourceCommit must be a full 40-character lowercase commit SHA, found ${JSON.stringify(importManifest.sourceCommit)}`);
  }
  if (!/^[0-9a-f]{64}$/.test(importManifest.sourceLicenseSha256)) {
    fail('IMPORT_MANIFEST_SHAPE', `${IMPORT_MANIFEST_PATH}: sourceLicenseSha256 must be a lowercase SHA256 hex digest`);
  }
  for (const field of ['sourceRepoId', 'sourceRepoCanonicalUrl', 'sourceCommitRef', 'sourceLicensePath', 'sourceLicenseNotice']) {
    if (typeof importManifest[field] !== 'string' || importManifest[field].trim() === '') {
      fail('IMPORT_MANIFEST_SHAPE', `${IMPORT_MANIFEST_PATH}: \`${field}\` must be a non-empty string`);
    }
  }
  if (!Array.isArray(importManifest.excludedSourcePaths) || importManifest.excludedSourcePaths.length === 0) {
    fail('IMPORT_MANIFEST_SHAPE', `${IMPORT_MANIFEST_PATH}: \`excludedSourcePaths\` must record the source files this import deliberately leaves out`);
  }
  // The excluded set and the shipped set must not overlap: a file that is both
  // deliberately excluded and shipped would make the exclusion meaningless.
  const shipped = new Set(importManifest.files.map((file) => file.sourcePath));
  const overlap = importManifest.excludedSourcePaths.filter((path) => shipped.has(path));
  if (overlap.length > 0) {
    fail('IMPORT_MANIFEST_SHAPE', `${IMPORT_MANIFEST_PATH}: these paths are both shipped and listed as excluded: ${overlap.join(', ')}`);
  }
  return { commit: importManifest.sourceCommit, excluded: importManifest.excludedSourcePaths.length };
}

/**
 * Cross-check the reviewed source identity against the reviewed baseline record.
 *
 * The verifier cannot re-derive `sourceCommit` or `sourceLicenseSha256` — they
 * describe an external repository it deliberately does not read. It can, and
 * does, refuse to let a single edited file assert a different identity: the
 * import manifest and `reviewed-baseline.json` are separate reviewed inputs, so
 * they must agree, and the file digest they imply must be the digest of the
 * bytes actually shipped. Fabricating a source identity means changing the
 * implementation or both reviewed records, which is a review event rather than a
 * silent pass.
 */
function checkReviewedBaseline(repoRoot, importManifest, assetSet) {
  let baselineBuffer;
  try {
    baselineBuffer = readFileSync(path.join(repoRoot, REVIEWED_BASELINE_PATH));
  } catch (error) {
    return fail('REVIEWED_BASELINE_MISSING', `${REVIEWED_BASELINE_PATH}: cannot read: ${error.message}`);
  }
  const baseline = readJsonStrict(baselineBuffer, REVIEWED_BASELINE_PATH);
  for (const field of ['reviewedBaselineVersion', 'specVersion', 'fileCount', 'sourceFilesSha256', 'packageFilesSha256', 'source']) {
    if (!(field in baseline)) fail('REVIEWED_BASELINE_SHAPE', `${REVIEWED_BASELINE_PATH}: missing required field \`${field}\``);
  }
  const disagreements = [];
  if (baseline.source === null || typeof baseline.source !== 'object') {
    fail('REVIEWED_BASELINE_SHAPE', `${REVIEWED_BASELINE_PATH}: \`source\` must be an object`);
  }
  if (baseline.source.commit !== importManifest.sourceCommit) {
    disagreements.push(`source.commit: ${baseline.source.commit} != ${importManifest.sourceCommit}`);
  }
  if (baseline.source.repositoryId !== importManifest.sourceRepoId) {
    disagreements.push(`source.repositoryId: ${baseline.source.repositoryId} != ${importManifest.sourceRepoId}`);
  }
  if (baseline.source.repository !== importManifest.sourceRepoCanonicalUrl) {
    disagreements.push(`source.repository: ${baseline.source.repository} != ${importManifest.sourceRepoCanonicalUrl}`);
  }
  if (baseline.source.licenseSha256 !== importManifest.sourceLicenseSha256) {
    disagreements.push(`source.licenseSha256: ${baseline.source.licenseSha256} != ${importManifest.sourceLicenseSha256}`);
  }
  if (baseline.source.licensePath !== importManifest.sourceLicensePath) {
    disagreements.push(`source.licensePath: ${baseline.source.licensePath} != ${importManifest.sourceLicensePath}`);
  }
  if (disagreements.length > 0) {
    fail('SOURCE_IDENTITY', `${IMPORT_MANIFEST_PATH} and ${REVIEWED_BASELINE_PATH} disagree about the reviewed source: ${disagreements.join('; ')}`, { disagreements });
  }

  if (baseline.specVersion !== SPEC_VERSION) {
    fail('SOURCE_IDENTITY', `${REVIEWED_BASELINE_PATH}: specVersion ${JSON.stringify(baseline.specVersion)} != ${SPEC_VERSION}`);
  }
  if (baseline.fileCount !== importManifest.files.length) {
    fail('SOURCE_IDENTITY', `${REVIEWED_BASELINE_PATH}: fileCount ${baseline.fileCount} != import manifest ${importManifest.files.length}`);
  }

  const sourceHashes = Object.fromEntries(importManifest.files.map((file) => [file.sourcePath, file.sha256]));
  const sourceDigest = hashCanonicalJson(sourceHashes);
  if (sourceDigest !== baseline.sourceFilesSha256) {
    fail('SOURCE_IDENTITY', `${REVIEWED_BASELINE_PATH}: the source file digests it reviewed (${baseline.sourceFilesSha256}) do not match the import manifest's (${sourceDigest}); a fabricated or drifted source inventory cannot pass`);
  }
  const packageHashes = Object.fromEntries(importManifest.files.map((file) => file.packagePath).sort().map((relative) => [relative, assetSet.sha256.get(relative)]));
  const packageDigest = hashCanonicalJson(packageHashes);
  if (packageDigest !== baseline.packageFilesSha256) {
    fail('SOURCE_IDENTITY', `${REVIEWED_BASELINE_PATH}: the shipped bytes (${packageDigest}) are not the bytes it reviewed (${baseline.packageFilesSha256})`);
  }
  return { commit: baseline.source.commit, sourceFilesSha256: sourceDigest, packageFilesSha256: packageDigest };
}

function verifyManifest(repoRoot, diagnostics, state, { expectedSourceRevision = null } = {}) {
  const assetSet = state.assetSet ?? run(diagnostics, 'manifest/assets', () => loadAssetSet(repoRoot));
  const importManifest = state.importManifest ?? run(diagnostics, 'manifest/import-manifest', () => readImportManifest(repoRoot, IMPORT_MANIFEST_PATH));
  if (assetSet === undefined || importManifest === undefined) return;
  state.assetSet = assetSet;
  state.importManifest = importManifest;

  const declared = run(diagnostics, 'manifest/read', () => loadDeclaredManifest(repoRoot));
  if (declared === undefined) return;
  // The shipped manifest is the one every later stage binds to, so it is what the
  // archive stage compares against rather than a recomputation that may differ in
  // the qualification block.
  state.manifest = declared;
  const built = run(diagnostics, 'manifest/build', () => buildManifest({ packageRoot: repoRoot, assetSet, importManifest }));
  if (built === undefined) return;

  run(diagnostics, 'manifest/compare', () => {
    let shippedText;
    try {
      shippedText = readFileSync(path.join(repoRoot, MANIFEST_PATH), 'utf8');
    } catch (error) {
      return fail('MANIFEST_MISSING', `${MANIFEST_PATH}: cannot read: ${error.message}`);
    }
    let shipped;
    try {
      shipped = JSON.parse(shippedText);
    } catch (error) {
      return fail('MANIFEST_PARSE', `${MANIFEST_PATH}: malformed JSON: ${error.message}`);
    }
    if (shippedText !== formatJson(shipped)) {
      fail('MANIFEST_FORMAT', `${MANIFEST_PATH}: is not in the canonical build format (two-space indent, LF, single trailing newline)`);
    }
    if (shipped.releaseCommit !== undefined || shipped.reviewedPackageSource !== undefined) {
      fail(
        'MANIFEST_IDENTITY',
        `${MANIFEST_PATH}: contains a source-revision claim. The manifest is content-derived and cannot name the commit that contains it; the reviewed revision lives in the candidate receipt, outside every artifact it describes. See docs/qualification.md.`,
      );
    }
    // The comparison covers the entire manifest, field for field. The manifest is
    // a pure function of the shipped content, so nothing in it is held aside.
    if (canonicalJson(shipped) !== canonicalJson(built)) {
      const differences = diffJson(built, shipped);
      fail('MANIFEST_STALE', `${MANIFEST_PATH} does not match the shipped specification content (${differences.length} difference(s))`, { differences: differences.slice(0, 40) });
    }
    return { files: built.files.length, packagedFiles: built.counts.packagedFiles };
  });
}


function diffJson(expected, actual, pointer = '') {
  const out = [];
  const walk = (a, b, at) => {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) {
        out.push(`${at}: expected ${JSON.stringify(a)}, found ${JSON.stringify(b)}`);
        return;
      }
      if (a.length !== b.length) out.push(`${at}: length ${a.length} != ${b.length}`);
      for (let index = 0; index < Math.max(a.length, b.length); index += 1) walk(a[index], b[index], `${at}/${index}`);
      return;
    }
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) walk(a[key], b[key], `${at}/${key}`);
      return;
    }
    if (a !== b) out.push(`${at}: expected ${JSON.stringify(a)}, found ${JSON.stringify(b)}`);
  };
  walk(expected, actual, pointer);
  return out;
}

// ---------------------------------------------------------------------------
// package
// ---------------------------------------------------------------------------

/**
 * Files npm rewrites while packing.
 *
 * The npm client re-emits `package.json` from the parsed document: it drops
 * `packageManager` and writes the keys in its own order. That file therefore
 * cannot be byte-identical between the repository, the canonical archive, and an
 * npm-installed copy. Every other entry must be.
 *
 * The allowance is deliberately narrow and checked rather than assumed: the two
 * forms must be equal after removing exactly this field, so any real metadata
 * difference still fails. See docs/specification.md.
 */
/**
 * Non-asset files a published package is expected to carry.
 *
 * The package publishes specification content; everything else in it is
 * metadata that exists so a consumer can read and audit that content. Listing
 * them explicitly means an accidental addition (a stray document, a build log,
 * a second manifest) is a failure rather than extra published surface.
 */
const EXPECTED_PACKAGE_METADATA = Object.freeze([
  'LICENSE',
  'README.md',
  'package.json',
  'reviewed-baseline.json',
  'source-import.yaml',
  'spec-manifest.json',
]);

function verifyPackage(repoRoot, diagnostics, state) {
  const content = run(diagnostics, 'package/declared-content', () => resolvePackageContent(repoRoot));
  if (content === undefined) return;
  state.packageContent = content;

  run(diagnostics, 'package/identity', () => {
    if (content.packageJson.name !== PACKAGE_NAME) fail('PACKAGE_NAME', `package.json name must be ${PACKAGE_NAME}, found ${JSON.stringify(content.packageJson.name)}`);
    if (content.packageJson.version !== SPEC_VERSION) fail('PACKAGE_VERSION', `package.json version must be ${SPEC_VERSION}, found ${JSON.stringify(content.packageJson.version)}`);
    if (content.packageJson.private === true) fail('PACKAGE_PRIVATE', 'the specification package is published; `private: true` contradicts that');
    return { name: content.packageJson.name, version: content.packageJson.version };
  });

  run(diagnostics, 'package/license-declaration', () => {
    // A bare SPDX identifier would assert that the whole package carries that
    // license. The tools notice is verified, but per-artifact licensing of the
    // embedded classifications is not resolved (docs/provenance.md), so the
    // package must point at its license files instead of claiming a blanket
    // license. Changing this value is the last step of resolving provenance, not
    // a packaging preference.
    if (content.packageJson.license !== LICENSE_DECLARATION) {
      fail(
        'PACKAGE_LICENSE_CLAIM',
        `package.json must declare \`"license": ${JSON.stringify(LICENSE_DECLARATION)}\` while per-artifact licensing is unresolved; found ${JSON.stringify(content.packageJson.license)}. A blanket SPDX identifier would claim a license the provenance record does not establish.`,
      );
    }
    return { license: content.packageJson.license };
  });

  run(diagnostics, 'package/no-runtime-dependency', () => {
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies', 'bundleDependencies']) {
      const value = content.packageJson[field];
      if (value !== undefined && Object.keys(value).length > 0) {
        fail('PACKAGE_RUNTIME_DEPENDENCY', `package.json declares \`${field}\`; the specification package is asset-only and has no runtime dependency`);
      }
    }
    return { devDependencies: Object.keys(content.packageJson.devDependencies ?? {}).sort() };
  });

  run(diagnostics, 'package/no-install-hooks', () => {
    const scripts = content.packageJson.scripts ?? {};
    const forbidden = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack'];
    const found = forbidden.filter((name) => name in scripts);
    if (found.length > 0) {
      fail('PACKAGE_INSTALL_HOOK', `package.json declares lifecycle script(s) ${found.map((name) => `\`${name}\``).join(', ')}; consumers must be able to unpack and read the package without executing anything`);
    }
    return { scripts: Object.keys(scripts).sort() };
  });

  run(diagnostics, 'package/whitelist-covers-assets', () => {
    if (!content.hasFilesWhitelist) fail('PACKAGE_WHITELIST', 'package.json must declare a `files` whitelist so the published asset set is explicit');
    if (content.unresolvedPatterns.length > 0) {
      fail('PACKAGE_WHITELIST', `package.json \`files\` entries match nothing: ${content.unresolvedPatterns.join(', ')}`);
    }
    if (content.hiddenByWhitelist.length > 0) {
      fail('PACKAGE_WHITELIST', `files exist under assets/ but the \`files\` whitelist would not publish them: ${content.hiddenByWhitelist.join(', ')}`, { hidden: content.hiddenByWhitelist });
    }
    const approved = new Set(approvedAssetPaths());
    const shipped = new Set(content.shippedAssets);
    const notApproved = [...shipped].filter((relative) => !approved.has(relative));
    if (notApproved.length > 0) fail('PACKAGE_WHITELIST', `the package would publish files outside the approved specification set: ${notApproved.join(', ')}`);
    return { shipped: shipped.size };
  });

  run(diagnostics, 'package/canonical-serialization', () => {
    // The published channels must be byte-identical, and the npm client
    // re-serializes `package.json` with `JSON.stringify(_, null, 2)` and no
    // trailing newline. The repository copy is therefore kept in exactly that
    // form, which makes `pnpm pack` a no-op for this file instead of a rewrite
    // that would force one channel to carry different bytes from the other.
    const text = readFileSync(path.join(repoRoot, PACKAGE_JSON_PATH), 'utf8');
    const canonical = JSON.stringify(JSON.parse(text), null, 2);
    if (text !== canonical) {
      fail(
        'PACKAGE_JSON_SERIALIZATION',
        `package.json is not in the canonical published serialization the npm client produces (two-space indent, no trailing newline); the two channels would then carry different bytes for the same file`,
      );
    }
    return { bytes: Buffer.byteLength(text, 'utf8') };
  });

  run(diagnostics, 'package/published-file-set', () => {
    const packaged = resolvePackagedFiles(repoRoot);
    const allowed = new Set([...approvedAssetPaths(), ...EXPECTED_PACKAGE_METADATA]);
    const unexpected = packaged.files.filter((relative) => !allowed.has(relative));
    if (unexpected.length > 0) {
      fail(
        'PACKAGE_EXTRA_FILE',
        `the package would publish files that are neither approved specification assets nor expected package metadata: ${unexpected.join(', ')}`,
        { unexpected },
      );
    }
    const missingMetadata = EXPECTED_PACKAGE_METADATA.filter((relative) => !packaged.files.includes(relative));
    if (missingMetadata.length > 0) {
      fail('PACKAGE_METADATA_MISSING', `the package must carry its provenance and manifest metadata: missing ${missingMetadata.join(', ')}`, { missingMetadata });
    }
    return { packaged: packaged.files.length };
  });
}

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

function verifyArchive(repoRoot, diagnostics, state, { archivePath, tempParent, logger, expectedSourceRevision }) {
  const target = archivePath ?? path.join(repoRoot, RELEASE_ROOT, archiveFileName());
  if (!existsSync(target)) {
    return diagnostics.error('archive/missing', `${target}: candidate archive does not exist; run the build first`);
  }
  state.archivePath = target;

  const unpackRoot = mkdtempSync(path.join(tempParent, 'tidas-spec-archive-'));
  try {
    // The archive is read with this project's own ustar parser rather than with
    // the host `tar`. Two reasons: entry names are validated for traversal
    // before anything touches the filesystem, and symlink or device entries are
    // refused instead of being materialized. Extraction is confined to a
    // temporary directory created for this verification.
    const extracted = run(diagnostics, 'archive/read', () => {
      let compressed;
      try {
        compressed = readFileSync(target);
      } catch (error) {
        return fail('ARCHIVE_READ', `cannot read ${target}: ${error.message}`);
      }
      let tar;
      try {
        tar = gunzipSync(compressed);
      } catch (error) {
        return fail('ARCHIVE_READ', `${target} is not a readable gzip stream: ${error.message}`);
      }
      const entries = readTarEntries(tar);
      if (entries.length === 0) fail('ARCHIVE_READ', `${target} contains no entries`);
      return { entries, unpackRoot };
    });
    if (extracted === undefined) return;

    const written = run(diagnostics, 'archive/extract', () => {
      const rootWithSeparator = `${unpackRoot}${path.sep}`;
      for (const item of extracted.entries) {
        const destination = path.resolve(unpackRoot, item.entry);
        if (!destination.startsWith(rootWithSeparator)) {
          fail('ARCHIVE_PATH', `archive entry escapes the extraction root: ${item.entry}`);
        }
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, item.content, { mode: 0o644 });
      }
      return { files: extracted.entries.length };
    });
    if (written === undefined) return;

    const layout = run(diagnostics, 'archive/package-root', () => {
      const entries = readdirSync(unpackRoot);
      if (entries.length !== 1 || entries[0] !== 'package') {
        fail('ARCHIVE_LAYOUT', `archive must contain exactly one top-level \`package/\` directory, found: ${entries.join(', ') || '(nothing)'}`);
      }
      return { entry: 'package' };
    });
    if (layout === undefined) return;

    const packageRoot = path.join(unpackRoot, 'package');
    const archiveAssetSet = run(diagnostics, 'archive/read-offline', () => loadAssetSet(packageRoot));
    if (archiveAssetSet === undefined) return;
    state.archiveAssetSet = archiveAssetSet;

    run(diagnostics, 'archive/asset-bytes', () => {
      // The imported specification assets must appear in the archive with the
      // bytes the outer manifest binds. Full file-set coverage is checked
      // separately, against the archive's own manifest.
      const declared = state.manifest ?? loadDeclaredManifest(repoRoot);
      const byPath = new Map(declared.files.map((file) => [file.path, file]));
      const differences = [];
      for (const relative of archiveAssetSet.approved) {
        const entry = byPath.get(relative);
        if (entry === undefined) {
          differences.push(`${relative}: shipped asset has no manifest entry`);
          continue;
        }
        const actual = archiveAssetSet.sha256.get(relative);
        if (actual !== entry.sha256) differences.push(`${relative}: archive ${actual} != manifest ${entry.sha256}`);
      }
      if (differences.length > 0) {
        fail('ARCHIVE_ASSET_MISMATCH', `archive asset bytes differ from the manifest: ${differences.slice(0, 20).join(' | ')}`, { differences });
      }
      return { assets: archiveAssetSet.approved.length };
    });

    run(diagnostics, 'archive/self-verification', () => {
      // The archive must be verifiable as a package on its own: this is the
      // "read it after unpacking, with no sibling checkout" requirement.
      const result = verifyCandidate({ repoRoot: packageRoot, stages: ['identity', 'manifest', 'package'], tempParent, logger });
      if (!result.diagnostics.ok) {
        fail('ARCHIVE_SELF_VERIFY', `the extracted archive fails its own verification: ${result.diagnostics.errors.map((item) => `${item.code}: ${item.message}`).join(' | ')}`, { errors: result.diagnostics.errors });
      }
      return { checks: result.diagnostics.items.filter((item) => item.severity === 'info').length };
    });

    run(diagnostics, 'archive/manifest-identity', () => {
      // The archive's manifest is the manifest the package ships. Bytes, not a
      // re-derivation: a package whose own manifest differs from the manifest of
      // the candidate it was built from is not the reviewed candidate.
      const innerPath = path.join(packageRoot, MANIFEST_PATH);
      let innerBuffer;
      try {
        innerBuffer = readFileSync(innerPath);
      } catch (error) {
        return fail('ARCHIVE_MANIFEST_MISSING', `the archive must carry \`package/${MANIFEST_PATH}\`: ${error.message}`);
      }
      const outerBuffer = readFileSync(path.join(repoRoot, MANIFEST_PATH));
      if (sha256Hex(innerBuffer) !== sha256Hex(outerBuffer)) {
        fail(
          'ARCHIVE_MANIFEST_MISMATCH',
          `the manifest inside the archive is not the candidate's manifest (archive ${sha256Hex(innerBuffer)}, repository ${sha256Hex(outerBuffer)})`,
        );
      }
      return { manifestSha256: sha256Hex(innerBuffer) };
    });

    run(diagnostics, 'archive/manifest-self-consistency', () => {
      // Independent of the outer manifest: recompute the full manifest from the
      // bytes the archive actually contains and require the archive's own
      // manifest to match. This is what makes an internally inconsistent archive
      // fail even when its outer digest and the external binding agree.
      const innerManifest = loadDeclaredManifest(packageRoot);
      const innerImportManifest = readImportManifest(packageRoot, IMPORT_MANIFEST_PATH);
      const recomputed = buildManifest({
        packageRoot,
        assetSet: archiveAssetSet,
        importManifest: innerImportManifest,
      });
      const differences = diffJson(recomputed, innerManifest);
      if (differences.length > 0) {
        fail(
          'ARCHIVE_MANIFEST_INCONSISTENT',
          `the manifest inside the archive does not describe the archive's own contents (${differences.length} difference(s))`,
          { differences: differences.slice(0, 40) },
        );
      }
      return { files: recomputed.files.length };
    });

    run(diagnostics, 'archive/published-file-set', () => {
      // The archive must carry exactly the declared package: every manifest entry
      // plus the manifest itself. An extra file is published surface that no
      // review covers; a missing one is a package that cannot be verified.
      // Every shipped file must be accounted for: the byte-digest list, plus the
      // manifest itself, which is bound from outside by the binding record.
      const declared = new Set([
        ...loadDeclaredManifest(repoRoot).files.map((file) => file.path),
        MANIFEST_PATH,
      ]);
      const present = new Set(
        listFilesRecursive(packageRoot, { rejectSymlinks: false }).map((relative) => relative.split(path.sep).join('/')),
      );
      const extra = [...present].filter((relative) => !declared.has(relative));
      const absent = [...declared].filter((relative) => !present.has(relative));
      if (absent.length > 0) fail('ARCHIVE_FILE_MISSING', `the archive is missing declared file(s): ${absent.join(', ')}`, { absent });
      if (extra.length > 0) fail('ARCHIVE_FILE_EXTRA', `the archive carries file(s) no manifest entry declares: ${extra.join(', ')}`, { extra });
      return { files: present.size };
    });

    run(diagnostics, 'archive/binding', () => {
      const bindingPath = path.join(repoRoot, ARCHIVE_BINDING_PATH);
      if (!existsSync(bindingPath)) {
        // The receipt is disposable build output. On a fresh checkout it is
        // legitimately absent, and the archive's own integrity is already fully
        // established by the layout, file-set, internal-manifest and
        // self-verification checks above. What the receipt adds is the source
        // revision and the toolchain-dependent artifact digests, so its absence
        // is a note — unless a revision was explicitly asserted, in which case
        // there is nothing to check the assertion against.
        if (expectedSourceRevision !== null && expectedSourceRevision !== undefined) {
          fail('ARCHIVE_BINDING_MISSING', `${ARCHIVE_BINDING_PATH}: a source revision was asserted but no receipt is present to record it`);
        }
        diagnostics.warn(
          'archive/binding/absent',
          `${ARCHIVE_BINDING_PATH}: no candidate receipt is present, so the reviewed source revision and the recorded artifact digests could not be checked; the archive itself verified on its content`,
        );
        return { receipt: null };
      }
      let binding;
      try {
        binding = JSON.parse(readFileSync(bindingPath, 'utf8'));
      } catch (error) {
        return fail('ARCHIVE_BINDING_PARSE', `${ARCHIVE_BINDING_PATH}: malformed JSON: ${error.message}`);
      }
      const actualArchiveSha = sha256Hex(readFileSync(target));
      const recordedRuntime = binding.buildRuntime ?? null;
      if (recordedRuntime !== null && recordedRuntime.node !== process.version) {
        diagnostics.warn(
          'archive/binding/runtime-mismatch',
          `${ARCHIVE_BINDING_PATH}: recorded by node ${recordedRuntime.node} (zlib ${recordedRuntime.zlib}), verifying under node ${process.version} (zlib ${process.versions.zlib}); the uncompressed tar is runtime-independent but the gzip framing is not, so byte equality is guaranteed within one pinned toolchain`,
          { recorded: recordedRuntime, current: { node: process.version, zlib: process.versions.zlib } },
        );
      }
      // Shape first: every declared field must be present and of the right type,
      // so a missing field fails as a missing field rather than as a mismatch
      // against `undefined`.
      const REQUIRED_RECEIPT_FIELDS = [
        ['receiptVersion', 'number'],
        ['package', 'string'],
        ['version', 'string'],
        ['archiveFile', 'string'],
        ['archiveSha256', 'string'],
        ['manifestSha256', 'string'],
        ['assetFilesSha256', 'string'],
        ['assetFilesContentSha256', 'string'],
        ['assetFileCount', 'number'],
        ['importedAssetFileCount', 'number'],
        ['packagedFileCount', 'number'],
        ['qualification', 'string'],
        ['qualificationBasis', 'string'],
        ['buildRuntime', 'object'],
      ];
      const missing = REQUIRED_RECEIPT_FIELDS
        .filter(([field, type]) => typeof binding[field] !== type)
        .map(([field, type]) => `${field} (expected ${type}, found ${binding[field] === undefined ? 'nothing' : typeof binding[field]})`);
      if (missing.length > 0) {
        fail('ARCHIVE_BINDING_SHAPE', `${ARCHIVE_BINDING_PATH}: malformed or incomplete receipt: ${missing.join('; ')}`);
      }

      if (binding.package !== PACKAGE_NAME) fail('ARCHIVE_BINDING_IDENTITY', `${ARCHIVE_BINDING_PATH}: package ${JSON.stringify(binding.package)} != ${PACKAGE_NAME}`);
      if (binding.version !== SPEC_VERSION) fail('ARCHIVE_BINDING_IDENTITY', `${ARCHIVE_BINDING_PATH}: version ${JSON.stringify(binding.version)} != ${SPEC_VERSION}`);
      if (binding.archiveFile !== path.basename(target)) fail('ARCHIVE_BINDING_IDENTITY', `${ARCHIVE_BINDING_PATH}: archiveFile ${JSON.stringify(binding.archiveFile)} != ${path.basename(target)}`);
      // Hashing bytes on disk does not depend on the verifier's runtime, so the
      // recorded archive digest is always checkable and always checked.
      if (binding.archiveSha256 !== actualArchiveSha) {
        fail('ARCHIVE_BINDING_DIGEST', `${ARCHIVE_BINDING_PATH}: recorded archive digest ${binding.archiveSha256} does not match the archive (${actualArchiveSha})`);
      }
      // The declared manifest digest is checked against the committed manifest
      // whenever verification has read it, in every stage combination.
      const declaredManifest = state.manifest ?? loadDeclaredManifest(repoRoot);
      const committedManifestSha = sha256Hex(readFileSync(path.join(repoRoot, MANIFEST_PATH)));
      if (binding.manifestSha256 !== committedManifestSha) {
        fail('ARCHIVE_BINDING_DIGEST', `${ARCHIVE_BINDING_PATH}: recorded manifest digest ${binding.manifestSha256} does not match the committed manifest (${committedManifestSha})`);
      }
      const declared = declaredManifest;
      const digest = declared?.aggregates?.filesSha256;
      if (typeof digest !== 'string') fail('ARCHIVE_BINDING_MISSING', `${MANIFEST_PATH}: the manifest declares no \`aggregates.filesSha256\` for the binding to reference`);
      if (binding.assetFilesSha256 !== digest) {
        fail('ARCHIVE_BINDING_DIGEST', `${ARCHIVE_BINDING_PATH}: asset digest ${binding.assetFilesSha256} does not match the manifest digest ${digest}`);
      }
      if (binding.assetFilesContentSha256 !== declared?.aggregates?.filesContentSha256) {
        fail('ARCHIVE_BINDING_DIGEST', `${ARCHIVE_BINDING_PATH}: content digest ${binding.assetFilesContentSha256} does not match the manifest digest ${declared?.aggregates?.filesContentSha256}`);
      }
      const declaredCount = declared.files.length;
      // The receipt is the only place a reviewed source revision is recorded, and
      // it lives outside every artifact it describes. Verification checks the
      // revision against the packager-supplied expectation, and checks that the
      // receipt's artifact digests describe the artifacts actually present.
      const receiptSource = binding.sourceRevision ?? null;
      if (receiptSource !== null) {
        if (!/^[0-9a-f]{40}$/.test(receiptSource.commit ?? '')) {
          fail('ARCHIVE_BINDING_SOURCE', `${ARCHIVE_BINDING_PATH}: sourceRevision.commit must be a full 40-character lowercase commit SHA, found ${JSON.stringify(receiptSource.commit)}`);
        }
        if (receiptSource.treeState !== 'clean') {
          fail('ARCHIVE_BINDING_SOURCE', `${ARCHIVE_BINDING_PATH}: a qualified candidate must record treeState "clean", found ${JSON.stringify(receiptSource.treeState)}`);
        }
          if (expectedSourceRevision !== null && receiptSource.commit !== expectedSourceRevision.commit) {
          fail(
            'ARCHIVE_BINDING_SOURCE',
            `${ARCHIVE_BINDING_PATH}: records source revision ${receiptSource.commit}, but this verification expected ${expectedSourceRevision.commit}`,
            { recorded: receiptSource.commit, expected: expectedSourceRevision.commit },
          );
        }
        if (expectedSourceRevision !== null && receiptSource.treeState !== expectedSourceRevision.treeState) {
          fail('ARCHIVE_BINDING_SOURCE', `${ARCHIVE_BINDING_PATH}: records treeState ${JSON.stringify(receiptSource.treeState)}, but this verification expected ${JSON.stringify(expectedSourceRevision.treeState)}`);
        }
      } else if (expectedSourceRevision !== null && expectedSourceRevision.qualification === QUALIFICATION_QUALIFIED) {
        fail('ARCHIVE_BINDING_SOURCE', `${ARCHIVE_BINDING_PATH}: no source revision is recorded, but a qualified revision (${expectedSourceRevision.commit}) was expected`);
      }

      if (binding.assetFileCount !== declaredCount) {
        fail('ARCHIVE_BINDING_DIGEST', `${ARCHIVE_BINDING_PATH}: asset file count ${binding.assetFileCount} does not match the manifest's ${declaredCount}`);
      }
      const importedCount = declared.counts.importedAssets;
      if (binding.importedAssetFileCount !== importedCount) {
        fail('ARCHIVE_BINDING_DIGEST', `${ARCHIVE_BINDING_PATH}: imported asset count ${binding.importedAssetFileCount} does not match the manifest's ${importedCount}`);
      }
      if (binding.packagedFileCount !== binding.assetFileCount + 1) {
        fail(
          'ARCHIVE_BINDING_DIGEST',
          `${ARCHIVE_BINDING_PATH}: packagedFileCount ${binding.packagedFileCount} must be the manifest-bound file count plus the manifest itself (${binding.assetFileCount + 1})`,
        );
      }
      if (declared?.counts?.packagedFiles !== undefined && binding.packagedFileCount !== declared.counts.packagedFiles) {
        fail('ARCHIVE_BINDING_DIGEST', `${ARCHIVE_BINDING_PATH}: packagedFileCount ${binding.packagedFileCount} does not match the manifest's ${declared.counts.packagedFiles}`);
      }

      // `qualification` and `sourceRevision` are two encodings of one fact. They
      // must agree, or a receipt could claim one state while carrying the other.
      if (binding.qualification === QUALIFICATION_QUALIFIED) {
        if (receiptSource === null) fail('ARCHIVE_BINDING_SOURCE', `${ARCHIVE_BINDING_PATH}: qualification is "qualified" but no source revision is recorded`);
      } else if (binding.qualification === QUALIFICATION_DRAFT) {
        if (receiptSource !== null) fail('ARCHIVE_BINDING_SOURCE', `${ARCHIVE_BINDING_PATH}: qualification is "draft" but a source revision is recorded`);
      } else {
        fail('ARCHIVE_BINDING_SHAPE', `${ARCHIVE_BINDING_PATH}: qualification must be "${QUALIFICATION_DRAFT}" or "${QUALIFICATION_QUALIFIED}", found ${JSON.stringify(binding.qualification)}`);
      }
      // A qualified candidate is only ever produced by validating a repository;
      // the basis field says which path produced it, and only the build may claim
      // it revalidated one.
      const QUALIFIED_BASES = new Set(['qualified-from-repository', 'carried-forward-and-revalidated']);
      if (binding.qualification === QUALIFICATION_QUALIFIED && !QUALIFIED_BASES.has(binding.qualificationBasis)) {
        fail(
          'ARCHIVE_BINDING_SOURCE',
          `${ARCHIVE_BINDING_PATH}: qualificationBasis ${JSON.stringify(binding.qualificationBasis)} does not establish a qualified candidate; expected one of ${[...QUALIFIED_BASES].join(', ')}`,
        );
      }
      if (typeof binding.buildRuntime?.node !== 'string' || typeof binding.buildRuntime?.zlib !== 'string') {
        fail('ARCHIVE_BINDING_SHAPE', `${ARCHIVE_BINDING_PATH}: buildRuntime must record the producing node and zlib versions`);
      }
      return { archiveSha256: actualArchiveSha, assetFilesSha256: digest, qualification: binding.qualification, qualificationBasis: binding.qualificationBasis };
    });
  } finally {
    rmSync(unpackRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

/**
 * Run a check and return its value, or `undefined` when it failed.
 *
 * A failed check has already been recorded with its code and message, so the
 * caller only has to decide whether later checks can still proceed.
 */
function run(diagnostics, id, fn) {
  const outcome = diagnostics.check(id, fn);
  return outcome.ok ? outcome.result : undefined;
}

export { readJsonStrict, listFilesRecursive, canonicalJson };
