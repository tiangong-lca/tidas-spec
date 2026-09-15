// Offline reference closure for the shipped JSON Schemas.
//
// What this module enforces:
//   * Every `$ref` resolves inside the package. A reference that leaves the
//     package, needs the network, or names a fragment the target does not define
//     is an error. Nothing is ever fetched.
//   * Only schema positions are walked. `examples`, `default`, `enum`, and
//     `const` carry instance data; a `$ref`-shaped key inside them is data.
//   * The vocabulary is the dialect the source declares: Draft 7. Keywords
//     introduced by later drafts (`dependentSchemas`, `unevaluatedProperties`,
//     `prefixItems`, ...) are not Draft 7 schema positions. They are not walked
//     on their own authority.
//
// The last point needs one qualification, and it is the reason this module is
// structured the way it is. The reviewed source stores its shared type
// definitions under `$defs`, which is a 2019-09 keyword — under a Draft 7
// reading `$defs` is just an unknown member. Treating it as a plain annotation
// would silently drop real transitive closure, because the source's `$ref`s
// point into it. So the walker does not classify storage locations at all:
//
//     A location is a schema position because a reference *reached* it, not
//     because of the keyword it happens to be stored under.
//
// Closure starts at each document root (the package's own entry points) and
// follows resolved references. `#/$defs/UUID` makes `/$defs/UUID` a live schema
// position, so its own `$ref`s are followed in turn. An unreferenced member of
// `$defs` — or of any extension keyword — is never walked, so it cannot invent a
// constraint the specification does not make.
//
// Resource scope is implemented, not assumed away. Draft 7 core section 8.2
// makes `$id` establish the base URI for its own subschema, so the resolver
// indexes every schema resource in the package before it resolves anything:
//
//     each document root is a resource, and every subschema carrying a
//     non-fragment `$id` starts a nested resource whose base is that identifier
//     resolved against its parent's base.
//
// A reference is then resolved against the base in effect at its own location,
// and the result must name a resource the package actually contains. An
// identifier that names a resource the package does not contain is reported,
// because resolving through it offline would mean guessing. Nothing is ever
// fetched: an unresolvable base is a failure with its location, never a network
// request.
//
// A `$ref` object's siblings are Draft 7 behaviour: `$ref` replaces the object,
// so siblings do not apply (core section 8.3). Siblings are classified rather
// than lumped together:
//
//   * an object whose siblings are all non-asserting is reported as
//     `ref-applicability` — informational, because nothing about instance
//     validity turns on it;
//   * an object with any asserting sibling is reported as `ref-sibling-conflict`,
//     carrying each affected keyword. Ignoring such a sibling changes which
//     instances the document accepts, so it is a source finding rather than
//     context;
//   * an object whose siblings include a keyword the declared dialect does not
//     define is reported as `ref-sibling-unclassified`. Such a keyword has no
//     established assertion semantics here, so it is neither counted as a
//     constraint nor claimed to cause evaluator disagreement — it is an
//     extension the reader should see.
//
// The reviewed source has objects of the first two kinds. The split is not
// hardcoded here: it is derived from the documents, reported with counts and
// locations, and recorded in the manifest for the difference-disposition work
// package. This module does not decide which evaluator is right, and it never
// changes the source bytes.
//
// `SCHEMA_DIRECTORIES` states where a schema may live, so a reference cannot
// reach into package metadata that happens to be a shipped file.

import path from 'node:path';
import { fail } from './core.mjs';

/** Keywords that hold a single subschema. */
const SCHEMA_VALUED_KEYWORDS = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'else',
  'if',
  'not',
  'propertyNames',
  'then',
]);

/** Keywords that hold an array of subschemas. */
const SCHEMA_ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf']);

/** Keywords that hold a map of name -> subschema. */
const SCHEMA_MAP_KEYWORDS = new Set(['definitions', 'properties', 'patternProperties']);

/**
 * Keywords whose value is instance data and must never be descended into as if it
 * were a schema.
 *
 * This answers a different question from `classifySiblingKeyword`: it is about
 * *traversal*. `const` and `enum` appear here and are also assertions — a value
 * need not be walked to restrict the instance.
 */
export const INSTANCE_DATA_KEYWORDS = new Set(['const', 'default', 'enum', 'examples']);

/** `items` is a schema or an array of schemas (Draft 7 tuple form). */
const ITEMS = 'items';

/** `dependencies` is either a schema or an array of property names (Draft 7). */
const DEPENDENCIES = 'dependencies';

/**
 * Draft 7 assertion keywords: their presence changes which instances are valid.
 *
 * This is the classification that decides whether a `$ref` object's sibling is
 * reported as a source finding. It is deliberately separate from
 * `INSTANCE_DATA_KEYWORDS`, which answers a different question — whether a value
 * may be *recursively traversed* as schema. `enum` and `const` are instance data
 * (never descended into) and assertions (they restrict the instance) at the same
 * time; conflating the two questions is what made an earlier revision report a
 * `const` sibling as a mere annotation and drop the finding entirely.
 *
 * The list is the Draft 7 validation vocabulary. Keywords that only carry
 * metadata (`title`, `description`, `examples`, ...) are not assertions and are
 * listed separately below.
 */
const ASSERTION_KEYWORDS = new Set([
  // numeric
  'multipleOf',
  'maximum',
  'exclusiveMaximum',
  'minimum',
  'exclusiveMinimum',
  // string
  'maxLength',
  'minLength',
  'pattern',
  // array
  'items',
  'additionalItems',
  'maxItems',
  'minItems',
  'uniqueItems',
  'contains',
  // object
  'maxProperties',
  'minProperties',
  'required',
  'properties',
  'patternProperties',
  'additionalProperties',
  'dependencies',
  'propertyNames',
  // any
  'enum',
  'const',
  'type',
  'format',
  // applicators
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
]);

/**
 * Keywords that carry no assertion.
 *
 * A `$ref` object's sibling from this set cannot change which instances are
 * valid under any reading, so it is reported as inapplicable-but-harmless rather
 * than as a source finding. `definitions`/`$defs` belong here too: the
 * definitions are only reachable through a reference, which the `$ref` already
 * replaces.
 */
const NON_ASSERTION_KEYWORDS = new Set([
  '$comment',
  '$id',
  'id',
  '$schema',
  'title',
  'description',
  'default',
  'examples',
  'readOnly',
  'writeOnly',
  'definitions',
  '$defs',
]);

/**
 * Classify one `$ref` object's sibling keyword.
 *
 * Returns:
 *   * `'assertion'` — a keyword of the declared dialect whose presence restricts
 *     the instance, so ignoring it changes what the file appears to state;
 *   * `'non-assertion'` — metadata (`title`, `examples`) or a reserved container
 *     (`definitions`, `$defs`); it cannot change instance validity;
 *   * `'unknown'` — a keyword this module does not recognise.
 *
 * `unknown` is reported as its own category, not folded into either of the
 * others. Under the declared dialect such a keyword has **no established
 * assertion semantics**: it is not evidence that the instance is restricted, and
 * it is also not evidence of any conflict between evaluators. Saying otherwise
 * would claim more than the source establishes. It stays visible so a reader can
 * see that the extension is there.
 */
export function classifySiblingKeyword(keyword) {
  if (NON_ASSERTION_KEYWORDS.has(keyword)) return 'non-assertion';
  if (ASSERTION_KEYWORDS.has(keyword)) return 'assertion';
  return 'unknown';
}

/**
 * Package-relative directories a reference may resolve into.
 *
 * The closure rule is that a reference stays inside the package, but "inside the
 * package" is not the same as "inside any file the build happens to ship": a
 * reference into `assets/tidas/schema.lock.json` would be reaching out of the
 * schema sets into package metadata, which is not a resolvable schema target.
 */
export const SCHEMA_DIRECTORIES = Object.freeze(['assets/tidas/schemas', 'assets/tidas/schemas_zh']);

// ---------------------------------------------------------------------------
// JSON Pointer (RFC 6901)
// ---------------------------------------------------------------------------

/**
 * Decode one pointer token: the RFC 6901 escape sequences, in the order the RFC
 * specifies (`~1` before `~0`, so `~01` decodes to `~1` and not to `/`).
 *
 * A `~` not followed by `0` or `1` is not a valid escape and is rejected rather
 * than passed through, which is what makes `#/~2` a failure instead of a lookup
 * for a member literally named `~2`.
 *
 * No percent-decoding happens here: URI fragment decoding is applied once, by
 * the caller, before the pointer is split into tokens.
 */
export function decodeJsonPointerToken(rawToken, label, reference) {
  let out = '';
  for (let index = 0; index < rawToken.length; index += 1) {
    const char = rawToken[index];
    if (char !== '~') {
      out += char;
      continue;
    }
    const next = rawToken[index + 1];
    if (next === '0') out += '~';
    else if (next === '1') out += '/';
    else {
      return fail(
        'REF_POINTER_ESCAPE',
        `${label}: invalid JSON pointer escape \`~${next ?? ''}\` in token ${JSON.stringify(rawToken)} of \`${reference}\`; RFC 6901 allows only \`~0\` and \`~1\``,
      );
    }
    index += 1;
  }
  return out;
}

/** Whether a pointer addresses a location that exists in the document. */
export function pointerExists(document, pointer, label, reference) {
  if (pointer === '') return true;
  if (!pointer.startsWith('/')) {
    return fail('REF_POINTER_SYNTAX', `${label}: JSON pointer must start with \`/\`: \`#${pointer}\` in \`${reference}\``);
  }
  let current = document;
  for (const rawToken of pointer.slice(1).split('/')) {
    const token = decodeJsonPointerToken(rawToken, label, reference);
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return false;
      const index = Number(token);
      if (index >= current.length) return false;
      current = current[index];
      continue;
    }
    if (current !== null && typeof current === 'object') {
      if (!Object.hasOwn(current, token)) return false;
      current = current[token];
      continue;
    }
    return false;
  }
  return true;
}

/** Escape one member name for use inside a JSON pointer. */
export function escapePointerToken(token) {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

// ---------------------------------------------------------------------------
// traversal
// ---------------------------------------------------------------------------

/**
 * Child schema positions of one schema object.
 *
 * `node` must already be at a live schema position. The generator yields the
 * pointer and value of each nested schema position; nothing else is descended
 * into, so extension members of unknown meaning contribute no references.
 */
export function* schemaChildren(node, pointer) {
  for (const [keyword, value] of Object.entries(node)) {
    const childPointer = `${pointer}/${escapePointerToken(keyword)}`;
    if (keyword === '$ref' || keyword === '$id' || keyword === 'id') continue;
    if (INSTANCE_DATA_KEYWORDS.has(keyword)) continue;
    if (SCHEMA_MAP_KEYWORDS.has(keyword)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const [name, subschema] of Object.entries(value)) {
          yield [`${childPointer}/${escapePointerToken(name)}`, subschema];
        }
      }
      continue;
    }
    if (keyword === DEPENDENCIES) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const [name, dependency] of Object.entries(value)) {
          if (Array.isArray(dependency)) continue; // property-dependency form: instance data
          yield [`${childPointer}/${escapePointerToken(name)}`, dependency];
        }
      }
      continue;
    }
    if (keyword === ITEMS) {
      yield [childPointer, value];
      continue;
    }
    if (SCHEMA_VALUED_KEYWORDS.has(keyword) || SCHEMA_ARRAY_KEYWORDS.has(keyword)) {
      yield [childPointer, value];
    }
    // Any other keyword is a Draft 7 annotation, an unknown member, or a keyword
    // from a later draft. None of them is a schema position on its own authority.
  }
}

/**
 * Walk one live schema position, following resolved references, and report
 * structural problems through `report`.
 *
 * `report(code, category, message, detail)` receives:
 *   * `ref-applicability` (`applicability`) — a `$ref` object carries siblings
 *     that Draft 7 does not apply, but none of them is a constraint
 *   * `ref-sibling-conflict` (`conflict`) — one of those siblings does apply a
 *     constraint, so dropping it would change what the file appears to state
 *   * `id-scope-unsupported` (`conflict`) — an `$id` that would establish a new
 *     resource base, which this offline resolver will not guess at
 *
 * A reference that cannot be resolved is reported by the caller, which owns the
 * resolver, so this walker stays a pure traversal.
 */
function walkLive(node, pointer, context) {
  const { packagePath, catalog, report, resolve, visited } = context;
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    // Round-tripped Draft 7 schemas may hold an `items` array; its members are
    // schemas because the parent keyword said so.
    node.forEach((item, index) => walkLive(item, `${pointer}/${index}`, context));
    return;
  }

  const identity = `${packagePath}#${pointer}`;
  if (visited.has(identity)) return;
  visited.add(identity);

  const reference = typeof node.$ref === 'string' ? node.$ref : null;
  if (reference !== null) {
    const siblings = Object.keys(node).filter((key) => key !== '$ref');
    // Classify once, here, so the caller never has to re-derive which siblings
    // assert. Three groups, kept apart on purpose: a known assertion is evidence
    // that the file states a constraint; a non-assertion cannot state one; an
    // unrecognised keyword is neither.
    const constraints = siblings.filter((key) => classifySiblingKeyword(key) === 'assertion');
    const harmless = siblings.filter((key) => classifySiblingKeyword(key) === 'non-assertion');
    const unclassified = siblings.filter((key) => classifySiblingKeyword(key) === 'unknown');

    if (constraints.length === 0 && unclassified.length === 0 && harmless.length > 0) {
      // `applicability` is informational: it reports a Draft 7 reading, not a
      // defect. It is emitted only for objects whose siblings are *all*
      // non-asserting, so a caller counting these events is counting
      // annotation-only objects and can never mistake a constraint-bearing one
      // for harmless context.
      report(
        'ref-applicability',
        'applicability',
        `${identity}: a \`$ref\` object's sibling keywords do not apply under Draft 7; siblings here are ${harmless.map((key) => `\`${key}\``).join(', ')}`,
        { pointer: identity, reference, siblings: harmless },
      );
    }
    if (constraints.length > 0) {
      report(
        'ref-sibling-conflict',
        'conflict',
        `${identity}: \`$ref\` has assertion-bearing siblings ${constraints.map((key) => `\`${key}\``).join(', ')}; Draft 7 core 8.3 says a \`$ref\` object's other properties are ignored, so a reader that ignores them sees a weaker constraint than this file appears to state`,
        {
          pointer: identity,
          reference,
          siblings: constraints,
          // Kept for callers that want the full sibling set, and so an
          // unclassified sibling sitting beside a known assertion stays visible.
          allSiblings: siblings,
          unclassifiedSiblings: unclassified,
          siblingClasses: Object.fromEntries(siblings.map((key) => [key, classifySiblingKeyword(key)])),
        },
      );
    } else if (unclassified.length > 0) {
      // Reported on its own, and only when no known assertion is present, so the
      // categories partition the objects exactly and an extension keyword can
      // never be counted as a constraint.
      report(
        'ref-sibling-unclassified',
        'unclassified',
        `${identity}: \`$ref\` has sibling keyword(s) ${unclassified.map((key) => `\`${key}\``).join(', ')} that the declared dialect does not define. Their semantics are unclassified: this report does not claim they restrict the instance, and it does not claim any evaluator disagrees about them.`,
        {
          pointer: identity,
          reference,
          siblings: unclassified,
          allSiblings: siblings,
          siblingClasses: Object.fromEntries(siblings.map((key) => [key, classifySiblingKeyword(key)])),
        },
      );
    }
    // Draft 7: `$ref` replaces the object. Siblings are reported above; only the
    // reference target is walked.
    resolve(reference, packagePath, pointer);
    return;
  }

  // A non-fragment `$id` starts a nested schema resource. Its scope was indexed
  // before resolution began, so this walk simply continues into it: the contents
  // are schema positions and the references inside them resolve against the
  // nested base, which `resolve` handles from the reference's own location.

  for (const [childPointer, child] of schemaChildren(node, pointer)) {
    walkLive(child, childPointer, context);
  }
}

/**
 * Synthetic absolute base every document hangs from.
 *
 * The package is a directory tree, so its files have no absolute URIs of their
 * own. Giving them one lets `$id` and relative references resolve with ordinary
 * URI rules instead of a bespoke path algebra, while keeping every result inside
 * a namespace that maps back to a package-relative path.
 */
const PACKAGE_SCHEME = 'tidas-spec:';
const PACKAGE_BASE_URI = `${PACKAGE_SCHEME}///`;

/** Turn a package-relative path into the base URI of its document resource. */
export function baseUriFor(packagePath) {
  return `${PACKAGE_BASE_URI}${packagePath}`;
}

/** Turn a resolved base URI back into a package-relative path, or null. */
function packagePathFromBase(baseUri) {
  if (!baseUri.startsWith(PACKAGE_BASE_URI)) return null;
  return decodeURIComponent(baseUri.slice(PACKAGE_BASE_URI.length));
}

/**
 * Build the resolvable catalog for one package asset root.
 *
 * `documents` maps a package-relative path to its parsed value. The catalog is
 * pure data. Resource and anchor indexes are derived lazily and cached, because
 * most callers only ever ask about a few documents.
 */
export function buildCatalog(documents, { schemaDirectories = SCHEMA_DIRECTORIES } = {}) {
  const byPath = new Map();
  for (const [packagePath, document] of documents) byPath.set(packagePath, { document });
  return {
    byPath,
    schemaDirectories,
    resourceIndex: null,
    prepared: false,
    anchorIndexes: new Map(),
    /** Where each live schema position was reached from, for diagnostics. */
    livePositions: new Map(),
  };
}

/**
 * Index every schema resource in the package.
 *
 * Draft 7 core section 8.2: a subschema carrying a non-fragment `$id` establishes
 * a base URI for itself and its descendants, resolved against the base in effect
 * where it appears. Each document root is a resource as well.
 *
 * The index is built by walking documents structurally. That is discovery, not
 * evaluation: it records where identifiers *are*, so a reference can be resolved
 * against the base in effect at its own location. It follows nothing, so it
 * cannot invent a reference or a constraint.
 *
 * Two conditions are recorded rather than resolved:
 *   * the same base URI declared twice — a reference through it would point at
 *     one of two places without saying so;
 *   * a declared identifier this package cannot serve, which is reported so an
 *     offline reader is told rather than left to guess.
 */
/**
 * Bring the catalog's indexes up to date, including subschemas reachable only
 * through references.
 *
 * Discovery has two halves that depend on each other: resolving a reference needs
 * the resource index, and a document's own resource declarations may live behind
 * a reference. The flag is set *before* the reachability walk, so a re-entrant
 * call from inside that walk sees an index that is already usable and the walk
 * simply extends it.
 */
export function prepareCatalog(catalog) {
  resourceIndexOf(catalog);
  if (catalog.prepared) return catalog;
  catalog.prepared = true;
  indexReachedSubschemas(catalog);
  return catalog;
}

/**
 * Walk every document following live references, indexing the resources and
 * anchors declared inside the subschemas those references reach.
 *
 * This is what makes a `$defs` member that the source's own references point into
 * a real schema position — including for the `$id`s and anchors declared inside
 * it — while an unreferenced member stays data.
 */
function indexReachedSubschemas(catalog) {
  const resolvedCache = new Map();
  const resolveQuietly = (reference, fromPackagePath, fromPointer) => {
    const key = `${fromPackagePath}#${fromPointer} -> ${reference}`;
    if (resolvedCache.has(key)) return resolvedCache.get(key);
    let result = null;
    try {
      result = resolveReference(reference, fromPackagePath, catalog, fromPointer);
    } catch {
      result = null;
    }
    resolvedCache.set(key, result);
    return result;
  };

  const visited = new Set();
  const walk = (node, pointer, packagePath) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${pointer}/${index}`, packagePath));
      return;
    }
    const identity = `${packagePath}#${pointer}`;
    if (visited.has(identity)) return;
    visited.add(identity);

    if (typeof node.$ref === 'string') {
      const resolved = resolveQuietly(node.$ref, packagePath, pointer);
      if (resolved === null) return;
      const target = descend(catalog.byPath.get(resolved.packagePath).document, resolved.pointer);
      if (!isSchemaTarget(target)) return;
      resourceIndexOfReached(catalog, target, resolved.packagePath, resolved.pointer);
      walk(target, resolved.pointer, resolved.packagePath);
      return;
    }
    for (const [childPointer, child] of schemaChildren(node, pointer)) {
      walk(child, childPointer, packagePath);
    }
  };

  for (const [packagePath, entry] of catalog.byPath) {
    if (entry.document !== null && typeof entry.document === 'object') walk(entry.document, '', packagePath);
  }
}

export function resourceIndexOf(catalog) {
  if (catalog.resourceIndex !== null) return catalog.resourceIndex;
  const resources = new Map();
  const conflicts = [];
  const unresolvable = [];

  for (const [packagePath, entry] of catalog.byPath) {
    const retrievalBase = baseUriFor(packagePath);
    // The retrieval URI is registered first and always, so a reference that
    // names this file by path resolves whatever the document's own `$id` says.
    // `$id` establishes an *additional* identity; it does not replace the way
    // the package can address the file.
    registerResource(resources, conflicts, retrievalBase, packagePath, '', 'retrieval');
    if (entry.document === null || typeof entry.document !== 'object') continue;

    // Discovery follows schema positions only. `examples`, `default`, `enum` and
    // `const` carry instance data, and an unknown member is not a subschema on
    // its own authority, so an `$id` inside them is data rather than a resource
    // declaration. See `resourceIndexOfReached` for the dynamic half of the
    // index: subschemas reached through a real reference are indexed even when
    // they are stored under an otherwise unknown keyword.
    const rootId = readIdentifier(entry.document);
    const documentBase = rootId !== null && !rootId.startsWith('#')
      ? resolveBaseUri(rootId, retrievalBase) ?? retrievalBase
      : retrievalBase;
    if (documentBase !== retrievalBase) {
      recordResource(resources, conflicts, unresolvable, documentBase, packagePath, '', catalog.schemaDirectories);
    }
    if (rootId !== null && rootId.startsWith('#')) {
      registerAnchor(catalog, documentBase, rootId, packagePath, '');
    }

    const visit = (node, pointer, currentBase, inSchemaPosition) => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        // An array of schemas is only reachable because its parent keyword said
        // so; a bare array in an unknown member is data.
        if (inSchemaPosition) node.forEach((item, index) => visit(item, `${pointer}/${index}`, currentBase, true));
        return;
      }

      const identifier = readIdentifier(node);
      let nestedBase = currentBase;
      if (identifier !== null && !identifier.startsWith('#')) {
        const resolved = resolveBaseUri(identifier, currentBase);
        if (resolved === null) {
          unresolvable.push({ identifier, pointer: `${packagePath}#${pointer}`, base: currentBase });
        } else {
          nestedBase = resolved;
          recordResource(resources, conflicts, unresolvable, resolved, packagePath, pointer, catalog.schemaDirectories);
        }
      } else if (identifier !== null && inSchemaPosition) {
        registerAnchor(catalog, currentBase, identifier, packagePath, pointer);
      }

      for (const [childPointer, child] of schemaChildren(node, pointer)) {
        visit(child, childPointer, nestedBase, true);
      }
    };
    visit(entry.document, '', documentBase, true);
  }

  const index = { resources, conflicts, unresolvable };
  catalog.resourceIndex = index;
  return index;
}

/**
 * Index the resources and anchors declared inside a subschema reached by a
 * reference.
 *
 * Static discovery covers every subschema reachable by following schema
 * positions from each document root. This covers the rest: a `$defs` member the
 * source's own references point into is a schema position because a reference
 * reached it, so an `$id` declared there is a real resource base — while an
 * unreferenced `$defs` member, or anything inside `examples`, stays data.
 */
function resourceIndexOfReached(catalog, node, packagePath, pointer) {
  const index = resourceIndexOf(catalog);
  if (node === null || typeof node !== 'object') return;
  const base = baseAtPointer(catalog, packagePath, pointer);
  const visit = (current, currentPointer, currentBase) => {
    if (current === null || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      current.forEach((item, index_) => visit(item, `${currentPointer}/${index_}`, currentBase));
      return;
    }
    const identifier = readIdentifier(current);
    let nestedBase = currentBase;
    if (identifier !== null && !identifier.startsWith('#')) {
      const resolved = resolveBaseUri(identifier, currentBase);
      if (resolved !== null) {
        nestedBase = resolved;
        registerResource(index.resources, index.conflicts, resolved, packagePath, currentPointer);
      }
    } else if (identifier !== null) {
      registerAnchor(catalog, currentBase, identifier, packagePath, currentPointer);
    }
    for (const [childPointer, child] of schemaChildren(current, currentPointer)) {
      visit(child, childPointer, nestedBase);
    }
  };
  visit(node, pointer, base);
}

function readIdentifier(node) {
  if (node === null || typeof node !== 'object') return null;
  if (typeof node.$id === 'string') return node.$id;
  if (typeof node.id === 'string') return node.id;
  return null;
}

/**
 * Record one declared resource base.
 *
 * A declared `$id` is locally available by definition: it names a subschema of a
 * file this package ships, so resolving through it never requires a fetch. It may
 * be an absolute URI with any authority — an alias is not a network request. What
 * would require the network is a *reference* to a base no document declares, and
 * that is reported by the resolver, not here.
 */
function recordResource(resources, conflicts, _unresolvable, baseUri, packagePath, pointer) {
  registerResource(resources, conflicts, baseUri, packagePath, pointer);
}

function registerResource(resources, conflicts, baseUri, packagePath, pointer, kind = 'declared') {
  const existing = resources.get(baseUri);
  if (existing === undefined) {
    resources.set(baseUri, { packagePath, pointer, kind });
    return;
  }
  if (existing.packagePath === packagePath && existing.pointer === pointer) return;
  // The retrieval URI and a root `$id` legitimately name the same location; that
  // is an alias, not a conflict. Two *declarations* naming one base is a real
  // conflict, because a reference through it would pick one silently.
  const sameLocation = existing.packagePath === packagePath && existing.pointer === pointer;
  if (sameLocation) return;
  if (kind === 'retrieval' || existing.kind === 'retrieval') return;
  conflicts.push({ baseUri, first: existing, second: { packagePath, pointer } });
}

function registerAnchor(catalog, baseUri, identifier, packagePath, pointer) {
  let index = catalog.anchorIndexes.get(baseUri);
  if (index === undefined) {
    index = { anchors: new Map(), duplicates: new Map() };
    catalog.anchorIndexes.set(baseUri, index);
  }
  const name = decodeFragmentOnce(identifier.slice(1), packagePath, identifier);
  const existing = index.anchors.get(name);
  // The same declaration is reached by more than one discovery pass (static
  // positions and reference reachability both arrive at it). Re-registering the
  // same location is idempotent; only genuinely different locations are a
  // duplicate.
  if (existing !== undefined) {
    if (existing.packagePath === packagePath && existing.pointer === pointer) return;
    if (!index.duplicates.has(name)) index.duplicates.set(name, [existing]);
    if (!index.duplicates.get(name).some((entry) => entry.pointer === pointer)) {
      index.duplicates.get(name).push({ packagePath, pointer });
    }
    return;
  }
  index.anchors.set(name, { packagePath, pointer });
}

/** Resolve one URI against a base, or null when it is not a usable URI. */
function resolveBaseUri(reference, base) {
  try {
    return new URL(reference, base).href;
  } catch {
    return null;
  }
}

/** Whether a package-relative path is somewhere a schema reference may target. */
function isResolvableTarget(packagePath, schemaDirectories) {
  return schemaDirectories.some((directory) => packagePath.startsWith(`${directory}/`));
}

/**
 * Anchors an explicit `#name` reference can target, per resource base.
 *
 * The verifier uses this to report duplicate anchors across a document. Keyed by
 * resource base, because `#name` is scoped to the resource it appears in.
 */
export function anchorsFor(catalog, packagePath) {
  prepareCatalog(catalog);
  const duplicates = new Map();
  const anchors = new Map();
  const rootBase = baseUriFor(packagePath);
  for (const [baseUri, index] of catalog.anchorIndexes) {
    if (baseUri !== rootBase && packagePathFromBase(baseUri) !== packagePath) continue;
    for (const [name, anchor] of index.anchors) {
      if (!anchors.has(name)) anchors.set(name, anchor.pointer);
    }
    for (const [name, entries] of index.duplicates) {
      if (!duplicates.has(name)) duplicates.set(name, []);
      for (const entry of entries) {
        if (!duplicates.get(name).some((existing) => existing.pointer === entry.pointer && existing.packagePath === entry.packagePath)) {
          duplicates.get(name).push(entry);
        }
      }
    }
  }
  return { anchors, duplicates, resources: resourceCountFor(catalog, packagePath) };
}

function resourceCountFor(catalog, packagePath) {
  let count = 0;
  for (const resource of resourceIndexOf(catalog).resources.values()) {
    if (resource.packagePath === packagePath) count += 1;
  }
  return count;
}

/**
 * Decode a URI fragment once, as RFC 3986 defines it.
 *
 * Exactly one decoding layer: the caller receives the decoded fragment and must
 * not decode again, so a document member literally named `%2F` is reachable as
 * `#/%2F` and not reachable as `#/%252F`.
 */
/**
 * Whether a resolved reference target is a schema.
 *
 * Draft 7 permits a schema to be an object or a boolean. A string, number, null,
 * or array is not a schema, so a reference that lands on one has not resolved to
 * anything usable — and treating it as "reached, therefore fine" would accept a
 * document that cannot be evaluated.
 */
export function isSchemaTarget(value) {
  if (typeof value === 'boolean') return true;
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describeTarget(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

export function decodeFragmentOnce(fragment, label, reference) {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fail('REF_FRAGMENT_ENCODING', `${label}: invalid percent-encoding in the fragment of \`${reference}\``);
  }
}

/** The innermost resource base in effect at a pointer within a document. */
function baseAtPointer(catalog, packagePath, pointer) {
  const { resources } = resourceIndexOf(catalog);
  // Start from the retrieval URI: a document with no root `$id` has no other
  // base. A declared base at the same pointer wins, because `$id` is what
  // relative references inside the document resolve against.
  let best = baseUriFor(packagePath);
  let bestLength = -1;
  let bestDeclared = false;
  for (const [baseUri, resource] of resources) {
    if (resource.packagePath !== packagePath) continue;
    const covers = pointer === resource.pointer || pointer.startsWith(`${resource.pointer}/`) || resource.pointer === '';
    if (!covers) continue;
    const declared = resource.kind === 'declared';
    const longer = resource.pointer.length > bestLength;
    // The deepest base wins; at equal depth, a declared base beats the retrieval
    // alias, which is what makes a root `$id` in another directory actually
    // change how relative references resolve.
    if (longer || (resource.pointer.length === bestLength && declared && !bestDeclared)) {
      best = baseUri;
      bestLength = resource.pointer.length;
      bestDeclared = declared;
    }
  }
  return best;
}

/**
 * Resolve the target of a reference, or describe exactly why it cannot be.
 *
 * `fromPointer` locates the reference inside `fromPackagePath`, which is what
 * makes nested resource scope work: the reference resolves against the base in
 * effect where it appears, not against its document root.
 */
export function resolveReference(reference, fromPackagePath, catalog, fromPointer = '') {
  const label = fromPackagePath;
  prepareCatalog(catalog);
  const { resources } = resourceIndexOf(catalog);

  // An absolute identifier is not automatically a network request. If a document
  // in this package declares that resource base, the reference is satisfied
  // locally — an alias is not a fetch. Only an absolute reference whose resource
  // no document declares would need the network, and that is refused below.
  const absolute = splitAbsoluteReference(reference);
  if (absolute !== null) {
    const scheme = absolute.scheme;
    if (scheme !== 'http' && scheme !== 'https') {
      return fail('REF_EXTERNAL_SCHEME', `${label}: reference \`${reference}\` uses the \`${scheme}\` scheme, which cannot resolve inside this package`);
    }
    if (!resources.has(absolute.resourceUri)) {
      return fail('REF_NETWORK', `${label}: reference \`${reference}\` names the resource \`${absolute.resourceUri}\`, which no document in this package declares; resolving it would require the network`);
    }
  } else if (reference.startsWith('//')) {
    return fail('REF_NETWORK', `${label}: protocol-relative reference \`${reference}\` requires network resolution`);
  }

  const base = baseAtPointer(catalog, fromPackagePath, fromPointer);
  const resolved = resolveReferenceUri(reference, base, label);
  if (resolved === null) {
    return fail('REF_SYNTAX', `${label}: reference \`${reference}\` is not a valid URI reference against base \`${base}\``);
  }

  const { resourceUri, rawFragment } = resolved;
  const resource = resources.get(resourceUri);

  if (resource === undefined) {
    const asPath = packagePathFromBase(resourceUri);
    if (asPath === null) {
      return fail(
        'REF_NETWORK',
        `${label}: reference \`${reference}\` resolves to \`${resourceUri}\`, which no document in this package declares; resolving it would require the network`,
      );
    }
    if (catalog.byPath.has(asPath)) {
      return fail(
        'REF_UNRESOLVED_IDENTIFIER',
        `${label}: reference \`${reference}\` resolves to \`${asPath}\`, which the package contains but no \`$id\` declares as a schema resource`,
      );
    }
    if (!isResolvableTarget(asPath, catalog.schemaDirectories)) {
      return fail('REF_OUTSIDE_SCHEMA_SETS', `${label}: reference \`${reference}\` resolves to \`${asPath}\`, which is inside the package but outside the schema sets a schema reference may target`);
    }
    return fail('REF_MISSING_TARGET', `${label}: reference \`${reference}\` resolves to \`${asPath}\`, which is not a shipped specification file`);
  }

  const entry = catalog.byPath.get(resource.packagePath);
  if (rawFragment === '') return { packagePath: resource.packagePath, pointer: resource.pointer };

  const fragment = decodeFragmentOnce(rawFragment, label, reference);
  if (fragment.startsWith('/')) {
    // A pointer fragment is relative to the resource it is written in, not to the
    // document root it happens to live in.
    const document = entry.document;
    const resourceRoot = resource.pointer === '' ? document : descend(document, resource.pointer);
    if (!pointerExists(resourceRoot, fragment, label, reference)) {
      fail('REF_MISSING_FRAGMENT', `${label}: reference \`${reference}\` points at a JSON pointer that does not exist in the resource \`${resourceUri}\``);
    }
    return { packagePath: resource.packagePath, pointer: `${resource.pointer}${fragment}` };
  }

  const anchorIndex = catalog.anchorIndexes.get(resourceUri);
  const anchor = anchorIndex?.anchors.get(fragment);
  if (anchor === undefined) {
    fail('REF_MISSING_FRAGMENT', `${label}: reference \`${reference}\` uses anchor \`#${fragment}\`, which the resource \`${resourceUri}\` does not define`);
  }
  return { packagePath: anchor.packagePath, pointer: anchor.pointer };
}

/**
 * Split an absolute reference into its scheme and resource URI, or null when it
 * is relative.
 *
 * The fragment is dropped: resource identity is what matters for deciding whether
 * the package can serve the reference at all.
 */
function splitAbsoluteReference(reference) {
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference)) return null;
  const scheme = reference.slice(0, reference.indexOf(':')).toLowerCase();
  const hashIndex = reference.indexOf('#');
  const withoutFragment = hashIndex === -1 ? reference : reference.slice(0, hashIndex);
  return { scheme, resourceUri: withoutFragment };
}

/** Split and resolve a reference into (resource URI, raw fragment), or null. */
function resolveReferenceUri(reference, base, label) {
  // An explicit escape past the package root is its own failure: URL
  // normalization would quietly clamp it to the root, which would resolve the
  // reference somewhere the author did not write.
  const hashIndex = reference.indexOf('#');
  const filePart = hashIndex === -1 ? reference : reference.slice(0, hashIndex);
  const rawFragment = hashIndex === -1 ? '' : reference.slice(hashIndex + 1);
  if (filePart !== '') {
    let decoded;
    try {
      decoded = decodeURIComponent(filePart);
    } catch {
      return fail('REF_SYNTAX', `${label}: invalid percent-encoding in reference \`${reference}\``);
    }
    if (decoded.startsWith('/') || /^[a-zA-Z]:/.test(decoded)) {
      return fail('REF_ABSOLUTE', `${label}: absolute reference \`${reference}\` cannot resolve inside the package`);
    }
    if (escapesPackageRoot(base, decoded)) {
      return fail('REF_ESCAPE', `${label}: reference \`${reference}\` escapes the package asset root`);
    }
  }

  let url;
  try {
    url = new URL(reference, base);
  } catch {
    return null;
  }
  if (url.protocol === PACKAGE_SCHEME) {
    return { resourceUri: `${PACKAGE_BASE_URI}${url.pathname.replace(/^\//, '')}`, rawFragment };
  }
  // An absolute reference keeps its own identity. A declared resource may be an
  // alias in any authority, and rewriting it to a package path would lose the
  // identity the index is keyed by. The fragment is taken verbatim either way:
  // `URL` would percent-encode some characters, and decoding twice is exactly
  // what the RFC forbids.
  url.hash = '';
  return { resourceUri: url.href, rawFragment };
}

/** Whether a relative path walks above the package root. */
function escapesPackageRoot(base, relativePath) {
  const basePath = packagePathFromBase(base) ?? '';
  const depth = basePath.split('/').length - 1;
  let remaining = depth;
  for (const segment of relativePath.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      remaining -= 1;
      if (remaining < 0) return true;
      continue;
    }
    remaining += 1;
  }
  return false;
}

/**
 * Full closure check across the catalog.
 *
 * `report` receives one entry per problem: `{ code, message, detail, kind }`,
 * where `kind` is `reference` for an unresolvable reference or `structure` for
 * one of the structural problems above.
 */
export function checkClosure(catalog, report) {
  // Indexes first, including the subschemas only reachable through references, so
  // resolution below sees every resource and anchor the package actually declares.
  prepareCatalog(catalog);
  // Resource-scope problems are reported before traversal: an unresolvable base
  // or a base established twice makes every reference through it suspect, so it
  // should not be buried under the individual references that fail because of it.
  const index = resourceIndexOf(catalog);
  for (const conflict of index.conflicts) {
    report({
      code: 'REF_RESOURCE_CONFLICT',
      category: 'conflict',
      kind: 'structure',
      message: `the schema resource base \`${conflict.baseUri}\` is established more than once (\`${conflict.first.packagePath}#${conflict.first.pointer}\` and \`${conflict.second.packagePath}#${conflict.second.pointer}\`); a reference through it would silently pick one`,
      detail: conflict,
    });
  }
  for (const item of index.unresolvable) {
    report({
      code: 'REF_UNRESOLVED_IDENTIFIER',
      category: 'conflict',
      kind: 'structure',
      message: `${item.pointer}: \`$id\` value ${JSON.stringify(item.identifier)} does not name a schema resource this package contains, so references under it cannot be resolved offline`,
      detail: item,
    });
  }

  const visited = new Set();
  const livePositions = catalog.livePositions;
  const resolve = (reference, fromPackagePath, fromPointer) => {
    try {
      const resolved = resolveReference(reference, fromPackagePath, catalog, fromPointer);
      const identity = `${resolved.packagePath}#${resolved.pointer}`;
      if (!livePositions.has(identity)) livePositions.set(identity, `${fromPackagePath}#${fromPointer}`);
      // A pointer target is a live schema position reached through a real
      // reference, whatever keyword it is stored under.
      const target = descend(catalog.byPath.get(resolved.packagePath).document, resolved.pointer);
      if (!isSchemaTarget(target)) {
        report({
          code: 'REF_NON_SCHEMA_TARGET',
          category: 'reference',
          kind: 'reference',
          message: `${fromPackagePath}#${fromPointer}: reference \`${reference}\` resolves to \`${identity}\`, whose value is ${describeTarget(target)}; a reference must target a schema`,
          detail: { reference, from: `${fromPackagePath}#${fromPointer}`, target: identity, value: describeTarget(target) },
        });
        return;
      }
      livePositions.set(identity, `${fromPackagePath}#${fromPointer}`);
      walkLive(target, resolved.pointer, {
        packagePath: resolved.packagePath,
        catalog,
        report: (code, category, message, detail) => report({ code, category, message, detail, kind: 'structure' }),
        resolve,
        visited,
      });
    } catch (error) {
      if (error !== null && typeof error === 'object' && error.name === 'SpecError') {
        report({ code: error.code, category: 'reference', message: error.message, detail: error.detail, kind: 'reference' });
        return;
      }
      throw error;
    }
  };

  for (const packagePath of catalog.byPath.keys()) {
    const entry = catalog.byPath.get(packagePath);
    walkLive(entry.document, '', {
      packagePath,
      catalog,
      report: (code, category, message, detail) => report({ code, category, message, detail, kind: 'structure' }),
      resolve,
      visited,
    });
  }
  return { visited: visited.size, livePositions: livePositions.size };
}

/** Follow an RFC 6901 pointer from a document root. */
export function descend(document, pointer) {
  if (pointer === '') return document;
  let current = document;
  for (const rawToken of pointer.slice(1).split('/')) {
    const token = decodeJsonPointerToken(rawToken, 'catalog', pointer);
    current = Array.isArray(current) ? current[Number(token)] : current[token];
  }
  return current;
}

/**
 * Every reference in the catalog, with its resolution outcome.
 *
 * Used by the verifier both to report failures and to count what was actually
 * checked, so the totals cannot drift away from the closure result.
 */
export function collectReferences(catalog) {
  prepareCatalog(catalog);
  const found = new Map();
  const visited = new Set();
  const walk = (node, pointer, packagePath) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${pointer}/${index}`, packagePath));
      return;
    }
    const identity = `${packagePath}#${pointer}`;
    if (visited.has(identity)) return;
    visited.add(identity);
    const reference = typeof node.$ref === 'string' ? node.$ref : null;
    if (reference !== null) {
      found.set(identity, { reference, from: packagePath });
      try {
        const resolved = resolveReference(reference, packagePath, catalog, pointer);
        walk(descend(catalog.byPath.get(resolved.packagePath).document, resolved.pointer), resolved.pointer, resolved.packagePath);
      } catch {
        // Unresolvable references are reported by the closure check.
      }
      return;
    }
    for (const [childPointer, child] of schemaChildren(node, pointer)) walk(child, childPointer, packagePath);
  };
  for (const packagePath of catalog.byPath.keys()) walk(catalog.byPath.get(packagePath).document, '', packagePath);
  return found;
}
