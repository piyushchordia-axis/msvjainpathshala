/**
 * Course create / patch / publish / soft-delete + node soft-delete with CU20 guard.
 */
import {
  db,
  course_sections,
  course_subsections,
  courses,
  student_course_progress,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { ErrorCode, Role } from "@workspace/api-zod";
import { ErrorCode as Err } from "@workspace/api-zod";
import { writeAudit } from "../lib/audit";

export class CourseAdminError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CourseAdminError";
  }
}

/** CU8 / Q2 — MSV or national (city_id null) authoring is super_admin only. */
export function assertMayAuthorCourseKind(opts: {
  role: Role;
  kind: string;
  cityId: string | null | undefined;
}): void {
  const national = opts.cityId == null;
  const msv = opts.kind === "msv";
  if ((national || msv) && opts.role !== "super_admin") {
    throw new CourseAdminError(
      403,
      Err.FORBIDDEN,
      "Only a super_admin may create or edit MSV or national courses.",
    );
  }
}

export type PublishCourseInput = {
  courseId: string;
  actorId: string;
  actorRole: Role;
  ip?: string | null;
};

/**
 * L6 — runs inside a transaction with a `status = 'draft'` guard on the
 * UPDATE itself, not just on the earlier SELECT. Two concurrent publish
 * requests could otherwise both pass the initial SELECT's `status !== 'draft'`
 * check before either commits, and both proceed to award/flip state. The
 * guard on the UPDATE's WHERE clause means only one of them can ever actually
 * flip the row; the other sees zero rows affected and reports the same
 * "already published" error a strictly-sequential second call would get.
 */
export async function publishCourse(input: PublishCourseInput): Promise<{ id: string; status: string }> {
  return db.transaction(async (tx) => {
    const [course] = await tx
      .select()
      .from(courses)
      .where(and(eq(courses.id, input.courseId), isNull(courses.deleted_at)))
      .limit(1);
    if (!course) {
      throw new CourseAdminError(404, Err.NOT_FOUND, "Course not found.");
    }
    if (course.status !== "draft") {
      throw new CourseAdminError(
        409,
        Err.INVALID_STATE,
        course.status === "active"
          ? "That course is already published."
          : "Archived courses cannot be published — create a new draft instead.",
      );
    }

    const reasons: string[] = [];
    if (!course.name_hi?.trim()) reasons.push("name_hi is required");
    if (!course.academic_year?.trim()) reasons.push("academic_year is required");

    const sections = await tx
      .select({ id: course_sections.id, punya_points: course_sections.punya_points })
      .from(course_sections)
      .where(and(eq(course_sections.course_id, course.id), isNull(course_sections.deleted_at)));

    if (sections.length === 0) reasons.push("at least one section is required");
    // CU4 / CU22 — 0 silently disables the main award path; require an explicit non-zero.
    if (sections.some((s) => s.punya_points <= 0)) {
      reasons.push("every section must have punya_points set (> 0)");
    }

    if (reasons.length > 0) {
      const fixes: Record<string, string> = {
        "name_hi is required": "Add a Hindi name in Devanagari, then try again.",
        "academic_year is required": "Set the academic year (for example 2025-26), then try again.",
        "at least one section is required": "Add at least one section, then try again.",
        "every section must have punya_points set (> 0)":
          "Set Punya points greater than 0 on every section, then try again.",
      };
      const detailLines = reasons.map((r) => `${r} — ${fixes[r] ?? "Fix this field, then try again."}`);
      throw new CourseAdminError(
        422,
        Err.COURSE_NOT_PUBLISHABLE,
        `This course cannot be published yet. ${detailLines.join(" ")}`,
        { reasons, fixes: detailLines },
      );
    }

    const [updated] = await tx
      .update(courses)
      .set({ status: "active", updated_at: new Date() })
      .where(and(eq(courses.id, course.id), eq(courses.status, "draft")))
      .returning({ id: courses.id });
    if (!updated) {
      // Lost the race between the SELECT above and this UPDATE.
      throw new CourseAdminError(409, Err.INVALID_STATE, "That course is already published.");
    }

    await writeAudit(
      {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: "update",
        entityKind: "course",
        entityId: course.id,
        summary: `Published course "${course.name_en}".`,
        metadata: { from: "draft", to: "active" },
        ip: input.ip ?? null,
      },
      tx,
    );

    return { id: course.id, status: "active" };
  });
}

export type SoftDeleteNodeInput = {
  nodeKind: "section" | "subsection";
  nodeId: string;
  actorId: string;
  actorRole: Role;
  ip?: string | null;
};

/**
 * CU20 — soft-delete blocked when any certified progress exists.
 *
 * M4 — the certification-exists check now runs INSIDE the same transaction as
 * the delete itself (previously two separate SELECTs ran before a separate
 * `db.transaction`, leaving a window where a certify could land between the
 * check and the delete and get soft-deleted out from under a live
 * certificate). M3 — this function used to also run an UPDATE against
 * `student_course_progress` that touched only `updated_at`, under a comment
 * claiming it "soft-deletes" progress rows; `student_course_progress` has no
 * `deleted_at` column (CU29 gives soft-delete only to `courses`,
 * `course_sections`, `course_subsections` and `course_templates`), so that
 * statement changed nothing meaningful and has been removed. Progress rows
 * for a deleted node are left exactly as they were — CU28's `fn_course_progress`
 * already excludes them by filtering on the PARENT node's `deleted_at`, so
 * nothing needs to happen to the progress row itself for the calculation to
 * be correct.
 */
export async function softDeleteCourseNode(input: SoftDeleteNodeInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    if (input.nodeKind === "section") {
      const [sec] = await tx
        .select({ id: course_sections.id, course_id: course_sections.course_id })
        .from(course_sections)
        .where(and(eq(course_sections.id, input.nodeId), isNull(course_sections.deleted_at)))
        .limit(1);
      if (!sec) throw new CourseAdminError(404, Err.NOT_FOUND, "Section not found.");

      const [certified] = await tx
        .select({ id: student_course_progress.id })
        .from(student_course_progress)
        .where(
          and(
            eq(student_course_progress.section_id, sec.id),
            isNull(student_course_progress.subsection_id),
            sql`${student_course_progress.certified_at} is not null`,
          ),
        )
        .limit(1);
      // Also block if any subsection under this section is certified.
      const [subCert] = await tx
        .select({ id: student_course_progress.id })
        .from(student_course_progress)
        .innerJoin(
          course_subsections,
          eq(course_subsections.id, student_course_progress.subsection_id),
        )
        .where(
          and(
            eq(course_subsections.section_id, sec.id),
            sql`${student_course_progress.certified_at} is not null`,
          ),
        )
        .limit(1);
      if (certified || subCert) {
        throw new CourseAdminError(
          409,
          Err.COURSE_NODE_HAS_CERTIFICATIONS,
          "That section has certifications — archive the course instead of deleting it.",
        );
      }

      const now = new Date();
      await tx
        .update(course_subsections)
        .set({ deleted_at: now, updated_at: now })
        .where(and(eq(course_subsections.section_id, sec.id), isNull(course_subsections.deleted_at)));
      await tx
        .update(course_sections)
        .set({ deleted_at: now, updated_at: now })
        .where(eq(course_sections.id, sec.id));

      await writeAudit(
        {
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: "delete",
          entityKind: "course_section",
          entityId: sec.id,
          summary: "Soft-deleted course section.",
          metadata: { course_id: sec.course_id },
          ip: input.ip ?? null,
        },
        tx,
      );
      return { id: sec.id };
    }

    const [sub] = await tx
      .select({ id: course_subsections.id, section_id: course_subsections.section_id })
      .from(course_subsections)
      .where(and(eq(course_subsections.id, input.nodeId), isNull(course_subsections.deleted_at)))
      .limit(1);
    if (!sub) throw new CourseAdminError(404, Err.NOT_FOUND, "Subsection not found.");

    const [certified] = await tx
      .select({ id: student_course_progress.id })
      .from(student_course_progress)
      .where(
        and(
          eq(student_course_progress.subsection_id, sub.id),
          sql`${student_course_progress.certified_at} is not null`,
        ),
      )
      .limit(1);
    if (certified) {
      throw new CourseAdminError(
        409,
        Err.COURSE_NODE_HAS_CERTIFICATIONS,
        "That subsection has certifications — archive the course instead of deleting it.",
      );
    }

    const now = new Date();
    await tx
      .update(course_subsections)
      .set({ deleted_at: now, updated_at: now })
      .where(eq(course_subsections.id, sub.id));

    await writeAudit(
      {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: "delete",
        entityKind: "course_subsection",
        entityId: sub.id,
        summary: "Soft-deleted course subsection.",
        metadata: { section_id: sub.section_id },
        ip: input.ip ?? null,
      },
      tx,
    );
    return { id: sub.id };
  });
}
