/**
 * /v1/courses — catalogue read, section authoring, progress, certify (CU3–CU23).
 * Certificate download/verify routes are Step 4.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  centres,
  cities,
  course_sections,
  course_subsections,
  courses,
  student_course_progress,
  students,
  users,
  type User,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Role } from "@workspace/api-zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { requireMinRole, hasMinRole } from "../../lib/roles";
import { resolveAdminScope, inBatchWriteScope, inCentreScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import {
  courseVisibleToStudentSql,
  loadActiveStudent,
  studentCityId,
  studentViewAgeRefusal,
} from "../../lib/course-visibility";
import { getCourseProgress } from "../../lib/course-progress";
import {
  COURSE_PROGRESS_STATUSES,
  CourseProgressError,
  bulkUpsertCourseProgress,
  resetCourseProgress,
  upsertCourseProgress,
} from "../../services/course-progress";
import {
  CourseAdminError,
  assertMayAuthorCourseKind,
  softDeleteCourseNode,
} from "../../services/course-admin";
import {
  CourseCertifyError,
  certifyCourseNode,
  correctCourseCertification,
} from "../../services/course-certify";
import { enqueueCertificatePdf } from "../../services/course-certificates";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function handleErr(res: Response, err: unknown): boolean {
  if (
    err instanceof CourseProgressError ||
    err instanceof CourseAdminError ||
    err instanceof CourseCertifyError
  ) {
    fail(res, err.httpStatus, err.code, err.message);
    return true;
  }
  return false;
}

async function cityIdsForAuthor(user: User): Promise<string[] | null> {
  if (user.role === "super_admin") return null;
  if (user.role === "city_admin") return user.city_id ? [user.city_id] : [];
  if (user.role === "state_admin") {
    if (!user.state_id) return [];
    const rows = await db.select({ id: cities.id }).from(cities).where(eq(cities.state_id, user.state_id));
    return rows.map((r) => r.id);
  }
  return [];
}

async function loadAuthorableCourse(
  req: Request,
  res: Response,
  courseId: string,
): Promise<{ id: string; city_id: string | null; kind: string } | null> {
  if (!UUID_RE.test(courseId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
    return null;
  }
  const [course] = await db
    .select({
      id: courses.id,
      city_id: courses.city_id,
      kind: courses.kind,
    })
    .from(courses)
    .where(and(eq(courses.id, courseId), isNull(courses.deleted_at)))
    .limit(1);
  if (!course) {
    fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
    return null;
  }
  try {
    assertMayAuthorCourseKind({
      role: req.authUser!.role as Role,
      kind: course.kind,
      cityId: course.city_id,
    });
  } catch (err) {
    if (err instanceof CourseAdminError) {
      fail(res, err.httpStatus, err.code, err.message);
      return null;
    }
    throw err;
  }
  if (!course.city_id) return course;
  const cityIds = await cityIdsForAuthor(req.authUser!);
  if (cityIds !== null && !cityIds.includes(course.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Course not found in your scope.");
    return null;
  }
  return course;
}

async function resolveNodeKind(nodeId: string): Promise<{
  kind: "section" | "subsection";
  courseId: string;
} | null> {
  const [sub] = await db
    .select({
      id: course_subsections.id,
      course_id: course_sections.course_id,
    })
    .from(course_subsections)
    .innerJoin(course_sections, eq(course_sections.id, course_subsections.section_id))
    .where(and(eq(course_subsections.id, nodeId), isNull(course_subsections.deleted_at)))
    .limit(1);
  if (sub) return { kind: "subsection", courseId: sub.course_id };
  const [sec] = await db
    .select({ id: course_sections.id, course_id: course_sections.course_id })
    .from(course_sections)
    .where(and(eq(course_sections.id, nodeId), isNull(course_sections.deleted_at)))
    .limit(1);
  if (sec) return { kind: "section", courseId: sec.course_id };
  return null;
}

/**
 * Who may write progress for this student (single-student route).
 * Parent: own child. Student: self, and old enough per Q4 (MIN_STUDENT_VIEW_AGE).
 * Shikshak+: inBatchWriteScope.
 */
async function assertProgressWriteAccess(
  req: Request,
  studentId: string,
): Promise<{ ok: true } | { ok: false; status: number; code: "ERR_COURSE_STUDENT_OUT_OF_SCOPE" | "ERR_FORBIDDEN"; message: string }> {
  const user = req.authUser!;
  const stu = await loadActiveStudent(studentId);
  if (!stu || stu.status !== "active") {
    return {
      ok: false,
      status: 403,
      code: "ERR_COURSE_STUDENT_OUT_OF_SCOPE",
      message: "That student is outside your scope.",
    };
  }

  if (user.role === "parent") {
    if (stu.parent_id !== user.id) {
      return {
        ok: false,
        status: 403,
        code: "ERR_COURSE_STUDENT_OUT_OF_SCOPE",
        message: "That student is not your child — you cannot update their progress.",
      };
    }
    return { ok: true };
  }

  if (user.role === "student") {
    if (stu.user_id !== user.id) {
      return {
        ok: false,
        status: 403,
        code: "ERR_COURSE_STUDENT_OUT_OF_SCOPE",
        message: "You can only update your own course progress.",
      };
    }
    const refusal = studentViewAgeRefusal(stu.dob);
    if (refusal) {
      return {
        ok: false,
        status: 403,
        code: "ERR_FORBIDDEN",
        message: refusal,
      };
    }
    return { ok: true };
  }

  if (hasMinRole(user.role, "shikshak")) {
    const scope = await resolveAdminScope(user);
    if (!inBatchWriteScope(scope, stu.batch_id, stu.centre_id)) {
      return {
        ok: false,
        status: 403,
        code: "ERR_COURSE_STUDENT_OUT_OF_SCOPE",
        message: "That student is outside your scope.",
      };
    }
    return { ok: true };
  }

  return {
    ok: false,
    status: 403,
    code: "ERR_FORBIDDEN",
    message: "You do not have access to this resource.",
  };
}

/* ═══════════════ CU3 catalogue ═══════════════ */

router.get("/", async (req: Request, res: Response) => {
  const user = req.authUser!;

  if (user.role === "parent") {
    // Prefer one child (mobile ChildSwitcher) — same shape as attendance / Niyam.
    // Optional student_id scopes CU3 visibility (city + MSV) to that child only.
    const requestedId =
      typeof req.query.student_id === "string" ? req.query.student_id : null;
    if (requestedId && !UUID_RE.test(requestedId)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "student_id must be a valid UUID.");
      return;
    }

    const kids = await db
      .select({
        id: students.id,
        centre_id: students.centre_id,
        msv_status: students.msv_status,
      })
      .from(students)
      .where(
        and(
          eq(students.parent_id, user.id),
          eq(students.status, "active"),
          isNull(students.deleted_at),
          requestedId ? eq(students.id, requestedId) : undefined,
        ),
      );

    if (requestedId && kids.length === 0) {
      fail(res, 403, "ERR_COURSE_STUDENT_OUT_OF_SCOPE", "That student is outside your scope.");
      return;
    }

    // Without student_id, keep a union so older clients still get a catalogue.
    const seen = new Map<string, unknown>();
    for (const kid of kids) {
      const cityId = await studentCityId(kid.centre_id);
      const rows = await db
        .select({
          id: courses.id,
          name_en: courses.name_en,
          name_hi: courses.name_hi,
          kind: courses.kind,
          academic_year: courses.academic_year,
          punya_points: courses.punya_points,
        })
        .from(courses)
        .where(courseVisibleToStudentSql(kid, cityId));
      for (const r of rows) seen.set(r.id, r);
    }
    ok(res, {
      items: [...seen.values()],
      student_ids: kids.map((k) => k.id),
    });
    return;
  }

  if (user.role === "student") {
    const [kid] = await db
      .select({
        id: students.id,
        centre_id: students.centre_id,
        msv_status: students.msv_status,
      })
      .from(students)
      .where(
        and(eq(students.user_id, user.id), eq(students.status, "active"), isNull(students.deleted_at)),
      )
      .limit(1);
    if (!kid) {
      ok(res, { items: [] });
      return;
    }
    const cityId = await studentCityId(kid.centre_id);
    const rows = await db
      .select({
        id: courses.id,
        name_en: courses.name_en,
        name_hi: courses.name_hi,
        kind: courses.kind,
        academic_year: courses.academic_year,
        punya_points: courses.punya_points,
      })
      .from(courses)
      .where(courseVisibleToStudentSql(kid, cityId));
    ok(res, { items: rows });
    return;
  }

  // Admin panel roles — active courses in city scope (still CU3 status=active).
  if (hasMinRole(user.role, "shikshak")) {
    const cityIds = await cityIdsForAuthor(user);
    const rows = await db
      .select({
        id: courses.id,
        name_en: courses.name_en,
        name_hi: courses.name_hi,
        kind: courses.kind,
        academic_year: courses.academic_year,
        status: courses.status,
        punya_points: courses.punya_points,
      })
      .from(courses)
      .where(
        and(
          eq(courses.status, "active"),
          isNull(courses.deleted_at),
          cityIds === null
            ? undefined
            : cityIds.length === 0
              ? sql`false`
              : or(isNull(courses.city_id), inArray(courses.city_id, cityIds)),
        ),
      );
    ok(res, { items: rows });
    return;
  }

  ok(res, { items: [] });
});

router.get("/:id/tree", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const studentId =
    typeof req.query.student_id === "string" ? req.query.student_id : null;
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
    return;
  }
  if (!studentId || !UUID_RE.test(studentId)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "student_id is required.");
    return;
  }

  const stu = await loadActiveStudent(studentId);
  if (!stu || stu.status !== "active") {
    fail(res, 403, "ERR_COURSE_STUDENT_OUT_OF_SCOPE", "That student is outside your scope.");
    return;
  }
  const user = req.authUser!;
  let allowed = false;
  if (user.role === "parent" && stu.parent_id === user.id) allowed = true;
  else if (user.role === "student" && stu.user_id === user.id) allowed = true;
  else if (hasMinRole(user.role, "shikshak")) {
    const scope = await resolveAdminScope(user);
    allowed =
      inBatchWriteScope(scope, stu.batch_id, stu.centre_id) ||
      inCentreScope(scope, stu.centre_id);
  }
  if (!allowed) {
    fail(res, 403, "ERR_COURSE_STUDENT_OUT_OF_SCOPE", "That student is outside your scope.");
    return;
  }
  const cityId = await studentCityId(stu.centre_id);
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, id), courseVisibleToStudentSql(stu, cityId)))
    .limit(1);
  if (!course) {
    // Draft / wrong city / MSV gate — invisible.
    fail(res, 404, "ERR_NOT_FOUND", "Course not found.");
    return;
  }

  const sections = await db
    .select()
    .from(course_sections)
    .where(and(eq(course_sections.course_id, id), isNull(course_sections.deleted_at)))
    .orderBy(asc(course_sections.order_index));
  const subs = await db
    .select()
    .from(course_subsections)
    .innerJoin(course_sections, eq(course_sections.id, course_subsections.section_id))
    .where(and(eq(course_sections.course_id, id), isNull(course_subsections.deleted_at)))
    .orderBy(asc(course_subsections.order_index));

  const progress = await db
    .select()
    .from(student_course_progress)
    .where(eq(student_course_progress.student_id, studentId));

  const progBySection = new Map(
    progress.filter((p) => p.section_id && !p.subsection_id).map((p) => [p.section_id!, p]),
  );
  const progBySub = new Map(
    progress.filter((p) => p.subsection_id).map((p) => [p.subsection_id!, p]),
  );

  const certifierIds = Array.from(
    new Set(
      progress
        .map((p) => p.certified_by)
        .filter((g): g is string => typeof g === "string" && g.length > 0),
    ),
  );
  const certifiers =
    certifierIds.length === 0
      ? []
      : await db
          .select({ id: users.id, gender: users.gender })
          .from(users)
          .where(inArray(users.id, certifierIds));
  const genderByUser = new Map(certifiers.map((u) => [u.id, u.gender]));

  const stats = await getCourseProgress(studentId, id);

  // CU16 — section-scoped roll-ups from the same fn_course_progress (never a second formula).
  const sectionRollups = await Promise.all(
    sections.map(async (s) => {
      const roll = await getCourseProgress(studentId, id, s.id);
      const subCount = subs.filter((row) => row.course_subsections.section_id === s.id).length;
      let derived_status: "not_started" | "in_progress" | "completed" | null = null;
      if (subCount === 0 || roll.leaf_total === 0) {
        derived_status = null;
      } else if (roll.leaf_reached <= 0) {
        derived_status = "not_started";
      } else if (roll.leaf_reached < roll.leaf_total) {
        derived_status = "in_progress";
      } else {
        derived_status = "completed";
      }
      return { sectionId: s.id, roll, derived_status };
    }),
  );
  const rollupBySection = new Map(sectionRollups.map((r) => [r.sectionId, r]));

  ok(res, {
    course: {
      id: course.id,
      name_en: course.name_en,
      name_hi: course.name_hi,
      kind: course.kind,
      academic_year: course.academic_year,
      punya_points: course.punya_points,
    },
    progress: stats,
    sections: sections.map((s) => {
      const sp = progBySection.get(s.id);
      const ru = rollupBySection.get(s.id);
      const declared = sp?.status ?? "not_started";
      const derived = ru?.derived_status ?? null;
      return {
        id: s.id,
        title_en: s.title_en,
        title_hi: s.title_hi,
        order_index: s.order_index,
        punya_points: s.punya_points,
        status: declared,
        certified_at: sp?.certified_at?.toISOString() ?? null,
        certified_by: sp?.certified_by ?? null,
        certified_by_gender: sp?.certified_by
          ? (genderByUser.get(sp.certified_by) ?? null)
          : null,
        // CU16 — both surfaces; divergence is information, not validation.
        derived_status: derived,
        derived_leaf_total: ru?.roll.leaf_total ?? 0,
        derived_leaf_reached: ru?.roll.leaf_reached ?? 0,
        derived_coverage: ru?.roll.coverage ?? null,
        status_diverges: derived != null && derived !== declared,
        subsections: subs
          .filter((row) => row.course_subsections.section_id === s.id)
          .map((row) => {
            const ip = progBySub.get(row.course_subsections.id);
            return {
              id: row.course_subsections.id,
              title_en: row.course_subsections.title_en,
              title_hi: row.course_subsections.title_hi,
              description_en: row.course_subsections.description_en,
              description_hi: row.course_subsections.description_hi,
              order_index: row.course_subsections.order_index,
              status: ip?.status ?? "not_started",
              certified_at: ip?.certified_at?.toISOString() ?? null,
              certified_by: ip?.certified_by ?? null,
              certified_by_gender: ip?.certified_by
                ? (genderByUser.get(ip.certified_by) ?? null)
                : null,
            };
          }),
      };
    }),
  });
});

/* ═══════════════ Section / subsection authoring ═══════════════ */

const sectionBody = z.object({
  title_en: z.string().min(1).max(300),
  title_hi: z.string().min(1).max(300),
  punya_points: z.number().int().min(0).max(1000),
});

router.post(
  "/:courseId/sections",
  requireAdminPanel,
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    let body: z.infer<typeof sectionBody>;
    try {
      body = sectionBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid section data.");
      return;
    }
    const course = await loadAuthorableCourse(req, res, String(req.params.courseId));
    if (!course) return;

    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${course_sections.order_index}), -1)::int` })
      .from(course_sections)
      .where(and(eq(course_sections.course_id, course.id), isNull(course_sections.deleted_at)));

    const [row] = await db
      .insert(course_sections)
      .values({
        course_id: course.id,
        title_en: body.title_en,
        title_hi: body.title_hi,
        order_index: (max ?? -1) + 1,
        punya_points: body.punya_points,
      })
      .returning({ id: course_sections.id });

    await auditFromReq(req, {
      action: "create",
      entityKind: "course_section",
      entityId: row.id,
      summary: `Added course section "${body.title_en}".`,
      metadata: { course_id: course.id, punya_points: body.punya_points },
    });
    ok(res, { id: row.id });
  },
);

const patchSectionBody = z.object({
  title_en: z.string().min(1).max(300).optional(),
  title_hi: z.string().min(1).max(300).optional(),
  punya_points: z.number().int().min(0).max(1000).optional(),
});

router.patch(
  "/sections/:sectionId",
  requireAdminPanel,
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    let body: z.infer<typeof patchSectionBody>;
    try {
      body = patchSectionBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid section data.");
      return;
    }
    const [sec] = await db
      .select({ id: course_sections.id, course_id: course_sections.course_id })
      .from(course_sections)
      .where(and(eq(course_sections.id, String(req.params.sectionId)), isNull(course_sections.deleted_at)))
      .limit(1);
    if (!sec) {
      fail(res, 404, "ERR_NOT_FOUND", "Section not found.");
      return;
    }
    const course = await loadAuthorableCourse(req, res, sec.course_id);
    if (!course) return;

    await db
      .update(course_sections)
      .set({
        ...(body.title_en !== undefined ? { title_en: body.title_en } : {}),
        ...(body.title_hi !== undefined ? { title_hi: body.title_hi } : {}),
        ...(body.punya_points !== undefined ? { punya_points: body.punya_points } : {}),
        updated_at: new Date(),
      })
      .where(eq(course_sections.id, sec.id));

    await auditFromReq(req, {
      action: "update",
      entityKind: "course_section",
      entityId: sec.id,
      summary:
        body.punya_points !== undefined
          ? "Updated course section (including punya_points)."
          : "Updated course section.",
      metadata: { course_id: course.id, ...body },
    });
    ok(res, { id: sec.id });
  },
);

router.delete(
  "/sections/:sectionId",
  requireAdminPanel,
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    const [sec] = await db
      .select({ id: course_sections.id, course_id: course_sections.course_id })
      .from(course_sections)
      .where(and(eq(course_sections.id, String(req.params.sectionId)), isNull(course_sections.deleted_at)))
      .limit(1);
    if (!sec) {
      fail(res, 404, "ERR_NOT_FOUND", "Section not found.");
      return;
    }
    if (!(await loadAuthorableCourse(req, res, sec.course_id))) return;
    try {
      const row = await softDeleteCourseNode({
        nodeKind: "section",
        nodeId: sec.id,
        actorId: req.authUser!.id,
        actorRole: req.authUser!.role as Role,
        ip: req.ip ?? null,
      });
      ok(res, { id: row.id, deleted: true });
    } catch (err) {
      if (!handleErr(res, err)) throw err;
    }
  },
);

const reorderSectionsBody = z.object({
  section_ids: z.array(z.string().uuid()).min(1).max(500),
});

router.post(
  "/:courseId/sections/reorder",
  requireAdminPanel,
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    let body: z.infer<typeof reorderSectionsBody>;
    try {
      body = reorderSectionsBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid reorder data.");
      return;
    }
    const course = await loadAuthorableCourse(req, res, String(req.params.courseId));
    if (!course) return;
    const existing = await db
      .select({ id: course_sections.id })
      .from(course_sections)
      .where(and(eq(course_sections.course_id, course.id), isNull(course_sections.deleted_at)));
    const existingIds = new Set(existing.map((r) => r.id));
    if (
      body.section_ids.length !== existingIds.size ||
      body.section_ids.some((id) => !existingIds.has(id))
    ) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Reorder must list every section exactly once.");
      return;
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < body.section_ids.length; i += 1) {
        await tx
          .update(course_sections)
          .set({ order_index: i, updated_at: new Date() })
          .where(eq(course_sections.id, body.section_ids[i]!));
      }
    });
    ok(res, { id: course.id, reordered: body.section_ids.length });
  },
);

const subsectionBody = z.object({
  title_en: z.string().min(1).max(500),
  title_hi: z.string().min(1).max(500),
  description_en: z.string().max(4000).optional(),
  description_hi: z.string().max(4000).optional(),
});

router.post(
  "/sections/:sectionId/subsections",
  requireAdminPanel,
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    let body: z.infer<typeof subsectionBody>;
    try {
      body = subsectionBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid subsection data.");
      return;
    }
    const [sec] = await db
      .select({ id: course_sections.id, course_id: course_sections.course_id })
      .from(course_sections)
      .where(and(eq(course_sections.id, String(req.params.sectionId)), isNull(course_sections.deleted_at)))
      .limit(1);
    if (!sec) {
      fail(res, 404, "ERR_NOT_FOUND", "Section not found.");
      return;
    }
    if (!(await loadAuthorableCourse(req, res, sec.course_id))) return;

    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${course_subsections.order_index}), -1)::int` })
      .from(course_subsections)
      .where(and(eq(course_subsections.section_id, sec.id), isNull(course_subsections.deleted_at)));

    const [row] = await db
      .insert(course_subsections)
      .values({
        section_id: sec.id,
        title_en: body.title_en,
        title_hi: body.title_hi,
        description_en: body.description_en ?? null,
        description_hi: body.description_hi ?? null,
        order_index: (max ?? -1) + 1,
      })
      .returning({ id: course_subsections.id });

    await auditFromReq(req, {
      action: "create",
      entityKind: "course_subsection",
      entityId: row.id,
      summary: `Added course subsection "${body.title_en}".`,
      metadata: { section_id: sec.id, course_id: sec.course_id },
    });
    ok(res, { id: row.id });
  },
);

router.patch(
  "/subsections/:subsectionId",
  requireAdminPanel,
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    const body = subsectionBody.partial().parse(req.body ?? {});
    const [sub] = await db
      .select({
        id: course_subsections.id,
        section_id: course_subsections.section_id,
        course_id: course_sections.course_id,
      })
      .from(course_subsections)
      .innerJoin(course_sections, eq(course_sections.id, course_subsections.section_id))
      .where(
        and(
          eq(course_subsections.id, String(req.params.subsectionId)),
          isNull(course_subsections.deleted_at),
        ),
      )
      .limit(1);
    if (!sub) {
      fail(res, 404, "ERR_NOT_FOUND", "Subsection not found.");
      return;
    }
    if (!(await loadAuthorableCourse(req, res, sub.course_id))) return;
    await db
      .update(course_subsections)
      .set({
        ...(body.title_en !== undefined ? { title_en: body.title_en } : {}),
        ...(body.title_hi !== undefined ? { title_hi: body.title_hi } : {}),
        ...(body.description_en !== undefined ? { description_en: body.description_en } : {}),
        ...(body.description_hi !== undefined ? { description_hi: body.description_hi } : {}),
        updated_at: new Date(),
      })
      .where(eq(course_subsections.id, sub.id));
    ok(res, { id: sub.id });
  },
);

router.delete(
  "/subsections/:subsectionId",
  requireAdminPanel,
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    const [sub] = await db
      .select({
        id: course_subsections.id,
        course_id: course_sections.course_id,
      })
      .from(course_subsections)
      .innerJoin(course_sections, eq(course_sections.id, course_subsections.section_id))
      .where(
        and(
          eq(course_subsections.id, String(req.params.subsectionId)),
          isNull(course_subsections.deleted_at),
        ),
      )
      .limit(1);
    if (!sub) {
      fail(res, 404, "ERR_NOT_FOUND", "Subsection not found.");
      return;
    }
    if (!(await loadAuthorableCourse(req, res, sub.course_id))) return;
    try {
      const row = await softDeleteCourseNode({
        nodeKind: "subsection",
        nodeId: sub.id,
        actorId: req.authUser!.id,
        actorRole: req.authUser!.role as Role,
        ip: req.ip ?? null,
      });
      ok(res, { id: row.id, deleted: true });
    } catch (err) {
      if (!handleErr(res, err)) throw err;
    }
  },
);

const reorderSubsBody = z.object({
  subsection_ids: z.array(z.string().uuid()).min(1).max(2000),
});

router.post(
  "/sections/:sectionId/subsections/reorder",
  requireAdminPanel,
  requireMinRole("city_admin"),
  async (req: Request, res: Response) => {
    let body: z.infer<typeof reorderSubsBody>;
    try {
      body = reorderSubsBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid reorder data.");
      return;
    }
    const [sec] = await db
      .select({ id: course_sections.id, course_id: course_sections.course_id })
      .from(course_sections)
      .where(and(eq(course_sections.id, String(req.params.sectionId)), isNull(course_sections.deleted_at)))
      .limit(1);
    if (!sec) {
      fail(res, 404, "ERR_NOT_FOUND", "Section not found.");
      return;
    }
    if (!(await loadAuthorableCourse(req, res, sec.course_id))) return;
    const existing = await db
      .select({ id: course_subsections.id })
      .from(course_subsections)
      .where(and(eq(course_subsections.section_id, sec.id), isNull(course_subsections.deleted_at)));
    const existingIds = new Set(existing.map((r) => r.id));
    if (
      body.subsection_ids.length !== existingIds.size ||
      body.subsection_ids.some((id) => !existingIds.has(id))
    ) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Reorder must list every subsection exactly once.");
      return;
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < body.subsection_ids.length; i += 1) {
        await tx
          .update(course_subsections)
          .set({ order_index: i, updated_at: new Date() })
          .where(eq(course_subsections.id, body.subsection_ids[i]!));
      }
    });
    ok(res, { id: sec.id, reordered: body.subsection_ids.length });
  },
);

/* ═══════════════ Progress + certify ═══════════════ */

const progressBody = z.object({
  student_id: z.string().uuid(),
  status: z.enum(COURSE_PROGRESS_STATUSES),
  note: z.string().max(1000).optional(),
  client_op_id: z.string().length(26).optional(),
  client_marked_at: z.string().datetime().optional(),
});

router.post("/nodes/:nodeId/progress", async (req: Request, res: Response) => {
  let body: z.infer<typeof progressBody>;
  try {
    body = progressBody.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid progress payload.");
    return;
  }
  const node = await resolveNodeKind(String(req.params.nodeId));
  if (!node) {
    fail(res, 404, "ERR_COURSE_NODE_NOT_FOUND", "That course node was not found.");
    return;
  }
  const access = await assertProgressWriteAccess(req, body.student_id);
  if (!access.ok) {
    fail(res, access.status, access.code, access.message);
    return;
  }
  try {
    const row = await upsertCourseProgress({
      studentId: body.student_id,
      nodeKind: node.kind,
      nodeId: String(req.params.nodeId),
      status: body.status,
      note: body.note ?? null,
      updatedBy: req.authUser!.id,
      updatedByRole: req.authUser!.role,
      clientOpId: body.client_op_id ?? null,
      clientMarkedAt: body.client_marked_at ? new Date(body.client_marked_at) : null,
    });
    ok(res, {
      id: row.id,
      status: row.status,
      section_id: row.section_id,
      subsection_id: row.subsection_id,
    });
  } catch (err) {
    if (!handleErr(res, err)) throw err;
  }
});

const bulkBody = z
  .object({
    batch_id: z.string().uuid().optional(),
    student_ids: z.array(z.string().uuid()).min(1).max(200).optional(),
    status: z.enum(COURSE_PROGRESS_STATUSES),
    note: z.string().max(1000).optional(),
    submission_op_id: z.string().length(26).optional(),
  })
  .refine(
    (b) => (!!b.batch_id) !== (!!b.student_ids && b.student_ids.length > 0),
    { message: "Exactly one of batch_id or student_ids" },
  );

router.post(
  "/nodes/:nodeId/progress/bulk",
  requireAdminPanel,
  requireMinRole("shikshak"),
  async (req: Request, res: Response) => {
    let body: z.infer<typeof bulkBody>;
    try {
      body = bulkBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Provide exactly one of batch_id or student_ids.");
      return;
    }
    const node = await resolveNodeKind(String(req.params.nodeId));
    if (!node) {
      fail(res, 404, "ERR_COURSE_NODE_NOT_FOUND", "That course node was not found.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    try {
      const result = await bulkUpsertCourseProgress({
        nodeKind: node.kind,
        nodeId: String(req.params.nodeId),
        status: body.status,
        note: body.note ?? null,
        batchId: body.batch_id ?? null,
        studentIds: body.student_ids ?? null,
        scope,
        updatedBy: req.authUser!.id,
        updatedByRole: req.authUser!.role,
      });
      ok(res, result);
    } catch (err) {
      if (!handleErr(res, err)) throw err;
    }
  },
);

router.post(
  "/nodes/:nodeId/progress/reset",
  requireAdminPanel,
  requireMinRole("shikshak"),
  async (req: Request, res: Response) => {
    let body: z.infer<typeof bulkBody>;
    try {
      body = bulkBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Provide exactly one of batch_id or student_ids.");
      return;
    }
    const node = await resolveNodeKind(String(req.params.nodeId));
    if (!node) {
      fail(res, 404, "ERR_COURSE_NODE_NOT_FOUND", "That course node was not found.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    try {
      const result = await resetCourseProgress({
        nodeKind: node.kind,
        nodeId: String(req.params.nodeId),
        status: body.status,
        note: body.note ?? null,
        batchId: body.batch_id ?? null,
        studentIds: body.student_ids ?? null,
        scope,
        updatedBy: req.authUser!.id,
        updatedByRole: req.authUser!.role as Role,
        ip: req.ip ?? null,
      });
      ok(res, result);
    } catch (err) {
      if (!handleErr(res, err)) throw err;
    }
  },
);

const certifyBody = z.object({
  student_id: z.string().uuid(),
  note: z.string().max(1000).optional(),
});

router.post(
  "/nodes/:nodeId/certify",
  requireAdminPanel,
  requireMinRole("shikshak"),
  async (req: Request, res: Response) => {
    let body: z.infer<typeof certifyBody>;
    try {
      body = certifyBody.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid certify payload.");
      return;
    }
    const node = await resolveNodeKind(String(req.params.nodeId));
    if (!node) {
      fail(res, 404, "ERR_COURSE_NODE_NOT_FOUND", "That course node was not found.");
      return;
    }
    const stu = await loadActiveStudent(body.student_id);
    if (!stu || stu.status !== "active") {
      fail(res, 403, "ERR_COURSE_STUDENT_OUT_OF_SCOPE", "That student is outside your scope.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    if (!inBatchWriteScope(scope, stu.batch_id, stu.centre_id)) {
      fail(res, 403, "ERR_COURSE_STUDENT_OUT_OF_SCOPE", "That student is outside your scope.");
      return;
    }
    try {
      const result = await certifyCourseNode({
        nodeKind: node.kind,
        nodeId: String(req.params.nodeId),
        studentId: body.student_id,
        actorId: req.authUser!.id,
        actorRole: req.authUser!.role as Role,
        note: body.note ?? null,
        softTransition: false,
        ip: req.ip ?? null,
      });
      // PDF after commit — enqueue is best-effort (CU26).
      for (const certId of result.certificate_ids) {
        await enqueueCertificatePdf(certId);
      }
      // L1 — course_award_key is the internal Punya idempotency key; it's an
      // implementation detail (table/column shape), not something a client
      // needs or should see.
      ok(res, {
        progress_id: result.progress_id,
        section_id: result.section_id,
        subsection_id: result.subsection_id,
        status: result.status,
        certified_at: result.certified_at,
        revision: result.revision,
        section_points_awarded: result.section_points_awarded,
        course_points_awarded: result.course_points_awarded,
        section_transaction_id: result.section_transaction_id,
        course_transaction_id: result.course_transaction_id,
        certificate_ids: result.certificate_ids,
        applied: result.applied,
      });
    } catch (err) {
      if (!handleErr(res, err)) throw err;
    }
  },
);

/** CU19 — super_admin correction (not a product feature). */
router.post(
  "/nodes/:nodeId/certify/correct",
  requireAdminPanel,
  requireMinRole("super_admin"),
  async (req: Request, res: Response) => {
    const body = z
      .object({
        student_id: z.string().uuid(),
        status: z.enum(COURSE_PROGRESS_STATUSES).optional(),
      })
      .parse(req.body);
    const node = await resolveNodeKind(String(req.params.nodeId));
    if (!node) {
      fail(res, 404, "ERR_COURSE_NODE_NOT_FOUND", "That course node was not found.");
      return;
    }
    try {
      const result = await correctCourseCertification({
        nodeKind: node.kind,
        nodeId: String(req.params.nodeId),
        studentId: body.student_id,
        actorId: req.authUser!.id,
        actorRole: req.authUser!.role as Role,
        status: body.status,
        ip: req.ip ?? null,
      });
      ok(res, result);
    } catch (err) {
      if (!handleErr(res, err)) throw err;
    }
  },
);

export default router;
