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

const DEFAULT_PORTS = ['8081', '8082', '8083', '19000', '19001'];

export function requiresTunnelUrl() {
  return process.env.EXPO_REQUIRE_TUNNEL === '1';
}

/** True when the URL is reachable from a physical device (ngrok / exp.direct). */
export function isPublicExpoUrl(url) {
  const hostPart = url.replace(/^exp[s]?:\/\//i, '').split('/')[0] ?? '';
  if (/^(127\.0\.0\.1|localhost)(:|$)/i.test(hostPart)) return false;
  return /\.exp\.direct/i.test(hostPart) || /\.ngrok/i.test(hostPart);
}

function metroBasesToProbe() {
  const bases = [];
  if (process.env.EXPO_METRO_URL) {
    bases.push(process.env.EXPO_METRO_URL.replace(/\/$/, ''));
  }
  const ports = (process.env.EXPO_METRO_PORTS ?? DEFAULT_PORTS.join(','))
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const port of ports) {
    const base = `http://127.0.0.1:${port}`;
    if (!bases.includes(base)) bases.push(base);
  }
  return bases;
}

async function fetchJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
  if (!res.ok) return null;
  return res.json();
}

async function isMetroRunning(base) {
  try {
    const res = await fetch(`${base}/status`, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    });
    const text = await res.text();
    return res.ok && text.includes('packager-status:running');
  } catch {
    return false;
  }
}

async function resolveUrlFromMetroBase(metroBase) {
  const open = await fetchJson(`${metroBase}/_expo/open?platform=ios&runtime=expo`, {
    cache: 'no-store',
  });
  if (open?.url && typeof open.url === 'string') {
    return { url: open.url, source: 'expo-open', metroBase };
  }

  const manifest = await fetchJson(`${metroBase}/manifest`, {
    headers: { 'expo-platform': 'ios' },
    cache: 'no-store',
  });
  const debuggerHost =
    manifest?.extra?.expoGo?.debuggerHost ?? manifest?.extra?.expoClient?.debuggerHost;
  if (debuggerHost) {
    return { url: `exp://${debuggerHost}`, source: 'metro-manifest', metroBase };
  }

  const hostUri = manifest?.extra?.expoClient?.hostUri;
  if (hostUri) {
    return { url: `exp://${hostUri}`, source: 'metro-manifest', metroBase };
  }

  return null;
}

export async function resolveUrlFromMetro() {
  const requireTunnel = requiresTunnelUrl();
  const candidates = [];

  for (const base of metroBasesToProbe()) {
    if (!(await isMetroRunning(base))) continue;
    const resolved = await resolveUrlFromMetroBase(base);
    if (!resolved) continue;
    if (requireTunnel && !isPublicExpoUrl(resolved.url)) continue;
    candidates.push(resolved);
  }

  if (candidates.length === 0) return null;

  const tunnelCandidate = candidates.find((c) => isPublicExpoUrl(c.url));
  if (requireTunnel) return tunnelCandidate ?? null;
  return tunnelCandidate ?? candidates[0];
}

export async function writeExpoDevJson() {
  const resolved = await resolveUrlFromMetro();
  if (!resolved) return false;

  const payload = {
    url: resolved.url,
    source: resolved.source,
    metroUrl: resolved.metroBase,
    requireTunnel: requiresTunnelUrl(),
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
        console.info(`[expo-dev] ${payload.url} (${payload.source} via ${payload.metroUrl})`);
        process.exit(0);
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    console.error(
      requiresTunnelUrl()
        ? '[expo-dev] Metro did not expose a tunnel URL (exp.direct). Is `expo start --tunnel` running?'
        : '[expo-dev] Metro did not expose a dev URL in time.',
    );
    process.exit(1);
  })();
}
