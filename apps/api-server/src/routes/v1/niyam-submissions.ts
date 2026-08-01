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
  gallery_items,
  notifications,
  device_push_tokens,
  punya_transactions,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { httpUrl } from "../../lib/validation";
import { signUploadUrl, uploadKeyFromUrl } from "../../lib/file-tokens";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope } from "../../lib/scope";
import { awardPunya, reversePunya } from "../../lib/punya";
import { auditFromReq } from "../../lib/audit";
import { clampLimit, inScope, scopedCentreFilter } from "../../lib/route-helpers";
import { rejectionWindowFields, canRejectSubmission } from "../../lib/niyam-constants";
import { sendPush } from "../../lib/push";
import {
  allowedMediaKinds,
  periodKey,
  previousPeriodKey,
  type NiyamPeriodType,
} from "../../lib/niyam-period";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const router: IRouter = Router();
router.use(requireAuth);

async function ownedStudentId(req: Request, id: string): Promise<string | null> {
  const uid = req.authUser!.id;
  const [row] = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, id), or(eq(students.parent_id, uid), eq(students.user_id, uid))))
    .limit(1);
  return row?.id ?? null;
}

function todayIstDate(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function previousDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function isNiyamProofUrl(url: string): boolean {
  const key = uploadKeyFromUrl(url);
  if (key) return key.startsWith("niyam-proof/");
  // Allow unsigned local paths that still point at the folder.
  try {
    const u = new URL(url);
    return u.pathname.includes("/uploads/niyam-proof/");
  } catch {
    return url.includes("/uploads/niyam-proof/");
  }
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

async function bumpStreak(
  studentId: string,
  niyamId: string,
  niyamType: NiyamPeriodType,
  submissionDate: string,
  pKey: string,
  exec: Tx | typeof db = db,
): Promise<void> {
  const [row] = await exec
    .select({
      id: niyam_streaks.id,
      current_streak: niyam_streaks.current_streak,
      longest_streak: niyam_streaks.longest_streak,
      last_period_key: niyam_streaks.last_period_key,
    })
    .from(niyam_streaks)
    .where(and(eq(niyam_streaks.student_id, studentId), eq(niyam_streaks.niyam_id, niyamId)))
    .limit(1);

  if (!row) {
    await exec.insert(niyam_streaks).values({
      student_id: studentId,
      niyam_id: niyamId,
      current_streak: 1,
      longest_streak: 1,
      last_submission_date: submissionDate,
      last_period_key: pKey,
    });
    return;
  }

  const prev = previousPeriodKey(niyamType, pKey);
  const continued = row.last_period_key === prev;
  const samePeriod = row.last_period_key === pKey;
  const current = samePeriod ? row.current_streak : continued ? row.current_streak + 1 : 1;
  const longest = Math.max(row.longest_streak, current);
  await exec
    .update(niyam_streaks)
    .set({
      current_streak: current,
      longest_streak: longest,
      last_submission_date: submissionDate,
      last_period_key: pKey,
    })
    .where(eq(niyam_streaks.id, row.id));
}

/** Rebuild streak from remaining non-rejected submissions after a reject. */
async function recomputeStreak(
  studentId: string,
  niyamId: string,
  niyamType: NiyamPeriodType,
  exec: Tx | typeof db = db,
): Promise<void> {
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
      ),
    )
    .orderBy(asc(niyam_submissions.submission_date));

  const [existing] = await exec
    .select({ id: niyam_streaks.id })
    .from(niyam_streaks)
    .where(and(eq(niyam_streaks.student_id, studentId), eq(niyam_streaks.niyam_id, niyamId)))
    .limit(1);

  if (rows.length === 0) {
    if (existing) {
      await exec
        .update(niyam_streaks)
        .set({
          current_streak: 0,
          last_submission_date: null,
          last_period_key: null,
        })
        .where(eq(niyam_streaks.id, existing.id));
    }
    return;
  }

  // Unique period keys in chronological order
  const seen = new Set<string>();
  const ordered: { period_key: string; submission_date: string }[] = [];
  for (const r of rows) {
    if (!r.period_key || seen.has(r.period_key)) continue;
    seen.add(r.period_key);
    ordered.push({ period_key: r.period_key, submission_date: r.submission_date });
  }

  let current = 0;
  let longest = 0;
  let prevKey: string | null = null;
  for (const r of ordered) {
    if (prevKey && previousPeriodKey(niyamType, r.period_key) === prevKey) {
      current += 1;
    } else {
      current = 1;
    }
    longest = Math.max(longest, current);
    prevKey = r.period_key;
  }
  const last = ordered[ordered.length - 1]!;

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
  let body: z.infer<typeof createSubmissionSchema>;
  try { body = createSubmissionSchema.parse(req.body); }
  catch { fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid submission data."); return; }

  if (!(await ownedStudentId(req, body.student_id))) {
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
    })
    .from(niyams)
    .where(and(eq(niyams.id, body.niyam_id), eq(niyams.is_active, true)))
    .limit(1);
  if (!niyam) {
    fail(res, 404, "ERR_NOT_FOUND", "Niyam not found."); return;
  }

  const today = todayIstDate();
  const submissionDate = body.submission_date ?? today;
  if (submissionDate > today) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "submission_date cannot be in the future."); return;
  }
  if (submissionDate < previousDate(today)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "submission_date too old."); return;
  }

  let media = body.media ?? [];
  if (media.length === 0 && body.proof_url) {
    const kind =
      niyam.proof_type === "video" ? "video" :
      niyam.proof_type === "audio" ? "audio" : "photo";
    media = [{ url: body.proof_url, kind }];
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
  }

  const pKey = periodKey(niyam.niyam_type as NiyamPeriodType, submissionDate);
  const autoApprove = niyam.approval_mode === "auto";
  const status = autoApprove ? "auto_approved" : "pending";
  const pointsAwarded = autoApprove ? niyam.points : 0;
  const firstUrl = media[0]?.url ?? null;

  const lockKey = `niyam:${niyam.id}:${body.student_id}:${pKey}`;
  const row = await db.transaction(async (tx) => {
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
        submitted_by: req.authUser!.id,
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

    if (autoApprove) {
      const award = await awardPunya(
        {
          studentId: body.student_id,
          featureKey: "niyam_submission",
          points: niyam.points,
          note: body.notes ?? null,
          awardedBy: req.authUser!.id,
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
      await bumpStreak(
        body.student_id,
        niyam.id,
        niyam.niyam_type as NiyamPeriodType,
        submissionDate,
        pKey,
        tx,
      );
      await maybeInsertGalleryFromSubmission(tx, {
        submissionId: created.id,
        studentId: body.student_id,
        niyamId: niyam.id,
        media,
      });
      return updated ?? created;
    }

    return created;
  });
  if (!row) {
    fail(res, 409, "ERR_NIYAM_PERIOD_DUPLICATE", `Already submitted for this ${niyam.niyam_type} period (${pKey}).`);
    return;
  }

  if (autoApprove) {
    await auditFromReq(req, {
      action: "award",
      entityKind: "niyam_submission",
      entityId: row.id,
      summary: `Auto-approved niyam submission (+${niyam.points}).`,
      metadata: {
        niyam_id: niyam.id,
        student_id: body.student_id,
        points: niyam.points,
        submission_date: submissionDate,
        period_key: pKey,
      },
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
    ...rejectionWindowFields(row.status, row.created_at),
  });
});

/* GET /v1/niyam-submissions/pending */
router.get("/pending", requireAdminPanel, async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 100, 300);
  const centreFilter = scopedCentreFilter(scope, students.centre_id);
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
    .where(and(eq(niyam_submissions.status, "pending"), centreFilter))
    .orderBy(desc(niyam_submissions.submission_date))
    .limit(limit);

  const ids = rows.map((r) => r.id);
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

  const items = rows.map((r) => ({
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
  ok(res, { items }, { count: items.length });
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
      points: niyams.points,
      niyam_type: niyams.niyam_type,
    })
    .from(niyam_submissions)
    .innerJoin(students, eq(students.id, niyam_submissions.student_id))
    .innerJoin(niyams, eq(niyams.id, niyam_submissions.niyam_id))
    .where(eq(niyam_submissions.id, String(req.params.id)))
    .limit(1);
  if (!sub || !inScope(scope, sub.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Submission not found."); return;
  }

  const award = await db.transaction(async (tx) => {
    const now = new Date();
    const updated = await tx
      .update(niyam_submissions)
      .set({
        status: "approved",
        points_awarded: sub.points,
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
        points: sub.points,
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

    await bumpStreak(
      sub.student_id,
      sub.niyam_id,
      sub.niyam_type as NiyamPeriodType,
      sub.submission_date,
      sub.period_key ?? periodKey(sub.niyam_type as NiyamPeriodType, sub.submission_date),
      tx,
    );

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

    return result;
  });

  if (!award) {
    fail(res, 409, "ERR_INVALID_STATE", "Submission is not pending."); return;
  }

  await auditFromReq(req, {
    action: "approve",
    entityKind: "niyam_submission",
    entityId: sub.id,
    summary: `Approved niyam submission (+${sub.points}).`,
    metadata: {
      niyam_id: sub.niyam_id,
      student_id: sub.student_id,
      points: sub.points,
      submission_date: sub.submission_date,
    },
  });

  ok(res, {
    id: sub.id,
    status: "approved",
    total_points: award.total_points,
    tier: award.tier,
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

  // Q5: awarded submissions older than 30 days cannot reverse punya.
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
