/**
 * CU7 — course templates: super_admin masters; derive is a one-time snapshot.
 */
import {
  db,
  course_sections,
  course_subsections,
  course_template_sections,
  course_template_subsections,
  course_templates,
  courses,
} from "@workspace/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { ErrorCode, Role } from "@workspace/api-zod";
import { ErrorCode as Err } from "@workspace/api-zod";
import { writeAudit } from "../lib/audit";
import { assertMayAuthorCourseKind, CourseAdminError } from "./course-admin";

export class CourseTemplateError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CourseTemplateError";
  }
}

export async function createCourseTemplate(input: {
  name_en: string;
  name_hi?: string | null;
  kind: string;
  age_group?: "bal" | "kishor" | "tarun" | "yuva" | null;
  actorId: string;
  actorRole: Role;
  ip?: string | null;
}): Promise<{ id: string }> {
  if (input.actorRole !== "super_admin") {
    throw new CourseTemplateError(403, Err.FORBIDDEN, "Only a super_admin may author templates.");
  }
  assertMayAuthorCourseKind({ role: input.actorRole, kind: input.kind, cityId: null });

  const [row] = await db
    .insert(course_templates)
    .values({
      name_en: input.name_en,
      name_hi: input.name_hi ?? null,
      kind: input.kind,
      age_group: input.age_group ?? null,
      created_by: input.actorId,
    })
    .returning({ id: course_templates.id });

  await writeAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "create",
    entityKind: "course_template",
    entityId: row.id,
    summary: `Created course template "${input.name_en}".`,
    metadata: { kind: input.kind },
    ip: input.ip ?? null,
  });
  return row;
}

export async function deriveCourseFromTemplate(input: {
  templateId: string;
  cityId?: string | null;
  academicYear?: string | null;
  name_en?: string | null;
  name_hi?: string | null;
  actorId: string;
  actorRole: Role;
  ip?: string | null;
}): Promise<{ id: string }> {
  if (input.actorRole !== "super_admin") {
    throw new CourseTemplateError(403, Err.FORBIDDEN, "Only a super_admin may derive courses.");
  }

  const [tpl] = await db
    .select()
    .from(course_templates)
    .where(and(eq(course_templates.id, input.templateId), isNull(course_templates.deleted_at)))
    .limit(1);
  if (!tpl) throw new CourseTemplateError(404, Err.NOT_FOUND, "Template not found.");

  assertMayAuthorCourseKind({
    role: input.actorRole,
    kind: tpl.kind,
    cityId: input.cityId ?? null,
  });

  const courseId = await db.transaction(async (tx) => {
    const [course] = await tx
      .insert(courses)
      .values({
        name_en: input.name_en?.trim() || tpl.name_en,
        name_hi: input.name_hi ?? tpl.name_hi,
        kind: tpl.kind,
        city_id: input.cityId ?? null,
        academic_year: input.academicYear ?? null,
        status: "draft",
        template_id: tpl.id,
        punya_points: 0,
      })
      .returning({ id: courses.id });

    const sections = await tx
      .select()
      .from(course_template_sections)
      .where(
        and(
          eq(course_template_sections.template_id, tpl.id),
          isNull(course_template_sections.deleted_at),
        ),
      )
      .orderBy(asc(course_template_sections.order_index));

    for (const sec of sections) {
      const [newSec] = await tx
        .insert(course_sections)
        .values({
          course_id: course.id,
          title_en: sec.title_en,
          title_hi: sec.title_hi,
          order_index: sec.order_index,
          punya_points: sec.punya_points,
        })
        .returning({ id: course_sections.id });

      const subs = await tx
        .select()
        .from(course_template_subsections)
        .where(
          and(
            eq(course_template_subsections.section_id, sec.id),
            isNull(course_template_subsections.deleted_at),
          ),
        )
        .orderBy(asc(course_template_subsections.order_index));

      if (subs.length) {
        await tx.insert(course_subsections).values(
          subs.map((sub) => ({
            section_id: newSec.id,
            title_en: sub.title_en,
            title_hi: sub.title_hi,
            description_en: sub.description_en,
            description_hi: sub.description_hi,
            order_index: sub.order_index,
          })),
        );
      }
    }

    return course.id;
  });

  await writeAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "create",
    entityKind: "course",
    entityId: courseId,
    summary: `Derived course from template "${tpl.name_en}".`,
    metadata: { template_id: tpl.id },
    ip: input.ip ?? null,
  });

  return { id: courseId };
}

// Re-export for callers that catch CourseAdminError from assertMayAuthorCourseKind
export { CourseAdminError };
