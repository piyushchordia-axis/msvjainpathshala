/**
 * /v1/me — persona-scoped reads for the mobile app.
 *
 * parent  : their own children + each child's punya / niyams / id-card
 * student : their own student record (same shapes, scoped to self)
 *
 * Attendance / today sessions use frozen routes under /v1/students and
 * /v1/sessions — no /me aliases.
 *
 * All routes require authentication. Student-scoped routes verify ownership
 * (the student belongs to the caller via parent_id or user_id) so a parent
 * can only read their own children and a student only their own record.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  users,
  students,
  centres,
  batches,
  punya_balances,
  punya_transactions,
  niyams,
  niyam_submissions,
  niyam_submission_media,
  niyam_streaks,
  niyam_badges,
} from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { nextTierFor, resolveTierThresholds } from "../../lib/punya-tiers";
import { requireAuth } from "../../middlewares/auth";
import {
  periodKey,
  periodLabel,
  submittedPeriodTag,
  istCalendarDate,
} from "../../lib/niyam-period";
import { signUploadUrl, uploadKeyFromUrl } from "../../lib/file-tokens";
import { upsertIdCardArt } from "../../lib/idcard-render";
import { auditFromReq } from "../../lib/audit";
import { storage } from "../../lib/storage";
import {
  clampLimit,
  ownedStudentId,
  ownedStudentsCondition,
  encodeDateCursor,
  decodeDateCursor,
} from "../../lib/route-helpers";
import { studentNiyamAccessWhere } from "../../lib/niyam-audience";
import { resolveNiyamAwardOverride } from "../../lib/niyam-points";
import { toSessionUser } from "../../lib/session-user";
import { invalidateAuthUserCache } from "../../lib/auth-user-cache";
import { galleryVisibilityBodySchema } from "@workspace/api-zod";

const router: IRouter = Router();

router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const userPhotoSchema = z.object({
  photo_url: z.string().min(1).max(1000).nullable(),
});

/**
 * PUT /v1/me/photo — set or clear the caller's profile avatar.
 * Accepts a previously uploaded /uploads URL (folder user-photos) or null to clear.
 */
router.put("/photo", async (req: Request, res: Response) => {
  let body: z.infer<typeof userPhotoSchema>;
  try {
    body = userPhotoSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "photo_url must be a URL string or null.");
    return;
  }

  if (body.photo_url !== null) {
    const key = uploadKeyFromUrl(body.photo_url);
    if (!key || !key.startsWith("user-photos/")) {
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        "photo_url must be an uploaded file under user-photos.",
      );
      return;
    }
  }

  const uid = req.authUser!.id;
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, uid), isNull(users.deleted_at)))
    .limit(1);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "User not found.");
    return;
  }

  const previousKey = row.photo_url ? uploadKeyFromUrl(row.photo_url) : null;

  const [updated] = await db
    .update(users)
    .set({ photo_url: body.photo_url, updated_at: new Date() })
    .where(eq(users.id, uid))
    .returning();

  if (previousKey && previousKey !== uploadKeyFromUrl(body.photo_url ?? "")) {
    await storage.remove(previousKey);
  }

  await invalidateAuthUserCache(uid);

  await auditFromReq(req, {
    action: "update",
    entityKind: "user",
    entityId: uid,
    summary: body.photo_url ? "Profile photo updated." : "Profile photo cleared.",
  });

  ok(res, { user: toSessionUser(updated!) });
});

/**
 * PATCH /v1/me/gallery-visibility — Q6 blanket parent consent.
 * Sets users.gallery_visibility_opt_in only. Visibility is resolved at query
 * time in GET /v1/gallery — no per-item backfill.
 */
router.patch("/gallery-visibility", async (req: Request, res: Response) => {
  const parsed = galleryVisibilityBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      "opt_in must be a boolean — send { opt_in: true } or { opt_in: false }.",
    );
    return;
  }

  const uid = req.authUser!.id;
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, uid), isNull(users.deleted_at)))
    .limit(1);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "User not found.");
    return;
  }

  const optIn = parsed.data.opt_in;
  const [updated] = await db
    .update(users)
    .set({ gallery_visibility_opt_in: optIn, updated_at: new Date() })
    .where(eq(users.id, uid))
    .returning();

  await invalidateAuthUserCache(uid);

  await auditFromReq(req, {
    action: "update",
    entityKind: "user",
    entityId: uid,
    summary: optIn
      ? "Gallery visibility opted in (blanket — all children)."
      : "Gallery visibility opted out (blanket — all children).",
    metadata: { gallery_visibility_opt_in: optIn },
  });

  ok(res, {
    gallery_visibility_opt_in: optIn,
    user: toSessionUser(updated!),
  });
});

/* GET /v1/me/children — students owned by the caller (parent: kids; student: self) */
router.get("/children", async (req: Request, res: Response) => {
  const uid = req.authUser!.id;
  const rows = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      age_group: students.age_group,
      centre_id: students.centre_id,
      batch_id: students.batch_id,
      centre_name: centres.name,
      batch_name: batches.name,
      msv_status: students.msv_status,
      status: students.status,
      photo_url: students.photo_url,
      total_points: sql<number>`coalesce(${punya_balances.total_points}, 0)::int`,
      tier: sql<string>`coalesce(${punya_balances.tier}, 'jigyasu')`,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .leftJoin(batches, eq(batches.id, students.batch_id))
    .leftJoin(punya_balances, eq(punya_balances.student_id, students.id))
    // Q11 — one ownership predicate everywhere: soft-deleted AND non-active students
    // are excluded, matching every other child-scoped route. An inactive child that
    // still appeared here became the ChildSwitcher default and 404'd every screen.
    .where(ownedStudentsCondition(uid))
    .orderBy(students.full_name);

  ok(
    res,
    {
      items: rows.map((r) => ({
        ...r,
        photo_url: signUploadUrl(r.photo_url),
      })),
    },
    { count: rows.length },
  );
});

const studentPhotoSchema = z.object({
  photo_url: z.string().min(1).max(1000).nullable(),
});

/**
 * PUT /v1/me/students/:id/photo — parent/student sets the ID-card headshot.
 * Accepts a previously uploaded /uploads URL (folder student-photos) or null to clear.
 * Refreshes the digital ID card PNG without rotating the QR version.
 */
router.put("/students/:id/photo", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id) || !(await ownedStudentId(req, id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  let body: z.infer<typeof studentPhotoSchema>;
  try {
    body = studentPhotoSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "photo_url must be a URL string or null.");
    return;
  }

  if (body.photo_url !== null) {
    const key = uploadKeyFromUrl(body.photo_url);
    if (!key || !key.startsWith("student-photos/")) {
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        "photo_url must be an uploaded file under student-photos.",
      );
      return;
    }
  }

  const [student] = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      student_code: students.student_code,
      msv_status: students.msv_status,
      photo_url: students.photo_url,
      centre_name: centres.name,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(eq(students.id, id))
    .limit(1);
  if (!student) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }

  const previousKey = student.photo_url ? uploadKeyFromUrl(student.photo_url) : null;

  await db
    .update(students)
    .set({ photo_url: body.photo_url, updated_at: new Date() })
    .where(eq(students.id, id));

  const card = await upsertIdCardArt({
    studentId: id,
    fullName: student.full_name ?? student.student_code,
    studentCode: student.student_code,
    centreName: student.centre_name ?? "—",
    msvBadge: student.msv_status === "approved",
    photoUrl: body.photo_url,
    rotateQr: false,
  });

  if (previousKey && previousKey !== uploadKeyFromUrl(body.photo_url ?? "")) {
    await storage.remove(previousKey);
  }

  await auditFromReq(req, {
    action: "update",
    entityKind: "student",
    entityId: id,
    summary: body.photo_url ? "Student ID photo updated." : "Student ID photo cleared.",
  });

  ok(res, {
    student_id: id,
    photo_url: signUploadUrl(body.photo_url),
    id_card: {
      student_id: card.student_id,
      card_number: card.card_number,
      png_url: signUploadUrl(card.png_url),
      photo_url: signUploadUrl(body.photo_url),
      version_no: card.version_no,
      is_active: card.is_active,
      last_regenerated_at: card.last_regenerated_at,
    },
  });
});

/* Attendance history: use frozen GET /v1/students/:id/attendance (no /me alias). */

/**
 * GET /v1/me/students/:id/punya — balance + recent transactions.
 *
 * M19 — a DELIBERATE deviation from SPEC 6.9, which specifies separate
 * /punya/balance and /punya/transactions endpoints.
 *
 * Every caller of one wants the other: the screen renders a total, a tier and
 * the ledger behind them together, so splitting this would mean two requests
 * on a connection that is frequently poor, and a window in which the headline
 * total and the visible rows come from different moments and disagree. The
 * merged shape is the one the product actually needs; it is recorded here
 * rather than silently diverging.
 */
router.get("/students/:id/punya", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id) || !(await ownedStudentId(req, id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  const [balance] = await db
    .select({ total_points: punya_balances.total_points, tier: punya_balances.tier })
    .from(punya_balances)
    .where(eq(punya_balances.student_id, id))
    .limit(1);

  // The ledger was hard-capped at 50 with no cursor and no has_more, so a student
  // in their second term could not see how the earlier half of their balance was
  // earned — and the visible rows did not sum to the headline total.
  const limit = clampLimit(req.query.limit, 50, 200);
  const rows = await db
    .select({
      id: punya_transactions.id,
      feature_key: punya_transactions.feature_key,
      points: punya_transactions.points,
      note: punya_transactions.note,
      created_at: punya_transactions.created_at,
    })
    .from(punya_transactions)
    .where(eq(punya_transactions.student_id, id))
    .orderBy(desc(punya_transactions.created_at))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const txns = hasMore ? rows.slice(0, limit) : rows;

  // H4 — how far to the next tier. Nothing rendered it and nothing COULD:
  // no endpoint returned the thresholds and no client hardcoded them, so the
  // one number a child actually wants was unreachable from every surface.
  const total = balance?.total_points ?? 0;
  const thresholds = await resolveTierThresholds();
  const { next_tier, points_to_next } = nextTierFor(total, thresholds);

  ok(res, {
    total_points: total,
    tier: balance?.tier ?? "jigyasu",
    next_tier,
    points_to_next,
    transactions: txns.map((t) => ({ ...t, created_at: t.created_at.toISOString() })),
    has_more: hasMore,
  });
});

/* GET /v1/me/students/:id/niyams — recent niyam submissions (with signed proof) */
router.get("/students/:id/niyams", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id) || !(await ownedStudentId(req, id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  const limit = clampLimit(req.query.limit, 40, 120);
  const cursor = decodeDateCursor(req.query.cursor);
  // Keyset over (submission_date, created_at, id). Ordering on submission_date
  // alone reordered same-date rows between fetches, and with no cursor a child
  // with more submissions than one page could never reach their own history.
  const keyset = cursor
    ? or(
        lt(niyam_submissions.submission_date, cursor.date),
        and(
          eq(niyam_submissions.submission_date, cursor.date),
          or(
            lt(niyam_submissions.created_at, cursor.createdAt),
            and(
              eq(niyam_submissions.created_at, cursor.createdAt),
              lt(niyam_submissions.id, cursor.id),
            ),
          ),
        ),
      )
    : undefined;
  const rows = await db
    .select({
      id: niyam_submissions.id,
      niyam_title_en: niyams.title_en,
      niyam_title_hi: niyams.title_hi,
      niyam_type: niyams.niyam_type,
      submission_date: niyam_submissions.submission_date,
      created_at: niyam_submissions.created_at,
      status: niyam_submissions.status,
      points_awarded: niyam_submissions.points_awarded,
      is_featured: niyam_submissions.is_featured,
      notes: niyam_submissions.notes,
      rejection_reason: niyam_submissions.rejection_reason,
      proof_url: niyam_submissions.proof_url,
    })
    .from(niyam_submissions)
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .where(and(eq(niyam_submissions.student_id, id), keyset))
    .orderBy(
      desc(niyam_submissions.submission_date),
      desc(niyam_submissions.created_at),
      desc(niyam_submissions.id),
    )
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  // Same batched media shape as GET /v1/niyam-submissions/pending — no N+1.
  const ids = rows.map((r) => r.id);
  const mediaAll = ids.length
    ? await db
        .select({
          id: niyam_submission_media.id,
          submission_id: niyam_submission_media.submission_id,
          url: niyam_submission_media.url,
          kind: niyam_submission_media.kind,
          mime: niyam_submission_media.mime,
          size_bytes: niyam_submission_media.size_bytes,
          ordinal: niyam_submission_media.ordinal,
        })
        .from(niyam_submission_media)
        .where(inArray(niyam_submission_media.submission_id, ids))
        .orderBy(asc(niyam_submission_media.ordinal))
    : [];
  const bySub = new Map<string, typeof mediaAll>();
  for (const m of mediaAll) {
    const list = bySub.get(m.submission_id) ?? [];
    list.push(m);
    bySub.set(m.submission_id, list);
  }

  const items = rows.map((r) => ({
    id: r.id,
    niyam_title_en: r.niyam_title_en,
    niyam_title_hi: r.niyam_title_hi,
    niyam_type: r.niyam_type,
    submission_date: r.submission_date,
    status: r.status,
    points_awarded: r.points_awarded,
    is_featured: r.is_featured,
    notes: r.notes,
    rejection_reason: r.rejection_reason,
    proof_url: signUploadUrl(r.proof_url),
    media: (bySub.get(r.id) ?? []).map((m) => ({
      id: m.id,
      url: signUploadUrl(m.url),
      kind: m.kind,
      mime: m.mime,
      size_bytes: m.size_bytes,
      ordinal: m.ordinal,
    })),
  }));

  const last = rows[rows.length - 1];
  const nextCursor =
    hasMore && last ? encodeDateCursor(last.submission_date, last.created_at, last.id) : null;

  ok(res, { items, next_cursor: nextCursor }, { count: items.length });
});

/* GET /v1/me/niyam-catalog?student_id= — active niyams visible to this student */
router.get("/niyam-catalog", async (req: Request, res: Response) => {
  const studentIdRaw = req.query.student_id;
  const studentId = typeof studentIdRaw === "string" && UUID_RE.test(studentIdRaw) ? studentIdRaw : null;

  let studentCtx: {
    msv_status: string;
    city_id: string | null;
    state_id: string | null;
  } | null = null;

  if (studentId) {
    const uid = req.authUser!.id;
    const [owned] = await db
      .select({
        id: students.id,
        msv_status: students.msv_status,
        city_id: centres.city_id,
        state_id: centres.state_id,
      })
      .from(students)
      .leftJoin(centres, eq(centres.id, students.centre_id))
      // Q11 — shared ownership predicate (excludes soft-deleted and inactive students).
      .where(and(eq(students.id, studentId), ownedStudentsCondition(uid)))
      .limit(1);
    if (!owned) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
      return;
    }
    studentCtx = {
      msv_status: owned.msv_status,
      city_id: owned.city_id,
      state_id: owned.state_id,
    };
  }

  const today = istCalendarDate();
  /**
   * M2 — without a student_id the audience filter was skipped entirely, so any
   * authenticated user saw MSV-only niyams and every city's and state's private
   * ones. Client-side authorization is not authorization: when we have no
   * student to judge against, fall back to what is public to everyone — the
   * national, all-audience niyams — rather than to no filter at all.
   */
  const audienceWhere = studentCtx
    ? studentNiyamAccessWhere(studentCtx)
    : and(eq(niyams.scope, "national"), eq(niyams.msv_audience, "all"));
  const limit = clampLimit(req.query.limit, 100, 200);
  const rows = await db
    .select({
      id: niyams.id,
      title_en: niyams.title_en,
      title_hi: niyams.title_hi,
      niyam_type: niyams.niyam_type,
      proof_type: niyams.proof_type,
      proof_required: niyams.proof_required,
      approval_mode: niyams.approval_mode,
      max_uploads: niyams.max_uploads,
      points: niyams.points,
      scope: niyams.scope,
      state_id: niyams.state_id,
      city_id: niyams.city_id,
      msv_audience: niyams.msv_audience,
      start_date: niyams.start_date,
      end_date: niyams.end_date,
    })
    .from(niyams)
    .where(
      and(
        eq(niyams.is_active, true),
        lte(niyams.start_date, today),
        or(isNull(niyams.end_date), gte(niyams.end_date, today)),
        audienceWhere,
      ),
    )
    // M5 — was unbounded. A deterministic tiebreak matters because the three
    // fan-out queries below key on exactly this page of ids.
    .orderBy(desc(niyams.points), asc(niyams.id))
    .limit(limit);

  const items = rows;

  // Resolved once for the whole page, not per row (H11).
  const awardOverride = await resolveNiyamAwardOverride(studentCtx?.city_id ?? null);
  const awardPointsFor = (authored: number) => awardOverride ?? authored;

  // Current-period submission status in one query (no N+1).
  let periodByNiyam = new Map<
    string,
    { status: string; submission_date: string; period_key: string }
  >();
  if (studentId && items.length > 0) {
    const keys = items.map((n) => ({
      id: n.id,
      type: n.niyam_type as "daily" | "weekly" | "monthly",
      key: periodKey(n.niyam_type as "daily" | "weekly" | "monthly", today),
    }));
    const currentKeys = [...new Set(keys.map((k) => k.key))];
    const niyamIds = items.map((i) => i.id);
    const [subs, streakRows, badgeRows] = await Promise.all([
      db
        .select({
          niyam_id: niyam_submissions.niyam_id,
          status: niyam_submissions.status,
          submission_date: niyam_submissions.submission_date,
          period_key: niyam_submissions.period_key,
        })
        .from(niyam_submissions)
        .where(
          and(
            eq(niyam_submissions.student_id, studentId),
            inArray(niyam_submissions.niyam_id, items.map((i) => i.id)),
            inArray(niyam_submissions.period_key, currentKeys),
            ne(niyam_submissions.status, "rejected"),
          ),
        ),
      db
        .select({
          niyam_id: niyam_streaks.niyam_id,
          current_streak: niyam_streaks.current_streak,
          longest_streak: niyam_streaks.longest_streak,
        })
        .from(niyam_streaks)
        .where(
          and(eq(niyam_streaks.student_id, studentId), inArray(niyam_streaks.niyam_id, niyamIds)),
        ),
      db
        .select({
          niyam_id: niyam_badges.niyam_id,
          badge_key: niyam_badges.badge_key,
          streak_length: niyam_badges.streak_length,
          awarded_at: niyam_badges.awarded_at,
        })
        .from(niyam_badges)
        .where(
          and(eq(niyam_badges.student_id, studentId), inArray(niyam_badges.niyam_id, niyamIds)),
        ),
    ]);
    periodByNiyam = new Map(
      subs
        .filter((s) => s.period_key)
        .map((s) => [
          s.niyam_id,
          {
            status: s.status,
            submission_date: s.submission_date,
            period_key: s.period_key!,
          },
        ]),
    );
    const streakByNiyam = new Map(streakRows.map((s) => [s.niyam_id, s]));

    const badgesByNiyam = new Map<string, typeof badgeRows>();
    for (const b of badgeRows) {
      const list = badgesByNiyam.get(b.niyam_id) ?? [];
      list.push(b);
      badgesByNiyam.set(b.niyam_id, list);
    }

    const enriched = items.map((n) => {
      const pKey = periodKey(n.niyam_type as "daily" | "weekly" | "monthly", today);
      const sub = periodByNiyam.get(n.id);
      const submitted = !!sub && sub.period_key === pKey;
      const streak = streakByNiyam.get(n.id);
      const earned = badgesByNiyam.get(n.id) ?? [];
      return {
        ...n,
        /**
         * H11 — what the child will ACTUALLY be awarded. The `points` column is
         * the authored value; `resolveNiyamAwardPoints` prefers a city (then
         * global) punya_configs override, so wherever a config exists the
         * catalog pill promised a number the ledger never paid.
         */
        award_points: awardPointsFor(n.points),
        /** review-mode awards nothing until a Guruji acts — qualify the pill. */
        awards_on_approval: n.approval_mode === "review",
        current_period_key: pKey,
        period_label_en: periodLabel(n.niyam_type as "daily" | "weekly" | "monthly", pKey, "en"),
        period_label_hi: periodLabel(n.niyam_type as "daily" | "weekly" | "monthly", pKey, "hi"),
        submitted_this_period: submitted,
        submission_status: submitted ? sub!.status : null,
        submission_date: submitted ? sub!.submission_date : null,
        period_status_tag_en: submitted
          ? submittedPeriodTag(n.niyam_type as "daily" | "weekly" | "monthly", "en")
          : null,
        period_status_tag_hi: submitted
          ? submittedPeriodTag(n.niyam_type as "daily" | "weekly" | "monthly", "hi")
          : null,
        current_streak: streak?.current_streak ?? 0,
        longest_streak: streak?.longest_streak ?? 0,
        earned_badges: earned.map((b) => ({
          badge_key: b.badge_key,
          streak_length: b.streak_length,
          awarded_at: b.awarded_at.toISOString(),
        })),
      };
    });
    ok(res, { items: enriched }, { count: enriched.length });
    return;
  }

  ok(
    res,
    {
      items: items.map((n) => ({
        ...n,
        award_points: awardPointsFor(n.points),
        awards_on_approval: n.approval_mode === "review",
      })),
    },
    { count: items.length },
  );
});

/* Shikshak today: use frozen GET /v1/sessions/today (no /me alias). */

export default router;
