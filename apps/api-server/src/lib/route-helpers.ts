/**
 * Shared helpers copy-pasted across admin route files historically.
 * Lifted from gallery.ts / niyam-submissions.ts — behaviour must stay identical.
 */
import type { Request } from "express";
import type { PgColumn } from "drizzle-orm/pg-core";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, students } from "@workspace/db";
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

/**
 * Resolve a student the caller owns (parent of, or is, that student).
 * Soft-deleted and non-active students are treated as not found (Q11).
 */
export async function ownedStudentId(req: Request, id: string): Promise<string | null> {
  const uid = req.authUser!.id;
  const [row] = await db
    .select({ id: students.id })
    .from(students)
    .where(
      and(
        eq(students.id, id),
        isNull(students.deleted_at),
        eq(students.status, "active"),
        or(eq(students.parent_id, uid), eq(students.user_id, uid)),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
