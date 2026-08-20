/**
 * Admin APIs: curriculum, exams, donations, queues.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  centres,
  cities,
  courses,
  course_sections,
  course_subsections,
  online_exams,
  exam_attempts,
  exam_questions,
  students,
  donation_campaigns,
  donations,
  queue_stats,
  queue_dlq_jobs,
  niyams,
  punya_configs,
  centre_holidays,
  type User,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail, zodDetails } from "../../lib/envelope";
import {
  requireAuth,
  requireAdminPanel,
  requireRole,
  requireDonationView,
} from "../../middlewares/auth";
import { resolveAdminScope, cityIdsForState, cityIdsForUser } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { invalidatePunyaPointCaches } from "../../lib/punya-config-invalidate";
import {
  clampLimit,
  decodeTimeCursor,
  encodeTimeCursor,
  scopedBatchFilter,
  scopedCentreFilter,
} from "../../lib/route-helpers";
import {
  validateNiyamPointsBounds,
  validatePunyaConfigPointsBounds,
} from "../../lib/niyam-points";
import { isUniqueViolation } from "../../lib/pg-errors";
import { generateExamAccessCode, hashOtpCode } from "../../lib/tokens";
import { QUEUE_NAMES } from "@jp/shared/constants";
import { enqueueJob } from "../../lib/queues";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function cityFilter(column: PgColumn, ids: string[] | null) {
  if (ids === null) return undefined;
  if (ids.length === 0) return eq(column, "00000000-0000-0000-0000-000000000000");
  return inArray(column, ids);
}

/* GET /v1/admin/curricula?kind= */
router.get("/curricula", async (req: Request, res: Response) => {
  const cityIds = await cityIdsForUser(req.authUser!);
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const rows = await db
    .select({
      id: courses.id,
      name: courses.name_en,
      kind: courses.kind,
      academic_year: courses.academic_year,
      status: courses.status,
      city_name: cities.name,
      section_count: sql<number>`(
        select count(*)::int from ${course_sections}
        where ${course_sections.course_id} = ${courses.id}
      )`,
    })
    .from(courses)
    .leftJoin(cities, eq(cities.id, courses.city_id))
    .where(
      and(
        kind ? eq(courses.kind, kind) : undefined,
        cityFilter(courses.city_id, cityIds),
      ),
    )
    .orderBy(desc(courses.created_at));

  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/admin/curricula/:id/tree */
router.get("/curricula/:id/tree", async (req: Request, res: Response) => {
  const cityIds = await cityIdsForUser(req.authUser!);
  const id = String(req.params.id);
  if (!isUuid(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Curriculum not found.");
    return;
  }
  const [curriculum] = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
  if (!curriculum) {
    fail(res, 404, "ERR_NOT_FOUND", "Curriculum not found.");
    return;
  }
  if (cityIds !== null && curriculum.city_id && !cityIds.includes(curriculum.city_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Curriculum not found in your scope.");
    return;
  }

  const sections = await db
    .select()
    .from(course_sections)
    .where(eq(course_sections.course_id, id))
    .orderBy(asc(course_sections.order_index));

  const items = await db
    .select()
    .from(course_subsections)
    .innerJoin(course_sections, eq(course_sections.id, course_subsections.section_id))
    .where(eq(course_sections.course_id, id))
    .orderBy(asc(course_subsections.order_index));

  ok(res, {
    curriculum: {
      id: curriculum.id,
      name: curriculum.name_en,
      kind: curriculum.kind,
      academic_year: curriculum.academic_year,
      status: curriculum.status,
    },
    sections: sections.map((s) => ({
      id: s.id,
      title_en: s.title_en,
      title_hi: s.title_hi,
      order_index: s.order_index,
      items: items
        .filter((row) => row.course_subsections.section_id === s.id)
        .map((row) => ({
          id: row.course_subsections.id,
          title_en: row.course_subsections.title_en,
          title_hi: row.course_subsections.title_hi,
          order_index: row.course_subsections.order_index,
        })),
    })),
  });
});

/* GET /v1/admin/exams */
router.get("/exams", async (req: Request, res: Response) => {
  const cityIds = await cityIdsForUser(req.authUser!);
  const limit = clampLimit(req.query.limit, 50, 200);
  const rows = await db
    .select({
      id: online_exams.id,
      title_en: online_exams.title_en,
      // title_hi/descriptions/max_attempts were omitted here while the edit
      // dialog read them — opening "Edit exam" crashed on undefined.trim()
      // and white-screened the panel (CTY-ERR-01).
      title_hi: online_exams.title_hi,
      description_en: online_exams.description_en,
      description_hi: online_exams.description_hi,
      max_attempts: online_exams.max_attempts,
      city_id: online_exams.city_id,
      city_name: cities.name,
      window_start: online_exams.window_start,
      window_end: online_exams.window_end,
      exam_otp: online_exams.exam_otp,
      exam_otp_hash: online_exams.exam_otp_hash,
      results_released: online_exams.results_released,
      total_marks: online_exams.total_marks,
      pass_mark: online_exams.pass_mark,
      attempt_count: sql<number>`count(${exam_attempts.id})::int`,
    })
    .from(online_exams)
    .innerJoin(cities, eq(cities.id, online_exams.city_id))
    .leftJoin(exam_attempts, eq(exam_attempts.exam_id, online_exams.id))
    .where(cityFilter(online_exams.city_id, cityIds))
    .groupBy(online_exams.id, cities.name)
    .orderBy(desc(online_exams.window_start))
    .limit(limit);

  // Per-exam question-marks sums (CTY-API-07b) — separate aggregate so the
  // attempts join above cannot multiply it.
  const sumsByExam = new Map<string, number>();
  if (rows.length > 0) {
    const sums = await db
      .select({
        exam_id: exam_questions.exam_id,
        marks_sum: sql<number>`coalesce(sum(${exam_questions.marks}), 0)::int`,
      })
      .from(exam_questions)
      .where(inArray(exam_questions.exam_id, rows.map((r) => r.id)))
      .groupBy(exam_questions.exam_id);
    for (const s of sums) sumsByExam.set(s.exam_id, s.marks_sum);
  }

  // CTY-DSN-05: plaintext codes are never listable — legacy `exam_otp` is no
  // longer echoed even to exam administrators; the code is shown exactly once
  // at create/regenerate time.
  const items = rows.map((r) => ({
    id: r.id,
    title_en: r.title_en,
    title_hi: r.title_hi,
    description_en: r.description_en,
    description_hi: r.description_hi,
    city_id: r.city_id,
    city_name: r.city_name,
    window_start: r.window_start.toISOString(),
    window_end: r.window_end.toISOString(),
    results_released: r.results_released,
    total_marks: r.total_marks,
    pass_mark: r.pass_mark,
    max_attempts: r.max_attempts,
    attempt_count: r.attempt_count,
    // Running question-marks sum so the client can surface a mismatch
    // against total_marks before release (CTY-API-07b).
    question_marks_total: sumsByExam.get(r.id) ?? 0,
    requires_otp: !!(r.exam_otp_hash || (r.exam_otp && r.exam_otp.length > 0)),
  }));
  ok(res, { items }, { count: items.length });
});

/* POST /v1/admin/exams/:id/release-results */
router.post(
  "/exams/:id/release-results",
  requireRole("super_admin", "state_admin", "city_admin"),
  async (req: Request, res: Response) => {
    const cityIds = await cityIdsForUser(req.authUser!);
    const id = String(req.params.id);
    if (!isUuid(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
      return;
    }
    const [exam] = await db.select().from(online_exams).where(eq(online_exams.id, id)).limit(1);
    if (!exam || (cityIds !== null && !cityIds.includes(exam.city_id))) {
      fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
      return;
    }

    // CTY-API-07b: an exam declared out of 100 whose questions total 20 fails
    // the whole cohort — results must not release while the paper and the
    // declared total disagree.
    const [qSum] = await db
      .select({ marks_sum: sql<number>`coalesce(sum(${exam_questions.marks}), 0)::int` })
      .from(exam_questions)
      .where(eq(exam_questions.exam_id, id));
    const questionTotal = qSum?.marks_sum ?? 0;
    if (questionTotal !== exam.total_marks) {
      fail(
        res,
        409,
        "ERR_CONFLICT",
        `Question marks add up to ${questionTotal}, but the exam is declared out of ${exam.total_marks} — fix the questions or the total, then release.`,
      );
      return;
    }

    // Releasing while text answers are unmarked publishes a NULL score, which
    // the result route renders as a failing zero — a child who wrote a good
    // paper is told they failed. Release is one-way, so this has to block.
    const [ungraded] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(exam_attempts)
      .where(
        and(
          eq(exam_attempts.exam_id, id),
          eq(exam_attempts.status, "submitted"),
          eq(exam_attempts.needs_grading, true),
        ),
      );
    const pending = ungraded?.n ?? 0;
    if (pending > 0) {
      fail(
        res,
        409,
        "ERR_CONFLICT",
        `${pending} attempt${pending === 1 ? " still needs" : "s still need"} grading — finish grading on the Exam grading page, then release.`,
      );
      return;
    }

    // updated_at matters beyond bookkeeping: the top-score catch-up cron filters
    // on (window_end >= since OR updated_at >= since) over 30 days, so an exam
    // released well after its window closed matched neither disjunct and its
    // toppers were silently skipped.
    await db
      .update(online_exams)
      .set({ results_released: true, updated_at: new Date() })
      .where(eq(online_exams.id, id));

    await auditFromReq(req, {
      action: "update",
      entityKind: "online_exam",
      entityId: id,
      summary: `Released results for exam "${exam.title_en}".`,
      metadata: { results_released: true },
    });

    // The primary trigger for top-score Punya (exam-punya.ts documents this
    // route as such); the daily cron is only the catch-up. Non-fatal: the
    // release is already committed, so a queue hiccup must not 500 the admin
    // into retrying an irreversible action. The cron picks it up either way,
    // which is exactly what updated_at above keeps in range.
    try {
      await enqueueJob(QUEUE_NAMES.EXAM_TOP_SCORE, { exam_id: id });
    } catch (err) {
      logger.warn({ err, examId: id }, "exam.top_score enqueue failed after release");
    }

    ok(res, { id, results_released: true });
  },
);

const patchExamSchema = z
  .object({
    title_en: z.string().min(1).max(300).optional(),
    title_hi: z.string().min(1).max(300).optional(),
    description_en: z.string().max(2000).nullable().optional(),
    description_hi: z.string().max(2000).nullable().optional(),
    window_start: z.string().datetime().optional(),
    window_end: z.string().datetime().optional(),
    total_marks: z.coerce.number().int().min(1).optional(),
    pass_mark: z.coerce.number().int().min(0).optional(),
    max_attempts: z.coerce.number().int().min(1).max(10).optional(),
    completion_points: z.coerce.number().int().min(0).nullable().optional(),
    top_score_points: z.coerce.number().int().min(0).nullable().optional(),
  })
  .strict();

/* PATCH /v1/admin/exams/:id — the edit dialog PATCHed a route that did not
   exist, so no exam was ever editable (CTY-API-01). */
router.patch(
  "/exams/:id",
  requireRole("super_admin", "state_admin", "city_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isUuid(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
      return;
    }
    let body: z.infer<typeof patchExamSchema>;
    try {
      body = patchExamSchema.parse(req.body);
    } catch (err) {
      const msg =
        err instanceof z.ZodError ? (err.issues[0]?.message ?? "Invalid exam data.") : "Invalid exam data.";
      fail(res, 422, "ERR_VALIDATION_FAILED", msg);
      return;
    }

    const cityIds = await cityIdsForUser(req.authUser!);
    const [exam] = await db.select().from(online_exams).where(eq(online_exams.id, id)).limit(1);
    if (!exam || (cityIds !== null && !cityIds.includes(exam.city_id))) {
      fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
      return;
    }

    // Marks lock after release — server-enforced, not just a disabled input.
    if (exam.results_released && (body.total_marks !== undefined || body.pass_mark !== undefined)) {
      fail(
        res,
        409,
        "ERR_RESULTS_PUBLISHED",
        "Total marks and pass mark are locked after results are released.",
      );
      return;
    }

    const nextStart = body.window_start ? new Date(body.window_start) : exam.window_start;
    const nextEnd = body.window_end ? new Date(body.window_end) : exam.window_end;
    if (nextStart.getTime() >= nextEnd.getTime()) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "The exam must end after it starts — check the window dates.");
      return;
    }
    const nextTotal = body.total_marks ?? exam.total_marks;
    const nextPass = body.pass_mark ?? exam.pass_mark;
    if (nextPass > nextTotal) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Pass mark cannot be higher than total marks.");
      return;
    }

    const [row] = await db
      .update(online_exams)
      .set({
        ...(body.title_en !== undefined ? { title_en: body.title_en } : {}),
        ...(body.title_hi !== undefined ? { title_hi: body.title_hi } : {}),
        ...(body.description_en !== undefined ? { description_en: body.description_en } : {}),
        ...(body.description_hi !== undefined ? { description_hi: body.description_hi } : {}),
        ...(body.window_start !== undefined ? { window_start: nextStart } : {}),
        ...(body.window_end !== undefined ? { window_end: nextEnd } : {}),
        ...(body.total_marks !== undefined ? { total_marks: body.total_marks } : {}),
        ...(body.pass_mark !== undefined ? { pass_mark: body.pass_mark } : {}),
        ...(body.max_attempts !== undefined ? { max_attempts: body.max_attempts } : {}),
        ...(body.completion_points !== undefined ? { completion_points: body.completion_points } : {}),
        ...(body.top_score_points !== undefined ? { top_score_points: body.top_score_points } : {}),
        updated_at: new Date(),
      })
      .where(eq(online_exams.id, id))
      .returning({
        id: online_exams.id,
        title_en: online_exams.title_en,
        title_hi: online_exams.title_hi,
        description_en: online_exams.description_en,
        description_hi: online_exams.description_hi,
        window_start: online_exams.window_start,
        window_end: online_exams.window_end,
        total_marks: online_exams.total_marks,
        pass_mark: online_exams.pass_mark,
        max_attempts: online_exams.max_attempts,
        results_released: online_exams.results_released,
      });
    await auditFromReq(req, {
      action: "update",
      entityKind: "online_exam",
      entityId: id,
      summary: `Updated exam "${exam.title_en}".`,
      metadata: { fields: Object.keys(body) },
    });
    ok(res, {
      ...row!,
      window_start: row!.window_start.toISOString(),
      window_end: row!.window_end.toISOString(),
    });
  },
);

/* POST /v1/admin/exams/:id/access-code — regenerate; plaintext returned once
   (CTY-API-07). The old flow showed the code in a 4-second toast and it was
   unrecoverable afterwards. */
router.post(
  "/exams/:id/access-code",
  requireRole("super_admin", "state_admin", "city_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isUuid(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
      return;
    }
    const cityIds = await cityIdsForUser(req.authUser!);
    const [exam] = await db.select().from(online_exams).where(eq(online_exams.id, id)).limit(1);
    if (!exam || (cityIds !== null && !cityIds.includes(exam.city_id))) {
      fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
      return;
    }
    const plaintext = generateExamAccessCode();
    const hash = await hashOtpCode(plaintext);
    await db
      .update(online_exams)
      .set({ exam_otp: null, exam_otp_hash: hash, updated_at: new Date() })
      .where(eq(online_exams.id, id));
    await auditFromReq(req, {
      action: "update",
      entityKind: "online_exam",
      entityId: id,
      summary: `Regenerated the access code for exam "${exam.title_en}".`,
    });
    ok(res, { id, exam_otp: plaintext });
  },
);
/* GET /v1/admin/exams/:id/attempts */
router.get("/exams/:id/attempts", async (req: Request, res: Response) => {
  const cityIds = await cityIdsForUser(req.authUser!);
  const id = String(req.params.id);
  if (!isUuid(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }
  const [exam] = await db.select().from(online_exams).where(eq(online_exams.id, id)).limit(1);
  if (!exam || (cityIds !== null && !cityIds.includes(exam.city_id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }
  // Reads are open to the admin panel, but the ROWS are scoped (Q12): a
  // shikshak sees only their assigned batches, a sanchalak only their assigned
  // centres. Without this the list handed every admin-panel role every
  // attempting child's name and score city-wide. Writes stay canAdministerExams.
  const scope = await resolveAdminScope(req.authUser!);
  const rows = await db
    .select({
      id: exam_attempts.id,
      student_name: students.full_name,
      student_code: students.student_code,
      status: exam_attempts.status,
      score: exam_attempts.score,
      // The grading page filters on needs_grading and renders the auto/manual
      // split; omitting these three made every exam report "no attempts need
      // grading", so a text exam could never be found to grade.
      needs_grading: exam_attempts.needs_grading,
      auto_score: exam_attempts.auto_score,
      manual_score: exam_attempts.manual_score,
      started_at: exam_attempts.started_at,
      submitted_at: exam_attempts.submitted_at,
    })
    .from(exam_attempts)
    .innerJoin(students, eq(students.id, exam_attempts.student_id))
    .where(
      and(
        eq(exam_attempts.exam_id, id),
        isNull(students.deleted_at),
        scopedCentreFilter(scope, students.centre_id),
        scopedBatchFilter(scope, students.batch_id),
      ),
    )
    .orderBy(desc(exam_attempts.started_at));

  const items = rows.map((r) => ({
    ...r,
    started_at: r.started_at.toISOString(),
    submitted_at: r.submitted_at ? r.submitted_at.toISOString() : null,
  }));
  ok(res, { items }, { count: items.length });
});

/* GET /v1/admin/donations/campaigns — donor data is city_admin+ (XC-API-01):
   a shikshak typing the URL used to receive the full donor list. */
router.get(
  "/donations/campaigns",
  requireDonationView,
  async (req: Request, res: Response) => {
  const cityIds = await cityIdsForUser(req.authUser!);
  const rows = await db
    .select({
      id: donation_campaigns.id,
      name: donation_campaigns.name,
      description: donation_campaigns.description,
      city_name: cities.name,
      target_amount_paise: donation_campaigns.target_amount_paise,
      raised_amount_paise: donation_campaigns.raised_amount_paise,
      is_public: donation_campaigns.is_public,
    })
    .from(donation_campaigns)
    .leftJoin(cities, eq(cities.id, donation_campaigns.city_id))
    .where(
      cityIds === null
        ? undefined
        : cityIds.length === 0
          ? eq(donation_campaigns.id, "00000000-0000-0000-0000-000000000000")
          : or(
              isNull(donation_campaigns.city_id),
              inArray(donation_campaigns.city_id, cityIds),
            ),
    )
    .orderBy(desc(donation_campaigns.created_at));

  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/admin/donations — donor PII; gated on canViewDonations (XC-API-01).
   The roster lives in one place (@workspace/api-zod) so this route and the
   analytics overview in admin.ts cannot drift apart. */
router.get(
  "/donations",
  requireDonationView,
  async (req: Request, res: Response) => {
  const cityIds = await cityIdsForUser(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 500);
  // XC-WEB-02 — this list had no cursor at all, so it returned a truncated
  // prefix and the admin total silently under-reported against the bank. Keyset
  // on (created_at, id) to match the existing admin list pattern.
  const cursor = decodeTimeCursor(req.query.cursor);
  const rows = await db
    .select({
      id: donations.id,
      donor_name: donations.donor_name,
      donor_phone: donations.donor_phone,
      amount_paise: donations.amount_paise,
      purpose: donations.purpose,
      frequency: donations.frequency,
      status: donations.status,
      eighty_g_eligible: donations.eighty_g_eligible,
      receipt_number: donations.receipt_number,
      campaign_name: donation_campaigns.name,
      city_name: cities.name,
      payment_captured_at: donations.payment_captured_at,
      created_at: donations.created_at,
    })
    .from(donations)
    .leftJoin(donation_campaigns, eq(donation_campaigns.id, donations.campaign_id))
    .leftJoin(cities, eq(cities.id, donation_campaigns.city_id))
    .where(
      and(
        cityIds === null
          ? undefined
          : cityIds.length === 0
            ? eq(donations.id, "00000000-0000-0000-0000-000000000000")
            : or(isNull(donation_campaigns.city_id), inArray(donation_campaigns.city_id, cityIds)),
        cursor
          ? or(
              lt(donations.created_at, cursor.createdAt),
              and(eq(donations.created_at, cursor.createdAt), lt(donations.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(donations.created_at), desc(donations.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const items = page.map(({ created_at: _created, ...r }) => ({
    ...r,
    payment_captured_at: r.payment_captured_at ? r.payment_captured_at.toISOString() : null,
  }));
  ok(
    res,
    { items, next_cursor: hasMore && last ? encodeTimeCursor(last.created_at, last.id) : null },
    { count: items.length },
  );
});

/* ═══════════════════ CREATE routes ═══════════════════ */

const createCurriculumSchema = z.object({
  name: z.string().min(1).max(300),
  // Q2 — free-form `kind` stored anything: `kind:"MSV"` became an inert orphan
  // that the Q2 check below (an exact "msv" compare) never saw, one
  // case-normalisation change away from a city_admin creating MSV curricula.
  // Backed by a CHECK constraint in migration 0070.
  kind: z.enum(["standard", "msv"]).default("standard"),
  academic_year: z.string().max(20).optional(),
  city_id: z.string().uuid().optional(),
});

/* POST /v1/admin/curricula */
router.post("/curricula", requireRole("super_admin", "state_admin", "city_admin"), async (req: Request, res: Response) => {
  let body: z.infer<typeof createCurriculumSchema>;
  try { body = createCurriculumSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid curriculum data."); return; }
  // Validate the caller may write to the requested city scope. `cityIdsForUser`
  // returns null for super_admin (unrestricted, incl. national/null) or the set
  // of city ids the caller owns. Non-super_admins may NOT create national
  // (city_id = null) courses, and may only target cities in their scope.
  const cityIds = await cityIdsForUser(req.authUser!);
  if (cityIds !== null) {
    if (!body.city_id || !cityIds.includes(body.city_id)) {
      fail(res, 403, "ERR_FORBIDDEN", "City not in your scope."); return;
    }
  }
  // Q2 / CU8 — kind='msv' (and national city_id null, already blocked above for
  // non-super) is super_admin only at the service layer.
  if (body.kind === "msv" && req.authUser!.role !== "super_admin") {
    fail(res, 403, "ERR_FORBIDDEN", "Only a super_admin may create MSV courses.");
    return;
  }
  const [row] = await db.insert(courses).values({
    name_en: body.name,
    kind: body.kind,
    academic_year: body.academic_year ?? null,
    city_id: body.city_id ?? null,
    status: "draft",
  }).returning({ id: courses.id, name: courses.name_en });
  await auditFromReq(req, {
    action: "create",
    entityKind: "curriculum",
    entityId: row.id,
    summary: `Created curriculum "${row.name}".`,
    metadata: { kind: body.kind, city_id: body.city_id ?? null },
  });
  ok(res, row);
});

const createExamSchema = z
  .object({
    title_en: z.string().min(1).max(500),
    // Required: the old `title_hi ?? title_en` fallback wrote Latin text into a
    // Devanagari column, which CLAUDE.md forbids. The create dialog already
    // blocks submit on an empty Hindi title, so nothing client-side changes.
    title_hi: z.string().min(1).max(500),
    // Accepted, not stripped — the schema is not .strict(), so Zod silently
    // dropped the descriptions the dialog has been sending all along.
    description_en: z.string().max(2000).nullable().optional(),
    description_hi: z.string().max(2000).nullable().optional(),
    city_id: z.string().uuid(),
    window_start: z.string().datetime(),
    window_end: z.string().datetime(),
    total_marks: z.coerce.number().int().min(1).default(100),
    pass_mark: z.coerce.number().int().min(0).default(40),
    max_attempts: z.coerce.number().int().min(1).default(1),
    // SPEC §5.14 per-exam Punya overrides — NULL means punya config (AT21).
    completion_points: z.coerce.number().int().min(0).nullable().optional(),
    top_score_points: z.coerce.number().int().min(0).nullable().optional(),
    exam_otp: z.string().max(20).optional(),
  })
  .superRefine((data, ctx) => {
    if (new Date(data.window_start).getTime() >= new Date(data.window_end).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["window_end"],
        message: "The exam must end after it starts — check the window dates.",
      });
    }
    if (data.pass_mark > data.total_marks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pass_mark"],
        message: "Pass mark cannot be higher than total marks.",
      });
    }
  });

/* POST /v1/admin/exams */
router.post("/exams", requireRole("super_admin", "state_admin", "city_admin"), async (req: Request, res: Response) => {
  let body: z.infer<typeof createExamSchema>;
  try { body = createExamSchema.parse(req.body); }
  catch (err) {
    const msg =
      err instanceof z.ZodError
        ? (err.issues[0]?.message ?? "Invalid exam data.")
        : "Invalid exam data.";
    fail(res, 422, "ERR_VALIDATION_FAILED", msg);
    return;
  }
  const cityIds = await cityIdsForUser(req.authUser!);
  if (cityIds !== null && !cityIds.includes(body.city_id)) {
    fail(res, 403, "ERR_FORBIDDEN", "City not in your scope."); return;
  }

  // Empty string = no access code. Undefined = auto-generate. Non-empty = use as given.
  const wantsOtp = body.exam_otp !== "";
  const plaintextOtp = wantsOtp
    ? (body.exam_otp && body.exam_otp.length > 0 ? body.exam_otp : generateExamAccessCode())
    : null;
  const examOtpHash = plaintextOtp ? await hashOtpCode(plaintextOtp) : null;

  const [row] = await db.insert(online_exams).values({
    title_en: body.title_en,
    title_hi: body.title_hi,
    description_en: body.description_en ?? null,
    description_hi: body.description_hi ?? null,
    city_id: body.city_id,
    window_start: new Date(body.window_start),
    window_end: new Date(body.window_end),
    total_marks: body.total_marks,
    pass_mark: body.pass_mark,
    max_attempts: body.max_attempts,
    completion_points: body.completion_points ?? null,
    top_score_points: body.top_score_points ?? null,
    exam_otp: null,
    exam_otp_hash: examOtpHash,
  }).returning({ id: online_exams.id, title_en: online_exams.title_en });
  // Plaintext returned exactly once — never stored, never listable again.
  ok(res, { ...row, exam_otp: plaintextOtp });
});

const createNiyamSchema = z.object({
  title_en: z.string().min(1).max(300),
  title_hi: z.string().max(300).nullable().optional(),
  description_en: z.string().max(2000).optional(),
  description_hi: z.string().max(2000).optional(),
  niyam_type: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  proof_type: z.enum(["photo", "video", "audio", "either", "any"]).default("either"),
  proof_required: z.boolean().optional(),
  approval_mode: z.enum(["auto", "review"]).default("auto"),
  max_uploads: z.coerce.number().int().min(0).max(10).default(3),
  points: z.coerce.number().int().min(0).max(1000).default(10),
  is_active: z.boolean().default(true),
  scope: z.enum(["national", "state", "city"]).default("national"),
  state_id: z.string().uuid().optional(),
  city_id: z.string().uuid().optional(),
  msv_audience: z.enum(["all", "msv", "non_msv"]).default("all"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

function authorizeNiyamGeo(
  role: string,
  userStateId: string | null | undefined,
  userCityId: string | null | undefined,
  scope: "national" | "state" | "city",
  stateId: string | null,
  cityId: string | null,
): string | null {
  if (scope === "national") {
    if (role !== "super_admin") return "Only national admins can create national niyams.";
    return null;
  }
  if (scope === "state") {
    if (!stateId) return "state_id is required for state-scoped niyams.";
    if (role === "super_admin") return null;
    if (role === "state_admin" && userStateId === stateId) return null;
    return "You can only create state niyams for your own state.";
  }
  // city
  if (!cityId) return "city_id is required for city-scoped niyams.";
  if (role === "super_admin") return null;
  if (role === "city_admin" && userCityId === cityId) return null;
  if (role === "state_admin") return null; // city-in-state checked by caller via cityIdsForState
  return "You can only create city niyams inside your scope.";
}

/* POST /v1/admin/niyams */
router.post("/niyams", requireRole("super_admin", "state_admin", "city_admin"), async (req: Request, res: Response) => {
  let body: z.infer<typeof createNiyamSchema>;
  try { body = createNiyamSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid niyam data."); return; }

  const role = req.authUser!.role;
  let stateId = body.state_id ?? null;
  let cityId = body.city_id ?? null;

  // Fill geography from the caller's own assignment when omitted.
  if (body.scope === "state" && !stateId && role === "state_admin") {
    stateId = req.authUser!.state_id ?? null;
  }
  if (body.scope === "city" && !cityId && role === "city_admin") {
    cityId = req.authUser!.city_id ?? null;
  }

  if (body.scope === "city" && cityId) {
    const [cityRow] = await db.select({ id: cities.id, state_id: cities.state_id }).from(cities).where(eq(cities.id, cityId)).limit(1);
    if (!cityRow) { fail(res, 404, "ERR_NOT_FOUND", "City not found."); return; }
    stateId = cityRow.state_id;
    if (role === "state_admin") {
      const allowed = req.authUser!.state_id ? await cityIdsForState(req.authUser!.state_id) : [];
      if (!allowed.includes(cityId)) {
        fail(res, 403, "ERR_FORBIDDEN", "That city is outside your state."); return;
      }
    }
  }
  if (body.scope === "national") {
    stateId = null;
    cityId = null;
  }

  const geoErr = authorizeNiyamGeo(
    role,
    req.authUser!.state_id,
    req.authUser!.city_id,
    body.scope,
    stateId,
    cityId,
  );
  if (geoErr) { fail(res, 403, "ERR_FORBIDDEN", geoErr); return; }

  const boundsErr = await validateNiyamPointsBounds(body.points);
  if (boundsErr) {
    fail(res, 422, "ERR_VALIDATION_FAILED", boundsErr.message);
    return;
  }

  const proofRequired =
    body.proof_required ??
    (body.proof_type === "photo" || body.proof_type === "video" || body.proof_type === "audio");

  const [row] = await db.insert(niyams).values({
    title_en: body.title_en,
    // Never default to the English title (H13): that made `title_hi ?? title_en`
    // dead at every render site and hid the missing translation entirely.
    title_hi: body.title_hi?.trim() ? body.title_hi : null,
    description_en: body.description_en ?? null,
    description_hi: body.description_hi ?? null,
    niyam_type: body.niyam_type,
    proof_type: body.proof_type,
    proof_required: proofRequired,
    approval_mode: body.approval_mode,
    max_uploads: body.max_uploads,
    points: body.points,
    is_active: body.is_active,
    scope: body.scope,
    state_id: stateId,
    city_id: cityId,
    msv_audience: body.msv_audience,
    ...(body.start_date ? { start_date: body.start_date } : {}),
    ...(body.end_date !== undefined ? { end_date: body.end_date } : {}),
  }).returning({ id: niyams.id, title_en: niyams.title_en, is_active: niyams.is_active });
  await auditFromReq(req, {
    action: "create",
    entityKind: "niyam",
    entityId: row.id,
    summary: `Niyam ${row.title_en} created.`,
    metadata: { scope: body.scope, msv_audience: body.msv_audience },
  });
  ok(res, row, undefined, 201);
});

const patchNiyamSchema = z.object({
  is_active: z.boolean().optional(),
  title_en: z.string().min(1).max(300).optional(),
  title_hi: z.string().max(300).nullable().optional(),
  description_en: z.string().max(2000).nullable().optional(),
  description_hi: z.string().max(2000).nullable().optional(),
  points: z.coerce.number().int().min(0).max(1000).optional(),
  proof_type: z.enum(["photo", "video", "audio", "either", "any"]).optional(),
  proof_required: z.boolean().optional(),
  approval_mode: z.enum(["auto", "review"]).optional(),
  max_uploads: z.coerce.number().int().min(0).max(10).optional(),
  msv_audience: z.enum(["all", "msv", "non_msv"]).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/* PATCH /v1/admin/niyams/:id — enable/disable + limited edits */
router.patch("/niyams/:id", requireRole("super_admin", "state_admin", "city_admin"), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) { fail(res, 404, "ERR_NOT_FOUND", "Niyam not found."); return; }
  let body: z.infer<typeof patchNiyamSchema>;
  try { body = patchNiyamSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid niyam update."); return; }
  if (Object.keys(body).length === 0) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "No fields to update."); return;
  }

  if (body.points !== undefined) {
    const boundsErr = await validateNiyamPointsBounds(body.points);
    if (boundsErr) {
      fail(res, 422, "ERR_VALIDATION_FAILED", boundsErr.message);
      return;
    }
  }

  const [existing] = await db.select().from(niyams).where(eq(niyams.id, id)).limit(1);
  if (!existing) { fail(res, 404, "ERR_NOT_FOUND", "Niyam not found."); return; }

  // Scope-of-edit: city admins only touch city niyams in their city; state admins
  // their state; super_admin anything.
  const role = req.authUser!.role;
  if (role === "city_admin") {
    if (existing.scope !== "city" || existing.city_id !== req.authUser!.city_id) {
      fail(res, 403, "ERR_FORBIDDEN", "You can only update city niyams in your city."); return;
    }
  } else if (role === "state_admin") {
    if (existing.scope === "national") {
      fail(res, 403, "ERR_FORBIDDEN", "You cannot update national niyams."); return;
    }
    if (existing.state_id !== req.authUser!.state_id) {
      fail(res, 403, "ERR_FORBIDDEN", "That niyam is outside your state."); return;
    }
  }

  const [row] = await db.update(niyams).set({
    ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
    ...(body.title_en !== undefined ? { title_en: body.title_en } : {}),
    ...(body.title_hi !== undefined ? { title_hi: body.title_hi } : {}),
    ...(body.description_en !== undefined ? { description_en: body.description_en } : {}),
    ...(body.description_hi !== undefined ? { description_hi: body.description_hi } : {}),
    ...(body.points !== undefined ? { points: body.points } : {}),
    ...(body.proof_type !== undefined ? { proof_type: body.proof_type } : {}),
    ...(body.proof_required !== undefined ? { proof_required: body.proof_required } : {}),
    ...(body.approval_mode !== undefined ? { approval_mode: body.approval_mode } : {}),
    ...(body.max_uploads !== undefined ? { max_uploads: body.max_uploads } : {}),
    ...(body.msv_audience !== undefined ? { msv_audience: body.msv_audience } : {}),
    ...(body.start_date !== undefined ? { start_date: body.start_date } : {}),
    ...(body.end_date !== undefined ? { end_date: body.end_date } : {}),
  }).where(eq(niyams.id, id)).returning({
    id: niyams.id,
    title_en: niyams.title_en,
    is_active: niyams.is_active,
    proof_type: niyams.proof_type,
    proof_required: niyams.proof_required,
    approval_mode: niyams.approval_mode,
    max_uploads: niyams.max_uploads,
    msv_audience: niyams.msv_audience,
  });
  await auditFromReq(req, {
    action: "update",
    entityKind: "niyam",
    entityId: row.id,
    summary: body.is_active === undefined
      ? `Niyam ${row.title_en} updated.`
      : `Niyam ${row.title_en} ${row.is_active ? "enabled" : "disabled"}.`,
    metadata: body,
  });
  ok(res, row);
});

const createPunyaConfigSchema = z.object({
  feature_key: z.string().min(1).max(100),
  points: z.coerce.number().int().min(0).max(10000),
  is_active: z.boolean().default(true),
  /**
   * null = a GLOBAL default applying to every city. Omitted = "my city" for a
   * city_admin. The route previously accepted neither and always wrote a global
   * row, so one city administrator typing `niyam_submission` into a free-text
   * box silently re-priced every niyam in the country.
   */
  city_id: z.string().uuid().nullable().optional(),
});

/**
 * Resolve and authorize the city scope of a punya config write.
 *
 * A global row (city_id null) overrides the authored per-niyam points
 * everywhere, so writing one is a super_admin act. Everyone else is pinned to a
 * city they actually administer.
 */
async function resolvePunyaConfigCity(
  req: Request,
  requested: string | null | undefined,
): Promise<{ cityId: string | null } | { error: { status: number; message: string } }> {
  const role = req.authUser!.role;

  if (role === "super_admin") {
    return { cityId: requested ?? null };
  }

  if (requested === null) {
    return {
      error: {
        status: 403,
        message: "Only a super admin can set a global points value — choose a city instead.",
      },
    };
  }

  if (role === "city_admin") {
    const own = req.authUser!.city_id ?? null;
    if (!own) {
      return { error: { status: 403, message: "Your account is not attached to a city." } };
    }
    if (requested && requested !== own) {
      return { error: { status: 403, message: "That city is outside your scope." } };
    }
    return { cityId: own };
  }

  if (role === "state_admin") {
    if (!requested) {
      return {
        error: { status: 422, message: "Choose a city in your state for this points value." },
      };
    }
    const allowed = req.authUser!.state_id ? await cityIdsForState(req.authUser!.state_id) : [];
    if (!allowed.includes(requested)) {
      return { error: { status: 403, message: "That city is outside your state." } };
    }
    return { cityId: requested };
  }

  return { error: { status: 403, message: "You cannot change points values." } };
}

/* POST /v1/admin/punya/configs */
router.post("/punya/configs", requireRole("super_admin", "state_admin", "city_admin"), async (req: Request, res: Response) => {
  let body: z.infer<typeof createPunyaConfigSchema>;
  try { body = createPunyaConfigSchema.parse(req.body); }
  catch (err) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid punya config data.", zodDetails(err));
    return;
  }

  const scoped = await resolvePunyaConfigCity(req, body.city_id);
  if ("error" in scoped) {
    fail(
      res,
      scoped.error.status,
      scoped.error.status === 422 ? "ERR_VALIDATION_FAILED" : "ERR_FORBIDDEN",
      scoped.error.message,
    );
    return;
  }

  // A config overrides the authored per-niyam points, so it must respect the
  // same punya_features min/max. The bounds check keyed on a different feature
  // than the award resolver reads, so overrides were never bounds-checked.
  const boundsErr = await validatePunyaConfigPointsBounds(body.feature_key, body.points);
  if (boundsErr) {
    fail(res, 422, "ERR_VALIDATION_FAILED", boundsErr.message);
    return;
  }

  let row: { id: string; feature_key: string } | undefined;
  try {
    [row] = await db.insert(punya_configs).values({
      feature_key: body.feature_key,
      points: body.points,
      is_active: body.is_active,
      city_id: scoped.cityId,
    }).returning({ id: punya_configs.id, feature_key: punya_configs.feature_key });
  } catch (err) {
    // Unique (feature_key, city_id) — duplicates made the award resolver's
    // unordered .limit(1) pick an arbitrary winner.
    if (isUniqueViolation(err)) {
      fail(
        res,
        409,
        "ERR_DUPLICATE",
        "A points value for that feature already exists here — edit the existing one instead.",
      );
      return;
    }
    throw err;
  }

  await invalidatePunyaPointCaches();
  await auditFromReq(req, {
    action: "create",
    entityKind: "punya_config",
    entityId: row!.id,
    summary: `Set punya config "${body.feature_key}" to ${body.points}${
      scoped.cityId ? "" : " (global)"
    }.`,
    metadata: { feature_key: body.feature_key, points: body.points, city_id: scoped.cityId },
  });
  ok(res, row);
});

const patchPunyaConfigSchema = z
  .object({
    points: z.coerce.number().int().min(0).max(10000).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

/* PATCH /v1/admin/punya/configs/:id — configs were create-only, so a
   mis-entered point value could never be corrected (CTY-API-09). feature_key
   and city scope stay immutable: changing what a config MEANS is a new
   config, not an edit. */
router.patch(
  "/punya/configs/:id",
  requireRole("super_admin", "state_admin", "city_admin"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isUuid(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Punya config not found.");
      return;
    }
    let body: z.infer<typeof patchPunyaConfigSchema>;
    try {
      body = patchPunyaConfigSchema.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid punya config data.");
      return;
    }
    if (body.points === undefined && body.is_active === undefined) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Provide points and/or is_active to update.");
      return;
    }

    // Scope the EDIT too. Without this a city_admin could retune a global row,
    // or another city's, which is the same nationwide re-pricing the create
    // route allowed.
    const [existing] = await db
      .select({
        city_id: punya_configs.city_id,
        feature_key: punya_configs.feature_key,
      })
      .from(punya_configs)
      .where(eq(punya_configs.id, id))
      .limit(1);
    if (!existing) {
      fail(res, 404, "ERR_NOT_FOUND", "Punya config not found.");
      return;
    }
    const scoped = await resolvePunyaConfigCity(req, existing.city_id);
    if ("error" in scoped || scoped.cityId !== existing.city_id) {
      fail(res, 404, "ERR_NOT_FOUND", "Punya config not found.");
      return;
    }
    if (body.points !== undefined) {
      const boundsErr = await validatePunyaConfigPointsBounds(existing.feature_key, body.points);
      if (boundsErr) {
        fail(res, 422, "ERR_VALIDATION_FAILED", boundsErr.message);
        return;
      }
    }

    const [row] = await db
      .update(punya_configs)
      .set({
        ...(body.points !== undefined ? { points: body.points } : {}),
        ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
        updated_at: new Date(),
      })
      .where(eq(punya_configs.id, id))
      .returning({ id: punya_configs.id, feature_key: punya_configs.feature_key });
    if (!row) {
      fail(res, 404, "ERR_NOT_FOUND", "Punya config not found.");
      return;
    }
    // Point values are AT21-cached — a stale cache would keep awarding the
    // old value after the correction.
    await invalidatePunyaPointCaches();
    await auditFromReq(req, {
      action: "update",
      entityKind: "punya_config",
      entityId: id,
      summary: `Updated punya config "${row.feature_key}".`,
      metadata: { fields: Object.keys(body) },
    });
    ok(res, row);
  },
);

const createCentreHolidaySchema = z.object({
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(500).optional(),
  is_published: z.boolean().optional(),
});

/* POST /v1/admin/centres/:id/holidays — sanchalak+ scoped (AT30 nested write) */
router.post(
  "/centres/:id/holidays",
  requireRole("super_admin", "state_admin", "city_admin", "sanchalak"),
  async (req: Request, res: Response) => {
    const centreId = String(req.params.id);
    let body: z.infer<typeof createCentreHolidaySchema>;
    try {
      body = createCentreHolidaySchema.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid holiday data.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    if (scope.centreIds !== null && !scope.centreIds.includes(centreId)) {
      fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope.");
      return;
    }
    const [row] = await db
      .insert(centre_holidays)
      .values({
        centre_id: centreId,
        holiday_date: body.holiday_date,
        reason: body.reason ?? null,
        is_published: body.is_published ?? true,
      })
      .returning({
        id: centre_holidays.id,
        holiday_date: centre_holidays.holiday_date,
        is_published: centre_holidays.is_published,
      });

    const { applyHolidayToSessions } = await import("../../services/session-materialise");
    await applyHolidayToSessions(centreId, body.holiday_date, body.holiday_date);

    await auditFromReq(req, {
      action: "create",
      entityKind: "centre_holiday",
      entityId: row.id,
      summary: `Holiday created for ${body.holiday_date}`,
      metadata: { centre_id: centreId, holiday_date: body.holiday_date },
    });

    ok(res, row);
  },
);

const createCentreHolidayRangeSchema = z
  .object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().max(500).optional(),
    is_published: z.boolean().optional(),
  })
  .refine((b) => b.end_date >= b.start_date, {
    message: "end_date must be on or after start_date.",
  });

/* POST /v1/admin/centres/:id/holidays/range — one ranged call with per-date
   results (SAN-PRF-01): the mobile app issued 20 serial single-date requests
   for a 20-day break, with a vague partial-failure story. */
router.post(
  "/centres/:id/holidays/range",
  requireRole("super_admin", "state_admin", "city_admin", "sanchalak"),
  async (req: Request, res: Response) => {
    const centreId = String(req.params.id);
    let body: z.infer<typeof createCentreHolidayRangeSchema>;
    try {
      body = createCentreHolidayRangeSchema.parse(req.body);
    } catch (err) {
      const msg =
        err instanceof z.ZodError ? (err.issues[0]?.message ?? "Invalid range.") : "Invalid range.";
      fail(res, 422, "ERR_VALIDATION_FAILED", msg);
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    if (scope.centreIds !== null && !scope.centreIds.includes(centreId)) {
      fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope.");
      return;
    }

    // Enumerate the calendar days (inclusive); cap so a typo'd year cannot
    // create thousands of rows.
    const dates: string[] = [];
    const cursor = new Date(`${body.start_date}T00:00:00Z`);
    const end = new Date(`${body.end_date}T00:00:00Z`);
    while (cursor.getTime() <= end.getTime() && dates.length <= 92) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    if (dates.length > 92) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "A holiday range can cover at most 92 days.");
      return;
    }

    const existing = await db
      .select({ holiday_date: centre_holidays.holiday_date })
      .from(centre_holidays)
      .where(
        and(
          eq(centre_holidays.centre_id, centreId),
          inArray(centre_holidays.holiday_date, dates),
        ),
      );
    const existingDates = new Set(existing.map((e) => String(e.holiday_date)));

    const toCreate = dates.filter((d) => !existingDates.has(d));
    const results = dates.map((d) => ({
      holiday_date: d,
      status: existingDates.has(d) ? ("already_exists" as const) : ("created" as const),
    }));

    if (toCreate.length > 0) {
      await db.insert(centre_holidays).values(
        toCreate.map((d) => ({
          centre_id: centreId,
          holiday_date: d,
          reason: body.reason ?? null,
          is_published: body.is_published ?? true,
        })),
      );
      // AT10 — future scheduled sessions with no marks inside the range are
      // removed; marked sessions stay.
      const { applyHolidayToSessions } = await import("../../services/session-materialise");
      await applyHolidayToSessions(centreId, body.start_date, body.end_date);
    }

    await auditFromReq(req, {
      action: "create",
      entityKind: "centre_holiday",
      entityId: centreId,
      summary: `Holiday range ${body.start_date} → ${body.end_date} (${toCreate.length} new day(s)).`,
      metadata: { centre_id: centreId, start_date: body.start_date, end_date: body.end_date },
    });

    ok(res, { results }, { created: toCreate.length, already_exists: existingDates.size });
  },
);

const patchCentreHolidaySchema = z.object({
  is_published: z.boolean(),
});

/* PATCH /v1/admin/centres/:id/holidays/:holidayId — publish/unpublish only (AT30) */
router.patch(
  "/centres/:id/holidays/:holidayId",
  requireRole("super_admin", "state_admin", "city_admin", "sanchalak"),
  async (req: Request, res: Response) => {
    const centreId = String(req.params.id);
    const holidayId = String(req.params.holidayId);
    if (!isUuid(centreId) || !isUuid(holidayId)) {
      fail(res, 404, "ERR_NOT_FOUND", "Holiday not found.");
      return;
    }
    let body: z.infer<typeof patchCentreHolidaySchema>;
    try {
      body = patchCentreHolidaySchema.parse(req.body);
    } catch {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid holiday update.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    if (scope.centreIds !== null && !scope.centreIds.includes(centreId)) {
      fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope.");
      return;
    }

    const [existing] = await db
      .select({
        id: centre_holidays.id,
        holiday_date: centre_holidays.holiday_date,
        is_published: centre_holidays.is_published,
        centre_id: centre_holidays.centre_id,
      })
      .from(centre_holidays)
      .where(and(eq(centre_holidays.id, holidayId), eq(centre_holidays.centre_id, centreId)))
      .limit(1);
    if (!existing) {
      fail(res, 404, "ERR_NOT_FOUND", "Holiday not found.");
      return;
    }

    const [row] = await db
      .update(centre_holidays)
      .set({ is_published: body.is_published })
      .where(eq(centre_holidays.id, existing.id))
      .returning({
        id: centre_holidays.id,
        holiday_date: centre_holidays.holiday_date,
        is_published: centre_holidays.is_published,
      });

    // Publication is AT30 public-read only — does NOT touch sessions.
    await auditFromReq(req, {
      action: "update",
      entityKind: "centre_holiday",
      entityId: row.id,
      summary: `Holiday ${row.holiday_date} ${body.is_published ? "published" : "unpublished"}.`,
      metadata: {
        centre_id: centreId,
        holiday_date: row.holiday_date,
        is_published: body.is_published,
      },
    });

    ok(res, row);
  },
);

/* DELETE /v1/admin/centres/:id/holidays/:holidayId — remove + rematerialise (AT10 undo) */
router.delete(
  "/centres/:id/holidays/:holidayId",
  requireRole("super_admin", "state_admin", "city_admin", "sanchalak"),
  async (req: Request, res: Response) => {
    const centreId = String(req.params.id);
    const holidayId = String(req.params.holidayId);
    if (!isUuid(centreId) || !isUuid(holidayId)) {
      fail(res, 404, "ERR_NOT_FOUND", "Holiday not found.");
      return;
    }
    const scope = await resolveAdminScope(req.authUser!);
    if (scope.centreIds !== null && !scope.centreIds.includes(centreId)) {
      fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope.");
      return;
    }

    const [existing] = await db
      .select({
        id: centre_holidays.id,
        holiday_date: centre_holidays.holiday_date,
        centre_id: centre_holidays.centre_id,
      })
      .from(centre_holidays)
      .where(and(eq(centre_holidays.id, holidayId), eq(centre_holidays.centre_id, centreId)))
      .limit(1);
    if (!existing) {
      fail(res, 404, "ERR_NOT_FOUND", "Holiday not found.");
      return;
    }

    await db.delete(centre_holidays).where(eq(centre_holidays.id, existing.id));

    // Holiday row must be gone before rematerialise so holidayDatesForCentre
    // no longer skips the date. ON CONFLICT DO NOTHING (AT7) prevents duplicating
    // any session that AT10 left because it already had attendance.
    const { rematerialiseCentreBatches } = await import("../../services/session-materialise");
    const restored = await rematerialiseCentreBatches(centreId);

    await auditFromReq(req, {
      action: "delete",
      entityKind: "centre_holiday",
      entityId: existing.id,
      summary: `Holiday removed for ${existing.holiday_date}; restored ${restored.inserted} sessions.`,
      metadata: {
        centre_id: centreId,
        holiday_date: existing.holiday_date,
        sessions_restored: restored.inserted,
        batches_touched: restored.batches,
      },
    });

    ok(res, {
      id: existing.id,
      holiday_date: existing.holiday_date,
      sessions_restored: restored.inserted,
    });
  },
);

/* Queues — super_admin only. NOTE: requireRole is applied PER-ROUTE, not via
 * queuesRouter.use(...), because this router is mounted at the admin-modules
 * root (router.use(queuesRouter)); a router-level .use() would leak the
 * super_admin guard onto every admin-modules route and 403 all other roles. */
const queuesRouter: IRouter = Router();

queuesRouter.get("/queues/stats", requireRole("super_admin"), async (_req: Request, res: Response) => {
  const rows = await db.select().from(queue_stats).orderBy(asc(queue_stats.queue_name));
  const items = rows.map((r) => ({ ...r, updated_at: r.updated_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

queuesRouter.get("/queues/:queueName/dlq", requireRole("super_admin"), async (req: Request, res: Response) => {
  const queueName = String(req.params.queueName);
  const limit = clampLimit(req.query.limit, 50, 200);
  const rows = await db
    .select()
    .from(queue_dlq_jobs)
    .where(and(eq(queue_dlq_jobs.queue_name, queueName), isNull(queue_dlq_jobs.replayed_at)))
    .orderBy(desc(queue_dlq_jobs.failed_at))
    .limit(limit);
  const items = rows.map((r) => ({
    id: r.id,
    job_id: r.job_id,
    queue_name: r.queue_name,
    payload: r.payload,
    error_message: r.error_message,
    failed_at: r.failed_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
});

queuesRouter.post("/queues/:queueName/dlq/:jobId/replay", requireRole("super_admin"), async (req: Request, res: Response) => {
  const queueName = String(req.params.queueName);
  const jobId = String(req.params.jobId);
  const [job] = await db
    .select()
    .from(queue_dlq_jobs)
    .where(
      and(
        eq(queue_dlq_jobs.queue_name, queueName),
        eq(queue_dlq_jobs.job_id, jobId),
        isNull(queue_dlq_jobs.replayed_at),
      ),
    )
    .limit(1);
  if (!job) {
    fail(res, 404, "ERR_NOT_FOUND", "DLQ job not found.");
    return;
  }
  await db
    .update(queue_dlq_jobs)
    .set({ replayed_at: new Date() })
    .where(eq(queue_dlq_jobs.id, job.id));

  const [stat] = await db
    .select()
    .from(queue_stats)
    .where(eq(queue_stats.queue_name, queueName))
    .limit(1);
  if (stat && stat.failed > 0) {
    await db
      .update(queue_stats)
      .set({ failed: stat.failed - 1, waiting: stat.waiting + 1, updated_at: new Date() })
      .where(eq(queue_stats.queue_name, queueName));
  }

  ok(res, { queue_name: queueName, job_id: jobId, replayed: true });
});

router.use(queuesRouter);

export default router;
