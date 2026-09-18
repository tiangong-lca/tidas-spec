#!/usr/bin/env node
// Regenerate the derived schema lock from the reviewed English and Chinese
// schema bytes. This command changes only the lock; build/check remain strict
// consumers so stale derived identity cannot be hidden by validation.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ASSET_ROOT, formatJson, repoRootFromUrl } from './lib/core.mjs';
import { loadAssetSet } from './lib/inventory.mjs';
import { computeSchemaLock } from './lib/lock.mjs';

const repoRoot = repoRootFromUrl(import.meta.url);
const assetSet = loadAssetSet(repoRoot);
const lock = computeSchemaLock({
  schemaRoot: ASSET_ROOT,
  schemaSets: assetSet.schemaSets,
  localizedKeys: assetSet.localizedKeys,
});
const target = path.join(repoRoot, ASSET_ROOT, 'schema.lock.json');
writeFileSync(target, formatJson(lock));
process.stdout.write(`${path.relative(repoRoot, target)} updated\n`);
