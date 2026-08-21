/**
 * Course progress writes — CU9–CU15.
 * Single implementation for the online route and offline sync/batch.
 * Never a parallel offline-only path.
 */
import {
  db,
  course_sections,
  course_subsections,
  student_course_progress,
  students,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ErrorCode } from "@workspace/api-zod";
import { ErrorCode as Err } from "@workspace/api-zod";
import type { AdminScope } from "../lib/scope";
import { inBatchWriteScope } from "../lib/scope";
import { writeAudits, type AuditInput } from "../lib/audit";
import { isUniqueViolationOn } from "../lib/pg-errors";
import type { Role } from "@workspace/api-zod";

/** Live status values only — 'mastered' is reserved and never written (CU11). */
export const COURSE_PROGRESS_STATUSES = ["not_started", "in_progress", "completed"] as const;
export type CourseProgressStatus = (typeof COURSE_PROGRESS_STATUSES)[number];

export type CourseProgressNodeKind = "section" | "subsection";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

export class CourseProgressError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CourseProgressError";
  }
}

export type UpsertCourseProgressInput = {
  studentId: string;
  nodeKind: CourseProgressNodeKind;
  nodeId: string;
  status: CourseProgressStatus;
  note?: string | null;
  updatedBy: string;
  updatedByRole: string;
  clientOpId?: string | null;
  clientMarkedAt?: Date | null;
  /**
   * CU19 correction only. Default false — certified rows are frozen for
   * everyone else (CU12); the service guard is the contract, the CHECK is the net.
   */
  allowCertifiedWrite?: boolean;
};

export type UpsertCourseProgressResult = {
  id: string;
  student_id: string;
  section_id: string | null;
  subsection_id: string | null;
  status: CourseProgressStatus;
  note: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  certified_at: Date | null;
  revision: number;
  /** false when stored client_marked_at is newer (CU31 / AT26) — sync maps to duplicate. */
  applied: boolean;
};

function assertLiveStatus(status: string): asserts status is CourseProgressStatus {
  if (!(COURSE_PROGRESS_STATUSES as readonly string[]).includes(status)) {
    throw new CourseProgressError(
      422,
      Err.VALIDATION_FAILED,
      "Progress status must be not_started, in_progress, or completed — 'mastered' is not written (use certification).",
    );
  }
}

async function resolveNode(
  nodeKind: CourseProgressNodeKind,
  nodeId: string,
  client: DbOrTx = db,
): Promise<{ sectionId: string | null; subsectionId: string | null }> {
  if (nodeKind === "subsection") {
    const [row] = await client
      .select({ id: course_subsections.id })
      .from(course_subsections)
      .where(and(eq(course_subsections.id, nodeId), isNull(course_subsections.deleted_at)))
      .limit(1);
    if (!row) {
      throw new CourseProgressError(
        404,
        Err.COURSE_NODE_NOT_FOUND,
        "That course node was not found — check the id and try again.",
      );
    }
    return { sectionId: null, subsectionId: row.id };
  }

  const [row] = await client
    .select({ id: course_sections.id })
    .from(course_sections)
    .where(and(eq(course_sections.id, nodeId), isNull(course_sections.deleted_at)))
    .limit(1);
  if (!row) {
    throw new CourseProgressError(
      404,
      Err.COURSE_NODE_NOT_FOUND,
      "That course node was not found — check the id and try again.",
    );
  }
  return { sectionId: row.id, subsectionId: null };
}

const progressReturning = {
  id: student_course_progress.id,
  student_id: student_course_progress.student_id,
  section_id: student_course_progress.section_id,
  subsection_id: student_course_progress.subsection_id,
  status: student_course_progress.status,
  note: student_course_progress.note,
  started_at: student_course_progress.started_at,
  completed_at: student_course_progress.completed_at,
  certified_at: student_course_progress.certified_at,
  revision: student_course_progress.revision,
};

type ProgressRow = {
  id: string;
  student_id: string;
  section_id: string | null;
  subsection_id: string | null;
  status: "not_started" | "in_progress" | "completed" | "mastered";
  note: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  certified_at: Date | null;
  revision: number;
};

/**
 * UPSERT one (student, node) progress row (CU10).
 * Partial unique indexes require targetWhere — omitting it fails at runtime.
 * Newest client_marked_at wins (CU31) — comparison lives here so online obeys
 * it too, arbitrated atomically inside the upsert's setWhere (C3) rather than
 * a read-then-write race between a pre-check SELECT and this INSERT.
 */
export async function upsertCourseProgress(
  input: UpsertCourseProgressInput,
  tx?: Tx,
): Promise<UpsertCourseProgressResult> {
  assertLiveStatus(input.status);
  const client: DbOrTx = tx ?? db;
  const { sectionId, subsectionId } = await resolveNode(input.nodeKind, input.nodeId, client);

  const existingWhere = subsectionId
    ? and(
        eq(student_course_progress.student_id, input.studentId),
        eq(student_course_progress.subsection_id, subsectionId),
      )
    : and(
        eq(student_course_progress.student_id, input.studentId),
        eq(student_course_progress.section_id, sectionId!),
        isNull(student_course_progress.subsection_id),
      );

  const now = new Date();
  const startedAtInsert = input.status === "not_started" ? null : now;
  const completedAtInsert = input.status === "completed" ? now : null;

  const values = {
    student_id: input.studentId,
    section_id: sectionId,
    subsection_id: subsectionId,
    status: input.status,
    note: input.note ?? null,
    started_at: startedAtInsert,
    completed_at: completedAtInsert,
    updated_by: input.updatedBy,
    updated_by_role: input.updatedByRole,
    client_op_id: input.clientOpId ?? null,
    client_marked_at: input.clientMarkedAt ?? null,
  };

  // C3 — omit client_op_id/client_marked_at from the UPDATE branch when this
  // write doesn't carry them, instead of nulling out whatever CU31 state a
  // prior (possibly offline) write already stored. M10 — same coalesce
  // treatment for note: an op carrying no note is not a write of an empty one.
  //
  // Deliberately `!= null` (loose), not `!== undefined`: every call site in
  // this codebase — the online route, bulk, reset — normalises "not
  // provided" to an explicit `null` before it ever reaches this function
  // (`body.note ?? null`, `body.client_op_id ?? null`, …), so an
  // `undefined`-only check would never actually omit anything and this fix
  // would silently do nothing. No caller has a legitimate reason to
  // explicitly null out a previously-recorded note/op-id/clock, so treating
  // null the same as "absent" here loses no real behaviour.
  const set = {
    status: input.status,
    // First transition into progress stamps started_at; not_started clears it (CU11).
    started_at:
      input.status === "not_started"
        ? null
        : sql`coalesce(${student_course_progress.started_at}, now())`,
    // completed stamps completed_at; leaving completed clears it (CU11).
    completed_at: input.status === "completed" ? sql`now()` : null,
    updated_by: input.updatedBy,
    updated_by_role: input.updatedByRole,
    updated_at: now,
    ...(input.note != null ? { note: input.note } : {}),
    ...(input.clientOpId != null ? { client_op_id: input.clientOpId } : {}),
    ...(input.clientMarkedAt != null ? { client_marked_at: input.clientMarkedAt } : {}),
    // M38 — the CU19 correction path clears the certified pair in the SAME
    // statement it (optionally) regresses status, so a regressing write can
    // never collide with the certified_requires_completed CHECK (23514 → 500).
    ...(input.allowCertifiedWrite
      ? { certified_at: null, certified_by: null, certification_note: null }
      : {}),
  };

  // CU31 — newest client_marked_at wins, folded into setWhere so Postgres
  // arbitrates atomically. CU12 — certified rows are frozen unless the
  // correction path opts in.
  const staleGuard = input.clientMarkedAt
    ? sql`(${student_course_progress.client_marked_at} is null or ${student_course_progress.client_marked_at} <= ${input.clientMarkedAt})`
    : null;
  const setWhere = input.allowCertifiedWrite
    ? (staleGuard ?? undefined)
    : staleGuard
      ? sql`${student_course_progress.certified_at} is null and ${staleGuard}`
      : sql`${student_course_progress.certified_at} is null`;

  let rows: ProgressRow[];
  try {
    if (subsectionId) {
      rows = await client
        .insert(student_course_progress)
        .values(values)
        .onConflictDoUpdate({
          target: [student_course_progress.student_id, student_course_progress.subsection_id],
          targetWhere: sql`${student_course_progress.subsection_id} is not null`,
          set,
          setWhere,
        })
        .returning(progressReturning);
    } else {
      rows = await client
        .insert(student_course_progress)
        .values(values)
        .onConflictDoUpdate({
          target: [student_course_progress.student_id, student_course_progress.section_id],
          targetWhere: sql`${student_course_progress.section_id} is not null`,
          set,
          setWhere,
        })
        .returning(progressReturning);
    }
  } catch (err) {
    // M20 — this client_op_id already belongs to a DIFFERENT (student, node)
    // row. The ON CONFLICT target above is (student, node); a collision on
    // the SEPARATE client_op_id unique index is a raw constraint violation,
    // not a graceful "0 rows" — without this it 500s instead of reporting
    // the idempotent duplicate a repeated offline op actually is.
    if (
      input.clientOpId &&
      isUniqueViolationOn(err, "student_course_progress_client_op_id_unique")
    ) {
      const [owner] = await client
        .select(progressReturning)
        .from(student_course_progress)
        .where(eq(student_course_progress.client_op_id, input.clientOpId))
        .limit(1);
      if (owner) {
        return { ...owner, status: owner.status as CourseProgressStatus, applied: false };
      }
    }
    throw err;
  }

  const row = rows[0];
  if (!row) {
    // setWhere blocked the update — either the row is certified (and this
    // isn't a correction write) or a newer client_marked_at already stands
    // (CU31). Report the current state rather than erroring where the second
    // case applies.
    const [existing] = await client
      .select(progressReturning)
      .from(student_course_progress)
      .where(existingWhere)
      .limit(1);
    if (existing?.certified_at && !input.allowCertifiedWrite) {
      throw new CourseProgressError(
        409,
        Err.COURSE_NODE_CERTIFIED,
        "That node is already certified — only a super_admin correction can change it.",
      );
    }
    if (existing) {
      return { ...existing, status: existing.status as CourseProgressStatus, applied: false };
    }
    throw new CourseProgressError(500, Err.INTERNAL, "Progress write did not apply — try again.");
  }

  return {
    id: row.id,
    student_id: row.student_id,
    section_id: row.section_id,
    subsection_id: row.subsection_id,
    status: row.status as CourseProgressStatus,
    note: row.note,
    started_at: row.started_at,
    completed_at: row.completed_at,
    certified_at: row.certified_at,
    revision: row.revision,
    applied: true,
  };
}

const STATUS_RANK: Record<CourseProgressStatus, number> = {
  not_started: 0,
  in_progress: 1,
  completed: 2,
};

export function statusRank(status: string | null | undefined): number {
  if (!status || status === "not_started") return 0;
  if (status === "in_progress") return 1;
  if (status === "completed" || status === "mastered") return 2;
  return 0;
}

export type BulkProgressInput = {
  nodeKind: CourseProgressNodeKind;
  nodeId: string;
  status: CourseProgressStatus;
  note?: string | null;
  batchId?: string | null;
  studentIds?: string[] | null;
  scope: AdminScope;
  updatedBy: string;
  updatedByRole: string;
};

/**
 * CU13/CU14 — bulk advance only. Exactly one of batch_id / student_ids.
 * Out-of-scope student_ids → 403 whole, nothing applied. Unknown/deactivated
 * ids → distinct 404 (M11), never conflated with a scope violation.
 */
export async function bulkUpsertCourseProgress(input: BulkProgressInput): Promise<{
  applied: number;
  skipped: number;
  student_ids: string[];
}> {
  assertLiveStatus(input.status);
  const hasBatch = !!input.batchId;
  const hasIds = Array.isArray(input.studentIds) && input.studentIds.length > 0;
  if (hasBatch === hasIds) {
    throw new CourseProgressError(
      422,
      Err.VALIDATION_FAILED,
      "Provide exactly one of batch_id or student_ids.",
    );
  }

  let roster: Array<{ id: string; batch_id: string | null; centre_id: string | null }>;
  if (hasBatch) {
    roster = await db
      .select({
        id: students.id,
        batch_id: students.batch_id,
        centre_id: students.centre_id,
      })
      .from(students)
      .where(
        and(
          eq(students.batch_id, input.batchId!),
          eq(students.status, "active"),
          isNull(students.deleted_at),
        ),
      );
  } else {
    // Q11 — unknown, soft-deleted or deactivated ids never resolve here.
    roster = await db
      .select({
        id: students.id,
        batch_id: students.batch_id,
        centre_id: students.centre_id,
      })
      .from(students)
      .where(
        and(
          inArray(students.id, input.studentIds!),
          eq(students.status, "active"),
          isNull(students.deleted_at),
        ),
      );
    if (roster.length !== input.studentIds!.length) {
      // M11 — distinct from a scope violation: these ids simply don't
      // resolve to a live, active student, which is a different problem for
      // the caller to fix than "you can't touch that student."
      throw new CourseProgressError(
        404,
        Err.NOT_FOUND,
        "One or more students were not found or are inactive — nothing was applied.",
      );
    }
  }

  for (const s of roster) {
    if (!inBatchWriteScope(input.scope, s.batch_id, s.centre_id)) {
      throw new CourseProgressError(
        403,
        Err.COURSE_STUDENT_OUT_OF_SCOPE,
        "One or more students are outside your scope — nothing was applied.",
      );
    }
  }

  // Resolve node once (throws 404 if missing).
  await resolveNode(input.nodeKind, input.nodeId);

  const targetRank = STATUS_RANK[input.status];

  // M7 — one transaction for the whole roster; a mid-loop failure must not
  // leave some students advanced and the rest untouched with no way to tell.
  return db.transaction(async (tx) => {
    let applied = 0;
    let skipped = 0;
    const appliedIds: string[] = [];

    for (const s of roster) {
      const [existing] = await tx
        .select({
          status: student_course_progress.status,
          certified_at: student_course_progress.certified_at,
        })
        .from(student_course_progress)
        .where(
          input.nodeKind === "subsection"
            ? and(
                eq(student_course_progress.student_id, s.id),
                eq(student_course_progress.subsection_id, input.nodeId),
              )
            : and(
                eq(student_course_progress.student_id, s.id),
                eq(student_course_progress.section_id, input.nodeId),
                isNull(student_course_progress.subsection_id),
              ),
        )
        .limit(1);

      // CU12 — certified rows excluded from every bulk write.
      if (existing?.certified_at) {
        skipped += 1;
        continue;
      }
      // CU14 — advance only; silence (no row) ranks as not_started.
      if (statusRank(existing?.status) >= targetRank) {
        skipped += 1;
        continue;
      }

      await upsertCourseProgress(
        {
          studentId: s.id,
          nodeKind: input.nodeKind,
          nodeId: input.nodeId,
          status: input.status,
          note: input.note ?? null,
          updatedBy: input.updatedBy,
          updatedByRole: input.updatedByRole,
        },
        tx,
      );
      applied += 1;
      appliedIds.push(s.id);
    }

    return { applied, skipped, student_ids: appliedIds };
  });
}

export type ResetProgressInput = {
  nodeKind: CourseProgressNodeKind;
  nodeId: string;
  status: CourseProgressStatus;
  note?: string | null;
  batchId?: string | null;
  studentIds?: string[] | null;
  scope: AdminScope;
  updatedBy: string;
  updatedByRole: Role;
  ip?: string | null;
};

/** CU14 reset — explicit regression, audited per student. Certified rows excluded. */
export async function resetCourseProgress(input: ResetProgressInput): Promise<{
  applied: number;
  skipped: number;
}> {
  assertLiveStatus(input.status);
  const hasBatch = !!input.batchId;
  const hasIds = Array.isArray(input.studentIds) && input.studentIds.length > 0;
  if (hasBatch === hasIds) {
    throw new CourseProgressError(
      422,
      Err.VALIDATION_FAILED,
      "Provide exactly one of batch_id or student_ids.",
    );
  }

  let roster: Array<{ id: string; batch_id: string | null; centre_id: string | null }>;
  if (hasBatch) {
    roster = await db
      .select({
        id: students.id,
        batch_id: students.batch_id,
        centre_id: students.centre_id,
      })
      .from(students)
      .where(
        and(
          eq(students.batch_id, input.batchId!),
          eq(students.status, "active"),
          isNull(students.deleted_at),
        ),
      );
  } else {
    // M8 — align with bulk's Q11 exclusion: naming a deactivated student's id
    // explicitly must not let a regression land on them anyway.
    roster = await db
      .select({
        id: students.id,
        batch_id: students.batch_id,
        centre_id: students.centre_id,
      })
      .from(students)
      .where(
        and(
          inArray(students.id, input.studentIds!),
          eq(students.status, "active"),
          isNull(students.deleted_at),
        ),
      );
    if (roster.length !== input.studentIds!.length) {
      // M11 — distinct from a scope violation, same reasoning as bulk.
      throw new CourseProgressError(
        404,
        Err.NOT_FOUND,
        "One or more students were not found or are inactive — nothing was applied.",
      );
    }
  }

  for (const s of roster) {
    if (!inBatchWriteScope(input.scope, s.batch_id, s.centre_id)) {
      throw new CourseProgressError(
        403,
        Err.COURSE_STUDENT_OUT_OF_SCOPE,
        "One or more students are outside your scope — nothing was applied.",
      );
    }
  }

  await resolveNode(input.nodeKind, input.nodeId);

  // M7 + M9 — one transaction for the whole roster AND its per-student audit
  // rows: a mid-loop failure can't half-apply a regression, and the audit
  // trail that is CU14's entire justification for this route can't be
  // silently lost to a swallowed post-loop write.
  return db.transaction(async (tx) => {
    let applied = 0;
    let skipped = 0;
    const audits: AuditInput[] = [];

    for (const s of roster) {
      const [existing] = await tx
        .select({
          status: student_course_progress.status,
          certified_at: student_course_progress.certified_at,
        })
        .from(student_course_progress)
        .where(
          input.nodeKind === "subsection"
            ? and(
                eq(student_course_progress.student_id, s.id),
                eq(student_course_progress.subsection_id, input.nodeId),
              )
            : and(
                eq(student_course_progress.student_id, s.id),
                eq(student_course_progress.section_id, input.nodeId),
                isNull(student_course_progress.subsection_id),
              ),
        )
        .limit(1);

      if (existing?.certified_at) {
        skipped += 1;
        continue;
      }
      if (!existing) {
        skipped += 1;
        continue;
      }

      await upsertCourseProgress(
        {
          studentId: s.id,
          nodeKind: input.nodeKind,
          nodeId: input.nodeId,
          status: input.status,
          note: input.note ?? null,
          updatedBy: input.updatedBy,
          updatedByRole: input.updatedByRole,
        },
        tx,
      );
      applied += 1;
      audits.push({
        actorId: input.updatedBy,
        actorRole: input.updatedByRole,
        action: "update",
        entityKind: "student_course_progress",
        entityId: s.id,
        summary: `Reset course progress to ${input.status}.`,
        metadata: {
          student_id: s.id,
          node_kind: input.nodeKind,
          node_id: input.nodeId,
          status: input.status,
        },
        ip: input.ip ?? null,
      });
    }

    await writeAudits(audits, tx);
    return { applied, skipped };
  });
}
