/**
 * ky-based API client.
 *
 *   - Base URL from `EXPO_PUBLIC_API_BASE_URL` (Constants.expoConfig.extra
 *     fallback). Android emulator users must set http://10.0.2.2:3000.
 *   - Bearer token from `authStore.getAccessToken()` (memory). When that
 *     returns null we attach no Authorization header — callers handle 401.
 *   - `Idempotency-Key: <ULID>` injected for any non-GET request.
 *   - 30s timeout, 2 network retries with 1s/3s backoff.
 *   - Single-flight refresh on `ERR_AUTH_TOKEN_EXPIRED`: a shared
 *     `Promise<string>` cached at module scope so 50 concurrent stale
 *     requests result in one /v1/auth/refresh call.
 *   - Unwraps the `{ data, meta }` envelope on success and re-throws
 *     `AppErrorLike` shaped errors so callers can `try / catch` cleanly.
 */

import Constants from 'expo-constants';
import ky, { HTTPError, type KyInstance, type ResponsePromise } from 'ky';
import { ulid } from 'ulid';

import { authStore } from '@/storage/stores/auth.store';

const DEFAULT_TIMEOUT_MS = 30_000;

function resolveBaseUrl(): string {
  const fromEnv =
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined);
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, '');
  return 'http://localhost:3000';
}

export const API_BASE_URL = resolveBaseUrl();

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---- Single-flight refresh -----------------------------------------------
let refreshInFlight: Promise<string> | null = null;
type RefreshFn = () => Promise<string>;
let refreshFnRef: RefreshFn | null = null;

/**
 * Hook the refresh implementation in here at boot. Defined in
 * `endpoints/auth.ts` to avoid a circular import (refresh itself uses
 * the ky client).
 */
export function setRefreshHandler(fn: RefreshFn): void {
  refreshFnRef = fn;
}

async function runRefresh(): Promise<string> {
  if (!refreshFnRef) {
    throw new ApiError('ERR_AUTH_TOKEN_EXPIRED', 'Session expired (no refresh handler wired)', 401);
  }
  if (!refreshInFlight) {
    refreshInFlight = refreshFnRef().finally(() => {
      // Clear after the round-trip so the *next* expiry triggers fresh work.
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// ---- Body unwrap ----------------------------------------------------------
async function readErrorEnvelope(res: Response): Promise<ApiErrorEnvelope['error'] | null> {
  try {
    const body = (await res.clone().json()) as Partial<ApiErrorEnvelope>;
    return body?.error ?? null;
  } catch {
    return null;
  }
}

// ---- ky instance ----------------------------------------------------------
export function createApiClient(): KyInstance {
  return ky.create({
    prefixUrl: API_BASE_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    retry: {
      limit: 2,
      methods: ['get', 'put', 'head', 'delete', 'options', 'trace'],
      backoffLimit: 3_000,
    },
    hooks: {
      beforeRequest: [
        (request) => {
          const access = authStore.getAccessToken();
          if (access) {
            request.headers.set('Authorization', `Bearer ${access}`);
          }
          if (request.method !== 'GET') {
            request.headers.set('Idempotency-Key', ulid());
          }
          if (!request.headers.has('Content-Type') && request.method !== 'GET') {
            request.headers.set('Content-Type', 'application/json');
          }
          request.headers.set('Accept', 'application/json');
        },
      ],
      afterResponse: [
        async (request, _options, response) => {
          // Single-flight refresh on token-expired
          if (response.status === 401) {
            const env = await readErrorEnvelope(response);
            if (env?.code === 'ERR_AUTH_TOKEN_EXPIRED') {
              try {
                const newToken = await runRefresh();
                const retry = new Request(request, {
                  headers: new Headers(request.headers),
                });
                retry.headers.set('Authorization', `Bearer ${newToken}`);
                return await fetch(retry);
              } catch (err) {
                // Refresh failed → propagate the original 401
                await authStore.logout().catch(() => undefined);
                throw err instanceof Error
                  ? err
                  : new ApiError('ERR_AUTH_TOKEN_EXPIRED', 'Session expired', 401);
              }
            }
          }
          return response;
        },
      ],
    },
  });
}

/** Translate ky's HTTPError into our envelope-aware ApiError. */
async function toApiError(err: unknown): Promise<never> {
  if (err instanceof HTTPError) {
    const env = await readErrorEnvelope(err.response);
    if (env) {
      throw new ApiError(env.code, env.message, err.response.status, env.details, env.request_id);
    }
    throw new ApiError('ERR_INTERNAL', err.message || 'Request failed', err.response.status);
  }
  throw err;
}

export const api = createApiClient();

/**
 * Type-safe `{ data, meta }` envelope unwrap. Use in endpoint wrappers:
 *
 *   const user = await unwrap<User>(api.get('v1/auth/me'));
 */
export async function unwrap<T>(req: ResponsePromise<unknown> | Promise<Response>): Promise<T> {
  try {
    const res = await req;
    const body = (await res.json()) as { data: T };
    return body.data;
  } catch (err) {
    await toApiError(err); // throws — never returns
    throw err; // unreachable; satisfies TS narrowing
  }
}
