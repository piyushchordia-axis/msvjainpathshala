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
  punya_features,
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
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, lt, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { isValidCitySlug, slugifyCityName } from "@jp/shared/city-slug";
import {
  requireAuth,
  requireAdminPanel,
  requireRole,
  requireShivirAdmin,
} from "../../middlewares/auth";
import {
  resolveAdminScope,
  cityIdsForState,
  cityIdsForUser,
  inBatchWriteScope,
  type AdminScope,
} from "../../lib/scope";
import { auditFromReq } from "../../lib/audit";
import { enqueueShivirPublishedAnnouncement } from "../../lib/shivir-notify";
import { awardPunya, reversePunya } from "../../lib/punya";
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
import {
  listManualCategories,
  validateManualAward,
} from "../../lib/punya-manual-award";
import { isClientSettingKey } from "../../lib/client-settings";
import { isPlatformSettingKey, getEightyGConfig } from "../../lib/platform-settings";
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
      city_id: centres.city_id,
      city_name: cities.name,
      state_id: centres.state_id,
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

/* GET /v1/admin/shivirs?q=&is_published=&limit=&offset= */
router.get("/shivirs", async (req: Request, res: Response) => {
  /**
   * This handler used to take no scope at all — it had a `where` clause of
   * nothing, so every admin-panel role listed every shivir in the country,
   * unpublished drafts included. The dashboard dropdown was fed from here and
   * then 404'd on anything out of the caller's city.
   */
  const cityIds = await cityIdsForUser(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 200);
  /**
   * The admin list hook pages on `cursor` / `next_cursor`, not offset — an
   * offset-shaped response makes hasMore permanently false and the "Load more"
   * button never renders, which is precisely the silently-inert pagination that
   * hook's own comment was written about. The cursor here is just the offset in
   * string form, which is all an ordered-by-start_date list needs.
   */
  const cursorRaw = typeof req.query.cursor === "string" ? req.query.cursor : req.query.offset;
  const offset = Math.max(0, Number(cursorRaw) || 0);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const publishedFilter =
    req.query.is_published === "true" ? true : req.query.is_published === "false" ? false : null;

  const rows = await db
    .select({
      id: shivir_events.id,
      name_en: shivir_events.name_en,
      name_hi: shivir_events.name_hi,
      description_en: shivir_events.description_en,
      description_hi: shivir_events.description_hi,
      start_date: shivir_events.start_date,
      end_date: shivir_events.end_date,
      location_text: shivir_events.location_text,
      contact_info: shivir_events.contact_info,
      city_id: shivir_events.city_id,
      city_name: cities.name,
      is_published: shivir_events.is_published,
      msv_only: shivir_events.msv_only,
      attendance_mode: shivir_events.attendance_mode,
      capacity: shivir_events.capacity,
    })
    .from(shivir_events)
    .innerJoin(cities, eq(cities.id, shivir_events.city_id))
    .where(
      and(
        isNull(shivir_events.deleted_at),
        cityIds === null
          ? undefined
          : cityIds.length === 0
            ? sql`false`
            : inArray(shivir_events.city_id, cityIds),
        publishedFilter === null ? undefined : eq(shivir_events.is_published, publishedFilter),
        q
          ? or(
              ilike(shivir_events.name_en, `%${q}%`),
              ilike(shivir_events.name_hi, `%${q}%`),
              ilike(shivir_events.location_text, `%${q}%`),
              ilike(cities.name, `%${q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(shivir_events.start_date))
    .offset(offset)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  ok(
    res,
    { items, next_cursor: hasMore ? String(offset + limit) : null },
    { count: items.length, has_more: hasMore, next_cursor: hasMore ? String(offset + limit) : null },
  );
});

/* GET /v1/admin/niyams */
router.get("/niyams", async (req: Request, res: Response) => {
  /**
   * M2 — this handler took `_req`: no scope narrowing and no limit, so a
   * shikshak or city_admin read every niyam in the country in one unpaginated
   * response. Narrow to what the caller administers: national niyams are
   * visible to everyone (they apply to every centre), plus their own
   * state's / city's.
   */
  const cityIds = await cityIdsForUser(req.authUser!);
  const geoFilter =
    cityIds === null
      ? undefined
      : or(
          eq(niyams.scope, "national"),
          cityIds.length ? inArray(niyams.city_id, cityIds) : undefined,
          req.authUser!.state_id ? eq(niyams.state_id, req.authUser!.state_id) : undefined,
        );
  const limit = clampLimit(req.query.limit, 100, 300);

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
      // H14 — the edit dialog authors these, so the list has to read them back.
      start_date: niyams.start_date,
      end_date: niyams.end_date,
    })
    .from(niyams)
    .leftJoin(states, eq(states.id, niyams.state_id))
    .leftJoin(cities, eq(cities.id, niyams.city_id))
    .where(geoFilter)
    .orderBy(desc(niyams.points), asc(niyams.id))
    .limit(limit);
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
      // Q12 — needed to compute can_decide per row. The list is centre-scoped
      // but approve/reject are batch-bound, so without these the web panel
      // rendered Approve on rows the caller could not act on.
      centre_id: students.centre_id,
      batch_id: students.batch_id,
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
    // Q12 — same field the mobile /pending list returns, so the web panel can
    // grey out rows outside write scope instead of failing the click with a
    // bare "Submission not found." toast.
    can_decide: inBatchWriteScope(scope, r.batch_id, r.centre_id),
    ...rejectionWindowFields(r.status, r.created_at),
  }));
  ok(res, { items, next_cursor: nextCursor }, { count: items.length });
});

/* GET /v1/admin/punya/configs */
router.get("/punya/configs", async (req: Request, res: Response) => {
  // city_id was omitted entirely, so a GLOBAL row (which re-prices every city)
  // and a city override rendered identically and nobody could tell which was
  // which after the fact.
  //
  // M9 — and the list was unscoped, so a Mumbai city_admin read every
  // other city's point economics. Global rows stay visible to everyone: they
  // are the value a city override is measured against, and an admin who
  // cannot see the default cannot reason about their own row.
  const role = req.authUser!.role;
  let cityFilter: SQL | undefined;
  if (role === "city_admin") {
    const own = req.authUser!.city_id ?? null;
    cityFilter = own
      ? or(isNull(punya_configs.city_id), eq(punya_configs.city_id, own))
      : isNull(punya_configs.city_id);
  } else if (role === "state_admin") {
    const ids = req.authUser!.state_id ? await cityIdsForState(req.authUser!.state_id) : [];
    cityFilter = ids.length
      ? or(isNull(punya_configs.city_id), inArray(punya_configs.city_id, ids))
      : isNull(punya_configs.city_id);
  }
  const rows = await db
    .select({
      id: punya_configs.id,
      feature_key: punya_configs.feature_key,
      points: punya_configs.points,
      is_active: punya_configs.is_active,
      city_id: punya_configs.city_id,
      city_name: cities.name,
    })
    .from(punya_configs)
    .leftJoin(cities, eq(cities.id, punya_configs.city_id))
    .where(cityFilter)
    .orderBy(asc(punya_configs.feature_key), asc(cities.name));
  ok(res, { items: rows }, { count: rows.length });
});

/* GET /v1/admin/punya/features — the catalogue a config's feature_key must
   name. The create form free-texted the key, so a typo silently produced a
   config nothing ever reads. */
router.get("/punya/features", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      key: punya_features.key,
      label: punya_features.label,
      min_points: punya_features.min_points,
      max_points: punya_features.max_points,
      // M3 — the clients drive the manual-award category picker and its
      // reason requirement from these rather than hardcoding either.
      default_points: punya_features.default_points,
      is_manual: punya_features.is_manual,
      requires_reason: punya_features.requires_reason,
      is_active: punya_features.is_active,
    })
    .from(punya_features)
    .where(eq(punya_features.is_active, true))
    .orderBy(asc(punya_features.key));
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
  /**
   * H6 — BRD 7.2's category. Optional for backward compatibility: an
   * omitted key resolves to `manual_award`, which is what every caller
   * implicitly awarded under before. Validated against punya_features with
   * is_manual = true, so a typo cannot invent a category.
   */
  feature_key: z.string().min(1).max(100).optional(),
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

  // Category bounds and the reason requirement come from the catalogue.
  const note = body.note?.trim() || null;
  const validated = await validateManualAward({
    featureKey: body.feature_key,
    points: body.points,
    note,
  });
  if ("error" in validated) {
    fail(
      res,
      validated.error.code === "unknown" ? 422 : 422,
      ErrorCode.VALIDATION_FAILED,
      validated.error.message,
    );
    return;
  }
  const category = validated.category;

  const idemKey = body.idempotency_key?.trim() || null;
  const limit = await resolveAwardLimit(req.authUser!.role);

  // H7 — the ceiling checks used to run on the pool, before a separate
  // awardPunya transaction. Two awards of 10 issued concurrently at 40/50 used
  // both read 40, both passed, and both committed: 60 against a 50 cap, with no
  // row lock, no post-award verification, and no reconciliation that would ever
  // notice. Everything that reads the day's total and everything that changes it
  // now happens inside ONE transaction, serialized per awarder by an advisory
  // xact lock (same idiom as donations.ts / enrolments.ts). The lock is on the
  // awarder, not the student: the cap is per-admin, so that is the contended row.
  type AwardOutcome =
    | { kind: "ok"; result: Awaited<ReturnType<typeof awardPunya>>; awardedToday: number }
    | { kind: "per_award" }
    | { kind: "daily" };

  const outcome = await db.transaction(async (tx): Promise<AwardOutcome> => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`punya:award:${req.authUser!.id}`}::text, 0))`,
    );

    // M15 — scoped to this student AND this awarder. Matching on the key
    // alone let any caller quote an arbitrary transaction's idempotency key to
    // skip both limit checks below and read back someone else's award.
    let isReplay = false;
    if (idemKey) {
      const [existing] = await tx
        .select({ id: punya_transactions.id })
        .from(punya_transactions)
        .where(
          and(
            eq(punya_transactions.idempotency_key, idemKey),
            eq(punya_transactions.student_id, student.id),
            eq(punya_transactions.awarded_by, req.authUser!.id),
          ),
        )
        .limit(1);
      isReplay = Boolean(existing);
    }

    const awardedToday = await pointsAwardedTodayBy(req.authUser!.id, tx);

    if (!isReplay) {
      if (body.points > limit.maxPerAward) return { kind: "per_award" };
      if (limit.maxPerDay != null && awardedToday + body.points > limit.maxPerDay) {
        return { kind: "daily" };
      }
    }

    // Composed into the SAME tx, so the ledger insert, balance upsert and tier
    // recompute commit with the cap check that authorised them.
    const result = await awardPunya(
      {
        studentId: student.id,
        featureKey: category.key,
        points: body.points,
        note,
        awardedBy: req.authUser!.id,
        idempotencyKey: idemKey,
      },
      tx,
    );
    return { kind: "ok", result, awardedToday };
  });

  if (outcome.kind === "per_award") {
    fail(
      res,
      422,
      ErrorCode.AWARD_LIMIT_EXCEEDED,
      `That is more than you can award at once — the limit is ${limit.maxPerAward} Punya per award.`,
    );
    return;
  }
  if (outcome.kind === "daily") {
    fail(
      res,
      429,
      ErrorCode.AWARD_DAILY_LIMIT_EXCEEDED,
      `You have reached today's award limit (${limit.maxPerDay} Punya) — try again tomorrow or ask a higher role to award.`,
    );
    return;
  }
  const { result, awardedToday: pointsAwardedToday } = outcome;

  // Only audit a real credit; an idempotent replay didn't change anything.
  if (result.awarded) {
    await auditFromReq(req, {
      action: "award",
      entityKind: "student",
      entityId: student.id,
      summary: `${category.label} award (+${body.points}).`,
      metadata: {
        feature_key: category.key,
        points: body.points,
        note,
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
    feature_key: category.key,
    points_awarded: result.points_awarded,
    total_points: result.total_points,
    tier: result.tier,
  });
});

const punyaReverseSchema = z.object({
  reason: z.string().min(3).max(500),
});

/**
 * POST /v1/admin/punya/transactions/:id/reverse — M18.
 *
 * A mis-targeted manual award was permanent. reversePunya lived in lib/ and
 * was reachable from no HTTP route at all, so a Sanchalak who spotted their
 * shikshak awarding the wrong child had nothing to do about it, on any
 * surface. The only workaround was a compensating award, which leaves the
 * ledger claiming the first child earned points they did not.
 *
 * Deliberately limited to MANUAL awards. Everything else — attendance,
 * niyam, homework, exam, quiz, course, competition — already reverses through
 * its own domain path, which also fixes up streaks, gallery rows, badges and
 * certification state. Reversing one of those from here would move the
 * points and silently desynchronise everything around them.
 */
router.post(
  "/punya/transactions/:id/reverse",
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Transaction not found.");
      return;
    }
    let body: z.infer<typeof punyaReverseSchema>;
    try {
      body = punyaReverseSchema.parse(req.body);
    } catch {
      fail(
        res,
        422,
        ErrorCode.VALIDATION_FAILED,
        "Say why this award is being reversed — the family sees the correction.",
      );
      return;
    }

    const [txn] = await db
      .select({
        id: punya_transactions.id,
        student_id: punya_transactions.student_id,
        feature_key: punya_transactions.feature_key,
        points: punya_transactions.points,
        idempotency_key: punya_transactions.idempotency_key,
        is_manual: punya_features.is_manual,
        centre_id: students.centre_id,
        batch_id: students.batch_id,
      })
      .from(punya_transactions)
      .innerJoin(students, eq(students.id, punya_transactions.student_id))
      .leftJoin(punya_features, eq(punya_features.key, punya_transactions.feature_key))
      .where(eq(punya_transactions.id, id))
      .limit(1);

    const scope = await resolveAdminScope(req.authUser!);
    // 404 rather than 403 throughout, matching the rest of the module.
    if (!txn || !inBatchWriteScope(scope, txn.batch_id, txn.centre_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Transaction not found.");
      return;
    }
    if (!txn.is_manual) {
      fail(
        res,
        422,
        ErrorCode.VALIDATION_FAILED,
        "Only a manually awarded Punya can be reversed here — correct the attendance mark, niyam or grade it came from instead.",
      );
      return;
    }
    if (txn.points <= 0) {
      fail(
        res,
        422,
        ErrorCode.VALIDATION_FAILED,
        "That row is already a reversal.",
      );
      return;
    }
    if (!txn.idempotency_key) {
      // reversePunya keys the debit off the original's key; without one the
      // reversal could not be made idempotent or linked back.
      fail(
        res,
        422,
        ErrorCode.VALIDATION_FAILED,
        "That award predates reversible records and cannot be undone automatically.",
      );
      return;
    }

    const result = await reversePunya({
      studentId: txn.student_id,
      featureKey: txn.feature_key,
      points: txn.points,
      note: body.reason,
      awardedBy: req.authUser!.id,
      idempotencyKey: `${txn.idempotency_key}:reversal`,
    });

    if (!result.reversed) {
      fail(res, 409, "ERR_DUPLICATE", "That award has already been reversed.");
      return;
    }

    await auditFromReq(req, {
      action: "reverse",
      entityKind: "student",
      entityId: txn.student_id,
      summary: `Reversed a ${txn.feature_key} award (-${txn.points}).`,
      metadata: {
        transaction_id: txn.id,
        feature_key: txn.feature_key,
        points: txn.points,
        reason: body.reason,
        total_points: result.total_points,
      },
    });

    ok(res, {
      student_id: txn.student_id,
      points_reversed: result.points_reversed,
      total_points: result.total_points,
      tier: result.tier,
    });
  },
);

/* GET /v1/admin/punya/award-categories — BRD 7.2's manual categories.
   Clients drive their picker, per-category bounds and the reason
   requirement from this rather than hardcoding any of them. */
router.get("/punya/award-categories", async (_req: Request, res: Response) => {
  const items = await listManualCategories();
  ok(res, { items }, { count: items.length });
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

    if (!row) {
      fail(res, 500, "ERR_INTERNAL", "Could not queue the report — try again in a moment.");
      return;
    }

    await auditFromReq(req, {
      action: "create",
      entityKind: "centre_monthly_report",
      entityId: row.id,
      summary: `Queued monthly report for centre ${centreId} (${month}).`,
      metadata: { centre_id: centreId, month },
    });

    try {
      await enqueueJob(QUEUE_NAMES.REPORT_GENERATION, { report_id: row.id });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "enqueue failed";
      logger.warn({ err, reportId: row.id }, "report.generation enqueue failed");
      await db
        .update(centre_monthly_reports)
        .set({
          status: "failed",
          error_message: detail.slice(0, 500),
          updated_at: new Date(),
        })
        .where(eq(centre_monthly_reports.id, row.id));
      fail(
        res,
        503,
        "ERR_INTERNAL",
        "The report could not be queued — try again in a moment.",
      );
      return;
    }

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

  // The log is centre-scoped, but MARKING is batch-bound for a shikshak
  // (inBatchWriteScope). Without this flag the UI showed a Mark button on every
  // row and the Guruji only discovered the 403 after filling in a whole roster.
  // Same disabled-not-hidden treatment Q12 already uses for niyam review.
  const items = result.items.map((s) => ({
    ...s,
    can_mark: inBatchWriteScope(scope, (s as { batch_id?: string | null }).batch_id ?? null, centreId),
  }));

  ok(
    res,
    { items },
    {
      count: items.length,
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
      slug: cities.slug,
      state_id: cities.state_id,
      state_name: states.name,
      state_code: states.code,
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
  slug: z
    .string()
    .min(1)
    .max(120)
    .transform((s) => s.trim().toLowerCase())
    .optional(),
});

const patchCitySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(2).max(10).transform((s) => s.toUpperCase()).optional(),
  slug: z
    .string()
    .min(1)
    .max(120)
    .transform((s) => s.trim().toLowerCase())
    .optional(),
}).refine((b) => b.name !== undefined || b.code !== undefined || b.slug !== undefined, {
  message: "At least one field required",
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

  const slug = body.slug ?? slugifyCityName(body.name);
  if (!isValidCitySlug(slug)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "City slug must be lowercase letters, digits, and hyphens.");
    return;
  }

  // Same name twice within one state is a duplicate; the same name in another
  // state is legitimate (e.g. Aurangabad exists in more than one state).
  const [dupe] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(and(eq(cities.state_id, body.state_id), eq(cities.name, body.name)))
    .limit(1);
  if (dupe) { fail(res, 409, "ERR_ALREADY_EXISTS", "That city already exists in this state."); return; }

  const [slugTaken] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.slug, slug))
    .limit(1);
  if (slugTaken) {
    fail(res, 409, "ERR_CITY_SLUG_CONFLICT", "That city slug is already taken — choose a different slug.");
    return;
  }

  try {
    const [row] = await db
      .insert(cities)
      .values({ state_id: body.state_id, name: body.name, code: body.code, slug })
      .returning({
        id: cities.id,
        name: cities.name,
        code: cities.code,
        slug: cities.slug,
        state_id: cities.state_id,
      });
    await auditFromReq(req, {
      action: "create",
      entityKind: "city",
      entityId: row.id,
      summary: `City ${row.name} created.`,
      metadata: { name: row.name, code: row.code, slug: row.slug, state_id: row.state_id },
    });
    ok(res, row, undefined, 201);
  } catch (err) {
    // Race on unique slug — surface as the domain conflict, not 500.
    const msg = err instanceof Error ? err.message : String(err);
    if (/cities_slug_uq|unique.*slug/i.test(msg)) {
      fail(res, 409, "ERR_CITY_SLUG_CONFLICT", "That city slug is already taken — choose a different slug.");
      return;
    }
    throw err;
  }
});

/* PATCH /v1/admin/cities/:id */
router.patch("/cities/:id", async (req: Request, res: Response) => {
  if (!requireNationalAdmin(req, res)) return;
  const id = String(req.params.id);
  let body: z.infer<typeof patchCitySchema>;
  try { body = patchCitySchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid city data."); return; }

  const [existing] = await db
    .select({
      id: cities.id,
      name: cities.name,
      code: cities.code,
      slug: cities.slug,
      state_id: cities.state_id,
    })
    .from(cities)
    .where(eq(cities.id, id))
    .limit(1);
  if (!existing) { fail(res, 404, "ERR_NOT_FOUND", "City not found."); return; }

  const nextName = body.name ?? existing.name;
  const nextCode = body.code ?? existing.code;
  const nextSlug = body.slug ?? existing.slug;

  if (!isValidCitySlug(nextSlug)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "City slug must be lowercase letters, digits, and hyphens.");
    return;
  }

  if (nextName !== existing.name) {
    const [dupe] = await db
      .select({ id: cities.id })
      .from(cities)
      .where(and(eq(cities.state_id, existing.state_id), eq(cities.name, nextName), ne(cities.id, id)))
      .limit(1);
    if (dupe) { fail(res, 409, "ERR_ALREADY_EXISTS", "That city already exists in this state."); return; }
  }

  if (nextSlug !== existing.slug) {
    const [slugTaken] = await db
      .select({ id: cities.id })
      .from(cities)
      .where(and(eq(cities.slug, nextSlug), ne(cities.id, id)))
      .limit(1);
    if (slugTaken) {
      fail(res, 409, "ERR_CITY_SLUG_CONFLICT", "That city slug is already taken — choose a different slug.");
      return;
    }
  }

  try {
    const [row] = await db
      .update(cities)
      .set({ name: nextName, code: nextCode, slug: nextSlug, updated_at: new Date() })
      .where(eq(cities.id, id))
      .returning({
        id: cities.id,
        name: cities.name,
        code: cities.code,
        slug: cities.slug,
        state_id: cities.state_id,
      });
    await auditFromReq(req, {
      action: "update",
      entityKind: "city",
      entityId: row.id,
      summary: `City ${row.name} updated.`,
      metadata: { name: row.name, code: row.code, slug: row.slug, state_id: row.state_id },
    });
    ok(res, row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cities_slug_uq|unique.*slug/i.test(msg)) {
      fail(res, 409, "ERR_CITY_SLUG_CONFLICT", "That city slug is already taken — choose a different slug.");
      return;
    }
    throw err;
  }
});

/* GET /v1/admin/settings — platform configuration is state_admin+ read
   (nav min), super_admin write (XC-API-01: previously any admin-panel role
   could read every setting). */
router.get(
  "/settings",
  requireRole("super_admin", "state_admin"),
  async (_req: Request, res: Response) => {
    const rows = await db.select().from(settings).orderBy(asc(settings.key));
    ok(res, { items: rows.map((r) => ({ ...r, updated_at: r.updated_at.toISOString() })) });
  },
);

const patchSettingSchema = z.object({
  key: z.string().min(1).max(128),
  value: z.string().max(4000),
});

/* PATCH /v1/admin/settings — super_admin only; allowlisted client + platform
   keys. The 80G toggle enforces Q3: enabling requires BOTH the registration
   number and the organisation PAN to already be set. */
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
  if (!isClientSettingKey(body.key) && !isPlatformSettingKey(body.key)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "That settings key is not writable via this endpoint.");
    return;
  }

  if (body.key === "eighty_g_enabled") {
    const value = body.value.trim().toLowerCase();
    if (value !== "true" && value !== "false") {
      fail(res, 422, "ERR_VALIDATION_FAILED", "eighty_g_enabled must be 'true' or 'false'.");
      return;
    }
    body = { ...body, value };
    if (value === "true") {
      const config = await getEightyGConfig();
      if (!config.registrationNumber || !config.organizationPan) {
        fail(
          res,
          422,
          "ERR_VALIDATION_FAILED",
          "Set the 80G registration number and organisation PAN first — receipts must carry both before 80G can be enabled.",
        );
        return;
      }
    }
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

const patchCentreStatusSchema = z.object({
  status: z.enum(["active", "inactive"]),
});

/* PATCH /v1/admin/centres/:id — activate / deactivate (city_admin+) */
router.patch("/centres/:id", async (req: Request, res: Response) => {
  const role = req.authUser!.role;
  if (role !== "super_admin" && role !== "state_admin" && role !== "city_admin") {
    fail(res, 403, "ERR_FORBIDDEN", "Only city admins and above can update centres.");
    return;
  }
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
    return;
  }
  let body: z.infer<typeof patchCentreStatusSchema>;
  try {
    body = patchCentreStatusSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid centre status.");
    return;
  }

  const scope = await resolveAdminScope(req.authUser!);
  const [existing] = await db
    .select({
      id: centres.id,
      name: centres.name,
      status: centres.status,
      city_id: centres.city_id,
      state_id: centres.state_id,
    })
    .from(centres)
    .where(and(eq(centres.id, id), isNull(centres.deleted_at)))
    .limit(1);
  if (!existing) {
    fail(res, 404, "ERR_NOT_FOUND", "Centre not found.");
    return;
  }
  if (!inScope(scope, existing.id)) {
    fail(res, 403, "ERR_FORBIDDEN", "Centre not in your scope.");
    return;
  }

  const [row] = await db
    .update(centres)
    .set({ status: body.status, updated_at: new Date() })
    .where(eq(centres.id, id))
    .returning({
      id: centres.id,
      name: centres.name,
      status: centres.status,
    });

  if (body.status === "inactive") {
    const { unpublishTeamMembersForCentre } = await import("../../lib/team-members-sync");
    await unpublishTeamMembersForCentre(id);
  }

  await auditFromReq(req, {
    action: "update",
    entityKind: "centre",
    entityId: row.id,
    summary: `Centre ${row.name} set to ${body.status}.`,
    metadata: { status: body.status },
  });
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const createShivirSchema = z
  .object({
    name_en: z.string().min(1).max(300),
    name_hi: z.string().max(300).optional(),
    description_en: z.string().max(2000).optional(),
    description_hi: z.string().max(2000).optional(),
    city_id: z.string().uuid(),
    start_date: z.string().regex(DATE_RE),
    end_date: z.string().regex(DATE_RE),
    location_text: z.string().max(500).optional(),
    // Rendered on both public detail pages since day one and never settable
    // from any surface, so the Contact block could not appear for any shivir
    // created through the app.
    contact_info: z.string().max(500).optional(),
    capacity: z.coerce.number().int().min(1).optional(),
    attendance_mode: z.enum(["in_out", "present_only"]).default("present_only"),
    is_published: z.boolean().default(true),
    msv_only: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    // An inverted range was accepted silently, and the shivir then rendered
    // backwards everywhere and — being already "ended" — never appeared publicly.
    if (v.end_date < v.start_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_date"],
        message: "The end date is before the start date.",
      });
    }
  });

const patchShivirSchema = z
  .object({
    name_en: z.string().min(1).max(300).optional(),
    name_hi: z.string().max(300).nullable().optional(),
    description_en: z.string().max(2000).nullable().optional(),
    description_hi: z.string().max(2000).nullable().optional(),
    start_date: z.string().regex(DATE_RE).optional(),
    end_date: z.string().regex(DATE_RE).optional(),
    location_text: z.string().max(500).nullable().optional(),
    contact_info: z.string().max(500).nullable().optional(),
    capacity: z.coerce.number().int().min(1).nullable().optional(),
    attendance_mode: z.enum(["in_out", "present_only"]).optional(),
    is_published: z.boolean().optional(),
    msv_only: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

/** The caller's allowed city ids for a shivir write; null = unrestricted. */
async function shivirWriteCityIds(req: Request): Promise<string[] | null> {
  const role = req.authUser!.role;
  if (role === "city_admin") return req.authUser!.city_id ? [req.authUser!.city_id] : [];
  if (role === "state_admin") {
    return req.authUser!.state_id ? cityIdsForState(req.authUser!.state_id) : [];
  }
  return null;
}

/* POST /v1/admin/shivirs */
router.post("/shivirs", requireShivirAdmin, async (req: Request, res: Response) => {
  let body: z.infer<typeof createShivirSchema>;
  try { body = createShivirSchema.parse(req.body); }
  catch (err) {
    const message =
      err instanceof z.ZodError ? (err.issues[0]?.message ?? "Invalid shivir data.") : "Invalid shivir data.";
    fail(res, 422, "ERR_VALIDATION_FAILED", message); return;
  }
  const allowedCityIds = await shivirWriteCityIds(req);
  const [cityRow] = await db.select({ state_id: cities.state_id }).from(cities).where(eq(cities.id, body.city_id)).limit(1);
  if (!cityRow || (allowedCityIds !== null && !allowedCityIds.includes(body.city_id))) {
    fail(res, 403, "ERR_FORBIDDEN", "That city is outside your scope."); return;
  }
  const [row] = await db.insert(shivir_events).values({
    name_en: body.name_en,
    name_hi: body.name_hi ?? null,
    description_en: body.description_en ?? null,
    description_hi: body.description_hi ?? null,
    city_id: body.city_id,
    state_id: cityRow?.state_id ?? null,
    start_date: body.start_date,
    end_date: body.end_date,
    location_text: body.location_text ?? null,
    contact_info: body.contact_info ?? null,
    capacity: body.capacity ?? null,
    attendance_mode: body.attendance_mode,
    is_published: body.is_published,
    msv_only: body.msv_only,
  }).returning({ id: shivir_events.id, name_en: shivir_events.name_en });
  await auditFromReq(req, {
    action: "create",
    entityKind: "shivir_event",
    entityId: row.id,
    summary: `Created shivir "${row.name_en}".`,
    metadata: { city_id: body.city_id, start_date: body.start_date, end_date: body.end_date },
  });
  if (body.is_published) {
    void enqueueShivirPublishedAnnouncement(row.id);
  }
  ok(res, row);
});

/**
 * PATCH /v1/admin/shivirs/:id
 *
 * Creation used to be the only write: a typo in the name, a venue change or a
 * cancelled camp was permanent and stayed on the public site until end_date.
 */
router.patch("/shivirs/:id", requireShivirAdmin, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  let body: z.infer<typeof patchShivirSchema>;
  try { body = patchShivirSchema.parse(req.body); }
  catch (err) {
    const message =
      err instanceof z.ZodError ? (err.issues[0]?.message ?? "Invalid shivir data.") : "Invalid shivir data.";
    fail(res, 422, "ERR_VALIDATION_FAILED", message); return;
  }

  const [existing] = await db
    .select({
      id: shivir_events.id,
      city_id: shivir_events.city_id,
      name_en: shivir_events.name_en,
      start_date: shivir_events.start_date,
      end_date: shivir_events.end_date,
      is_published: shivir_events.is_published,
    })
    .from(shivir_events)
    .where(and(eq(shivir_events.id, id), isNull(shivir_events.deleted_at)))
    .limit(1);
  const allowedCityIds = await shivirWriteCityIds(req);
  if (!existing || (allowedCityIds !== null && !allowedCityIds.includes(existing.city_id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found."); return;
  }

  // Validate the range against the MERGED row, not the patch alone — moving
  // only start_date can invert a range that was valid before.
  const nextStart = body.start_date ?? existing.start_date;
  const nextEnd = body.end_date ?? existing.end_date;
  if (nextEnd < nextStart) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "The end date is before the start date."); return;
  }

  await db
    .update(shivir_events)
    .set({ ...body, updated_at: new Date() })
    .where(eq(shivir_events.id, id));

  await auditFromReq(req, {
    action: "update",
    entityKind: "shivir_event",
    entityId: id,
    summary: `Updated shivir "${body.name_en ?? existing.name_en}".`,
    metadata: { fields: Object.keys(body) },
  });

  // Announce only on the false -> true edge, so editing a published shivir does
  // not re-notify every family in the city.
  if (body.is_published === true && !existing.is_published) {
    void enqueueShivirPublishedAnnouncement(id);
  }

  ok(res, { id });
});

/* DELETE /v1/admin/shivirs/:id — soft delete; scans and registrations are kept. */
router.delete("/shivirs/:id", requireShivirAdmin, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [existing] = await db
    .select({ id: shivir_events.id, city_id: shivir_events.city_id, name_en: shivir_events.name_en })
    .from(shivir_events)
    .where(and(eq(shivir_events.id, id), isNull(shivir_events.deleted_at)))
    .limit(1);
  const allowedCityIds = await shivirWriteCityIds(req);
  if (!existing || (allowedCityIds !== null && !allowedCityIds.includes(existing.city_id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Shivir not found."); return;
  }

  await db
    .update(shivir_events)
    .set({ deleted_at: new Date(), is_published: false, updated_at: new Date() })
    .where(eq(shivir_events.id, id));

  await auditFromReq(req, {
    action: "delete",
    entityKind: "shivir_event",
    entityId: id,
    summary: `Cancelled shivir "${existing.name_en}".`,
  });
  ok(res, { id });
});

export default router;
