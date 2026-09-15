// What the package actually ships.
//
// Two sets must agree, and neither is derived from the other:
//   * `assets/**` — what is physically present in the installed package
//     directory, read from the filesystem.
//   * the `files` whitelist in package.json — what npm will include.
// A file present but not whitelisted silently disappears at publish time; a
// whitelisted pattern that matches nothing produces an empty promise. Both are
// failures here rather than surprises after `npm pack`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fail, listFilesRecursive } from './core.mjs';
import { parseYamlDocument } from './yaml.mjs';

/**
 * Minimal glob support for the package.json `files` whitelist: `*`, `**`, and
 * `?`, matched against POSIX-style repository-relative paths. This is not a
 * general glob engine; it covers the patterns npm's whitelist actually uses.
 *
 * A pattern ending in `/` names a directory and includes everything under it,
 * which is npm's own reading of a `files` entry.
 */
export function globToRegExp(pattern) {
  const normalized = pattern.endsWith('/') ? `${pattern}**` : pattern;
  let out = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        // `**/` matches zero or more path segments; a trailing `**` matches the rest.
        if (normalized[index + 2] === '/') {
          out += '(?:[^/]+/)*';
          index += 2;
        } else {
          out += '.*';
          index += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return new RegExp(`${out}$`);
}

function matchesAny(relativePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(relativePath));
}

/**
 * Resolve the package's declared asset set for a repository (or unpacked
 * package) root.
 */
export function resolvePackageContent(repoRoot) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    return fail('PACKAGE_JSON', `package.json: cannot read: ${error.message}`);
  }
  if (packageJson.name !== undefined && typeof packageJson.name !== 'string') {
    fail('PACKAGE_JSON', 'package.json: `name` must be a string when present');
  }

  const hasFilesWhitelist = Array.isArray(packageJson.files);
  const patterns = hasFilesWhitelist ? packageJson.files.map((entry) => String(entry)) : null;

  const presentAssets = listFilesRecursive(path.join(repoRoot, 'assets')).map((relative) => `assets/${relative}`).sort();
  const shippedAssets = patterns === null ? presentAssets : presentAssets.filter((relative) => matchesAny(relative, patterns)).sort();

  // Every whitelist entry must actually resolve. A static path must exist; a
  // wildcard must match at least one file; a directory entry (`assets/`) must
  // contain at least one file. A stale entry silently publishes nothing.
  const unresolvedPatterns = [];
  if (patterns !== null) {
    for (const pattern of patterns) {
      if (pattern.endsWith('/')) {
        const prefix = pattern;
        if (!presentAssets.some((relative) => relative.startsWith(prefix))) unresolvedPatterns.push(pattern);
        continue;
      }
      if (pattern.includes('*') || pattern.includes('?')) {
        if (!presentAssets.some((relative) => globToRegExp(pattern).test(relative))) unresolvedPatterns.push(pattern);
        continue;
      }
      try {
        readFileSync(path.join(repoRoot, pattern));
      } catch {
        unresolvedPatterns.push(pattern);
      }
    }
  }

  const hiddenByWhitelist = patterns === null ? [] : presentAssets.filter((relative) => !matchesAny(relative, patterns));

  return {
    packageJson,
    hasFilesWhitelist,
    patterns,
    presentAssets,
    shippedAssets,
    hiddenByWhitelist,
    unresolvedPatterns,
  };
}

/**
 * Directories npm itself never packs, regardless of the `files` whitelist.
 *
 * Nothing else is excluded here. If a directory is not in this list, whether it
 * is packed is decided by the whitelist alone — the same decision npm makes — so
 * this module cannot disagree with the real package contents by carrying its own
 * opinion about what "should" ship.
 */
const NEVER_PACKED_DIRECTORIES = ['.git', 'node_modules'];

/** Files npm includes regardless of the `files` whitelist. */
const ALWAYS_PACKED = new Set(['package.json', 'README.md', 'LICENSE', 'LICENCE', 'CHANGELOG.md']);

/**
 * Resolve the exact file list a package would publish.
 *
 * The archive is built from this list, so "the npm package and the release
 * archive carry the same reviewed files" holds by construction rather than by
 * two independent lists that drift apart.
 */
export function resolvePackagedFiles(repoRoot) {
  const content = resolvePackageContent(repoRoot);
  const all = listFilesRecursive(repoRoot, { rejectSymlinks: false, skipDirectories: NEVER_PACKED_DIRECTORIES }).filter(
    (relative) => !relative.split('/').some((segment) => NEVER_PACKED_DIRECTORIES.includes(segment)),
  );
  const selected = all
    .filter((relative) => ALWAYS_PACKED.has(relative) || (content.patterns !== null && matchesAny(relative, content.patterns)))
    .sort();
  return { files: selected, content };
}

// The import manifest carries human rationale in comments, so it is YAML and is
// read with the same strict loader the methodology assets use. Its structure is
// still enforced field by field below.
export function readImportManifest(repoRoot, relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  let buffer;
  try {
    buffer = readFileSync(absolute);
  } catch (error) {
    return fail('IMPORT_MANIFEST_MISSING', `${relativePath}: cannot read: ${error.message}`);
  }
  const value = parseYamlDocument(buffer, relativePath);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('IMPORT_MANIFEST_SHAPE', `${relativePath}: import manifest must be a mapping`);
  }
  for (const field of [
    'version',
    'sourceRepoId',
    'sourceRepoCanonicalUrl',
    'sourceCommit',
    'sourceCommitRef',
    'sourceLicensePath',
    'sourceLicenseSha256',
    'sourceLicenseNotice',
    'excludedSourcePaths',
    'files',
  ]) {
    if (!(field in value)) fail('IMPORT_MANIFEST_SHAPE', `${relativePath}: missing required field \`${field}\``);
  }
  if (!Array.isArray(value.files) || value.files.length === 0) fail('IMPORT_MANIFEST_SHAPE', `${relativePath}: \`files\` must be a non-empty array`);
  const seen = new Set();
  for (const entry of value.files) {
    if (entry === null || typeof entry !== 'object') fail('IMPORT_MANIFEST_SHAPE', `${relativePath}: every \`files\` entry must be a mapping`);
    for (const field of ['sourcePath', 'packagePath', 'sha256']) {
      if (typeof entry[field] !== 'string' || entry[field] === '') fail('IMPORT_MANIFEST_SHAPE', `${relativePath}: every \`files\` entry needs a non-empty \`${field}\``);
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sha256)) fail('IMPORT_MANIFEST_SHAPE', `${relativePath}: \`sha256\` for ${entry.packagePath} is not a lowercase SHA256 hex digest`);
    if (seen.has(entry.packagePath)) fail('IMPORT_MANIFEST_SHAPE', `${relativePath}: duplicate \`packagePath\` ${entry.packagePath}`);
    seen.add(entry.packagePath);
  }
  if (value.version !== 1) fail('IMPORT_MANIFEST_SHAPE', `${relativePath}: unsupported import manifest version ${JSON.stringify(value.version)}`);
  return value;
}
