/**
 * Shared helpers copy-pasted across admin route files historically.
 * Lifted from gallery.ts / niyam-submissions.ts — behaviour must stay identical.
 */
import type { Request } from "express";
import type { PgColumn } from "drizzle-orm/pg-core";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, students } from "@workspace/db";
import type { AdminScope } from "./scope";

export function scopedCentreFilter(scope: AdminScope, column: PgColumn) {
  if (scope.centreIds === null) return undefined;
  if (scope.centreIds.length === 0) return sql`false`;
  return inArray(column, scope.centreIds);
}

/** Batch write-scope filter (shikshak assigned batches). null = no extra filter. */
export function scopedBatchFilter(scope: AdminScope, column: PgColumn) {
  if (scope.batchIds === null) return undefined;
  if (scope.batchIds.length === 0) return sql`false`;
  return inArray(column, scope.batchIds);
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
 * Ownership filter shared by ownedStudentId / listOwnedStudents (Q11).
 * Soft-deleted and non-active students are excluded.
 */
export function ownedStudentsCondition(callerUserId: string) {
  return and(
    isNull(students.deleted_at),
    eq(students.status, "active"),
    or(eq(students.parent_id, callerUserId), eq(students.user_id, callerUserId)),
  );
}

/**
 * Resolve a student the caller owns (parent of, or is, that student).
 * Soft-deleted and non-active students are treated as not found (Q11).
 */
export async function ownedStudentId(req: Request, id: string): Promise<string | null> {
  const row = await ownedStudentRow(req, id);
  return row?.id ?? null;
}

/** Same ownership as ownedStudentId, with display name (F6 feed labelling). */
export async function ownedStudentRow(
  req: Request,
  id: string,
): Promise<{ id: string; full_name: string } | null> {
  const uid = req.authUser!.id;
  const [row] = await db
    .select({ id: students.id, full_name: students.full_name })
    .from(students)
    .where(and(eq(students.id, id), ownedStudentsCondition(uid)))
    .limit(1);
  return row ?? null;
}

/** Every active student the caller owns — same filter as ownedStudentId (F6). */
export async function listOwnedStudents(
  req: Request,
): Promise<Array<{ id: string; full_name: string }>> {
  const uid = req.authUser!.id;
  return db
    .select({ id: students.id, full_name: students.full_name })
    .from(students)
    .where(ownedStudentsCondition(uid))
    .orderBy(asc(students.full_name));
}
