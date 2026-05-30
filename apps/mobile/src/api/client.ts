/**
 * axios-based API client (SPEC §4.3).
 *
 *   - Base URL from `EXPO_PUBLIC_API_BASE_URL` (Constants.expoConfig.extra
 *     fallback). Android emulator users must set http://10.0.2.2:3000.
 *   - Bearer token from `authStore.getAccessToken()` (memory). When that
 *     returns null we attach no Authorization header — callers handle 401.
 *   - `Idempotency-Key: <ULID>` injected for any non-GET request.
 *   - 30s timeout.
 *   - Single-flight refresh on `ERR_AUTH_TOKEN_EXPIRED`: a shared
 *     `Promise<string>` cached at module scope so 50 concurrent stale
 *     requests result in one /v1/auth/refresh call.
 *   - Translates `AxiosError` into envelope-aware `ApiError` so callers
 *     can `catch (err) { if (err instanceof ApiError) … }` without
 *     inspecting raw `response.data.error`.
 */

import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
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
 * the axios client).
 */
export function setRefreshHandler(fn: RefreshFn): void {
  refreshFnRef = fn;
}

/**
 * Single-flight refresh. ALL refresh paths — the response-interceptor's
 * expired-token retry, the request-interceptor's cold-start pre-emptive
 * refresh, AND AuthProvider.hydrate() — must funnel through here so a cold
 * start never fires two concurrent `/v1/auth/refresh` calls with the same
 * refresh token (which the backend's reuse-detection would treat as a replay
 * and revoke the whole token family).
 */
export async function runRefresh(): Promise<string> {
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

// ---- Error translation ---------------------------------------------------
function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (axios.isAxiosError(err)) {
    const envelope = (err.response?.data as Partial<ApiErrorEnvelope> | undefined)?.error;
    const status = err.response?.status ?? 0;
    if (envelope) {
      return new ApiError(
        envelope.code,
        envelope.message,
        status,
        envelope.details,
        envelope.request_id,
      );
    }
    return new ApiError(
      status === 0 ? 'ERR_NETWORK' : 'ERR_INTERNAL',
      err.message || 'Request failed',
      status,
    );
  }
  return new ApiError('ERR_INTERNAL', err instanceof Error ? err.message : String(err), 0);
}

// ---- axios instance ------------------------------------------------------
type RetryFlaggedConfig = InternalAxiosRequestConfig & { _jpRetried?: boolean };

export function createApiClient(): AxiosInstance {
  const instance = axios.create({
    baseURL: API_BASE_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    headers: { Accept: 'application/json' },
  });

  instance.interceptors.request.use(async (config) => {
    let access = authStore.getAccessToken();
    // Cold-start / deep-link race: the access token lives in memory only and
    // is restored asynchronously by AuthProvider.hydrate() (which refreshes
    // using the persisted refresh token). A screen that fetches on mount can
    // fire BEFORE that completes — sending no Authorization header and getting
    // a 401 "Authorization header missing". Pre-emptively run the (single-
    // flight) refresh here so the first authed request after launch carries a
    // token. Skip for auth + public endpoints, which need no bearer.
    if (!access) {
      const url = config.url ?? '';
      const needsAuth = !url.includes('/auth/') && !url.includes('/public/');
      if (needsAuth) {
        try {
          access = await runRefresh();
        } catch {
          // Logged out / no refresh token — proceed unauthenticated and let
          // the caller surface its normal empty/error state.
          access = null;
        }
      }
    }
    if (access) {
      config.headers.set('Authorization', `Bearer ${access}`);
    }
    const method = (config.method ?? 'get').toLowerCase();
    if (method !== 'get') {
      config.headers.set('Idempotency-Key', ulid());
      if (!config.headers.has('Content-Type')) {
        config.headers.set('Content-Type', 'application/json');
      }
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (err: AxiosError<Partial<ApiErrorEnvelope>>) => {
      const status = err.response?.status;
      const code = err.response?.data?.error?.code;
      const original = err.config as RetryFlaggedConfig | undefined;

      // Single-flight refresh on expired access token. Retry the original
      // request once with the new bearer; further failures propagate.
      if (status === 401 && code === 'ERR_AUTH_TOKEN_EXPIRED' && original && !original._jpRetried) {
        try {
          const newToken = await runRefresh();
          original._jpRetried = true;
          original.headers.set('Authorization', `Bearer ${newToken}`);
          return await instance.request(original);
        } catch (refreshErr) {
          await authStore.logout().catch(() => undefined);
          return Promise.reject(toApiError(refreshErr));
        }
      }
      return Promise.reject(toApiError(err));
    },
  );

  return instance;
}

export const api = createApiClient();

/**
 * Type-safe `{ data, meta }` envelope unwrap. Use in endpoint wrappers:
 *
 *   const user = await unwrap<User>(api.get('/v1/auth/me'));
 *
 * Axios already gives us `{ data: <server-body> }`; the server body is
 * `{ data: T, meta }`. We accept either the doubly-wrapped or the bare
 * shape so test fixtures don't have to mimic the envelope exactly.
 */
export async function unwrap<T>(req: Promise<{ data: unknown }>): Promise<T> {
  const res = await req;
  const body = res.data as { data?: T } | T;
  if (body && typeof body === 'object' && 'data' in (body as object)) {
    return (body as { data: T }).data;
  }
  return body as T;
}
