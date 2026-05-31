/**
 * Server-side axios client. Used by Route Handlers and Server Components
 * to call the backend API.
 *
 *   - baseURL from INTERNAL_API_BASE_URL (server-only; not bundled to
 *     the browser). Defaults to http://localhost:3000.
 *   - Automatically reads the access token from the request cookie jar
 *     when called from a Server Component / Route Handler. Pass the
 *     token explicitly via `withAccessToken(token)` for handlers that
 *     have already extracted it.
 *   - 15s timeout (admin/server flows; faster than the mobile 30s).
 *   - Idempotency-Key (ULID) on non-GET so retries are safe.
 *   - Translates AxiosError into envelope-aware ApiError.
 *
 * The HTTP-client convention for Jain Pathshala is axios across all
 * surfaces (see `/Users/sumit/.claude/projects/.../memory/feedback_http_client.md`).
 */

import axios, { type AxiosError, type AxiosInstance } from 'axios';
import { ulid } from 'ulid';

import { readAccessToken } from '@/lib/auth-cookies';

const BASE_URL =
  process.env.NEXT_INTERNAL_API_BASE_URL ??
  process.env.INTERNAL_API_BASE_URL ??
  'http://localhost:3000';

const DEFAULT_TIMEOUT_MS = 15_000;

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

function buildInstance(token: string | null): AxiosInstance {
  const instance = axios.create({
    baseURL: BASE_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    headers: { Accept: 'application/json' },
  });

  instance.interceptors.request.use((config) => {
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
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
    (err: AxiosError<Partial<ApiErrorEnvelope>>) => Promise.reject(toApiError(err)),
  );

  return instance;
}

/** Build a client that explicitly carries a token (handy in Route Handlers). */
export function withAccessToken(token: string | null): AxiosInstance {
  return buildInstance(token);
}

/**
 * Build an authenticated client by reading the cookie jar.
 * Safe to call from Server Components and Route Handlers.
 */
export async function authenticatedServerClient(): Promise<AxiosInstance> {
  const token = await readAccessToken();
  return buildInstance(token);
}

/**
 * Anonymous client (no Authorization header). Used for the OTP
 * send/verify flow before a session exists.
 */
export const anonServerClient = buildInstance(null);
