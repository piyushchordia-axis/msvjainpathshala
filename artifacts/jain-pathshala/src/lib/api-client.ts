const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

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
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
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
      env?.code ?? 'ERR_HTTP',
      env?.message ?? res.statusText,
      res.status,
      env?.details,
    );
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function del<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'DELETE', ...(body ? { body: JSON.stringify(body) } : {}) });
}

function unwrap<T>(data: unknown): T {
  if (data && typeof data === 'object' && 'data' in (data as object)) {
    return (data as { data: T }).data;
  }
  return data as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await post<{ data: T } | T>(path, body);
  return unwrap<T>(res);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await get<{ data: T } | T>(path);
  return unwrap<T>(res);
}
