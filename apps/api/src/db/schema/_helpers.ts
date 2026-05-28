/**
 * Shared column helpers used by every table schema in `apps/api/src/db/schema/`.
 *
 *   • `timestamps()`  — created_at + updated_at (timestamptz, default now())
 *   • `softDelete()`  — deleted_at (timestamptz, nullable)
 *   • `auditedBy()`   — created_by + updated_by (uuid, nullable, ON DELETE SET NULL)
 *
 * `auditedBy()` references `users.id` lazily via a function callback so the
 * helpers file does not have to import `users` (which would cause cycles —
 * `users` itself uses `timestamps()`).
 */

import { timestamp, uuid } from 'drizzle-orm/pg-core';

import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export function timestamps() {
  return {
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  };
}

export function softDelete() {
  return {
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  };
}

/**
 * Audit cols (`created_by` / `updated_by`) referencing `users.id`.
 *
 * Callers pass a getter — `auditedBy(() => users.id)` — so the importing
 * file already has `users` in scope. Lazy reference avoids the cyclic
 * import that would happen if this module pulled `users` directly.
 */
export function auditedBy(userIdRef: () => AnyPgColumn) {
  return {
    created_by: uuid('created_by').references(userIdRef, { onDelete: 'set null' }),
    updated_by: uuid('updated_by').references(userIdRef, { onDelete: 'set null' }),
  };
}
