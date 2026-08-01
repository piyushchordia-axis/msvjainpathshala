/**
 * Shared helpers copy-pasted across admin route files historically.
 * Lifted from gallery.ts / niyam-submissions.ts — behaviour must stay identical.
 */
import type { PgColumn } from "drizzle-orm/pg-core";
import { inArray, sql } from "drizzle-orm";
import type { AdminScope } from "./scope";

export function scopedCentreFilter(scope: AdminScope, column: PgColumn) {
  if (scope.centreIds === null) return undefined;
  if (scope.centreIds.length === 0) return sql`false`;
  return inArray(column, scope.centreIds);
}

export function inScope(scope: AdminScope, centreId: string | null): boolean {
  if (scope.centreIds === null) return true;
  if (!centreId) return false;
  return scope.centreIds.includes(centreId);
}

export function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export function firstName(full: string | null): string {
  if (!full) return "—";
  return full.trim().split(/\s+/)[0] ?? full;
}
