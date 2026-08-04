/**
 * /v1/homework — homework assignments + submissions.
 *
 * Admin/shikshak (requireAdminPanel): create assignments for a batch (fanning
 * out one pending submission per target student), list assignments with
 * submission counts, view per-assignment submissions, and grade submissions
 * (approve/star -> punya award).
 *
 * Student/parent (requireAuth): list a student's homework, and submit a
 * submission_url (auto-marked late if past the due date). Ownership of the
 * student is verified on every persona action.
 *
 * Scope: every admin read/mutation is constrained by the caller's batch/centre
 * write scope (via the assignment's batch -> centre). Out-of-scope on a
 * detail/action is a 404; an out-of-scope batch on create is a 403.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, homework_assignments, homework_submissions, batches, centres, students, punya_balances } from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { httpUrl } from "../../lib/validation";
import { signUploadUrl } from "../../lib/file-tokens";
import { requireAuth, requireAdminPanel } from "../../middlewares/auth";
import { resolveAdminScope, inBatchWriteScope } from "../../lib/scope";
import { awardPunya, reversePunya } from "../../lib/punya";
import { resolveHomeworkAwardPoints } from "../../lib/homework-points";
import {
  notifyParentsHomeworkAssigned,
  notifyParentHomeworkGraded,
} from "../../lib/homework-notify";
import { auditFromReq } from "../../lib/audit";

import { clampLimit, ownedStudentId, scopedCentreFilter } from "../../lib/route-helpers";
import { kolkataDateString } from "../../services/attendance-mark";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isPastDueDate(dueDate: string): boolean {
  return dueDate < kolkataDateString(new Date());
}

/** Keyset cursor: `value|uuid` base64url — matches admin niyam-submissions. */
function encodeKeysetCursor(value: string, id: string): string {
  return Buffer.from(`${value}|${id}`, "utf8").toString("base64url");
}

function decodeKeysetCursor(
  raw: unknown,
  valueRe: RegExp,
): { value: string; id: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const i = decoded.indexOf("|");
    if (i < 0) return null;
    const value = decoded.slice(0, i);
    const id = decoded.slice(i + 1);
    if (!valueRe.test(value) || !UUID_RE.test(id)) return null;
    return { value, id };
  } catch {
    return null;
  }
}

const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function homeworkAwardKey(submissionId: string, revision: number): string {
  return `homework-grade:${submissionId}:${revision}`;
}

function homeworkReversalKey(awardKey: string): string {
  return awardKey.endsWith(":reversal") ? awardKey : `${awardKey}:reversal`;
}

/** Most recent UNREVERSED homework award for a submission (AT18). */
async function findLatestUnreversedHomeworkAward(
  tx: Tx,
  submissionId: string,
  studentId: string,
): Promise<{ id: string; points: number; idempotency_key: string } | null> {
  const legacy = `homework-grade:${submissionId}`;
  const prefix = `homework-grade:${submissionId}:`;
  const result = await tx.execute(sql`
    select t.id, t.points, t.idempotency_key
    from punya_transactions t
    where t.student_id = ${studentId}
      and t.points > 0
      and (
        t.idempotency_key = ${legacy}
        or (
          t.idempotency_key like ${prefix + "%"}
          and t.idempotency_key not like ${"%:reversal"}
        )
      )
      and not exists (
        select 1 from punya_transactions r where r.reversal_of = t.id
      )
    order by t.created_at desc, t.id desc
    limit 1
  `);
  const rows =
    (result as unknown as {
      rows?: Array<{ id: string; points: number; idempotency_key: string }>;
    }).rows ?? [];
  return rows[0] ?? null;
}

/* ═══════════════════════════ Admin / shikshak ═══════════════════════════ */

const createAssignmentSchema = z.object({
  batch_id: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  due_date: z.string().regex(DUE_DATE_RE),
  attachment_url: httpUrl(1000).optional(),
  is_msv: z.boolean().optional(),
  // Create-time subset only — not persisted (FIX #14 dropped the column).
  target_student_ids: z.array(z.string().uuid()).max(500).optional(),
});

/* POST /v1/homework/assignments — create an assignment + fan out submissions */
router.post("/assignments", requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof createAssignmentSchema>;
  try {
    body = createAssignmentSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid assignment data.");
    return;
  }

  const scope = await resolveAdminScope(req.authUser!);
  const [batch] = await db
    .select({ id: batches.id, centre_id: batches.centre_id })
    .from(batches)
    .where(eq(batches.id, body.batch_id))
    .limit(1);
  if (!batch) {
    fail(res, 404, "ERR_NOT_FOUND", "Batch not found.");
    return;
  }
  if (!inBatchWriteScope(scope, batch.id, batch.centre_id)) {
    fail(res, 403, "ERR_FORBIDDEN", "Batch not in your scope.");
    return;
  }
  if (isPastDueDate(body.due_date)) {
    fail(
      res,
      422,
      "ERR_VALIDATION_FAILED",
      "That due date has already passed — pick today or a later date.",
    );
    return;
  }

  let assignmentId = "";
  let submissionsCreated = 0;
  let titleForAudit = body.title;

  try {
    const outcome = await db.transaction(async (tx) => {
      // Target resolution inside the tx so a concurrent deactivate cannot slip
      // a student into the fan-out after we decided the roster.
      const isMsv = body.is_msv === true;
      const rosterFilters = [
        eq(students.batch_id, batch.id),
        eq(students.status, "active"),
        isNull(students.deleted_at),
        ...(isMsv ? [eq(students.msv_status, "approved")] : []),
      ];

      let targetIds: string[];
      if (body.target_student_ids && body.target_student_ids.length > 0) {
        const requested = Array.from(new Set(body.target_student_ids));
        const valid = await tx
          .select({ id: students.id })
          .from(students)
          .where(and(inArray(students.id, requested), ...rosterFilters));
        if (valid.length !== requested.length) {
          throw Object.assign(new Error("invalid targets"), { code: "ERR_VALIDATION_FAILED" as const });
        }
        targetIds = valid.map((r) => r.id);
      } else {
        const all = await tx
          .select({ id: students.id })
          .from(students)
          .where(and(...rosterFilters));
        targetIds = all.map((r) => r.id);
      }

      const [row] = await tx
        .insert(homework_assignments)
        .values({
          batch_id: batch.id,
          title: body.title,
          description: body.description ?? null,
          due_date: body.due_date,
          attachment_url: body.attachment_url ?? null,
          is_msv: body.is_msv ?? false,
          created_by: req.authUser!.id,
        })
        .returning({ id: homework_assignments.id });

      // values([]) throws — empty batches still get an assignment row, no fan-out.
      if (targetIds.length > 0) {
        await tx.insert(homework_submissions).values(
          targetIds.map((sid) => ({
            assignment_id: row.id,
            student_id: sid,
            status: "pending" as const,
          })),
        );
      }

      return { id: row.id, submissions_created: targetIds.length, targetIds };
    });
    assignmentId = outcome.id;
    submissionsCreated = outcome.submissions_created;

    // Best-effort: one notification per parent (not per child) for this assignment.
    await notifyParentsHomeworkAssigned({
      studentIds: outcome.targetIds,
      assignmentTitle: titleForAudit,
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ERR_VALIDATION_FAILED") {
      fail(res, 422, "ERR_VALIDATION_FAILED", "One or more target students are not active in this batch.");
      return;
    }
    throw err;
  }

  await auditFromReq(req, {
    action: "create",
    entityKind: "homework_assignment",
    entityId: assignmentId,
    summary: `Created homework "${titleForAudit}" for ${submissionsCreated} student(s).`,
    metadata: { batch_id: batch.id, submissions_created: submissionsCreated },
  });

  ok(res, { id: assignmentId, submissions_created: submissionsCreated });
});

const patchAssignmentSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(5000).nullable().optional(),
    due_date: z.string().regex(DUE_DATE_RE).optional(),
    attachment_url: httpUrl(1000).nullable().optional(),
    is_msv: z.boolean().optional(),
    /** Required when PATCH sets due_date to a past Kolkata calendar day. */
    allow_past_due_date: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).filter((k) => k !== "allow_past_due_date").length > 0, {
    message: "empty patch",
  });

/* PATCH /v1/homework/assignments/:id — partial update; out-of-scope → 404 */
router.patch("/assignments/:id", requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof patchAssignmentSchema>;
  try {
    body = patchAssignmentSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid assignment update.");
    return;
  }

  const id = String(req.params.id);
  const scope = await resolveAdminScope(req.authUser!);
  const [assignment] = await db
    .select({
      id: homework_assignments.id,
      batch_id: homework_assignments.batch_id,
      centre_id: batches.centre_id,
      title: homework_assignments.title,
      description: homework_assignments.description,
      due_date: homework_assignments.due_date,
      attachment_url: homework_assignments.attachment_url,
      is_msv: homework_assignments.is_msv,
    })
    .from(homework_assignments)
    .innerJoin(batches, eq(batches.id, homework_assignments.batch_id))
    .where(and(eq(homework_assignments.id, id), isNull(homework_assignments.deleted_at)))
    .limit(1);
  if (!assignment || !inBatchWriteScope(scope, assignment.batch_id, assignment.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Assignment not found.");
    return;
  }

  // Partial update: only keys present in the body. Do not coalesce absent keys
  // to null — that is the wipe bug FIX #13 addresses on feedback.
  // Changing due_date must NOT retroactively re-evaluate `late` on rows already
  // submitted; lateness is a point-in-time fact captured at submit (AT26).
  const patch: {
    title?: string;
    description?: string | null;
    due_date?: string;
    attachment_url?: string | null;
    is_msv?: boolean;
  } = {};
  if (Object.prototype.hasOwnProperty.call(body, "title") && body.title !== undefined) {
    patch.title = body.title;
  }
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    patch.description = body.description ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "due_date") && body.due_date !== undefined) {
    if (isPastDueDate(body.due_date) && body.allow_past_due_date !== true) {
      fail(
        res,
        422,
        "ERR_VALIDATION_FAILED",
        "That due date has already passed — pick today or a later date, or pass allow_past_due_date to correct backwards.",
      );
      return;
    }
    patch.due_date = body.due_date;
  }
  if (Object.prototype.hasOwnProperty.call(body, "attachment_url")) {
    patch.attachment_url = body.attachment_url ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "is_msv") && body.is_msv !== undefined) {
    patch.is_msv = body.is_msv;
  }

  const [updated] = await db
    .update(homework_assignments)
    .set(patch)
    .where(eq(homework_assignments.id, assignment.id))
    .returning({
      id: homework_assignments.id,
      title: homework_assignments.title,
      description: homework_assignments.description,
      due_date: homework_assignments.due_date,
      attachment_url: homework_assignments.attachment_url,
      is_msv: homework_assignments.is_msv,
      batch_id: homework_assignments.batch_id,
    });

  await auditFromReq(req, {
    action: "update",
    entityKind: "homework_assignment",
    entityId: assignment.id,
    summary: `Updated homework "${updated.title}".`,
    metadata: { fields: Object.keys(patch) },
  });

  ok(res, updated);
});

const deleteAssignmentSchema = z.object({
  force_delete: z.boolean().optional(),
});

/**
 * DELETE /v1/homework/assignments/:id — soft-delete only.
 * Graded submissions imply awarded Punya: require force_delete (AT25 shape) and
 * reverse each award (revision-scoped keys, AT18) before hiding the assignment.
 */
router.delete("/assignments/:id", requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof deleteAssignmentSchema> = {};
  try {
    if (req.body && typeof req.body === "object" && Object.keys(req.body as object).length > 0) {
      body = deleteAssignmentSchema.parse(req.body);
    }
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid delete request.");
    return;
  }

  const id = String(req.params.id);
  const scope = await resolveAdminScope(req.authUser!);
  const [assignment] = await db
    .select({
      id: homework_assignments.id,
      title: homework_assignments.title,
      batch_id: homework_assignments.batch_id,
      centre_id: batches.centre_id,
    })
    .from(homework_assignments)
    .innerJoin(batches, eq(batches.id, homework_assignments.batch_id))
    .where(and(eq(homework_assignments.id, id), isNull(homework_assignments.deleted_at)))
    .limit(1);
  if (!assignment || !inBatchWriteScope(scope, assignment.batch_id, assignment.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Assignment not found.");
    return;
  }

  const graded = await db
    .select({
      id: homework_submissions.id,
      student_id: homework_submissions.student_id,
      status: homework_submissions.status,
    })
    .from(homework_submissions)
    .where(
      and(
        eq(homework_submissions.assignment_id, assignment.id),
        inArray(homework_submissions.status, ["approved", "starred"]),
      ),
    );

  if (graded.length > 0 && body.force_delete !== true) {
    fail(
      res,
      409,
      "ERR_CONFLICT",
      `This assignment has ${graded.length} graded submission(s). Pass force_delete=true to reverse their Punya and remove it.`,
    );
    return;
  }

  await db.transaction(async (tx) => {
    for (const sub of graded) {
      const prior = await findLatestUnreversedHomeworkAward(tx, sub.id, sub.student_id);
      if (prior && prior.points > 0) {
        await reversePunya(
          {
            studentId: sub.student_id,
            featureKey: "homework",
            points: prior.points,
            note: "Homework assignment deleted",
            awardedBy: req.authUser!.id,
            idempotencyKey: homeworkReversalKey(prior.idempotency_key),
          },
          tx,
        );
      }
    }

    await tx
      .update(homework_assignments)
      .set({ deleted_at: new Date() })
      .where(eq(homework_assignments.id, assignment.id));
  });

  await auditFromReq(req, {
    action: "delete",
    entityKind: "homework_assignment",
    entityId: assignment.id,
    summary: `Soft-deleted homework "${assignment.title}"${graded.length > 0 ? ` (force; ${graded.length} Punya reversal(s))` : ""}.`,
    metadata: {
      force_delete: body.force_delete === true,
      graded_reversed: graded.length,
    },
  });

  ok(res, { id: assignment.id, deleted: true, graded_reversed: graded.length });
});

/* GET /v1/homework/assignments?batch_id=&limit=&cursor= — scoped list + counts */
router.get("/assignments", requireAdminPanel, async (req: Request, res: Response) => {
  const scope = await resolveAdminScope(req.authUser!);
  const limit = clampLimit(req.query.limit, 50, 200);
  const centreFilter = scopedCentreFilter(scope, batches.centre_id);
  const cursor = decodeKeysetCursor(req.query.cursor, ISO_TS_RE);

  const filters = [isNull(homework_assignments.deleted_at), centreFilter];
  // Shikshak scope is batch-level: centre membership alone would leak every
  // assignment at their centre (including batches they do not teach).
  if (scope.batchIds !== null) {
    filters.push(
      scope.batchIds.length === 0
        ? sql`false`
        : inArray(homework_assignments.batch_id, scope.batchIds),
    );
  }
  const batchId = req.query.batch_id;
  if (typeof batchId === "string" && UUID_RE.test(batchId)) {
    filters.push(eq(homework_assignments.batch_id, batchId));
  }
  if (cursor) {
    const cursorAt = new Date(cursor.value);
    filters.push(
      or(
        lt(homework_assignments.created_at, cursorAt),
        and(eq(homework_assignments.created_at, cursorAt), lt(homework_assignments.id, cursor.id)),
      )!,
    );
  }

  const pageRows = await db
    .select({
      id: homework_assignments.id,
      title: homework_assignments.title,
      description: homework_assignments.description,
      due_date: homework_assignments.due_date,
      attachment_url: homework_assignments.attachment_url,
      is_msv: homework_assignments.is_msv,
      batch_id: homework_assignments.batch_id,
      batch_name: batches.name,
      centre_name: centres.name,
      created_at: homework_assignments.created_at,
    })
    .from(homework_assignments)
    .innerJoin(batches, eq(batches.id, homework_assignments.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .where(and(...filters))
    .orderBy(desc(homework_assignments.created_at), desc(homework_assignments.id))
    .limit(limit + 1);

  const hasMore = pageRows.length > limit;
  const page = hasMore ? pageRows.slice(0, limit) : pageRows;

  // Counts only for the limited page (LATERAL), not a national GROUP BY then LIMIT.
  const countById = new Map<string, { total: number; submitted: number; graded: number }>();
  if (page.length > 0) {
    const idArray = sql`array[${sql.join(
      page.map((r) => sql`${r.id}::uuid`),
      sql`, `,
    )}]::uuid[]`;
    const countResult = await db.execute(sql`
      select
        ha.id,
        coalesce(cnt.total, 0)::int as total,
        coalesce(cnt.submitted, 0)::int as submitted,
        coalesce(cnt.graded, 0)::int as graded
      from unnest(${idArray}) as ha(id)
      left join lateral (
        select
          count(*)::int as total,
          count(*) filter (
            where hs.status in ('submitted', 'approved', 'starred', 'late')
          )::int as submitted,
          count(*) filter (
            where hs.status in ('approved', 'starred')
          )::int as graded
        from homework_submissions hs
        where hs.assignment_id = ha.id
      ) cnt on true
    `);
    const countRows =
      (countResult as unknown as {
        rows?: Array<{ id: string; total: number; submitted: number; graded: number }>;
      }).rows ??
      (countResult as unknown as Array<{ id: string; total: number; submitted: number; graded: number }>);
    for (const r of countRows) {
      countById.set(r.id, {
        total: Number(r.total),
        submitted: Number(r.submitted),
        graded: Number(r.graded),
      });
    }
  }

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeKeysetCursor(last.created_at.toISOString(), last.id) : null;

  const items = page.map((r) => {
    const counts = countById.get(r.id) ?? { total: 0, submitted: 0, graded: 0 };
    return {
      ...r,
      ...counts,
      created_at: r.created_at.toISOString(),
    };
  });
  ok(res, { items }, { count: items.length, has_more: hasMore, next_cursor: nextCursor });
});

/* GET /v1/homework/assignments/:id/submissions — scoped submission list */
router.get("/assignments/:id/submissions", requireAdminPanel, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const scope = await resolveAdminScope(req.authUser!);
  const [assignment] = await db
    .select({
      id: homework_assignments.id,
      batch_id: homework_assignments.batch_id,
      centre_id: batches.centre_id,
    })
    .from(homework_assignments)
    .innerJoin(batches, eq(batches.id, homework_assignments.batch_id))
    .where(and(eq(homework_assignments.id, id), isNull(homework_assignments.deleted_at)))
    .limit(1);
  if (!assignment || !inBatchWriteScope(scope, assignment.batch_id, assignment.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Assignment not found.");
    return;
  }

  const rows = await db
    .select({
      id: homework_submissions.id,
      student_id: homework_submissions.student_id,
      student_name: students.full_name,
      student_code: students.student_code,
      status: homework_submissions.status,
      submission_url: homework_submissions.submission_url,
      feedback_note: homework_submissions.feedback_note,
      late: homework_submissions.late,
      marked_at: homework_submissions.marked_at,
    })
    .from(homework_submissions)
    .innerJoin(students, eq(students.id, homework_submissions.student_id))
    .where(eq(homework_submissions.assignment_id, assignment.id))
    .orderBy(asc(students.full_name));

  const items = rows.map((r) => ({ ...r, submission_url: signUploadUrl(r.submission_url), marked_at: r.marked_at ? r.marked_at.toISOString() : null }));
  ok(res, { items }, { count: items.length });
});

const gradeSchema = z.object({
  status: z.enum(["approved", "starred"]),
  // .nullable() allows explicit clear; absence is detected on req.body (not via ??).
  feedback_note: z.string().max(2000).nullable().optional(),
});

/* POST /v1/homework/submissions/:id/grade — grade + award punya (AT18 / AT20) */
router.post("/submissions/:id/grade", requireAdminPanel, async (req: Request, res: Response) => {
  let body: z.infer<typeof gradeSchema>;
  try {
    body = gradeSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid grade data.");
    return;
  }

  // Partial update: only write feedback_note when the key is present on the wire.
  const feedbackPresent = Object.prototype.hasOwnProperty.call(req.body ?? {}, "feedback_note");
  const feedbackPatch = feedbackPresent
    ? { feedback_note: body.feedback_note ?? null }
    : ({} as { feedback_note?: string | null });

  const id = String(req.params.id);
  const scope = await resolveAdminScope(req.authUser!);
  const [sub] = await db
    .select({
      id: homework_submissions.id,
      student_id: homework_submissions.student_id,
      status: homework_submissions.status,
      late: homework_submissions.late,
      revision: homework_submissions.revision,
      assignment_id: homework_submissions.assignment_id,
      batch_id: homework_assignments.batch_id,
      centre_id: batches.centre_id,
    })
    .from(homework_submissions)
    .innerJoin(homework_assignments, eq(homework_assignments.id, homework_submissions.assignment_id))
    .innerJoin(batches, eq(batches.id, homework_assignments.batch_id))
    .where(and(eq(homework_submissions.id, id), isNull(homework_assignments.deleted_at)))
    .limit(1);
  if (!sub || !inBatchWriteScope(scope, sub.batch_id, sub.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Submission not found.");
    return;
  }

  // Pending has no work uploaded — refuse before the claim so the client gets a
  // clear fix. Already-graded rows still enter the tx for AT18 re-grades.
  if (sub.status === "pending") {
    fail(
      res,
      409,
      "ERR_CONFLICT",
      "Nothing has been submitted yet — ask the student to upload their work first.",
    );
    return;
  }

  const points = await resolveHomeworkAwardPoints(body.status, sub.centre_id);

  // Claim + grade + award run in ONE transaction (AT20). First grade claims a
  // submitted/late row; re-grades of already-graded rows follow AT18:
  // reverse-then-award when the point value changes, otherwise metadata only
  // with no revision bump.
  const result = await db.transaction(async (tx) => {
    const claimedRows = await tx
      .update(homework_submissions)
      .set({
        status: body.status,
        ...feedbackPatch,
        marked_by: req.authUser!.id,
        marked_at: new Date(),
        revision: sql`${homework_submissions.revision} + 1`,
      })
      .where(
        and(
          eq(homework_submissions.id, sub.id),
          sql`${homework_submissions.status} in ('submitted', 'late')`,
        ),
      )
      .returning({
        id: homework_submissions.id,
        revision: homework_submissions.revision,
      });
    const claimed = claimedRows.length > 0;

    if (claimed) {
      // Award keyed to the revision AFTER the bump (matches attendance AT17).
      const awardRevision = claimedRows[0]!.revision;
      const award = await awardPunya(
        {
          studentId: sub.student_id,
          featureKey: "homework",
          points,
          note: body.status === "starred" ? "Homework starred" : "Homework approved",
          awardedBy: req.authUser!.id,
          idempotencyKey: homeworkAwardKey(sub.id, awardRevision),
          sourceEntityKind: "homework",
          sourceEntityId: sub.id,
          sourceRevision: awardRevision,
        },
        tx,
      );
      return {
        kind: "first_grade" as const,
        total_points: award.total_points,
        points,
      };
    }

    // Already graded — lock current row for AT18 comparison.
    const [fresh] = await tx
      .select({
        status: homework_submissions.status,
        revision: homework_submissions.revision,
      })
      .from(homework_submissions)
      .where(eq(homework_submissions.id, sub.id))
      .limit(1);
    if (!fresh || (fresh.status !== "approved" && fresh.status !== "starred")) {
      const [bal] = await tx
        .select({ total_points: punya_balances.total_points })
        .from(punya_balances)
        .where(eq(punya_balances.student_id, sub.student_id))
        .limit(1);
      return { kind: "noop" as const, total_points: bal?.total_points ?? 0, points: 0 };
    }

    const oldPoints = await resolveHomeworkAwardPoints(
      fresh.status as "approved" | "starred",
      sub.centre_id,
    );
    if (oldPoints === points) {
      // Identical award value — metadata only, do NOT bump revision (AT18).
      // Preserve original marked_by/marked_at; audit records who re-graded.
      await tx
        .update(homework_submissions)
        .set({
          status: body.status,
          ...feedbackPatch,
        })
        .where(eq(homework_submissions.id, sub.id));
      const [bal] = await tx
        .select({ total_points: punya_balances.total_points })
        .from(punya_balances)
        .where(eq(punya_balances.student_id, sub.student_id))
        .limit(1);
      return { kind: "metadata" as const, total_points: bal?.total_points ?? 0, points: 0 };
    }

    // Different point value: reverse old, award new, bump revision.
    const prior = await findLatestUnreversedHomeworkAward(tx, sub.id, sub.student_id);
    if (prior && prior.points > 0) {
      await reversePunya(
        {
          studentId: sub.student_id,
          featureKey: "homework",
          points: prior.points,
          note: "Homework re-grade reversal",
          awardedBy: req.authUser!.id,
          idempotencyKey: homeworkReversalKey(prior.idempotency_key),
        },
        tx,
      );
    }

    const [bumped] = await tx
      .update(homework_submissions)
      .set({
        status: body.status,
        ...feedbackPatch,
        // Keep the original grader; audit log carries the re-grader.
        revision: sql`${homework_submissions.revision} + 1`,
      })
      .where(eq(homework_submissions.id, sub.id))
      .returning({ revision: homework_submissions.revision });

    const awardRevision = bumped!.revision;
    const award = await awardPunya(
      {
        studentId: sub.student_id,
        featureKey: "homework",
        points,
        note: body.status === "starred" ? "Homework starred" : "Homework approved",
        awardedBy: req.authUser!.id,
        idempotencyKey: homeworkAwardKey(sub.id, awardRevision),
        sourceEntityKind: "homework",
        sourceEntityId: sub.id,
        sourceRevision: awardRevision,
      },
      tx,
    );
    return {
      kind: "regrade" as const,
      total_points: award.total_points,
      points,
      reversed: prior?.points ?? 0,
    };
  });

  if (result.kind === "first_grade") {
    await auditFromReq(req, {
      action: "grade",
      entityKind: "homework_submission",
      entityId: sub.id,
      summary: `Graded homework submission as ${body.status} (+${result.points}).`,
      metadata: { status: body.status, points: result.points },
    });
    await notifyParentHomeworkGraded({
      studentId: sub.student_id,
      status: body.status,
      assignmentId: sub.assignment_id,
    });
  } else if (result.kind === "regrade") {
    await auditFromReq(req, {
      action: "grade",
      entityKind: "homework_submission",
      entityId: sub.id,
      summary: `Re-graded homework submission as ${body.status} (reverse ${result.reversed}, award ${result.points}).`,
      metadata: {
        status: body.status,
        points: result.points,
        reversed: result.reversed,
        re_grade: true,
      },
    });
    await notifyParentHomeworkGraded({
      studentId: sub.student_id,
      status: body.status,
      assignmentId: sub.assignment_id,
    });
  } else {
    await auditFromReq(req, {
      action: "grade",
      entityKind: "homework_submission",
      entityId: sub.id,
      summary: `Re-graded homework submission as ${body.status} (no punya change).`,
      metadata: { status: body.status, points: 0, re_grade: true },
    });
  }

  ok(res, { id: sub.id, status: body.status, total_points: result.total_points });
});

/**
 * POST /v1/homework/submissions/:id/ungrade — reverse Punya and return to
 * submitted/late. No 30-day window (unlike niyam Q5): homework grades are
 * pastoral corrections that must stay fixable after parent conversations, and
 * assignment force_delete already needs unbounded reverse of the same awards.
 */
router.post("/submissions/:id/ungrade", requireAdminPanel, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const scope = await resolveAdminScope(req.authUser!);
  const [sub] = await db
    .select({
      id: homework_submissions.id,
      student_id: homework_submissions.student_id,
      status: homework_submissions.status,
      late: homework_submissions.late,
      revision: homework_submissions.revision,
      batch_id: homework_assignments.batch_id,
      centre_id: batches.centre_id,
    })
    .from(homework_submissions)
    .innerJoin(homework_assignments, eq(homework_assignments.id, homework_submissions.assignment_id))
    .innerJoin(batches, eq(batches.id, homework_assignments.batch_id))
    .where(and(eq(homework_submissions.id, id), isNull(homework_assignments.deleted_at)))
    .limit(1);
  if (!sub || !inBatchWriteScope(scope, sub.batch_id, sub.centre_id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Submission not found.");
    return;
  }
  if (sub.status !== "approved" && sub.status !== "starred") {
    fail(res, 409, "ERR_CONFLICT", "Only an approved or starred submission can be un-graded.");
    return;
  }

  const restoredStatus = sub.late ? ("late" as const) : ("submitted" as const);

  const outcome = await db.transaction(async (tx) => {
    const prior = await findLatestUnreversedHomeworkAward(tx, sub.id, sub.student_id);
    let reversedPoints = 0;
    if (prior && prior.points > 0) {
      const rev = await reversePunya(
        {
          studentId: sub.student_id,
          featureKey: "homework",
          points: prior.points,
          note: "Homework un-graded",
          awardedBy: req.authUser!.id,
          idempotencyKey: homeworkReversalKey(prior.idempotency_key),
        },
        tx,
      );
      reversedPoints = rev.reversed ? rev.points_reversed : 0;
      // Idempotent replay still reports the reversed amount without double-debit.
      if (!rev.reversed) reversedPoints = rev.points_reversed;
    }

    await tx
      .update(homework_submissions)
      .set({
        status: restoredStatus,
        marked_by: null,
        marked_at: null,
        revision: sql`${homework_submissions.revision} + 1`,
      })
      .where(eq(homework_submissions.id, sub.id));

    const [bal] = await tx
      .select({ total_points: punya_balances.total_points })
      .from(punya_balances)
      .where(eq(punya_balances.student_id, sub.student_id))
      .limit(1);

    return {
      status: restoredStatus,
      points_reversed: prior?.points ?? 0,
      total_points: bal?.total_points ?? 0,
      actually_reversed: reversedPoints > 0 || (prior != null && prior.points > 0),
    };
  });

  await auditFromReq(req, {
    action: "grade",
    entityKind: "homework_submission",
    entityId: sub.id,
    summary: `Un-graded homework submission (restored to ${outcome.status}, reversed ${outcome.points_reversed}).`,
    metadata: {
      ungrade: true,
      restored_status: outcome.status,
      points_reversed: outcome.points_reversed,
    },
  });

  ok(res, {
    id: sub.id,
    status: outcome.status,
    points_reversed: outcome.points_reversed,
    total_points: outcome.total_points,
  });
});

/* ═══════════════════════════ Student / parent ═══════════════════════════ */

/* GET /v1/homework/mine?student_id=&limit=&cursor= — a student's homework feed */
router.get("/mine", async (req: Request, res: Response) => {
  const studentId = String(req.query.student_id ?? "");
  if (!UUID_RE.test(studentId) || !(await ownedStudentId(req, studentId))) {
    fail(res, 404, "ERR_NOT_FOUND", "Student not found.");
    return;
  }
  const limit = clampLimit(req.query.limit, 50, 200);
  const cursor = decodeKeysetCursor(req.query.cursor, DATE_RE);

  const filters = [
    eq(homework_submissions.student_id, studentId),
    isNull(homework_assignments.deleted_at),
  ];
  if (cursor) {
    filters.push(
      or(
        lt(homework_assignments.due_date, cursor.value),
        and(
          eq(homework_assignments.due_date, cursor.value),
          lt(homework_submissions.id, cursor.id),
        ),
      )!,
    );
  }

  const rows = await db
    .select({
      id: homework_submissions.id,
      assignment_id: homework_assignments.id,
      title: homework_assignments.title,
      description: homework_assignments.description,
      due_date: homework_assignments.due_date,
      attachment_url: homework_assignments.attachment_url,
      is_msv: homework_assignments.is_msv,
      status: homework_submissions.status,
      submission_url: homework_submissions.submission_url,
      feedback_note: homework_submissions.feedback_note,
      late: homework_submissions.late,
    })
    .from(homework_submissions)
    .innerJoin(homework_assignments, eq(homework_assignments.id, homework_submissions.assignment_id))
    .where(and(...filters))
    .orderBy(desc(homework_assignments.due_date), desc(homework_submissions.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeKeysetCursor(last.due_date, last.id) : null;

  const items = page.map((r) => ({
    ...r,
    attachment_url: signUploadUrl(r.attachment_url),
    submission_url: signUploadUrl(r.submission_url),
  }));
  ok(res, { items }, { count: items.length, has_more: hasMore, next_cursor: nextCursor });
});

const submitSchema = z.object({
  submission_url: httpUrl(1000),
});

/* POST /v1/homework/submissions/:id/submit — student/parent uploads their work */
router.post("/submissions/:id/submit", async (req: Request, res: Response) => {
  let body: z.infer<typeof submitSchema>;
  try {
    body = submitSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid submission data.");
    return;
  }

  const { applyHomeworkSubmit, HomeworkSubmitError } = await import("../../services/homework-submit-sync");
  try {
    const data = await applyHomeworkSubmit({
      actor: req.authUser!,
      submissionId: String(req.params.id),
      fileUrl: body.submission_url,
    });
    ok(res, { id: data.id, status: data.status, late: data.late });
  } catch (err) {
    if (err instanceof HomeworkSubmitError) {
      fail(res, err.httpStatus, err.code, err.message);
      return;
    }
    throw err;
  }
});

export default router;
