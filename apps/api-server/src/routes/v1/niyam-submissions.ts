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
  batches,
  gallery_items,
  punya_transactions,
  users,
} from "@workspace/db";
import { NIYAM_SUBMISSION_STATUSES } from "@workspace/db/enums";
import { and, asc, desc, eq, gt, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { QUEUE_NAMES, CRON_EXPRESSIONS } from "@jp/shared/constants";
import { ok, fail, zodDetails } from "../../lib/envelope";
import { httpUrl } from "../../lib/validation";
import { signUploadUrl, uploadKeyFromUrl } from "../../lib/file-tokens";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, inBatchWriteScope, inCentreScope as inScope } from "../../lib/scope";
import { reversePunya } from "../../lib/punya";
import { auditFromReq, writeAudit, impersonatorIdFromReq } from "../../lib/audit";
import {
  clampLimit,
  ownedStudentId,
  scopedCentreFilter,
} from "../../lib/route-helpers";
import { rejectionWindowFields, canRejectSubmission } from "../../lib/niyam-constants";
import { notifyUsers } from "../../lib/notify";
import { notifyBadgesPush } from "../../lib/niyam-badges";
import { rateLimit } from "../../lib/ratelimit";
import { registerCron } from "../../lib/scheduler";
import { logger } from "../../lib/logger";
import { MIME_BY_EXT } from "../../lib/upload";
import type { ProofMediaKind } from "../../lib/niyam-media";
import {
  addCalendarDays,
  istCalendarDate,
  periodKey,
  previousPeriodKey,
  streakLookbackDays,
  type NiyamPeriodType,
} from "../../lib/niyam-period";
import { approveNiyamSubmission } from "../../services/niyam-approve";
import {
  submitNiyam,
  NiyamSubmitError,
  type SubmitNiyamOutcome,
} from "../../services/niyam-submit";
import {
  NIYAM_REJECT_REASON_MIN,
  NIYAM_REJECT_REASON_MAX,
  type Role,
} from "@workspace/api-zod";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router: IRouter = Router();
router.use(requireAuth);

function todayIstDate(): string {
  return istCalendarDate();
}

// Media types + resolution live in lib/niyam-media.ts, and the whole submit
// sequence in services/niyam-submit.ts, so the offline /v1/sync/batch handler
// runs identical code (CLAUDE.md offline sync §4).

/** Derive photo/video/audio from stored content_type (or key extension fallback). */
export function kindFromUploadContentType(
  contentType: string | null | undefined,
  key: string,
): ProofMediaKind | null {
  let mime = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (!mime) {
    const dot = key.lastIndexOf(".");
    if (dot >= 0) {
      mime = (MIME_BY_EXT[key.slice(dot + 1).toLowerCase()] ?? "").toLowerCase();
    }
  }
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

/**
 * Rebuild streak from non-rejected submissions inside the type-aware lookback window.
 * longest_streak = max(stored, recomputed) so a rejection never lowers a peak already reached.
 *
 * Badges are NOT revoked here — see awardNewlyReachedBadges.
 *
 * Exported for unit tests (lapse behaviour) without going through HTTP submit.
 */
export async function recomputeStreak(
  studentId: string,
  niyamId: string,
  niyamType: NiyamPeriodType,
  exec: Tx | typeof db = db,
): Promise<{ current: number; longest: number }> {
  const today = todayIstDate();
  // Type-aware: a flat 400 days is only ~13 periods for a monthly niyam, so a
  // longer monthly streak could never be rebuilt (L10).
  const cutoff = addCalendarDays(today, -streakLookbackDays(niyamType));

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
  let walkPrev: string | null = null;
  for (const r of ordered) {
    if (walkPrev && previousPeriodKey(niyamType, r.period_key) === walkPrev) {
      current += 1;
    } else {
      current = 1;
    }
    recomputedLongest = Math.max(recomputedLongest, current);
    walkPrev = r.period_key;
  }
  const last = ordered[ordered.length - 1]!;
  const longest = Math.max(existing?.longest_streak ?? 0, recomputedLongest);

  // Lapse check: the walk ends at the LAST submission's run length, which is
  // stale if the child stopped submitting. A streak is still alive when the
  // last period is today OR the immediately previous period (e.g. daily: still
  // alive at 9am today if yesterday was submitted; it only dies once today is
  // also missed). Keep last_submission_date / last_period_key as history.
  const todayKey = periodKey(niyamType, today);
  const alivePrevKey = previousPeriodKey(niyamType, todayKey);
  if (last.period_key !== todayKey && last.period_key !== alivePrevKey) {
    current = 0;
  }

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

const STREAK_LAPSE_BATCH = 200;

/**
 * Zero `current_streak` for rows whose last_period_key is neither the current
 * nor previous period for that niyam's type. Batched — does not call
 * recomputeStreak per row. Exported so tests can invoke without the scheduler.
 */
export async function runNiyamStreakLapse(): Promise<{ zeroed: number }> {
  const today = todayIstDate();
  const types: NiyamPeriodType[] = ["daily", "weekly", "monthly"];
  let zeroed = 0;

  for (const niyamType of types) {
    const todayKey = periodKey(niyamType, today);
    const prevKey = previousPeriodKey(niyamType, todayKey);

    // Cursor-batch by id so we never load the whole table into memory.
    let afterId: string | null = null;
    for (;;) {
      const filters = [
        eq(niyams.niyam_type, niyamType),
        gt(niyam_streaks.current_streak, 0),
        sql`${niyam_streaks.last_period_key} is not null`,
        ne(niyam_streaks.last_period_key, todayKey),
        ne(niyam_streaks.last_period_key, prevKey),
      ];
      if (afterId) filters.push(gt(niyam_streaks.id, afterId));

      const batch = await db
        .select({ id: niyam_streaks.id })
        .from(niyam_streaks)
        .innerJoin(niyams, eq(niyams.id, niyam_streaks.niyam_id))
        .where(and(...filters))
        .orderBy(asc(niyam_streaks.id))
        .limit(STREAK_LAPSE_BATCH);

      if (batch.length === 0) break;

      const ids = batch.map((r) => r.id);
      await db
        .update(niyam_streaks)
        .set({ current_streak: 0, updated_at: new Date() })
        .where(inArray(niyam_streaks.id, ids));
      zeroed += ids.length;
      afterId = ids[ids.length - 1]!;
      if (batch.length < STREAK_LAPSE_BATCH) break;
    }
  }

  return { zeroed };
}

// Frozen cron: niyam-streak-lapse @ 05:00 IST (ReplitAgent §9.5). No timer in tests.
registerCron(QUEUE_NAMES.NIYAM_STREAK_LAPSE, CRON_EXPRESSIONS.NIYAM_STREAK_LAPSE, async () => {
  await runNiyamStreakLapse();
});

/** Post-commit parent alert when a submission is rejected. */
async function notifyParentOfRejection(opts: {
  parentId: string | null;
  studentName: string;
  niyamTitleEn: string;
  niyamTitleHi: string | null;
  reason: string;
  submissionId: string;
}): Promise<void> {
  if (!opts.parentId) return;

  // Request-handler path — never fail reject on notify (FIX #6).
  await notifyUsers({
    userIds: [opts.parentId],
    kind: "niyam_rejected",
    title_en: "Niyam submission rejected",
    title_hi: "नियम जमा अस्वीकृत",
    body_en: `${opts.studentName}'s submission for "${opts.niyamTitleEn}" was rejected: ${opts.reason}`,
    body_hi: `${opts.studentName} का "${opts.niyamTitleHi ?? opts.niyamTitleEn}" जमा अस्वीकृत: ${opts.reason}`,
    push: true,
    data: { kind: "niyam_rejected", submission_id: opts.submissionId },
  }).catch((err) => {
    logger.warn({ err, submissionId: opts.submissionId }, "notifyParentOfRejection failed");
  });
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
  /** Accepted for wire compatibility; server derives kind from upload_objects.content_type. */
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
  // Coarse per-account ceiling — an abuse guard, deliberately generous enough
  // that a large family never meets it. The meaningful budget is per-student,
  // applied after parse below.
  if (await rateLimit(`niyam:submit:hour:${uid}`, 120, 3600)) {
    fail(res, 429, "ERR_RATE_LIMITED", "Too many requests. Please try again later.");
    return;
  }

  let body: z.infer<typeof createSubmissionSchema>;
  try { body = createSubmissionSchema.parse(req.body); }
  catch (err) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid submission data.", zodDetails(err));
    return;
  }

  if (!(await ownedStudentId(req, body.student_id))) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found."); return;
  }

  // Per-student budget. Keying only on the parent meant a family of four shared
  // one child's allowance: logging Sunday's niyams for the second child already
  // hit the limit. Mirrors the (user, student) keying exams.ts already uses.
  if (await rateLimit(`niyam:submit:min:${uid}:${body.student_id}`, 5, 60)) {
    fail(res, 429, "ERR_RATE_LIMITED", "Too many submissions just now — wait a minute and try again.");
    return;
  }
  if (await rateLimit(`niyam:submit:hour:${uid}:${body.student_id}`, 20, 3600)) {
    fail(res, 429, "ERR_RATE_LIMITED", "Too many submissions for this student today. Try again later.");
    return;
  }

  // The whole submit sequence — ownership, audience, date window, media
  // resolution, advisory lock, award, gallery, streak, badges — lives in
  // services/niyam-submit.ts so POST /v1/sync/batch executes exactly the same
  // code (CLAUDE.md offline sync §4). Rate limiting stays above, on this route.
  let outcome: SubmitNiyamOutcome;
  try {
    outcome = await submitNiyam({
      actorUserId: uid,
      actorRole: req.authUser!.role as Role,
      actorIp: req.ip ?? null,
      impersonatorId: impersonatorIdFromReq(req),
      niyamId: body.niyam_id,
      studentId: body.student_id,
      submissionDate: body.submission_date,
      media: body.media,
      proofUrl: body.proof_url,
      notes: body.notes,
    });
  } catch (err) {
    if (err instanceof NiyamSubmitError) {
      fail(res, err.httpStatus, err.code, err.message);
      return;
    }
    throw err;
  }

  const { row, newBadges, media: mediaRows } = outcome;

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
  const limit = clampLimit(req.query.limit, 30, 300);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
  const cursor = decodeSubmissionCursor(req.query.cursor);

  const batchIdRaw = typeof req.query.batch_id === "string" ? req.query.batch_id.trim() : "";
  const niyamTypeRaw =
    typeof req.query.niyam_type === "string" ? req.query.niyam_type.trim() : "";

  let batchFilter: ReturnType<typeof eq> | undefined;
  if (batchIdRaw) {
    if (!UUID_RE.test(batchIdRaw)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "batch_id must be a UUID.");
      return;
    }
    const [batch] = await db
      .select({ id: batches.id, centre_id: batches.centre_id })
      .from(batches)
      .where(eq(batches.id, batchIdRaw))
      .limit(1);
    if (!batch || !inBatchWriteScope(scope, batch.id, batch.centre_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Batch not found in your scope.");
      return;
    }
    batchFilter = eq(students.batch_id, batch.id);
  }

  // Deep-linking from a student's dossier used to filter the loaded pages
  // client-side, so a submission beyond page 1 showed the empty state AND stalled
  // pagination (the list never rendered, so onEndReached never fired).
  const studentIdRaw = typeof req.query.student_id === "string" ? req.query.student_id.trim() : "";
  let studentFilter: ReturnType<typeof eq> | undefined;
  if (studentIdRaw) {
    if (!UUID_RE.test(studentIdRaw)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "student_id must be a UUID.");
      return;
    }
    // Centre scope (not batch): /pending is deliberately centre-wide so a
    // shikshak can see the whole backlog — only the decide writes are batch-bound.
    const [student] = await db
      .select({ id: students.id, centre_id: students.centre_id })
      .from(students)
      .where(eq(students.id, studentIdRaw))
      .limit(1);
    if (!student || !inScope(scope, student.centre_id)) {
      fail(res, 404, "ERR_NOT_FOUND", "Student not found in your scope.");
      return;
    }
    studentFilter = eq(students.id, student.id);
  }

  let typeFilter: ReturnType<typeof eq> | undefined;
  if (niyamTypeRaw) {
    if (!["daily", "weekly", "monthly"].includes(niyamTypeRaw)) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "niyam_type must be daily, weekly, or monthly.");
      return;
    }
    typeFilter = eq(niyams.niyam_type, niyamTypeRaw as "daily" | "weekly" | "monthly");
  }

  /**
   * H1 — this route hardcoded status='pending' while niyams.approval_mode
   * defaults to 'auto', so the queue Q12 makes the Sanchalak's safety net was
   * empty by construction on a default-configured platform: nothing ever
   * reaches 'pending'. Retroactive rejection is the PRIMARY admin workflow
   * (CLAUDE.md Q5), so the reviewer must be able to see auto-approved work.
   *
   * Repeatable `?status=` (…&status=pending&status=auto_approved), defaulting
   * to ['pending'] so existing callers are unaffected.
   */
  const statusRaw = req.query.status;
  const requestedStatuses = (
    Array.isArray(statusRaw) ? statusRaw : statusRaw === undefined ? [] : [statusRaw]
  ).map((s) => String(s).trim());
  for (const s of requestedStatuses) {
    if (!NIYAM_SUBMISSION_STATUSES.includes(s as (typeof NIYAM_SUBMISSION_STATUSES)[number])) {
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        `status must be one of: ${NIYAM_SUBMISSION_STATUSES.join(", ")}.`,
      );
      return;
    }
  }
  const statuses = requestedStatuses.length > 0 ? requestedStatuses : ["pending"];
  const statusFilter = inArray(
    niyam_submissions.status,
    statuses as (typeof NIYAM_SUBMISSION_STATUSES)[number][],
  );

  const rows = await db
    .select({
      id: niyam_submissions.id,
      student_id: niyam_submissions.student_id,
      student_name: students.full_name,
      student_code: students.student_code,
      centre_id: students.centre_id,
      batch_id: students.batch_id,
      batch_name: batches.name,
      niyam_id: niyam_submissions.niyam_id,
      niyam_title_en: niyams.title_en,
      niyam_title_hi: niyams.title_hi,
      niyam_type: niyams.niyam_type,
      proof_url: niyam_submissions.proof_url,
      notes: niyam_submissions.notes,
      submission_date: niyam_submissions.submission_date,
      period_key: niyam_submissions.period_key,
      status: niyam_submissions.status,
      // Needed now that the list can show approved / rejected tabs, not just
      // the (always-zero) pending rows.
      points_awarded: niyam_submissions.points_awarded,
      rejection_reason: niyam_submissions.rejection_reason,
      created_at: niyam_submissions.created_at,
    })
    .from(niyam_submissions)
    .innerJoin(students, eq(students.id, niyam_submissions.student_id))
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .leftJoin(batches, eq(batches.id, students.batch_id))
    .where(
      and(
        statusFilter,
        centreFilter,
        batchFilter,
        studentFilter,
        typeFilter,
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
    batch_id: r.batch_id,
    batch_name: r.batch_name,
    niyam_id: r.niyam_id,
    niyam_title_en: r.niyam_title_en,
    niyam_title_hi: r.niyam_title_hi,
    niyam_type: r.niyam_type,
    proof_url: signUploadUrl(r.proof_url),
    notes: r.notes,
    submission_date: r.submission_date,
    period_key: r.period_key,
    status: r.status,
    points_awarded: r.points_awarded,
    rejection_reason: r.rejection_reason,
    created_at: r.created_at.toISOString(),
    // Q12 — list stays centre-scoped; clients disable actions when false.
    can_decide: inBatchWriteScope(scope, r.batch_id, r.centre_id),
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
  // Shared with both review surfaces (@workspace/api-zod) so the client gate
  // and this one cannot drift. NOT the generic REJECT_REASON_MIN in contracts,
  // which is 10 and gates enrolment rejections.
  reason: z.string().trim().min(NIYAM_REJECT_REASON_MIN).max(NIYAM_REJECT_REASON_MAX),
});

const bulkApproveSchema = z.object({
  submission_ids: z.array(z.string().uuid()).min(1).max(50),
});

/* POST /v1/niyam-submissions/bulk-approve — before /:id/approve so "bulk-approve" is not an id */
router.post("/bulk-approve", requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof bulkApproveSchema>;
  try {
    body = bulkApproveSchema.parse(req.body);
  } catch (err) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid bulk approve payload.", zodDetails(err));
    return;
  }

  const scope = await resolveAdminScope(req.authUser!);
  const actor = req.authUser!;
  const results: Array<{
    id: string;
    status: "approved" | "skipped" | "failed";
    error?: { code: string; message: string };
  }> = [];
  const approvedIds: string[] = [];

  for (const id of body.submission_ids) {
    try {
      const outcome = await approveNiyamSubmission({
        submissionId: id,
        actor,
        scope,
        ip: req.ip ?? null,
      });
      if (outcome.status === "approved") {
        approvedIds.push(id);
        results.push({ id, status: "approved" });
        await notifyBadgesPush({
          parentUserId: outcome.parent_id,
          studentUserId: outcome.student_user_id,
          studentName: outcome.student_name,
          badges: outcome.newBadges,
        });
      } else if (outcome.status === "not_pending") {
        results.push({
          id,
          status: "skipped",
          error: { code: "ERR_INVALID_STATE", message: "Submission is not pending." },
        });
      } else {
        results.push({
          id,
          status: "failed",
          error: { code: "ERR_NOT_FOUND", message: "Submission not found." },
        });
      }
    } catch (err) {
      logger.warn({ err, submissionId: id }, "bulk niyam approve item failed");
      results.push({
        id,
        status: "failed",
        error: {
          code: "ERR_INTERNAL",
          message: err instanceof Error ? err.message : "Approve failed.",
        },
      });
    }
  }

  await writeAudit({
    actorId: actor.id,
    actorRole: actor.role as Role,
    action: "approve",
    entityKind: "niyam_submission_bulk",
    entityId: null,
    summary: `Bulk approved ${approvedIds.length} of ${body.submission_ids.length} niyam submission(s).`,
    metadata: {
      approved_count: approvedIds.length,
      approved_ids: approvedIds,
      requested_ids: body.submission_ids,
    },
    ip: req.ip ?? null,
  });

  ok(res, { results });
});

/* POST /v1/niyam-submissions/:id/approve */
router.post("/:id/approve", requireAdminPanel, async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const outcome = await approveNiyamSubmission({
    submissionId: String(req.params.id),
    actor: req.authUser!,
    scope,
    ip: req.ip ?? null,
  });

  if (outcome.status === "not_found") {
    fail(res, 404, "ERR_NOT_FOUND", "Submission not found.");
    return;
  }
  if (outcome.status === "not_pending") {
    fail(res, 409, "ERR_INVALID_STATE", "Submission is not pending.");
    return;
  }

  await notifyBadgesPush({
    parentUserId: outcome.parent_id,
    studentUserId: outcome.student_user_id,
    studentName: outcome.student_name,
    badges: outcome.newBadges,
  });

  ok(res, {
    id: outcome.submissionId,
    status: "approved",
    total_points: outcome.total_points,
    tier: outcome.tier,
    new_badges: outcome.newBadges,
    ...rejectionWindowFields("approved", outcome.created_at),
  });
});

/* POST /v1/niyam-submissions/:id/reject — pending | auto_approved | approved */
router.post("/:id/reject", requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof rejectSchema>;
  try { body = rejectSchema.parse(req.body); }
  catch (err) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid reject payload.", zodDetails(err));
    return;
  }

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
      batch_id: students.batch_id,
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
  // Q12 — same batch write gate as approve (no sanchalak special-case).
  if (!sub || !inBatchWriteScope(scope, sub.batch_id, sub.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Submission not found."); return;
  }

  const rejectable = ["pending", "auto_approved", "approved"] as const;
  if (!rejectable.includes(sub.status as (typeof rejectable)[number])) {
    fail(res, 409, "ERR_INVALID_STATE", "Submission cannot be rejected."); return;
  }

  const outcome = await db.transaction(async (tx) => {
    // Re-read status / created_at / points_awarded inside the transaction so the
    // Q5 window and reversal amount cannot race a concurrent approve/reject or a
    // day-boundary clock tick between the outer SELECT and this UPDATE.
    const [fresh] = await tx
      .select({
        status: niyam_submissions.status,
        created_at: niyam_submissions.created_at,
        points_awarded: niyam_submissions.points_awarded,
        punya_transaction_id: niyam_submissions.punya_transaction_id,
      })
      .from(niyam_submissions)
      .where(eq(niyam_submissions.id, sub.id))
      .limit(1);
    if (!fresh || !rejectable.includes(fresh.status as (typeof rejectable)[number])) {
      return { ok: false as const };
    }

    if (
      (fresh.status === "auto_approved" || fresh.status === "approved") &&
      !canRejectSubmission(fresh.status, fresh.created_at)
    ) {
      return { ok: false as const, windowExpired: true as const };
    }

    const pointsToReverse = fresh.points_awarded;
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
    if (pointsToReverse > 0) {
      reverseResult = await reversePunya(
        {
          studentId: sub.student_id,
          featureKey: "niyam_submission",
          points: pointsToReverse,
          note: body.reason,
          awardedBy: req.authUser!.id,
          idempotencyKey: `submission:${sub.id}:reversal`,
        },
        tx,
      );

      let awardTxnId = fresh.punya_transaction_id;
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
      .set({
        is_public: false,
        featured_gallery: false,
        featured_home: false,
        featured_at: null,
        featured_by: null,
        deleted_at: new Date(),
      })
      .where(eq(gallery_items.submission_id, sub.id));

    return { ok: true as const, reverseResult };
  });

  if ("windowExpired" in outcome && outcome.windowExpired) {
    fail(
      res,
      409,
      "ERR_NIYAM_REVERSAL_WINDOW_EXPIRED",
      "The 30-day rejection window for this submission has closed.",
    );
    return;
  }

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
