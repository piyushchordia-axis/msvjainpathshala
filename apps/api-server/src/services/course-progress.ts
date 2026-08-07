/**
 * Course progress writes — CU9–CU15.
 * Single implementation for the online route and (later) offline sync/batch.
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
import type { Role } from "@workspace/api-zod";

/** Live status values only — 'mastered' is reserved and never written (CU11). */
export const COURSE_PROGRESS_STATUSES = ["not_started", "in_progress", "completed"] as const;
export type CourseProgressStatus = (typeof COURSE_PROGRESS_STATUSES)[number];

export type CourseProgressNodeKind = "section" | "subsection";

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
): Promise<{ sectionId: string | null; subsectionId: string | null }> {
  if (nodeKind === "subsection") {
    const [row] = await db
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

  const [row] = await db
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

/**
 * UPSERT one (student, node) progress row (CU10).
 * Partial unique indexes require targetWhere — omitting it fails at runtime.
 * Newest client_marked_at wins (CU31) — comparison lives here so online obeys it too.
 */
export async function upsertCourseProgress(
  input: UpsertCourseProgressInput,
): Promise<UpsertCourseProgressResult> {
  assertLiveStatus(input.status);
  const { sectionId, subsectionId } = await resolveNode(input.nodeKind, input.nodeId);

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

  // CU31 — newest marked_at vs stored client_marked_at (never server receipt).
  if (input.clientMarkedAt) {
    const [prior] = await db
      .select({
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
        client_marked_at: student_course_progress.client_marked_at,
      })
      .from(student_course_progress)
      .where(existingWhere)
      .limit(1);
    if (
      prior?.client_marked_at &&
      prior.client_marked_at.getTime() > input.clientMarkedAt.getTime()
    ) {
      return {
        id: prior.id,
        student_id: prior.student_id,
        section_id: prior.section_id,
        subsection_id: prior.subsection_id,
        status: prior.status as CourseProgressStatus,
        note: prior.note,
        started_at: prior.started_at,
        completed_at: prior.completed_at,
        certified_at: prior.certified_at,
        revision: prior.revision,
        applied: false,
      };
    }
  }

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

  const set = {
    status: input.status,
    note: input.note ?? null,
    // First transition into progress stamps started_at; not_started clears it (CU11).
    started_at:
      input.status === "not_started"
        ? null
        : sql`coalesce(${student_course_progress.started_at}, now())`,
    // completed stamps completed_at; leaving completed clears it (CU11).
    completed_at: input.status === "completed" ? sql`now()` : null,
    updated_by: input.updatedBy,
    updated_by_role: input.updatedByRole,
    client_op_id: input.clientOpId ?? null,
    client_marked_at: input.clientMarkedAt ?? null,
    updated_at: now,
  };

  const returning = {
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

  // CU12: do not overwrite certified rows unless the correction path opts in.
  const setWhere = input.allowCertifiedWrite
    ? undefined
    : sql`${student_course_progress.certified_at} is null`;

  let rows: Array<{
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
  }>;

  if (subsectionId) {
    rows = await db
      .insert(student_course_progress)
      .values(values)
      .onConflictDoUpdate({
        target: [student_course_progress.student_id, student_course_progress.subsection_id],
        targetWhere: sql`${student_course_progress.subsection_id} is not null`,
        set,
        setWhere,
      })
      .returning(returning);
  } else {
    rows = await db
      .insert(student_course_progress)
      .values(values)
      .onConflictDoUpdate({
        target: [student_course_progress.student_id, student_course_progress.section_id],
        targetWhere: sql`${student_course_progress.section_id} is not null`,
        set,
        setWhere,
      })
      .returning(returning);
  }

  const row = rows[0];
  if (!row) {
    // Conflict hit a certified row (setWhere blocked the update).
    const existing = await db
      .select({
        certified_at: student_course_progress.certified_at,
        status: student_course_progress.status,
      })
      .from(student_course_progress)
      .where(existingWhere)
      .limit(1);
    if (existing[0]?.certified_at) {
      throw new CourseProgressError(
        409,
        Err.COURSE_NODE_CERTIFIED,
        "That node is already certified — only a super_admin correction can change it.",
      );
    }
    throw new CourseProgressError(
      500,
      Err.INTERNAL,
      "Progress write did not apply — try again.",
    );
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
 * Out-of-scope student_ids → 403 whole, nothing applied.
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
      throw new CourseProgressError(
        403,
        Err.COURSE_STUDENT_OUT_OF_SCOPE,
        "One or more students are outside your scope — nothing was applied.",
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

  let applied = 0;
  let skipped = 0;
  const appliedIds: string[] = [];
  const targetRank = STATUS_RANK[input.status];

  for (const s of roster) {
    const [existing] = await db
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

    await upsertCourseProgress({
      studentId: s.id,
      nodeKind: input.nodeKind,
      nodeId: input.nodeId,
      status: input.status,
      note: input.note ?? null,
      updatedBy: input.updatedBy,
      updatedByRole: input.updatedByRole,
    });
    applied += 1;
    appliedIds.push(s.id);
  }

  return { applied, skipped, student_ids: appliedIds };
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
    roster = await db
      .select({
        id: students.id,
        batch_id: students.batch_id,
        centre_id: students.centre_id,
      })
      .from(students)
      .where(and(inArray(students.id, input.studentIds!), isNull(students.deleted_at)));
    if (roster.length !== input.studentIds!.length) {
      throw new CourseProgressError(
        403,
        Err.COURSE_STUDENT_OUT_OF_SCOPE,
        "One or more students are outside your scope — nothing was applied.",
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

  let applied = 0;
  let skipped = 0;
  const audits: AuditInput[] = [];

  for (const s of roster) {
    const [existing] = await db
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

    await upsertCourseProgress({
      studentId: s.id,
      nodeKind: input.nodeKind,
      nodeId: input.nodeId,
      status: input.status,
      note: input.note ?? null,
      updatedBy: input.updatedBy,
      updatedByRole: input.updatedByRole,
    });
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

  await writeAudits(audits);
  return { applied, skipped };
}
