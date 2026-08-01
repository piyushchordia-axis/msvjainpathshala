/**
 * /v1/niyam-submissions — student niyam submission + shikshak review.
 *
 * Approval is driven by niyams.approval_mode (auto | review), not by proof
 * presence. Period uniqueness uses period_key (daily/weekly/monthly IST).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  niyams,
  niyam_submissions,
  niyam_submission_media,
  niyam_streaks,
  students,
  centres,
  gallery_items,
  notifications,
  device_push_tokens,
  punya_transactions,
  upload_objects,
} from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { httpUrl } from "../../lib/validation";
import { signUploadUrl, uploadKeyFromUrl } from "../../lib/file-tokens";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope } from "../../lib/scope";
import { awardPunya, reversePunya } from "../../lib/punya";
import { auditFromReq } from "../../lib/audit";
import {
  clampLimit,
  inScope,
  ownedStudentId,
  scopedCentreFilter,
} from "../../lib/route-helpers";
import { rejectionWindowFields, canRejectSubmission } from "../../lib/niyam-constants";
import { sendPush } from "../../lib/push";
import { studentCanAccessNiyam } from "../../lib/niyam-audience";
import { awardNewlyReachedBadges, notifyBadgesPush, type AwardedBadge } from "../../lib/niyam-badges";
import { resolveNiyamAwardPoints } from "../../lib/niyam-points";
import { rateLimit } from "../../lib/ratelimit";
import {
  allowedMediaKinds,
  addCalendarDays,
  istCalendarDate,
  periodKey,
  previousPeriodKey,
  STREAK_RECOMPUTE_LOOKBACK_DAYS,
  SUBMISSION_BACKDATE_DAYS,
  type NiyamPeriodType,
} from "../../lib/niyam-period";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const router: IRouter = Router();
router.use(requireAuth);

function todayIstDate(): string {
  return istCalendarDate();
}

/** Earliest submission_date allowed relative to today (IST). */
function earliestAllowedSubmissionDate(today: string): string {
  return addCalendarDays(today, -SUBMISSION_BACKDATE_DAYS);
}

function isNiyamProofUrl(url: string): boolean {
  const key = uploadKeyFromUrl(url);
  if (key) return key.startsWith("niyam-proof/");
  try {
    const u = new URL(url);
    return u.pathname.includes("/uploads/niyam-proof/");
  } catch {
    return url.includes("/uploads/niyam-proof/");
  }
}

/**
 * Caller must own the upload_objects row, or the key is unclaimed (legacy /
 * seed URLs with no registry entry). Stolen claimed keys → reject.
 */
async function callerOwnsProofUrl(userId: string, url: string): Promise<boolean> {
  const key = uploadKeyFromUrl(url);
  if (!key || !key.startsWith("niyam-proof/")) return false;
  const [row] = await db
    .select({ uploaded_by: upload_objects.uploaded_by })
    .from(upload_objects)
    .where(eq(upload_objects.key, key))
    .limit(1);
  if (!row) return true;
  return row.uploaded_by === userId;
}

/** Insert a gallery row from the first photo media; skip if none. Consent is query-time. */
async function maybeInsertGalleryFromSubmission(
  tx: Tx,
  opts: {
    submissionId: string;
    studentId: string;
    niyamId: string;
    media: Array<{ url: string; kind: string }>;
  },
): Promise<void> {
  const photo = opts.media.find((m) => m.kind === "photo");
  if (!photo) return;
  await tx.insert(gallery_items).values({
    submission_id: opts.submissionId,
    student_id: opts.studentId,
    niyam_id: opts.niyamId,
    image_url: photo.url,
    is_public: true,
    is_featured: false,
    created_by: null,
  });
}

/**
 * Rebuild streak from non-rejected submissions in the last STREAK_RECOMPUTE_LOOKBACK_DAYS.
 * longest_streak = max(stored, recomputed) so a rejection never lowers a peak already reached.
 *
 * Badges are NOT revoked here — see awardNewlyReachedBadges.
 */
async function recomputeStreak(
  studentId: string,
  niyamId: string,
  niyamType: NiyamPeriodType,
  exec: Tx | typeof db = db,
): Promise<{ current: number; longest: number }> {
  const today = todayIstDate();
  const cutoff = addCalendarDays(today, -STREAK_RECOMPUTE_LOOKBACK_DAYS);

  const rows = await exec
    .select({
      period_key: niyam_submissions.period_key,
      submission_date: niyam_submissions.submission_date,
    })
    .from(niyam_submissions)
    .where(
      and(
        eq(niyam_submissions.student_id, studentId),
        eq(niyam_submissions.niyam_id, niyamId),
        ne(niyam_submissions.status, "rejected"),
        gte(niyam_submissions.submission_date, cutoff),
      ),
    )
    .orderBy(asc(niyam_submissions.submission_date));

  const [existing] = await exec
    .select({
      id: niyam_streaks.id,
      longest_streak: niyam_streaks.longest_streak,
    })
    .from(niyam_streaks)
    .where(and(eq(niyam_streaks.student_id, studentId), eq(niyam_streaks.niyam_id, niyamId)))
    .limit(1);

  if (rows.length === 0) {
    if (existing) {
      await exec
        .update(niyam_streaks)
        .set({
          current_streak: 0,
          // Preserve historical peak.
          longest_streak: existing.longest_streak,
          last_submission_date: null,
          last_period_key: null,
        })
        .where(eq(niyam_streaks.id, existing.id));
    }
    return { current: 0, longest: existing?.longest_streak ?? 0 };
  }

  const seen = new Set<string>();
  const ordered: { period_key: string; submission_date: string }[] = [];
  for (const r of rows) {
    if (!r.period_key || seen.has(r.period_key)) continue;
    seen.add(r.period_key);
    ordered.push({ period_key: r.period_key, submission_date: r.submission_date });
  }

  let current = 0;
  let recomputedLongest = 0;
  let prevKey: string | null = null;
  for (const r of ordered) {
    if (prevKey && previousPeriodKey(niyamType, r.period_key) === prevKey) {
      current += 1;
    } else {
      current = 1;
    }
    recomputedLongest = Math.max(recomputedLongest, current);
    prevKey = r.period_key;
  }
  const last = ordered[ordered.length - 1]!;
  const longest = Math.max(existing?.longest_streak ?? 0, recomputedLongest);

  if (existing) {
    await exec
      .update(niyam_streaks)
      .set({
        current_streak: current,
        longest_streak: longest,
        last_submission_date: last.submission_date,
        last_period_key: last.period_key,
      })
      .where(eq(niyam_streaks.id, existing.id));
  } else {
    await exec.insert(niyam_streaks).values({
      student_id: studentId,
      niyam_id: niyamId,
      current_streak: current,
      longest_streak: longest,
      last_submission_date: last.submission_date,
      last_period_key: last.period_key,
    });
  }

  return { current, longest };
}

/** Post-commit parent alert when a submission is rejected (insert gates push). */
async function notifyParentOfRejection(opts: {
  parentId: string | null;
  studentName: string;
  niyamTitleEn: string;
  niyamTitleHi: string | null;
  reason: string;
  submissionId: string;
}): Promise<void> {
  if (!opts.parentId) return;

  const titleEn = "Niyam submission rejected";
  const titleHi = "नियम जमा अस्वीकृत";
  const bodyEn = `${opts.studentName}'s submission for "${opts.niyamTitleEn}" was rejected: ${opts.reason}`;
  const bodyHi = `${opts.studentName} का "${opts.niyamTitleHi ?? opts.niyamTitleEn}" जमा अस्वीकृत: ${opts.reason}`;

  const [inserted] = await db
    .insert(notifications)
    .values({
      user_id: opts.parentId,
      kind: "niyam_rejected",
      title_en: titleEn,
      title_hi: titleHi,
      body_en: bodyEn,
      body_hi: bodyHi,
    })
    .returning({ id: notifications.id });

  if (!inserted) return;

  try {
    const tokens = await db
      .select({ expo_token: device_push_tokens.expo_token })
      .from(device_push_tokens)
      .where(
        and(
          eq(device_push_tokens.user_id, opts.parentId),
          eq(device_push_tokens.is_active, true),
        ),
      );
    if (tokens.length === 0) return;
    await sendPush(
      tokens.map((t) => ({
        to: t.expo_token,
        title: titleEn,
        body: bodyEn,
        data: { kind: "niyam_rejected", submission_id: opts.submissionId },
      })),
    );
  } catch {
    // Best-effort push — inbox row already committed.
  }
}

function encodeSubmissionCursor(submissionDate: string, id: string): string {
  return Buffer.from(`${submissionDate}|${id}`, "utf8").toString("base64url");
}

function decodeSubmissionCursor(raw: unknown): { date: string; id: string } | null {
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

function cursorWhere(cursor: { date: string; id: string }) {
  return or(
    lt(niyam_submissions.submission_date, cursor.date),
    and(eq(niyam_submissions.submission_date, cursor.date), lt(niyam_submissions.id, cursor.id)),
  );
}

const mediaItemSchema = z.object({
  url: httpUrl(2000),
  kind: z.enum(["photo", "video", "audio"]),
  mime: z.string().max(100).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
});

const createSubmissionSchema = z.object({
  niyam_id: z.string().uuid(),
  student_id: z.string().uuid(),
  submission_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** @deprecated prefer media[] */
  proof_url: httpUrl(2000).optional(),
  media: z.array(mediaItemSchema).max(10).optional(),
  notes: z.string().max(500).optional(),
});

/* POST /v1/niyam-submissions */
router.post("/", async (req: Request, res: Response) => {
  const uid = req.authUser!.id;
  if (await rateLimit(`niyam:submit:hour:${uid}`, 20, 3600)) {
    fail(res, 429, "ERR_RATE_LIMITED", "Too many requests. Please try again later.");
    return;
  }
  if (await rateLimit(`niyam:submit:min:${uid}`, 5, 60)) {
    fail(res, 429, "ERR_RATE_LIMITED", "Too many requests. Please try again later.");
    return;
  }

  let body: z.infer<typeof createSubmissionSchema>;
  try { body = createSubmissionSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid submission data."); return; }

  if (!(await ownedStudentId(req, body.student_id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found."); return;
  }

  const [studentCtx] = await db
    .select({
      msv_status: students.msv_status,
      parent_id: students.parent_id,
      full_name: students.full_name,
      city_id: centres.city_id,
      state_id: centres.state_id,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(eq(students.id, body.student_id))
    .limit(1);
  if (!studentCtx) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found."); return;
  }

  const [niyam] = await db
    .select({
      id: niyams.id,
      proof_type: niyams.proof_type,
      proof_required: niyams.proof_required,
      approval_mode: niyams.approval_mode,
      max_uploads: niyams.max_uploads,
      niyam_type: niyams.niyam_type,
      points: niyams.points,
      start_date: niyams.start_date,
      end_date: niyams.end_date,
      msv_audience: niyams.msv_audience,
      scope: niyams.scope,
      state_id: niyams.state_id,
      city_id: niyams.city_id,
    })
    .from(niyams)
    .where(and(eq(niyams.id, body.niyam_id), eq(niyams.is_active, true)))
    .limit(1);
  if (!niyam) {
    fail(res, 404, "ERR_NOT_FOUND", "Niyam not found."); return;
  }

  if (
    !studentCanAccessNiyam(
      {
        msv_audience: niyam.msv_audience,
        scope: niyam.scope,
        state_id: niyam.state_id,
        city_id: niyam.city_id,
      },
      {
        msv_status: studentCtx.msv_status,
        city_id: studentCtx.city_id,
        state_id: studentCtx.state_id,
      },
    )
  ) {
    fail(res, 403, "ERR_FORBIDDEN", "This niyam is not available for this student.");
    return;
  }

  const today = todayIstDate();
  const submissionDate = body.submission_date ?? today;
  if (submissionDate > today) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "submission_date cannot be in the future."); return;
  }
  if (submissionDate < earliestAllowedSubmissionDate(today)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "submission_date too old."); return;
  }

  // Spec §8.4 step 6 — compare submission_date to the niyam window, not now().
  if (niyam.start_date && submissionDate < niyam.start_date) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "submission_date is before this niyam starts."); return;
  }
  if (niyam.end_date && submissionDate > niyam.end_date) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "submission_date is after this niyam ended."); return;
  }

  let media = body.media ?? [];
  if (media.length === 0 && body.proof_url) {
    const kinds = allowedMediaKinds(niyam.proof_type);
    media = [{ url: body.proof_url, kind: kinds[0] ?? "photo" }];
  }

  if (niyam.max_uploads === 0 && media.length > 0) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "This niyam does not accept media."); return;
  }
  if (media.length > niyam.max_uploads) {
    fail(res, 422, "ERR_VALIDATION_FAILED", `At most ${niyam.max_uploads} file(s) allowed.`); return;
  }
  if (niyam.proof_required && media.length === 0) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Proof required."); return;
  }

  const allowed = allowedMediaKinds(niyam.proof_type);
  for (const m of media) {
    if (!allowed.includes(m.kind)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", `Media kind "${m.kind}" is not allowed for this niyam.`); return;
    }
    if (!isNiyamProofUrl(m.url)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Media URL must be an uploaded niyam-proof file."); return;
    }
    if (!(await callerOwnsProofUrl(uid, m.url))) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Media URL is not owned by the caller."); return;
    }
  }

  const pKey = periodKey(niyam.niyam_type as NiyamPeriodType, submissionDate);
  const autoApprove = niyam.approval_mode === "auto";
  const awardPoints = autoApprove
    ? await resolveNiyamAwardPoints(niyam.points, studentCtx.city_id)
    : 0;
  const status = autoApprove ? "auto_approved" : "pending";
  const pointsAwarded = autoApprove ? awardPoints : 0;
  const firstUrl = media[0]?.url ?? null;

  const lockKey = `niyam:${niyam.id}:${body.student_id}:${pKey}`;
  type TxResult = {
    row: typeof niyam_submissions.$inferSelect;
    newBadges: AwardedBadge[];
  };
  const outcome = await db.transaction(async (tx): Promise<TxResult | null> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [dup] = await tx
      .select({ id: niyam_submissions.id })
      .from(niyam_submissions)
      .where(
        and(
          eq(niyam_submissions.niyam_id, niyam.id),
          eq(niyam_submissions.student_id, body.student_id),
          eq(niyam_submissions.period_key, pKey),
          ne(niyam_submissions.status, "rejected"),
        ),
      )
      .limit(1);
    if (dup) return null;
    const [created] = await tx
      .insert(niyam_submissions)
      .values({
        niyam_id: niyam.id,
        student_id: body.student_id,
        submission_date: submissionDate,
        period_key: pKey,
        status,
        points_awarded: pointsAwarded,
        proof_url: firstUrl,
        notes: body.notes ?? null,
        submitted_by: uid,
      })
      .returning();
    if (media.length > 0) {
      await tx.insert(niyam_submission_media).values(
        media.map((m, i) => ({
          submission_id: created.id,
          url: m.url,
          kind: m.kind,
          mime: m.mime ?? null,
          size_bytes: m.size_bytes ?? null,
          ordinal: i,
        })),
      );
    }

    let row = created;
    let newBadges: AwardedBadge[] = [];

    if (autoApprove) {
      const award = await awardPunya(
        {
          studentId: body.student_id,
          featureKey: "niyam_submission",
          points: awardPoints,
          note: body.notes ?? null,
          awardedBy: uid,
          idempotencyKey: `submission:${created.id}`,
        },
        tx,
      );
      const now = new Date();
      const [updated] = await tx
        .update(niyam_submissions)
        .set({
          approved_at: now,
          punya_transaction_id: award.transaction_id,
        })
        .where(eq(niyam_submissions.id, created.id))
        .returning();
      row = updated ?? created;

      await maybeInsertGalleryFromSubmission(tx, {
        submissionId: created.id,
        studentId: body.student_id,
        niyamId: niyam.id,
        media,
      });

      const streak = await recomputeStreak(
        body.student_id,
        niyam.id,
        niyam.niyam_type as NiyamPeriodType,
        tx,
      );
      newBadges = await awardNewlyReachedBadges(
        {
          studentId: body.student_id,
          niyamId: niyam.id,
          niyamType: niyam.niyam_type as NiyamPeriodType,
          currentStreak: streak.current,
          awardedBy: uid,
        },
        tx,
      );
    }

    return { row, newBadges };
  });
  if (!outcome) {
    fail(res, 409, "ERR_NIYAM_PERIOD_DUPLICATE", `Already submitted for this ${niyam.niyam_type} period (${pKey}).`);
    return;
  }

  const { row, newBadges } = outcome;

  if (autoApprove) {
    await auditFromReq(req, {
      action: "award",
      entityKind: "niyam_submission",
      entityId: row.id,
      summary: `Auto-approved niyam submission (+${awardPoints}).`,
      metadata: {
        niyam_id: niyam.id,
        student_id: body.student_id,
        points: awardPoints,
        submission_date: submissionDate,
        period_key: pKey,
      },
    });
    await notifyBadgesPush({
      parentUserId: studentCtx.parent_id,
      studentName: studentCtx.full_name,
      badges: newBadges,
    });
  }

  const mediaRows = await db
    .select()
    .from(niyam_submission_media)
    .where(eq(niyam_submission_media.submission_id, row.id))
    .orderBy(asc(niyam_submission_media.ordinal));

  ok(res, {
    id: row.id,
    niyam_id: row.niyam_id,
    student_id: row.student_id,
    submission_date: row.submission_date,
    period_key: row.period_key,
    status: row.status,
    points_awarded: row.points_awarded,
    is_featured: row.is_featured,
    proof_url: signUploadUrl(row.proof_url),
    media: mediaRows.map((m) => ({
      id: m.id,
      url: signUploadUrl(m.url),
      kind: m.kind,
      mime: m.mime,
      size_bytes: m.size_bytes,
      ordinal: m.ordinal,
    })),
    notes: row.notes,
    reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    new_badges: newBadges,
    ...rejectionWindowFields(row.status, row.created_at),
  });
});

/* GET /v1/niyam-submissions/pending */
router.get("/pending", requireAdminPanel, async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
  const cursor = decodeSubmissionCursor(req.query.cursor);

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
      submission_date: niyam_submissions.submission_date,
      period_key: niyam_submissions.period_key,
      status: niyam_submissions.status,
      created_at: niyam_submissions.created_at,
    })
    .from(niyam_submissions)
    .innerJoin(students, eq(students.id, niyam_submissions.student_id))
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .where(
      and(
        eq(niyam_submissions.status, "pending"),
        centreFilter,
        cursor ? cursorWhere(cursor) : undefined,
      ),
    )
    .orderBy(desc(niyam_submissions.submission_date), desc(niyam_submissions.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeSubmissionCursor(last.submission_date, last.id) : null;

  const ids = page.map((r) => r.id);
  const mediaAll = ids.length
    ? await db
        .select()
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
    submission_date: r.submission_date,
    period_key: r.period_key,
    status: r.status,
    created_at: r.created_at.toISOString(),
    media: (bySub.get(r.id) ?? []).map((m) => ({
      id: m.id,
      url: signUploadUrl(m.url),
      kind: m.kind,
      mime: m.mime,
      size_bytes: m.size_bytes,
      ordinal: m.ordinal,
    })),
    ...rejectionWindowFields(r.status, r.created_at),
  }));
  ok(res, { items, next_cursor: nextCursor }, { count: items.length });
});

const rejectSchema = z.object({
  reason: z.string().trim().min(20).max(300),
});

/* POST /v1/niyam-submissions/:id/approve */
router.post("/:id/approve", requireAdminPanel, async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const [sub] = await db
    .select({
      id: niyam_submissions.id,
      status: niyam_submissions.status,
      student_id: niyam_submissions.student_id,
      niyam_id: niyam_submissions.niyam_id,
      submission_date: niyam_submissions.submission_date,
      period_key: niyam_submissions.period_key,
      notes: niyam_submissions.notes,
      created_at: niyam_submissions.created_at,
      centre_id: students.centre_id,
      parent_id: students.parent_id,
      student_name: students.full_name,
      city_id: centres.city_id,
      points: niyams.points,
      niyam_type: niyams.niyam_type,
    })
    .from(niyam_submissions)
    .innerJoin(students, eq(students.id, niyam_submissions.student_id))
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .where(eq(niyam_submissions.id, String(req.params.id)))
    .limit(1);
  if (!sub || !inScope(scope, sub.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Submission not found."); return;
  }

  const awardPoints = await resolveNiyamAwardPoints(sub.points, sub.city_id);

  const award = await db.transaction(async (tx) => {
    const now = new Date();
    const updated = await tx
      .update(niyam_submissions)
      .set({
        status: "approved",
        points_awarded: awardPoints,
        reviewed_by: req.authUser!.id,
        reviewed_at: now,
        approved_at: now,
      })
      .where(and(eq(niyam_submissions.id, sub.id), eq(niyam_submissions.status, "pending")))
      .returning({ id: niyam_submissions.id });
    if (updated.length === 0) return null;

    const result = await awardPunya(
      {
        studentId: sub.student_id,
        featureKey: "niyam_submission",
        points: awardPoints,
        note: sub.notes ?? null,
        awardedBy: req.authUser!.id,
        idempotencyKey: `submission:${sub.id}`,
      },
      tx,
    );

    if (result.transaction_id) {
      await tx
        .update(niyam_submissions)
        .set({ punya_transaction_id: result.transaction_id })
        .where(eq(niyam_submissions.id, sub.id));
    }

    const mediaRows = await tx
      .select({ url: niyam_submission_media.url, kind: niyam_submission_media.kind })
      .from(niyam_submission_media)
      .where(eq(niyam_submission_media.submission_id, sub.id))
      .orderBy(asc(niyam_submission_media.ordinal));
    await maybeInsertGalleryFromSubmission(tx, {
      submissionId: sub.id,
      studentId: sub.student_id,
      niyamId: sub.niyam_id,
      media: mediaRows,
    });

    const streak = await recomputeStreak(
      sub.student_id,
      sub.niyam_id,
      sub.niyam_type as NiyamPeriodType,
      tx,
    );
    const newBadges = await awardNewlyReachedBadges(
      {
        studentId: sub.student_id,
        niyamId: sub.niyam_id,
        niyamType: sub.niyam_type as NiyamPeriodType,
        currentStreak: streak.current,
        awardedBy: req.authUser!.id,
      },
      tx,
    );

    return { result, newBadges };
  });

  if (!award) {
    fail(res, 409, "ERR_INVALID_STATE", "Submission is not pending."); return;
  }

  await auditFromReq(req, {
    action: "approve",
    entityKind: "niyam_submission",
    entityId: sub.id,
    summary: `Approved niyam submission (+${awardPoints}).`,
    metadata: {
      niyam_id: sub.niyam_id,
      student_id: sub.student_id,
      points: awardPoints,
      submission_date: sub.submission_date,
    },
  });

  await notifyBadgesPush({
    parentUserId: sub.parent_id,
    studentName: sub.student_name,
    badges: award.newBadges,
  });

  ok(res, {
    id: sub.id,
    status: "approved",
    total_points: award.result.total_points,
    tier: award.result.tier,
    new_badges: award.newBadges,
    ...rejectionWindowFields("approved", sub.created_at),
  });
});

/* POST /v1/niyam-submissions/:id/reject — pending | auto_approved | approved */
router.post("/:id/reject", requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof rejectSchema>;
  try { body = rejectSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid reject payload."); return; }

  const scope = await resolveAdminScope(req.authUser!);
  const [sub] = await db
    .select({
      id: niyam_submissions.id,
      status: niyam_submissions.status,
      student_id: niyam_submissions.student_id,
      niyam_id: niyam_submissions.niyam_id,
      points_awarded: niyam_submissions.points_awarded,
      notes: niyam_submissions.notes,
      created_at: niyam_submissions.created_at,
      punya_transaction_id: niyam_submissions.punya_transaction_id,
      centre_id: students.centre_id,
      parent_id: students.parent_id,
      student_name: students.full_name,
      niyam_type: niyams.niyam_type,
      niyam_title_en: niyams.title_en,
      niyam_title_hi: niyams.title_hi,
    })
    .from(niyam_submissions)
    .innerJoin(students, eq(students.id, niyam_submissions.student_id))
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .where(eq(niyam_submissions.id, String(req.params.id)))
    .limit(1);
  if (!sub || !inScope(scope, sub.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Submission not found."); return;
  }

  const rejectable = ["pending", "auto_approved", "approved"] as const;
  if (!rejectable.includes(sub.status as (typeof rejectable)[number])) {
    fail(res, 409, "ERR_INVALID_STATE", "Submission cannot be rejected."); return;
  }

  if (
    (sub.status === "auto_approved" || sub.status === "approved") &&
    !canRejectSubmission(sub.status, sub.created_at)
  ) {
    fail(
      res,
      409,
      "ERR_NIYAM_REVERSAL_WINDOW_EXPIRED",
      "The 30-day rejection window for this submission has closed.",
    );
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const now = new Date();
    const rejected = await tx
      .update(niyam_submissions)
      .set({
        status: "rejected",
        rejected_at: now,
        rejected_by: req.authUser!.id,
        rejection_reason: body.reason,
        points_awarded: 0,
      })
      .where(
        and(
          eq(niyam_submissions.id, sub.id),
          inArray(niyam_submissions.status, [...rejectable]),
        ),
      )
      .returning({ id: niyam_submissions.id });
    if (rejected.length === 0) return { ok: false as const };

    let reverseResult: Awaited<ReturnType<typeof reversePunya>> | null = null;
    if (sub.points_awarded > 0) {
      reverseResult = await reversePunya(
        {
          studentId: sub.student_id,
          featureKey: "niyam_submission",
          points: sub.points_awarded,
          note: body.reason,
          awardedBy: req.authUser!.id,
          idempotencyKey: `submission:${sub.id}:reversal`,
        },
        tx,
      );

      let awardTxnId = sub.punya_transaction_id;
      if (!awardTxnId) {
        const [origRow] = await tx
          .select({ id: punya_transactions.id })
          .from(punya_transactions)
          .where(eq(punya_transactions.idempotency_key, `submission:${sub.id}`))
          .limit(1);
        awardTxnId = origRow?.id ?? null;
      }

      await tx
        .update(niyam_submissions)
        .set({
          reversal_transaction_id: reverseResult.transaction_id,
          punya_transaction_id: awardTxnId,
        })
        .where(eq(niyam_submissions.id, sub.id));
    }

    // Recompute may lower current_streak; badges already earned stay (historical).
    await recomputeStreak(sub.student_id, sub.niyam_id, sub.niyam_type as NiyamPeriodType, tx);

    await tx
      .update(gallery_items)
      .set({ is_public: false, deleted_at: new Date() })
      .where(eq(gallery_items.submission_id, sub.id));

    return { ok: true as const, reverseResult };
  });

  if (!outcome.ok) {
    fail(res, 409, "ERR_INVALID_STATE", "Submission could not be rejected."); return;
  }

  await auditFromReq(req, {
    action: "reject",
    entityKind: "niyam_submission",
    entityId: sub.id,
    summary: "Rejected niyam submission.",
    metadata: {
      reason: body.reason,
      points_reversed: outcome.reverseResult?.points_reversed ?? 0,
      prior_status: sub.status,
    },
  });

  await notifyParentOfRejection({
    parentId: sub.parent_id,
    studentName: sub.student_name,
    niyamTitleEn: sub.niyam_title_en,
    niyamTitleHi: sub.niyam_title_hi,
    reason: body.reason,
    submissionId: sub.id,
  });

  ok(res, {
    id: sub.id,
    status: "rejected",
    points_reversed: outcome.reverseResult?.points_reversed ?? 0,
    total_points: outcome.reverseResult?.total_points,
    tier: outcome.reverseResult?.tier,
    ...rejectionWindowFields("rejected", sub.created_at),
  });
});

export default router;
