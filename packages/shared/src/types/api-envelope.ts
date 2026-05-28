/**
 * `ApiEnvelope<T>` — the success-side wrapper for every API response.
 *
 * Pairs with `ErrorEnvelope` (from `errors/envelope.ts`); the API NEVER mixes
 * `data` and `error` in the same payload.
 *
 *   Success:  { data: T,   meta: { request_id, timestamp, ...pagination? } }
 *   Error:    { error: { code, message, details?, request_id } }
 */

export interface ResponseMeta {
  request_id: string;
  timestamp: string; // ISO 8601 with timezone

  // Pagination meta (present on list endpoints; absent on single-resource
  // responses). Either offset/limit-style OR cursor-style is populated,
  // never both.
  page?: number;
  page_size?: number;
  total?: number;
  next_cursor?: string | null;
  prev_cursor?: string | null;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ResponseMeta;
}

/**
 * `Paginated<T>` — items + offset-style pagination metadata (the canonical
 * shape for `GET /v1/...` list endpoints that accept `?page=&page_size=`).
 */
export interface Paginated<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

/**
 * `CursorPaginated<T>` — opaque cursor pagination for high-velocity feeds
 * (e.g. notifications, audit logs). Both cursors are nullable: `null` means
 * no further page in that direction.
 */
export interface CursorPaginated<T> {
  items: T[];
  next_cursor: string | null;
  prev_cursor: string | null;
}
