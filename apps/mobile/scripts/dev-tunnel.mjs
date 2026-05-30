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

const expoArgs = ['exec', 'expo', 'start', '--tunnel'];
if (process.env.EXPO_METRO_CLEAR === '1') {
  expoArgs.push('--clear');
}

const expo = spawn('pnpm', expoArgs, {
  cwd: MOBILE_ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    EXPO_REQUIRE_TUNNEL: '1',
    // Avoid interactive "use port 8082?" when 8081 is taken (common on dev machines).
    CI: process.env.CI ?? '1',
  },
});

let syncing = false;
let lastLoggedUrl = '';

async function syncOnce() {
  if (syncing) return;
  syncing = true;
  try {
    const payload = await writeExpoDevJson();
    if (payload && payload.url !== lastLoggedUrl) {
      lastLoggedUrl = payload.url;
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
  Number(process.env.EXPO_DEV_JSON_INTERVAL_MS ?? 5000),
);

// Wait for ngrok + Metro before polling (avoids caching 127.0.0.1 from a stale port).
setTimeout(
  () => {
    void syncOnce();
  },
  Number(process.env.EXPO_DEV_JSON_START_DELAY_MS ?? 12000),
);

function shutdown(code) {
  clearInterval(syncTimer);
  if (!expo.killed) expo.kill('SIGTERM');
  process.exit(code ?? 0);
}

expo.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error('[expo-dev] Tunnel failed. Try:');
    console.error('  1. pnpm metro:clear-cache && pnpm dev:tunnel:clean');
    console.error('  2. Kill stale Metro: lsof -ti :8081 | xargs kill -9');
    console.error('  3. npx expo login  (tunnel needs an Expo account)');
    console.error('  4. Fallback: pnpm dev:lan + EXPO_TUNNEL_URL in apps/web/.env.development');
  }
  shutdown(code ?? 0);
});
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
