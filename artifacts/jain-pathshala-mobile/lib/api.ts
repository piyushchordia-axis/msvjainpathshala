/**
 * Mobile data layer — mirrors the web artifact's hand-written fetch helper
 * (src/lib/api-client.ts). Same endpoints, same { data } unwrapping, same
 * ApiError envelope. Differences from web:
 *   - Base URL is the deployed domain (EXPO_PUBLIC_DOMAIN) since Expo runs
 *     outside the web proxy and needs absolute URLs.
 *   - Auth uses a Bearer token (no cookies on native) supplied via
 *     setAuthToken() from the AuthContext.
 */

function resolveApiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return "";
  if (/^https?:\/\//i.test(domain)) return domain.replace(/\/$/, "");
  return `https://${domain}`;
}

export const API_BASE = resolveApiBase();

let authToken: string | null = null;

/** Called by AuthContext whenever the session token changes. */
export function setAuthToken(token: string | null): void {
  authToken = token;
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let data: Partial<ApiErrorEnvelope> = {};
    try {
      data = (await res.json()) as Partial<ApiErrorEnvelope>;
    } catch {}
    const env = data?.error;
    throw new ApiError(
      env?.code ?? "ERR_HTTP",
      env?.message ?? `Request failed (${res.status})`,
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
