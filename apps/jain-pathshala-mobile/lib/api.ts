/**
 * Mobile data layer — mirrors the web artifact's hand-written fetch helper.
 * Auth uses Bearer tokens (no cookies on native).
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

const API_PORT = process.env.EXPO_PUBLIC_API_PORT ?? "8080";
const REQUEST_TIMEOUT_MS = 30_000;

/** RN's AbortSignal polyfill does not implement AbortSignal.timeout (crashes or breaks fetch). */
function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const { signal: _ignored, ...rest } = init;
  return fetch(url, { ...rest, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

function hostFromExpoManifest(): string | null {
  const raw =
    Constants.expoGoConfig?.debuggerHost ??
    Constants.expoConfig?.hostUri ??
    (Constants.manifest2?.extra?.expoClient?.hostUri as string | undefined);

  if (!raw) return null;
  const host = String(raw).split(":")[0];
  if (!host || host === "localhost" || host === "127.0.0.1") return null;
  return host;
}

function resolveApiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
  if (explicit) return rewriteLocalhostForDevice(explicit);

  const fromExtra = (
    Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined
  )?.apiBaseUrl?.replace(/\/$/, "");
  if (fromExtra) return rewriteLocalhostForDevice(fromExtra);

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) {
    if (/^https?:\/\//i.test(domain)) return domain.replace(/\/$/, "");
    return `https://${domain}`;
  }

  if (__DEV__) {
    const metroPort = process.env.EXPO_PUBLIC_METRO_PORT ?? "8081";
    const host = hostFromExpoManifest();
    if (host) return `http://${host}:${metroPort}`;
  }

  const host = hostFromExpoManifest();
  if (host) return `http://${host}:${API_PORT}`;

  return "";
}

/** In dev on a physical device, localhost in env must become the Metro host IP. */
function rewriteLocalhostForDevice(base: string): string {
  if (!__DEV__) return base;
  if (!/localhost|127\.0\.0\.1/i.test(base)) return base;

  const host = hostFromExpoManifest();
  if (host) {
    return base.replace(/localhost|127\.0\.0\.1/gi, host);
  }

  if (Platform.OS === "android") {
    return `http://10.0.2.2:${API_PORT}`;
  }

  return base;
}

export const API_BASE = resolveApiBase();

let authToken: string | null = null;
let refreshToken: string | null = null;
let persistTokens: ((access: string, refresh: string) => void) | null = null;

/** Called by AuthContext whenever the session token changes. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Called by AuthContext with the persisted refresh token (for silent refresh). */
export function setRefreshToken(token: string | null): void {
  refreshToken = token;
}

/** AuthContext registers this so a silent refresh can persist the rotated pair. */
export function setTokenPersistor(fn: ((access: string, refresh: string) => void) | null): void {
  persistTokens = fn;
}

// Single-flight refresh: with short-lived access tokens, a 401 triggers one
// refresh (shared across concurrent requests), then the original call retries.
let refreshInFlight: Promise<boolean> | null = null;
function runRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      if (!refreshToken) return false;
      try {
        const r = await fetchWithTimeout(
          `${API_BASE}/api/auth/refresh`,
          {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken }),
          },
          REQUEST_TIMEOUT_MS,
        );
        if (!r.ok) return false;
        const json = (await r.json()) as {
          data?: { tokens?: { access_token: string; refresh_token: string } };
        };
        const t = json.data?.tokens;
        if (!t) return false;
        authToken = t.access_token;
        refreshToken = t.refresh_token;
        persistTokens?.(t.access_token, t.refresh_token);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!API_BASE) {
    throw new ApiError(
      "ERR_CONFIG",
      "API URL is not configured. Run `pnpm run dev` in jain-pathshala-mobile (API is proxied via Metro on port 8081).",
      0,
    );
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(init.headers ?? {}),
      },
    }, REQUEST_TIMEOUT_MS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      /network request failed|failed to fetch|network error|timed out|timeout|aborted/i.test(
        msg,
      )
    ) {
      throw new ApiError(
        "ERR_NETWORK",
        `Cannot reach the API at ${API_BASE}. Same Wi‑Fi as PC, enable Local Network for Expo Go (iOS Settings), restart \`pnpm run dev\`, reload Expo Go. Test in phone Safari: ${API_BASE}/api/healthz`,
        0,
      );
    }
    throw err;
  }
  // Expired access token → refresh once and retry (skip the auth endpoints).
  if (res.status === 401 && retry && !path.startsWith("/api/auth/")) {
    if (await runRefresh()) return request<T>(path, init, false);
  }
  if (!res.ok) {
    let data: Partial<ApiErrorEnvelope> = {};
    try {
      data = (await res.json()) as Partial<ApiErrorEnvelope>;
    } catch {}
    const env = data?.error;
    const fallback =
      res.status >= 500
        ? `Server error (${res.status}). Start Docker Desktop, run docker start jp-postgres, then retry.`
        : `Request failed (${res.status})`;
    throw new ApiError(
      env?.code ?? "ERR_HTTP",
      env?.message ?? fallback,
      res.status,
      env?.details,
    );
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function del<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "DELETE",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function unwrap<T>(data: unknown): T {
  if (data && typeof data === "object" && "data" in (data as object)) {
    return (data as { data: T }).data;
  }
  return data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await get<{ data: T } | T>(path);
  return unwrap<T>(res);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await post<{ data: T } | T>(path, body);
  return unwrap<T>(res);
}
