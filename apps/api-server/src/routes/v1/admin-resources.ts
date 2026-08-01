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
  shikshak_centre_assignments,
} from "@workspace/db";
import { ageGroupFromDob } from "@workspace/db";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, lt, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, cityIdsForState, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { awardPunya } from "../../lib/punya";
import { isClientSettingKey } from "../../lib/client-settings";
import { clampLimit, inScope, scopedCentreFilter } from "../../lib/route-helpers";
import { rejectionWindowFields } from "../../lib/niyam-constants";

const phoneSchema = z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164 (+91…)");
const bloodGroupSchema = z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]);
const guardianRelationSchema = z.enum(["father", "mother", "guardian"]);

const router: IRouter = Router();
router.use(requireAuth, requireAdminPanel);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;




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
    .where(and(isNull(centres.deleted_at), centreFilter))
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
    .where(and(isNull(students.deleted_at), centreFilter))
    .orderBy(desc(gallery_items.is_featured), desc(gallery_items.created_at))
    .limit(limit);
  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

/* POST /v1/admin/gallery/:id/feature */
router.post("/gallery/:id/feature", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const [item] = await db
    .select({ id: gallery_items.id, centre_id: students.centre_id })
    .from(gallery_items)
    .innerJoin(students, eq(students.id, gallery_items.student_id))
    .where(and(eq(gallery_items.id, id), isNull(students.deleted_at)))
    .limit(1);
  if (!item || !inScope(scope, item.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
    return;
  }
  await db.update(gallery_items).set({ is_featured: true }).where(eq(gallery_items.id, item.id));
  await auditFromReq(req, {
    action: "update",
    entityKind: "gallery_item",
    entityId: item.id,
    summary: "Gallery item featured.",
    metadata: { is_featured: true },
  });
  ok(res, { id: item.id, is_featured: true });
});

/* POST /v1/admin/gallery/:id/unfeature */
router.post("/gallery/:id/unfeature", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  const [item] = await db
    .select({ id: gallery_items.id, centre_id: students.centre_id })
    .from(gallery_items)
    .innerJoin(students, eq(students.id, gallery_items.student_id))
    .where(and(eq(gallery_items.id, id), isNull(students.deleted_at)))
    .limit(1);
  if (!item || !inScope(scope, item.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Gallery item not found.");
    return;
  }
  await db.update(gallery_items).set({ is_featured: false }).where(eq(gallery_items.id, item.id));
  await auditFromReq(req, {
    action: "update",
    entityKind: "gallery_item",
    entityId: item.id,
    summary: "Gallery item unfeatured.",
    metadata: { is_featured: false },
  });
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
      description_en: niyams.description_en,
      description_hi: niyams.description_hi,
      niyam_type: niyams.niyam_type,
      proof_type: niyams.proof_type,
      proof_required: niyams.proof_required,
      approval_mode: niyams.approval_mode,
      max_uploads: niyams.max_uploads,
      points: niyams.points,
      is_active: niyams.is_active,
      scope: niyams.scope,
      state_id: niyams.state_id,
      city_id: niyams.city_id,
      state_name: states.name,
      city_name: cities.name,
      msv_audience: niyams.msv_audience,
    })
    .from(niyams)
    .leftJoin(states, eq(states.id, niyams.state_id))
    .leftJoin(cities, eq(cities.id, niyams.city_id))
    .orderBy(desc(niyams.points));
  ok(res, { items: rows }, { count: rows.length });
});

function parseRepeatableQuery(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return [String(raw)].filter(Boolean);
}

function decodeAdminSubmissionCursor(raw: unknown): { date: string; id: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const i = decoded.indexOf("|");
    if (i < 0) return null;
    const date = decoded.slice(0, i);
    const id = decoded.slice(i + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !id) return null;
    return { date, id };
  } catch {
    return null;
  }
}

/* GET /v1/admin/niyam-submissions — filters + cursor on (submission_date desc, id desc) */
router.get("/niyam-submissions", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
  const statuses = parseRepeatableQuery(req.query.status);
  const studentId = typeof req.query.student_id === "string" ? req.query.student_id : null;
  const niyamId = typeof req.query.niyam_id === "string" ? req.query.niyam_id : null;
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const cursor = decodeAdminSubmissionCursor(req.query.cursor);

  const rows = await db
    .select({
      id: niyam_submissions.id,
      student_id: niyam_submissions.student_id,
      student_name: students.full_name,
      niyam_id: niyam_submissions.niyam_id,
      niyam_title_en: niyams.title_en,
      submission_date: niyam_submissions.submission_date,
      status: niyam_submissions.status,
      points_awarded: niyam_submissions.points_awarded,
      is_featured: niyam_submissions.is_featured,
      created_at: niyam_submissions.created_at,
    })
    .from(niyam_submissions)
    .innerJoin(students, eq(students.id, niyam_submissions.student_id))
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .where(
      and(
        isNull(students.deleted_at),
        centreFilter,
        statuses.length ? inArray(niyam_submissions.status, statuses as never) : undefined,
        studentId ? eq(niyam_submissions.student_id, studentId) : undefined,
        niyamId ? eq(niyam_submissions.niyam_id, niyamId) : undefined,
        from ? gte(niyam_submissions.submission_date, from) : undefined,
        to ? lte(niyam_submissions.submission_date, to) : undefined,
        cursor
          ? or(
              lt(niyam_submissions.submission_date, cursor.date),
              and(
                eq(niyam_submissions.submission_date, cursor.date),
                lt(niyam_submissions.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(niyam_submissions.submission_date), desc(niyam_submissions.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? Buffer.from(`${last.submission_date}|${last.id}`, "utf8").toString("base64url")
      : null;

  const items = page.map((r) => ({
    id: r.id,
    student_id: r.student_id,
    student_name: r.student_name,
    niyam_id: r.niyam_id,
    niyam_title_en: r.niyam_title_en,
    submission_date: r.submission_date,
    status: r.status,
    points_awarded: r.points_awarded,
    is_featured: r.is_featured,
    created_at: r.created_at.toISOString(),
    ...rejectionWindowFields(r.status, r.created_at),
  }));
  ok(res, { items, next_cursor: nextCursor }, { count: items.length });
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
    .where(and(isNull(students.deleted_at), centreFilter))
    .orderBy(desc(punya_transactions.created_at))
    .limit(limit);
  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

const punyaAwardSchema = z.object({
  student_id: z.string().uuid(),
  points: z.coerce.number().int().positive().max(500),
  note: z.string().max(500).optional(),
  // Optional client-supplied de-dupe token. When the same key is replayed (a
  // double-clicked submit, a retried request), the award is NOT credited twice
  // — awardPunya returns the original result. Backward compatible: callers that
  // omit it get the previous always-credit behaviour.
  idempotency_key: z.string().min(1).max(200).optional(),
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
    .where(and(eq(students.id, body.student_id), isNull(students.deleted_at)))
    .limit(1);
  if (!student || !inScope(scope, student.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
    return;
  }

  // Atomic + idempotent: the ledger insert, balance upsert, and tier recompute
  // all commit together inside awardPunya's transaction. Passing an idempotency
  // key makes a double-submit a no-op instead of double-crediting (the previous
  // select-then-insert here was both non-atomic AND non-idempotent).
  const result = await awardPunya({
    studentId: student.id,
    featureKey: "manual_award",
    points: body.points,
    note: body.note ?? null,
    awardedBy: req.authUser!.id,
    idempotencyKey: body.idempotency_key ?? null,
  });

  // Only audit a real credit; an idempotent replay didn't change anything.
  if (result.awarded) {
    await auditFromReq(req, {
      action: "award",
      entityKind: "student",
      entityId: student.id,
      summary: `Manual punya award (+${body.points}).`,
      metadata: {
        points: body.points,
        note: body.note ?? null,
        total_points: result.total_points,
        tier: result.tier,
        idempotency_key: body.idempotency_key ?? null,
      },
    });
  }

  ok(res, {
    student_id: result.student_id,
    points_awarded: result.points_awarded,
    total_points: result.total_points,
    tier: result.tier,
  });
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
    .where(and(eq(users.role, "shikshak"), isNull(users.deleted_at), eq(shikshak_batch_assignments.is_active, true), centreFilter))
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
    .where(and(isNull(students.deleted_at), centreFilter))
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
    .where(and(isNull(centres.deleted_at), centreFilter))
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
    .where(and(isNull(batches.deleted_at), isNull(centres.deleted_at), centreFilter))
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
      state_id: cities.state_id,
      state_name: states.name,
    })
    .from(cities)
    .innerJoin(states, eq(states.id, cities.state_id))
    .orderBy(asc(states.name), asc(cities.name));
  ok(res, { states: stateRows, cities: cityRows });
});

// States and cities are national reference data that every scope resolves
// against, so only super_admin may extend them — a state/city admin adding
// geography outside their own scope would silently widen it.
function requireNationalAdmin(req: Request, res: Response): boolean {
  if (req.authUser!.role !== "super_admin") {
    fail(res, 403, "ERR_FORBIDDEN", "Only national admins can manage geography.");
    return false;
  }
  return true;
}

const createStateSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(2).max(10).transform((s) => s.toUpperCase()),
});

/* POST /v1/admin/states */
router.post("/states", async (req: Request, res: Response) => {
  if (!requireNationalAdmin(req, res)) return;
  let body: z.infer<typeof createStateSchema>;
  try { body = createStateSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid state data."); return; }

  // No unique index on states — enforce it here so a duplicate name/code can't
  // split one state's centres across two rows.
  const [dupe] = await db
    .select({ id: states.id })
    .from(states)
    .where(or(eq(states.code, body.code), eq(states.name, body.name)))
    .limit(1);
  if (dupe) { fail(res, 409, "ERR_ALREADY_EXISTS", "That state already exists."); return; }

  const [row] = await db
    .insert(states)
    .values({ name: body.name, code: body.code })
    .returning({ id: states.id, name: states.name, code: states.code });
  await auditFromReq(req, {
    action: "create",
    entityKind: "state",
    entityId: row.id,
    summary: `State ${row.name} created.`,
    metadata: { name: row.name, code: row.code },
  });
  ok(res, row, undefined, 201);
});

const createCitySchema = z.object({
  state_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  code: z.string().min(2).max(10).transform((s) => s.toUpperCase()),
});

/* POST /v1/admin/cities */
router.post("/cities", async (req: Request, res: Response) => {
  if (!requireNationalAdmin(req, res)) return;
  let body: z.infer<typeof createCitySchema>;
  try { body = createCitySchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid city data."); return; }

  const [stateRow] = await db
    .select({ id: states.id })
    .from(states)
    .where(eq(states.id, body.state_id))
    .limit(1);
  if (!stateRow) { fail(res, 404, "ERR_NOT_FOUND", "State not found."); return; }

  // Same name twice within one state is a duplicate; the same name in another
  // state is legitimate (e.g. Aurangabad exists in more than one state).
  const [dupe] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(and(eq(cities.state_id, body.state_id), eq(cities.name, body.name)))
    .limit(1);
  if (dupe) { fail(res, 409, "ERR_ALREADY_EXISTS", "That city already exists in this state."); return; }

  const [row] = await db
    .insert(cities)
    .values({ state_id: body.state_id, name: body.name, code: body.code })
    .returning({ id: cities.id, name: cities.name, code: cities.code, state_id: cities.state_id });
  await auditFromReq(req, {
    action: "create",
    entityKind: "city",
    entityId: row.id,
    summary: `City ${row.name} created.`,
    metadata: { name: row.name, code: row.code, state_id: row.state_id },
  });
  ok(res, row, undefined, 201);
});

/* GET /v1/admin/settings */
router.get("/settings", async (_req: Request, res: Response) => {
  const rows = await db.select().from(settings).orderBy(asc(settings.key));
  ok(res, { items: rows.map((r) => ({ ...r, updated_at: r.updated_at.toISOString() })) });
});

const patchSettingSchema = z.object({
  key: z.string().min(1).max(128),
  value: z.string().max(4000),
});

/* PATCH /v1/admin/settings — super_admin only; allowlisted client keys only */
router.patch("/settings", async (req: Request, res: Response) => {
  if (req.authUser!.role !== "super_admin") {
    fail(res, 403, "ERR_FORBIDDEN", "Only super admins can update client settings.");
    return;
  }
  let body: z.infer<typeof patchSettingSchema>;
  try {
    body = patchSettingSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid settings payload.");
    return;
  }
  if (!isClientSettingKey(body.key)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "That settings key is not writable via this endpoint.");
    return;
  }

  const now = new Date();
  await db
    .insert(settings)
    .values({ key: body.key, value: body.value, updated_at: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: body.value, updated_at: now },
    });

  await auditFromReq(req, {
    action: "config_change",
    entityKind: "settings",
    entityId: body.key,
    summary: `Updated setting ${body.key}.`,
    metadata: { key: body.key, value: body.value },
  });

  ok(res, { key: body.key, value: body.value, updated_at: now.toISOString() });
});

/* ═══════════════════════════ CREATE endpoints ═══════════════════════════ */

const createCentreSchema = z.object({
  name: z.string().min(2).max(200),
  city_id: z.string().uuid(),
  state_id: z.string().uuid(),
  locality: z.string().max(200).optional(),
  pincode: z.string().max(10).optional(),
  contact_phone: z.string().max(15).optional(),
  contact_email: z.string().email().max(255).optional(),
});

/* POST /v1/admin/centres */
router.post("/centres", async (req: Request, res: Response) => {
  let body: z.infer<typeof createCentreSchema>;
  try { body = createCentreSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid centre data."); return; }
  // Only geography admins create centres (mirrors the shivirs create route). An
  // empty centre scope alone is NOT sufficient — a brand-new city/state admin, or
  // any sanchalak/shikshak with no assignments, also has an empty scope.
  const role = req.authUser!.role;
  if (role !== "super_admin" && role !== "state_admin" && role !== "city_admin") {
    fail(res, 403, "ERR_FORBIDDEN", "Only national/state/city admins can create centres.");
    return;
  }
  // The target city must be within the caller's scope, and the state must be the
  // city's actual state (never trust the client-supplied state_id).
  let allowedCityIds: string[] | null = null;
  if (role === "city_admin") allowedCityIds = req.authUser!.city_id ? [req.authUser!.city_id] : [];
  else if (role === "state_admin") allowedCityIds = req.authUser!.state_id ? (await cityIdsForState(req.authUser!.state_id)) : [];
  const [cityRow] = await db.select({ state_id: cities.state_id }).from(cities).where(eq(cities.id, body.city_id)).limit(1);
  if (!cityRow || (allowedCityIds !== null && !allowedCityIds.includes(body.city_id))) {
    fail(res, 403, "ERR_FORBIDDEN", "That city is outside your scope."); return;
  }
  const [row] = await db.insert(centres).values({
    name: body.name,
    city_id: body.city_id,
    state_id: cityRow.state_id,
    locality: body.locality ?? null,
    pincode: body.pincode ?? null,
    contact_phone: body.contact_phone ?? null,
    contact_email: body.contact_email ?? null,
  }).returning({ id: centres.id, name: centres.name });
  ok(res, row);
});

const createBatchSchema = z.object({
  centre_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  age_groups: z.array(z.enum(["bal", "kishor", "tarun", "yuva"])).min(1).max(4).optional(),
  /** @deprecated prefer age_groups */
  age_group: z.enum(["bal", "kishor", "tarun", "yuva"]).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  day_of_week: z.array(z.number().int().min(1).max(7)).default([]),
  capacity: z.coerce.number().int().min(1).max(500).default(30),
  /** Primary shikshak — must already be tagged to the centre. */
  primary_shikshak_id: z.string().uuid().optional(),
  /** @deprecated use primary_shikshak_id */
  shikshak_id: z.string().uuid().optional(),
}).superRefine((b, ctx) => {
  const groups = b.age_groups?.length ? b.age_groups : b.age_group ? [b.age_group] : [];
  if (groups.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "age_groups is required", path: ["age_groups"] });
  }
});

/* POST /v1/admin/batches */
router.post("/batches", async (req: Request, res: Response) => {
  let body: z.infer<typeof createBatchSchema>;
  try { body = createBatchSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid batch data."); return; }
  const scope = await resolveAdminScope(req.authUser!);
  if (!inScope(scope, body.centre_id)) {
    fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope."); return;
  }
  const age_groups = body.age_groups?.length
    ? Array.from(new Set(body.age_groups))
    : body.age_group
      ? [body.age_group]
      : [];
  if (age_groups.length === 0) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Select at least one age group."); return;
  }

  const primaryId = body.primary_shikshak_id ?? body.shikshak_id ?? null;
  if (primaryId) {
    const [u] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, primaryId), eq(users.is_active, true), isNull(users.deleted_at)))
      .limit(1);
    if (!u || u.role !== "shikshak") {
      fail(res, 422, "ERR_WRONG_ROLE", "primary_shikshak_id must be an active shikshak."); return;
    }
    const [tagged] = await db
      .select({ id: shikshak_centre_assignments.id })
      .from(shikshak_centre_assignments)
      .where(
        and(
          eq(shikshak_centre_assignments.user_id, primaryId),
          eq(shikshak_centre_assignments.centre_id, body.centre_id),
          eq(shikshak_centre_assignments.is_active, true),
        ),
      )
      .limit(1);
    if (!tagged) {
      fail(res, 422, "ERR_NOT_CENTRE_TAGGED", "Shikshak must be tagged to this centre first."); return;
    }

    const [row] = await db.transaction(async (tx) => {
      const [batch] = await tx.insert(batches).values({
        centre_id: body.centre_id,
        name: body.name,
        age_groups,
        start_time: body.start_time,
        end_time: body.end_time,
        day_of_week: body.day_of_week,
        capacity: body.capacity,
      }).returning({ id: batches.id, name: batches.name });
      await tx.insert(shikshak_batch_assignments).values({
        user_id: primaryId,
        batch_id: batch.id,
        is_primary: true,
        assigned_by: req.authUser!.id,
      });
      return [batch];
    });
    ok(res, row);
    return;
  }

  const [row] = await db.insert(batches).values({
    centre_id: body.centre_id,
    name: body.name,
    age_groups,
    start_time: body.start_time,
    end_time: body.end_time,
    day_of_week: body.day_of_week,
    capacity: body.capacity,
  }).returning({ id: batches.id, name: batches.name });
  ok(res, row);
});

const createStudentSchema = z.object({
  full_name: z.string().min(1).max(200),
  centre_id: z.string().uuid(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth is required (YYYY-MM-DD)."),
  batch_id: z.string().uuid().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  blood_group: bloodGroupSchema.optional(),
  parent_full_name: z.string().min(1).max(200),
  parent_phone: phoneSchema,
  guardian_relation: guardianRelationSchema,
  /** Ignored if sent — age group is always derived from dob. */
  age_group: z.enum(["bal", "kishor", "tarun", "yuva"]).optional(),
});

async function ensureParentLogin(opts: {
  phone: string;
  full_name: string;
  city_id: string | null;
  state_id: string | null;
  centre_id: string | null;
}): Promise<{ ok: true; userId: string; created: boolean } | { ok: false; message: string }> {
  const [existing] = await db
    .select({
      id: users.id,
      role: users.role,
      full_name: users.full_name,
      is_active: users.is_active,
    })
    .from(users)
    .where(and(eq(users.phone, opts.phone), isNull(users.deleted_at)))
    .limit(1);

  if (existing) {
    if (existing.role !== "parent") {
      return {
        ok: false,
        message: `Phone ${opts.phone} is already registered as ${existing.role}. Use a different parent number.`,
      };
    }
    if (!existing.is_active) {
      return { ok: false, message: "This parent account is inactive. Reactivate it before linking." };
    }
    if (existing.full_name !== opts.full_name.trim()) {
      await db
        .update(users)
        .set({ full_name: opts.full_name.trim(), updated_at: new Date() })
        .where(eq(users.id, existing.id));
    }
    return { ok: true, userId: existing.id, created: false };
  }

  const [row] = await db
    .insert(users)
    .values({
      phone: opts.phone,
      full_name: opts.full_name.trim(),
      role: "parent",
      city_id: opts.city_id,
      state_id: opts.state_id,
      centre_id_default: opts.centre_id,
      is_active: true,
      preferred_language: "en",
    })
    .returning({ id: users.id });
  return { ok: true, userId: row.id, created: true };
}

/* POST /v1/admin/students */
router.post("/students", async (req: Request, res: Response) => {
  let body: z.infer<typeof createStudentSchema>;
  try {
    body = createStudentSchema.parse(req.body);
  } catch (err) {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid student data." : "Invalid student data.",
    );
    return;
  }

  const age_group = ageGroupFromDob(body.dob);
  if (!age_group) {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      "Date of birth must yield an age between 5 and 21 years (Bal–Yuva).",
    );
    return;
  }

  const scope = await resolveAdminScope(req.authUser!);
  if (!inScope(scope, body.centre_id)) {
    fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope.");
    return;
  }

  const [centre] = await db
    .select({ id: centres.id, city_id: centres.city_id, state_id: centres.state_id })
    .from(centres)
    .where(and(eq(centres.id, body.centre_id), isNull(centres.deleted_at)))
    .limit(1);
  if (!centre) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
    return;
  }

  if (body.batch_id) {
    const [batch] = await db
      .select({ id: batches.id, centre_id: batches.centre_id, age_groups: batches.age_groups })
      .from(batches)
      .where(and(eq(batches.id, body.batch_id), isNull(batches.deleted_at)))
      .limit(1);
    if (!batch || batch.centre_id !== body.centre_id) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Batch must belong to the selected centre.");
      return;
    }
    const allowed = (batch.age_groups as string[] | null) ?? [];
    if (allowed.length > 0 && !allowed.includes(age_group)) {
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        `This batch does not accept age group ${age_group} (from date of birth).`,
      );
      return;
    }
  }

  const parent = await ensureParentLogin({
    phone: body.parent_phone,
    full_name: body.parent_full_name,
    city_id: centre.city_id,
    state_id: centre.state_id,
    centre_id: centre.id,
  });
  if (!parent.ok) {
    fail(res, 409, "ERR_DUPLICATE", parent.message);
    return;
  }

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(students);
  const student_code = `STU${String((total ?? 0) + 1).padStart(6, "0")}`;
  const [row] = await db
    .insert(students)
    .values({
      full_name: body.full_name.trim(),
      student_code,
      age_group,
      centre_id: body.centre_id,
      batch_id: body.batch_id ?? null,
      gender: body.gender ?? null,
      dob: body.dob,
      blood_group: body.blood_group ?? null,
      guardian_relation: body.guardian_relation,
      parent_id: parent.userId,
    })
    .returning({
      id: students.id,
      student_code: students.student_code,
      full_name: students.full_name,
      age_group: students.age_group,
      parent_id: students.parent_id,
      blood_group: students.blood_group,
    });

  await auditFromReq(req, {
    action: "create",
    entityKind: "student",
    entityId: row.id,
    summary: `Registered student ${row.full_name} (${row.student_code}).`,
    metadata: {
      parent_id: parent.userId,
      parent_created: parent.created,
      age_group,
      guardian_relation: body.guardian_relation,
    },
  });

  ok(res, { ...row, parent_created: parent.created });
});

const createNoticeSchema = z.object({
  title_en: z.string().min(1).max(500),
  title_hi: z.string().max(500).optional(),
  content_en: z.string().max(5000).optional(),
  content_hi: z.string().max(5000).optional(),
  audience: z.enum(["batch", "centre", "city", "state", "national", "msv"]).default("national"),
  is_public: z.boolean().default(false),
  pinned: z.boolean().default(false),
  is_critical: z.boolean().default(false),
  centre_id: z.string().uuid().optional(),
  publish_now: z.boolean().default(true),
});

/* POST /v1/admin/notices */
router.post("/notices", async (req: Request, res: Response) => {
  let body: z.infer<typeof createNoticeSchema>;
  try { body = createNoticeSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid notice data."); return; }
  const scope = await resolveAdminScope(req.authUser!);
  // Audience-based authorization (mirrors authorizeWrite in notices.ts):
  //  - national / msv  → super_admin only
  //  - state           → state_admin (their own state) or super_admin
  //  - city            → city_admin (their own city) / state_admin / super_admin
  //  - centre / batch  → target centre must be inside the caller's scope
  // Without this, createNoticeSchema's defaults (audience="national",
  // publish_now=true) let any admin-panel role publish an org-wide notice.
  const role = req.authUser!.role;
  if (role !== "super_admin") {
    switch (body.audience) {
      case "national":
      case "msv":
        fail(res, 403, "ERR_FORBIDDEN", "Only national admins can publish to this audience."); return;
      case "state":
        if (role !== "state_admin" || !req.authUser!.state_id) {
          fail(res, 403, "ERR_FORBIDDEN", "You cannot target this state."); return;
        }
        break;
      case "city":
        if (role !== "city_admin" && role !== "state_admin") {
          fail(res, 403, "ERR_FORBIDDEN", "You cannot target this city."); return;
        }
        break;
      case "centre":
      case "batch":
        if (!inScope(scope, body.centre_id ?? null)) {
          fail(res, 403, "ERR_FORBIDDEN", "Target is not in your scope."); return;
        }
        break;
    }
  }
  const [row] = await db.insert(notices).values({
    title_en: body.title_en,
    title_hi: body.title_hi ?? null,
    content_en: body.content_en ?? null,
    content_hi: body.content_hi ?? null,
    audience: body.audience,
    is_public: body.is_public,
    pinned: body.pinned,
    is_critical: body.is_critical,
    centre_id: body.centre_id ?? null,
    created_by: req.authUser!.id,
    published_at: body.publish_now ? new Date() : null,
  }).returning({ id: notices.id, title_en: notices.title_en });
  await auditFromReq(req, {
    action: "create",
    entityKind: "notice",
    entityId: row.id,
    summary: `Created notice "${row.title_en}".`,
    metadata: { audience: body.audience, centre_id: body.centre_id ?? null },
  });
  ok(res, row);
});

const createShivirSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  city_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location_text: z.string().max(500).optional(),
  capacity: z.coerce.number().int().min(1).optional(),
  is_published: z.boolean().default(true),
  msv_only: z.boolean().default(false),
});

/* POST /v1/admin/shivirs */
router.post("/shivirs", async (req: Request, res: Response) => {
  let body: z.infer<typeof createShivirSchema>;
  try { body = createShivirSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid shivir data."); return; }
  const role = req.authUser!.role;
  if (role !== "super_admin" && role !== "state_admin" && role !== "city_admin") {
    fail(res, 403, "ERR_FORBIDDEN", "Only national/state/city admins can create shivirs."); return;
  }
  // The target city must be in the caller's scope. Resolve the caller's allowed
  // city ids (null = unrestricted for super_admin) and 403 on an out-of-scope city.
  let allowedCityIds: string[] | null = null;
  if (role === "city_admin") allowedCityIds = req.authUser!.city_id ? [req.authUser!.city_id] : [];
  else if (role === "state_admin") allowedCityIds = req.authUser!.state_id ? (await cityIdsForState(req.authUser!.state_id)) : [];
  const [cityRow] = await db.select({ state_id: cities.state_id }).from(cities).where(eq(cities.id, body.city_id)).limit(1);
  if (!cityRow || (allowedCityIds !== null && !allowedCityIds.includes(body.city_id))) {
    fail(res, 403, "ERR_FORBIDDEN", "That city is outside your scope."); return;
  }
  const [row] = await db.insert(shivir_events).values({
    name: body.name,
    description: body.description ?? null,
    city_id: body.city_id,
    state_id: cityRow?.state_id ?? null,
    start_date: body.start_date,
    end_date: body.end_date,
    location_text: body.location_text ?? null,
    capacity: body.capacity ?? null,
    is_published: body.is_published,
    msv_only: body.msv_only,
  }).returning({ id: shivir_events.id, name: shivir_events.name });
  await auditFromReq(req, {
    action: "create",
    entityKind: "shivir_event",
    entityId: row.id,
    summary: `Created shivir "${row.name}".`,
    metadata: { city_id: body.city_id, start_date: body.start_date, end_date: body.end_date },
  });
  ok(res, row);
});

export default router;
