/**
 * Resolves the Expo Go deep link shown on `/expo`.
 *
 * Priority:
 *   1. EXPO_TUNNEL_URL / NEXT_PUBLIC_EXPO_DEV_URL (manual override)
 *   2. apps/mobile/.expo-dev.json (written by `pnpm dev:tunnel`)
 *   3. GET {EXPO_METRO_URL}/_expo/open (Expo CLI 0.23+; safe over tunnel)
 *   4. GET {EXPO_METRO_URL}/manifest (Expo SDK 52 fallback)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ExpoDeepLink {
  /** Full deep link, e.g. exp://abc.exp.direct:80 */
  deepLink: string;
  /** Host (+ path) after the scheme */
  hostPart: string;
  scheme: 'exp' | 'exps';
  source: 'env' | 'expo-dev-json' | 'expo-open' | 'metro' | 'none';
}

interface ExpoDevJsonFile {
  url?: string;
  tunnelUrl?: string;
  expoGoUrl?: string;
  deepLink?: string;
}

/** Strip scheme; return host part used in exps://HOST templates. */
export function toHostPart(url: string): string {
  return url.replace(/^exp[s]?:\/\//i, '').replace(/\/$/, '');
}

export function parseExpoDevUrl(
  raw: string,
  source: ExpoDeepLink['source'] = 'env',
): ExpoDeepLink | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const schemeMatch = trimmed.match(/^(exp|exps):\/\//i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase() as 'exp' | 'exps';
    const hostPart = toHostPart(trimmed);
    return {
      deepLink: `${scheme}://${hostPart}`,
      hostPart,
      scheme,
      source,
    };
  }

  const hostPart = trimmed.replace(/^\/+/, '');
  const scheme = (process.env.EXPO_DEV_SCHEME?.toLowerCase() === 'exps' ? 'exps' : 'exp') as
    | 'exp'
    | 'exps';
  return {
    deepLink: `${scheme}://${hostPart}`,
    hostPart,
    scheme,
    source,
  };
}

const DEFAULT_METRO_PORTS = ['8081', '8082', '8083', '19000'];

function metroBasesToProbe(): string[] {
  const bases: string[] = [];
  if (process.env.EXPO_METRO_URL) {
    bases.push(process.env.EXPO_METRO_URL.replace(/\/$/, ''));
  }
  const ports = (process.env.EXPO_METRO_PORTS ?? DEFAULT_METRO_PORTS.join(','))
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const port of ports) {
    const base = `http://127.0.0.1:${port}`;
    if (!bases.includes(base)) bases.push(base);
  }
  return bases;
}

async function isMetroRunning(base: string): Promise<boolean> {
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

const EXPO_DEV_JSON_CANDIDATES = [
  path.join(process.cwd(), '../mobile/.expo-dev.json'),
  path.join(process.cwd(), '../mobile/.expo/expo-dev.json'),
  path.join(process.cwd(), '../../apps/mobile/.expo-dev.json'),
];

async function readEnvLink(): Promise<ExpoDeepLink | null> {
  const raw =
    process.env.EXPO_TUNNEL_URL ??
    process.env.NEXT_PUBLIC_EXPO_DEV_URL ??
    process.env.EXPO_PUBLIC_DEV_URL ??
    '';
  return raw ? parseExpoDevUrl(raw, 'env') : null;
}

function pickUrlFromDevJson(data: ExpoDevJsonFile): string | null {
  return data.url ?? data.tunnelUrl ?? data.expoGoUrl ?? data.deepLink ?? null;
}

function isPublicExpoUrl(url: string): boolean {
  const hostPart = url.replace(/^exp[s]?:\/\//i, '').split('/')[0] ?? '';
  if (/^(127\.0\.0\.1|localhost)(:|$)/i.test(hostPart)) return false;
  return /\.exp\.direct/i.test(hostPart) || /\.ngrok/i.test(hostPart);
}

async function readExpoDevJsonFile(): Promise<ExpoDeepLink | null> {
  for (const filePath of EXPO_DEV_JSON_CANDIDATES) {
    try {
      const raw = await readFile(filePath, 'utf8');
      const data = JSON.parse(raw) as ExpoDevJsonFile & { requireTunnel?: boolean };
      const url = pickUrlFromDevJson(data);
      if (!url) continue;
      if (data.requireTunnel && !isPublicExpoUrl(url)) continue;
      const parsed = parseExpoDevUrl(url, 'expo-dev-json');
      if (parsed) return parsed;
    } catch {
      /* try next path */
    }
  }
  return null;
}

async function readExpoOpenFromBase(base: string): Promise<ExpoDeepLink | null> {
  try {
    const res = await fetch(`${base}/_expo/open?platform=ios&runtime=expo`, {
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { url?: string };
    if (!body.url) return null;
    return parseExpoDevUrl(body.url, 'expo-open');
  } catch {
    return null;
  }
}

async function readManifestFromBase(base: string): Promise<ExpoDeepLink | null> {
  try {
    const res = await fetch(`${base}/manifest`, {
      headers: { 'expo-platform': 'ios' },
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const manifest = (await res.json()) as {
      extra?: {
        expoGo?: { debuggerHost?: string };
        expoClient?: { debuggerHost?: string; hostUri?: string };
      };
    };

    const debuggerHost =
      manifest.extra?.expoGo?.debuggerHost ?? manifest.extra?.expoClient?.debuggerHost;
    if (debuggerHost) {
      const parsed = parseExpoDevUrl(`exp://${debuggerHost}`, 'metro');
      if (parsed) return parsed;
    }

    const hostUri = manifest.extra?.expoClient?.hostUri;
    if (hostUri) {
      return parseExpoDevUrl(`exp://${hostUri}`, 'metro');
    }
  } catch {
    /* Metro not running or unreachable */
  }
  return null;
}

async function readBestMetroLink(preferTunnel: boolean): Promise<ExpoDeepLink | null> {
  const candidates: ExpoDeepLink[] = [];

  for (const base of metroBasesToProbe()) {
    if (!(await isMetroRunning(base))) continue;

    const fromOpen = await readExpoOpenFromBase(base);
    if (fromOpen) candidates.push(fromOpen);

    const fromManifest = await readManifestFromBase(base);
    if (fromManifest) candidates.push(fromManifest);
  }

  const tunnel = candidates.find((c) => isPublicExpoUrl(c.deepLink));
  if (preferTunnel) return tunnel ?? null;
  return tunnel ?? candidates[0] ?? null;
}

export async function resolveExpoDeepLink(): Promise<ExpoDeepLink> {
  const fromEnv = await readEnvLink();
  if (fromEnv) return fromEnv;

  const fromDevJson = await readExpoDevJsonFile();
  if (fromDevJson) return fromDevJson;

  const fromMetro = await readBestMetroLink(true);
  if (fromMetro) return fromMetro;

  return {
    deepLink: '',
    hostPart: '',
    scheme: 'exp',
    source: 'none',
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderExpoLandingHtml(template: string, link: ExpoDeepLink): string {
  const appName = process.env.NEXT_PUBLIC_EXPO_APP_NAME ?? 'Jain Pathshala';

  let html = template.replaceAll('APP_NAME_PLACEHOLDER', escapeHtml(appName));

  if (link.source === 'none' || !link.deepLink) {
    const banner = `<div class="setup-banner" role="status">
      <strong>Expo dev server not detected.</strong>
      Run <code>pnpm dev:tunnel</code> on this host — it writes
      <code>apps/mobile/.expo-dev.json</code> automatically once the tunnel is ready.
      Or set <code>EXPO_TUNNEL_URL</code> in <code>apps/web/.env.development</code>.
    </div>`;
    html = html
      .replace('SETUP_BANNER_PLACEHOLDER', banner)
      .replace('__EXPO_DEEP_LINK_HREF__', '#')
      .replace('__EXPO_DEEP_LINK_JS__', 'null');
    return html;
  }

  const deepLinkJson = JSON.stringify(link.deepLink);
  html = html
    .replace('SETUP_BANNER_PLACEHOLDER', '')
    .replace('__EXPO_DEEP_LINK_HREF__', escapeHtml(link.deepLink))
    .replace('__EXPO_DEEP_LINK_JS__', deepLinkJson);

  return html;
}
