#!/usr/bin/env node
/**
 * Writes apps/mobile/.expo-dev.json from the running Metro / Expo dev server.
 * Used by `pnpm dev:tunnel` so the Next.js /expo landing page can read the tunnel URL.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(MOBILE_ROOT, '.expo-dev.json');
const METRO_BASE = (process.env.EXPO_METRO_URL ?? 'http://127.0.0.1:8081').replace(/\/$/, '');

async function fetchJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
  if (!res.ok) return null;
  return res.json();
}

async function resolveUrlFromMetro() {
  const open = await fetchJson(`${METRO_BASE}/_expo/open?platform=ios&runtime=expo`, {
    cache: 'no-store',
  });
  if (open?.url && typeof open.url === 'string') {
    return { url: open.url, source: 'expo-open' };
  }

  const manifest = await fetchJson(`${METRO_BASE}/manifest`, {
    headers: { 'expo-platform': 'ios' },
    cache: 'no-store',
  });
  const debuggerHost =
    manifest?.extra?.expoGo?.debuggerHost ?? manifest?.extra?.expoClient?.debuggerHost;
  if (debuggerHost) {
    return { url: `exp://${debuggerHost}`, source: 'metro-manifest' };
  }

  const hostUri = manifest?.extra?.expoClient?.hostUri;
  if (hostUri) {
    return { url: `exp://${hostUri}`, source: 'metro-manifest' };
  }

  return null;
}

export async function writeExpoDevJson() {
  const resolved = await resolveUrlFromMetro();
  if (!resolved) return false;

  const payload = {
    url: resolved.url,
    source: resolved.source,
    metroUrl: METRO_BASE,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const maxAttempts = Number(process.env.EXPO_DEV_JSON_ATTEMPTS ?? 90);
  const intervalMs = Number(process.env.EXPO_DEV_JSON_INTERVAL_MS ?? 2000);

  (async () => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const payload = await writeExpoDevJson();
      if (payload) {
        console.info(`[expo-dev] Wrote ${OUT_FILE}`);
        console.info(`[expo-dev] ${payload.url} (${payload.source})`);
        process.exit(0);
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    console.error('[expo-dev] Metro did not expose a tunnel URL in time.');
    process.exit(1);
  })();
}
