/**
 * Shared types for offline queues and caches.
 *
 * Every mutation we'd send to the backend goes through `PendingOp<T>` first:
 *   - `client_op_id` is a ULID (sortable, generated at op-creation time)
 *     used both as the idempotency key on the backend and as the local
 *     primary key in MMKV.
 *   - `created_at` lets us age out abandoned ops in dead-letter cleanup.
 *   - `attempts` tracks retry count for the retry-policy ladder
 *     (5s → 15s → 45s → 2min → 5min cap, max 10 — see `sync/retry-policy.ts`).
 *   - `last_error` stores the last failure reason for the Sync Issues UI.
 */

import type { Role } from '@jp/shared';

export interface PendingOp<TPayload = unknown> {
  client_op_id: string;
  kind: string;
  created_at: string;
  attempts: number;
  last_error?: string | null;
  payload: TPayload;
}

export interface CacheEntry<TValue = unknown> {
  value: TValue;
  fetched_at: string;
  expires_at?: string | null;
}

export interface AuthSnapshot {
  user: {
    id: string;
    phone: string;
    role: Role;
    full_name: string;
    preferred_language: 'en' | 'hi';
  };
  view: 'parent' | 'student' | null;
  /** Access token TTL (ISO). The token itself lives in memory + MMKV. */
  access_expires_at: string;
  /** Refresh TTL (ISO). The token itself lives in SecureStore. */
  refresh_expires_at: string;
}

export interface ProfileSnapshot {
  preferred_language: 'en' | 'hi';
  last_login_phone?: string;
  /** ISO datetime of the most recent successful `/v1/sync/delta` (Step 14).
   *  The sync engine uses this as the `since` parameter; cleared on logout. */
  last_sync_at?: string;
}
