/**
 * Admin APIs: curriculum, exams, donations, queues.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  centres,
  cities,
  curricula,
  curriculum_sections,
  curriculum_items,
  online_exams,
  exam_attempts,
  students,
  donation_campaigns,
  donations,
  queue_stats,
  queue_dlq_jobs,
  type User,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel, requireRole } from "../../middlewares/auth";
import { resolveAdminScope, cityIdsForState } from "../../lib/scope";

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** null = unrestricted; [] = see nothing */
async function cityIdsForUser(user: User): Promise<string[] | null> {
  if (user.role === "super_admin") return null;
  if (user.role === "city_admin" && user.city_id) return [user.city_id];
  if (user.role === "state_admin" && user.state_id) return cityIdsForState(user.state_id);
  const scope = await resolveAdminScope(user);
  if (scope.centreIds === null) return null;
  if (scope.centreIds.length === 0) return [];
  const rows = await db
    .select({ city_id: centres.city_id })
    .from(centres)
    .where(inArray(centres.id, scope.centreIds));
  return Array.from(new Set(rows.map((r) => r.city_id)));
}

function cityFilter(column: typeof curricula.city_id, ids: string[] | null) {
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
      id: curricula.id,
      name: curricula.name,
      kind: curricula.kind,
      academic_year: curricula.academic_year,
      status: curricula.status,
      city_name: cities.name,
      section_count: sql<number>`(
        select count(*)::int from ${curriculum_sections}
        where ${curriculum_sections.curriculum_id} = ${curricula.id}
      )`,
    })
    .from(curricula)
    .leftJoin(cities, eq(cities.id, curricula.city_id))
    .where(
      and(
        kind ? eq(curricula.kind, kind) : undefined,
        cityFilter(curricula.city_id, cityIds),
      ),
    )
    .orderBy(desc(curricula.created_at));

  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/admin/curricula/:id/tree */
router.get("/curricula/:id/tree", async (req: Request, res: Response) => {
  const cityIds = await cityIdsForUser(req.authUser!);
  const id = String(req.params.id);
  const [curriculum] = await db.select().from(curricula).where(eq(curricula.id, id)).limit(1);
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
    .from(curriculum_sections)
    .where(eq(curriculum_sections.curriculum_id, id))
    .orderBy(asc(curriculum_sections.order_index));

  const items = await db
    .select()
    .from(curriculum_items)
    .innerJoin(curriculum_sections, eq(curriculum_sections.id, curriculum_items.section_id))
    .where(eq(curriculum_sections.curriculum_id, id))
    .orderBy(asc(curriculum_items.order_index));

  ok(res, {
    curriculum: {
      id: curriculum.id,
      name: curriculum.name,
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
        .filter((row) => row.curriculum_items.section_id === s.id)
        .map((row) => ({
          id: row.curriculum_items.id,
          title_en: row.curriculum_items.title_en,
          title_hi: row.curriculum_items.title_hi,
          order_index: row.curriculum_items.order_index,
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
      city_name: cities.name,
      window_start: online_exams.window_start,
      window_end: online_exams.window_end,
      exam_otp: online_exams.exam_otp,
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

  const items = rows.map((r) => ({
    ...r,
    window_start: r.window_start.toISOString(),
    window_end: r.window_end.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
});

/* POST /v1/admin/exams/:id/release-results */
router.post("/exams/:id/release-results", async (req: Request, res: Response) => {
  const cityIds = await cityIdsForUser(req.authUser!);
  const id = String(req.params.id);
  const [exam] = await db.select().from(online_exams).where(eq(online_exams.id, id)).limit(1);
  if (!exam || (cityIds !== null && !cityIds.includes(exam.city_id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }
  await db.update(online_exams).set({ results_released: true }).where(eq(online_exams.id, id));
  ok(res, { id, results_released: true });
});

/* GET /v1/admin/exams/:id/attempts */
router.get("/exams/:id/attempts", async (req: Request, res: Response) => {
  const cityIds = await cityIdsForUser(req.authUser!);
  const id = String(req.params.id);
  const [exam] = await db.select().from(online_exams).where(eq(online_exams.id, id)).limit(1);
  if (!exam || (cityIds !== null && !cityIds.includes(exam.city_id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Exam not found.");
    return;
  }
  const rows = await db
    .select({
      id: exam_attempts.id,
      student_name: students.full_name,
      student_code: students.student_code,
      status: exam_attempts.status,
      score: exam_attempts.score,
      started_at: exam_attempts.started_at,
      submitted_at: exam_attempts.submitted_at,
    })
    .from(exam_attempts)
    .innerJoin(students, eq(students.id, exam_attempts.student_id))
    .where(eq(exam_attempts.exam_id, id))
    .orderBy(desc(exam_attempts.started_at));

  const items = rows.map((r) => ({
    ...r,
    started_at: r.started_at.toISOString(),
    submitted_at: r.submitted_at ? r.submitted_at.toISOString() : null,
  }));
  ok(res, { items }, { count: items.length });
});

/* GET /v1/admin/donations/campaigns */
router.get("/donations/campaigns", async (req: Request, res: Response) => {
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

/* GET /v1/admin/donations */
router.get("/donations", async (req: Request, res: Response) => {
  const cityIds = await cityIdsForUser(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 500);
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
    })
    .from(donations)
    .leftJoin(donation_campaigns, eq(donation_campaigns.id, donations.campaign_id))
    .leftJoin(cities, eq(cities.id, donation_campaigns.city_id))
    .where(
      cityIds === null
        ? undefined
        : cityIds.length === 0
          ? eq(donations.id, "00000000-0000-0000-0000-000000000000")
          : or(isNull(donation_campaigns.city_id), inArray(donation_campaigns.city_id, cityIds)),
    )
    .orderBy(desc(donations.created_at))
    .limit(limit);

  const items = rows.map((r) => ({
    ...r,
    payment_captured_at: r.payment_captured_at ? r.payment_captured_at.toISOString() : null,
  }));
  ok(res, { items }, { count: items.length });
});

/* Queues — super_admin only */
const queuesRouter: IRouter = Router();
queuesRouter.use(requireRole("super_admin"));

queuesRouter.get("/queues/stats", async (_req: Request, res: Response) => {
  const rows = await db.select().from(queue_stats).orderBy(asc(queue_stats.queue_name));
  const items = rows.map((r) => ({ ...r, updated_at: r.updated_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

queuesRouter.get("/queues/:queueName/dlq", async (req: Request, res: Response) => {
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

queuesRouter.post("/queues/:queueName/dlq/:jobId/replay", async (req: Request, res: Response) => {
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
