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
  shivir_events,
  niyams,
  niyam_submissions,
  niyam_submission_media,
  centre_holidays,
  centre_monthly_reports,
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
import { resolveAdminScope, cityIdsForState, inBatchWriteScope, type AdminScope } from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { awardPunya } from "../../lib/punya";
import {
  allocateParentCode,
  allocateStudentCode,
  composePathshalaCode,
  localityToken,
  normalizeCodePart,
} from "../../lib/entity-codes";
import {
  resolveAwardLimit,
  pointsAwardedTodayBy,
  MANUAL_AWARD_FEATURE_KEY,
} from "../../lib/punya-award-limits";
import { isClientSettingKey } from "../../lib/client-settings";
import { clampLimit, inScope, scopedCentreFilter } from "../../lib/route-helpers";
import { rejectionWindowFields } from "../../lib/niyam-constants";
import { signUploadUrl } from "../../lib/file-tokens";
import { enqueueJob } from "../../lib/queues";
import { QUEUE_NAMES } from "@jp/shared/constants";
import { isValidReportMonth } from "../../lib/centre-monthly-report";
import { registerReportJobs } from "../../jobs/report-jobs";
import { logger } from "../../lib/logger";

/** Ensure inline (no-Redis) test/dev can run report.generation. */
registerReportJobs();
import { ErrorCode } from "@workspace/api-zod";

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
      code: centres.code,
      name: centres.name,
      locality: centres.locality,
      pincode: centres.pincode,
      city_name: cities.name,
      state_name: states.name,
      contact_phone: centres.contact_phone,
      contact_email: centres.contact_email,
      gps_radius_meters: centres.gps_radius_meters,
      status: centres.status,
      batch_count: sql<number>`count(distinct ${batches.id})::int`,
      active_student_count: sql<number>`(
        select count(*)::int from ${students}
        where ${students.centre_id} = ${centres.id}
          and ${students.status} = 'active'
          and ${students.deleted_at} is null
      )`,
    })
    .from(centres)
    .innerJoin(cities, eq(cities.id, centres.city_id))
    .innerJoin(states, eq(states.id, centres.state_id))
    .leftJoin(batches, and(eq(batches.centre_id, centres.id), eq(batches.status, "active"), isNull(batches.deleted_at)))
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
      featured_gallery: gallery_items.featured_gallery,
      featured_home: gallery_items.featured_home,
      is_public: gallery_items.is_public,
      created_at: gallery_items.created_at,
    })
    .from(gallery_items)
    .innerJoin(students, eq(students.id, gallery_items.student_id))
    .innerJoin(niyams, eq(niyams.id, gallery_items.niyam_id))
    .where(and(isNull(students.deleted_at), centreFilter))
    .orderBy(desc(gallery_items.featured_gallery), desc(gallery_items.created_at))
    .limit(limit);
  const items = rows.map((r) => ({
    ...r,
    is_featured: r.featured_gallery,
    created_at: r.created_at.toISOString(),
  }));
  ok(res, { items }, { count: items.length });
});

/* POST /v1/admin/gallery/:id/feature — legacy; prefer PATCH /v1/gallery/admin/:id/featured */
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
  await db
    .update(gallery_items)
    .set({
      featured_gallery: true,
      featured_at: new Date(),
      featured_by: req.authUser!.id,
      updated_at: new Date(),
    })
    .where(eq(gallery_items.id, item.id));
  await auditFromReq(req, {
    action: "update",
    entityKind: "gallery_item",
    entityId: item.id,
    summary: "Gallery item featured.",
    metadata: { featured_gallery: true },
  });
  ok(res, { id: item.id, featured_gallery: true, is_featured: true });
});

/* POST /v1/admin/gallery/:id/unfeature — legacy */
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
  await db
    .update(gallery_items)
    .set({
      featured_gallery: false,
      featured_home: false,
      featured_at: null,
      featured_by: null,
      updated_at: new Date(),
    })
    .where(eq(gallery_items.id, item.id));
  await auditFromReq(req, {
    action: "update",
    entityKind: "gallery_item",
    entityId: item.id,
    summary: "Gallery item unfeatured.",
    metadata: { featured_gallery: false, featured_home: false },
  });
  ok(res, { id: item.id, featured_gallery: false, is_featured: false });
});

/* GET /v1/admin/library — moved to admin-library router (draft/publish CRUD). */
/* (stub removed) */

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
      student_code: students.student_code,
      niyam_id: niyam_submissions.niyam_id,
      niyam_title_en: niyams.title_en,
      niyam_title_hi: niyams.title_hi,
      proof_url: niyam_submissions.proof_url,
      notes: niyam_submissions.notes,
      rejection_reason: niyam_submissions.rejection_reason,
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

  const ids = page.map((r) => r.id);
  const mediaAll = ids.length
    ? await db
        .select({
          id: niyam_submission_media.id,
          submission_id: niyam_submission_media.submission_id,
          url: niyam_submission_media.url,
          kind: niyam_submission_media.kind,
          mime: niyam_submission_media.mime,
          ordinal: niyam_submission_media.ordinal,
        })
        .from(niyam_submission_media)
        .where(inArray(niyam_submission_media.submission_id, ids))
        .orderBy(asc(niyam_submission_media.ordinal))
    : [];
  const mediaBySub = new Map<string, typeof mediaAll>();
  for (const m of mediaAll) {
    const list = mediaBySub.get(m.submission_id) ?? [];
    list.push(m);
    mediaBySub.set(m.submission_id, list);
  }

  const items = page.map((r) => ({
    id: r.id,
    student_id: r.student_id,
    student_name: r.student_name,
    student_code: r.student_code,
    niyam_id: r.niyam_id,
    niyam_title_en: r.niyam_title_en,
    niyam_title_hi: r.niyam_title_hi,
    proof_url: signUploadUrl(r.proof_url),
    notes: r.notes,
    rejection_reason: r.rejection_reason,
    media: (mediaBySub.get(r.id) ?? []).map((m) => ({
      id: m.id,
      url: signUploadUrl(m.url),
      kind: m.kind,
      mime: m.mime,
      ordinal: m.ordinal,
    })),
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
  points: z.coerce.number().int().positive(),
  note: z.string().max(500).optional(),
  // Optional client-supplied de-dupe token. When the same key is replayed (a
  // double-clicked submit, a retried request), the award is NOT credited twice
  // — awardPunya returns the original result. Backward compatible: callers that
  // omit it get the previous always-credit behaviour.
  idempotency_key: z.string().min(1).max(200).optional(),
});

/* GET /v1/admin/punya/award-limit */
router.get("/punya/award-limit", async (req: Request, res: Response) => {
  const role = req.authUser!.role;
  const limit = await resolveAwardLimit(role);
  const pointsAwardedToday = await pointsAwardedTodayBy(req.authUser!.id);
  const remainingToday =
    limit.maxPerDay == null ? null : Math.max(0, limit.maxPerDay - pointsAwardedToday);
  ok(res, {
    role,
    max_points_per_award: limit.maxPerAward,
    max_points_per_day: limit.maxPerDay,
    points_awarded_today: pointsAwardedToday,
    remaining_today: remainingToday,
  });
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
    .select({
      id: students.id,
      centre_id: students.centre_id,
      batch_id: students.batch_id,
    })
    .from(students)
    .where(and(eq(students.id, body.student_id), isNull(students.deleted_at)))
    .limit(1);
  if (!student || !inBatchWriteScope(scope, student.batch_id, student.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
    return;
  }

  const idemKey = body.idempotency_key?.trim() || null;
  let isReplay = false;
  if (idemKey) {
    const [existing] = await db
      .select({ id: punya_transactions.id })
      .from(punya_transactions)
      .where(eq(punya_transactions.idempotency_key, idemKey))
      .limit(1);
    isReplay = Boolean(existing);
  }

  const limit = await resolveAwardLimit(req.authUser!.role);
  const pointsAwardedToday = await pointsAwardedTodayBy(req.authUser!.id);

  if (!isReplay) {
    if (body.points > limit.maxPerAward) {
      fail(
        res,
        422,
        ErrorCode.AWARD_LIMIT_EXCEEDED,
        `That is more than you can award at once — the limit is ${limit.maxPerAward} Punya per award.`,
      );
      return;
    }
    if (limit.maxPerDay != null && pointsAwardedToday + body.points > limit.maxPerDay) {
      fail(
        res,
        429,
        ErrorCode.AWARD_DAILY_LIMIT_EXCEEDED,
        `You have reached today's award limit (${limit.maxPerDay} Punya) — try again tomorrow or ask a higher role to award.`,
      );
      return;
    }
  }

  // Atomic + idempotent: the ledger insert, balance upsert, and tier recompute
  // all commit together inside awardPunya's transaction. Passing an idempotency
  // key makes a double-submit a no-op instead of double-crediting (the previous
  // select-then-insert here was both non-atomic AND non-idempotent).
  const result = await awardPunya({
    studentId: student.id,
    featureKey: MANUAL_AWARD_FEATURE_KEY,
    points: body.points,
    note: body.note ?? null,
    awardedBy: req.authUser!.id,
    idempotencyKey: idemKey,
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
        idempotency_key: idemKey,
        max_per_award: limit.maxPerAward,
        points_awarded_today: pointsAwardedToday + body.points,
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

/* GET /v1/admin/centres/:id/holidays — sanchalak+ scoped (AT30) */
router.get(
  "/centres/:id/holidays",
  async (req: Request, res: Response) => {
    const role = req.authUser!.role;
    if (!["super_admin", "state_admin", "city_admin", "sanchalak"].includes(role)) {
      fail(res, 403, "ERR_FORBIDDEN", "Sanchalak or higher required.");
      return;
    }
    const centreId = String(req.params.id);
    const scope = await resolveAdminScope(req.authUser!);
    if (scope.centreIds !== null && !scope.centreIds.includes(centreId)) {
      fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope.");
      return;
    }
    const rows = await db
      .select({
        id: centre_holidays.id,
        holiday_date: centre_holidays.holiday_date,
        reason: centre_holidays.reason,
        is_published: centre_holidays.is_published,
      })
      .from(centre_holidays)
      .where(eq(centre_holidays.centre_id, centreId))
      .orderBy(desc(centre_holidays.holiday_date));

    // Per-row estimate for the delete confirm ("restore N cancelled sessions").
    const { countRestorableSessions } = await import("../../services/session-materialise");
    const items = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        restorable_session_count: await countRestorableSessions(centreId, r.holiday_date),
      })),
    );
    ok(res, { items }, { count: items.length });
  },
);

const monthlyReportBody = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

/* POST /v1/admin/centres/:id/reports/monthly — enqueue centre monthly PDF */
router.post(
  "/centres/:id/reports/monthly",
  async (req: Request, res: Response) => {
    const centreId = String(req.params.id);
    if (!UUID_RE.test(centreId)) {
      fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
      return;
    }
    const parsed = monthlyReportBody.safeParse(req.body ?? {});
    if (!parsed.success || !isValidReportMonth(parsed.data.month)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "month must be YYYY-MM.");
      return;
    }
    const month = parsed.data.month;
    const nowYm = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
    if (month > nowYm) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Cannot generate a report for a future month.");
      return;
    }

    const scope = await resolveAdminScope(req.authUser!);
    if (scope.centreIds !== null && !scope.centreIds.includes(centreId)) {
      fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope.");
      return;
    }
    const [centre] = await db
      .select({ id: centres.id })
      .from(centres)
      .where(and(eq(centres.id, centreId), isNull(centres.deleted_at)))
      .limit(1);
    if (!centre) {
      fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
      return;
    }

    // UNIQUE (centre_id, month) — re-queue overwrites a prior ready/failed row.
    const [row] = await db
      .insert(centre_monthly_reports)
      .values({
        centre_id: centreId,
        month,
        status: "queued",
        generated_by: req.authUser!.id,
      })
      .onConflictDoUpdate({
        target: [centre_monthly_reports.centre_id, centre_monthly_reports.month],
        set: {
          status: "queued",
          pdf_url: null,
          error_message: null,
          snapshot: null,
          generated_by: req.authUser!.id,
          updated_at: new Date(),
        },
      })
      .returning({ id: centre_monthly_reports.id });

    await auditFromReq(req, {
      action: "create",
      entityKind: "centre_monthly_report",
      entityId: row.id,
      summary: `Queued monthly report for centre ${centreId} (${month}).`,
      metadata: { centre_id: centreId, month },
    });

    // Return queued immediately; job may run inline when REDIS_URL is unset.
    void enqueueJob(QUEUE_NAMES.REPORT_GENERATION, { report_id: row.id }).catch((err) => {
      logger.warn({ err, reportId: row.id }, "report.generation enqueue failed");
    });

    ok(res, { job_id: row.id, status: "queued" as const });
  },
);

/* GET /v1/admin/centres/:id/reports?month=YYYY-MM — list with signed PDF URLs */
router.get("/centres/:id/reports", async (req: Request, res: Response) => {
  const centreId = String(req.params.id);
  if (!UUID_RE.test(centreId)) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
    return;
  }
  const scope = await resolveAdminScope(req.authUser!);
  if (scope.centreIds !== null && !scope.centreIds.includes(centreId)) {
    fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope.");
    return;
  }

  const monthQ = typeof req.query.month === "string" ? req.query.month : null;
  if (monthQ && !isValidReportMonth(monthQ)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "month must be YYYY-MM.");
    return;
  }

  const conditions = [eq(centre_monthly_reports.centre_id, centreId)];
  if (monthQ) conditions.push(eq(centre_monthly_reports.month, monthQ));

  const rows = await db
    .select({
      id: centre_monthly_reports.id,
      centre_id: centre_monthly_reports.centre_id,
      month: centre_monthly_reports.month,
      status: centre_monthly_reports.status,
      pdf_url: centre_monthly_reports.pdf_url,
      error_message: centre_monthly_reports.error_message,
      created_at: centre_monthly_reports.created_at,
      updated_at: centre_monthly_reports.updated_at,
    })
    .from(centre_monthly_reports)
    .where(and(...conditions))
    .orderBy(desc(centre_monthly_reports.created_at))
    .limit(50);

  const items = rows.map((r) => ({
    id: r.id,
    centre_id: r.centre_id,
    month: r.month,
    status: r.status,
    // Long-lived download like progress reports — still signed, never a public bucket URL.
    pdf_url: r.pdf_url ? signUploadUrl(r.pdf_url, 7 * 24 * 3600) : null,
    error_message: r.error_message,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  ok(res, { items }, { count: items.length });
});

/* GET /v1/admin/attendance/alerts — centre monitor (read-only; AT27 / AT6 / AT32) */
router.get("/attendance/alerts", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const centreId =
    typeof req.query.centre_id === "string" && req.query.centre_id.length > 0
      ? String(req.query.centre_id)
      : null;
  if (!centreId) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "centre_id is required.");
    return;
  }
  if (scope.centreIds !== null && !scope.centreIds.includes(centreId)) {
    fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope.");
    return;
  }

  const { todayIst } = await import("../../services/session-materialise");
  const { findConsecutiveAbsenceCandidates } = await import(
    "../../services/consecutive-absence"
  );
  const date =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : todayIst();

  const candidates = await findConsecutiveAbsenceCandidates({ centreId });
  const studentIds = candidates.map((c) => c.student_id);

  const studentMeta =
    studentIds.length === 0
      ? []
      : await db
          .select({
            id: students.id,
            batch_id: students.batch_id,
            batch_name: batches.name,
            parent_phone: users.phone,
          })
          .from(students)
          .leftJoin(batches, eq(batches.id, students.batch_id))
          .leftJoin(users, eq(users.id, students.parent_id))
          .where(inArray(students.id, studentIds));

  const lastAttendedRows =
    studentIds.length === 0
      ? []
      : (
          await db.execute(sql`
          select distinct on (a.student_id)
            a.student_id::text as student_id,
            s.scheduled_date::text as last_attended_date
          from attendance a
          inner join sessions s on s.id = a.session_id
          where a.student_id in (${sql.join(
            studentIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
            and a.status in ('present', 'late')
            and s.status <> 'cancelled'
          order by a.student_id, s.scheduled_date desc, s.id desc
        `)
        );
  const lastAttended = new Map<string, string>();
  const lastRows =
    (lastAttendedRows as unknown as { rows?: Array<{ student_id: string; last_attended_date: string }> })
      .rows ??
    (Array.isArray(lastAttendedRows)
      ? (lastAttendedRows as Array<{ student_id: string; last_attended_date: string }>)
      : []);
  for (const r of lastRows) {
    lastAttended.set(r.student_id, r.last_attended_date);
  }

  const metaByStudent = new Map(studentMeta.map((s) => [s.id, s]));
  const consecutive_absences = candidates.map((c) => {
    const meta = metaByStudent.get(c.student_id);
    return {
      student_id: c.student_id,
      student_name: c.full_name,
      batch_id: meta?.batch_id ?? null,
      batch_name: meta?.batch_name ?? null,
      consecutive_absent_count: Array.isArray(c.session_ids) ? c.session_ids.length : 3,
      last_attended_date: lastAttended.get(c.student_id) ?? null,
      parent_phone: meta?.parent_phone ?? null,
    };
  });

  // Today's (or ?date) sessions past scheduled_end (IST) with zero attendance rows (AT6).
  const sessionRows = await db
    .select({
      id: sessions.id,
      batch_id: sessions.batch_id,
      batch_name: batches.name,
      centre_name: centres.name,
      status: sessions.status,
      scheduled_date: sessions.scheduled_date,
      scheduled_start_time: sessions.scheduled_start_time,
      scheduled_end_time: sessions.scheduled_end_time,
      check_in_at: sessions.check_in_at,
      gps_flagged: sessions.gps_flagged,
      gps_unverified: sessions.gps_unverified,
      attendance_count: sql<number>`(
        select count(*)::int from attendance a where a.session_id = ${sessions.id}
      )`,
    })
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .where(
      and(
        eq(batches.centre_id, centreId),
        eq(sessions.scheduled_date, date),
        isNull(batches.deleted_at),
        sql`${sessions.status} <> 'cancelled'`,
      ),
    )
    .orderBy(asc(sessions.scheduled_start_time));

  const nowMs = Date.now();
  function endInstantMs(scheduledDate: string, endTime: string | null): number | null {
    if (!endTime) return null;
    // scheduled_date + end_time interpreted in Asia/Kolkata → UTC instant
    const iso = `${scheduledDate}T${String(endTime).slice(0, 8)}+05:30`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : null;
  }

  const unmarked_sessions = sessionRows
    .filter((s) => {
      if (Number(s.attendance_count) > 0) return false;
      const endMs = endInstantMs(String(s.scheduled_date), s.scheduled_end_time);
      return endMs != null && nowMs > endMs;
    })
    .map((s) => ({
      id: s.id,
      batch_id: s.batch_id,
      batch_name: s.batch_name,
      centre_name: s.centre_name,
      status: s.status,
      scheduled_date: String(s.scheduled_date),
      scheduled_start_time: s.scheduled_start_time,
      scheduled_end_time: s.scheduled_end_time,
      label: "not_marked" as const,
    }));

  // AT32.3 — gps_flagged means measured-and-wrong; no-fix is pastoral "not checked in".
  const gps_flagged_sessions = sessionRows
    .filter((s) => s.gps_flagged === true)
    .map((s) => ({
      id: s.id,
      batch_id: s.batch_id,
      batch_name: s.batch_name,
      centre_name: s.centre_name,
      status: s.status,
      scheduled_date: String(s.scheduled_date),
      scheduled_start_time: s.scheduled_start_time,
      check_in_at: s.check_in_at ? s.check_in_at.toISOString() : null,
      gps_flagged: true as const,
    }));

  const not_checked_in_sessions = sessionRows
    .filter((s) => s.check_in_at == null && s.gps_flagged !== true)
    .map((s) => ({
      id: s.id,
      batch_id: s.batch_id,
      batch_name: s.batch_name,
      centre_name: s.centre_name,
      status: s.status,
      scheduled_date: String(s.scheduled_date),
      scheduled_start_time: s.scheduled_start_time,
      check_in_at: null as null,
      gps_unverified: s.gps_unverified === true,
      label: "not_checked_in" as const,
    }));

  // Alert badge excludes pastoral "not checked in" (AT32.4).
  const alert_count =
    consecutive_absences.length + unmarked_sessions.length + gps_flagged_sessions.length;

  ok(
    res,
    {
      consecutive_absences,
      unmarked_sessions,
      gps_flagged_sessions,
      not_checked_in_sessions,
      date,
    },
    {
      consecutive_absence_count: consecutive_absences.length,
      unmarked_count: unmarked_sessions.length,
      gps_flagged_count: gps_flagged_sessions.length,
      not_checked_in_count: not_checked_in_sessions.length,
      alert_count,
    },
  );
});

/* GET /v1/admin/attendance/centres/:id/log — centre attendance log (frozen) */
router.get("/attendance/centres/:id/log", async (req: Request, res: Response) => {
  const centreId = String(req.params.id);
  const scope = await resolveAdminScope(req.authUser!);
  if (scope.centreIds !== null && !scope.centreIds.includes(centreId)) {
    fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope.");
    return;
  }
  const limit = clampLimit(req.query.limit, 50, 200);
  const sessionId =
    typeof req.query.session_id === "string" ? String(req.query.session_id) : null;

  if (sessionId) {
    const { loadSessionDetail } = await import("../../lib/session-roster");
    const detail = await loadSessionDetail(sessionId);
    if (!detail || detail.session.centre_id !== centreId) {
      fail(res, 404, "ERR_NOT_FOUND", "Session not found.");
      return;
    }
    ok(res, detail);
    return;
  }

  const {
    pageSessionsWithAttendanceCounts,
    decodeSessionCursor,
  } = await import("../../lib/session-page");
  const cursor = decodeSessionCursor(req.query.cursor);
  const fromExplicit =
    typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
      ? req.query.from
      : null;
  const toExplicit =
    typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
      ? req.query.to
      : null;

  const filters = [
    eq(batches.centre_id, centreId),
    isNull(batches.deleted_at),
  ];
  if (fromExplicit) filters.push(gte(sessions.scheduled_date, fromExplicit));
  if (toExplicit) filters.push(lte(sessions.scheduled_date, toExplicit));

  const result = await pageSessionsWithAttendanceCounts({
    filters,
    limit,
    cursor,
    // Explicit range replaces the default 180-day window.
    windowDays: fromExplicit || toExplicit ? null : 180,
  });

  ok(
    res,
    { items: result.items },
    {
      count: result.items.length,
      has_more: result.hasMore,
      next_cursor: result.nextCursor,
      window_days: result.windowDays,
      window_from: result.windowFrom,
    },
  );
});

/* GET /v1/admin/sessions — recent sessions in scope */
router.get("/sessions", async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 50, 200);
  const centreFilter = scopedCentreFilter(scope, batches.centre_id);
  const {
    pageSessionsWithAttendanceCounts,
    decodeSessionCursor,
  } = await import("../../lib/session-page");
  const cursor = decodeSessionCursor(req.query.cursor);
  const fromExplicit =
    typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
      ? req.query.from
      : null;
  const toExplicit =
    typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
      ? req.query.to
      : null;

  const filters = [
    isNull(batches.deleted_at),
    isNull(centres.deleted_at),
    ...(centreFilter ? [centreFilter] : []),
  ];
  if (fromExplicit) filters.push(gte(sessions.scheduled_date, fromExplicit));
  if (toExplicit) filters.push(lte(sessions.scheduled_date, toExplicit));

  const result = await pageSessionsWithAttendanceCounts({
    filters,
    limit,
    cursor,
    windowDays: fromExplicit || toExplicit ? null : 180,
  });

  ok(
    res,
    { items: result.items },
    {
      count: result.items.length,
      has_more: result.hasMore,
      next_cursor: result.nextCursor,
      window_days: result.windowDays,
      window_from: result.windowFrom,
    },
  );
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
  /** Locality token (GHK) or full Pathshala code (MUM-GHK). Auto-derived when omitted. */
  code: z.string().min(2).max(16).optional(),
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
  const [cityRow] = await db
    .select({ state_id: cities.state_id, code: cities.code })
    .from(cities)
    .where(eq(cities.id, body.city_id))
    .limit(1);
  if (!cityRow || (allowedCityIds !== null && !allowedCityIds.includes(body.city_id))) {
    fail(res, 403, "ERR_FORBIDDEN", "That city is outside your scope."); return;
  }

  const cityCode = normalizeCodePart(cityRow.code);
  let pathshalaCode: string;
  try {
    const raw = body.code?.trim();
    if (raw && raw.includes("-")) {
      pathshalaCode = normalizeCodePart(raw);
      if (!pathshalaCode.startsWith(`${cityCode}-`)) {
        fail(
          res,
          422,
          "ERR_VALIDATION_FAILED",
          `Pathshala code must start with ${cityCode}- (city code).`,
        );
        return;
      }
    } else {
      const loc = raw
        ? normalizeCodePart(raw)
        : localityToken(body.locality?.trim() || body.name);
      pathshalaCode = composePathshalaCode(cityCode, loc);
    }
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Could not build a Pathshala code — set code or locality.");
    return;
  }

  const [dup] = await db
    .select({ id: centres.id })
    .from(centres)
    .where(and(eq(centres.code, pathshalaCode), isNull(centres.deleted_at)))
    .limit(1);
  if (dup) {
    fail(res, 409, "ERR_DUPLICATE", `Pathshala code ${pathshalaCode} is already in use.`);
    return;
  }

  const [row] = await db.insert(centres).values({
    name: body.name,
    code: pathshalaCode,
    city_id: body.city_id,
    state_id: cityRow.state_id,
    locality: body.locality ?? null,
    pincode: body.pincode ?? null,
    contact_phone: body.contact_phone ?? null,
    contact_email: body.contact_email ?? null,
  }).returning({ id: centres.id, name: centres.name, code: centres.code });
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

  if (!opts.city_id) {
    return { ok: false, message: "A city is required to issue a parent ID." };
  }
  const [city] = await db
    .select({ code: cities.code })
    .from(cities)
    .where(eq(cities.id, opts.city_id))
    .limit(1);
  if (!city?.code) {
    return { ok: false, message: "Could not resolve city code for parent ID." };
  }

  const display_code = await allocateParentCode(db, city.code);
  const [row] = await db
    .insert(users)
    .values({
      phone: opts.phone,
      full_name: opts.full_name.trim(),
      role: "parent",
      display_code,
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

  const [city] = await db
    .select({ code: cities.code })
    .from(cities)
    .where(eq(cities.id, centre.city_id))
    .limit(1);
  if (!city?.code) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Centre city has no code — cannot issue student ID.");
    return;
  }

  const student_code = await allocateStudentCode(db, city.code);
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

/* POST /v1/admin/notices removed — authoring lives at POST /v1/notices/admin
 * (noticeWriteSchema + LIVE visibility). The only caller was unrouted dead code
 * in AdminListPages.NoticesPage. */

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
