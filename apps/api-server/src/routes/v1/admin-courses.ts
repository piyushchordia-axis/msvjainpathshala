/**
 * /v1/admin/courses + /v1/admin/course-templates — CU4–CU8 catalogue authoring.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  cities,
  course_sections,
  course_subsections,
  course_template_sections,
  course_template_subsections,
  course_templates,
  courses,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Role } from "@workspace/api-zod";
import { ErrorCode as Err } from "@workspace/api-zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel, requireRole } from "../../middlewares/auth";
import { requireMinRole } from "../../lib/roles";
import { cityIdsForUser } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import {
  assertMayAuthorCourseKind,
  CourseAdminError,
  publishCourse,
} from "../../services/course-admin";
import {
  createCourseTemplate,
  deriveCourseFromTemplate,
  CourseTemplateError,
} from "../../services/course-templates";

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function handleServiceError(res: Response, err: unknown): boolean {
  if (
    err instanceof CourseAdminError ||
    err instanceof CourseTemplateError
  ) {
    fail(res, err.httpStatus, err.code, err.message, "details" in err ? (err as CourseAdminError).details : undefined);
    return true;
  }
  return false;
}

/* ═══════════════ Templates (super_admin) ═══════════════ */

const templateBody = z.object({
  name_en: z.string().min(1).max(300),
  name_hi: z.string().max(300).nullable().optional(),
  kind: z.enum(["standard", "msv"]).default("standard"),
  age_group: z.enum(["bal", "kishor", "tarun", "yuva"]).nullable().optional(),
});

router.post(
  "/course-templates",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    let body: z.infer<typeof templateBody>;
    try {
      body = templateBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid template data.");
      return;
    }
    try {
      const row = await createCourseTemplate({
        ...body,
        actorId: req.authUser!.id,
        actorRole: req.authUser!.role as Role,
        ip: req.ip ?? null,
      });
      ok(res, row);
    } catch (err) {
      if (!handleServiceError(res, err)) throw err;
    }
  },
);

router.get("/course-templates", requireRole("super_admin"), async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: course_templates.id,
      name_en: course_templates.name_en,
      name_hi: course_templates.name_hi,
      kind: course_templates.kind,
      age_group: course_templates.age_group,
    })
    .from(course_templates)
    .where(isNull(course_templates.deleted_at))
    .orderBy(desc(course_templates.created_at));
  ok(res, { items: rows }, { count: rows.length });
});

const patchTemplateBody = templateBody.partial();

router.patch(
  "/course-templates/:id",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Template not found.");
      return;
    }
    let body: z.infer<typeof patchTemplateBody>;
    try {
      body = patchTemplateBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid template data.");
      return;
    }
    if (body.kind) {
      try {
        assertMayAuthorCourseKind({
          role: req.authUser!.role as Role,
          kind: body.kind,
          cityId: null,
        });
      } catch (err) {
        if (!handleServiceError(res, err)) throw err;
        return;
      }
    }
    const [row] = await db
      .update(course_templates)
      .set({
        ...(body.name_en !== undefined ? { name_en: body.name_en } : {}),
        ...(body.name_hi !== undefined ? { name_hi: body.name_hi } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.age_group !== undefined ? { age_group: body.age_group } : {}),
        updated_at: new Date(),
      })
      .where(and(eq(course_templates.id, id), isNull(course_templates.deleted_at)))
      .returning({ id: course_templates.id });
    if (!row) {
      fail(res, 404, "ERR_NOT_FOUND", "Template not found.");
      return;
    }
    await auditFromReq(req, {
      action: "update",
      entityKind: "course_template",
      entityId: row.id,
      summary: "Updated course template.",
    });
    ok(res, row);
  },
);

router.delete(
  "/course-templates/:id",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const now = new Date();
    const [row] = await db
      .update(course_templates)
      .set({ deleted_at: now, updated_at: now })
      .where(and(eq(course_templates.id, id), isNull(course_templates.deleted_at)))
      .returning({ id: course_templates.id });
    if (!row) {
      fail(res, 404, "ERR_NOT_FOUND", "Template not found.");
      return;
    }
    await auditFromReq(req, {
      action: "delete",
      entityKind: "course_template",
      entityId: row.id,
      summary: "Soft-deleted course template.",
    });
    ok(res, { id: row.id, deleted: true });
  },
);

const deriveBody = z.object({
  city_id: z.string().uuid().nullable().optional(),
  academic_year: z.string().max(20).nullable().optional(),
  name_en: z.string().min(1).max(300).optional(),
  name_hi: z.string().max(300).nullable().optional(),
});

router.post(
  "/course-templates/:id/derive",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    let body: z.infer<typeof deriveBody>;
    try {
      body = deriveBody.parse(req.body ?? {});
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid derive payload.");
      return;
    }
    try {
      const row = await deriveCourseFromTemplate({
        templateId: String(req.params.id),
        cityId: body.city_id ?? null,
        academicYear: body.academic_year ?? null,
        name_en: body.name_en ?? null,
        name_hi: body.name_hi ?? null,
        actorId: req.authUser!.id,
        actorRole: req.authUser!.role as Role,
        ip: req.ip ?? null,
      });
      ok(res, row);
    } catch (err) {
      if (!handleServiceError(res, err)) throw err;
    }
  },
);

/* ═══════════════ Courses ═══════════════ */

const createCourseBody = z.object({
  name_en: z.string().min(1).max(300),
  name_hi: z.string().max(300).nullable().optional(),
  kind: z.enum(["standard", "msv"]).default("standard"),
  academic_year: z.string().max(20).nullable().optional(),
  city_id: z.string().uuid().nullable().optional(),
  punya_points: z.number().int().min(0).max(2000).optional(),
});

router.post(
  "/courses",
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    let body: z.infer<typeof createCourseBody>;
    try {
      body = createCourseBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid course data.");
      return;
    }
    const role = req.authUser!.role as Role;
    try {
      assertMayAuthorCourseKind({
        role,
        kind: body.kind,
        cityId: body.city_id ?? null,
      });
    } catch (err) {
      if (!handleServiceError(res, err)) throw err;
      return;
    }
    const cityIds = await cityIdsForUser(req.authUser!);
    if (cityIds !== null) {
      if (!body.city_id || !cityIds.includes(body.city_id)) {
        fail(res, 403, "ERR_FORBIDDEN", "City not in your scope.");
        return;
      }
    }
    const [row] = await db
      .insert(courses)
      .values({
        name_en: body.name_en,
        name_hi: body.name_hi ?? null,
        kind: body.kind,
        academic_year: body.academic_year ?? null,
        city_id: body.city_id ?? null,
        status: "draft",
        punya_points: body.punya_points ?? 0,
      })
      .returning({ id: courses.id, name_en: courses.name_en, status: courses.status });
    await auditFromReq(req, {
      action: "create",
      entityKind: "course",
      entityId: row.id,
      summary: `Created course "${row.name_en}".`,
      metadata: { kind: body.kind, city_id: body.city_id ?? null },
    });
    ok(res, row);
  },
);

const patchCourseBody = z.object({
  name_en: z.string().min(1).max(300).optional(),
  name_hi: z.string().max(300).nullable().optional(),
  kind: z.enum(["standard", "msv"]).optional(),
  academic_year: z.string().max(20).nullable().optional(),
  city_id: z.string().uuid().nullable().optional(),
  punya_points: z.number().int().min(0).max(2000).optional(),
  status: z.enum(["archived"]).optional(),
});

router.patch(
  "/courses/:id",
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
      return;
    }
    let body: z.infer<typeof patchCourseBody>;
    try {
      body = patchCourseBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid course data.");
      return;
    }
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, id), isNull(courses.deleted_at)))
      .limit(1);
    if (!course) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
      return;
    }
    const role = req.authUser!.role as Role;
    const nextKind = body.kind ?? course.kind;
    const nextCity = body.city_id !== undefined ? body.city_id : course.city_id;
    try {
      assertMayAuthorCourseKind({ role, kind: nextKind, cityId: nextCity });
      assertMayAuthorCourseKind({ role, kind: course.kind, cityId: course.city_id });
    } catch (err) {
      if (!handleServiceError(res, err)) throw err;
      return;
    }
    const cityIds = await cityIdsForUser(req.authUser!);
    if (cityIds !== null && course.city_id && !cityIds.includes(course.city_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found in your scope.");
      return;
    }
    // H4 — validate the DESTINATION city too. The OLD-city check above only
    // stops a city_admin from touching a course they can't already see; on
    // its own it lets that same PATCH move the course INTO a city its real
    // city_admin cannot see or administer.
    if (cityIds !== null && nextCity && !cityIds.includes(nextCity)) {
      fail(res, 403, "ERR_FORBIDDEN", "City not in your scope.");
      return;
    }
    // L2 — a draft can be archived directly (the only exit used to be the
    // unguarded DELETE). CU4 only forbids the REVERSE move, active -> draft;
    // it never required a course to be published before it can be archived.
    if (body.status === "archived" && course.status === "archived") {
      fail(res, 409, "ERR_INVALID_STATE", "That course is already archived.");
      return;
    }
    // M19 — re-run the CU4 publish gate's name_hi/academic_year half on every
    // PATCH that leaves the course active: without this, a PATCH can null
    // either field on a LIVE course, and CU4 only ever checked them once, at
    // the draft→active transition.
    const resultStatus = body.status === "archived" ? "archived" : course.status;
    if (resultStatus === "active") {
      const nextNameHi = body.name_hi !== undefined ? body.name_hi : course.name_hi;
      const nextAcademicYear =
        body.academic_year !== undefined ? body.academic_year : course.academic_year;
      if (!nextNameHi?.trim() || !nextAcademicYear?.trim()) {
        fail(
          res,
          422,
          "ERR_COURSE_NOT_PUBLISHABLE",
          "An active course must keep a Hindi name and an academic year — set both, or archive the course first.",
        );
        return;
      }
    }
    // CU4 — active may not return to draft.
    const [row] = await db
      .update(courses)
      .set({
        ...(body.name_en !== undefined ? { name_en: body.name_en } : {}),
        ...(body.name_hi !== undefined ? { name_hi: body.name_hi } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.academic_year !== undefined ? { academic_year: body.academic_year } : {}),
        ...(body.city_id !== undefined ? { city_id: body.city_id } : {}),
        ...(body.punya_points !== undefined ? { punya_points: body.punya_points } : {}),
        ...(body.status === "archived" ? { status: "archived" as const } : {}),
        updated_at: new Date(),
      })
      .where(eq(courses.id, id))
      .returning({ id: courses.id, status: courses.status });

    await auditFromReq(req, {
      action: "update",
      entityKind: "course",
      entityId: id,
      summary: body.punya_points !== undefined
        ? "Updated course (including punya_points)."
        : "Updated course.",
      metadata: body as Record<string, unknown>,
    });
    ok(res, row);
  },
);

/**
 * H10 — CU20 extends to the parent course: a course with any certified
 * section (or subsection) cannot be deleted, only archived, same reasoning as
 * node delete — deleting the parent of a certified section is the larger
 * version of the act CU20 blocks at the node. The certification check and the
 * delete run in the SAME transaction (the M4 pattern) so a certify landing
 * mid-check can't slip a certified course out from under it. The response
 * carries an impact count — how many students had uncertified, in-progress or
 * completed work on this course — so the caller isn't guessing what just
 * disappeared from their view.
 */
router.delete(
  "/courses/:id",
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
      return;
    }
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, id), isNull(courses.deleted_at)))
      .limit(1);
    if (!course) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
      return;
    }
    try {
      assertMayAuthorCourseKind({
        role: req.authUser!.role as Role,
        kind: course.kind,
        cityId: course.city_id,
      });
    } catch (err) {
      if (!handleServiceError(res, err)) throw err;
      return;
    }
    const cityIds = await cityIdsForUser(req.authUser!);
    if (cityIds !== null && course.city_id && !cityIds.includes(course.city_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found in your scope.");
      return;
    }

    try {
      const impactCount = await db.transaction(async (tx) => {
        const certifiedCheck = await tx.execute(sql`
          select exists (
            select 1
              from student_course_progress p
             where p.certified_at is not null
               and (
                 (
                   p.section_id in (
                     select id from course_sections
                      where course_id = ${id}::uuid and deleted_at is null
                   )
                   and p.subsection_id is null
                 )
                 or p.subsection_id in (
                   select ss.id
                     from course_subsections ss
                     join course_sections s on s.id = ss.section_id
                    where s.course_id = ${id}::uuid
                      and ss.deleted_at is null
                      and s.deleted_at is null
                 )
               )
          ) as has_certified
        `);
        const hasCertified = Boolean(
          (certifiedCheck as unknown as { rows?: Array<{ has_certified: boolean }> }).rows?.[0]
            ?.has_certified,
        );
        if (hasCertified) {
          throw new CourseAdminError(
            409,
            Err.COURSE_NODE_HAS_CERTIFICATIONS,
            "That course has certified sections — archive it instead of deleting it.",
          );
        }

        const impactResult = await tx.execute(sql`
          select count(distinct p.student_id)::int as count
            from student_course_progress p
           where p.certified_at is null
             and p.status <> 'not_started'
             and (
               (
                 p.section_id in (
                   select id from course_sections
                    where course_id = ${id}::uuid and deleted_at is null
                 )
                 and p.subsection_id is null
               )
               or p.subsection_id in (
                 select ss.id
                   from course_subsections ss
                   join course_sections s on s.id = ss.section_id
                  where s.course_id = ${id}::uuid
                    and ss.deleted_at is null
                    and s.deleted_at is null
               )
             )
        `);
        const count = Number(
          (impactResult as unknown as { rows?: Array<{ count: number | string }> }).rows?.[0]
            ?.count ?? 0,
        );

        const now = new Date();
        await tx
          .update(courses)
          .set({ deleted_at: now, updated_at: now })
          .where(eq(courses.id, id));

        return Number.isFinite(count) ? count : 0;
      });

      await auditFromReq(req, {
        action: "delete",
        entityKind: "course",
        entityId: id,
        summary: `Soft-deleted course "${course.name_en}".`,
        metadata: { in_progress_uncertified_students: impactCount },
      });
      ok(res, { id, deleted: true, impact: { in_progress_uncertified_students: impactCount } });
    } catch (err) {
      if (!handleServiceError(res, err)) throw err;
    }
  },
);

/** H10 / CU29 — admin-only, audited undelete: clears deleted_at. */
router.post(
  "/courses/:id/undelete",
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
      return;
    }
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, id), sql`${courses.deleted_at} is not null`))
      .limit(1);
    if (!course) {
      fail(res, 404, "ERR_NOT_FOUND", "Deleted course not found.");
      return;
    }
    try {
      assertMayAuthorCourseKind({
        role: req.authUser!.role as Role,
        kind: course.kind,
        cityId: course.city_id,
      });
    } catch (err) {
      if (!handleServiceError(res, err)) throw err;
      return;
    }
    const cityIds = await cityIdsForUser(req.authUser!);
    if (cityIds !== null && course.city_id && !cityIds.includes(course.city_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found in your scope.");
      return;
    }
    const [row] = await db
      .update(courses)
      .set({ deleted_at: null, updated_at: new Date() })
      .where(eq(courses.id, id))
      .returning({ id: courses.id, status: courses.status });
    await auditFromReq(req, {
      action: "update",
      entityKind: "course",
      entityId: id,
      summary: `Restored soft-deleted course "${course.name_en}".`,
    });
    ok(res, row);
  },
);

router.post(
  "/courses/:id/publish",
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, id), isNull(courses.deleted_at)))
      .limit(1);
    if (!course) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
      return;
    }
    try {
      assertMayAuthorCourseKind({
        role: req.authUser!.role as Role,
        kind: course.kind,
        cityId: course.city_id,
      });
    } catch (err) {
      if (!handleServiceError(res, err)) throw err;
      return;
    }
    const cityIds = await cityIdsForUser(req.authUser!);
    if (cityIds !== null && course.city_id && !cityIds.includes(course.city_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found in your scope.");
      return;
    }
    try {
      const row = await publishCourse({
        courseId: id,
        actorId: req.authUser!.id,
        actorRole: req.authUser!.role as Role,
        ip: req.ip ?? null,
      });
      ok(res, row);
    } catch (err) {
      if (!handleServiceError(res, err)) throw err;
    }
  },
);

router.get("/courses", requireMinRole("shikshak"), async (req: Request, res: Response) => {
  const cityIds = await cityIdsForUser(req.authUser!);
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await db
    .select({
      id: courses.id,
      name_en: courses.name_en,
      name_hi: courses.name_hi,
      kind: courses.kind,
      academic_year: courses.academic_year,
      status: courses.status,
      punya_points: courses.punya_points,
      city_id: courses.city_id,
      city_name: cities.name,
      template_id: courses.template_id,
      section_count: sql<number>`(
        select count(*)::int from ${course_sections}
        where ${course_sections.course_id} = ${courses.id}
          and ${course_sections.deleted_at} is null
      )`,
    })
    .from(courses)
    .leftJoin(cities, eq(cities.id, courses.city_id))
    .where(
      and(
        isNull(courses.deleted_at),
        kind ? eq(courses.kind, kind) : undefined,
        status ? eq(courses.status, status as "draft" | "active" | "archived") : undefined,
        cityIds === null
          ? undefined
          : cityIds.length === 0
            ? sql`false`
            : or(isNull(courses.city_id), inArray(courses.city_id, cityIds)),
      ),
    )
    .orderBy(desc(courses.created_at));
  ok(res, { items: rows }, { count: rows.length });
});

/**
 * CU4 / CU33 — archive confirm needs the count of students with in-progress,
 * uncertified work on this course (mid-course archive is the failure mode).
 */
router.get(
  "/courses/:id/archive-impact",
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
      return;
    }
    const cityIds = await cityIdsForUser(req.authUser!);
    const [course] = await db
      .select({ id: courses.id, city_id: courses.city_id, status: courses.status })
      .from(courses)
      .where(and(eq(courses.id, id), isNull(courses.deleted_at)))
      .limit(1);
    if (!course) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
      return;
    }
    if (cityIds !== null && course.city_id && !cityIds.includes(course.city_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Course not found in your scope.");
      return;
    }

    const result = await db.execute(sql`
      select count(distinct p.student_id)::int as count
        from student_course_progress p
       where p.status = 'in_progress'
         and p.certified_at is null
         and (
           (p.section_id in (
              select id from course_sections
               where course_id = ${id}::uuid and deleted_at is null
            ) and p.subsection_id is null)
           or p.subsection_id in (
              select ss.id
                from course_subsections ss
                join course_sections s on s.id = ss.section_id
               where s.course_id = ${id}::uuid
                 and ss.deleted_at is null
                 and s.deleted_at is null
            )
         )
    `);
    const rows = (result as unknown as { rows?: Array<{ count: number | string }> }).rows ?? [];
    const count = Number(rows[0]?.count ?? 0);
    ok(res, {
      course_id: id,
      status: course.status,
      in_progress_uncertified_students: Number.isFinite(count) ? count : 0,
    });
  },
);

router.get("/courses/:id/tree", requireMinRole("shikshak"), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
    return;
  }
  const cityIds = await cityIdsForUser(req.authUser!);
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, id), isNull(courses.deleted_at)))
    .limit(1);
  if (!course) {
    fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
    return;
  }
  if (cityIds !== null && course.city_id && !cityIds.includes(course.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Course not found in your scope.");
    return;
  }
  const sections = await db
    .select()
    .from(course_sections)
    .where(and(eq(course_sections.course_id, id), isNull(course_sections.deleted_at)))
    .orderBy(asc(course_sections.order_index));
  const items = await db
    .select()
    .from(course_subsections)
    .innerJoin(course_sections, eq(course_sections.id, course_subsections.section_id))
    .where(and(eq(course_sections.course_id, id), isNull(course_subsections.deleted_at)))
    .orderBy(asc(course_subsections.order_index));

  ok(res, {
    course: {
      id: course.id,
      name_en: course.name_en,
      name_hi: course.name_hi,
      kind: course.kind,
      academic_year: course.academic_year,
      status: course.status,
      punya_points: course.punya_points,
      city_id: course.city_id,
      template_id: course.template_id,
    },
    sections: sections.map((s) => ({
      id: s.id,
      title_en: s.title_en,
      title_hi: s.title_hi,
      order_index: s.order_index,
      punya_points: s.punya_points,
      subsections: items
        .filter((row) => row.course_subsections.section_id === s.id)
        .map((row) => ({
          id: row.course_subsections.id,
          title_en: row.course_subsections.title_en,
          title_hi: row.course_subsections.title_hi,
          description_en: row.course_subsections.description_en,
          description_hi: row.course_subsections.description_hi,
          order_index: row.course_subsections.order_index,
        })),
    })),
  });
});

/* ═══════════════ Template tree authoring (super_admin, CU7) ═══════════════ */

router.get(
  "/course-templates/:id/tree",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Template not found.");
      return;
    }
    const [tpl] = await db
      .select()
      .from(course_templates)
      .where(and(eq(course_templates.id, id), isNull(course_templates.deleted_at)))
      .limit(1);
    if (!tpl) {
      fail(res, 404, "ERR_NOT_FOUND", "Template not found.");
      return;
    }
    const sections = await db
      .select()
      .from(course_template_sections)
      .where(
        and(eq(course_template_sections.template_id, id), isNull(course_template_sections.deleted_at)),
      )
      .orderBy(asc(course_template_sections.order_index));
    const subs = await db
      .select()
      .from(course_template_subsections)
      .innerJoin(
        course_template_sections,
        eq(course_template_sections.id, course_template_subsections.section_id),
      )
      .where(
        and(
          eq(course_template_sections.template_id, id),
          isNull(course_template_subsections.deleted_at),
        ),
      )
      .orderBy(asc(course_template_subsections.order_index));

    ok(res, {
      template: {
        id: tpl.id,
        name_en: tpl.name_en,
        name_hi: tpl.name_hi,
        kind: tpl.kind,
        age_group: tpl.age_group,
      },
      sections: sections.map((s) => ({
        id: s.id,
        title_en: s.title_en,
        title_hi: s.title_hi,
        order_index: s.order_index,
        punya_points: s.punya_points,
        subsections: subs
          .filter((row) => row.course_template_subsections.section_id === s.id)
          .map((row) => ({
            id: row.course_template_subsections.id,
            title_en: row.course_template_subsections.title_en,
            title_hi: row.course_template_subsections.title_hi,
            order_index: row.course_template_subsections.order_index,
          })),
      })),
    });
  },
);

const templateSectionBody = z.object({
  title_en: z.string().min(1).max(300),
  title_hi: z.string().min(1).max(300),
  punya_points: z.number().int().min(0).max(1000),
});

router.post(
  "/course-templates/:id/sections",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    let body: z.infer<typeof templateSectionBody>;
    try {
      body = templateSectionBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid section data.");
      return;
    }
    const [tpl] = await db
      .select({ id: course_templates.id })
      .from(course_templates)
      .where(and(eq(course_templates.id, id), isNull(course_templates.deleted_at)))
      .limit(1);
    if (!tpl) {
      fail(res, 404, "ERR_NOT_FOUND", "Template not found.");
      return;
    }
    const [{ max }] = await db
      .select({
        max: sql<number>`coalesce(max(${course_template_sections.order_index}), -1)::int`,
      })
      .from(course_template_sections)
      .where(
        and(
          eq(course_template_sections.template_id, id),
          isNull(course_template_sections.deleted_at),
        ),
      );
    const [row] = await db
      .insert(course_template_sections)
      .values({
        template_id: id,
        title_en: body.title_en,
        title_hi: body.title_hi,
        punya_points: body.punya_points,
        order_index: max + 1,
      })
      .returning({ id: course_template_sections.id });
    await auditFromReq(req, {
      action: "create",
      entityKind: "course_template_section",
      entityId: row.id,
      summary: "Added section to course template.",
      metadata: { template_id: id },
    });
    ok(res, row);
  },
);

router.patch(
  "/course-template-sections/:id",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    let body: Partial<z.infer<typeof templateSectionBody>>;
    try {
      body = templateSectionBody.partial().parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid section data.");
      return;
    }
    const [row] = await db
      .update(course_template_sections)
      .set({
        ...(body.title_en !== undefined ? { title_en: body.title_en } : {}),
        ...(body.title_hi !== undefined ? { title_hi: body.title_hi } : {}),
        ...(body.punya_points !== undefined ? { punya_points: body.punya_points } : {}),
        updated_at: new Date(),
      })
      .where(and(eq(course_template_sections.id, id), isNull(course_template_sections.deleted_at)))
      .returning({ id: course_template_sections.id });
    if (!row) {
      fail(res, 404, "ERR_NOT_FOUND", "Template section not found.");
      return;
    }
    await auditFromReq(req, {
      action: "update",
      entityKind: "course_template_section",
      entityId: row.id,
      summary: "Updated course template section.",
    });
    ok(res, row);
  },
);

router.delete(
  "/course-template-sections/:id",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const [sec] = await db
      .select({ id: course_template_sections.id })
      .from(course_template_sections)
      .where(and(eq(course_template_sections.id, id), isNull(course_template_sections.deleted_at)))
      .limit(1);
    if (!sec) {
      fail(res, 404, "ERR_NOT_FOUND", "Template section not found.");
      return;
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(course_template_subsections)
        .set({ deleted_at: now, updated_at: now })
        .where(
          and(
            eq(course_template_subsections.section_id, id),
            isNull(course_template_subsections.deleted_at),
          ),
        );
      await tx
        .update(course_template_sections)
        .set({ deleted_at: now, updated_at: now })
        .where(eq(course_template_sections.id, id));
    });
    await auditFromReq(req, {
      action: "delete",
      entityKind: "course_template_section",
      entityId: id,
      summary: "Soft-deleted course template section.",
    });
    ok(res, { id, deleted: true });
  },
);

const templateSubsectionBody = z.object({
  title_en: z.string().min(1).max(300),
  title_hi: z.string().min(1).max(300),
});

router.post(
  "/course-template-sections/:id/subsections",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const sectionId = String(req.params.id);
    let body: z.infer<typeof templateSubsectionBody>;
    try {
      body = templateSubsectionBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid subsection data.");
      return;
    }
    const [sec] = await db
      .select({ id: course_template_sections.id })
      .from(course_template_sections)
      .where(
        and(eq(course_template_sections.id, sectionId), isNull(course_template_sections.deleted_at)),
      )
      .limit(1);
    if (!sec) {
      fail(res, 404, "ERR_NOT_FOUND", "Template section not found.");
      return;
    }
    const [{ max }] = await db
      .select({
        max: sql<number>`coalesce(max(${course_template_subsections.order_index}), -1)::int`,
      })
      .from(course_template_subsections)
      .where(
        and(
          eq(course_template_subsections.section_id, sectionId),
          isNull(course_template_subsections.deleted_at),
        ),
      );
    const [row] = await db
      .insert(course_template_subsections)
      .values({
        section_id: sectionId,
        title_en: body.title_en,
        title_hi: body.title_hi,
        order_index: max + 1,
      })
      .returning({ id: course_template_subsections.id });
    await auditFromReq(req, {
      action: "create",
      entityKind: "course_template_subsection",
      entityId: row.id,
      summary: "Added subsection to course template.",
      metadata: { section_id: sectionId },
    });
    ok(res, row);
  },
);

router.patch(
  "/course-template-subsections/:id",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    let body: Partial<z.infer<typeof templateSubsectionBody>>;
    try {
      body = templateSubsectionBody.partial().parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid subsection data.");
      return;
    }
    const [row] = await db
      .update(course_template_subsections)
      .set({
        ...(body.title_en !== undefined ? { title_en: body.title_en } : {}),
        ...(body.title_hi !== undefined ? { title_hi: body.title_hi } : {}),
        updated_at: new Date(),
      })
      .where(
        and(eq(course_template_subsections.id, id), isNull(course_template_subsections.deleted_at)),
      )
      .returning({ id: course_template_subsections.id });
    if (!row) {
      fail(res, 404, "ERR_NOT_FOUND", "Template subsection not found.");
      return;
    }
    await auditFromReq(req, {
      action: "update",
      entityKind: "course_template_subsection",
      entityId: row.id,
      summary: "Updated course template subsection.",
    });
    ok(res, row);
  },
);

router.delete(
  "/course-template-subsections/:id",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const now = new Date();
    const [row] = await db
      .update(course_template_subsections)
      .set({ deleted_at: now, updated_at: now })
      .where(
        and(eq(course_template_subsections.id, id), isNull(course_template_subsections.deleted_at)),
      )
      .returning({ id: course_template_subsections.id });
    if (!row) {
      fail(res, 404, "ERR_NOT_FOUND", "Template subsection not found.");
      return;
    }
    await auditFromReq(req, {
      action: "delete",
      entityKind: "course_template_subsection",
      entityId: row.id,
      summary: "Soft-deleted course template subsection.",
    });
    ok(res, { id: row.id, deleted: true });
  },
);

export default router;
