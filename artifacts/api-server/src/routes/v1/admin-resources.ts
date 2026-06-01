/**
 * Additional admin read/write routes backed by Postgres.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  students,
  enrolments,
  batches,
  centres,
  cities,
  states,
  users,
  sessions,
  attendance,
  punya_transactions,
  punya_balances,
  punya_configs,
  msv_enrolments,
  notices,
  gallery_items,
  library_items,
  shivir_events,
  niyams,
  niyam_submissions,
  centre_holidays,
  settings,
  shikshak_batch_assignments,
} from "@workspace/db";
import { tierForPoints } from "@workspace/db/enums";
import { and, asc, count, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, type AdminScope } from "../../lib/scope";

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);

function scopedCentreFilter(scope: AdminScope, column: PgColumn) {
  if (scope.centreIds === null) return undefined;
  if (scope.centreIds.length === 0) return sql`false`;
  return inArray(column, scope.centreIds);
}

function inScope(scope: AdminScope, centreId: string | null): boolean {
  if (scope.centreIds === null) return true;
  if (!centreId) return false;
  return scope.centreIds.includes(centreId);
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function noticeScopeWhere(scope: AdminScope) {
  if (scope.centreIds === null) return undefined;
  if (scope.centreIds.length === 0) return sql`false`;
  return or(
    isNull(notices.centre_id),
    inArray(notices.centre_id, scope.centreIds),
    eq(notices.audience, "national"),
  );
}

/* GET /v1/admin/centres */
router.get("/centres", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const centreFilter = scopedCentreFilter(scope, centres.id);
  const rows = await db
    .select({
      id: centres.id,
      name: centres.name,
      locality: centres.locality,
      city_name: cities.name,
      state_name: states.name,
      contact_phone: centres.contact_phone,
      status: centres.status,
      batch_count: sql<number>`count(${batches.id})::int`,
    })
    .from(centres)
    .innerJoin(cities, eq(cities.id, centres.city_id))
    .innerJoin(states, eq(states.id, centres.state_id))
    .leftJoin(batches, and(eq(batches.centre_id, centres.id), eq(batches.status, "active")))
    .where(centreFilter)
    .groupBy(centres.id, cities.name, states.name)
    .orderBy(asc(states.name), asc(cities.name), asc(centres.name));
  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/admin/notices */
router.get("/notices", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const rows = await db
    .select({
      id: notices.id,
      title_en: notices.title_en,
      title_hi: notices.title_hi,
      audience: notices.audience,
      is_public: notices.is_public,
      pinned: notices.pinned,
      is_critical: notices.is_critical,
      created_at: notices.created_at,
      published_at: notices.published_at,
    })
    .from(notices)
    .where(noticeScopeWhere(scope))
    .orderBy(desc(notices.pinned), desc(notices.published_at), desc(notices.created_at))
    .limit(limit);
  const items = rows.map((r) => ({
    ...r,
    created_at: r.created_at.toISOString(),
    published_at: r.published_at ? r.published_at.toISOString() : null,
  }));
  ok(res, { items }, { count: items.length });
});

/* GET /v1/admin/gallery */
router.get("/gallery", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
  const rows = await db
    .select({
      id: gallery_items.id,
      student_name: students.full_name,
      niyam_title_en: niyams.title_en,
      is_featured: gallery_items.is_featured,
      is_public: gallery_items.is_public,
      created_at: gallery_items.created_at,
    })
    .from(gallery_items)
    .innerJoin(students, eq(students.id, gallery_items.student_id))
    .innerJoin(niyams, eq(niyams.id, gallery_items.niyam_id))
    .where(centreFilter)
    .orderBy(desc(gallery_items.is_featured), desc(gallery_items.created_at))
    .limit(limit);
  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

/* POST /v1/admin/gallery/:id/feature */
router.post("/gallery/:id/feature", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const [item] = await db
    .select({ id: gallery_items.id, centre_id: students.centre_id })
    .from(gallery_items)
    .innerJoin(students, eq(students.id, gallery_items.student_id))
    .where(eq(gallery_items.id, String(req.params.id)))
    .limit(1);
  if (!item || !inScope(scope, item.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
    return;
  }
  await db.update(gallery_items).set({ is_featured: true }).where(eq(gallery_items.id, item.id));
  ok(res, { id: item.id, is_featured: true });
});

/* POST /v1/admin/gallery/:id/unfeature */
router.post("/gallery/:id/unfeature", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const [item] = await db
    .select({ id: gallery_items.id, centre_id: students.centre_id })
    .from(gallery_items)
    .innerJoin(students, eq(students.id, gallery_items.student_id))
    .where(eq(gallery_items.id, String(req.params.id)))
    .limit(1);
  if (!item || !inScope(scope, item.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
    return;
  }
  await db.update(gallery_items).set({ is_featured: false }).where(eq(gallery_items.id, item.id));
  ok(res, { id: item.id, is_featured: false });
});

/* GET /v1/admin/library */
router.get("/library", async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 100, 300);
  const rows = await db
    .select({
      id: library_items.id,
      content_type: library_items.content_type,
      title_en: library_items.title_en,
      title_hi: library_items.title_hi,
      access_tier: library_items.access_tier,
      is_published: library_items.is_published,
      created_at: library_items.created_at,
    })
    .from(library_items)
    .orderBy(desc(library_items.created_at))
    .limit(limit);
  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

/* GET /v1/admin/shivirs */
router.get("/shivirs", async (req: Request, res: Response) => {
  const limit = clampLimit(req.query.limit, 100, 200);
  const rows = await db
    .select({
      id: shivir_events.id,
      name: shivir_events.name,
      start_date: shivir_events.start_date,
      end_date: shivir_events.end_date,
      location_text: shivir_events.location_text,
      city_name: cities.name,
      is_published: shivir_events.is_published,
      capacity: shivir_events.capacity,
    })
    .from(shivir_events)
    .innerJoin(cities, eq(cities.id, shivir_events.city_id))
    .orderBy(desc(shivir_events.start_date))
    .limit(limit);
  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/admin/niyams */
router.get("/niyams", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: niyams.id,
      title_en: niyams.title_en,
      title_hi: niyams.title_hi,
      niyam_type: niyams.niyam_type,
      points: niyams.points,
      is_active: niyams.is_active,
    })
    .from(niyams)
    .orderBy(desc(niyams.points));
  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/admin/niyam-submissions */
router.get("/niyam-submissions", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
  const rows = await db
    .select({
      id: niyam_submissions.id,
      student_name: students.full_name,
      niyam_title_en: niyams.title_en,
      submission_date: niyam_submissions.submission_date,
      status: niyam_submissions.status,
      points_awarded: niyam_submissions.points_awarded,
      is_featured: niyam_submissions.is_featured,
    })
    .from(niyam_submissions)
    .innerJoin(students, eq(students.id, niyam_submissions.student_id))
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .where(centreFilter)
    .orderBy(desc(niyam_submissions.submission_date))
    .limit(limit);
  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/admin/punya/configs */
router.get("/punya/configs", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: punya_configs.id,
      feature_key: punya_configs.feature_key,
      points: punya_configs.points,
      is_active: punya_configs.is_active,
    })
    .from(punya_configs)
    .orderBy(asc(punya_configs.feature_key));
  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/admin/punya/transactions */
router.get("/punya/transactions", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 500);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
  const rows = await db
    .select({
      id: punya_transactions.id,
      student_name: students.full_name,
      student_code: students.student_code,
      feature_key: punya_transactions.feature_key,
      points: punya_transactions.points,
      note: punya_transactions.note,
      awarded_by_name: users.full_name,
      created_at: punya_transactions.created_at,
    })
    .from(punya_transactions)
    .innerJoin(students, eq(students.id, punya_transactions.student_id))
    .leftJoin(users, eq(users.id, punya_transactions.awarded_by))
    .where(centreFilter)
    .orderBy(desc(punya_transactions.created_at))
    .limit(limit);
  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

const punyaAwardSchema = z.object({
  student_id: z.string().uuid(),
  points: z.coerce.number().int().positive().max(500),
  note: z.string().max(500).optional(),
});

/* POST /v1/admin/punya/award */
router.post("/punya/award", async (req: Request, res: Response) => {
  let body: z.infer<typeof punyaAwardSchema>;
  try {
    body = punyaAwardSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid award payload.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const [student] = await db
    .select({ id: students.id, centre_id: students.centre_id })
    .from(students)
    .where(eq(students.id, body.student_id))
    .limit(1);
  if (!student || !inScope(scope, student.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
    return;
  }

  await db.insert(punya_transactions).values({
    student_id: student.id,
    feature_key: "manual_award",
    points: body.points,
    note: body.note ?? null,
    awarded_by: req.authUser!.id,
  });

  const [bal] = await db
    .select()
    .from(punya_balances)
    .where(eq(punya_balances.student_id, student.id))
    .limit(1);
  const newTotal = (bal?.total_points ?? 0) + body.points;
  const tier = tierForPoints(newTotal);
  if (bal) {
    await db
      .update(punya_balances)
      .set({ total_points: newTotal, tier })
      .where(eq(punya_balances.student_id, student.id));
  } else {
    await db.insert(punya_balances).values({
      student_id: student.id,
      total_points: newTotal,
      tier,
    });
  }

  ok(res, { student_id: student.id, points_awarded: body.points, total_points: newTotal, tier });
});

/* GET /v1/admin/shikshaks */
router.get("/shikshaks", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const centreFilter = scopedCentreFilter(scope, batches.centre_id);

  const rows = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      phone: users.phone,
      batch_count: sql<number>`count(distinct ${batches.id})::int`,
    })
    .from(users)
    .innerJoin(shikshak_batch_assignments, eq(shikshak_batch_assignments.user_id, users.id))
    .innerJoin(batches, eq(batches.id, shikshak_batch_assignments.batch_id))
    .where(and(eq(users.role, "shikshak"), eq(shikshak_batch_assignments.is_active, true), centreFilter))
    .groupBy(users.id)
    .orderBy(asc(users.full_name))
    .limit(limit);

  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/admin/msv-enrolments */
router.get("/msv-enrolments", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
  const rows = await db
    .select({
      id: msv_enrolments.id,
      student_name: students.full_name,
      student_code: students.student_code,
      status: msv_enrolments.status,
      reason: msv_enrolments.reason,
      created_at: msv_enrolments.created_at,
      decided_at: msv_enrolments.decided_at,
    })
    .from(msv_enrolments)
    .innerJoin(students, eq(students.id, msv_enrolments.student_id))
    .where(centreFilter)
    .orderBy(desc(msv_enrolments.created_at))
    .limit(limit);
  const items = rows.map((r) => ({
    ...r,
    created_at: r.created_at.toISOString(),
    decided_at: r.decided_at ? r.decided_at.toISOString() : null,
  }));
  ok(res, { items }, { count: items.length });
});

/* GET /v1/admin/holidays */
router.get("/holidays", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const centreFilter = scopedCentreFilter(scope, centre_holidays.centre_id);
  const rows = await db
    .select({
      id: centre_holidays.id,
      centre_name: centres.name,
      holiday_date: centre_holidays.holiday_date,
      reason: centre_holidays.reason,
    })
    .from(centre_holidays)
    .innerJoin(centres, eq(centres.id, centre_holidays.centre_id))
    .where(centreFilter)
    .orderBy(desc(centre_holidays.holiday_date))
    .limit(limit);
  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/admin/sessions — recent sessions in scope */
router.get("/sessions", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 50, 200);
  const centreFilter = scopedCentreFilter(scope, batches.centre_id);
  const rows = await db
    .select({
      id: sessions.id,
      session_date: sessions.session_date,
      status: sessions.status,
      topic: sessions.topic,
      batch_name: batches.name,
      centre_name: centres.name,
      present_count: sql<number>`count(${attendance.id}) filter (where ${attendance.status} in ('present','late'))::int`,
      total_count: sql<number>`count(${attendance.id})::int`,
    })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .leftJoin(attendance, eq(attendance.session_id, sessions.id))
    .where(centreFilter)
    .groupBy(sessions.id, batches.name, centres.name)
    .orderBy(desc(sessions.session_date))
    .limit(limit);
  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/admin/geography */
router.get("/geography", async (_req: Request, res: Response) => {
  const stateRows = await db
    .select({ id: states.id, name: states.name, code: states.code })
    .from(states)
    .orderBy(asc(states.name));
  const cityRows = await db
    .select({
      id: cities.id,
      name: cities.name,
      code: cities.code,
      state_name: states.name,
    })
    .from(cities)
    .innerJoin(states, eq(states.id, cities.state_id))
    .orderBy(asc(states.name), asc(cities.name));
  ok(res, { states: stateRows, cities: cityRows });
});

/* GET /v1/admin/settings */
router.get("/settings", async (_req: Request, res: Response) => {
  const rows = await db.select().from(settings).orderBy(asc(settings.key));
  ok(res, { items: rows.map((r) => ({ ...r, updated_at: r.updated_at.toISOString() })) });
});

export default router;
