#!/usr/bin/env node
/**
 * Removes Metro / Expo file-map caches. Use after Node upgrades or when you see:
 *   "Unable to deserialize cloned data"
 */

import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(MOBILE_ROOT, '../..');

const CACHE_DIRS = [
  path.join(MOBILE_ROOT, '.metro-cache'),
  path.join(MOBILE_ROOT, 'node_modules', '.cache'),
  path.join(WORKSPACE_ROOT, 'node_modules', '.cache', 'metro'),
  path.join(WORKSPACE_ROOT, 'node_modules', '.cache'),
];

async function clearDir(target) {
  try {
    await rm(target, { recursive: true, force: true });
    console.info(`[metro] cleared ${target}`);
  } catch (err) {
    console.warn(`[metro] skip ${target}: ${err.message}`);
  }
}

for (const dir of CACHE_DIRS) {
  await clearDir(dir);
}

console.info('[metro] cache clear done — next start may take longer while Metro re-indexes.');
