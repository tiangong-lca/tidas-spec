// Shared primitives for the TIDAS specification build and verifier.
//
// Everything here is Node-standard-library only. The specification package has
// no runtime dependency; this library runs at development, CI, and review time.

import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_NAME = '@tiangong-lca/tidas-spec';
export const SPEC_VERSION = '0.2.0';
export const MANIFEST_VERSION = 1;
// Points at the license files rather than naming a single SPDX identifier: the
// tools notice is verified, but per-artifact licensing of the embedded
// classifications is not resolved. See docs/provenance.md.
export const LICENSE_DECLARATION = 'SEE LICENSE IN LICENSE';
export const ASSET_ROOT = 'assets/tidas';
/** The publication metadata file, whose serialization is canonical. */
export const PACKAGE_JSON_PATH = 'package.json';
export const MANIFEST_PATH = 'spec-manifest.json';
export const IMPORT_MANIFEST_PATH = 'source-import.yaml';
export const REVIEWED_BASELINE_PATH = 'reviewed-baseline.json';
// The canonical candidate archive is a reviewed release artifact and is
// committed, so the exact bytes a downstream step consumes are reviewable in
// the repository rather than produced on the spot.
export const RELEASE_ROOT = 'release';
// Everything under `build/` is disposable output, never required for checking.
// The candidate *receipt* carries the facts that are not derivable from content:
// which revision was reviewed, and which artifact bytes were produced.
export const BUILD_ROOT = 'build';
export const ARCHIVE_BINDING_PATH = `${BUILD_ROOT}/candidate-archive-binding.json`;
// The reviewed baselines this candidate ships. Counts are asserted, not inferred,
// so an accidental extra or missing imported file is a hard failure.
export const EXPECTED_SCHEMA_COUNT_PER_LANGUAGE = 18;
export const EXPECTED_METHODOLOGY_COUNT = 2;
export const LANGUAGE_SCHEMA_DIRS = Object.freeze({ en: 'schemas', zh: 'schemas_zh' });
export const METHODOLOGY_DIR = 'methodologies';

// Package metadata that ships alongside the imported specification assets. These
// files are owned by this repository, not imported from the tools source, and the
// manifest says so per file rather than attributing them to the source commit.
export const PACKAGE_METADATA_ORIGIN = 'tidas-spec';
/** Canonical archive filename for a version. */
export function archiveFileName(version = SPEC_VERSION) {
  return `${PACKAGE_NAME.replace('@', '').replace('/', '-')}-${version}.tgz`;
}

export class SpecError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'SpecError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export function fail(code, message, detail) {
  throw new SpecError(code, message, detail);
}

/** Ordered collector for verification findings. */
export class Diagnostics {
  #items = [];

  error(code, message, detail) {
    this.#items.push({ severity: 'error', code, message, ...(detail === undefined ? {} : { detail }) });
    return this;
  }

  warn(code, message, detail) {
    this.#items.push({ severity: 'warning', code, message, ...(detail === undefined ? {} : { detail }) });
    return this;
  }

  get items() {
    return [...this.#items];
  }

  get errors() {
    return this.#items.filter((item) => item.severity === 'error');
  }

  get warnings() {
    return this.#items.filter((item) => item.severity === 'warning');
  }

  get ok() {
    return this.errors.length === 0;
  }

  codes() {
    return this.errors.map((item) => item.code);
  }

  /**
   * Run one check. A `SpecError` becomes a structured finding named
   * `<id>/<ERROR_CODE>`; anything else is a programming defect and propagates
   * rather than being reported as a specification failure.
   */
  check(id, fn) {
    try {
      const result = fn();
      this.#items.push({ severity: 'info', code: `${id}:passed`, message: `${id} passed`, ...(result === undefined ? {} : { detail: result }) });
      return { ok: true, result };
    } catch (error) {
      if (error instanceof SpecError) {
        this.error(`${id}/${error.code}`, error.message, error.detail);
        return { ok: false, error };
      }
      throw error;
    }
  }
}

export function sha256Hex(input) {
  const hash = createHash('sha256');
  hash.update(typeof input === 'string' ? Buffer.from(input, 'utf8') : input);
  return hash.digest('hex');
}

/** CRLF -> LF, matching the pinned source lock's content-hash normalization. */
export function normalizeLineEndings(buffer) {
  return Buffer.from(buffer.toString('binary').replace(/\r\n/g, '\n'), 'binary');
}

export function canonicalJson(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) fail('CANONICAL_NUMBER', `cannot canonicalize non-finite number ${value}`);
      if (Object.is(value, -0)) fail('CANONICAL_NUMBER', 'cannot canonicalize negative zero');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const keys = Object.keys(value).sort();
      for (const key of keys) {
        if (value[key] === undefined) fail('CANONICAL_UNDEFINED', `undefined value at key ${JSON.stringify(key)}`);
      }
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    default:
      return fail('CANONICAL_TYPE', `cannot canonicalize value of type ${typeof value}`);
  }
}

export function hashCanonicalJson(value) {
  return sha256Hex(canonicalJson(value));
}

/** Stable pretty JSON: two-space indent, LF, single trailing newline. */
export function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function readJsonStrict(buffer, label) {
  const text = decodeUtf8(buffer, label);
  assertNoDuplicateJsonKeys(text, label);
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return fail('JSON_PARSE', `${label}: malformed JSON: ${error.message}`);
  }
  return value;
}

export function decodeUtf8(buffer, label) {
  const text = buffer.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(buffer) !== 0) {
    fail('UTF8_ENCODING', `${label}: content is not valid UTF-8`);
  }
  if (text.charCodeAt(0) === 0xfeff) {
    fail('UTF8_BOM', `${label}: leading UTF-8 BOM is not part of the reviewed source bytes`);
  }
  return text;
}

// A duplicate object key is silent data loss: JSON.parse keeps the last value
// and the earlier value disappears without any error. Detecting it needs a
// token scan, because the parser has already collapsed the duplicate away.
export function assertNoDuplicateJsonKeys(text, label) {
  let index = 0;
  const length = text.length;
  /** Stack of open containers; objects additionally track the keys already seen. */
  const stack = [];

  const skipWhitespace = () => {
    while (index < length) {
      const code = text.charCodeAt(index);
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) index += 1;
      else break;
    }
  };

  const readString = () => {
    // Caller guarantees text[index] === '"'.
    index += 1;
    let out = '';
    while (index < length) {
      const char = text[index];
      if (char === '\\') {
        const escape = text[index + 1];
        if (escape === 'u') {
          out += String.fromCharCode(Number.parseInt(text.slice(index + 2, index + 6), 16));
          index += 6;
        } else {
          out += escape;
          index += 2;
        }
      } else if (char === '"') {
        index += 1;
        return out;
      } else {
        out += char;
        index += 1;
      }
    }
    return fail('JSON_PARSE', `${label}: unterminated string at offset ${index}`);
  };

  const top = () => stack[stack.length - 1];

  skipWhitespace();
  while (index < length) {
    const char = text[index];
    const frame = top();
    if (char === '"') {
      const value = readString();
      skipWhitespace();
      if (frame !== undefined && frame.kind === 'object' && frame.expectKey) {
        if (frame.seen.has(value)) fail('JSON_DUPLICATE_KEY', `${label}: duplicate object key ${JSON.stringify(value)}`);
        frame.seen.add(value);
        frame.expectKey = false;
      }
      continue;
    }
    if (char === '{') {
      stack.push({ kind: 'object', seen: new Set(), expectKey: true });
      index += 1;
    } else if (char === '[') {
      stack.push({ kind: 'array' });
      index += 1;
    } else if (char === '}' || char === ']') {
      if (stack.length === 0) fail('JSON_PARSE', `${label}: unbalanced ${char} at offset ${index}`);
      stack.pop();
      index += 1;
    } else if (char === ',') {
      if (frame !== undefined && frame.kind === 'object') frame.expectKey = true;
      index += 1;
    } else if (char === ':') {
      index += 1;
    } else if (char === '-' || char === '+' || (char >= '0' && char <= '9') || (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '.') {
      while (index < length && /[^\s,[\]{}:]/.test(text[index])) index += 1;
    } else {
      return fail('JSON_PARSE', `${label}: unexpected character ${JSON.stringify(char)} at offset ${index}`);
    }
    skipWhitespace();
  }
}

export function readBytes(filePath, label = filePath) {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch (error) {
    return fail('FILE_MISSING', `${label}: cannot read file: ${error.message}`);
  }
  if (stats.isSymbolicLink()) fail('FILE_SYMLINK', `${label}: symbolic links are not part of a shipped asset set`);
  if (!stats.isFile()) fail('FILE_NOT_REGULAR', `${label}: not a regular file`);
  return readFileSync(filePath);
}

/**
 * Sorted list of relative file paths under a directory.
 *
 * `rejectSymlinks` is for shipped asset trees, where a link would make the
 * published bytes depend on a file outside the package. Package assembly walks
 * the whole repository instead, where `node_modules` legitimately contains
 * links, so it excludes those directories up front and does not reject links it
 * never packs.
 */
export function listFilesRecursive(rootDir, { rejectSymlinks = true, skipDirectories = [] } = {}) {
  const skip = new Set(skipDirectories);
  const out = [];
  const walk = (absolute, relative) => {
    const entries = readdirSync(absolute, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const entryAbsolute = path.join(absolute, entry.name);
      const entryRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (skip.has(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        if (rejectSymlinks) fail('FILE_SYMLINK', `${entryRelative}: symbolic links are not allowed in the specification asset tree`);
        continue;
      }
      if (entry.isDirectory()) walk(entryAbsolute, entryRelative);
      else if (entry.isFile()) out.push(entryRelative);
      else if (rejectSymlinks) fail('FILE_TYPE', `${entryRelative}: unsupported filesystem entry`);
    }
  };
  walk(rootDir, '');
  return out;
}

export function repoRootFromUrl(importMetaUrl) {
  let current = path.dirname(fileURLToPath(importMetaUrl));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(current, 'package.json'), 'utf8'));
      if (pkg.name === PACKAGE_NAME) return current;
    } catch {
      // keep walking
    }
    const parent = path.dirname(current);
    if (parent === current) fail('REPO_ROOT', `cannot locate the ${PACKAGE_NAME} repository root above ${fileURLToPath(importMetaUrl)}`);
    current = parent;
  }
}
