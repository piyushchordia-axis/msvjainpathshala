/**
 * Course progress writes — CU9–CU12, CU15.
 * Single implementation for the online route and (later) offline sync/batch.
 * Never a parallel offline-only path.
 */
import { db, course_sections, course_subsections, student_course_progress } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { ErrorCode } from "@workspace/api-zod";
import { ErrorCode as Err } from "@workspace/api-zod";

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
 */
export async function upsertCourseProgress(
  input: UpsertCourseProgressInput,
): Promise<UpsertCourseProgressResult> {
  assertLiveStatus(input.status);
  const { sectionId, subsectionId } = await resolveNode(input.nodeKind, input.nodeId);

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
      .where(
        subsectionId
          ? and(
              eq(student_course_progress.student_id, input.studentId),
              eq(student_course_progress.subsection_id, subsectionId),
            )
          : and(
              eq(student_course_progress.student_id, input.studentId),
              eq(student_course_progress.section_id, sectionId!),
              isNull(student_course_progress.subsection_id),
            ),
      )
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
  };
}
