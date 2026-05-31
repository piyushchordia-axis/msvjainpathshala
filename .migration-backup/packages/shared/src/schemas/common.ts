/**
 * Shared Zod primitives used across every DTO.
 *
 * SPEC §6.27 — Validation Standards:
 *   - Phone: E.164 (`+91…`)
 *   - All UUIDs: UUID v4 regex
 *   - All datetimes: ISO 8601 with timezone
 *   - Bilingual fields require both `_en` and `_hi` (else 422 with
 *     `ERR_VALIDATION_BILINGUAL_REQUIRED`)
 */

import { z } from 'zod';

import { PAGINATION_DEFAULT, PAGINATION_MAX } from '../constants/limits.js';
import { LANGUAGES } from '../enums/language.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** UUID v4 (Drizzle default — `gen_random_uuid()`). */
export const uuid = z.string().uuid({ message: 'Must be a valid UUID v4' });

/**
 * E.164 phone number (`+<country><number>`, 7–15 digits total after `+`).
 * India numbers start with `+91`.
 */
export const phone = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format (+91…)');

/** Email (case-insensitive citext on the DB side). */
export const email = z.string().email().max(255).toLowerCase();

/** ISO 8601 datetime with timezone (`2026-05-28T10:30:00+05:30` or `…Z`). */
export const isoDatetime = z
  .string()
  .datetime({ offset: true, message: 'Must be ISO 8601 with timezone' });

/** ISO 8601 date (`YYYY-MM-DD`), for things like DOB. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

/** Language code matching SPEC §5.1 `language_enum`. */
export const languageCode = z.enum(LANGUAGES);

/** Latitude / longitude (WGS84). */
export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);

// ---------------------------------------------------------------------------
// Composite helpers
// ---------------------------------------------------------------------------

/**
 * Bilingual text — both `_en` and `_hi` are required (SPEC §6.27).
 * Use `bilingualText('title')` to get `{ title_en, title_hi }`.
 */
export function bilingualText<K extends string>(field: K, opts?: { max?: number }) {
  const max = opts?.max ?? 500;
  const value = z.string().min(1).max(max);
  return z.object({
    [`${field}_en`]: value,
    [`${field}_hi`]: value,
  } as Record<`${K}_en` | `${K}_hi`, typeof value>);
}

/** Offset-style pagination query. */
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(PAGINATION_MAX).default(PAGINATION_DEFAULT),
});
export type PaginationQuery = z.infer<typeof pagination>;

/** Cursor-style pagination query. */
export const cursorPagination = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX).default(PAGINATION_DEFAULT),
});
export type CursorPaginationQuery = z.infer<typeof cursorPagination>;

/**
 * Idempotency key (Punya transactions, sync ops). UUID v4 or ULID — accept
 * either by matching a permissive pattern; strict validation happens in the
 * service if the kind matters.
 */
export const idempotencyKey = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Idempotency key must be URL-safe');
