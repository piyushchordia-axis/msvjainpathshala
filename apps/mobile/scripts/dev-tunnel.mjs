#!/usr/bin/env node
/**
 * Starts `expo start --tunnel` and keeps `.expo-dev.json` in sync for the web /expo page.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeExpoDevJson } from './write-expo-dev-json.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..');

const expo = spawn('pnpm', ['exec', 'expo', 'start', '--tunnel'], {
  cwd: MOBILE_ROOT,
  stdio: 'inherit',
  env: process.env,
});

let syncing = false;

async function syncOnce() {
  if (syncing) return;
  syncing = true;
  try {
    const payload = await writeExpoDevJson();
    if (payload) {
      console.info(`[expo-dev] ${payload.url}`);
    }
  } catch {
    /* Metro not ready yet */
  } finally {
    syncing = false;
  }
}

const syncTimer = setInterval(
  () => {
    void syncOnce();
  },
  Number(process.env.EXPO_DEV_JSON_INTERVAL_MS ?? 3000),
);

void syncOnce();

function shutdown(code) {
  clearInterval(syncTimer);
  if (!expo.killed) expo.kill('SIGTERM');
  process.exit(code ?? 0);
}

expo.on('exit', (code) => shutdown(code ?? 0));
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
